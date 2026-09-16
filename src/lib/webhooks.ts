// ═══════════════════════════════════════════════════════════════
// WEBHOOKS DE SAÍDA — EVENTOS OPERACIONAIS (P3)
// ═══════════════════════════════════════════════════════════════
// Disparo seguro e controlado de eventos para sites e sistemas externos:
//  - Assinatura criptográfica HMAC-SHA256 (prevenção contra spoofing);
//  - Timestamp com tolerância temporal (prevenção contra ataques de replay);
//  - Segredo protegido: nunca exposto após criação (apenas secretMasked);
//  - Retry controlado com backoff determinístico e preservação de eventId;
//  - Isolamento estrito por Business;
//  - Histórico de tentativas e auditoria.

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DB, SafeWebhookConfig, WebhookConfig, WebhookDelivery, WebhookEvent } from './types';
import { VALID_WEBHOOK_EVENTS } from './types';

export { VALID_WEBHOOK_EVENTS };

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('hex')}`;
}

/** Mascara o segredo do webhook para nunca expor a chave completa em listagens ou GET. */
export function maskWebhookSecret(secret: string): string {
  if (!secret) return '';
  const trimmed = secret.trim();
  const last4 = trimmed.slice(-4);
  return `whsec_••••••••${last4}`;
}

/** Sanitiza a configuração do webhook para retorno em APIs de leitura e painel administrativo. */
export function sanitizeWebhookForDisplay(webhook: WebhookConfig): SafeWebhookConfig {
  const { secret, ...rest } = webhook;
  return {
    ...rest,
    secretMasked: maskWebhookSecret(secret),
  };
}

/** Assina payload com timestamp e segredo. */
export function signWebhookPayload(secret: string, payload: string, timestamp: number): string {
  const content = `${timestamp}.${payload}`;
  return createHmac('sha256', secret).update(content).digest('hex');
}

/**
 * Validação de assinatura de webhook (lado receptor ou teste).
 * Valida o formato `t=1726444800,v1=...`, o timestamp dentro da tolerância
 * e a igualdade em tempo constante.
 */
export function verifyWebhookSignature(
  secret: string,
  payload: string,
  signatureHeader: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): { valid: boolean; reason?: string } {
  if (!signatureHeader || !secret) {
    return { valid: false, reason: 'Assinatura ou segredo ausente.' };
  }

  const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, item) => {
    const [k, v] = item.split('=');
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const tsStr = parts.t;
  const sig = parts.v1;

  if (!tsStr || !sig) {
    return { valid: false, reason: 'Header de assinatura mal formatado (esperado t=...,v1=...).' };
  }

  const timestamp = Number(tsStr);
  if (!Number.isFinite(timestamp)) {
    return { valid: false, reason: 'Timestamp inválido.' };
  }

  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { valid: false, reason: 'Assinatura expirada (tolerância excedida).' };
  }

  const expected = signWebhookPayload(secret, payload, timestamp);
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(sig, 'hex');

  if (expectedBuf.length !== actualBuf.length) {
    return { valid: false, reason: 'Assinatura divergente.' };
  }

  if (!timingSafeEqual(expectedBuf, actualBuf)) {
    return { valid: false, reason: 'Assinatura divergente.' };
  }

  return { valid: true };
}

/** Cria ou atualiza configuração de webhook para um negócio. */
export function upsertWebhook(
  db: DB,
  businessId: string,
  input: {
    id?: string;
    url: string;
    events: WebhookEvent[];
    active?: boolean;
    secret?: string;
  },
): WebhookConfig {
  if (!Array.isArray(db.webhooks)) db.webhooks = [];

  const url = String(input.url || '').trim();
  if (!/^https?:\/\//i.test(url)) {
    throw Object.assign(new Error('URL de webhook inválida. Deve iniciar com http:// ou https://'), { status: 400 });
  }

  const validEvents = (Array.isArray(input.events) ? input.events : [])
    .filter((e) => VALID_WEBHOOK_EVENTS.includes(e));

  if (validEvents.length === 0) {
    throw Object.assign(new Error('Selecione ao menos um evento ativo para o webhook.'), { status: 400 });
  }

  const now = new Date().toISOString();
  let existing = input.id ? db.webhooks.find((w) => w.id === input.id && w.businessId === businessId) : null;

  if (existing) {
    existing.url = url;
    existing.events = validEvents;
    existing.active = input.active !== false;
    if (input.secret) existing.secret = input.secret;
    existing.updatedAt = now;
    return existing;
  }

  const newWebhook: WebhookConfig = {
    id: randomUUID(),
    businessId,
    url,
    events: validEvents,
    active: input.active !== false,
    secret: input.secret || generateWebhookSecret(),
    createdAt: now,
    updatedAt: now,
  };

  db.webhooks.push(newWebhook);
  return newWebhook;
}

/** Remove webhook de um negócio. */
export function deleteWebhook(db: DB, businessId: string, webhookId: string): boolean {
  if (!Array.isArray(db.webhooks)) db.webhooks = [];
  const idx = db.webhooks.findIndex((w) => w.id === webhookId && w.businessId === businessId);
  if (idx === -1) return false;
  db.webhooks.splice(idx, 1);
  return true;
}

// ═══════════════════════════════════════════════════════════════
// RETRY CONTROLADO DE WEBHOOKS
// ═══════════════════════════════════════════════════════════════

/** Define se o status HTTP ou erro de rede justifica nova tentativa. */
export function isRetryableWebhookStatus(statusCode?: number): boolean {
  // 0 = erro de rede, timeout, abort, dns, etc.
  if (!statusCode || statusCode === 0) return true;
  // 429 = Too Many Requests (rate limit)
  if (statusCode === 429) return true;
  // 5xx = Erro de servidor temporário
  if (statusCode >= 500 && statusCode <= 599) return true;
  // 4xx (400, 401, 403, 404, 422) = Erros lógicos de cliente permanentes (não retentar)
  return false;
}

/** Intervalos de backoff determinístico para retries: 30s após tentativa 1; 2min após tentativa 2. */
export const WEBHOOK_RETRY_INTERVALS_MS = [
  30 * 1000,   // Tentativa 2 após 30 segundos
  120 * 1000,  // Tentativa 3 após 2 minutos
];

/**
 * Executa uma tentativa de entrega para um registro de WebhookDelivery.
 * Mantém o mesmo eventId em todos os retries para garantir idempotência no receptor.
 */
export async function executeDeliveryAttempt(
  delivery: WebhookDelivery,
  secret: string,
  fetchFn: typeof fetch = fetch,
): Promise<WebhookDelivery> {
  const attemptNum = (delivery.attempts || 0) + 1;
  delivery.attempts = attemptNum;
  const now = new Date();
  const nowISO = now.toISOString();
  const timestamp = Math.floor(now.getTime() / 1000);

  // Serializa payload preservando estritamente o eventId original
  const payloadStr = JSON.stringify({
    id: delivery.eventId,
    event: delivery.event,
    businessId: delivery.businessId,
    createdAt: delivery.createdAt,
    data: delivery.payloadSummary,
  });

  const signature = signWebhookPayload(secret, payloadStr, timestamp);
  const headerVal = `t=${timestamp},v1=${signature}`;

  const start = Date.now();
  let statusCode = 0;
  let isSuccess = false;
  let errorMsg = '';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const res = await fetchFn(delivery.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Instalink-Signature': headerVal,
        'X-Instalink-Timestamp': String(timestamp),
        'X-Instalink-Delivery-Id': delivery.id,
        'X-Instalink-Event-Id': delivery.eventId,
        'X-Instalink-Attempt': String(attemptNum),
        'User-Agent': 'InstaLink-Webhook/1.0',
      },
      body: payloadStr,
      signal: controller.signal,
    }).catch((e: any) => ({
      ok: false,
      status: 0,
      statusText: e?.message || 'Falha de conexão ou timeout',
    }));

    clearTimeout(timer);
    statusCode = res.status;
    isSuccess = Boolean(res.ok);
    if (!res.ok) {
      errorMsg = `HTTP ${res.status}: ${(res as any).statusText || 'Falha na entrega'}`;
    }
  } catch (err: any) {
    statusCode = 0;
    errorMsg = err?.message || 'Erro inesperado na entrega';
  }

  const durationMs = Date.now() - start;

  if (!Array.isArray(delivery.attemptsHistory)) {
    delivery.attemptsHistory = [];
  }

  delivery.attemptsHistory.push({
    attempt: attemptNum,
    at: nowISO,
    statusCode,
    error: errorMsg || undefined,
    durationMs,
  });

  delivery.statusCode = statusCode;
  delivery.updatedAt = nowISO;

  if (isSuccess) {
    delivery.status = 'success';
    delivery.deliveredAt = nowISO;
    delivery.error = undefined;
    delivery.nextRetryAt = undefined;
  } else {
    delivery.error = errorMsg;
    const canRetry = attemptNum < (delivery.maxAttempts || 3) && isRetryableWebhookStatus(statusCode);
    if (canRetry) {
      delivery.status = 'pending';
      const delayMs = WEBHOOK_RETRY_INTERVALS_MS[attemptNum - 1] || 120_000;
      delivery.nextRetryAt = new Date(now.getTime() + delayMs).toISOString();
    } else {
      delivery.status = 'failed';
      delivery.nextRetryAt = undefined;
    }
  }

  return delivery;
}

/** Despacha evento para todos os webhooks ativos do negócio (Tentativa 1 imediata + agendamento de retry). */
export async function dispatchWebhook(
  db: DB,
  event: WebhookEvent,
  businessId: string,
  data: Record<string, any>,
  fetchFn: typeof fetch = fetch,
): Promise<WebhookDelivery[]> {
  if (!Array.isArray(db.webhooks)) db.webhooks = [];
  if (!Array.isArray(db.webhookDeliveries)) db.webhookDeliveries = [];

  const activeWebhooks = db.webhooks.filter(
    (w) => w.businessId === businessId && w.active && w.events.includes(event),
  );

  if (activeWebhooks.length === 0) return [];

  const eventId = `evt_${randomUUID()}`;
  const now = new Date().toISOString();
  const deliveries: WebhookDelivery[] = [];

  for (const hook of activeWebhooks) {
    const delivery: WebhookDelivery = {
      id: randomUUID(),
      webhookId: hook.id,
      businessId,
      event,
      eventId,
      url: hook.url,
      payloadSummary: data || {},
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      attemptsHistory: [],
      createdAt: now,
      updatedAt: now,
    };

    // Executa a primeira tentativa
    await executeDeliveryAttempt(delivery, hook.secret, fetchFn);

    db.webhookDeliveries.push(delivery);
    deliveries.push(delivery);
  }

  return deliveries;
}

/**
 * Processa entregas pendentes com retry agendado vencido.
 * Pode ser invocado por cron, worker ou deterministamente em testes.
 */
export async function processPendingWebhookDeliveries(
  db: DB,
  nowISO = new Date().toISOString(),
  fetchFn: typeof fetch = fetch,
): Promise<WebhookDelivery[]> {
  if (!Array.isArray(db.webhookDeliveries)) return [];

  const nowDate = new Date(nowISO).getTime();
  const pending = db.webhookDeliveries.filter((d) => {
    if (d.status !== 'pending') return false;
    if (!d.nextRetryAt) return true;
    return new Date(d.nextRetryAt).getTime() <= nowDate;
  });

  const processed: WebhookDelivery[] = [];
  for (const delivery of pending) {
    const webhook = (db.webhooks || []).find((w) => w.id === delivery.webhookId);
    if (!webhook || !webhook.active) {
      delivery.status = 'failed';
      delivery.error = 'Webhook foi desativado ou removido.';
      delivery.nextRetryAt = undefined;
      processed.push(delivery);
      continue;
    }

    await executeDeliveryAttempt(delivery, webhook.secret, fetchFn);
    processed.push(delivery);
  }

  return processed;
}

/** Executa imediatamente o próximo retry de uma entrega pendente pelo seu ID. */
export async function retryWebhookDelivery(
  db: DB,
  deliveryId: string,
  fetchFn: typeof fetch = fetch,
): Promise<WebhookDelivery | null> {
  if (!Array.isArray(db.webhookDeliveries)) return null;
  const delivery = db.webhookDeliveries.find((d) => d.id === deliveryId);
  if (!delivery) return null;
  const webhook = (db.webhooks || []).find((w) => w.id === delivery.webhookId);
  if (!webhook) {
    delivery.status = 'failed';
    delivery.error = 'Webhook correspondente não encontrado.';
    return delivery;
  }
  return await executeDeliveryAttempt(delivery, webhook.secret, fetchFn);
}
