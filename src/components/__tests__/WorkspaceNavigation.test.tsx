// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// SIDEBAR — GoDoutor UI Revolution · Etapa A
// ═══════════════════════════════════════════════════════════════
// O que estes testes protegem:
//   1. a NOVA arquitetura de informação (seções + 4 grupos + segunda coluna);
//   2. o invariante de segurança que já existia: a navegação nunca revela nem
//      cria destino que o usuário não alcança (a fonte é `nav.allowed`);
//   3. nada foi apagado: destino com `sidebar: false` não ocupa linha no menu,
//      mas continua existindo (URL/atalho contextual).
//
// A busca e o seletor de unidade SAÍRAM da sidebar (topbar e menu da conta),
// então não são mais assertados aqui — ver WorkspaceTopbar/AccountMenu.
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceNavigation } from '../dashboard/WorkspaceNavigation';
import { panelNavigation } from '@/lib/panel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const unit = { id: 'one', name: 'Clínica sintética', logo: '/demo/clinic.svg', slug: 'demo-one' };
const FULL_PERMISSIONS = {
  dashboard: true, agenda: true, clientes: true, leads: true, catalogo: true,
  pagina: true, equipe: true, financeiro: true, config: true, agente: true,
  campanhas: true, whatsapp: true, pedidos: true,
};
const nav = panelNavigation({
  permissions: FULL_PERMISSIONS as any, modes: ['services', 'bookings'], features: {},
});

function setup(overrides: any = {}) {
  const callbacks = { onCollapse: vi.fn(), onMobileOpen: vi.fn() };
  const props = { nav, activePath: '/agenda', unit, collapsed: false, ...callbacks, ...overrides };
  const view = render(<WorkspaceNavigation {...props} />);
  return { ...view, ...callbacks, props };
}

describe('Etapa A — sidebar por seções', () => {
  it('mostra os destinos principais como link e exatamente quatro grupos', () => {
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    // 2.0 — Operação é link direto: o dia a dia cabe na primeira coluna.
    for (const name of ['Visão geral', 'Agenda', 'Conversas', 'Clientes', 'Página']) {
      expect(within(main).getByRole('link', { name })).toBeTruthy();
    }
    // Pendências/Oportunidades saíram da linha do menu (contexto, não porta).
    for (const name of ['Pendências', 'Oportunidades']) {
      expect(within(main).queryByRole('link', { name })).toBeNull();
    }
    // Só 4 grupos abrem a segunda coluna — é isso que acaba com a lista infinita.
    expect(within(main).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
      .toEqual(['Clínica', 'Automação', 'Gestão', 'Configurações']);
    expect(screen.queryByLabelText('Fechar submenu')).toBeNull();
  });

  it('agrupa Serviços/Profissionais/Disponibilidade/Equipe em "Clínica"', async () => {
    const u = userEvent.setup();
    setup();
    await u.click(screen.getByRole('button', { name: 'Clínica' }));
    const rail = screen.getByRole('navigation', { name: 'Clínica' });
    // A UX agrupa; o modelo de dados NÃO foi unificado ( Professional ≠ Member ):
    // são quatro destinos distintos, cada um com a própria rota.
    for (const name of ['Serviços', 'Profissionais', 'Disponibilidade', 'Equipe']) {
      expect(within(rail).getByRole('link', { name })).toBeTruthy();
    }
  });

  it('substitui e fecha a segunda coluna sem recolher a navegação', async () => {
    const u = userEvent.setup();
    const { onCollapse } = setup();
    await u.click(screen.getByRole('button', { name: 'Gestão' }));
    expect(screen.getByRole('navigation', { name: 'Gestão' })).toBeTruthy();
    await u.click(screen.getByRole('button', { name: 'Configurações' }));
    expect(screen.queryByRole('navigation', { name: 'Gestão' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Configurações' }));
    expect(screen.queryByRole('navigation', { name: 'Configurações' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Gestão' }));
    await u.click(screen.getByRole('button', { name: 'Fechar submenu' }));
    expect(screen.queryByRole('navigation', { name: 'Gestão' })).toBeNull();
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it('abre o grupo dono da rota em deep-link e troca junto com a rota', () => {
    const { rerender, props } = setup({ activePath: '/configuracoes' });
    expect(screen.getByRole('navigation', { name: 'Configurações' })).toBeTruthy();
    rerender(<WorkspaceNavigation {...props} activePath="/agenda" />);
    expect(screen.queryByRole('navigation', { name: 'Configurações' })).toBeNull();
  });

  it('marca 2.0: a CLÍNICA identifica a navegação, GoDoutor assina no rodapé', () => {
    // §C — clinic-first: o topo da sidebar é a clínica (nome + logo). A marca
    // do produto NÃO some (nada de white-label): ela assina discretamente.
    setup();
    const side = screen.getByRole('complementary', { name: 'Navegação da clínica' });
    expect(side.querySelector('.workspace-clinic-head__logo')).toBeTruthy();
    expect(side.textContent).toContain(unit.name);
    expect(side.textContent).toContain('GoDoutor');
    expect(side.textContent).not.toContain('InstaLink');
  });

  it('só recolhe no botão explícito', async () => {
    const u = userEvent.setup();
    const { onCollapse } = setup();
    await u.click(screen.getByRole('button', { name: 'Recolher navegação' }));
    expect(onCollapse).toHaveBeenCalledOnce();
  });

  it('não promove destino fora do menu (sidebar:false) a linha de menu', () => {
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    // /execucoes continua existindo (URL + atalho contextual), sem virar menu.
    expect(within(main).queryByRole('link', { name: 'Execuções' })).toBeNull();
    // E o grupo que o contém continua acessível.
    expect(within(main).getByRole('button', { name: 'Automação' })).toBeTruthy();
  });

  it('usa UM diálogo móvel com passo de voltar, controlado pelo shell', async () => {
    const u = userEvent.setup();
    setup({ mobileOpen: true });
    const dialog = screen.getByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: 'Gestão' }));
    expect(within(dialog).getByRole('link', { name: 'Resultados' })).toBeTruthy();
    expect(within(dialog).queryByRole('link', { name: 'Agenda' })).toBeNull();
    await u.click(within(dialog).getByRole('button', { name: /Voltar/ }));
    expect(within(dialog).getByRole('link', { name: 'Agenda' })).toBeTruthy();
  });

  it('nunca introduz rota ou grupo sem autorização', () => {
    setup({ nav: panelNavigation({ permissions: { agenda: true }, modes: ['bookings'], features: {} }) });
    expect(screen.queryByRole('button', { name: 'Gestão' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clínica' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Clientes' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Agenda' })).toBeTruthy();
  });
});
