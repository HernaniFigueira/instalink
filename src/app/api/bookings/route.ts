import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { customerFromRequest } from '@/lib/customer-auth';
import { isFeatureEnabled, canBook as canBookModule } from '@/lib/features';
import {
  bookingDuration, needsClosure, rescheduleDecision, rescheduleForwardNote, rescheduleNote,
} from '@/lib/booking-ops';
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
      const guard = await requireBusiness(req, businessId, 'agenda');
      if (!guard.ok) return guard.res;
      const from = q.get('from') || '';
      const to = q.get('to') || '';
      let all = guard.db.bookings.filter((x) => x.businessId === businessId);
      if (isValidDateISO(from) && isValidDateISO(to)) {
        all = all.filter((x) => x.date >= from && x.date <= to);
      }
      all = all.sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
      const page = Math.max(1, Number(q.get('page')) || 1);
      const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 200));
      // Pendências operacionais (horário já passou e ninguém fechou o
      // atendimento) — a agenda destaca, nunca altera status sozinha.
      const servicesById = Object.fromEntries(
        guard.db.services.filter((s) => s.businessId === businessId).map((s) => [s.id, s]),
      );
      const today = todayISO();
      const now = nowHM();
      const slice = all.slice((page - 1) * limit, page * limit);
      return NextResponse.json({
        bookings: slice,
        total: all.length, page, limit,
        today,
        needsClosure: slice.filter((b) => needsClosure(b, bookingDuration(servicesById[b.serviceId]), today, now)).map((b) => b.id),
        modules: { bookings: isFeatureEnabled(guard.ctx.business, 'bookings') },
      });
    }

    const service = db.services.find((s) => s.id === q.get('serviceId') && s.businessId === businessId);
    if (!service) return NextResponse.json({ slots: [] });
    // Módulo de agendamentos desativado ⇒ nenhum horário é oferecido.
    if (!isFeatureEnabled(business, 'bookings')) {
      return NextResponse.json({ slots: [], closed: true, moduleOff: true });
    }
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

    // MÓDULO: agendamento desativado não aceita reserva pública nenhuma.
    if (!isFeatureEnabled(business, 'bookings')) {
      return NextResponse.json({ error: 'Este negócio não está aceitando agendamentos no momento.' }, { status: 403 });
    }

    // CRÍTICO: modo proprietário só com intenção explícita (asOwner === true)
    // + autorização real (dono OU membro com permissão de agenda). Sessão de
    // lojista logado NUNCA transforma sozinha uma requisição pública em
    // operação interna.
    const guard = body.asOwner === true ? await requireBusiness(req, business.id, 'agenda') : null;
    const actor = bookingMode({
      asOwner: body.asOwner,
      ownerLogged: !!guard?.ok,
      ownerMatches: !!guard?.ok,
    });
    const isOwner = actor === 'owner';

    let customer = null as Awaited<ReturnType<typeof customerFromRequest>>;
    if (!isOwner) {
      customer = await customerFromRequest(req);
      if (!customer) return NextResponse.json({ error: 'Entre para agendar.', code: 'login_required' }, { status: 401 });
    }

    const service = db.services.find((s) => s.id === body.serviceId && s.businessId === business.id && s.active);
    if (!service) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 400 });
    if (isOwner && !canBookModule(business, [service])) {
      return NextResponse.json({ error: 'Serviço sem agendamento disponível.' }, { status: 400 });
    }
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

    // CRM primeiro: o painel escolhe um CONTATO existente (ou cria um novo).
    // Quando um contato é vinculado, nome/telefone/e-mail vêm dele — nada de
    // digitar duas vezes nem duplicar pessoa.
    const linkedContact = isOwner && body.contactId
      ? db.contacts.find((c) => c.id === String(body.contactId) && c.businessId === business.id)
      : undefined;

    // Identidade: cliente logado usa os dados da CONTA (nunca re-pergunta);
    // dono digita os dados do cliente (ou usa o contato selecionado).
    const name = isOwner
      ? String(body.customerName || linkedContact?.name || '').trim().slice(0, 80)
      : (customer!.name || '').trim().slice(0, 80);
    const phone = isOwner
      ? String(body.customerPhone || linkedContact?.phone || '').trim()
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
        id: bookingId, businessId: business.id,
        customerId: customer?.id || linkedContact?.customerId || '',
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
      // O atendimento SEMPRE alimenta o CRM, venha de onde vier.
      upsertContact(d, {
        businessId: business.id,
        customerId: customer?.id || linkedContact?.customerId || '',
        name, phone: digits,
        email: customer?.email || linkedContact?.email || '',
        source: 'agendamento', now,
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
    const guard = await requireBusiness(req, String(body.businessId || ''), 'agenda');
    if (!guard.ok) return guard.res;
    const db = guard.db;
    const business = guard.ctx.business;
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
      const decision = rescheduleDecision(current.status);
      const result = await updateDB((d: DB) => {
        const target = d.bookings.find((x) => x.id === body.id && x.businessId === business.id);
        if (!target) throw err('Agendamento não encontrado.', 404);
        // O próprio atendimento não bloqueia o novo horário; atendimentos
        // terminais recriados também não (ficam no histórico, não na grade).
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
        const note = rescheduleNote({ date: target.date, time: target.time }, { date, time });

        if (decision.kind === 'recreate') {
          // Estado terminal (concluído/faltou/cancelado): o registro antigo
          // PERMANECE como está e um NOVO atendimento futuro é criado.
          const newId = randomUUID();
          d.bookings.push({
            id: newId, businessId: business.id, customerId: target.customerId || '',
            serviceId: target.serviceId,
            professionalId: proId || r.assign[time] || target.professionalId || '',
            date, time,
            customerName: target.customerName, customerPhone: target.customerPhone,
            status: decision.nextStatus, note: target.note || '', answers: target.answers || [],
            createdAt: now, updatedAt: now,
            previousId: target.id,
            rescheduleCount: (target.rescheduleCount || 0) + 1,
            history: [{ at: now, from: '', to: decision.nextStatus, by: 'owner', note }],
          });
          target.history.push({ at: now, from: target.status, to: target.status, by: 'owner', note: rescheduleForwardNote({ date, time }) });
          target.updatedAt = now;
          upsertContact(d, {
            businessId: business.id, customerId: target.customerId || '',
            name: target.customerName, phone: target.customerPhone, source: 'reagendamento', now,
          });
          return { created: true, newId };
        }

        // pending/confirmed: move o MESMO atendimento, mantendo o status.
        target.date = date;
        target.time = time;
        if (proId || !r.assign[time]) target.professionalId = proId || r.assign[time] || '';
        target.updatedAt = now;
        target.history.push({ at: now, from: target.status, to: decision.nextStatus, by: 'owner', note });
        if (target.status !== decision.nextStatus) target.status = decision.nextStatus;
        return { created: false, newId: target.id };
      });
      return NextResponse.json({ ok: true, ...result, moved: decision.kind === 'move', reason: decision.reason });
    }

    // ── Transição de status (fechamento operacional ou mudança normal) ──
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
