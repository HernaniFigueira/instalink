import type { AvailabilityException } from './types';
import { timeToMin } from './utils';
/** Display-only complement of the same first date exception used by computeSlots.
 * A special interval is OPEN time, never a partial closure. No ScheduleBlock writes.
 */
export function exceptionUnavailableRanges(exceptions: AvailabilityException[], date: string, from: number, to: number, normalWindows?: Array<{ start: number; end: number }>) {
  const exception = exceptions.find(e => e.date === date);
  if (!exception || to <= from) return [];
  const label = exception.note || 'Dia especial';
  if (exception.closed) return [{ start: from, end: to, label }];
  if (!exception.start || !exception.end) return [];
  const start = timeToMin(exception.start), end = timeToMin(exception.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const complement = [{ start: from, end: Math.min(to, start), label }, { start: Math.max(from, end), end: to, label }].filter(r => r.end > r.start);
  if (!normalWindows) return complement;
  // Attribute the exception's reason only to hours removed from the normal routine.
  const clipped = complement.flatMap(r => normalWindows.map(w => ({ start: Math.max(r.start, w.start), end: Math.min(r.end, w.end), label }))).filter(r => r.end > r.start).sort((a,b) => a.start - b.start);
  const merged: typeof clipped = [];
  for (const r of clipped) { const last = merged[merged.length - 1]; if (last && r.start <= last.end) last.end = Math.max(last.end, r.end); else merged.push({ ...r }); }
  return merged;
}
