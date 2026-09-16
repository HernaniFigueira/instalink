// ═══════════════════════════════════════════════════════════════
// OBSERVABILIDADE DE INTEGRAÇÕES (P3)
// ═══════════════════════════════════════════════════════════════
// Registro append-only seguro para monitoramento de integrações externas:
//  - Registra endpoint, status, origem, timestamp e operationId;
//  - NUNCA grava senhas, tokens, hashes ou dados sensíveis de pagamento;
//  - Prune oportunístico para manter o documento enxuto.

import { randomUUID } from 'node:crypto';
import type { DB, IntegrationLog } from './types';

export function pushIntegrationLog(
  db: DB,
  entry: {
    businessId: string;
    endpoint: string;
    method: string;
    source?: string;
    status: number;
    errorMessage?: string;
    now?: string;
  },
): IntegrationLog {
  if (!Array.isArray(db.integrationLogs)) db.integrationLogs = [];

  // Prune se passar de 300 logs
  if (db.integrationLogs.length > 300) {
    db.integrationLogs = db.integrationLogs.slice(-200);
  }

  const log: IntegrationLog = {
    id: randomUUID(),
    businessId: entry.businessId,
    endpoint: entry.endpoint.slice(0, 100),
    method: entry.method.slice(0, 10),
    source: (entry.source || 'api').slice(0, 40),
    status: entry.status,
    operationId: randomUUID().slice(0, 12),
    errorMessage: entry.errorMessage ? String(entry.errorMessage).slice(0, 200) : undefined,
    at: entry.now || new Date().toISOString(),
  };

  db.integrationLogs.push(log);
  return log;
}
