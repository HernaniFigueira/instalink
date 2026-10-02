import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { canAccessBooking, requireBusiness, scopeBookings, scopeInfo } from '@/lib/access';
import { customerFromRequest } from '@/lib/customer-auth';
import { isFeatureEnabled, canBook as canBookModule } from '@/lib/features';
import {
  bookingDurationOf, bookingMaxDate, effectiveManageLimit, needsClosure, rescheduleDecision,
  rescheduleForwardNote, rescheduleNote,
} from '@/lib/booking-ops';
import { transitionAppointment, bookingWorkflowState, closeWorkflowTaskTx } from '@/lib/appointment-workflow-tx';
import { publishWorkflowEvent } from '@/lib/workflow-events';
import { workflowForBooking, workflowForBookings } from '@/lib/workflow-view';
import { bufferPair, assignResources, blockConflict } from '@/lib/schedule-capacity';
import { computeSlots, dayAvailability } from '@/lib/slots';
import { bookingMode, eligibleProfessionalIds as eligibleIdsForService, slotEligibleProfessionalIds, serviceProfessionalMode } from '@/lib/booking';
import { createBookingTx, resolveBookingIdentity } from '@/lib/booking-create';
import { previewSeries, createSeriesTx, cancelFutureSeriesTx } from '@/lib/booking-series';
import type { CreateBookingParams } from '@/lib/booking-create';
import { noteLeadReschedule } from '@/lib/pipeline';
import { emitAutomationEvent } from '@/lib/automation/events';
import { enqueueDueReminders } from '@/lib/automations';
import { upsertContact } from '@/lib/contacts';
import { todayISO, nowHM, weekdayOf, addDaysISO, effectiveTimezone, isValidDateISO, isValidClockTime } from '@/lib/tz';
import { onlyDigits, timeToMin } from '@/lib/utils';
import { fitInConflictsFromDB, fitInWarning } from '@/lib/fit-in';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import { applyBookingWindow, bookingWindowFields, buildBookingWindow, freezeLegacyBookingWindow, type BookingWindow } from '@/lib/booking-temporal';
import type { Booking, BookingStatus, DB } from '@/lib/types';

function err(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

// GET ?businessId=&serviceId=&date= — slots livres (público, sem escolha de profissional)
// GET ?businessId=&serviceId=&from=&to= — mapa de dias (público)
// GET ?businessId=&mode=slots-admin&serviceId=&date= — slots da equipe, exige agenda
// GET ?businessId=&mode=manage[&from=&to=&page=&limit=] — gestão (dono)
export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const businessId = q.get('businessId') || '';
    const mode = q.get('mode');
    const staffGuard = mode === 'slots-admin' || mode === 'manage'
      ? await requireBusiness(req, businessId, 'agenda')
      : null;
    if (staffGuard && !staffGuard.ok) return staffGuard.res;
    const db = staffGuard?.ok ? staffGuard.db : await readDB();
    const business = db.businesses.find((b) => b.id === businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });

    if (mode === 'manage') {
      // The mode was authorized above; reuse its snapshot for the response.
      const guard = staffGuard!;
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
      // FASE 2 · P6 — veterinária: a agenda lê PRIMEIRO o PET (o tutor fica
      // como contexto). `petName` só existe quando há vínculo — dados legados
      // e outras clínicas seguem exatamente como antes.
      const petsById: Record<string, string> = business.clinicType === 'veterinaria'
        ? Object.fromEntries(
          guard.db.pets.filter((p) => p.businessId === businessId && p.active !== false).map((p) => [p.id, p.name]),
        )
        : {};
      // Workflow: etapa canônica + ações válidas para ESTE papel/escopo
      // (derivadas no servidor; a tela só desenha o que vem aqui).
      const wf = workflowForBookings(guard.db, businessId, slice, guard.ctx);
      const withPet = slice.map((b) => ({
        ...b,
        ...(b.petId && petsById[b.petId] ? { petName: petsById[b.petId] } : {}),
        workflow: wf[b.id],
      }));
      return NextResponse.json({
        bookings: withPet,
        total: all.length, page, limit,
        ...(capped ? { limitCapped: true, requestedLimit: requested } : {}),
        today,
        needsClosure: slice.filter((b) => needsClosure(b, bookingDurationOf(b, servicesById[b.serviceId]), today, now)).map((b) => b.id),
        modules: { bookings: isFeatureEnabled(guard.ctx.business, 'bookings') },
        // Informação para a tela avisar (com honestidade) quando a agenda
        // está recortada. A regra já foi aplicada nos dados acima.
        scope: scopeInfo(guard.ctx),
      });
    }

    const service = db.services.find((s) => s.id === q.get('serviceId') && s.businessId === businessId);
    if (!service) return q.has('dates')
      ? NextResponse.json({ error: 'Serviço indisponível.' }, { status: 404 })
      : NextResponse.json({ slots: [] });
    const scope = staffGuard?.ok ? staffGuard.ctx.professionalScope : '';
    if (scope && q.get('professionalId') && q.get('professionalId') !== scope) {
      return NextResponse.json({ error: 'Você só pode consultar o seu profissional.' }, { status: 403 });
    }
    const requestedProfessionalId = scope || String(q.get('professionalId') || '');
    const allProsForService = db.professionals.filter((p) => p.businessId === businessId);
    const eligibleProfessionalIds = eligibleIdsForService(service as any, allProsForService);
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
    const maxDate = bookingMaxDate(today, cfg, !!staffGuard?.ok);

    // O cliente NUNCA escolhe profissional: a grade é sempre "qualquer
    // profissional elegível livre" (o motor resolve internamente).
    // Only the authenticated staff gesture may request 5-minute starts.
    // A booking ID selects its own frozen duration; never trust a duration in the URL.
    const gestureBooking = staffGuard?.ok && q.get('gestureBookingId')
      ? db.bookings.find((b) => b.id === q.get('gestureBookingId') && b.businessId === businessId && canAccessBooking(staffGuard.ctx, b))
      : undefined;
    if (q.get('gestureBookingId') && (!gestureBooking || gestureBooking.serviceId !== service.id)) return NextResponse.json({ error: 'Agendamento não encontrado.' }, { status: 404 });
    const base = {
      ...(staffGuard?.ok && q.get('internalSnap') === '5' ? { startStepMin: 5 } : {}),
      rules: db.availability.filter((a) => a.businessId === businessId),
      exceptions: db.exceptions.filter((e) => e.businessId === businessId),
      bookings: db.bookings.filter((b) => b.businessId === businessId && b.id !== gestureBooking?.id),
      services: db.services.filter((s) => s.businessId === businessId),
      professionals: db.professionals.filter((p) => p.businessId === businessId),
      serviceId: service.id,
      durationMin: gestureBooking ? bookingDurationOf(gestureBooking, service) : service.durationMin,
      // A consulta administrativa pode restringir a coluna escolhida; sem
      // filtro a resposta continua sendo a união da equipe.
      professionalId: requestedProfessionalId,
      eligibleProIds: slotEligibleProfessionalIds(service as any, allProsForService),
      leadMin: cfg.leadMin || 0,
      bufferMin: cfg.bufferMin || 0, bufferBeforeMin: cfg.bufferBeforeMin, bufferAfterMin: cfg.bufferAfterMin,
      blocks: db.scheduleBlocks, resources: db.scheduleResources, businessId,
      preferredResourceIds: gestureBooking?.resourceIds,
      candidateBufferBeforeMin: gestureBooking?.bufferBeforeMin,
      candidateBufferAfterMin: gestureBooking?.bufferAfterMin,
      timeZone: btz,
    };

    // B2.1: one authenticated, bounded request for the entire visible week.
    // All computations reuse guard.db; public day maps/single-day slots keep
    // their existing contract and cannot opt into the staff batch/snap.
    if (q.has('dates')) {
      if (!staffGuard?.ok || !gestureBooking || q.get('internalSnap') !== '5' || q.has('date') || q.has('from') || q.has('to')) {
        return NextResponse.json({ error: 'Consulta de gesto indisponível.' }, { status: 400 });
      }
      const dates = (q.get('dates') || '').split(',');
      if (dates.length < 1 || dates.length > 7 || new Set(dates).size !== dates.length || dates.some((iso) => !isValidDateISO(iso))) {
        return NextResponse.json({ error: 'Informe de 1 a 7 datas válidas e distintas.' }, { status: 400 });
      }
      const days: Record<string, { slots: string[]; byPro: Record<string, string[]>; eligibleProfessionalIds: string[]; closed: boolean }> = {};
      for (const iso of dates) {
        if (iso < today || iso > maxDate) {
          days[iso] = { slots: [], byPro: {}, eligibleProfessionalIds, closed: true };
          continue;
        }
        const r = computeSlots({ ...base, dateISO: iso, weekday: weekdayOf(iso), nowHM: iso === today ? nowHM(new Date(), btz) : '' });
        days[iso] = { slots: r.slots, byPro: r.byProfessional, eligibleProfessionalIds, closed: r.closed };
      }
      return NextResponse.json({ days });
    }

    const from = q.get('from') || '';
    const to = q.get('to') || '';
    if (isValidDateISO(from) && isValidDateISO(to)) {
      // A2-B3 (F4): cada dia carrega o ESTADO real (fechado × lotado × livre
      // × passado) derivado do mesmo motor — a UI deixa de chamar de
      // "fechado" um dia que está aberto e lotado.
      const days: Record<string, ReturnType<typeof dayAvailability>> = {};
      for (let iso = from < today ? today : from; iso <= to && iso <= maxDate; iso = addDaysISO(iso, 1)) {
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
    const guard = body.asOwner === true
      ? await requireBusiness(req, String(body.businessId || ''), 'agenda')
      : null;
    if (guard && !guard.ok) return guard.res;
    const db = guard?.ok ? guard.db : await readDB();
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
    const actor = bookingMode({
      asOwner: body.asOwner,
      ownerLogged: !!guard?.ok,
      ownerMatches: !!guard?.ok,
    });
    const isOwner = actor === 'owner';
    if (!isOwner && body.staffDurationMin !== undefined) return NextResponse.json({ error: 'Duração personalizada exige permissão de Agenda.' }, { status: 403 });

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
    const maxDate = bookingMaxDate(today, cfg, isOwner);
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
    if (body.series && !isOwner) return NextResponse.json({ error: 'Recorrência exige permissão de Agenda.' }, { status: 403 });
    // A3.4 · Bloco 4 — ENCAIXE. Só a equipe (dono/membro com agenda) encaixa;
    // recorrência + encaixe juntos não existem (uma decisão por vez).
    if (body.bookingKind === 'fit_in' && !isOwner) {
      return NextResponse.json({ error: 'Encaixe é uma decisão da equipe.' }, { status: 403 });
    }
    if (body.bookingKind === 'fit_in' && body.series) {
      return NextResponse.json({ error: 'Encaixe não cria série.' }, { status: 400 });
    }
    if (guard?.ok && guard.ctx.professionalScope && body.professionalId && body.professionalId !== guard.ctx.professionalScope) {
      return NextResponse.json({ error: 'Você só pode agendar para o seu profissional.' }, { status: 403 });
    }
    const params: CreateBookingParams = {
      business,
      service,
      date,
      time,
      actor: isOwner ? 'owner' : 'customer',
      ...(isOwner && body.staffDurationMin !== undefined ? { staffDurationMin: body.staffDurationMin } : {}),
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
      source: body.bookingKind === 'fit_in' ? 'encaixe' : 'agendamento',
      leadId: body.leadId ? String(body.leadId) : undefined,
      bookingKind: body.bookingKind === 'fit_in' ? 'fit_in' : undefined,
      fitInConfirmed: body.confirmFitIn === true,
      // FASE 2 · P6 / P0-3 — pet escolhido pelo DONO (validado na unidade;
      // público nunca envia). Veterinária + tutor com pets ativos = OBRIGATÓRIO.
      petId: (() => {
        if (!isOwner || !body.petId) return undefined;
        const pet = db.pets.find((x) => x.id === String(body.petId) && x.businessId === business.id);
        if (!pet) return undefined;
        return pet.id;
      })(),
    };
    // P0-3 — veterinária: tutor já com pet não agenda "só tutor".
    if (
      isOwner
      && business.clinicType === 'veterinaria'
      && linkedContact
      && db.pets.some((x) => x.businessId === business.id && x.tutorId === linkedContact.id && x.active !== false)
      && !params.petId
    ) {
      return NextResponse.json({
        error: 'Em clínica veterinária, selecione o pet (paciente) deste agendamento.',
      }, { status: 400 });
    }
    const scope = guard?.ok ? guard.ctx.professionalScope : '';
    // Encaixe exige CONFIRMAÇÃO EXPLÍCITA: sem `confirmFitIn`, o servidor
    // devolve a lista de conflitos e NÃO grava nada. A tela mostra com quem
    // está batendo e só então reenvia com a confirmação.
    if (body.bookingKind === 'fit_in' && body.confirmFitIn !== true) {
      const allPros = db.professionals.filter((p) => p.businessId === business.id);
      const conflicts = fitInConflictsFromDB({
        bookings: db.bookings.filter((b) => b.businessId === business.id),
        services: db.services.filter((x) => x.businessId === business.id),
        professionals: allPros.filter((p) => p.active !== false).map((p) => ({ id: p.id, name: p.name })),
      }, {
        date, time, durationMin: service.durationMin,
        professionalId: (guard?.ok ? guard.ctx.professionalScope : '') || String(body.professionalId || ''),
        eligibleProIds: slotEligibleProfessionalIds(service as any, allPros),
      });
      if (conflicts.length > 0) {
        return NextResponse.json({
          error: fitInWarning(conflicts),
          code: 'fit_in_conflict',
          conflicts,
        }, { status: 409 });
      }
    }
    if (body.series && body.preview === true) {
      return NextResponse.json({ occurrences: previewSeries(db, params, body.series.occurrences, scope) });
    }
    const result = await updateDB((d: DB) => body.series
      ? createSeriesTx(d, params, body.series.occurrences, body.series.requestId, scope)
      : createBookingTx(d, params));
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[bookings] POST falhou:', e);
    return NextResponse.json({
      error: status === 500 ? 'Não foi possível confirmar. Tente novamente.' : e.message,
      ...(e?.occurrences ? { occurrences: e.occurrences } : {}),
      ...(e?.conflicts ? { conflicts: e.conflicts, code: 'fit_in_conflict' } : {}),
    }, { status });
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

    // ── CHECK-IN do cliente no balcão (Workflow: Agendado ⇄ Chegou) ──
    // Autoridade única: lib/appointment-workflow-tx. Não muda o STATUS do
    // Booking (chegar não é conclusão); grava instante, autor, histórico e
    // auditoria. Repetir é idempotente; etapa inválida é recusada com motivo.
    if (body.action === 'check-in' || body.action === 'check-in-undo') {
      const r = await updateDB((d: DB) => transitionAppointment(d, {
        ctx: guard.ctx, businessId: business.id, bookingId: String(body.id || ''),
        command: { kind: body.action === 'check-in' ? 'check_in' : 'check_in_undo' },
      }));
      void Promise.all(r.events.map(publishWorkflowEvent));
      return NextResponse.json({
        ok: true, checkedInAt: r.booking.checkedInAt || '', checkedInByName: r.booking.checkedInByName || '',
        workflow: workflowForBooking(await readDB(), business.id, r.booking, guard.ctx),
      });
    }

    if (body.action === 'cancel-series-future') {
      if (!current.seriesId) return NextResponse.json({ error: 'Agendamento sem série.' }, { status: 400 });
      const result = await updateDB((d) => cancelFutureSeriesTx(d, business.id, current.seriesId!, guard.ctx.professionalScope));
      return NextResponse.json({ ok: true, ...result });
    }

    // ── Remarcação pelo dono ──
    if ((body.date && body.time) || body.resizeEnd !== undefined) {
      const resizing = body.resizeEnd !== undefined;
      if (!resizing && (body.durationMin !== undefined || body.startAt !== undefined || body.endAt !== undefined)) {
        return NextResponse.json({ error: 'Informe somente a nova data e horário.' }, { status: 400 });
      }
      const date = String(resizing ? current.date : body.date);
      const time = String(resizing ? current.time : body.time);
      if (resizing && (!isValidClockTime(String(body.resizeEnd)) || body.date || body.time || body.durationMin !== undefined || body.startAt || body.endAt || body.professionalId)) {
        return NextResponse.json({ error: 'Informe somente o novo fim do atendimento.' }, { status: 400 });
      }
      if (!isValidDateISO(date) || !isValidClockTime(time)) {
        return NextResponse.json({ error: 'Escolha data e horário.' }, { status: 400 });
      }
      const patchTz = effectiveTimezone(business.businessTimezone); // A2-B5 (F9)
      const today = todayISO(new Date(), patchTz);
      const maxDate = bookingMaxDate(today, business.booking, true);
      if (date < today) return NextResponse.json({ error: 'Não é possível remarcar para o passado.' }, { status: 400 });
      if (date > maxDate) return NextResponse.json({ error: 'Data fora da agenda disponível.' }, { status: 400 });
      const service = db.services.find((s) => s.id === current.serviceId && s.businessId === business.id);
      if (!service) return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 400 });
      // Escopo do profissional: remarcação permanece com ele (nunca move o
      // atendimento para outro profissional sem permissão administrativa).
      if (guard.ctx.professionalScope && body.professionalId && body.professionalId !== guard.ctx.professionalScope) {
        return NextResponse.json({ error: 'Você só pode reagendar para o seu profissional.' }, { status: 403 });
      }
      const proId = guard.ctx.professionalScope || (resizing ? current.professionalId : String(body.professionalId || ''));
      const activePros = db.professionals.filter((p) => p.businessId === business.id && p.active !== false);
      const eligible = eligibleIdsForService(service as any, activePros).map(id => activePros.find(p=>p.id===id)!).filter(Boolean);
      if (proId && !eligible.some((p) => p.id === proId)) {
        return NextResponse.json({ error: 'Profissional indisponível para este serviço.' }, { status: 400 });
      }
      const decision = rescheduleDecision(current.status);
      const result = await updateDB((d: DB) => {
        const target = d.bookings.find((x) => x.id === body.id && x.businessId === business.id);
        if (!target) throw err('Agendamento não encontrado.', 404);
        if (!canAccessBooking(guard.ctx, target)) throw err('Você só pode alterar os seus próprios atendimentos.', 403);
        // Workflow: atendimento EM ANDAMENTO não é remarcado (finalize antes).
        if (bookingWorkflowState(d, business.id, target) === 'in_care') {
          throw err('Atendimento em andamento: finalize o atendimento antes de reagendar.', 409);
        }
        // O próprio atendimento não bloqueia o novo horário; atendimentos
        // terminais recriados também não (ficam no histórico, não na grade).
        const freshBusiness = d.businesses.find((b) => b.id === business.id)!;
        const freshService = d.services.find((s) => s.id === target.serviceId && s.businessId === business.id && s.active !== false);
        if (!freshService) throw err('Serviço indisponível.', 400);
        if (resizing && target.professionalId !== proId) throw err('Profissional alterado. Recarregue a agenda.', 409);
        const freshTz = effectiveTimezone(freshBusiness.businessTimezone);
        const freshToday = todayISO(new Date(), freshTz);
        if (date < freshToday || date > bookingMaxDate(freshToday, freshBusiness.booking, true)) throw err('Data fora da agenda disponível.', 400);
        const decision = rescheduleDecision(target.status);
        if (resizing && (decision.kind === 'recreate' || target.date !== date || target.time !== time)) {
          throw err('Esse atendimento não pode ter a duração alterada.', 409);
        }
        const resizedDuration = resizing ? timeToMin(String(body.resizeEnd)) - timeToMin(target.time) : 0;
        if (resizing && (resizedDuration < 5 || resizedDuration > 720 || resizedDuration % 5 !== 0)) {
          throw err('Escolha um fim válido, em intervalos de 5 minutos.', 400);
        }
        // Move preserva a duração do próprio Booking; somente recreate é um
        // NOVO Booking e usa o default atual do serviço. Também validar o
        // destino com essa duração para não aceitar um slot que não a comporta.
        const destinationDuration = resizing ? resizedDuration : decision.kind === 'recreate'
          ? freshService.durationMin
          : bookingDurationOf(target, freshService);
        const others = d.bookings.filter((b) => b.businessId === business.id && b.id !== body.id);
        const r = computeSlots({
          rules: d.availability.filter((a) => a.businessId === business.id),
          exceptions: d.exceptions.filter((e) => e.businessId === business.id),
          bookings: others,
          services: d.services.filter((s) => s.businessId === business.id),
          professionals: d.professionals.filter((p) => p.businessId === business.id),
          dateISO: date, weekday: weekdayOf(date),
          serviceId: freshService.id, durationMin: destinationDuration, startStepMin: 5,
          professionalId: proId,
          eligibleProIds: slotEligibleProfessionalIds(freshService as any, d.professionals.filter((p) => p.businessId === business.id)),
          nowHM: date === freshToday ? nowHM(new Date(), freshTz) : '',
          leadMin: freshBusiness.booking?.leadMin || 0,
          bufferMin: freshBusiness.booking?.bufferMin || 0, bufferBeforeMin: freshBusiness.booking?.bufferBeforeMin, bufferAfterMin: freshBusiness.booking?.bufferAfterMin,
          blocks: d.scheduleBlocks, resources: d.scheduleResources, businessId: business.id, preferredResourceIds: target.resourceIds,
          candidateBufferBeforeMin: decision.kind === 'recreate' ? undefined : target.bufferBeforeMin,
          candidateBufferAfterMin: decision.kind === 'recreate' ? undefined : target.bufferAfterMin,
          timeZone: freshTz,
        });
        if (!r.slots.includes(time)) throw err('Este horário está ocupado. Escolha outro.', 409);
        const destinationPro = resizing ? target.professionalId : proId || r.assign[time] || target.professionalId || '';
        const pair = bufferPair(freshService, freshBusiness.booking);
        if (decision.kind !== 'recreate') {
          pair.before = target.bufferBeforeMin ?? pair.before;
          pair.after = target.bufferAfterMin ?? pair.after;
        }
        const destinationWindow = buildBookingWindow({ date, time, durationMin: destinationDuration, timeZone: freshTz });
        const occupationStart = Date.parse(destinationWindow.startAt) - pair.before * 60000;
        const occupationEnd = Date.parse(destinationWindow.endAt) + pair.after * 60000;
        const resources = assignResources({
          requirements: freshService.resourceRequirements || [], resources: d.scheduleResources,
          services: d.services, bookingConfig: freshBusiness.booking,
          bookings: others, blocks: d.scheduleBlocks, businessId: business.id,
          start: occupationStart, end: occupationEnd, preferred: target.resourceIds,
        });
        if (!resources || blockConflict(d.scheduleBlocks, business.id, destinationPro, resources, occupationStart, occupationEnd)) throw err('Bloqueio ou recurso ocupado.', 409);
        // Agenda Temporal 2.0 (B1): o novo horário nasce como NOVA janela
        // canônica (instantes + snapshot + fuso), validada no fuso da clínica.
        let rescheduleWindow: BookingWindow;
        try {
          rescheduleWindow = buildBookingWindow({
            date, time, durationMin: destinationDuration, timeZone: freshTz,
          });
        } catch (e: any) {
          throw err(e?.message || 'Horário inválido para o fuso da clínica.', 400);
        }
        const now = new Date().toISOString();
        const note = resizing ? `Duração alterada: ${bookingDurationOf(target, freshService)} → ${destinationDuration} min`
          : rescheduleNote({ date: target.date, time: target.time }, { date, time });

        if (decision.kind === 'recreate') {
          // Estado terminal (concluído/faltou/cancelado): o registro antigo
          // PERMANECE como está e um NOVO atendimento futuro é criado.
          // Agenda Temporal 2.0: o registro antigo mantém a janela histórica
          // (legado sem instantes é congelado AGORA para não se mover depois
          // quando o serviço for editado); o novo recebe a janela nova.
          freezeLegacyBookingWindow(target, { timeZone: freshTz, serviceDurationMin: freshService.durationMin });
          const newId = randomUUID();
          d.bookings.push({
            id: newId, businessId: business.id, customerId: target.customerId || '',
            serviceId: target.serviceId,
            professionalId: destinationPro,
            bufferBeforeMin: pair.before, bufferAfterMin: pair.after, resourceIds: resources,
            ...bookingWindowFields(rescheduleWindow, freshTz),
            customerName: target.customerName, customerPhone: target.customerPhone,
            status: decision.nextStatus, note: target.note || '', answers: target.answers || [],
            createdAt: now, updatedAt: now,
            previousId: target.id,
            seriesId: target.seriesId, seriesIndex: target.seriesIndex, seriesCount: target.seriesCount,
            seriesRequestId: target.seriesRequestId, seriesFingerprint: target.seriesFingerprint,
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
          // A falta/cancelamento já tem novo horário: a pendência "reagendar" fecha.
          closeWorkflowTaskTx(d, business.id, target.id, now);
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
          emitAutomationEvent(d, {
            event: 'booking.rescheduled',
            businessId: business.id,
            at: now,
            bookingId: newId,
            leadId: target.leadId || undefined,
            customerId: target.customerId || undefined,
            data: { previousId: target.id, fromDate: target.date, fromTime: target.time, date, time, kind: 'recreate' },
          });
          return { created: true, newId };
        }

        // pending/confirmed: move o MESMO atendimento, mantendo o status.
        // A janela canônica é reescrita atomicamente para o novo horário.
        const fromDate = target.date;
        const fromTime = target.time;
        // Se ainda é legado, congele a inferência ANTES de trocar a janela.
        // A duração usada no destino foi resolvida a partir desse mesmo
        // snapshot/fallback (não do default do serviço para Booking canônico).
        freezeLegacyBookingWindow(target, { timeZone: freshTz, serviceDurationMin: freshService.durationMin });
        applyBookingWindow(target, rescheduleWindow, freshTz);
        target.bufferBeforeMin = pair.before; target.bufferAfterMin = pair.after; target.resourceIds = resources;
        // Um resize mantém a chegada/check-in; somente move muda a chegada.
        let queueChanged = false;
        if (!resizing) {
          // Novo horário = nova chegada: o check-in do horário antigo não vale.
          target.checkedInAt = undefined;
          target.checkedInBy = undefined;
          target.checkedInByName = undefined;
          for (const q of d.queue || []) {
            if (q.businessId === business.id && q.bookingId === target.id && (q.status === 'waiting' || q.status === 'called')) {
              q.status = 'left'; q.endedAt = now; q.updatedAt = now; queueChanged = true;
            }
          }
        }
        // Profissional do destino: o escolhido explicitamente vence. Sem
        // escolha, usa o profissional LIVRE retornado pela validação (em equipe
        // o horário pode estar livre só para outra pessoa). Manter o profissional
        // anterior quando ele está ocupado criaria um conflito silencioso.
        target.professionalId = resizing ? target.professionalId : proId || r.assign[time] || target.professionalId || '';
        target.updatedAt = now;
        target.history.push({ at: now, from: target.status, to: decision.nextStatus, by: 'owner', note });
        if (target.status !== decision.nextStatus) target.status = decision.nextStatus;
        // A2-B3 (F7.2): a nota da esteira ("Agendado para …") acompanha a
        // remarcação — sem nota stale apontando para o dia antigo.
        if (!resizing) noteLeadReschedule(d, {
          businessId: business.id, leadId: target.leadId,
          from: { date: fromDate, time: fromTime }, to: { date, time },
          by: 'owner', now,
        });
        if (!resizing) emitAutomationEvent(d, {
          event: 'booking.rescheduled',
          businessId: business.id,
          at: now,
          bookingId: target.id,
          leadId: target.leadId || undefined,
          customerId: target.customerId || undefined,
          data: { previousId: target.id, fromDate, fromTime, date, time, kind: 'move' },
        });
        // Minimal mutation echo for the Agenda's local state. The server owns
        // all fields; no speculative client reconstruction or cross-tenant data.
        const booking: Partial<Booking> & Pick<Booking, 'id'> = {
          id: target.id, date: target.date, time: target.time,
          startAt: target.startAt, endAt: target.endAt, durationMin: target.durationMin,
          timeZone: target.timeZone, temporalSource: target.temporalSource,
          professionalId: target.professionalId, resourceIds: target.resourceIds, bufferBeforeMin: target.bufferBeforeMin, bufferAfterMin: target.bufferAfterMin, status: target.status,
          checkedInAt: target.checkedInAt, checkedInBy: target.checkedInBy,
          checkedInByName: target.checkedInByName, updatedAt: target.updatedAt,
          history: target.history,
          workflow: workflowForBooking(d, business.id, target, guard.ctx),
        };
        return { created: false, newId: target.id, resized: resizing, booking, queueChanged };
      });
      return NextResponse.json({ ok: true, ...result, moved: decision.kind === 'move', reason: decision.reason });
    }

    // ── Transição de status (cancelar · faltou · concluir · confirmar · reabrir) ──
    // Passa pelo WORKFLOW (etapa × papel × escopo) e, dentro dele, pela FUNÇÃO
    // OFICIAL de status (lib/booking-status.ts, a mesma da automação).
    const to = String(body.status || '') as BookingStatus;
    if (!['pending', 'confirmed', 'completed', 'cancelled', 'no_show'].includes(to)) {
      return NextResponse.json({ error: 'Status inválido.' }, { status: 400 });
    }
    const applied = await updateDB((d) => {
      const r = transitionAppointment(d, {
        ctx: guard.ctx, businessId: business.id, bookingId: String(body.id || ''),
        command: { kind: 'status', to }, note: body.note ? String(body.note) : undefined,
      });
      // A2-B3 (F6): lembretes vencidos nascem na ESCRITA (idempotente por
      // agendamento) — o GET manage parou de ter efeito colateral.
      try { enqueueDueReminders(d, business.id, todayISO(new Date(), effectiveTimezone(business.businessTimezone))); } catch { /* melhor-esforço */ }
      return r;
    });
    void Promise.all(applied.events.map(publishWorkflowEvent));
    return NextResponse.json({
      ok: true, status: applied.booking.status,
      workflow: workflowForBooking(await readDB(), business.id, applied.booking, guard.ctx),
    });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[bookings] PATCH falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível atualizar.' : e.message }, { status });
  }
}
