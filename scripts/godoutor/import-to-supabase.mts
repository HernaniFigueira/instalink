// ═══════════════════════════════════════════════════════════════
// IMPORTADOR GoDoutor — documento monolítico → Supabase relacional.
// ═══════════════════════════════════════════════════════════════
// Uso:
//   npx tsx scripts/godoutor/import-to-supabase.mts \
//     --from-file  data/neon-export.json          # ou:
//     --from-url   "$SOURCE_DATABASE_URL"          # lê instalink_doc (Neon)
//     --to         "$SUPABASE_DB_URL" \
//     [--allow-overwrite]   # exigido quando o destino JÁ tem linhas (reconciliação)
//     [--dry-run]           # valida origem/destino e NÃO grava
//     [--report out.json]
//
// Segurança:
//   • origem e destino não podem ser a mesma conexão;
//   • destino populado sem --allow-overwrite ⇒ NADA é gravado;
//   • falha de leitura da origem é erro (nunca "banco vazio");
//   • conflitos de horário já existentes na ORIGEM abortam a importação com
//     a lista completa (reconciliação humana antes do corte);
//   • senha/connection string só via ambiente — nunca em argumento commitado.
import fs from 'node:fs';
import { Pool } from 'pg';
import { normalizeDB } from '../../src/lib/db';
import { importDocument, tableCounts } from '../../src/lib/relational/import/run';
import { validateImport } from '../../src/lib/relational/import/validate';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

async function readDocumentFromFile(path: string): Promise<unknown> {
  const raw = fs.readFileSync(path, 'utf8');
  if (!raw.trim()) throw new Error(`Arquivo ${path} está vazio — falha de leitura não é banco vazio.`);
  const parsed = JSON.parse(raw);
  // Export pode vir do documento puro ou da linha instalink_doc ({id, data}).
  if (parsed && typeof parsed === 'object' && 'data' in parsed && parsed.data && typeof parsed.data === 'object' && 'businesses' in (parsed.data as object)) {
    return parsed.data;
  }
  return parsed;
}

async function readDocumentFromUrl(url: string): Promise<unknown> {
  const pool = new Pool({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }, max: 1 });
  try {
    // Fail-closed: tabela/linha ausente é ERRO — nunca vira documento vazio.
    const exists = await pool.query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'instalink_doc'`,
    );
    if (exists.rows.length === 0) {
      throw new Error('Tabela instalink_doc não existe na origem informada.');
    }
    const r = await pool.query('SELECT data FROM instalink_doc WHERE id = 1');
    if (r.rows.length === 0) {
      throw new Error('instalink_doc está vazia na origem — não há documento para importar.');
    }
    return r.rows[0].data;
  } finally {
    await pool.end();
  }
}

async function main() {
  const fromFile = arg('from-file');
  const fromUrl = arg('from-url');
  const to = arg('to');
  const reportPath = arg('report');
  const dryRun = hasFlag('dry-run');
  const allowOverwrite = hasFlag('allow-overwrite');

  if (!fromFile && !fromUrl) {
    console.error('Informe --from-file <export.json> ou --from-url <SOURCE_DATABASE_URL>.');
    process.exit(2);
  }
  if (!to) {
    console.error('Informe --to <SUPABASE_DB_URL> (string de conexão do pooler do projeto alvo).');
    process.exit(2);
  }
  if (fromUrl && fromUrl === to) {
    console.error('Origem e destino não podem ser a mesma conexão.');
    process.exit(2);
  }

  console.error('[1/5] Lendo origem…');
  const rawDoc = fromFile ? await readDocumentFromFile(fromFile) : await readDocumentFromUrl(fromUrl!);
  const doc = normalizeDB(rawDoc); // defaults aditivos; nada é apagado
  const collections = Object.entries(doc).filter(([, v]) => Array.isArray(v)) as Array<[string, unknown[]]>;
  const totalSource = collections.reduce((n, [, v]) => n + v.length, 0);
  console.error(`      documento: ${collections.length} coleções, ${totalSource} registros.`);
  if (totalSource === 0) {
    console.error('ABORTADO: documento de origem vazio. Se isso for inesperado, verifique a exportação — NUNCA importamos "vazio" por segurança.');
    process.exit(3);
  }

  console.error('[2/5] Conferindo destino…');
  const pool = new Pool({ connectionString: to, ssl: /localhost|127\.0\.0\.1/.test(to) ? false : { rejectUnauthorized: false }, max: 3 });
  const client = await pool.connect();
  try {
    const before = await tableCounts(client);
    const populated = Object.entries(before).filter(([, n]) => n > 0);
    console.error(`      destino: ${populated.length === 0 ? 'vazio' : populated.map(([t, n]) => `${t}=${n}`).join(', ')}`);
    if (populated.length > 0 && !allowOverwrite && !dryRun) {
      console.error('ABORTADO: destino já tem dados. Reimportar é RECONCILIAÇÃO — rode com --allow-overwrite depois de conferir o backup. Nada foi gravado.');
      process.exit(3);
    }

    console.error('[3/5] Importando (transacional por tabela)…');
    if (dryRun) {
      console.error('      --dry-run: nenhuma gravação foi feita.');
      process.exit(0);
    }
    const report = await importDocument(client, doc, { mode: 'upsert', allowPopulated: allowOverwrite });
    if (!report.ok) {
      console.error(`FALHOU em ${report.error?.table}: ${report.error?.message}`);
      if (report.conflicts.length > 0) {
        console.error(`Conflitos de horário na ORIGEM (primeiros 10):`);
        for (const c of report.conflicts.slice(0, 10)) console.error(' -', JSON.stringify(c));
      }
      process.exit(4);
    }
    const written = report.tables.reduce((n, t) => n + t.written, 0);
    console.error(`      gravadas: ${written} linhas em ${report.tables.filter((t) => t.written > 0).length} tabelas.`);

    console.error('[4/5] Validando (contagens, conteúdo e vínculos)…');
    const validation = await validateImport(client, doc);
    const badCounts = validation.counts.filter((c) => !c.ok);
    console.error(`      contagens: ${validation.counts.length - badCounts.length}/${validation.counts.length} OK; conteúdo: ${validation.contentErrors.length} divergência(s); vínculos órfãos: ${validation.orphanErrors.filter((o) => o.count > 0).length}`);
    if (!validation.ok) {
      console.error('VALIDAÇÃO FALHOU — corra o relatório antes do corte.');
      if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ report, validation }, null, 2));
      process.exit(4);
    }

    console.error('[5/5] OK — importação reconciliada e validada.');
    if (reportPath) fs.writeFileSync(reportPath, JSON.stringify({ report, validation }, null, 2));
    console.log(JSON.stringify({ ok: true, written, counts: report.tables }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[import] erro:', e?.message || e);
  process.exit(1);
});
