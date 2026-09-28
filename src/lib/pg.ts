// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — Acesso Postgres compartilhado
// ═══════════════════════════════════════════════════════════════
// Pool único por processo para TODO acesso Postgres: o ledger monolítico
// (instalink_doc em db.ts) e os domínios NORMALIZADOS novos (domain_event,
// ai_usage e os futuros F1+) compartilham a mesma conexão/configuração.
//
// Padrão do projeto (preservado): backend duplo por ambiente —
//   • COM DATABASE_URL  → Postgres (produção: Vercel/Neon/Supabase);
//   • SEM DATABASE_URL  → memória/arquivo local (dev/testes; sem rede).
//
// Nenhuma credencial aqui: só o que já está em DATABASE_URL (servidor).
import { Pool } from 'pg';

let pool: Pool | null = null;

/** Há Postgres configurado? (Produção só existe com DATABASE_URL.) */
export function isPgConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

export function getPgPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Neon/Vercel Postgres/Supabase exigem SSL. PGSSLMODE=disable só
      // para Postgres local sem SSL (mesma regra de db.ts).
      ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30000,
    });
    logBootProbe(pool); // uma vez por processo; nunca altera o fluxo
  }
  return pool;
}

/** Só para testes: injeta um Pool falso/medidor (vi.doMock('pg') também serve). */
export function __setPgPoolForTests(testPool: Pool | null): void {
  pool = testPool;
}

// ─────────────────────────────────────────────────────────────
// Sonda de boot (P0-login, 2026-09-28): registra UMA vez por processo, no
// log do runtime, o que a investigação do 500 de login precisou e não tinha:
// WHOAMI da conexão (current_user), search_path efetivo e qual env forneceu
// a string (SUPABASE_DB_URL via instrumentação, ou DATABASE_URL). Nunca
// loga URL, host ou credenciais — current_user é o NOME do papel (não é
// segredo; é o fato pedido no diagnóstico). Fire-and-forget: a sonda NUNCA
// afeta o fluxo (falha dela é só um log). docs/GODOUTOR-CLINICAL-OS-V1.md §6.2.
let bootProbed = false;
export function __resetBootProbeForTests(): void {
  bootProbed = false;
}

function logBootProbe(p: Pool): void {
  if (bootProbed || typeof (p as { query?: unknown }).query !== 'function') return;
  bootProbed = true;
  p.query('SELECT current_user AS usr, current_setting(\'search_path\') AS sp')
    .then((res) => {
      const row = (res.rows?.[0] ?? {}) as { usr?: string; sp?: string };
      console.info('[db/boot] conexão Postgres', {
        current_user: String(row.usr ?? '?'),
        search_path: String(row.sp ?? '?'),
        source: process.env.SUPABASE_DB_URL ? 'SUPABASE_DB_URL (instrumentação)' : 'DATABASE_URL',
        ssl: process.env.PGSSLMODE === 'disable' ? 'off' : 'on',
      });
    })
    .catch((err: unknown) => {
      const e = err as { code?: string; name?: string; message?: string };
      // A sonda falhou — o acesso real falhará com o MESMO erro; logar o
      // código é o ponto da sonda (42P01/42501/ECONNREFUSED/ETIMEDOUT…).
      console.error('[db/boot] sonda de diagnóstico falhou', {
        code: e?.code, name: e?.name, message: String(e?.message ?? '').slice(0, 200),
      });
    });
}

