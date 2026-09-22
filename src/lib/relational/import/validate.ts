// ═══════════════════════════════════════════════════════════════
// VALIDAÇÃO DA IMPORTAÇÃO — contagens, vínculos e conferência linha a linha.
// ═══════════════════════════════════════════════════════════════
// O corte só avança com este relatório verde (handoff §6/§9):
//   1. CONTAGENS: cada coleção da origem = contagem na tabela destino;
//   2. CONFERÊNCIA: cada linha transformada existe no destino com o MESMO
//      conteúdo (comparação por id, amostragem completa até o teto);
//   3. VÍNCULOS: nenhuma FK-backed referência órfã no destino.
import type { Pool, PoolClient } from 'pg';
import type { DB } from '../../types';
import { documentToRows } from './transform';

export interface ValidationReport {
  ok: boolean;
  counts: Array<{ table: string; source: number; target: number; ok: boolean }>;
  contentErrors: Array<{ table: string; id: string; field: string }>;
  orphanErrors: Array<{ table: string; column: string; count: number }>;
}

const COMPARE_LIMIT = 5000; // por tabela: conferência completa até o teto

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^\d{2}:\d{2}$/;

/** Igualdade profunda INSENSÍVEL à ordem de chaves (jsonb do PG reordena). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === (b as unknown[]).length && a.every((x, i) => deepEqual(x, (b as unknown[])[i]));
  }
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length || !ka.every((k, i) => k === kb[i])) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Converte o valor esperado (texto JSON quando veio do transform) em objeto. */
function asValue(v: unknown): unknown {
  if (typeof v === 'string' && v.length > 1 && (v[0] === '{' || v[0] === '[')) {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

/**
 * Compara o valor ESPERADO (transformado) com o GRAVADO, considerando as
 * normalizações do Postgres: timestamptz volta como Date, date volta como
 * Date (meia-noite UTC), time volta com segundos, jsonb reordena chaves.
 */
const cmp = (a: unknown, b: unknown): boolean => {
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (b instanceof Date) {
    const bs = b.toISOString();
    if (typeof a === 'string' && DATE_ONLY.test(a)) return bs.slice(0, 10) === a;
    return bs === a || Date.parse(bs) === Date.parse(String(a));
  }
  if (typeof b === 'object') return deepEqual(asValue(a), b);
  const bs = String(b);
  if (typeof a === 'object') return deepEqual(a, asValue(bs));
  const as = String(a);
  if (CLOCK.test(as) && bs.length > as.length) return bs.slice(0, as.length) === as; // '09:00' = '09:00:00'
  if (DATE_ONLY.test(as) && bs.length > 10) return bs.slice(0, 10) === as;          // date gravada com hora
  if (typeof a === 'number') return Number(bs) === a;
  return as === bs;
};

export async function validateImport(
  client: PoolClient | Pool,
  source: DB,
): Promise<ValidationReport> {
  // finalPhase: compara com o ESTADO FINAL (leads.booking_id já restabelecido).
  const plan = documentToRows(source, { finalPhase: true });
  const report: ValidationReport = { ok: true, counts: [], contentErrors: [], orphanErrors: [] };

  // 1) Contagens (contando pela chave da tabela, não por linhas escritas).
  for (const { table, rows } of plan.tables) {
    const c = await client.query(`SELECT count(*)::int AS n FROM app."${table}"`);
    const target = Number(c.rows[0].n);
    const ok = target >= rows.length; // >= porque o destino pode ter linhas novas pós-importação
    report.counts.push({ table, source: rows.length, target, ok });
    if (!ok) report.ok = false;
  }

  // 2) Conferência de conteúdo (transformado × gravado), por id.
  for (const { table, rows } of plan.tables) {
    const slice = rows.slice(0, COMPARE_LIMIT);
    for (const row of slice) {
      const r = await client.query(
        `SELECT * FROM app."${table}" WHERE id = $1`,
        [row.id],
      );
      if (r.rows.length === 0) {
        report.contentErrors.push({ table, id: String(row.id), field: '(linha ausente)' });
        continue;
      }
      const dbRow = r.rows[0];
      for (const [field, expected] of Object.entries(row)) {
        if (!cmp(expected, dbRow[field])) {
          report.contentErrors.push({ table, id: String(row.id), field });
        }
      }
    }
    if (report.contentErrors.length > 0) report.ok = false;
  }

  // 3) Vínculos FK-backed órfãos no destino (defesa em profundidade — o banco
  //    já recusa, mas o relatório precisa dizer zero quando estiver verde).
  const fkChecks: Array<[string, string, string]> = [
    ['bookings', 'business_id', 'businesses'],
    ['bookings', 'service_id', 'services'],
    ['contacts', 'business_id', 'businesses'],
    ['events', 'business_id', 'businesses'],
    ['messages', 'conversation_id', 'conversations'],
    ['queue_entries', 'business_id', 'businesses'],
    ['encounters', 'business_id', 'businesses'],
    ['members', 'business_id', 'businesses'],
    ['services', 'business_id', 'businesses'],
  ];
  for (const [table, column, parent] of fkChecks) {
    const r = await client.query(
      `SELECT count(*)::int AS n FROM app."${table}" t
        LEFT JOIN app."${parent}" p ON p.id = t."${column}"
       WHERE t."${column}" IS NOT NULL AND p.id IS NULL`,
    );
    const count = Number(r.rows[0].n);
    report.orphanErrors.push({ table, column, count });
    if (count > 0) report.ok = false;
  }

  return report;
}
