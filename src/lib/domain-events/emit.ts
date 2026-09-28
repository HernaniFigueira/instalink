// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — EVENT LOG: emissor + persistência
// ═══════════════════════════════════════════════════════════════
// `emitDomainEvent` valida e CONSTRÓI o evento (puro — testável isolado).
// `recordDomainEvent` persiste no store atual (JSONB/arquivo) com
// idempotência (businessId + idempotencyKey). O payload passa por `redact`
// (chaves sensíveis são cortadas) — prontuário/prompt clínico NUNCA entram.
//
// MIGRAÇÃO: esta coleção é ADITIVA (`domainEvents: []` com default em
// normalizeDB). Não migra, não apaga e não altera instalink_doc existente.
// O schema SQL normalizado (tabela `domain_event`) vive no documento de
// arquitetura como plano de corte F1+ — nada de big-bang aqui.
import { randomUUID } from 'node:crypto';
import type { DB } from '../types';
import { redactSensitive } from '../redact';
import type {
  DomainEvent, DomainEventPayload, EmitDomainEventInput,
} from './types';

/** Catálogo fechado — usado em validação e testes. */
export const DOMAIN_EVENT_TYPES = [
  'appointment.created', 'appointment.confirmed', 'appointment.cancelled',
  'appointment.completed', 'appointment.no_show',
  'patient.checked_in', 'queue.called',
  'encounter.started', 'encounter.finalized',
  'prescription.created', 'exam.ordered', 'exam.resulted', 'procedure.performed',
  'document.generated',
  'invoice.created', 'payment.received',
  'inventory.low', 'inventory.movement',
  'followup.due', 'followup.completed',
] as const;

export class DomainEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainEventError';
  }
}

/**
 * Chaves que JAMAIS podem entrar num evento de domínio (conteúdo clínico ou
 * texto livre de IA). Além do redact global (token/password), estas são
 * cortadas aqui — o EventLog registra FATOS, não prontuário nem prompt.
 */
const CLINICAL_DENY_KEYS = new Set([
  'prompt', 'transcript', 'transcription', 'notes', 'note', 'summary',
  'report', 'clinicaltext', 'documenttext', 'anamnese', 'attachment',
  'message', 'text', 'content',
]);

function sanitizePayload(payload: DomainEventPayload): DomainEventPayload {
  const out: DomainEventPayload = {};
  for (const [key, value] of Object.entries(payload)) {
    out[key] = CLINICAL_DENY_KEYS.has(key.toLowerCase()) ? '[REDACTED]' : value;
  }
  return redactSensitive(out) as DomainEventPayload;
}

/**
 * Constrói o evento validado (PURO). Lança DomainEventError em contrato
 * inválido — falhar cedo é melhor do que log poluído.
 */
export function emitDomainEvent(input: EmitDomainEventInput): DomainEvent {
  const businessId = String(input.businessId || '').trim();
  if (!businessId) throw new DomainEventError('businessId é obrigatório em todo evento de domínio.');
  if (!DOMAIN_EVENT_TYPES.includes(input.type)) {
    throw new DomainEventError(`Tipo de evento fora do catálogo: ${String(input.type)}`);
  }
  const entityId = String(input.entityId || '').trim();
  if (!entityId) throw new DomainEventError('entityId é obrigatório.');
  const actor = input.actor || { kind: 'system' };
  if (!['user', 'agent', 'system', 'patient'].includes(actor.kind)) {
    throw new DomainEventError(`actor.kind inválido: ${String(actor.kind)}`);
  }
  const now = input.now || new Date().toISOString();
  // Payload SEGURO: redact corta chaves sensíveis (token/password/…) e a
  // lista clínica (prompt/notes/…) — o EventLog nunca guarda prontuário.
  const safePayload: DomainEventPayload = sanitizePayload(input.payload || {});
  return {
    id: randomUUID(),
    businessId,
    type: input.type,
    entityType: input.entityType,
    entityId,
    actor: { kind: actor.kind, ...(actor.id ? { id: String(actor.id) } : {}), ...(actor.name ? { name: String(actor.name) } : {}) },
    origin: input.origin,
    occurredAt: input.occurredAt || now,
    recordedAt: now,
    payload: safePayload,
    ...(input.idempotencyKey ? { idempotencyKey: String(input.idempotencyKey) } : {}),
  };
}

/**
 * Persiste o evento. Idempotência: mesma (businessId + idempotencyKey)
 * devolve o PRIMEIRO evento gravado e não duplica. Retorna o evento
 * persistido (o original no caso de repetição).
 */
export function recordDomainEvent(db: DB, input: EmitDomainEventInput): DomainEvent {
  const event = emitDomainEvent(input);
  if (!Array.isArray(db.domainEvents)) db.domainEvents = [];
  if (event.idempotencyKey) {
    const existing = db.domainEvents.find(
      (e) => e.businessId === event.businessId && e.idempotencyKey === event.idempotencyKey,
    );
    if (existing) return existing;
  }
  db.domainEvents.push(event);
  return event;
}

/** Consulta por tenant (sempre com businessId — isolamento na leitura). */
export function listDomainEvents(db: DB, businessId: string, opts?: {
  type?: DomainEvent['type'];
  entityType?: DomainEvent['entityType'];
  entityId?: string;
  since?: string;
  limit?: number;
}): DomainEvent[] {
  const limit = Math.max(1, Math.min(500, opts?.limit || 100));
  return db.domainEvents
    .filter((e) => e.businessId === businessId)
    .filter((e) => (!opts?.type || e.type === opts.type))
    .filter((e) => (!opts?.entityType || e.entityType === opts.entityType))
    .filter((e) => (!opts?.entityId || e.entityId === opts.entityId))
    .filter((e) => (!opts?.since || e.occurredAt >= opts.since))
    .slice(-limit)
    .reverse();
}
