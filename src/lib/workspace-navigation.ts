import type { PanelRouteDef } from './panel';

// Presentation only. Routes and authorization remain owned by panel.ts.
export const WORKSPACE_AREAS = [
  { id: 'overview', label: 'Visão geral', short: 'Início', icon: 'home', routes: ['/dashboard'] },
  { id: 'care', label: 'Atendimento', short: 'Atender', icon: 'calendar', routes: ['/agenda', '/conversas', '/tarefas', '/pedidos'] },
  { id: 'people', label: 'Pacientes e clientes', short: 'Pessoas', icon: 'users', routes: ['/clientes', '/funil'] },
  { id: 'page', label: 'Página da clínica', short: 'Página', icon: 'globe', routes: ['/pagina'] },
  { id: 'automation', label: 'Automação', short: 'Automação', icon: 'bolt', routes: ['/automacoes', '/execucoes', '/agente', '/campanhas'] },
  { id: 'management', label: 'Gestão', short: 'Gestão', icon: 'chart', routes: ['/resultados', '/equipe', '/profissionais', '/servicos', '/disponibilidade', '/produtos', '/organizacao'] },
  { id: 'settings', label: 'Configurações', short: 'Ajustes', icon: 'settings', routes: ['/configuracoes', '/recursos', '/canais'] },
] as const;

export function workspaceAreas(allowed: PanelRouteDef[]) {
  return WORKSPACE_AREAS.map(area => ({ ...area,
    items: area.routes.flatMap(href => allowed.filter(route => route.href === href)),
  })).filter(area => area.items.length > 0);
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
