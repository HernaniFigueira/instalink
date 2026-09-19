// ═══════════════════════════════════════════════════════════════
// WHATSAPP CLOUD API — Conector Oficial da Meta (Graph API)
// ═══════════════════════════════════════════════════════════════
// Implementação OFICIAL de envio e recepção via WhatsApp Cloud API da Meta.
//
// Regras de arquitetura:
//   1. NENHUM fetch para a Meta ocorre dentro de transações do banco
//      (updateDB, updateDBWithCas, SELECT FOR UPDATE).
//   2. Persistência de mensagem em 'pending' → commit → claim atômico →
//      chamada HTTP externa → atualização curta de 'sent'/'failed'.
//   3. Idempotência por externalId / wamid e por claimToken.
//   4. Multi-tenant real: credenciais por Business criptografadas em repouso
//      com AES-256-GCM via WHATSAPP_CREDENTIALS_KEY (nunca no frontend,
//      nunca em logs, nunca em plaintext).
//   5. Suporta mensagens de texto e mensagens template aprovadas.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import type { Business, DB, Message, WhatsappIntegration } from './types';
import { updateDB, updateDBWithCas } from './db';
import { assertOutsideDBTransaction } from './db-transaction';
import { registerChannelConnector, type ChannelConnector, type ChannelSendResult, type ConnectorContext, type OutboundChannelMessage } from './integrations/connectors';
import { onlyDigits } from './utils';

export const DEFAULT_META_GRAPH_VERSION = 'v21.0';

export function getMetaGraphVersion(): string {
  return process.env.META_GRAPH_VERSION || DEFAULT_META_GRAPH_VERSION;
}

export function getMetaGraphBaseUrl(): string {
  return `https://graph.facebook.com/${getMetaGraphVersion()}`;
}

// ── Criptografia de Credenciais Multi-Tenant (AES-256-GCM) ──

function getCredentialsKey(): Buffer {
  const secret = process.env.WHATSAPP_CREDENTIALS_KEY ||
    process.env.WHATSAPP_API_TOKEN ||
    process.env.SESSION_SECRET ||
    'instalink-whatsapp-credentials-secure-salt';
  return createHash('sha256').update(secret).digest();
}

/** Criptografa token de acesso para armazenamento em repouso no Business. */
export function encryptSecret(plainText: string): string {
  if (!plainText) return '';
  const key = getCredentialsKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Descriptografa token de acesso no servidor. Retorna '' se inválido. */
export function decryptSecret(cipherText: string): string {
  if (!cipherText || !cipherText.includes(':')) return '';
  try {
    const parts = cipherText.split(':');
    if (parts.length !== 3) return '';
    const [ivHex, tagHex, dataHex] = parts;
    const key = getCredentialsKey();
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
 * Usa WHATSAPP_APP_SECRET ou META_APP_SECRET quando configurados.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET,
): boolean {
  if (!appSecret) return true; // segredo não configurado no ambiente → aceita handshake com verify_token
  if (!signatureHeader || !signatureHeader.startsWith('sha256=')) return false;

  const expected = signatureHeader.slice(7);
  const hmac = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');

  if (expected.length !== hmac.length) return false;
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(hmac, 'hex'));
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
 * Consulta a Graph API da Meta para validar se o phoneNumberId e o token são reais.
 * Chamada de diagnóstico e ativação de canal (NUNCA dentro do lock do DB).
 */
export async function testMetaConnection(
  phoneNumberId: string,
  accessToken: string,
  fetchFn: typeof fetch = fetch,
): Promise<MetaConnectionCheckResult> {
  assertOutsideDBTransaction();
  if (!phoneNumberId || !accessToken) {
    return { ok: false, error: 'Phone Number ID e Access Token são obrigatórios.' };
  }

  const url = `${getMetaGraphBaseUrl()}/${encodeURIComponent(phoneNumberId)}?fields=verified_name,display_phone_number,quality_rating,code_verification_status`;
  try {
    const res = await fetchFn(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errDetail = data?.error?.message || data?.error?.error_user_msg || `Falha na Meta API (HTTP ${res.status})`;
      return { ok: false, error: errDetail, statusCode: res.status };
    }

    return {
      ok: true,
      verifiedName: data?.verified_name || '',
      displayPhoneNumber: data?.display_phone_number || '',
      qualityRating: data?.quality_rating || '',
      codeVerificationStatus: data?.code_verification_status || '',
      statusCode: res.status,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Erro de rede ao conectar à Graph API da Meta.',
      statusCode: 0,
    };
  }
}

// ── Envio Real de Mensagens via Graph API ──

export interface SendMessageOptions {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  body?: string;
  template?: {
    name: string;
    language?: string;
    components?: any[];
  };
  fetchFn?: typeof fetch;
}

export interface SendMessageResult {
  ok: boolean;
  status: 'sent' | 'failed';
  externalId?: string;
  error?: string;
  statusCode?: number;
  retryable?: boolean;
}

/** Classifica se o erro da Meta justifica retry automático com backoff. */
export function isRetryableMetaStatus(statusCode?: number, errorCode?: number): boolean {
  if (!statusCode || statusCode === 0) return true; // timeout, abort, rede
  if (statusCode === 429) return true; // rate limit
  if (statusCode >= 500 && statusCode <= 599) return true; // erro de infra da Meta
  if (errorCode === 131056 || errorCode === 4 || errorCode === 80007) return true;
  return false;
}

/**
 * Envia uma mensagem pela Graph API oficial da Meta.
 * Executada FORA de qualquer lock transacional.
 */
export async function sendMetaGraphMessage(opts: SendMessageOptions): Promise<SendMessageResult> {
  assertOutsideDBTransaction();
  const fetchFn = opts.fetchFn || fetch;
  const digits = onlyDigits(opts.to);
  if (!digits || digits.length < 10) {
    return { ok: false, status: 'failed', error: 'Número de telefone do destinatário inválido.', retryable: false };
  }

  // Prepara payload conforme especificação oficial do WhatsApp Cloud API
  const payload: Record<string, any> = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: digits,
  };

  if (opts.template && opts.template.name) {
    payload.type = 'template';
    payload.template = {
      name: opts.template.name,
      language: { code: opts.template.language || 'pt_BR' },
      ...(opts.template.components?.length ? { components: opts.template.components } : {}),
    };
  } else {
    payload.type = 'text';
    payload.text = {
      preview_url: false,
      body: String(opts.body || '').slice(0, 4096),
    };
  }

  const url = `${getMetaGraphBaseUrl()}/${encodeURIComponent(opts.phoneNumberId)}/messages`;

  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errObj = data?.error || {};
      const errMsg = errObj.message || errObj.error_user_msg || `Meta API error (${res.status})`;
      const errCode = errObj.code;
      const retryable = isRetryableMetaStatus(res.status, errCode);
      return {
        ok: false,
        status: 'failed',
        error: errMsg,
        statusCode: res.status,
        retryable,
      };
    }

    const externalId = data?.messages?.[0]?.id || '';
    if (!externalId) {
      return {
        ok: false,
        status: 'failed',
        error: 'Resposta da Meta sem ID de mensagem (wamid).',
        statusCode: res.status,
        retryable: false,
      };
    }

    return {
      ok: true,
      status: 'sent',
      externalId,
      statusCode: res.status,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Erro de rede na chamada Meta Cloud API.';
    return {
      ok: false,
      status: 'failed',
      error: errorMsg,
      statusCode: 0,
      retryable: true,
    };
  }
}

// ── Padrão de Posse e Entrega Segura (Claim + CAS + HTTP pós-commit) ──

export const WHATSAPP_CLAIM_LEASE_MS = 30_000;
export const WHATSAPP_MAX_ATTEMPTS = 3;
export const WHATSAPP_RETRY_INTERVALS_MS = [30_000, 120_000];

/** Posse (claim lease) ainda válida? */
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

/**
 * Entrega uma mensagem específica já persistida em db.messages com status 'pending'.
 * Executa a claim, a chamada HTTP à Meta e grava o resultado final.
 */
export async function deliverWhatsappMessage(
  businessId: string,
  messageId: string,
  options?: { fetchFn?: typeof fetch; nowISO?: string },
): Promise<{ ok: boolean; status: 'sent' | 'failed'; externalId?: string; error?: string }> {
  assertOutsideDBTransaction();
  const nowISO = options?.nowISO || new Date().toISOString();
  const holder = `send_${randomUUID()}`;

  // 1. Claim atômico
  const claimRes = await updateDBWithCas(
    (d) => claimPendingWhatsappMessages(d, businessId, holder, 1, nowISO, [messageId]),
    { guard: (d) => d.messages.some((m) => m.id === messageId && m.status === 'pending') },
  );

  const claimed = claimRes.result?.[0];
  if (!claimed) {
    return { ok: false, status: 'failed', error: 'Mensagem não encontrada ou já reivindicada por outro processo.' };
  }

  // 2. Busca parâmetros e credenciais do negócio
  let business: Business | undefined;
  let destinationPhone = '';
  let msgBody = claimed.body;
  let msgMeta = claimed.meta;

  await updateDB((d) => {
    business = d.businesses.find((b) => b.id === businessId);
    const conv = d.conversations.find((c) => c.id === claimed.conversationId);
    destinationPhone = conv?.phone || '';
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
        m.status = 'failed';
        m.error = 'WhatsApp não configurado ou desconectado para esta unidade.';
        m.claimToken = undefined;
      }
      const b = d.businesses.find((x) => x.id === businessId);
      if (b && b.whatsappIntegration) {
        b.whatsappIntegration.lastError = 'Tentativa de envio sem credenciais válidas da Cloud API.';
        b.whatsappIntegration.lastErrorAt = nowISO;
      }
    });
    return { ok: false, status: 'failed', error: 'WhatsApp não configurado para esta unidade.' };
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

  // 4. Gravação curta do resultado
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
      if (b && b.whatsappIntegration) {
        b.whatsappIntegration.lastOutboundAt = nowISO;
      }
    } else {
      const attemptNum = (target.attempts || 0) + 1;
      target.attempts = attemptNum;
      target.error = sendRes.error || 'Falha ao enviar mensagem pela Meta API.';

      if (sendRes.retryable && attemptNum < WHATSAPP_MAX_ATTEMPTS) {
        target.status = 'pending';
        const delay = WHATSAPP_RETRY_INTERVALS_MS[attemptNum - 1] || 120_000;
        target.nextRetryAt = new Date(Date.now() + delay).toISOString();
      } else {
        target.status = 'failed';
        target.nextRetryAt = undefined;
      }

      if (b && b.whatsappIntegration) {
        b.whatsappIntegration.lastError = target.error;
        b.whatsappIntegration.lastErrorAt = nowISO;
      }
    }
  });

  return {
    ok: sendRes.ok,
    status: sendRes.ok ? 'sent' : 'failed',
    externalId: sendRes.externalId,
    error: sendRes.error,
  };
}

/** Entrega todas as mensagens pendentes elegíveis de uma unidade. */
export async function deliverPendingWhatsappMessages(
  businessId: string,
  options?: { fetchFn?: typeof fetch; limit?: number },
): Promise<number> {
  assertOutsideDBTransaction();
  const limit = options?.limit || 10;
  const nowISO = new Date().toISOString();
  const holder = `batch_${randomUUID()}`;

  const claimRes = await updateDBWithCas(
    (d) => claimPendingWhatsappMessages(d, businessId, holder, limit, nowISO),
    { guard: (d) => d.messages.some((m) => m.businessId === businessId && m.status === 'pending') },
  );

  const claimed = claimRes.result || [];
  let sentCount = 0;

  for (const item of claimed) {
    const res = await deliverWhatsappMessage(businessId, item.id, options);
    if (res.ok) sentCount++;
  }

  return sentCount;
}

// ── Registro do ChannelConnector Oficial de WhatsApp ──

const whatsappChannelConnector: ChannelConnector = {
  provider: 'whatsapp',
  label: 'WhatsApp Cloud API',
  available: true,
  async send(ctx: ConnectorContext, message: OutboundChannelMessage): Promise<ChannelSendResult> {
    assertOutsideDBTransaction();
    const credentials = getWhatsappCredentials({ whatsappIntegration: { phoneNumberId: message.meta?.phoneNumberId || '', encryptedAccessToken: '', status: 'connected', displayPhone: '', wabaId: '', connectedAt: '', lastWebhookAt: '', requestedAt: '' } } as any);
    // Para envio via conector de canal genérico (ex.: automação P4 ou broadcast)
    const token = ctx.integration.config?.accessToken || process.env.WHATSAPP_API_TOKEN || '';
    const phoneId = ctx.integration.config?.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '';

    if (!token || !phoneId) {
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
      phoneNumberId: phoneId,
      accessToken: token,
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

// Registra o conector oficial do WhatsApp no barramento de canais
registerChannelConnector(whatsappChannelConnector);
