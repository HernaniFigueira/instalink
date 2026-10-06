import { describe, expect, it } from 'vitest';
import { preferredSupabaseDatabaseUrl } from '../../instrumentation';
import { legacyDocRelation } from '../db';

describe('produção GoDoutor — roteamento do banco Supabase', () => {
  it('prefere SUPABASE_DB_URL sobre POSTGRES_URL e DATABASE_URL', () => {
    const env = {
      SUPABASE_DB_URL: 'postgresql://supabase-explicit',
      POSTGRES_URL: 'postgresql://supabase-integration',
      DATABASE_URL: 'postgresql://legacy-neon',
    } as NodeJS.ProcessEnv;

    expect(preferredSupabaseDatabaseUrl(env)).toBe('postgresql://supabase-explicit');
    expect(legacyDocRelation(env)).toBe('godoutor_app.instalink_doc');
  });

  it('usa POSTGRES_URL da integração Supabase quando o alias explícito não existe', () => {
    const env = {
      POSTGRES_URL: 'postgresql://supabase-integration',
      DATABASE_URL: 'postgresql://legacy-neon',
    } as NodeJS.ProcessEnv;

    expect(preferredSupabaseDatabaseUrl(env)).toBe('postgresql://supabase-integration');
    expect(legacyDocRelation(env)).toBe('godoutor_app.instalink_doc');
  });

  it('mantém DATABASE_URL como fallback legado quando não há Supabase configurado', () => {
    const env = {
      DATABASE_URL: 'postgresql://legacy-neon',
    } as NodeJS.ProcessEnv;

    expect(preferredSupabaseDatabaseUrl(env)).toBe('');
    expect(legacyDocRelation(env)).toBe('instalink_doc');
  });
});
