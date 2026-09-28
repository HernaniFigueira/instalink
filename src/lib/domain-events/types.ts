// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — EVENT LOG (eventos de domínio / OAAS)
// ═══════════════════════════════════════════════════════════════
// Fundação do Event-Driven OAAS: o EventLog registra o que ACONTECEU no
// domínio clínico/operacional, com autoridade única e payload seguro.
//
// REGRAS (contrato):
//   • `businessId` é OBRIGATÓRIO (isolamento multi-tenant na raiz);
//   • cada evento tem tipo do CATÁLOGO FECHADO (DomainEventType) — nada de
//     string livre inventada por chamador;
//   • `entityType`/`entityId` apontam a entidade de domínio afetada;
//   • `actor` registra QUEM causou (user | agent | system | patient) e a
//     `origin` por onde entrou (api | automation | agent | webhook | ui);
//   • `occurredAt` ISO UTC; `recordedAt` preenchido na gravação;
//   • `payload` é SEMPRE dado não-sensível já sanitizado (sem prontuário,
//     sem prompt clínico, sem token) — o `redact` corta o resto;
//   • `idempotencyKey` (opcional mas recomendado em efeitos externos):
//     repetir (businessId + idempotencyKey) é NO-OP e devolve o primeiro.
//
// A Automação futura (F8) consome ESTE log — nunca um formato paralelo.
// Nenhuma automação nova é criada nesta fundação.
export type DomainEventType =
  // ── Agenda / Atendimento ──
  | 'appointment.created'
  | 'appointment.confirmed'
  | 'appointment.cancelled'
  | 'appointment.completed'
  | 'appointment.no_show'
  | 'patient.checked_in'
  | 'queue.called'
  | 'encounter.started'
  | 'encounter.finalized'
  // ── Clínico ──
  | 'prescription.created'
  | 'exam.ordered'
  | 'exam.resulted'
  | 'procedure.performed'
  | 'document.generated'
  // ── Financeiro / Estoque ──
  | 'invoice.created'
  | 'payment.received'
  | 'inventory.low'
  | 'inventory.movement'
  // ── Relacionamento ──
  | 'followup.due'
  | 'followup.completed';

/** Quem causou o evento (nunca "a IA decidiu sozinha"). */
export type DomainEventActorKind = 'user' | 'agent' | 'system' | 'patient';

/** Por onde o evento entrou no sistema. */
export type DomainEventOrigin = 'ui' | 'api' | 'automation' | 'agent' | 'webhook' | 'import';

export type DomainEventEntityType =
  | 'booking' | 'queue_entry' | 'encounter' | 'prescription' | 'clinical_order'
  | 'clinical_document' | 'procedure' | 'invoice' | 'payment' | 'inventory_item'
  | 'followup' | 'patient' | 'contact' | 'pet';

export interface DomainEventActor {
  kind: DomainEventActorKind;
  /** id do usuário/agente/sistema (opcional p/ patient/system). */
  id?: string;
  name?: string;
}

/** Payload SEGURO: só JSON simples, sem dados clínicos identificáveis. */
export type DomainEventPayload = Record<string, string | number | boolean | null>;

export interface DomainEvent {
  id: string;
  businessId: string;
  type: DomainEventType;
  entityType: DomainEventEntityType;
  entityId: string;
  actor: DomainEventActor;
  origin: DomainEventOrigin;
  /** Momento em que o fato aconteceu (ISO UTC). */
  occurredAt: string;
  /** Momento em que o evento foi gravado (ISO UTC). */
  recordedAt: string;
  payload: DomainEventPayload;
  /** Idempotência opcional: (businessId + idempotencyKey) é único. */
  idempotencyKey?: string;
}

export interface EmitDomainEventInput {
  businessId: string;
  type: DomainEventType;
  entityType: DomainEventEntityType;
  entityId: string;
  actor: DomainEventActor;
  origin: DomainEventOrigin;
  occurredAt?: string;
  payload?: DomainEventPayload;
  idempotencyKey?: string;
  now?: string;
}
