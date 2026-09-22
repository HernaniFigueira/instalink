// ═══════════════════════════════════════════════════════════════
// EXPORTAÇÃO DE SEGURANÇA — dump completo do Supabase relacional.
// ═══════════════════════════════════════════════════════════════
// Roda ANTES de qualquer corte e gera um backup navegável (NDJSON por tabela)
// em --out-dir. É o "procedimento de retorno" do handoff: com este dump +
// o importador, o documento pode ser reconstruído no Postgres de origem.
//
//   npx tsx scripts/godoutor/export-relational.mts --to "$SUPABASE_DB_URL" --out-dir backups/supabase-YYYYMMDD
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { tableCounts } from '../../src/lib/relational/import/run';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const to = arg('to');
  const outDir = arg('out-dir');
  if (!to || !outDir) {
    console.error('Uso: --to <SUPABASE_DB_URL> --out-dir <diretório>');
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const pool = new Pool({ connectionString: to, ssl: /localhost|127\.0\.0\.1/.test(to) ? false : { rejectUnauthorized: false }, max: 3 });
  try {
    const counts = await tableCounts(pool);
    const summary: Record<string, number> = {};
    for (const table of Object.keys(counts).sort()) {
      const name = table.replace('app.', '');
      const r = await pool.query(`SELECT * FROM app."${name}" ORDER BY 1`);
      const file = path.join(outDir, `${name}.ndjson`);
      const out = fs.createWriteStream(file);
      for (const row of r.rows) out.write(JSON.stringify(row) + '\n');
      await new Promise<void>((resolve) => out.end(resolve));
      summary[name] = r.rows.length;
    }
    fs.writeFileSync(path.join(outDir, '_summary.json'), JSON.stringify(summary, null, 2));
    const total = Object.values(summary).reduce((a, b) => a + b, 0);
    console.log(JSON.stringify({ ok: true, outDir, tables: summary, total }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[export-relational] erro:', e?.message || e);
  process.exit(1);
});
