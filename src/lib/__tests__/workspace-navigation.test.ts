import { describe, it, expect } from 'vitest';
import { PANEL_ROUTES, panelNavigation } from '../panel';
import {
  workspaceAreas, switchUnitHref, routeBreadcrumb, workspaceSections,
  workspaceRailItems, workspacePanelItems, OFF_MENU_ROUTES, CONTEXTUAL_ONLY_ROUTES,
} from '../workspace-navigation';

describe('360 navigation is an authorized projection', () => {
  it('keeps every destination exactly once, including contextual/legacy routes', () => {
    // PARTIÇÃO TOTAL — o invariante que protege contra "rota que sumiu do menu
    // e virou porta fantasma". Com MAIS DE UMA unidade a partição cobre o
    // catálogo inteiro MENOS a Página legada (Clinical OS F0: fora da
    // navegação operacional por padrão; GODOUTOR_LEGACY_PAGES reativa). Com
    // uma unidade só, soma-se a supressão de "Organização" (quem tem uma
    // unidade não precisa pensar em organização). TODA rota suprimida segue
    // acessível por URL — supressão é apresentação, nunca bloqueio.
    const all = workspaceAreas(PANEL_ROUTES, { multiUnit: true }).flatMap(a => a.items.map(i => i.href));
    expect(all.sort()).toEqual(PANEL_ROUTES.filter(i => i.href !== '/pagina').map(i => i.href).sort());
    expect(all).toContain('/atendimento');
    expect(new Set(all).size).toBe(all.length);

    const single = workspaceAreas(PANEL_ROUTES).flatMap(a => a.items.map(i => i.href));
    expect(single.sort()).toEqual(PANEL_ROUTES.filter(i => i.href !== '/organizacao' && i.href !== '/pagina').map(i => i.href).sort());
    expect(new Set(single).size).toBe(single.length);

    // Contrato da flag: GODOUTOR_LEGACY_PAGES=1 restaura a Página na
    // partição total (sem migração, sem perda).
    const legacy = workspaceAreas(PANEL_ROUTES, { multiUnit: true, legacyPages: true }).flatMap(a => a.items.map(i => i.href));
    expect(legacy.sort()).toEqual(PANEL_ROUTES.map(i => i.href).sort());
    expect(new Set(legacy).size).toBe(legacy.length);
  });
  for (const permissions of [{}, { agenda: true, clientes: true }, { dashboard: true, atendimento: true }, { equipe: true, config: true }]) {
    it(`never expands authorized routes: ${JSON.stringify(permissions)}`, () => {
      const nav = panelNavigation({ permissions, modes: ['services', 'bookings'], features: {} });
      const projected = workspaceAreas(nav.allowed, { multiUnit: true }).flatMap(a => a.items);
      expect(projected.map(r => r.href).sort()).toEqual(nav.allowed.map(r => r.href).sort());
    });
  }
  it('A2 · /atendimento continua autorizado e contextual, mas não ocupa navegação persistente', () => {
    // A rota clínica continua declarada e com área dona (breadcrumb/filhas),
    // porém só deve abrir a partir da entidade que a contextualiza: Agenda,
    // Fila ou Cliente 360. Não é uma porta fixa de menu.
    const nav = panelNavigation({ permissions: { atendimento: true }, modes: ['services', 'bookings'], features: {} });
    expect(nav.allowed.some((r) => r.href === '/atendimento')).toBe(true);
    expect(nav.sidebar.some((r) => r.href === '/atendimento')).toBe(false);
    expect(nav.more.some((r) => r.href === '/atendimento')).toBe(true);
    const areas = workspaceAreas(nav.allowed, { multiUnit: true });
    const clinica = areas.find((a) => a.id === 'clinica')!;
    expect(clinica.items.some((r) => r.href === '/atendimento')).toBe(true);
    expect(workspaceRailItems(clinica).map((r) => r.href)).not.toContain('/atendimento');
    expect(workspacePanelItems(clinica).map((r) => r.href)).not.toContain('/atendimento');
    // A flag legada também não pode reintroduzir essa porta persistente.
    expect(workspacePanelItems(clinica, { legacyPages: true }).map((r) => r.href)).not.toContain('/atendimento');
    expect(CONTEXTUAL_ONLY_ROUTES).toContain('/atendimento');
    expect(areas.some((a) => a.id === 'mais')).toBe(false);
  });

  it('PARTIÇÃO TOTAL também no painel: nenhuma área inventa destino, nenhuma rota some', () => {
    const permissions = {
      dashboard: true, agenda: true, clientes: true, leads: true, catalogo: true,
      pagina: true, equipe: true, financeiro: true, config: true, agente: true,
      campanhas: true, whatsapp: true, pedidos: true, atendimento: true,
    };
    const nav = panelNavigation({ permissions, modes: ['services', 'bookings'], features: {} });
    const areas = workspaceAreas(nav.allowed, { multiUnit: true });
    const panel = areas.flatMap((a) => workspacePanelItems(a).map((r) => r.href));
    const rail = areas.flatMap((a) => workspaceRailItems(a).map((r) => r.href));
    // Painel = catálogo autorizado inteiro MENOS a Página legada (flag), MENOS
    // os alias de compatibilidade E MENOS os destinos que por decisão de produto
    // não ocupam MENU com a experiência padrão (P0 · rodada 2: comércio
    // legado/diagnóstico — a rota segue autorizada e viva por URL, e continua
    // alcançável DENTRO da tela que a explica).
    expect(panel.sort()).toEqual(
      nav.allowed
        .filter((r) => r.href !== '/pagina' && r.href !== '/profissionais' && !OFF_MENU_ROUTES.includes(r.href) && !CONTEXTUAL_ONLY_ROUTES.includes(r.href))
        .map((r) => r.href)
        .sort(),
    );
    // Contrato da supressão: os destinos suprimidos são EXATAMENTE os
    // declarados — nada de supressão implícita decidida na tela.
    for (const href of [...OFF_MENU_ROUTES, ...CONTEXTUAL_ONLY_ROUTES]) {
      if (!nav.allowed.some((r) => r.href === href)) continue;
      expect(panel, href).not.toContain(href);
      expect(rail, href).not.toContain(href);
    }
    expect(new Set(panel).size).toBe(panel.length);
    expect(new Set(rail).size).toBe(rail.length);
    for (const href of rail) expect(panel, href).toContain(href);
    expect(rail).not.toContain('/atendimento'); // contextual: não é porta persistente
    expect(rail).not.toContain('/execucoes');
  });

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
    // Clinical OS F0: a Página legada está FORA por padrão — só "principal".
    const flat = sections.flatMap((s) => s.groups.filter((g) => g.flat).map((g) => g.area.id));
    expect(flat).toEqual(['principal']);
    // E com a flag reativada, a Página volta como link direto.
    const legacyAreas = workspaceAreas(PANEL_ROUTES, { multiUnit: true, legacyPages: true });
    const legacyFlat = workspaceSections(legacyAreas).flatMap((s) => s.groups.filter((g) => g.flat).map((g) => g.area.id));
    expect(legacyFlat).toEqual(['principal', 'presenca']);

    // Nenhuma porta fora do menu ocupa linha no menu (GODOUTOR final:
    // Pendências VOLTOU à linha — é fila de trabalho da recepção).
    const rendered = sections.flatMap((s) => s.groups.flatMap(({ area, flat: isFlat }) =>
      (isFlat ? area.items : []).filter((i) => i.sidebar !== false).map((i) => i.href)));
    expect(rendered).not.toContain('/execucoes');
    expect(rendered).toContain('/tarefas');
    expect(rendered).not.toContain('/perfil');

    // "Clínica" reúne os conceitos pedidos SEM unir modelos (Professional e
    // Member continuam separados) e sem perder nenhum destino.
    const clinica = areas.find((a) => a.id === 'clinica')!;
    expect(clinica.items.map((i) => i.href).sort()).toEqual(
      ['/atendimento', '/disponibilidade', '/equipe', '/estrutura', '/produtos', '/profissionais', '/servicos', '/pedidos'].sort(),
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
