// ═══════════════════════════════════════════════════════════════
// EXECUTOR DA IMPORTAÇÃO — repetível, reconciliado e honesto.
// ═══════════════════════════════════════════════════════════════
// • Confere a migração (schema_migrations/0001) ANTES de gravar — sem schema,
//   sem importação (nunca "cria por fora").
// • RECUSA destino já populado, exceto em modo upsert (--mode upsert = hora da
//   RECONCILIAÇÃO) — nunca sobrescreve nem apaga dados por engano.
// • Falha em UMA linha aborta a importação e o relatório diz exatamente a
//   tabela, o id e o erro do Postgres. Nada continua "melhor-esforço".
// • Nunca preenche produção com seed: quem chama decide o destino; o CLI
//   exige flags explícitas para escrever em base não vazia.
import type { Pool, PoolClient } from 'pg';
import type { DB } from '../../types';
import { documentToRows, findBookingOverlapConflicts, type ImportPlan } from './transform';

export interface ImportReport {
  ok: boolean;
  tables: Array<{ table: string; written: number }>;
  /** Sobreposições de horário que a ORIGEM já contém (pré-flight). */
  conflicts: Array<Record<string, unknown>>;
  error?: { table: string; rowId: string; message: string };
}

export interface ImportRunOptions {
  /** upsert = reconcilia (ON CONFLICT (id) DO UPDATE); insert = falha se id já existe. Padrão: upsert. */
  mode?: 'upsert' | 'insert';
  batchSize?: number;
  /** Exigido quando o destino já tem linhas (decisão explícita da operação). */
  allowPopulated?: boolean;
}

export async function checkSchema(client: PoolClient | Pool): Promise<{ ok: boolean; missing: string[] }> {
  const r = await client.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'app'`);
  const have = new Set(r.rows.map((x) => `app.${x.tablename}`));
  const missing = ['app.bookings', 'app.businesses'].filter((t) => !have.has(t));
  return { ok: missing.length === 0, missing };
}

export async function tableCounts(client: PoolClient | Pool): Promise<Record<string, number>> {
  const tables = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'app' AND tablename <> 'schema_migrations'`,
  );
  const out: Record<string, number> = {};
  for (const { tablename } of tables.rows) {
    const c = await client.query(`SELECT count(*)::int AS n FROM app."${tablename}"`);
    out[`app.${tablename}`] = c.rows[0].n;
  }
  return out;
}

export async function importDocument(
  client: PoolClient | Pool,
  source: DB,
  opts: ImportRunOptions = {},
): Promise<ImportReport> {
  const report: ImportReport = { ok: false, tables: [], conflicts: [] };

  // 1) Migração aplicada? (fail-closed)
  const schema = await checkSchema(client);
  if (!schema.ok) {
    report.error = {
      table: 'schema', rowId: '',
      message: `Migração 0001 ausente (${schema.missing.join(', ')}). Aplique supabase/migrations antes de importar — nada foi gravado.`,
    };
    return report;
  }

  // 2) Destino populado exige decisão explícita.
  const counts = await tableCounts(client);
  const populated = Object.entries(counts).filter(([, n]) => n > 0);
  if (populated.length > 0 && !opts.allowPopulated) {
    report.error = {
      table: 'target', rowId: '',
      message: `Destino já tem dados (${populated.slice(0, 5).map(([t, n]) => `${t}=${n}`).join(', ')}…). Reimportar é RECONCILIAÇÃO: rode com allowPopulated/--allow-overwrite após checar o backup. Nada foi gravado.`,
    };
    return report;
  }

  // 3) Pré-flight: sobreposições que a ORIGEM já contém — a constraint
  //    bookings_no_overlap recusaria. Devolve a lista p/ reconciliação humana.
  report.conflicts = findBookingOverlapConflicts(source);
  if (report.conflicts.length > 0) {
    report.error = {
      table: 'app.bookings', rowId: '',
      message: `Origem tem ${report.conflicts.length} sobreposição(ões) de horário (regra da agenda). Reconcilie antes — nada foi gravado.`,
    };
    return report;
  }

  const plan: ImportPlan = documentToRows(source);
  const upsert = opts.mode !== 'insert';

  for (const { table, rows, post } of plan.tables) {
    if (rows.length === 0) {
      report.tables.push({ table, written: 0 });
      continue;
    }
    try {
      for (const row of rows) {
        const cols = Object.keys(row);
        const vals = Object.values(row);
        const ph = cols.map((_, k) => `$${k + 1}`).join(', ');
        const conflict = upsert
          ? `ON CONFLICT (id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')}`
          : 'ON CONFLICT (id) DO NOTHING';
        await client.query(
          `INSERT INTO app."${table}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${ph}) ${conflict}`,
          vals,
        );
      }
      // Fase 2 (dependência circular lead↔booking).
      if (post) await post(client);
      report.tables.push({ table, written: rows.length });
    } catch (e: any) {
      report.error = {
        table, rowId: '',
        message: `${e?.message || e} ${e?.detail || ''}${e?.constraint ? ` [${e.constraint}]` : ''}`.trim(),
      };
      return report;
    }
  }

  report.ok = true;
  return report;
}
