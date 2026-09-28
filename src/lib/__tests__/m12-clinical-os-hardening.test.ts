// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — HARDENING (auditoria estática + UUID)
//
// Travas do hardening final, verificadas CONTRA O CÓDIGO/arquivos reais:
//   1) `ai_usage.id` é UUID v4 via crypto.randomUUID() — sem contador
//      global (seguro entre instâncias serverless); `id` explícito é
//      respeitado (fixtures); ids de módulos recém-instanciados nunca
//      colidem (o problema do contador que foi corrigido);
//   2) stores de runtime NÃO CONTÊM DDL (nenhum CREATE TABLE/INDEX,
//      ALTER TABLE no código-fonte fora de comentários — nem no resto
//      de src/lib dos módulos F0);
//   3) SQL do runtime é QUALIFICADO com godoutor_internal.* — e o código
//      não mexe em search_path;
//   4) migrations 0001/0002 são a única autoridade estrutural: criam o
//      schema, as tabelas qualificadas, os índices, NUMERIC(18,8) para
//      estimated_cost e NASCEM FECHADAS (REVOKE PUBLIC/anon/
//      authenticated/service_role, sem USAGE de schema para o gateway);
//   5) preservações contratuais: DomainEvent continua fora de
//      instalink_doc, DecisionEngine/Página legada seguem vivos.
// ═══════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Remove comentários de linha/bloco para auditar SÓ o código vivo. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      let inString: string | null = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inString) { if (ch === '\\') i++; else if (ch === inString) inString = null; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { inString = ch; continue; }
        if (ch === '/' && line[i + 1] === '/') return line.slice(0, i);
      }
      return line;
    })
    .join('\n');
}

const DDL_RE = /\b(CREATE\s+(TABLE|INDEX|UNIQUE\s+INDEX|SCHEMA)|ALTER\s+TABLE|DROP\s+TABLE)\b/i;

// Remove comentários SQL (linha `--` e blocos de comentário) para auditar só o statement.
function stripSqlComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
}

const F0_STORE_FILES = [
  'src/lib/domain-events/pg-store.ts',
  'src/lib/domain-events/store.ts',
  'src/lib/domain-events/emit.ts',
  'src/lib/ai/usage-pg-store.ts',
  'src/lib/ai/usage-store.ts',
  'src/lib/ai/usage.ts',
  'src/lib/pg.ts',
];

describe('F0 hardening · runtime não é autoridade de DDL', () => {
  it('nenhum store/módulo F0 executa CREATE/ALTER/DROP no código vivo', () => {
    for (const file of F0_STORE_FILES) {
      const code = stripComments(read(file));
      expect(DDL_RE.test(code), `${file} contém DDL — migrations são a única autoridade`).toBe(false);
    }
  });

  it('stores só referenciam tabelas qualificadas godoutor_internal.*', () => {
    const ev = read('src/lib/domain-events/pg-store.ts');
    const ai = read('src/lib/ai/usage-pg-store.ts');
    expect(ev).toContain("'godoutor_internal.domain_event'");
    expect(ai).toContain("'godoutor_internal.ai_usage'");
    // e nenhuma query crua cita as tabelas SEM o schema (search_path jamais)
    for (const src of [stripComments(ev), stripComments(ai)]) {
      expect(/\b(FROM|INTO)\s+domain_event\b/.test(src)).toBe(false);
      expect(/\b(FROM|INTO)\s+ai_usage\b/.test(src)).toBe(false);
    }
    // ninguém ALTERA search_path em nenhum módulo F0. (A trava é sobre
    // MUTAÇÃO, não sobre a palavra: a sonda de boot de lib/pg.ts APENAS LÊ
    // current_setting('search_path') para diagnóstico — não altera nada.)
    for (const file of F0_STORE_FILES) {
      const code = stripComments(read(file));
      expect(code).not.toMatch(/\bSET\s+(SESSION\s+|LOCAL\s+)?search_path\b/i);
      expect(code).not.toMatch(/ALTER\s+(ROLE|DATABASE)\b[^;]*\bsearch_path\b/i);
    }
  });

  it('migration ausente é falha EXPLÍCITA (42P01/3F000 traduzidos, com o arquivo apontado)', () => {
    const ev = stripComments(read('src/lib/domain-events/pg-store.ts'));
    const ai = stripComments(read('src/lib/ai/usage-pg-store.ts'));
    expect(ev).toMatch(/'42P01'/);
    expect(ev).toMatch(/0001_domain_event\.sql/);
    expect(ai).toMatch(/'42P01'/);
    expect(ai).toMatch(/0002_ai_usage\.sql/);
  });
});

describe('F0 hardening · migrations (única autoridade estrutural)', () => {
  const m1 = read('db/migrations/0001_domain_event.sql');
  const m2 = read('db/migrations/0002_ai_usage.sql');

  it('0001/0002 criam o schema interno e as tabelas QUALIFICADAS', () => {
    expect(m1).toMatch(/CREATE SCHEMA IF NOT EXISTS godoutor_internal/);
    expect(m1).toMatch(/CREATE TABLE IF NOT EXISTS godoutor_internal\.domain_event/);
    expect(m2).toMatch(/CREATE SCHEMA IF NOT EXISTS godoutor_internal/);
    expect(m2).toMatch(/CREATE TABLE IF NOT EXISTS godoutor_internal\.ai_usage/);
    // índices também na tabela qualificada
    expect(m1).toMatch(/ON godoutor_internal\.domain_event \(business_id, occurred_at DESC\)/);
    expect(m1).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS domain_event_business_idem_uq\s*\n?\s*ON godoutor_internal\.domain_event \(business_id, idempotency_key\)/);
    expect(m2).toMatch(/ON godoutor_internal\.ai_usage \(business_id, created_at DESC\)/);
  });

  it('estimated_cost é NUMERIC(18,8) — nunca DOUBLE PRECISION', () => {
    expect(m2).toMatch(/estimated_cost\s+NUMERIC\(18,8\)\s+NOT NULL DEFAULT 0/);
    expect(m2).not.toMatch(/estimated_cost\s+DOUBLE PRECISION/);
    // e o runtime trata NUMERIC como decimal (string) — sem cast ::float
    const ai = stripComments(read('src/lib/ai/usage-pg-store.ts'));
    expect(ai).not.toMatch(/::float/i);
    expect(ai).toMatch(/COALESCE\(SUM\(estimated_cost\), 0\)::numeric/);
  });

  it('tabelas novas NASCEM FECHADAS: REVOKE de PUBLIC/anon/authenticated/service_role', () => {
    for (const [sql, table] of [[m1, 'godoutor_internal.domain_event'], [m2, 'godoutor_internal.ai_usage']] as const) {
      expect(sql).toContain(`REVOKE ALL ON ${table} FROM PUBLIC`);
      // os papéis do gateway público perdem acesso à tabela e ao schema
      expect(sql).toMatch(/'anon', 'authenticated', 'service_role'/);
      expect(sql).toMatch(/REVOKE ALL ON godoutor_internal\.domain_event FROM %I|REVOKE ALL ON godoutor_internal\.ai_usage FROM %I/);
      expect(sql).toMatch(/REVOKE ALL ON SCHEMA godoutor_internal FROM %I/);
      // portável fora do Supabase: revogações condicionais via to_regrole
      expect(sql).toMatch(/to_regrole\(rol\)/);
    }
  });

  it('migration NÃO depende de search_path e não toca instalink_doc (no SQL vivo)', () => {
    // só o SQL conta: comentários podem NOMEAR o legado para explicá-lo
    const sql = stripSqlComments(m1 + m2);
    expect(sql).not.toMatch(/search_path/i);
    expect(sql).not.toMatch(/instalink_doc/i);
  });
});

describe('F0 hardening · ai_usage id é UUID v4 sem contador global', () => {
  it('buildAiUsageRecord gera UUID v4 válido e único por chamada', async () => {
    const { buildAiUsageRecord } = await import('../ai/usage');
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const a = buildAiUsageRecord({
      businessId: 'b', agentId: 'a', feature: 'f', provider: 'p', model: 'm',
      inputTokens: 1, outputTokens: 1, latencyMs: 1,
    });
    const b = buildAiUsageRecord({
      businessId: 'b', agentId: 'a', feature: 'f', provider: 'p', model: 'm',
      inputTokens: 1, outputTokens: 1, latencyMs: 1,
    });
    expect(a.id).toMatch(uuidV4);
    expect(b.id).toMatch(uuidV4);
    expect(a.id).not.toBe(b.id);
  });

  it('ids não dependem de contador global: duas INSTANCIAS do módulo não colidem', async () => {
    // O bug do antigo `aiu-<data>-<seq>`: cada cold start reiniciava seq em
    // zero — duas instâncias geravam o MESMO id. UUID não tem esse estado.
    const first = await import('../ai/usage');
    const idFromFirst = first.buildAiUsageRecord({
      businessId: 'b', agentId: 'a', feature: 'f', provider: 'p', model: 'm',
      inputTokens: 1, outputTokens: 1, latencyMs: 1,
    }).id;
    vi.resetModules();
    const second = await import('../ai/usage');
    const idFromSecond = second.buildAiUsageRecord({
      businessId: 'b', agentId: 'a', feature: 'f', provider: 'p', model: 'm',
      inputTokens: 1, outputTokens: 1, latencyMs: 1,
    }).id;
    expect(idFromSecond).not.toBe(idFromFirst);
    vi.resetModules();
  });

  it('fixtures podem fixar id explícito (e o código não tem mais `let seq`)', async () => {
    const { buildAiUsageRecord } = await import('../ai/usage');
    const rec = buildAiUsageRecord({
      id: 'fixture-id-1', businessId: 'b', agentId: 'a', feature: 'f', provider: 'p',
      model: 'm', inputTokens: 1, outputTokens: 1, latencyMs: 1,
    });
    expect(rec.id).toBe('fixture-id-1');
    const code = stripComments(read('src/lib/ai/usage.ts'));
    expect(code).not.toMatch(/\bseq\b/);
    expect(code).toMatch(/randomUUID\(\)/);
  });
});

describe('F0 hardening · contratos preservados', () => {
  it('EventLog/AI Usage continuam FORA de instalink_doc (nenhum import dos módulos)', () => {
    for (const file of F0_STORE_FILES) {
      // em produção só o pool compartilhado existe; db.ts (instalink_doc)
      // não é referenciado de jeito nenhum pelos módulos normalizados
      expect(read(file)).not.toMatch(/from '\.\.\/db'|require\(['"]\.\.\/db['"]\)/);
    }
  });

  it('DecisionEngine e Página legada seguem íntegros (flag off por padrão)', async () => {
    const { getDecisionEngine } = await import('../decision');
    expect(getDecisionEngine({}).id).toBe('disabled');
    const { isLegacyPagesEnabled, filterNavAreas } = await import('../product');
    expect(isLegacyPagesEnabled({})).toBe(false);
    const areas = [{ id: 'principal' }, { id: 'presenca' }];
    expect(filterNavAreas(areas, {}).map((a) => a.id)).toEqual(['principal']);
  });
});
