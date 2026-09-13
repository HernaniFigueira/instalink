import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { userFromRequest } from '@/lib/auth';
import { customerFromRequest } from '@/lib/customer-auth';
import { computeSlots } from '@/lib/slots';
import { resolveProfessional, bookingMode } from '@/lib/booking';
import { upsertContact } from '@/lib/contacts';
import { todayISO, nowHM, weekdayOf, addDaysISO, isValidDateISO } from '@/lib/tz';
import { onlyDigits } from '@/lib/utils';
import { BOOKING_FLOW, canTransition } from '@/lib/status';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import type { BookingStatus, DB } from '@/lib/types';

function err(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

// GET ?businessId=&serviceId=&date= — slots livres (público, sem escolha de profissional)
// GET ?businessId=&serviceId=&from=&to= — mapa de dias (público)
// GET ?businessId=&mode=manage[&from=&to=&page=&limit=] — gestão (dono)
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
      const from = q.get('from') || '';
      const to = q.get('to') || '';
      let all = db.bookings.filter((x) => x.businessId === businessId);
      if (isValidDateISO(from) && isValidDateISO(to)) {
        all = all.filter((x) => x.date >= from && x.date <= to);
      }
      all = all.sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
      const page = Math.max(1, Number(q.get('page')) || 1);
      const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 200));
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

    // O cliente NUNCA escolhe profissional: a grade é sempre "qualquer
    // profissional elegível livre" (o motor resolve internamente).
    const base = {
      rules: db.availability.filter((a) => a.businessId === businessId),
      exceptions: db.exceptions.filter((e) => e.businessId === businessId),
      bookings: db.bookings.filter((b) => b.businessId === businessId),
      services: db.services.filter((s) => s.businessId === businessId),
      professionals: db.professionals.filter((p) => p.businessId === businessId),
      serviceId: service.id,
      durationMin: service.durationMin,
      professionalId: '',
      eligibleProIds: service.professionalIds || [],
      leadMin: cfg.leadMin || 0,
      bufferMin: cfg.bufferMin || 0,
    };

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

// POST público: cria reserva. O servidor RESOLVE o profissional (nunca o
// cliente). Validação atômica contra corrida. Pode também criar como DONO
// (asOwner) para "+ Novo agendamento" do painel.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`booking:${ipFrom(req)}`, 30, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Aguarde um instante.' }, { status: 429 });
  try {
    const body = await req.json();
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === body.businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });

    const owner = await userFromRequest(req);
    // CRÍTICO: modo proprietário só com intenção explícita (asOwner === true)
    // + sessão de dono do próprio negócio. Sessão de dono logado NUNCA
    // transforma sozinha uma requisição pública em operação interna.
    const actor = bookingMode({
      asOwner: body.asOwner,
      ownerLogged: !!owner,
      ownerMatches: !!owner && business.ownerId === owner.id,
    });
    const isOwner = actor === 'owner';

    let customer = null as Awaited<ReturnType<typeof customerFromRequest>>;
    if (!isOwner) {
      customer = await customerFromRequest(req);
      if (!customer) return NextResponse.json({ error: 'Entre para agendar.', code: 'login_required' }, { status: 401 });
    }

    const service = db.services.find((s) => s.id === body.serviceId && s.businessId === business.id && s.active);
    if (!service) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 400 });
    if (!isOwner && !service.bookable) return NextResponse.json({ error: 'Este serviço não aceita agendamento.' }, { status: 400 });

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

    // Identidade: cliente logado usa os dados da CONTA (nunca re-pergunta);
    // dono digita os dados do cliente ao agendar manualmente.
    const name = isOwner
      ? String(body.customerName || '').trim().slice(0, 80)
      : (customer!.name || '').trim().slice(0, 80);
    const phone = isOwner
      ? String(body.customerPhone || '').trim()
      : (customer!.phone || '').trim();
    if (!name) return NextResponse.json({ error: 'Informe o nome do cliente.' }, { status: 400 });
    const digits = onlyDigits(phone);
    if (digits.length < 10) {
      if (!isOwner) {
        return NextResponse.json({ error: 'Precisamos do seu WhatsApp para confirmar.', code: 'phone_required' }, { status: 400 });
      }
      return NextResponse.json({ error: 'Informe um WhatsApp válido.' }, { status: 400 });
    }

    const activePros = db.professionals.filter((p) => p.businessId === business.id && p.active !== false);
    const eligible = (service.professionalIds || []).length > 0
      ? activePros.filter((p) => (service.professionalIds || []).includes(p.id))
      : activePros;

    // Cliente NUNCA escolhe profissional — o payload é ignorado.
    // Dono pode indicar, mas só se elegível para o serviço.
    let ownerPro = '';
    if (isOwner) {
      ownerPro = String(body.professionalId || '');
      if (ownerPro && activePros.length > 0 && !eligible.some((p) => p.id === ownerPro)) {
        return NextResponse.json({ error: 'Profissional indisponível para este serviço.' }, { status: 400 });
      }
    }

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
        professionalId: isOwner ? ownerPro : '',
        eligibleProIds: service.professionalIds || [],
        nowHM: date === todayISO() ? nowHM() : '',
        leadMin: cfg.leadMin || 0,
        bufferMin: cfg.bufferMin || 0,
      });
      if (!r.slots.includes(time)) {
        throw err('Este horário acabou de ser ocupado. Escolha outro.', 409);
      }
      // Distribuição automática: menor carga no dia (política "equilibrar equipe").
      const finalPro = resolveProfessional({
        service,
        professionals: d.professionals.filter((p) => p.businessId === business.id),
        assign: r.assign,
        time,
        requested: ownerPro,
        allowRequested: isOwner,
      });
      const now = new Date().toISOString();
      const bookingId = randomUUID();
      d.bookings.push({
        id: bookingId, businessId: business.id, customerId: customer?.id || '',
        serviceId: service.id, professionalId: finalPro, date, time,
        customerName: name, customerPhone: digits,
        status: isOwner ? 'confirmed' : 'pending',
        note: String(body.note || '').slice(0, 300), createdAt: now,
        answers: (Array.isArray(body.answers) ? body.answers : []).map((x: any) => String(x || '').trim().slice(0, 300)).slice(0, 3),
        updatedAt: now, history: [{ at: now, from: '', to: isOwner ? 'confirmed' : 'pending', by: isOwner ? 'owner' : 'customer' }],
      });
      d.events.push({ id: randomUUID(), businessId: business.id, type: 'booking_created', path: '', meta: { serviceId: service.id }, createdAt: now });
      d.events.push({ id: randomUUID(), businessId: business.id, type: 'conversion', path: '', meta: { kind: 'booking' }, createdAt: now });

      // Contato (relação Customer × Business) — UPSERT, nunca duplica.
      upsertContact(d, {
        businessId: business.id, customerId: customer?.id || '', name, phone: digits,
        email: customer?.email || '', source: 'agendamento', now,
      });

      // Lead associado ao contato/agendamento (origem = agendamento).
      if (!isOwner) {
        const lead = d.leads.find((l) =>
          l.businessId === business.id &&
          ((l.customerId && l.customerId === customer!.id) || (digits && onlyDigits(l.phone) === digits)),
        );
        if (lead) {
          lead.name = name; lead.customerId = customer!.id; lead.lastInteraction = now;
          lead.action = 'agendamento'; if (lead.status === 'new') lead.status = 'converted';
        } else {
          d.leads.push({ id: randomUUID(), businessId: business.id, customerId: customer!.id, name, phone: digits, email: customer?.email || '', instagram: '', origin: 'agendamento', interest: service.name, action: 'agendamento', status: 'converted', createdAt: now, lastInteraction: now });
        }
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

// PATCH (dono): transição de status OU remarcação (date/time). Máquina de
// estados + validação atômica do novo slot (ignorando a própria reserva).
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === body.businessId && b.ownerId === user.id);
    if (!business) return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    const current = db.bookings.find((x) => x.id === body.id && x.businessId === business.id);
    if (!current) return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 });

    // ── Remarcação pelo dono ──
    if (body.date && body.time) {
      const date = String(body.date);
      const time = String(body.time);
      if (!isValidDateISO(date) || !/^\d{2}:\d{2}$/.test(time)) {
        return NextResponse.json({ error: 'Escolha data e horário.' }, { status: 400 });
      }
      const today = todayISO();
      const maxDate = addDaysISO(today, Math.max(1, business.booking?.horizonDays || 60));
      if (date < today) return NextResponse.json({ error: 'Não é possível remarcar para o passado.' }, { status: 400 });
      if (date > maxDate) return NextResponse.json({ error: 'Data fora da agenda disponível.' }, { status: 400 });
      const service = db.services.find((s) => s.id === current.serviceId && s.businessId === business.id);
      if (!service) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 400 });
      const proId = String(body.professionalId || '');
      const activePros = db.professionals.filter((p) => p.businessId === business.id && p.active !== false);
      const eligible = (service.professionalIds || []).length > 0
        ? activePros.filter((p) => (service.professionalIds || []).includes(p.id))
        : activePros;
      if (proId && activePros.length > 0 && !eligible.some((p) => p.id === proId)) {
        return NextResponse.json({ error: 'Profissional indisponível para este serviço.' }, { status: 400 });
      }
      await updateDB((d: DB) => {
        const target = d.bookings.find((x) => x.id === body.id && x.businessId === business.id);
        if (!target) throw err('Agendamento não encontrado.', 404);
        const others = d.bookings.filter((b) => b.businessId === business.id && b.id !== body.id);
        const r = computeSlots({
          rules: d.availability.filter((a) => a.businessId === business.id),
          exceptions: d.exceptions.filter((e) => e.businessId === business.id),
          bookings: others,
          services: d.services.filter((s) => s.businessId === business.id),
          professionals: d.professionals.filter((p) => p.businessId === business.id),
          dateISO: date, weekday: weekdayOf(date),
          serviceId: service.id, durationMin: service.durationMin,
          professionalId: proId,
          eligibleProIds: service.professionalIds || [],
          nowHM: date === todayISO() ? nowHM() : '',
          leadMin: business.booking?.leadMin || 0,
          bufferMin: business.booking?.bufferMin || 0,
        });
        if (!r.slots.includes(time)) throw err('Este horário está ocupado. Escolha outro.', 409);
        const now = new Date().toISOString();
        target.date = date;
        target.time = time;
        if (proId || !r.assign[time]) target.professionalId = proId || r.assign[time] || '';
        target.updatedAt = now;
        target.history.push({ at: now, from: target.status, to: target.status, by: 'owner' });
      });
      return NextResponse.json({ ok: true });
    }

    // ── Transição de status ──
    const to = body.status as BookingStatus;
    if (!BOOKING_FLOW[current.status] || !canTransition(BOOKING_FLOW, current.status, to)) {
      return NextResponse.json({ error: `Não é possível mudar de "${current.status}" para "${body.status}".` }, { status: 422 });
    }
    await updateDB((d) => {
      const b = d.bookings.find((x) => x.id === body.id && x.businessId === business.id);
      if (!b) throw err('Agendamento não encontrado.', 404);
      const now = new Date().toISOString();
      b.history.push({ at: now, from: b.status, to, by: 'owner' });
      b.status = to;
      b.updatedAt = now;
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[bookings] PATCH falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível atualizar.' : e.message }, { status });
  }
}
