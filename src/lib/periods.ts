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
import { addDaysISO } from './tz';

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
