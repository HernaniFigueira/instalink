export async function register() {
  // Recovery branch only: force the legacy single-document persistence engine
  // to use the Supabase Postgres connection already configured in Preview.
  // This intentionally overrides any stale Neon DATABASE_URL still present
  // in Vercel for this branch. No secrets are logged or exposed.
  if (process.env.SUPABASE_DB_URL) {
    process.env.DATABASE_URL = process.env.SUPABASE_DB_URL;
  }
}
