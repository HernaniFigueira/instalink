// ═══════════════════════════════════════════════════════════════
// META WHATSAPP CLOUD API — CLIENTE OFICIAL, CRIPTOGRAFIA & OUTBOX
// ═══════════════════════════════════════════════════════════════
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Business, DB, Message, WhatsappIntegration } from './types';
import { readDB, updateDB, updateDBWithCas } from './db';
import {
  type ChannelConnector,
  type ChannelSendResult,
  type ConnectorContext,
  type OutboundChannelMessage,
  registerChannelConnector,
} from './integrations/connectors';

export const DEFAULT_META_GRAPH_VERSION = 'v21.0';
export const WHATSAPP_CLAIM_LEASE_MS = 60_000; // 60 segundos
export const WHATSAPP_RETRY_INTERVALS_MS = [30_000, 120_000]; // 1º retry em 30s, 2º retry em 120s
export const WHATSAPP_MAX_ATTEMPTS = 3;

export function getMetaGraphVersion(): string {
  return (process.env.META_GRAPH_VERSION || DEFAULT_META_GRAPH_VERSION).trim();
}

export function getMetaGraphBaseUrl(): string {
  return `https://graph.facebook.com/${getMetaGraphVersion()}`;
}

// ── Criptografia de Credenciais Multi-Tenant (AES-256-GCM) ──

/**
 * Retorna a chave AES-256 derivada EXCLUSIVAMENTE de WHATSAPP_CREDENTIALS_KEY.
 * NUNCA faz fallback para token, session secret ou chave estática.
 */
export function getCredentialsKey(): Buffer | null {
  const secret = process.env.WHATSAPP_CREDENTIALS_KEY;
  if (!secret || secret.trim().length === 0) {
    return null;
  }
  return createHash('sha256').update(secret.trim()).digest();
}

/**
 * Criptografa token de acesso para armazenamento em repouso no Business.
 * Falha explicitamente se WHATSAPP_CREDENTIALS_KEY não estiver configurada.
 */
export function encryptSecret(plainText: string): string {
  if (!plainText) return '';
  const key = getCredentialsKey();
  if (!key) {
    throw new Error('Chave de criptografia WHATSAPP_CREDENTIALS_KEY não configurada no ambiente.');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Descriptografa token de acesso no servidor. Retorna '' se chave ausente ou token inválido. */
export function decryptSecret(cipherText: string): string {
  if (!cipherText || !cipherText.includes(':')) return '';
  const key = getCredentialsKey();
  if (!key) {
    return '';
  }
  try {
    const parts = cipherText.split(':');
    if (parts.length !== 3) return '';
    const [ivHex, tagHex, dataHex] = parts;
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

// ── Resolução de Credenciais por Business (Tenant Isolation) ──

export interface ResolvedWhatsappCredentials {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  source: 'business' | 'server';
}

/**
 * Resolve credenciais ativas do WhatsApp para o negócio informado.
 * Prioridade:
 *   1. Credencial configurada e criptografada no Business.
 *   2. Variáveis de ambiente globais do servidor (fallback de implantação única).
 */
export function getWhatsappCredentials(business: Business): ResolvedWhatsappCredentials | null {
  const integration = business.whatsappIntegration;
  if (integration?.phoneNumberId && integration.encryptedAccessToken) {
    const token = decryptSecret(integration.encryptedAccessToken);
    if (token) {
      return {
        phoneNumberId: integration.phoneNumberId,
        wabaId: integration.wabaId || '',
        accessToken: token,
        source: 'business',
      };
    }
  }

  // Fallback do servidor (apenas se configurado nas env vars)
  const envToken = process.env.WHATSAPP_API_TOKEN || '';
  const envPhoneId = integration?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const envWabaId = integration?.wabaId || process.env.WHATSAPP_WABA_ID || '';

  if (envToken && envPhoneId) {
    return {
      phoneNumberId: envPhoneId,
      wabaId: envWabaId,
      accessToken: envToken,
      source: 'server',
    };
  }

  return null;
}

// ── Validação de Autenticidade do Webhook Meta ──

/**
 * Valida a assinatura HMAC-SHA256 enviada pela Meta no cabeçalho x-hub-signature-256.
 * FALHA FECHADA: se appSecret estiver ausente, sempre retorna false.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET,
): boolean {
  if (!appSecret) return false; // Fail-closed: sem app secret configurado, nunca aceita assinatura
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expected = signatureHeader.slice(7);
  try {
    const hmac = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
    if (expected.length !== hmac.length) return false;
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(hmac, 'hex'));
  } catch {
    return false;
  }
}

// ── Diagnóstico e Teste de Conexão com a Graph API ──

export interface MetaConnectionCheckResult {
  ok: boolean;
  verifiedName?: string;
  displayPhoneNumber?: string;
  qualityRating?: string;
  codeVerificationStatus?: string;
  error?: string;
  statusCode?: number;
}

/**
 * Executa uma consulta real na Graph API para validar o phoneNumberId e o accessToken.
 * NUNCA execute dentro de lock do banco (updateDB).
 */
export async function testMetaConnection(
  phoneNumberId: string,
  accessToken: string,
  options?: { fetchFn?: typeof fetch },
): Promise<MetaConnectionCheckResult> {
  assertOutsideDBTransaction();
  const doFetch = options?.fetchFn || fetch;
  const url = `${getMetaGraphBaseUrl()}/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating,code_verification_status`;

  try {
    const res = await doFetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = data?.error?.message || `Meta API respondeu com status ${res.status}`;
      return {
        ok: false,
        statusCode: res.status,
        error: errMsg,
      };
    }

    return {
      ok: true,
      statusCode: res.status,
      verifiedName: data.verified_name,
      displayPhoneNumber: data.display_phone_number,
      qualityRating: data.quality_rating,
      codeVerificationStatus: data.code_verification_status,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Falha na conexão de rede com a Meta API.',
    };
  }
}

// ── Envio de Mensagens de Saída (Graph API) ──

export interface SendTemplateConfig {
  name: string;
  language?: string; // padrão pt_BR
  components?: Array<Record<string, any>>;
}

export interface SendMessageOptions {
  phoneNumberId: string;
  accessToken: string;
  to: string; // formato internacional só dígitos: 5511999998888
  body?: string;
  template?: SendTemplateConfig;
  fetchFn?: typeof fetch;
}

export interface SendMessageResult {
  ok: boolean;
  externalId?: string;
  error?: string;
  statusCode?: number;
  retryable?: boolean;
}

/** Erros transitórios da Meta que justificam retry automático. */
export function isRetryableMetaStatus(statusCode?: number, errorCode?: number): boolean {
  if (!statusCode) return true;
  if (statusCode >= 500 && statusCode <= 599) return true;
  if (statusCode === 429) return true;
  // Códigos de erro transitório documentados pela Meta
  if (errorCode && [131016, 131021, 130429, 1, 2].includes(errorCode)) return true;
  return false;
}

/**
 * Envia mensagem real via Meta WhatsApp Cloud API.
 * Deve ser chamada EXCLUSIVAMENTE FORA de transações/locks de banco.
 */
export async function sendMetaGraphMessage(opts: SendMessageOptions): Promise<SendMessageResult> {
  assertOutsideDBTransaction();
  const doFetch = opts.fetchFn || fetch;
  const url = `${getMetaGraphBaseUrl()}/${opts.phoneNumberId}/messages`;

  let cleanTo = opts.to.replace(/\D/g, '');
  if (cleanTo.length === 10 || cleanTo.length === 11) {
    cleanTo = `55${cleanTo}`;
  }

  let payload: Record<string, any>;
  if (opts.template) {
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: 'template',
      template: {
        name: opts.template.name,
        language: { code: opts.template.language || 'pt_BR' },
        components: opts.template.components || [],
      },
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanTo,
      type: 'text',
      text: {
        preview_url: false,
        body: String(opts.body || '').slice(0, 4000),
      },
    };
  }

  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errorCode = data?.error?.code;
      const errorSubcode = data?.error?.error_subcode;
      const errorMsg = data?.error?.message || `Meta API respondeu com status ${res.status}`;
      return {
        ok: false,
        statusCode: res.status,
        error: `${errorCode ? `[${errorCode}] ` : ''}${errorMsg}${errorSubcode ? ` (subcode ${errorSubcode})` : ''}`,
        retryable: isRetryableMetaStatus(res.status, errorCode),
      };
    }

    const messageId = data?.messages?.[0]?.id;
    return {
      ok: true,
      statusCode: res.status,
      externalId: messageId,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Falha de rede ao contatar a Meta Cloud API.',
      retryable: true,
    };
  }
}

// ── Outbox & Retry Engine de Mensagens WhatsApp ──

function assertOutsideDBTransaction() {
  if (process.env.INSTALINK_IN_TRANSACTION === 'true') {
    throw new Error('VIOLAÇÃO DE ARQUITETURA: Chamada externa de rede executada dentro de uma transação ou lock do banco de dados.');
  }
}

/** Verifica se a mensagem está atualmente com lease de envio ativo. */
export function isWhatsappMessageClaimLive(msg: Message, nowISO = new Date().toISOString()): boolean {
  if (!msg.claimToken || !msg.claimExpiresAt) return false;
  const expires = new Date(msg.claimExpiresAt).getTime();
  const now = new Date(nowISO).getTime();
  return Number.isFinite(expires) && expires > now;
}

/** Mensagem elegível para envio ou retry? */
export function isWhatsappMessageDue(msg: Message, nowISO = new Date().toISOString()): boolean {
  if (msg.status !== 'pending') return false;
  if (!msg.nextRetryAt) return true;
  const due = new Date(msg.nextRetryAt).getTime();
  return Number.isFinite(due) && due <= new Date(nowISO).getTime();
}

/**
 * Reivindica atômica e exclusivamente mensagens pendentes para entrega.
 * Função pura chamada dentro do updateDBWithCas.
 */
export function claimPendingWhatsappMessages(
  db: DB,
  businessId: string,
  holder: string,
  limit = 10,
  nowISO = new Date().toISOString(),
  targetMessageIds?: string[],
): Message[] {
  const leaseUntil = new Date(new Date(nowISO).getTime() + WHATSAPP_CLAIM_LEASE_MS).toISOString();
  const candidates = db.messages.filter((m) => {
    if (m.businessId !== businessId) return false;
    if (m.direction !== 'out') return false;
    if (targetMessageIds && !targetMessageIds.includes(m.id)) return false;
    return isWhatsappMessageDue(m, nowISO) && !isWhatsappMessageClaimLive(m, nowISO);
  });

  const claimed: Message[] = [];
  for (const m of candidates.slice(0, limit)) {
    m.claimToken = holder;
    m.claimExpiresAt = leaseUntil;
    claimed.push(m);
  }
  return claimed;
}

export type DeliverWhatsappMessageResult = {
  ok: boolean;
  status: 'sent' | 'pending' | 'failed' | 'claimed_by_other';
  externalId?: string;
  error?: string;
  nextRetryAt?: string;
  attempts?: number;
};

/**
 * Entrega uma mensagem específica persistida em db.messages com status 'pending'.
 * Executa a claim atômica exclusiva, a chamada HTTP à Meta e grava o resultado final.
 * Retorna status real persistido ('sent', 'pending' se agendado retry, ou 'failed').
 */
export async function deliverWhatsappMessage(
  businessId: string,
  messageId: string,
  options?: { fetchFn?: typeof fetch; nowISO?: string },
): Promise<DeliverWhatsappMessageResult> {
  assertOutsideDBTransaction();
  const nowISO = options?.nowISO || new Date().toISOString();
  const holder = `send_${randomUUID()}`;

  // 1. Claim atômico exclusivo via CAS
  const claimRes = await updateDBWithCas(
    (d) => claimPendingWhatsappMessages(d, businessId, holder, 1, nowISO, [messageId]),
    { guard: (d) => d.messages.some((m) => m.id === messageId && m.status === 'pending') },
  );

  const claimed = claimRes.result?.[0];
  if (!claimed) {
    return {
      ok: false,
      status: 'claimed_by_other',
      error: 'Mensagem não encontrada ou já reivindicada por outro processo concorrente.',
    };
  }

  // 2. Busca parâmetros e credenciais do negócio
  let business: Business | undefined;
  let destinationPhone = '';
  const msgBody = claimed.body;
  const msgMeta = claimed.meta;

  await updateDB((d) => {
    business = d.businesses.find((b) => b.id === businessId);
    const conv = d.conversations.find((c) => c.id === claimed.conversationId);
    destinationPhone = conv?.phone || claimed.channelUserId || '';
  });

  if (!business) {
    await updateDB((d) => {
      const m = d.messages.find((x) => x.id === messageId && x.claimToken === holder);
      if (m) { m.status = 'failed'; m.error = 'Unidade não encontrada.'; m.claimToken = undefined; }
    });
    return { ok: false, status: 'failed', error: 'Unidade não encontrada.' };
  }

  const credentials = getWhatsappCredentials(business);
  if (!credentials) {
    await updateDB((d) => {
      const m = d.messages.find((x) => x.id === messageId && x.claimToken === holder);
      if (m) {
        m.claimToken = undefined;
        m.claimExpiresAt = undefined;
      }
    });
    return { ok: false, status: 'pending', error: 'WhatsApp não configurado para esta unidade.' };
  }

  if (!destinationPhone) {
    await updateDB((d) => {
      const m = d.messages.find((x) => x.id === messageId && x.claimToken === holder);
      if (m) { m.status = 'failed'; m.error = 'Telefone do destinatário não encontrado na conversa.'; m.claimToken = undefined; }
    });
    return { ok: false, status: 'failed', error: 'Telefone do destinatário ausente.' };
  }

  // 3. Chamada HTTP fora do lock
  const templateConfig = msgMeta?.templateName ? {
    name: msgMeta.templateName,
    language: msgMeta.templateLanguage || 'pt_BR',
    components: msgMeta.templateComponents,
  } : undefined;

  const sendRes = await sendMetaGraphMessage({
    phoneNumberId: credentials.phoneNumberId,
    accessToken: credentials.accessToken,
    to: destinationPhone,
    body: msgBody,
    template: templateConfig,
    fetchFn: options?.fetchFn,
  });

  // 4. Gravação curta do resultado e status persistido honesto
  let finalStatus: 'sent' | 'pending' | 'failed' = 'failed';
  let nextRetryAtStr: string | undefined;
  let attemptsCount = (claimed.attempts || 0) + 1;

  await updateDB((d) => {
    const target = d.messages.find((m) => m.id === messageId && m.claimToken === holder);
    const b = d.businesses.find((x) => x.id === businessId);
    if (!target) return;

    target.claimToken = undefined;
    target.claimExpiresAt = undefined;

    if (sendRes.ok && sendRes.externalId) {
      target.status = 'sent';
      target.externalId = sendRes.externalId;
      target.error = undefined;
      target.nextRetryAt = undefined;
      finalStatus = 'sent';
      if (b && b.whatsappIntegration) {
        b.whatsappIntegration.lastOutboundAt = nowISO;
      }
    } else {
      const attemptNum = (target.attempts || 0) + 1;
      target.attempts = attemptNum;
      attemptsCount = attemptNum;
      target.error = sendRes.error || 'Falha ao enviar mensagem pela Meta API.';

      if (sendRes.retryable && attemptNum < WHATSAPP_MAX_ATTEMPTS) {
        target.status = 'pending';
        const delay = WHATSAPP_RETRY_INTERVALS_MS[attemptNum - 1] || 120_000;
        target.nextRetryAt = new Date(Date.now() + delay).toISOString();
        nextRetryAtStr = target.nextRetryAt;
        finalStatus = 'pending';
      } else {
        target.status = 'failed';
        target.nextRetryAt = undefined;
        finalStatus = 'failed';
      }

      if (b && b.whatsappIntegration) {
        b.whatsappIntegration.lastError = target.error;
        b.whatsappIntegration.lastErrorAt = nowISO;
      }
    }
  });

  return {
    ok: sendRes.ok,
    status: finalStatus,
    externalId: sendRes.externalId,
    error: sendRes.error,
    nextRetryAt: nextRetryAtStr,
    attempts: attemptsCount,
  };
}

/**
 * Entrega todas as mensagens pendentes elegíveis de uma unidade sem double claim.
 * Lê os IDs elegíveis e delega para deliverWhatsappMessage onde a claim atômica ocorre com lease.
 */
export async function deliverPendingWhatsappMessages(
  businessId: string,
  options?: { fetchFn?: typeof fetch; limit?: number; nowISO?: string },
): Promise<number> {
  assertOutsideDBTransaction();
  const limit = options?.limit || 10;
  const nowISO = options?.nowISO || new Date().toISOString();

  const db = await readDB();
  const candidateIds = db.messages
    .filter((m) => m.businessId === businessId && m.direction === 'out' && isWhatsappMessageDue(m, nowISO) && !isWhatsappMessageClaimLive(m, nowISO))
    .slice(0, limit)
    .map((m) => m.id);

  let sentCount = 0;
  for (const messageId of candidateIds) {
    const res = await deliverWhatsappMessage(businessId, messageId, options);
    if (res.ok) sentCount++;
  }

  return sentCount;
}

// ── Consumidor Geral de Retentativas de WhatsApp (Mensagens + Campanhas) ──

/**
 * Resolve a unidade para uma change específica do webhook.
 * PHONE_NUMBER_ID É A AUTORIDADE:
 * - Se phoneNumberId foi informado, busca EXATAMENTE por phoneNumberId. Se não achar, NUNCA cai para WABA.
 * - WABA é fallback SOMENTE quando phoneNumberId estiver ausente e houver inequivocamente 1 unidade.
 */
export function resolveTenantForChange(
  db: DB,
  phoneNumberId?: string,
  wabaId?: string,
): Business | null {
  const pId = String(phoneNumberId || '').trim();
  const wId = String(wabaId || '').trim();

  if (pId) {
    const match = db.businesses.find((b) => b.whatsappIntegration?.phoneNumberId === pId);
    return match || null;
  }

  if (wId) {
    const matching = db.businesses.filter((b) => b.whatsappIntegration?.wabaId === wId);
    if (matching.length === 1) {
      return matching[0];
    }
  }

  return null;
}

export interface WhatsappRetrySummary {
  businessesChecked: number;
  messagesProcessed: number;
  messagesSent: number;
  campaignRecipientsSent: number;
  ranAt: string;
}

/**
 * Consome periodicamente todas as mensagens e campanhas pendentes vencidas de todos os tenants.
 * Disparado pelo cron autenticado (/api/cron/whatsapp).
 */
export async function processPendingWhatsappRetries(options?: {
  nowISO?: string;
  fetchFn?: typeof fetch;
}): Promise<WhatsappRetrySummary> {
  assertOutsideDBTransaction();
  const nowISO = options?.nowISO || new Date().toISOString();
  const db = await readDB();

  // 1. Identifica unidades com mensagens devidas
  const dueBusinesses = new Set<string>();
  for (const m of db.messages) {
    if (m.direction === 'out' && isWhatsappMessageDue(m, nowISO) && !isWhatsappMessageClaimLive(m, nowISO)) {
      dueBusinesses.add(m.businessId);
    }
  }

  let totalSent = 0;
  let totalProcessed = 0;

  for (const bizId of dueBusinesses) {
    const sent = await deliverPendingWhatsappMessages(bizId, { ...options, nowISO });
    totalSent += sent;
    totalProcessed += sent;
  }

  // 2. Destinatários de campanhas pendentes vencidos (Item 11)
  let campaignSent = 0;
  const dueRecipients = (db.campaignRecipients || []).filter((r) => {
    if (r.status !== 'pending') return false;
    if (!r.nextRetryAt) return true;
    return new Date(r.nextRetryAt).getTime() <= new Date(nowISO).getTime();
  });

  for (const rec of dueRecipients) {
    const biz = db.businesses.find((b) => b.id === rec.businessId);
    const creds = biz ? getWhatsappCredentials(biz) : null;
    const campaign = db.campaigns.find((c) => c.id === rec.campaignId);
    if (!creds || !campaign) continue;

    const templateConfig = campaign.templateName ? {
      name: campaign.templateName,
      language: campaign.templateLanguage || 'pt_BR',
    } : undefined;

    const res = await sendMetaGraphMessage({
      phoneNumberId: creds.phoneNumberId,
      accessToken: creds.accessToken,
      to: rec.phone,
      body: campaign.message,
      template: templateConfig,
      fetchFn: options?.fetchFn,
    });

    await updateDB((d) => {
      const target = d.campaignRecipients.find((r) => r.id === rec.id);
      if (!target) return;
      if (res.ok && res.externalId) {
        target.status = 'sent';
        target.externalId = res.externalId;
        target.error = '';
        target.nextRetryAt = undefined;
        campaignSent++;
      } else {
        const attempts = (target.attempts || 0) + 1;
        target.attempts = attempts;
        target.error = res.error || 'Falha no envio';
        if (res.retryable && attempts < WHATSAPP_MAX_ATTEMPTS) {
          target.status = 'pending';
          const delay = WHATSAPP_RETRY_INTERVALS_MS[attempts - 1] || 120_000;
          target.nextRetryAt = new Date(Date.now() + delay).toISOString();
        } else {
          target.status = 'failed';
          target.nextRetryAt = undefined;
        }
      }

      // Atualiza o status da campanha se todos os recipients foram resolvidos
      const c = d.campaigns.find((x) => x.id === rec.campaignId);
      if (c) {
        const allRecs = d.campaignRecipients.filter((r) => r.campaignId === c.id);
        const hasPending = allRecs.some((r) => r.status === 'pending');
        const sentRecs = allRecs.filter((r) => r.status === 'sent').length;
        const failedRecs = allRecs.filter((r) => r.status === 'failed').length;
        c.counts.sent = sentRecs;
        c.counts.failed = failedRecs;
        if (!hasPending) {
          if (sentRecs > 0 && failedRecs === 0) c.status = 'sent';
          else if (sentRecs > 0 && failedRecs > 0) c.status = 'partial';
          else if (sentRecs === 0 && failedRecs > 0) c.status = 'failed';
        }
      }
    });
  }

  return {
    businessesChecked: dueBusinesses.size,
    messagesProcessed: totalProcessed,
    messagesSent: totalSent,
    campaignRecipientsSent: campaignSent,
    ranAt: nowISO,
  };
}

// ── Registro do ChannelConnector Oficial de WhatsApp ──

const whatsappChannelConnector: ChannelConnector = {
  provider: 'whatsapp',
  label: 'WhatsApp Cloud API',
  available: true,
  async send(ctx: ConnectorContext, message: OutboundChannelMessage): Promise<ChannelSendResult> {
    assertOutsideDBTransaction();
    const db = await readDB();
    const business = ctx.business || db.businesses.find((b) => b.id === ctx.businessId);

    if (!business) {
      return {
        ok: false,
        code: 'missing_credentials',
        detail: 'Unidade não encontrada para este canal.',
        retryable: false,
      };
    }

    const creds = getWhatsappCredentials(business);
    if (!creds) {
      return {
        ok: false,
        code: 'missing_credentials',
        detail: 'Credenciais do WhatsApp Cloud API ausentes nesta unidade ou no servidor.',
        retryable: false,
      };
    }

    const templateConfig = message.meta?.templateName ? {
      name: message.meta.templateName,
      language: message.meta.templateLanguage || 'pt_BR',
      components: message.meta.templateComponents,
    } : undefined;

    const res = await sendMetaGraphMessage({
      phoneNumberId: creds.phoneNumberId,
      accessToken: creds.accessToken,
      to: message.to,
      body: message.body,
      template: templateConfig,
      fetchFn: ctx.fetchFn,
    });

    if (res.ok) {
      return {
        ok: true,
        code: 'sent',
        detail: 'Mensagem aceita pela Meta Cloud API.',
        externalId: res.externalId,
      };
    }

    return {
      ok: false,
      code: 'provider_error',
      detail: res.error || 'Erro ao enviar mensagem pelo WhatsApp.',
      retryable: res.retryable,
    };
  },
};

registerChannelConnector(whatsappChannelConnector);
export { whatsappChannelConnector };
