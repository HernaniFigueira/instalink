// ═══════════════════════════════════════════════════════════════
// PAINEL — rotas, permissões e visibilidade contextual
// ═══════════════════════════════════════════════════════════════
// Fonte única usada pelo DashboardShell para:
//   1. montar a navegação (permissão REAL ∩ módulos ativos);
//   2. proteger a rota no cliente: sem permissão → 403 AMIGÁVEL na tela,
//      NUNCA logout (ver lib/http.ts — somente 401 inicia fluxo de login);
//   3. rotular a área na mensagem de permissão.
//
// Esconder item de menu é UX; a segurança continua no servidor (lib/access.ts).
// Módulo PURE (sem I/O/DOM) para ser testável e reutilizável.
import type { BusinessMode, FeatureId, PermissionId } from './types';
import { areaLabel } from './http';

export interface PanelRouteDef {
  href: string;
  label: string;
  icon: string;
  /** Rótulo da seção da sidebar (Dashboard fica fora de seção). */
  section?: string;
  /** Permissão independente exigida (dashboard continua sendo uma delas). */
  permission: PermissionId;
  /** Só aparece quando ALGUM destes módulos comerciais estiver ativo. */
  modes?: BusinessMode[];
  /** Só aparece quando ALGUM destes módulos opcionais estiver ativo. */
  features?: FeatureId[];
  /** Chave de área para mensagens de permissão (lib/http). */
  area?: string;
  /**
   * true = fora da navegação do produto (legado ainda funcional por URL
   * direta para empresas que já têm o módulo ativo). Nunca aparece no menu.
   */
  hidden?: boolean;
}

// Ordem canônica da navegação — reflete o novo posicionamento:
//   Operacional → Catálogo → Atendimento → Gestão → Presença → Administração.
// Pedidos não é mais caminho principal: a rota continua existente (histórico
// legado acessível por URL para quem tem o módulo), mas fora da navegação.
export const PANEL_ROUTES: PanelRouteDef[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'home', permission: 'dashboard', area: 'dashboard' },
  // Operacional — o centro do produto
  { href: '/agenda', label: 'Agenda', icon: 'calendar', section: 'Operacional', modes: ['bookings'], permission: 'agenda', area: 'agenda' },
  { href: '/clientes', label: 'Clientes', icon: 'users', section: 'Operacional', permission: 'clientes', area: 'clientes' },
  // Catálogo
  { href: '/servicos', label: 'Serviços', icon: 'scissors', section: 'Catálogo', modes: ['services', 'bookings'], permission: 'catalogo', area: 'servicos' },
  { href: '/produtos', label: 'Produtos', icon: 'cart', section: 'Catálogo', modes: ['products', 'orders'], permission: 'catalogo', area: 'catalogo' },
  // Atendimento
  { href: '/whatsapp', label: 'WhatsApp', icon: 'whatsapp', section: 'Atendimento', permission: 'whatsapp', area: 'whatsapp' },
  { href: '/agente', label: 'Assistente', icon: 'spark', section: 'Atendimento', permission: 'agente', area: 'agente' },
  // Gestão
  { href: '/resultados', label: 'Resultados', icon: 'chart', section: 'Gestão', permission: 'financeiro', area: 'resultados' },
  { href: '/campanhas', label: 'Campanhas', icon: 'megaphone', section: 'Gestão', permission: 'campanhas', area: 'campanhas' },
  // Presença — a página pública é construída AQUI (editor), não em Configurações
  { href: '/pagina', label: 'Página', icon: 'link', section: 'Presença', permission: 'pagina', area: 'pagina' },
  // Administração
  { href: '/equipe', label: 'Equipe', icon: 'users', section: 'Administração', permission: 'equipe', area: 'equipe' },
  { href: '/recursos', label: 'Recursos', icon: 'toggle', section: 'Administração', permission: 'config', area: 'recursos' },
  { href: '/configuracoes', label: 'Configurações', icon: 'settings', section: 'Administração', permission: 'config', area: 'config' },
  // Legado (fora da navegação; a rota e o histórico continuam preservados
  // para empresas que já recebiam pedidos)
  { href: '/pedidos', label: 'Pedidos', icon: 'receipt', modes: ['orders', 'products'], permission: 'pedidos', area: 'pedidos', hidden: true },
];

/** Rotas que usam a largura toda (sem container estreito). */
export const FULL_WIDTH_PATHS = PANEL_ROUTES
  .filter((r) => ['/dashboard', '/agenda', '/resultados', '/clientes', '/whatsapp', '/campanhas', '/servicos', '/pedidos', '/equipe'].includes(r.href))
  .map((r) => r.href);

export interface PanelContext {
  permissions: Partial<Record<PermissionId, boolean>>;
  modes: BusinessMode[];
  features: Partial<Record<FeatureId, boolean>>;
}

export function emptyPanelContext(): PanelContext {
  return { permissions: {}, modes: [], features: {} };
}

export function panelRouteFor(pathname: string): PanelRouteDef | undefined {
  const clean = String(pathname || '').replace(/\/+$/, '') || '/';
  return PANEL_ROUTES.find((r) => r.href === clean);
}

/** Permissão exigida por um caminho do painel ('' = rota sem guarda própria). */
export function permissionForPath(pathname: string): PermissionId | '' {
  return panelRouteFor(pathname)?.permission || '';
}

function hasMode(route: PanelRouteDef, ctx: PanelContext): boolean {
  if (!route.modes) return true;
  const modes = ctx.modes || [];
  return route.modes.some((m) => modes.includes(m));
}

function hasFeature(route: PanelRouteDef, ctx: PanelContext): boolean {
  if (!route.features) return true;
  const features = ctx.features || {};
  return route.features.some((f) => (features as Record<string, boolean>)[f] === true);
}

export function hasPermission(permission: PermissionId, ctx: PanelContext): boolean {
  return (ctx.permissions || {})[permission] === true;
}

/**
 * Rota visível na NAVEGAÇÃO? (permissão ∩ módulos — e nunca `hidden`).
 * Rotas ocultas continuam acessíveis por URL quando o módulo existe: a
 * guarda de acesso (panelAccess) não usa este filtro.
 */
export function isPanelRouteVisible(route: PanelRouteDef, ctx: PanelContext): boolean {
  if (route.hidden) return false;
  return hasPermission(route.permission, ctx) && hasMode(route, ctx) && hasFeature(route, ctx);
}

export function visiblePanelRoutes(ctx: PanelContext): PanelRouteDef[] {
  return PANEL_ROUTES.filter((r) => isPanelRouteVisible(r, ctx));
}

export interface PanelSection {
  label: string;
  items: PanelRouteDef[];
}

/** Itens agrupados para a sidebar: Dashboard primeiro, demais por seção. */
export function panelNavigation(ctx: PanelContext): {
  primary: PanelRouteDef | null;
  sections: PanelSection[];
  all: PanelRouteDef[];
} {
  const items = visiblePanelRoutes(ctx);
  const primary = items.find((r) => r.href === '/dashboard') || null;
  const rest = items.filter((r) => r.href !== '/dashboard');
  const grouped = new Map<string, PanelRouteDef[]>();
  for (const it of rest) {
    const key = it.section || 'Outros';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(it);
  }
  const sections: PanelSection[] = [];
  for (const [label, list] of grouped) sections.push({ label, items: list });
  return { primary, sections, all: items };
}

export type PanelAccessState = 'allow' | 'denied' | 'unknown';

export interface PanelAccess {
  state: PanelAccessState;
  route?: PanelRouteDef;
  /** Rótulo da área para a mensagem de 403 (vazio quando desconhecida). */
  area: string;
  /** Motivo da negativa (permissão ausente ou módulo desativado). */
  reason: 'permission' | 'module' | '';
}

/**
 * Acesso do usuário à rota atual do painel.
 *  - 'allow'   → renderiza a tela;
 *  - 'denied'  → renderiza o aviso de 403 amigável (usuário continua logado);
 *  - 'unknown' → rota fora do catálogo (ex.: /onboarding) → sem guarda aqui.
 */
export function panelAccess(pathname: string, ctx: PanelContext): PanelAccess {
  const route = panelRouteFor(pathname);
  if (!route) return { state: 'unknown', area: '', reason: '' };
  if (!hasPermission(route.permission, ctx)) {
    return { state: 'denied', route, area: areaLabel(route.area), reason: 'permission' };
  }
  if (!hasMode(route, ctx) || !hasFeature(route, ctx)) {
    return { state: 'denied', route, area: areaLabel(route.area), reason: 'module' };
  }
  return { state: 'allow', route, area: areaLabel(route.area), reason: '' };
}

/**
 * Primeira rota permitida — usada para nunca deixar o usuário sem destino
 * quando ele não tem `dashboard` (ex.: VIEWER com agenda liberada).
 */
export function firstAllowedPath(ctx: PanelContext): string {
  const { all } = panelNavigation(ctx);
  return all[0]?.href || '';
}

// ── Guardas de servidor esperados por área ────────────────────
// Mapa declarativo: cada API do painel e a permissão que ela DEVE exigir em
// `requireBusiness(...)`. Coberto por teste de regressão (panel.test.ts), que
// lê o código-fonte das rotas — assim ninguém remove a guarda por engano.
export const API_GUARDS: Array<{ route: string; file: string; permission: PermissionId | PermissionId[]; area: string }> = [
  { route: '/api/overview', file: 'src/app/api/overview/route.ts', permission: 'dashboard', area: 'dashboard' },
  { route: '/api/team', file: 'src/app/api/team/route.ts', permission: 'equipe', area: 'equipe' },
  { route: '/api/businesses/:id', file: 'src/app/api/businesses/[id]/route.ts', permission: 'config', area: 'config' },
  { route: '/api/bookings', file: 'src/app/api/bookings/route.ts', permission: 'agenda', area: 'agenda' },
  { route: '/api/whatsapp', file: 'src/app/api/whatsapp/route.ts', permission: 'whatsapp', area: 'whatsapp' },
  { route: '/api/catalog', file: 'src/app/api/catalog/route.ts', permission: 'catalogo', area: 'catalogo' },
  { route: '/api/campaigns', file: 'src/app/api/campaigns/route.ts', permission: 'campanhas', area: 'campanhas' },
  { route: '/api/agent', file: 'src/app/api/agent/route.ts', permission: 'agente', area: 'agente' },
  { route: '/api/pages', file: 'src/app/api/pages/route.ts', permission: 'pagina', area: 'pagina' },
  { route: '/api/analytics', file: 'src/app/api/analytics/route.ts', permission: 'financeiro', area: 'resultados' },
  { route: '/api/orders', file: 'src/app/api/orders/route.ts', permission: 'pedidos', area: 'pedidos' },
  { route: '/api/people360', file: 'src/app/api/people360/route.ts', permission: 'clientes', area: 'clientes' },
  { route: '/api/contacts', file: 'src/app/api/contacts/route.ts', permission: 'clientes', area: 'clientes' },
  { route: '/api/leads', file: 'src/app/api/leads/route.ts', permission: 'leads', area: 'clientes' },
  // Leitura de catálogo é compartilhada (serviços/profissionais alimentam
  // agenda, clientes e pedidos) — a ESCRITA continua em 'catalogo'.
  {
    route: '/api/catalog/get',
    file: 'src/app/api/catalog/get/route.ts',
    permission: ['catalogo', 'agenda', 'clientes', 'pedidos', 'config', 'pagina'],
    area: 'catalogo',
  },
];
