// ═══════════════════════════════════════════════════════════════
// §i — COALESCÊNCIA EM VOO do /api/overview
// ═══════════════════════════════════════════════════════════════
// Medição que originou o módulo: no harness de rede contra o build de
// produção, cada navegação fazia DUAS chamadas idênticas a /api/overview em
// paralelo. O endpoint agrega agenda + financeiro + funil: repetir a chamada
// é repetir o trabalho de banco. Estes testes travam as duas garantias:
//   1. chamadas SIMULTÂNEAS e iguais dividem UMA requisição;
//   2. NADA é cacheado depois que a resposta chega (nada de número velho).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadOverview, overviewInflightCount, overviewUrl } from '../overview';

function okResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('loadOverview — uma requisição para N consumidores', () => {
  it('duas chamadas simultâneas = UMA requisição, mesma resposta', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url));
      return okResponse({ pct: 71, checklist: [] });
    }));

    const [a, b] = await Promise.all([
      loadOverview('biz-1', 7),
      loadOverview('biz-1', 7),
      // terceiro consumidor (sino) entra junto: continua sendo UMA requisição
      loadOverview('biz-1', 7),
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(overviewUrl('biz-1', 7));
    expect(a.ok && b.ok).toBe(true);
    expect(a.data?.pct).toBe(71);
    expect(b.data?.pct).toBe(71);
    expect(overviewInflightCount()).toBe(0);
  });

  it('NÃO guarda resposta: a próxima navegação busca de novo (nunca dado velho)', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => okResponse({ pct: ++n })));

    expect((await loadOverview('biz-1', 7)).data?.pct).toBe(1);
    expect((await loadOverview('biz-1', 7)).data?.pct).toBe(2);
    expect((fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(2);
  });

  it('períodos diferentes são requisições diferentes', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(String(url)); return okResponse({}); }));

    await Promise.all([loadOverview('biz-1', 7), loadOverview('biz-1', 30)]);
    expect(urls.sort()).toEqual([overviewUrl('biz-1', 7), overviewUrl('biz-1', 30)].sort());
  });

  it('unidades diferentes nunca compartilham resposta (isolamento multi-tenant)', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(String(url)); return okResponse({}); }));

    await Promise.all([loadOverview('biz-1', 7), loadOverview('biz-2', 7)]);
    expect(urls).toHaveLength(2);
    expect(new Set(urls).size).toBe(2);
  });

  it('sem unidade ativa não há chamada nem erro cru', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const res = await loadOverview('', 7);
    expect(spy).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
  });

  it('404/erro do servidor não fica preso no mapa de em-voo', async () => {
    const spy = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: 'sem permissão' }) } as unknown as Response));
    vi.stubGlobal('fetch', spy);
    const res = await loadOverview('biz-1', 7);
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(overviewInflightCount()).toBe(0);
  });
});
