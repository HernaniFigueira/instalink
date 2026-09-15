// ═══════════════════════════════════════════════════════════════
// PERÍODOS DE CONSULTA — Dashboard e Resultados (P1)
// ═══════════════════════════════════════════════════════════════
// Fonte única dos períodos de visualização: quais existem, como o texto da
// URL vira número e qual janela de datas cada um representa.
//
//   7 / 30 / 90 / 365 dias · 0 = todo o período (sem filtro inicial).
//
// Módulo PURO (sem I/O): usado pelas APIs (/api/overview, /api/analytics),
// pelo seletor compartilhado (PeriodSelector) e coberto por testes.
// Não é inteligência financeira — só recorte de visualização.
import { addDaysISO, isValidDateISO } from './tz';

/** Períodos oferecidos, na ordem do seletor. `0` = todo o período. */
export const PERIOD_VALUES = [7, 30, 90, 365, 0] as const;

export type PeriodValue = (typeof PERIOD_VALUES)[number];

/**
 * Normaliza o `?period=` da URL. Qualquer valor desconhecido/ausente cai
 * para 30 (comportamento histórico preservado).
 */
export function parsePeriodParam(raw: string | null | undefined): 7 | 30 | 90 | 365 | 0 {
  if (raw === '7') return 7;
  if (raw === '90') return 90;
  if (raw === '365' || raw === '12m' || raw === '12') return 365;
  if (raw === '0' || raw === 'all' || raw === 'total') return 0;
  return 30;
}

/** Rótulo longo do período ("30 dias", "12 meses", "Todo período"). */
export function periodLabel(period: number): string {
  switch (period) {
    case 7: return '7 dias';
    case 30: return '30 dias';
    case 90: return '90 dias';
    case 365: return '12 meses';
    default: return 'Todo período';
  }
}

/** Rótulo curto para espaços apertados ("30d", "12m", "Tudo"). */
export function periodShortLabel(period: number): string {
  switch (period) {
    case 7: return '7d';
    case 30: return '30d';
    case 90: return '90d';
    case 365: return '12m';
    default: return 'Tudo';
  }
}

export interface PeriodWindows {
  /** Janela atual, inclusiva (YYYY-MM-DD). `from === ''` = sem início. */
  from: string;
  to: string;
  /** Janela anterior de mesma duração (para variação/evolução). */
  prevFrom: string;
  prevTo: string;
  /** `false` em "todo o período" — não há janela anterior comparável. */
  hasPrevious: boolean;
}

/**
 * Janelas de datas do período a partir de `today` (YYYY-MM-DD).
 * Comparações no formato ISO funcionam por ordem lexicográfica, então
 * `from === ''` casa com qualquer data (todo o período).
 */
export function periodWindows(period: number, today: string): PeriodWindows {
  if (!(period > 0)) {
    return { from: '', to: today, prevFrom: '', prevTo: '', hasPrevious: false };
  }
  return {
    from: addDaysISO(today, -(period - 1)),
    to: today,
    prevFrom: addDaysISO(today, -(period * 2 - 1)),
    prevTo: addDaysISO(today, -period),
    hasPrevious: true,
  };
}

// ═══════════════════════════════════════════════════════════════
// P2 — PERÍODOS SIMPLES PARA O DONO (Hoje · 7 · 30 · Este mês · Personalizado)
// ═══════════════════════════════════════════════════════════════
// Continua sendo SÓ recorte de visualização. Os períodos antigos (90 dias,
// 12 meses, todo o período) seguem válidos em URL e continuam no seletor
// (agrupados em "Mais períodos") — nada foi removido.
//
// COMPARAÇÃO: sempre "período atual × período imediatamente anterior de mesma
// duração" (ex.: 30 dias atuais × os 30 dias anteriores). Para "Este mês" a
// janela equivalente é o bloco de mesmo tamanho imediatamente anterior.
export type PeriodKey = 'today' | '7' | '30' | '90' | '365' | 'all' | 'month' | 'custom';

export interface PeriodSpec {
  key: PeriodKey;
  /** Início inclusive (YYYY-MM-DD). '' = sem início (todo o período). */
  from: string;
  /** Fim inclusive (YYYY-MM-DD). */
  to: string;
  prevFrom: string;
  prevTo: string;
  /** `false` quando não existe janela anterior comparável (todo o período). */
  hasPrevious: boolean;
  label: string;
  shortLabel: string;
  /** `true` quando o usuário escolheu datas explícitas. */
  custom: boolean;
}

function shiftWindow(from: string, to: string): { prevFrom: string; prevTo: string } {
  if (!isValidDateISO(from) || !isValidDateISO(to) || from > to) return { prevFrom: '', prevTo: '' };
  let days = 0;
  let cursor = from;
  while (cursor <= to) { days++; cursor = addDaysISO(cursor, 1); }
  return { prevFrom: addDaysISO(from, -days), prevTo: addDaysISO(from, -1) };
}

const LABELS: Record<PeriodKey, { label: string; short: string }> = {
  today: { label: 'Hoje', short: 'Hoje' },
  '7': { label: '7 dias', short: '7d' },
  '30': { label: '30 dias', short: '30d' },
  '90': { label: '90 dias', short: '90d' },
  '365': { label: '12 meses', short: '12m' },
  all: { label: 'Todo período', short: 'Tudo' },
  month: { label: 'Este mês', short: 'Mês' },
  custom: { label: 'Período personalizado', short: 'Personalizado' },
};

/** Duração máxima aceita em um período personalizado (dias). */
export const MAX_CUSTOM_DAYS = 366;

/**
 * Resolve o período da URL (`?period=`, `?from=`, `?to=`) em uma janela
 * concreta. Entradas inválidas caem no comportamento histórico (30 dias).
 */
export function resolvePeriodSpec(opts: {
  period?: string | null;
  from?: string | null;
  to?: string | null;
  today: string;
}): PeriodSpec {
  const today = opts.today;
  const raw = String(opts.period ?? '').trim().toLowerCase();
  const fromQ = String(opts.from ?? '').trim();
  const toQ = String(opts.to ?? '').trim();

  const build = (key: PeriodKey, from: string, to: string): PeriodSpec => {
    const prev = key === 'all' ? { prevFrom: '', prevTo: '' } : shiftWindow(from, to);
    return {
      key, from, to,
      prevFrom: prev.prevFrom, prevTo: prev.prevTo,
      hasPrevious: key !== 'all' && !!prev.prevFrom,
      label: LABELS[key].label,
      shortLabel: LABELS[key].short,
      custom: key === 'custom',
    };
  };

  if (raw === 'custom' || (isValidDateISO(fromQ) || isValidDateISO(toQ))) {
    let from = isValidDateISO(fromQ) ? fromQ : addDaysISO(today, -29);
    let to = isValidDateISO(toQ) ? toQ : today;
    if (from > to) [from, to] = [to, from];
    // Teto de segurança (a resposta da API não pode crescer sem limite).
    if (from < addDaysISO(to, -(MAX_CUSTOM_DAYS - 1))) from = addDaysISO(to, -(MAX_CUSTOM_DAYS - 1));
    return build('custom', from, to);
  }
  if (raw === 'today' || raw === '1' || raw === 'day') return build('today', today, today);
  if (raw === 'month' || raw === 'mes' || raw === 'mês') {
    return build('month', `${today.slice(0, 7)}-01`, today);
  }
  if (raw === '90') return build('90', addDaysISO(today, -89), today);
  if (raw === '365' || raw === '12m' || raw === '12') return build('365', addDaysISO(today, -364), today);
  if (raw === '0' || raw === 'all' || raw === 'total') return build('all', '', today);
  if (raw === '7') return build('7', addDaysISO(today, -6), today);
  return build('30', addDaysISO(today, -29), today);
}

/** Períodos do seletor principal (ordem de uso do dia a dia). */
export const MAIN_PERIOD_KEYS: PeriodKey[] = ['today', '7', '30', 'month'];

/** Períodos secundários ("Mais períodos") — os antigos continuam válidos. */
export const MORE_PERIOD_KEYS: PeriodKey[] = ['90', '365', 'all'];

/** Query string canônica de um período (para links internos). */
export function periodQuery(spec: Pick<PeriodSpec, 'key' | 'from' | 'to'>): string {
  if (spec.key === 'custom') return `period=custom&from=${spec.from}&to=${spec.to}`;
  return `period=${spec.key}`;
}

/** O valor de `?period=` correspondente a uma chave (compatível com o legado). */
export function periodParamFor(key: PeriodKey): string {
  if (key === 'today') return 'today';
  if (key === 'month') return 'month';
  if (key === 'all') return '0';
  if (key === 'custom') return 'custom';
  return key;
}

/** Rótulo humano de uma chave (mesmo sem janela calculada). */
export function periodKeyLabel(key: PeriodKey): string {
  return LABELS[key].label;
}
