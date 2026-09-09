// Motor universal de disponibilidade (serve barbearia, clínica, pet, etc.)
import type { Availability, Booking } from './types';
import { timeToMin, minToTime } from './utils';

export function computeSlots(
  rules: Availability[],
  bookings: Booking[],
  dateISO: string,
  weekday: number,
  professionalId: string,
  durationMin: number,
): string[] {
  const applicable = rules.filter(
    (r) => r.weekday === weekday && (!r.professionalId || r.professionalId === professionalId),
  );
  if (applicable.length === 0) return [];

  const busy = bookings
    .filter((b) => b.date === dateISO && b.status !== 'cancelled' && (!professionalId || !b.professionalId || b.professionalId === professionalId))
    .map((b) => ({ start: timeToMin(b.time), end: timeToMin(b.time) + durationMin }));

  const out: string[] = [];
  for (const rule of applicable) {
    const start = timeToMin(rule.start);
    const end = timeToMin(rule.end);
    const step = Math.max(10, rule.slotMin || 30);
    for (let t = start; t + durationMin <= end; t += step) {
      const overlaps = busy.some((b) => t < b.end && t + durationMin > b.start);
      if (!overlaps) out.push(minToTime(t));
    }
  }
  return [...new Set(out)].sort();
}
