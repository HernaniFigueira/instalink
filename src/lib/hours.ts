// ═══════════════════════════════════════════════════════════════
// STATUS DE FUNCIONAMENTO DA PÁGINA PÚBLICA — "Aberto agora" honesto
// ═══════════════════════════════════════════════════════════════
// Derivado 100% do horário cadastrado do negócio (Business.hours, chaves
// '0'..'6' = dom..sáb). Não inventa nada: se o negócio não configurou
// nenhum dia, não existe status (null) e a página não mostra chip.
import { nowHM, todayISO, addDaysISO, weekdayOf } from './tz';
import type { DayHours } from './types';

export interface OpenStatus {
  open: boolean;
  /** Rótulo curto exibido na página ("Aberto até 19:00", "Fechado · abre às 08:00"). */
  label: string;
}

function defDay(hours: Record<string, DayHours | null> | undefined, wd: number): DayHours | null {
  const h = hours?.[String(wd)];
  return h && h.open && h.close ? h : null;
}

/**
 * O negócio está aberto agora? `null` = sem horário configurado (não
 * mostramos status em cima de achismo).
 */
export function openStatus(
  hours: Record<string, DayHours | null> | undefined,
  now = new Date(),
): OpenStatus | null {
  if (!hours) return null;
  const anyConfigured = ['0', '1', '2', '3', '4', '5', '6'].some((k) => {
    const h = hours[k];
    return !!(h && h.open && h.close);
  });
  if (!anyConfigured) return null;

  const today = todayISO(now);
  const hm = nowHM(now);
  const wd = weekdayOf(today);
  const todayHours = defDay(hours, wd);

  if (todayHours) {
    if (hm >= todayHours.open && hm < todayHours.close) {
      return { open: true, label: `Aberto agora · até ${todayHours.close}` };
    }
    if (hm < todayHours.open) {
      return { open: false, label: `Fechado · abre hoje às ${todayHours.open}` };
    }
  }
  // Próximo dia com atendimento nos próximos 7 dias (sem prometer o improvável).
  for (let i = 1; i <= 7; i += 1) {
    const d = addDaysISO(today, i);
    const h = defDay(hours, weekdayOf(d));
    if (h) {
      const when = i === 1 ? 'amanhã' : `dia ${d.slice(8, 10)}/${d.slice(5, 7)}`;
      return { open: false, label: `Fechado · abre ${when} às ${h.open}` };
    }
  }
  return { open: false, label: 'Atendimento sob consulta' };
}
