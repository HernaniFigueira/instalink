// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — STORES NORMALIZADOS (Postgres + memória)
//
// Prova que EventLog e AI Usage persistem FORA de instalink_doc e SEM DDL:
//   • o runtime NÃO executa CREATE TABLE/INDEX nem ALTER TABLE — a ÚNICA
//     autoridade estrutural é db/migrations/ (0001/0002);
//   • INSERT parametrizado em `godoutor_internal.domain_event` /
//     `godoutor_internal.ai_usage` — SQL sempre QUALIFICADO, nunca
//     `instalink_doc`, nunca dependente de search_path;
//   • idempotência via UNIQUE (business_id, idempotency_key) — ON CONFLICT;
//   • tenant isolation em TODA query (business_id = $1);
//   • migration ausente ⇒ falha EXPLÍCITA apontando o arquivo de DDL;
//   • adapter de memória com o MESMO contrato (dev/testes sem rede).
// Tudo com Pool falso (vi.doMock('pg')) — zero banco, zero rede, zero
// escrita em produção.
// ═══════════════════════════════════════════════════════════════
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiUsageRecord } from '../ai/usage';
import type { DomainEvent } from '../domain-events/types';

const DDL_RE = /\b(CREATE\s+(TABLE|INDEX|UNIQUE|SCHEMA)|ALTER\s+TABLE|DROP\s+TABLE)\b/i;

/** Pool falso: registra SQL e responde como o real responderia. */
function fakePool(opts: { missingMigration?: boolean } = {}) {
  const sql: string[] = [];
  const domainRows: any[] = [];
  const aiRows: any[] = [];
  const pool = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      sql.push(text.replace(/\s+/g, ' ').trim());
      // Banco real SEM migração aplicada: undefined_table (42P01).
      if (opts.missingMigration) {
        throw Object.assign(new Error(`relation "godoutor_internal.domain_event" does not exist`), { code: '42P01' });
      }
      if (DDL_RE.test(text)) {
        throw new Error('STORE EXECUTOU DDL — migration é a única autoridade estrutural');
      }
      if (text.includes('FROM godoutor_internal.domain_event')) {
        if (text.includes('COUNT')) return { rows: [{ calls: 0 }] };
        const [biz, key] = params || [];
        const found = domainRows.filter((r) => r.business_id === biz && (!key || r.idempotency_key === key));
        return { rows: text.includes('idempotency_key = $2') ? found.slice(0, 1) : found };
      }
      if (text.includes('INSERT INTO godoutor_internal.domain_event')) {
        const p = params!;
        const row = {
          id: p[0], business_id: p[1], type: p[2], entity_type: p[3], entity_id: p[4],
          actor_kind: p[5], actor_id: p[6], actor_name: p[7], origin: p[8],
          occurred_at: p[9], recorded_at: p[10], payload: p[11], idempotency_key: p[12],
        };
        const clash = domainRows.find((r) => r.business_id === row.business_id && row.idempotency_key && r.idempotency_key === row.idempotency_key);
        if (clash) return { rows: [] };
        domainRows.push(row);
        return { rows: [row] };
      }
      if (text.includes('FROM godoutor_internal.ai_usage')) {
        if (text.includes('COUNT(*)')) return { rows: [{ calls: 0, input_tokens: 0, output_tokens: 0, estimated_cost: '0.00000000' }] };
        return { rows: aiRows };
      }
      if (text.includes('INSERT INTO godoutor_internal.ai_usage')) {
        const p = params!;
        aiRows.push({
          id: p[0], business_id: p[1], agent_id: p[2], feature: p[3], provider: p[4], model: p[5],
          input_tokens: p[6], output_tokens: p[7], audio_seconds: p[8], estimated_cost: p[9],
          latency_ms: p[10], decision_type: p[11], confidence: p[12], created_at: p[13],
        });
        return { rows: [] };
      }
      return { rows: [] };
    }),
  };
  return { pool, sql, domainRows, aiRows };
}

afterEach(() => { vi.resetModules(); vi.doUnmock('pg'); });

async function loadStores(fake: ReturnType<typeof fakePool>) {
  vi.doMock('pg', () => ({ Pool: function Pool() { return fake.pool; } as unknown as typeof import('pg').Pool }));
  process.env.DATABASE_URL = 'postgres://teste.invalida/db';
  const pgMod = await import('../pg');
  pgMod.__setPgPoolForTests(fake.pool as never);
  const { PostgresDomainEventStore } = await import('../domain-events/pg-store');
  const { PostgresAiUsageStore } = await import('../ai/usage-pg-store');
  return { eventStore: new PostgresDomainEventStore(), aiStore: new PostgresAiUsageStore() };
}

describe('F0 · PostgresDomainEventStore (tabela normalizada godoutor_internal.domain_event)', () => {
  it('grava em godoutor_internal.domain_event — NUNCA em instalink_doc, SEM NENHUM DDL', async () => {
    const fake = fakePool();
    const { eventStore } = await loadStores(fake);
    await eventStore.record({
      businessId: 'biz-1', type: 'encounter.started', entityType: 'encounter', entityId: 'e1',
      actor: { kind: 'user', id: 'u1' }, origin: 'ui', idempotencyKey: 'ek-1',
    });
    expect(fake.sql.some((s) => s.includes('INSERT INTO godoutor_internal.domain_event'))).toBe(true);
    // única autoridade estrutural: nada de CREATE/ALTER no runtime
    expect(fake.sql.some((s) => DDL_RE.test(s))).toBe(false);
    expect(fake.sql.some((s) => s.includes('instalink_doc'))).toBe(false);
    // SQL 100% qualificado — nada depende de search_path
    expect(fake.sql.every((s) => !/\b(FROM|INTO)\s+domain_event\b/i.test(s))).toBe(true);
  });

  it('idempotência: ON CONFLICT por (business_id, idempotency_key) — repetir é NO-OP', async () => {
    const fake = fakePool();
    const { eventStore } = await loadStores(fake);
    const first = await eventStore.record({
      businessId: 'biz-1', type: 'payment.received', entityType: 'payment', entityId: 'p1',
      actor: { kind: 'system' }, origin: 'api', idempotencyKey: 'pay:1',
    });
    const again = await eventStore.record({
      businessId: 'biz-1', type: 'payment.received', entityType: 'payment', entityId: 'p1',
      actor: { kind: 'system' }, origin: 'api', idempotencyKey: 'pay:1',
    });
    expect(again.id).toBe(first.id);
    expect(fake.domainRows).toHaveLength(1);
    expect(fake.sql.some((s) => s.includes('ON CONFLICT'))).toBe(true);
    expect(fake.sql.some((s) => s.includes('WHERE idempotency_key IS NOT NULL'))).toBe(true);
  });

  it('tenant isolation: toda query lista com business_id', async () => {
    const fake = fakePool();
    const { eventStore } = await loadStores(fake);
    await eventStore.record({
      businessId: 'biz-A', type: 'exam.ordered', entityType: 'clinical_order', entityId: 'o1',
      actor: { kind: 'user' }, origin: 'ui',
    });
    await eventStore.list('biz-A', { type: 'exam.ordered' });
    const listSql = fake.sql.filter((s) => s.includes('SELECT') && s.includes('FROM godoutor_internal.domain_event') && s.includes('ORDER BY'));
    expect(listSql.length).toBeGreaterThan(0);
    // a query de listagem sempre começa filtrando o tenant
    expect(fake.sql.some((s) => s.includes('WHERE business_id = $1'))).toBe(true);
  });

  it('migration ausente ⇒ falha EXPLÍCITA apontando 0001 (sem DDL de boot)', async () => {
    const fake = fakePool({ missingMigration: true });
    const { eventStore } = await loadStores(fake);
    await expect(
      eventStore.record({
        businessId: 'biz-1', type: 'queue.called', entityType: 'queue_entry', entityId: 'q1',
        actor: { kind: 'system' }, origin: 'api',
      }),
    ).rejects.toThrow(/migration.*0001_domain_event\.sql/i);
    expect(fake.sql.some((s) => DDL_RE.test(s))).toBe(false);
  });
});

describe('F0 · PostgresAiUsageStore (tabela normalizada godoutor_internal.ai_usage)', () => {
  it('grava em godoutor_internal.ai_usage — NUNCA em instalink_doc, sem prompt, sem DDL', async () => {
    const fake = fakePool();
    const { aiStore } = await loadStores(fake);
    await aiStore.record({
      businessId: 'biz-1', agentId: 'jev', feature: 'triage', provider: 'mock', model: 'mock-generative-v1',
      inputTokens: 10, outputTokens: 5, latencyMs: 3, decisionType: 'choice', confidence: 0.9,
    });
    expect(fake.sql.some((s) => s.includes('INSERT INTO godoutor_internal.ai_usage'))).toBe(true);
    expect(fake.sql.some((s) => DDL_RE.test(s))).toBe(false);
    expect(fake.sql.some((s) => s.includes('instalink_doc'))).toBe(false);
    expect(fake.sql.every((s) => !/\b(FROM|INTO)\s+ai_usage\b/i.test(s))).toBe(true);
    expect(JSON.stringify(fake.aiRows)).not.toMatch(/prompt|transcript|notes/i);
  });

  it('tenant isolation em list/totals (business_id sempre)', async () => {
    const fake = fakePool();
    const { aiStore } = await loadStores(fake);
    await aiStore.list('biz-A', { agentId: 'jev' });
    await aiStore.totals('biz-A');
    expect(fake.sql.some((s) => s.includes('FROM godoutor_internal.ai_usage WHERE business_id = $1'))).toBe(true);
    expect(fake.sql.some((s) => s.includes('COUNT(*)'))).toBe(true);
    // nenhuma query sem escopo de tenant
    expect(fake.sql.filter((s) => s.includes('FROM godoutor_internal.ai_usage') && !s.includes('business_id')).length).toBe(0);
  });

  it('NUMERIC(18,8): custo decimal chega como string e é lido com precisão', async () => {
    const fake = fakePool();
    const { aiStore } = await loadStores(fake);
    // o driver pg devolve NUMERIC como STRING decimal — o store normaliza
    fake.aiRows.length = 0;
    fake.aiRows.push({
      id: 'u-1', business_id: 'biz-1', agent_id: 'jev', feature: 'f', provider: 'mock',
      model: 'mock-generative-v1', input_tokens: 10, output_tokens: 5, audio_seconds: null,
      estimated_cost: '0.00000250', latency_ms: 3, decision_type: null, confidence: null,
      created_at: new Date('2026-09-28T00:00:00.000Z'),
    });
    const [row] = await aiStore.list('biz-1');
    expect(row.estimatedCost).toBe(0.0000025);
    // agregação mantém decimal exato (cast ::numeric, nunca ::float)
    await aiStore.totals('biz-1');
    expect(fake.sql.some((s) => s.includes('COALESCE(SUM(estimated_cost), 0)::numeric'))).toBe(true);
    expect(fake.sql.some((s) => /::float/i.test(s))).toBe(false);
  });
});

describe('F0 · adapters locais (memória) têm o MESMO contrato', () => {
  it('MemoryDomainEventStore e MemoryAiUsageStore respondem igual (record/list/totals)', async () => {
    const { MemoryDomainEventStore } = await import('../domain-events/store');
    const { MemoryAiUsageStore } = await import('../ai/usage-store');
    const events = new MemoryDomainEventStore();
    const usage = new MemoryAiUsageStore();
    const ev = await events.record({
      businessId: 'b', type: 'followup.due', entityType: 'followup', entityId: 'f1',
      actor: { kind: 'system' }, origin: 'automation',
    });
    expect((await events.list('b'))[0].id).toBe(ev.id);
    const rec: AiUsageRecord = await usage.record({
      businessId: 'b', agentId: 'a', feature: 'f', provider: 'p', model: 'm',
      inputTokens: 2, outputTokens: 1, latencyMs: 1,
    });
    expect((await usage.list('b'))[0].id).toBe(rec.id);
    expect((await usage.totals('b')).calls).toBe(1);
    // nenhum deles toca o documento monolítico (nem existe DB aqui)
    expect(JSON.stringify(await events.list('b'))).not.toContain('instalink_doc');
  });

  it('fábricas sem DATABASE_URL escolhem memória — sem tocar em rede/pg', async () => {
    vi.doUnmock('pg');
    vi.resetModules();
    delete process.env.DATABASE_URL;
    let poolTouched = 0;
    vi.doMock('pg', () => ({
      Pool: function Pool() { poolTouched++; return {}; } as unknown as typeof import('pg').Pool,
    }));
    const { getDomainEventStore, MemoryDomainEventStore } = await import('../domain-events/store');
    const { getAiUsageStore, MemoryAiUsageStore } = await import('../ai/usage-store');
    expect(await getDomainEventStore()).toBeInstanceOf(MemoryDomainEventStore);
    expect(await getAiUsageStore()).toBeInstanceOf(MemoryAiUsageStore);
    expect(poolTouched).toBe(0); // nem um Pool foi construído
    process.env.DATABASE_URL = 'postgres://teste.invalida/db';
  });
});
