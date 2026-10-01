import { Temporal } from 'temporal-polyfill';

/**
 * Library-independent Agenda Temporal 2.0 contract used only by this spike.
 * Nothing in the production agenda imports this module.
 */
export const DEFAULT_SNAP_MIN = 5;

export type CalendarView = 'day' | 'week' | 'list';
export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';

export interface AppointmentWindow {
  /** Absolute RFC 3339 instant in UTC; start is inclusive. */
  startAt: string;
  /** Absolute RFC 3339 instant in UTC; end is exclusive. */
  endAt: string;
  /** Frozen duration snapshot; must equal endAt - startAt in minutes. */
  durationMin: number;
  /** IANA zone used to interpret the original local booking intent. */
  timeZone: string;
}

export interface LegacyAppointmentWindow {
  date?: string;
  time?: string;
  startAt?: string;
  endAt?: string;
  durationMin?: number;
  serviceDurationDefault?: number;
  timeZone?: string;
}

export interface WindowResolution {
  window: AppointmentWindow;
  source: 'canonical' | 'legacy';
  /** True when a legacy booking had no frozen duration and used a one-time default. */
  inferredDuration: boolean;
}

export interface EventPresentation {
  statusLabel: string;
  serviceLabel: string;
  ariaLabel: string;
  tone: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no-show';
}

const STATUS_PRESENTATION: Record<BookingStatus, Omit<EventPresentation, 'serviceLabel' | 'ariaLabel'>> = {
  pending: { statusLabel: 'Aguardando confirmação', tone: 'pending' },
  confirmed: { statusLabel: 'Confirmado', tone: 'confirmed' },
  cancelled: { statusLabel: 'Cancelado', tone: 'cancelled' },
  completed: { statusLabel: 'Concluído', tone: 'completed' },
  no_show: { statusLabel: 'Não compareceu', tone: 'no-show' },
};

export function requireTimeZone(value: string | null | undefined): string {
  if (!value?.trim()) throw new RangeError('O fuso IANA da unidade precisa ser informado explicitamente.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    throw new RangeError(`Fuso IANA inválido: ${value}`);
  }
}

function isoInstant(value: string | Temporal.Instant): string {
  const instant = typeof value === 'string' ? Temporal.Instant.from(value) : value;
  return instant.toString({ fractionalSecondDigits: 3 });
}

function checkedDuration(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('A duração deve ser maior que zero.');
  const rounded = Math.round(value);
  if (Math.abs(value - rounded) > 1e-7) throw new RangeError('A duração deve usar minutos inteiros.');
  return rounded;
}

export function minutesBetween(startAt: string, endAt: string): number {
  const start = Temporal.Instant.from(startAt);
  const end = Temporal.Instant.from(endAt);
  const milliseconds = Number(end.epochMilliseconds - start.epochMilliseconds);
  if (milliseconds <= 0 || milliseconds % 60_000 !== 0) {
    throw new RangeError('O intervalo precisa terminar depois do início e usar minutos inteiros.');
  }
  return milliseconds / 60_000;
}

/**
 * Resolves a civil date/time in the business IANA zone. Ambiguous or nonexistent
 * wall-clock times (DST folds/gaps) reject instead of silently shifting.
 */
export function localDateTimeToInstant(date: string, time: string, timeZone: string): string {
  const zone = requireTimeZone(timeZone);
  const local = Temporal.PlainDateTime.from(`${date}T${time}:00`);
  return isoInstant(local.toZonedDateTime(zone, { disambiguation: 'reject' }).toInstant());
}

export function instantToLocalDateTime(instant: string, timeZone: string): { date: string; time: string } {
  const zoned = Temporal.Instant.from(instant).toZonedDateTimeISO(requireTimeZone(timeZone));
  return {
    date: zoned.toPlainDate().toString(),
    time: zoned.toPlainTime().toString({ smallestUnit: 'minute' }),
  };
}

export function createWindow(
  date: string,
  time: string,
  durationMin: number,
  timeZone: string,
): AppointmentWindow {
  const duration = checkedDuration(durationMin);
  const zone = requireTimeZone(timeZone);
  const start = Temporal.Instant.from(localDateTimeToInstant(date, time, zone));
  const end = start.add({ minutes: duration });
  return { startAt: isoInstant(start), endAt: isoInstant(end), durationMin: duration, timeZone: zone };
}

/**
 * Prefer canonical instants. Old `date`/`time` rows are interpreted in the
 * booking/business zone; if they have no frozen duration, this deliberately
 * captures the service's then-current default only once (migration is lossy).
 */
export function resolveWindow(
  input: LegacyAppointmentWindow,
  businessTimeZone: string,
): WindowResolution {
  const zone = requireTimeZone(input.timeZone ?? businessTimeZone);
  if (input.startAt && input.endAt) {
    const duration = minutesBetween(input.startAt, input.endAt);
    if (input.durationMin !== undefined && checkedDuration(input.durationMin) !== duration) {
      throw new RangeError('durationMin diverge do intervalo canônico startAt/endAt.');
    }
    return {
      window: {
        startAt: isoInstant(input.startAt),
        endAt: isoInstant(input.endAt),
        durationMin: duration,
        timeZone: zone,
      },
      source: 'canonical',
      inferredDuration: false,
    };
  }
  if (!input.date || !input.time) throw new RangeError('Agendamento legado precisa de date/time.');
  const inferredDuration = input.durationMin === undefined || input.durationMin === null;
  const duration = inferredDuration
    ? (input.serviceDurationDefault || 30)
    : input.durationMin!;
  return {
    window: createWindow(input.date, input.time, duration, zone),
    source: 'legacy',
    inferredDuration,
  };
}

export function snapMinutes(value: number, stepMin = DEFAULT_SNAP_MIN, mode: 'floor' | 'ceil' | 'nearest' = 'nearest'): number {
  if (!Number.isFinite(value) || !Number.isInteger(stepMin) || stepMin < 1) {
    throw new RangeError('Minutos e passo de snap inválidos.');
  }
  const units = value / stepMin;
  const snapped = mode === 'floor' ? Math.floor(units) : mode === 'ceil' ? Math.ceil(units) : Math.round(units);
  return snapped * stepMin;
}

/** Snap an instant using the business wall-clock minute, not the browser zone. */
export function snapInstant(
  value: string,
  timeZone: string,
  stepMin = DEFAULT_SNAP_MIN,
  mode: 'floor' | 'ceil' | 'nearest' = 'nearest',
): string {
  const zone = requireTimeZone(timeZone);
  const instant = Temporal.Instant.from(value);
  const local = instant.toZonedDateTimeISO(zone);
  const roundingMode = mode === 'floor' ? 'floor' : mode === 'ceil' ? 'ceil' : 'halfExpand';
  return isoInstant(local.round({ smallestUnit: 'minute', roundingIncrement: stepMin, roundingMode }).toInstant());
}

/** Calendar drag/resize selection uses an exclusive end, matching intervals. */
export function selectWindow(
  startAt: string,
  endAt: string,
  timeZone: string,
  stepMin = DEFAULT_SNAP_MIN,
): AppointmentWindow {
  const zone = requireTimeZone(timeZone);
  const start = snapInstant(startAt, zone, stepMin, 'floor');
  const end = snapInstant(endAt, zone, stepMin, 'ceil');
  const durationMin = minutesBetween(start, end);
  return { startAt: start, endAt: end, durationMin, timeZone: zone };
}

/** Moving an event changes startAt and preserves its frozen elapsed duration. */
export function moveWindow(
  window: AppointmentWindow,
  targetStartAt: string,
  stepMin = DEFAULT_SNAP_MIN,
): AppointmentWindow {
  const durationMin = minutesBetween(window.startAt, window.endAt);
  const startAt = snapInstant(targetStartAt, window.timeZone, stepMin, 'nearest');
  const endAt = isoInstant(Temporal.Instant.from(startAt).add({ minutes: durationMin }));
  return { startAt, endAt, durationMin, timeZone: requireTimeZone(window.timeZone) };
}

/** Resize changes only the end; duration rounds to the 5-minute snap, min 5. */
export function resizeWindow(
  window: AppointmentWindow,
  targetEndAt: string,
  stepMin = DEFAULT_SNAP_MIN,
): AppointmentWindow {
  const snappedEnd = snapInstant(targetEndAt, window.timeZone, stepMin, 'nearest');
  const requested = minutesBetween(window.startAt, snappedEnd);
  const durationMin = Math.max(stepMin, snapMinutes(requested, stepMin, 'nearest'));
  const endAt = isoInstant(Temporal.Instant.from(window.startAt).add({ minutes: durationMin }));
  return { ...window, endAt, durationMin };
}

export function resizeToDuration(
  window: AppointmentWindow,
  requestedDurationMin: number,
  stepMin = DEFAULT_SNAP_MIN,
): AppointmentWindow {
  if (!Number.isFinite(requestedDurationMin) || requestedDurationMin <= 0) {
    throw new RangeError('A duração precisa ser maior que zero.');
  }
  const durationMin = Math.max(stepMin, snapMinutes(requestedDurationMin, stepMin, 'nearest'));
  const endAt = isoInstant(Temporal.Instant.from(window.startAt).add({ minutes: durationMin }));
  return { ...window, endAt, durationMin };
}

export function windowFromLocalMove(
  window: AppointmentWindow,
  date: string,
  time: string,
  stepMin = DEFAULT_SNAP_MIN,
): AppointmentWindow {
  const zone = requireTimeZone(window.timeZone);
  const [hour, minute] = time.split(':').map(Number);
  const snappedMinute = snapMinutes(hour * 60 + minute, stepMin, 'nearest');
  const snappedDate = snappedMinute >= 1_440 ? addCivilDays(date, Math.floor(snappedMinute / 1_440)) : date;
  const snappedTime = `${String(Math.floor((snappedMinute % 1_440) / 60)).padStart(2, '0')}:${String(snappedMinute % 60).padStart(2, '0')}`;
  const targetStartAt = localDateTimeToInstant(snappedDate, snappedTime, zone);
  return moveWindow(window, targetStartAt, stepMin);
}

function addCivilDays(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

export function overlaps(a: Pick<AppointmentWindow, 'startAt' | 'endAt'>, b: Pick<AppointmentWindow, 'startAt' | 'endAt'>): boolean {
  const aStart = Temporal.Instant.from(a.startAt).epochMilliseconds;
  const aEnd = Temporal.Instant.from(a.endAt).epochMilliseconds;
  const bStart = Temporal.Instant.from(b.startAt).epochMilliseconds;
  const bEnd = Temporal.Instant.from(b.endAt).epochMilliseconds;
  return aStart < bEnd && aEnd > bStart;
}

export function viewForViewport(width: number, preferred: CalendarView = 'day'): CalendarView {
  if (width <= 600) return 'list';
  return preferred;
}

export function libraryView(candidate: 'grid' | 'rbc' | 'fullcalendar' | 'schedule-x', view: CalendarView): string {
  const maps: Record<typeof candidate, Record<CalendarView, string>> = {
    grid: { day: 'day', week: 'week', list: 'list' },
    rbc: { day: 'day', week: 'week', list: 'agenda' },
    fullcalendar: { day: 'timeGridDay', week: 'timeGridWeek', list: 'listDay' },
    'schedule-x': { day: 'day', week: 'week', list: 'list' },
  };
  return maps[candidate][view];
}

export function eventPresentation(input: {
  customerName: string;
  serviceName: string;
  status: BookingStatus;
}): EventPresentation {
  const state = STATUS_PRESENTATION[input.status];
  const serviceLabel = input.serviceName.trim();
  return {
    ...state,
    serviceLabel,
    ariaLabel: `${input.customerName} · ${serviceLabel} · ${state.statusLabel}`,
  };
}

export function assertCanonicalWindow(window: AppointmentWindow): AppointmentWindow {
  const zone = requireTimeZone(window.timeZone);
  const durationMin = minutesBetween(window.startAt, window.endAt);
  if (checkedDuration(window.durationMin) !== durationMin) {
    throw new RangeError('durationMin precisa corresponder exatamente a endAt - startAt.');
  }
  return {
    startAt: isoInstant(window.startAt),
    endAt: isoInstant(window.endAt),
    durationMin,
    timeZone: zone,
  };
}
