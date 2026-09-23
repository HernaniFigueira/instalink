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
import type { Business, PermissionId } from './types';
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
 * Áreas do negócio que a Dashboard destaca — REMOVIDA no A1.2 · Bloco 4:
 * repetia a navegação/contexto que o shell (catálogo lib/panel.ts) já fornece,
 * virando um subtítulo redundante ("Dashboard · Agenda · Clientes · …").
 * O vocabulário do negócio continua decidido por `dashboardContext().labels`.
 */

export interface DashboardContext {
  modules: DashboardModules;
  panels: DashboardPanelId[];
  kpis: DashboardKpiId[];
  revenue: RevenueKind[];
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
    labels: {
      activityUnit,
      showsOrders,
      showsBookings,
      showsProducts: modules.products,
    },
  };
}

// ── A1.2 · Bloco 4 — ATENÇÃO e "ONDE AGIR" ──────────────────
// A região de atenção reúne, num único lugar e na ordem de leitura, o que
// precisa de decisão HOJE. Só entram categorias com DADO CONFIÁVEL já
// existente no sistema (pendências de fechamento da agenda, leads sem
// primeiro tratamento, tarefas vencidas) — nada de novo sistema de alertas,
// notificação ou scheduler. O link só vai junto quando o usuário PODE abrir
// a rota (permissão do catálogo): ninguém é enviado para porta proibida.

export interface DashboardAttentionItem {
  id: 'closures' | 'leadsNew' | 'tasksOverdue' | 'queueWaiting' | 'arrivalsPending' | 'returnsDue';
  count: number;
  label: string;
  /** Destino contextual — presente somente com permissão para a rota. */
  href: string | null;
}

export interface DashboardAttentionInput {
  /** Atendimentos com horário já passado e ainda em aberto (agenda). */
  closures: number;
  /** Leads com status 'new' (sem primeiro tratamento). */
  leadsNew: number;
  /** Tarefas abertas com prazo vencido (lib/automation/tasks). */
  tasksOverdue: number;
  /** A3.4 · Bloco 4 — gente esperando no balcão (lib/queue). */
  queueWaiting?: number;
  /** A3.4 · Bloco 4 — chegou hoje e o check-in ainda não foi registrado. */
  arrivalsPending?: number;
  /** FASE 2 · P10 — retornos vencidos/hoje sem novo agendamento (Paciente 360). */
  returnsDue?: number;
  permissions: {
    agenda: boolean;
    leads: boolean;
    /** Qualquer uma das permissões da porta /tarefas. */
    tasks: boolean;
    /** FASE 2 · P10 — rota /followup (perfis com config ou clientes). */
    followUp?: boolean;
  };
}

export function dashboardAttention(input: DashboardAttentionInput): DashboardAttentionItem[] {
  const out: DashboardAttentionItem[] = [];
  if (input.closures > 0) {
    out.push({
      id: 'closures', count: input.closures, label: 'atendimentos para fechar',
      href: input.permissions.agenda ? '/agenda' : null,
    });
  }
  if (input.leadsNew > 0) {
    out.push({
      id: 'leadsNew', count: input.leadsNew, label: 'leads sem tratamento',
      href: input.permissions.leads ? '/funil' : null,
    });
  }
  if (input.tasksOverdue > 0) {
    out.push({
      id: 'tasksOverdue', count: input.tasksOverdue, label: 'tarefas vencidas',
      href: input.permissions.tasks ? '/tarefas' : null,
    });
  }
  // A3.4 · Bloco 4: a operação do balcão também é "atenção de hoje" — quem
  // espera na fila e quem chegou sem check-in. Só aparece com dado real.
  if ((input.queueWaiting || 0) > 0) {
    out.push({
      id: 'queueWaiting', count: input.queueWaiting || 0, label: 'esperando na fila',
      href: input.permissions.agenda ? '/agenda' : null,
    });
  }
  if ((input.arrivalsPending || 0) > 0) {
    out.push({
      id: 'arrivalsPending', count: input.arrivalsPending || 0, label: 'chegaram sem check-in',
      href: input.permissions.agenda ? '/agenda' : null,
    });
  }
  // FASE 2 · P10 — retorno do profissional venceu e o paciente não voltou.
  if ((input.returnsDue || 0) > 0) {
    out.push({
      id: 'returnsDue', count: input.returnsDue || 0,
      label: input.returnsDue === 1 ? 'retorno pendente' : 'retornos pendentes',
      href: input.permissions.followUp === false ? null : '/followup',
    });
  }
  return out;
}

/**
 * Mapa de permissão das PORTAS que a Dashboard menciona. O servidor calcula
 // uma única vez; a tela não chuta destino: sem permissão, o item vira texto
 * (informação preservada) ou deixa de ser link — nunca um 403 desnecessário.
 */
export interface DashboardLinkFlags {
  agenda: boolean;
  funil: boolean;
  clientes: boolean;
  pedidos: boolean;
  produtos: boolean;
  pagina: boolean;
  conversas: boolean;
  resultados: boolean;
  canais: boolean;
  configuracoes: boolean;
  /** FASE 2 · P10 — porta /followup (mesma permissão de config). */
  followUp: boolean;
}

export function dashboardLinks(
  permissions: Partial<Record<import('./types').PermissionId, boolean>>,
): DashboardLinkFlags {
  const has = (p: import('./types').PermissionId): boolean => permissions[p] === true;
  return {
    agenda: has('agenda'),
    funil: has('leads'),
    clientes: has('clientes'),
    pedidos: has('pedidos'),
    produtos: has('catalogo'),
    pagina: has('pagina'),
    conversas: has('whatsapp'),
    resultados: has('financeiro'),
    // Canais & Integrações e Configurações vivem atrás da MESMA permissão
    // (config) — catálogo lib/panel.ts.
    canais: has('config'),
    configuracoes: has('config'),
    followUp: has('config'),
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
  business: Pick<Business, 'description' | 'logo' | 'cover' | 'whatsapp' | 'phone' | 'address' | 'published'>
    & { setupSkipped?: string[] };
  modules: DashboardModules;
  counts: { services: number; availability: number; professionals: number; products: number };
  /** FASE 2 · P8 — a página já foi personalizada de verdade (blocos/navegação/sobre). */
  pageCustomized?: boolean;
  /** FASE 2 · P8 — WhatsApp oficial conectado (item OPCIONAL do checklist). */
  whatsappConnected?: boolean;
}

export interface SetupCheckItem {
  id: string;
  done: boolean;
  label: string;
  href: string;
  /** FASE 2 · P8 — item não obrigatório: pode ser pulado sem travar o progresso. */
  optional?: boolean;
}

// FASE 2 · P8 — caminho operacional (ordem do ciclo de abrir a clínica):
// dados → serviço → profissional → horários → (vitrine) → personalizar →
// publicar → (opcional) WhatsApp. Progresso REAL; pular só o opcional;
// "continuar depois" = ocultar o bloco (nada é perdido).
export function setupChecklist(input: SetupCheckInput): SetupCheckItem[] {
  const { business, modules, counts } = input;
  const items: SetupCheckItem[] = [];
  const skipped = new Set(Array.isArray(business.setupSkipped) ? business.setupSkipped : []);
  const hasContact = !!(String(business.whatsapp || '').trim() || String(business.phone || '').trim());
  const hasIdentity = !!(String(business.description || '').trim() || business.logo || business.cover);
  const push = (item: SetupCheckItem) => {
    // Só OBRIGATÓRIOS podem ser pulados? Não: apenas `optional` honra o skip —
    // um id obrigatório em setupSkipped (dado malicioso/legado) é ignorado.
    // Item pulado conta como resolvido: o opcional nunca trava o 100%.
    const honored = item.optional === true && skipped.has(item.id);
    items.push(honored ? { ...item, done: true } : item);
  };
  push({
    id: 'profile',
    done: hasIdentity && hasContact,
    label: 'Dados da clínica',
    href: '/configuracoes',
  });
  if (modules.services || modules.bookings) {
    push({ id: 'services', done: counts.services > 0, label: 'Cadastre o primeiro serviço', href: '/servicos' });
  }
  if (modules.bookings) {
    // Ordem do ciclo (P8): quem realiza ANTES de quando atende.
    push({ id: 'team', done: counts.professionals > 0, label: 'Cadastre um profissional', href: '/profissionais' });
    push({ id: 'hours', done: counts.availability > 0, label: 'Configure os horários', href: '/disponibilidade' });
  }
  if (modules.products) {
    push({ id: 'products', done: counts.products > 0, label: 'Monte sua vitrine de produtos', href: '/produtos' });
  }
  push({
    id: 'personalize',
    done: input.pageCustomized === true,
    label: 'Personalize a página',
    href: '/pagina',
  });
  push({ id: 'publish', done: !!business.published, label: 'Publique a página', href: '/pagina' });
  push({
    id: 'whatsapp',
    done: input.whatsappConnected === true,
    label: 'Conecte o WhatsApp',
    href: '/canais',
    optional: true,
  });
  return items;
}

/** Progresso real do checklist (0–100; sem checklist → 100, nada a fazer). */
export function setupProgress(items: SetupCheckItem[]): number {
  if (items.length === 0) return 100;
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}
