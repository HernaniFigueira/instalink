import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { customerFromRequest } from '@/lib/customer-auth';
import { computeSlots } from '@/lib/slots';
import { todayISO, nowHM, weekdayOf, addDaysISO, isValidDateISO } from '@/lib/tz';
import { onlyDigits } from '@/lib/utils';
import { BOOKING_FLOW, canTransition } from '@/lib/status';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import type { BookingStatus, DB } from '@/lib/types';

function err(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

// GET ?businessId=&serviceId=&professionalId=&date= — slots livres (público)
// GET ?businessId=&serviceId=&professionalId=&from=&to= — mapa de dias (público)
// GET ?businessId=&mode=manage — gestão (dono, paginado)
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const businessId = q.get('businessId') || '';
    const mode = q.get('mode');
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });

    if (mode === 'manage') {
      const user = await userFromRequest(req);
      if (!user || business.ownerId !== user.id) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
      const page = Math.max(1, Number(q.get('page')) || 1);
      const limit = Math.min(200, Math.max(1, Number(q.get('limit')) || 50));
      const all = db.bookings
        .filter((x) => x.businessId === businessId)
        .sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
      return NextResponse.json({
        bookings: all.slice((page - 1) * limit, page * limit),
        total: all.length, page, limit,
      });
    }

    const service = db.services.find((s) => s.id === q.get('serviceId') && s.businessId === businessId);
    if (!service) return NextResponse.json({ slots: [] });
    const cfg = business.booking;
    const today = todayISO();
    const maxDate = addDaysISO(today, Math.max(1, cfg.horizonDays || 60));
    const proId = q.get('professionalId') || '';

    const base = {
      rules: db.availability.filter((a) => a.businessId === businessId),
      exceptions: db.exceptions.filter((e) => e.businessId === businessId),
      bookings: db.bookings.filter((b) => b.businessId === businessId),
      services: db.services.filter((s) => s.businessId === businessId),
      professionals: db.professionals.filter((p) => p.businessId === businessId),
      serviceId: service.id,
      durationMin: service.durationMin,
      professionalId: proId,
      eligibleProIds: service.professionalIds || [],
      leadMin: cfg.leadMin || 0,
      bufferMin: cfg.bufferMin || 0,
    };

    // ?from=&to= — mapa de dias (fechado/livre) p/ a faixa
    const from = q.get('from') || '';
    const to = q.get('to') || '';
    if (isValidDateISO(from) && isValidDateISO(to)) {
      const days: Record<string, { closed: boolean; free: number }> = {};
      for (let iso = from; iso <= to && iso <= maxDate; iso = addDaysISO(iso, 1)) {
        if (iso < today) { days[iso] = { closed: true, free: 0 }; continue; }
        const r = computeSlots({
          ...base, dateISO: iso, weekday: weekdayOf(iso),
          nowHM: iso === today ? nowHM() : '',
        });
        days[iso] = { closed: r.slots.length === 0, free: r.slots.length };
      }
      return NextResponse.json({ days, today });
    }

    const date = q.get('date') || '';
    if (!isValidDateISO(date) || date < today || date > maxDate) {
      return NextResponse.json({ slots: [], closed: true });
    }
    const r = computeSlots({
      ...base, dateISO: date, weekday: weekdayOf(date),
      nowHM: date === today ? nowHM() : '',
    });
    const pros = Object.fromEntries(base.professionals.map((p) => [p.id, p.name]));
    return NextResponse.json({ slots: r.slots, occupied: r.occupied, closed: r.closed, assign: r.assign, pros, today });
  } catch {
    return NextResponse.json({ error: 'Não foi possível carregar os horários.' }, { status: 500 });
  }
}

// POST público: cria reserva (login obrigatório; validação atômica no servidor)
export async function POST(req: NextRequest) {
  const rl = rateLimit(`booking:${ipFrom(req)}`, 30, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Aguarde um instante.' }, { status: 429 });
  try {
    const body = await req.json();
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === body.businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });
    const customer = await customerFromRequest(req);
    if (!customer) return NextResponse.json({ error: 'Entre para agendar.', code: 'login_required' }, { status: 401 });
    const service = db.services.find((s) => s.id === body.serviceId && s.businessId === business.id && s.bookable && s.active);
    if (!service) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 400 });
    const name = (body.customerName || customer.name || '').trim();
    const phone = (body.customerPhone || customer.phone || '').trim();
    if (!name) return NextResponse.json({ error: 'Informe seu nome.' }, { status: 400 });
    if (onlyDigits(phone).length < 10) return NextResponse.json({ error: 'Informe um WhatsApp válido.' }, { status: 400 });
    const date = body.date || '';
    const time = body.time || '';
    if (!isValidDateISO(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return NextResponse.json({ error: 'Escolha data e horário.' }, { status: 400 });
    }

    const cfg = business.booking;
    const today = todayISO();
    const maxDate = addDaysISO(today, Math.max(1, cfg.horizonDays || 60));
    if (date < today) return NextResponse.json({ error: 'Não é possível agendar no passado.' }, { status: 400 });
    if (date > maxDate) return NextResponse.json({ error: 'Data fora da agenda disponível.' }, { status: 400 });

    const teamMode = cfg.teamMode || 'solo';
    let wantPro = String(body.professionalId || '');
    if (teamMode === 'solo') wantPro = '';
    const eligible = (service.professionalIds || []).filter((id) =>
      db.professionals.some((p) => p.id === id && p.businessId === business.id && p.active !== false),
    );
    const hasTeam = db.professionals.some((p) => p.businessId === business.id && p.active !== false);
    if (wantPro && hasTeam && (service.professionalIds || []).length > 0 && !eligible.includes(wantPro)) {
      return NextResponse.json({ error: 'Profissional indisponível para este serviço.' }, { status: 400 });
    }
    if (wantPro && hasTeam && !db.professionals.some((p) => p.id === wantPro && p.businessId === business.id)) {
      return NextResponse.json({ error: 'Profissional inválido.' }, { status: 400 });
    }

    // Checagem + escrita ATÔMICAS (dentro do updateDB, sobre leitura fresca).
    const result = await updateDB((d: DB) => {
      const fresh = d.bookings.filter((b) => b.businessId === business.id);
      const r = computeSlots({
        rules: d.availability.filter((a) => a.businessId === business.id),
        exceptions: d.exceptions.filter((e) => e.businessId === business.id),
        bookings: fresh,
        services: d.services.filter((s) => s.businessId === business.id),
        professionals: d.professionals.filter((p) => p.businessId === business.id),
        dateISO: date, weekday: weekdayOf(date),
        serviceId: service.id, durationMin: service.durationMin,
        professionalId: wantPro,
        eligibleProIds: service.professionalIds || [],
        nowHM: date === todayISO() ? nowHM() : '',
        leadMin: cfg.leadMin || 0,
        bufferMin: cfg.bufferMin || 0,
      });
      if (!r.slots.includes(time)) {
        throw err('Este horário acabou de ser ocupado. Escolha outro.', 409);
      }
      const finalPro = wantPro || r.assign[time] || '';
      const now = new Date().toISOString();
      const bookingId = randomUUID();
      d.bookings.push({
        id: bookingId, businessId: business.id, customerId: customer.id, serviceId: service.id,
        professionalId: finalPro, date, time,
        customerName: name, customerPhone: phone, status: 'pending',
        note: String(body.note || '').slice(0, 300), createdAt: now,
        answers: (Array.isArray(body.answers) ? body.answers : []).map((x: any) => String(x || '').trim().slice(0, 300)).slice(0, 3),
        updatedAt: now, history: [{ at: now, from: '', to: 'pending', by: 'customer' }],
      });
      d.events.push({ id: randomUUID(), businessId: business.id, type: 'booking_created', path: '', meta: { serviceId: service.id }, createdAt: now });
      d.events.push({ id: randomUUID(), businessId: business.id, type: 'conversion', path: '', meta: { kind: 'booking' }, createdAt: now });
      const digits = onlyDigits(phone);
      const lead = d.leads.find((l) =>
        l.businessId === business.id &&
        ((l.customerId && l.customerId === customer.id) || (digits && onlyDigits(l.phone) === digits)),
      );
      if (lead) {
        lead.name = name; lead.customerId = customer.id; lead.lastInteraction = now;
        lead.action = 'agendamento'; if (lead.status === 'new') lead.status = 'converted';
      } else {
        d.leads.push({ id: randomUUID(), businessId: business.id, customerId: customer.id, name, phone, email: '', instagram: '', origin: 'agendamento', interest: service.name, action: 'agendamento', status: 'converted', createdAt: now, lastInteraction: now });
      }
      const proName = finalPro
        ? d.professionals.find((p) => p.id === finalPro)?.name || ''
        : '';
      return { bookingId, professionalId: finalPro, professionalName: proName };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[bookings] POST falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível confirmar. Tente novamente.' : e.message }, { status });
  }
}

// PATCH (dono): transição de status com máquina de estados.
export async function PATCH(req: NextRequest) {
  try {
    const { businessId, id, status } = await req.json();
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    const db = await readDB();
    if (!db.businesses.some((b) => b.id === businessId && b.ownerId === user.id)) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }
    const current = db.bookings.find((x) => x.id === id && x.businessId === businessId);
    if (!current) return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 });
    const to = status as BookingStatus;
    if (!BOOKING_FLOW[current.status] || !canTransition(BOOKING_FLOW, current.status, to)) {
      return NextResponse.json({ error: `Não é possível mudar de "${current.status}" para "${status}".` }, { status: 422 });
    }
    await updateDB((d) => {
      const b = d.bookings.find((x) => x.id === id && x.businessId === businessId);
      if (!b) throw err('Agendamento não encontrado.', 404);
      const now = new Date().toISOString();
      b.history.push({ at: now, from: b.status, to, by: 'owner' });
      b.status = to;
      b.updatedAt = now;
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = e?.status || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível atualizar.' : e.message }, { status });
  }
}
