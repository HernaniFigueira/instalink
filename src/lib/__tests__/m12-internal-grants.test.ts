// ═══════════════════════════════════════════════════════════════
// F0-GIFTS · 0003 — grants do papel do backend nos stores internos
//
// Por que teste próprio: a 0003 CORRIGE uma premissa falsa de 0001/0002
// (auditoria 2026-09-28 no Supabase real): o papel da conexão do backend
// (`godoutor_app`) não tinha USAGE no schema nem SELECT/INSERT nas tabelas
// — sem isto, TODO uso dos stores normalizados falha com 42501. O contrato
// abaixo trava três coisas: (1) a 0003 concede EXATAMENTE o que o runtime
// usa (nada de UPDATE/DELETE/CREATE/TRUNCATE/REFERENCES), (2) nunca encosta
// nos papéis do gateway público (fechamento client-side intocado), e
// (3) continua portável fora do Supabase (guarda to_regrole; sem tabelas
// das migrations anteriores ⇒ falha explícita, não grant parcial).
// ═══════════════════════════════════════════════════════════════
import { readFileSync } from 'node:fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Remove comentários de linha `--` para auditar só o statement. */
function stripSql(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n');
}

const m3 = () => stripSql(read('db/migrations/0003_internal_backend_grants.sql'));

describe('0003 · grants do backend em godoutor_internal', () => {
  it('concede ao papel do backend SOMENTE USAGE no schema + SELECT/INSERT nas duas tabelas', () => {
    const sql = m3();
    const grants = sql.match(/GRANT[^;']+/g) ?? [];
    // 3 concessões, nenhuma a mais: schema + 2 tabelas.
    expect(grants).toHaveLength(3);
    expect(grants.some((g) => /GRANT\s+USAGE\s+ON\s+SCHEMA\s+godoutor_internal/i.test(g))).toBe(true);
    expect(grants.some((g) => /GRANT\s+SELECT,\s*INSERT\s+ON\s+godoutor_internal\.domain_event/i.test(g))).toBe(true);
    expect(grants.some((g) => /GRANT\s+SELECT,\s*INSERT\s+ON\s+godoutor_internal\.ai_usage/i.test(g))).toBe(true);
  });

  it('NÃO concede UPDATE/DELETE/CREATE/TRUNCATE/REFERENCES (menor privilégio real do runtime)', () => {
    // os stores só fazem SELECT/INSERT/ON CONFLICT DO NOTHING/COUNT/SUM —
    // qualquer privilégio além deste contrato é superfície de ataque.
    const grants = m3().match(/GRANT[^;']+/g) ?? [];
    for (const g of grants) {
      expect(g, `grant com privilégio além do contrato: ${g}`).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|REFERENCES|CREATE)\b/);
    }
  });

  it('NÃO menciona anon/authenticated/service_role como beneficiários', () => {
    // o fechamento do gateway público vem de 0001/0002; a 0003 não o toca
    // nem o desfaz. (O comentário do header pode NOMEAR os papéis — só o
    // statement vivo é auditado.)
    const grants = m3().match(/GRANT[^;']+/g) ?? [];
    for (const g of grants) {
      expect(g).not.toMatch(/\b(anon|authenticated|service_role)\b/);
    }
  });

  it('é portável: guarda to_regrole (papel ausente ⇒ no-op) e exige 0001/0002 via to_regclass', () => {
    const sql = m3();
    expect(sql).toMatch(/to_regrole\(\s*backend_role\s*\)\s+IS\s+NULL/i);
    expect(sql).toMatch(/RETURN/i); // ambiente sem papel dedicado: nada a fazer
    expect(sql).toMatch(/to_regclass\(\s*'godoutor_internal\.domain_event'\s*\)\s+IS\s+NULL/i);
    expect(sql).toMatch(/to_regclass\(\s*'godoutor_internal\.ai_usage'\s*\)\s+IS\s+NULL/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION/i); // fora de ordem ⇒ explícito
    expect(sql).toMatch(/ERRCODE\s*=\s*'42P01'/i);
  });

  it('não cria nem altera estrutura (só GRANT — migrations seguem a única autoridade DDL)', () => {
    const sql = m3();
    expect(sql).not.toMatch(/\b(CREATE\s+(TABLE|INDEX|SCHEMA)|ALTER\s+TABLE|DROP\s+(TABLE|SCHEMA))\b/i);
  });

  it('0001/0002 permanecem inalteradas no contrato de fechamento (esta migração só soma grants)', () => {
    for (const f of ['db/migrations/0001_domain_event.sql', 'db/migrations/0002_ai_usage.sql']) {
      const sql = stripSql(read(f));
      expect(sql).toMatch(/REVOKE ALL ON \S+ FROM PUBLIC/i); // nasceram fechadas — continuam
    }
  });
});

describe('0003 · o contrato do teste espelha o SQL vivo dos stores', () => {
  it('stores não usam UPDATE/DELETE/CREATE nas tabelas internas (privilégios concedidos são exatos)', () => {
    for (const f of ['src/lib/domain-events/pg-store.ts', 'src/lib/ai/usage-pg-store.ts']) {
      const code = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((l) => l.replace(/\/\/.*$/, ''))
        .join('\n');
      expect(code, `${f} contém UPDATE nas tabelas internas`).not.toMatch(/\bUPDATE\s+godoutor_internal\b/i);
      expect(code, `${f} contém DELETE nas tabelas internas`).not.toMatch(/\bDELETE\s+FROM\s+godoutor_internal\b/i);
      expect(code, `${f} contém DDL`).not.toMatch(/\b(CREATE|ALTER|DROP|TRUNCATE)\b/i);
    }
  });
});
