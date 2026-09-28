// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — DomainEventStore (porta de persistência)
// ═══════════════════════════════════════════════════════════════
// O domínio depende DESTA porta — nunca de SQL nem de instalink_doc.
//
//   • PostgresDomainEventStore (./pg-store) → produção (DATABASE_URL):
//     tabela normalizada `domain_event` (migration 0001).
//   • MemoryDomainEventStore (aqui)       → testes/dev local (sem rede).
//
// REGRA (F0/J): EventLog NÃO é armazenado em instalink_doc — é o primeiro
// domínio que já nasce normalizado. Idempotência: (businessId +
// idempotencyKey) repetido é NO-OP e devolve o primeiro evento.
import { emitDomainEvent } from './emit';
import type { DomainEvent, EmitDomainEventInput } from './types';

export interface DomainEventQuery {
  type?: DomainEvent['type'];
  entityType?: DomainEvent['entityType'];
  entityId?: string;
  since?: string;
  limit?: number;
}

/** Porta única de persistência do EventLog (async: Postgres de verdade). */
export interface DomainEventStore {
  /** Emite, valida e persiste. Idempotente por (businessId, idempotencyKey). */
  record(input: EmitDomainEventInput): Promise<DomainEvent>;
  /** Leitura SEMPRE escopada por tenant (businessId obrigatório). */
  list(businessId: string, query?: DomainEventQuery): Promise<DomainEvent[]>;
}

/**
 * Adapter de memória — testes e dev local (sem banco, sem rede). Mesmo
 * contrato do Postgres; ideal para fixtures/mocks. Volátil por construção:
 * produção NUNCA usa este adapter (a factory só o escolhe sem DATABASE_URL).
 */
export class MemoryDomainEventStore implements DomainEventStore {
  private readonly events: DomainEvent[] = [];

  async record(input: EmitDomainEventInput): Promise<DomainEvent> {
    const event = emitDomainEvent(input);
    if (event.idempotencyKey) {
      const existing = this.events.find(
        (e) => e.businessId === event.businessId && e.idempotencyKey === event.idempotencyKey,
      );
      if (existing) return existing;
    }
    this.events.push(event);
    return event;
  }

  async list(businessId: string, query: DomainEventQuery = {}): Promise<DomainEvent[]> {
    const limit = Math.max(1, Math.min(500, query.limit || 100));
    return this.events
      .filter((e) => e.businessId === businessId)
      .filter((e) => (!query.type || e.type === query.type))
      .filter((e) => (!query.entityType || e.entityType === query.entityType))
      .filter((e) => (!query.entityId || e.entityId === query.entityId))
      .filter((e) => (!query.since || e.occurredAt >= query.since))
      .slice(-limit)
      .reverse();
  }
}

/**
 * Factory: COM DATABASE_URL → Postgres normalizado; sem → memória (dev).
 * Import dinâmico do adapter Postgres mantém o bundle do cliente limpo.
 */
export async function getDomainEventStore(): Promise<DomainEventStore> {
  const { isPgConfigured } = await import('../pg');
  if (isPgConfigured()) {
    const { PostgresDomainEventStore } = await import('./pg-store');
    return new PostgresDomainEventStore();
  }
  return new MemoryDomainEventStore();
}
