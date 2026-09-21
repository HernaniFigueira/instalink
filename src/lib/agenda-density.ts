import type { Availability, AvailabilityException, Booking, Service } from './types';
import { timeToMin } from './utils';
import { weekdayOf } from './tz';
import { bookingDuration } from './booking-ops';
export type AgendaDensity = 'compact' | 'comfortable';

/** Presentation envelope only: never a source of booking/availability authorization. */
export function agendaEnvelope(dates: string[], rules: Availability[], exceptions: AvailabilityException[], bookings: Booking[], services: Service[]) {
  const selected = new Set(dates), weekdays = new Set(dates.map(weekdayOf));
  const windows: Array<{start:number;end:number}> = [];
  for (const rule of rules) if(weekdays.has(rule.weekday) && timeToMin(rule.end)>timeToMin(rule.start)) windows.push({start:timeToMin(rule.start),end:timeToMin(rule.end)});
  for (const exception of exceptions) if(selected.has(exception.date) && exception.start && exception.end && timeToMin(exception.end)>timeToMin(exception.start)) windows.push({start:timeToMin(exception.start),end:timeToMin(exception.end)});
  // Include every loaded event on these dates, even outside configured hours or hidden by a presentation filter.
  for (const booking of bookings) if(selected.has(booking.date)) {
    const start=timeToMin(booking.time);
    windows.push({start,end:start+bookingDuration(services.find(s=>s.id===booking.serviceId),30)});
  }
  const start=windows.length?Math.floor(Math.min(...windows.map(w=>w.start))/60)*60:8*60;
  const end=windows.length?Math.max(start+60,Math.ceil(Math.max(...windows.map(w=>w.end))/60)*60):18*60;
  return {start,end,span:end-start,hours:(end-start)/60};
}
export function agendaScale(density: AgendaDensity, hours: number, availableBodyHeight: number) {
  return density==='comfortable'?72:Math.max(40,Math.min(72,Math.floor(availableBodyHeight/Math.max(1,hours))));
}
