// ═══════════════════════════════════════════════════════════════
// SEED SINTÉTICO — homologação do esquema/importador em base de teste.
// ═══════════════════════════════════════════════════════════════
// IMPORTANTE (handoff §6): NUNCA apontar para o projeto de produção. O script
// RECUSA conexões *.supabase.co — homologação usa Postgres descartável local
// (ou banco de preview separado, se a operação criar um).
//
//   npx tsx scripts/godoutor/seed-synthetic.mts --to "postgres://localhost/godoutor_dev"
import { Pool } from 'pg';
import { syntheticDocument } from '../../src/lib/relational/testing/helpers/synthetic';
import { importDocument } from '../../src/lib/relational/import/run';
import { validateImport } from '../../src/lib/relational/import/validate';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const to = arg('to');
  if (!to) {
    console.error('Uso: --to <DATABASE_URL de base de TESTE>');
    process.exit(2);
  }
  if (/supabase\.(co|com)/i.test(to)) {
    console.error('RECUSADO: seed sintético nunca vai para o Supabase de produção.');
    process.exit(3);
  }
  const doc = syntheticDocument();
  const pool = new Pool({ connectionString: to, ssl: /localhost|127\.0\.0\.1/.test(to) ? false : { rejectUnauthorized: false }, max: 3 });
  try {
    const report = await importDocument(pool, doc, { mode: 'upsert', allowPopulated: true });
    if (!report.ok) {
      console.error('FALHOU:', report.error?.table, report.error?.message);
      process.exit(4);
    }
    const validation = await validateImport(pool, doc);
    const out: Record<string, unknown> = {
      ok: report.ok && validation.ok,
      written: report.tables.reduce((n, t) => n + t.written, 0),
      countsOk: validation.counts.every((c) => c.ok),
      contentErrors: validation.contentErrors.length,
      orphans: validation.orphanErrors.filter((o) => o.count > 0),
    };
    if (validation.contentErrors.length > 0) out.samples = validation.contentErrors.slice(0, 10);
    console.log(JSON.stringify(out, null, 2));
    process.exit(report.ok && validation.ok ? 0 : 4);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[seed-synthetic] erro:', e?.message || e);
  process.exit(1);
});
