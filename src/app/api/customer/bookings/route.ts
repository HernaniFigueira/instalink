import { NextRequest, NextResponse } from 'next/server';
import { customerFromRequest } from '@/lib/customer-auth';
import { readDB, updateDB } from '@/lib/db';
import { relationalActive } from '@/lib/relational/config';
import { rowToBooking, rowToService } from '@/lib/relational/mapping';
import { rowToBusiness } from '@/lib/relational/business-row';
import { bookingOpSpec, runRelationalWrite } from '@/lib/relational/slice';
import { isFeatureEnabled } from '@/lib/features';
import { onlyDigits, timeToMin } from '@/lib/utils';
import { todayISO, nowHM, weekdayOf, addDaysISO, effectiveTimezone, isValidDateISO } from '@/lib/tz';
import { computeSlots } from '@/lib/slots';
import { applyBookingStatusTx } from '@/lib/booking-status';
import { effectiveHorizonDays } from '@/lib/booking-ops';
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
  const myPhone = onlyDigits(customer.phone);
  // MODO RELACIONAL: agendamentos DO PRÓPRIO consumidor direto do SQL.
  if (relationalActive()) {
    const { getPool } = await import('@/lib/relational/pool');
    const pool = getPool();
    const bizRes = await pool.query('SELECT * FROM app.businesses WHERE id = $1', [businessId]);
    if (!bizRes.rows[0]) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    const business = rowToBusiness(bizRes.rows[0]);
    if (!isFeatureEnabled(business, 'bookings')) {
      return NextResponse.json({ bookings: [], cancelUntilMin: 0, moduleOff: true });
    }
    const mine = await pool.query(
      `SELECT * FROM app.bookings
        WHERE business_id = $1 AND (customer_id = $2 OR (regexp_replace(customer_phone, '\D', '', 'g') = $3 AND $3 <> ''))
        ORDER BY date DESC, time DESC LIMIT 500`,
      [businessId, customer.id, myPhone],
    );
    const svcIds = [...new Set(mine.rows.map((r: any) => String(r.service_id)))];
    const proIds = [...new Set(mine.rows.map((r: any) => String(r.professional_id)).filter(Boolean))];
    const services = svcIds.length ? (await pool.query('SELECT id, name, duration_min FROM app.services WHERE id = ANY($1)', [svcIds])).rows : [];
    const pros = proIds.length ? (await pool.query('SELECT id, name FROM app.professionals WHERE id = ANY($1)', [proIds])).rows : [];
    const svcOf = new Map(services.map((x: any) => [String(x.id), x]));
    const proOf = new Map(pros.map((x: any) => [String(x.id), x]));
    const bookings = mine.rows.map((r: any) => ({
      id: String(r.id), serviceId: String(r.service_id), date: String(r.date).slice(0, 10),
      time: String(r.time || '').slice(0, 5), status: String(r.status),
      service: svcOf.get(String(r.service_id))?.name || 'Serviço',
      durationMin: svcOf.get(String(r.service_id))?.duration_min || 30,
      professional: proOf.get(String(r.professional_id))?.name || '',
    }));
    return NextResponse.json({ bookings, cancelUntilMin: business.booking?.cancelUntilMin ?? 120 });
  }
  const db = await readDB();
  const business = db.businesses.find((b) => b.id === businessId);
  if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
  // Módulo de agendamentos desligado: nada de agenda para o cliente.
  if (!isFeatureEnabled(business, 'bookings')) {
    return NextResponse.json({ bookings: [], cancelUntilMin: 0, moduleOff: true });
  }
  const bookings = db.bookings
    .filter((b) =>
      b.businessId === businessId &&
      (b.customerId === customer.id || (myPhone && onlyDigits(b.customerPhone) === myPhone)),
    )
    .reverse()
    .map((b) => {
      const service = db.services.find((s) => s.id === b.serviceId);
      return {
        id: b.id, serviceId: b.serviceId, date: b.date, time: b.time, status: b.status,
        service: service?.name || 'Serviço',
        durationMin: service?.durationMin || 30,
        professional: db.professionals.find((p) => p.id === b.professionalId)?.name || '',
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

    // Fonte de dados ÚNICA por request: relacional (SQL) OU documento —
    // nunca os dois (sem leitura mista).
    let booking: any;
    let business: any;
    let service: any;
    if (relationalActive()) {
      const { getPool } = await import('@/lib/relational/pool');
      const pool = getPool();
      const bRes = await pool.query('SELECT * FROM app.bookings WHERE id = $1', [id]);
      booking = bRes.rows[0] ? rowToBooking(bRes.rows[0]) : undefined;
      if (!booking) return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 });
      const bizRes = await pool.query('SELECT * FROM app.businesses WHERE id = $1', [booking.businessId]);
      business = bizRes.rows[0] ? rowToBusiness(bizRes.rows[0]) : undefined;
      const svcRes = await pool.query(
        'SELECT * FROM app.services WHERE id = $1 AND business_id = $2',
        [serviceId || booking.serviceId, booking.businessId],
      );
      service = svcRes.rows[0] ? rowToService(svcRes.rows[0]) : undefined;
    } else {
      const db = await readDB();
      booking = db.bookings.find((b) => b.id === id);
      if (!booking) return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 });
      business = db.businesses.find((b) => b.id === booking.businessId);
    }
    if (!mine(booking, customer)) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    if (!['pending', 'confirmed'].includes(booking.status)) {
      return NextResponse.json({ error: 'Este agendamento não pode mais ser alterado.' }, { status: 400 });
    }
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    if (!isFeatureEnabled(business, 'bookings')) {
      return NextResponse.json({ error: 'Este negócio não está com a agenda aberta no momento.' }, { status: 403 });
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
      if (!service) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 400 });
      const svc = service;

      /** Mutação PURA (DOIS motores): valida slot IGNORANDO a própria reserva e move. */
      const customerRescheduleTx = (d: DB): { professionalId: string; professionalName: string } => {
        const target = d.bookings.find((x) => x.id === id);
        if (!target || !['pending', 'confirmed'].includes(target.status)) {
          throw err('Este agendamento não pode mais ser alterado.', 400);
        }
        // Valida o novo slot IGNORANDO a própria reserva (troca, não soma).
        // O servidor re-atribui o profissional (cliente nunca escolhe).
        const others = d.bookings.filter((b) => b.businessId === business!.id && b.id !== id);
        const r = computeSlots({
          rules: d.availability.filter((a) => a.businessId === business!.id),
          exceptions: d.exceptions.filter((e) => e.businessId === business!.id),
          bookings: others,
          services: d.services.filter((sv) => sv.businessId === business!.id),
          professionals: d.professionals.filter((pr) => pr.businessId === business!.id),
          dateISO: date, weekday: weekdayOf(date),
          serviceId: svc.id, durationMin: svc.durationMin,
          professionalId: '',
          eligibleProIds: svc.professionalIds || [],
          nowHM: date === today ? nowHM(new Date(), btz) : '',
          leadMin: cfg?.leadMin || 0,
          bufferMin: cfg?.bufferMin || 0,
        });
        if (!r.slots.includes(time)) throw err('Este horário acabou de ser ocupado. Escolha outro.', 409);
        const finalPro = r.assign[time] || '';
        const now = new Date().toISOString();
        const fromDate = target.date;
        const fromTime = target.time;
        target.serviceId = svc.id;
        target.professionalId = finalPro;
        target.date = date;
        target.time = time;
        if (note !== undefined) target.note = String(note || '').slice(0, 300);
        if (answers !== undefined) target.answers = (Array.isArray(answers) ? answers : []).map((x: any) => String(x || '').trim().slice(0, 300)).slice(0, 3);
        target.updatedAt = now;
        target.history.push({ at: now, from: target.status, to: target.status, by: 'customer', note: `Reagendado de ${fromDate.slice(8, 10)}/${fromDate.slice(5, 7)} ${fromTime} para ${date.slice(8, 10)}/${date.slice(5, 7)} ${time}` });
        // A2-B3 (F7.2): nota da esteira acompanha a remarcação do cliente.
        noteLeadReschedule(d, {
          businessId: business!.id, leadId: target.leadId,
          from: { date: fromDate, time: fromTime }, to: { date, time },
          by: 'customer', now,
        });
        const proName = finalPro ? d.professionals.find((pp) => pp.id === finalPro)?.name || '' : '';
        return { professionalId: finalPro, professionalName: proName };
      };

      if (relationalActive()) {
        // SQL: alvo + janela do novo dia + catálogo + identidades (esteira).
        const result = await runRelationalWrite(business.id, customerRescheduleTx, {
          load: bookingOpSpec({
            bookingIds: [id], dateFrom: date, dateTo: date,
            phones: [onlyDigits(booking.customerPhone)], customerId: booking.customerId || '',
          }),
        });
        return NextResponse.json({ ok: true, ...result });
      }
      // Doc: serviço a partir do documento (pré-leitura única do request).
      const svcDoc = (await readDB()).services.find((sv) => sv.id === (serviceId || booking.serviceId) && sv.businessId === business!.id && sv.bookable && sv.active);
      if (!svcDoc) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 400 });
      const result = await updateDB((d: DB) => {
        // mesmas regras com o serviço do documento
        const target = d.bookings.find((x) => x.id === id);
        if (!target || !['pending', 'confirmed'].includes(target.status)) {
          throw err('Este agendamento não pode mais ser alterado.', 400);
        }
        const others = d.bookings.filter((b) => b.businessId === business!.id && b.id !== id);
        const r = computeSlots({
          rules: d.availability.filter((a) => a.businessId === business!.id),
          exceptions: d.exceptions.filter((e) => e.businessId === business!.id),
          bookings: others,
          services: d.services.filter((sv) => sv.businessId === business!.id),
          professionals: d.professionals.filter((pr) => pr.businessId === business!.id),
          dateISO: date, weekday: weekdayOf(date),
          serviceId: svcDoc.id, durationMin: svcDoc.durationMin,
          professionalId: '',
          eligibleProIds: svcDoc.professionalIds || [],
          nowHM: date === today ? nowHM(new Date(), btz) : '',
          leadMin: cfg?.leadMin || 0,
          bufferMin: cfg?.bufferMin || 0,
        });
        if (!r.slots.includes(time)) throw err('Este horário acabou de ser ocupado. Escolha outro.', 409);
        const finalPro = r.assign[time] || '';
        const now = new Date().toISOString();
        const fromDate = target.date;
        const fromTime = target.time;
        target.serviceId = svcDoc.id;
        target.professionalId = finalPro;
        target.date = date;
        target.time = time;
        if (note !== undefined) target.note = String(note || '').slice(0, 300);
        if (answers !== undefined) target.answers = (Array.isArray(answers) ? answers : []).map((x: any) => String(x || '').trim().slice(0, 300)).slice(0, 3);
        target.updatedAt = now;
        target.history.push({ at: now, from: target.status, to: target.status, by: 'customer', note: `Reagendado de ${fromDate.slice(8, 10)}/${fromDate.slice(5, 7)} ${fromTime} para ${date.slice(8, 10)}/${date.slice(5, 7)} ${time}` });
        noteLeadReschedule(d, {
          businessId: business!.id, leadId: target.leadId,
          from: { date: fromDate, time: fromTime }, to: { date, time },
          by: 'customer', now,
        });
        const proName = finalPro ? d.professionals.find((pp) => pp.id === finalPro)?.name || '' : '';
        return { professionalId: finalPro, professionalName: proName };
      });
      return NextResponse.json({ ok: true, ...result });
    }

    // ── Cancelamento ──
    // P4: mesma função oficial do painel (histórico + máquina de estados +
    // mensagens do P3 + gatilho de automação) — nenhum caminho paralelo.
    const cancelTx = (d: DB) => applyBookingStatusTx(d, {
      businessId: business.id,
      bookingId: String(id || ''),
      to: 'cancelled',
      by: 'customer',
    });
    let applied: any;
    if (relationalActive()) {
      applied = await runRelationalWrite(business.id, cancelTx, {
        load: bookingOpSpec({
          bookingIds: [id],
          phones: [onlyDigits(booking.customerPhone)],
          customerId: booking.customerId || '',
        }),
      });
    } else {
      applied = await updateDB(cancelTx);
    }
    if (!applied.ok) return NextResponse.json({ error: applied.error || 'Não foi possível cancelar.' }, { status: applied.status_code || 400 });
    return NextResponse.json({ ok: true, status: applied.status });
  } catch (e: any) {
    const status = e?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível concluir.' : e.message }, { status });
  }
}
