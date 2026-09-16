// ═══════════════════════════════════════════════════════════════
// OPERAÇÃO DA AGENDA — pendências, resumo do dia e reagendamento
// ═══════════════════════════════════════════════════════════════
// Fonte única de duas regras que estavam espalhadas (e erradas):
//
//  1. PASSADO ≠ CONCLUÍDO. Quando o horário passa sem definição, o
//     atendimento fica PENDENTE DE FECHAMENTO (a pessoa decide: concluir,
//     faltou, cancelar ou reagendar). O sistema nunca altera status sozinho.
//
//  2. REAGENDAR NÃO PODE MANTER "CONCLUÍDO". Se o atendimento já está em
//     estado terminal (concluído/faltou/cancelado), o reagendamento cria um
//     NOVO atendimento futuro (pending), preservando o registro antigo e o
//     histórico — o CRM mostra "09/09 concluído" e "16/09 agendado".
import type { Booking, BookingStatus, DB, Service } from './types';
import { timeToMin } from './utils';
import { BOOKING_FLOW, canTransition } from './status';
import { enqueueBookingAutomation, onBookingCompleted } from './automations';
// P4 — o evento do agendamento nasce na FUNÇÃO OFICIAL de transição, de onde
// saem a mudança de status, o histórico e as mensagens do P3.
import { emitAutomationEvent } from './automation/events';

export const TERMINAL_STATUSES: BookingStatus[] = ['completed', 'no_show', 'cancelled'];

export function isTerminal(status: BookingStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function bookingDuration(service: Service | undefined, fallback = 30): number {
  const d = Number(service?.durationMin);
  return Number.isFinite(d) && d > 0 ? d : fallback;
}

/** Minutos desde a meia-noite em que o atendimento termina. */
export function endMinutes(b: Pick<Booking, 'time'>, durationMin: number): number {
  return timeToMin(b.time) + Math.max(0, durationMin);
}

/**
 * O atendimento já passou (fim do horário) e continua "aberto"?
 * `todayISO`/`nowHM` vêm de lib/tz (fuso do produto).
 */
export function needsClosure(
  b: Pick<Booking, 'date' | 'time' | 'status'>,
  durationMin: number,
  todayISO: string,
  nowHM: string,
): boolean {
  if (b.status !== 'pending' && b.status !== 'confirmed') return false;
  if (b.date > todayISO) return false;
  if (b.date < todayISO) return true;
  return endMinutes(b, durationMin) < timeToMin(nowHM);
}

/** Atendimentos que precisam de fechamento, do mais antigo ao mais recente. */
export function pendingClosures(
  bookings: Booking[],
  services: Map<string, Service> | Record<string, Service>,
  todayISO: string,
  nowHM: string,
): Booking[] {
  const get = (id: string): Service | undefined =>
    services instanceof Map ? services.get(id) : (services as Record<string, Service>)[id];
  return bookings
    .filter((b) => needsClosure(b, bookingDuration(get(b.serviceId)), todayISO, nowHM))
    .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1));
}

export interface DaySummary {
  date: string;
  total: number;
  pending: number;
  confirmed: number;
  completed: number;
  noShow: number;
  cancelled: number;
  needsClosure: number; // operacional (não é status)
}

export function summarizeDay(
  bookings: Array<Pick<Booking, 'date' | 'time' | 'status' | 'serviceId'>>,
  date: string,
  services: Map<string, Service> | Record<string, Service>,
  todayISO: string,
  nowHM: string,
): DaySummary {
  const get = (id: string): Service | undefined =>
    services instanceof Map ? services.get(id) : (services as Record<string, Service>)[id];
  const list = bookings.filter((b) => b.date === date);
  const count = (s: BookingStatus) => list.filter((b) => b.status === s).length;
  return {
    date,
    total: list.length,
    pending: count('pending'),
    confirmed: count('confirmed'),
    completed: count('completed'),
    noShow: count('no_show'),
    cancelled: count('cancelled'),
    needsClosure: list.filter((b) => needsClosure(b, bookingDuration(get(b.serviceId)), todayISO, nowHM)).length,
  };
}

export type RescheduleDecision =
  | { kind: 'move'; nextStatus: BookingStatus; reason: string }
  | { kind: 'recreate'; nextStatus: BookingStatus; reason: string };

/**
 * Como reagendar sem mentir no histórico.
 * - pending   → move (continua aguardando confirmação)
 * - confirmed → move (segue confirmado no novo horário)
 * - completed → NOVO atendimento 'pending' (o antigo permanece concluído)
 * - no_show   → NOVO atendimento 'pending' (a falta fica registrada)
 * - cancelled → NOVO atendimento 'pending' (o cancelamento fica registrado)
 */
export function rescheduleDecision(status: BookingStatus): RescheduleDecision {
  switch (status) {
    case 'pending':
      return { kind: 'move', nextStatus: 'pending', reason: 'Aguardando confirmação no novo horário.' };
    case 'confirmed':
      return { kind: 'move', nextStatus: 'confirmed', reason: 'Confirmado no novo horário.' };
    case 'completed':
      return { kind: 'recreate', nextStatus: 'pending', reason: 'O atendimento anterior foi concluído: o novo horário entra como aguardando confirmação.' };
    case 'no_show':
      return { kind: 'recreate', nextStatus: 'pending', reason: 'A falta anterior fica no histórico: o novo horário entra como aguardando confirmação.' };
    default:
      return { kind: 'recreate', nextStatus: 'pending', reason: 'O cancelamento anterior fica no histórico: o novo horário entra como aguardando confirmação.' };
  }
}

/** Descrição humana da mudança, gravada no histórico (auditoria). */
export function rescheduleNote(
  from: { date: string; time: string },
  to: { date: string; time: string },
): string {
  const f = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  return `Reagendado de ${f(from.date)} ${from.time} para ${f(to.date)} ${to.time}`;
}

export function rescheduleForwardNote(to: { date: string; time: string }): string {
  const f = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7);
  return `Reagendado para ${f(to.date)} ${to.time} (novo atendimento criado)`;
}

// ── Ações rápidas de fechamento (o que o operador pode fazer) ──
export interface ClosureAction {
  status: BookingStatus;
  label: string;
  tone: 'ok' | 'warn' | 'danger' | 'neutral';
}

export const CLOSURE_ACTIONS: ClosureAction[] = [
  { status: 'completed', label: 'Concluir', tone: 'ok' },
  { status: 'no_show', label: 'Não compareceu', tone: 'warn' },
  { status: 'cancelled', label: 'Cancelar', tone: 'danger' },
  // Reagendar abre o fluxo de remarcação (não é transição de status).
];

/** Ações permitidas para um status (usado nas quick actions do painel). */
export function bookingActions(status: BookingStatus): ClosureAction[] {
  switch (status) {
    case 'pending':
      return [
        { status: 'confirmed', label: 'Confirmar', tone: 'ok' },
        { status: 'cancelled', label: 'Cancelar', tone: 'danger' },
      ];
    case 'confirmed':
      return CLOSURE_ACTIONS;
    case 'cancelled':
      // A máquina de estados (status.ts) permite sair de cancelado para
      // pendente; "reativar" direto para confirmado seria um atalho inválido.
      return [{ status: 'pending', label: 'Reabrir', tone: 'neutral' }];
    case 'no_show':
      return [{ status: 'confirmed', label: 'Reativar', tone: 'neutral' }];
    default:
      return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// TRANSIÇÃO DE STATUS — FUNÇÃO OFICIAL (painel · cliente · automação)
// ═══════════════════════════════════════════════════════════════
// Antes do P4, "mudar o status de um agendamento" vivia dentro da rota
// (histórico + máquina de estados + automações de mensagem do P3). A automação
// precisava fazer exatamente a MESMA coisa, então a regra foi EXTRAÍDA para cá
// — e a rota passou a chamá-la. Contratos preservados:
//   • mesma validação pela máquina de estados (`BOOKING_FLOW` em lib/status.ts);
//   • mesma mensagem de recusa (`Não é possível mudar de "x" para "y".`);
//   • mesmo histórico append-only (`StatusChange` com autor e motivo);
//   • mesmas automações de mensagem do P3 (confirmação / pós-atendimento);
//   • + P4: o evento correspondente é emitido no fim, dentro da transação.

export interface ApplyBookingStatusParams {
  businessId: string;
  bookingId: string;
  to: BookingStatus;
  /** Autor registrado no histórico (dono, cliente, sistema/automação). */
  by: 'owner' | 'customer' | 'system' | 'master' | 'agent';
  note?: string;
  now?: string;
  /** P4 — execução que pediu a mudança (anti-loop do gatilho). */
  originRunId?: string;
}

export interface ApplyBookingStatusResult {
  ok: boolean;
  booking?: Booking;
  from?: BookingStatus;
  status?: BookingStatus;
  /** Mensagem de recusa (transição inválida / agendamento inexistente). */
  error?: string;
  status_code?: number;
}

/** Evento de automação correspondente a um novo status (P4.2). */
export function bookingStatusEvent(to: BookingStatus): 'booking.confirmed' | 'booking.cancelled' | 'booking.completed' | null {
  switch (to) {
    case 'confirmed': return 'booking.confirmed';
    case 'cancelled': return 'booking.cancelled';
    case 'completed': return 'booking.completed';
    default: return null;
  }
}

/**
 * Aplica a transição de status de um agendamento DA UNIDADE informada.
 * Não lança: devolve `{ ok:false, error }` (a rota decide o status HTTP, a
 * automação registra o erro no histórico da execução).
 */
export function applyBookingStatusTx(
  d: DB,
  p: ApplyBookingStatusParams,
): ApplyBookingStatusResult {
  if (!Array.isArray(d.bookings)) return { ok: false, error: 'Agendamento não encontrado.', status_code: 404 };
  // Isolamento: o id só vale dentro do businessId informado — nunca "acha" o
  // registro de outra empresa.
  const booking = d.bookings.find((x) => x.id === p.bookingId && x.businessId === p.businessId);
  if (!booking) return { ok: false, error: 'Agendamento não encontrado.', status_code: 404 };

  const from = booking.status;
  if (from !== p.to && (!canTransition(BOOKING_FLOW, from, p.to))) {
    return {
      ok: false,
      from,
      error: `Não é possível mudar de "${from}" para "${p.to}".`,
      status_code: 422,
    };
  }

  const now = p.now || new Date().toISOString();
  const note = String(p.note || '').trim().slice(0, 300);
  if (!Array.isArray(booking.history)) booking.history = [];
  booking.history.push({ at: now, from, to: p.to, by: p.by, ...(note ? { note } : {}) });
  booking.status = p.to;
  booking.updatedAt = now;

  // Automações de MENSAGEM do P3 (fila do WhatsApp) — preservadas daqui, onde
  // sempre estiveram: a extração não mudou o texto nem a idempotência.
  const service = d.services.find((s) => s.id === booking.serviceId);
  const info = {
    id: booking.id,
    customerName: booking.customerName,
    customerPhone: booking.customerPhone,
    date: booking.date,
    time: booking.time,
    serviceName: service?.name || 'atendimento',
  };
  if (p.to === 'confirmed' && from !== 'confirmed') {
    enqueueBookingAutomation(d, { businessId: p.businessId, kind: 'booking_confirmation', variant: 'confirmed', booking: info });
  }
  if (p.to === 'completed' && from !== 'completed') onBookingCompleted(d, p.businessId, booking);

  // P4 — gatilho (mesma transação da mudança de estado).
  const event = bookingStatusEvent(p.to);
  if (event && from !== p.to) {
    emitAutomationEvent(d, {
      event,
      businessId: p.businessId,
      at: now,
      bookingId: booking.id,
      leadId: booking.leadId || undefined,
      data: { from, to: p.to, by: p.by, note },
      fromRunId: p.originRunId,
    });
  }

  return { ok: true, booking, from, status: booking.status };
}
