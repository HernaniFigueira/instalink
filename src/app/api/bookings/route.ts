import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { canAccessBooking, requireBusiness, scopeBookings, scopeInfo } from '@/lib/access';
import { customerFromRequest } from '@/lib/customer-auth';
import { isFeatureEnabled, canBook as canBookModule } from '@/lib/features';
import {
  bookingDuration, effectiveHorizonDays, effectiveManageLimit, needsClosure, rescheduleDecision,
  rescheduleForwardNote, rescheduleNote,
} from '@/lib/booking-ops';
import { applyBookingStatusTx } from '@/lib/booking-status';
import { computeSlots, dayAvailability } from '@/lib/slots';
import { bookingMode } from '@/lib/booking';
import { createBookingTx, resolveBookingIdentity } from '@/lib/booking-create';
import { noteLeadReschedule } from '@/lib/pipeline';
import { enqueueDueReminders } from '@/lib/automations';
import { upsertContact } from '@/lib/contacts';
import { todayISO, nowHM, weekdayOf, addDaysISO, effectiveTimezone, isValidDateISO, isValidClockTime } from '@/lib/tz';
import { onlyDigits } from '@/lib/utils';
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
      // ESCOPO DO PROFISSIONAL (P2): quem atende e tem login vinculado vê
      // SOMENTE a própria agenda — filtro aplicado AQUI (dados), não na tela.
      const scope = guard.ctx.professionalScope;
      const from = q.get('from') || '';
      const to = q.get('to') || '';
      // A2-B3 (F6): UMA leitura só (guard.db já é o documento atual) — o GET
      // lia o documento DUAS vezes e ainda escrevia lembretes no meio. GET
      // não tem efeito colateral: lembretes hoje nascem na ESCRITA
      // (createBookingTx e a mudança de status no PATCH), nunca na leitura.
      let all = scopeBookings(guard.db.bookings.filter((x) => x.businessId === businessId), scope)
        .sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1));
      if (isValidDateISO(from) && isValidDateISO(to)) {
        all = all.filter((x) => x.date >= from && x.date <= to);
      }
      const page = Math.max(1, Number(q.get('page')) || 1);
      // Limite EFETIVO explícito (F6): pediu 1000, recebe 500 — e a resposta
      // diz isso (limitCapped/requestedLimit), sem cap silencioso.
      const { limit, capped, requested } = effectiveManageLimit(q.get('limit'));
      // Pendências operacionais (horário já passou e ninguém fechou o
      // atendimento) — a agenda destaca, nunca altera status sozinha.
      const servicesById = Object.fromEntries(
        guard.db.services.filter((s) => s.businessId === businessId).map((s) => [s.id, s]),
      );
      // A2-B5 (F9): "hoje" e "agora" no FUSO DO NEGÓCIO (nunca o do servidor
      // nem o do navegador) — as regras operacionais seguem o negócio.
      const btz = effectiveTimezone(business.businessTimezone);
      const today = todayISO(new Date(), btz);
      const now = nowHM(new Date(), btz);
      const slice = all.slice((page - 1) * limit, page * limit);
      return NextResponse.json({
        bookings: slice,
        total: all.length, page, limit,
        ...(capped ? { limitCapped: true, requestedLimit: requested } : {}),
        today,
        needsClosure: slice.filter((b) => needsClosure(b, bookingDuration(servicesById[b.serviceId]), today, now)).map((b) => b.id),
        modules: { bookings: isFeatureEnabled(guard.ctx.business, 'bookings') },
        // Informação para a tela avisar (com honestidade) quando a agenda
        // está recortada. A regra já foi aplicada nos dados acima.
        scope: scopeInfo(guard.ctx),
      });
    }

    const service = db.services.find((s) => s.id === q.get('serviceId') && s.businessId === businessId);
    if (!service) return NextResponse.json({ slots: [] });
    const requestedProfessionalId = String(q.get('professionalId') || '');
    const activeProsForService = db.professionals.filter((p) => p.businessId === businessId && p.active !== false);
    const eligibleProfessionalIds = (service.professionalIds || []).length > 0
      ? activeProsForService.filter((p) => service.professionalIds.includes(p.id)).map((p) => p.id)
      : activeProsForService.map((p) => p.id);
    if (requestedProfessionalId && !eligibleProfessionalIds.includes(requestedProfessionalId)) {
      return NextResponse.json({ error: 'Profissional indisponível para este serviço.' }, { status: 400 });
    }
    // Módulo de agendamentos desativado ⇒ nenhum horário é oferecido.
    if (!isFeatureEnabled(business, 'bookings')) {
      return NextResponse.json({ slots: [], closed: true, moduleOff: true });
    }
    const cfg = business.booking;
    const btz = effectiveTimezone(business.businessTimezone); // A2-B5 (F9)
    const today = todayISO(new Date(), btz);
    const maxDate = addDaysISO(today, effectiveHorizonDays(cfg));

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
      // A consulta administrativa pode restringir a coluna escolhida; sem
      // filtro a resposta continua sendo a união da equipe.
      professionalId: requestedProfessionalId,
      eligibleProIds: service.professionalIds || [],
      leadMin: cfg.leadMin || 0,
      bufferMin: cfg.bufferMin || 0,
    };

    const from = q.get('from') || '';
    const to = q.get('to') || '';
    if (isValidDateISO(from) && isValidDateISO(to)) {
      // A2-B3 (F4): cada dia carrega o ESTADO real (fechado × lotado × livre
      // × passado) derivado do mesmo motor — a UI deixa de chamar de
      // "fechado" um dia que está aberto e lotado.
      const days: Record<string, ReturnType<typeof dayAvailability>> = {};
      for (let iso = from; iso <= to && iso <= maxDate; iso = addDaysISO(iso, 1)) {
        days[iso] = dayAvailability(
          { ...base, dateISO: iso, weekday: weekdayOf(iso), nowHM: iso === today ? nowHM(new Date(), btz) : '' },
          { today },
        );
      }
      return NextResponse.json({ days, today });
    }

    const date = q.get('date') || '';
    if (!isValidDateISO(date) || date < today || date > maxDate) {
      return NextResponse.json({ slots: [], closed: true });
    }
    const r = computeSlots({
      ...base, dateISO: date, weekday: weekdayOf(date),
      nowHM: date === today ? nowHM(new Date(), btz) : '',
    });
    const day = dayAvailability(
      { ...base, dateISO: date, weekday: weekdayOf(date), nowHM: date === today ? nowHM(new Date(), btz) : '' },
      { today },
    );
    const pros = Object.fromEntries(base.professionals.map((p) => [p.id, p.name]));
    // `byPro` permite que a agenda (drag-and-drop) saiba em QUAL coluna o
    // horário realmente cabe, sem precisar de uma requisição por profissional.
    // A2-B3 (F4): `state`/`reason`/`full` explicam HONESTAMENTE um dia sem
    // horários (fechado por regra/exceção × lotado × hoje encerrou).
    return NextResponse.json({
      slots: r.slots, occupied: r.occupied, closed: r.closed, closedReason: r.closedReason,
      state: day.state, full: day.full, reason: day.reason,
      assign: r.assign,
      byPro: r.byProfessional, pros, today,
      eligibleProfessionalIds,
    });
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
      // A2-B2 (F1): a sessão do consumidor é OPCIONAL — /agendar e o widget
      // aceitam GUEST (nome/telefone informados no fluxo, validados abaixo
      // por resolveBookingIdentity). Sem sessão E sem identidade ⇒ 401
      // login_required: o fluxo autenticado da página pública continua igual.
      customer = await customerFromRequest(req);
    }

    const service = db.services.find((s) => s.id === body.serviceId && s.businessId === business.id && s.active);
    if (!service) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 400 });
    if (isOwner && !canBookModule(business, [service])) {
      return NextResponse.json({ error: 'Serviço sem agendamento disponível.' }, { status: 400 });
    }
    if (!isOwner && !service.bookable) return NextResponse.json({ error: 'Este serviço não aceita agendamento.' }, { status: 400 });

    const date = body.date || '';
    const time = body.time || '';
    if (!isValidDateISO(date) || !isValidClockTime(time)) {
      return NextResponse.json({ error: 'Escolha data e horário.' }, { status: 400 });
    }
    const cfg = business.booking;
    const btz = effectiveTimezone(business.businessTimezone); // A2-B5 (F9)
    const today = todayISO(new Date(), btz);
    const maxDate = addDaysISO(today, effectiveHorizonDays(cfg));
    if (date < today) return NextResponse.json({ error: 'Não é possível agendar no passado.' }, { status: 400 });
    if (date > maxDate) return NextResponse.json({ error: 'Data fora da agenda disponível.' }, { status: 400 });

    // CRM primeiro: o painel escolhe um CONTATO existente (ou cria um novo).
    // Quando um contato é vinculado, nome/telefone/e-mail vêm dele — nada de
    // digitar duas vezes nem duplicar pessoa.
    const linkedContact = isOwner && body.contactId
      ? db.contacts.find((c) => c.id === String(body.contactId) && c.businessId === business.id)
      : undefined;

    // ── Identidade (A2-B2 · F1): UMA regra no servidor ──
    // Cliente logado usa os dados da CONTA (nunca re-pergunta); GUEST de
    // /agendar/widget informa nome+telefone validados aqui; dono digita ou
    // usa o contato vinculado.
    const identity = resolveBookingIdentity({
      isOwner,
      sessionCustomer: customer
        ? { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email }
        : null,
      body: { customerName: body.customerName, customerPhone: body.customerPhone, customerEmail: body.customerEmail },
      linked: isOwner && linkedContact
        ? { name: linkedContact.name, phone: linkedContact.phone, email: linkedContact.email }
        : null,
    });
    if (!identity.ok) {
      return NextResponse.json(
        { error: identity.error, ...(identity.code ? { code: identity.code } : {}) },
        { status: identity.code === 'login_required' ? 401 : 400 },
      );
    }
    const name = identity.name;
    const digits = identity.phoneDigits;
    if (!name) return NextResponse.json({ error: 'Informe o nome do cliente.' }, { status: 400 });
    if (digits.length < 10) {
      if (identity.source !== 'owner') {
        return NextResponse.json({ error: 'Precisamos do seu WhatsApp para confirmar.', code: 'phone_required' }, { status: 400 });
      }
      return NextResponse.json({ error: 'Informe um WhatsApp válido.' }, { status: 400 });
    }
    // E-mail informado no fluxo (A2-B2 · F7.3): passa a ser USADO (contato/lead),
    // complementando a sessão/contato quando eles não têm e-mail.
    const email = identity.email || linkedContact?.email || customer?.email || '';

    // CONSENTIMENTO EXPLÍCITO (nunca presumido): só o PRÓPRIO cliente marca a
    // caixa no ato da reserva; cadastro/agendamento sozinho NÃO vira opt-in.
    const marketingOptIn = !isOwner && body.marketingOptIn === true;

    // ── Criação pelo CAMINHO ÚNICO (lib/booking-create.ts) ──
    // Mesmo motor da página, do painel e do assistente: slot revalidado na
    // transação, profissional resolvido pela política interna, CRM alimentado
    // e automação de confirmação enfileirada.
    const result = await updateDB((d: DB) => createBookingTx(d, {
      business,
      service,
      date,
      time,
      actor: isOwner ? 'owner' : 'customer',
      customer: {
        id: customer?.id || linkedContact?.customerId || '',
        name,
        phone: digits,
        email,
      },
      linkedContact: isOwner && linkedContact
        ? {
          id: linkedContact.id, name: linkedContact.name, phone: linkedContact.phone,
          email: linkedContact.email, customerId: linkedContact.customerId,
        }
        : null,
      // Escopo do profissional: o próprio profissional é o responsável pelo
      // atendimento que ele cria (nunca é possível criar para outra pessoa).
      professionalId: guard?.ok ? (guard.ctx.professionalScope || String(body.professionalId || '')) : String(body.professionalId || ''),
      note: body.note,
      answers: body.answers,
      marketingOptIn,
      source: 'agendamento',
      leadId: body.leadId ? String(body.leadId) : undefined,
    }));
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
    // ESCOPO DO PROFISSIONAL (P2): alterar status/remarcar atendimento de
    // outra pessoa é recusado no servidor — o id não pode ser manipulado.
    if (!canAccessBooking(guard.ctx, current)) {
      return NextResponse.json({ error: 'Você só pode alterar os seus próprios atendimentos.' }, { status: 403 });
    }

    // ── Remarcação pelo dono ──
    if (body.date && body.time) {
      const date = String(body.date);
      const time = String(body.time);
      if (!isValidDateISO(date) || !isValidClockTime(time)) {
        return NextResponse.json({ error: 'Escolha data e horário.' }, { status: 400 });
      }
      const patchTz = effectiveTimezone(business.businessTimezone); // A2-B5 (F9)
      const today = todayISO(new Date(), patchTz);
      const maxDate = addDaysISO(today, effectiveHorizonDays(business.booking));
      if (date < today) return NextResponse.json({ error: 'Não é possível remarcar para o passado.' }, { status: 400 });
      if (date > maxDate) return NextResponse.json({ error: 'Data fora da agenda disponível.' }, { status: 400 });
      const service = db.services.find((s) => s.id === current.serviceId && s.businessId === business.id);
      if (!service) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 400 });
      // Escopo do profissional: remarcação permanece com ele (nunca move o
      // atendimento para outro profissional sem permissão administrativa).
      const proId = guard.ctx.professionalScope || String(body.professionalId || '');
      const activePros = db.professionals.filter((p) => p.businessId === business.id && p.active !== false);
      const eligible = (service.professionalIds || []).length > 0
        ? activePros.filter((p) => (service.professionalIds || []).includes(p.id))
        : activePros;
      if (proId && !eligible.some((p) => p.id === proId)) {
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
          nowHM: date === todayISO(new Date(), patchTz) ? nowHM(new Date(), patchTz) : '',
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
            // A2-B3 (F7.2): a cadeia de reagendamento mantém o vínculo com o
            // lead — o lead passa a apontar para o atendimento FUTURO, não
            // para o registro antigo (nota "Agendado para..." nunca fica
            // apontando para o passado).
            leadId: target.leadId || undefined,
          });
          target.history.push({ at: now, from: target.status, to: target.status, by: 'owner', note: rescheduleForwardNote({ date, time }) });
          target.updatedAt = now;
          if (target.leadId) {
            const lead = d.leads.find((l) => l.id === target.leadId && l.businessId === business.id);
            if (lead) lead.bookingId = newId;
          }
          noteLeadReschedule(d, {
            businessId: business.id, leadId: target.leadId,
            from: { date: target.date, time: target.time }, to: { date, time },
            by: 'owner', now,
          });
          upsertContact(d, {
            businessId: business.id, customerId: target.customerId || '',
            name: target.customerName, phone: target.customerPhone, source: 'reagendamento', now,
          });
          return { created: true, newId };
        }

        // pending/confirmed: move o MESMO atendimento, mantendo o status.
        const fromDate = target.date;
        const fromTime = target.time;
        target.date = date;
        target.time = time;
        // Profissional do destino: o escolhido explicitamente vence. Sem
        // escolha, usa o profissional LIVRE retornado pela validação (em equipe
        // o horário pode estar livre só para outra pessoa). Manter o profissional
        // anterior quando ele está ocupado criaria um conflito silencioso.
        target.professionalId = proId || r.assign[time] || target.professionalId || '';
        target.updatedAt = now;
        target.history.push({ at: now, from: target.status, to: decision.nextStatus, by: 'owner', note });
        if (target.status !== decision.nextStatus) target.status = decision.nextStatus;
        // A2-B3 (F7.2): a nota da esteira ("Agendado para …") acompanha a
        // remarcação — sem nota stale apontando para o dia antigo.
        noteLeadReschedule(d, {
          businessId: business.id, leadId: target.leadId,
          from: { date: fromDate, time: fromTime }, to: { date, time },
          by: 'owner', now,
        });
        return { created: false, newId: target.id };
      });
      return NextResponse.json({ ok: true, ...result, moved: decision.kind === 'move', reason: decision.reason });
    }

    // ── Transição de status (fechamento operacional ou mudança normal) ──
    // P4: a regra está na FUNÇÃO OFICIAL (lib/booking-status.ts), que a automação
    // também usa — máquina de estados, histórico e mensagens do P3 num só lugar.
    const to = body.status as BookingStatus;
    const applied = await updateDB((d) => {
      const r = applyBookingStatusTx(d, {
        businessId: business.id,
        bookingId: String(body.id || ''),
        to,
        by: 'owner',
        note: body.note ? String(body.note) : undefined,
      });
      if (r.ok) {
        // A2-B3 (F6): lembretes vencidos nascem na ESCRITA (idempotente por
        // agendamento) — o GET manage parou de ter efeito colateral.
        try { enqueueDueReminders(d, business.id, todayISO(new Date(), effectiveTimezone(business.businessTimezone))); } catch { /* melhor-esforço */ }
      }
      return r;
    });
    if (!applied.ok) {
      return NextResponse.json({ error: applied.error || 'Não foi possível atualizar.' }, { status: applied.status_code || 422 });
    }
    return NextResponse.json({ ok: true, status: applied.status });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[bookings] PATCH falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível atualizar.' : e.message }, { status });
  }
}
