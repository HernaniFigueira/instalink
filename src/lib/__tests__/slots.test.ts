import { describe, expect, it } from 'vitest';
import { computeSlots, type SlotQuery } from '../slots';

// Clínica: Orlando (odonto) e João (cardio), agendas individuais.
const pros = [
  { id: 'pro-orlando', businessId: 'b', name: 'Orlando', role: 'Dentista', photo: '', active: true },
  { id: 'pro-joao', businessId: 'b', name: 'João', role: 'Cardiologista', photo: '', active: true },
  { id: 'pro-ana', businessId: 'b', name: 'Ana', role: 'Fisio', photo: '', active: false },
] as any;
const services = [
  { id: 'svc-odonto', businessId: 'b', name: 'Consulta Odontológica', durationMin: 60, professionalIds: ['pro-orlando'] },
  { id: 'svc-cardio', businessId: 'b', name: 'Consulta Cardiológica', durationMin: 45, professionalIds: ['pro-joao'] },
] as any;
const rules = [
  { id: 'a1', businessId: 'b', weekday: 3, start: '09:00', end: '12:00', slotMin: 0, professionalId: 'pro-orlando', serviceId: '' },
  { id: 'a2', businessId: 'b', weekday: 3, start: '09:00', end: '12:00', slotMin: 0, professionalId: 'pro-joao', serviceId: '' },
] as any;

function query(serviceId: string, bookings: any[] = [], professionalId = ''): SlotQuery {
  const svc = services.find((s: any) => s.id === serviceId);
  return {
    rules, exceptions: [], bookings, services, professionals: pros,
    dateISO: '2026-09-09', weekday: 3, serviceId,
    durationMin: svc.durationMin, professionalId,
    eligibleProIds: svc.professionalIds, nowHM: '', leadMin: 0, bufferMin: 0,
  };
}

describe('grade pela duração do serviço', () => {
  it('60min → 09:00, 10:00, 11:00', () => {
    const r = computeSlots(query('svc-odonto'));
    expect(r.slots).toEqual(['09:00', '10:00', '11:00']);
  });
  it('45min → 09:00, 09:45, 10:30, 11:15', () => {
    const r = computeSlots(query('svc-cardio'));
    expect(r.slots).toEqual(['09:00', '09:45', '10:30', '11:15']);
  });
});

describe('serviço → elegíveis → disponibilidade deles', () => {
  it('odonto ocupado não afeta cardio (agendas não se misturam)', () => {
    const busy = [{ date: '2026-09-09', time: '09:00', status: 'confirmed', serviceId: 'svc-odonto', professionalId: 'pro-orlando' }];
    expect(computeSlots(query('svc-odonto', busy)).slots).toEqual(['10:00', '11:00']);
    expect(computeSlots(query('svc-cardio', busy)).slots).toEqual(['09:00', '09:45', '10:30', '11:15']);
  });
  it('profissional inativo não participa', () => {
    const r = computeSlots({ ...query('svc-cardio'), eligibleProIds: ['pro-joao', 'pro-ana'] });
    expect(r.slots).toEqual(['09:00', '09:45', '10:30', '11:15']);
    expect(Object.values(r.assign).every((id) => id !== 'pro-ana')).toBe(true);
  });
});

describe('ocupados visíveis', () => {
  it('horário ocupado sai de slots e entra em occupied', () => {
    const busy = [{ date: '2026-09-09', time: '10:00', status: 'confirmed', serviceId: 'svc-odonto', professionalId: 'pro-orlando' }];
    const r = computeSlots(query('svc-odonto', busy));
    expect(r.slots).not.toContain('10:00');
    expect(r.occupied).toContain('10:00');
  });
  it('cancelado libera o horário', () => {
    const cancelled = [{ date: '2026-09-09', time: '10:00', status: 'cancelled', serviceId: 'svc-odonto', professionalId: 'pro-orlando' }];
    const r = computeSlots(query('svc-odonto', cancelled));
    expect(r.slots).toContain('10:00');
    expect(r.occupied).not.toContain('10:00');
  });
});
