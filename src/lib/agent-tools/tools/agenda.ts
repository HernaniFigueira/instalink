// F3-D — tools de AGENDA (domínio oficial: slots, create, reschedule, cancel)
import type { ToolDef } from '../types';
import { createBookingTx } from '../../booking-create';
import { applyBookingStatusTx } from '../../booking-status';
import { computeSlots } from '../../slots';
import { weekdayOf, todayISO } from '../../tz';
import { onlyDigits } from '../../utils';
import { pushAudit } from '../../audit';

function requireBiz(ctx: any) {
  const b = ctx.db.businesses.find((x: any) => x.id === ctx.businessId);
  if (!b) throw Object.assign(new Error('Unidade não encontrada.'), { status: 404 });
  return b;
}

function bookingOf(ctx: any, bookingId: string) {
  return (ctx.db.bookings || []).find(
    (b: any) => b.id === bookingId && b.businessId === ctx.businessId,
  ) || null;
}

export const findAvailableSlots: ToolDef<{ date: string; serviceId: string; professionalId?: string }, {
  date: string; slots: string[]; closed: boolean; closedReason?: string;
}> = {
  name: 'findAvailableSlots',
  description: 'Horários livres na agenda para data/serviço.',
  domain: 'agenda',
  sideEffect: 'read',
  requiresPermission: null,
  requiresConfirm: false,
  inputSchema: [
    { name: 'date', type: 'string', required: true, max: 10 },
    { name: 'serviceId', type: 'string', required: true, max: 64 },
    { name: 'professionalId', type: 'string', required: false, max: 64 },
  ],
  outputSchema: 'any',
  handler: (input, ctx) => {
    requireBiz(ctx);
    const service = (ctx.db.services || []).find(
      (s: any) => s.id === input.serviceId && s.businessId === ctx.businessId,
    );
    if (!service) throw Object.assign(new Error('Serviço não encontrado.'), { status: 404 });
    const rules = (ctx.db.availability || []).filter((a: any) => a.businessId === ctx.businessId);
    const exceptions = (ctx.db.exceptions || []).filter((e: any) => e.businessId === ctx.businessId);
    const bookings = (ctx.db.bookings || []).filter((b: any) => b.businessId === ctx.businessId);
    const professionals = (ctx.db.professionals || []).filter((p: any) => p.businessId === ctx.businessId);
    const business = requireBiz(ctx);
    const now = ctx.now ? new Date(ctx.now) : new Date();
    const today = todayISO(now, business.businessTimezone);
    const result = computeSlots({
      rules, exceptions, bookings,
      services: [service], professionals,
      dateISO: input.date,
      weekday: weekdayOf(input.date),
      serviceId: service.id,
      durationMin: service.durationMin,
      professionalId: String(input.professionalId || ''),
      eligibleProIds: service.professionalIds || [],
      nowHM: input.date === today ? now.toTimeString().slice(0, 5) : '',
      leadMin: business.booking?.leadMin || 0,
      bufferMin: business.booking?.bufferMin || 0,
    });
    return {
      date: input.date,
      slots: result.slots,
      closed: result.closed,
      closedReason: result.closedReason,
    };
  },
};

export const getBooking: ToolDef<{ bookingId: string }, {
  id: string; date: string; time: string; status: string; customerName: string; serviceName: string; petId: string;
} | null> = {
  name: 'getBooking',
  description: 'Detalhe de um agendamento da unidade da sessão.',
  domain: 'agenda',
  sideEffect: 'read',
  requiresPermission: null,
  requiresConfirm: false,
  inputSchema: [{ name: 'bookingId', type: 'string', required: true, max: 64 }],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const b = bookingOf(ctx, input.bookingId);
    if (!b) return null;
    const service = (ctx.db.services || []).find((s: any) => s.id === b.serviceId);
    return {
      id: b.id,
      date: b.date,
      time: b.time,
      status: b.status,
      customerName: b.customerName,
      serviceName: service?.name || '',
      petId: b.petId || '',
    };
  },
};

export const createBooking: ToolDef<{
  serviceId: string; date: string; time: string;
  customerName: string; customerPhone: string;
  professionalId?: string; petId?: string; note?: string;
}, { bookingId: string; status: string; petId: string }> = {
  name: 'createBooking',
  description: 'Cria agendamento (importante — exige confirmação na conversa).',
  domain: 'agenda',
  sideEffect: 'destructive',
  requiresPermission: 'agenda',
  requiresConfirm: true,
  inputSchema: [
    { name: 'serviceId', type: 'string', required: true, max: 64 },
    { name: 'date', type: 'string', required: true, max: 10 },
    { name: 'time', type: 'string', required: true, max: 5 },
    { name: 'customerName', type: 'string', required: true, max: 80 },
    { name: 'customerPhone', type: 'string', required: true, max: 20 },
    { name: 'professionalId', type: 'string', required: false, max: 64 },
    { name: 'petId', type: 'string', required: false, max: 64 },
    { name: 'note', type: 'string', required: false, max: 300 },
  ],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const business = requireBiz(ctx);
    const service = (ctx.db.services || []).find(
      (s: any) => s.id === input.serviceId && s.businessId === ctx.businessId,
    );
    if (!service) throw Object.assign(new Error('Serviço não encontrado.'), { status: 404 });

    // Pet: só aceita se pertencer a esta unidade (veterinária).
    let petId = String(input.petId || '');
    if (petId) {
      const pet = (ctx.db.pets || []).find((p: any) => p.id === petId && p.businessId === ctx.businessId);
      if (!pet) throw Object.assign(new Error('Pet não encontrado nesta unidade.'), { status: 404 });
    } else {
      petId = '';
    }

    const out = createBookingTx(ctx.db, {
      business,
      service,
      date: input.date,
      time: input.time,
      actor: 'owner',
      customer: {
        id: '',
        name: input.customerName,
        phone: onlyDigits(input.customerPhone),
      },
      professionalId: String(input.professionalId || '') || undefined,
      note: String(input.note || ''),
      source: 'agent',
      now: ctx.now,
      petId: petId || undefined,
    });
    return { bookingId: out.bookingId, status: out.status, petId };
  },
};

export const cancelBooking: ToolDef<{ bookingId: string; reason?: string }, { bookingId: string; status: string }> = {
  name: 'cancelBooking',
  description: 'Cancela agendamento (importante — exige confirmação).',
  domain: 'agenda',
  sideEffect: 'destructive',
  requiresPermission: 'agenda',
  requiresConfirm: true,
  inputSchema: [
    { name: 'bookingId', type: 'string', required: true, max: 64 },
    { name: 'reason', type: 'string', required: false, max: 200 },
  ],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const existing = bookingOf(ctx, input.bookingId);
    if (!existing) throw Object.assign(new Error('Agendamento não encontrado.'), { status: 404 });
    const res = applyBookingStatusTx(ctx.db, {
      businessId: ctx.businessId,
      bookingId: input.bookingId,
      to: 'cancelled',
      by: 'agent',
      note: String(input.reason || '').slice(0, 300) || 'Cancelado pelo assistente',
      now: ctx.now,
    });
    if (!res.ok) {
      throw Object.assign(new Error(res.error || 'Não foi possível cancelar.'), { status: res.status_code || 422 });
    }
    return { bookingId: input.bookingId, status: res.status || 'cancelled' };
  },
};

export const rescheduleBooking: ToolDef<{ bookingId: string; date: string; time: string }, {
  bookingId: string; date: string; time: string;
}> = {
  name: 'rescheduleBooking',
  description: 'Remarca agendamento (importante — exige confirmação).',
  domain: 'agenda',
  sideEffect: 'destructive',
  requiresPermission: 'agenda',
  requiresConfirm: true,
  inputSchema: [
    { name: 'bookingId', type: 'string', required: true, max: 64 },
    { name: 'date', type: 'string', required: true, max: 10 },
    { name: 'time', type: 'string', required: true, max: 5 },
  ],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const target = bookingOf(ctx, input.bookingId);
    if (!target) throw Object.assign(new Error('Agendamento não encontrado.'), { status: 404 });
    // Revalidação de estado antes de ação atrasada/importante.
    if (target.status === 'cancelled' || target.status === 'completed' || target.status === 'no_show') {
      throw Object.assign(
        new Error(`Agendamento em estado "${target.status}" não pode ser remarcado.`),
        { status: 422 },
      );
    }
    // Slot livre?
    const service = (ctx.db.services || []).find((s: any) => s.id === target.serviceId);
    const business = requireBiz(ctx);
    const rules = (ctx.db.availability || []).filter((a: any) => a.businessId === ctx.businessId);
    const exceptions = (ctx.db.exceptions || []).filter((e: any) => e.businessId === ctx.businessId);
    const bookings = (ctx.db.bookings || []).filter(
      (b: any) => b.businessId === ctx.businessId && b.id !== target.id,
    );
    const professionals = (ctx.db.professionals || []).filter((p: any) => p.businessId === ctx.businessId);
    const slots = computeSlots({
      rules, exceptions, bookings,
      services: service ? [service] : [],
      professionals,
      dateISO: input.date,
      weekday: weekdayOf(input.date),
      serviceId: target.serviceId,
      durationMin: service?.durationMin || 30,
      professionalId: target.professionalId || '',
      eligibleProIds: service?.professionalIds || [],
      nowHM: '',
      leadMin: 0,
      bufferMin: business.booking?.bufferMin || 0,
    });
    if (!slots.slots.includes(input.time)) {
      throw Object.assign(new Error('Horário indisponível para remarcação.'), { status: 409 });
    }
    const now = ctx.now || new Date().toISOString();
    const from = { date: target.date, time: target.time };
    target.date = input.date;
    target.time = input.time;
    target.updatedAt = now;
    if (!Array.isArray(target.history)) target.history = [];
    target.history.push({
      at: now,
      from: target.status,
      to: target.status,
      by: 'agent',
      note: `Remarcado de ${from.date} ${from.time} para ${input.date} ${input.time}`,
    });
    pushAudit(ctx.db, {
      action: 'booking.rescheduled',
      actor: { id: ctx.actor.userId, email: ctx.actor.email, role: ctx.actor.role },
      businessId: ctx.businessId,
      meta: { bookingId: target.id, kind: 'reschedule', from, to: { date: input.date, time: input.time } },
    }, now);
    return { bookingId: target.id, date: target.date, time: target.time };
  },
};

export const agendaTools = [
  findAvailableSlots, getBooking, createBooking, rescheduleBooking, cancelBooking,
];
