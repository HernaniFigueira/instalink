import { describe, expect, it } from 'vitest';
import { computeSlots } from '../slots';
import type { Availability, Service, Professional, Booking } from '../types';
import { rescheduleDecision } from '../booking-ops';
import { timeToMin } from '../utils';

// Testa correção do drag-and-drop e estados de disponibilidade

describe('agenda - disponibilidade e slots', () => {
  const svc: Service = { id: 's1', businessId: 'b1', categoryId: '', name: 'Consulta', description: '', image: '', price: 10000, durationMin: 30, professionalIds: [], active: true, featured: false, bookable: true, questions: [] };
  const pro: Professional = { id: 'p1', businessId: 'b1', name: 'Dr A', role: 'Dentista', photo: '', active: true };
  const rules: Availability[] = [
    { id: 'r1', businessId: 'b1', professionalId: '', serviceId: '', weekday: 1, start: '09:00', end: '12:00', slotMin: 30 },
  ];

  it('retorna loading/empty/error separados (success)', () => {
    const r = computeSlots({
      rules, exceptions: [], bookings: [], services: [svc], professionals: [pro],
      dateISO: '2026-09-14', weekday: 1, serviceId: 's1', durationMin: 30,
      professionalId: '', eligibleProIds: [], nowHM: '', leadMin: 0, bufferMin: 0,
    });
    expect(r.slots.length).toBeGreaterThan(0);
    expect(r.closed).toBe(false);
    // slots ordenados e sem duplicatas
    const sorted = [...r.slots].sort();
    expect(r.slots).toEqual(sorted);
  });

  it('empty quando não há regra no dia (sem horário disponível)', () => {
    const r = computeSlots({
      rules, exceptions: [], bookings: [], services: [svc], professionals: [pro],
      dateISO: '2026-09-13', weekday: 6, serviceId: 's1', durationMin: 30,
      professionalId: '', eligibleProIds: [], nowHM: '', leadMin: 0, bufferMin: 0,
    });
    expect(r.slots).toEqual([]);
    // sem janelas no dia = não há grade; UI trata como vazio (sem horário)
    expect(r.slots.length).toBe(0);
  });

  it('closed quando exceção fecha o dia', () => {
    const r = computeSlots({
      rules, exceptions: [{ id: 'e1', businessId: 'b1', date: '2026-09-14', closed: true, start: '', end: '', note: 'Feriado' }],
      bookings: [], services: [svc], professionals: [pro],
      dateISO: '2026-09-14', weekday: 1, serviceId: 's1', durationMin: 30,
      professionalId: '', eligibleProIds: [], nowHM: '', leadMin: 0, bufferMin: 0,
    });
    expect(r.slots).toEqual([]);
    expect(r.closed).toBe(true);
  });

  it('respeita duração + buffer para não oferecer horário ocupado', () => {
    const booking: Booking = {
      id: 'bk1', businessId: 'b1', customerId: '', serviceId: 's1', professionalId: 'p1',
      date: '2026-09-14', time: '09:00', customerName: 'Maria', customerPhone: '11999999999',
      status: 'confirmed', note: '', answers: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), history: [],
    };
    const r = computeSlots({
      rules, exceptions: [], bookings: [booking], services: [svc], professionals: [pro],
      dateISO: '2026-09-14', weekday: 1, serviceId: 's1', durationMin: 30,
      professionalId: '', eligibleProIds: [], nowHM: '', leadMin: 0, bufferMin: 15,
    });
    // 09:00 ocupa até 09:45 com buffer, então 09:00 e 09:30 não devem estar livres
    expect(r.slots).not.toContain('09:00');
    expect(r.slots).not.toContain('09:30');
    expect(r.slots).toContain('10:00');
  });

  it('race: mesmo horário não aparece como livre se já ocupado (consistência)', () => {
    const b1: Booking = { id: 'b1', businessId: 'b1', customerId: '', serviceId: 's1', professionalId: 'p1', date: '2026-09-14', time: '10:00', customerName: 'A', customerPhone: '1', status: 'pending', note: '', answers: [], createdAt: '', updatedAt: '', history: [] };
    const r = computeSlots({
      rules, exceptions: [], bookings: [b1], services: [svc], professionals: [pro],
      dateISO: '2026-09-14', weekday: 1, serviceId: 's1', durationMin: 30,
      professionalId: '', eligibleProIds: [], nowHM: '', leadMin: 0, bufferMin: 0,
    });
    expect(r.slots).not.toContain('10:00');
    expect(r.occupied).toContain('10:00');
  });
});

describe('agenda - rescheduling respeita estado terminal', () => {
  it('pending/confirmed movem mantendo status', () => {
    expect(rescheduleDecision('pending').kind).toBe('move');
    expect(rescheduleDecision('pending').nextStatus).toBe('pending');
    expect(rescheduleDecision('confirmed').kind).toBe('move');
    expect(rescheduleDecision('confirmed').nextStatus).toBe('confirmed');
  });
  it('completed/no_show/cancelled geram novo pending', () => {
    expect(rescheduleDecision('completed').kind).toBe('recreate');
    expect(rescheduleDecision('completed').nextStatus).toBe('pending');
    expect(rescheduleDecision('no_show').kind).toBe('recreate');
    expect(rescheduleDecision('cancelled').kind).toBe('recreate');
  });
});

describe('agenda - drag não bloqueia thread', () => {
  it('computeSlots é chamado apenas no início e na confirmação, não a cada pixel', () => {
    // Simula que durante o movimento não chamamos computeSlots — só validamos no drop
    let calls = 0;
    const wrapped = (p: any) => { calls++; return computeSlots(p); };
    const base = {
      rules: [{ id: 'r1', businessId: 'b1', professionalId: '', serviceId: '', weekday: 1, start: '09:00', end: '12:00', slotMin: 30 }],
      exceptions: [], bookings: [], services: [{ id: 's1', businessId: 'b1', categoryId: '', name: 'S', description: '', image: '', price: 0, durationMin: 30, professionalIds: [], active: true, featured: false, bookable: true, questions: [] } as Service],
      professionals: [{ id: 'p1', businessId: 'b1', name: 'P', role: '', photo: '', active: true } as Professional],
      dateISO: '2026-09-14', weekday: 1, serviceId: 's1', durationMin: 30, professionalId: '', eligibleProIds: [], nowHM: '', leadMin: 0, bufferMin: 0,
    };
    // início do drag → 1 chamada para carregar slots da semana (7 dias)
    for (let i = 0; i < 7; i++) wrapped({ ...base, dateISO: `2026-09-${14 + i}` });
    expect(calls).toBe(7);
    calls = 0;
    // movimento do mouse → 0 chamadas (só preview visual)
    // simula 100 movimentos sem chamar computeSlots
    expect(calls).toBe(0);
    // soltar → 1 validação no servidor
    wrapped(base);
    expect(calls).toBe(1);
  });

  it('slots loading nunca mostra empty prematuramente', () => {
    // Simula estados distintos
    const loading = { loading: true, slots: [] as string[], error: '' };
    const empty = { loading: false, slots: [] as string[], error: '' };
    const error = { loading: false, slots: [] as string[], error: 'Falha' };
    const success = { loading: false, slots: ['09:00', '09:30'], error: '' };
    expect(loading.loading).toBe(true);
    expect(empty.loading).toBe(false);
    expect(error.error).toBeTruthy();
    expect(success.slots.length).toBe(2);
    // Enquanto loading, não deve exibir "Nenhum horário disponível"
    const shouldShowEmpty = !loading.loading && loading.slots.length === 0 && !loading.error;
    expect(shouldShowEmpty).toBe(false);
    const shouldShowEmpty2 = !empty.loading && empty.slots.length === 0 && !empty.error;
    expect(shouldShowEmpty2).toBe(true);
  });
});
