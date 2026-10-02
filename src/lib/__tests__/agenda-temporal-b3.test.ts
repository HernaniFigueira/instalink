import { describe, expect, it } from 'vitest';
import { assignResources, blockConflict, bufferPair } from '../schedule-capacity';
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
  it('assigns two simultaneous bookings to alternatives, rejects a third; prefers old room on move', () => {
    const base = { requirements: service.resourceRequirements!, resources, blocks: [], businessId, start: Date.parse(at(12)), end: Date.parse(at(13)) };
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
