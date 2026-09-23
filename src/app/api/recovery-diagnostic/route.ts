import { NextResponse } from 'next/server';
import { Pool } from 'pg';

export const runtime = 'nodejs';

export async function GET() {
  const supabaseUrl = process.env.SUPABASE_DB_URL || '';
  const databaseUrl = process.env.DATABASE_URL || '';
  const result: Record<string, unknown> = {
    supabaseDbUrlConfigured: !!supabaseUrl,
    databaseUrlConfigured: !!databaseUrl,
    databaseUrlUsesSupabase: !!databaseUrl && /supabase|pooler/i.test(databaseUrl),
    bridgeMatched: !!supabaseUrl && databaseUrl === supabaseUrl,
  };

  if (!supabaseUrl) {
    return NextResponse.json({ ...result, db: { ok: false, reason: 'SUPABASE_DB_URL ausente' } }, { status: 503 });
  }

  const pool = new Pool({
    connectionString: supabaseUrl,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 1000,
  });

  try {
    const q = await pool.query(`
      select
        current_user as user_name,
        current_schema() as schema_name,
        to_regclass('instalink_doc')::text as instalink_doc
    `);
    return NextResponse.json({ ...result, db: { ok: true, ...q.rows[0] } });
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return NextResponse.json({
      ...result,
      db: {
        ok: false,
        code: e?.code || 'unknown',
        message: String(e?.message || 'Falha de conexão').slice(0, 180),
      },
    }, { status: 503 });
  } finally {
    await pool.end().catch(() => {});
  }
}
