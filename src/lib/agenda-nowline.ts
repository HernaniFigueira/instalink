// ═══════════════════════════════════════════════════════════════
// LINHA DO HORÁRIO ATUAL — decisão puramente visual
// ═══════════════════════════════════════════════════════════════
// Diz ONDE desenhar o marcador de "agora" na grade — ou se ele nem deve
// existir. Regra de honestidade visual do briefing: a linha só aparece quando
// o dia/hora atual está DENTRO do recorte visível (visão de dia focada em hoje,
// ou coluna de hoje na semana, e o minuto atual entre o início e o fim da
// grade). Fora disso, nada de linha fantasma.
//
// É 100% apresentação: nenhuma regra de tempo, disponibilidade ou agendamento
// passa por aqui.
export type NowLineView = 'day' | 'week' | 'month';

export interface NowLineInput {
  view: NowLineView;
  /** Dia focado (ISO). */
  focus: string;
  /** Hoje no fuso da clínica (ISO). */
  today: string;
  /** Minuto atual do dia no fuso da clínica. */
  nowMin: number;
  gridStart: number;
  gridEnd: number;
  /** Colunas da grade (na semana, para achar a de hoje). */
  columns: ReadonlyArray<{ isToday?: boolean }>;
  pxPerHour: number;
}

export interface NowLinePlacement {
  /** Deslocamento vertical em px dentro do corpo da grade. */
  top: number;
  /** Na semana a linha ocupa só a coluna de hoje. */
  left?: string;
  width?: string;
}

export function nowLinePlacement(input: NowLineInput): NowLinePlacement | null {
  const { view, focus, today, nowMin, gridStart, gridEnd, columns, pxPerHour } = input;
  if (view === 'month') return null;
  if (nowMin < gridStart || nowMin > gridEnd) return null;

  const top = ((nowMin - gridStart) / 60) * pxPerHour;

  if (view === 'day') {
    return focus === today ? { top } : null;
  }

  // semana: só a coluna de hoje recebe o marcador
  const idx = columns.findIndex((c) => c.isToday);
  if (idx < 0) return null;
  const w = 100 / Math.max(1, columns.length);
  return { top, left: `${idx * w}%`, width: `${w}%` };
}
