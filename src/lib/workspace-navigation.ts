import type { PanelRouteDef } from './panel';

// Presentation only. Routes and authorization remain owned by panel.ts.
// Operational order comes from PANEL_ROUTES (historical Operação/Pessoas/Oferta).
export const WORKSPACE_AREAS = [
  { id: 'automation', label: 'Automação', icon: 'bolt', color: '#B45309', routes: ['/automacoes', '/execucoes', '/agente', '/campanhas'] },
  { id: 'management', label: 'Gestão', icon: 'chart', color: '#0369A1', routes: ['/resultados', '/equipe'] },
  { id: 'settings', label: 'Ajustes', icon: 'settings', color: '#526174', routes: ['/configuracoes', '/recursos', '/canais'] },
] as const;
export function workspaceAreas(allowed: PanelRouteDef[]) {
  const groups = WORKSPACE_AREAS.map(area => ({ ...area, items: allowed.filter(route => (area.routes as readonly string[]).includes(route.href)) })).filter(area => area.items.length);
  const grouped = new Set(groups.flatMap(g => g.items.map(i => i.href)));
  return [{ id: 'operations', label: 'Operação', icon: 'calendar', color: '#007FA3', items: allowed.filter(i => !grouped.has(i.href)) }, ...groups].filter(g => g.items.length);
}
export function routeAreaColor(path: string) {
  if (['/clientes','/funil'].includes(path)) return '#7C3AED';
  if (path === '/conversas') return '#047857';
  return WORKSPACE_AREAS.find(a => (a.routes as readonly string[]).includes(path))?.color || '#007FA3';
}

/** Only presentation filters cross units. Never carry entity IDs or text searches. */
export function switchUnitHref(pathname: string, params: URLSearchParams, businessId: string) {
  const next = new URLSearchParams({ b: businessId });
  const keys = pathname === '/agenda' ? ['data', 'view']
    : ['/pagina', '/configuracoes', '/canais'].includes(pathname) ? ['tab'] : [];
  for (const key of keys) {
    const value = params.get(key);
    if (value) next.set(key, value);
  }
  return `${pathname}?${next}`;
}
