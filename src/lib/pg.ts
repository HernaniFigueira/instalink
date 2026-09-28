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
  }
  return pool;
}

/** Só para testes: injeta um Pool falso/medidor (vi.doMock('pg') também serve). */
export function __setPgPoolForTests(testPool: Pool | null): void {
  pool = testPool;
}
