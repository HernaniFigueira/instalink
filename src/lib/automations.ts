// ═══════════════════════════════════════════════════════════════
// AUTOMAÇÕES — operacionais, reais e simples (arquitetadas p/ expansão)
// ═══════════════════════════════════════════════════════════════
// Cinco gatilhos deste ciclo (nada de dezenas):
//
//   agendamento confirmado  → confirmação
//   antes do atendimento    → lembrete
//   atendimento concluído   → pós-atendimento
//   pós-atendimento         → avaliação
//   cliente sem retorno     → oportunidade/ação INTERNA
//
// HONESTIDADE (§ WhatsApp): automação NÃO simula envio. A mensagem nasce na
// FILA do WhatsApp oficial (status 'pending', visível no inbox) e só é
// entregue pela integração conectada. Sem integração, fica na fila — o
// negócio vê exatamente o que sairia e pode copiar/enviar manualmente.
//
// NEUTRALIDADE (§ Saúde/Conteúdo): nenhum texto promocional hardcoded, nenhuma
// promessa de resultado — só confirmações operacionais com os dados reais.
//
// Este módulo é PURO sobre o DB recebido (roda dentro de updateDB).
import { randomUUID } from 'node:crypto';
import type { Booking, Business, BusinessCustomer, DB } from './types';
import { ingestLead, moveLeadStage, getBusinessPipeline, normalizeLeadStageId } from './pipeline';
import { phoneKey } from './whatsapp';
import { publicBookingSummary } from './pricing';
import { addDaysISO, todayISO } from './tz';

export type AutomationId =
  | 'booking_confirmation'
  | 'booking_reminder'
  | 'post_service'
  | 'review_request'
  | 'win_back';

export interface AutomationDef {
  id: AutomationId;
  label: string;
  trigger: string;
  hint: string;
}

export const AUTOMATIONS: AutomationDef[] = [
  {
    id: 'booking_confirmation', label: 'Confirmação de agendamento',
    trigger: 'Agendamento criado/confirmado',
    hint: 'Mensagem na fila com data, hora e serviço — o cliente sabe que reservou.',
  },
  {
    id: 'booking_reminder', label: 'Lembrete antes do atendimento',
    trigger: 'Atendimento nas próximas 24h',
    hint: 'Lembrete automático na véspera/dia do atendimento (uma vez por agendamento).',
  },
  {
    id: 'post_service', label: 'Pós-atendimento',
    trigger: 'Atendimento concluído',
    hint: 'Agradecimento neutro após a conclusão — sem promessa de resultado.',
  },
  {
    id: 'review_request', label: 'Convite de avaliação',
    trigger: 'Atendimento concluído',
    hint: 'Convida o cliente a avaliar (uma vez por atendimento concluído).',
  },
  {
    id: 'win_back', label: 'Cliente sem retorno',
    trigger: 'Ação interna (sem disparo)',
    hint: 'Cria oportunidade na base para o negócio agir — não envia mensagem.',
  },
];

/** Automação ativa? (padrão: sim; o lojista pode desligar por empresa). */
export function automationEnabled(
  business: Pick<Business, 'automations'>,
  id: AutomationId,
): boolean {
  return (business.automations || {})[id] !== false;
}

/** Chave de dedupe de mensagem de automação (idempotente por agendamento). */
export function automationKey(kind: AutomationId | string, bookingId: string): string {
  return `auto:${kind}:${bookingId}`;
}

export interface AutomationBookingInfo {
  customerName: string;
  customerPhone: string;
  date: string;
  time: string;
  serviceName: string;
}

/** Textos operacionais neutros (sem promessa clínica/resultado). */
export function automationMessage(
  kind: AutomationId,
  ctx: { businessName: string; booking: AutomationBookingInfo; reviewUrl?: string; confirmed?: boolean },
): string {
  const first = (ctx.booking.customerName || '').trim().split(/\s+/)[0] || 'tudo bem';
  const when = publicBookingSummary(ctx.booking.date, ctx.booking.time);
  switch (kind) {
    case 'booking_confirmation':
      return ctx.confirmed
        ? `Olá${first ? `, ${first}` : ''}! Seu agendamento na ${ctx.businessName} está CONFIRMADO: ${ctx.booking.serviceName}, ${when}. Até lá!`
        : `Olá${first ? `, ${first}` : ''}! Registramos seu agendamento na ${ctx.businessName}: ${ctx.booking.serviceName}, ${when}. A equipe confirma por aqui em instantes — se precisar remarcar ou cancelar, responda por aqui.`;
    case 'booking_reminder':
      return `Oi${first ? `, ${first}` : ''}! Lembrete do seu ${ctx.booking.serviceName} na ${ctx.businessName}: ${when}. Até lá!`;
    case 'post_service':
      return `Obrigado pela visita${first ? `, ${first}` : ''}! Se precisar de qualquer coisa da ${ctx.businessName}, é só chamar por aqui.`;
    case 'review_request':
      return `${first ? `${first}, q` : 'Q'}ueremos saber como foi seu atendimento na ${ctx.businessName}. Sua opinião ajuda muito${ctx.reviewUrl ? ` — é rapidinho: ${ctx.reviewUrl}` : ''}!`;
    default:
      return '';
  }
}

// ── Fila do WhatsApp oficial (mensagem pendente; nunca "enviada") ──

function findOrCreateConversation(
  d: DB,
  opts: { businessId: string; phone: string; name: string; contactId?: string },
): void {
  const digits = phoneKey(opts.phone);
  if (!digits) return;
  let conv = d.conversations.find(
    (c) => c.businessId === opts.businessId && c.phone === digits && c.channel === 'whatsapp',
  );
  const now = new Date().toISOString();
  if (!conv) {
    const contact = d.contacts.find((c) => c.businessId === opts.businessId && c.phone === digits);
    conv = {
      id: randomUUID(),
      businessId: opts.businessId,
      channel: 'whatsapp',
      contactId: contact?.id || '',
      customerId: contact?.customerId || '',
      name: opts.name || contact?.name || digits,
      phone: digits,
      status: 'open',
      unread: 0,
      lastMessageAt: now,
      lastMessagePreview: '',
      createdAt: now,
    };
    d.conversations.push(conv);
  }
}

/**
 * Enfileira uma mensagem de automação (idempotente pela chave externa).
 * Retorna true quando criou a mensagem; false quando já existia (dedupe) ou
 * quando o automação está desligada.
 */
export function enqueueAutomationMessage(
  d: DB,
  opts: {
    businessId: string;
    phone: string;
    name: string;
    body: string;
    key: string;
  },
): boolean {
  const digits = phoneKey(opts.phone);
  if (!digits || !opts.body.trim()) return false;
  if (d.messages.some((m) => m.businessId === opts.businessId && m.externalId === opts.key)) return false;
  findOrCreateConversation(d, { businessId: opts.businessId, phone: digits, name: opts.name });
  const conv = d.conversations.find(
    (c) => c.businessId === opts.businessId && c.phone === digits && c.channel === 'whatsapp',
  );
  if (!conv) return false;
  const now = new Date().toISOString();
  d.messages.push({
    id: randomUUID(),
    businessId: opts.businessId,
    conversationId: conv.id,
    direction: 'out',
    body: opts.body,
    status: 'pending', // fila do WhatsApp oficial — nada é marcado como enviado
    externalId: opts.key,
    by: 'automation',
    at: now,
  });
  conv.lastMessageAt = now;
  conv.lastMessagePreview = opts.body.slice(0, 120);
  return true;
}

/** Enfileira a automação de um agendamento (respeita o toggle da empresa). */
export function enqueueBookingAutomation(
  d: DB,
  opts: {
    businessId: string;
    kind: AutomationId;
    booking: AutomationBookingInfo & { id?: string };
    status?: string;
    reviewUrl?: string;
    /** Diferencia mensagens do mesmo gatilho (ex.: registro × confirmação). */
    variant?: string;
  },
): boolean {
  const business = d.businesses.find((b) => b.id === opts.businessId);
  if (!business || !automationEnabled(business, opts.kind)) return false;
  const body = automationMessage(opts.kind, {
    businessName: business.name,
    booking: opts.booking,
    reviewUrl: opts.reviewUrl,
    ...(opts.variant === 'confirmed' ? { confirmed: true } : {}),
  });
  const base = opts.booking.id
    || `${opts.booking.date}T${opts.booking.time}:${opts.booking.customerPhone}:${opts.booking.serviceName}`;
  return enqueueAutomationMessage(d, {
    businessId: opts.businessId,
    phone: opts.booking.customerPhone,
    name: opts.booking.customerName,
    body,
    key: automationKey(opts.kind, opts.variant ? `${base}::${opts.variant}` : base),
  });
}

// ── Lembretes (antes do atendimento) ──────────────────────────

/** Agendamentos que acontecem hoje/amanhã e ainda não têm lembrete na fila. */
export function dueReminderBookings(
  d: DB,
  businessId: string,
  today: string,
): Booking[] {
  const tomorrow = addDaysISO(today, 1);
  return d.bookings.filter((b) => {
    if (b.businessId !== businessId) return false;
    if (b.status !== 'confirmed' && b.status !== 'pending') return false;
    if (b.date !== today && b.date !== tomorrow) return false;
    const key = automationKey('booking_reminder', b.id);
    return !d.messages.some((m) => m.businessId === businessId && m.externalId === key);
  });
}

/**
 * Enfileira todos os lembretes devidos (idempotente). Chamado quando a
 * operação abre a agenda — cada lembrete é criado UMA vez por agendamento.
 */
export function enqueueDueReminders(d: DB, businessId: string, today: string): number {
  const business = d.businesses.find((b) => b.id === businessId);
  if (!business || !automationEnabled(business, 'booking_reminder')) return 0;
  const due = dueReminderBookings(d, businessId, today);
  let count = 0;
  for (const b of due) {
    const service = d.services.find((s) => s.id === b.serviceId);
    const ok = enqueueAutomationMessage(d, {
      businessId,
      phone: b.customerPhone,
      name: b.customerName,
      body: automationMessage('booking_reminder', {
        businessName: business.name,
        booking: {
          customerName: b.customerName,
          customerPhone: b.customerPhone,
          date: b.date,
          time: b.time,
          serviceName: service?.name || 'atendimento',
        },
      }),
      key: automationKey('booking_reminder', b.id),
    });
    if (ok) count += 1;
  }
  return count;
}

// ── Pós-atendimento + avaliação (na conclusão) ────────────────

/** Automações disparadas quando um atendimento é CONCLUÍDO. */
export function onBookingCompleted(d: DB, businessId: string, booking: Booking): void {
  const business = d.businesses.find((b) => b.id === businessId);
  if (!business) return;
  const service = d.services.find((s) => s.id === booking.serviceId);
  const info = {
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    date: booking.date,
    time: booking.time,
    serviceName: service?.name || 'atendimento',
  };
  enqueueBookingAutomation(d, { businessId, kind: 'post_service', booking: info });
  enqueueBookingAutomation(d, {
    businessId, kind: 'review_request', booking: info,
    reviewUrl: business.googleUrl || `/${business.slug}`,
  });
}

// ── Cliente sem retorno (oportunidade INTERNA — sem disparo) ──

export interface WinBackCandidate {
  contact: BusinessCustomer;
  lastBookingDate: string;
  daysSince: number;
}

/**
 * Clientes que já atenderam e estão sem retorno há `inactiveDays` (padrão 30).
 * Gera OPORTUNIDADE INTERNA (lead de retorno) — não envia mensagem; o
 * disparo, se quiser, é campanha (que exige consentimento explícito).
 */
export function winBackCandidates(
  d: DB,
  businessId: string,
  today = todayISO(),
  inactiveDays = 30,
): WinBackCandidate[] {
  const cutoff = addDaysISO(today, -inactiveDays);
  const bookings = d.bookings.filter((b) => b.businessId === businessId);
  const pipeline = getBusinessPipeline(d, businessId);
  const out: WinBackCandidate[] = [];
  for (const contact of d.contacts) {
    if (contact.businessId !== businessId) continue;
    const digits = phoneKey(contact.phone);
    if (!digits) continue;
    const mine = bookings.filter(
      (b) => b.customerPhone === digits || phoneKey(b.customerPhone) === digits,
    );
    if (mine.length === 0) continue;
    const last = mine.reduce((acc, b) => (b.date > acc ? b.date : acc), '');
    if (!last || last >= cutoff) continue;
    // A3 fechamento — oportunidade aberta = PipelineStage não terminal (não LeadStatus)
    const hasOpen = d.leads.some((l) => {
      if (l.businessId !== businessId) return false;
      if (l.action !== 'retorno') return false;
      const match = phoneKey(l.phone) === digits || (contact.customerId && l.customerId === contact.customerId);
      if (!match) return false;
      const cur = normalizeLeadStageId(pipeline, l);
      const st = pipeline.stages.find((s) => s.id === cur);
      return st ? !st.isTerminal : false;
    });
    if (hasOpen) continue;
    out.push({
      contact,
      lastBookingDate: last,
      daysSince: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86400000),
    });
  }
  return out.sort((a, b) => (a.lastBookingDate < b.lastBookingDate ? -1 : 1));
}

/** Cria as oportunidades de retorno (leads internos com action 'retorno'). */
export function createWinBackLeads(d: DB, businessId: string, today = todayISO()): number {
  const business = d.businesses.find((b) => b.id === businessId);
  if (!business || !automationEnabled(business, 'win_back')) return 0;
  const now = new Date().toISOString();
  let count = 0;
  // A3.17 — entrada interna VIA ingestLead (única porta): pipeline válido,
  // stageId/stageHistory, status projetado, contato e eventos P4 corretos.
  // Se o lead já existir e estiver terminal (converted/lost), reabre para `new`
  // via máquina oficial (mesmo lead, sem duplicação, histórico correto).
  for (const c of winBackCandidates(d, businessId, today)) {
    try {
      const res = ingestLead(d, {
        businessId,
        customerId: c.contact.customerId || undefined,
        name: c.contact.name,
        phone: c.contact.phone,
        email: c.contact.email,
        interest: `Retorno — último atendimento ${c.lastBookingDate.split('-').reverse().join('/')}`,
        source: 'automacao',
        actor: { id: 'system', name: 'Automação', type: 'system' },
        now,
      });
      const lead = res.lead;
      lead.action = 'retorno';
      lead.interest = `Retorno — último atendimento ${c.lastBookingDate.split('-').reverse().join('/')}`;
      // Se ingest encontrou lead terminal existente, reabre para `new`
      if (!res.isNew) {
        const pipeline = getBusinessPipeline(d, businessId);
        const cur = normalizeLeadStageId(pipeline, lead);
        const curStage = pipeline.stages.find((s) => s.id === cur);
        if (curStage?.isTerminal) {
          try {
            moveLeadStage(d, {
              businessId,
              leadId: lead.id,
              toStageId: 'new',
              note: 'Retorno — oportunidade reaberta',
              actor: { id: 'system', name: 'Automação' },
              now,
            });
          } catch {}
        }
      }
      count += 1;
    } catch (e) {
      // Falha de domínio: não cria lead paralelo, apenas não conta.
      // Erro observável via console em dev; em prod o motor registra no histórico.
      // console.warn('[winBack] falha ao criar oportunidade', e);
      void e;
    }
  }
  return count;
}
