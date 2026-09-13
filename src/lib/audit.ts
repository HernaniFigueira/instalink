// Auditoria administrativa: TODA ação relevante na área da plataforma
// (master) ou de gestão sensível (equipe, módulos, campanhas) gera registro.
// O log é append-only do ponto de vista das telas — nunca editado.
import { randomUUID } from 'node:crypto';
import type { AuditAction, DB, User } from './types';

export interface AuditInput {
  action: AuditAction;
  actor: Pick<User, 'id' | 'email'> & { role?: string };
  businessId?: string;
  supportSessionId?: string;
  meta?: Record<string, any>;
}

/** Registra dentro de um updateDB já aberto (sem escrita aninhada). */
export function pushAudit(db: DB, input: AuditInput, at = new Date().toISOString()): string {
  const id = randomUUID();
  db.audit.push({
    id,
    at,
    action: input.action,
    actorUserId: input.actor?.id || '',
    actorEmail: input.actor?.email || '',
    actorRole: input.actor?.role || '',
    businessId: input.businessId || '',
    supportSessionId: input.supportSessionId || '',
    meta: input.meta || {},
  });
  return id;
}
