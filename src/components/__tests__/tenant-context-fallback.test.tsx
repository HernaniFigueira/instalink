// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// P2 — ?b= DE OUTRO TENANT: CONTEXTO, NÃO PERMISSÃO
// ═══════════════════════════════════════════════════════════════
// Cenário comprovado no Work: Owner autenticado da clínica A abre
//
//     /dashboard?b=<BUSINESS_DA_BIOCLIN>
//
// O isolamento funcionava (nem BioClin abria, nem dado cross-tenant aparecia),
// MAS a área mostrava "Seu perfil não possui acesso a esta área" — mensagem
// ERRADA: o Owner TEM a permissão `dashboard`; o que não pertence à conta é o
// businessId pedido na URL.
//
// CAUSA (auditada): o DashboardShell resolvia a unidade legítima e canonicali-
// zava a URL, mas as TELAS de área leem `params.get('b')` por conta própria.
// Enquanto a URL não era canônica, a tela pedia dados da unidade alheia; a API
// respondia 403 (isolamento correto, preservado) e a tela traduzia esse 403 de
// TENANT como 403 de PERMISSÃO (`setDenied(true)` / `useAreaLoad.report`).
//
// Aqui a prova é em DOM, com o shell REAL e as páginas REAIS (/dashboard e
// /clientes), router stateful (replace/push mudam a URL e re-renderizam):
//
//   • nenhuma requisição para a unidade alheia sai do cliente;
//   • nenhuma mensagem de "sem acesso" aparece (nem transitória);
//   • a URL é canonicalizada para b=A;
//   • a área carrega normalmente com A.
//
// API cross-tenant continua 403: provado no teste de rota real em
// src/lib/__tests__/session-identity-isolation.test.ts (casos F e H).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { act, useSyncExternalStore } from 'react';

// ── Contas (dados sintéticos) ────────────────────────────────────────────
const BIZ_A = 'biz-andrioni';        // unidade legítima do Owner autenticado
const BIZ_X = 'biz-bioclin';         // OUTRO tenant (nunca acessível)

// ── next/navigation stateful: replace/push MUDAM a URL e re-renderizam ───
const nav = vi.hoisted(() => {
  const state = { pathname: '/dashboard', search: '' };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((f) => f());
  const apply = (url: string) => {
    const [path, qs = ''] = String(url).split('?');
    state.pathname = path;
    state.search = qs ? `?${qs}` : '';
    emit();
  };
  return {
    state, emit, apply,
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    replace: vi.fn((url: string) => apply(url)),
    push: vi.fn((url: string) => apply(url)),
    refresh: vi.fn(),
    reset() { state.pathname = '/dashboard'; state.search = ''; listeners.clear(); },
  };
});

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(useSyncExternalStore(nav.subscribe, () => nav.state.search, () => '')),
  usePathname: () => useSyncExternalStore(nav.subscribe, () => nav.state.pathname, () => '/dashboard'),
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: nav.refresh, back: vi.fn(), prefetch: vi.fn() }),
}));

// ── Sessão: UMA unidade acessível (a da conta autenticada) ───────────────
vi.mock('@/lib/session-me', () => ({
  loadMe: vi.fn(async () => ({
    ok: true,
    status: 200,
    data: {
      user: { id: 'user-owner', name: 'Owner Andrioni', email: 'owner@andrioni.invalid', role: 'owner' },
      isMaster: false,
      organizations: [],
      businesses: [{
        id: 'biz-andrioni', name: 'Clínica Andrioni', slug: 'andrioni',
        organizationId: '', modes: ['services', 'bookings'], features: {},
        published: true, role: 'OWNER', isOwner: true, readOnly: false,
        permissions: { dashboard: true, clientes: true, agenda: true, leads: true, config: true, financeiro: true },
      }],
    },
  })),
  resetSessionMeCache: vi.fn(),
}));

// ── APIs: 403 para tenant alheio (isolamento), ok para a própria unidade ──
const api = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async (url: string) => {
    api.calls.push(url);
    if (url.includes('biz-bioclin')) {
      return { ok: false, status: 403, data: null, message: '', denied: null, flow: 'stay' as const, networkError: false };
    }
    if (url.includes('/api/people360')) return { ok: true, status: 200, data: { people: [], total: 0, pages: 1 } };
    if (url.includes('/api/pipeline')) return { ok: true, status: 200, data: { pipeline: null } };
    if (url.includes('/api/tasks')) return { ok: true, status: 200, data: { summary: null, tasks: [] } };
    if (url.includes('/api/pets')) return { ok: true, status: 200, data: { vet: false, pets: [] } };
    return { ok: true, status: 200, data: {} };
  }),
  apiSend: vi.fn(async () => ({ ok: true, status: 200, data: {} })),
}));

// ── Overview + revalidação: o mesmo contrato do shell real ───────────────
const overview = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('@/lib/overview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/overview')>()),
  loadOverview: vi.fn(async (businessId: string) => {
    overview.calls.push(businessId);
    if (businessId === 'biz-bioclin') {
      return { ok: false, status: 403, data: null, message: '', denied: null, flow: 'stay' as const, networkError: false };
    }
    return { ok: true, status: 200, data: OVERVIEW_FIXTURE };
  }),
}));
const OVERVIEW_FIXTURE = {
  user: { name: 'Owner Andrioni' },
  business: { id: 'biz-andrioni', name: 'Clínica Andrioni' },
  totals: { leads: 0, uniqueVisitors: 0 },
  upcoming: [], checklist: [], pct: 100,
  recent: { orders: [], bookings: [], leads: [] },
  today: { total: 0, pending: 0, confirmed: 0, completed: 0, noShow: 0, cancelled: 0, needsClosure: 0 },
  yesterday: null, crm: { leadsNew: 0 }, pageStats: null, whatsapp: null,
  ordersPanel: null, productsPanel: null, intelligence: null,
  context: { modules: { bookings: true, services: true, orders: false, products: false } },
  showMoney: false, revenueDetail: null, results: null, links: { agenda: true, clientes: true },
  attention: [], pendingSetup: 0, needsClosure: [],
};
vi.mock('@/components/dashboard/use-revalidate', () => ({ useRevalidateOnFocus: vi.fn() }));
vi.mock('@/components/dashboard/NotificationsBell', () => ({
  useWorkspaceAlerts: () => null,
  NotificationsBell: () => null,
}));
vi.mock('@/components/dashboard/ConversationsDock', () => ({ ConversationsDock: () => null }));

import { DashboardShell } from '@/components/DashboardShell';
import DashboardPage from '@/app/(dashboard)/dashboard/page';
import ClientesPage from '@/app/(dashboard)/clientes/page';
import { usePathname } from 'next/navigation';
import { businessContextNeedsCanonicalization, resolveActiveBusinessId } from '@/lib/business-context';

/**
 * "Outlet": reproduz o que o App Router faz — a página renderizada é a da
 * rota atual. Sem isto, trocar a URL não trocaria a tela e a prova de
 * /clientes seria falsa.
 */
function Outlet() {
  const pathname = usePathname();
  return pathname === '/clientes' ? <ClientesPage /> : <DashboardPage />;
}

/** A URL pedindo um tenant alheio, como no cenário do Work. */
function openWithForeignBusiness(pathname: string) {
  nav.state.pathname = pathname;
  nav.state.search = `?b=${BIZ_X}`;
  nav.emit();
}

beforeEach(() => {
  nav.reset();
  api.calls.length = 0;
  overview.calls.length = 0;
  vi.clearAllMocks();
  // Comportamento real do router: replace/push MUDAM a URL e re-renderizam.
  nav.replace.mockImplementation((url: string) => nav.apply(url));
  nav.push.mockImplementation((url: string) => nav.apply(url));
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('P2 — contexto de tenant: descartar ?b= alheio, nunca virar "sem acesso"', () => {
  it('dashboard: ?b= de outro tenant nunca vira pedido, nem mensagem de permissão', async () => {
    nav.state.pathname = '/dashboard';
    nav.state.search = `?b=${BIZ_X}`;

    render(<DashboardShell><Outlet /></DashboardShell>);

    // A unidade legítima é A; a URL é canonicalizada; a área carrega com A.
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/dashboard?b=${BIZ_A}`));
    await waitFor(() => expect(overview.calls).toContain(BIZ_A));

    // 1) NENHUMA requisição para o tenant alheio saiu do cliente.
    expect(overview.calls).not.toContain(BIZ_X);
    expect(api.calls.filter((u) => u.includes(BIZ_X))).toEqual([]);
    // 2) A URL final usa b=A (canônica) e o miolo montou com A.
    expect(nav.state.pathname).toBe('/dashboard');
    expect(nav.state.search).toBe(`?b=${BIZ_A}`);
    // 3) A área permitida carregou (o miolo real renderizou).
    await waitFor(() => expect(screen.getAllByText(/Clínica Andrioni/).length).toBeGreaterThan(0));
    // 4) E nada de "perfil sem acesso" — nem transitório.
    expect(screen.queryByText(/não possui acesso/i)).toBeNull();
  });

  it('clientes: ?b= de outro tenant resolve A e a área abre normalmente', async () => {
    nav.state.pathname = '/dashboard';
    nav.state.search = `?b=${BIZ_A}`;
    render(<DashboardShell><Outlet /></DashboardShell>);
    await waitFor(() => expect(screen.getAllByText(/Clínica Andrioni/).length).toBeGreaterThan(0));

    // Mesmo navegador, agora abrindo /clientes com o ?b= alheio.
    api.calls.length = 0;
    act(() => { openWithForeignBusiness('/clientes'); });

    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(`/clientes?b=${BIZ_A}`));
    await waitFor(() => expect(api.calls.some((u) => u.includes(`businessId=${BIZ_A}`))).toBe(true));

    // 1) NUNCA o tenant alheio.
    expect(api.calls.filter((u) => u.includes(BIZ_X))).toEqual([]);
    // 2) URL final canônica com b=A.
    expect(nav.state.pathname).toBe('/clientes');
    expect(nav.state.search).toBe(`?b=${BIZ_A}`);
    // 3) Clientes abre normalmente (lista vazia é estado válido de uma conta
    //    sem clientes) — o que NÃO pode aparecer é a negação de área.
    await waitFor(() => expect(screen.getByText(/Nenhum cliente ainda/)).toBeTruthy());
    expect(screen.queryByText(/não possui acesso/i)).toBeNull();
  });

  it('guarda do estado transitório: URL ainda com o ?b= alheio mostra carregamento neutro, nunca negação', async () => {
    // Pior caso: o router NÃO consegue canonicalizar a URL (replace sem efeito).
    // O miolo continua sem montar — e nada do tenant alheio é pedido. Nenhuma
    // mensagem de permissão aparece: o estado transitório é esqueleto, não 403
    // de permissão disfarçado.
    nav.replace.mockImplementation(() => {});
    nav.state.pathname = '/dashboard';
    nav.state.search = `?b=${BIZ_X}`;

    render(<DashboardShell><Outlet /></DashboardShell>);

    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect(overview.calls).toEqual([]);
    expect(api.calls).toEqual([]);
    expect(screen.queryByText(/não possui acesso/i)).toBeNull();
    expect(screen.getByLabelText('Carregando painel')).toBeTruthy();
  });

  it('contrato puro: só o ?b= que difere da unidade resolvida precisa de canonicalização', () => {
    // Sem ?b=: nada a descartar (o shell resolve e escreve a URL).
    expect(businessContextNeedsCanonicalization('', BIZ_A)).toBe(false);
    expect(businessContextNeedsCanonicalization(null, BIZ_A)).toBe(false);
    // ?b= da própria unidade: já canônico, nem replace nem bloqueio.
    expect(businessContextNeedsCanonicalization(BIZ_A, BIZ_A)).toBe(false);
    // ?b= de outro tenant: precisa ser descartado/canonicalizado.
    expect(businessContextNeedsCanonicalization(BIZ_X, BIZ_A)).toBe(true);
    // O id alheio NUNCA é escolhido pela resolução da conta.
    expect(resolveActiveBusinessId(BIZ_X, [{ id: BIZ_A }], '')).toBe(BIZ_A);
    // Conta com 2 unidades e ?b= alheio: silêncio nenhum — seleção explícita.
    expect(resolveActiveBusinessId(BIZ_X, [{ id: BIZ_A }, { id: 'biz-b' }], '')).toBe('');
  });
});
