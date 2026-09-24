// ═══════════════════════════════════════════════════════════════
// F3-H · OUTREACH DE FOLLOW-UP / REATIVAÇÃO (anti-duplo-envio)
// ═══════════════════════════════════════════════════════════════
// Ciclo: evaluate (F2) → revalida → FollowUpOutreach (1x lógico)
//        → emit followup.due | patient.inactive (eventKey) →
//        Automation Engine → MessagingService → resposta →
//        Booking Assistant (F3-E) | handoff (F3-F).
//
// Camadas de idempotência:
//   1. FollowUpOutreach.idempotencyKey  (nunca 2 outreachs iguais)
//   2. emitAutomationEvent eventKey     (nunca 2 runs)
//   3. AutomationRun history/claim      (passo 1x)
//   4. MessagingService idempotencyKey  (retry ≠ 2 envios)
//
// Sem timers em memória: quem varre é o cron/janela existente.
// ═══════════════════════════════════════════════════════════════
import { randomUUID } from 'node:crypto';
import type {
  Business, DB, Encounter, FollowUpOutreach, FollowUpOutreachKind,
  FollowUpOutreachStatus, FollowUpRule, Pet,
} from './types';
import { FOLLOW_UP_OUTREACH_LABELS } from './types';
import {
  evaluateRule, followUpChannelState, type FollowUpCandidate,
} from './follow-up';
import { emitAutomationEvent } from './automation/events';
import { followUpDueDate } from './encounters';
import { effectiveTimezone, todayISO, nowHM } from './tz';
import { pushAudit } from './audit';
import { petsOfTutor } from './pets';

const digits = (v: string): string => String(v || '').replace(/\D/g, '');

export interface OutreachScanInput {
  businessId: string;
  /** ISO completo. */
  now: string;
}

export interface OutreachScanResult {
  businessId: string;
  emitted: number;
  created: number;
  skipped: Array<{ key: string; reason: string }>;
  deferred: number;
}

/** Chave lógica estável — base do anti-duplo-envio. */
export function outreachIdempotencyKey(input: {
  businessId: string;
  kind: FollowUpOutreachKind;
  ruleId: string;
  subjectId: string;
  dueDate: string;
  attempt?: number;
}): string {
  const attempt = input.attempt && input.attempt > 1 ? `:a${input.attempt}` : '';
  return `followup:${input.businessId}:${input.kind}:${input.ruleId}:${input.subjectId}:${input.dueDate}${attempt}`;
}

/** eventKey para emitAutomationEvent (1 emissão lógica por outreach). */
export function outreachEventKey(o: Pick<FollowUpOutreach, 'idempotencyKey' | 'kind'>): string {
  const event = o.kind === 'return' ? 'followup.due' : 'patient.inactive';
  return `${event}:${o.idempotencyKey}`;
}

export function outreachStatusLabel(status: FollowUpOutreachStatus): string {
  return FOLLOW_UP_OUTREACH_LABELS[status] || status;
}

// ── Quiet hours (fuso do negócio; sem hardcoded em componente) ──

/** Janela padrão de contato quando o negócio não define horas. */
const DEFAULT_QUIET = { startHM: '08:00', endHM: '20:00' };

/** 0=Dom … 6=Sáb no fuso, a partir de YYYY-MM-DD. */
function weekdayIndex(dayISO: string): number {
  const d = new Date(`${dayISO}T12:00:00Z`);
  return d.getUTCDay();
}

function plusDays(dayISO: string, n: number): string {
  const t = Date.parse(`${dayISO}T00:00:00Z`);
  return new Date(t + n * 86400000).toISOString().slice(0, 10);
}

/** true se agora está fora da janela de contato do negócio. */
export function isQuietHours(nowISO: string, business: Pick<Business, 'hours'> & { timezone?: string }): boolean {
  const tz = effectiveTimezone(business.timezone);
  const day = todayISO(new Date(nowISO), tz);
  const hm = nowHM(new Date(nowISO), tz);
  const weekday = weekdayIndex(day);
  const dayRule = ((business.hours as Record<string, { open?: string; close?: string } | null>) || {})[weekday] || ((business.hours as Record<string, { open?: string; close?: string } | null>) || {})[String(weekday)];
  const open = (dayRule?.open as string) || DEFAULT_QUIET.startHM;
  const close = (dayRule?.close as string) || DEFAULT_QUIET.endHM;
  // Dia sem expediente (regra ausente e weekday 0) ⇒ quiet
  if (!dayRule && weekday === 0) return true;
  return !(hm >= open && hm < close);
}

/** ISO local (fuso do negócio) para "amanhã às open" — adiamento honesto. */
export function deferUntilQuietEnd(
  nowISO: string,
  business: Pick<Business, 'hours'> & { timezone?: string },
): string {
  if (!isQuietHours(nowISO, business)) return nowISO;
  const tz = effectiveTimezone(business.timezone);
  const day = todayISO(new Date(nowISO), tz);
  const weekday = weekdayIndex(day);
  const dayRule = ((business.hours as Record<string, { open?: string; close?: string } | null>) || {})[weekday] || ((business.hours as Record<string, { open?: string; close?: string } | null>) || {})[String(weekday)];
  const open = (dayRule?.open as string) || DEFAULT_QUIET.startHM;
  const hm = nowHM(new Date(nowISO), tz);
  const close = (dayRule?.close as string) || DEFAULT_QUIET.endHM;
  // Ainda antes do open hoje
  if (hm < open) {
    return `${day}T${open}:00:00.000Z`;
  }
  // Depois do close (ou dia fechado): próximo dia com open
  let d = plusDays(day, 1);
  for (let i = 0; i < 8; i++) {
    const wd = weekdayIndex(d);
    const r = (business.hours as any)?.[wd] || (business.hours as any)?.[String(wd)];
    if (r?.open) return `${d}T${r.open}:00:00.000Z`;
    d = plusDays(d, 1);
  }
  return `${plusDays(day, 1)}T${DEFAULT_QUIET.startHM}:00.000Z`;
}

// ── Revalidações (skips antes do envio) ───────────────────────

export type OutreachSkipReason =
  | 'skipped_already_scheduled'
  | 'skipped_superseded'
  | 'cancelled_by_context'
  | 'skipped_no_phone'
  | 'skipped_no_marketing_consent'
  | 'awaiting_channel';

export interface RevalidateContext {
  db: DB;
  business: Business;
  candidate: FollowUpCandidate;
  now: string;
}

export interface RevalidateOutcome {
  ok: boolean;
  reason?: OutreachSkipReason;
  phone: string;
  patientName: string;
  destName: string;
  petId?: string;
  contactId?: string;
  customerId?: string;
  encounterId?: string;
  /** Booking futuro relevante. */
  futureBookingId?: string;
}

/** Booking futuro (pending/confirmed) para telefone do contato. */
export function findFutureBooking(
  db: DB,
  businessId: string,
  phone: string,
  today: string,
): DB['bookings'][number] | undefined {
  const d = digits(phone);
  if (!d) return undefined;
  return db.bookings.find(
    (b) => b.businessId === businessId
      && digits(b.customerPhone) === d
      && b.date >= today
      && (b.status === 'pending' || b.status === 'confirmed'),
  );
}

/** Encounter mais novo finalizado para o mesmo contato (supersession). */
export function newerFinalizedEncounter(
  db: DB,
  encounter: Encounter,
): Encounter | undefined {
  return db.encounters.find(
    (e) => e.businessId === encounter.businessId
      && e.id !== encounter.id
      && e.contactId === encounter.contactId
      && !!encounter.contactId
      && e.status === 'finalized'
      && (e.finalizedAt || e.updatedAt) > (encounter.finalizedAt || encounter.updatedAt),
  );
}

function isVet(business: Business): boolean {
  return business.clinicType === 'veterinaria';
}

function petById(db: DB, businessId: string, petId?: string): Pet | undefined {
  if (!petId) return undefined;
  return db.pets.find((p) => p.id === petId && p.businessId === businessId);
}

/**
 * Revalida um candidato ANTES de criar outreach/emissão.
 * Separa retorno (operacional) × reativação (marketing).
 */
export function revalidateOutreach(ctx: RevalidateContext): RevalidateOutcome {
  const { db, business, candidate, now } = ctx;
  const today = todayISO(new Date(now), effectiveTimezone(business.timezone));
  const contact = candidate.contactId
    ? db.contacts.find((c) => c.id === candidate.contactId && c.businessId === business.id)
    : db.contacts.find((c) => c.businessId === business.id && digits(c.phone) === digits(candidate.phone));

  const phone = digits(candidate.phone || contact?.phone || '');
  const base: RevalidateOutcome = {
    ok: true,
    phone,
    patientName: candidate.name || contact?.name || 'Paciente',
    destName: contact?.name || candidate.name || 'Paciente',
    contactId: contact?.id || candidate.contactId || '',
    customerId: contact?.customerId || '',
    encounterId: candidate.encounterId,
  };

  // 1. Canal honesto (não fingir envio)
  const channel = followUpChannelState(business);
  if (!channel.ready) {
    // criamos outreach em aguardando_canal — ok=true mas caller grava status
    base.ok = true;
  }

  // 2. Sem telefone
  if (!phone || phone.length < 10) {
    return { ...base, ok: false, reason: 'skipped_no_phone' };
  }

  if (candidate.trigger === 'return_due' && candidate.encounterId) {
    const enc = db.encounters.find(
      (e) => e.id === candidate.encounterId && e.businessId === business.id,
    );
    if (!enc) return { ...base, ok: false, reason: 'cancelled_by_context' };
    // 3. Retorno removido/desativado
    if (enc.status !== 'finalized' || (enc.followUpMode !== 'date' && enc.followUpMode !== 'interval')) {
      return { ...base, ok: false, reason: 'cancelled_by_context' };
    }
    const due = followUpDueDate(enc);
    if (!due) return { ...base, ok: false, reason: 'cancelled_by_context' };
    // 4. Já agendou antes do follow-up
    const future = findFutureBooking(db, business.id, phone, today)
      || (enc.contactId
        ? db.bookings.find((b) => b.businessId === business.id && b.date >= today
            && (b.status === 'pending' || b.status === 'confirmed')
            && db.contacts.some((c) => c.id === enc.contactId && digits(c.phone) === digits(b.customerPhone)))
        : undefined);
    if (future) {
      return { ...base, ok: false, reason: 'skipped_already_scheduled', futureBookingId: future.id };
    }
    // 5. Novo atendimento supersedou
    const newer = newerFinalizedEncounter(db, enc);
    if (newer) {
      return { ...base, ok: false, reason: 'skipped_superseded' };
    }
    // Vet: paciente = pet; destino = tutor
    if (isVet(business)) {
      const pet = petById(db, business.id, enc.petId)
        || petsOfTutor(db.pets.filter((p) => p.businessId === business.id), enc.contactId)[0];
      if (pet) {
        base.petId = pet.id;
        base.patientName = pet.name;
      }
      base.destName = contact?.name || enc.customerName || 'Paciente';
    } else {
      base.patientName = enc.customerName || contact?.name || base.patientName;
      base.destName = contact?.name || enc.customerName || base.destName;
    }
    return base;
  }

  if (candidate.trigger === 'inactive_patient') {
    // 6. Reativação = marketing → consentimento explícito
    if (contact?.marketingOptIn !== true) {
      return { ...base, ok: false, reason: 'skipped_no_marketing_consent' };
    }
    // 7. Booking futuro ⇒ não inativo p/ reativação
    const future = findFutureBooking(db, business.id, phone, today);
    if (future) {
      return { ...base, ok: false, reason: 'skipped_already_scheduled', futureBookingId: future.id };
    }
    if (isVet(business)) {
      const pets = contact?.id
        ? petsOfTutor(db.pets.filter((p) => p.businessId === business.id), contact.id)
        : [];
      if (pets[0]) {
        base.petId = pets[0].id;
        base.patientName = pets[0].name;
      }
      base.destName = contact?.name || base.destName;
    }
    return base;
  }

  // Outros triggers de fundação: telefone + booking futuro
  const future = findFutureBooking(db, business.id, phone, today);
  if (future) {
    return { ...base, ok: false, reason: 'skipped_already_scheduled', futureBookingId: future.id };
  }
  return base;
}

// ── Mensagens (sem motivo clínico; sem diagnóstico) ────────────

export function buildOutreachMessage(input: {
  kind: FollowUpOutreachKind;
  patientName: string;
  destName: string;
  clinicName: string;
  isVet: boolean;
}): string {
  const patient = input.patientName || 'Paciente';
  const dest = input.destName || patient;
  const clinic = input.clinicName || 'nossa clínica';
  if (input.kind === 'reactivation') {
    if (input.isVet) {
      return `Olá, ${dest}. Faz um tempo que o ${patient} não passa pela ${clinic}. Se quiser, posso verificar horários para vocês.`;
    }
    return `Olá, ${dest}. Faz um tempo que você não passa pela ${clinic}. Se quiser, posso verificar horários.`;
  }
  if (input.isVet) {
    return `Olá, ${dest}. Está chegando o momento do retorno do ${patient} na ${clinic}. Gostaria de agendar?`;
  }
  return `Olá, ${dest}. Está chegando o momento do seu retorno na ${clinic}. Gostaria de agendar?`;
}

// ── Upsert do registro outreach ────────────────────────────────

function findExisting(
  db: DB,
  businessId: string,
  key: string,
): FollowUpOutreach | undefined {
  if (!Array.isArray(db.followUpOutreach)) db.followUpOutreach = [];
  return db.followUpOutreach.find((o) => o.businessId === businessId && o.idempotencyKey === key);
}

export function upsertOutreach(
  db: DB,
  input: Omit<FollowUpOutreach, 'id' | 'statusLabel' | 'createdAt' | 'updatedAt' | 'origin' | 'attempt' | 'nextAttemptAt'> &
    Partial<Pick<FollowUpOutreach, 'status' | 'origin' | 'attempt' | 'nextAttemptAt'>>,
  now: string,
): FollowUpOutreach {
  if (!Array.isArray(db.followUpOutreach)) db.followUpOutreach = [];
  const existing = findExisting(db, input.businessId, input.idempotencyKey);
  if (existing) {
    // Nunca regride status terminal para "programado" em revarredura
    Object.assign(existing, {
      ...input,
      status: input.status || existing.status,
      updatedAt: now,
    });
    existing.statusLabel = outreachStatusLabel(existing.status);
    return existing;
  }
  const initialStatus = (input.status as FollowUpOutreachStatus) || 'programado';
  const row: FollowUpOutreach = {
    id: randomUUID(),
    origin: input.kind,
    attempt: 0,
    nextAttemptAt: '',
    ...input,
    status: initialStatus,
    statusLabel: outreachStatusLabel(initialStatus),
    createdAt: now,
    updatedAt: now,
  };
  db.followUpOutreach.push(row);
  return row;
}

export function markOutreach(
  db: DB,
  row: FollowUpOutreach,
  status: FollowUpOutreachStatus,
  now: string,
  extra: Partial<FollowUpOutreach> = {},
): FollowUpOutreach {
  row.status = status;
  row.statusLabel = outreachStatusLabel(status);
  row.updatedAt = now;
  Object.assign(row, extra);
  return row;
}

// ── Scan principal (cron; idempotente) ─────────────────────────

/**
 * Varre UMA unidade: cria/atualiza outreach e emite eventos 1x.
 * Puro sobre o documento (chamador grava via updateDB).
 */
export function scanBusinessOutreach(
  db: DB,
  input: OutreachScanInput,
): OutreachScanResult {
  const result: OutreachScanResult = {
    businessId: input.businessId,
    emitted: 0,
    created: 0,
    skipped: [],
    deferred: 0,
  };
  const business = db.businesses.find((b) => b.id === input.businessId);
  if (!business) return result;

  const now = input.now;
  const tz = effectiveTimezone(business.timezone);
  const today = todayISO(new Date(now), tz);
  const rules = (db.followUpRules || []).filter((r) => r.businessId === input.businessId && r.active);
  if (rules.length === 0) return result;

  const evalInput = {
    rules,
    contacts: db.contacts.filter((c) => c.businessId === input.businessId),
    leads: db.leads.filter((l) => l.businessId === input.businessId),
    bookings: db.bookings.filter((b) => b.businessId === input.businessId),
    encounters: db.encounters.filter((e) => e.businessId === input.businessId),
    today,
    now,
  };

  const quiet = isQuietHours(now, business);
  const channel = followUpChannelState(business);

  for (const rule of rules) {
    const candidates = evaluateRule(rule, evalInput);
    for (const cand of candidates) {
      const subjectId = cand.encounterId || cand.leadId || cand.contactId || digits(cand.phone) || 'unknown';
      const kind: FollowUpOutreachKind = rule.trigger === 'inactive_patient' ? 'reactivation' : 'return';
      const dueDate = (cand.dueAt || today).slice(0, 10);
      const key = outreachIdempotencyKey({
        businessId: input.businessId,
        kind,
        ruleId: rule.id,
        subjectId,
        dueDate,
      });

      // Camada 1: já existe outreach terminal ⇒ nada a fazer
      const existing = findExisting(db, input.businessId, key);
      if (existing && isTerminalOutreach(existing.status)) {
        continue;
      }

      const rev = revalidateOutreach({ db, business, candidate: cand, now });
      if (!rev.ok) {
        const reason = rev.reason || 'cancelled_by_context';
        const status = skipToStatus(reason);
        if (existing) {
          if (!isTerminalOutreach(existing.status)) markOutreach(db, existing, status, now, { lastResult: reason });
        } else {
          upsertOutreach(db, {
            businessId: input.businessId,
            kind,
            ruleId: rule.id,
            encounterId: cand.encounterId,
            contactId: rev.contactId,
            customerId: rev.customerId,
            petId: rev.petId,
            bookingId: cand.bookingId,
            dueDate,
            idempotencyKey: key,
            status,
            eventKey: outreachEventKey({ idempotencyKey: key, kind }),
            phone: rev.phone,
            patientName: rev.patientName,
            destName: rev.destName,
            origin: kind,
            lastResult: reason,
          }, now);
          result.created += 1;
        }
        result.skipped.push({ key, reason });
        continue;
      }

      // Quiet hours: adia (não falha, não marca enviado)
      if (quiet) {
        const until = deferUntilQuietEnd(now, business);
        const row = existing || upsertOutreach(db, {
          businessId: input.businessId,
          kind,
          ruleId: rule.id,
          encounterId: cand.encounterId,
          contactId: rev.contactId,
          customerId: rev.customerId,
          petId: rev.petId,
          bookingId: cand.bookingId,
          dueDate,
          idempotencyKey: key,
          status: 'programado',
          eventKey: outreachEventKey({ idempotencyKey: key, kind }),
          phone: rev.phone,
          patientName: rev.patientName,
          destName: rev.destName,
          origin: kind,
        }, now);
        if (!existing) result.created += 1;
        row.nextAttemptAt = until;
        if (row.status !== 'mensagem_enviada' && row.status !== 'agendamento_realizado') {
          markOutreach(db, row, 'ignorado', now, { nextAttemptAt: until, lastResult: 'quiet_hours' });
        }
        result.deferred += 1;
        continue;
      }

      // Canal desconectado: status honesto, sem "enviado"
      if (!channel.ready) {
        const row = existing || upsertOutreach(db, {
          businessId: input.businessId,
          kind,
          ruleId: rule.id,
          encounterId: cand.encounterId,
          contactId: rev.contactId,
          customerId: rev.customerId,
          petId: rev.petId,
          bookingId: cand.bookingId,
          dueDate,
          idempotencyKey: key,
          status: 'aguardando_canal',
          eventKey: outreachEventKey({ idempotencyKey: key, kind }),
          phone: rev.phone,
          patientName: rev.patientName,
          destName: rev.destName,
          origin: kind,
        }, now);
        if (!existing) result.created += 1;
        markOutreach(db, row, 'aguardando_canal', now, { lastResult: 'awaiting_channel' });
        // NÃO emite evento de envio — não há envio.
        result.skipped.push({ key, reason: 'awaiting_channel' });
        continue;
      }

      // Camada 1 (upsert) + camada 2 (eventKey no emit)
      const row = existing || upsertOutreach(db, {
        businessId: input.businessId,
        kind,
        ruleId: rule.id,
        encounterId: cand.encounterId,
        contactId: rev.contactId,
        customerId: rev.customerId,
        petId: rev.petId,
        bookingId: cand.bookingId,
        dueDate,
        idempotencyKey: key,
        status: 'programado',
        eventKey: outreachEventKey({ idempotencyKey: key, kind }),
        phone: rev.phone,
        patientName: rev.patientName,
        destName: rev.destName,
        origin: kind,
        conversationId: undefined,
      }, now);
      if (!existing) result.created += 1;

      // Já emitiu / já enviou neste ciclo?
      if (row.attempt >= 1 && (row.status === 'mensagem_enviada' || row.status === 'paciente_respondeu'
        || row.status === 'agendamento_realizado' || row.status === 'recusado')) {
        continue;
      }

      const event = kind === 'return' ? 'followup.due' as const : 'patient.inactive' as const;
      const eventKey = row.eventKey || outreachEventKey(row);

      const emit = emitAutomationEvent(db, {
        event,
        businessId: input.businessId,
        at: now,
        eventKey,
        source: kind === 'return' ? 'return' : 'reactivation',
        customerId: rev.customerId || undefined,
        bookingId: cand.bookingId || undefined,
        data: {
          outreachId: row.id,
          idempotencyKey: key,
          ruleId: rule.id,
          trigger: rule.trigger,
          dueDate,
          encounterId: cand.encounterId || '',
          patientName: row.patientName,
          destName: row.destName,
          phone: row.phone,
          kind,
          message: buildOutreachMessage({
            kind,
            patientName: row.patientName,
            destName: row.destName,
            clinicName: business.name,
            isVet: isVet(business),
          }),
        },
      });

      // matched=0 (sem automação ativa) ainda conta como outreach criado,
      // mas só marca tentativa quando houve run criado OU já existia run.
      if (emit.created.length > 0) {
        row.attempt = Math.max(row.attempt, 1);
        row.automationRunId = emit.created[0].id;
        markOutreach(db, row, 'programado', now, {
          attempt: row.attempt,
          automationRunId: row.automationRunId,
          lastResult: 'emitted',
        });
        result.emitted += 1;
      } else if (emit.skipped.some((s) => s.reason.includes('já existe'))) {
        // duplicata de run — outreach já contabilizado
        row.attempt = Math.max(row.attempt, 1);
      } else {
        // sem automação configurada: outreach fica programado (sem envio cego)
        markOutreach(db, row, 'programado', now, { lastResult: emit.skipped[0]?.reason || 'no_automation' });
      }

      pushAudit(db, {
        action: 'followup.outreach_evaluated',
        actor: { id: 'system', email: 'system@instalink.app', role: 'system' },
        businessId: input.businessId,
        meta: {
          outreachId: row.id,
          kind,
          ruleId: rule.id,
          result: row.status,
          eventKey,
        },
      }, now);
    }
  }

  return result;
}

function isTerminalOutreach(s: FollowUpOutreachStatus): boolean {
  return s === 'ja_agendado' || s === 'superado' || s === 'cancelado'
    || s === 'sem_telefone' || s === 'sem_consentimento'
    || s === 'recusado' || s === 'agendamento_realizado';
}

function skipToStatus(reason: OutreachSkipReason): FollowUpOutreachStatus {
  switch (reason) {
    case 'skipped_already_scheduled': return 'ja_agendado';
    case 'skipped_superseded': return 'superado';
    case 'cancelled_by_context': return 'cancelado';
    case 'skipped_no_phone': return 'sem_telefone';
    case 'skipped_no_marketing_consent': return 'sem_consentimento';
    case 'awaiting_channel': return 'aguardando_canal';
    default: return 'ignorado';
  }
}

/** Varre todas as unidades (cron). Puro; quem grava é o chamador. */
export function scanAllOutreach(db: DB, nowISO: string): OutreachScanResult[] {
  if (!Array.isArray(db.followUpOutreach)) db.followUpOutreach = [];
  return db.businesses.map((b) => scanBusinessOutreach(db, { businessId: b.id, now: nowISO }));
}

/** Resposta do paciente classificada p/ status do outreach (F3-H). */
export type OutreachReply = 'positive' | 'negative' | 'human' | 'other';

export function classifyOutreachReply(text: string): OutreachReply {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return 'other';
  if (/\b(quero falar com (algu[ée]m|a equipe)|atendente|humano|pessoa de verdade)\b/.test(t)) return 'human';
  if (/^(sim|quero marcar|quero agendar|pode marcar|agendar|marcar|quero sim|claro|obrigad[oa])\b/.test(t)) return 'positive';
  if (/\b(n[ãa]o quero|n[ãa]o tenho interesse|depois|talvez n[ãa]o|n[ãa]o obrigad[oa]|n[ãa]o)\b/.test(t)) return 'negative';
  return 'other';
}

/**
 * Processa resposta inbound ligada a um outreach (idempotente por status).
 * positive NÃO cria booking — só marca e o Booking Assistant F3-E assume.
 */
export function applyOutreachReply(
  db: DB,
  input: { businessId: string; conversationId: string; body: string; now: string },
): FollowUpOutreach | null {
  if (!Array.isArray(db.followUpOutreach)) return null;
  const row = db.followUpOutreach.find(
    (o) => o.businessId === input.businessId
      && o.conversationId === input.conversationId
      && (o.status === 'mensagem_enviada' || o.status === 'programado' || o.status === 'paciente_respondeu'),
  );
  if (!row) return null;
  if (row.status === 'agendamento_realizado' || row.status === 'recusado') return row;

  const kind = classifyOutreachReply(input.body);
  if (kind === 'human') {
    // handoff é F3-F — aqui só registramos a resposta
    return markOutreach(db, row, 'paciente_respondeu', input.now, { lastResult: 'requested_human' });
  }
  if (kind === 'negative') {
    return markOutreach(db, row, 'recusado', input.now, { lastResult: 'declined' });
  }
  if (kind === 'positive') {
    return markOutreach(db, row, 'paciente_respondeu', input.now, { lastResult: 'positive' });
  }
  return markOutreach(db, row, 'paciente_respondeu', input.now, { lastResult: 'replied' });
}

/** Booking criado a partir do fluxo ⇒ status final (idempotente). */
export function markOutreachBooked(
  db: DB,
  input: { businessId: string; conversationId?: string; contactId?: string; outreachId?: string; now: string },
): FollowUpOutreach | null {
  if (!Array.isArray(db.followUpOutreach)) return null;
  const row = input.outreachId
    ? db.followUpOutreach.find((o) => o.id === input.outreachId && o.businessId === input.businessId)
    : db.followUpOutreach.find(
      (o) => o.businessId === input.businessId
        && ((input.conversationId && o.conversationId === input.conversationId)
          || (input.contactId && o.contactId === input.contactId))
        && o.status !== 'ja_agendado' && o.status !== 'cancelado',
    );
  if (!row) return null;
  return markOutreach(db, row, 'agendamento_realizado', input.now, { lastResult: 'booked' });
}

/** Histórico legível por pet/pessoa (UI sem campos técnicos). */
export function outreachHistory(
  db: DB,
  businessId: string,
  filter: { contactId?: string; petId?: string; encounterId?: string },
): Array<{ at: string; label: string; status: FollowUpOutreachStatus }> {
  if (!Array.isArray(db.followUpOutreach)) return [];
  return db.followUpOutreach
    .filter((o) => o.businessId === businessId)
    .filter((o) => {
      if (filter.encounterId) return o.encounterId === filter.encounterId;
      if (filter.petId) return o.petId === filter.petId;
      if (filter.contactId) return o.contactId === filter.contactId;
      return false;
    })
    .map((o) => ({
      at: o.updatedAt || o.createdAt,
      label: o.statusLabel,
      status: o.status,
    }))
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Próximo retorno visível (Pet/Paciente 360). */
export function upcomingReturnFor(
  db: DB,
  businessId: string,
  filter: { contactId?: string; petId?: string },
): { dueDate: string; status: FollowUpOutreachStatus; label: string } | null {
  if (!Array.isArray(db.followUpOutreach)) return null;
  const rows = db.followUpOutreach
    .filter((o) => o.businessId === businessId && o.kind === 'return')
    .filter((o) => {
      if (filter.petId) return o.petId === filter.petId;
      if (filter.contactId) return o.contactId === filter.contactId;
      return false;
    })
    .filter((o) => o.status !== 'cancelado' && o.status !== 'superado' && o.status !== 'recusado')
    .sort((a, b) => (a.dueDate < b.dueDate ? 1 : -1));
  const top = rows[0];
  if (!top) return null;
  return { dueDate: top.dueDate, status: top.status, label: top.statusLabel };
}
