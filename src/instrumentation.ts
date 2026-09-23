export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const supabaseUrl = process.env.SUPABASE_DB_URL || process.env.GODOUTOR_SUPABASE_DB_URL;
  if (supabaseUrl) process.env.DATABASE_URL = supabaseUrl;
}
