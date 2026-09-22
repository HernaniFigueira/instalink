// Diagnóstico público MÍNIMO do preview (validação GoDoutor).
// NUNCA expõe a connection string nem segredos — só o formato mascarado da
// URL, o modo de persistência e códigos/msgs curtos de erro do Postgres
// (ex.: 28P01 senha inválida, 42P01 tabela ausente, ENOTFOUND/ECONNREFUSED).
import { NextResponse } from 'next/server';
import { persistenceMode, relationalDatabaseUrl } from '@/lib/relational/config';
import { getPool } from '@/lib/relational/pool';

export const dynamic = 'force-dynamic';

type PgErr = { code?: string; message?: string };

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const db = (u.pathname || '').replace(/^\//, '');
    const ssl = u.searchParams.has('sslmode') ? '?sslmode' : '';
    return `${u.protocol}//***@${u.hostname}:${u.port || '-'}/${db}${ssl}`;
  } catch {
    return 'malformed';
  }
}

function errTag(e: unknown, max = 140): string {
  const { code, message } = (e || {}) as PgErr;
  return `${code || 'ERR'}:${String(message || '').slice(0, max)}`;
}

export async function GET() {
  const mode = persistenceMode();
  const url = relationalDatabaseUrl();
  const out: Record<string, unknown> = {
    ok: true,
    persistence: mode,
    dbUrlConfigured: Boolean(url),
    dbUrlShape: url ? maskUrl(url) : null,
    // Permite à validação esperar EXATAMENTE o deployment deste commit.
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  };
  if (mode === 'relational') {
    try {
      await getPool().query('SELECT 1');
      out.dbConnect = 'ok';
    } catch (e) {
      out.dbConnect = `fail:${errTag(e, 200)}`;
      return NextResponse.json(out);
    }
    try {
      const r = await getPool().query<{ n: number }>('SELECT count(*)::int AS n FROM app.users');
      out.appUsers = `ok:${r.rows[0]?.n ?? '?'} registros`;
    } catch (e) {
      out.appUsers = `fail:${errTag(e)}`;
    }
    try {
      const r = await getPool().query<{ n: number }>('SELECT count(*)::int AS n FROM app.businesses');
      out.appBusinesses = `ok:${r.rows[0]?.n ?? '?'} registros`;
    } catch (e) {
      out.appBusinesses = `fail:${errTag(e)}`;
    }
  }
  return NextResponse.json(out);
}
