// Eventos de domínio do Workflow (EventLog F0) — MELHOR ESFORÇO.
// A fonte transacional é `db.audit` (gravada na mesma transação). O EventLog é
// o fato publicado DEPOIS do commit: falha aqui nunca derruba a operação nem
// desfaz a transição. Payload só com ids/estados — nunca nota, queixa ou
// evolução (o emissor ainda corta chaves clínicas).
import { getDomainEventStore } from './domain-events';
import type { DomainEventType } from './domain-events';

export interface WorkflowEventInput {
  businessId: string;
  type: Extract<DomainEventType,
    'patient.checked_in' | 'appointment.cancelled' | 'appointment.no_show' | 'appointment.completed'
    | 'appointment.confirmed' | 'encounter.started' | 'encounter.finalized'>;
  entityType: 'booking' | 'encounter';
  entityId: string;
  actor: { id: string; name?: string };
  bookingId?: string;
  from?: string;
  to?: string;
  at?: string;
}

export async function publishWorkflowEvent(input: WorkflowEventInput): Promise<void> {
  try {
    const store = await getDomainEventStore();
    await store.record({
      businessId: input.businessId,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      actor: { kind: 'user', id: input.actor.id, ...(input.actor.name ? { name: input.actor.name } : {}) },
      origin: 'api',
      ...(input.at ? { occurredAt: input.at } : {}),
      payload: {
        ...(input.bookingId ? { bookingId: input.bookingId } : {}),
        ...(input.from ? { from: input.from } : {}),
        ...(input.to ? { to: input.to } : {}),
      },
      // Repetir a mesma transição não duplica o fato.
      idempotencyKey: `${input.type}:${input.entityId}:${input.to || ''}:${input.at || ''}`,
    });
  } catch {
    /* melhor-esforço: o audit transacional já registrou */
  }
}
