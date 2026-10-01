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
describe('B1 — núcleo IANA (Intl, sem dependência de calendário)', () => {
  it('converte intenção local → instante e de volta em São Paulo', () => {
    const startAt = localDateTimeToInstant('2026-10-01', '10:00', SP);
    expect(startAt).toBe('2026-10-01T13:00:00.000Z');
    expect(instantToLocalProjection(startAt, SP)).toEqual({ date: '2026-10-01', time: '10:00' });
  });

  it('New York: horário normal (EST) e horário de verão (EDT) coexistem', () => {
    expect(localDateTimeToInstant('2026-01-15', '10:00', NY)).toBe('2026-01-15T15:00:00.000Z');
    expect(localDateTimeToInstant('2026-07-15', '10:00', NY)).toBe('2026-07-15T14:00:00.000Z');
    expect(instantToLocalProjection('2026-07-15T14:00:00.000Z', NY)).toEqual({ date: '2026-07-15', time: '10:00' });
  });

  it('DST gap: horário inexistente é RECUSADO (nunca reinterpretado em silêncio)', () => {
    let code = '';
    try { localDateTimeToInstant('2026-03-08', '02:30', NY); } catch (e) { code = temporalErrorCode(e); }
    expect(code).toBe('nonexistent_local_time');
  });

  it('DST fold: horário ambíguo é RECUSADO', () => {
    let code = '';
    try { localDateTimeToInstant('2026-11-01', '01:30', NY); } catch (e) { code = temporalErrorCode(e); }
    expect(code).toBe('ambiguous_local_time');
  });

  it('fuso inválido/ausente nunca cai para o fuso do servidor', () => {
    expect(temporalErrorCode((() => { try { localDateTimeToInstant('2026-10-01', '10:00', ''); } catch (e) { return e; } })())).toBe('invalid_timezone');
    expect(temporalErrorCode((() => { try { localDateTimeToInstant('2026-10-01', '10:00', 'Marte/Olympus'); } catch (e) { return e; } })())).toBe('invalid_timezone');
  });

  it('não depende do fuso da máquina (process.env.TZ)', () => {
    const previous = process.env.TZ;
    try {
      const before = localDateTimeToInstant('2026-10-01', '10:00', SP);
      const legacyBefore = resolveBookingWindow({ date: '2026-10-01', time: '10:00' }, { timeZone: SP, serviceDurationMin: 40 });
      process.env.TZ = 'Pacific/Kiritimati';
      const after = localDateTimeToInstant('2026-10-01', '10:00', SP);
      const legacyAfter = resolveBookingWindow({ date: '2026-10-01', time: '10:00' }, { timeZone: SP, serviceDurationMin: 40 });
      expect(after).toBe(before);
      expect(legacyAfter.startAt).toBe(legacyBefore.startAt);
      expect(after).toBe('2026-10-01T13:00:00.000Z');
    } finally {
      if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
  });

  it('buildBookingWindow congela duração e fim = início + duração', () => {
    const w = buildBookingWindow({ date: '2026-10-01', time: '10:00', durationMin: 40, timeZone: SP });
    expect(w.startAt).toBe('2026-10-01T13:00:00.000Z');
    expect(w.endAt).toBe('2026-10-01T13:40:00.000Z');
    expect(w.durationMin).toBe(40);
    expect(w.timeZone).toBe(SP);
    expect(w.source).toBe('native');
  });

  it('resolveBookingWindow: snapshot/window vence a duração atual do serviço', () => {
    const w = buildBookingWindow({ date: '2026-10-01', time: '10:00', durationMin: 40, timeZone: SP });
    const resolved = resolveBookingWindow({ ...w }, { timeZone: SP, serviceDurationMin: 999 });
    expect(resolved.durationMin).toBe(40);
    expect(resolved.source).toBe('native');
    expect(resolved.inferred).toBe(false);
    expect(resolved.local).toEqual({ date: '2026-10-01', time: '10:00' });
  });

  it('resolveBookingWindow: legado usa date/time + fuso + duração disponível e marca a origem', () => {
    const resolved = resolveBookingWindow({ date: '2026-10-01', time: '10:00' }, { timeZone: SP, serviceDurationMin: 40 });
    expect(resolved).toMatchObject({
      startAt: '2026-10-01T13:00:00.000Z',
      endAt: '2026-10-01T13:40:00.000Z',
      durationMin: 40,
      timeZone: SP,
      source: 'legacy_inferred',
      inferred: true,
      unresolvable: false,
    });
    expect(bookingLocalProjection({ date: '2026-10-01', time: '10:00' }, { timeZone: SP })).toEqual({ date: '2026-10-01', time: '10:00' });
  });

  it('congelar legado é idempotente e nunca toca janela canônica', () => {
    const legacy: any = { date: '2026-10-01', time: '10:00', serviceId: 's1' };
    expect(freezeLegacyBookingWindow(legacy, { timeZone: SP, serviceDurationMin: 40 })).toBe(true);
    expect(legacy).toMatchObject({ durationMin: 40, timeZone: SP, temporalSource: 'legacy_inferred' });
    expect(freezeLegacyBookingWindow(legacy, { timeZone: SP, serviceDurationMin: 90 })).toBe(false);
    expect(legacy.durationMin).toBe(40);

    const canonical = buildBookingWindow({ date: '2026-10-01', time: '10:00', durationMin: 40, timeZone: SP });
    const booking: any = { ...canonical };
    expect(freezeLegacyBookingWindow(booking, { timeZone: SP, serviceDurationMin: 90 })).toBe(false);
    expect(booking.durationMin).toBe(40);
    expect(hasCanonicalWindow(booking)).toBe(true);
  });

  it('applyBookingWindow escreve instantes, snapshot, fuso e projeção date/time atomicamente', () => {
    const booking: any = { date: '2026-09-25', time: '10:00' };
    const w = buildBookingWindow({ date: '2026-09-26', time: '09:30', durationMin: 25, timeZone: SP });
    applyBookingWindow(booking, w, SP);
    expect(booking).toMatchObject({
      startAt: '2026-09-26T12:30:00.000Z', endAt: '2026-09-26T12:55:00.000Z',
      durationMin: 25, timeZone: SP, temporalSource: 'native', date: '2026-09-26', time: '09:30',
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// NOVO BOOKING — contrato canônico na criação
// ═══════════════════════════════════════════════════════════════
describe('B1 — criação congela a janela canônica', () => {
  it('agendamento novo nasce com startAt, endAt, durationMin, timeZone e date/time compatíveis', async () => {
    const created = await createOwnerBooking();
    const booking = await bookingById(created.bookingId);
    expect(booking.startAt).toBe('2026-09-25T13:00:00.000Z');
    expect(booking.endAt).toBe('2026-09-25T13:40:00.000Z');
    expect(booking.durationMin).toBe(40);
    expect(booking.timeZone).toBe(SP);
    expect(booking.temporalSource).toBe('native');
    // Compatibilidade: projeção civil idêntica à intenção original.
    expect(booking.date).toBe('2026-09-25');
    expect(booking.time).toBe('10:00');
  });

  it('o navegador não escolhe a duração: o servidor resolve o default do serviço', async () => {
    const created = await updateDB((d) => createBookingTx(d, {
      business: d.businesses.find((b) => b.id === BIZ)!,
      service: d.services.find((s) => s.id === 's1')!,
      date: '2026-09-25', time: '10:00', actor: 'owner',
      customer: { id: '', name: 'Maria', phone: '11987654321' },
      ...( { durationMin: 999 } as any ),
    }));
    const booking = await bookingById(created.bookingId);
    expect(booking.durationMin).toBe(40);
    expect(booking.endAt).toBe('2026-09-25T13:40:00.000Z');
  });

  it('intenção local inexistente (DST gap) é recusada na criação — nada é gravado', async () => {
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    await expect(updateDB((d) => createBookingTx(d, {
      business: d.businesses.find((b) => b.id === 'b2')!,
      service: d.services.find((s) => s.id === 's2')!,
      date: '2026-03-08', time: '02:30', actor: 'owner',
      customer: { id: '', name: 'Maria', phone: '11987654321' },
    }))).rejects.toThrow(/não existe no fuso/);
    expect((await readDB()).bookings).toHaveLength(0);
  });

  it('intenção local ambígua (DST fold) é recusada na criação', async () => {
    vi.setSystemTime(new Date('2026-01-05T12:00:00Z'));
    await expect(updateDB((d) => createBookingTx(d, {
      business: d.businesses.find((b) => b.id === 'b2')!,
      service: d.services.find((s) => s.id === 's2')!,
      date: '2026-11-01', time: '01:30', actor: 'owner',
      customer: { id: '', name: 'Maria', phone: '11987654321' },
    }))).rejects.toThrow(/duas vezes no fuso/);
    expect((await readDB()).bookings).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// REGRESSÃO OBRIGATÓRIA: serviço 40 → booking 40 → serviço 60
// ═══════════════════════════════════════════════════════════════
describe('B1 — REGRESSÃO: editar o serviço NÃO muda o agendamento existente', () => {
  it('booking antigo continua 40 min e o novo nasce 60 (agenda/slots)', async () => {
    const created = await createOwnerBooking();
    const id = created.bookingId;

    // Serviço editado para 60 (rota REAL do catálogo).
    const res = await catalogPOST(req('POST', {
      businessId: BIZ, action: 'service.save', id: 's1', name: 'Consulta',
      durationMin: 60, professionalMode: 'all', professionalIds: [],
    }, token, '', '/api/catalog'));
    expect(res.status).toBe(200);
    expect((await readDB()).services.find((s) => s.id === 's1')!.durationMin).toBe(60);

    // O agendamento antigo NÃO se move.
    const old = await bookingById(id);
    expect(old.durationMin).toBe(40);
    expect(old.startAt).toBe('2026-09-25T13:00:00.000Z');
    expect(old.endAt).toBe('2026-09-25T13:40:00.000Z');
    expect(bookingDurationOf(old, { durationMin: 60 } as any)).toBe(40);

    // Ocupação histórica: 11:00 (depois dos 40 min) está LIVRE; 10:30 (dentro
    // dos 40 min) continua ocupado. Se a ocupação tivesse virado 60, 11:00
    // estaria bloqueado.
    const slots = await (await bookingsGET(req('GET', {}, token, `?businessId=${BIZ}&serviceId=s1&date=2026-09-25&mode=slots-admin`))).json();
    expect(slots.slots).toContain('11:00');
    expect(slots.slots).not.toContain('10:30');
    expect(slots.slots).not.toContain('10:00');

    // Novo agendamento depois da edição nasce com 60.
    const newer = await createOwnerBooking({}, { date: '2026-09-25', time: '11:00' });
    const fresh = await bookingById(newer.bookingId);
    expect(fresh.durationMin).toBe(60);
    expect(fresh.startAt).toBe('2026-09-25T14:00:00.000Z'); // 11:00 em São Paulo
    expect(fresh.endAt).toBe('2026-09-25T15:00:00.000Z');
  });

  it('o snapshot sobrevive a uma segunda edição do serviço', async () => {
    const created = await createOwnerBooking();
    for (const durationMin of [60, 75, 20]) {
      await catalogPOST(req('POST', {
        businessId: BIZ, action: 'service.save', id: 's1', name: 'Consulta',
        durationMin, professionalMode: 'all', professionalIds: [],
      }, token, '', '/api/catalog'));
    }
    const old = await bookingById(created.bookingId);
    expect(old.durationMin).toBe(40);
    expect(old.endAt).toBe('2026-09-25T13:40:00.000Z');
  });

  it('permissão de catálogo continua exigida (nada de efeito colateral em rota negada)', async () => {
    const created = await createOwnerBooking();
    const denied = await catalogPOST(req('POST', { businessId: BIZ, action: 'service.save', id: 's1', name: 'x', durationMin: 90 }, '', '/api/catalog'));
    expect(denied.status).toBe(401);
    expect((await bookingById(created.bookingId)).durationMin).toBe(40);
  });
});

// ═══════════════════════════════════════════════════════════════
// LEGADO
// ═══════════════════════════════════════════════════════════════
describe('B1 — legado (só date/time) continua legível e é congelado na escrita', () => {
  it('legado ocupa a grade pela inferência (date/time + fuso + duração do serviço)', async () => {
    await updateDB((d) => { d.bookings.push(legacyBooking()); });
    const w = resolveBookingWindow((await readDB()).bookings[0], { timeZone: SP, serviceDurationMin: 40 });
    expect(w.source).toBe('legacy_inferred');
    expect(w.startAt).toBe('2026-09-25T13:00:00.000Z');
    expect(w.durationMin).toBe(40);

    // 10:30 bloqueado pelos 40 min do legado; 11:00 livre.
    const slots = await (await bookingsGET(req('GET', {}, token, `?businessId=${BIZ}&serviceId=s1&date=2026-09-25&mode=slots-admin`))).json();
    expect(slots.slots).not.toContain('10:30');
    expect(slots.slots).toContain('11:00');
  });

  it('editar o serviço CONGELA o legado com a duração vigente (marcado legacy_inferred)', async () => {
    await updateDB((d) => { d.bookings.push(legacyBooking()); });
    await catalogPOST(req('POST', {
      businessId: BIZ, action: 'service.save', id: 's1', name: 'Consulta',
      durationMin: 60, professionalMode: 'all', professionalIds: [],
    }, token, '', '/api/catalog'));

    const frozen = (await readDB()).bookings[0];
    expect(frozen.durationMin).toBe(40);
    expect(frozen.temporalSource).toBe('legacy_inferred');
    expect(frozen.startAt).toBe('2026-09-25T13:00:00.000Z');
    expect(frozen.endAt).toBe('2026-09-25T13:40:00.000Z');

    // Segunda edição do serviço não move o histórico congelado.
    await catalogPOST(req('POST', {
      businessId: BIZ, action: 'service.save', id: 's1', name: 'Consulta',
      durationMin: 90, professionalMode: 'all', professionalIds: [],
    }, token, '', '/api/catalog'));
    expect((await readDB()).bookings[0].durationMin).toBe(40);
  });

  it('transição de status também congela o legado (sem backfill destrutivo)', async () => {
    await updateDB((d) => { d.bookings.push(legacyBooking({ status: 'pending' })); });
    await bookingsPATCH(req('PATCH', { businessId: BIZ, id: 'legacy-1', status: 'confirmed' }));
    const after = (await readDB()).bookings[0];
    expect(after.status).toBe('confirmed');
    expect(after.durationMin).toBe(40);
    expect(after.temporalSource).toBe('legacy_inferred');
  });

  it('normalizar duas vezes produz o mesmo resultado e NÃO inventa janela', async () => {
    const legacy = legacyBooking();
    const raw = () => JSON.parse(JSON.stringify({ ...emptyDB(), bookings: [legacy] }));
    const first = normalizeDB(raw());
    const second = normalizeDB(raw());
    expect(JSON.stringify(first.bookings)).toBe(JSON.stringify(second.bookings));
    expect(first.bookings[0].startAt).toBeUndefined();
    expect(first.bookings[0].date).toBe('2026-09-25');
    expect(first.bookings[0].durationMin).toBeUndefined();

    // Normalizar a própria saída é estável (idempotente).
    const again = normalizeDB(JSON.parse(JSON.stringify(first)));
    expect(JSON.stringify(again.bookings)).toBe(JSON.stringify(first.bookings));
  });

  it('normalização descarta janela inválida e mantém o snapshot coerente com os instantes', async () => {
    const half = normalizeDB(JSON.parse(JSON.stringify({
      ...emptyDB(),
      bookings: [legacyBooking({ id: 'half', startAt: '2026-09-25T13:00:00.000Z' } as any)],
    })));
    expect(half.bookings[0].startAt).toBeUndefined();

    // startAt/endAt são autoridade: durationMin divergente é corrigido.
    const divergent = normalizeDB(JSON.parse(JSON.stringify({
      ...emptyDB(),
      bookings: [legacyBooking({
        id: 'div', startAt: '2026-09-25T13:00:00.000Z', endAt: '2026-09-25T13:40:00.000Z',
        durationMin: 90, timeZone: SP, temporalSource: 'native',
      } as any)],
    })));
    expect(divergent.bookings[0].durationMin).toBe(40);
  });
});

// ═══════════════════════════════════════════════════════════════
// SLOTS — ocupação pela janela real; buffer continua separado
// ═══════════════════════════════════════════════════════════════
describe('B1 — slots: ocupação pela janela do Booking', () => {
  const query = (bookings: Booking[], over: Record<string, unknown> = {}) => computeSlots({
    rules: [{ id: 'a5', businessId: BIZ, professionalId: '', serviceId: '', weekday: 5, start: '00:00', end: '23:59', slotMin: 30 } as any],
    exceptions: [],
    bookings,
    services: [{ id: 's1', businessId: BIZ, durationMin: 40 } as any],
    professionals: [{ id: 'orlando', businessId: BIZ, name: 'Orlando', active: true } as any],
    dateISO: '2026-09-25', weekday: 5, serviceId: 's1', durationMin: 40,
    professionalId: '', eligibleProIds: ['orlando'], nowHM: '', leadMin: 0, bufferMin: 0,
    timeZone: SP,
    ...over,
  });

  it('Booking canônico bloqueia exatamente a janela dele (40 min), não a duração do serviço', () => {
    const w = buildBookingWindow({ date: '2026-09-25', time: '10:00', durationMin: 40, timeZone: SP });
    const booking = legacyBooking({ id: 'canon', ...w } as any);
    const withBooking = query([booking]).slots;
    expect(withBooking).not.toContain('10:00');
    expect(withBooking).not.toContain('10:30');
    expect(withBooking).toContain('11:00');

    // Mesmo com o serviço agora em 60, a ocupação histórica continua 40.
    const withBigger = query([booking], { services: [{ id: 's1', businessId: BIZ, durationMin: 60 } as any] }).slots;
    expect(withBigger).toContain('11:00');
    expect(withBigger).not.toContain('10:30');
  });

  it('agendamento cancelado não bloqueia', () => {
    const w = buildBookingWindow({ date: '2026-09-25', time: '10:00', durationMin: 40, timeZone: SP });
    const booking = legacyBooking({ id: 'cancelled', status: 'cancelled', ...w } as any);
    expect(query([booking]).slots).toContain('10:00');
  });

  it('buffer ocupa a grade mas NÃO entra na duração do cartão', () => {
    const w = buildBookingWindow({ date: '2026-09-25', time: '10:00', durationMin: 40, timeZone: SP });
    const booking = legacyBooking({ id: 'buffered', ...w } as any);
    const slots = query([booking], { bufferMin: 10 }).slots;
    // 10:00–10:40 + 10 min de buffer = ocupa até 10:50 → 11:00 livre, 10:30 não.
    expect(slots).not.toContain('10:30');
    expect(slots).toContain('11:00');
    // O cartão continua representando o atendimento (40 min).
    expect(booking.durationMin).toBe(40);
    expect((Date.parse(booking.endAt!) - Date.parse(booking.startAt!)) / 60000).toBe(40);
  });

  it('legado sem snapshot usa o fallback explícito do serviço', () => {
    const booking = legacyBooking({ id: 'legacy-plain' });
    const withForty = query([booking]).slots;
    expect(withForty).not.toContain('10:30');
    const withTwenty = query([booking], { services: [{ id: 's1', businessId: BIZ, durationMin: 20 } as any] }).slots;
    expect(withTwenty).toContain('10:30');
  });
});

// ═══════════════════════════════════════════════════════════════
// SÉRIES
// ═══════════════════════════════════════════════════════════════
describe('B1 — séries: cada ocorrência congela a própria janela', () => {
  it('todas as ocorrências recebem janela própria, com idempotência preservada', async () => {
    const occurrences = [
      { date: '2026-09-25', time: '10:00', professionalId: 'orlando' },
      { date: '2026-10-02', time: '10:00', professionalId: 'orlando' },
      { date: '2026-10-09', time: '10:00', professionalId: 'orlando' },
    ];
    const requestId = randomUUID();
    const result = await updateDB((d) => createSeriesTx(d, {
      business: d.businesses.find((b) => b.id === BIZ)!,
      service: d.services.find((s) => s.id === 's1')!,
      date: occurrences[0].date, time: occurrences[0].time, actor: 'owner',
      customer: { id: '', name: 'Maria', phone: '11987654321' },
    }, occurrences, requestId));
    expect(result.count).toBe(3);

    const series = (await readDB()).bookings.filter((b) => b.seriesId === result.seriesId);
    expect(series).toHaveLength(3);
    for (const b of series) {
      expect(b.durationMin).toBe(40);
      expect(b.timeZone).toBe(SP);
      expect(b.temporalSource).toBe('native');
      expect((Date.parse(b.endAt!) - Date.parse(b.startAt!)) / 60000).toBe(40);
      expect(b.time).toBe('10:00');
    }
    expect(series.map((b) => b.startAt).sort()).toEqual([
      '2026-09-25T13:00:00.000Z', '2026-10-02T13:00:00.000Z', '2026-10-09T13:00:00.000Z',
    ]);

    // Idempotência: mesma chave + mesmo payload devolve a mesma série.
    const replay = await updateDB((d) => createSeriesTx(d, {
      business: d.businesses.find((b) => b.id === BIZ)!,
      service: d.services.find((s) => s.id === 's1')!,
      date: occurrences[0].date, time: occurrences[0].time, actor: 'owner',
      customer: { id: '', name: 'Maria', phone: '11987654321' },
    }, occurrences, requestId));
    expect(replay.replayed).toBe(true);
    expect(replay.bookingIds.sort()).toEqual(result.bookingIds.sort());

    // Editar o serviço não move a série criada.
    await catalogPOST(req('POST', {
      businessId: BIZ, action: 'service.save', id: 's1', name: 'Consulta',
      durationMin: 60, professionalMode: 'all', professionalIds: [],
    }, token, '', '/api/catalog'));
    expect((await readDB()).bookings.filter((b) => b.seriesId === result.seriesId).every((b) => b.durationMin === 40)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// REAGENDAMENTO
// ═══════════════════════════════════════════════════════════════
describe('B1 — reagendamento: janela nova sem sobrescrever o passado', () => {
  it('move o MESMO agendamento e reescreve a janela atomicamente', async () => {
    const created = await createOwnerBooking();
    const res = await bookingsPATCH(req('PATCH', { businessId: BIZ, id: created.bookingId, date: '2026-09-25', time: '11:00' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(false);
    const moved = await bookingById(created.bookingId);
    expect(moved.time).toBe('11:00');
    expect(moved.startAt).toBe('2026-09-25T14:00:00.000Z');
    expect(moved.endAt).toBe('2026-09-25T14:40:00.000Z');
    expect(moved.durationMin).toBe(40);
    expect(moved.date).toBe('2026-09-25');
  });

  const editConsultaTo60 = async () => {
    const res = await catalogPOST(req('POST', {
      businessId: BIZ, action: 'service.save', id: 's1', name: 'Consulta',
      durationMin: 60, professionalMode: 'all', professionalIds: [],
    }, token, '', '/api/catalog'));
    expect(res.status).toBe(200);
  };

  it('move canônico preserva 40 após Service 60; segundo move e slots seguem 40', async () => {
    const { bookingId } = await createOwnerBooking();
    await editConsultaTo60();
    for (const [time, startAt, endAt] of [
      ['11:00', '2026-09-25T14:00:00.000Z', '2026-09-25T14:40:00.000Z'],
      ['13:15', '2026-09-25T16:15:00.000Z', '2026-09-25T16:55:00.000Z'],
    ]) {
      // A segunda intenção usa cadência de 15 min; slotMin não é duração.
      if (time === '13:15') await updateDB((d) => {
        for (const rule of d.availability.filter((a) => a.businessId === BIZ)) rule.slotMin = 15;
      });
      const res = await bookingsPATCH(req('PATCH', { businessId: BIZ, id: bookingId, date: '2026-09-25', time }));
      expect(res.status).toBe(200);
      expect((await res.json()).created).toBe(false);
      const moved = await bookingById(bookingId);
      expect(moved.startAt).toBe(startAt);
      expect(moved.endAt).toBe(endAt);
      expect(moved.durationMin).toBe(40);
    }
    expect((await readDB()).bookings.filter((b) => b.id === bookingId)).toHaveLength(1);
    // Consulta atual = 60, mas uma intenção curta a partir de 13:55 cabe:
    // a ocupação histórica do Booking movido termina em 13:55, não 14:15.
    const db = await readDB();
    const slots = computeSlots({
      rules: [{ id: 'short', businessId: BIZ, professionalId: '', serviceId: '', weekday: 5,
        start: '13:15', end: '16:00', slotMin: 5 } as any],
      exceptions: [], bookings: db.bookings, services: db.services,
      professionals: db.professionals, dateISO: '2026-09-25', weekday: 5,
      serviceId: 's1', durationMin: 10, professionalId: 'orlando',
      eligibleProIds: ['orlando'], nowHM: '', leadMin: 0, bufferMin: 0, timeZone: SP,
    });
    expect(slots.slots).not.toContain('13:50');
    expect(slots.slots).toContain('13:55');
  });

  it('legado congelado em 40 antes de Service 60 move mantendo 40', async () => {
    await updateDB((d) => { d.bookings.push(legacyBooking()); });
    await editConsultaTo60();
    const before = await bookingById('legacy-1');
    expect(before.temporalSource).toBe('legacy_inferred');
    expect(before.durationMin).toBe(40);
    const res = await bookingsPATCH(req('PATCH', { businessId: BIZ, id: 'legacy-1', date: '2026-09-25', time: '11:00' }));
    expect(res.status).toBe(200);
    expect((await res.json()).created).toBe(false);
    const moved = await bookingById('legacy-1');
    expect(moved.startAt).toBe('2026-09-25T14:00:00.000Z');
    expect(moved.endAt).toBe('2026-09-25T14:40:00.000Z');
    expect(moved.durationMin).toBe(40);
  });

  it('terminal 40 após Service 60 recria 60 e preserva janela antiga', async () => {
    const { bookingId } = await createOwnerBooking();
    await editConsultaTo60();
    expect((await bookingsPATCH(req('PATCH', { businessId: BIZ, id: bookingId, status: 'cancelled' }))).status).toBe(200);
    const before = await bookingById(bookingId);
    const res = await bookingsPATCH(req('PATCH', { businessId: BIZ, id: bookingId, date: '2026-09-25', time: '11:00' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(true);
    const old = await bookingById(bookingId);
    expect(old.status).toBe('cancelled');
    expect(old.startAt).toBe(before.startAt);
    expect(old.endAt).toBe(before.endAt);
    expect(old.durationMin).toBe(40);
    const fresh = await bookingById(body.newId);
    expect(fresh.previousId).toBe(bookingId);
    expect(fresh.startAt).toBe('2026-09-25T14:00:00.000Z');
    expect(fresh.endAt).toBe('2026-09-25T15:00:00.000Z');
    expect(fresh.durationMin).toBe(60);
  });

  it('estado terminal reagendado cria NOVO Booking; o antigo mantém a janela histórica', async () => {
    const created = await createOwnerBooking();
    await bookingsPATCH(req('PATCH', { businessId: BIZ, id: created.bookingId, status: 'cancelled' }));
    const before = await bookingById(created.bookingId);

    const res = await bookingsPATCH(req('PATCH', { businessId: BIZ, id: created.bookingId, date: '2026-09-26', time: '09:00' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(true);

    const oldOne = await bookingById(created.bookingId);
    expect(oldOne.status).toBe('cancelled');
    expect(oldOne.startAt).toBe(before.startAt);
    expect(oldOne.endAt).toBe(before.endAt);
    expect(oldOne.durationMin).toBe(40);

    const fresh = await bookingById(body.newId);
    expect(fresh.previousId).toBe(created.bookingId);
    expect(fresh.startAt).toBe('2026-09-26T12:00:00.000Z');
    expect(fresh.endAt).toBe('2026-09-26T12:40:00.000Z');
    expect(fresh.durationMin).toBe(40);
    expect(fresh.temporalSource).toBe('native');
  });

  it('legado terminal reagendado: o antigo é congelado antes da criação do novo', async () => {
    await updateDB((d) => { d.bookings.push(legacyBooking({ status: 'cancelled' })); });
    const res = await bookingsPATCH(req('PATCH', { businessId: BIZ, id: 'legacy-1', date: '2026-09-26', time: '09:00' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const oldOne = (await readDB()).bookings.find((b) => b.id === 'legacy-1')!;
    expect(oldOne.durationMin).toBe(40);
    expect(oldOne.temporalSource).toBe('legacy_inferred');
    expect(oldOne.startAt).toBe('2026-09-25T13:00:00.000Z');
    expect((await readDB()).bookings.find((b) => b.id === body.newId)!.previousId).toBe('legacy-1');
  });
});

// ═══════════════════════════════════════════════════════════════
// API — compatibilidade para consumidores antigos + campos canônicos
// ═══════════════════════════════════════════════════════════════
describe('B1 — compatibilidade de API', () => {
  it('POST /api/bookings responde ok e o registro mantém date/time + campos canônicos', async () => {
    const res = await bookingsPOST(req('POST', {
      businessId: BIZ, serviceId: 's1', asOwner: true,
      customerName: 'Maria', customerPhone: '11987654321',
      date: '2026-09-25', time: '10:00',
    }));
    expect(res.status).toBe(200);

    const manage = await (await bookingsGET(req('GET', {}, token, `?businessId=${BIZ}&mode=manage`))).json();
    const row = manage.bookings.find((b: Booking) => b.date === '2026-09-25');
    expect(row.date).toBe('2026-09-25');
    expect(row.time).toBe('10:00');
    expect(row.startAt).toBe('2026-09-25T13:00:00.000Z');
    expect(row.endAt).toBe('2026-09-25T13:40:00.000Z');
    expect(row.durationMin).toBe(40);
    expect(row.timeZone).toBe(SP);
  });

  it('GET /api/customer/bookings devolve date/time e a duração do SNAPSHOT (não do serviço)', async () => {
    const created = await createOwnerBooking({ customer: { id: 'consumer', name: 'Cliente', phone: '11999998888' } });
    await catalogPOST(req('POST', {
      businessId: BIZ, action: 'service.save', id: 's1', name: 'Consulta',
      durationMin: 60, professionalMode: 'all', professionalIds: [],
    }, token, '', '/api/catalog'));

    const res = await customerBookingsGET(req('GET', {}, consumerToken, `?businessId=${BIZ}`, '/api/customer/bookings'));
    const body = await res.json();
    const row = body.bookings.find((b: any) => b.id === created.bookingId);
    expect(row.date).toBe('2026-09-25');
    expect(row.time).toBe('10:00');
    expect(row.durationMin).toBe(40);
    expect(row.startAt).toBe('2026-09-25T13:00:00.000Z');
  });

  it('API externa cria e devolve o contrato canônico (tenant isolation preservada)', async () => {
    const secret = await updateDB((d) => createApiKey(d, BIZ, 'Teste').fullSecret);
    const res = await externalBookingsPOST(new NextRequest('http://localhost/api/external/bookings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify({ serviceId: 's1', date: '2026-09-25', time: '10:00', customerName: 'Ana', customerPhone: '11999990000' }),
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.booking.businessId).toBe(BIZ);
    expect(body.booking.date).toBe('2026-09-25');
    expect(body.booking.startAt).toBe('2026-09-25T13:00:00.000Z');
    expect(body.booking.durationMin).toBe(40);
    expect(body.booking.timeZone).toBe(SP);
  });

  it('assistente/agente usa o mesmo caminho único (createBookingTx) com janela canônica', async () => {
    const created = await createOwnerBooking({ actor: 'agent' } as any);
    expect((await bookingById(created.bookingId)).temporalSource).toBe('native');
  });
});
