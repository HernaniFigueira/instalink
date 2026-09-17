// ═══════════════════════════════════════════════════════════════
// P6 — LOG DE ENTREGAS EXTERNAS (append-only, por unidade)
// ═══════════════════════════════════════════════════════════════
// Cada requisição externa gera UMA linha (`IntegrationEvent`): o que chegou,
// o que foi feito, o que foi recusado e por quê. É a única fonte de verdade do
// monitoramento de integrações — o painel lê daqui.
//
// O log NUNCA guarda token, segredo, assinatura ou corpo integral: só o
// payload resumido e sanitizado (ver contract.ts) e o motivo em português.
import { randomUUID } from 'node:crypto';
import type { DB, ExternalEventName, IntegrationEvent, IntegrationEventStatus, IntegrationProviderId } from '../types';
import { stripSensitivePayloadKeys } from './contract';

/** Teto de linhas por unidade (as mais recentes ficam). */
export const MAX_INTEGRATION_EVENTS_PER_BUSINESS = 500;
/** Retenção das linhas terminais (90 dias) e das duplicatas (7 dias). */
export const INTEGRATION_EVENT_RETENTION_MS = 90 * 86400000;
export const INTEGRATION_DUPLICATE_RETENTION_MS = 7 * 86400000;

export interface RecordIntegrationEventInput {
  businessId: string;
  integrationId: string;
  provider?: IntegrationProviderId | '';
  direction: 'in' | 'out';
  event?: ExternalEventName | '';
  status: IntegrationEventStatus;
  externalEventId?: string;
  idempotencyKey?: string;
  httpStatus?: number;
  reason?: string;
  leadId?: string;
  contactId?: string;
  automationRunIds?: string[];
  payloadSummary?: Record<string, any>;
  now?: string;
}

export function recordIntegrationEvent(db: DB, input: RecordIntegrationEventInput): IntegrationEvent {
  if (!Array.isArray(db.integrationEvents)) db.integrationEvents = [];
  const now = input.now || new Date().toISOString();
  const entry: IntegrationEvent = {
    id: randomUUID(),
    businessId: input.businessId,
    integrationId: input.integrationId,
    provider: input.provider || '',
    direction: input.direction,
    event: input.event || '',
    status: input.status,
    externalEventId: (input.externalEventId || '').slice(0, 160),
    idempotencyKey: (input.idempotencyKey || '').slice(0, 220),
    httpStatus: Number.isFinite(input.httpStatus) ? Number(input.httpStatus) : 0,
    reason: (input.reason || '').slice(0, 200),
    leadId: input.leadId || '',
    contactId: input.contactId || '',
    automationRunIds: (input.automationRunIds || []).slice(0, 25),
    // Chave que parece credencial nunca entra no log (defesa em profundidade).
    payloadSummary: stripSensitivePayloadKeys(input.payloadSummary || {}),
    at: now,
  };
  db.integrationEvents.push(entry);
  return entry;
}

/** Linhas da unidade (mais recentes primeiro), opcionalmente de uma conexão. */
export function integrationEventsOf(
  db: DB,
  businessId: string,
  options: { integrationId?: string; limit?: number; status?: IntegrationEventStatus } = {},
): IntegrationEvent[] {
  if (!Array.isArray(db.integrationEvents)) return [];
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  return db.integrationEvents
    .filter((e) => e.businessId === businessId
      && (!options.integrationId || e.integrationId === options.integrationId)
      && (!options.status || e.status === options.status))
    .slice(-limit)
    .reverse();
}

/** Contadores do painel — sem payload, sem identificadores de terceiros. */
export function summarizeIntegrationEvents(db: DB, businessId: string): {
  total: number; processed: number; duplicate: number; rejected: number; failed: number; lastEventAt: string;
} {
  const rows = (Array.isArray(db.integrationEvents) ? db.integrationEvents : [])
    .filter((e) => e.businessId === businessId);
  return {
    total: rows.length,
    processed: rows.filter((e) => e.status === 'processed').length,
    duplicate: rows.filter((e) => e.status === 'duplicate').length,
    rejected: rows.filter((e) => e.status === 'rejected').length,
    failed: rows.filter((e) => e.status === 'failed').length,
    lastEventAt: rows.length > 0 ? rows[rows.length - 1].at : '',
  };
}

/** Já existe entrega PROCESSADA com esta chave de idempotência? */
export function findProcessedByKey(db: DB, integrationId: string, idempotencyKey: string): IntegrationEvent | undefined {
  if (!idempotencyKey) return undefined;
  return (Array.isArray(db.integrationEvents) ? db.integrationEvents : []).find(
    (e) => e.integrationId === integrationId && e.idempotencyKey === idempotencyKey && e.status === 'processed',
  );
}
