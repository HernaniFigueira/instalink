// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// SIDEBAR — GoDoutor UI Revolution · Etapa A
// ═══════════════════════════════════════════════════════════════
// O que estes testes protegem:
//   1. a NOVA arquitetura de informação (seções + 4 grupos + ACORDEÃO de
//      coluna única — GODOUTOR final/FASE D: sem segunda coluna);
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
    // GODOUTOR final: Pendências voltou à linha do menu (fila de trabalho da
    // recepção, permissão real). Oportunidades vive DENTRO do grupo Gestão.
    expect(within(main).getByRole('link', { name: 'Pendências' })).toBeTruthy();
    // Só 4 grupos têm acordeão — é isso que acaba com a lista infinita.
    expect(within(main).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
      .toEqual(['Clínica', 'Automação', 'Gestão', 'Configurações']);
    // FASE D: NÃO existe segunda coluna (nem navegação de submenu fora do menu principal).
    expect(screen.queryByRole('navigation', { name: 'Clínica' })).toBeNull();
    expect(screen.queryByLabelText('Fechar submenu')).toBeNull();
  });

  it('acordeão: o grupo expande PARA BAIXO, na própria coluna (nunca segunda coluna)', async () => {
    const u = userEvent.setup();
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    await u.click(within(main).getByRole('button', { name: 'Clínica' }));
    // A UX agrupa; o modelo de dados NÃO foi unificado ( Professional ≠ Member ):
    // são quatro destinos distintos, cada um com a própria rota.
    for (const name of ['Serviços', 'Profissionais', 'Disponibilidade', 'Equipe']) {
      expect(within(main).getByRole('link', { name })).toBeTruthy();
    }
    // O submenu do grupo mora DENTRO do menu principal, com linha-guia.
    expect(within(main).getByText('Serviços').closest('.workspace-submenu')).toBeTruthy();
  });

  it('acordeão: UM grupo aberto por vez; clicar de novo fecha; não recolhe a navegação', async () => {
    const u = userEvent.setup();
    const { onCollapse } = setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    // O estado VISUAL do acordeão mora em aria-expanded + .is-open (o submenu
    // fecha por CSS grid 0fr — altura zero — mantendo o DOM estável).
    await u.click(within(main).getByRole('button', { name: 'Gestão' }));
    expect(within(main).getByRole('button', { name: 'Gestão' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.workspace-group.is-open #submenu-gestao')).toBeTruthy();
    await u.click(within(main).getByRole('button', { name: 'Configurações' }));
    expect(within(main).getByRole('button', { name: 'Gestão' }).getAttribute('aria-expanded')).toBe('false');
    expect(within(main).getByRole('button', { name: 'Configurações' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.workspace-group.is-open #submenu-ajustes')).toBeTruthy();
    expect(document.querySelectorAll('.workspace-group.is-open')).toHaveLength(1);
    await u.click(within(main).getByRole('button', { name: 'Configurações' }));
    expect(within(main).getByRole('button', { name: 'Configurações' }).getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.workspace-group.is-open')).toBeNull();
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it('deep-link abre o grupo dono da rota e a troca de rota atualiza o acordeão', () => {
    const { rerender, props } = setup({ activePath: '/configuracoes' });
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    expect(within(main).getByRole('button', { name: 'Configurações' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(main).getByRole('link', { name: 'Equipe' })).toBeTruthy();
    rerender(<WorkspaceNavigation {...props} activePath="/agenda" />);
    expect(within(main).getByRole('button', { name: 'Configurações' }).getAttribute('aria-expanded')).toBe('false');
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

  it('destino fora do menu NUNCA deixa painel vazio (invariante da área dona)', () => {
    // Cada rota fora do menu tem ÁREA DONA (Operação para /perfil e
    // /tarefas; Automação para /execucoes; Configurações para /recursos):
    // o acordeão abre o grupo dono COM conteúdo — nunca um painel vazio.
    for (const activePath of ['/perfil', '/tarefas']) {
      cleanup();
      setup({ activePath });
      expect(screen.queryByLabelText('Fechar submenu'), `painel vazio em ${activePath}`).toBeNull();
    }
    for (const [activePath, group] of [['/execucoes', 'Automação'], ['/recursos', 'Configurações']] as const) {
      cleanup();
      setup({ activePath });
      const main = screen.getByRole('navigation', { name: 'Menu principal' });
      const btn = within(main).getByRole('button', { name: group });
      expect(btn.getAttribute('aria-expanded'), `grupo dono aberto em ${activePath}`).toBe('true');
      expect(within(main).getAllByRole('link').length, `grupo com conteúdo em ${activePath}`).toBeGreaterThan(0);
      // O próprio destino fora do menu não é promovido a linha (régua do menu).
      expect(within(main).queryByRole('link', { name: activePath === '/execucoes' ? 'Execuções' : 'Recursos' })).toBeNull();
    }
  });

  it('não promove destino fora do menu (sidebar:false) a linha de menu', () => {
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    // /execucoes continua existindo (URL + atalho contextual), sem virar menu.
    expect(within(main).queryByRole('link', { name: 'Execuções' })).toBeNull();
    // E o grupo que o contém continua acessível.
    expect(within(main).getByRole('button', { name: 'Automação' })).toBeTruthy();
  });

  it('móvel: UM diálogo com o MESMO acordeão (sem passo de voltar)', async () => {
    const u = userEvent.setup();
    setup({ mobileOpen: true });
    const dialog = screen.getByRole('dialog');
    // As portas diretas e os grupos convivem no mesmo diálogo.
    expect(within(dialog).getByRole('link', { name: 'Agenda' })).toBeTruthy();
    await u.click(within(dialog).getByRole('button', { name: 'Gestão' }));
    expect(within(dialog).getByRole('link', { name: 'Resultados' })).toBeTruthy();
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
