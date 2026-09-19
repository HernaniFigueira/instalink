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
import type { Booking, BookingStatus, Service } from './types';
import { timeToMin } from './utils';
import { addDaysISO } from './tz';
import { addMonthsClamped } from './booking-recurrence';

export const TERMINAL_STATUSES: BookingStatus[] = ['completed', 'no_show', 'cancelled'];

export function isTerminal(status: BookingStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function bookingDuration(service: Service | undefined, fallback = 30): number {
  const d = Number(service?.durationMin);
  return Number.isFinite(d) && d > 0 ? d : fallback;
}

// ═══════════════════════════════════════════════════════════════
// A2-B3 (F5) — HORIZONTE EFETIVO (uma regra, zero hardcode de 60)
// ═══════════════════════════════════════════════════════════════
// horizonDays é exclusivamente a janela pública de autoagendamento.
// A equipe autorizada tem limite técnico próprio, inclusivo, de cinco anos.
export const BOOKING_HORIZON_MIN_DAYS = 1;
export const BOOKING_HORIZON_MAX_DAYS = 365;
export const BOOKING_HORIZON_DEFAULT_DAYS = 60;

export function effectiveHorizonDays(cfg?: { horizonDays?: number } | null): number {
  const n = Math.round(Number(cfg?.horizonDays));
  if (!Number.isFinite(n) || n < BOOKING_HORIZON_MIN_DAYS) return BOOKING_HORIZON_DEFAULT_DAYS;
  return Math.min(BOOKING_HORIZON_MAX_DAYS, n);
}

export const ADMIN_BOOKING_HORIZON_YEARS = 5;
export function adminBookingMaxDate(today: string): string {
  return addMonthsClamped(today, ADMIN_BOOKING_HORIZON_YEARS * 12);
}
export function bookingMaxDate(today: string, cfg: { horizonDays?: number } | undefined, admin = false): string {
  return admin ? adminBookingMaxDate(today) : addDaysISO(today, effectiveHorizonDays(cfg));
}

// A2-B3 (F6): limite efetivo do GET manage — EXPLÍCITO no contrato. O cliente
// pode pedir o que quiser; o servidor devolve o valor aplicado (e sinaliza o
// corte) em vez de capar em silêncio.
export const MANAGE_LIST_MAX_LIMIT = 500;
export const MANAGE_LIST_DEFAULT_LIMIT = 200;

export function effectiveManageLimit(requested?: number | string | null): { limit: number; capped: boolean; requested: number | null } {
  const raw = Number(requested);
  const requestedLimit = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : null;
  if (requestedLimit === null) return { limit: MANAGE_LIST_DEFAULT_LIMIT, capped: false, requested: null };
  if (requestedLimit > MANAGE_LIST_MAX_LIMIT) {
    return { limit: MANAGE_LIST_MAX_LIMIT, capped: true, requested: requestedLimit };
  }
  return { limit: requestedLimit, capped: false, requested: requestedLimit };
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
// TRANSIÇÃO DE STATUS — veja lib/booking-status.ts
// ═══════════════════════════════════════════════════════════════
// A função OFICIAL que muda o status de um agendamento (máquina de estados +
// histórico + automações de mensagem do P3 + gatilho de automação do P4) mora
// em `booking-status.ts`, e NÃO aqui. Motivo: este arquivo é importado por
// Client Components (agenda, ficha do atendimento) e precisa continuar PURE —
// sem `node:crypto`, sem banco. A separação é a mesma de access-core × access.
