// ═══════════════════════════════════════════════════════════════
// META WHATSAPP CLOUD API — CLIENTE OFICIAL, CRIPTOGRAFIA & OUTBOX
// ═══════════════════════════════════════════════════════════════
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Business, Campaign, CampaignRecipient, DB, Message, WhatsappIntegration } from './types';
import { readDB, updateDB, updateDBWithCas } from './db';
import { assertOutsideDBTransaction } from './db-transaction';
import {
  type ChannelConnector,
  type ChannelSendResult,
  type ConnectorContext,
  type OutboundChannelMessage,
  registerChannelConnector,
} from './integrations/connectors';

// Última versão conferida na documentação oficial da Meta (21/07/2026).
// A tabela de vigência de cada versão fica em `whatsapp-onboarding.ts`
// (GRAPH_RELEASES) — há teste garantindo que as duas não divirjam.
export const DEFAULT_META_GRAPH_VERSION = 'v26.0';
export const WHATSAPP_CLAIM_LEASE_MS = 60_000; // 60 segundos
export const WHATSAPP_RETRY_INTERVALS_MS = [30_000, 120_000]; // 1º retry em 30s, 2º retry em 120s
export const WHATSAPP_MAX_ATTEMPTS = 3;
export const CAMPAIGN_IMMEDIATE_BATCH_LIMIT = 5; // Disparo síncrono inicial máximo no request da campanha
export const CAMPAIGN_CRON_BATCH_SIZE = 20; // Lote por ciclo do cron worker

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

// ── Resolução de Credenciais por Business (Tenant Isolation Estrito) ──

export interface ResolvedWhatsappCredentials {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  source: 'business' | 'server';
}

/**
 * Resolve credenciais ativas do WhatsApp para o negócio informado.
 * AUTORIDADE DE PRODUÇÃO:
 *   1. Credencial configurada e criptografada no Business (Business.whatsappIntegration + encryptedAccessToken).
 * MODO LEGADO (SOMENTE MONO-TENANT / DESENVOLVIMENTO):
 *   2. Se a unidade não possuir credenciais próprias, e as variáveis de ambiente globais
 *      estiverem configuradas (WHATSAPP_API_TOKEN e WHATSAPP_PHONE_NUMBER_ID):
 *      O phoneNumberId da unidade DEVE coincidir exatamente com o global (ou a unidade não ter nenhum definido).
 *      NUNCA combina token global com um phoneNumberId arbitrário de outra unidade!
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

  // Fallback do servidor legado monotenant
  const envToken = (process.env.WHATSAPP_API_TOKEN || '').trim();
  const envPhoneId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim();
  const envWabaId = (process.env.WHATSAPP_WABA_ID || '').trim();

  if (envToken && envPhoneId) {
    // Se a unidade possui phoneNumberId definido e difere do global, RECUSA o fallback global
    if (integration?.phoneNumberId && integration.phoneNumberId !== envPhoneId) {
      return null; // Isolamento: impede que Business B use o token global do Business A!
    }
    return {
      phoneNumberId: envPhoneId,
      wabaId: integration?.wabaId || envWabaId,
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
 * SUCESSO SEM WAMID NÃO É SUCESSO: exige externalId válido da Meta.
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

    const messageId = typeof data?.messages?.[0]?.id === 'string' && data.messages[0].id.trim().length > 0
      ? data.messages[0].id.trim()
      : undefined;

    // Regra P6.1: Sucesso sem wamid NÃO é aceito como enviado
    if (!messageId) {
      return {
        ok: false,
        statusCode: res.status,
        error: 'Meta API respondeu status de sucesso mas não retornou o identificador da mensagem (wamid ausente).',
        retryable: false,
      };
    }

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

  const db = await readDB();
  business = db.businesses.find((b) => b.id === businessId);
  const conv = db.conversations.find((c) => c.id === claimed.conversationId);
  destinationPhone = conv?.phone || claimed.channelUserId || '';

  if (!business) {
    await updateDB((d) => {
      const m = d.messages.find((x) => x.id === messageId && x.claimToken === holder);
      if (m) { m.status = 'failed'; m.error = 'Unidade não encontrada.'; m.claimToken = undefined; }
    });
    return { ok: false, status: 'failed', error: 'Unidade não encontrada.' };
  }

  const credentials = getWhatsappCredentials(business);
  if (!credentials) {
    // Se o WhatsApp não estiver configurado para esta unidade, libera o lease
    // sem abortar destrutivamente para respeitar filas pendentes de rascunho/P3
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
        target.nextRetryAt = new Date(new Date(nowISO).getTime() + delay).toISOString();
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
    ok: sendRes.ok && !!sendRes.externalId,
    status: finalStatus,
    externalId: sendRes.externalId,
    error: sendRes.error,
    nextRetryAt: nextRetryAtStr,
    attempts: attemptsCount,
  };
}

export interface BatchDeliveryResult {
  processed: number;
  sent: number;
}

/**
 * Entrega todas as mensagens pendentes elegíveis de uma unidade sem double claim.
 * Lê os IDs elegíveis e delega para deliverWhatsappMessage onde a claim atômica ocorre com lease.
 */
export async function deliverPendingWhatsappMessages(
  businessId: string,
  options?: { fetchFn?: typeof fetch; limit?: number; nowISO?: string },
): Promise<BatchDeliveryResult> {
  assertOutsideDBTransaction();
  const limit = options?.limit || 10;
  const nowISO = options?.nowISO || new Date().toISOString();

  const db = await readDB();
  const candidateIds = db.messages
    .filter((m) => m.businessId === businessId && m.direction === 'out' && isWhatsappMessageDue(m, nowISO) && !isWhatsappMessageClaimLive(m, nowISO))
    .slice(0, limit)
    .map((m) => m.id);

  let sentCount = 0;
  let processedCount = 0;

  for (const messageId of candidateIds) {
    processedCount++;
    const res = await deliverWhatsappMessage(businessId, messageId, options);
    if (res.ok) sentCount++;
  }

  return { processed: processedCount, sent: sentCount };
}

// ── Outbox & Claim/Lease de Destinatários de Campanhas (CampaignRecipient) ──

/** Verifica se o recipient de campanha está com lease ativo. */
export function isCampaignRecipientClaimLive(rec: CampaignRecipient, nowISO = new Date().toISOString()): boolean {
  if (!rec.claimToken || !rec.claimExpiresAt) return false;
  const expires = new Date(rec.claimExpiresAt).getTime();
  const now = new Date(nowISO).getTime();
  return Number.isFinite(expires) && expires > now;
}

/** Recipient de campanha elegível para envio ou retry? */
export function isCampaignRecipientDue(rec: CampaignRecipient, nowISO = new Date().toISOString()): boolean {
  if (rec.status !== 'pending') return false;
  if (!rec.nextRetryAt) return true;
  const due = new Date(rec.nextRetryAt).getTime();
  return Number.isFinite(due) && due <= new Date(nowISO).getTime();
}

/** Claim atômico de recipients de campanha pendentes via CAS. */
export function claimPendingCampaignRecipients(
  db: DB,
  holder: string,
  limit = 10,
  nowISO = new Date().toISOString(),
  targetRecipientIds?: string[],
): CampaignRecipient[] {
  const leaseUntil = new Date(new Date(nowISO).getTime() + WHATSAPP_CLAIM_LEASE_MS).toISOString();
  const candidates = (db.campaignRecipients || []).filter((r) => {
    if (targetRecipientIds && !targetRecipientIds.includes(r.id)) return false;
    // No escaneamento geral da fila pelo worker, campanhas canceladas são ignoradas
    if (!targetRecipientIds) {
      const parent = (db.campaigns || []).find((c) => c.id === r.campaignId);
      if (parent && parent.status === 'cancelled') return false;
    }
    return isCampaignRecipientDue(r, nowISO) && !isCampaignRecipientClaimLive(r, nowISO);
  });

  const claimed: CampaignRecipient[] = [];
  for (const r of candidates.slice(0, limit)) {
    r.claimToken = holder;
    r.claimExpiresAt = leaseUntil;
    claimed.push(r);
  }
  return claimed;
}

export type DeliverCampaignRecipientResult = {
  ok: boolean;
  status: 'sent' | 'pending' | 'failed' | 'claimed_by_other';
  externalId?: string;
  error?: string;
  attempts?: number;
  nextRetryAt?: string;
};

/** Sincroniza contadores e status de campanha com honestidade estrita. */
export function syncCampaignStatusAndCounts(d: DB, c: Campaign, nowISO = new Date().toISOString()): void {
  const allRecs = (d.campaignRecipients || []).filter((r) => r.campaignId === c.id);
  const pendingRecs = allRecs.filter((r) => r.status === 'pending');
  const sentRecs = allRecs.filter((r) => r.status === 'sent');
  const failedRecs = allRecs.filter((r) => r.status === 'failed');

  c.counts.sent = sentRecs.length;
  c.counts.failed = failedRecs.length;
  c.counts.eligible = allRecs.length;

  // Nenhuma campanha cancelada ou em rascunho/pronta pode ser reativada/alterada para sending/sent pelo worker
  if (c.status === 'cancelled' || c.status === 'draft' || c.status === 'ready') {
    c.updatedAt = nowISO;
    return;
  }

  if (pendingRecs.length > 0) {
    c.status = 'sending';
  } else {
    if (sentRecs.length > 0 && failedRecs.length === 0) {
      c.status = 'sent';
    } else if (sentRecs.length > 0 && failedRecs.length > 0) {
      c.status = 'partial';
    } else if (sentRecs.length === 0 && failedRecs.length > 0) {
      c.status = 'failed';
    }
    // sentAt definitivo é gravado SOMENTE quando nenhum recipient estiver pending!
    if (!c.sentAt) {
      c.sentAt = nowISO;
    }
  }
  c.updatedAt = nowISO;
}

/**
 * Entrega um recipient de campanha específico com claim atômico via CAS.
 * Executa HTTP fora do lock e atualiza o recipient e a campanha pai.
 */
export async function deliverCampaignRecipient(
  recipientId: string,
  options?: { fetchFn?: typeof fetch; nowISO?: string },
): Promise<DeliverCampaignRecipientResult> {
  assertOutsideDBTransaction();
  const nowISO = options?.nowISO || new Date().toISOString();
  const holder = `camp_${randomUUID()}`;

  // 1. Claim atômico exclusivo via CAS
  const claimRes = await updateDBWithCas(
    (d) => claimPendingCampaignRecipients(d, holder, 1, nowISO, [recipientId]),
    { guard: (d) => (d.campaignRecipients || []).some((r) => r.id === recipientId && r.status === 'pending') },
  );

  const claimed = claimRes.result?.[0];
  if (!claimed) {
    return {
      ok: false,
      status: 'claimed_by_other',
      error: 'Destinatário de campanha já reivindicado ou indisponível.',
    };
  }

  // 2. Busca dados de negócio e campanha
  const db = await readDB();
  const business = db.businesses.find((b) => b.id === claimed.businessId);
  const campaign = db.campaigns.find((c) => c.id === claimed.campaignId);

  if (!business || !campaign) {
    await updateDB((d) => {
      const target = d.campaignRecipients.find((r) => r.id === recipientId && r.claimToken === holder);
      if (target) {
        target.status = 'failed';
        target.error = 'Unidade ou campanha não encontrada.';
        target.claimToken = undefined;
        target.claimExpiresAt = undefined;
      }
    });
    return { ok: false, status: 'failed', error: 'Unidade ou campanha não encontrada.' };
  }

  // Se a campanha estiver cancelada, não executa envio externo e encerra recipient
  if (campaign.status === 'cancelled') {
    await updateDB((d) => {
      const target = d.campaignRecipients.find((r) => r.id === recipientId && r.claimToken === holder);
      if (target) {
        target.status = 'failed';
        target.error = 'Campanha foi cancelada.';
        target.claimToken = undefined;
        target.claimExpiresAt = undefined;
      }
      const c = d.campaigns.find((x) => x.id === campaign.id);
      if (c) syncCampaignStatusAndCounts(d, c, nowISO);
    });
    return { ok: false, status: 'failed', error: 'Campanha foi cancelada.' };
  }

  const creds = getWhatsappCredentials(business);
  if (!creds) {
    await updateDB((d) => {
      const target = d.campaignRecipients.find((r) => r.id === recipientId && r.claimToken === holder);
      if (target) {
        target.status = 'failed';
        target.error = 'WhatsApp não configurado para esta unidade.';
        target.claimToken = undefined;
        target.claimExpiresAt = undefined;
      }
    });
    return { ok: false, status: 'failed', error: 'WhatsApp não configurado para esta unidade.' };
  }

  const templateConfig = campaign.templateName ? {
    name: campaign.templateName,
    language: campaign.templateLanguage || 'pt_BR',
  } : undefined;

  // 3. Chamada HTTP fora de qualquer lock
  const sendRes = await sendMetaGraphMessage({
    phoneNumberId: creds.phoneNumberId,
    accessToken: creds.accessToken,
    to: claimed.phone,
    body: campaign.message,
    template: templateConfig,
    fetchFn: options?.fetchFn,
  });

  // 4. Gravação atômica curta pós-envio
  let finalStatus: 'sent' | 'pending' | 'failed' = 'failed';
  let nextRetryAtStr: string | undefined;
  let attemptsCount = (claimed.attempts || 0) + 1;

  await updateDB((d) => {
    const target = d.campaignRecipients.find((r) => r.id === recipientId && r.claimToken === holder);
    if (!target) return;

    target.claimToken = undefined;
    target.claimExpiresAt = undefined;

    if (sendRes.ok && sendRes.externalId) {
      target.status = 'sent';
      target.externalId = sendRes.externalId;
      target.error = '';
      target.nextRetryAt = undefined;
      finalStatus = 'sent';
    } else {
      const attempts = (target.attempts || 0) + 1;
      target.attempts = attempts;
      attemptsCount = attempts;
      target.error = sendRes.error || 'Falha no envio';
      if (sendRes.retryable && attempts < WHATSAPP_MAX_ATTEMPTS) {
        const delay = WHATSAPP_RETRY_INTERVALS_MS[attempts - 1] || 120_000;
        target.nextRetryAt = new Date(new Date(nowISO).getTime() + delay).toISOString();
        nextRetryAtStr = target.nextRetryAt;
        finalStatus = 'pending';
      } else {
        target.status = 'failed';
        target.nextRetryAt = undefined;
        finalStatus = 'failed';
      }
    }

    const c = d.campaigns.find((x) => x.id === claimed.campaignId);
    if (c) {
      syncCampaignStatusAndCounts(d, c, nowISO);
    }
  });

  return {
    ok: sendRes.ok && !!sendRes.externalId,
    status: finalStatus,
    externalId: sendRes.externalId,
    error: sendRes.error,
    attempts: attemptsCount,
    nextRetryAt: nextRetryAtStr,
  };
}

// ── Consumidor Geral de Retentativas de WhatsApp (Mensagens + Campanhas) ──

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
  campaignRecipientsProcessed: number;
  campaignRecipientsSent: number;
  ranAt: string;
}

/**
 * Consome periodicamente todas as mensagens e campanhas pendentes vencidas de todos os tenants.
 * Disparado pelo cron autenticado (/api/cron/whatsapp).
 * messagesProcessed e campaignRecipientsProcessed refletem tentativas reais executadas.
 */
export async function processPendingWhatsappRetries(options?: {
  nowISO?: string;
  fetchFn?: typeof fetch;
}): Promise<WhatsappRetrySummary> {
  assertOutsideDBTransaction();
  const nowISO = options?.nowISO || new Date().toISOString();
  const db = await readDB();

  // 1. Mensagens de conversas pendentes
  const dueBusinesses = new Set<string>();
  for (const m of db.messages) {
    if (m.direction === 'out' && isWhatsappMessageDue(m, nowISO) && !isWhatsappMessageClaimLive(m, nowISO)) {
      dueBusinesses.add(m.businessId);
    }
  }

  let totalMsgSent = 0;
  let totalMsgProcessed = 0;

  for (const bizId of dueBusinesses) {
    const batchRes = await deliverPendingWhatsappMessages(bizId, { ...options, nowISO });
    totalMsgProcessed += batchRes.processed;
    totalMsgSent += batchRes.sent;
  }

  // 2. Destinatários de campanhas pendentes devidos com claim atômico
  let totalCampaignProcessed = 0;
  let totalCampaignSent = 0;

  const dueRecipients = (db.campaignRecipients || [])
    .filter((r) => isCampaignRecipientDue(r, nowISO) && !isCampaignRecipientClaimLive(r, nowISO))
    .slice(0, CAMPAIGN_CRON_BATCH_SIZE);

  for (const rec of dueRecipients) {
    totalCampaignProcessed++;
    const res = await deliverCampaignRecipient(rec.id, { ...options, nowISO });
    if (res.ok) {
      totalCampaignSent++;
    }
  }

  return {
    businessesChecked: dueBusinesses.size,
    messagesProcessed: totalMsgProcessed,
    messagesSent: totalMsgSent,
    campaignRecipientsProcessed: totalCampaignProcessed,
    campaignRecipientsSent: totalCampaignSent,
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

    if (res.ok && res.externalId) {
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
