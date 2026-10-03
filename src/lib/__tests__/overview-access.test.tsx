// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// VISÃO GERAL: quem não tem `dashboard` NÃO chama /api/overview
// ═══════════════════════════════════════════════════════════════
// A Recepção (`SECRETARIA`) não tem Visão geral. Antes, o shell (mini-card da
// sidebar, sino) disparava /api/overview e o servidor respondia 403 — leitura
// de banco inútil e Network/console poluídos. A decisão agora é tomada ANTES
// da requisição, com as permissões/navegação que o sistema já calcula.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { permissionsFor } from '../permissions';
import { panelNavigation } from '../panel';
import { canLoadOverview, navAllowsOverview } from '../overview';
import { WorkspaceNavigation } from '@/components/dashboard/WorkspaceNavigation';
import { NotificationsBell, useWorkspaceAlerts } from '@/components/dashboard/NotificationsBell';
import { HelpCenter } from '@/components/dashboard/HelpCenter';

const mocks = vi.hoisted(() => ({ biz: 'biz-1', perms: { permissions: {} as Record<string, boolean>, role: '', ready: true } }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`b=${mocks.biz}`),
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/agenda',
}));
vi.mock('@/components/dashboard/usePanelPermissions', () => ({ usePanelPermissions: () => mocks.perms }));

const ROLES = ['OWNER', 'ADMIN', 'PROFISSIONAL', 'SECRETARIA'] as const;
const navFor = (role: (typeof ROLES)[number]) => panelNavigation({
  permissions: permissionsFor(role), modes: ['services', 'bookings'], features: {},
});
const unit = { id: 'biz-1', name: 'Clínica', slug: 'clinica' };

let overviewCalls: string[] = [];
beforeEach(() => {
  overviewCalls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/overview')) overviewCalls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ pct: 40, checklist: [{ done: false, label: 'Configurar', href: '/configuracoes' }], attention: [] }) } as unknown as Response;
  }));
  // jsdom não implementa <dialog> modal (Drawer da Central de ajuda).
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }), configurable: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('regra única (pura)', () => {
  it('só com permissões prontas E dashboard=true', () => {
    expect(canLoadOverview(true, { dashboard: true })).toBe(true);
    expect(canLoadOverview(false, { dashboard: true })).toBe(false); // ainda carregando
    expect(canLoadOverview(true, { dashboard: false })).toBe(false);
    expect(canLoadOverview(true, {})).toBe(false);
    expect(canLoadOverview(true, undefined)).toBe(false);
  });
  it('mesma decisão pela navegação já calculada, por papel real', () => {
    expect(navAllowsOverview(navFor('SECRETARIA'))).toBe(false);
    for (const role of ['OWNER', 'ADMIN', 'PROFISSIONAL'] as const) expect(navAllowsOverview(navFor(role)), role).toBe(true);
    // O preset da Recepção continua SEM Visão geral (nada foi concedido).
    expect(permissionsFor('SECRETARIA').dashboard).toBeFalsy();
    for (const role of ROLES) expect(canLoadOverview(true, permissionsFor(role))).toBe(navAllowsOverview(navFor(role)));
  });
});

describe('WorkspaceNavigation — mini-card de setup', () => {
  const mount = (role: (typeof ROLES)[number]) => render(
    <WorkspaceNavigation nav={navFor(role)} activePath="/agenda" unit={unit} collapsed={false} onCollapse={() => {}} />,
  );
  it('Recepção: zero chamadas a /api/overview e nenhum card de setup', async () => {
    const { container } = mount('SECRETARIA');
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    window.dispatchEvent(new Event('godoutor:overview-refresh'));
    window.dispatchEvent(new Event('godoutor:business-refresh'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(overviewCalls).toEqual([]);
    expect(container.textContent).not.toContain('Continuar configuração');
    expect(container.querySelector('[data-nav-item="/agenda"]')).toBeTruthy(); // navegação segue íntegra
  });
  it.each(['OWNER', 'ADMIN', 'PROFISSIONAL'] as const)('%s: Overview continua carregando e o card aparece', async (role) => {
    const { container } = mount(role);
    await waitFor(() => expect(overviewCalls.length).toBeGreaterThan(0));
    await waitFor(() => expect(container.textContent).toContain('Continuar configuração'));
    expect(overviewCalls[0]).toContain('/api/overview?businessId=biz-1');
  });
});

describe('Sino (useWorkspaceAlerts)', () => {
  it('denied/pending: zero chamadas; allowed: lê o Overview', async () => {
    const denied = renderHook(() => useWorkspaceAlerts('biz-1', '?b=biz-1', 'denied'));
    const pending = renderHook(() => useWorkspaceAlerts('biz-1', '?b=biz-1', 'pending'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(overviewCalls).toEqual([]);
    // Sem acesso NÃO é falha: `restricted` (e `unavailable` só para erro real).
    expect(denied.result.current.status).toBe('restricted');
    expect(pending.result.current.status).toBe('loading');
    const allowed = renderHook(() => useWorkspaceAlerts('biz-1', '?b=biz-1', 'allowed'));
    await waitFor(() => expect(allowed.result.current.status).toBe('ready'));
    expect(overviewCalls).toHaveLength(1);
  });
});

describe('Sino — acesso restrito ≠ erro', () => {
  const RESTRICTED = 'Este resumo de notificações não faz parte do seu acesso. Suas pendências continuam disponíveis na área Pendências.';
  const FAILURE = 'Não foi possível carregar as pendências agora.';
  function Bell({ access }: { access: 'allowed' | 'pending' | 'denied' }) {
    const alerts = useWorkspaceAlerts('biz-bell', '?b=biz-bell', access);
    return <NotificationsBell alerts={alerts} />;
  }
  const openBell = () => fireEvent.click(document.querySelector('button.ws-topbar__icon-button') as HTMLElement);

  it('Maria (sem dashboard): painel neutro, sem mensagem de falha e ZERO /api/overview', async () => {
    render(<Bell access="denied" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    openBell();
    expect(await screen.findByText(RESTRICTED)).toBeTruthy();
    expect(document.body.textContent).not.toContain(FAILURE);
    expect(document.querySelector('button.ws-topbar__icon-button')?.getAttribute('aria-label')).toBe('Notificações: resumo fora do seu acesso');
    expect(document.querySelector('.ws-bell__badge')).toBeNull();
    expect(overviewCalls).toEqual([]);
  });

  it('erro real de rede no Overview continua `unavailable` (mensagem de falha)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/overview')) overviewCalls.push(String(url));
      throw new Error('network down');
    }));
    render(<Bell access="allowed" />);
    await waitFor(() => expect(overviewCalls.length).toBeGreaterThan(0));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    openBell();
    expect(await screen.findByText(new RegExp(FAILURE))).toBeTruthy();
    expect(document.body.textContent).not.toContain('não faz parte do seu acesso');
  });

  it('erro 5xx do servidor também é `unavailable`', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/overview')) overviewCalls.push(String(url));
      return { ok: false, status: 500, json: async () => ({ error: 'boom' }) } as unknown as Response;
    }));
    const hook = renderHook(() => useWorkspaceAlerts('biz-5xx', '?b=biz-5xx', 'allowed'));
    await waitFor(() => expect(hook.result.current.status).toBe('unavailable'));
  });

  it('pending → loading sem chamada; depois allowed lê e vira ready (sem restricted no meio)', async () => {
    const seen: string[] = [];
    const { rerender } = renderHook(({ a }: { a: 'allowed' | 'pending' | 'denied' }) => {
      const r = useWorkspaceAlerts('biz-seq', '?b=biz-seq', a);
      seen.push(r.status);
      return r;
    }, { initialProps: { a: 'pending' as 'allowed' | 'pending' | 'denied' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(overviewCalls).toEqual([]);
    rerender({ a: 'allowed' });
    await waitFor(() => expect(seen.at(-1)).toBe('ready'));
    expect(seen).not.toContain('restricted');
    expect(overviewCalls).toHaveLength(1);
  });
});

describe('Central de ajuda', () => {
  const help = (role: (typeof ROLES)[number]) => render(
    <HelpCenter open onClose={() => {}} query="?b=biz-1" nav={navFor(role)} businessId="biz-1" />,
  );
  it('Recepção: aberta, sem chamar o Overview', async () => {
    help('SECRETARIA');
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(overviewCalls).toEqual([]);
  });
  it('Administrador: aberta, lê o checklist', async () => {
    help('ADMIN');
    await waitFor(() => expect(overviewCalls).toHaveLength(1));
  });
});

describe('Visão geral (página)', () => {
  // A página só precisa CONTAR as chamadas: o Overview fica pendente (o payload
  // completo da tela não é o assunto aqui).
  let seq = 0;
  beforeEach(() => {
    // Unidade nova por teste: o loader divide chamadas EM VOO e o Overview
    // pendente daqui nunca resolve.
    mocks.biz = `biz-page-${++seq}`;
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (String(url).includes('/api/overview')) { overviewCalls.push(String(url)); return new Promise(() => {}); }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ tasks: [], summary: { open: 0, overdue: 0, dueToday: 0, mine: 0 } }) } as unknown as Response);
    }));
  });
  async function mountPage() {
    const { default: DashboardPage } = await import('@/app/(dashboard)/dashboard/page');
    return render(<DashboardPage />);
  }
  it('Recepção (dashboard=false): nenhuma chamada e o aviso amigável aparece', async () => {
    mocks.perms = { permissions: permissionsFor('SECRETARIA') as any, role: 'SECRETARIA', ready: true };
    const { container } = await mountPage();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(overviewCalls).toEqual([]);
    expect(container.textContent).not.toContain('undefined');
  });
  it('permissões ainda carregando: nenhuma chamada especulativa', async () => {
    mocks.perms = { permissions: {}, role: '', ready: false };
    await mountPage();
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(overviewCalls).toEqual([]);
  });
  it.each(['OWNER', 'ADMIN', 'PROFISSIONAL'] as const)('%s: carrega o Overview', async (role) => {
    mocks.perms = { permissions: permissionsFor(role) as any, role, ready: true };
    await mountPage();
    await waitFor(() => expect(overviewCalls.length).toBeGreaterThan(0));
  });
  it('mudança ready:false → true dispara UMA leitura (hooks estáveis)', async () => {
    mocks.perms = { permissions: {}, role: '', ready: false };
    const { default: DashboardPage } = await import('@/app/(dashboard)/dashboard/page');
    const view = render(<DashboardPage />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(overviewCalls).toEqual([]);
    mocks.perms = { permissions: permissionsFor('ADMIN') as any, role: 'ADMIN', ready: true };
    view.rerender(<DashboardPage />);
    await waitFor(() => expect(overviewCalls).toHaveLength(1));
  });
});
