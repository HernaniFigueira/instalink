// ═══════════════════════════════════════════════════════════════
// RESULTADOS / INTELIGÊNCIA (P2) — matemática pura, sem I/O
// ═══════════════════════════════════════════════════════════════
// Responde "como está o meu negócio?" com DADOS REAIS. Regras invioláveis:
//
//   1. NUNCA inventar número. Sem base confiável → estado neutro com
//      explicação (`hasData: false` + `noDataHint`) — nada de mock, nada de
//      estimativa decorativa.
//   2. CADA INDICADOR USA A DATA SEMANTICAMENTE CORRETA:
//        agendamentos / atendimentos / concluídos / cancelados / faltas
//          → data do ATENDIMENTO (`Booking.date`);
//        receita prevista
//          → data do ATENDIMENTO (regra de lib/revenue.ts);
//        novos clientes
//          → data de CADASTRO na base (`Contact.createdAt`);
//        leads / conversão de leads
//          → data de CRIAÇÃO do lead (`Lead.createdAt`);
//        receita de pedidos
//          → data de criação do pedido (regra de lib/revenue.ts).
//      Criar em um período e atender em outro NÃO mistura os dois: um
//      agendamento criado hoje para daqui a 20 dias conta no período do
//      atendimento, não no de hoje.
//   3. COMPARAÇÃO sempre com o período IMEDIATAMENTE ANTERIOR de mesma
//      duração. Sem base anterior (`prev <= 0`) → `deltaPct: null` (a tela
//      mostra "sem base de comparação", não "-100%" nem "+∞").
//   4. "Chegou" (check-in) NÃO existe no modelo de dados atual — o estágio
//      aparece como NÃO RASTREADO e o funil explica isso em uma frase.
//   5. Receita registrada/realizada só aparece quando existe base confiável
//      (módulo de pedidos: total de pedidos não cancelados). Atendimentos não
//      têm registro de pagamento → estado neutro explicado.
//
// Módulo PURO: coberto por src/lib/__tests__/insights.test.ts.
import type { BookingStatus, DB } from './types';
import {
  bookingRevenue, orderRevenue, REVENUE_HINTS, REVENUE_LABELS, REVENUE_UNIT_LABELS,
  type OrderRevenueItem, type RevenueResult,
} from './revenue';
import { pctChange } from './analytics';
import { leadOriginLabel, leadOriginRank } from './leads';

export interface Window { from: string; to: string }

export interface BookingRow {
  id: string;
  status: BookingStatus;
  /** Data do ATENDIMENTO (YYYY-MM-DD). */
  date: string;
  serviceId: string;
  professionalId?: string;
}

export interface ContactRow { id: string; createdAt: string }
export interface LeadRow { id: string; status: string; origin: string; createdAt: string }
export interface ServiceRow { id: string; name: string; price: number }
export interface ProfessionalRow { id: string; name: string }

export interface ResultsInput {
  window: Window;
  previous?: Window | null;
  bookings: BookingRow[];
  contacts?: ContactRow[];
  leads?: LeadRow[];
  services?: ServiceRow[];
  professionals?: ProfessionalRow[];
  /** Pedidos (só quando o módulo existe) — base da receita registrada. */
  orders?: OrderRevenueItem[];
  hasBookingsModule?: boolean;
  hasOrdersModule?: boolean;
}

export type MetricUnit = 'count' | 'money' | 'percent';

export interface Metric {
  id: string;
  label: string;
  value: number;
  unit: MetricUnit;
  hint: string;
  /** false → a tela mostra estado neutro + `noDataHint`. */
  hasData: boolean;
  noDataHint?: string;
  prev: number | null;
  deltaPct: number | null;
}

export interface FunnelStep {
  id: string;
  label: string;
  value: number;
  hint: string;
  /** false = estágio que o modelo atual NÃO registra (não inventamos dado). */
  tracked: boolean;
  group: 'lead' | 'booking';
  /** % vs etapa anterior DO MESMO grupo (1ª = 100). null quando sem base. */
  rate: number | null;
}

export interface ServicePerformance {
  id: string;
  name: string;
  bookings: number;
  completed: number;
  cancelled: number;
  noShow: number;
  /** Centavos — soma dos atendimentos elegíveis (pendentes+confirmados+concluídos). */
  revenue: number;
}

export interface ProfessionalPerformance {
  id: string;
  name: string;
  bookings: number;
  completed: number;
  cancelled: number;
  noShow: number;
  /** Serviços DIFERENTES concluídos pelo profissional no período. */
  servicesDone: number;
  revenue: number;
}

export interface OriginPerformance {
  name: string;
  leads: number;
  converted: number;
  rate: number;
}

export interface RegisteredRevenue {
  available: boolean;
  kind: 'orders' | null;
  result: RevenueResult | null;
  reason: string;
}

export interface SectionState<T> {
  available: boolean;
  reason: string;
  rows: T[];
}

export interface ResultsPayload {
  period: {
    from: string; to: string;
    prevFrom: string; prevTo: string;
    hasPrevious: boolean;
    label: string;
  };
  modules: { bookings: boolean; orders: boolean };
  metrics: Metric[];
  funnel: {
    steps: FunnelStep[];
    losses: Array<{ id: string; label: string; value: number; hint: string }>;
    note: string;
  };
  services: SectionState<ServicePerformance>;
  professionals: SectionState<ProfessionalPerformance>;
  origins: SectionState<OriginPerformance>;
  revenue: {
    forecast: RevenueResult | null;
    forecastPriced: boolean;
    registered: RegisteredRevenue;
    labels: Record<string, string>;
    hints: Record<string, string>;
    unitLabels: Record<string, string>;
  };
  /** Limitações conhecidas, em linguagem simples (mostradas na tela). */
  limitations: string[];
  hasAnyData: boolean;
  emptyHint: string;
}

// ═══════════════════════════════════════════════════════════════
// COLETA A PARTIR DO BANCO (fonte única de montagem)
// ═══════════════════════════════════════════════════════════════
// A MESMA função serve a tela Resultados (uma unidade), a visão consolidada
// da Organização (várias unidades acessíveis) e o resumo da Dashboard.
// Recebe SOMENTE as unidades que o usuário pode ver: quem monta a lista é a
// camada de acesso — nunca o parâmetro de um cliente.
export interface ResultsUnit {
  id: string;
  hasBookings: boolean;
  hasOrders: boolean;
}

/** Linha de atendimento → entrada do motor (sem trazer dado sensível da agenda). */
export function bookingRow(b: { id: string; status: BookingStatus; date: string; serviceId: string; professionalId?: string }): BookingRow {
  return { id: b.id, status: b.status, date: b.date, serviceId: b.serviceId, professionalId: b.professionalId || '' };
}

export function leadRow(l: { id: string; status: string; origin: string; createdAt: string }): LeadRow {
  return { id: l.id, status: l.status, origin: l.origin, createdAt: l.createdAt };
}

/**
 * Monta o payload de resultados para um CONJUNTO de unidades.
 * `label` descreve o recorte na tela ("no período" / "em 3 unidade(s)").
 */
export function collectResults(
  db: DB,
  units: ResultsUnit[],
  window: Window,
  previous: Window | null,
  label = 'no período',
): ResultsPayload {
  const ids = new Set(units.map((u) => u.id));
  const payload = buildResults({
    window,
    previous,
    bookings: db.bookings.filter((b) => ids.has(b.businessId)).map(bookingRow),
    contacts: db.contacts
      .filter((c) => ids.has(c.businessId))
      .map((c) => ({ id: c.id, createdAt: c.createdAt || '' })),
    leads: db.leads.filter((l) => ids.has(l.businessId)).map(leadRow),
    services: db.services
      .filter((s) => ids.has(s.businessId))
      .map((s) => ({ id: s.id, name: s.name, price: Number(s.price) || 0 })),
    professionals: db.professionals
      .filter((p) => ids.has(p.businessId))
      .map((p) => ({ id: p.id, name: p.name })),
    orders: db.orders
      .filter((o) => ids.has(o.businessId))
      .map((o) => ({ status: o.status, createdAt: o.createdAt, total: o.total })),
    hasBookingsModule: units.some((u) => u.hasBookings),
    hasOrdersModule: units.some((u) => u.hasOrders),
  });
  payload.period.label = label;
  return payload;
}

// ── Resumo para a Dashboard (Início) ─────────────────────────
// A Dashboard responde "como está o meu negócio?" com um recorte CURTO dos
// mesmos indicadores (nada de um segundo cálculo): curadoria + link para a
// tela completa. A ordem é de leitura (operação → clientes → dinheiro).
export const SUMMARY_METRIC_IDS: string[] = [
  'bookings', 'completed', 'cancelled', 'no_show', 'new_clients', 'leads', 'forecast_revenue', 'ticket',
];

export interface SummaryItem {
  id: string;
  label: string;
  value: number;
  unit: Metric['unit'];
  hint: string;
  hasData: boolean;
  noDataHint?: string;
  prev: number | null;
  deltaPct: number | null;
}

export function resultsSummary(payload: ResultsPayload, ids: string[] = SUMMARY_METRIC_IDS): SummaryItem[] {
  const byId = new Map(payload.metrics.map((mk) => [mk.id, mk]));
  return ids
    .map((id) => byId.get(id))
    .filter((mk): mk is Metric => !!mk)
    .map((mk) => ({
      id: mk.id, label: mk.label, value: mk.value, unit: mk.unit, hint: mk.hint,
      hasData: mk.hasData, noDataHint: mk.noDataHint, prev: mk.prev, deltaPct: mk.deltaPct,
    }));
}

export const NO_DATA = 'Sem dados suficientes';

const NO_REGISTERED_REVENUE_REASON =
  'Este negócio não registra recebimentos no GoDoutor: o sistema conhece o valor previsto dos atendimentos, mas não o pagamento. '
  + 'Por isso não exibimos “receita realizada”.';

export const ARRIVAL_NOTE =
  'A chegada do cliente (check-in) ainda não é registrada pelo sistema. Por isso a etapa “Chegou” aparece sem número — '
  + 'acompanhe o atendimento por Confirmado → Concluído e use “Não compareceu” quando for o caso.';

const day = (iso: unknown): string => String(iso ?? '').slice(0, 10);

/** Data dentro da janela? `from === ''` = sem início (todo o período). */
export function inWindow(iso: unknown, win: Window | null | undefined): boolean {
  if (!win) return false;
  const d = day(iso);
  if (!d) return false;
  if (win.from && d < win.from) return false;
  if (win.to && d > win.to) return false;
  return true;
}

const ELIGIBLE: BookingStatus[] = ['pending', 'confirmed', 'completed'];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function metric(input: {
  id: string; label: string; value: number; prev: number | null; unit: MetricUnit;
  hint: string; hasData: boolean; noDataHint?: string; comparable?: boolean;
}): Metric {
  const comparable = input.comparable !== false && input.prev !== null;
  const deltaPct = comparable && input.prev !== null ? pctChange(input.value, input.prev) : null;
  return {
    id: input.id,
    label: input.label,
    value: input.value,
    unit: input.unit,
    hint: input.hint,
    hasData: input.hasData,
    noDataHint: input.hasData ? undefined : input.noDataHint,
    prev: input.prev,
    deltaPct,
  };
}

/**
 * Constrói o painel de resultados do período. Todas as contagens usam a data
 * semanticamente correta (ver cabeçalho do módulo).
 */
export function buildResults(input: ResultsInput): ResultsPayload {
  const window = input.window;
  const previous = input.previous || null;
  const hasBookings = input.hasBookingsModule !== false;
  const hasOrders = input.hasOrdersModule === true;

  const bookings = input.bookings || [];
  const contacts = input.contacts || [];
  const leads = input.leads || [];
  const services = input.services || [];
  const professionals = input.professionals || [];
  const orders = input.orders || [];
  const priceOf = new Map(services.map((s) => [s.id, Number(s.price) || 0]));
  const nameOf = new Map(services.map((s) => [s.id, s.name]));

  const inCurrent = bookings.filter((b) => inWindow(b.date, window));
  const inPrevious = previous ? bookings.filter((b) => inWindow(b.date, previous)) : [];
  const countBy = (rows: BookingRow[], status: BookingStatus) => rows.filter((b) => b.status === status).length;

  // ── Indicadores de agenda (data do atendimento) ──
  const bookingsCur = inCurrent.length;
  const bookingsPrev = previous ? inPrevious.length : null;
  const completedCur = countBy(inCurrent, 'completed');
  const completedPrev = previous ? countBy(inPrevious, 'completed') : null;
  const cancelledCur = countBy(inCurrent, 'cancelled');
  const cancelledPrev = previous ? countBy(inPrevious, 'cancelled') : null;
  const noShowCur = countBy(inCurrent, 'no_show');
  const noShowPrev = previous ? countBy(inPrevious, 'no_show') : null;
  const attendedCur = inCurrent.filter((b) => b.status !== 'cancelled').length;
  const attendedPrev = previous ? inPrevious.filter((b) => b.status !== 'cancelled').length : null;

  const attendanceCur = completedCur + noShowCur;
  const attendancePrev = previous ? countBy(inPrevious, 'completed') + countBy(inPrevious, 'no_show') : null;
  const attendanceRate = attendanceCur > 0 ? round1((completedCur / attendanceCur) * 100) : 0;
  const attendanceRatePrev = previous && (attendancePrev || 0) > 0
    ? round1((countBy(inPrevious, 'completed') / (attendancePrev as number)) * 100)
    : null;

  // ── Clientes (cadastro na base) e leads (criação) ──
  const newContactsCur = contacts.filter((c) => inWindow(c.createdAt, window)).length;
  const newContactsPrev = previous ? contacts.filter((c) => inWindow(c.createdAt, previous)).length : null;
  const leadsCur = leads.filter((l) => inWindow(l.createdAt, window));
  const leadsPrev = previous ? leads.filter((l) => inWindow(l.createdAt, previous)) : null;
  const convertedCur = leadsCur.filter((l) => l.status === 'converted').length;
  const convertedPrev = leadsPrev ? leadsPrev.filter((l) => l.status === 'converted').length : null;
  const leadRate = leadsCur.length > 0 ? round1((convertedCur / leadsCur.length) * 100) : 0;
  const leadRatePrev = leadsPrev && leadsPrev.length > 0
    ? round1(((convertedPrev as number) / leadsPrev.length) * 100)
    : null;

  // ── Receita prevista (data do atendimento) — regra de lib/revenue.ts ──
  const forecast = hasBookings
    ? bookingRevenue(
      bookings.map((b) => ({ status: b.status, date: b.date, price: priceOf.get(b.serviceId) || 0 })),
      window,
      previous || undefined,
    )
    : null;
  const eligibleCurrent = inCurrent.filter((b) => ELIGIBLE.includes(b.status));
  const forecastPriced = eligibleCurrent.some((b) => (priceOf.get(b.serviceId) || 0) > 0);

  // ── Receita registrada: só com base confiável (pedidos) ──
  const registered: RegisteredRevenue = hasOrders
    ? {
      available: true,
      kind: 'orders',
      result: orderRevenue(orders, window, previous || undefined),
      reason: REVENUE_HINTS.orders,
    }
    : { available: false, kind: null, result: null, reason: NO_REGISTERED_REVENUE_REASON };

  // ── Ticket médio (atendimentos CONCLUÍDOS com valor cadastrado) ──
  const pricedCompleted = inCurrent.filter((b) => b.status === 'completed' && (priceOf.get(b.serviceId) || 0) > 0);
  const ticketTotal = pricedCompleted.reduce((s, b) => s + (priceOf.get(b.serviceId) || 0), 0);
  const ticket = pricedCompleted.length > 0 ? Math.round(ticketTotal / pricedCompleted.length) : 0;
  const pricedCompletedPrev = previous
    ? inPrevious.filter((b) => b.status === 'completed' && (priceOf.get(b.serviceId) || 0) > 0)
    : [];
  const ticketPrev = pricedCompletedPrev.length > 0
    ? Math.round(pricedCompletedPrev.reduce((s, b) => s + (priceOf.get(b.serviceId) || 0), 0) / pricedCompletedPrev.length)
    : null;

  const metrics: Metric[] = [];
  if (hasBookings) {
    metrics.push(
      metric({
        id: 'bookings', label: 'Agendamentos', unit: 'count', value: bookingsCur, prev: bookingsPrev,
        hint: 'Atendimentos marcados para este período, pela data do atendimento.',
        hasData: true,
      }),
      metric({
        id: 'attendances', label: 'Atendimentos', unit: 'count', value: attendedCur, prev: attendedPrev,
        hint: 'Agendamentos do período que não foram cancelados (inclui os que ainda vão acontecer).',
        hasData: true,
      }),
      metric({
        id: 'completed', label: 'Concluídos', unit: 'count', value: completedCur, prev: completedPrev,
        hint: 'Atendimentos realizados e concluídos no período.',
        hasData: completedCur > 0 || (completedPrev || 0) > 0,
        noDataHint: 'Nenhum atendimento foi concluído neste período (e não havia concluídos no anterior).',
      }),
      metric({
        id: 'cancelled', label: 'Cancelamentos', unit: 'count', value: cancelledCur, prev: cancelledPrev,
        hint: 'Agendamentos cancelados no período (pela data do atendimento).',
        hasData: cancelledCur > 0 || (cancelledPrev || 0) > 0,
        noDataHint: 'Nenhum cancelamento neste período — nem no período anterior de comparação.',
      }),
      metric({
        id: 'no_show', label: 'Não compareceu', unit: 'count', value: noShowCur, prev: noShowPrev,
        hint: 'Clientes que faltaram no período.',
        hasData: noShowCur > 0 || (noShowPrev || 0) > 0,
        noDataHint: 'Nenhuma falta registrada neste período — nem no período anterior de comparação.',
      }),
      metric({
        id: 'attendance_rate', label: 'Compareceram', unit: 'percent', value: attendanceRate, prev: attendanceRatePrev,
        hint: 'Concluídos ÷ (concluídos + faltas) no período.',
        hasData: attendanceCur > 0,
        noDataHint: 'Ainda não há atendimentos fechados (concluídos ou faltas) para calcular comparecimento.',
      }),
    );
  }
  metrics.push(
    metric({
      id: 'new_clients', label: 'Novos clientes', unit: 'count', value: newContactsCur, prev: newContactsPrev,
      hint: 'Pessoas que entraram na sua base no período (pela data de cadastro).',
      hasData: true,
    }),
    metric({
      id: 'clients', label: 'Clientes', unit: 'count', value: contacts.length, prev: null,
      hint: 'Total de pessoas na sua base hoje (não é recortado pelo período).',
      hasData: contacts.length > 0,
      noDataHint: 'Sua base ainda não tem clientes cadastrados.',
      comparable: false,
    }),
    metric({
      id: 'leads', label: 'Oportunidades', unit: 'count', value: leadsCur.length, prev: leadsPrev ? leadsPrev.length : null,
      hint: 'Contatos interessados registrados no período (pela data de criação).',
      hasData: leadsCur.length > 0 || (leadsPrev || []).length > 0,
      noDataHint: 'Nenhum lead registrado neste período — nem no período anterior.',
    }),
    metric({
      id: 'lead_conversion', label: 'Conversão de oportunidades', unit: 'percent', value: leadRate, prev: leadRatePrev,
      hint: 'Oportunidades do período que viraram cliente/agendamento ÷ oportunidades do período.',
      hasData: leadsCur.length > 0,
      noDataHint: 'Sem leads no período não há conversão para calcular.',
    }),
  );
  if (forecast) {
    metrics.push(
      metric({
        id: 'forecast_revenue', label: REVENUE_LABELS.bookings, unit: 'money',
        value: forecast.total, prev: previous ? forecast.prev : null,
        hint: REVENUE_HINTS.bookings,
        hasData: forecast.count > 0 && forecastPriced,
        noDataHint: forecast.count > 0
          ? `Há ${forecast.count} atendimento(s) no período, mas nenhum serviço com valor cadastrado.`
          : 'Nenhum atendimento elegível (pendente, confirmado ou concluído) neste período.',
      }),
      metric({
        id: 'ticket', label: 'Ticket médio', unit: 'money', value: ticket, prev: ticketPrev,
        hint: 'Valor médio dos atendimentos CONCLUÍDOS com valor cadastrado no período.',
        hasData: pricedCompleted.length > 0,
        noDataHint: 'Sem atendimentos concluídos com valor cadastrado não há ticket médio a calcular.',
      }),
    );
  }
  if (registered.available && registered.result) {
    metrics.push(metric({
      id: 'registered_revenue', label: REVENUE_LABELS.orders, unit: 'money',
      value: registered.result.total, prev: previous ? registered.result.prev : null,
      hint: REVENUE_HINTS.orders,
      hasData: registered.result.count > 0,
      noDataHint: 'Nenhum pedido não cancelado foi criado neste período.',
    }));
  }

  // ── Funil operacional (etapas reais; "Chegou" não é rastreado) ──
  const confirmedCur = inCurrent.filter((b) => b.status === 'confirmed' || b.status === 'completed').length;
  const funnelNote = ARRIVAL_NOTE;
  const step = (
    id: string, label: string, value: number, hint: string, group: 'lead' | 'booking', tracked = true,
  ): FunnelStep => ({ id, label, value, hint, tracked, group, rate: null });

  const steps: FunnelStep[] = hasBookings
    ? [
      step('leads', 'Oportunidades', leadsCur.length, 'Interessados registrados no período.', 'lead'),
      step('lead_converted', 'Oportunidades convertidas', convertedCur, 'Oportunidades do período marcadas como convertidas.', 'lead'),
      step('bookings', 'Agendamentos', bookingsCur, 'Atendimentos marcados para o período.', 'booking'),
      step('confirmed', 'Confirmados', confirmedCur, 'Agendamentos confirmados (ou já concluídos) no período.', 'booking'),
      step('arrived', 'Chegou', 0, 'O sistema ainda não registra a chegada do cliente.', 'booking', false),
      step('completed', 'Concluídos', completedCur, 'Atendimentos realizados no período.', 'booking'),
    ]
    : [
      step('leads', 'Oportunidades', leadsCur.length, 'Interessados registrados no período.', 'lead'),
      step('lead_converted', 'Oportunidades convertidas', convertedCur, 'Oportunidades do período marcadas como convertidas.', 'lead'),
    ];

  // Taxa etapa-a-etapa DENTRO do mesmo grupo (não inventamos elo entre lead e
  // agendamento: são registros contados separadamente).
  let prevInGroup: FunnelStep | null = null;
  for (const s of steps) {
    if (s.group !== prevInGroup?.group) s.rate = s.value > 0 ? 100 : null;
    else if (!s.tracked) s.rate = null;
    else s.rate = (prevInGroup?.value || 0) > 0 ? round1((s.value / (prevInGroup as FunnelStep).value) * 100) : null;
    prevInGroup = s;
  }

  const losses: Array<{ id: string; label: string; value: number; hint: string }> = [];
  const notConverted = leadsCur.length - convertedCur;
  if (leadsCur.length > 0) {
    losses.push({ id: 'lead_lost', label: 'Oportunidades não convertidas', value: notConverted, hint: 'Oportunidades do período que não viraram cliente/agendamento.' });
  }
  if (hasBookings) {
    losses.push(
      { id: 'cancelled', label: 'Cancelamentos', value: cancelledCur, hint: 'Agendamentos cancelados no período.' },
      { id: 'no_show', label: 'Faltas', value: noShowCur, hint: 'Clientes que não compareceram.' },
    );
  }

  // ── Desempenho por serviço ──
  const serviceRows: ServicePerformance[] = [];
  const byService = new Map<string, BookingRow[]>();
  for (const b of inCurrent) {
    const list = byService.get(b.serviceId) || [];
    list.push(b);
    byService.set(b.serviceId, list);
  }
  for (const [id, rows] of byService) {
    serviceRows.push({
      id,
      name: nameOf.get(id) || 'Serviço removido',
      bookings: rows.length,
      completed: countBy(rows, 'completed'),
      cancelled: countBy(rows, 'cancelled'),
      noShow: countBy(rows, 'no_show'),
      revenue: rows.filter((b) => ELIGIBLE.includes(b.status)).reduce((s, b) => s + (priceOf.get(b.serviceId) || 0), 0),
    });
  }
  serviceRows.sort((a, b) => (b.bookings - a.bookings) || a.name.localeCompare(b.name));

  // ── Desempenho por profissional ──
  const prosWithData = new Set(inCurrent.map((b) => b.professionalId || '').filter(Boolean));
  const usesProfessionals = professionals.length > 0 || prosWithData.size > 0;
  const proRows: ProfessionalPerformance[] = [];
  if (usesProfessionals) {
    const byPro = new Map<string, BookingRow[]>();
    for (const b of inCurrent) {
      const key = b.professionalId || '';
      const list = byPro.get(key) || [];
      list.push(b);
      byPro.set(key, list);
    }
    const nameFor = (id: string) => professionals.find((p) => p.id === id)?.name || 'Profissional removido';
    for (const [id, rows] of byPro) {
      const completedRows = rows.filter((b) => b.status === 'completed');
      proRows.push({
        id,
        name: id ? nameFor(id) : 'Sem profissional definido',
        bookings: rows.length,
        completed: completedRows.length,
        cancelled: countBy(rows, 'cancelled'),
        noShow: countBy(rows, 'no_show'),
        servicesDone: new Set(completedRows.map((b) => b.serviceId)).size,
        revenue: rows.filter((b) => ELIGIBLE.includes(b.status)).reduce((s, b) => s + (priceOf.get(b.serviceId) || 0), 0),
      });
    }
    proRows.sort((a, b) => (b.bookings - a.bookings) || a.name.localeCompare(b.name));
  }

  // ── Origem dos leads (distribuição + conversão) ──
  const originMap = new Map<string, { leads: number; converted: number }>();
  for (const l of leadsCur) {
    const label = leadOriginLabel(l.origin);
    const row = originMap.get(label) || { leads: 0, converted: 0 };
    row.leads += 1;
    if (l.status === 'converted') row.converted += 1;
    originMap.set(label, row);
  }
  const originRows: OriginPerformance[] = [...originMap.entries()]
    .map(([name, v]) => ({ name, leads: v.leads, converted: v.converted, rate: v.leads > 0 ? round1((v.converted / v.leads) * 100) : 0 }))
    .sort((a, b) => (b.leads - a.leads) || (leadOriginRank(a.name) - leadOriginRank(b.name)) || a.name.localeCompare(b.name));

  const hasAnyData = bookingsCur > 0 || leadsCur.length > 0 || newContactsCur > 0 || contacts.length > 0;

  const limitations: string[] = [];
  if (!registered.available) limitations.push(NO_REGISTERED_REVENUE_REASON);
  if (hasBookings) limitations.push(ARRIVAL_NOTE);
  if (forecast && forecast.count > 0 && !forecastPriced) {
    limitations.push('Os atendimentos deste período não têm valor de serviço cadastrado — por isso a receita prevista não é exibida.');
  }

  return {
    period: {
      from: window.from, to: window.to,
      prevFrom: previous?.from || '', prevTo: previous?.to || '',
      hasPrevious: !!previous,
      label: '',
    },
    modules: { bookings: hasBookings, orders: hasOrders },
    metrics,
    funnel: { steps, losses, note: funnelNote },
    services: serviceRows.length > 0
      ? { available: true, reason: '', rows: serviceRows }
      : {
        available: false,
        reason: hasBookings
          ? 'Nenhum serviço foi agendado neste período.'
          : 'Esta empresa não usa a agenda de serviços.',
        rows: [],
      },
    professionals: proRows.length > 0
      ? { available: true, reason: '', rows: proRows }
      : {
        available: false,
        reason: usesProfessionals
          ? 'Nenhum atendimento por profissional neste período.'
          : 'Sua agenda não está dividida por profissionais.',
        rows: [],
      },
    origins: originRows.length > 0
      ? { available: true, reason: '', rows: originRows }
      : { available: false, reason: 'Nenhum lead com origem registrada neste período.', rows: [] },
    revenue: {
      forecast,
      forecastPriced,
      registered,
      labels: REVENUE_LABELS as unknown as Record<string, string>,
      hints: REVENUE_HINTS as unknown as Record<string, string>,
      unitLabels: REVENUE_UNIT_LABELS as unknown as Record<string, string>,
    },
    limitations,
    hasAnyData,
    emptyHint: 'Ainda não há movimento neste período. Assim que houver atendimentos, clientes ou leads, os números aparecem aqui.',
  };
}
