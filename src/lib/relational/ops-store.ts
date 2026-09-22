// ═══════════════════════════════════════════════════════════════
// FILA (A3.4 B4) e REGISTRO DE ATENDIMENTO (A3.4 B5) no modo relacional.
// ═══════════════════════════════════════════════════════════════
// Mesma disciplina do slice: transação ÚNICA por unidade com advisory lock,
// carregamento DIRECIONADO (só as linhas da operação) e write-back por diff
// — as REGRAS continuam nas funções puras do produto (queueTransitionAllowed,
// resolveQueueAssignment, versionConflict, canFinalize, upsertContact,
// encounterInScope…), reutilizadas pelas rotas nos DOIS motores.
// O banco garante os 1:1 (encounters_booking_uniq / encounters_queue_uniq).
import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { getPool } from './pool';
import type { DB } from '../types';

const s = (v: unknown): string => String(v ?? '');
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));
const dateOf = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const ts = (v: unknown): Date | null => (v ? new Date(String(v)) : null);
const j = <T>(v: unknown, d: T): T => {
  if (v == null) return d;
  if (typeof v === 'object') return v as T;
  try { return JSON.parse(String(v)) as T; } catch { return d; }
};

// ── Linha → domínio (espelho do import/transform.ts) ──
export function rowToQueueEntry(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id),
    customerName: s(r.customer_name), customerPhone: s(r.customer_phone),
    contactId: s(r.contact_id), serviceId: s(r.service_id), professionalId: s(r.professional_id),
    bookingId: s(r.booking_id), note: s(r.note), status: s(r.status) || 'waiting',
    date: dateOf(r.date), createdAt: iso(r.created_at),
    calledAt: r.called_at ? iso(r.called_at) : '',
    startedAt: r.started_at ? iso(r.started_at) : '',
    endedAt: r.ended_at ? iso(r.ended_at) : '',
    updatedBy: s(r.updated_by), updatedAt: iso(r.updated_at),
  } as any;
}
export function rowToEncounter(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id),
    bookingId: s(r.booking_id), queueId: s(r.queue_id),
    serviceId: s(r.service_id), professionalId: s(r.professional_id),
    customerId: s(r.customer_id), contactId: s(r.contact_id),
    customerName: s(r.customer_name),
    date: dateOf(r.date), time: s(r.time).slice(0, 5),
    complaint: s(r.complaint), evolution: s(r.evolution), guidance: s(r.guidance),
    followUp: s(r.follow_up), internalNote: s(r.internal_note),
    tags: j<string[]>(r.tags, []), status: s(r.status) || 'draft',
    version: Number.isFinite(Number(r.version)) && Number(r.version) > 0 ? Number(r.version) : 1,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    createdBy: s(r.created_by), updatedBy: s(r.updated_by),
    finalizedAt: r.finalized_at ? iso(r.finalized_at) : '',
    finalizedBy: s(r.finalized_by), signedBy: s(r.signed_by),
  } as any;
}

// ── Domínio → linha (upsert do write-back) ──
function queueRow(q: any): Record<string, unknown> {
  return {
    id: q.id, business_id: q.businessId, customer_name: q.customerName ?? '',
    customer_phone: q.customerPhone ?? '', contact_id: q.contactId ?? '',
    service_id: q.serviceId ?? '', professional_id: q.professionalId ?? '',
    booking_id: q.bookingId ?? '', note: q.note ?? '', status: q.status || 'waiting',
    date: q.date, created_at: new Date(q.createdAt || new Date().toISOString()),
    called_at: ts(q.calledAt), started_at: ts(q.startedAt), ended_at: ts(q.endedAt),
    updated_by: q.updatedBy ?? '', updated_at: new Date(q.updatedAt || q.createdAt || new Date().toISOString()),
  };
}
function encounterRow(e: any): Record<string, unknown> {
  return {
    id: e.id, business_id: e.businessId, booking_id: e.bookingId ?? '', queue_id: e.queueId ?? '',
    service_id: e.serviceId ?? '', professional_id: e.professionalId ?? '',
    customer_id: e.customerId || null, contact_id: e.contactId ?? '',
    customer_name: e.customerName ?? '', date: e.date, time: e.time ?? '',
    complaint: e.complaint ?? '', evolution: e.evolution ?? '', guidance: e.guidance ?? '',
    follow_up: e.followUp ?? '', internal_note: e.internalNote ?? '',
    tags: JSON.stringify(e.tags ?? []), status: e.status || 'draft', version: e.version ?? 1,
    created_at: new Date(e.createdAt || new Date().toISOString()),
    updated_at: new Date(e.updatedAt || e.createdAt || new Date().toISOString()),
    created_by: e.createdBy ?? '', updated_by: e.updatedBy ?? '',
    finalized_at: ts(e.finalizedAt), finalized_by: e.finalizedBy ?? '', signed_by: e.signedBy ?? '',
  };
}
function contactRow(c: any): Record<string, unknown> {
  return {
    id: c.id, business_id: c.businessId, customer_id: c.customerId || null,
    name: c.name ?? '', phone: c.phone ?? '', email: c.email ?? '',
    created_at: new Date(c.createdAt || new Date().toISOString()),
    updated_at: new Date(c.updatedAt || c.createdAt || new Date().toISOString()),
    source: c.source || 'interaction', last_interaction: ts(c.lastInteraction),
    marketing_opt_in: c.marketingOptIn === true, note: c.note ?? '',
    notes: JSON.stringify(c.notes ?? null),
    profile: JSON.stringify(c.profile ?? null),
    channel_identities: JSON.stringify(c.channelIdentities ?? null),
  };
}

/** Linha → contato (mesma forma do slice — contato do CRM da unidade). */
export function rowToContactFull(r: any) {
  return {
    id: s(r.id), businessId: s(r.business_id), customerId: s(r.customer_id),
    name: s(r.name), phone: s(r.phone), email: s(r.email),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
    source: s(r.source) || 'interaction', ...(r.last_interaction ? { lastInteraction: iso(r.last_interaction) } : {}),
    marketingOptIn: r.marketing_opt_in === true, note: s(r.note),
    ...(r.notes ? { notes: j(r.notes, []) } : {}), ...(r.profile ? { profile: j(r.profile, {}) } : {}),
    ...(r.channel_identities ? { channelIdentities: j(r.channel_identities, {}) } : {}),
  } as any;
}

export interface OpsLoad {
  queue?: { where?: string; args?: unknown[]; order?: string; limit?: number };
  encounters?: { where?: string; args?: unknown[]; order?: string; limit?: number };
  contacts?: { where?: string; args?: unknown[]; order?: string; limit?: number };
  bookings?: { where?: string; args?: unknown[]; limit?: number };
  services?: boolean;
  professionals?: boolean;
}

export interface OpsWriteResult<T> { result: T }

const stable = (v: any): any => {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = stable((v as any)[k]);
    return out;
  }
  return v;
};

async function loadOps(client: PoolClient, businessId: string, load: OpsLoad): Promise<DB> {
  const db = { queue: [], encounters: [], contacts: [], bookings: [], services: [], professionals: [], audit: [] } as any as DB;
  const one = async (table: string, spec?: { where?: string; args?: unknown[]; order?: string; limit?: number }) => {
    const conds = ['business_id = $1'];
    const args: unknown[] = [businessId];
    if (spec?.where) {
      conds.push(`(${spec.where})`);
      for (const a of spec.args || []) args.push(a);
    }
    let sql = `SELECT * FROM ${table} WHERE ${conds.join(' AND ')}`;
    if (spec?.order) sql += ` ORDER BY ${spec.order}`;
    if (spec?.limit) sql += ` LIMIT ${Math.floor(spec.limit)}`;
    return (await client.query(sql, args)).rows;
  };
  if (load.queue) db.queue = (await one('app.queue_entries', load.queue)).map(rowToQueueEntry) as any;
  if (load.encounters) db.encounters = (await one('app.encounters', load.encounters)).map(rowToEncounter) as any;
  if (load.contacts) db.contacts = (await one('app.contacts', load.contacts)).map(rowToContactFull) as any;
  if (load.bookings) db.bookings = (await one('app.bookings', load.bookings)) as any;
  if (load.services) db.services = (await one('app.services', {})) as any;
  if (load.professionals) db.professionals = (await one('app.professionals', {})) as any;
  return db;
}

async function upsert(client: PoolClient, table: string, row: Record<string, unknown>): Promise<void> {
  // Identificadores entre aspas (start/"end" são reservados no Postgres).
  const cols = Object.keys(row).map((c) => `"${c}"`);
  const values = Object.values(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
  const rawCols = Object.keys(row);
  const updates = rawCols.slice(1).map((c, i) => `"${c}" = $${i + 2}`).join(', ');
  await client.query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})
     ON CONFLICT (id) DO UPDATE SET ${updates}`,
    values,
  );
}

/**
 * Transação de fila/atendimento/contato: advisory lock da unidade + negócio
 * FOR UPDATE + carregamento direcionado + fn síncrona (mesmas regras puras) +
 * diff de write-back (queue/encounters/contacts) + COMMIT. 23505 nos índices
 * únicos de 1:1 vira 409 com a MESMA frase do motor do documento.
 */
export async function runOpsWrite<T>(
  businessId: string,
  load: OpsLoad,
  fn: (db: DB) => T,
): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`godoutor:unit:${businessId}`]);
    const biz = await client.query('SELECT id FROM app.businesses WHERE id = $1 FOR UPDATE', [businessId]);
    if (biz.rows.length === 0) {
      throw Object.assign(new Error('Negócio não encontrado.'), { status: 404 });
    }
    const before = await loadOps(client, businessId, load);
    const after = structuredClone(before);
    const result = fn(after);
    // Auditoria é append-only: entradas criadas por `fn` (pushAudit — a MESMA
    // função do motor do documento) viram INSERT; nada é apagado.
    for (const a of (after as any).audit || []) {
      await (client as PoolClient).query(
        `INSERT INTO app.audit (id, at, action, actor_user_id, actor_email, actor_role, business_id, support_session_id, meta)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [
          a.id || randomUUID(), a.at ? new Date(a.at) : new Date(), a.action,
          a.actorUserId || '', a.actorEmail || '', a.actorRole || '',
          a.businessId || '', a.supportSessionId || '', JSON.stringify(a.meta ?? {}),
        ],
      );
    }
    // Write-back por diff — só o que mudou (upsert) ou sumiu (delete).
    for (const [coll, table, rowOf] of [
      ['queue', 'app.queue_entries', queueRow],
      ['encounters', 'app.encounters', encounterRow],
      ['contacts', 'app.contacts', contactRow],
    ] as const) {
      const beforeRows = (before as any)[coll] || [];
      const afterRows = (after as any)[coll] || [];
      const beforeById = new Map<string, any>(beforeRows.map((x: any) => [x.id, x]));
      const afterById = new Map<string, any>(afterRows.map((x: any) => [x.id, x]));
      for (const [id, obj] of afterById) {
        const prev = beforeById.get(id);
        if (prev && JSON.stringify(stable(prev)) === JSON.stringify(stable(obj))) continue;
        await upsert(client, table, rowOf(obj));
      }
      for (const id of beforeById.keys()) {
        if (!afterById.has(id)) await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
      }
    }
    await client.query('COMMIT');
    return result;
  } catch (e: any) {
    try { await client.query('ROLLBACK'); } catch { /* conexão já quebrou */ }
    // 1:1 do atendimento garantido no banco (mesma frase da revalidação).
    if (e?.code === '23505' && String(e?.detail || e?.constraint || '').includes('booking')) {
      throw Object.assign(new Error('Este agendamento já tem registro de atendimento.'), { status: 409 });
    }
    if (e?.code === '23505' && String(e?.detail || e?.constraint || '').includes('queue')) {
      throw Object.assign(new Error('Esta entrada da fila já tem registro de atendimento.'), { status: 409 });
    }
    throw e;
  } finally {
    client.release();
  }
}

/** Leitura da fila (GET): entradas vivas + encerradas do dia + catálogo enxuto. */
export async function loadQueueDoc(businessId: string, date: string): Promise<DB> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    return await loadOps(client, businessId, {
      queue: {
        where: `(date = $2 OR status IN ('waiting', 'called', 'in_service'))`,
        args: [date],
        order: 'created_at ASC',
        limit: 500,
      },
      services: true,
      professionals: true,
    });
  } finally {
    client.release();
  }
}


