// ═══════════════════════════════════════════════════════════════
// COSTURA DO MODO RELACIONAL nas rotas de agendamento.
// ═══════════════════════════════════════════════════════════════
// Quando GODOUTOR_PERSISTENCE !== 'relational' (padrão), TODAS as funções
// abaixo devolvem `null` e a rota segue pelo motor de documento —
// comportamento atual preservado byte a byte.
//
// No modo relacional, a AUTENTICAÇÃO e as PERMISSÕES continuam exatamente as
// de hoje (lib/access — que, neste modo, consulta o SQL; ver access.ts). O que
// muda é ONDE os dados da agenda são lidos/gravados: a fatia DA UNIDADE é
// carregada dentro da transação e as REGRAS continuam sendo os motores
// canônicos (createBookingTx, createSeriesTx, applyBookingStatusTx,
// noteLeadReschedule, enqueueDueReminders) — nenhuma regra foi reescrita em
// SQL. Consultas específicas por unidade, transação única, sem documento.
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { relationalActive } from './config';
import { runRelationalWrite, bookingOpSpec } from './slice';
import { onlyDigits } from '../utils';
import { dayMap, listBookingsManage, slotsForDate } from './agenda';
import { resolveBookingIdentity, createBookingTx, type CreateBookingParams } from '../booking-create';
import { previewSeries, createSeriesTx, cancelFutureSeriesTx } from '../booking-series';
import { scopeInfo, canAccessBooking, type AccessContext } from '../access-core';
import { isFeatureEnabled, canBook as canBookModule } from '../features';
import {
  bookingDuration, bookingMaxDate, rescheduleDecision, rescheduleForwardNote, rescheduleNote,
} from '../booking-ops';
import { applyBookingStatusTx } from '../booking-status';
import { computeSlots } from '../slots';
import { enqueueDueReminders } from '../automations';
import { upsertContact } from '../contacts';
import { noteLeadReschedule } from '../pipeline';
import { fitInConflictsFromDB, fitInWarning } from '../fit-in';
import { pushAudit } from '../audit';
import type { BookingStatus } from '../types';
import { effectiveTimezone, isValidDateISO, isValidClockTime, nowHM, todayISO, weekdayOf } from '../tz';

export { relationalActive } from './config';

const errJson = (message: string, status: number, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error: message, ...extra }, { status });

function txErr(message: string, status: number): never {
  throw Object.assign(new Error(message), { status });
}

// ── GET: slots do dia, mapa de dias e lista de gestão ─────────────────────
export async function relationalBookingsGET(
  q: URLSearchParams,
  businessId: string,
  slotGuardCtx: AccessContext | null,
): Promise<NextResponse | null> {
  if (!relationalActive()) return null;
  const { getPool } = await import('./pool');
  const pool = getPool();
  const mode = q.get('mode');

  // Lista de gestão: período + escopo do profissional NO SQL, paginação real.
  if (mode === 'manage') {
    const result = await listBookingsManage(pool, {
      businessId,
      from: q.get('from') || undefined,
      to: q.get('to') || undefined,
      professionalScope: slotGuardCtx?.professionalScope || undefined,
      page: Math.max(1, Number(q.get('page')) || 1),
      limit: Number(q.get('limit')) || undefined,
    });
    if (!result) return errJson('Negócio não encontrado.', 404);
    const biz = await pool.query('SELECT modes, features FROM app.businesses WHERE id = $1', [businessId]);
    const core = { modes: biz.rows[0]?.modes || [], features: biz.rows[0]?.features || {} };
    return NextResponse.json({
      bookings: result.bookings,
      total: result.total, page: result.page, limit: result.limit,
      ...(result.limitCapped ? { limitCapped: true, requestedLimit: result.requestedLimit } : {}),
      today: result.today,
      needsClosure: result.needsClosure,
      modules: { bookings: isFeatureEnabled(core, 'bookings') },
      scope: slotGuardCtx ? scopeInfo(slotGuardCtx) : undefined,
    });
  }

  const svc = q.get('serviceId') || '';
  // Verificações espelhadas do caminho do documento: serviço da unidade,
  // escopo de profissional e módulo de agendamentos.
  const bizRes = await pool.query(
    'SELECT id, modes, features, booking, business_timezone FROM app.businesses WHERE id = $1',
    [businessId],
  );
  if (bizRes.rows.length === 0) return errJson('Negócio não encontrado.', 404);
  const core = { modes: bizRes.rows[0].modes || [], features: bizRes.rows[0].features || {}, booking: bizRes.rows[0].booking || {}, businessTimezone: bizRes.rows[0].business_timezone };
  const svcRes = await pool.query(
    `SELECT id, business_id, name, description, image, price, show_price, duration_min,
            professional_ids, active, featured, bookable, questions
       FROM app.services WHERE id = $1 AND business_id = $2`,
    [svc, businessId],
  );
  if (svcRes.rows.length === 0) return NextResponse.json({ slots: [] });
  const scope = slotGuardCtx?.professionalScope || '';
  const requestedPro = q.get('professionalId') || '';
  if (scope && requestedPro && requestedPro !== scope) {
    return errJson('Você só pode consultar o seu profissional.', 403);
  }
  const requestedProfessionalId = scope || requestedPro;
  if (!isFeatureEnabled(core, 'bookings')) {
    return NextResponse.json({ slots: [], closed: true, moduleOff: true });
  }

  const from = q.get('from') || '';
  const to = q.get('to') || '';
  if (isValidDateISO(from) && isValidDateISO(to)) {
    const map = await dayMap(pool, {
      businessId, serviceId: svc, from, to,
      professionalId: requestedProfessionalId, isAdmin: !!slotGuardCtx,
    });
    if (!map.ok) return map.reason === 'not_found' ? errJson('Negócio não encontrado.', 404) : errJson('Janela inválida.', 400);
    return NextResponse.json({ days: map.days, today: map.today });
  }

  const date = q.get('date') || '';
  const outcome = await slotsForDate(pool, {
    businessId, serviceId: svc, date,
    professionalId: requestedProfessionalId, isAdmin: !!slotGuardCtx,
  });
  if (!outcome.ok) {
    if (outcome.reason === 'bad_professional') return errJson('Profissional indisponível para este serviço.', 400);
    return NextResponse.json({ slots: [], closed: true });
  }
  return NextResponse.json({
    slots: outcome.result.slots,
    occupied: outcome.result.occupied,
    closed: outcome.result.closed,
    ...(outcome.result.closedReason ? { closedReason: outcome.result.closedReason } : {}),
    assign: outcome.result.assign,
    byProfessional: outcome.result.byProfessional,
    today: outcome.today,
    maxDate: outcome.maxDate,
  });
}

// ── POST: criação de agendamento — motor canônico sobre a fatia ───────────
export interface RelationalPostInput {
  body: Record<string, unknown>;
  businessId: string;
  isOwner: boolean;
  actorProfessionalScope: string; // escopo do profissional (P2)
  sessionCustomer: { id: string; name: string; phone: string; email?: string } | null;
}

export async function relationalBookingsPOST(
  input: RelationalPostInput,
): Promise<NextResponse | null> {
  if (!relationalActive()) return null;
  const body = input.body;
  const isOwner = input.isOwner;
  const scope = input.actorProfessionalScope;

  try {
    // Carregamento DIRECIONADO (bloqueio de desempenho): a transação carrega
    // só o que a criação/série lê — catálogo da unidade, agendamentos da
    // JANELA das ocorrências (conflito) e identidades candidatas do cliente.
    const seriesRaw = body.series as { occurrences?: unknown } | undefined;
    const occDates = Array.isArray(seriesRaw?.occurrences)
      ? (seriesRaw!.occurrences as Array<{ date?: unknown }>).map((o) => String(o?.date || '')).filter(Boolean)
      : [];
    const opDate = String(body.date || '');
    const dateFrom = occDates.length ? occDates.reduce((a, b) => (a < b ? a : b)) : opDate;
    const dateTo = occDates.length ? occDates.reduce((a, b) => (a > b ? a : b)) : opDate;
    const load = bookingOpSpec({
      dateFrom, dateTo,
      phones: [onlyDigits(String(body.customerPhone || '')), input.sessionCustomer?.phone || ''],
      emails: [String(body.customerEmail || '')],
      contactId: isOwner ? String(body.contactId || '') : '',
      leadId: body.leadId ? String(body.leadId) : '',
      customerId: input.sessionCustomer?.id || '',
    });
    const result = await runRelationalWrite(input.businessId, (db) => {
      const business = db.businesses.find((b) => b.id === input.businessId);
      if (!business) txErr('Negócio não encontrado.', 404);
      const biz = business; // TS: estreita após o throw acima

      // MÓDULO: agendamento desativado não aceita reserva pública nenhuma.
      if (!isFeatureEnabled(biz, 'bookings')) {
        txErr('Este negócio não está aceitando agendamentos no momento.', 403);
      }

      const service = db.services.find(
        (sv) => sv.id === String(body.serviceId || '') && sv.businessId === biz.id && sv.active,
      );
      if (!service) txErr('Serviço indisponível.', 400);
      if (isOwner && !canBookModule(biz, [service])) {
        txErr('Serviço sem agendamento disponível.', 400);
      }
      if (!isOwner && !service.bookable) txErr('Este serviço não aceita agendamento.', 400);

      const date = String(body.date || '');
      const time = String(body.time || '');
      if (!isValidDateISO(date) || !isValidClockTime(time)) txErr('Escolha data e horário.', 400);
      const btz = effectiveTimezone(biz.businessTimezone);
      const today = todayISO(new Date(), btz);
      const maxDate = bookingMaxDate(today, biz.booking, isOwner);
      if (date < today) txErr('Não é possível agendar no passado.', 400);
      if (date > maxDate) txErr('Data fora da agenda disponível.', 400);

      // CRM primeiro: painel escolhe um CONTATO existente da UNIDADE.
      const linkedContact = isOwner && body.contactId
        ? db.contacts.find((c) => c.id === String(body.contactId) && c.businessId === biz.id)
        : undefined;

      // ── Identidade: MESMA regra única do servidor ──
      const identity = resolveBookingIdentity({
        isOwner,
        sessionCustomer: input.sessionCustomer,
        body: { customerName: body.customerName, customerPhone: body.customerPhone, customerEmail: body.customerEmail },
        linked: isOwner && linkedContact
          ? { name: linkedContact.name, phone: linkedContact.phone, email: linkedContact.email || '' }
          : null,
      });
      if (!identity.ok) {
        throw Object.assign(new Error(identity.error), {
          status: identity.code === 'login_required' ? 401 : 400,
          code: identity.code,
        });
      }
      const name = identity.name;
      const digits = identity.phoneDigits;
      if (!name) txErr('Informe o nome do cliente.', 400);
      if (digits.length < 10) {
        if (identity.source !== 'owner') {
          throw Object.assign(new Error('Precisamos do seu WhatsApp para confirmar.'), { status: 400, code: 'phone_required' });
        }
        txErr('Informe um WhatsApp válido.', 400);
      }
      const email = identity.email || linkedContact?.email || input.sessionCustomer?.email || '';
      const marketingOptIn = !isOwner && body.marketingOptIn === true;

      if (body.series && !isOwner) txErr('Recorrência exige permissão de Agenda.', 403);
      if (body.bookingKind === 'fit_in' && !isOwner) txErr('Encaixe é uma decisão da equipe.', 403);
      if (body.bookingKind === 'fit_in' && body.series) txErr('Encaixe não cria série.', 400);
      if (scope && body.professionalId && body.professionalId !== scope) {
        txErr('Você só pode agendar para o seu profissional.', 403);
      }

      const params: CreateBookingParams = {
        business: biz,
        service,
        date,
        time,
        actor: isOwner ? 'owner' : 'customer',
        customer: {
          id: input.sessionCustomer?.id || (linkedContact as any)?.customerId || '',
          name,
          phone: digits,
          email,
        },
        linkedContact: isOwner && linkedContact
          ? {
            id: linkedContact.id, name: linkedContact.name, phone: linkedContact.phone,
            email: linkedContact.email || '', customerId: (linkedContact as any).customerId || '',
          }
          : null,
        professionalId: scope || String(body.professionalId || ''),
        note: typeof body.note === 'string' ? body.note : undefined,
        answers: Array.isArray(body.answers) ? (body.answers as unknown[]).map(String) : undefined,
        marketingOptIn,
        source: body.bookingKind === 'fit_in' ? 'encaixe' : 'agendamento',
        leadId: body.leadId ? String(body.leadId) : undefined,
        bookingKind: body.bookingKind === 'fit_in' ? 'fit_in' : undefined,
        fitInConfirmed: body.confirmFitIn === true,
      };

      // Encaixe exige CONFIRMAÇÃO EXPLÍCITA: sem ela, devolve os conflitos.
      if (body.bookingKind === 'fit_in' && body.confirmFitIn !== true) {
        const conflicts = fitInConflictsFromDB({
          bookings: db.bookings.filter((b) => b.businessId === biz.id),
          services: db.services.filter((x) => x.businessId === biz.id),
          professionals: db.professionals.filter((p) => p.businessId === biz.id && p.active !== false).map((p) => ({ id: p.id, name: p.name })),
        }, {
          date, time, durationMin: service.durationMin,
          professionalId: scope || String(body.professionalId || ''),
          eligibleProIds: service.professionalIds || [],
        });
        if (conflicts.length > 0) {
          throw Object.assign(new Error(fitInWarning(conflicts)), { status: 409, code: 'fit_in_conflict', conflicts });
        }
      }

      const seriesInput = body.series as { occurrences?: unknown; requestId?: unknown } | undefined;
      if (seriesInput && body.preview === true) {
        return { preview: previewSeries(db, params, seriesInput.occurrences, scope) };
      }
      return seriesInput
        ? { result: createSeriesTx(db, params, seriesInput.occurrences, seriesInput.requestId, scope) }
        : { result: createBookingTx(db, params) };
    }, { load });

    if ((result as any).preview) {
      return NextResponse.json({ occurrences: (result as any).preview });
    }
    return NextResponse.json({ ok: true, ...(result as any).result });
  } catch (e: any) {
    if (e?.status && e.status !== 500) {
      return errJson(e.message, e.status, {
        ...(e.code ? { code: e.code } : {}),
        ...(e.occurrences ? { occurrences: e.occurrences } : {}),
        ...(e.conflicts ? { conflicts: e.conflicts, code: 'fit_in_conflict' } : {}),
      });
    }
    throw e;
  }
}

// ── PATCH: check-in, série, remarcação e status — motores canônicos ───────
export interface RelationalPatchInput {
  body: Record<string, unknown>;
  ctx: AccessContext;
}

export async function relationalBookingsPATCH(
  input: RelationalPatchInput,
): Promise<NextResponse | null> {
  if (!relationalActive()) return null;
  const { body, ctx } = input;
  const businessId = ctx.business.id;
  const guardCtx = { professionalScope: ctx.professionalScope };

  try {
    // Carregamento DIRECIONADO por variante do PATCH: check-in (o alvo),
    // cancelar série (a série inteira), remarcar (alvo + janela do novo dia),
    // status (alvo + hoje/amanhã para os lembretes devidos).
    const targetId = String(body.id || '');
    const tzOf = effectiveTimezone(ctx.business.businessTimezone);
    const todayD = todayISO(new Date(), tzOf);
    const tomorrowD = (function plusOne(iso: string) {
      const d = new Date(`${iso}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    })(todayD);
    let load;
    if (body.action === 'cancel-series-future') {
      load = bookingOpSpec({ bookingIds: [targetId], seriesOfBookingId: targetId });
    } else if (body.action === 'check-in' || body.action === 'check-in-undo') {
      load = bookingOpSpec({ bookingIds: [targetId] });
    } else if (body.date && body.time) {
      load = bookingOpSpec({ bookingIds: [targetId], dateFrom: String(body.date), dateTo: String(body.date) });
    } else {
      load = bookingOpSpec({ bookingIds: [targetId], dateFrom: todayD, dateTo: tomorrowD });
    }
    const result = await runRelationalWrite(businessId, (db) => {
      const business = db.businesses.find((b) => b.id === businessId)!;
      const current = db.bookings.find((x) => x.id === String(body.id || '') && x.businessId === businessId);
      if (!current) txErr('Agendamento não encontrado.', 404);
      if (!canAccessBooking(guardCtx, current)) {
        txErr('Você só pode alterar os seus próprios atendimentos.', 403);
      }

      // ── CHECK-IN do balcão (reversível, auditado) ──
      if (body.action === 'check-in' || body.action === 'check-in-undo') {
        const undo = body.action === 'check-in-undo';
        const nowIso = new Date().toISOString();
        const target = db.bookings.find((x) => x.id === current.id)!;
        if ((target as any).status && isTerminal(target.status)) {
          txErr('Atendimento encerrado não recebe check-in.', 400);
        }
        if (undo) {
          if (!(target as any).checkedInAt) txErr('Este atendimento não tem check-in registrado.', 400);
          (target as any).checkedInAt = undefined;
          (target as any).checkedInBy = undefined;
          (target as any).checkedInByName = undefined;
          target.updatedAt = nowIso;
          target.history.push({ at: nowIso, from: target.status, to: target.status, by: 'owner', note: 'Check-in desfeito no balcão' });
          pushAudit(db, {
            action: 'booking.checkin_undo', businessId,
            actor: ctx.user, meta: { bookingId: target.id, date: target.date, time: target.time },
          }, nowIso);
          return { checkedInAt: '', checkedInByName: '' };
        }
        if (!(target as any).checkedInAt) {
          (target as any).checkedInAt = nowIso;
          (target as any).checkedInBy = ctx.user.id;
          (target as any).checkedInByName = ctx.user.name || ctx.user.email || 'Equipe';
          target.updatedAt = nowIso;
          target.history.push({ at: nowIso, from: target.status, to: target.status, by: 'owner', note: `Check-in às ${nowHM(new Date(), effectiveTimezone(business.businessTimezone))}` });
          pushAudit(db, {
            action: 'booking.checkin', businessId,
            actor: ctx.user, meta: { bookingId: target.id, date: target.date, time: target.time },
          }, nowIso);
        }
        return {
          checkedInAt: (target as any).checkedInAt || '',
          checkedInByName: (target as any).checkedInByName || '',
        };
      }

      if (body.action === 'cancel-series-future') {
        if (!current.seriesId) txErr('Agendamento sem série.', 400);
        return cancelFutureSeriesTx(db, businessId, current.seriesId, ctx.professionalScope);
      }

      // ── Remarcação ──
      if (body.date && body.time) {
        const date = String(body.date);
        const time = String(body.time);
        if (!isValidDateISO(date) || !isValidClockTime(time)) txErr('Escolha data e horário.', 400);
        const patchTz = effectiveTimezone(business.businessTimezone);
        const today = todayISO(new Date(), patchTz);
        const maxDate = bookingMaxDate(today, business.booking, true);
        if (date < today) txErr('Não é possível remarcar para o passado.', 400);
        if (date > maxDate) txErr('Data fora da agenda disponível.', 400);
        const service = db.services.find((sv) => sv.id === current.serviceId && sv.businessId === businessId);
        if (!service) txErr('Serviço indisponível.', 400);
        if (ctx.professionalScope && body.professionalId && body.professionalId !== ctx.professionalScope) {
          txErr('Você só pode reagendar para o seu profissional.', 403);
        }
        const proId = ctx.professionalScope || String(body.professionalId || '');
        const activePros = db.professionals.filter((p) => p.businessId === businessId && p.active !== false);
        const eligible = (service.professionalIds || []).length > 0
          ? activePros.filter((p) => (service.professionalIds || []).includes(p.id))
          : activePros;
        if (proId && !eligible.some((p) => p.id === proId)) {
          txErr('Profissional indisponível para este serviço.', 400);
        }
        const decision = rescheduleDecision(current.status);
        const target = db.bookings.find((x) => x.id === current.id)!;
        const others = db.bookings.filter((bk) => bk.businessId === businessId && bk.id !== current.id);
        const r = computeSlots({
          rules: db.availability.filter((a) => a.businessId === businessId),
          exceptions: db.exceptions.filter((e) => e.businessId === businessId),
          bookings: others,
          services: db.services.filter((sv) => sv.businessId === businessId),
          professionals: db.professionals.filter((p) => p.businessId === businessId),
          dateISO: date, weekday: weekdayOf(date),
          serviceId: service.id, durationMin: service.durationMin,
          professionalId: proId,
          eligibleProIds: service.professionalIds || [],
          nowHM: date === today ? nowHM(new Date(), patchTz) : '',
          leadMin: business.booking?.leadMin || 0,
          bufferMin: business.booking?.bufferMin || 0,
        });
        if (!r.slots.includes(time)) txErr('Este horário está ocupado. Escolha outro.', 409);
        const now = new Date().toISOString();
        const note = rescheduleNote({ date: target.date, time: target.time }, { date, time });

        if (decision.kind === 'recreate') {
          // Estado terminal: registro antigo permanece; novo atendimento futuro.
          const newId = randomUUID();
          db.bookings.push({
            id: newId, businessId, customerId: target.customerId || '',
            serviceId: target.serviceId,
            professionalId: proId || r.assign[time] || target.professionalId || '',
            date, time,
            customerName: target.customerName, customerPhone: target.customerPhone,
            status: decision.nextStatus, note: target.note || '', answers: target.answers || [],
            createdAt: now, updatedAt: now,
            previousId: target.id,
            seriesId: target.seriesId, seriesIndex: target.seriesIndex, seriesCount: target.seriesCount,
            seriesRequestId: target.seriesRequestId, seriesFingerprint: target.seriesFingerprint,
            rescheduleCount: (target.rescheduleCount || 0) + 1,
            history: [{ at: now, from: '', to: decision.nextStatus, by: 'owner', note }],
            leadId: target.leadId || undefined,
          } as any);
          target.history.push({ at: now, from: target.status, to: target.status, by: 'owner', note: rescheduleForwardNote({ date, time }) });
          target.updatedAt = now;
          if (target.leadId) {
            const lead = db.leads.find((l) => l.id === target.leadId && l.businessId === businessId);
            if (lead) lead.bookingId = newId;
          }
          noteLeadReschedule(db, {
            businessId, leadId: target.leadId,
            from: { date: target.date, time: target.time }, to: { date, time },
            by: 'owner', now,
          });
          upsertContact(db, {
            businessId, customerId: target.customerId || '',
            name: target.customerName, phone: target.customerPhone, source: 'reagendamento', now,
          });
          return { created: true, newId };
        }

        // pending/confirmed: move o MESMO atendimento.
        const fromDate = target.date;
        const fromTime = target.time;
        target.date = date;
        target.time = time;
        target.professionalId = proId || r.assign[time] || target.professionalId || '';
        target.updatedAt = now;
        target.history.push({ at: now, from: target.status, to: decision.nextStatus, by: 'owner', note });
        if (target.status !== decision.nextStatus) target.status = decision.nextStatus;
        noteLeadReschedule(db, {
          businessId, leadId: target.leadId,
          from: { date: fromDate, time: fromTime }, to: { date, time },
          by: 'owner', now,
        });
        return { created: false, newId: target.id };
      }

      // ── Transição de status (máquina oficial + P3 + P4) ──
      const to = body.status as BookingStatus;
      const applied = applyBookingStatusTx(db, {
        businessId,
        bookingId: String(body.id || ''),
        to,
        by: 'owner',
        note: body.note ? String(body.note) : undefined,
      });
      if (applied.ok) {
        // Lembretes vencidos nascem na ESCRITA (idempotente por agendamento).
        try { enqueueDueReminders(db, businessId, todayISO(new Date(), effectiveTimezone(business.businessTimezone))); } catch { /* melhor-esforço */ }
      }
      return { applied };
    }, { load });

    const r = result as any;
    if (r.applied) {
      if (!r.applied.ok) {
        return errJson(r.applied.error || 'Não foi possível atualizar.', r.applied.status_code || 422);
      }
      return NextResponse.json({ ok: true, status: r.applied.status });
    }
    return NextResponse.json({
      ok: true, ...r,
      ...(r.created !== undefined ? { moved: !r.created, reason: '' } : {}),
    });
  } catch (e: any) {
    if (e?.status && e.status !== 500) return errJson(e.message, e.status);
    throw e;
  }
}

function isTerminal(status: string): boolean {
  return status === 'cancelled' || status === 'completed' || status === 'no_show';
}

/** Cabeçalho de depuração honesto (aparece só no modo relacional). */
export function relationalHeader(res: NextResponse): NextResponse {
  res.headers.set('x-godoutor-persistence', 'relational');
  return res;
}
