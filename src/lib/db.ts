// Camada de persistência do MVD.
//
// Arquitetura: todo acesso a dados passa por readDB/updateDB.
// Backend duplo, escolhido por ambiente:
//   - COM DATABASE_URL  → Postgres (documento JSONB em linha única).
//                         É o modo produção (Vercel/Neon/Supabase).
//   - SEM DATABASE_URL  → arquivo JSON local (dev).
// Nenhuma rota ou tela importa detalhes de armazenamento.
//
// Nota de concorrência (modo Postgres): updateDB faz read-modify-write.
// Para o volume do MVD isso é suficiente; se escalar, migrar coleções
// quentes para tabelas relacionais com transações.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import type { DB } from './types';

const FILE = path.join(process.cwd(), 'data', 'instalink.db.json');

export function emptyDB(): DB {
  return {
    users: [], sessions: [], customers: [], customerSessions: [],
    businesses: [], pages: [], categories: [],
    products: [], options: [], optionValues: [], services: [],
    professionals: [], availability: [], exceptions: [], orders: [],
    bookings: [], leads: [], reviews: [], events: [],
  };
}

function normalize(raw: unknown): DB {
  if (!raw || typeof raw !== 'object') return emptyDB();
  return { ...emptyDB(), ...(raw as Partial<DB>) };
}

// ── Postgres ────────────────────────────────────────────────
let pool: Pool | null = null;

function usePg(): boolean {
  return !!process.env.DATABASE_URL;
}

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Neon/Vercel Postgres/Supabase exigem SSL. PGSSLMODE=disable só
      // para Postgres local sem SSL.
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

async function pgInit(): Promise<void> {
  await getPool().query(
    'CREATE TABLE IF NOT EXISTS instalink_doc (id SMALLINT PRIMARY KEY, data JSONB NOT NULL)',
  );
}

async function pgRead(): Promise<DB> {
  try {
    await pgInit();
    const res = await getPool().query('SELECT data FROM instalink_doc WHERE id = 1');
    if (res.rows.length === 0) return emptyDB();
    return normalize(res.rows[0].data);
  } catch {
    return emptyDB();
  }
}

async function pgWrite(db: DB): Promise<void> {
  await pgInit();
  await getPool().query(
    `INSERT INTO instalink_doc (id, data) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [JSON.stringify(db)],
  );
}

// ── Arquivo JSON (dev local) ────────────────────────────────
function fileRead(): DB {
  try {
    if (!fs.existsSync(FILE)) return emptyDB();
    const raw = fs.readFileSync(FILE, 'utf8');
    if (!raw.trim()) return emptyDB();
    return normalize(JSON.parse(raw));
  } catch {
    return emptyDB();
  }
}

function fileWrite(db: DB): void {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  try {
    if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.bak');
  } catch {
    /* backup é melhor-esforço: nunca pode quebrar a escrita */
  }
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, FILE);
}

// ── API pública (sempre async) ──────────────────────────────
export async function readDB(): Promise<DB> {
  if (usePg()) return pgRead();
  return fileRead();
}

export async function writeDB(db: DB): Promise<void> {
  if (usePg()) return pgWrite(db);
  return fileWrite(db);
}

export async function updateDB<T>(fn: (db: DB) => T): Promise<T> {
  const db = await readDB();
  const result = fn(db);
  await writeDB(db);
  return result;
}
