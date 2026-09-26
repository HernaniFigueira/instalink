// ═══════════════════════════════════════════════════════════════
// FASE 2 · P7 — FINANCEIRO BÁSICO (funções puras, sem I/O)
// ═══════════════════════════════════════════════════════════════
// NÃO é ERP. É o registro operacional de movimentações da clínica:
// valor · tipo (receita/despesa) · status (previsto/pendente/pago/cancelado)
// · datas · forma · vínculos opcionais (paciente, agendamento, serviço).
//
// Distinção importante com lib/revenue.ts:
//   • revenue.ts → "receita PREVISTA" derivada dos agendamentos (previsão);
//   • este módulo → o que foi REGISTRADO como recebido/a pagar (caixa).
// Os dois números convivem na UI, cada um com seu rótulo — nunca somados.
import type { FinanceEntry, FinanceKind, FinanceStatus } from './types';

export const FINANCE_KINDS: FinanceKind[] = ['receita', 'despesa'];
export const FINANCE_STATUSES: FinanceStatus[] = ['previsto', 'pendente', 'pago', 'cancelado'];

export const FINANCE_STATUS_LABEL: Record<FinanceStatus, string> = {
  previsto: 'Previsto', pendente: 'Pendente', pago: 'Pago', cancelado: 'Cancelado',
};

export const FINANCE_METHODS: Array<{ id: string; label: string }> = [
  { id: 'pix', label: 'PIX' },
  { id: 'card', label: 'Cartão' },
  { id: 'cash', label: 'Dinheiro' },
  { id: 'transfer', label: 'Transferência' },
  { id: 'other', label: 'Outro' },
];

export interface FinanceFilters {
  /** YYYY-MM-DD inclusivo. '' = sem limite. */
  from?: string;
  to?: string;
  professionalId?: string;
  serviceId?: string;
  contactId?: string;
  status?: FinanceStatus | '';
  method?: string;
  kind?: FinanceKind | '';
}

/** Aplica os filtros da tela sobre a lista da unidade. */
export function filterEntries(entries: FinanceEntry[], f: FinanceFilters = {}): FinanceEntry[] {
  return entries.filter((e) => {
    if (f.from && e.dueDate && e.dueDate < f.from) return false;
    if (f.to && e.dueDate && e.dueDate > f.to) return false;
    if (f.professionalId && e.professionalId !== f.professionalId) return false;
    if (f.serviceId && e.serviceId !== f.serviceId) return false;
    if (f.contactId && e.contactId !== f.contactId) return false;
    if (f.status && e.status !== f.status) return false;
    if (f.method && e.method !== f.method) return false;
    if (f.kind && e.kind !== f.kind) return false;
    return true;
  });
}

export interface FinanceSummary {
  /** Receitas com status 'previsto' (ainda não venceu/venceu sem ação). */
  receitaPrevista: number;
  /** Receitas com status 'pago' — dinheiro efetivamente registrado. */
  receitaRecebida: number;
  /** Receitas 'pendente' (vencidas ou aguardando). */
  receitaPendente: number;
  /** Despesas 'pago'. */
  despesasPagas: number;
  /** Despesas 'previsto' + 'pendente'. */
  despesasProjetadas: number;
  /** Recebido − despesas pagas (caixa realizado). */
  saldo: number;
  /** Ticket médio = receita recebida ÷ nº de receitas pagas (0 quando nenhuma). */
  ticketMedio: number;
  /** Quantidade de receitas pagas (base do ticket médio). */
  pagamentosCount: number;
}

const sum = (list: FinanceEntry[]) => list.reduce((acc, e) => acc + (e.amount || 0), 0);

/** Consolidação dos totais do período (filtro já aplicado, se houver). */
export function summarize(entries: FinanceEntry[]): FinanceSummary {
  const receitas = entries.filter((e) => e.kind === 'receita');
  const despesas = entries.filter((e) => e.kind === 'despesa');
  const receitaPrevista = sum(receitas.filter((e) => e.status === 'previsto'));
  const receitaRecebida = sum(receitas.filter((e) => e.status === 'pago'));
  const receitaPendente = sum(receitas.filter((e) => e.status === 'pendente'));
  const despesasPagas = sum(despesas.filter((e) => e.status === 'pago'));
  const despesasProjetadas = sum(despesas.filter((e) => e.status === 'previsto' || e.status === 'pendente'));
  const pagamentosCount = receitas.filter((e) => e.status === 'pago').length;
  return {
    receitaPrevista, receitaRecebida, receitaPendente,
    despesasPagas, despesasProjetadas,
    saldo: receitaRecebida - despesasPagas,
    ticketMedio: pagamentosCount ? Math.round(receitaRecebida / pagamentosCount) : 0,
    pagamentosCount,
  };
}

// ── Gráficos básicos (dados para a UI desenhar; sem lib de charts) ──
export interface PeriodBar { label: string; from: string; to: string; receita: number; despesa: number }
export interface StatusSlice { status: FinanceStatus; label: string; amount: number }
export interface MethodSlice { method: string; label: string; amount: number }

/** Barras por dia (curto), semana ou mês conforme a janela. */
export function periodBars(entries: FinanceEntry[], from: string, to: string): PeriodBar[] {
  if (!from || !to || from > to) return [];
  const days: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
    if (days.length > 400) break; // teto de segurança
  }
  const span = days.length;
  const bucketDays = span <= 31 ? 1 : span <= 92 ? 7 : 30;
  const buckets: PeriodBar[] = [];
  for (let i = 0; i < days.length; i += bucketDays) {
    const bFrom = days[i];
    const bTo = days[Math.min(i + bucketDays - 1, days.length - 1)];
    buckets.push({
      label: bucketDays === 1 ? bFrom.slice(8) + '/' + bFrom.slice(5, 7) : `${bFrom.slice(8)}/${bFrom.slice(5, 7)}`,
      from: bFrom, to: bTo, receita: 0, despesa: 0,
    });
  }
  for (const e of entries) {
    if (e.status === 'cancelado' || !e.dueDate) continue;
    const b = buckets.find((x) => e.dueDate >= x.from && e.dueDate <= x.to);
    if (!b) continue;
    if (e.kind === 'receita') b.receita += e.amount;
    else b.despesa += e.amount;
  }
  return buckets;
}

/** Previsto x realizado (receitas e despesas separadas por status de caixa). */
export function plannedVsRealized(entries: FinanceEntry[]): Array<{ label: string; previsto: number; realizado: number }> {
  const recebido = entries.filter((e) => e.status === 'pago');
  const aReceber = entries.filter((e) => e.status !== 'pago' && e.status !== 'cancelado');
  const r1 = sum(recebido.filter((e) => e.kind === 'receita'));
  const r2 = sum(aReceber.filter((e) => e.kind === 'receita'));
  const d1 = sum(recebido.filter((e) => e.kind === 'despesa'));
  const d2 = sum(aReceber.filter((e) => e.kind === 'despesa'));
  return [
    { label: 'Receitas', previsto: r2, realizado: r1 },
    { label: 'Despesas', previsto: d2, realizado: d1 },
  ];
}

/** Receitas pagas por forma de pagamento (fatias do gráfico). */
export function methodSlices(entries: FinanceEntry[]): MethodSlice[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    if (e.kind !== 'receita' || e.status !== 'pago') continue;
    const key = e.method || 'other';
    map.set(key, (map.get(key) || 0) + e.amount);
  }
  const label = (id: string) => FINANCE_METHODS.find((m) => m.id === id)?.label || 'Outro';
  return [...map.entries()]
    .map(([method, amount]) => ({ method, label: label(method), amount }))
    .sort((a, b) => b.amount - a.amount);
}

/** Validação de escrita (mensagem amigável; nunca erro técnico). */
export function validateEntry(input: Partial<FinanceEntry>): string {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 'Informe um valor maior que zero.';
  if (amount > 100_000_000) return 'Valor acima do limite permitido (R$ 1.000.000,00).';
  if (input.kind !== 'receita' && input.kind !== 'despesa') return 'Informe se é receita ou despesa.';
  if (!FINANCE_STATUSES.includes(input.status as FinanceStatus)) return 'Status inválido.';
  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) return 'Data prevista inválida.';
  if (input.paidAt && !/^\d{4}-\d{2}-\d{2}$/.test(input.paidAt)) return 'Data de pagamento inválida.';
  if (input.status === 'pago' && !input.paidAt) return 'Informe a data de pagamento.';
  if (!String(input.description || '').trim()) return 'Descreva a movimentação.';
  return '';
}
