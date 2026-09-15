// ═══════════════════════════════════════════════════════════════
// DASHBOARD CONTEXTUAL — construído a partir dos módulos ATIVOS
// ═══════════════════════════════════════════════════════════════
// Uma clínica de serviços/agendamentos NÃO pode enxergar "Pedidos" só porque
// o componente existia na versão antiga. Um varejo vê produtos e pedidos. Um
// negócio híbrido vê os dois — sempre separados, sem misturar conceitos.
//
// A decisão de módulo continua sendo EXCLUSIVAMENTE lib/features.ts
// (isFeatureEnabled). Este arquivo apenas traduz módulos → painéis/KPIs da
// Dashboard, e é coberto por testes.
//
// Visual: o redesign do PR #4 é preservado — linhas, painéis, divisórias,
// tabelas e KPIs compactos. Nada vira "parede de cards".
import type { Business } from './types';
import { isFeatureEnabled } from './features';
import { revenueSources, type RevenueKind } from './revenue';

export interface DashboardModules {
  bookings: boolean;
  services: boolean;
  products: boolean;
  orders: boolean;
  quote: boolean;
  whatsapp: boolean;
  agent: boolean;
  reviews: boolean;
}

/** Módulos efetivos que a Dashboard pode usar. */
export function dashboardModules(
  business: Pick<Business, 'modes' | 'features'>,
): DashboardModules {
  return {
    bookings: isFeatureEnabled(business, 'bookings'),
    services: isFeatureEnabled(business, 'services'),
    products: isFeatureEnabled(business, 'products'),
    orders: isFeatureEnabled(business, 'orders'),
    quote: isFeatureEnabled(business, 'quote'),
    whatsapp: isFeatureEnabled(business, 'whatsapp'),
    agent: isFeatureEnabled(business, 'agent'),
    reviews: isFeatureEnabled(business, 'reviews'),
  };
}

export type DashboardPanelId =
  | 'today'              // operação de hoje (agenda)
  | 'upcomingBookings'   // próximos atendimentos
  | 'revenueBookings'    // receita prevista (valor dos atendimentos)
  | 'revenueOrders'      // receita de pedidos
  | 'orders'             // atividade/resumo de pedidos
  | 'movement'           // visitantes, cliques, leads, conversões
  | 'crm'                // contatos
  | 'page'               // desempenho da página
  | 'whatsapp'           // canal WhatsApp
  | 'checklist';         // configuração pendente

/** Painel aparece? (módulo manda; nada é decidido no componente) */
export function dashboardPanelVisible(
  id: DashboardPanelId,
  m: DashboardModules,
): boolean {
  switch (id) {
    case 'today':
    case 'upcomingBookings':
      return m.bookings;
    case 'revenueBookings':
      return m.bookings || m.services;
    case 'revenueOrders':
    case 'orders':
      // "Pedidos" só existe quando o módulo de pedidos está ativo.
      return m.orders;
    case 'whatsapp':
      return m.whatsapp;
    case 'movement':
    case 'crm':
    case 'page':
    case 'checklist':
      return true;
    default:
      return false;
  }
}

export const DASHBOARD_PANELS: DashboardPanelId[] = [
  'today', 'upcomingBookings', 'revenueBookings', 'revenueOrders', 'orders',
  'movement', 'crm', 'page', 'whatsapp', 'checklist',
];

export function visibleDashboardPanels(m: DashboardModules): DashboardPanelId[] {
  return DASHBOARD_PANELS.filter((id) => dashboardPanelVisible(id, m));
}

/** KPIs compactos (linha, não card) disponíveis para o negócio. */
export type DashboardKpiId =
  | 'attendance' | 'revenueForecast' | 'revenueOrders' | 'orders'
  | 'clients' | 'visitors' | 'leads' | 'conversions';

export function visibleDashboardKpis(m: DashboardModules): DashboardKpiId[] {
  const out: DashboardKpiId[] = [];
  if (m.bookings) out.push('attendance');
  for (const kind of revenueSources(m)) {
    out.push(kind === 'bookings' ? 'revenueForecast' : 'revenueOrders');
  }
  if (m.orders) out.push('orders');
  out.push('clients', 'visitors', 'leads', 'conversions');
  return out;
}

/** Fontes de receita contextualizadas (ver lib/revenue.ts). */
export function dashboardRevenueSources(m: DashboardModules): RevenueKind[] {
  return revenueSources(m);
}

/**
 * Áreas do negócio que a Dashboard destaca — usado no subtítulo e para
 * decidir o vocabulário ("atendimentos" × "pedidos").
 */
export function dashboardAreas(m: DashboardModules): string[] {
  const out: string[] = [];
  if (m.bookings) out.push('Agenda');
  out.push('Clientes');
  if (m.services || m.bookings) out.push('Serviços');
  if (m.products) out.push('Produtos');
  if (m.orders) out.push('Pedidos');
  if (m.whatsapp || m.agent) out.push('Atendimento');
  out.push('Resultados');
  return out;
}

export interface DashboardContext {
  modules: DashboardModules;
  panels: DashboardPanelId[];
  kpis: DashboardKpiId[];
  revenue: RevenueKind[];
  areas: string[];
  /** Vocabulário do negócio (evita chamar atendimento de pedido). */
  labels: {
    activityUnit: string;   // 'atendimentos' | 'pedidos' | 'itens'
    showsOrders: boolean;
    showsBookings: boolean;
    showsProducts: boolean;
  };
}

/** Contexto completo da Dashboard para um negócio. */
export function dashboardContext(
  business: Pick<Business, 'modes' | 'features'>,
): DashboardContext {
  const modules = dashboardModules(business);
  const revenue = dashboardRevenueSources(modules);
  const showsOrders = modules.orders;
  const showsBookings = modules.bookings;
  const activityUnit = showsBookings && showsOrders
    ? 'itens'
    : showsBookings
      ? 'atendimentos'
      : showsOrders
        ? 'pedidos'
        : 'itens';
  return {
    modules,
    panels: visibleDashboardPanels(modules),
    kpis: visibleDashboardKpis(modules),
    revenue,
    areas: dashboardAreas(modules),
    labels: {
      activityUnit,
      showsOrders,
      showsBookings,
      showsProducts: modules.products,
    },
  };
}

/**
 * Atividade recente: quais listas entram. Uma clínica nunca recebe a lista de
 * pedidos (nem vazia com título "Pedidos").
 */
export function recentActivityLists(m: DashboardModules): {
  orders: boolean; bookings: boolean; leads: boolean;
} {
  return { orders: m.orders, bookings: m.bookings, leads: true };
}

// ── "Comece por aqui" — checklist LEVE e não bloqueante ───────
// Regras (obrigatórias):
//   • progresso REAL: cada item é calculado a partir de dados existentes —
//     nada é marcado como feito por padrão e nada é "inventado";
//   • itens irrelevantes para o negócio simplesmente não aparecem (ex.:
//     horários só com agenda ativa; vitrine só com produtos ativo);
//   • a área some quando não há pendência; não bloqueia nada;
//   • nenhum caminho de pedido/checkout aparece aqui.
export interface SetupCheckInput {
  business: Pick<Business, 'description' | 'logo' | 'cover' | 'whatsapp' | 'phone' | 'address' | 'published'>;
  modules: DashboardModules;
  counts: { services: number; availability: number; professionals: number; products: number };
}

export interface SetupCheckItem {
  id: string;
  done: boolean;
  label: string;
  href: string;
}

export function setupChecklist(input: SetupCheckInput): SetupCheckItem[] {
  const { business, modules, counts } = input;
  const items: SetupCheckItem[] = [];
  const hasContact = !!(String(business.whatsapp || '').trim() || String(business.phone || '').trim());
  const hasIdentity = !!(String(business.description || '').trim() || business.logo || business.cover);
  items.push({
    id: 'profile',
    done: hasIdentity && hasContact,
    label: 'Crie o perfil do negócio',
    href: '/configuracoes',
  });
  if (modules.services || modules.bookings) {
    items.push({ id: 'services', done: counts.services > 0, label: 'Cadastre seus serviços', href: '/servicos' });
  }
  if (modules.bookings) {
    items.push({ id: 'hours', done: counts.availability > 0, label: 'Configure seus horários', href: '/horarios' });
    items.push({ id: 'team', done: counts.professionals > 0, label: 'Adicione profissionais', href: '/profissionais' });
  }
  if (modules.products) {
    items.push({ id: 'products', done: counts.products > 0, label: 'Monte sua vitrine de produtos', href: '/produtos' });
  }
  items.push({ id: 'publish', done: !!business.published, label: 'Publique sua página', href: '/pagina' });
  return items;
}

/** Progresso real do checklist (0–100; sem checklist → 100, nada a fazer). */
export function setupProgress(items: SetupCheckItem[]): number {
  if (items.length === 0) return 100;
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}
