// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — PostgresDomainEventStore (produção)
// ═══════════════════════════════════════════════════════════════
// Persistência NORMALIZADA do EventLog: tabela
// `godoutor_internal.domain_event`.
//
//   • NUNCA escreve em instalink_doc;
//   • tenant isolation: toda query passa por business_id;
//   • idempotência: UNIQUE (business_id, idempotency_key) parcial —
//     repetir é NO-OP e devolve o primeiro evento;
//   • SEM DDL AQUI. A única autoridade estrutural é
//     db/migrations/0001_domain_event.sql; o runtime só SELECT/INSERT.
//     Migration ausente ⇒ falha EXPLÍCITA (erro 42P01 traduzido), nunca
//     boot silencioso com CREATE TABLE.
//   • Todo SQL é QUALIFICADO com `godoutor_internal.` — nada depende de
//     search_path (seguro em pool serverless/Vercel que reaproveita conexões).
import { emitDomainEvent } from './emit';
import type { DomainEvent, EmitDomainEventInput, DomainEventPayload } from './types';
import type { DomainEventQuery, DomainEventStore } from './store';
import { getPgPool } from '../pg';

/** Tabela SEMPRE qualificada — única forma de referenciá-la no runtime. */
export const DOMAIN_EVENT_TABLE = 'godoutor_internal.domain_event';

/**
 * Tradução honesta de "migration não aplicada": em vez de DDL de boot, o
 * erro do Postgres (42P01 undefined_table / 3F000 invalid_schema_name) vira
 * uma falha acionável que aponta o arquivo de DDL canônico.
 */
export function assertMigrationApplied(err: unknown): never {
  const code = (err as { code?: string } | null)?.code;
  if (code === '42P01' || code === '3F000') {
    throw new Error(
      `Migration ausente: ${DOMAIN_EVENT_TABLE} não existe. ` +
      'Aplique db/migrations/0001_domain_event.sql (a única autoridade de DDL — o runtime não cria tabelas).',
    );
  }
  throw err;
}

/** Query controlada do pool (nome explícito: não colide com o filtro `query` das listagens): falha de estrutura vira diagnóstico claro. */
async function runQuery(sql: string, params?: unknown[]): Promise<unknown[]> {
  try {
    const res = await getPgPool().query(sql, params);
    return res.rows as unknown[];
  } catch (err) {
    assertMigrationApplied(err);
  }
}

interface Row {
  id: string;
  business_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  actor_kind: string;
  actor_id: string | null;
  actor_name: string | null;
  origin: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
  payload: DomainEventPayload | string;
  idempotency_key: string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowToEvent(row: Row): DomainEvent {
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
  return {
    id: row.id,
    businessId: row.business_id,
    type: row.type as DomainEvent['type'],
    entityType: row.entity_type as DomainEvent['entityType'],
    entityId: row.entity_id,
    actor: {
      kind: row.actor_kind as DomainEvent['actor']['kind'],
      ...(row.actor_id ? { id: row.actor_id } : {}),
      ...(row.actor_name ? { name: row.actor_name } : {}),
    },
    origin: row.origin as DomainEvent['origin'],
    occurredAt: iso(row.occurred_at),
    recordedAt: iso(row.recorded_at),
    payload,
    ...(row.idempotency_key ? { idempotencyKey: row.idempotency_key } : {}),
  };
}

export class PostgresDomainEventStore implements DomainEventStore {
  async record(input: EmitDomainEventInput): Promise<DomainEvent> {
    const event = emitDomainEvent(input); // validação + redigação obrigatórias
    const pool = getPgPool();
    if (event.idempotencyKey) {
      // Caminho feliz da idempotência: já existe? devolve o PRIMEIRO.
      const existing = (await runQuery(
        `SELECT * FROM ${DOMAIN_EVENT_TABLE} WHERE business_id = $1 AND idempotency_key = $2`,
        [event.businessId, event.idempotencyKey],
      )) as Row[];
      if (existing.length > 0) return rowToEvent(existing[0] as Row);
    }
    const inserted = (await runQuery(
      `INSERT INTO ${DOMAIN_EVENT_TABLE} (
         id, business_id, type, entity_type, entity_id,
         actor_kind, actor_id, actor_name, origin,
         occurred_at, recorded_at, payload, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (business_id, idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING *`,
      [
        event.id, event.businessId, event.type, event.entityType, event.entityId,
        event.actor.kind, event.actor.id ?? null, event.actor.name ?? null, event.origin,
        event.occurredAt, event.recordedAt, JSON.stringify(event.payload),
        event.idempotencyKey ?? null,
      ],
    )) as Row[];
    if (inserted.length > 0) return rowToEvent(inserted[0] as Row);
    // Corrida: outra instância gravou a mesma key — devolve o registro dela.
    const raced = (await runQuery(
      `SELECT * FROM ${DOMAIN_EVENT_TABLE} WHERE business_id = $1 AND idempotency_key = $2`,
      [event.businessId, event.idempotencyKey],
    )) as Row[];
    if (raced.length > 0) return rowToEvent(raced[0] as Row);
    throw new Error('Falha idempotente ao gravar domain_event.');
  }

  async list(businessId: string, query: DomainEventQuery = {}): Promise<DomainEvent[]> {
    if (!businessId) throw new Error('businessId é obrigatório para listar eventos.');
    const limit = Math.max(1, Math.min(500, query.limit || 100));
    const where: string[] = ['business_id = $1'];
    const params: unknown[] = [businessId];
    if (query.type) { params.push(query.type); where.push(`type = $${params.length}`); }
    if (query.entityType) { params.push(query.entityType); where.push(`entity_type = $${params.length}`); }
    if (query.entityId) { params.push(query.entityId); where.push(`entity_id = $${params.length}`); }
    if (query.since) { params.push(query.since); where.push(`occurred_at >= $${params.length}`); }
    params.push(limit);
    const res = (await runQuery(
      `SELECT * FROM ${DOMAIN_EVENT_TABLE} WHERE ${where.join(' AND ')}
       ORDER BY occurred_at DESC, recorded_at DESC
       LIMIT $${params.length}`,
      params,
    )) as Row[];
    return res.map(rowToEvent);
  }
}
