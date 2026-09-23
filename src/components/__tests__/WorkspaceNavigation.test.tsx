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
    // Principal + Operação/Comercial/Presença planos: links diretos.
    for (const name of ['Início', 'Agenda', 'Clientes', 'Conversas', 'Tarefas', 'Funil', 'Página']) {
      expect(within(main).getByRole('link', { name })).toBeTruthy();
    }
    // Só 4 grupos abrem a segunda coluna — é isso que acaba com a lista infinita.
    expect(within(main).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
      .toEqual(['Estrutura da clínica', 'Automação', 'Gestão', 'Ajustes']);
    expect(screen.queryByLabelText('Fechar submenu')).toBeNull();
  });

  it('agrupa Serviços/Profissionais/Disponibilidade/Equipe em "Estrutura da clínica"', async () => {
    const u = userEvent.setup();
    setup();
    await u.click(screen.getByRole('button', { name: 'Estrutura da clínica' }));
    const rail = screen.getByRole('navigation', { name: 'Estrutura da clínica' });
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
    await u.click(screen.getByRole('button', { name: 'Ajustes' }));
    expect(screen.queryByRole('navigation', { name: 'Gestão' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Ajustes' }));
    expect(screen.queryByRole('navigation', { name: 'Ajustes' })).toBeNull();
    await u.click(screen.getByRole('button', { name: 'Gestão' }));
    await u.click(screen.getByRole('button', { name: 'Fechar submenu' }));
    expect(screen.queryByRole('navigation', { name: 'Gestão' })).toBeNull();
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it('abre o grupo dono da rota em deep-link e troca junto com a rota', () => {
    const { rerender, props } = setup({ activePath: '/configuracoes' });
    expect(screen.getByRole('navigation', { name: 'Ajustes' })).toBeTruthy();
    rerender(<WorkspaceNavigation {...props} activePath="/agenda" />);
    expect(screen.queryByRole('navigation', { name: 'Ajustes' })).toBeNull();
  });

  it('mantém a identidade da clínica (logo) na sidebar', () => {
    setup();
    const side = screen.getByRole('complementary', { name: 'Navegação da clínica' });
    expect(side.querySelectorAll('img')).toHaveLength(1);
    expect(side.querySelector('img')?.getAttribute('src')).toBe(unit.logo);
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
    expect(screen.queryByRole('button', { name: 'Estrutura da clínica' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Clientes' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Agenda' })).toBeTruthy();
  });
});
