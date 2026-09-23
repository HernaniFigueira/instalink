function sanitizePostgresUrl(raw: string): string {
  try {
    const url = new URL(raw);
    // node-postgres lets SSL options embedded in the connection string override
    // the explicit `ssl` object. Supabase's pooler URL currently carries
    // `sslmode=require`, which caused SELF_SIGNED_CERT_IN_CHAIN in this legacy
    // engine even though db.ts sets rejectUnauthorized:false.
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return raw;
  }
}

export async function register() {
  // Recovery branch only: force the legacy single-document persistence engine
  // to use the Supabase Postgres connection already configured in Preview.
  // This intentionally overrides any stale Neon DATABASE_URL still present
  // in Vercel for this branch. No secrets are logged or exposed.
  if (process.env.SUPABASE_DB_URL) {
    process.env.DATABASE_URL = sanitizePostgresUrl(process.env.SUPABASE_DB_URL);
  }
}
