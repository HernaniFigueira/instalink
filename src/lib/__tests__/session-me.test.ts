// ═══════════════════════════════════════════════════════════════
// §i — /api/auth/me lido UMA vez por navegação
// ═══════════════════════════════════════════════════════════════
// Medição que originou o módulo (harness de rede, build de produção): três
// consumidores do shell (DashboardShell, useBusinessId, usePanelPermissions)
// buscavam /api/auth/me cada um por conta própria — o navegador recebia a
// MESMA resposta duas vezes por navegação em agenda, clientes, automações,
// tarefas, execuções, recursos e canais.
//
// Estes testes travam as garantias do loader compartilhado:
//   1. chamadas simultâneas dividem UMA requisição;
//   2. o TTL de 5s é a MESMA régua de revalidação que o shell já usava;
//   3. `fresh` (sinal explícito de "mudou agora") fura o cache;
//   4. 401 NUNCA é cacheado — sessão expirada volta a bater no servidor.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMe, meNeedsLogin, resetSessionMeCache, ME_TTL_MS } from '../session-me';

const PAYLOAD = { user: { id: 'u1', name: 'Demo' }, businesses: [{ id: 'b1' }] };

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

beforeEach(() => { resetSessionMeCache(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); resetSessionMeCache(); });

describe('loadMe — contexto da sessão compartilhado', () => {
  it('shell + unidade ativa + permissões = UMA requisição', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(String(url)); return jsonResponse(PAYLOAD); }));

    const [a, b, c] = await Promise.all([loadMe(), loadMe(), loadMe()]);
    expect(calls).toEqual(['/api/auth/me']);
    expect(a.data?.user?.id).toBe('u1');
    expect(b.data?.businesses?.[0].id).toBe('b1');
    expect(c.data).toEqual(a.data);
  });

  it(`dentro do TTL (${ME_TTL_MS}ms) a resposta é reaproveitada — sem segunda chamada`, async () => {
    const spy = vi.fn(async () => jsonResponse(PAYLOAD));
    vi.stubGlobal('fetch', spy);
    await loadMe();
    await loadMe(); // nav remonta, muda de rota: mesmo contexto
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('`fresh: true` fura o cache (toggle de módulo/equipe tem que aparecer)', async () => {
    const spy = vi.fn(async () => jsonResponse(PAYLOAD));
    vi.stubGlobal('fetch', spy);
    await loadMe();
    await loadMe();
    expect(spy).toHaveBeenCalledTimes(1);
    await loadMe({ fresh: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('401 não é cacheado e é reconhecido como fluxo de login', async () => {
    const spy = vi.fn(async () => jsonResponse({ error: 'sessão expirada' }, 401));
    vi.stubGlobal('fetch', spy);
    const first = await loadMe();
    expect(first.ok).toBe(false);
    expect(first.status).toBe(401);
    expect(meNeedsLogin(first.status)).toBe(true);
    await loadMe();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('403 e 500 mantêm a sessão (nunca mandam para o login)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'nope' }, 403)));
    const res = await loadMe();
    expect(res.ok).toBe(false);
    expect(meNeedsLogin(res.status)).toBe(false);

    resetSessionMeCache();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 500)));
    const err = await loadMe();
    expect(meNeedsLogin(err.status)).toBe(false);
  });

  it('falha de rede não quebra o shell nem entra no cache', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('offline');
      return jsonResponse(PAYLOAD);
    }));
    const first = await loadMe();
    expect(first.ok).toBe(false);
    expect(first.status).toBe(0);
    const second = await loadMe();
    expect(second.ok).toBe(true);
    expect(n).toBe(2);
  });

  it('corpo ilegível não vira cache de sessão válida', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as unknown as Response)));
    const res = await loadMe();
    expect(res.ok).toBe(false);
    expect(res.data).toBeNull();
  });

  it('a requisição é credenciada (same-origin) — cookie de sessão sempre vai', async () => {
    const spy = vi.fn(async () => jsonResponse(PAYLOAD));
    vi.stubGlobal('fetch', spy);
    await loadMe();
    expect(spy).toHaveBeenCalledWith('/api/auth/me', { credentials: 'same-origin' });
  });
});

describe('consumidores usam o loader compartilhado (regressão estática)', () => {
  it('shell, unidade ativa e permissões não fazem fetch próprio de /api/auth/me', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    for (const rel of [
      'src/components/DashboardShell.tsx',
      'src/components/dashboard/useBusinessId.ts',
      'src/components/dashboard/usePanelPermissions.ts',
    ]) {
      const src = readFileSync(resolve(rel), 'utf8');
      expect(src, rel).toMatch(/loadMe\(/);
      expect(src, rel).not.toMatch(/fetch\('\/api\/auth\/me'\)/);
    }
  });
});
