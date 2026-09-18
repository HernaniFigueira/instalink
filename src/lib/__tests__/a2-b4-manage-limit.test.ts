// ═══════════════════════════════════════════════════════════════
// A2-B4 (F6) — GET manage limpo: limite explícito, sem dupla leitura
// e lembretes nascendo na ESCRITA (nunca no GET).
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { effectiveManageLimit, MANAGE_LIST_DEFAULT_LIMIT, MANAGE_LIST_MAX_LIMIT } from '../booking-ops';
import { createBookingTx } from '../booking-create';
import { dueReminderBookings, enqueueDueReminders } from '../automations';
import { emptyDB } from '../db';
import { addDaysISO, nowHM, todayISO } from '../tz';
import { biz as fixtureBiz, FIXED_NOW, service as fixtureService } from './helpers/automation-fixtures';
import type { Availability, Professional, User } from '../types';

// ── Limite efetivo explícito ─────────────────────────────────────
describe('A2-B4 · effectiveManageLimit (limite do GET manage)', () => {
  it('sem parâmetro → default 200, sem corte', () => {
    expect(effectiveManageLimit(null)).toEqual({ limit: MANAGE_LIST_DEFAULT_LIMIT, capped: false, requested: null });
    expect(effectiveManageLimit(undefined)).toMatchObject({ limit: 200, capped: false });
    expect(effectiveManageLimit('')).toMatchObject({ limit: 200, capped: false });
    expect(effectiveManageLimit('abc')).toMatchObject({ limit: 200, capped: false });
  });
  it('valor dentro da faixa é respeitado (não capado)', () => {
    expect(effectiveManageLimit(1)).toEqual({ limit: 1, capped: false, requested: 1 });
    expect(effectiveManageLimit('200')).toEqual({ limit: 200, capped: false, requested: 200 });
    expect(effectiveManageLimit(500)).toEqual({ limit: MANAGE_LIST_MAX_LIMIT, capped: false, requested: 500 });
  });
  it('pediu 1000 → recebe 500 E a resposta declara o corte (nada silencioso)', () => {
    const r = effectiveManageLimit(1000);
    expect(r.limit).toBe(500);
    expect(r.capped).toBe(true);
    expect(r.requested).toBe(1000);
    expect(effectiveManageLimit('9999')).toMatchObject({ limit: 500, capped: true });
  });
});

// ── Lembretes nascem na ESCRITA (createBookingTx), não no GET ────
function baseDB() {
  const d = emptyDB();
  const b = fixtureBiz('b1', { published: true });
  d.businesses.push(b);
  d.services.push(fixtureService('s1', 'b1', { durationMin: 30, professionalIds: [] }));
  d.users.push({
    id: 'u1', businessId: 'b1', organizationId: b.organizationId || 'org-b1', email: 'demo@instalink.app',
    name: 'Demo', role: 'owner', active: true, permissions: {}, passwordHash: 'x', createdAt: FIXED_NOW,
  } as User);
  d.professionals.push({
    id: '', businessId: 'b1', name: 'Dono', role: '', active: true,
  } as Professional);
  d.availability.push({
    id: 'av1', businessId: 'b1', professionalId: '', serviceId: '',
    weekday: new Date(`${todayISO()}T12:00:00Z`).getUTCDay(), start: '00:00', end: '23:59', slotMin: 30,
  } as Availability);
  return d;
}

describe('A2-B4 · lembrete na escrita (createBookingTx)', () => {
  it('booking criado para HOJE enfileira o lembrete na mesma transação', () => {
    const d = baseDB();
    const today = todayISO();
    const nowHMv = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
    // horário bem no futuro de hoje para sobreviver ao corte do lead time
    const res = createBookingTx(d, {
      business: d.businesses[0],
      service: d.services[0],
      date: today, time: '23:00',
      actor: 'owner',
      customer: { id: '', name: 'Ana', phone: '11988887777' },
      now: `${today}T${nowHMv}:00.000Z`,
    });
    expect(res.bookingId).toBeTruthy();
    // o lembrete do agendamento de hoje entra na fila na ESCRITA
    const reminder = d.messages.find((m) => m.businessId === 'b1' && m.externalId === `auto:booking_reminder:${res.bookingId}`);
    expect(reminder).toBeTruthy();
    expect(reminder?.body).toContain('Ana');
  });

  it('idempotente: chamar enqueueDueReminders de novo NÃO duplica (chave por agendamento)', () => {
    const d = baseDB();
    const today = todayISO();
    const nowHMv = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
    const res = createBookingTx(d, {
      business: d.businesses[0],
      service: d.services[0],
      date: today, time: '23:00',
      actor: 'owner',
      customer: { id: '', name: 'Bruno', phone: '11977776666' },
      now: `${today}T${nowHMv}:00.000Z`,
    });
    const before = d.messages.filter((m) => m.externalId === `auto:booking_reminder:${res.bookingId}`).length;
    expect(before).toBe(1);
    enqueueDueReminders(d, 'b1', today);
    enqueueDueReminders(d, 'b1', today);
    const after = d.messages.filter((m) => m.externalId === `auto:booking_reminder:${res.bookingId}`).length;
    expect(after).toBe(1);
  });

  it('dueReminderBookings isola por tenant e janela (hoje/amanhã)', () => {
    const d = baseDB();
    d.businesses.push({ ...fixtureBiz('b2'), organizationId: 'org-b2' });
    const today = todayISO();
    const nowHMv = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
    // createBookingTx JÁ enfileira o lembrete do próprio agendamento —
    // logo, nada fica "due" para ele (idempotência ponta a ponta).
    createBookingTx(d, {
      business: d.businesses[0],
      service: d.services[0],
      date: today, time: '23:00',
      actor: 'owner',
      customer: { id: '', name: 'Carla', phone: '11966665555' },
      now: `${today}T${nowHMv}:00.000Z`,
    });
    expect(dueReminderBookings(d, 'b1', today).length).toBe(0);
    // agendamentos gravados diretamente (ex.: migração/import) ficam due:
    const mk = (id: string, businessId: string, date: string) => d.bookings.push({
      id, businessId, customerId: '', serviceId: 's1', professionalId: '',
      date, time: '10:00', customerName: 'X', customerPhone: '1190000000' + id.length,
      status: 'confirmed', note: '', answers: [], createdAt: '', updatedAt: '', history: [],
    });
    mk('bk-b1', 'b1', today);
    mk('bk-b2', 'b2', today);
    mk('bk-far', 'b1', addDaysISO(today, 5));
    expect(dueReminderBookings(d, 'b1', today).map((b) => b.id)).toEqual(['bk-b1']);
    expect(dueReminderBookings(d, 'b2', today).map((b) => b.id)).toEqual(['bk-b2']);
    // "amanhã" também é janela: bk de amanhã fica due quando consultado hoje
    mk('bk-amanha', 'b1', addDaysISO(today, 1));
    expect(dueReminderBookings(d, 'b1', today).map((b) => b.id)).toEqual(['bk-b1', 'bk-amanha']);
  });
});
