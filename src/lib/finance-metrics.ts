// ═══════════════════════════════════════════════════════════════
// MÉTRICAS FINANCEIRAS — quatro conceitos, UM cálculo (§6)
// ═══════════════════════════════════════════════════════════════
// BUG real da auditoria: Dashboard/Resultados mostravam "R$ 160 previsto"
// enquanto Financeiro mostrava "R$ 0" — cada tela tinha sua própria
// matemática e o usuário não sabia em qual acreditar.
//
// Contrato desta missão (decisão fechada):
//
//   AGENDADO   → valor dos atendimentos ELEGÍVEIS pendentes+confirmados
//                no período (vai acontecer / aguardando);
//   REALIZADO  → valor dos atendimentos CONCLUÍDOS elegíveis no período;
//   RECEBIDO   → pagamentos EFETIVAMENTE registrados (FinanceEntry
//                receita 'pago') no período — só dado real, nunca
//                agendamento transformado em dinheiro;
//   EM ABERTO  → valor realizado ainda não recebido (realizado − recebido,
//                nunca negativo).
//
// "Receita prevista" (agendado + realizado) continua existindo como
// subproduto para comparação de período — mas NENHUMA tela chama o total
// de "receita" sem dizer qual conceito é.
//
// A MESMA função alimenta /api/overview (Visão geral), /api/results
// (Resultados) e /api/finance (Financeiro): mesmo indicador = mesmo
// cálculo em todas as telas.
//
// Módulo PURO (sem I/O): coberto por src/lib/__tests__/finance-metrics.test.ts.
import { REVENUE_ELIGIBLE_BOOKING_STATUSES } from './revenue';
import type { BookingStatus, FinanceEntry } from './types';

export interface FinanceMetricsBooking {
  status: BookingStatus;
  /** Data do atendimento (YYYY-MM-DD) — é ela que define o período. */
  date: string;
  /** Preço do serviço em centavos. */
  price: number;
}

export interface FinanceMetricsEntry {
  kind: FinanceEntry['kind'];
  /** Entrada legada pode carregar valores fora do catálogo — a régua é `=== 'pago'`. */
  status: string;
  amount: number;
  dueDate: string;
  paidAt: string;
}

export interface FinanceMetrics {
  /** Pendentes + confirmados elegíveis no período (centavos). */
  agendado: number;
  /** Concluídos elegíveis no período (centavos). */
  realizado: number;
  /** Pagamentos realmente registrados no período (centavos). */
  recebido: number;
  /** Realizado ainda não recebido (centavos; nunca negativo). */
  emAberto: number;
  /** Agendado + realizado — o antigo "receito prevista", agora com nome honesto. */
  previsto: number;
  /** Nº de pagamentos registrados (base do "Recebido"). */
  pagamentos: number;
  /** Algum atendimento elegível no período (para estado neutro da UI). */
  hasBookings: boolean;
}

export const FINANCE_METRIC_LABELS: Record<keyof Omit<FinanceMetrics, 'pagamentos' | 'hasBookings'>, string> = {
  agendado: 'Agendado',
  realizado: 'Realizado',
  recebido: 'Recebido',
  emAberto: 'Em aberto',
  previsto: 'Previsto (agendado + realizado)',
};

const inWindow = (day: string, from: string, to: string): boolean => {
  const d = String(day || '').slice(0, 10);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
};

/**
 * Os quatro conceitos de uma vez. `from`/`to` vazios = sem limite (todo o
 * período) — a régua é a mesma dos filtros de Financeiro.
 */
export function financeMetrics(input: {
  bookings: FinanceMetricsBooking[];
  entries: FinanceMetricsEntry[];
  from?: string;
  to?: string;
}): FinanceMetrics {
  const { bookings = [], entries = [], from = '', to = '' } = input;

  const eligible = bookings.filter(
    (b) => REVENUE_ELIGIBLE_BOOKING_STATUSES.includes(b.status) && inWindow(b.date, from, to),
  );
  const agendado = eligible
    .filter((b) => b.status === 'pending' || b.status === 'confirmed')
    .reduce((s, b) => s + (Number(b.price) || 0), 0);
  const realizado = eligible
    .filter((b) => b.status === 'completed')
    .reduce((s, b) => s + (Number(b.price) || 0), 0);

  // RECEBIDO: somente pagamento REGISTRADO (data de pagamento no período;
  // sem paidAt, recorre ao vencimento — dado legado segue contando).
  const paid = entries.filter(
    (e) => e.kind === 'receita' && e.status === 'pago'
      && inWindow((e.paidAt || e.dueDate || '').slice(0, 10), from, to),
  );
  const recebido = paid.reduce((s, e) => s + (Number(e.amount) || 0), 0);

  return {
    agendado,
    realizado,
    recebido,
    emAberto: Math.max(0, realizado - recebido),
    previsto: agendado + realizado,
    pagamentos: paid.length,
    hasBookings: eligible.length > 0,
  };
}

/** Linha curta "Agendado · Realizado · Recebido · Em aberto" para tooltips. */
export function financeMetricsHint(m: FinanceMetrics, money: (cents: number) => string): string {
  return `Agendado ${money(m.agendado)} · Realizado ${money(m.realizado)} · Recebido ${money(m.recebido)} · Em aberto ${money(m.emAberto)}`;
}
