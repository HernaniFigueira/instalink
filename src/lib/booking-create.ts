// ═══════════════════════════════════════════════════════════════
// CRIAÇÃO DE AGENDAMENTO — caminho ÚNICO (página · painel · assistente)
// ═══════════════════════════════════════════════════════════════
// Regra do produto (§ Assistente + Agenda): o assistente usa EXATAMENTE as
// mesmas regras da Agenda — disponibilidade, conflito, duração, buffer,
// lead time, profissionais elegíveis, autoatribuição (menor carga no dia).
// Nenhuma IA implementa uma agenda paralela: este módulo é o único ponto de
// criação de Booking, reutilizado por /api/bookings (público + dono) e pelo
// assistente (/api/concierge, canal site e WhatsApp).
//
// A função roda DENTRO de updateDB (transação sobre a leitura mais fresca):
// o slot é revalidado no momento da escrita — corrida de dupla reserva
// continua impossível (409 quando ocupado).
import { randomUUID } from 'node:crypto';
import type { BookingStatus, Business, DB, Service } from './types';
import { computeSlots } from './slots';
import { resolveProfessional } from './booking';
import { upsertContact } from './contacts';
import { onlyDigits } from './utils';
import { isValidDateISO, isValidClockTime, effectiveTimezone, weekdayOf, todayISO, nowHM } from './tz';
import { enqueueBookingAutomation, enqueueDueReminders } from './automations';
import { bookingMaxDate } from './booking-ops';
import { fitInConflictsFromDB, fitInPastError, fitInWarning } from './fit-in';
// A2-B1 (F2): o destino do lead passa pela máquina OFICIAL da esteira
// (pipeline.ts é também importado aqui — dependência circular só de funções,
// resolvida em runtime; nenhum dos módulos executa o outro no load).
import { ensureScheduledStage, ingestLead, markLeadScheduled } from './pipeline';
// P4 — o agendamento é UM caminho (este arquivo); o gatilho nasce aqui para
// que página, painel, assistente, widget, API externa e automação disparem as
// MESMAS automações. Não existe segunda fonte do evento.
import { emitAutomationEvent } from './automation/events';

export function txError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

export type BookingActor = 'owner' | 'customer' | 'agent';

// ═══════════════════════════════════════════════════════════════
// A2-B2 (F1) — IDENTIDADE DO AGENDAMENTO (sessão · guest · dono)
// ═══════════════════════════════════════════════════════════════
// Regra única usada por /api/bookings: cliente logado mantém a identidade da
// CONTA (nunca re-perguntado); GUEST informado no fluxo (/agendar e widget)
// conclui SEM cadastro; dono digita/escolhe o contato do CRM.
// A validação vive AQUI (servidor) — a UI nunca é a autoridade.
export interface BookingIdentityInput {
  isOwner: boolean;
  sessionCustomer: { id: string; name: string; phone: string; email?: string } | null;
  body: {
    customerName?: unknown;
    customerPhone?: unknown;
    customerEmail?: unknown;
  };
  linked?: { name?: string; phone?: string; email?: string } | null;
}

export type BookingIdentity =
  | { ok: true; name: string; phoneDigits: string; email: string; source: 'session' | 'guest' | 'owner' }
  | { ok: false; error: string; code?: 'login_required' | 'phone_required' };

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function resolveBookingIdentity(input: BookingIdentityInput): BookingIdentity {
  const bodyName = str(input.body.customerName);
  const bodyPhone = str(input.body.customerPhone);
  const bodyEmail = str(input.body.customerEmail).toLowerCase().slice(0, 120);

  if (input.isOwner) {
    const name = (bodyName || str(input.linked?.name)).slice(0, 80);
    const phone = bodyPhone || str(input.linked?.phone);
    return {
      ok: true,
      name,
      phoneDigits: onlyDigits(phone),
      email: bodyEmail || str(input.linked?.email),
      source: 'owner',
    };
  }

  // Cliente autenticado: a CONTA vence (evita duplicação de dados) — campos
  // ausentes na conta (nome/telefone/e-mail) são COMPLEMENTADOS pelo fluxo
  // em vez de recusar quem já está logado com cadastro incompleto.
  if (input.sessionCustomer) {
    const name = (str(input.sessionCustomer.name) || bodyName).slice(0, 80);
    const phone = str(input.sessionCustomer.phone) || bodyPhone;
    return {
      ok: true,
      name,
      phoneDigits: onlyDigits(phone),
      email: str(input.sessionCustomer.email) || bodyEmail,
      source: 'session',
    };
  }

  // Guest (DECISÃO 5): sem conta, identidade informada no fluxo. Sem NENHUMA
  // identidade ⇒ continua exigindo login (fluxo da página pública que abre o
  // sheet de conta a partir do 401).
  if (!bodyName) {
    return { ok: false, error: 'Entre para agendar.', code: 'login_required' };
  }
  const digits = onlyDigits(bodyPhone);
  if (digits.length < 10) {
    return { ok: false, error: 'Precisamos do seu WhatsApp para confirmar.', code: 'phone_required' };
  }
  return {
    ok: true,
    name: bodyName.slice(0, 80),
    phoneDigits: digits,
    email: bodyEmail,
    source: 'guest',
  };
}

export interface CreateBookingParams {
  business: Pick<Business, 'id' | 'booking' | 'businessTimezone'>;
  service: Pick<Service, 'id' | 'durationMin' | 'professionalIds' | 'name' | 'bookable' | 'active'>;
  date: string;
  time: string;
  actor: BookingActor;
  /** Identidade do cliente (conta logada ou dados informados no chat). */
  customer: { id: string; name: string; phone: string; email?: string } | null;
  /** Contato do CRM escolhido no painel (dono) — nome/fone vêm dele. */
  linkedContact?: { id: string; name: string; phone: string; email: string; customerId: string } | null;
  /** Profissional indicado explicitamente (SÓ o dono pode; precisa ser elegível). */
  professionalId?: string;
  note?: string;
  answers?: string[];
  /** Consentimento explícito de marketing dado pelo cliente AGORA (nunca presumido). */
  marketingOptIn?: boolean;
  /** Origem do contato no CRM (agendamento | agente | …). */
  source?: string;
  now?: string;
  /** P3: Lead de origem para vínculo direto. */
  leadId?: string;
  /** P4: execução de automação que criou o agendamento (anti-loop). */
  originRunId?: string;
  /**
   * A3.4 · Bloco 4 — ENCAIXE. `fit_in` aceita um horário FORA da grade (com
   * conflito reconhecido por quem cria). A autorização é do servidor: só o
   * dono/equipe agenda encaixe — o fluxo público do cliente nunca consegue.
   */
  bookingKind?: import('./types').BookingKind;
  /**
   * O conflito do encaixe foi MOSTRADO e confirmado por quem cria. Sem isto,
   * o motor recusa o encaixe conflitante (nada é gravado em silêncio).
   */
  fitInConfirmed?: boolean;
  series?: Pick<import('./types').Booking, 'seriesId' | 'seriesIndex' | 'seriesCount' | 'seriesRequestId' | 'seriesFingerprint'>;
  /**
   * FASE 2 · P6 — veterinária: pet atendido (paciente). O DONO escolhe no
   * painel; o fluxo público nunca envia. A validação de existência é do
   * chamador (rota) — aqui só persistimos o vínculo aditivo.
   */
  petId?: string;
}

/**
 * Cria o agendamento (transação). Valida o slot com o motor real, resolve o
 * profissional pela política interna (cliente nunca escolhe), alimenta o CRM
 * (upsert de contato) e dispara a automação de confirmação.
 *
 * Status inicial: owner → 'confirmed' · customer/agent → 'pending'
 * (o fluxo público e o assistente reservam; o negócio confirma).
 */
export function createBookingTx(d: DB, p: CreateBookingParams): {
  bookingId: string;
  professionalId: string;
  professionalName: string;
  /** Status inicial do agendamento ('confirmed' dono · 'pending' cliente) — A2-B2: resultado honesto. */
  status: BookingStatus;
} {
  const businessId = p.business.id;
  const isOwner = p.actor === 'owner';
  const now = p.now || new Date().toISOString();
  const digits = onlyDigits(p.customer?.phone || p.linkedContact?.phone || '');
  const name = (p.customer?.name || p.linkedContact?.name || '').trim().slice(0, 80);

  const service = d.services.find((s) => s.id === p.service.id && s.businessId === businessId);
  if (!service || service.active === false) throw txError('Serviço indisponível.', 400);
  if (!isOwner && service.bookable === false) throw txError('Este serviço não aceita agendamento.', 400);

  const business = d.businesses.find((b) => b.id === businessId) || p.business;
  const cfg = business.booking;
  if (!isValidDateISO(p.date) || !isValidClockTime(p.time)) throw txError('Escolha data e horário.', 400);
  // A2-B5 (F9): horizonte/passado/lead time no FUSO DO NEGÓCIO.
  const btz = effectiveTimezone(business.businessTimezone);
  const nowDate = p.now ? new Date(p.now) : new Date();
  const today = todayISO(nowDate, btz);
  if (p.date < today) throw txError('Não é possível agendar no passado.', 400);
  const horizon = bookingMaxDate(today, cfg, isOwner);
  if (p.date > horizon) throw txError('Data fora da agenda disponível.', 400);
  // A3.4 (teste humano): HOJE tem relógio. A grade já não oferece horário
  // passado, mas o ENCAIXE entra por fora dela — então a régua do relógio
  // fica aqui, no caminho único, valendo para todos os chamadores.
  // (Mensagem específica do encaixe quando for encaixe; genérica no resto.)
  const pastError = p.date === today ? fitInPastError(p.date, p.time, today, nowHM(nowDate, btz)) : '';
  if (pastError) {
    throw txError(p.bookingKind === 'fit_in' ? pastError : 'Este horário já passou. Escolha um horário a partir de agora.', 400);
  }

  const activePros = d.professionals.filter((x) => x.businessId === businessId && x.active !== false);
  const eligible = (service.professionalIds || []).length > 0
    ? activePros.filter((x) => (service.professionalIds || []).includes(x.id))
    : activePros;

  let ownerPro = '';
  if (isOwner) {
    ownerPro = String(p.professionalId || '');
    if (ownerPro && !eligible.some((x) => x.id === ownerPro)) {
      throw txError('Profissional indisponível para este serviço.', 400);
    }
  }

  // Revalidação atômica: mesmo motor, dados frescos, dentro da transação.
  const r = computeSlots({
    rules: d.availability.filter((a) => a.businessId === businessId),
    exceptions: d.exceptions.filter((e) => e.businessId === businessId),
    bookings: d.bookings.filter((b) => b.businessId === businessId),
    services: d.services.filter((s) => s.businessId === businessId),
    professionals: d.professionals.filter((x) => x.businessId === businessId),
    dateISO: p.date,
    weekday: weekdayOf(p.date),
    serviceId: service.id,
    durationMin: service.durationMin,
    professionalId: isOwner ? ownerPro : '',
    eligibleProIds: service.professionalIds || [],
    nowHM: p.date === today ? nowHM(nowDate, btz) : '',
    leadMin: cfg?.leadMin || 0,
    bufferMin: cfg?.bufferMin || 0,
  });
  // ── A3.4 · Bloco 4: encaixe (fit_in) ────────────────────────────────
  // O encaixe NÃO cria um segundo caminho de agendamento: muda UMA regra
  // (o horário não precisa estar na grade) e mantém TODAS as outras
  // (tenant, serviço, data, horizonte, passado, profissional elegível).
  // O que ele nunca faz é esconder o conflito: a mensagem diz com quem bate.
  const fitIn = p.bookingKind === 'fit_in';
  if (fitIn && !isOwner) throw txError('Encaixe é uma decisão da equipe.', 403);
  if (!fitIn && !r.slots.includes(p.time)) {
    throw txError('Este horário acabou de ser ocupado. Escolha outro.', 409);
  }
  if (fitIn) {
    const conflicts = fitInConflictsFromDB({
      bookings: d.bookings.filter((b) => b.businessId === businessId),
      services: d.services.filter((s) => s.businessId === businessId),
      professionals: eligible.map((x) => ({ id: x.id, name: x.name })),
    }, {
      date: p.date, time: p.time, durationMin: service.durationMin,
      professionalId: ownerPro, eligibleProIds: service.professionalIds || [],
    });
    if (conflicts.length > 0 && !p.fitInConfirmed) {
      throw Object.assign(txError(fitInWarning(conflicts), 409), { conflicts });
    }
  }

  // No encaixe sem escolha explícita o `r.assign` pode não existir (o horário
  // não está na grade): escolhemos, entre os elegíveis, quem tem MENOS
  // atendimentos ativos naquele dia — a mesma ideia de equilíbrio da agenda,
  // sem inventar uma segunda política.
  const fitInFallback = (() => {
    if (!fitIn || ownerPro || eligible.length === 0) return '';
    const loadOf = (id: string) => d.bookings.filter((b) =>
      b.businessId === businessId && b.date === p.date && b.professionalId === id &&
      (b.status === 'pending' || b.status === 'confirmed')).length;
    return [...eligible].sort((a, b) => (loadOf(a.id) - loadOf(b.id)) || a.name.localeCompare(b.name))[0]?.id || '';
  })();

  const finalPro = resolveProfessional({
    service,
    professionals: d.professionals.filter((x) => x.businessId === businessId),
    assign: r.assign,
    time: p.time,
    requested: ownerPro || fitInFallback,
    allowRequested: isOwner,
  });

  const status: BookingStatus = isOwner ? 'confirmed' : 'pending';
  const bookingId = randomUUID();
  d.bookings.push({
    ...p.series,
    id: bookingId,
    businessId,
    customerId: p.customer?.id || p.linkedContact?.customerId || '',
    serviceId: service.id,
    professionalId: finalPro,
    date: p.date,
    time: p.time,
    customerName: name,
    customerPhone: digits,
    status,
    ...(fitIn ? { bookingKind: 'fit_in' as const } : {}),
    note: String(p.note || '').slice(0, 300),
    createdAt: now,
    answers: (Array.isArray(p.answers) ? p.answers : [])
      .map((x: any) => String(x || '').trim().slice(0, 300)).slice(0, 3),
    updatedAt: now,
    history: [{
      at: now, from: '', to: status,
      by: isOwner ? 'owner' : p.actor === 'agent' ? 'agent' : 'customer',
      ...(fitIn ? { note: 'Encaixe criado fora da grade (conflito reconhecido pela equipe).' } : {}),
    }],
    leadId: p.leadId || undefined,
    // FASE 2 · P6 — vínculo com o PET (aditivo; só quando informado).
    ...(p.petId ? { petId: p.petId } : {}),
  });
  d.events.push({
    id: randomUUID(), businessId, type: 'booking_created', path: '',
    meta: { serviceId: service.id, via: p.actor, ...(fitIn ? { kind: 'fit_in' } : {}) }, createdAt: now,
  });
  d.events.push({ id: randomUUID(), businessId, type: 'conversion', path: '', meta: { kind: 'booking' }, createdAt: now });

  // CRM: o atendimento SEMPRE alimenta a base (upsert, nunca duplica).
  const crmContact = upsertContact(d, {
    businessId,
    customerId: p.customer?.id || p.linkedContact?.customerId || '',
    name,
    phone: digits,
    email: p.customer?.email || p.linkedContact?.email || '',
    source: p.source || 'agendamento',
    marketingOptIn: p.marketingOptIn,
    now,
  });

  // ── Lead associado (A2-B1 · F2) ──
  // NENHUM caminho escreve `stageId` diretamente: o destino estrutural
  // `scheduled` é garantido na esteira e toda movimentação passa pela
  // máquina oficial (markLeadScheduled → moveLeadStage). Leads novos entram
  // pela porta universal (ingestLead) — mesma entrada da página, API externa
  // e integrações; o histórico e os gatilhos do P4 ficam coerentes.
  ensureScheduledStage(d, businessId);

  const lead = p.leadId
    ? d.leads.find((l) => l.id === p.leadId && l.businessId === businessId)
    : (!isOwner
        ? d.leads.find((l) =>
            l.businessId === businessId &&
            ((p.customer?.id && l.customerId === p.customer.id) || (digits && onlyDigits(l.phone) === digits)),
          )
        : undefined);

  const leadActor = {
    id: isOwner ? 'owner' : p.actor === 'agent' ? 'agent' : 'customer',
    name: 'Agendamento',
  };
  const markParams = {
    businessId,
    customerId: p.customer?.id || '',
    phone: digits,
    name,
    bookingId,
    bookingDate: p.date,
    bookingTime: p.time,
    actor: leadActor,
    now,
    origin: p.originRunId ? { runId: p.originRunId } : undefined,
  };

  if (lead) {
    // Lead existente (inclusive terminal/perdido): REABRE e vai para
    // `scheduled` com status projetado recalculado — nunca stageId=scheduled
    // com status=lost, nunca lead duplicado.
    markLeadScheduled(d, { ...markParams, leadId: lead.id });
  } else if (!isOwner) {
    // Cliente sem lead no negócio: entrada universal de leads (única porta de
    // criação — dedupe, contato, histórico e eventos lead.created/conversion).
    const ingested = ingestLead(d, {
      businessId,
      customerId: p.customer?.id || '',
      name,
      phone: digits,
      email: p.customer?.email || '',
      interest: service.name,
      source: p.source || (p.actor === 'agent' ? 'agente' : 'agendamento'),
      actor: {
        id: p.customer?.id || 'system',
        name: name || 'Cliente',
        type: p.actor === 'agent' ? 'agent' : 'customer',
      },
      now,
    });
    ingested.lead.action = 'agendamento';
    markLeadScheduled(d, { ...markParams, leadId: ingested.lead.id });
  }

  // Automação: confirmação do agendamento (mensagem na fila do WhatsApp).
  enqueueBookingAutomation(d, {
    businessId,
    kind: 'booking_confirmation',
    booking: {
      id: bookingId,
      customerName: name, customerPhone: digits,
      date: p.date, time: p.time, serviceName: service.name,
    },
    status,
  });

  // A2-B3 (F6): lembretes vencidos nascem na ESCRITA, não na leitura — cada
  // criação aproveita a transação para enfileirar (idempotente por chave)
  // os lembretes de hoje/amanhã do negócio. O GET manage parou de escrever.
  try { enqueueDueReminders(d, businessId, today); } catch { /* melhor-esforço */ }

  const professionalName = finalPro
    ? d.professionals.find((x) => x.id === finalPro)?.name || ''
    : '';

  // P4 — gatilho de agendamento criado (depois do vínculo com o lead, para
  // que a condição enxergue o lead já atualizado).
  const created = d.bookings.find((b) => b.id === bookingId);
  if (created) {
    emitAutomationEvent(d, {
      event: 'booking.created',
      businessId,
      at: now,
      bookingId,
      leadId: created.leadId || p.leadId || undefined,
      customerId: crmContact?.id,
      data: { status, serviceId: service.id, professionalId: finalPro },
      fromRunId: p.originRunId,
    });
  }

  return { bookingId, professionalId: finalPro, professionalName, status };
}
