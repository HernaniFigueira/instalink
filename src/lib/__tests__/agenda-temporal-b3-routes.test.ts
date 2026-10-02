import './helpers/temp-db';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { emptyDB, readDB, updateDB, writeDB } from '../db';
import { createSession } from '../auth';
import { biz, service, user } from './helpers/automation-fixtures';
import { createBookingTx } from '../booking-create';
import { buildBookingWindow } from '../booking-temporal';
import { GET as bookingsGET } from '@/app/api/bookings/route';
import { POST as operationsPOST, GET as operationsGET } from '@/app/api/schedule-operations/route';
import { PATCH as configPATCH } from '@/app/api/businesses/[id]/route';
import { POST as catalogPOST } from '@/app/api/catalog/route';
import type { Booking } from '../types';

let token = '';
const businessId = 'b3';
const req = (method: string, body: any = {}, auth = token, path = '/api/schedule-operations') => new NextRequest(`http://localhost${path}`, {
  method, headers: { 'content-type': 'application/json', 'x-forwarded-for': randomUUID(), ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
  ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
});
const post = (body: any, auth = token) => operationsPOST(req('POST', { businessId, ...body }, auth));
const startAt = '2026-10-05T15:00:00.000Z';
const endAt = '2026-10-05T16:00:00.000Z';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
  const d = emptyDB();
  d.businesses.push(biz(businessId, { booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 60, bufferMin: 10, bufferBeforeMin: 5 } }), biz('foreign'));
  d.users.push(user('owner-b3', 'Owner'), user('owner-foreign', 'Other'));
  d.professionals.push({ id: 'p1', businessId, name: 'Orlando', role: '', photo: '', active: true });
  d.services.push(service('s1', businessId), service('foreign-service', 'foreign'));
  d.scheduleResources.push({ id: 'r1', businessId, name: 'Sala 1', kind: 'room', active: true }, { id: 'foreign-room', businessId: 'foreign', name: 'Outra sala', kind: 'room', active: true });
  const window = buildBookingWindow({ date: '2026-10-05', time: '10:00', durationMin: 30, timeZone: 'America/Sao_Paulo' });
  d.bookings.push({ id: 'old', businessId, customerId: '', serviceId: 's1', professionalId: 'p1', date: '2026-10-05', time: '10:00', status: 'confirmed', customerName: 'Fake', customerPhone: '', note: '', answers: [], createdAt: '', updatedAt: '', history: [], ...window } as Booking);
  await writeDB(d); token = await createSession('owner-b3');
});
afterEach(() => vi.useRealTimers());

describe('B3 — escrita tenant-scoped e freeze de buffers', () => {
  it('congela antes/depois antes de mudar a clínica; não altera snapshots na segunda edição', async () => {
    const patch = (before: number, after: number) => configPATCH(req('PATCH', { booking: { bufferBeforeMin: before, bufferAfterMin: after } }, token, '/api/businesses/b3'), { params: { id: businessId } });
    expect((await patch(20, 30)).status).toBe(200);
    let old = (await readDB()).bookings.find(b => b.id === 'old')!;
    expect([old.bufferBeforeMin, old.bufferAfterMin]).toEqual([5, 10]);
    expect((await patch(30, 40)).status).toBe(200);
    old = (await readDB()).bookings.find(b => b.id === 'old')!;
    expect([old.bufferBeforeMin, old.bufferAfterMin]).toEqual([5, 10]);
  });
  it('creates, edits, lists and deletes a block without creating a fake booking', async () => {
    const made = await post({ action: 'block.save', startAt, endAt, professionalId: 'p1', note: 'Reunião' });
    expect(made.status).toBe(200);
    const { block } = await made.json();
    expect(block.note).toBe('Reunião');
    const changed = await post({ action: 'block.save', id: block.id, startAt, endAt, professionalId: 'p1', note: 'Inventário' });
    expect(changed.status).toBe(200);
    const list = await operationsGET(req('GET', {}, token, `/api/schedule-operations?businessId=${businessId}`));
    expect((await list.json()).blocks).toMatchObject([{ note: 'Inventário' }]);
    expect((await readDB()).bookings).toHaveLength(1);
    expect((await post({ action: 'block.delete', id: block.id })).status).toBe(200);
    expect((await readDB()).scheduleBlocks).toHaveLength(0);
  });
  it('serializes two professionals competing for one room: exactly one succeeds, the other is 409', async () => {
    await updateDB(d => {
      d.professionals.push({ id: 'p2', businessId, name: 'Ana', role: '', photo: '', active: true });
      d.services.find(s => s.id === 's1')!.resourceRequirements = [['r1']];
      d.availability.push({ id: 'rule', businessId, serviceId: '', professionalId: '', weekday: 1, start: '09:00', end: '18:00', slotMin: 30 });
    });
    const create = (professionalId: string) => updateDB(d => createBookingTx(d, {
      business: d.businesses.find(b => b.id === businessId)!, service: d.services.find(s => s.id === 's1')!,
      date: '2026-10-05', time: '11:00', professionalId, actor: 'owner',
      customer: { id: '', name: 'Fake', phone: '11988889999' },
    }));
    const result = await Promise.allSettled([create('p1'), create('p2')]);
    expect(result.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const denied = result.find(x => x.status === 'rejected') as PromiseRejectedResult;
    expect(denied.reason.status).toBe(409);
    const rows = (await readDB()).bookings.filter(b => b.time === '11:00');
    expect(rows).toHaveLength(1);
    expect(rows[0].resourceIds).toEqual(['r1']);
  });
  it('does not let fit-in bypass a professional or business block', async () => {
    await updateDB(d => {
      d.scheduleBlocks.push({ id: 'blocked', businessId, professionalId: 'p1', resourceId: '', startAt: '2026-10-05T14:00:00.000Z', endAt: '2026-10-05T15:00:00.000Z', note: 'Reunião' });
    });
    await expect(updateDB(d => createBookingTx(d, {
      business: d.businesses[0], service: d.services.find(s => s.id === 's1')!,
      date: '2026-10-05', time: '11:00', professionalId: 'p1', actor: 'owner', bookingKind: 'fit_in', fitInConfirmed: true,
      customer: { id: '', name: 'Fake', phone: '11988889999' },
    }))).rejects.toMatchObject({ status: 409 });
    expect((await readDB()).bookings).toHaveLength(1);
  });
  it('serializes competition for a single equipment unit too', async () => {
    await updateDB(d => {
      d.scheduleResources.find(r => r.id === 'r1')!.kind = 'equipment';
      d.professionals.push({ id: 'p2', businessId, name: 'Ana', role: '', photo: '', active: true });
      d.services.find(s => s.id === 's1')!.resourceRequirements = [['r1']];
      d.availability.push({ id: 'rule', businessId, serviceId: '', professionalId: '', weekday: 1, start: '09:00', end: '18:00', slotMin: 30 });
    });
    const create = (professionalId: string) => updateDB(d => createBookingTx(d, {
      business: d.businesses[0], service: d.services.find(s => s.id === 's1')!, date: '2026-10-05', time: '11:00', professionalId, actor: 'owner',
      customer: { id: '', name: 'Fake', phone: '11988889999' },
    }));
    const rows = await Promise.allSettled([create('p1'), create('p2')]);
    expect(rows.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect((rows.find(row => row.status === 'rejected') as PromiseRejectedResult).reason.status).toBe(409);
  });
  it('public and internal slots both honor hard business and resource blocks', async () => {
    await updateDB(d => {
      d.availability.push({ id: 'rule', businessId, serviceId: '', professionalId: '', weekday: 1, start: '09:00', end: '18:00', slotMin: 30 });
      d.services.find(s => s.id === 's1')!.resourceRequirements = [['r1']];
    });
    const url = '/api/bookings?businessId=b3&serviceId=s1&date=2026-10-05';
    const before = await bookingsGET(req('GET', {}, '', url));
    expect((await before.json()).slots).toContain('11:00');
    expect((await post({ action: 'block.save', startAt: '2026-10-05T14:00:00Z', endAt: '2026-10-05T14:30:00Z', resourceId: 'r1' })).status).toBe(200);
    const publicSlots = await bookingsGET(req('GET', {}, '', url));
    expect((await publicSlots.json()).slots).not.toContain('11:00');
    const internal = await bookingsGET(req('GET', {}, token, url.replace('?', '?mode=slots-admin&internalSnap=5&')));
    expect((await internal.json()).slots).not.toContain('11:00');
  });
  it('keeps used or deactivated resources legible and rejects cross-tenant edits', async () => {
    await updateDB(d => { d.bookings.find(b => b.id === 'old')!.resourceIds = ['r1']; });
    const off = await post({ action: 'resource.save', id: 'r1', name: 'Sala antiga', kind: 'room', active: false });
    expect(off.status).toBe(200);
    expect((await readDB()).bookings[0].resourceIds).toEqual(['r1']);
    expect((await post({ action: 'resource.delete', id: 'r1' })).status).toBe(409);
    expect((await post({ action: 'resource.save', id: 'foreign-room', name: 'Outra', kind: 'room' })).status).toBe(404);
  });
  it('rejects foreign resources and blocks; history prevents deleting used rooms', async () => {
    const foreign = await post({ action: 'block.save', startAt, endAt, resourceId: 'foreign-room' });
    expect(foreign.status).toBe(400);
    expect((await post({ action: 'block.delete', id: 'some-other-tenant-block' })).status).toBe(404);
    const svc = await catalogPOST(req('POST', { businessId, action: 'service.save', id: 's1', name: 'Consulta', durationMin: 30, resourceRequirements: [['foreign-room']] }, token, '/api/catalog'));
    expect(svc.ok).toBe(false);
  });
});
