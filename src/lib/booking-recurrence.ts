// Regras de calendário, sem disponibilidade: toda validação de vagas usa computeSlots.
import { addDaysISO, isValidDateISO, isValidClockTime } from './tz';
export const MAX_SERIES_OCCURRENCES = 366;
export interface BookingOccurrence { date: string; time: string; professionalId: string }
export type RecurrenceFrequency = 'weekly' | 'fortnightly' | 'monthly';

/** Mantém o dia âncora: 31/jan → 28(29)/fev → 31/mar, sem drift. */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, day] = iso.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, last));
  return first.toISOString().slice(0, 10);
}

export function generateOccurrences(first: BookingOccurrence, frequency: RecurrenceFrequency,
  end: { count: number } | { until: string }): BookingOccurrence[] {
  if (!isValidDateISO(first.date) || !isValidClockTime(first.time)) throw new Error('Escolha data e horário.');
  if (!['weekly', 'fortnightly', 'monthly'].includes(frequency)) throw new Error('Repetição inválida.');
  if ('count' in end && (!Number.isInteger(end.count) || end.count < 2 || end.count > MAX_SERIES_OCCURRENCES)) {
    throw new Error(`Escolha de 2 a ${MAX_SERIES_OCCURRENCES} atendimentos (incluindo o primeiro).`);
  }
  if ('until' in end && (!isValidDateISO(end.until) || end.until < first.date)) throw new Error('Data final inválida.');
  const result: BookingOccurrence[] = [];
  for (let i = 0; i <= MAX_SERIES_OCCURRENCES; i++) {
    const date = frequency === 'monthly' ? addMonthsClamped(first.date, i) : addDaysISO(first.date, i * (frequency === 'weekly' ? 7 : 14));
    if ('count' in end ? i >= end.count : date > end.until) break;
    if (i === MAX_SERIES_OCCURRENCES) throw new Error(`Limite de ${MAX_SERIES_OCCURRENCES} atendimentos por série.`);
    result.push({ ...first, date });
  }
  if (result.length < 2) throw new Error('A série precisa de pelo menos 2 atendimentos.');
  return result;
}
