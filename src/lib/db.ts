// Camada de persistência.
//
// Arquitetura: todo acesso a dados passa por readDB/updateDB.
// Backend duplo, escolhido por ambiente:
//   - COM DATABASE_URL  → Postgres (documento JSONB em linha única).
//                         É o modo produção (Vercel/Neon/Supabase).
//   - SEM DATABASE_URL  → arquivo JSON local (dev).
// Nenhuma rota ou tela importa detalhes de armazenamento.
//
// FAIL-CLOSED (P0-1): erro de leitura NUNCA retorna banco vazio.
// pgRead/fileRead lançam exceção em falha real; emptyDB só existe quando
// o documento genuinamente não existe (primeira execução). updateDB nunca
// escreve sobre uma leitura que falhou.
//
// Concorrência: updateDB serializa escritas por instância (mutex em
// memória). Entre instâncias serverless distintas ainda vale last-wins —
// por isso checagens críticas (slot, código de pedido) acontecem DENTRO
// do callback, sobre a leitura mais fresca possível.
//
// Retenção: updateDB executa prune oportunístico (sessões expiradas e
// eventos antigos) para o documento não crescer sem teto.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import type { DB } from './types';
import { defaultBookingConfig } from './types';
import { backfillContacts } from './contacts';

const FILE = path.join(process.cwd(), 'data', 'instalink.db.json');

export function emptyDB(): DB {
  return {
    users: [], sessions: [], customers: [], customerSessions: [],
    passwordResets: [],
    businesses: [], pages: [], categories: [],
    products: [], options: [], optionValues: [], services: [],
    professionals: [], availability: [], exceptions: [], orders: [],
    bookings: [], leads: [], contacts: [], reviews: [], events: [],
  };
}

// Migração defensiva: preenche campos novos em documentos antigos.
// Reversível (só adiciona defaults) e idempotente.
function normalize(raw: unknown): DB {
  const base = { ...emptyDB(), ...((raw && typeof raw === 'object' ? raw : {}) as Partial<DB>) };
  // Contatos: migração defensiva UMA única vez (quando o doc antigo não
  // tinha o campo). Idempotente; nada existente é apagado ou duplicado.
  const hadContacts = Array.isArray((raw as any)?.contacts);
  if (!Array.isArray(base.contacts)) base.contacts = [];
  if (!hadContacts) backfillContacts(base);
  for (const b of base.businesses) {
    if (!b.booking) b.booking = defaultBookingConfig();
    else b.booking = { ...defaultBookingConfig(), ...b.booking };
    if (typeof b.deliveryFee !== 'number') b.deliveryFee = 0;
    if (typeof b.minOrder !== 'number') b.minOrder = 0;
    if (!Array.isArray(b.modes)) b.modes = [];
    if (!Array.isArray(b.nav)) b.nav = [];
    if (typeof b.navCustom !== 'boolean') b.navCustom = false;
    if (!b.about || typeof b.about !== 'object') {
      b.about = { title: '', text: '', image: '', enabled: false };
    } else {
      b.about = {
        title: typeof b.about.title === 'string' ? b.about.title : '',
        text: typeof b.about.text === 'string' ? b.about.text : '',
        image: typeof b.about.image === 'string' ? b.about.image : '',
        enabled: !!b.about.enabled,
      };
    }
  }
  for (const s of base.services) {
    if (!Array.isArray((s as any).professionalIds)) (s as any).professionalIds = [];
  }
  for (const a of base.availability) {
    if (typeof (a as any).serviceId !== 'string') (a as any).serviceId = '';
  }
  for (const e of base.exceptions) {
    if (typeof (e as any).start !== 'string') (e as any).start = '';
    if (typeof (e as any).end !== 'string') (e as any).end = '';
    if (typeof (e as any).note !== 'string') (e as any).note = '';
  }
  for (const l of base.leads) {
    if (typeof (l as any).customerId !== 'string') (l as any).customerId = '';
  }
  for (const o of base.orders) {
    if (typeof (o as any).updatedAt !== 'string' || !(o as any).updatedAt) (o as any).updatedAt = o.createdAt || '';
    if (!Array.isArray((o as any).history)) (o as any).history = [];
  }
  for (const bk of base.bookings) {
    if (typeof (bk as any).updatedAt !== 'string' || !(bk as any).updatedAt) (bk as any).updatedAt = bk.createdAt || '';
    if (!Array.isArray((bk as any).history)) (bk as any).history = [];
  }
  return base;
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
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30000,
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
  // FAIL-CLOSED: qualquer erro (timeout, TLS, conexão, resposta inválida)
  // propaga como exceção. emptyDB SOMENTE quando a linha não existe.
  await pgInit();
  const res = await getPool().query('SELECT data FROM instalink_doc WHERE id = 1');
  if (res.rows.length === 0) return emptyDB();
  return normalize(res.rows[0].data);
}

async function pgWrite(db: DB): Promise<void> {
  await pgInit();
  await getPool().query(
    `INSERT INTO instalink_doc (id, data) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
    [JSON.stringify(db)],
  );
}

// ── Arquivo JSON (dev local) ───────────────────────────────
function fileRead(): DB {
  if (!fs.existsSync(FILE)) return emptyDB();
  const raw = fs.readFileSync(FILE, 'utf8');
  if (!raw.trim()) return emptyDB();
  // FAIL-CLOSED também em dev: JSON corrompido lança, não vira vazio.
  return normalize(JSON.parse(raw));
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

// ── Retenção (teto contra crescimento infinito) ─────────────
const MAX_EVENTS_PER_BUSINESS = 3000;
const VOLATILE_EVENT_MAX_AGE_MS = 90 * 86400000; // page_view/ai_started
const VOLATILE_TYPES = new Set(['page_view', 'ai_started', 'ai_recommendation']);

function prune(db: DB): void {
  const now = Date.now();
  db.sessions = db.sessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  db.customerSessions = db.customerSessions.filter((s) => new Date(s.expiresAt).getTime() > now);
  db.passwordResets = db.passwordResets.filter(
    (r) => !r.usedAt && new Date(r.expiresAt).getTime() > now,
  );
  if (db.events.length === 0) return;
  const cutoff = new Date(now - VOLATILE_EVENT_MAX_AGE_MS).toISOString();
  const kept: typeof db.events = [];
  const perBiz = new Map<string, number>();
  // percorre do mais novo ao mais antigo
  for (let i = db.events.length - 1; i >= 0; i--) {
    const e = db.events[i];
    if (VOLATILE_TYPES.has(e.type) && e.createdAt < cutoff) continue;
    const n = perBiz.get(e.businessId) || 0;
    if (n >= MAX_EVENTS_PER_BUSINESS) continue;
    perBiz.set(e.businessId, n + 1);
    kept.push(e);
  }
  db.events = kept.reverse();
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

// Mutex por instância: serializa read-modify-write concorrentes.
let writeChain: Promise<unknown> = Promise.resolve();

export async function updateDB<T>(fn: (db: DB) => T): Promise<T> {
  const run = async (): Promise<T> => {
    const db = await readDB(); // falhou? lança — NADA é escrito
    const result = fn(db); // callback lançou? nada é escrito
    prune(db);
    await writeDB(db);
    return result;
  };
  const p = writeChain.then(run, run);
  writeChain = p.then(
    () => undefined,
    () => undefined,
  );
  return p;
}
