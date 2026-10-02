import { describe, expect, it } from 'vitest';
import { assignResources, blockConflict, bufferPair, bookingBufferPair, freezeLegacyBuffers } from '../schedule-capacity';
import { computeSlots } from '../slots';
import type { Booking, ScheduleBlock, ScheduleResource, Service } from '../types';

const businessId = 'clinic';
const resources: ScheduleResource[] = ['room-a', 'room-b'].map(id => ({ id, businessId, name: id, kind: 'room', active: true }));
const service = { id: 's', businessId, durationMin: 30, resourceRequirements: [['room-a', 'room-b']] } as Service;
const date = '2026-10-05';
const at = (hour: number) => `2026-10-05T${String(hour).padStart(2, '0')}:00:00.000Z`;
const booking = (id: string, resourceId: string): Booking => ({ id, businessId, serviceId: 's', professionalId: id, resourceIds: [resourceId], status: 'confirmed', startAt: at(12), endAt: at(13) } as Booking);
const block = (professionalId = '', resourceId = ''): ScheduleBlock => ({ id: 'block', businessId, professionalId, resourceId, startAt: at(12), endAt: at(13), note: 'Inventário' });

describe('Agenda Temporal B3 — recursos, bloqueios e buffers', () => {
  it('legacy bufferMin only applies after; service overrides each side', () => {
    expect(bufferPair(undefined, { bufferMin: 10 })).toEqual({ before: 0, after: 10 });
    expect(bufferPair(service, { bufferMin: 10, bufferBeforeMin: 5 })).toEqual({ before: 5, after: 10 });
    expect(bufferPair({ ...service, bufferAfterMin: 0 }, { bufferMin: 10 })).toEqual({ before: 0, after: 0 });
  });
  it('freezes legacy buffers on the old policy before a clinic or service edit; new bookings use the new policy', () => {
    const legacy = booking('old', 'room-a');
    legacy.bufferBeforeMin = undefined; legacy.bufferAfterMin = undefined;
    const native = booking('native', 'room-b');
    native.bufferBeforeMin = 5; native.bufferAfterMin = 10;
    const db = { bookings: [legacy, native], services: [service] };
    expect(freezeLegacyBuffers(db, businessId, { bufferMin: 10, bufferBeforeMin: 0 })).toBe(1);
    expect(legacy).toMatchObject({ bufferBeforeMin: 0, bufferAfterMin: 10 });
    expect(freezeLegacyBuffers(db, businessId, { bufferMin: 30, bufferBeforeMin: 20 })).toBe(0);
    expect(legacy).toMatchObject({ bufferBeforeMin: 0, bufferAfterMin: 10 });
    expect(native).toMatchObject({ bufferBeforeMin: 5, bufferAfterMin: 10 });
    expect(bufferPair(service, { bufferMin: 30, bufferBeforeMin: 20 })).toEqual({ before: 20, after: 30 });
  });
  it('A: legacy clinic after=15 occupies Sala 1 through 10:55, not 10:45', () => {
    const old = { ...booking('old', 'room-a'), startAt: '2026-10-05T13:00:00Z', endAt: '2026-10-05T13:40:00Z' };
    const args = { requirements: [['room-a']], resources, bookings: [old], services: [service], bookingConfig: { bufferMin: 15 }, blocks: [], businessId, end: Date.parse('2026-10-05T14:00:00Z') };
    expect(assignResources({ ...args, start: Date.parse('2026-10-05T13:45:00Z') })).toBeNull();
    expect(assignResources({ ...args, start: Date.parse('2026-10-05T13:55:00Z') })).toEqual(['room-a']);
  });
  it('B: uses existing Cirurgia override, never candidate Consulta policy', () => {
    const surgery = { ...service, id: 'surgery', bufferBeforeMin: 10, bufferAfterMin: 20 };
    const consult = { ...service, id: 'consult', bufferBeforeMin: 0, bufferAfterMin: 0 };
    const old = { ...booking('old', 'room-a'), serviceId: 'surgery', startAt: '2026-10-05T13:00:00Z', endAt: '2026-10-05T13:40:00Z' };
    const config = { bufferMin: 5, bufferBeforeMin: 0 };
    expect(bookingBufferPair(old, surgery, config)).toEqual({ before: 10, after: 20 });
    const args = { requirements: [['room-a']], resources, bookings: [old], services: [consult, surgery], bookingConfig: config, blocks: [], businessId };
    expect(assignResources({ ...args, start: Date.parse('2026-10-05T12:55:00Z'), end: Date.parse('2026-10-05T13:00:00Z') })).toBeNull();
    expect(assignResources({ ...args, start: Date.parse('2026-10-05T13:55:00Z'), end: Date.parse('2026-10-05T14:00:00Z') })).toBeNull();
    expect(assignResources({ ...args, start: Date.parse('2026-10-05T14:00:00Z'), end: Date.parse('2026-10-05T14:05:00Z') })).toEqual(['room-a']);
  });
  it('C/D/H: snapshots win after policy changes, cancelled frees resource; freeze captures old policy', () => {
    const old = { ...booking('old', 'room-a'), startAt: '2026-10-05T13:00:00Z', endAt: '2026-10-05T13:40:00Z', bufferBeforeMin: 5, bufferAfterMin: 10 };
    const changed = { ...service, bufferBeforeMin: 30, bufferAfterMin: 45 };
    const config = { bufferMin: 30, bufferBeforeMin: 30 };
    expect(bookingBufferPair(old, changed, config)).toEqual({ before: 5, after: 10 });
    const args = { requirements: [['room-a']], resources, bookings: [old], services: [changed], bookingConfig: config, blocks: [], businessId, start: Date.parse('2026-10-05T13:50:00Z'), end: Date.parse('2026-10-05T13:55:00Z') };
    expect(assignResources(args)).toEqual(['room-a']);
    expect(assignResources({ ...args, start: Date.parse('2026-10-05T13:45:00Z') })).toBeNull();
    expect(assignResources({ ...args, bookings: [{ ...old, status: 'cancelled' }] })).toEqual(['room-a']);
    const legacy = { ...old, bufferBeforeMin: undefined, bufferAfterMin: undefined };
    expect(freezeLegacyBuffers({ bookings: [legacy], services: [service] }, businessId, { bufferMin: 15 })).toBe(1);
    expect(legacy).toMatchObject({ bufferBeforeMin: 0, bufferAfterMin: 15 });
    expect(assignResources({ ...args, bookings: [legacy], start: Date.parse('2026-10-05T13:50:00Z') })).toBeNull();
    expect(assignResources({ ...args, bookings: [legacy], start: Date.parse('2026-10-05T13:55:00Z') })).toEqual(['room-a']);
  });
  it('backtracks overlapping alternative groups without assigning the same room twice', () => {
    expect(assignResources({ requirements: [['room-a', 'room-b'], ['room-a']], resources, bookings: [], services: [service], bookingConfig: { bufferMin: 0 }, blocks: [], businessId, start: Date.parse(at(12)), end: Date.parse(at(13)) })).toEqual(['room-b', 'room-a']);
  });
  it('assigns two simultaneous bookings to alternatives, rejects a third; prefers old room on move', () => {
    const base = { requirements: service.resourceRequirements!, resources, services: [service], bookingConfig: { bufferMin: 0 }, blocks: [], businessId, start: Date.parse(at(12)), end: Date.parse(at(13)) };
    expect(assignResources({ ...base, bookings: [] })).toEqual(['room-a']);
    expect(assignResources({ ...base, bookings: [booking('p1', 'room-a')] })).toEqual(['room-b']);
    expect(assignResources({ ...base, bookings: [booking('p1', 'room-a'), booking('p2', 'room-b')] })).toBeNull();
    expect(assignResources({ ...base, bookings: [], preferred: ['room-b'] })).toEqual(['room-b']);
  });
  it('blocks business, professional and resource independently', () => {
    const start = Date.parse(at(12)), end = Date.parse(at(13));
    expect(blockConflict([block()], businessId, 'p2', [], start, end)).toBe(true);
    expect(blockConflict([block('p1')], businessId, 'p2', [], start, end)).toBe(false);
    expect(blockConflict([block('', 'room-a')], businessId, 'p2', ['room-a'], start, end)).toBe(true);
    expect(blockConflict([block('', 'room-a')], 'other', 'p2', ['room-a'], start, end)).toBe(false);
  });
  it('before/after effective interval rejects collisions, accepts exact boundaries, cancelled frees', () => {
    const existing = { ...booking('p1', 'room-a'), serviceId: 's', date, time: '10:00',
      startAt: '2026-10-05T13:00:00.000Z', endAt: '2026-10-05T13:40:00.000Z', durationMin: 40,
      bufferBeforeMin: 10, bufferAfterMin: 15 } as Booking;
    const base = {
      rules: [{ id: 'rule', businessId, professionalId: '', serviceId: '', weekday: 1, start: '08:00', end: '12:00', slotMin: 5 }],
      exceptions: [], bookings: [existing], services: [{ ...service, resourceRequirements: [], durationMin: 5 }],
      professionals: [{ id: 'p1', businessId, name: 'Maria', role: '', photo: '', active: true, followBusinessHours: true }],
      dateISO: date, weekday: 1, serviceId: 's', durationMin: 5, startStepMin: 5, professionalId: 'p1', eligibleProIds: ['p1'], nowHM: '', leadMin: 0, bufferMin: 0,
      timeZone: 'America/Sao_Paulo', resources: [], businessId,
    };
    const q = computeSlots(base);
    expect(q.slots).toContain('09:45'); // 09:45–09:50 meets before edge
    expect(q.slots).not.toContain('09:50');
    expect(q.slots).not.toContain('10:50');
    expect(q.slots).toContain('10:55'); // after edge exact
    expect(computeSlots({ ...base, bookings: [{ ...existing, status: 'cancelled' }] }).slots).toContain('10:00');
  });
  it('slot engine excludes a blocked professional and occupied alternative rooms', () => {
    const base = {
      rules: [{ id: 'rule', businessId, professionalId: '', serviceId: '', weekday: 1, start: '09:00', end: '10:00', slotMin: 30 }],
      exceptions: [], bookings: [], services: [service],
      professionals: [{ id: 'p1', businessId, name: 'Maria', role: '', photo: '', active: true, followBusinessHours: true }],
      dateISO: date, weekday: 1, serviceId: 's', durationMin: 30, professionalId: 'p1', eligibleProIds: ['p1'], nowHM: '', leadMin: 0, bufferMin: 0,
      timeZone: 'America/Sao_Paulo', resources, businessId,
    };
    const open = computeSlots(base);
    expect(open.slots).toContain('09:00');
    const morningBlock = { ...block('p1'), startAt: '2026-10-05T12:00:00.000Z', endAt: '2026-10-05T12:30:00.000Z' };
    expect(computeSlots({ ...base, blocks: [morningBlock] }).slots).not.toContain('09:00');
    expect(computeSlots({ ...base, blocks: [{ ...morningBlock, resourceId: 'room-a', professionalId: '' }, { ...morningBlock, id: 'b2', resourceId: 'room-b', professionalId: '' }] }).slots).not.toContain('09:00');
  });
});
