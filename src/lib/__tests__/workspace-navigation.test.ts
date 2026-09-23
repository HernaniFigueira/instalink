import { describe, it, expect } from 'vitest';
import { PANEL_ROUTES, panelNavigation } from '../panel';
import { workspaceAreas, switchUnitHref, routeBreadcrumb, workspaceSections } from '../workspace-navigation';

describe('360 navigation is an authorized projection', () => {
  it('keeps every destination exactly once, including contextual/legacy routes', () => {
    const routes = workspaceAreas(PANEL_ROUTES).flatMap(a => a.items.map(i => i.href));
    expect(routes.sort()).toEqual(PANEL_ROUTES.map(i => i.href).sort());
    expect(new Set(routes).size).toBe(routes.length);
  });
  for (const permissions of [{}, { agenda: true, clientes: true }, { dashboard: true, atendimento: true }, { equipe: true, config: true }]) {
    it(`never expands authorized routes: ${JSON.stringify(permissions)}`, () => {
      const nav = panelNavigation({ permissions, modes: ['services', 'bookings'], features: {} });
      const projected = workspaceAreas(nav.allowed).flatMap(a => a.items);
      expect(projected.map(r => r.href).sort()).toEqual(nav.allowed.map(r => r.href).sort());
    });
  }
  it('preserves presentation filters, strips entity IDs/searches on unit change', () => {
    const old = new URLSearchParams('b=old&data=2026-09-21&view=week&professionalId=private&member=private&booking=private&q=patient&customerId=private');
    expect(switchUnitHref('/agenda', old, 'new')).toBe('/agenda?b=new&data=2026-09-21&view=week');
    expect(switchUnitHref('/clientes', old, 'new')).toBe('/clientes?b=new');
    expect(switchUnitHref('/configuracoes', new URLSearchParams('tab=agenda&member=secret'), 'new')).toBe('/configuracoes?b=new&tab=agenda');
  });

  it('projects the new section architecture: flat links plus exactly four groups', () => {
    const areas = workspaceAreas(PANEL_ROUTES);
    const sections = workspaceSections(areas);
    expect(sections.map((s) => s.label)).toEqual([
      'Principal', 'Operação', 'Comercial', 'Presença', 'Inteligência', 'Administração',
    ]);
    const groups = sections.flatMap((s) => s.groups.filter((g) => !g.flat).map((g) => g.area.label));
    expect(groups.sort()).toEqual(['Ajustes', 'Automação', 'Estrutura da clínica', 'Gestão'].sort());
    // "Estrutura da clínica" reúne os quatro conceitos pedidos, sem unir modelos.
    const estrutura = areas.find((a) => a.id === 'estrutura')!;
    expect(estrutura.items.map((i) => i.href).sort()).toEqual(
      ['/disponibilidade', '/equipe', '/produtos', '/profissionais', '/servicos'].sort(),
    );
  });

  it('builds a contextual breadcrumb: group level only for grouped areas', () => {
    const areas = workspaceAreas(PANEL_ROUTES);
    // Rota plana → dois níveis (Clínica / Agenda), sem repetir a seção.
    expect(routeBreadcrumb('/agenda', areas).group).toBeUndefined();
    expect(routeBreadcrumb('/clientes', areas).group).toBeUndefined();
    // Rota agrupada → três níveis (Clínica / Estrutura da clínica / Serviços).
    expect(routeBreadcrumb('/servicos', areas).group).toBe('Estrutura da clínica');
    expect(routeBreadcrumb('/equipe', areas).group).toBe('Estrutura da clínica');
    expect(routeBreadcrumb('/resultados', areas).group).toBe('Gestão');
    expect(routeBreadcrumb('/configuracoes', areas).group).toBe('Ajustes');
    // Rota desconhecida não inventa área.
    expect(routeBreadcrumb('/inexistente', areas)).toEqual({});
  });
});
