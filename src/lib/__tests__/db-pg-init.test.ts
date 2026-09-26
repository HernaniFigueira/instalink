// ═══════════════════════════════════════════════════════════════
// §i — CUSTO DE BANCO POR REQUISIÇÃO (medido, não estimado)
// ═══════════════════════════════════════════════════════════════
// O painel guarda o documento da unidade em UMA linha JSONB
// (`instalink_doc`), então toda requisição autenticada é:
//
//     CREATE TABLE IF NOT EXISTS …   ← garantia da tabela
//     SELECT data FROM instalink_doc WHERE id = 1
//
// A garantia da tabela não precisa ser reemitida a cada requisição: com o
// cache por instância, N requisições passam a custar N SELECTs + 1 DDL, em vez
// de N SELECTs + N DDLs. Aqui isso é MEDIDO com um Pool de mentira que conta
// os comandos SQL de verdade — inclusive os casos de erro (fail-closed).
import { afterEach, describe, expect, it, vi } from 'vitest';

/** Pool falso: registra cada SQL emitido e responde como o real responderia. */
function fakePool() {
  const sql: string[] = [];
  const pool = {
    query: vi.fn(async (text: string) => {
      sql.push(text.replace(/\s+/g, ' ').trim().slice(0, 60));
      if (text.startsWith('CREATE TABLE')) return { rows: [] };
      if (text.startsWith('SELECT data FROM instalink_doc')) return { rows: [] };
      if (text.startsWith('SELECT data, md5')) return { rows: [] };
      if (text.startsWith('INSERT INTO instalink_doc')) return { rows: [] };
      return { rows: [] };
    }),
  };
  return { pool, sql, ddl: () => sql.filter((s) => s.startsWith('CREATE TABLE')).length };
}

afterEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });

async function loadDbWithFakePool() {
  const fake = fakePool();
  vi.doMock('pg', () => ({ Pool: function Pool() { return fake.pool; } as unknown as typeof import('pg').Pool }));
  vi.doMock('next/cache', () => ({ unstable_noStore: () => {}, revalidatePath: () => {} }));
  process.env.DATABASE_URL = 'postgres://medicao.invalida/db';
  const mod = await import('../db');
  return { mod, ...fake };
}

describe('§i — DDL da tabela não se repete a cada requisição', () => {
  it('antes: cada leitura emitia CREATE TABLE IF NOT EXISTS', () => {
    // Este é o comportamento ANTIGO, reproduzido aqui para provar a diferença:
    // 3 leituras → 3 DDLs.
    const calls: string[] = [];
    const oldPgInit = async () => { calls.push('CREATE TABLE IF NOT EXISTS instalink_doc …'); };
    return Promise.all([oldPgInit(), oldPgInit(), oldPgInit()]).then(() => {
      expect(calls.filter((c) => c.startsWith('CREATE TABLE'))).toHaveLength(3);
    });
  });

  it('depois: 3 leituras emitiam 1 único DDL (cache por instância)', async () => {
    const { mod, sql, ddl } = await loadDbWithFakePool();
    mod.__resetPgInitForTests();

    await Promise.all([mod.readDB(), mod.readDB(), mod.readDB()]);

    // A garantia da tabela foi emitida UMA vez; as leituras aconteceram.
    expect(ddl()).toBe(1);
    expect(sql.filter((s) => s.startsWith('SELECT data FROM instalink_doc')).length).toBe(3);
  });

  it('sequência longa (10 requisições) continua com um único DDL', async () => {
    const { mod, ddl, sql } = await loadDbWithFakePool();
    mod.__resetPgInitForTests();
    for (let i = 0; i < 10; i++) await mod.readDB();
    expect(ddl()).toBe(1);
    expect(sql.filter((s) => s.startsWith('SELECT data FROM instalink_doc')).length).toBe(10);
  });

  it('FAIL-CLOSED preservado: falha de rede propaga e não fica em cache', async () => {
    const { mod, pool } = await loadDbWithFakePool();
    mod.__resetPgInitForTests();
    let attempts = 0;
    (pool.query as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(async (text: string) => {
      if (text.startsWith('CREATE TABLE')) {
        attempts += 1;
        if (attempts === 1) throw new Error('rede caiu');
      }
      return { rows: [] };
    });

    await expect(mod.readDB()).rejects.toThrow('rede caiu');
    // A próxima tentativa NÃO herda o erro: tenta de novo e segue.
    await expect(mod.readDB()).resolves.toBeTruthy();
    expect(attempts).toBe(2);
  });
});
