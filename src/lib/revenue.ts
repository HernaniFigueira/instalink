// ═══════════════════════════════════════════════════════════════
// RECEITA — semântica honesta (não fingimos contabilidade)
// ═══════════════════════════════════════════════════════════════
// O sistema conhece preço do serviço, agendamentos, status e duração — mas
// NÃO sabe se o pagamento ocorreu. Por isso:
//
// ── REGRA DOCUMENTADA (negócios de agendamento: services + bookings) ──
// "RECEITA PREVISTA" (também lida como "Valor dos atendimentos"):
//   soma do PREÇO DO SERVIÇO dos atendimentos ELEGÍVEIS no período,
//   considerando a DATA DO ATENDIMENTO (não a data de criação).
//
//   ELEGÍVEIS   = pending + confirmed + completed
//   FORA DA SOMA = cancelled (cancelado) e no_show (não compareceu)
//
//   O resultado é sempre separado por status na UI, para ninguém ler
//   "R$ 1.200" como dinheiro no caixa:
//     • concluídos  → já aconteceu;
//     • confirmados → vai acontecer;
//     • pendentes   → pode ainda não acontecer;
//     • cancelados / faltas → exibidos à parte, nunca somados.
//
// ── REGRA (negócios com products + orders) ──
// "RECEITA" = soma do total dos pedidos NÃO CANCELADOS criados no período
// (regra já existente, preservada).
//
// ── Negócios híbridos ──
// As duas métricas aparecem SEPARADAS, cada uma com seu rótulo e sua regra.
// Nunca somamos pedidos com atendimentos num número só.
//
// ── Sem dados ──
// Nada de valor inventado: sem itens elegíveis, total = 0 e a UI mostra
// "Sem dados suficientes" (ver hasData).
//
// Módulo PURO: coberto por testes em src/lib/__tests__/revenue.test.ts.
import type { BookingStatus, OrderStatus } from './types';
import { BOOKING_STATUS } from './status';

export type RevenueKind = 'bookings' | 'orders';

/** Status de agendamento que entram na receita prevista. */
export const REVENUE_ELIGIBLE_BOOKING_STATUSES: BookingStatus[] = [
  'pending', 'confirmed', 'completed',
];

/** Status de agendamento que NUNCA entram na soma (exibidos à parte). */
export const REVENUE_EXCLUDED_BOOKING_STATUSES: BookingStatus[] = ['cancelled', 'no_show'];

/** Pedidos cancelados não entram na receita. */
export const REVENUE_EXCLUDED_ORDER_STATUSES: OrderStatus[] = ['cancelled'];

export const REVENUE_LABELS: Record<RevenueKind, string> = {
  bookings: 'Receita prevista',
  orders: 'Receita',
};

export const REVENUE_HINTS: Record<RevenueKind, string> = {
  bookings:
    'Soma do valor dos atendimentos elegíveis no período (pendentes, confirmados e concluídos), pela data do atendimento. Cancelamentos e faltas ficam de fora. Não é dinheiro recebido: é previsão.',
  orders: 'Soma dos pedidos não cancelados criados no período.',
};

export const REVENUE_UNIT_LABELS: Record<RevenueKind, string> = {
  bookings: 'atendimentos',
  orders: 'pedidos',
};

export const NO_DATA_MESSAGE = 'Sem dados suficientes';

export interface BookingRevenueItem {
  status: BookingStatus;
  /** Data do atendimento (YYYY-MM-DD) — é ela que define o período. */
  date: string;
  /** Preço do serviço em centavos. */
  price: number;
}

export interface OrderRevenueItem {
  status: OrderStatus;
  /** Data de criação do pedido (ISO ou YYYY-MM-DD). */
  createdAt: string;
  total: number;
}

export interface RevenueWindow {
  /** YYYY-MM-DD inicial (inclusive). */
  from: string;
  /** YYYY-MM-DD final (inclusive). */
  to: string;
}

export interface StatusAmount {
  status: BookingStatus;
  label: string;
  count: number;
  total: number;
  /** Entra na soma da receita prevista? */
  eligible: boolean;
}

// Rótulos de status vêm SEMPRE de lib/status.ts (fonte única). O que existe
// aqui é apenas o rótulo de AGRUPAMENTO no plural, usado na quebra da receita.
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  pending: BOOKING_STATUS.pending.panel,
  confirmed: BOOKING_STATUS.confirmed.panel,
  completed: BOOKING_STATUS.completed.panel,
  cancelled: BOOKING_STATUS.cancelled.panel,
  no_show: BOOKING_STATUS.no_show.panel,
};

export const BOOKING_STATUS_GROUP_LABELS: Record<BookingStatus, string> = {
  pending: 'pendentes',
  confirmed: 'confirmados',
  completed: 'concluídos',
  cancelled: 'cancelados',
  no_show: 'faltas',
};

export interface RevenueResult {
  kind: RevenueKind;
  label: string;
  hint: string;
  unitLabel: string;
  /** Centavos somados no período. */
  total: number;
  /** Centavos somados no período anterior (mesma regra). */
  prev: number;
  delta: number;
  /** Itens elegíveis no período. */
  count: number;
  /** Média por item elegível. */
  ticket: number;
  /** `false` quando não há nada calculável → UI mostra "Sem dados suficientes". */
  hasData: boolean;
  /** Detalhe por status (somente para atendimentos). */
  breakdown: StatusAmount[] | null;
}

function inWindow(day: string, w: RevenueWindow): boolean {
  return day >= w.from && day <= w.to;
}

function emptyResult(kind: RevenueKind, withBreakdown: boolean): RevenueResult {
  return {
    kind,
    label: REVENUE_LABELS[kind],
    hint: REVENUE_HINTS[kind],
    unitLabel: REVENUE_UNIT_LABELS[kind],
    total: 0,
    prev: 0,
    delta: 0,
    count: 0,
    ticket: 0,
    hasData: false,
    breakdown: withBreakdown ? [] : null,
  };
}

/**
 * Receita prevista de atendimentos (regra documentada no topo do arquivo).
 * `priceOf` recebe o item e devolve o preço do serviço em centavos — assim a
 * função não depende de onde o preço está guardado.
 */
export function bookingRevenue(
  items: BookingRevenueItem[],
  current: RevenueWindow,
  previous?: RevenueWindow,
): RevenueResult {
  const base = emptyResult('bookings', true);
  const list = items || [];

  const sumOf = (win: RevenueWindow) =>
    list
      .filter((i) => REVENUE_ELIGIBLE_BOOKING_STATUSES.includes(i.status))
      .filter((i) => inWindow(String(i.date || '').slice(0, 10), win))
      .reduce((s, i) => s + (Number(i.price) || 0), 0);

  const inCurrent = list.filter((i) => inWindow(String(i.date || '').slice(0, 10), current));
  const total = sumOf(current);
  const prev = previous ? sumOf(previous) : 0;

  const order: BookingStatus[] = ['completed', 'confirmed', 'pending', 'no_show', 'cancelled'];
  const breakdown: StatusAmount[] = order.map((status) => {
    const rows = inCurrent.filter((i) => i.status === status);
    return {
      status,
      label: BOOKING_STATUS_GROUP_LABELS[status],
      count: rows.length,
      total: rows.reduce((s, i) => s + (Number(i.price) || 0), 0),
      eligible: REVENUE_ELIGIBLE_BOOKING_STATUSES.includes(status),
    };
  });

  const count = inCurrent.filter((i) => REVENUE_ELIGIBLE_BOOKING_STATUSES.includes(i.status)).length;
  return {
    ...base,
    total,
    prev,
    delta: total - prev,
    count,
    ticket: count > 0 ? Math.round(total / count) : 0,
    hasData: count > 0,
    breakdown,
  };
}

/** Receita de pedidos (regra preservada: não cancelados, pela criação). */
export function orderRevenue(
  items: OrderRevenueItem[],
  current: RevenueWindow,
  previous?: RevenueWindow,
): RevenueResult {
  const base = emptyResult('orders', false);
  const list = items || [];
  const eligible = (i: OrderRevenueItem) => !REVENUE_EXCLUDED_ORDER_STATUSES.includes(i.status);

  const rowsIn = (win: RevenueWindow) =>
    list.filter((i) => eligible(i) && inWindow(String(i.createdAt || '').slice(0, 10), win));

  const cur = rowsIn(current);
  const prv = previous ? rowsIn(previous) : [];
  const total = cur.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const prevTotal = prv.reduce((s, i) => s + (Number(i.total) || 0), 0);
  return {
    ...base,
    total,
    prev: prevTotal,
    delta: total - prevTotal,
    count: cur.length,
    ticket: cur.length > 0 ? Math.round(total / cur.length) : 0,
    hasData: cur.length > 0,
  };
}

/**
 * Quais fontes de receita o negócio tem — uma clínica (services+bookings)
 * NÃO depende de pedidos para ter métrica de valor; um varejo usa pedidos;
 * um híbrido mostra as duas, separadas.
 */
export function revenueSources(modules: {
  bookings?: boolean; services?: boolean; orders?: boolean; products?: boolean;
}): RevenueKind[] {
  const out: RevenueKind[] = [];
  if (modules.bookings || modules.services) out.push('bookings');
  if (modules.orders) out.push('orders');
  return out;
}

/** Valor exibido quando não há dados (nunca inventamos número). */
export function revenueEmptyMessage(result: Pick<RevenueResult, 'hasData'>): string {
  return result.hasData ? '' : NO_DATA_MESSAGE;
}
