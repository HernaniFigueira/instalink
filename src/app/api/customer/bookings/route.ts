import { NextRequest, NextResponse } from 'next/server';
import { customerFromRequest } from '@/lib/customer-auth';
import { readDB, updateDB } from '@/lib/db';
import { isFeatureEnabled } from '@/lib/features';
import { onlyDigits, timeToMin } from '@/lib/utils';
import { todayISO, nowHM, weekdayOf, addDaysISO, effectiveTimezone, isValidDateISO } from '@/lib/tz';
import { computeSlots } from '@/lib/slots';
import { eligibleProfessionalIds, slotEligibleProfessionalIds } from '@/lib/booking';
import { applyBookingStatusTx } from '@/lib/booking-status';
import { bookingWorkflowState } from '@/lib/appointment-workflow-tx';
import { bookingDurationOf, effectiveHorizonDays } from '@/lib/booking-ops';
import { applyBookingWindow, buildBookingWindow, type BookingWindow } from '@/lib/booking-temporal';
import { noteLeadReschedule } from '@/lib/pipeline';
import type { DB } from '@/lib/types';

function err(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

// GET ?businessId= — agendamentos do consumidor naquele negócio.
export async function GET(req: NextRequest) {
  const customer = await customerFromRequest(req);
  if (!customer) return NextResponse.json({ error: 'Entre para ver seus agendamentos.' }, { status: 401 });
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const db = await readDB();
  const business = db.businesses.find((b) => b.id === businessId);
  if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
  // Módulo de agendamentos desligado: nada de agenda para o cliente.
  if (!isFeatureEnabled(business, 'bookings')) {
    return NextResponse.json({ bookings: [], cancelUntilMin: 0, moduleOff: true });
  }
  const myPhone = onlyDigits(customer.phone);
  const bookings = db.bookings
    .filter((b) =>
      b.businessId === businessId &&
      (b.customerId === customer.id || (myPhone && onlyDigits(b.customerPhone) === myPhone)),
    )
    .reverse()
    .map((b) => {
      const service = db.services.find((s) => s.id === b.serviceId);
      // Compatibilidade: date/time/status como sempre; os campos canônicos da
      // Agenda Temporal 2.0 são ADITIVOS (o consumidor antigo não é obrigado a
      // conhecê-los) e a duração vem do snapshot do Booking, não do serviço.
      return {
        id: b.id, serviceId: b.serviceId, date: b.date, time: b.time, status: b.status,
        service: service?.name || 'Serviço',
        durationMin: bookingDurationOf(b, service),
        professional: db.professionals.find((p) => p.id === b.professionalId)?.name || '',
        startAt: b.startAt || '', endAt: b.endAt || '', timeZone: b.timeZone || '',
      };
    });
  return NextResponse.json({ bookings, cancelUntilMin: business.booking?.cancelUntilMin ?? 120 });
}

function mine(booking: { customerId: string; customerPhone: string }, customer: { id: string; phone: string }): boolean {
  return booking.customerId === customer.id ||
    (!!customer.phone && onlyDigits(booking.customerPhone) === onlyDigits(customer.phone));
}

// PATCH { id } — cancela | { id, date, time, ... } — remarca (troca atômica:
// o horário antigo só é liberado quando o novo é confirmado).
export async function PATCH(req: NextRequest) {
  try {
    const customer = await customerFromRequest(req);
    if (!customer) return NextResponse.json({ error: 'Entre para gerenciar.' }, { status: 401 });
    const { id, date, time, serviceId, note, answers } = await req.json();
    const db = await readDB();
    const booking = db.bookings.find((b) => b.id === id);
    if (!booking) return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 });
    if (!mine(booking, customer)) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return NextResponse.json({ error: 'Este agendamento não pode mais ser alterado.' }, { status: 400 });
    }
    const business = db.businesses.find((b) => b.id === booking.businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    if (!isFeatureEnabled(business, 'bookings')) {
      return NextResponse.json({ error: 'Este negócio não está com a agenda aberta no momento.' }, { status: 403 });
    }
    // Workflow: quem já chegou (ou está sendo atendido) fala com a recepção —
    // o cliente não cancela nem remarca por fora do fluxo do atendimento.
    if (['arrived', 'in_care'].includes(bookingWorkflowState(db, business.id, booking))) {
      return NextResponse.json({ error: 'Sua chegada já foi registrada. Fale com a recepção para qualquer alteração.' }, { status: 409 });
    }
    const cfg = business.booking;
    // A2-B5 (F9): regras de prazo/cancelamento no FUSO DO NEGÓCIO.
    const btz = effectiveTimezone(business.businessTimezone);
    const today = todayISO(new Date(), btz);
    if (booking.date < today) {
      return NextResponse.json({ error: 'Este horário já passou.' }, { status: 400 });
    }
    if (booking.date === today) {
      const until = cfg?.cancelUntilMin ?? 120;
      const diff = timeToMin(booking.time) - timeToMin(nowHM(new Date(), btz));
      if (diff < until) {
        return NextResponse.json({ error: `Alterações até ${until} min antes do horário. Fale com o negócio.` }, { status: 400 });
      }
    }

    // ── Remarcação ──
    if (date && time) {
      if (!isValidDateISO(date) || !/^\d{2}:\d{2}$/.test(time)) {
        return NextResponse.json({ error: 'Escolha data e horário.' }, { status: 400 });
      }
      const maxDate = addDaysISO(today, effectiveHorizonDays(cfg));
      if (date < today) return NextResponse.json({ error: 'Não é possível remarcar para o passado.' }, { status: 400 });
      if (date > maxDate) return NextResponse.json({ error: 'Data fora da agenda disponível.' }, { status: 400 });
      const service = db.services.find((s) => s.id === (serviceId || booking.serviceId) && s.businessId === business.id && s.bookable && s.active);
      if (!service) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 400 });

      const result = await updateDB((d: DB) => {
        const target = d.bookings.find((x) => x.id === id);
        if (!target || !['pending', 'confirmed'].includes(target.status)) {
          throw err('Este agendamento não pode mais ser alterado.', 400);
        }
        if (['arrived', 'in_care'].includes(bookingWorkflowState(d, business.id, target))) {
          throw err('Sua chegada já foi registrada. Fale com a recepção para qualquer alteração.', 409);
        }
        // Valida o novo slot IGNORANDO a própria reserva (troca, não soma).
        // O servidor re-atribui o profissional (cliente nunca escolhe).
        const others = d.bookings.filter((b) => b.businessId === business.id && b.id !== id);
        const r = computeSlots({
          rules: d.availability.filter((a) => a.businessId === business.id),
          exceptions: d.exceptions.filter((e) => e.businessId === business.id),
          bookings: others,
          services: d.services.filter((s) => s.businessId === business.id),
          professionals: d.professionals.filter((p) => p.businessId === business.id),
          dateISO: date, weekday: weekdayOf(date),
          serviceId: service.id, durationMin: service.durationMin,
          professionalId: '',
          eligibleProIds: slotEligibleProfessionalIds(service as any, d.professionals.filter((p) => p.businessId === business.id)),
          nowHM: date === today ? nowHM(new Date(), btz) : '',
          leadMin: cfg?.leadMin || 0,
          bufferMin: cfg?.bufferMin || 0,
          timeZone: btz,
        });
        if (!r.slots.includes(time)) throw err('Este horário acabou de ser ocupado. Escolha outro.', 409);
        const finalPro = r.assign[time] || '';
        // Agenda Temporal 2.0 (B1): a remarcação do cliente também nasce como
        // janela canônica (instantes + snapshot + fuso da clínica).
        let rescheduleWindow: BookingWindow;
        try {
          rescheduleWindow = buildBookingWindow({ date, time, durationMin: service.durationMin, timeZone: btz });
        } catch (e: any) {
          throw err(e?.message || 'Horário inválido para o fuso da clínica.', 400);
        }
        const now = new Date().toISOString();
        const fromDate = target.date;
        const fromTime = target.time;
        target.serviceId = service.id;
        target.professionalId = finalPro;
        applyBookingWindow(target, rescheduleWindow, btz);
        if (note !== undefined) target.note = String(note || '').slice(0, 300);
        if (answers !== undefined) target.answers = (Array.isArray(answers) ? answers : []).map((x: any) => String(x || '').trim().slice(0, 300)).slice(0, 3);
        target.updatedAt = now;
        target.history.push({ at: now, from: target.status, to: target.status, by: 'customer', note: `Reagendado de ${fromDate.slice(8, 10)}/${fromDate.slice(5, 7)} ${fromTime} para ${date.slice(8, 10)}/${date.slice(5, 7)} ${time}` });
        // A2-B3 (F7.2): nota da esteira acompanha a remarcação do cliente.
        noteLeadReschedule(d, {
          businessId: business.id, leadId: target.leadId,
          from: { date: fromDate, time: fromTime }, to: { date, time },
          by: 'customer', now,
        });
        const proName = finalPro ? d.professionals.find((p) => p.id === finalPro)?.name || '' : '';
        return { professionalId: finalPro, professionalName: proName };
      });
      return NextResponse.json({ ok: true, ...result });
    }

    // ── Cancelamento ──
    // P4: mesma função oficial do painel (histórico + máquina de estados +
    // mensagens do P3 + gatilho de automação) — nenhum caminho paralelo.
    const applied = await updateDB((d) => applyBookingStatusTx(d, {
      businessId: business.id,
      bookingId: String(id || ''),
      to: 'cancelled',
      by: 'customer',
    }));
    if (!applied.ok) return NextResponse.json({ error: applied.error || 'Não foi possível cancelar.' }, { status: applied.status_code || 400 });
    return NextResponse.json({ ok: true, status: applied.status });
  } catch (e: any) {
    const status = e?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível concluir.' : e.message }, { status });
  }
}
