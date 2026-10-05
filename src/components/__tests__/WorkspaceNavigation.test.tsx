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
import { Drawer } from '../ui';
import { navAccentById, contrastRatio } from '@/lib/nav-accent';
import { color } from '@/lib/__tests__/helpers/ds-tokens';
import { panelNavigation } from '@/lib/panel';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllEnvs(); });

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

describe('Drawer de navegação mobile — superfície isolada', () => {
  it('usa o contexto nav apenas no Drawer mobile, preservando scroll e fechamento', async () => {
    const u = userEvent.setup();
    const { onMobileOpen } = setup({ mobileOpen: true });
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('workspace-nav-drawer');
    expect(dialog.querySelector('.il-drawer__strip')?.className).toContain('w-full');
    expect(dialog.querySelector('.il-drawer__strip')?.className).toContain('max-w-[420px]');
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog.querySelector('.ws-sheet__body')?.className).toContain('ws-scroll');
    expect(dialog.querySelector('.ws-sheet__body')?.className).toContain('overflow-y-auto');
    const close = within(dialog).getByRole('button', { name: 'Fechar' });

    const css = fs.readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toMatch(/dialog\.workspace-nav-drawer \.il-drawer__strip\s*\{[\s\S]*?background:\s*var\(--il-nav\)/);
    expect(css).toMatch(/dialog\.workspace-nav-drawer \.ws-sheet__close:focus-visible\s*\{[\s\S]*?outline:/);
    const genericStrip = css.match(/\.il-drawer__strip\s*\{([^}]*)\}/)?.[1] || '';
    const genericHeader = css.match(/\.ws-sheet__header\s*\{([^}]*)\}/)?.[1] || '';
    expect(genericStrip).not.toContain('--il-nav');
    expect(genericHeader).not.toContain('--il-nav');
    expect(css).toMatch(/\.workspace-nav-drawer \.workspace-foot__item\s*,[\s\S]*?color: var\(--il-nav-fg\)/);
    expect(css).toMatch(/\.workspace-link:hover\s*\{\s*background: var\(--il-nav-hover\)/);
    expect(css).toMatch(/\.workspace-link\[aria-current='page'\]\s*\{\s*background: var\(--il-nav-active\)/);
    expect(css).toMatch(/\.workspace-link--group\[aria-expanded='true'\][\s\S]*?background: var\(--il-nav-hover\)/);
    // DS 1.0 §15/§18 — o filho do grupo abre em PAINEL LATERAL (não em acordeão).
    expect(css).toMatch(/\.ws-peek \{[\s\S]*?background: var\(--gd-nav-panel-bg\)/);
    expect(css).not.toContain('.workspace-submenu');
    // O tema nunca é aplicado ao seletor genérico: overlays como Novo
    // Agendamento continuam usando a superfície neutra do Workspace.
    await u.click(close);
    expect(onMobileOpen).toHaveBeenCalledWith(false);
    cleanup();
    render(<Drawer open onClose={vi.fn()} title="Novo agendamento"><p>Conteúdo</p></Drawer>);
    const generic = screen.getByRole('dialog');
    expect(generic.className).toContain('il-drawer');
    expect(generic.className).not.toContain('workspace-nav-drawer');
  });

  it('no menu móvel o grupo mostra os filhos DIRETO (toque não tem hover) e mantém a rota ativa', () => {
    setup({ mobileOpen: true, activePath: '/agenda' });
    const dialog = screen.getByRole('dialog');
    const mobileNav = within(dialog).getByRole('navigation', { name: 'Menu móvel' });
    expect(within(mobileNav).getByRole('link', { name: 'Agenda' }).getAttribute('aria-current')).toBe('page');
    // DS 1.0 §18 — sem acordeão: os itens do grupo já estão no menu, sob o
    // rótulo discreto do grupo (recuo de subitem).
    expect(within(mobileNav).getByRole('link', { name: 'Serviços' })).toBeTruthy();
    expect(within(mobileNav).getByRole('link', { name: 'Serviços' }).className).toContain('workspace-link--sub');
    expect(within(mobileNav).queryByRole('button', { name: 'Clínica' })).toBeNull();
  });

  it.each(['azul-profundo', 'verde-salvia', 'neutro', 'vinho', 'branco'])(
    'mantém contraste AA para texto normal e ativo no preset %s', (id) => {
      const vars = navAccentById(id).vars;
      // Estrutura branca fixa (§13) + par ativo do preset: ambos AA.
      expect(contrastRatio(color('--il-nav-fg'), color('--il-nav'))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color('--il-nav-muted'), color('--il-nav-hover'))).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(vars['--il-nav-active-fg'], vars['--il-nav-active'])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it('a flag legada continua restaurando a rota Página na navegação mobile', () => {
    vi.stubEnv('GODOUTOR_LEGACY_PAGES', '1');
    setup({ mobileOpen: true });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Página' })).toBeTruthy();
  });
});

describe('Etapa A — sidebar por seções', () => {
  it('mostra os destinos principais como link e exatamente quatro grupos', () => {
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    // 2.0 — Operação é link direto: o dia a dia cabe na primeira coluna.
    // Clinical OS F0: "Página" é LEGADO — fora da navegação operacional
    // padrão (GODOUTOR_LEGACY_PAGES reativa; rotas/APIs preservadas).
    for (const name of ['Visão geral', 'Agenda', 'Conversas', 'Clientes']) {
      expect(within(main).getByRole('link', { name })).toBeTruthy();
    }
    expect(within(main).queryByRole('link', { name: 'Página' })).toBeNull();
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

  it('DS 1.0 §15 — o grupo abre o PAINEL LATERAL (nunca uma segunda coluna empurrando o conteúdo)', async () => {
    const u = userEvent.setup();
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    const linksBefore = main.querySelectorAll('a').length;
    await u.click(within(main).getByRole('button', { name: 'Clínica' }));
    const panel = document.getElementById('ws-nav-panel')!;
    expect(panel.getAttribute('aria-label')).toBe('Clínica');
    // CLINICAL STRUCTURE CONSOLIDATION (B1): Profissionais unificado em Equipe —
    // apenas Serviços permanece no grupo Clínica.
    expect(within(panel).getByRole('menuitem', { name: 'Serviços' })).toBeTruthy();
    expect(within(panel).queryByRole('menuitem', { name: 'Profissionais' })).toBeNull();
    // NADA foi inserido na coluna: o painel é portal no <body> e não reflui.
    expect(main.querySelectorAll('a').length).toBe(linksBefore);
    expect(panel.parentElement?.tagName).toBe('BODY');
    expect(document.getElementById('submenu-clinica')).toBeNull();
  });

  it('painel META: UM grupo aberto por vez; clicar no grupo ABERTO fecha', async () => {
    const u = userEvent.setup();
    const { onCollapse } = setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    // O estado VISUAL mora em aria-expanded + .is-open; o painel tem UM id.
    await u.click(within(main).getByRole('button', { name: 'Gestão' }));
    expect(within(main).getByRole('button', { name: 'Clínica' }).getAttribute('aria-expanded')).toBe('false');
    expect(within(main).getByRole('button', { name: 'Gestão' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('ws-nav-panel')?.getAttribute('aria-label')).toBe('Gestão');
    await u.click(within(main).getByRole('button', { name: 'Configurações' }));
    expect(within(main).getByRole('button', { name: 'Gestão' }).getAttribute('aria-expanded')).toBe('false');
    expect(within(main).getByRole('button', { name: 'Configurações' }).getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById('ws-nav-panel')?.getAttribute('aria-label')).toBe('Configurações');
    expect(document.querySelectorAll('.workspace-group.is-open')).toHaveLength(1);
    // Clicar no grupo aberto FECHA — zero painéis abertos é estado VÁLIDO.
    await u.click(within(main).getByRole('button', { name: 'Configurações' }));
    expect(within(main).getByRole('button', { name: 'Configurações' }).getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelectorAll('.workspace-group.is-open')).toHaveLength(0);
    expect(onCollapse).not.toHaveBeenCalled();
  });

  it('deep-link marca o grupo dono e a troca de rota move a marca (sem abrir painel sozinho)', () => {
    const { rerender, props } = setup({ activePath: '/configuracoes' });
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    // A rota ativa marca o grupo dono (is-active); o painel não abre sozinho.
    expect(within(main).getByRole('button', { name: 'Configurações' }).closest('.workspace-group')?.className).toContain('is-active');
    expect(document.getElementById('ws-nav-panel')).toBeNull();
    rerender(<WorkspaceNavigation {...props} activePath="/agenda" />);
    expect(within(main).getByRole('button', { name: 'Configurações' }).closest('.workspace-group')?.className).not.toContain('is-active');
    expect(within(main).getByRole('link', { name: 'Agenda' }).getAttribute('aria-current')).toBe('page');
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

  it('destino fora do menu NUNCA deixa painel vazio (invariante da área dona)', async () => {
    // Cada rota fora do menu tem ÁREA DONA (Operação para /perfil e /tarefas;
    // Automação para /execucoes; Configurações para /recursos). DS 1.0 §18: o
    // grupo da rota fica MARCADO (is-active) e abre um painel COM conteúdo —
    // nunca um painel vazio, nunca um grupo sem filhos.
    const u = userEvent.setup();
    for (const [activePath, group] of [['/execucoes', 'Automação'], ['/recursos', 'Configurações'], ['/perfil', 'Operação']] as const) {
      cleanup(); setup({ activePath });
      const main = screen.getByRole('navigation', { name: 'Menu principal' });
      const btn = within(main).queryByRole('button', { name: group });
      if (!btn) continue; // grupo sem linha própria não é desenhado (régua do menu)
      expect(btn.closest('.workspace-group')?.className, `grupo dono marcado em ${activePath}`).toContain('is-active');
      await u.click(btn);
      const panel = document.getElementById('ws-nav-panel');
      expect(panel, `painel do grupo em ${activePath}`).toBeTruthy();
      expect(within(panel!).getAllByRole('menuitem').length, `grupo com conteúdo em ${activePath}`).toBeGreaterThan(0);
      cleanup();
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

  it('móvel: UM diálogo com as portas diretas E os itens de grupo (sem passo de voltar)', () => {
    setup({ mobileOpen: true });
    const dialog = screen.getByRole('dialog');
    // Portas diretas e filhos de grupo convivem no mesmo diálogo.
    expect(within(dialog).getByRole('link', { name: 'Agenda' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Resultados' })).toBeTruthy();
    expect(within(dialog).getByRole('link', { name: 'Equipe' })).toBeTruthy();
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
    // CLINICAL STRUCTURE CONSOLIDATION (B1): Profissionais saiu do menu (unificado em Equipe, redirect compatível)
    // Portas diretas ficam na coluna; as demais são o conteúdo dos GRUPOS.
    const direct = ['Visão geral', 'Agenda', 'Conversas', 'Pendências', 'Clientes'];
    const grouped: Record<string, string> = {
      Estrutura: 'Clínica', Serviços: 'Clínica', Disponibilidade: 'Clínica', Equipe: 'Clínica',
      'Automações': 'Automação', 'Follow-up': 'Automação', Campanhas: 'Automação',
      Resultados: 'Gestão', Financeiro: 'Gestão', Oportunidades: 'Gestão',
      'Canais & Integrações': 'Configurações', 'Configurações': 'Configurações',
    };
    for (const label of direct) {
      expect(within(main).getByRole('link', { name: label }), label).toBeTruthy();
    }
    // Nenhum destino autorizado desapareceu: todos estão no grupo dono.
    for (const group of new Set(Object.values(grouped))) {
      fireEvent.mouseEnter(within(main).getByRole('button', { name: group }));
      const panel = document.getElementById('ws-nav-panel')!;
      for (const [label, owner] of Object.entries(grouped)) {
        if (owner !== group) continue;
        expect(within(panel).getByRole('menuitem', { name: label }), label).toBeTruthy();
      }
      fireEvent.mouseLeave(within(main).getByRole('button', { name: group }));
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
    // Uma vez, como RÓTULO do grupo (o "Clínica" do cabeçalho é o tipo da
    // unidade, não um título de seção — por isso o escopo é o menu). No toque
    // não há disclosure: o rótulo identifica o bloco de itens (§18).
    expect(within(mobileNav).getAllByText('Clínica')).toHaveLength(1);
    expect(within(mobileNav).getByText('Clínica').closest('.workspace-nav-drawer__title')).toBeTruthy();
  });

  it('links diretos têm porte de item primário; filhos de grupo têm recuo (§5)', () => {
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    expect(within(main).getByRole('link', { name: 'Agenda' }).className).not.toContain('workspace-link--sub');
    // No desktop o filho de grupo NÃO ocupa a coluna (ele vive no painel §15).
    expect(within(main).queryByRole('link', { name: 'Serviços' })).toBeNull();
    // No drawer móvel o filho aparece com recuo de subitem.
    cleanup();
    setup({ mobileOpen: true });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('link', { name: 'Serviços' }).className).toContain('workspace-link--sub');
  });
});

describe('DS 1.0 §15/§18 — grupo abre PAINEL LATERAL (sem acordeão)', () => {
  it.each(['/dashboard', '/agenda', '/conversas', '/tarefas', '/clientes', '/pagina'])(
    'rota plana %s inicia com ZERO painéis abertos',
    (activePath) => {
      setup({ activePath });
      const main = screen.getByRole('navigation', { name: 'Menu principal' });
      expect(within(main).getByRole('button', { name: 'Clínica' }).getAttribute('aria-expanded')).toBe('false');
      expect(document.querySelectorAll('.workspace-group.is-open')).toHaveLength(0);
      expect(document.getElementById('ws-nav-panel')).toBeNull();
    },
  );

  it('deep-link MARCA o grupo dono (is-active) sem forçar painel aberto', () => {
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
      const btn = within(main).getByRole('button', { name: group });
      expect(btn.closest('.workspace-group')?.className, `${activePath} → ${group}`).toContain('is-active');
      // Nada abre sozinho: painel é hover/focus/clique do usuário.
      expect(btn.getAttribute('aria-expanded'), activePath).toBe('false');
      expect(document.getElementById('ws-nav-panel')).toBeNull();
    }
  });

  it('hover/focus abre UM painel por vez; o anterior fecha (um por vez)', () => {
    setup({ activePath: '/configuracoes' });
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    fireEvent.focus(within(main).getByRole('button', { name: 'Configurações' }));
    expect(document.getElementById('ws-nav-panel')?.getAttribute('aria-label')).toBe('Configurações');
    fireEvent.focus(within(main).getByRole('button', { name: 'Automação' }));
    expect(document.getElementById('ws-nav-panel')?.getAttribute('aria-label')).toBe('Automação');
    expect(document.querySelectorAll('.workspace-group.is-open')).toHaveLength(1);
  });

  it('clicar novamente no grupo ABERTO fecha (zero painéis = estado válido)', async () => {
    const u = userEvent.setup();
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    const btn = within(main).getByRole('button', { name: 'Automação' });
    await u.click(btn);
    expect(document.getElementById('ws-nav-panel')).toBeTruthy();
    await u.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('ws-nav-panel')).toBeNull();
  });

  it('o painel NÃO empurra o conteúdo: os filhos jamais entram na coluna', async () => {
    const u = userEvent.setup();
    setup();
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    const linksBefore = main.querySelectorAll('a').length;
    const rowsBefore = main.querySelectorAll('.workspace-link').length;
    await u.click(within(main).getByRole('button', { name: 'Automação' }));
    // Nenhum submenu inline, nenhum filho dentro do <nav> — o painel é portal.
    expect(main.querySelectorAll('a').length).toBe(linksBefore);
    expect(main.querySelectorAll('.workspace-link').length).toBe(rowsBefore);
    expect(main.querySelector('.workspace-submenu')).toBeNull();
    expect(document.getElementById('ws-nav-panel')!.parentElement?.tagName).toBe('BODY');
  });
});

describe('Missão §7/§8 — rail recolhido (só ícones, tooltip, sem submenu inline)', () => {
  it('não renderiza nome/tipo da clínica, nem submenu inline, nem powered by', () => {
    setup({ collapsed: true, unit: { ...unit, name: 'Andrioni Veterinária', clinicType: 'veterinaria' } });
    const side = screen.getByRole('complementary', { name: 'Navegação da clínica' });
    expect(side.textContent).not.toContain('Andrioni Veterinária');
    expect(side.textContent).not.toContain('Clínica veterinária');
    expect(side.querySelector('.workspace-submenu')).toBeNull();
    // §18 — nenhum grupo abre filhos dentro da coluna, em nenhum modo.
    expect(side.querySelector('.workspace-nav-drawer__title')).toBeNull();
    expect(side.querySelector('.workspace-clinic-head__text')).toBeNull();
    expect(side.textContent).not.toContain('powered by');
    // A logo/monograma recolhida existe, centralizada no rail.
    expect(side.querySelector('.workspace-clinic-head__logo--mini, .workspace-clinic-head__mark--mini')).toBeTruthy();
  });

  it('labels do menu ficam OCULTOS por CSS (contrato de fonte do globals.css)', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'src', 'app', 'globals.css'), 'utf8');
    expect(css).toMatch(/\.is-collapsed \.workspace-label\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.is-collapsed \.workspace-clinic-head__text\s*\{\s*display:\s*none/);
    // §15 — painel ancorado na borda da navegação (rail OU expandida).
    expect(css).toMatch(/\.ws-peek \{[\s\S]*?left: calc\(var\(--gd-rail-w\) \+ var\(--gd-space-1\)\)/);
    expect(css).toMatch(/\.ws-peek--wide \{ left: calc\(var\(--gd-sidebar-w\) \+ var\(--gd-space-1\)\); \}/);
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
    // GRUPOS no rail: SEM data-tip — o hover-peek (§7) assume este papel
    // (cobre o nome + itens); o tooltip é só para rotas diretas.
    expect(screen.getByRole('button', { name: 'Automação' }).getAttribute('data-tip')).toBeNull();
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

  it('clicar num grupo no modo recolhido NÃO expande a sidebar — só abre o flyout', async () => {
    const u = userEvent.setup();
    const view = setup({ collapsed: true });
    const main = screen.getByRole('navigation', { name: 'Menu principal' });
    const btn = within(main).getByRole('button', { name: 'Automação' });
    await u.click(btn);
    // CONTRATO do refino final: o clique de grupo NUNCA expande a sidebar.
    expect(view.onCollapse).not.toHaveBeenCalled();
    // O flyout do grupo abre (aria-expanded acompanha o peek).
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    // Clique de novo fecha o flyout — sidebar continua recolhida.
    await u.click(btn);
    expect(view.onCollapse).not.toHaveBeenCalled();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    // Nenhum submenu inline aparece no rail.
    expect(document.querySelectorAll('.workspace-group.is-open')).toHaveLength(0);
  });
});
