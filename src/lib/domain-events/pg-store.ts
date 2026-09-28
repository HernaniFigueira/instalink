// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — PostgresDomainEventStore (produção)
// ═══════════════════════════════════════════════════════════════
// Persistência NORMALIZADA do EventLog: tabela `domain_event`
// (fonte de verdade do DDL: db/migrations/0001_domain_event.sql).
//
//   • NUNCA escreve em instalink_doc;
//   • tenant isolation: toda query passa por business_id;
//   • idempotência: UNIQUE (business_id, idempotency_key) parcial —
//     repetir é NO-OP e devolve o primeiro evento;
//   • DDL idempotente uma única vez por processo (padrão do projeto).
import { emitDomainEvent } from './emit';
import type { DomainEvent, EmitDomainEventInput, DomainEventPayload } from './types';
import type { DomainEventQuery, DomainEventStore } from './store';
import { getPgPool } from '../pg';

/** Mesmo DDL de db/migrations/0001_domain_event.sql (idempotente). */
const DDL = `
CREATE TABLE IF NOT EXISTS domain_event (
  id               TEXT        PRIMARY KEY,
  business_id      TEXT        NOT NULL,
  organization_id  TEXT        NULL,
  type             TEXT        NOT NULL,
  entity_type      TEXT        NOT NULL,
  entity_id        TEXT        NOT NULL,
  actor_kind       TEXT        NOT NULL,
  actor_id         TEXT        NULL,
  actor_name       TEXT        NULL,
  origin           TEXT        NOT NULL,
  occurred_at      TIMESTAMPTZ NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL,
  payload          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key  TEXT        NULL
);
CREATE INDEX IF NOT EXISTS domain_event_business_occurred_idx
  ON domain_event (business_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS domain_event_business_type_occurred_idx
  ON domain_event (business_id, type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS domain_event_business_entity_occurred_idx
  ON domain_event (business_id, entity_type, entity_id, occurred_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS domain_event_business_idem_uq
  ON domain_event (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
`;

// Garantia da tabela uma vez por processo (mesmo padrão de db.ts/pgInit).
let ready: Promise<void> | null = null;

export function __resetDomainEventInitForTests(): void {
  ready = null;
}

async function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = getPgPool().query(DDL).then(() => undefined).catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
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
    await ensureSchema();
    const pool = getPgPool();
    if (event.idempotencyKey) {
      // Caminho feliz da idempotência: já existe? devolve o PRIMEIRO.
      const existing = await pool.query(
        'SELECT * FROM domain_event WHERE business_id = $1 AND idempotency_key = $2',
        [event.businessId, event.idempotencyKey],
      );
      if (existing.rows.length > 0) return rowToEvent(existing.rows[0] as Row);
    }
    const inserted = await pool.query(
      `INSERT INTO domain_event (
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
    );
    if (inserted.rows.length > 0) return rowToEvent(inserted.rows[0] as Row);
    // Corrida: outra instância gravou a mesma key — devolve o registro dela.
    const raced = await pool.query(
      'SELECT * FROM domain_event WHERE business_id = $1 AND idempotency_key = $2',
      [event.businessId, event.idempotencyKey],
    );
    if (raced.rows.length > 0) return rowToEvent(raced.rows[0] as Row);
    throw new Error('Falha idempotente ao gravar domain_event.');
  }

  async list(businessId: string, query: DomainEventQuery = {}): Promise<DomainEvent[]> {
    if (!businessId) throw new Error('businessId é obrigatório para listar eventos.');
    await ensureSchema();
    const limit = Math.max(1, Math.min(500, query.limit || 100));
    const where: string[] = ['business_id = $1'];
    const params: unknown[] = [businessId];
    if (query.type) { params.push(query.type); where.push(`type = $${params.length}`); }
    if (query.entityType) { params.push(query.entityType); where.push(`entity_type = $${params.length}`); }
    if (query.entityId) { params.push(query.entityId); where.push(`entity_id = $${params.length}`); }
    if (query.since) { params.push(query.since); where.push(`occurred_at >= $${params.length}`); }
    params.push(limit);
    const res = await getPgPool().query(
      `SELECT * FROM domain_event WHERE ${where.join(' AND ')}
       ORDER BY occurred_at DESC, recorded_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return (res.rows as Row[]).map(rowToEvent);
  }
}
