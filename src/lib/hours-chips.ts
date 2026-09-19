// ═══════════════════════════════════════════════════════════════
// A3.4 — CHIPS DE HORÁRIO (a decisão, separada do desenho)
// ═══════════════════════════════════════════════════════════════
// A Disponibilidade resumia a semana numa frase corrida:
//   "Seg 08:00 — 20:00 · Ter 08:00 — 20:00 · Qua 08:00 — 20:00 · …"
// ilegível de relance. Aqui vive APENAS a decisão de o que mostrar em cada dia
// (ordem da semana, dia fechado, turnos múltiplos); o desenho é do
// `<HoursChips/>` em `components/ui.tsx`.
//
// Nenhum horário nasce aqui: a entrada vem de `businessHoursTable` /
// `professionalHoursTable` (lib/schedule.ts) — as MESMAS tabelas que o motor
// de slots usa. Este módulo só organiza para leitura.
export interface HoursChipDay {
  weekday: number;
  /** Janelas do dia (vazio = fechado). */
  windows: Array<{ start: string; end: string }>;
}

export interface HoursChip {
  weekday: number;
  /** Sigla do dia (SEG, TER…). */
  label: string;
  closed: boolean;
  windows: Array<{ start: string; end: string }>;
  /** Texto acessível/tooltip: "SEG 08:00 → 20:00" ou "DOM fechado". */
  text: string;
}

/** Ordem de leitura brasileira: a semana começa na segunda-feira. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

export const WEEK_SHORT = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'] as const;

/**
 * Monta os chips na ordem da semana. Dias ausentes da entrada são mostrados
 * como FECHADOS (ausência de regra é ausência de atendimento — nunca um
 * horário inventado).
 */
export function buildHoursChips(days: HoursChipDay[], opts: { fillClosed?: boolean } = {}): HoursChip[] {
  const { fillClosed = true } = opts;
  const byDay = new Map(days.map((d) => [d.weekday, d]));
  const out: HoursChip[] = [];
  for (const weekday of WEEK_ORDER) {
    const day = byDay.get(weekday);
    if (!day && !fillClosed) continue;
    const windows = (day?.windows || []).filter((w) => w.start && w.end);
    const closed = windows.length === 0;
    out.push({
      weekday,
      label: WEEK_SHORT[weekday],
      closed,
      windows,
      text: closed
        ? `${WEEK_SHORT[weekday]} fechado`
        : `${WEEK_SHORT[weekday]} ${windows.map((w) => `${w.start} → ${w.end}`).join(' · ')}`,
    });
  }
  return out;
}
