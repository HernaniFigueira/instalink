// ═══════════════════════════════════════════════════════════════
// AGENDA TEMPORAL 2.0 — FUNDAÇÃO TEMPORAL (ETAPA B1)
// ═══════════════════════════════════════════════════════════════
// Módulo PURO (sem I/O, sem banco, sem `Date.now()`): serve tanto o servidor
// quanto as telas. É a ÚNICA autoridade de conversão temporal do agendamento —
// nenhuma rota, tela ou motor de slots converte horário por conta própria.
//
// CONTRATO CANÔNICO DO BOOKING (autoridade):
//
//   startAt + endAt   janela temporal autoritativa (instantes UTC, RFC 3339);
//   durationMin       snapshot CONGELADO da duração daquele atendimento;
//   timeZone          fuso IANA usado para capturar a intenção local;
//   temporalSource    'native' (capturado na criação) | 'legacy_inferred'
//                     (derivado de date/time + fuso + duração disponível).
//
// `date`/`time` continuam existindo nesta etapa como PROJEÇÃO COMPATÍVEL no
// fuso da clínica — escritas atomicamente junto da janela, nunca divergentes.
//
// REGRA DE OURO (testada em regressão): mudar `Service.durationMin` NUNCA
// muda a duração de um agendamento já criado. A duração histórica vem do
// snapshot do próprio Booking; a do serviço só vale para NOVOS agendamentos
// ou como fallback LEGADO explícito (nunca para um Booking canônico).
//
// FUSO: usamos Intl (ICU do Node/Vercel) — nenhuma dependência nova. Intenção
// local inexistente (DST gap) ou ambígua (DST fold) é RECUSADA com erro
// explícito; o produto nunca reinterpreta um horário em silêncio.
import type { Booking, BookingTemporalSource } from './types';
import { DAY_MS, DEFAULT_TIMEZONE, effectiveTimezone, isValidClockTime, isValidDateISO, isValidTimezone } from './tz';

export type { BookingTemporalSource };

export interface BookingWindow {
  /** Instante absoluto UTC (RFC 3339) do início — autoridade da janela. */
  startAt: string;
  /** Instante absoluto UTC (RFC 3339) do fim — autoridade da janela. */
  endAt: string;
  /** Snapshot congelado da duração (minutos inteiros). */
  durationMin: number;
  /** Fuso IANA que interpretou a intenção local. */
  timeZone: string;
  source: BookingTemporalSource;
}

/** Campos temporais gravados no Booking (aditivos ao contrato antigo). */
export interface BookingTemporalFields {
  startAt?: string;
  endAt?: string;
  durationMin?: number;
  timeZone?: string;
  temporalSource?: BookingTemporalSource;
}

/** Entrada mínima aceita por `resolveBookingWindow` (Booking ou DTO). */
export interface BookingTemporalInput extends BookingTemporalFields {
  date?: string;
  time?: string;
}

export interface ResolvedBookingWindow extends BookingWindow {
  /**
   * Projeção civil usada pela grade/ocupação: quando há instantes, é a
   * projeção deles NO FUSO DA CLÍNICA informado em `opts.timeZone` (e não no
   * fuso gravado, que pode ter mudado). Sem instantes, é o `date`/`time`
   * legado lido como estava gravado.
   */
  local: { date: string; time: string };
  /** true quando a janela é inferida de dado legado (nunca precisão nativa). */
  inferred: boolean;
  /**
   * true quando nem os instantes nem uma data/hora civil conversível existem
   * (ex.: `date`/`time` vazio ou caindo em DST gap). A ocupação continua sendo
   * calculada pela leitura civil; nenhum instante é inventado.
   */
  unresolvable: boolean;
}

export interface ResolveBookingWindowOptions {
  /** Fuso IANA da CLÍNICA — autoridade de projeção e de captura da intenção. */
  timeZone?: string | null;
  /** Duração do serviço do Booking (fallback legado EXPLÍCITO, nunca canônico). */
  serviceDurationMin?: number | null;
  /** Duração padrão do sistema quando não há serviço nem snapshot. */
  fallbackDurationMin?: number;
}

// ── Erros temporais tipados (a borda da API traduz em 400 humano) ──
export type TemporalErrorCode =
  | 'invalid_timezone'
  | 'invalid_local_time'
  | 'nonexistent_local_time'
  | 'ambiguous_local_time'
  | 'invalid_instant'
  | 'invalid_duration';

export interface TemporalError extends Error {
  temporalCode: TemporalErrorCode;
}

function temporalError(code: TemporalErrorCode, message: string): TemporalError {
  return Object.assign(new Error(message), { temporalCode: code, status: 400 });
}

/** Código estável de um erro temporal ('' quando não é erro temporal). */
export function temporalErrorCode(e: unknown): TemporalErrorCode | '' {
  const code = (e as { temporalCode?: TemporalErrorCode } | null)?.temporalCode;
  return code || '';
}

// ═══════════════════════════════════════════════════════════════
// NÚCLEO IANA (Intl — sem dependência externa)
// ═══════════════════════════════════════════════════════════════
const PARTS_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = PARTS_FORMATTERS.get(timeZone);
  if (cached) return cached;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });
  PARTS_FORMATTERS.set(timeZone, fmt);
  return fmt;
}

/** Fuso IANA válido e explícito, ou erro. NUNCA cai para o fuso do servidor. */
export function requireTimezone(timeZone: string | null | undefined): string {
  const tz = typeof timeZone === 'string' ? timeZone.trim() : '';
  if (!tz) throw temporalError('invalid_timezone', 'O fuso IANA da clínica precisa ser informado explicitamente.');
  if (!isValidTimezone(tz)) throw temporalError('invalid_timezone', `Fuso IANA inválido: ${tz}`);
  return tz;
}

/** Fuso IANA da clínica com o default do produto (para leitura, nunca para escrita pública). */
export function bookingTimezone(timeZone?: string | null): string {
  return effectiveTimezone(timeZone) || DEFAULT_TIMEZONE;
}

/** Wall-clock (ms "como se UTC") do instante no fuso — precisão de segundo. */
function wallClockMs(epochMs: number, timeZone: string): number {
  const p = partsFormatter(timeZone).formatToParts(new Date(epochMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value || 0);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
}

/** Offset do fuso (ms) num instante — inclui o histórico de DST do ICU. */
function offsetMsAt(epochMs: number, timeZone: string): number {
  const second = Math.floor(epochMs / 1000) * 1000;
  return wallClockMs(second, timeZone) - second;
}

function parseInstant(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isoInstant(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Intenção local (data/hora civil) → instante UTC.
 * DST gap (horário inexistente) e DST fold (ambíguo) são RECUSADOS: um horário
 * que não existe ou vale duas vezes não pode ser reinterpretado em silêncio.
 */
export function localDateTimeToInstant(date: string, time: string, timeZone: string): string {
  const tz = requireTimezone(timeZone);
  if (!isValidDateISO(date) || !isValidClockTime(time)) {
    throw temporalError('invalid_local_time', 'Data (YYYY-MM-DD) ou horário (HH:MM) inválidos.');
  }
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, min, 0, 0);
  // Offsets um dia antes/depois "cercam" qualquer transição de DST possível.
  const before = offsetMsAt(wall - DAY_MS, tz);
  const after = offsetMsAt(wall + DAY_MS, tz);
  const candidates = new Set<number>([wall - before, wall - after]);
  const valid = [...candidates].filter((ms) => wallClockMs(ms, tz) === wall);
  if (valid.length === 0) {
    throw temporalError(
      'nonexistent_local_time',
      `${time} de ${date} não existe no fuso ${tz} (mudança de horário). Escolha outro horário.`,
    );
  }
  if (valid.length > 1) {
    throw temporalError(
      'ambiguous_local_time',
      `${time} de ${date} acontece duas vezes no fuso ${tz} (mudança de horário). Escolha outro horário.`,
    );
  }
  return isoInstant(valid[0]);
}

/** Instante UTC → projeção civil (data/hora) no fuso informado. */
export function instantToLocalProjection(instant: string, timeZone: string): { date: string; time: string } {
  const tz = requireTimezone(timeZone);
  const ms = parseInstant(instant);
  if (ms === null) throw temporalError('invalid_instant', `Instante inválido: ${String(instant)}`);
  const wall = wallClockMs(ms, tz);
  const dt = new Date(wall);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
    time: `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`,
  };
}

/** Duração em minutos inteiros, positiva. */
export function normalizeBookingDuration(value: unknown, fallback = 30): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0) {
    const f = Math.round(Number(fallback));
    return Number.isFinite(f) && f > 0 ? f : 30;
  }
  return n;
}

function positiveDuration(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ═══════════════════════════════════════════════════════════════
// JANELA CANÔNICA (escrita) — usada por TODA criação nova
// ═══════════════════════════════════════════════════════════════
/**
 * Constrói a janela canônica a partir da intenção local + duração do SERVIDOR
 * (a duração recebida do navegador nunca é autoridade). Lança em DST gap/fold.
 */
export function buildBookingWindow(input: {
  date: string;
  time: string;
  durationMin: number;
  timeZone: string;
}): BookingWindow {
  const tz = requireTimezone(input.timeZone);
  const duration = normalizeBookingDuration(input.durationMin);
  const startAt = localDateTimeToInstant(input.date, input.time, tz);
  const endAt = isoInstant(parseInstant(startAt)! + duration * 60_000);
  return { startAt, endAt, durationMin: duration, timeZone: tz, source: 'native' };
}

/** Campos temporais prontos para espalhar (`...`) num Booking novo. */
export function bookingWindowFields(
  window: BookingWindow,
  projectionTimeZone: string,
): Required<BookingTemporalFields> & { date: string; time: string } {
  const local = instantToLocalProjection(window.startAt, requireTimezone(projectionTimeZone));
  return {
    startAt: window.startAt,
    endAt: window.endAt,
    durationMin: window.durationMin,
    timeZone: window.timeZone,
    temporalSource: window.source,
    date: local.date,
    time: local.time,
  };
}

/**
 * Escreve a janela no Booking de forma ATÔMICA: instantes, snapshot, fuso e a
 * projeção `date`/`time` no fuso da clínica — nunca uma representação sem a
 * outra (divergência é impossível por construção).
 */
export function applyBookingWindow<T extends BookingTemporalInput>(
  booking: T,
  window: BookingWindow,
  projectionTimeZone: string,
): T {
  const fields = bookingWindowFields(window, projectionTimeZone);
  booking.startAt = fields.startAt;
  booking.endAt = fields.endAt;
  booking.durationMin = fields.durationMin;
  booking.timeZone = fields.timeZone;
  booking.temporalSource = fields.temporalSource;
  booking.date = fields.date;
  booking.time = fields.time;
  return booking;
}

// ═══════════════════════════════════════════════════════════════
// RESOLUÇÃO DE LEITURA — janela/snapshot PRIMEIRO, legado depois
// ═══════════════════════════════════════════════════════════════
/**
 * Resolve a janela de um Booking. Ordem de autoridade:
 *   1. `startAt` + `endAt` (canônicos) — a diferença manda sobre durationMin;
 *   2. snapshot `durationMin` do próprio Booking (congelado);
 *   3. fallback legado explícito (`serviceDurationMin`/`fallbackDurationMin`),
 *      marcado `legacy_inferred`.
 * NUNCA consulta `Service.durationMin` de um Booking canônico.
 */
export function resolveBookingWindow(
  booking: BookingTemporalInput,
  opts: ResolveBookingWindowOptions = {},
): ResolvedBookingWindow {
  const clinicTz = bookingTimezone(opts.timeZone);
  const snapshot = positiveDuration(booking.durationMin);
  const fallback = positiveDuration(opts.serviceDurationMin)
    ?? positiveDuration(opts.fallbackDurationMin)
    ?? 30;

  const startMs = parseInstant(booking.startAt);
  const endMs = parseInstant(booking.endAt);
  if (startMs !== null && endMs !== null && endMs > startMs) {
    const duration = Math.round((endMs - startMs) / 60_000);
    const source: BookingTemporalSource = booking.temporalSource === 'legacy_inferred' ? 'legacy_inferred' : 'native';
    const zone = typeof booking.timeZone === 'string' && isValidTimezone(booking.timeZone) ? booking.timeZone : clinicTz;
    return {
      startAt: isoInstant(startMs),
      endAt: isoInstant(endMs),
      durationMin: duration,
      timeZone: zone,
      source,
      local: instantToLocalProjection(isoInstant(startMs), clinicTz),
      inferred: source === 'legacy_inferred',
      unresolvable: false,
    };
  }

  // Sem instantes: leitura CIVIL (legado ou janela parcial). A duração vem do
  // snapshot quando existir; senão, do serviço — explicitamente legado.
  const duration = snapshot ?? fallback;
  const civil = isValidDateISO(String(booking.date || '')) && isValidClockTime(String(booking.time || ''));
  const local = civil ? { date: String(booking.date), time: String(booking.time) } : { date: '', time: '' };
  const legacy: ResolvedBookingWindow = {
    startAt: '', endAt: '', durationMin: duration, timeZone: clinicTz,
    source: 'legacy_inferred', local, inferred: true, unresolvable: true,
  };
  if (!civil) return legacy;
  try {
    const startAt = localDateTimeToInstant(local.date, local.time, clinicTz);
    return {
      ...legacy,
      startAt,
      endAt: isoInstant(parseInstant(startAt)! + duration * 60_000),
      unresolvable: false,
    };
  } catch {
    // Horário inexistente/ambíguo num dado legado: a leitura civil continua
    // válida para ocupar a grade; nenhum instante é inventado em silêncio.
    return legacy;
  }
}

/** Projeção civil do Booking no fuso informado ('' quando não há data/hora). */
export function bookingLocalProjection(
  booking: BookingTemporalInput,
  opts: ResolveBookingWindowOptions = {},
): { date: string; time: string } {
  return resolveBookingWindow(booking, opts).local;
}

/** Duração efetiva do Booking: snapshot/janela primeiro, serviço só em legado. */
export function resolveBookingDurationMin(
  booking: BookingTemporalInput | null | undefined,
  opts: ResolveBookingWindowOptions = {},
): number {
  if (!booking) return normalizeBookingDuration(opts.serviceDurationMin ?? opts.fallbackDurationMin, 30);
  return resolveBookingWindow(booking, opts).durationMin;
}

/** O Booking já tem janela canônica congelada (instantes válidos)? */
export function hasCanonicalWindow(booking: BookingTemporalInput | null | undefined): boolean {
  if (!booking) return false;
  const start = parseInstant(booking.startAt);
  const end = parseInstant(booking.endAt);
  return start !== null && end !== null && end > start;
}

// ═══════════════════════════════════════════════════════════════
// LEGADO — congelar a inferência (sem backfill destrutivo silencioso)
// ═══════════════════════════════════════════════════════════════
/**
 * Congela a janela de um Booking legado (sem instantes) usando a duração
 * disponível AGORA — marcada explicitamente `legacy_inferred`.
 *
 * HONESTIDADE HISTÓRICA: a duração original de um agendamento antigo nunca
 * foi armazenada. A inferência é a melhor aproximação disponível e NUNCA é
 * apresentada como precisão nativa. O que ela garante é que, uma vez
 * congelada, edições futuras de `Service.durationMin` não a alterem mais.
 *
 * Devolve true apenas quando gravou uma janela; horário irresolúvel (DST
 * gap/fold no dado antigo) permanece legível pela leitura civil.
 */
export function freezeLegacyBookingWindow(
  booking: BookingTemporalInput,
  opts: ResolveBookingWindowOptions = {},
): boolean {
  if (hasCanonicalWindow(booking)) return false;
  const resolved = resolveBookingWindow(booking, opts);
  if (!resolved.startAt || !resolved.endAt) return false;
  booking.startAt = resolved.startAt;
  booking.endAt = resolved.endAt;
  booking.durationMin = resolved.durationMin;
  booking.timeZone = resolved.timeZone;
  booking.temporalSource = 'legacy_inferred';
  return true;
}

/**
 * Congela a inferência dos Bookings legados de UM serviço. Chamado ANTES de
 * uma escrita que mudaria `Service.durationMin` (e também quando um Booking
 * legado é persistido por outro motivo) — é o que impede que a duração
 * histórica se mova retroativamente. Não toca em Bookings já canônicos.
 */
export function freezeLegacyWindowsForService(
  db: { bookings: Booking[] },
  p: { businessId: string; serviceId: string; durationMin?: number | null; timeZone?: string | null },
): number {
  let frozen = 0;
  for (const b of db.bookings || []) {
    if (b.businessId !== p.businessId || b.serviceId !== p.serviceId) continue;
    if (freezeLegacyBookingWindow(b, { timeZone: p.timeZone, serviceDurationMin: p.durationMin })) frozen += 1;
  }
  return frozen;
}
