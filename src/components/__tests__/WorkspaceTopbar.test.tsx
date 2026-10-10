// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// TOPBAR DO APP SHELL — identidade da clínica (missão UX Closure · item 2)
// ═══════════════════════════════════════════════════════════════
// Contrato que este arquivo protege:
//   1. a IDENTIDADE (logo + NOME COMPLETO) vive na topbar, no bloco esquerdo;
//   2. com mais de uma unidade o bloco vira TROCA REAL de contexto (popover com
//      as unidades, marcação da atual) — com uma só, é texto (nada de controle);
//   3. a sidebar NÃO repete nome/logo (uma identidade por tela);
//   4. a topbar continua sem breadcrumb e mantém busca + ações da conta;
//   5. nada é copiado da referência: cor/logo/marca continuam GoDoutor.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';
import { WorkspaceTopbar } from '@/components/dashboard/WorkspaceTopbar';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => cleanup());

const unit = { id: 'one', name: 'Andrioni Veterinaria', logo: '/demo/clinic.svg', slug: 'androni' };
const alerts = { status: 'ready', items: [], count: 0 } as any;

function setup(overrides: any = {}) {
  const onUnit = vi.fn();
  const props = {
    page: 'Agenda',
    query: '',
    searchItems: [],
    activePath: '/agenda',
    businessId: 'one',
    alerts,
    user: { name: 'Dra. Helena', email: 'h@example.invalid', role: 'OWNER' },
    unit,
    units: [unit],
    canCreate: ['/agenda', '/clientes'],
    onUnit,
    onLogout: vi.fn(),
    onOpenNav: vi.fn(),
    onOpenHelp: vi.fn(),
    ...overrides,
  };
  const view = render(<WorkspaceTopbar {...props} />);
  return { ...view, onUnit, props };
}

describe('TOPBAR · identidade da clínica', () => {
  it('mostra logo + NOME COMPLETO no bloco esquerdo', () => {
    setup();
    const header = document.querySelector('.ws-topbar') as HTMLElement;
    const identity = header.querySelector('[data-clinic-identity="true"]') as HTMLElement;
    expect(identity).toBeTruthy();
    expect(identity.textContent).toContain('Andrioni Veterinaria');
    expect(identity.querySelector('.ws-clinic__logo')?.getAttribute('src')).toBe('/demo/clinic.svg');
    // A identidade está à ESQUERDA (primeiro bloco da topbar).
    expect(header.querySelector('.ws-topbar__left')?.contains(identity)).toBe(true);
  });

  it('sem logo, desenha o monograma com o par accent/contrast (nunca texto truncado)', () => {
    setup({ unit: { ...unit, logo: undefined } });
    const mark = document.querySelector('.ws-clinic__mark') as HTMLElement;
    expect(mark.textContent).toBe('AV');
  });

  it('com UMA unidade a identidade é texto, não um controle que não faz nada', () => {
    setup();
    expect(document.querySelector('.ws-clinic--action')).toBeNull();
    expect(screen.queryByRole('button', { name: /Trocar de unidade/ })).toBeNull();
  });

  it('com MAIS de uma unidade o mesmo bloco troca de contexto (popover com a atual marcada)', async () => {
    const u = userEvent.setup();
    const other = { id: 'two', name: 'Andrioni Unidade Sul', slug: 'androni-sul' };
    const { onUnit } = setup({ units: [unit, other] });
    const trigger = screen.getByRole('button', { name: /Unidade atual: Andrioni Veterinaria/ });
    await u.click(trigger);
    const menu = await screen.findByRole('menu', { name: 'Trocar de unidade' });
    expect(within(menu).getByText('Andrioni Unidade Sul')).toBeTruthy();
    await u.click(within(menu).getByRole('menuitem', { name: /Andrioni Unidade Sul/ }));
    expect(onUnit).toHaveBeenCalledWith('two');
  });

  it('a sidebar NÃO repete a identidade (uma identidade por tela)', () => {
    const nav = fs.readFileSync(path.join(process.cwd(), 'src/components/dashboard/WorkspaceNavigation.tsx'), 'utf8');
    expect(nav).not.toContain('ws-clinic');
    expect(nav).not.toContain('clinic-head');
  });

  it('mantém busca global, ações da conta e NENHUM breadcrumb', () => {
    setup();
    const header = document.querySelector('.ws-topbar') as HTMLElement;
    expect(header.querySelector('.ws-topbar__center')).toBeTruthy();
    expect(header.querySelector('.ws-topbar__right')).toBeTruthy();
    // Sem breadcrumb global: o cabeçalho da página identifica a tela.
    expect(header.querySelector('.ws-crumbs, [data-breadcrumb]')).toBeNull();
    expect(header.textContent).not.toContain('›');
  });
});
