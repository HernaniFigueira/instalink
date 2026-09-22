// ═══════════════════════════════════════════════════════════════
// CONSULTAS DA AGENDA — por clínica (business), unidade e PERÍODO.
// ═══════════════════════════════════════════════════════════════
// Isto é o oposto do "recarregar o documento": cada função seleciona SOMENTE
// as colunas e as LINHAS da janela pedida, com os índices da migração 0001
// (bookings_business_date_idx, availability_business_weekday_idx, …) e
// devolve os MESMOS tipos do domínio — os motores puros (computeSlots,
// dayAvailability) continuam sendo a única fonte de verdade das regras.
import type { PoolClient } from 'pg';
import type {
  Availability, AvailabilityException, Booking, Professional, Service,
} from '../types';
import { computeSlots, dayAvailability, type DayAvailability, type SlotResult } from '../slots';
import { bookingMaxDate, effectiveManageLimit, needsClosure } from '../booking-ops';
import { effectiveTimezone, isValidDateISO, nowHM, todayISO, weekdayOf } from '../tz';
import {
  rowToAvailability, rowToBooking, rowToBusinessCore, rowToException,
  rowToProfessional, rowToService,
} from './mapping';

/** Fatiha mínima da unidade para o motor da agenda. */
export interface AgendaSlice {
  business: ReturnType<typeof rowToBusinessCore>;
  services: Service[];
  professionals: Professional[];
  availability: Availability[];
  exceptions: AvailabilityException[];
  bookings: Booking[]; // somente a janela [from, to] (ou o dia)
}

const BIZ_COLS = `id, organization_id, owner_id, name, booking, business_timezone,
  automations, capability_flags, modes, features`;

/**
 * Carrega a fatia da agenda de UMA unidade dentro do período [from, to]
 * (datas YYYY-MM-DD, inclusive). Cinco SELECTs alvejados em paralelo —
 * nada de varrer outras unidades, outras coleções ou o período fora da
 * janela.
 */
export async function loadAgendaSlice(
  client: PoolClient | import('pg').Pool,
  businessId: string,
  window: { from: string; to: string },
): Promise<AgendaSlice | null> {
  const biz = await client.query(
    `SELECT ${BIZ_COLS} FROM app.businesses WHERE id = $1`,
    [businessId],
  );
  if (biz.rows.length === 0) return null;
  const [services, professionals, rules, exceptions, bookings] = await Promise.all([
    client.query(
      `SELECT id, business_id, category_id, name, description, image, price, show_price,
              duration_min, professional_ids, active, featured, bookable, questions
         FROM app.services WHERE business_id = $1`,
      [businessId],
    ),
    client.query(
      `SELECT id, business_id, name, role, photo, active, user_id, follow_business_hours
         FROM app.professionals WHERE business_id = $1 AND active IS NOT FALSE`,
      [businessId],
    ),
    client.query(
      `SELECT id, business_id, professional_id, service_id, weekday, start, "end", slot_min
         FROM app.availability WHERE business_id = $1`,
      [businessId],
    ),
    client.query(
      // Somente exceções da janela — o motor só olha o dia pedido.
      `SELECT id, business_id, date, closed, start, "end", note
         FROM app.availability_exceptions
        WHERE business_id = $1 AND date BETWEEN $2 AND $3`,
      [businessId, window.from, window.to],
    ),
    client.query(
      // Somente agendamentos da janela — índice (business_id, date).
      `SELECT id, business_id, customer_id, service_id, professional_id, date, time,
              customer_name, customer_phone, status, note, answers, created_at, updated_at,
              history, previous_id, reschedule_count, lead_id, series_id, series_index,
              series_count, series_request_id, series_fingerprint, booking_kind,
              checked_in_at, checked_in_by, checked_in_by_name
         FROM app.bookings
        WHERE business_id = $1 AND date BETWEEN $2 AND $3
        ORDER BY date, time`,
      [businessId, window.from, window.to],
    ),
  ]);
  return {
    business: rowToBusinessCore(biz.rows[0]),
    services: services.rows.map(rowToService),
    professionals: professionals.rows.map(rowToProfessional),
    availability: rules.rows.map(rowToAvailability),
    exceptions: exceptions.rows.map(rowToException),
    bookings: bookings.rows.map(rowToBooking),
  };
}

function baseQuery(slice: AgendaSlice, serviceId: string, durationMin: number, professionalId: string, eligibleProIds: string[], cfg: { leadMin: number; bufferMin: number }, dateISO: string, now: Date) {
  const btz = effectiveTimezone(slice.business.businessTimezone);
  const today = todayISO(now, btz);
  return {
    rules: slice.availability,
    exceptions: slice.exceptions,
    bookings: slice.bookings.filter((b) => b.date === dateISO),
    services: slice.services,
    professionals: slice.professionals,
    dateISO,
    weekday: weekdayOf(dateISO),
    serviceId,
    durationMin,
    professionalId,
    eligibleProIds,
    nowHM: dateISO === today ? nowHM(now, btz) : '',
    leadMin: cfg.leadMin || 0,
    bufferMin: cfg.bufferMin || 0,
  };
}

export interface SlotsOutcome {
  ok: true; result: SlotResult; today: string; maxDate: string;
}
export interface SlotsRejection {
  ok: false; reason: 'not_found' | 'module_off' | 'invalid_date' | 'bad_professional';
  slots?: string[]; today?: string;
}

/**
 * Slots de UM dia — mesma semântica do GET /api/bookings público
 * (mesmo motor, dados vindos do SQL).
 */
export async function slotsForDate(
  client: PoolClient | import('pg').Pool,
  input: {
    businessId: string; serviceId: string; date: string;
    professionalId?: string; isAdmin?: boolean; now?: Date;
  },
): Promise<SlotsOutcome | SlotsRejection> {
  const now = input.now || new Date();
  const btz = await client.query(
    'SELECT booking, business_timezone FROM app.businesses WHERE id = $1',
    [input.businessId],
  );
  if (btz.rows.length === 0) return { ok: false, reason: 'not_found' };
  const core = rowToBusinessCore(btz.rows[0]);
  const svc = await client.query(
    `SELECT id, business_id, name, duration_min, professional_ids, active, bookable
       FROM app.services WHERE id = $1 AND business_id = $2`,
    [input.serviceId, input.businessId],
  );
  if (svc.rows.length === 0) return { ok: false, reason: 'not_found', slots: [] };
  const service = rowToService(svc.rows[0]);
  const today = todayISO(now, effectiveTimezone(core.businessTimezone));
  const maxDate = bookingMaxDate(today, core.booking, !!input.isAdmin);
  if (!isValidDateISO(input.date) || input.date < today || input.date > maxDate) {
    return { ok: false, reason: 'invalid_date', slots: [], today };
  }
  const proId = input.professionalId || '';
  if (proId) {
    // O profissional precisa existir na unidade, estar ativo E ser elegível
    // para o serviço (vínculo serviço↔profissional) — recusa no servidor.
    const check = await client.query(
      `SELECT 1 FROM app.professionals p
        WHERE p.id = $1 AND p.business_id = $2 AND p.active IS NOT FALSE
          AND ( ($3::jsonb = '[]'::jsonb) OR (p.id::text = ANY (SELECT jsonb_array_elements_text($3::jsonb))) )`,
      [proId, input.businessId, JSON.stringify(Array.isArray(svc.rows[0].professional_ids) ? svc.rows[0].professional_ids : [])],
    );
    if (check.rows.length === 0) return { ok: false, reason: 'bad_professional' };
  }
  const slice = await loadAgendaSlice(client, input.businessId, { from: input.date, to: input.date });
  if (!slice) return { ok: false, reason: 'not_found', slots: [], today };
  const result = computeSlots(baseQuery(
    slice, service.id, service.durationMin, proId, service.professionalIds || [],
    core.booking, input.date, now,
  ));
  return { ok: true, result, today, maxDate };
}

/** Mapa de dias (from→to): estado real por dia, igual ao GET público. */
export async function dayMap(
  client: PoolClient | import('pg').Pool,
  input: {
    businessId: string; serviceId: string; from: string; to: string;
    professionalId?: string; isAdmin?: boolean; now?: Date;
  },
): Promise<{ ok: true; days: Record<string, DayAvailability>; today: string } | { ok: false; reason: 'not_found' | 'invalid_window' }> {
  const now = input.now || new Date();
  if (!isValidDateISO(input.from) || !isValidDateISO(input.to)) return { ok: false, reason: 'invalid_window' };
  const biz = await client.query(
    'SELECT booking, business_timezone FROM app.businesses WHERE id = $1',
    [input.businessId],
  );
  if (biz.rows.length === 0) return { ok: false, reason: 'not_found' };
  const core = rowToBusinessCore(biz.rows[0]);
  const svc = await client.query(
    `SELECT id, duration_min, professional_ids FROM app.services WHERE id = $1 AND business_id = $2`,
    [input.serviceId, input.businessId],
  );
  if (svc.rows.length === 0) return { ok: false, reason: 'not_found' };
  const service = rowToService({ id: svc.rows[0].id, duration_min: svc.rows[0].duration_min, professional_ids: svc.rows[0].professional_ids });
  const today = todayISO(now, effectiveTimezone(core.businessTimezone));
  const maxDate = bookingMaxDate(today, core.booking, !!input.isAdmin);
  const slice = await loadAgendaSlice(client, input.businessId, { from: input.from, to: input.to });
  if (!slice) return { ok: false, reason: 'not_found' };
  const days: Record<string, DayAvailability> = {};
  for (let iso = input.from < today ? today : input.from; iso <= input.to && iso <= maxDate; iso = addDay(iso)) {
    days[iso] = dayAvailability(
      baseQuery(slice, service.id, service.durationMin, input.professionalId || '', service.professionalIds || [], core.booking, iso, now),
      { today },
    );
  }
  return { ok: true, days, today };
}

function addDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export interface ManageListParams {
  businessId: string;
  from?: string;
  to?: string;
  professionalScope?: string; // escopo do profissional (P2) — filtro NO DADO
  page?: number;
  limit?: number;
  now?: Date;
}

export interface ManageListResult {
  bookings: Booking[];
  total: number;
  page: number;
  limit: number;
  limitCapped?: boolean;
  requestedLimit?: number | null;
  today: string;
  needsClosure: string[];
}

/**
 * Lista de gestão da agenda: filtro por unidade + PERÍODO no SQL (índice
 * business_date), escopo do profissional aplicado NA CONSULTA, paginação
 * real (OFFSET/LIMIT) e contagem separada. Nada de carregar tudo em memória.
 */
export async function listBookingsManage(
  client: PoolClient | import('pg').Pool,
  p: ManageListParams,
): Promise<ManageListResult | null> {
  const now = p.now || new Date();
  const biz = await client.query(
    'SELECT booking, business_timezone FROM app.businesses WHERE id = $1',
    [p.businessId],
  );
  if (biz.rows.length === 0) return null;
  const core = rowToBusinessCore(biz.rows[0]);
  const btz = effectiveTimezone(core.businessTimezone);
  const today = todayISO(now, btz);
  const nowStr = nowHM(now, btz);

  const conds = ['business_id = $1'];
  const args: unknown[] = [p.businessId];
  if (p.professionalScope) {
    args.push(p.professionalScope);
    conds.push(`professional_id = $${args.length}`);
  }
  if (isValidDateISO(p.from || '') && isValidDateISO(p.to || '')) {
    args.push(p.from, p.to);
    conds.push(`date BETWEEN $${args.length - 1} AND $${args.length}`);
  }
  const where = conds.join(' AND ');
  const { limit, capped, requested } = effectiveManageLimit(String(p.limit ?? ''));
  const page = Math.max(1, p.page || 1);

  const [count, rows] = await Promise.all([
    client.query(`SELECT count(*)::int AS n FROM app.bookings WHERE ${where}`, args),
    client.query(
      `SELECT id, business_id, customer_id, service_id, professional_id, date, time,
              customer_name, customer_phone, status, note, answers, created_at, updated_at,
              history, previous_id, reschedule_count, lead_id, series_id, series_index,
              series_count, series_request_id, series_fingerprint, booking_kind,
              checked_in_at, checked_in_by, checked_in_by_name
         FROM app.bookings
        WHERE ${where}
        ORDER BY date DESC, time DESC
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      args,
    ),
  ]);
  const slice = rows.rows.map(rowToBooking);
  // needsClosure: pendências operacionais do dia — duração vem do serviço
  // (uma consulta pequena, colunas mínimas, só dos serviços desta página).
  const serviceIds = [...new Set(slice.map((b) => b.serviceId))];
  const durations = new Map<string, number>();
  if (serviceIds.length > 0) {
    const svcs = await client.query(
      `SELECT id, duration_min FROM app.services WHERE business_id = $1 AND id = ANY($2::text[])`,
      [p.businessId, serviceIds],
    );
    for (const s of svcs.rows) durations.set(String(s.id), Number(s.duration_min || 30));
  }
  return {
    bookings: slice,
    total: count.rows[0].n,
    page,
    limit,
    ...(capped ? { limitCapped: true, requestedLimit: requested } : {}),
    today,
    needsClosure: slice
      .filter((b) => needsClosure(b, durations.get(b.serviceId) ?? 30, today, nowStr))
      .map((b) => b.id),
  };
}
