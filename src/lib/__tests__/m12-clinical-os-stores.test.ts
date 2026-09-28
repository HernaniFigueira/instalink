// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — STORES NORMALIZADOS (Postgres + memória)
//
// Prova que EventLog e AI Usage persistem FORA de instalink_doc:
//   • DDL idempotente (CREATE … IF NOT EXISTS) das migrations 0001/0002;
//   • INSERT parametrizado nas tabelas `domain_event` / `ai_usage` — nunca
//     um UPDATE em instalink_doc;
//   • idempotência via UNIQUE (business_id, idempotency_key) — ON CONFLICT;
//   • tenant isolation em TODA query (business_id = $1);
//   • adapter de memória com o MESMO contrato (dev/testes sem rede).
// Tudo com Pool falso (vi.doMock('pg')) — zero banco, zero rede, zero
// escrita em produção.
// ═══════════════════════════════════════════════════════════════
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiUsageRecord } from '../ai/usage';
import type { DomainEvent } from '../domain-events/types';

/** Pool falso: registra SQL e responde como o real responderia. */
function fakePool() {
  const sql: string[] = [];
  const domainRows: any[] = [];
  const aiRows: any[] = [];
  const pool = {
    query: vi.fn(async (text: string, params?: unknown[]) => {
      sql.push(text.replace(/\s+/g, ' ').trim());
      if (text.startsWith('CREATE TABLE') || text.includes('CREATE TABLE IF NOT EXISTS')) return { rows: [] };
      if (text.includes('FROM domain_event')) {
        if (text.includes('COUNT')) return { rows: [{ calls: 0 }] };
        const [biz, key] = params || [];
        const found = domainRows.filter((r) => r.business_id === biz && (!key || r.idempotency_key === key));
        return { rows: text.includes('idempotency_key = $2') ? found.slice(0, 1) : found };
      }
      if (text.includes('INSERT INTO domain_event')) {
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
      if (text.includes('FROM ai_usage')) {
        if (text.includes('COUNT(*)')) return { rows: [{ calls: 0, input_tokens: 0, output_tokens: 0, estimated_cost: 0 }] };
        return { rows: aiRows };
      }
      if (text.includes('INSERT INTO ai_usage')) {
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
  const { PostgresDomainEventStore, __resetDomainEventInitForTests } = await import('../domain-events/pg-store');
  const { PostgresAiUsageStore, __resetAiUsageInitForTests } = await import('../ai/usage-pg-store');
  __resetDomainEventInitForTests();
  __resetAiUsageInitForTests();
  return { eventStore: new PostgresDomainEventStore(), aiStore: new PostgresAiUsageStore() };
}

describe('F0 · PostgresDomainEventStore (tabela normalizada domain_event)', () => {
  it('grava em domain_event — NUNCA em instalink_doc', async () => {
    const fake = fakePool();
    const { eventStore } = await loadStores(fake);
    await eventStore.record({
      businessId: 'biz-1', type: 'encounter.started', entityType: 'encounter', entityId: 'e1',
      actor: { kind: 'user', id: 'u1' }, origin: 'ui', idempotencyKey: 'ek-1',
    });
    expect(fake.sql.some((s) => s.includes('CREATE TABLE IF NOT EXISTS domain_event'))).toBe(true);
    expect(fake.sql.some((s) => s.includes('INSERT INTO domain_event'))).toBe(true);
    expect(fake.sql.some((s) => s.includes('instalink_doc'))).toBe(false);
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
    expect(fake.sql.some((s) => s.includes('domain_event_business_idem_uq'))).toBe(true);
  });

  it('tenant isolation: toda query lista com business_id', async () => {
    const fake = fakePool();
    const { eventStore } = await loadStores(fake);
    await eventStore.record({
      businessId: 'biz-A', type: 'exam.ordered', entityType: 'clinical_order', entityId: 'o1',
      actor: { kind: 'user' }, origin: 'ui',
    });
    await eventStore.list('biz-A', { type: 'exam.ordered' });
    const listSql = fake.sql.filter((s) => s.includes('SELECT') && s.includes('FROM domain_event') && s.includes('ORDER BY'));
    expect(listSql.length).toBeGreaterThan(0);
    // a query de listagem sempre começa filtrando o tenant
    expect(fake.sql.some((s) => s.includes('WHERE business_id = $1'))).toBe(true);
  });
});

describe('F0 · PostgresAiUsageStore (tabela normalizada ai_usage)', () => {
  it('grava em ai_usage — NUNCA em instalink_doc, sem prompt', async () => {
    const fake = fakePool();
    const { aiStore } = await loadStores(fake);
    await aiStore.record({
      businessId: 'biz-1', agentId: 'jev', feature: 'triage', provider: 'mock', model: 'mock-generative-v1',
      inputTokens: 10, outputTokens: 5, latencyMs: 3, decisionType: 'choice', confidence: 0.9,
    });
    expect(fake.sql.some((s) => s.includes('CREATE TABLE IF NOT EXISTS ai_usage'))).toBe(true);
    expect(fake.sql.some((s) => s.includes('INSERT INTO ai_usage'))).toBe(true);
    expect(fake.sql.some((s) => s.includes('instalink_doc'))).toBe(false);
    expect(JSON.stringify(fake.aiRows)).not.toMatch(/prompt|transcript|notes/i);
  });

  it('tenant isolation em list/totals (business_id sempre)', async () => {
    const fake = fakePool();
    const { aiStore } = await loadStores(fake);
    await aiStore.list('biz-A', { agentId: 'jev' });
    await aiStore.totals('biz-A');
    expect(fake.sql.some((s) => s.includes('FROM ai_usage WHERE business_id = $1'))).toBe(true);
    expect(fake.sql.some((s) => s.includes('COUNT(*)'))).toBe(true);
    // nenhuma query sem escopo de tenant
    expect(fake.sql.filter((s) => s.includes('FROM ai_usage') && !s.includes('business_id')).length).toBe(0);
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
});
