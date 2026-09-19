// ═══════════════════════════════════════════════════════════════
// INSIGHTS · GRÁFICOS — matemática pura das visualizações de Resultados
// ═══════════════════════════════════════════════════════════════
// A3.3 CONVERGÊNCIA (ponto 14): Resultados passou a mostrar gráficos — mas só
// do que o dado REAL do período sustenta. Nada de biblioteca pesada e nada de
// série temporal inventada: aqui vive apenas aritmética sobre o que
// `insights.ts` já coleta do banco, em funções puras para serem testáveis
// (o projeto não tem jsdom, então lógica de UI não é testável em componente).
//
// Regra de honestidade: se o modelo não separa algo, o gráfico não finge
// separar. `bookings` inclui pendentes E confirmados; como a coleta por
// serviço/profissional não abre essa divisão, os dois viram UM segmento
// ("Em agenda") — nunca duas fatias chutadas.

import type { OriginPerformance, ProfessionalPerformance, ServicePerformance } from './insights';

/** Linha de desempenho (serviço ou profissional) — as duas têm estes campos. */
type PerfRow = Pick<ServicePerformance | ProfessionalPerformance, 'bookings' | 'completed' | 'cancelled' | 'noShow'>;

export interface MixSegment {
  id: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  label: string;
  value: number;
  /** 0–100, com UMA casa decimal. Soma ≈ 100 quando `total > 0`. */
  pct: number;
  /** Cor de preenchimento como variável de token (nunca hex no componente). */
  color: string;
}

export interface StatusMix {
  total: number;
  segments: MixSegment[];
  /** true quando há ao menos um atendimento no recorte. */
  hasData: boolean;
}

/**
 * Distribuição de estados a partir das linhas de desempenho.
 *
 * "Em agenda" = `bookings − concluídos − cancelados − faltas`. É o que resta e
 * representa pendentes + confirmados juntos (a coleta não abre a divisão). O
 * valor é limitado a ≥ 0 para que um dado inconsistente nunca vire fatia
 * negativa no gráfico.
 */
export function statusMix(rows: PerfRow[]): StatusMix {
  const completed = rows.reduce((a, r) => a + Math.max(0, r.completed), 0);
  const cancelled = rows.reduce((a, r) => a + Math.max(0, r.cancelled), 0);
  const noShow = rows.reduce((a, r) => a + Math.max(0, r.noShow), 0);
  const bookings = rows.reduce((a, r) => a + Math.max(0, r.bookings), 0);
  const scheduled = Math.max(0, bookings - completed - cancelled - noShow);

  const total = completed + cancelled + noShow + scheduled;
  const pctOf = (v: number) => (total > 0 ? Math.round((v / total) * 1000) / 10 : 0);

  const segments: MixSegment[] = [
    { id: 'scheduled', label: 'Em agenda', value: scheduled, pct: pctOf(scheduled), color: 'var(--warning)' },
    { id: 'completed', label: 'Concluídos', value: completed, pct: pctOf(completed), color: 'var(--success)' },
    { id: 'cancelled', label: 'Cancelados', value: cancelled, pct: pctOf(cancelled), color: 'var(--danger)' },
    { id: 'no_show', label: 'Faltas', value: noShow, pct: pctOf(noShow), color: 'var(--text-muted)' },
  ];

  return { total, segments, hasData: total > 0 };
}

export interface RankBar {
  key: string;
  label: string;
  /** Valor principal da barra (agendamentos ou leads). */
  value: number;
  /** Valor secundário sobreposto (concluídos ou convertidos). */
  secondary: number;
  /** 0–100 do valor principal relativo ao MAIOR da lista (mín. 3 quando > 0). */
  widthPct: number;
  /** 0–100 do secundário relativo ao maior principal (para a sobreposição). */
  secondaryWidthPct: number;
}

const MIN_VISIBLE = 3;

function buildRank(
  items: Array<{ key: string; label: string; value: number; secondary: number }>,
): RankBar[] {
  const max = Math.max(1, ...items.map((i) => i.value));
  const pct = (v: number) => (v > 0 ? Math.max(MIN_VISIBLE, Math.round((v / max) * 100)) : 0);
  return items.map((i) => ({
    key: i.key,
    label: i.label,
    value: i.value,
    secondary: i.secondary,
    widthPct: pct(i.value),
    secondaryWidthPct: pct(i.secondary),
  }));
}

/** Comparação por serviço (ou profissional), ordenada do maior para o menor. */
export function rankBars<T extends PerfRow & { id?: string; name: string }>(rows: T[]): RankBar[] {
  return buildRank(
    rows.map((r) => ({
      key: r.id || r.name,
      label: r.name,
      value: Math.max(0, r.bookings),
      secondary: Math.max(0, r.completed),
    })),
  ).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'pt-BR'));
}

/** Comparação por origem de lead, ordenada do maior para o menor. */
export function originBars(rows: OriginPerformance[]): RankBar[] {
  return buildRank(
    rows.map((o) => ({
      key: o.name,
      label: o.name,
      value: Math.max(0, o.leads),
      secondary: Math.max(0, o.converted),
    })),
  ).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, 'pt-BR'));
}
