import { describe, it, expect } from 'vitest';
import { PANEL_ROUTES, panelNavigation } from '../panel';
import { workspaceAreas, switchUnitHref } from '../workspace-navigation';

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
});
