// ═══════════════════════════════════════════════════════════════
// GoDoutor — persistência RELACIONAL (Supabase Postgres)
// ═══════════════════════════════════════════════════════════════
// MODO: o motor de documento (lib/db.ts) continua sendo o padrão. O modo
// relacional é OPT-IN explícito — é a CHAVE DE CORTE do handoff:
//
//   GODOUTOR_PERSISTENCE=relational  +  SUPABASE_DB_URL=postgres://...
//
// Sem as duas variáveis, NADA muda (comportamento de produção atual, byte a
// byte). Nunca inventamos URL: a connection string vem do projeto Supabase
// (Panel → Connect → Session/Transaction pooler) e a senha vive só no
// ambiente do servidor.
//
// IMPORTANTE (corte controlado): ativar o modo relacional exige o runbook
// completo de docs/GODOUTOR-SUPABASE-IMPLEMENTACAO.md (importação reconciliada
// + validação + janela de corte). Não é um toggle de teste em produção.

export type PersistenceMode = 'document' | 'relational';

/** Connection string do Supabase (pooler). Só existe no servidor. */
export function relationalDatabaseUrl(): string {
  return String(process.env.SUPABASE_DB_URL || process.env.GODOUTOR_SUPABASE_DB_URL || '');
}

/** Modo efetivo desta instância (padrão: document — igual a hoje). */
export function persistenceMode(): PersistenceMode {
  if (String(process.env.GODOUTOR_PERSISTENCE || '').trim().toLowerCase() !== 'relational') {
    return 'document';
  }
  return relationalDatabaseUrl() ? 'relational' : 'document';
}

/** Atalho usado por rotas/guards: modo relacional LIGADO e configurado. */
export function relationalActive(): boolean {
  return persistenceMode() === 'relational';
}

/** Credenciais do Supabase Storage (só servidor; nunca no frontend). */
export function storageConfig(): {
  url: string;            // ex.: https://sefwhobqafkretljjlqx.supabase.co
  serviceKey: string;     // service_role — SÓ servidor
  publicBucket: string;
  privateBucket: string;
} | null {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!url || !serviceKey) return null;
  return {
    url,
    serviceKey,
    publicBucket: String(process.env.SUPABASE_BUCKET_PUBLIC || 'clinic-media'),
    privateBucket: String(process.env.SUPABASE_BUCKET_PRIVATE || 'patient-files'),
  };
}

/** Config do pool por ambiente (Vercel serverless: pool pequeno e honesto). */
/** Remove sslmode/ssl da query string — o objeto ssl do pool manda, sempre. */
function stripSslParams(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    u.searchParams.delete('sslmode');
    u.searchParams.delete('ssl');
    return u.toString();
  } catch {
    return connectionString;
  }
}

export function poolConfig(connectionString: string): {
  connectionString: string; ssl: boolean | { rejectUnauthorized: boolean };
  max: number; connectionTimeoutMillis: number; idleTimeoutMillis: number;
} {
  const local = /localhost|127\.0\.0\.1/.test(connectionString) || process.env.PGSSLMODE === 'disable';
  return {
    // sslmode na URL sobrepõe o objeto ssl e faz o pg validar a cadeia
    // autoassinada do pooler (SELF_SIGNED_CERT_IN_CHAIN). Criptografia SEMPRE,
    // validação de cadeia só quando o Supabase publicar CA confiável.
    connectionString: stripSslParams(connectionString),
    // Supabase/Neon exigem SSL; Postgres local de teste não.
    ssl: local ? false : { rejectUnauthorized: false },
    max: Number(process.env.PGPOOL_MAX || 5),
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 30000,
  };
}
