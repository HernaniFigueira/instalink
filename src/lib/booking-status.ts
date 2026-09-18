// ═══════════════════════════════════════════════════════════════
// STATUS DO AGENDAMENTO — FUNÇÃO OFICIAL (painel · cliente · automação)
// ═══════════════════════════════════════════════════════════════
// Nasceu da extração da regra que vivia dentro de /api/bookings (PATCH) para
// que o P4 pudesse CANCELAR/CONCLUIR/CONFIRMAR pela mesma porta — sem copiar a
// máquina de estados, o histórico ou as mensagens do P3. O arquivo é separado
// de `booking-ops.ts` porque este último é importado por Client Components e
// precisa continuar puro (sem node:crypto, sem banco).
//
// Contratos preservados na extração (ver testes de regressão):
//   • validação por `BOOKING_FLOW` (lib/status.ts) — transição inválida ⇒
//     recusa com a MESMA mensagem do painel: 'Não é possível mudar de "x" para
//     "y".' (422);
//   • histórico append-only (`StatusChange` com autor e motivo);
//   • automações de mensagem do P3: 'confirmed' → confirmação; 'completed' →
//     pós-atendimento + convite de avaliação (idempotentes por agendamento);
//   • + P4: o evento correspondente é emitido no fim, na MESMA transação.
import type { Booking, BookingStatus, DB } from './types';
import { BOOKING_FLOW, canTransition } from './status';
import { enqueueBookingAutomation, onBookingCompleted } from './automations';
import { emitAutomationEvent } from './automation/events';
import { markLeadConverted } from './pipeline';

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

  // A2-B3 (F7.1): transição SEM mudança real é no-op — nada de histórico
  // redundante (append-only registra MUDANÇAS, não repetições), nada de
  // updatedAt falso, nenhuma mensagem/evento re-disparado. Idempotente.
  if (from === p.to) {
    return { ok: true, booking, from, status: booking.status };
  }

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
  if (p.to === 'completed' && from !== 'completed') {
    onBookingCompleted(d, p.businessId, booking);
    // A3.16 — atendimento concluído ⇒ lead vinculado vai para CONVERTED (mesma transação)
    // Idempotente: já em converted não gera novo histórico/evento. Preserva cancel no-op.
    try {
      markLeadConverted(d, {
        businessId: p.businessId,
        leadId: booking.leadId || undefined,
        bookingId: booking.id,
        actor: { id: p.by, name: p.by === 'owner' ? 'Atendimento' : p.by },
        now,
        origin: p.originRunId ? { runId: p.originRunId } : undefined,
      });
    } catch {}
  }

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
