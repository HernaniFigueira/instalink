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
// Escrita condicional (CAS) do banco — usada pelo consumidor automático da
// fila de retry para que duas execuções não entreguem a mesma tentativa.
import { updateDBWithCas } from './db';
// Guarda de destino (P6): URL de saída apontando para rede interna é recusada
// na configuração — o mesmo critério vale para todo conector futuro.
import { assertOutboundUrlAllowed } from './outbound-url';

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
  // SSRF (P6): destino interno/privado é recusado na CONFIGURAÇÃO — em
  // produção. Em desenvolvimento/teste o alvo privado continua valendo (os
  // smokes usam receptor em 127.0.0.1); em produção, `ALLOW_PRIVATE_OUTBOUND_URLS=1`
  // libera explicitamente (on-prem). Ver `lib/outbound-url.ts`.
  assertOutboundUrlAllowed(url);

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
 * Versão de exibição de uma entrega (painel/API): remove os campos internos
 * de posse do consumidor automático. Nenhum segredo é adicionado ou removido
 * aqui — o registro já não carrega o segredo do webhook.
 */
export function sanitizeWebhookDeliveryForDisplay(delivery: WebhookDelivery): Omit<WebhookDelivery, 'claimToken' | 'claimExpiresAt'> {
  const { claimToken, claimExpiresAt, ...safe } = delivery;
  return safe;
}

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
 *
 * Duas formas de uso, mesma lógica de retry:
 *
 *  1) PRODUÇÃO — `processPendingWebhookDeliveries()` (ou com opções):
 *     lê o banco real, REIVINDICA (claim com CAS) as entregas vencidas,
 *     executa a tentativa e grava o resultado. É o que o cron chama; pode
 *     rodar concorrentemente sem entregar a mesma tentativa duas vezes.
 *
 *  2) DETERMINÍSTICO — `processPendingWebhookDeliveries(db, nowISO, fetchFn)`:
 *     opera sobre um `db` já carregado em memória (testes/uso embutido), sem
 *     I/O de banco. Mesma seleção de vencidas, mesma posse respeitada.
 */
export function processPendingWebhookDeliveries(
  db: DB,
  nowISO?: string,
  fetchFn?: typeof fetch,
  options?: WebhookRetryRunOptions,
): Promise<WebhookDelivery[]>;
export function processPendingWebhookDeliveries(options?: WebhookRetryRunOptions): Promise<WebhookDelivery[]>;
export async function processPendingWebhookDeliveries(
  dbOrOptions?: DB | WebhookRetryRunOptions,
  nowISOArg?: string,
  fetchFnArg?: typeof fetch,
  optionsArg: WebhookRetryRunOptions = {},
): Promise<WebhookDelivery[]> {
  if (looksLikeDb(dbOrOptions)) {
    // Modo determinístico: o `db` recebido é mutado em memória.
    return runWebhookRetryOnDb(
      dbOrOptions,
      nowISOArg || new Date().toISOString(),
      fetchFnArg || fetch,
      optionsArg,
    );
  }
  const options: WebhookRetryRunOptions = { ...(dbOrOptions || {}), ...optionsArg };
  if (nowISOArg) options.nowISO = options.nowISO || nowISOArg;
  if (fetchFnArg) options.fetchFn = options.fetchFn || fetchFnArg;
  return runWebhookRetryOnStore(options);
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

// ═══════════════════════════════════════════════════════════════
// CONSUMIDOR AUTOMÁTICO DA FILA DE RETRY (AGNÓSTICO DE SCHEDULER)
// ═══════════════════════════════════════════════════════════════
// Até aqui a tentativa 1 acontecia junto do evento e as tentativas 2 e 3
// ficavam agendadas (`status: 'pending'` + `nextRetryAt`) SEM ninguém para
// executá-las — uma entrega que falhasse podia ficar pendente para sempre.
//
// Este é o elo que faltava (nenhuma regra de retry nova foi criada aqui):
//
//   scheduler (qualquer) → GET /api/cron/webhooks (Authorization: Bearer CRON_SECRET)
//        ↓
//   processPendingWebhookDeliveries()
//        ↓ 1. reivindica (claim CAS) as entregas com nextRetryAt vencido
//        ↓ 2. executa a tentativa — MESMO eventId, mesma assinatura HMAC
//        ↓ 3. grava: success | pending (próximo backoff) | failed
//
// Nada aqui depende de plataforma: o processador só toca o banco atual. Quem
// dispara pode ser o Vercel Cron, um cron de VPS, outra função serverless, um
// agendador externo ou uma chamada manual de operação. O intervalo é escolha
// do ambiente — o motor não assume frequência nenhuma.
//
// Regras preservadas do P3: tentativa 1 imediata no evento, tentativa 2 após
// ~30s, tentativa 3 após ~120s, teto de 3 tentativas, retryable → reagenda,
// erro definitivo (4xx) → failed. Nenhum retry infinito.
//
// CONCORRÊNCIA (a mesma entrega nunca sai duas vezes na mesma tentativa):
// o agendador pode sobrepor execuções e o ambiente pode rodar mais de uma
// instância da função. Por isso a reivindicação é gravada com CAS
// (`updateDBWithCas`) e vale por um lease curto. Uma execução só tenta entregar
// o que conseguiu reivindicar e só grava o resultado enquanto a posse ainda for
// dela. Se a função for interrompida no meio, o lease expira e a entrega volta
// para o próximo ciclo — e, mesmo num reenvio, o receptor idempotente
// deduplica pelo MESMO eventId. Sem Redis, sem BullMQ, sem serviço externo: o
// banco atual (documento JSONB / arquivo local) é o árbitro.

/** Validade (lease) da posse de uma entrega por uma execução do consumidor. */
export const WEBHOOK_RETRY_CLAIM_LEASE_MS = 45_000;
/** Teto de entregas por ciclo do consumidor automático (protege o timeout da função). */
export const WEBHOOK_RETRY_BATCH_SIZE = 20;
/** Orçamento de tempo por ciclo — o que sobrar volta no próximo cron. */
export const WEBHOOK_RETRY_BUDGET_MS = 8_000;

export interface WebhookRetryRunOptions {
  /** "Agora" da execução (ISO). Injetável para testes determinísticos. */
  nowISO?: string;
  /** Cliente HTTP (injetável em testes). */
  fetchFn?: typeof fetch;
  /** Dono da posse (padrão: `run_<uuid>`). */
  holder?: string;
  leaseMs?: number;
  batchSize?: number;
  budgetMs?: number;
}

/** Contadores operacionais de um ciclo — nunca contêm segredos nem payloads. */
export interface WebhookRetryRunSummary {
  processed: number;
  delivered: number;
  rescheduled: number;
  failed: number;
  durationMs: number;
}

/**
 * Entrega reivindicada + segredo do webhook.
 * Uso INTERNO do servidor: nunca serializar, logar ou devolver em resposta.
 */
export interface ClaimedWebhookDelivery {
  delivery: WebhookDelivery;
  secret: string;
}

function envPositiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function looksLikeDb(value: unknown): value is DB {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as DB;
  return (
    Array.isArray(candidate.businesses) ||
    Array.isArray(candidate.webhooks) ||
    Array.isArray(candidate.webhookDeliveries)
  );
}

/** Posse (lease) ainda válida? Posse ausente/expirada = entrega elegível. */
export function isWebhookClaimLive(delivery: WebhookDelivery, nowISO = new Date().toISOString()): boolean {
  if (!delivery.claimToken || !delivery.claimExpiresAt) return false;
  const expiresAt = new Date(delivery.claimExpiresAt).getTime();
  const nowMs = new Date(nowISO).getTime();
  return Number.isFinite(expiresAt) && Number.isFinite(nowMs) && expiresAt > nowMs;
}

/**
 * A entrega está pronta para uma nova tentativa?
 * Somente `pending` e com `nextRetryAt` vencido (ou sem agendamento — entrega
 * cuja 1ª tentativa nem chegou a ser gravada). `success` e `failed` NUNCA
 * voltam para a fila.
 */
export function isWebhookDeliveryDue(delivery: WebhookDelivery, nowISO = new Date().toISOString()): boolean {
  if (delivery.status !== 'pending') return false;
  if (!delivery.nextRetryAt) return true;
  const dueAt = new Date(delivery.nextRetryAt).getTime();
  if (!Number.isFinite(dueAt)) return true; // agendamento ilegível não pode travar a fila
  return dueAt <= new Date(nowISO).getTime();
}

/** Quantas entregas estão vencidas e livres de posse ativa (guarda do CAS). */
export function countDueWebhookDeliveries(db: DB, nowISO = new Date().toISOString()): number {
  if (!Array.isArray(db.webhookDeliveries)) return 0;
  return db.webhookDeliveries.filter(
    (d) => isWebhookDeliveryDue(d, nowISO) && !isWebhookClaimLive(d, nowISO),
  ).length;
}

/** Libera a posse: a entrega volta a ser elegível assim que o agendamento vencer. */
export function releaseWebhookClaim(delivery: WebhookDelivery): void {
  delivery.claimToken = undefined;
  delivery.claimExpiresAt = undefined;
}

/** Encerra uma entrega cujo webhook foi removido/desativado (comportamento do P3). */
function failDeliveryWithoutWebhook(delivery: WebhookDelivery, nowISO: string): void {
  delivery.status = 'failed';
  delivery.error = 'Webhook foi desativado ou removido.';
  delivery.nextRetryAt = undefined;
  delivery.updatedAt = nowISO;
  releaseWebhookClaim(delivery);
}

function retryOrderKey(delivery: WebhookDelivery): number {
  const key = new Date(delivery.nextRetryAt || delivery.createdAt || 0).getTime();
  return Number.isFinite(key) ? key : 0;
}

/**
 * Reivindica (claim) as entregas vencidas para ESTA execução.
 * Puro sobre o `db` recebido — quem grava de forma atômica é o chamador
 * (produção: `updateDBWithCas`; ver `runWebhookRetryOnStore`).
 *
 * - respeita posse viva de outra execução (é o que impede entrega dupla);
 * - encerra como `failed` a entrega cujo webhook foi removido/desativado;
 * - FIFO por `nextRetryAt` (mais antiga primeiro) e no máximo `limit` por ciclo.
 */
export function claimPendingWebhookDeliveries(
  db: DB,
  options: { nowISO: string; holder: string; leaseMs?: number; limit?: number },
): ClaimedWebhookDelivery[] {
  if (!Array.isArray(db.webhookDeliveries)) return [];
  if (!Array.isArray(db.webhooks)) db.webhooks = [];

  const { nowISO, holder } = options;
  const leaseMs = options.leaseMs ?? WEBHOOK_RETRY_CLAIM_LEASE_MS;
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const nowMs = new Date(nowISO).getTime();

  const candidates = db.webhookDeliveries
    .filter((d) => isWebhookDeliveryDue(d, nowISO) && !isWebhookClaimLive(d, nowISO))
    .sort((a, b) => retryOrderKey(a) - retryOrderKey(b));

  const claimed: ClaimedWebhookDelivery[] = [];
  for (const delivery of candidates) {
    const webhook = db.webhooks.find((w) => w.id === delivery.webhookId);
    if (!webhook || !webhook.active) {
      failDeliveryWithoutWebhook(delivery, nowISO);
      continue;
    }
    if (claimed.length >= limit) break;
    delivery.claimToken = holder;
    delivery.claimExpiresAt = new Date(nowMs + leaseMs).toISOString();
    delivery.updatedAt = nowISO;
    claimed.push({ delivery, secret: webhook.secret });
  }
  return claimed;
}

/**
 * Grava o resultado das tentativas desta execução.
 * Só toca em entregas cuja posse ainda é DESTA execução — se outra execução
 * assumiu a entrega nesse meio-tempo, o resultado local é descartado (o
 * receptor deduplica pelo mesmo eventId).
 */
export function applyWebhookRetryResults(db: DB, holder: string, processed: WebhookDelivery[]): number {
  if (!Array.isArray(db.webhookDeliveries)) return 0;
  let applied = 0;
  for (const snapshot of processed) {
    const target = db.webhookDeliveries.find((d) => d.id === snapshot.id);
    if (!target || target.claimToken !== holder) continue;
    target.status = snapshot.status;
    target.statusCode = snapshot.statusCode;
    target.error = snapshot.error;
    target.attempts = snapshot.attempts;
    target.maxAttempts = snapshot.maxAttempts;
    target.nextRetryAt = snapshot.nextRetryAt;
    target.deliveredAt = snapshot.deliveredAt;
    target.attemptsHistory = snapshot.attemptsHistory;
    target.updatedAt = snapshot.updatedAt;
    releaseWebhookClaim(target);
    applied += 1;
  }
  return applied;
}

/** Resumo seguro para a resposta do cron: apenas contadores operacionais. */
export function summarizeWebhookRetryRun(
  processed: WebhookDelivery[],
  durationMs: number,
): WebhookRetryRunSummary {
  return {
    processed: processed.length,
    delivered: processed.filter((d) => d.status === 'success').length,
    rescheduled: processed.filter((d) => d.status === 'pending').length,
    failed: processed.filter((d) => d.status === 'failed').length,
    durationMs: Math.max(0, Math.round(durationMs)),
  };
}

/** Modo determinístico: processa a fila sobre um `db` já carregado. */
async function runWebhookRetryOnDb(
  db: DB,
  nowISO: string,
  fetchFn: typeof fetch,
  options: WebhookRetryRunOptions,
): Promise<WebhookDelivery[]> {
  if (!Array.isArray(db.webhookDeliveries)) return [];
  if (!Array.isArray(db.webhooks)) db.webhooks = [];

  const limit = options.batchSize ?? Number.POSITIVE_INFINITY;
  const processed: WebhookDelivery[] = [];

  // Mesma seleção da produção (vencidas + sem posse viva de terceiros), sem
  // gravar posse: aqui não há outra instância disputando o mesmo objeto.
  const due = db.webhookDeliveries
    .filter((d) => isWebhookDeliveryDue(d, nowISO) && !isWebhookClaimLive(d, nowISO))
    .sort((a, b) => retryOrderKey(a) - retryOrderKey(b))
    .slice(0, limit === Number.POSITIVE_INFINITY ? undefined : Math.max(0, limit));

  for (const delivery of due) {
    const webhook = db.webhooks.find((w) => w.id === delivery.webhookId);
    if (!webhook || !webhook.active) {
      failDeliveryWithoutWebhook(delivery, nowISO);
      processed.push(delivery);
      continue;
    }
    await executeDeliveryAttempt(delivery, webhook.secret, fetchFn);
    releaseWebhookClaim(delivery);
    processed.push(delivery);
  }

  return processed;
}

/**
 * Modo produção (cron): reivindica no banco real, entrega e grava o resultado.
 * Nenhuma regra de retry nova — apenas a orquestração de quem já existe.
 */
async function runWebhookRetryOnStore(options: WebhookRetryRunOptions): Promise<WebhookDelivery[]> {
  const nowISO = options.nowISO || new Date().toISOString();
  const holder = options.holder || `run_${randomUUID()}`;
  const leaseMs = options.leaseMs ?? envPositiveInt('WEBHOOK_RETRY_LEASE_MS', WEBHOOK_RETRY_CLAIM_LEASE_MS);
  const batchSize = options.batchSize ?? envPositiveInt('WEBHOOK_RETRY_BATCH_SIZE', WEBHOOK_RETRY_BATCH_SIZE);
  const budgetMs = options.budgetMs ?? envPositiveInt('WEBHOOK_RETRY_BUDGET_MS', WEBHOOK_RETRY_BUDGET_MS);
  const fetchFn = options.fetchFn || fetch;

  // 1) Reivindicação atômica (CAS): duas execuções simultâneas nunca pegam a
  //    mesma entrega — a segunda encontra a posse viva e não reivindica.
  const claim = await updateDBWithCas(
    (db) => claimPendingWebhookDeliveries(db, { nowISO, holder, leaseMs, limit: batchSize }),
    { guard: (db) => countDueWebhookDeliveries(db, nowISO) > 0 },
  );
  const claimed = claim.result || [];
  if (claimed.length === 0) return [];

  // 2) Tentativas FORA do lock do banco (HTTP não pode segurar a escrita) e
  //    dentro do orçamento de tempo da função — o resto volta no próximo ciclo.
  const startedAt = Date.now();
  const processed: WebhookDelivery[] = [];
  for (const item of claimed) {
    if (Date.now() - startedAt >= budgetMs) break;
    await executeDeliveryAttempt(item.delivery, item.secret, fetchFn);
    processed.push(item.delivery);
  }
  if (processed.length === 0) return [];

  // 3) Resultado gravado apenas enquanto a posse ainda for desta execução.
  await updateDBWithCas((db) => applyWebhookRetryResults(db, holder, processed), {
    guard: (db) => Array.isArray(db.webhookDeliveries) && db.webhookDeliveries.some((d) => d.claimToken === holder),
  });

  return processed;
}
