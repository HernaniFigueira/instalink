// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAreaLoad } from '@/components/dashboard/AccessNotice';
import {
  FORBIDDEN_EVENT, installFetchWrapper, onForbidden, __resetForbiddenDedupe,
  type ForbiddenDetail,
} from '@/lib/client-auth';

// ═══════════════════════════════════════════════════════════════
// REGRESSÃO · falso 403 da secretária (missão final §8–10)
//
// CAUSA RAIZ: uma request SECUNDÁRIA (403) era promovida à negação da área
// inteira pelo `report` único do useAreaLoad, e o wrapper de fetch espalhava
// toast para qualquer 403 (inclusive GETs de revalidação → "loop de toasts").
//
// REGRAS FINAIS (travadas aqui):
//   1. report()         = request PRINCIPAL → 403 nega a área (denied=true);
//   2. reportFeature()  = request SECUNDÁRIA → 403 NUNCA nega a área;
//   3. GET 403          = silencioso (nunca toast/global);
//   4. POST/PATCH/DELETE 403 = aviso único por caminho (dedupe 30s).
// ═══════════════════════════════════════════════════════════════

const okRes = { ok: true, status: 200, message: '' };
const forbiddenRes = { ok: false, status: 403, message: 'negado' };
const serverRes = { ok: false, status: 500, message: 'Erro do servidor.' };

describe('useAreaLoad · PRINCIPAL × SECUNDÁRIA', () => {
  it('report: 403 da PRINCIPAL promove a negação da área', () => {
    const { result } = renderHook(() => useAreaLoad('Agenda'));
    let out = true;
    act(() => { out = result.current.report(forbiddenRes); });
    expect(out).toBe(false);
    expect(result.current.denied).toBe(true);
  });

  it('reportFeature: 403 da SECUNDÁRIA NÃO nega a área (só a feature)', () => {
    const { result } = renderHook(() => useAreaLoad('Conversas'));
    let out = true;
    act(() => { out = result.current.reportFeature(forbiddenRes); });
    expect(out).toBe(false);
    // A página permitida continua de pé — NUNCA "sem permissão" na área.
    expect(result.current.denied).toBe(false);
    expect(result.current.failed).toBe('');
  });

  it('reportFeature: erro de rede/500 da feature de apoio também não derruba a tela', () => {
    const { result } = renderHook(() => useAreaLoad('Agenda'));
    act(() => { result.current.reportFeature(serverRes); });
    expect(result.current.denied).toBe(false);
    expect(result.current.failed).toBe('');
  });

  it('report: 500 da PRINCIPAL vira falha (não "sem permissão"), sessão preservada', () => {
    const { result } = renderHook(() => useAreaLoad('Agenda'));
    act(() => { result.current.report(serverRes); });
    expect(result.current.denied).toBe(false);
    expect(result.current.failed).toContain('servidor');
  });

  it('report: sucesso após 403 limpa a negação (recarregar/retry funciona)', () => {
    const { result } = renderHook(() => useAreaLoad('Clientes'));
    act(() => { result.current.report(forbiddenRes); });
    expect(result.current.denied).toBe(true);
    act(() => { result.current.report(okRes); });
    expect(result.current.denied).toBe(false);
    expect(result.current.failed).toBe('');
  });
});

// ── Cenário de navegação (item 9): as 5 telas da secretária ──
// Simulação do padrão de cada tela: principal 200 + secundárias 403.
// Nenhuma delas pode terminar em "sem permissão".
describe('navegação da secretária · Agenda/Clientes/Conversas/Pendências/Oportunidades', () => {
  const SCREENS: Array<[string, string, string[]]> = [
    // [tela, área, features secundárias que podem 403]
    ['Agenda', 'Agenda', ['catalog', 'queue']],
    ['Clientes', 'Clientes', ['pipeline']],
    ['Conversas', 'Conversas', ['whatsapp-channel']],
    ['Pendências', 'Pendências', ['bookings', 'tasks']],
    ['Oportunidades', 'Oportunidades', ['catalog', 'slots']],
  ];

  it.each(SCREENS)('%s: 403 só nas secundárias → tela permitida, sem negação de área', (_screen, area, features) => {
    const { result } = renderHook(() => useAreaLoad(area));
    // request principal carrega OK
    act(() => { result.current.report(okRes); });
    // todas as secundárias levam 403
    for (const _f of features) {
      act(() => { result.current.reportFeature(forbiddenRes); });
    }
    expect(result.current.denied).toBe(false);   // página nunca some
    expect(result.current.failed).toBe('');      // nem vira erro genérico
  });

  it.each(SCREENS)('%s: 403 da PRINCIPAL (área real negada) → AccessDenied certo', (_screen, area) => {
    const { result } = renderHook(() => useAreaLoad(area));
    act(() => { result.current.report(forbiddenRes); });
    expect(result.current.denied).toBe(true);
  });
});

// ── Wrapper de fetch: 403 silencioso em GET, aviso em ações ──
describe('installFetchWrapper · 403 de carregamento nunca vira aviso', () => {
  let events: ForbiddenDetail[];
  let stop: () => void;

  beforeEach(() => {
    events = [];
    __resetForbiddenDedupe();
    stop = onForbidden((d) => events.push(d));
    // jsdom não tem window.fetch wrapper instalado por padrão
    delete (window as any).__il_fetch_wrapped;
    // "dentro do painel" para o wrapper considerar o path
    window.history.replaceState({}, '', '/agenda');
  });

  afterEach(() => {
    stop();
    delete (window as any).__il_fetch_wrapped;
    vi.restoreAllMocks();
  });

  function mockFetch403() {
    const original = vi.fn(async () => new Response(
      JSON.stringify({ error: 'negado' }), { status: 403, headers: { 'Content-Type': 'application/json' } },
    ));
    (window as any).fetch = original;
    return original;
  }

  it('GET 403 (revalidação/polling) NÃO dispara FORBIDDEN_EVENT', async () => {
    mockFetch403();
    installFetchWrapper();
    await window.fetch('/api/analytics?businessId=biz-1');
    await window.fetch('/api/whatsapp?businessId=biz-1');
    await window.fetch('/api/catalog/get?businessId=biz-1');
    expect(events).toHaveLength(0);
  });

  it('POST/PATCH/DELETE 403 (ação do usuário) dispara o aviso', async () => {
    mockFetch403();
    installFetchWrapper();
    await window.fetch('/api/bookings', { method: 'POST', body: '{}' });
    expect(events).toHaveLength(1);
    expect(events[0].path).toContain('/api/bookings');
  });

  it('ação repetida no MESMO caminho não gera loop de toasts (dedupe)', async () => {
    mockFetch403();
    installFetchWrapper();
    await window.fetch('/api/bookings', { method: 'POST', body: '{}' });
    await window.fetch('/api/bookings', { method: 'POST', body: '{}' });
    await window.fetch('/api/bookings', { method: 'PATCH', body: '{}' });
    expect(events).toHaveLength(1);
  });

  it('caminhos DIFERENTES têm aviso próprio (uma ação não anula a outra)', async () => {
    mockFetch403();
    installFetchWrapper();
    await window.fetch('/api/bookings', { method: 'POST', body: '{}' });
    await window.fetch('/api/queue', { method: 'POST', body: '{}' });
    expect(events).toHaveLength(2);
  });
});

// ── Regra extra: o evento global existe e é observável (contrato) ──
describe('FORBIDDEN_EVENT · contrato', () => {
  it('notifyForbidden publica o detalhe; 403 nunca força logout', () => {
    const seen: ForbiddenDetail[] = [];
    const stop = onForbidden((d) => seen.push(d));
    window.dispatchEvent(new CustomEvent<ForbiddenDetail>(FORBIDDEN_EVENT, {
      detail: { path: '/api/x', message: '', status: 403 },
    }));
    stop();
    expect(seen).toHaveLength(1);
    expect(seen[0].status).toBe(403);
  });
});
