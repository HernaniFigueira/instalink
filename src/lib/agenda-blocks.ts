import type { ScheduleBlock } from './types';
import { instantToLocalProjection } from './booking-temporal';
import { timeToMin } from './utils';

/** Civil-day clipping shared by Day/Week. Week columns represent a day, not a professional. */
export function blockOnAgendaColumn(block: ScheduleBlock, date: string, professionalId: string, view: 'day' | 'week', timeZone: string) {
  const start = instantToLocalProjection(block.startAt, timeZone);
  const end = instantToLocalProjection(block.endAt, timeZone);
  if (date < start.date || date > end.date) return null;
  if (view === 'day' && block.professionalId && block.professionalId !== professionalId) return null;
  const from = date === start.date ? timeToMin(start.time) : 0;
  const to = date === end.date ? timeToMin(end.time) : 1440;
  if (to <= from) return null;
  return { from, to, timeLabel: `${date === start.date ? start.time : '00:00'}–${date === end.date ? end.time : '24:00'}` };
}
