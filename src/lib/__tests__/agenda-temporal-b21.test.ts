// ═══════════════════════════════════════════════════════════════
// AGENDA TEMPORAL 2.0 — B1 · FUNDAÇÃO TEMPORAL (suíte focada)
// ═══════════════════════════════════════════════════════════════
// Cobre: contrato canônico na criação, regressão 40→60 do serviço,
// legado/inferência determinística, IANA (São Paulo/New York, DST gap/fold),
// ocupação de slots, buffer separado, séries, reagendamento, normalização e
// compatibilidade de API (date/time continua funcionando).
import './helpers/temp-db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { emptyDB, normalizeDB, readDB, updateDB, writeDB } from '../db';
import { createSession } from '../auth';
import { createCustomerSession } from '../customer-auth';
import { createApiKey } from '../api-keys';
import { createBookingTx } from '../booking-create';
import { createSeriesTx } from '../booking-series';
import { computeSlots } from '../slots';
import { bookingDurationOf } from '../booking-ops';
import {
  applyBookingWindow, bookingLocalProjection, buildBookingWindow, freezeLegacyBookingWindow,
  hasCanonicalWindow, instantToLocalProjection, localDateTimeToInstant, resolveBookingWindow,
  temporalErrorCode,
} from '../booking-temporal';
import { biz, service, user } from './helpers/automation-fixtures';
import { GET as bookingsGET, PATCH as bookingsPATCH, POST as bookingsPOST } from '@/app/api/bookings/route';
import { GET as customerBookingsGET } from '@/app/api/customer/bookings/route';
import { POST as externalBookingsPOST } from '@/app/api/external/bookings/route';
import { POST as catalogPOST } from '@/app/api/catalog/route';
import type { Booking, DB } from '../types';

const NOW = '2026-09-18T12:00:00Z';
const BIZ = 'b1';
const SP = 'America/Sao_Paulo';
const NY = 'America/New_York';

let token = '';
let consumerToken = '';

function req(method: string, body: any = {}, auth = token, query = '', url = '/api/bookings') {
  return new NextRequest(`http://localhost${url}${query}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': randomUUID(),
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
}

function legacyBooking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'legacy-1', businessId: BIZ, customerId: '', serviceId: 's1', professionalId: 'orlando',
    date: '2026-09-25', time: '10:00', customerName: 'Legado', customerPhone: '11999990000',
    status: 'confirmed', note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [],
    ...over,
  } as Booking;
}

async function createOwnerBooking(over: Record<string, unknown> = {}, dt = { date: '2026-09-25', time: '10:00' }) {
  return updateDB((d) => createBookingTx(d, {
    business: d.businesses.find((b) => b.id === BIZ)!,
    service: d.services.find((s) => s.id === 's1')!,
    date: dt.date,
    time: dt.time,
    actor: 'owner',
    customer: { id: '', name: 'Maria', phone: '11987654321' },
    ...over,
  }));
}

const bookingById = async (id: string) => (await readDB()).bookings.find((b) => b.id === id)!;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  const d = emptyDB();
  d.customers.push({ id: 'consumer', name: 'Cliente', phone: '11999998888', email: 'consumer@example.test', passwordHash: 'x', googleId: '', avatar: '', createdAt: NOW } as any);
  d.businesses.push(
    biz(BIZ, { businessTimezone: SP, timezone: SP }),
    biz('b2', { businessTimezone: NY, timezone: NY }),
  );
  d.users.push(user('owner-b1', 'Dono'), user('owner-b2', 'Dono B2'));
  d.professionals.push({
    id: 'orlando', businessId: BIZ, name: 'Orlando', role: '', photo: '', active: true, followBusinessHours: true,
  } as any);
  d.services.push(
    service('s1', BIZ, { name: 'Consulta', durationMin: 40, professionalMode: 'all', professionalIds: [] }),
    service('s2', 'b2', { name: 'Consulta NY', durationMin: 40, professionalMode: 'all', professionalIds: [] }),
  );
  for (let weekday = 0; weekday < 7; weekday++) {
    d.availability.push({ id: `a${weekday}`, businessId: BIZ, professionalId: '', serviceId: '', weekday, start: '00:00', end: '23:59', slotMin: 30 } as any);
    d.availability.push({ id: `b${weekday}`, businessId: 'b2', professionalId: '', serviceId: '', weekday, start: '00:00', end: '23:59', slotMin: 30 } as any);
  }
  await writeDB(d);
  token = await createSession('owner-b1');
  consumerToken = await createCustomerSession('consumer');
});

afterEach(() => vi.useRealTimers());

// ═══════════════════════════════════════════════════════════════
// NÚCLEO IANA (puro, sem banco)
// ═══════════════════════════════════════════════════════════════
describe('B2.1 — batch de disponibilidade staff', () => {
  const url = (id: string, suffix: string) => `?mode=slots-admin&businessId=${BIZ}&serviceId=s1&internalSnap=5&gestureBookingId=${id}&${suffix}`;
  const dates = ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];
  const get = (query: string, auth = token) => bookingsGET(req('GET', {}, auth, query));

  it('Dia: um GET lógico, mesma duração congelada e mesmos slots/byPro do motor single-day', async () => {
    const { bookingId } = await createOwnerBooking();
    await updateDB((d) => { d.services.find((s) => s.id === 's1')!.durationMin = 60; });
    const batch = await get(url(bookingId, 'dates=2026-09-25'));
    expect(batch.status).toBe(200);
    const one = (await batch.json()).days[dates[0]];
    const legacy = await get(url(bookingId, 'date=2026-09-25'));
    const same = await legacy.json();
    expect(one.slots).toEqual(same.slots);
    expect(one.byPro).toEqual(same.byPro);
    // The booking's own time is free in the gesture, and the 40-min window
    // fits where a new 60-min appointment would not fit (17:15–17:55).
    expect(one.slots).toContain('10:00');
    expect(one.slots).toContain('22:15');
  });

  it('Semana: 1 GET retorna 7 datas idênticas às consultas individuais e sem o próprio booking', async () => {
    const { bookingId } = await createOwnerBooking();
    const res = await get(url(bookingId, `dates=${dates.join(',')}`));
    expect(res.status).toBe(200);
    const batch = (await res.json()).days;
    expect(Object.keys(batch)).toEqual(dates);
    for (const day of dates) {
      const single = await get(url(bookingId, `date=${day}`));
      const result = await single.json();
      expect(batch[day].slots).toEqual(result.slots);
      expect(batch[day].byPro).toEqual(result.byPro);
      expect(batch[day].eligibleProfessionalIds).toEqual(result.eligibleProfessionalIds);
    }
  });

  it('limite 8+, data inválida, repetida e misturar date/dates recusados antes do cálculo', async () => {
    const { bookingId } = await createOwnerBooking();
    const eight = [...dates, '2026-10-02'];
    for (const param of [`dates=${eight.join(',')}`, 'dates=2026-09-25,not-a-date', 'dates=2026-09-25,2026-09-25', 'dates=2026-09-25&date=2026-09-25']) {
      expect((await get(url(bookingId, param))).status).toBe(400);
    }
  });

  it('tenant, serviço, professionalScope e público sem internalSnap são isolados', async () => {
    const { bookingId } = await createOwnerBooking();
    await updateDB((d) => {
      d.bookings.push({ ...d.bookings.find((b) => b.id === bookingId)!, id: 'other-tenant', businessId: 'b2', serviceId: 's2' });
      d.users.push(user('orlando-user', 'Orlando'));
      d.members.push({ id: 'scope', businessId: BIZ, userId: 'orlando-user', role: 'PROFISSIONAL', permissions: { agenda: true }, active: true, createdAt: NOW, updatedAt: NOW } as any);
      d.professionals.find((p) => p.id === 'orlando')!.userId = 'orlando-user';
      d.professionals.push({ id: 'ana', businessId: BIZ, name: 'Ana', role: '', active: true, followBusinessHours: true } as any);
    });
    expect((await get(url('other-tenant', 'dates=2026-09-25'))).status).toBe(404);
    expect((await get(`?mode=slots-admin&businessId=${BIZ}&serviceId=s2&internalSnap=5&gestureBookingId=${bookingId}&dates=2026-09-25`)).status).toBe(404);
    const proToken = await createSession('orlando-user');
    expect((await get(url(bookingId, 'dates=2026-09-25&professionalId=ana'), proToken)).status).toBe(403);
    const publicSingle = await get(`?businessId=${BIZ}&serviceId=s1&date=2026-09-25&internalSnap=5`, '');
    expect((await publicSingle.json()).slots).not.toContain('10:05');
    expect((await get(`?businessId=${BIZ}&serviceId=s1&gestureBookingId=${bookingId}&dates=2026-09-25`, '')).status).toBe(404);
  });
});

describe('B2.1 — PATCH mutation echo e estado local', () => {
  it('move/resize retornam somente Booking autorizado; conflito não devolve patch', async () => {
    const { bookingId } = await createOwnerBooking();
    const move = await bookingsPATCH(req('PATCH', { businessId: BIZ, id: bookingId, date: '2026-09-25', time: '11:15' }));
    expect(move.status).toBe(200);
    const moved = await move.json();
    expect(moved.booking).toMatchObject({ id: bookingId, time: '11:15', durationMin: 40, endAt: '2026-09-25T14:55:00.000Z' });
    expect(moved.booking.businessId).toBeUndefined();
    expect(moved.queueChanged).toBe(false);
    const resize = await bookingsPATCH(req('PATCH', { businessId: BIZ, id: bookingId, resizeEnd: '12:10' }));
    expect(resize.status).toBe(200);
    expect((await resize.json()).booking).toMatchObject({ id: bookingId, durationMin: 55, endAt: '2026-09-25T15:10:00.000Z' });
    await createOwnerBooking({}, { date: '2026-09-25', time: '13:00' });
    const clash = await bookingsPATCH(req('PATCH', { businessId: BIZ, id: bookingId, date: '2026-09-25', time: '13:05' }));
    expect(clash.status).toBe(409);
    expect((await bookingById(bookingId)).time).toBe('11:15');
  });

  it('state patch updates only the confirmed row, preserves tenant and removes out-of-range move', async () => {
    const { applyBookingTemporalPatch } = await import('../agenda-local-update');
    const created = await createOwnerBooking();
    const own = await bookingById(created.bookingId);
    const other = { ...own, id: 'other', businessId: 'b2' };
    const rows = [own, other];
    const range = { from: '2026-09-20', to: '2026-09-30' };
    const patched = applyBookingTemporalPatch(rows, { id: own.id, time: '11:15', date: '2026-09-25', durationMin: 55 }, range);
    expect(patched[0]).toMatchObject({ id: own.id, businessId: BIZ, time: '11:15', durationMin: 55 });
    expect(patched[1]).toEqual(other);
    expect(applyBookingTemporalPatch(rows, { id: own.id, date: '2026-10-10' }, range)).toEqual([other]);
    expect(applyBookingTemporalPatch(rows, { id: own.id, businessId: 'b2', time: '15:00' }, range)).toEqual(rows);
  });
});

describe('B2.1 — fila somente quando houve mudança', () => {
  it('move que remove check-in/fila retorna queueChanged; resize não altera fila', async () => {
    const { bookingId } = await createOwnerBooking();
    await updateDB((d) => {
      const b = d.bookings.find((x) => x.id === bookingId)!;
      b.checkedInAt = NOW;
      d.queue.push({ id: 'q-b21', businessId: BIZ, customerName: b.customerName, customerPhone: b.customerPhone,
        contactId: '', serviceId: b.serviceId, professionalId: b.professionalId, bookingId,
        note: '', status: 'waiting', date: b.date, createdAt: NOW, calledAt: '', startedAt: '', endedAt: '',
        updatedBy: '', updatedAt: NOW });
    });
    const resized = await bookingsPATCH(req('PATCH', { businessId: BIZ, id: bookingId, resizeEnd: '10:55' }));
    expect(resized.status).toBe(200);
    expect((await resized.json()).queueChanged).toBe(false);
    expect((await readDB()).queue.find((q) => q.id === 'q-b21')?.status).toBe('waiting');
    const moved = await bookingsPATCH(req('PATCH', { businessId: BIZ, id: bookingId, date: '2026-09-25', time: '11:15' }));
    expect(moved.status).toBe(200);
    const echo = await moved.json();
    expect(echo.queueChanged).toBe(true);
    expect(echo.booking.checkedInAt).toBeUndefined();
    expect((await readDB()).queue.find((q) => q.id === 'q-b21')?.status).toBe('left');
  });
});
