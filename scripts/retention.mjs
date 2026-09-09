// Política de retenção de dados (LGPD) — dry-run por padrão.
// Uso:
//   node scripts/retention.mjs            → mostra o que seria removido
//   node scripts/retention.mjs --apply    → remove de verdade
// Regras (ver docs/retencao.md):
//   - eventos brutos de analytics com mais de 180 dias → apagar
//   - leads de orçamento parados (status new, sem conversão) com mais de 24 meses → apagar
import fs from 'node:fs';
import path from 'node:path';

const APPLY = process.argv.includes('--apply');
const FILE = path.join(process.cwd(), 'data', 'instalink.db.json');
const DAY = 86400000;
const now = Date.now();
const EVENT_CUTOFF = new Date(now - 180 * DAY).toISOString();
const QUOTE_CUTOFF = new Date(now - 730 * DAY).toISOString();

async function load() {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const r = await pool.query('SELECT data FROM instalink_doc WHERE id = 1');
    return {
      db: r.rows[0]?.data || null,
      save: async (db) => {
        await pool.query('UPDATE instalink_doc SET data = $1 WHERE id = 1', [JSON.stringify(db)]);
        await pool.end();
      },
      close: async () => { await pool.end(); },
      where: 'Postgres',
    };
  }
  if (!fs.existsSync(FILE)) {
    console.log('Sem banco local (data/instalink.db.json) e sem DATABASE_URL — nada a fazer.');
    process.exit(0);
  }
  return {
    db: JSON.parse(fs.readFileSync(FILE, 'utf8')),
    save: async (db) => { fs.writeFileSync(FILE, JSON.stringify(db)); },
    close: async () => {},
    where: 'arquivo local',
  };
}

const store = await load();
const db = store.db;
if (!db) {
  console.log('Banco vazio — nada a fazer.');
  await store.close();
  process.exit(0);
}

const oldEvents = (db.events || []).filter((e) => (e.createdAt || '') < EVENT_CUTOFF);
const oldQuotes = (db.leads || []).filter(
  (l) => l.origin === 'quote' && l.status === 'new' && (l.createdAt || '') < QUOTE_CUTOFF,
);

console.log(`Origem: ${store.where}`);
console.log(`Eventos: ${db.events?.length || 0} total, ${oldEvents.length} com +180 dias`);
console.log(`Orçamentos parados: ${db.leads?.length || 0} leads total, ${oldQuotes.length} elegíveis (+24 meses, sem conversão)`);

if (!APPLY) {
  console.log('\nDRY-RUN — nada foi removido. Rode com --apply para aplicar.');
  await store.close();
  process.exit(0);
}

db.events = (db.events || []).filter((e) => (e.createdAt || '') >= EVENT_CUTOFF);
const dropIds = new Set(oldQuotes.map((l) => l.id));
db.leads = (db.leads || []).filter((l) => !dropIds.has(l.id));
await store.save(db);
console.log(`\nAPLICADO — removidos ${oldEvents.length} eventos e ${oldQuotes.length} orçamentos antigos.`);
await store.close();
