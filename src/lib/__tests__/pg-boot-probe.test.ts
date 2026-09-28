// ═══════════════════════════════════════════════════════════════
// P0-login · sonda de boot de lib/pg.ts
//
// A investigação do 500 de produção (2026-09-28) provou que o log do
// runtime precisa responder, SEM PREMISSAS, "quem somos nós no banco".
// A sonda é: (a) só leitura, (b) uma vez por processo, (c) fire-and-forget
// — falhar a sonda nunca pode derrubar um request. Este teste trava as
// três propriedades contra um Pool falso.
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it, vi, beforeEach } from 'vitest';

let queries: string[] = [];
let failNext = false;

vi.doMock('pg', () => ({
  Pool: class FakePool {
    async query(sql: string) {
      queries.push(sql);
      if (failNext) throw Object.assign(new Error('ECONNREFUSED boom'), { code: 'ECONNREFUSED' });
      return { rows: [{ usr: 'godoutor_app', sp: '"$user", public' }] };
    }
  },
}));

async function loadFresh() {
  vi.resetModules();
  queries = [];
  return import('../pg');
}

describe('pg.ts · sonda de boot', () => {
  beforeEach(() => {
    failNext = false;
  });

  it('emite SOMENTE um SELECT de diagnóstico, uma vez por pool (não por request)', async () => {
    const { getPgPool } = await loadFresh();
    getPgPool();
    getPgPool();
    getPgPool();
    await new Promise((r) => setTimeout(r, 0));
    const probes = queries.filter((q) => /current_user/i.test(q));
    expect(probes).toHaveLength(1);
    expect(queries.every((q) => /^\s*SELECT\b/i.test(q))).toBe(true);
  });

  it('sonda que falha NÃO propaga para o chamador (fire-and-forget) e loga o código', async () => {
    failNext = true;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { getPgPool } = await loadFresh();
    expect(() => getPgPool()).not.toThrow(); // o acesso real continua vivo
    await new Promise((r) => setTimeout(r, 10));
    expect(errSpy).toHaveBeenCalled();
    const logged = JSON.stringify(errSpy.mock.calls.find((c) => String(c[0]).includes('[db/boot]'))?.[1] ?? '');
    expect(logged).toContain('ECONNREFUSED');
    errSpy.mockRestore();
    infoSpy.mockRestore();
  });
});
