// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// SIDEBAR — Missão final: disciplina visual Meta-like
// ═══════════════════════════════════════════════════════════════
// O que estes testes protegem (além do contrato original):
//   1. SEM títulos de seção (OPERAÇÃO/CLÍNICA/ADMINISTRAÇÃO) — a sidebar é
//      uma sequência contínua; "Clínica" aparece UMA vez, como grupo;
//   2. acordeão: SEMPRE exatamente UM grupo aberto quando expandida —
//      rotas planas abrem "Clínica" por padrão; deep-link abre o grupo dono;
//      clicar noutro grupo troca; clicar no aberto NÃO fecha;
//   3. rail recolhido: só ícones centralizados com tooltip (fora do container
//      rolável), sem nome/tipo de clínica, sem submenu inline; clicar num
//      grupo EXPANDE a sidebar e abre o grupo;
//   4. NENHUM .il-tip na sidebar — era o ::after dele (invisível, mas no
//      layout, dentro do container com overflow-y:auto) que esticava o
//      scrollWidth e criava a scrollbar horizontal do modo recolhido;
//   5. permissões e rotas: a navegação nunca revela nem cria destino que o
//      usuário não alcança (fonte: `nav.allowed`), e nenhuma rota desaparece.
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';
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
    // O submenu do grupo mora DENTRO do menu principal, com recuo.
    expect(within(main).getByText('Serviços').closest('.workspace-submenu')).toBeTruthy();
  });

  it('acordeão META: UM grupo aberto por vez; clicar no grupo ABERTO não fecha', async () => {
    const u = userEvent.setup();
    const { onCollapse } = setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    // O estado VISUAL do acordeão mora em aria-expanded + .is-open (o submenu
    // fecha por CSS grid 0fr — altura zero — mantendo o DOM estável).
    await u.click(within(main).getByRole('button', { name: 'Gestão' }));
    expect(within(main).getByRole('button', { name: 'Clínica' }).getAttribute('aria-expanded')).toBe('false');
    expect(within(main).getByRole('button', { name: 'Gestão' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.workspace-group.is-open #submenu-gestao')).toBeTruthy();
    await u.click(within(main).getByRole('button', { name: 'Configurações' }));
    expect(within(main).getByRole('button', { name: 'Gestão' }).getAttribute('aria-expanded')).toBe('false');
    expect(within(main).getByRole('button', { name: 'Configurações' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.workspace-group.is-open #submenu-ajustes')).toBeTruthy();
    expect(document.querySelectorAll('.workspace-group.is-open')).toHaveLength(1);
    // Missão §4 — NÃO fechar o próprio grupo: clicar de novo em Configurações
    // (já aberta) mantém o grupo aberto. Não existe "nenhum grupo aberto".
    await u.click(within(main).getByRole('button', { name: 'Configurações' }));
    expect(within(main).getByRole('button', { name: 'Configurações' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('.workspace-group.is-open')).toHaveLength(1);
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it('deep-link abre o grupo dono da rota e a troca de rota atualiza o acordeão', () => {
    const { rerender, props } = setup({ activePath: '/configuracoes' });
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    expect(within(main).getByRole('button', { name: 'Configurações' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(main).getByRole('link', { name: 'Equipe' })).toBeTruthy();
    rerender(<WorkspaceNavigation {...props} activePath="/agenda" />);
    expect(within(main).getByRole('button', { name: 'Configurações' }).getAttribute('aria-expanded')).toBe('false');
    // Rota plana sem escolha explícita do usuário → volta ao PADRÃO Clínica.
    expect(within(main).getByRole('button', { name: 'Clínica' }).getAttribute('aria-expanded')).toBe('true');
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
      cleanup(); setup({ activePath });
      expect(screen.queryByLabelText('Fechar submenu'), `painel vazio em ${activePath}`).toBeNull();
    }
    for (const [activePath, group] of [['/execucoes', 'Automação'], ['/recursos', 'Configurações']] as const) {
      cleanup(); setup({ activePath });
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

  it('nenhuma rota autorizada desapareceu do menu', () => {
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    const labels = [
      'Visão geral', 'Agenda', 'Conversas', 'Pendências', 'Clientes', 'Página',
      'Estrutura', 'Serviços', 'Profissionais', 'Disponibilidade', 'Equipe',
      'Automações', 'Follow-up', 'Campanhas',
      'Resultados', 'Financeiro', 'Oportunidades',
      'Canais & Integrações', 'Configurações',
    ];
    for (const label of labels) {
      expect(within(main).getByRole('link', { name: label }), label).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// MISSÃO SIDEBAR FINAL (§15 do briefing)
// ═══════════════════════════════════════════════════════════════
describe('Missão §2 — sem títulos de seção', () => {
  it('não renderiza OPERAÇÃO / CLÍNICA / ADMINISTRAÇÃO como títulos de seção', () => {
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    expect(within(main).queryByText('Operação')).toBeNull();
    expect(within(main).queryByText('Administração')).toBeNull();
    expect(document.querySelectorAll('.workspace-section__label')).toHaveLength(0);
  });

  it('"Clínica" aparece UMA vez, como grupo — não duplicada por título de seção', () => {
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    expect(within(main).getAllByText('Clínica')).toHaveLength(1);
    expect(within(main).getByText('Clínica').closest('.workspace-group')).toBeTruthy();
  });

  it('o drawer móvel também fica sem títulos de seção (§12)', () => {
    setup({ mobileOpen: true });
    const dialog = screen.getByRole('dialog');
    const mobileNav = within(dialog).getByRole('navigation', { name: 'Menu móvel' });
    expect(within(mobileNav).queryByText('Operação')).toBeNull();
    expect(within(mobileNav).queryByText('Administração')).toBeNull();
    // Uma vez como GRUPO (o "Clínica" do cabeçalho é o tipo da unidade,
    // não um título de seção — por isso o escopo é o menu).
    expect(within(mobileNav).getAllByText('Clínica')).toHaveLength(1);
    expect(within(mobileNav).getByText('Clínica').closest('.workspace-group')).toBeTruthy();
  });

  it('links diretos têm porte de item primário; subitens é que têm recuo (§5)', () => {
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    expect(within(main).getByRole('link', { name: 'Agenda' }).className).not.toContain('workspace-link--sub');
    expect(within(main).getByRole('link', { name: 'Serviços' }).className).toContain('workspace-link--sub');
  });
});

describe('Missão §4 — acordeão: sempre exatamente UM grupo aberto', () => {
  it.each(['/dashboard', '/agenda', '/conversas', '/tarefas', '/clientes', '/pagina'])(
    'rota plana %s inicia com Clínica aberta (padrão)',
    (activePath) => {
      setup({ activePath });
      const main = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(within(main).getByRole('button', { name: 'Clínica' }).getAttribute('aria-expanded')).toBe('true');
      expect(document.querySelectorAll('.workspace-group.is-open')).toHaveLength(1);
    },
  );

  it('deep-link abre o grupo DONO da rota', () => {
    const cases: Array<[string, string]> = [
      ['/estrutura', 'Clínica'], ['/servicos', 'Clínica'], ['/profissionais', 'Clínica'],
      ['/disponibilidade', 'Clínica'], ['/equipe', 'Clínica'],
      ['/agente', 'Automação'], ['/campanhas', 'Automação'], ['/automacoes', 'Automação'], ['/followup', 'Automação'],
      ['/resultados', 'Gestão'], ['/financeiro', 'Gestão'], ['/funil', 'Gestão'],
      ['/configuracoes', 'Configurações'], ['/canais', 'Configurações'],
    ];
    for (const [activePath, group] of cases) {
      cleanup(); setup({ activePath });
      const main = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(within(main).getByRole('button', { name: group }).getAttribute('aria-expanded'), `${activePath} → ${group}`).toBe('true');
      expect(document.querySelectorAll('.workspace-group.is-open'), activePath).toHaveLength(1);
    }
  });

  it('clicar Automação fecha Clínica e abre Automação (um grupo por vez)', async () => {
    const u = userEvent.setup();
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    await u.click(within(main).getByRole('button', { name: 'Automação' }));
    expect(within(main).getByRole('button', { name: 'Clínica' }).getAttribute('aria-expanded')).toBe('false');
    expect(within(main).getByRole('button', { name: 'Automação' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('.workspace-group.is-open')).toHaveLength(1);
  });

  it('clicar novamente em Automação NÃO fecha Automação', async () => {
    const u = userEvent.setup();
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    await u.click(within(main).getByRole('button', { name: 'Automação' }));
    await u.click(within(main).getByRole('button', { name: 'Automação' }));
    expect(within(main).getByRole('button', { name: 'Automação' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('.workspace-group.is-open')).toHaveLength(1);
  });

  it('a escolha EXPLÍCITA persiste em rota plana; deep-link tem autoridade', async () => {
    const u = userEvent.setup();
    const { rerender, props } = setup(); // /agenda — Clínica (padrão)
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    await u.click(within(main).getByRole('button', { name: 'Automação' }));
    // O usuário ABRIU Automação: navegando para rota plana, Automação segue aberta.
    rerender(<WorkspaceNavigation {...props} activePath="/clientes" />);
    expect(within(main).getByRole('button', { name: 'Automação' }).getAttribute('aria-expanded')).toBe('true');
    // Deep-link tem autoridade: /servicos reabre o dono (Clínica).
    rerender(<WorkspaceNavigation {...props} activePath="/servicos" />);
    expect(within(main).getByRole('button', { name: 'Clínica' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(main).getByRole('button', { name: 'Automação' }).getAttribute('aria-expanded')).toBe('false');
    // E rota plana, sem escolha explícita recente, volta ao padrão Clínica.
    rerender(<WorkspaceNavigation {...props} activePath="/dashboard" />);
    expect(within(main).getByRole('button', { name: 'Clínica' }).getAttribute('aria-expanded')).toBe('true');
  });
});

describe('Missão §7/§8 — rail recolhido (só ícones, tooltip, sem submenu inline)', () => {
  it('não renderiza nome/tipo da clínica, nem submenu inline, nem powered by', () => {
    setup({ collapsed: true, unit: { ...unit, name: 'Andrioni Veterinária', clinicType: 'veterinaria' } });
    const side = screen.getByRole('complementary', { name: 'Navegação da clínica' });
    expect(side.textContent).not.toContain('Andrioni Veterinária');
    expect(side.textContent).not.toContain('Clínica veterinária');
    expect(side.querySelector('.workspace-submenu')).toBeNull();
    expect(side.querySelector('.workspace-clinic-head__text')).toBeNull();
    expect(side.textContent).not.toContain('powered by');
    // A logo/monograma recolhida existe, centralizada no rail.
    expect(side.querySelector('.workspace-clinic-head__logo--mini, .workspace-clinic-head__mark--mini')).toBeTruthy();
  });

  it('labels do menu ficam OCULTOS por CSS (contrato de fonte do globals.css)', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/\.is-collapsed \.workspace-label\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.is-collapsed \.workspace-clinic-head__text\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.is-collapsed \.workspace-submenu\s*\{\s*display:\s*none/);
  });

  it('NENHUM elemento da sidebar usa .il-tip (causa raiz da scrollbar horizontal, §9)', () => {
    setup({ collapsed: true });
    expect(document.querySelectorAll('.il-tip')).toHaveLength(0);
    // Proteção extra: o container rolável não deixa nada vazar na horizontal.
    const css = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/\.workspace-primary\s*\{[^}]*overflow-x:\s*hidden/);
  });

  it('itens do rail carregam tooltip (data-tip) e o tooltip aparece ao hover', () => {
    setup({ collapsed: true });
    const side = screen.getByRole('complementary', { name: 'Navegação da clínica' });
    const agenda = screen.getByRole('link', { name: 'Agenda' });
    expect(agenda.getAttribute('data-tip')).toBe('Agenda');
    expect(screen.getByRole('button', { name: 'Automação' }).getAttribute('data-tip')).toBe('Automação');
    expect(screen.getByRole('button', { name: 'Ajuda e suporte' }).getAttribute('data-tip')).toBe('Ajuda e suporte');
    expect(side.querySelector('.ws-nav-tip')).toBeNull();
    fireEvent.mouseOver(agenda);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toBe('Agenda');
    // O tooltip vive FORA do container rolável (não estica o scrollWidth).
    expect(side.querySelector('.workspace-primary')?.contains(tip)).toBe(false);
    fireEvent.mouseOut(agenda);
    expect(side.querySelector('.ws-nav-tip')).toBeNull();
  });

  it('tooltip também aparece no foco (teclado)', () => {
    setup({ collapsed: true });
    const agenda = screen.getByRole('link', { name: 'Agenda' });
    fireEvent(agenda, new Event('focusin', { bubbles: true }));
    expect(screen.getByRole('tooltip').textContent).toBe('Agenda');
    fireEvent(agenda, new Event('focusout', { bubbles: true }));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('clicar num grupo no modo recolhido EXPANDE a sidebar e abre o grupo', async () => {
    const u = userEvent.setup();
    const view = setup({ collapsed: true });
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    await u.click(within(main).getByRole('button', { name: 'Automação' }));
    expect(view.onCollapse).toHaveBeenCalledTimes(1);
    // O shell inverte `collapsed`; ao expandir, Automação está aberto.
    view.rerender(<WorkspaceNavigation {...view.props} collapsed={false} />);
    expect(within(main).getByRole('button', { name: 'Automação' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('.workspace-group.is-open')).toHaveLength(1);
  });
});
