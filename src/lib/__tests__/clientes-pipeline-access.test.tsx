// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// CLIENTES: quem não tem `leads` NÃO chama /api/pipeline
// ═══════════════════════════════════════════════════════════════
// O Profissional não tem `leads`. A lista de Clientes chamava /api/pipeline
// mesmo assim e o servidor respondia 403. Agora a chamada é impedida ANTES,
// pela mesma permissão (`canFunil`) que já controla o atalho do Funil.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { permissionsFor } from '../permissions';

const mocks = vi.hoisted(() => ({
  biz: 'biz-1',
  perms: { permissions: {} as Record<string, boolean>, role: '', ready: true },
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`b=${mocks.biz}`),
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
  usePathname: () => '/clientes',
}));
vi.mock('@/components/dashboard/usePanelPermissions', () => ({ usePanelPermissions: () => mocks.perms }));

let calls: string[] = [];
const count = (frag: string) => calls.filter((u) => u.includes(frag)).length;
const PIPELINE = { pipeline: { id: 'p1', stages: [{ id: 's1', name: 'Novo', order: 0 }] } };

beforeEach(() => {
  calls = [];
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }), configurable: true });
  (Element.prototype as any).scrollIntoView = () => {};
  HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function close() { this.removeAttribute('open'); };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url));
    const body = String(url).includes('/api/pipeline') ? PIPELINE
      : String(url).includes('/api/people360') ? { people: [], total: 0, pages: 1 }
        : {};
    return { ok: true, status: 200, json: async () => body, headers: new Headers(), text: async () => JSON.stringify(body) } as unknown as Response;
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function mount() {
  const { default: ClientesPage } = await import('@/app/(dashboard)/clientes/page');
  return render(<ClientesPage />);
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 60)); });
let seq = 0;
beforeEach(() => { mocks.biz = `biz-cli-${++seq}`; });

describe('Clientes — /api/pipeline só com `leads`', () => {
  it('Profissional (sem leads): lista carrega, ZERO /api/pipeline', async () => {
    expect(permissionsFor('PROFISSIONAL').leads).toBeFalsy(); // o preset não foi alterado
    mocks.perms = { permissions: permissionsFor('PROFISSIONAL') as any, role: 'PROFISSIONAL', ready: true };
    await mount();
    await waitFor(() => expect(count('/api/people360')).toBeGreaterThan(0));
    await settle();
    expect(count('/api/pipeline')).toBe(0);
  });

  it('Profissional: buscar/paginar continua chamando people360 (escopado) e nunca o pipeline', async () => {
    mocks.perms = { permissions: permissionsFor('PROFISSIONAL') as any, role: 'PROFISSIONAL', ready: true };
    const { container } = await mount();
    await waitFor(() => expect(count('/api/people360')).toBeGreaterThan(0));
    const input = container.querySelector('input[type="search"], input[placeholder*="uscar"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: 'ana' } });
    await waitFor(() => expect(calls.some((u) => u.includes('/api/people360') && u.includes('q=ana'))).toBe(true), { timeout: 2000 });
    expect(count('/api/pipeline')).toBe(0);
  });

  it.each(['OWNER', 'ADMIN', 'SECRETARIA'] as const)('%s (com leads): pipeline continua carregando, uma vez', async (role) => {
    expect(permissionsFor(role).leads).toBe(true);
    mocks.perms = { permissions: permissionsFor(role) as any, role, ready: true };
    await mount();
    await waitFor(() => expect(count('/api/pipeline')).toBe(1));
    await settle();
    expect(count('/api/pipeline')).toBe(1);
    expect(count('/api/people360')).toBe(1); // sem recarga repetitiva
  });

  it('permissões ainda carregando: nada de pipeline; ao ficarem prontas (leads) carrega UMA vez e a lista NÃO recarrega', async () => {
    mocks.perms = { permissions: {}, role: '', ready: false };
    const { default: ClientesPage } = await import('@/app/(dashboard)/clientes/page');
    const view = render(<ClientesPage />);
    await waitFor(() => expect(count('/api/people360')).toBe(1));
    await settle();
    expect(count('/api/pipeline')).toBe(0);
    mocks.perms = { permissions: permissionsFor('ADMIN') as any, role: 'ADMIN', ready: true };
    view.rerender(<ClientesPage />); // mesmos hooks: sem erro de ordem
    await waitFor(() => expect(count('/api/pipeline')).toBe(1));
    await settle();
    expect(count('/api/pipeline')).toBe(1);
    expect(count('/api/people360')).toBe(1);
  });

  it('acesso muda (leads some): nenhuma chamada nova e nenhum pipeline velho fica na tela', async () => {
    mocks.perms = { permissions: permissionsFor('ADMIN') as any, role: 'ADMIN', ready: true };
    const { default: ClientesPage } = await import('@/app/(dashboard)/clientes/page');
    const view = render(<ClientesPage />);
    await waitFor(() => expect(count('/api/pipeline')).toBe(1));
    mocks.perms = { permissions: permissionsFor('PROFISSIONAL') as any, role: 'PROFISSIONAL', ready: true };
    view.rerender(<ClientesPage />);
    await settle();
    expect(count('/api/pipeline')).toBe(1); // nada novo
  });
});
