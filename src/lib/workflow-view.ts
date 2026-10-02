// Visão do workflow por agendamento para as RESPOSTAS de API: a interface
// mostra exatamente `allowed` (calculado aqui, no servidor, com papel e
// escopo reais) — nunca reimplementa a regra no navegador.
import type { AccessContext } from './access-core';
import { canAccessBooking } from './access-core';
import { workflowView, type WorkflowView } from './appointment-workflow';
import { bookingDurationOf, needsClosure } from './booking-ops';
import { effectiveTimezone, nowHM, todayISO } from './tz';
import type { Booking, DB } from './types';

type Ctx = Pick<AccessContext, 'permissions' | 'professionalScope'>;

export function workflowForBookings(
  db: DB, businessId: string, bookings: Booking[], ctx: Ctx, at = new Date(),
): Record<string, WorkflowView> {
  const business = db.businesses.find((b) => b.id === businessId);
  const tz = effectiveTimezone(business?.businessTimezone);
  const today = todayISO(at, tz);
  const hm = nowHM(at, tz);
  const svc = new Map(db.services.filter((s) => s.businessId === businessId).map((s) => [s.id, s]));
  const encByBooking = new Map<string, NonNullable<DB['encounters']>[number]>();
  for (const e of db.encounters || []) {
    if (e.businessId === businessId && e.bookingId && !encByBooking.has(e.bookingId)) encByBooking.set(e.bookingId, e);
  }
  const queueByBooking = new Map<string, NonNullable<DB['queue']>[number]>();
  for (const q of db.queue || []) {
    if (q.businessId === businessId && q.bookingId && (q.status === 'waiting' || q.status === 'called' || q.status === 'in_service')) {
      queueByBooking.set(q.bookingId, q);
    }
  }
  const out: Record<string, WorkflowView> = {};
  for (const b of bookings) {
    const mine = canAccessBooking(ctx, b);
    out[b.id] = workflowView(
      {
        booking: b, encounter: encByBooking.get(b.id) || null, queue: queueByBooking.get(b.id) || null,
        overdue: needsClosure(b, bookingDurationOf(b, svc.get(b.serviceId)), today, hm),
      },
      // Fora do escopo do profissional nenhuma ação é oferecida.
      { agenda: mine && !!ctx.permissions.agenda, atendimento: mine && !!ctx.permissions.atendimento },
    );
  }
  return out;
}

export function workflowForBooking(db: DB, businessId: string, booking: Booking, ctx: Ctx): WorkflowView {
  return workflowForBookings(db, businessId, [booking], ctx)[booking.id];
}
