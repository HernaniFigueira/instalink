// Pool único de conexões do modo relacional (pg).
// Um singleton por instância serverless — o mesmo padrão já usado pelo
// motor de documento. Nenhuma rota importa o `pg` direto.
import { Pool, type PoolClient } from 'pg';
import { poolConfig, relationalDatabaseUrl } from './config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const url = relationalDatabaseUrl();
    if (!url) throw new Error('Modo relacional sem SUPABASE_DB_URL.');
    pool = new Pool(poolConfig(url));
  }
  return pool;
}

/** Cliente transacional (BEGIN/COMMIT sob nosso controle). */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* conexão já perdida */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}
