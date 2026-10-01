import { Temporal } from 'temporal-polyfill';
import {
  createWindow,
  eventPresentation,
  instantToLocalDateTime,
  type AppointmentWindow,
  type BookingStatus,
} from './temporal-contract.ts';

export const DEMO_BUSINESS_ID = 'spike-clinica-orlando';
export const DEMO_TIME_ZONE = 'America/Sao_Paulo';
export const DEMO_WEEK_START = '2026-10-05'; // segunda-feira, fixa para reproduzir os gestos pedidos

export const PROFESSIONALS = [
  { id: 'pro-orlando', name: 'Dr. Orlando', initials: 'DO', role: 'Clínico geral' },
  { id: 'pro-ana', name: 'Dra. Ana', initials: 'DA', role: 'Dermatologia' },
  { id: 'pro-carlos', name: 'Dr. Carlos', initials: 'DC', role: 'Cirurgia' },
  { id: 'pro-bianca', name: 'Dra. Bianca', initials: 'DB', role: 'Clínica geral' },
  { id: 'pro-rafael', name: 'Dr. Rafael', initials: 'DR', role: 'Diagnóstico' },
] as const;

export type SpikeProfessional = (typeof PROFESSIONALS)[number];
export const DAY_PROFESSIONALS: readonly SpikeProfessional[] = PROFESSIONALS.slice(0, 3);

export const SERVICES = [
  { id: 'svc-consulta', name: 'Consulta clínica', durationMin: 40, color: '#2563eb' },
  { id: 'svc-retorno', name: 'Retorno', durationMin: 30, color: '#0f766e' },
  { id: 'svc-vacina', name: 'Vacina V8', durationMin: 20, color: '#7c3aed' },
  { id: 'svc-dermato', name: 'Procedimento dermatológico', durationMin: 55, color: '#c2410c' },
  { id: 'svc-procedimento-90', name: 'Procedimento clínico', durationMin: 90, color: '#be123c' },
] as const;

export interface SpikeEvent extends AppointmentWindow {
  id: string;
  businessId: string;
  professionalId: string;
  customerName: string;
  serviceId: string;
  serviceName: string;
  status: BookingStatus;
  note?: string;
  isBenchmark?: boolean;
}

export interface SpikeResource {
  id: string;
  title: string;
}

const STATUS_CYCLE: BookingStatus[] = ['confirmed', 'pending', 'completed', 'no_show', 'cancelled'];
function event(input: {
  id: string;
  professionalId: string;
  date?: string;
  time: string;
  durationMin: number;
  customerName: string;
  serviceId: string;
  status: BookingStatus;
  note?: string;
  isBenchmark?: boolean;
}): SpikeEvent {
  const service = SERVICES.find((item) => item.id === input.serviceId)!;
  const window = createWindow(input.date || DEMO_WEEK_START, input.time, input.durationMin, DEMO_TIME_ZONE);
  return {
    ...window,
    id: input.id,
    businessId: DEMO_BUSINESS_ID,
    professionalId: input.professionalId,
    customerName: input.customerName,
    serviceId: input.serviceId,
    serviceName: service.name,
    status: input.status,
    ...(input.note ? { note: input.note } : {}),
    ...(input.isBenchmark ? { isBenchmark: true } : {}),
  };
}

/** Seven realistic events; the first one is the 10:00 / 40-minute gesture target. */
export function demoEvents(): SpikeEvent[] {
  return [
    event({ id: 'booking-orlando-1000', professionalId: 'pro-orlando', time: '10:00', durationMin: 40, customerName: 'Marina Costa · Luna', serviceId: 'svc-consulta', status: 'confirmed', note: 'Selecionar 10:00–10:40; mover e redimensionar.' }),
    event({ id: 'booking-orlando-conflict', professionalId: 'pro-orlando', time: '12:30', durationMin: 30, customerName: 'Pedro Lima · Bento', serviceId: 'svc-vacina', status: 'pending', note: 'Âncora de conflito do profissional.' }),
    event({ id: 'booking-ana-retorno', professionalId: 'pro-ana', time: '09:30', durationMin: 40, customerName: 'Luciana Alves · Mel', serviceId: 'svc-retorno', status: 'confirmed' }),
    event({ id: 'booking-ana-dermato', professionalId: 'pro-ana', time: '11:00', durationMin: 55, customerName: 'Rafael Nunes · Thor', serviceId: 'svc-dermato', status: 'no_show' }),
    event({ id: 'booking-carlos-vacina', professionalId: 'pro-carlos', time: '10:30', durationMin: 30, customerName: 'Clara Reis · Nina', serviceId: 'svc-vacina', status: 'completed' }),
    event({ id: 'booking-carlos-cancelado', professionalId: 'pro-carlos', time: '13:00', durationMin: 40, customerName: 'Paulo Mota · Max', serviceId: 'svc-consulta', status: 'cancelled' }),
    event({ id: 'booking-carlos-procedimento-90', professionalId: 'pro-carlos', time: '15:00', durationMin: 90, customerName: 'Helena Dias · Pingo', serviceId: 'svc-procedimento-90', status: 'confirmed' }),
  ];
}

/**
 * Deterministic workload: exactly 5 professionals and N appointments inside
 * one clinic week. Baseline appointments stay fixed for visual interaction;
 * generated rows occupy other dates or later non-conflicting slots.
 */
export function benchmarkEvents(count: number): SpikeEvent[] {
  const total = Math.max(7, Math.min(1_000, Math.floor(count)));
  const events = demoEvents();
  const existing = new Set(events.map((item) => item.id));
  const extra = total - events.length;
  const days = Array.from({ length: 7 }, (_, offset) => Temporal.PlainDate.from(DEMO_WEEK_START).add({ days: offset }).toString());
  // Thirty-six half-hour starts (05:00–22:30) cover the 1000-event stress case
  // while leaving headroom for the fixed visual appointments.
  const slotMinutes = Array.from({ length: 36 }, (_, index) => 5 * 60 + index * 30);
  const occupied = new Map<string, Array<{ start: number; end: number }>>();
  for (const item of events) {
    const local = instantToLocalDateTime(item.startAt, DEMO_TIME_ZONE);
    const key = `${item.professionalId}:${local.date}`;
    const [hour, minute] = local.time.split(':').map(Number);
    const intervals = occupied.get(key) || [];
    intervals.push({ start: hour! * 60 + minute!, end: hour! * 60 + minute! + item.durationMin });
    occupied.set(key, intervals);
  }

  for (let index = 0; index < extra; index++) {
    const dayOffset = index % 7;
    const lane = Math.floor(index / 7) % PROFESSIONALS.length;
    const slotIndex = Math.floor(index / (7 * PROFESSIONALS.length));
    const pro = PROFESSIONALS[lane];
    const date = days[dayOffset]!;
    const minute = slotMinutes[slotIndex % slotMinutes.length]!;
    const id = `benchmark-${String(index + 1).padStart(4, '0')}`;
    if (existing.has(id)) continue;
    const service = SERVICES[index % SERVICES.length]!;
    const resourceKey = `${pro.id}:${date}`;
    const safeTime = resolveNonOverlappingBenchmarkTime(occupied.get(resourceKey) || [], minute, slotMinutes);
    const safeClock = `${String(Math.floor(safeTime / 60)).padStart(2, '0')}:${String(safeTime % 60).padStart(2, '0')}`;
    events.push(event({
      id,
      professionalId: pro.id,
      date,
      time: safeClock,
      durationMin: 30,
      customerName: `${['Marina', 'Rafael', 'Paulo', 'Clara', 'João'][index % 5]} · ${['Luna', 'Thor', 'Bento', 'Nina', 'Max'][index % 5]}`,
      serviceId: service.id,
      status: STATUS_CYCLE[index % STATUS_CYCLE.length]!,
      isBenchmark: true,
    }));
    const intervals = occupied.get(resourceKey) || [];
    intervals.push({ start: safeTime, end: safeTime + 30 });
    occupied.set(resourceKey, intervals);
    existing.add(id);
  }
  return events.slice(0, total);
}

function resolveNonOverlappingBenchmarkTime(
  occupied: Array<{ start: number; end: number }>,
  requestedMinute: number,
  candidateMinutes: number[],
): number {
  const candidates = [requestedMinute, ...candidateMinutes.filter((minute) => minute !== requestedMinute)];
  for (const minute of candidates) {
    const conflict = occupied.some((interval) => minute < interval.end && minute + 30 > interval.start);
    if (!conflict) return minute;
  }
  throw new RangeError('A carga do benchmark excede a janela de 05:00–23:00.');
}

function overlaps(a: Pick<AppointmentWindow, 'startAt' | 'endAt'>, b: Pick<AppointmentWindow, 'startAt' | 'endAt'>): boolean {
  return Date.parse(a.startAt) < Date.parse(b.endAt) && Date.parse(a.endAt) > Date.parse(b.startAt);
}

export function eventResources(professionals: readonly SpikeProfessional[] = PROFESSIONALS): SpikeResource[] {
  return professionals.map((pro) => ({ id: pro.id, title: pro.name }));
}

export function eventService(serviceId: string) {
  return SERVICES.find((service) => service.id === serviceId) || SERVICES[0];
}

export function weekDate(offset: number): string {
  return Temporal.PlainDate.from(DEMO_WEEK_START).add({ days: offset }).toString();
}

export function eventLocalStart(item: SpikeEvent) {
  return instantToLocalDateTime(item.startAt, item.timeZone);
}

export function eventLabel(item: SpikeEvent): string {
  return eventPresentation({ customerName: item.customerName, serviceName: item.serviceName, status: item.status }).ariaLabel;
}

export function eventHasSlotConflicts(a: SpikeEvent, b: SpikeEvent): boolean {
  return a.professionalId === b.professionalId && overlaps(a, b);
}
