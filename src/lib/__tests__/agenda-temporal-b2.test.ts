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
describe('B2 — interação temporal no servidor', () => {
  const move = (id: string, time: string, professionalId?: string) =>
    bookingsPATCH(req('PATCH', { businessId: BIZ, id, date: '2026-09-25', time, professionalId }));
  const resize = (id: string, resizeEnd: string, extra = {}) =>
    bookingsPATCH(req('PATCH', { businessId: BIZ, id, resizeEnd, ...extra }));
  const service60 = () => catalogPOST(req('POST', { businessId: BIZ, action: 'service.save', id: 's1', name: 'Consulta', durationMin: 60, professionalMode: 'all', professionalIds: [] }, token, '', '/api/catalog'));

  it('move 5 min preserva 40 após serviço 60; segundo move preserva 40', async () => {
    const { bookingId } = await createOwnerBooking();
    expect((await service60()).status).toBe(200);
    expect((await move(bookingId, '11:15')).status).toBe(200);
    expect((await bookingById(bookingId)).endAt).toBe('2026-09-25T14:55:00.000Z');
    expect((await move(bookingId, '13:15')).status).toBe(200);
    expect((await bookingById(bookingId)).durationMin).toBe(40);
    expect((await bookingById(bookingId)).endAt).toBe('2026-09-25T16:55:00.000Z');
  });

  it('resize 40→55 altera somente Booking; move posterior mantém 55', async () => {
    const { bookingId } = await createOwnerBooking();
    await service60();
    await move(bookingId, '11:15');
    expect((await resize(bookingId, '12:10')).status).toBe(200);
    const b = await bookingById(bookingId);
    expect(b.endAt).toBe('2026-09-25T15:10:00.000Z');
    expect(b.durationMin).toBe(55);
    expect((await readDB()).services.find((s) => s.id === 's1')!.durationMin).toBe(60);
    expect((await move(bookingId, '13:15')).status).toBe(200);
    expect((await bookingById(bookingId)).durationMin).toBe(55);
  });

  it('409: não persiste move/resize sobre Booking ocupado', async () => {
    const { bookingId } = await createOwnerBooking();
    await createOwnerBooking({}, { date: '2026-09-25', time: '11:00' });
    const before = await bookingById(bookingId);
    expect((await move(bookingId, '11:15')).status).toBe(409);
    expect((await resize(bookingId, '11:15')).status).toBe(409);
    expect(await bookingById(bookingId)).toEqual(before);
  });

  it('terminal: resize proibido, reagendamento explícito recria com duração atual', async () => {
    const { bookingId } = await createOwnerBooking();
    await service60();
    await bookingsPATCH(req('PATCH', { businessId: BIZ, id: bookingId, status: 'cancelled' }));
    expect((await resize(bookingId, '10:55')).status).toBe(409);
    const r = await move(bookingId, '11:15');
    expect(r.status).toBe(200);
    expect((await bookingById(bookingId)).durationMin).toBe(40);
    expect((await bookingById((await r.json()).newId)).durationMin).toBe(60);
  });

  it('resize contraditório recusado; snap interno só autenticado', async () => {
    const { bookingId } = await createOwnerBooking();
    expect((await resize(bookingId, '10:55', { durationMin: 999 })).status).toBe(400);
    const admin = await bookingsGET(req('GET', {}, token, `?mode=slots-admin&businessId=${BIZ}&serviceId=s1&date=2026-09-25&internalSnap=5&gestureBookingId=${bookingId}`));
    expect(admin.status).toBe(200);
    expect((await admin.json()).slots).toContain('10:05');
    const publicSlots = await bookingsGET(req('GET', {}, '', `?businessId=${BIZ}&serviceId=s1&date=2026-09-25&internalSnap=5`));
    expect((await publicSlots.json()).slots).not.toContain('10:05');
  });

  it('profissional elegível: sucesso; não elegível: 400', async () => {
    const { bookingId } = await createOwnerBooking({ professionalId: 'orlando' });
    await updateDB((d) => { d.professionals.push({ id: 'ana', businessId: BIZ, name: 'Ana', role: '', photo: '', active: true, followBusinessHours: true } as any); });
    expect((await move(bookingId, '11:15', 'ana')).status).toBe(200);
    expect((await bookingById(bookingId)).professionalId).toBe('ana');
    expect((await move(bookingId, '12:15', 'outsider')).status).toBe(400);
  });
});

describe('B2 — gestos puros', () => {
  it('snap 15 min arredonda para o mais próximo, sem depender de slotMin', async () => {
    const { snapGestureMinute, dragSlotUrl } = await import('../agenda-drag');
    expect([13, 17, 18].map((m) => snapGestureMinute(11 * 60 + m))).toEqual([675, 675, 675]);
    expect(dragSlotUrl(BIZ, 's1', ['2026-09-25'], 'booking-1')).toContain('dates=2026-09-25');
    expect(dragSlotUrl(BIZ, 's1', ['2026-09-25'], 'booking-1')).toContain('internalSnap=15&gestureBookingId=booking-1');
  });

  it('seleção 10:00–10:40 congela 40 pela criação canônica da equipe; público não escolhe duração', async () => {
    const created = await createOwnerBooking({ staffDurationMin: 40 });
    expect((await bookingById(created.bookingId)).durationMin).toBe(40);
    const owner = await bookingsPOST(req('POST', { businessId: BIZ, asOwner: true, serviceId: 's1', date: '2026-09-25', time: '11:15', customerName: 'Novo', customerPhone: '11999999999', staffDurationMin: 55 }));
    expect(owner.status).toBe(200);
    const row = (await readDB()).bookings.find((b) => b.time === '11:15')!;
    expect(row.durationMin).toBe(55);
    expect((await readDB()).services.find((s) => s.id === 's1')!.durationMin).toBe(40);
    expect((await bookingsPOST(req('POST', { businessId: BIZ, asOwner: true, serviceId: 's1', date: '2026-09-25', time: '13:15', customerName: 'Novo', customerPhone: '11999999999', staffDurationMin: 13 }))).status).toBe(400);
  });
});

describe('B2 — papéis e concorrência na escrita', () => {
  it('Recepção edita sua agenda; profissional escopado não edita Booking de outro profissional', async () => {
    await updateDB((d) => {
      d.users.push(user('maria', 'Maria'), user('orlando-user', 'Orlando'));
      d.members.push({ id: 'm-maria', businessId: BIZ, userId: 'maria', role: 'SECRETARIA', permissions: {}, active: true, note: '', createdAt: NOW, updatedAt: NOW } as any);
      d.members.push({ id: 'm-orlando', businessId: BIZ, userId: 'orlando-user', role: 'PROFISSIONAL', permissions: { agenda: true }, active: true, note: '', createdAt: NOW, updatedAt: NOW } as any);
      d.professionals.find((x) => x.id === 'orlando')!.userId = 'orlando-user';
      d.professionals.push({ id: 'ana', businessId: BIZ, name: 'Ana', role: '', active: true, followBusinessHours: true } as any);
    });
    const maria = await createSession('maria');
    const orlando = await createSession('orlando-user');
    const own = await createOwnerBooking({ professionalId: 'orlando' });
    const other = await createOwnerBooking({ professionalId: 'ana' }, { date: '2026-09-25', time: '11:00' });
    expect((await bookingsPATCH(req('PATCH', { businessId: BIZ, id: own.bookingId, date: '2026-09-25', time: '12:15' }, maria))).status).toBe(200);
    expect((await bookingsPATCH(req('PATCH', { businessId: BIZ, id: own.bookingId, resizeEnd: '13:10' }, maria))).status).toBe(200);
    expect((await bookingsPATCH(req('PATCH', { businessId: BIZ, id: other.bookingId, date: '2026-09-25', time: '14:15' }, orlando))).status).toBe(403);
    expect((await bookingsPATCH(req('PATCH', { businessId: BIZ, id: other.bookingId, resizeEnd: '11:55' }, orlando))).status).toBe(403);
    expect((await bookingById(other.bookingId)).time).toBe('11:00');
  });

  it('duas sessões no mesmo destino: uma vence, a outra 409 sem sobrescrever', async () => {
    const first = await createOwnerBooking();
    const second = await createOwnerBooking({}, { date: '2026-09-25', time: '12:00' });
    const results = await Promise.all([
      bookingsPATCH(req('PATCH', { businessId: BIZ, id: first.bookingId, date: '2026-09-25', time: '11:15' })),
      bookingsPATCH(req('PATCH', { businessId: BIZ, id: second.bookingId, date: '2026-09-25', time: '11:15' })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const rows = (await readDB()).bookings.filter((b) => b.time === '11:15');
    expect(rows).toHaveLength(1);
  });
});

describe('B2 — cartões proporcionais e duração longa', () => {
  it('20/40/60/90/180 usam altura proporcional; snapshot individual persiste', async () => {
    const { blockHeight } = await import('../agenda-drag');
    const durations = [20, 40, 60, 90, 180];
    for (let i = 0; i < durations.length; i++) {
      const { bookingId } = await createOwnerBooking({ staffDurationMin: durations[i] }, { date: `2026-09-${25 + i}`, time: '10:00' });
      expect((await bookingById(bookingId)).durationMin).toBe(durations[i]);
    }
    expect(durations.map((d) => blockHeight(d, 128))).toEqual(durations.map((d) => Math.max(22, d / 60 * 128)));
  });
});
