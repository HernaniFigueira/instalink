// ═══════════════════════════════════════════════════════════════
// P0-LOGIN — GARANTIA ESTRUTURAL REATIVA DO `instalink_doc`
// ═══════════════════════════════════════════════════════════════
// Contrato atual (substitui o DDL especulativo por instância, §i):
//   • estado estacionário (tabela existe): N leituras = N SELECTs, ZERO DDL —
//     é o que salva produção Supabase com papel de menor privilégio
//     (sem CREATE no schema: o antigo pgInit derrubava toda leitura com
//     42501 e o login virava 500 — sintoma "Não foi possível entrar");
//   • tabela genuinamente ausente (primeiro boot): 42P01 ⇒ DDL UMA vez ⇒
//     retry bem-sucedido; as leituras seguintes não emitem mais DDL;
//   • sem tabela E sem CREATE permitido: erro EXPLÍCITO apontando o
//     provisionamento — nunca 500 silencioso;
//   • fail-closed preservado: erro real propaga, não fica em cache.
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Pool falso programável: espelha as respostas reais do Postgres. */
function fakePool(behavior: (text: string, n: number) => unknown) {
  const sql: string[] = [];
  const pool = {
    query: vi.fn(async (text: string) => {
      const n = sql.push(text.replace(/\s+/g, ' ').trim().slice(0, 60));
      return behavior(text, n) ?? { rows: [] };
    }),
  };
  return {
    pool,
    sql,
    ddl: () => sql.filter((s) => s.startsWith('CREATE TABLE')).length,
  };
}

afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

async function loadDb(behavior: (text: string, n: number) => unknown) {
  const fake = fakePool(behavior);
  vi.doMock('pg', () => ({ Pool: function Pool() { return fake.pool; } as unknown as typeof import('pg').Pool }));
  vi.doMock('next/cache', () => ({ unstable_noStore: () => {}, revalidatePath: () => {} }));
  process.env.DATABASE_URL = 'postgres://medicao.invalida/db';
  const mod = await import('../db');
  mod.__resetPgInitForTests();
  return { mod, ...fake };
}

const pgErr = (code: string, message: string) => Object.assign(new Error(message), { code });

describe('P0-login — nenhuma DDL especulativa no caminho quente', () => {
  it('tabela existindo: 3 leituras emitem 3 SELECTs e ZERO DDL', async () => {
    const { mod, sql, ddl } = await loadDb((text) => {
      if (text.startsWith('SELECT data FROM instalink_doc')) return { rows: [] };
      return undefined;
    });
    await Promise.all([mod.readDB(), mod.readDB(), mod.readDB()]);
    expect(ddl()).toBe(0); // ← o bug antigo: 1 CREATE por instância fria
    expect(sql.filter((s) => s.startsWith('SELECT data FROM instalink_doc')).length).toBe(3);
  });

  it('10 requisições seguidas continuam sem emitir DDL', async () => {
    const { mod, ddl, sql } = await loadDb(() => undefined);
    for (let i = 0; i < 10; i++) await mod.readDB();
    expect(ddl()).toBe(0);
    expect(sql.filter((s) => s.startsWith('SELECT data FROM instalink_doc')).length).toBe(10);
  });
});

describe('P0-login — tabela ausente: garantia reativa + retry', () => {
  it('42P01 no SELECT ⇒ DDL uma única vez, retry lê a tabela, futuras leituras não criam', async () => {
    let created = false;
    const { mod, ddl } = await loadDb((text) => {
      if (text.startsWith('CREATE TABLE')) { created = true; return { rows: [] }; }
      if (text.startsWith('SELECT data FROM instalink_doc')) {
        if (!created) throw pgErr('42P01', 'relation "instalink_doc" does not exist');
        return { rows: [{ data: { users: [] } }] };
      }
      return undefined;
    });
    const db1 = await mod.readDB();
    expect(db1.users).toEqual([]);
    expect(ddl()).toBe(1);
    await mod.readDB();
    await mod.readDB();
    expect(ddl()).toBe(1); // garantia cacheada: nunca mais DDL
  });

  it('42P01 + sem CREATE no schema ⇒ erro EXPLÍCITO apontando provisionamento', async () => {
    const { mod } = await loadDb((text) => {
      if (text.startsWith('CREATE TABLE')) throw pgErr('42501', 'permission denied for schema godoutor_app');
      throw pgErr('42P01', 'relation "instalink_doc" does not exist');
    });
    await expect(mod.readDB()).rejects.toThrow(/não tem CREATE no schema/);
  });

  it('updateDB também é reativo: transação falha por 42P01, tabela criada, retry grava', async () => {
    let created = false;
    const behavior = (text: string): any => {
      if (text.startsWith('CREATE TABLE')) { created = true; return { rows: [] }; }
      if (text.includes('ON CONFLICT (id) DO NOTHING')) {
        if (!created) throw pgErr('42P01', 'relation "instalink_doc" does not exist');
        return { rows: [] };
      }
      if (text.includes('FOR UPDATE')) return { rows: [{ data: { users: [] } }] };
      return { rows: [] };
    };
    // updateDB usa client do pool (connect()); simulamos um client com o mesmo
    // comportamento do pool falso.
    const fake = fakePool(behavior);
    const client = { query: vi.fn(behavior), release: vi.fn() };
    (fake.pool as any).connect = vi.fn(async () => client);
    vi.doMock('pg', () => ({ Pool: function Pool() { return fake.pool; } as unknown as typeof import('pg').Pool }));
    vi.doMock('next/cache', () => ({ unstable_noStore: () => {}, revalidatePath: () => {} }));
    process.env.DATABASE_URL = 'postgres://retry.invalida/db';
    const mod = await import('../db');
    mod.__resetPgInitForTests();
    const out = await mod.updateDB((db) => { db.users.push({ id: 'u9' } as never); return db.users.length; });
    expect(out).toBe(1);
    expect(created).toBe(true); // só criou porque faltava estrutura
  });
});

describe('P0-login — fail-closed preservado', () => {
  it('falha de rede no SELECT propaga e não fica em cache (próxima tenta de novo)', async () => {
    let attempts = 0;
    const { mod } = await loadDb((text) => {
      if (text.startsWith('SELECT data FROM instalink_doc')) {
        attempts += 1;
        if (attempts === 1) throw new Error('rede caiu');
        return { rows: [] };
      }
      return undefined;
    });
    await expect(mod.readDB()).rejects.toThrow('rede caiu');
    await expect(mod.readDB()).resolves.toBeTruthy();
    expect(attempts).toBe(2);
  });

  it('erro 42501 DIRETO no SELECT (sem 42P01) NÃO dispara DDL — propaga', async () => {
    const { mod, ddl } = await loadDb((text) => {
      if (text.startsWith('SELECT data FROM instalink_doc')) throw pgErr('42501', 'permission denied for table instalink_doc');
      return undefined;
    });
    await expect(mod.readDB()).rejects.toThrow(/permission denied/);
    expect(ddl()).toBe(0);
  });
});
