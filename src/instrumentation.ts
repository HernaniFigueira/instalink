function sanitizePostgresUrl(raw: string): string {
  try {
    const url = new URL(raw);
    // node-postgres lets SSL options embedded in the connection string override
    // the explicit `ssl` object. Supabase pooler URLs can carry
    // `sslmode=require`, while pg.ts already sets rejectUnauthorized:false.
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return raw;
  }
}

export function preferredSupabaseDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  // A integração oficial da Supabase/Vercel injeta POSTGRES_URL em produção.
  // SUPABASE_DB_URL continua sendo o alias explícito usado em preview/QA.
  // DATABASE_URL fica apenas como fallback legado e é consumido por pg.ts.
  return env.SUPABASE_DB_URL || env.POSTGRES_URL || '';
}

export async function register() {
  // O GoDoutor migrou o banco operacional para Supabase, mas uma DATABASE_URL
  // antiga do Neon ainda pode coexistir na Vercel. Quando uma conexão Supabase
  // estiver disponível, ela é a autoridade e substitui o fallback legado antes
  // de qualquer acesso ao banco. Nenhum segredo é logado ou exposto.
  const supabaseUrl = preferredSupabaseDatabaseUrl();
  if (supabaseUrl) {
    process.env.DATABASE_URL = sanitizePostgresUrl(supabaseUrl);
  }
}
