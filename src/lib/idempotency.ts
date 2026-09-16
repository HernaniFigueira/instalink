// ═══════════════════════════════════════════════════════════════
// IDEMPOTÊNCIA PARA OPERAÇÕES EXTERNAS (P3)
// ═══════════════════════════════════════════════════════════════
// Previne duplicidade de requisições repetidas acidentalmente
// (timeout de rede, retries automáticos do cliente).
//  - Escopo por Business + Idempotency-Key + Endpoint;
//  - Retorna exatamente a mesma resposta HTTP anterior;
//  - Janela de validade: 48 horas.

import { randomUUID } from 'node:crypto';
import type { DB, IdempotencyRecord } from './types';

const MAX_AGE_MS = 48 * 60 * 60 * 1000;

export function extractIdempotencyKey(headers: Headers): string {
  const key = headers.get('idempotency-key') || headers.get('x-idempotency-key') || '';
  return key.trim().slice(0, 128);
}

export function checkIdempotency(
  db: DB,
  businessId: string,
  key: string,
  endpoint: string,
  nowMs = Date.now(),
): IdempotencyRecord | null {
  if (!key) return null;
  if (!Array.isArray(db.idempotencyKeys)) db.idempotencyKeys = [];

  const found = db.idempotencyKeys.find(
    (r) => r.businessId === businessId && r.key === key && r.endpoint === endpoint,
  );

  if (!found) return null;

  // Se expirou a janela de 48h, descarta
  const age = nowMs - new Date(found.createdAt).getTime();
  if (age > MAX_AGE_MS) return null;

  return found;
}

export function saveIdempotency(
  db: DB,
  businessId: string,
  key: string,
  endpoint: string,
  statusCode: number,
  responseBody: any,
  now = new Date().toISOString(),
): IdempotencyRecord {
  if (!Array.isArray(db.idempotencyKeys)) db.idempotencyKeys = [];

  // Prune Opportunístico se a lista passar de 200 itens
  if (db.idempotencyKeys.length > 200) {
    const minTime = Date.now() - MAX_AGE_MS;
    db.idempotencyKeys = db.idempotencyKeys.filter(
      (r) => new Date(r.createdAt).getTime() >= minTime,
    );
  }

  const record: IdempotencyRecord = {
    id: randomUUID(),
    businessId,
    key,
    endpoint,
    statusCode,
    responseBody,
    createdAt: now,
  };

  db.idempotencyKeys.push(record);
  return record;
}
