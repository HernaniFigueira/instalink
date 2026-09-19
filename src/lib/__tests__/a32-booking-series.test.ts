import './helpers/temp-db';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { emptyDB, writeDB, readDB, updateDB } from '../db';
import { createSession } from '../auth';
import { createCustomerSession } from '../customer-auth';
import { createSeriesTx } from '../booking-series';
import { biz, service, user, buildAutomation } from './helpers/automation-fixtures';
import { GET, POST, PATCH } from '@/app/api/bookings/route';
import { GET as people } from '@/app/api/people360/route';
import { generateOccurrences, addMonthsClamped, type BookingOccurrence } from '../booking-recurrence';
import { adminBookingMaxDate } from '../booking-ops';
import { addDaysISO } from '../tz';

const NOW = '2026-09-18T12:00:00Z';
let token = '', scopedToken = '', outsider = '', deniedToken = '', consumerToken = '';
function req(method: string, body: any = {}, auth = token, query = '') {
  return new NextRequest(`http://localhost/api/bookings${query}`, { method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': randomUUID(), ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
}
const first = { date: '2026-09-25', time: '14:00', professionalId: 'orlando' };
const rows = () => generateOccurrences(first, 'weekly', { count: 3 });
const body = (extra: any = {}) => ({ businessId: 'b1', serviceId: 's1', asOwner: true, customerName: 'Maria', customerPhone: '11987654321', ...first, ...extra });
const series = (occurrences = rows(), extra: any = {}) => body({ series: { requestId: randomUUID(), occurrences }, ...extra });
async function getSlots(date: string, admin = false, auth = token, extra = '') {
  return GET(req('GET', {}, auth, `?businessId=b1&serviceId=s1&date=${date}${admin ? '&mode=slots-admin' : ''}${extra}`));
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(NOW));
  const d = emptyDB();
  d.customers.push({ id: 'consumer', name: 'Cliente', phone: '11999998888', email: 'consumer@example.test', passwordHash: 'x', googleId: '', avatar: '', createdAt: NOW });
  d.businesses.push(biz('b1'), biz('b2'));
  d.users.push(user('owner-b1', 'Dono'), user('owner-b2', 'Outro'), user('pro-user', 'Orlando'), user('denied', 'Sem agenda'));
  d.professionals.push(...['orlando', 'silvio'].map((id) => ({ id, businessId: 'b1', name: id, role: '', photo: '', active: true, followBusinessHours: true, ...(id === 'orlando' ? { userId: 'pro-user' } : {}) })));
  d.members.push({ id: 'm', businessId: 'b1', userId: 'pro-user', role: 'PROFISSIONAL', active: true, permissions: {}, note: '', invitedBy: 'owner-b1', createdAt: NOW, updatedAt: NOW },
    { id: 'denied', businessId: 'b1', userId: 'denied', role: 'ATENDENTE', active: true, permissions: { agenda: false }, note: '', invitedBy: 'owner-b1', createdAt: NOW, updatedAt: NOW });
  d.services.push(service('s1', 'b1', { professionalIds: ['orlando', 'silvio'] }), service('s2', 'b2'));
  for (let weekday = 0; weekday < 7; weekday++) d.availability.push({ id: `a${weekday}`, businessId: 'b1', weekday, start: '00:00', end: '23:59', slotMin: 30, professionalId: '', serviceId: '' });
  await writeDB(d);
  token = await createSession('owner-b1'); scopedToken = await createSession('pro-user'); outsider = await createSession('owner-b2'); deniedToken = await createSession('denied'); consumerToken = await createCustomerSession('consumer');
});
afterEach(() => vi.useRealTimers());

describe('A3.2 — calendários', () => {
  it('semanal e quinzenal incluem primeiro atendimento', () => {
    expect(rows().map((r) => r.date)).toEqual(['2026-09-25', '2026-10-02', '2026-10-09']);
    expect(generateOccurrences(first, 'fortnightly', { until: '2026-11-06' }).map((r) => r.date)).toEqual(['2026-09-25', '2026-10-09', '2026-10-23', '2026-11-06']);
  });
  it('31/jan limita fevereiro sem deslocar março; atravessa ano e ano bissexto', () => {
    expect(generateOccurrences({ ...first, date: '2027-01-31' }, 'monthly', { count: 3 }).map((r) => r.date)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(addMonthsClamped('2027-12-31', 2)).toBe('2028-02-29');
    expect(adminBookingMaxDate('2028-02-29')).toBe('2033-02-28');
  });
  it('recusa quantidade excessiva, fracionada e data final inválida', () => {
    for (const count of [1, 367, 2.5]) expect(() => generateOccurrences(first, 'weekly', { count })).toThrow();
    expect(() => generateOccurrences(first, 'weekly', { until: '2040-01-01' })).toThrow();
    expect(() => generateOccurrences(first, 'monthly', { until: '2026-02-30' })).toThrow();
  });
});

describe('A3.2 — horizonte e autoridade das rotas reais', () => {
  it('público: dia 60 permitido; 61 bloqueado em GET e POST', async () => {
    const d60 = addDaysISO('2026-09-18', 60), d61 = addDaysISO('2026-09-18', 61);
    expect((await (await getSlots(d60)).json()).slots).toContain('14:00');
    expect((await (await getSlots(d61)).json()).slots).toEqual([]);
    expect((await POST(req('POST', body({ asOwner: false, date: d60 }), ''))).status).toBe(200);
    expect((await POST(req('POST', body({ asOwner: false, date: d61 }), ''))).status).toBe(400);
  });
  it.each(['2026-12-18', '2027-09-18', '2028-03-18', '2031-09-18'])('admin agenda %s com horizonte público 60', async (date) => {
    expect((await (await getSlots(date, true)).json()).slots).toContain('14:00');
    expect((await POST(req('POST', body({ date })))).status).toBe(200);
  });
  it('limite admin é inclusivo e independente do horizonte público', async () => {
    expect((await (await getSlots('2031-09-19', true)).json()).slots).toEqual([]);
    expect((await POST(req('POST', body({ date: '2031-09-19' })))).status).toBe(400);
    const d = await readDB(); expect(d.businesses[0].booking.horizonDays).toBe(60);
  });
  it.each(['', 'outsider', 'denied', 'consumer'])('mode admin/asOwner exige sessão e permissão: %s', async (actor) => {
    const auth = actor === 'outsider' ? outsider : actor === 'denied' ? deniedToken : actor === 'consumer' ? consumerToken : '';
    expect([401, 403]).toContain((await getSlots('2027-09-18', true, auth)).status);
    expect([401, 403]).toContain((await POST(req('POST', body(), auth))).status);
  });
  it('sessão lojista não transforma POST público em admin', async () => {
    expect((await POST(req('POST', body({ asOwner: false, date: '2027-09-18' })))).status).toBe(400);
  });
  it.each([true, false])('passado bloqueado para admin=%s (data e hora de hoje)', async (admin) => {
    expect((await (await getSlots('2026-09-17', admin)).json()).slots).toEqual([]);
    expect((await POST(req('POST', body({ asOwner: admin, date: '2026-09-17' })))).status).toBe(400);
    expect((await POST(req('POST', body({ asOwner: admin, date: '2026-09-18', time: '01:00' })))).status).toBe(409);
  });
  it('usa fuso do Business perto da virada UTC, inclusive no horizonte', async () => {
    vi.setSystemTime(new Date('2026-09-19T01:00:00Z'));
    await updateDB((d) => { d.businesses[0].businessTimezone = 'America/Sao_Paulo'; });
    const res = await (await getSlots('2026-09-18', true)).json();
    expect(res.today).toBe('2026-09-18'); expect(res.slots).toContain('23:00');
    expect((await POST(req('POST', body({ date: '2026-09-18', time: '23:00' })))).status).toBe(200);
    expect((await (await getSlots(addDaysISO('2026-09-18', 61))).json()).slots).toEqual([]);
  });
  it('slots admin respeita scope e elegibilidade, inclusive consulta sem pro', async () => {
    expect((await getSlots(first.date, true, scopedToken, '&professionalId=silvio')).status).toBe(403);
    expect(Object.keys((await (await getSlots(first.date, true, scopedToken)).json()).byPro)).toEqual(['orlando']);
    await updateDB((d) => { d.services[0].professionalIds = ['silvio']; });
    expect((await getSlots(first.date, true, scopedToken)).status).toBe(400);
  });
});

describe('A3.2 — série atômica, identidade e operações normais', () => {
  it('normal permanece Booking confirmado sem campos de série', async () => {
    expect((await POST(req('POST', body()))).status).toBe(200);
    const d = await readDB(); expect(d.bookings).toHaveLength(1); expect(d.bookings[0].seriesId).toBeUndefined(); expect(d.bookings[0].status).toBe('confirmed');
  });
  it('preview não escreve; criação possui IDs próprios, identidade comum e 360 único sem lead', async () => {
    const input = series();
    expect((await POST(req('POST', { ...input, preview: true }))).status).toBe(200);
    expect((await readDB()).bookings).toHaveLength(0);
    const res = await POST(req('POST', input)); expect(res.status).toBe(200);
    const result = await res.json(), d = await readDB();
    expect(new Set(d.bookings.map((b) => b.id)).size).toBe(3);
    expect(d.bookings.map((b) => b.seriesId)).toEqual([result.seriesId, result.seriesId, result.seriesId]);
    expect(d.bookings.map((b) => b.seriesIndex)).toEqual([1, 2, 3]);
    expect(d.bookings.every((b) => b.seriesCount === 3)).toBe(true);
    expect(d.contacts).toHaveLength(1); expect(d.leads).toHaveLength(0);
    expect(d.events.filter((e) => e.type === 'booking_created')).toHaveLength(3);
    expect(result.occurrences.map((r: any) => r.date)).toEqual(rows().map((r) => r.date));
    const crm = await (await people(req('GET', {}, token, '?businessId=b1'))).json();
    expect(crm.people).toHaveLength(1); expect(crm.people[0].bookings).toHaveLength(3);
    expect(crm.people[0].bookings.every((b: any) => b.seriesId === result.seriesId)).toBe(true);
  });
  it('cada booking emite o evento existente; retry não duplica execuções', async () => {
    const d = await readDB();
    d.automations.push(buildAutomation({ event: 'booking.created', serviceIds: ['s1'] }));
    const params = { business: d.businesses[0], service: d.services[0], ...first, actor: 'owner' as const, customer: { id: '', name: 'Maria', phone: '11987654321' } };
    const key = randomUUID();
    const result = createSeriesTx(d, params, rows(), key);
    expect(d.automationRuns).toHaveLength(3);
    expect(new Set(d.automationRuns.map((r) => r.eventKey)).size).toBe(3);
    expect(d.automationRuns.map((r) => (r.context.booking as any).id).sort()).toEqual(result.bookingIds.sort());
    createSeriesTx(d, params, rows(), key);
    expect(d.automationRuns).toHaveLength(3);
  });
  it('personalizadas preservam dia, horário e profissional elegível', async () => {
    const custom: BookingOccurrence[] = [first, { date: '2026-10-09', time: '15:00', professionalId: 'silvio' }, { ...first, date: '2026-10-23' }, { ...first, date: '2026-11-13', time: '16:00' }];
    expect((await POST(req('POST', series(custom)))).status).toBe(200);
    expect((await readDB()).bookings.map(({ date, time, professionalId }) => ({ date, time, professionalId }))).toEqual(custom);
  });
  it('recorrência atravessa horizonte público, mas não limite técnico', async () => {
    const occurrences = generateOccurrences(first, 'monthly', { count: 18 });
    expect((await POST(req('POST', series(occurrences)))).status).toBe(200);
    expect((await POST(req('POST', series([{ ...first, date: '2031-09-18' }, { ...first, date: '2031-09-19' }])))).status).toBe(409);
    expect((await readDB()).bookings).toHaveLength(18);
  });
  it('profissional inelegível / outra unidade rejeitado sem criação parcial', async () => {
    const occurrences = rows(); occurrences[1].professionalId = 'estrangeiro';
    const res = await POST(req('POST', series(occurrences))); expect(res.status).toBe(409);
    expect((await res.json()).occurrences[1].state).toBe('professional_unavailable');
    expect((await readDB()).bookings).toHaveLength(0);
  });
  it('preview diferencia fechado, profissional indisponível e conflito', async () => {
    await updateDB((d) => { d.exceptions.push({ id: 'e', businessId: 'b1', date: first.date, closed: true, start: '', end: '', note: '' }); });
    const occurrences = rows(); occurrences[1].professionalId = 'inelegivel';
    const result = await (await POST(req('POST', series(occurrences, { preview: true })))).json();
    expect(result.occurrences.map((r: any) => r.state)).toEqual(['closed', 'professional_unavailable', 'available']);
  });
  it('revalida confirmação após preview; conflito não cria parcialmente; permite corrigir', async () => {
    const input = series();
    expect((await POST(req('POST', { ...input, preview: true }))).status).toBe(200);
    await POST(req('POST', body(rows()[1])));
    const res = await POST(req('POST', input)); expect(res.status).toBe(409);
    expect((await res.json()).occurrences[1].state).toBe('conflict');
    expect((await readDB()).bookings).toHaveLength(1);
    input.series.occurrences[1].time = '15:00';
    expect((await POST(req('POST', input))).status).toBe(200);
    expect((await readDB()).bookings).toHaveLength(4);
  });
  it('sobreposição dentro da própria série passa pelo computeSlots', async () => {
    expect((await POST(req('POST', series([first, first])))).status).toBe(409);
    expect((await readDB()).bookings).toHaveLength(0);
  });
  it('duas submissões simultâneas da mesma chave retornam a mesma série', async () => {
    const input = series();
    const res = await Promise.all([POST(req('POST', input)), POST(req('POST', input))]);
    const results = await Promise.all(res.map((r) => r.json()));
    expect(results[0].seriesId).toBe(results[1].seriesId);
    expect(results.filter((r) => r.replayed)).toHaveLength(1);
    expect((await readDB()).bookings).toHaveLength(3);
    input.series.occurrences[0].time = '16:00';
    expect((await POST(req('POST', input))).status).toBe(409);
  });
  it('chaves diferentes concorrendo no mesmo slot: só uma vence', async () => {
    const res = await Promise.all([POST(req('POST', series())), POST(req('POST', series()))]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await readDB()).bookings).toHaveLength(3);
  });
  it('tenant isolation e scope profissional no POST, preview e cancelamento', async () => {
    expect((await POST(req('POST', series(), outsider))).status).toBe(403);
    expect((await POST(req('POST', series(rows(), { serviceId: 's2' })))).status).toBe(400);
    const mixed = [first, { ...first, date: '2026-10-09', professionalId: 'silvio' }];
    expect((await POST(req('POST', series(mixed), scopedToken))).status).toBe(403);
    expect((await POST(req('POST', series(mixed, { preview: true }), scopedToken))).status).toBe(403);
    expect((await POST(req('POST', series(mixed)))).status).toBe(200);
    const id = (await readDB()).bookings[0].id;
    expect((await PATCH(req('PATCH', { businessId: 'b1', id, action: 'cancel-series-future' }, scopedToken))).status).toBe(403);
    expect((await PATCH(req('PATCH', { businessId: 'b2', id, action: 'cancel-series-future' }, outsider))).status).toBe(404);
  });
  it('profissional scoped com automático cria somente para si', async () => {
    expect((await POST(req('POST', series(rows().map((r) => ({ ...r, professionalId: '' })), { professionalId: '' }), scopedToken))).status).toBe(200);
    expect((await readDB()).bookings.every((b) => b.professionalId === 'orlando')).toBe(true);
  });
  it('PATCH individual além do horizonte público preserva série e não move as demais', async () => {
    await POST(req('POST', series())); const before = (await readDB()).bookings;
    const id = before[0].id;
    expect((await PATCH(req('PATCH', { businessId: 'b1', id, date: '2027-09-18', time: '14:00' }))).status).toBe(200);
    let d = await readDB(); expect(d.bookings[0].seriesId).toBe(before[0].seriesId); expect(d.bookings.slice(1)).toEqual(before.slice(1));
    expect((await PATCH(req('PATCH', { businessId: 'b1', id, date: '2032-01-01', time: '14:00' }))).status).toBe(400);
    expect((await PATCH(req('PATCH', { businessId: 'b1', id, date: '2026-09-17', time: '14:00' }))).status).toBe(400);
    await PATCH(req('PATCH', { businessId: 'b1', id, status: 'completed' }));
    expect((await PATCH(req('PATCH', { businessId: 'b1', id, date: '2028-01-01', time: '14:00' }))).status).toBe(200);
    d = await readDB(); expect(d.bookings).toHaveLength(4); expect(d.bookings[3].seriesId).toBe(before[0].seriesId); expect(d.bookings[0].status).toBe('completed');
  });
  it('cancelar futuras preserva passadas e terminais, registra histórico, é idempotente', async () => {
    await POST(req('POST', series()));
    const ids = (await readDB()).bookings.map((b) => b.id);
    await PATCH(req('PATCH', { businessId: 'b1', id: ids[2], status: 'no_show' }));
    vi.setSystemTime(new Date('2026-09-26T12:00:00Z'));
    const result = await PATCH(req('PATCH', { businessId: 'b1', id: ids[0], action: 'cancel-series-future' }));
    expect(result.status).toBe(200); expect((await result.json()).cancelled).toBe(1);
    const d = await readDB(); expect(d.bookings.map((b) => b.status)).toEqual(['confirmed', 'cancelled', 'no_show']);
    expect(d.bookings[1].history.at(-1)?.note).toContain('série');
    expect((await (await PATCH(req('PATCH', { businessId: 'b1', id: ids[0], action: 'cancel-series-future' }))).json()).cancelled).toBe(0);
  });
});
