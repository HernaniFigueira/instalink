import { describe, it, expect } from 'vitest';
import { PANEL_ROUTES, panelNavigation } from '../panel';
import { workspaceAreas, switchUnitHref, routeBreadcrumb, workspaceSections } from '../workspace-navigation';

describe('360 navigation is an authorized projection', () => {
  it('keeps every destination exactly once, including contextual/legacy routes', () => {
    // PARTIÇÃO TOTAL — o invariante que protege contra "rota que sumiu do menu
    // e virou porta fantasma". Com MAIS DE UMA unidade a partição cobre o
    // catálogo inteiro; com uma unidade só, a ÚNICA supressão de apresentação
    // é "Organização" (decisão de produto: quem tem uma unidade não precisa
    // pensar em organização). A rota continua acessível por URL.
    const all = workspaceAreas(PANEL_ROUTES, { multiUnit: true }).flatMap(a => a.items.map(i => i.href));
    expect(all.sort()).toEqual(PANEL_ROUTES.map(i => i.href).sort());
    expect(new Set(all).size).toBe(all.length);

    const single = workspaceAreas(PANEL_ROUTES).flatMap(a => a.items.map(i => i.href));
    expect(single.sort()).toEqual(PANEL_ROUTES.filter(i => i.href !== '/organizacao').map(i => i.href).sort());
    expect(new Set(single).size).toBe(single.length);
  });
  for (const permissions of [{}, { agenda: true, clientes: true }, { dashboard: true, atendimento: true }, { equipe: true, config: true }]) {
    it(`never expands authorized routes: ${JSON.stringify(permissions)}`, () => {
      const nav = panelNavigation({ permissions, modes: ['services', 'bookings'], features: {} });
      const projected = workspaceAreas(nav.allowed, { multiUnit: true }).flatMap(a => a.items);
      expect(projected.map(r => r.href).sort()).toEqual(nav.allowed.map(r => r.href).sort());
    });
  }
  it('preserves presentation filters, strips entity IDs/searches on unit change', () => {
    const old = new URLSearchParams('b=old&data=2026-09-21&view=week&professionalId=private&member=private&booking=private&q=patient&customerId=private');
    expect(switchUnitHref('/agenda', old, 'new')).toBe('/agenda?b=new&data=2026-09-21&view=week');
    expect(switchUnitHref('/clientes', old, 'new')).toBe('/clientes?b=new');
    expect(switchUnitHref('/configuracoes', new URLSearchParams('tab=agenda&member=secret'), 'new')).toBe('/configuracoes?b=new&tab=agenda');
  });

  it('projects the 2.0 architecture: four doors on the first column, groups on the second', () => {
    const areas = workspaceAreas(PANEL_ROUTES, { multiUnit: true });
    const sections = workspaceSections(areas);
    // A sidebar 2.0 tem TRÊS seções renderizáveis (Operação · Clínica ·
    // Administração). O catálogo também produz a rede de segurança "Mais"
    // (destinos fora do menu: Pendências, Execuções, Meu perfil) — ela é DADOS,
    // nunca uma seção visível, porque todos os seus itens são `sidebar: false`
    // e o menu descarta seção sem linha (WorkspaceNavigation.menu).
    // Com o catálogo COBERTO (cada destino fora do menu tem área dona:
    // Pendências e Meu perfil em Operação, Execuções em Automação, Recursos em
    // Configurações), a rede de segurança "Mais" não é necessária — ela existe
    // no catálogo de áreas, mas não ocupa seção nenhuma.
    expect(sections.map((s) => s.label)).toEqual(['Operação', 'Clínica', 'Administração']);
    expect(areas.some((a) => a.id === 'mais')).toBe(false);
    const groups = sections.flatMap((s) => s.groups.filter((g) => !g.flat).map((g) => g.area.label));
    // Exatamente QUATRO portas abrem a segunda coluna.
    expect(groups.slice(0, 4)).toEqual(['Clínica', 'Automação', 'Gestão', 'Configurações']);
    // O resto da primeira coluna é LINK DIRETO (sem segundo nível).
    const flat = sections.flatMap((s) => s.groups.filter((g) => g.flat).map((g) => g.area.id));
    expect(flat).toEqual(['principal', 'presenca']);

    // Nenhuma porta fora do menu ocupa linha no menu.
    const rendered = sections.flatMap((s) => s.groups.flatMap(({ area, flat: isFlat }) =>
      (isFlat ? area.items : []).filter((i) => i.sidebar !== false).map((i) => i.href)));
    expect(rendered).not.toContain('/execucoes');
    expect(rendered).not.toContain('/tarefas');
    expect(rendered).not.toContain('/perfil');

    // "Clínica" reúne os conceitos pedidos SEM unir modelos (Professional e
    // Member continuam separados) e sem perder nenhum destino.
    const clinica = areas.find((a) => a.id === 'clinica')!;
    expect(clinica.items.map((i) => i.href).sort()).toEqual(
      ['/disponibilidade', '/equipe', '/estrutura', '/produtos', '/profissionais', '/servicos', '/pedidos'].sort(),
    );
  });

  it('builds a contextual breadcrumb: group level only for grouped areas', () => {
    const areas = workspaceAreas(PANEL_ROUTES, { multiUnit: true });
    // Rota plana → dois níveis (Operação / Agenda), sem repetir a seção.
    expect(routeBreadcrumb('/agenda', areas).group).toBeUndefined();
    expect(routeBreadcrumb('/clientes', areas).group).toBeUndefined();
    // Rota agrupada → três níveis (Clínica / Serviços).
    expect(routeBreadcrumb('/servicos', areas).group).toBe('Clínica');
    expect(routeBreadcrumb('/equipe', areas).group).toBe('Clínica');
    expect(routeBreadcrumb('/resultados', areas).group).toBe('Gestão');
    expect(routeBreadcrumb('/configuracoes', areas).group).toBe('Configurações');
    // Rotas fora do MENU também têm dono — e o breadcrumb não inventa degrau.
    expect(routeBreadcrumb('/tarefas', areas).group).toBeUndefined();   // Operação
    expect(routeBreadcrumb('/perfil', areas).group).toBeUndefined();    // Operação
    expect(routeBreadcrumb('/execucoes', areas).group).toBe('Automação');
    expect(routeBreadcrumb('/recursos', areas).group).toBe('Configurações');
    // Rota desconhecida não inventa área.
    expect(routeBreadcrumb('/inexistente', areas)).toEqual({});
  });
});
