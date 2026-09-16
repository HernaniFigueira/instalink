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
import { addDaysISO, weekdayOf, todayISO, nowHM } from './tz';
import { enqueueBookingAutomation } from './automations';

export function txError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

export type BookingActor = 'owner' | 'customer' | 'agent';

export interface CreateBookingParams {
  business: Pick<Business, 'id' | 'booking'>;
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
} {
  const businessId = p.business.id;
  const isOwner = p.actor === 'owner';
  const now = p.now || new Date().toISOString();
  const digits = onlyDigits(p.customer?.phone || p.linkedContact?.phone || '');
  const name = (p.customer?.name || p.linkedContact?.name || '').trim().slice(0, 80);

  const service = d.services.find((s) => s.id === p.service.id && s.businessId === businessId);
  if (!service || service.active === false) throw txError('Serviço indisponível.', 400);
  if (!isOwner && service.bookable === false) throw txError('Este serviço não aceita agendamento.', 400);

  const cfg = p.business.booking;
  const today = todayISO();
  if (p.date < today) throw txError('Não é possível agendar no passado.', 400);
  const horizon = addDaysISO(today, Math.max(1, cfg?.horizonDays || 60));
  if (p.date > horizon) throw txError('Data fora da agenda disponível.', 400);

  const activePros = d.professionals.filter((x) => x.businessId === businessId && x.active !== false);
  const eligible = (service.professionalIds || []).length > 0
    ? activePros.filter((x) => (service.professionalIds || []).includes(x.id))
    : activePros;

  let ownerPro = '';
  if (isOwner) {
    ownerPro = String(p.professionalId || '');
    if (ownerPro && activePros.length > 0 && !eligible.some((x) => x.id === ownerPro)) {
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
    nowHM: p.date === todayISO() ? nowHM() : '',
    leadMin: cfg?.leadMin || 0,
    bufferMin: cfg?.bufferMin || 0,
  });
  if (!r.slots.includes(p.time)) {
    throw txError('Este horário acabou de ser ocupado. Escolha outro.', 409);
  }

  const finalPro = resolveProfessional({
    service,
    professionals: d.professionals.filter((x) => x.businessId === businessId),
    assign: r.assign,
    time: p.time,
    requested: ownerPro,
    allowRequested: isOwner,
  });

  const status: BookingStatus = isOwner ? 'confirmed' : 'pending';
  const bookingId = randomUUID();
  d.bookings.push({
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
    note: String(p.note || '').slice(0, 300),
    createdAt: now,
    answers: (Array.isArray(p.answers) ? p.answers : [])
      .map((x: any) => String(x || '').trim().slice(0, 300)).slice(0, 3),
    updatedAt: now,
    history: [{ at: now, from: '', to: status, by: isOwner ? 'owner' : p.actor === 'agent' ? 'agent' : 'customer' }],
    leadId: p.leadId || undefined,
  });
  d.events.push({ id: randomUUID(), businessId, type: 'booking_created', path: '', meta: { serviceId: service.id, via: p.actor }, createdAt: now });
  d.events.push({ id: randomUUID(), businessId, type: 'conversion', path: '', meta: { kind: 'booking' }, createdAt: now });

  // CRM: o atendimento SEMPRE alimenta a base (upsert, nunca duplica).
  upsertContact(d, {
    businessId,
    customerId: p.customer?.id || p.linkedContact?.customerId || '',
    name,
    phone: digits,
    email: p.customer?.email || p.linkedContact?.email || '',
    source: p.source || 'agendamento',
    marketingOptIn: p.marketingOptIn,
    now,
  });

  // Lead associado (fluxo público, assistente e vínculo direto).
  const lead = p.leadId
    ? d.leads.find((l) => l.id === p.leadId && l.businessId === businessId)
    : (!isOwner
        ? d.leads.find((l) =>
            l.businessId === businessId &&
            ((p.customer?.id && l.customerId === p.customer.id) || (digits && onlyDigits(l.phone) === digits)),
          )
        : undefined);

  if (lead) {
    const prevStage = lead.stageId || (lead.status === 'new' ? 'new' : 'in_progress');
    lead.bookingId = bookingId;
    lead.name = name || lead.name;
    if (p.customer?.id) lead.customerId = p.customer.id;
    lead.lastInteraction = now;
    lead.action = 'agendamento';
    lead.stageId = 'scheduled';
    if (lead.status === 'new' || lead.status === 'contacted' || lead.status === 'qualified') {
      lead.status = 'converted';
    }
    if (!Array.isArray(lead.stageHistory)) lead.stageHistory = [];
    lead.stageHistory.push({
      id: randomUUID(),
      fromStage: prevStage,
      toStage: 'scheduled',
      movedBy: isOwner ? 'owner' : (p.actor === 'agent' ? 'agent' : 'customer'),
      movedByName: isOwner ? 'Equipe' : 'Agendamento',
      at: now,
      note: `Agendado para ${p.date} às ${p.time}`,
    });
  } else if (!isOwner) {
    d.leads.push({
      id: randomUUID(), businessId, customerId: p.customer?.id || '', name, phone: digits,
      email: p.customer?.email || '', instagram: '',
      origin: p.actor === 'agent' ? 'agente' : 'agendamento',
      interest: service.name, action: 'agendamento', status: 'converted',
      stageId: 'scheduled',
      bookingId,
      createdAt: now, lastInteraction: now,
      stageHistory: [{
        id: randomUUID(),
        fromStage: 'new',
        toStage: 'scheduled',
        movedBy: p.actor === 'agent' ? 'agent' : 'customer',
        movedByName: 'Agendamento',
        at: now,
        note: `Agendado para ${p.date} às ${p.time}`,
      }],
    });
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

  const professionalName = finalPro
    ? d.professionals.find((x) => x.id === finalPro)?.name || ''
    : '';
  return { bookingId, professionalId: finalPro, professionalName };
}
