// ═══════════════════════════════════════════════════════════════
// P4.2 — ÔNIBUS DE GATILHOS (o evento vira execução persistida)
// ═══════════════════════════════════════════════════════════════
// Ponto ÚNICO onde um evento do sistema se transforma em execução de
// automação. Chamado de dentro dos serviços oficiais (ingestLead,
// moveLeadStage, assignLead, createBookingTx, applyBookingStatusTx) para que
// qualquer caminho que produz o evento dispare a automação — sem que cada rota
// precise lembrar disso (e sem segundo mecanismo de evento).
//
// O que este módulo faz:
//   1. tira uma FOTOGRAFIA segura do assunto (lead/cliente/agendamento);
//   2. escolhe as automações ativas daquele negócio para aquele evento;
//   3. cria `AutomationRun` com status 'queued' + histórico inicial;
//   4. NADA mais. Executar é trabalho do executor (executor.ts).
//
// O que este módulo garante:
//   • isolamento absoluto por `businessId` (a lista vem só da unidade);
//   • idempotência: a MESMA `eventKey` não gera segunda execução (por unidade
//     e por automação — duas automações do mesmo evento não se bloqueiam);
//   • anti-loop: evento produzido POR uma automação não reabre automações,
//     salvo `settings.allowReentry` explícito; e, mesmo quando reentra, a
//     corrente é limitada por profundidade (`MAX_REENTRY_DEPTH`);
//   • falha segura: qualquer problema aqui é medido e ignorado pelo chamador
//     (a operação do usuário — criar o lead, agendar — NUNCA falha por causa
//     de automação);
//   • teto de fila (o documento não cresce sem limite).
import { createHash, randomUUID } from 'node:crypto';
import type {
  Automation, AutomationEventId, AutomationRun, DB,
} from '../types';
import { automationsForEvent, isAutomationEvent } from './model';
import { resolveFieldPath, hasValue } from './conditions';
import { hasCapability } from './capabilities';

/** Fila por unidade: acima disso o gatilho é adiado (o cron continua depois). */
export const MAX_QUEUED_RUNS_PER_BUSINESS = 400;
/** Profundidade máxima de uma cadeia de execuções encadeadas (`allowReentry`). */
export const MAX_REENTRY_DEPTH = 5;
/** Tetos de tamanho de contexto (protegem o documento e o histórico). */
export const MAX_CONTEXT_STRING = 300;
export const MAX_RUNS_PER_EVENT = 25;

export interface EmitInput {
  event: AutomationEventId;
  businessId: string;
  at?: string;
  leadId?: string;
  customerId?: string;
  bookingId?: string;
  /** Dados do próprio evento (ex.: previousStageId, isNew, note). */
  data?: Record<string, any>;
  /** Execução de origem — anti-loop. */
  fromRunId?: string;
  /** Chave de idempotência explícita (sem ela deriva do assunto). */
  eventKey?: string;
}

export interface SkippedAutomation {
  automationId: string;
  reason: string;
}

export interface EmitResult {
  created: AutomationRun[];
  skipped: SkippedAutomation[];
  matched: number;
}

// ── Fotografia segura do assunto (whitelist de campos) ────────
function clip(value: unknown, max = MAX_CONTEXT_STRING): string {
  const raw = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
  return raw.slice(0, max);
}

export function leadSnapshot(lead: DB['leads'][number] | undefined): Record<string, unknown> | null {
  if (!lead) return null;
  return {
    id: clip(lead.id, 64),
    name: clip(lead.name, 80),
    phone: clip(lead.phone, 32),
    email: clip(lead.email, 120),
    instagram: clip(lead.instagram, 60),
    origin: clip(lead.origin, 40),
    channel: clip(lead.channel || '', 40),
    interest: clip(lead.interest, 200),
    action: clip(lead.action, 40),
    status: clip(lead.status, 20),
    stageId: clip(lead.stageId || lead.status || 'new', 32),
    priority: clip(lead.priority || 'medium', 12),
    assignedUserId: clip(lead.assignedUserId || '', 64),
    serviceId: clip(lead.serviceId || '', 64),
    professionalId: clip(lead.professionalId || '', 64),
    bookingId: clip(lead.bookingId || '', 64),
    createdAt: clip(lead.createdAt, 40),
    lastInteraction: clip(lead.lastInteraction, 40),
  };
}

export function customerSnapshot(contact: DB['contacts'][number] | undefined): Record<string, unknown> | null {
  if (!contact) return null;
  return {
    id: clip(contact.id, 64),
    customerId: clip(contact.customerId || '', 64),
    name: clip(contact.name, 80),
    phone: clip(contact.phone, 32),
    email: clip(contact.email, 120),
    source: clip(contact.source, 40),
    createdAt: clip(contact.createdAt, 40),
    lastInteraction: clip(contact.lastInteraction, 40),
    marketingOptIn: contact.marketingOptIn === true,
  };
}

export function bookingSnapshot(booking: DB['bookings'][number] | undefined): Record<string, unknown> | null {
  if (!booking) return null;
  return {
    id: clip(booking.id, 64),
    status: clip(booking.status, 20),
    date: clip(booking.date, 20),
    time: clip(booking.time, 10),
    serviceId: clip(booking.serviceId, 64),
    professionalId: clip(booking.professionalId || '', 64),
    customerId: clip(booking.customerId || '', 64),
    customerName: clip(booking.customerName, 80),
    customerPhone: clip(booking.customerPhone, 32),
    leadId: clip(booking.leadId || '', 64),
    note: clip(booking.note, 200),
    createdAt: clip(booking.createdAt, 40),
    updatedAt: clip(booking.updatedAt, 40),
  };
}

/** Monta o contexto lido pelas condições e templates (whitelist fechada). */
export function buildEventContext(
  db: DB,
  input: {
    businessId: string;
    event: AutomationEventId;
    at: string;
    data?: Record<string, any>;
    leadId?: string;
    customerId?: string;
    bookingId?: string;
  },
): Record<string, unknown> {
  const business = db.businesses.find((b) => b.id === input.businessId);
  const lead = input.leadId ? db.leads.find((l) => l.id === input.leadId && l.businessId === input.businessId) : undefined;
  const booking = input.bookingId
    ? db.bookings.find((b) => b.id === input.bookingId && b.businessId === input.businessId)
    : (lead?.bookingId ? db.bookings.find((b) => b.id === lead.bookingId && b.businessId === input.businessId) : undefined);
  const contact = input.customerId
    ? db.contacts.find((c) => c.id === input.customerId && c.businessId === input.businessId)
    : (lead
      ? db.contacts.find((c) => c.businessId === input.businessId
        && ((lead.customerId && c.customerId === lead.customerId) || (!!lead.phone && c.phone === lead.phone)))
      : (booking
        ? db.contacts.find((c) => c.businessId === input.businessId && !!booking.customerPhone && c.phone === booking.customerPhone)
        : undefined));
  const serviceId = booking?.serviceId || lead?.serviceId || '';
  const service = serviceId ? db.services.find((s) => s.id === serviceId && s.businessId === input.businessId) : undefined;

  const safeData: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input.data || {})) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) safeData[k] = clip(v, 200);
  }

  return {
    event: {
      id: `ev_${randomUUID()}`,
      name: input.event,
      at: input.at,
      businessId: input.businessId,
      ...safeData,
    },
    lead: leadSnapshot(lead),
    customer: customerSnapshot(contact),
    booking: bookingSnapshot(booking),
    service: service
      ? { id: clip(service.id, 64), name: clip(service.name, 80), durationMin: service.durationMin, price: service.price }
      : null,
    business: business ? { id: clip(business.id, 64), name: clip(business.name, 80), slug: clip(business.slug, 60) } : null,
  };
}

/**
 * Chave de dedupe do gatilho. O escopo efetivo é (unidade, automação, chave).
 *
 *  1. `eventKey` explícito do chamador (API externa/idempotency-key) vence — é a
 *     única forma de dedupar um reenvio que chega em OUTRO instante;
 *  2. `settings.dedupeField` (ex.: `lead.id`) ⇒ UMA execução por lead para essa
 *     automação+evento, independentemente do resto do conteúdo — é o “não
 *     repetir nunca” que o lojista espera de um follow-up;
 *  3. padrão: `evento:assunto:hash(fotografia+dados)` — deduplica a MESMA
 *     mutação reaplicada dentro da mesma transação/mesmo instante (duplo clique
 *     no botão, reenvio do mesmo request). Como a fotografia inclui
 *     `lastInteraction`, um evento legítimo posterior tem chave nova e dispara
 *     de novo; o reenvio tardio de um request só é bloqueado se o chamador
 *     trouxer `eventKey` (1) ou a automação usar `dedupeField` (2).
 *
 * Janela do dedupe: as chaves vivem nas execuções, e execuções terminais são
 * retidas por 30 dias (até 200 por unidade) — não há índice infinito.
 */
export function deriveEventKey(input: EmitInput, context: Record<string, unknown>, automation?: Automation): string {
  if (input.eventKey) return clip(input.eventKey, 160);
  const dedupeField = automation?.settings?.dedupeField;
  if (dedupeField) {
    const resolved = resolveFieldPath(context, dedupeField);
    if (hasValue(resolved.value)) return `${input.event}:field:${clip(String(resolved.value), 120)}`;
  }
  const subject = input.leadId || input.bookingId || input.customerId
    || String((context.event as Record<string, unknown> | undefined)?.id || randomUUID());
  return `${input.event}:${subject}:${fingerprintOf(context)}`;
}

/** Hash estável do conteúdo relevante (sem id/latencia do evento). */
function fingerprintOf(context: Record<string, unknown>): string {
  const stable = {
    lead: context.lead || null,
    customer: context.customer || null,
    booking: context.booking || null,
    ...(context.event ? { data: { ...(context.event as Record<string, unknown>) } } : {}),
  };
  // `event.id`/`event.at` mudam a cada emissão — não entram no hash.
  if (stable.data) { delete (stable.data as any).id; delete (stable.data as any).at; }
  let serialized = '';
  try { serialized = JSON.stringify(stable); } catch { serialized = ''; }
  return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
}

function isRunLive(run: AutomationRun): boolean {
  return run.status === 'queued' || run.status === 'running' || run.status === 'waiting';
}

/**
 * Quantas execuções já vieram desta cadeia (`emittedByRunId`, gravado pelo
 * próprio gatilho). Caminha no máximo `MAX_REENTRY_DEPTH + 1` saltos e para em
 * ciclo — a pergunta é “fundo ou não?”, não “qual é o fundo exato?”.
 */
export function reentryDepth(db: DB, fromRunId: string): number {
  let depth = 0;
  let cursor = fromRunId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor) && depth <= MAX_REENTRY_DEPTH) {
    seen.add(cursor);
    const parent = (db.automationRuns || []).find((r) => r.id === cursor);
    if (!parent || !parent.emittedByRunId) break;
    cursor = parent.emittedByRunId;
    depth += 1;
  }
  return depth;
}

/**
 * Dispara o evento: cria as execuções correspondentes no `db` recebido.
 * Puro sobre o documento — quem grava é o chamador (já está dentro de um
 * updateDB quando os serviços oficiais chamam).
 */
export function emitAutomationEvent(db: DB, input: EmitInput): EmitResult {
  const result: EmitResult = { created: [], skipped: [], matched: 0 };
  if (!isAutomationEvent(input.event) || !input.businessId) return result;
  if (!Array.isArray(db.automations) || db.automations.length === 0) return result;
  if (!Array.isArray(db.automationRuns)) db.automationRuns = [];

  const business = db.businesses.find((b) => b.id === input.businessId);
  if (!business) return result;
  // Camada única de capacidade (P4.13): sem automação básica, nada é criado.
  if (!hasCapability(business, 'automation.basic')) {
    for (const a of automationsForEvent(db, input.businessId, input.event)) {
      result.skipped.push({ automationId: a.id, reason: 'recurso de automações desligado para esta empresa' });
    }
    return result;
  }

  const now = input.at || new Date().toISOString();
  const matched = automationsForEvent(db, input.businessId, input.event);
  result.matched = matched.length;
  if (matched.length === 0) return result;

  const queuedNow = db.automationRuns.filter((r) => r.businessId === input.businessId && isRunLive(r)).length;
  if (queuedNow >= MAX_QUEUED_RUNS_PER_BUSINESS) {
    for (const a of matched) result.skipped.push({ automationId: a.id, reason: 'fila de execuções cheia' });
    return result;
  }

  for (const automation of matched) {
    if (result.created.length >= MAX_RUNS_PER_EVENT) {
      result.skipped.push({ automationId: automation.id, reason: 'muitas automações para um mesmo evento' });
      continue;
    }
    // Anti-loop: quem criou o evento foi uma automação ⇒ só reentra se pedir.
    if (input.fromRunId && automation.settings?.allowReentry !== true) {
      result.skipped.push({ automationId: automation.id, reason: 'evento gerado por automação (reentrada desativada)' });
      continue;
    }
    // Reentrada EXPLÍCITA continua tendo fundo: uma corrente A→A→A… é limitada
    // por profundidade de linhagem, não só pelo teto de fila da unidade.
    if (input.fromRunId && reentryDepth(db, input.fromRunId) >= MAX_REENTRY_DEPTH) {
      result.skipped.push({
        automationId: automation.id,
        reason: `cadeia de reentrada atingiu o limite de ${MAX_REENTRY_DEPTH} execuções`,
      });
      continue;
    }

    const context = buildEventContext(db, {
      businessId: input.businessId,
      event: input.event,
      at: now,
      data: { ...input.data, ...(input.leadId ? { leadId: input.leadId } : {}), ...(input.bookingId ? { bookingId: input.bookingId } : {}) },
      leadId: input.leadId,
      customerId: input.customerId,
      bookingId: input.bookingId,
    });
    const eventKey = deriveEventKey(input, context, automation);
    // O escopo do dedupe é (unidade, automação, chave). É o que permite que duas
    // automações do MESMO evento cada uma tenha a sua execução, sem que a
    // unidade B herde a chave gravada pela unidade A.
    const runKey = `${automation.id}:${eventKey}`;

    const duplicate = db.automationRuns.find((r) => r.businessId === input.businessId && r.automationId === automation.id && r.eventKey === eventKey);
    if (duplicate) {
      result.skipped.push({ automationId: automation.id, reason: `execução já existe para este evento (${duplicate.status})` });
      continue;
    }

    const triggerNode = automation.nodes.find((n) => n.type === 'trigger') || automation.nodes[0];
    const run: AutomationRun = {
      id: randomUUID(),
      businessId: input.businessId,
      automationId: automation.id,
      automationName: automation.name,
      status: 'queued',
      triggerEvent: automation.trigger?.event || input.event,
      currentNodeId: triggerNode?.id || '',
      context,
      waitingUntil: '',
      startedAt: now,
      updatedAt: now,
      finishedAt: '',
      error: '',
      history: [{
        at: now,
        nodeId: triggerNode?.id || '',
        nodeType: 'run',
        outcome: 'triggered',
        label: `Gatilho ${input.event}`,
        detail: runKey.slice(0, 120),
      }],
      eventKey,
      emittedByRunId: input.fromRunId || '',
      steps: 0,
      resumes: 0,
    };
    db.automationRuns.push(run);
    result.created.push(run);
  }

  return result;
}
