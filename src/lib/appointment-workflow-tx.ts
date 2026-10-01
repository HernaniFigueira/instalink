// ═══════════════════════════════════════════════════════════════
// WORKFLOW — transições AUTORITATIVAS (servidor, dentro de updateDB)
// ═══════════════════════════════════════════════════════════════
// Único ponto de entrada para mudar a etapa de um atendimento:
//   • check-in / desfazer check-in / faltou / cancelar / confirmar / reabrir /
//     concluir retroativamente  → `transitionAppointment`
//   • iniciar atendimento (arrived → in_care) → `assertCanStartCare`
//   • finalizar (in_care → finalized)         → `assertCanFinalizeCare`
// Nada aqui confia no cliente: papel/permissão/escopo vêm do `ctx` do guard e
// o agendamento é achado SEMPRE dentro do `businessId` autenticado.
//
// Reaproveita as máquinas existentes (não cria outra): o status do Booking
// continua passando por `applyBookingStatusTx` (histórico, mensagens, lead).
import type { AccessContext } from './access-core';
import { canAccessBooking } from './access-core';
import { applyBookingStatusTx } from './booking-status';
import { bookingDuration, needsClosure } from './booking-ops';
import {
  appointmentWorkflowState, canWorkflowTransition, WORKFLOW_LABEL,
  type WorkflowState,
} from './appointment-workflow';
import { pushAudit } from './audit';
import { createTaskTx, setTaskStatusTx } from './automation/tasks';
import { effectiveTimezone, nowHM, todayISO } from './tz';
import type { Booking, BookingStatus, DB, Encounter, QueueEntry } from './types';
import type { WorkflowEventInput } from './workflow-events';

export class WorkflowError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'WorkflowError';
    this.status = status;
  }
}
const werr = (m: string, s: number) => new WorkflowError(m, s);

export type WorkflowCtx = Pick<AccessContext, 'user' | 'business' | 'permissions' | 'professionalScope'>;

/** Registro de atendimento e fila ligados ao agendamento (mesmo tenant). */
export function workflowRelations(d: DB, businessId: string, bookingId: string): {
  encounter: Encounter | null; queue: QueueEntry | null;
} {
  const encounter = (d.encounters || []).find((e) => e.businessId === businessId && e.bookingId === bookingId) || null;
  const queue = (d.queue || []).find(
    (q) => q.businessId === businessId && q.bookingId === bookingId && (q.status === 'waiting' || q.status === 'called' || q.status === 'in_service'),
  ) || null;
  return { encounter, queue };
}

export function bookingWorkflowState(d: DB, businessId: string, booking: Booking): WorkflowState {
  const { encounter, queue } = workflowRelations(d, businessId, booking.id);
  return appointmentWorkflowState({ booking, encounter, queue });
}

export type WorkflowCommand =
  | { kind: 'check_in' }
  | { kind: 'check_in_undo' }
  | { kind: 'status'; to: BookingStatus };

export interface TransitionResult {
  booking: Booking;
  from: WorkflowState;
  to: WorkflowState;
  /** false = repetição idempotente (nada mudou, nada foi auditado). */
  changed: boolean;
  events: WorkflowEventInput[];
  taskId?: string;
}

/** Tarefa operacional aberta pelo fluxo para este agendamento (anti-duplicação). */
function openWorkflowTask(d: DB, businessId: string, bookingId: string) {
  return (d.tasks || []).find(
    (t) => t.businessId === businessId && t.bookingId === bookingId && t.createdBy === 'workflow' && t.status === 'open',
  );
}

/** Fecha a pendência "reagendar falta" quando o cliente é reagendado. */
export function closeWorkflowTaskTx(d: DB, businessId: string, bookingId: string, now: string): void {
  const t = openWorkflowTask(d, businessId, bookingId);
  if (t) setTaskStatusTx(d, { businessId, taskId: t.id, status: 'done', now });
}

export function transitionAppointment(
  d: DB,
  p: { ctx: WorkflowCtx; businessId: string; bookingId: string; command: WorkflowCommand; note?: string; now?: string },
): TransitionResult {
  const { ctx, businessId } = p;
  const now = p.now || new Date().toISOString();
  // Tenant primeiro; depois o escopo do profissional.
  const booking = d.bookings.find((x) => x.id === p.bookingId && x.businessId === businessId);
  if (!booking) throw werr('Agendamento não encontrado.', 404);
  if (!canAccessBooking(ctx, booking)) throw werr('Você só pode alterar os seus próprios atendimentos.', 403);
  if (!ctx.permissions.agenda) throw werr('Você não tem permissão para operar a agenda.', 403);

  const from = bookingWorkflowState(d, businessId, booking);
  const unchanged = (): TransitionResult => ({ booking, from, to: from, changed: false, events: [] });
  const business = d.businesses.find((b) => b.id === businessId);
  const tz = effectiveTimezone(business?.businessTimezone);
  const actorName = ctx.user.name || ctx.user.email || 'Equipe';
  const events: WorkflowEventInput[] = [];
  let taskId: string | undefined;

  const audit = (fromState: WorkflowState, toState: WorkflowState, extra: Record<string, unknown> = {}) => {
    pushAudit(d, {
      action: 'booking.status_changed', businessId, actor: ctx.user,
      // Sem texto livre: só ids e etapas.
      meta: { bookingId: booking.id, from: fromState, to: toState, date: booking.date, time: booking.time, ...extra },
    }, now);
  };

  // ── CHECK-IN ────────────────────────────────────────────────
  if (p.command.kind === 'check_in') {
    if (from === 'arrived') return unchanged(); // idempotente
    if (from === 'in_care') throw werr('Este atendimento já está em andamento.', 409);
    if (from !== 'scheduled') throw werr('Atendimento encerrado não recebe check-in.', 400);
    booking.checkedInAt = now;
    booking.checkedInBy = ctx.user.id;
    booking.checkedInByName = actorName;
    booking.updatedAt = now;
    booking.history.push({ at: now, from: booking.status, to: booking.status, by: 'owner', note: `Check-in às ${nowHM(new Date(now), tz)}` });
    pushAudit(d, {
      action: 'booking.checkin', businessId, actor: ctx.user,
      meta: { bookingId: booking.id, date: booking.date, time: booking.time },
    }, now);
    audit('scheduled', 'arrived');
    events.push({ businessId, type: 'patient.checked_in', entityType: 'booking', entityId: booking.id, actor: { id: ctx.user.id, name: actorName }, bookingId: booking.id, from: 'scheduled', to: 'arrived', at: now });
    return { booking, from, to: 'arrived', changed: true, events };
  }

  // ── DESFAZER CHECK-IN ───────────────────────────────────────
  if (p.command.kind === 'check_in_undo') {
    if (from === 'in_care') throw werr('O atendimento já foi iniciado: não dá para desfazer a chegada.', 409);
    if (!booking.checkedInAt || from !== 'arrived') {
      if (from === 'cancelled' || from === 'no_show' || from === 'finalized') throw werr('Atendimento encerrado não recebe check-in.', 400);
      throw werr('Este atendimento não tem check-in registrado.', 400);
    }
    booking.checkedInAt = undefined;
    booking.checkedInBy = undefined;
    booking.checkedInByName = undefined;
    booking.updatedAt = now;
    booking.history.push({ at: now, from: booking.status, to: booking.status, by: 'owner', note: 'Check-in desfeito no balcão' });
    pushAudit(d, {
      action: 'booking.checkin_undo', businessId, actor: ctx.user,
      meta: { bookingId: booking.id, date: booking.date, time: booking.time },
    }, now);
    audit('arrived', 'scheduled');
    return { booking, from, to: 'scheduled', changed: true, events };
  }

  // ── MUDANÇA DE STATUS (cancelar · faltou · concluir · confirmar · reabrir) ──
  const to = p.command.to;
  const status = booking.status;
  if (status === to) return unchanged(); // repetição idempotente

  if (to === 'cancelled') {
    if (from === 'in_care') throw werr('Atendimento em andamento: finalize o atendimento antes de cancelar.', 409);
    if (from === 'finalized') throw werr('Atendimento finalizado não pode ser cancelado.', 422);
    if (!canWorkflowTransition(from, 'cancelled')) throw werr(`Não é possível mudar de "${status}" para "${to}".`, 422);
  } else if (to === 'no_show') {
    if (from === 'arrived' || from === 'in_care') {
      throw werr('Quem já chegou não pode ser marcado como faltou. Desfaça a chegada antes.', 409);
    }
    if (from === 'finalized') throw werr('Atendimento finalizado não pode virar falta.', 422);
    if (status === 'pending') throw werr('Confirme o agendamento antes de registrar a falta.', 422);
  } else if (to === 'completed') {
    // Fechamento SEM registro clínico: é ato de quem atende.
    if (!ctx.permissions.atendimento) throw werr('Apenas quem atende pode concluir um atendimento.', 403);
    if (from === 'in_care') throw werr('Atendimento em andamento: finalize pelo registro do atendimento.', 409);
    if (from === 'arrived') throw werr('O cliente já chegou: inicie o atendimento para finalizar.', 409);
    if (from === 'scheduled') {
      const svc = d.services.find((s) => s.id === booking.serviceId && s.businessId === businessId);
      if (!needsClosure(booking, bookingDuration(svc), todayISO(new Date(now), tz), nowHM(new Date(now), tz))) {
        throw werr('O atendimento só pode ser concluído sem registro depois do horário marcado.', 409);
      }
    }
  } else if (to === 'pending' && from !== 'scheduled' && from !== 'cancelled') {
    throw werr(`Não é possível mudar de "${status}" para "${to}".`, 422);
  }

  const applied = applyBookingStatusTx(d, {
    businessId, bookingId: booking.id, to, by: 'owner', note: p.note, now,
  });
  if (!applied.ok) throw werr(applied.error || 'Não foi possível atualizar.', applied.status_code || 422);

  const after = bookingWorkflowState(d, businessId, booking);
  audit(from, after, { statusFrom: status, statusTo: to });
  const ev = (type: WorkflowEventInput['type']): WorkflowEventInput => ({
    businessId, type, entityType: 'booking', entityId: booking.id,
    actor: { id: ctx.user.id, name: actorName }, bookingId: booking.id, from, to: after, at: now,
  });
  if (to === 'cancelled') {
    // Quem estava na fila por este horário deixa a fila (histórico preservado).
    for (const q of d.queue || []) {
      if (q.businessId === businessId && q.bookingId === booking.id && (q.status === 'waiting' || q.status === 'called')) {
        q.status = 'left'; q.endedAt = now; q.updatedAt = now; q.updatedBy = ctx.user.id;
      }
    }
    events.push(ev('appointment.cancelled'));
  } else if (to === 'confirmed' && status === 'pending') {
    events.push(ev('appointment.confirmed'));
  } else if (to === 'completed') {
    events.push(ev('appointment.completed'));
  } else if (to === 'no_show') {
    events.push(ev('appointment.no_show'));
    // Pendência OPERACIONAL e acionável agora: reagendar a falta. Reaproveita
    // o motor de tarefas (sem sistema novo); uma só aberta por agendamento.
    if (!openWorkflowTask(d, businessId, booking.id)) {
      const name = String(booking.customerName || 'cliente').trim() || 'cliente';
      const r = createTaskTx(d, {
        businessId, title: `Reagendar falta de ${name}`.slice(0, 140),
        note: `Faltou em ${booking.date.split('-').reverse().join('/')} às ${booking.time}.`,
        dueAt: todayISO(new Date(now), effectiveTimezone(d.businesses.find((x) => x.id === businessId)?.businessTimezone)), createdBy: 'workflow', source: 'manual', bookingId: booking.id, now,
      });
      taskId = r.task?.id;
    }
  } else if (status === 'no_show' || status === 'cancelled') {
    // Reabriu: a pendência de reagendar deixa de ser necessária.
    closeWorkflowTaskTx(d, businessId, booking.id, now);
  }
  return { booking, from, to: after, changed: true, events, taskId };
}

// ── Atendimento (clínico) ────────────────────────────────────

/**
 * arrived → in_care. Chamado ao CRIAR o registro de atendimento ligado a um
 * agendamento. Idempotente (o chamador já devolve o registro existente antes).
 * Walk-in sem agendamento não passa por aqui (não há etapa de chegada).
 */
export function assertCanStartCare(d: DB, businessId: string, booking: Booking): void {
  const st = bookingWorkflowState(d, businessId, booking);
  if (st === 'arrived' || st === 'in_care') return;
  if (st === 'scheduled') throw werr('Registre a chegada do cliente antes de iniciar o atendimento.', 409);
  if (st === 'finalized') throw werr('Este atendimento já foi finalizado.', 409);
  throw werr(st === 'cancelled' ? 'Atendimento cancelado não pode ser iniciado.' : 'Atendimento com falta não pode ser iniciado.', 409);
}

/** in_care → finalized: só com atendimento em andamento (rascunho existente). */
export function assertCanFinalizeCare(encounter: Pick<Encounter, 'status'>): void {
  if (encounter.status !== 'draft') throw werr('Este registro já está finalizado.', 409);
}

export { WORKFLOW_LABEL };
