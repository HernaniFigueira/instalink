// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// P0 — REGRESSÃO React #310: "Rendered more hooks than during the previous render"
// ═══════════════════════════════════════════════════════════════
// O bug: usePanelPermissions() estava DEPOIS dos early returns do
// DashboardPage (`if (denied)`, `if (failed)`, `if (!data) → skeleton`).
//   1º render: data=null → retorna ANTES do hook;
//   2º render: data carregada → hook passa a ser chamado;
//   ⇒ quantidade de hooks muda entre renders ⇒ React #310 e painel branco
//   logo após o login.
//
// Este teste reproduz EXATAMENTE a sequência: monta com data=null
// (skeleton), resolve o overview (data carrega) e re-renderiza — inclusive
// com as permissões chegando depois (permsReady false→true). Se qualquer
// hook voltar a ficar depois de um early return, o React lança #310 aqui e
// o teste falha.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, act } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('b=biz-hooks'),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/components/dashboard/WorkspaceContext', () => ({
  useWorkspace: () => ({ role: 'OWNER', agendaScope: 'all' }),
}));
vi.mock('@/lib/overview', () => ({ loadOverview: vi.fn() }));
vi.mock('@/lib/session-me', () => ({ loadMe: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock('@/components/dashboard/use-revalidate', () => ({ useRevalidateOnFocus: vi.fn() }));

import DashboardPage from '@/app/(dashboard)/dashboard/page';
import { loadOverview } from '@/lib/overview';
import { loadMe } from '@/lib/session-me';
import { apiGet } from '@/lib/api-client';

const OVERVIEW = {
  user: { name: 'Zulmira Teste' }, // único: não aparece em mais nenhum texto
  business: { name: 'Clínica Demo', id: 'biz-hooks' },
  totals: { leads: 0, uniqueVisitors: 0 },
  upcoming: [],
  checklist: [],
  pct: 100,
  recent: { orders: [], bookings: [], leads: [] },
  today: { total: 0, pending: 0, confirmed: 0, completed: 0, noShow: 0, cancelled: 0, needsClosure: 0 },
  yesterday: null,
  crm: { leadsNew: 0 },
  pageStats: null,
  whatsapp: null,
  ordersPanel: null,
  productsPanel: null,
  intelligence: null,
  context: { modules: { bookings: true, services: true, orders: false, products: false } },
  showMoney: false,
  revenueDetail: null,
  results: null,
  links: { agenda: true, clientes: true },
  attention: [],
  pendingSetup: 0,
  needsClosure: [],
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('P0 — DashboardPage: mesmos hooks em TODOS os renders (loading → dados)', () => {
  it('monta no skeleton, recebe os dados e NÃO muda a quantidade/ordem de hooks', async () => {
    // A permissão chega DEPOIS (async): primeiro render é permsReady=false.
    vi.mocked(loadMe).mockResolvedValue({
      ok: true,
      data: { businesses: [{ id: 'biz-hooks', role: 'OWNER', permissions: { config: true } }] },
    } as any);
    vi.mocked(apiGet).mockResolvedValue({
      ok: false, status: 403, data: null, message: '', denied: null, flow: 'stay' as const, networkError: false,
    });

    let resolveOverview!: (value: any) => void;
    vi.mocked(loadOverview).mockImplementation(() => new Promise((res) => { resolveOverview = res; }));

    // ── FASE 1: data=null → skeleton (aqui o hook JÁ precisa ter rodado) ──
    let view!: { rerender: (ui: ReactNode) => void };
    await act(async () => {
      view = render(<DashboardPage />);
    });
    // Sem dados ainda: nada do conteúdo renderizado, nenhum erro lançado.
    expect(screen.queryByText(/Zulmira/)).toBeNull();

    // ── FASE 2: overview resolve → re-render COM dados ──
    // Com o hook depois do `if (!data)`, é AQUI que o React lançaria
    // "Rendered more hooks than during the previous render" (#310).
    await act(async () => {
      resolveOverview({ ok: true, data: OVERVIEW });
    });
    expect(await screen.findByText(/Zulmira/)).toBeTruthy();

    // ── FASE 3: mais um re-render (permissões já resolvidas + mesmo estado) ──
    await act(async () => {
      view.rerender(<DashboardPage />);
    });
    expect(screen.getByText(/Zulmira/)).toBeTruthy();
  });

  it('o hook de permissões está ANTES do primeiro early return (contrato de fonte)', async () => {
    // Cinto e suspensórios: além do teste comportamental acima, o contrato
    // de fonte impede a reintrodução do padrão por refactor futuro.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'src', 'app', '(dashboard)', 'dashboard', 'page.tsx'),
      'utf8',
    );
    const hookPos = src.indexOf('usePanelPermissions()');
    const deniedPos = src.indexOf('if (denied)');
    const failedPos = src.indexOf('if (failed)');
    const noDataPos = src.indexOf('if (!data) return');
    expect(hookPos).toBeGreaterThan(0);
    for (const ret of [deniedPos, failedPos, noDataPos]) {
      if (ret > 0) expect(hookPos, 'usePanelPermissions deve vir antes de qualquer early return').toBeLessThan(ret);
    }
  });
});
