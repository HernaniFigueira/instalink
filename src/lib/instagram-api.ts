// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 9 — INSTAGRAM DIRECT (SÓ SERVIDOR)
// ═══════════════════════════════════════════════════════════════
// Aqui moram as chamadas oficiais e os segredos. Nada deste arquivo pode ser
// importado por componente de tela (usa `node:crypto`, cofre de credenciais e
// `assertOutsideDBTransaction`).
//
// FLUXO OFICIAL ESCOLHIDO (Instagram API with Instagram Login):
//   1. autorização  → https://www.instagram.com/oauth/authorize (state assinado)
//   2. código → token curto  → POST https://api.instagram.com/oauth/access_token
//   3. token curto → token LONGO (60 dias) → graph.instagram.com/access_token
//   4. assinar o webhook desta conta → POST /{ig-user-id}/subscribed_apps
//   5. receber pelo webhook `object: "instagram"` (entry.id = conta)
//   6. responder com POST /{ig-user-id}/messages
//
// DIFERENÇA IMPORTANTE em relação ao WhatsApp: aqui NÃO existe "registro de
// número" nem Página do Facebook. O que existe é a ASSINATURA do webhook —
// sem ela a Meta não entrega nada, e é por isso que "conectado" exige primeiro
// a assinatura e depois a PRIMEIRA ENTREGA real.
import { createHmac, randomUUID } from 'node:crypto';
import { readDB, updateDB } from './db';
import { assertOutsideDBTransaction } from './db-transaction';
import { pushAudit } from './audit';
import { SIGNUP_STATE_TTL_MS, issueSignupState, readSignupState, verifySignupState, type SignupStateContext } from './whatsapp-onboarding-server';
import { ingestLead } from './pipeline';
import {
  DEFAULT_META_GRAPH_VERSION, WHATSAPP_CLAIM_LEASE_MS, WHATSAPP_MAX_ATTEMPTS, WHATSAPP_RETRY_INTERVALS_MS,
  decryptSecret, encryptSecret, getMetaGraphVersion, verifyMetaWebhookSignature,
} from './whatsapp-cloud-api';
import {
  INSTAGRAM_CODE_TOKEN_URL, INSTAGRAM_LONG_LIVED_URL, INSTAGRAM_REFRESH_URL,
  INSTAGRAM_TEXT_MAX_BYTES, INSTAGRAM_WEBHOOK_FIELDS, instagramDedupeKey,
  instagramEnvAppId, instagramEnvAppSecret, instagramEnvVaultKey, instagramEnvVerifyToken,
  instagramGraphBase, instagramInboundBody, instagramMaxISO, instagramMessagingWindow,
  instagramTextFits, instagramTextLimitError, type InstagramNotification,
} from './instagram';
import { registerChannelConnector, type ChannelConnector, type ChannelSendResult, type ConnectorContext, type OutboundChannelMessage } from './integrations/connectors';
import type { Business, BusinessCustomer, ChannelIdentity, Conversation, DB, InstagramIntegration, Message } from './types';

// ── Configuração da plataforma (nunca vaza segredo) ─────────────
// A leitura do ambiente vive em `instagram.ts` (módulo puro) para que o painel
// e o servidor tomem EXATAMENTE a mesma decisão — inclusive nos fallbacks.
export function instagramAppId(env: NodeJS.ProcessEnv = process.env): string {
  return instagramEnvAppId(env);
}

/** App Secret: `INSTAGRAM_APP_SECRET` ou `META_APP_SECRET` (mesmo app da Meta). */
export function instagramAppSecret(env: NodeJS.ProcessEnv = process.env): string {
  return instagramEnvAppSecret(env);
}

/** Verify token: `INSTAGRAM_VERIFY_TOKEN` ou `WHATSAPP_VERIFY_TOKEN` (mesmo app). */
export function instagramVerifyToken(env: NodeJS.ProcessEnv = process.env): string {
  return instagramEnvVerifyToken(env);
}

export function instagramMissingPlatformConfig(env: NodeJS.ProcessEnv = process.env): string[] {
  const missing: string[] = [];
  if (!instagramAppId(env)) missing.push('INSTAGRAM_APP_ID');
  if (!instagramAppSecret(env)) missing.push('INSTAGRAM_APP_SECRET');
  if (!instagramVerifyToken(env)) missing.push('INSTAGRAM_VERIFY_TOKEN');
  if (!instagramEnvVaultKey(env)) missing.push('WHATSAPP_CREDENTIALS_KEY');
  return missing;
}

// ── Credencial da unidade (cofre AES-256-GCM já existente) ──────
export interface InstagramCredentials {
  igUserId: string;
  username: string;
  accessToken: string;
}

export function getInstagramCredentials(business: Business): InstagramCredentials | null {
  const ig = business.instagramIntegration;
  if (!ig?.igUserId || !ig.encryptedAccessToken) return null;
  const token = decryptSecret(ig.encryptedAccessToken);
  if (!token) return null;
  return { igUserId: ig.igUserId, username: ig.username || '', accessToken: token };
}

/** Fingerprint curto da chave do cofre (diagnóstico; NUNCA a chave). */
export function instagramKeyFingerprint(): string {
  const key = String(process.env.WHATSAPP_CREDENTIALS_KEY || '');
  if (!key) return '';
  return createHmac('sha256', 'instalink-key-fingerprint').update(key).digest('hex').slice(0, 8);
}

export function encryptInstagramToken(token: string): string {
  return encryptSecret(token);
}

/**
 * Estado anti-CSRF do onboarding do Instagram: MESMO modelo do B8
 * (businessId + userId + timestamp + nonce + HMAC) e MESMO código
 * (`issueSignupState`/`readSignupState`), com duas diferenças deliberadas:
 *
 *   1. o segredo é derivado por canal (HMAC do app secret com o rótulo
 *      `instagram-onboarding-state`), então um `state` do WhatsApp NUNCA serve
 *      aqui — nem quando a instalação compartilha o app da Meta;
 *   2. o retorno é lido por `readSignupState` (o callback é uma NAVEGAÇÃO, sem
 *      Authorization) e quem chama reconfere o acesso do usuário à unidade.
 */
export function instagramStateSecret(env: NodeJS.ProcessEnv = process.env): string {
  const appSecret = instagramAppSecret(env);
  if (!appSecret) return '';
  return createHmac('sha256', appSecret).update('instagram-onboarding-state').digest('hex');
}

export const IG_STATE_TTL_MS = SIGNUP_STATE_TTL_MS;

export function issueInstagramState(
  input: SignupStateContext,
  now: number = Date.now(),
): string {
  const secret = instagramStateSecret();
  if (!secret) throw new Error('App Secret do Instagram ausente.');
  return issueSignupState(secret, input, now);
}

/** O estado é deste par unidade+usuário? (usado quando ainda se tem sessão) */
export function verifyInstagramState(
  state: string,
  ctx: SignupStateContext,
  now: number = Date.now(),
): { ok: boolean; reason: string } {
  return verifySignupState(state, instagramStateSecret(), ctx, now);
}

/** Lê o estado sem contexto (callback por navegação) — só assinatura/validade. */
export function readInstagramState(
  state: string,
  now: number = Date.now(),
): { ok: boolean; reason: string; businessId: string; userId: string; issuedAt: number } {
  return readSignupState(state, instagramStateSecret(), now);
}

/** Assinatura do webhook (mesmo HMAC SHA-256 do WhatsApp). */
export function verifyInstagramWebhookSignature(rawBody: string, signature: string | null): boolean {
  return verifyMetaWebhookSignature(rawBody, signature, instagramAppSecret());
}

// ── Chamadas oficiais ───────────────────────────────────────────
async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Mensagem de erro da Meta, sem token e sem payload cru. */
export function metaErrorMessage(payload: any, fallback = 'A Meta recusou a operação.'): string {
  const err = payload?.error;
  if (!err) return fallback;
  const message = String(err.message || err.error_user_msg || '').trim();
  const code = err.code !== undefined ? String(err.code) : '';
  const sub = err.error_subcode !== undefined ? String(err.error_subcode) : '';
  if (!message) return fallback;
  const suffix = code ? ` (código ${code}${sub ? `/${sub}` : ''})` : '';
  return `${message}${suffix}`;
}

export interface InstagramCodeExchange {
  ok: boolean;
  accessToken: string;
  igUserId: string;
  expiresIn: number;
  error: string;
  statusCode: number;
}

/**
 * Passo 2+3 do fluxo: código → token curto → token LONGO (60 dias).
 * `redirect_uri` PRECISA ser idêntico ao usado na autorização.
 */
export async function exchangeInstagramCode(input: {
  code: string;
  redirectUri: string;
  fetchFn?: typeof fetch;
}): Promise<InstagramCodeExchange> {
  const fetchFn = input.fetchFn || fetch;
  const appId = instagramAppId();
  const appSecret = instagramAppSecret();
  if (!appId || !appSecret) {
    return { ok: false, accessToken: '', igUserId: '', expiresIn: 0, error: 'App do Instagram não configurado na plataforma.', statusCode: 0 };
  }

  // 2. código → token curto (o segredo vai no corpo form-urlencoded).
  let shortToken = '';
  let igUserId = '';
  try {
    const body = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'authorization_code',
      redirect_uri: input.redirectUri,
      code: input.code,
    });
    const res = await fetchFn(INSTAGRAM_CODE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data = await readJson(res);
    if (!res.ok) {
      return { ok: false, accessToken: '', igUserId: '', expiresIn: 0, error: metaErrorMessage(data, 'O Instagram recusou o código de autorização.'), statusCode: res.status };
    }
    shortToken = String(data?.access_token || '');
    igUserId = String(data?.user_id || '');
    if (!shortToken || !igUserId) {
      return { ok: false, accessToken: '', igUserId: '', expiresIn: 0, error: 'O Instagram não devolveu a credencial da conta.', statusCode: res.status };
    }
  } catch (e: any) {
    return { ok: false, accessToken: '', igUserId: '', expiresIn: 0, error: `Não foi possível falar com o Instagram: ${e?.message || 'erro de rede'}`, statusCode: 0 };
  }

  // 3. token curto → token longo (60 dias).
  const long = await exchangeForLongLivedToken({ shortToken, fetchFn });
  if (!long.ok) {
    // Sem token longo a conta AINDA não está conectada: erro explícito.
    return { ok: false, accessToken: '', igUserId, expiresIn: 0, error: long.error, statusCode: long.statusCode };
  }
  return { ok: true, accessToken: long.accessToken, igUserId, expiresIn: long.expiresIn, error: '', statusCode: 200 };
}

export async function exchangeForLongLivedToken(input: {
  shortToken: string;
  fetchFn?: typeof fetch;
}): Promise<{ ok: boolean; accessToken: string; expiresIn: number; error: string; statusCode: number }> {
  const fetchFn = input.fetchFn || fetch;
  const appSecret = instagramAppSecret();
  try {
    const url = new URL(INSTAGRAM_LONG_LIVED_URL);
    url.searchParams.set('grant_type', 'ig_exchange_token');
    url.searchParams.set('client_secret', appSecret);
    url.searchParams.set('access_token', input.shortToken);
    const res = await fetchFn(url.toString(), { method: 'GET' });
    const data = await readJson(res);
    if (!res.ok) {
      return { ok: false, accessToken: '', expiresIn: 0, error: metaErrorMessage(data, 'Não consegui trocar o código pelo token de longa duração.'), statusCode: res.status };
    }
    const token = String(data?.access_token || '');
    if (!token) {
      return { ok: false, accessToken: '', expiresIn: 0, error: 'A Meta não devolveu o token de longa duração.', statusCode: res.status };
    }
    return { ok: true, accessToken: token, expiresIn: Number(data?.expires_in) || 0, error: '', statusCode: res.status };
  } catch (e: any) {
    return { ok: false, accessToken: '', expiresIn: 0, error: `Não foi possível falar com o Instagram: ${e?.message || 'erro de rede'}`, statusCode: 0 };
  }
}

/** Renovação do token longo (a Meta recomenda renovar antes dos 60 dias). */
export async function refreshLongLivedToken(input: {
  accessToken: string;
  fetchFn?: typeof fetch;
}): Promise<{ ok: boolean; accessToken: string; expiresIn: number; error: string; statusCode: number }> {
  const fetchFn = input.fetchFn || fetch;
  try {
    const url = new URL(INSTAGRAM_REFRESH_URL);
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', input.accessToken);
    const res = await fetchFn(url.toString(), { method: 'GET' });
    const data = await readJson(res);
    if (!res.ok) {
      return { ok: false, accessToken: '', expiresIn: 0, error: metaErrorMessage(data, 'Não consegui renovar a credencial do Instagram.'), statusCode: res.status };
    }
    const token = String(data?.access_token || '');
    if (!token) {
      return { ok: false, accessToken: '', expiresIn: 0, error: 'A Meta não devolveu a credencial renovada.', statusCode: res.status };
    }
    return { ok: true, accessToken: token, expiresIn: Number(data?.expires_in) || 0, error: '', statusCode: res.status };
  } catch (e: any) {
    return { ok: false, accessToken: '', expiresIn: 0, error: `Não foi possível falar com o Instagram: ${e?.message || 'erro de rede'}`, statusCode: 0 };
  }
}

/**
 * Dados PÚBLICOS da conta (rótulo da tela). Falha aqui não derruba a conexão:
 * a conta pode estar autorizada mesmo que o perfil não venha.
 */
export async function fetchInstagramAccount(input: {
  igUserId: string;
  accessToken: string;
  fetchFn?: typeof fetch;
}): Promise<{ ok: boolean; igUserId: string; username: string; name: string; error: string }> {
  const fetchFn = input.fetchFn || fetch;
  const version = getMetaGraphVersion() || DEFAULT_META_GRAPH_VERSION;
  try {
    const url = new URL(`${instagramGraphBase(version)}/${encodeURIComponent(input.igUserId)}`);
    url.searchParams.set('fields', 'id,username,name,profile_pic');
    url.searchParams.set('access_token', input.accessToken);
    const res = await fetchFn(url.toString(), { method: 'GET' });
    const data = await readJson(res);
    if (!res.ok || !data?.id) {
      return { ok: false, igUserId: input.igUserId, username: '', name: '', error: metaErrorMessage(data, 'Não consegui ler os dados públicos da conta.') };
    }
    return {
      ok: true,
      igUserId: String(data.id || input.igUserId),
      username: String(data.username || ''),
      name: String(data.name || ''),
      error: '',
    };
  } catch (e: any) {
    return { ok: false, igUserId: input.igUserId, username: '', name: '', error: `Não foi possível falar com o Instagram: ${e?.message || 'erro de rede'}` };
  }
}

/**
 * Rótulo público de quem escreveu (IGSID). BEST EFFORT: falha aqui devolve
 * `ok:false` e a conversa segue sem nome inventado.
 * Campos oficiais do nó de usuário IG (`name`, `username`, `profile_pic`).
 */
export async function fetchInstagramProfile(input: {
  igUserId: string;
  accessToken: string;
  participantId: string;
  fetchFn?: typeof fetch;
}): Promise<{ ok: boolean; username: string; name: string; error: string }> {
  const fetchFn = input.fetchFn || fetch;
  const version = getMetaGraphVersion() || DEFAULT_META_GRAPH_VERSION;
  try {
    const url = new URL(`${instagramGraphBase(version)}/${encodeURIComponent(input.participantId)}`);
    url.searchParams.set('fields', 'name,username,profile_pic');
    url.searchParams.set('access_token', input.accessToken);
    const res = await fetchFn(url.toString(), { method: 'GET' });
    const data = await readJson(res);
    if (!res.ok || !data) {
      return { ok: false, username: '', name: '', error: metaErrorMessage(data, 'O Instagram não devolveu o perfil do contato.') };
    }
    return {
      ok: true,
      username: String(data.username || ''),
      name: String(data.name || ''),
      error: '',
    };
  } catch (e: any) {
    return { ok: false, username: '', name: '', error: `Não foi possível falar com o Instagram: ${e?.message || 'erro de rede'}` };
  }
}

/**
 * Assinatura do webhook DESTA conta. É o passo que faz as mensagens chegarem.
 * A Meta responde `{ success: true }`.
 */
export async function subscribeInstagramAccount(input: {
  igUserId: string;
  accessToken: string;
  fetchFn?: typeof fetch;
}): Promise<{ ok: boolean; error: string; statusCode: number }> {
  const fetchFn = input.fetchFn || fetch;
  const version = getMetaGraphVersion() || DEFAULT_META_GRAPH_VERSION;
  try {
    const url = new URL(`${instagramGraphBase(version)}/${encodeURIComponent(input.igUserId)}/subscribed_apps`);
    url.searchParams.set('subscribed_fields', INSTAGRAM_WEBHOOK_FIELDS.join(','));
    url.searchParams.set('access_token', input.accessToken);
    const res = await fetchFn(url.toString(), { method: 'POST' });
    const data = await readJson(res);
    if (!res.ok || data?.success !== true) {
      return { ok: false, error: metaErrorMessage(data, 'A Meta não confirmou a assinatura do webhook.'), statusCode: res.status };
    }
    return { ok: true, error: '', statusCode: res.status };
  } catch (e: any) {
    return { ok: false, error: `Não foi possível falar com o Instagram: ${e?.message || 'erro de rede'}`, statusCode: 0 };
  }
}

export interface InstagramSendResult {
  ok: boolean;
  externalId: string;
  error: string;
  retryable: boolean;
  statusCode: number;
}

/**
 * Envio oficial. REGRA DURA: 2xx SEM `message_id` NÃO é sucesso — sem o id
 * oficial não existe prova de entrega, então a mensagem não pode virar "sent".
 */
export async function sendInstagramMessage(input: {
  igUserId: string;
  accessToken: string;
  to: string;
  text: string;
  fetchFn?: typeof fetch;
}): Promise<InstagramSendResult> {
  const fetchFn = input.fetchFn || fetch;
  const version = getMetaGraphVersion() || DEFAULT_META_GRAPH_VERSION;
  const to = String(input.to || '').trim();
  if (!to) return { ok: false, externalId: '', error: 'Contato sem identificador do Instagram.', retryable: false, statusCode: 0 };
  const text = String(input.text || '');
  if (!text.trim()) return { ok: false, externalId: '', error: 'Mensagem vazia.', retryable: false, statusCode: 0 };
  // FAIL-CLOSED no limite: cortar aqui faria o histórico mostrar um texto e o
  // Instagram receber outro. Quem recusa é quem cria a mensagem (e esta
  // função também recusa, para nunca sair algo diferente do que foi salvo).
  if (!instagramTextFits(text, INSTAGRAM_TEXT_MAX_BYTES)) {
    return { ok: false, externalId: '', error: instagramTextLimitError(INSTAGRAM_TEXT_MAX_BYTES), retryable: false, statusCode: 0 };
  }

  try {
    const url = new URL(`${instagramGraphBase(version)}/${encodeURIComponent(input.igUserId)}/messages`);
    const res = await fetchFn(url.toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${input.accessToken}` },
      body: JSON.stringify({ recipient: { id: to }, message: { text } }),
    });
    const data = await readJson(res);
    if (!res.ok) {
      return {
        ok: false, externalId: '', statusCode: res.status,
        retryable: res.status >= 500 || res.status === 429 || res.status === 0,
        error: metaErrorMessage(data, 'A Meta recusou o envio da mensagem.'),
      };
    }
    const messageId = String(data?.message_id || '');
    if (!messageId) {
      return {
        ok: false, externalId: '', statusCode: res.status, retryable: false,
        error: 'A Meta aceitou a chamada, mas não devolveu o identificador da mensagem — sem ele não há prova de envio.',
      };
    }
    return { ok: true, externalId: messageId, error: '', retryable: false, statusCode: res.status };
  } catch (e: any) {
    return { ok: false, externalId: '', error: `Não foi possível falar com o Instagram: ${e?.message || 'erro de rede'}`, retryable: true, statusCode: 0 };
  }
}

// ── Roteamento por CONTA (tenant) ───────────────────────────────
/**
 * Qual unidade é dona deste `entry.id`? Só a CONTA conectada responde — nunca
 * por nome, nunca por @, nunca por telefone.
 */
export function resolveBusinessForInstagramAccountId(db: DB, igUserId: string): Business | undefined {
  const id = String(igUserId || '').trim();
  if (!id) return undefined;
  const owners = instagramAccountOwners(db, id);
  // FAIL-CLOSED: a mesma conta em duas unidades é ambígua — o webhook não
  // escolhe a primeira, não grava em nenhuma e a tela mostra a pendência.
  return owners.length === 1 ? owners[0] : undefined;
}

/** Todas as unidades que dizem ser donas desta conta (mais de uma = ambíguo). */
export function instagramAccountOwners(db: DB, igUserId: string): Business[] {
  const id = String(igUserId || '').trim();
  if (!id) return [];
  return db.businesses.filter((b) => b.instagramIntegration?.igUserId === id);
}

/** A conta já pertence a OUTRA unidade? (unicidade da conta, multi-tenant) */
export function instagramAccountTakenBy(db: DB, igUserId: string, businessId: string): Business | undefined {
  return instagramAccountOwners(db, igUserId).find((b) => b.id !== businessId);
}

// ── Janela POR CONVERSA (nunca por unidade) ─────────────────────
/**
 * Última mensagem RECEBIDA deste participante NESTA conversa. É a única fonte
 * válida da janela do Instagram: a mensagem do cliente A não abre (nem renova)
 * a janela do cliente B.
 *
 * Compatibilidade: conversa antiga (criada antes deste campo) deriva da
 * mensagem de entrada mais recente da própria conversa.
 */
export function instagramConversationLastInboundAt(
  db: DB,
  conversation: { id: string; lastInboundAt?: string },
): string {
  // O campo é a autoridade (cada entrada o atualiza com `max`).
  const stored = String(conversation.lastInboundAt || '');
  if (stored) return stored;
  // Conversa legada (sem o campo): deriva da mensagem de entrada mais recente
  // DELA — nunca da unidade, nunca de outra conversa.
  let fromMessages = '';
  for (const m of db.messages) {
    if (m.conversationId !== conversation.id) continue;
    if (m.direction !== 'in') continue;
    fromMessages = instagramMaxISO(fromMessages, m.at);
  }
  return fromMessages;
}

/** Janela de resposta DESTA conversa (mesma política para todos os caminhos). */
export function instagramConversationWindow(
  db: DB,
  conversation: { id: string; lastInboundAt?: string },
  nowISO: string,
): ReturnType<typeof instagramMessagingWindow> {
  return instagramMessagingWindow({ lastInboundAt: instagramConversationLastInboundAt(db, conversation), nowISO });
}

/** Frase única do desencontro conta/conversa (rota, conector e entrega). */
export const INSTAGRAM_ACCOUNT_MISMATCH_CODE = 'channel_account_mismatch';
export const INSTAGRAM_ACCOUNT_MISMATCH_MESSAGE = 'Esta conversa pertence a uma conta do Instagram conectada anteriormente.';
export const INSTAGRAM_ACCOUNT_MISMATCH_DETAIL = 'Esta conversa pertence a uma conta do Instagram conectada anteriormente. Reconecte a conta original ou continue a conversa pelo Direct.';
/** Frase única de quem nunca escreveu (a Meta não permite iniciar DM). */
export const INSTAGRAM_NO_INBOUND_CODE = 'no_inbound_conversation';
export const INSTAGRAM_NO_INBOUND_MESSAGE = 'Este usuário ainda não iniciou uma conversa com a conta do Instagram.';

/**
 * A conversa é da conta que está conectada AGORA? Depois de trocar de conta, o
 * histórico antigo continua visível, mas NÃO pode ser enviado pela credencial
 * nova (a Meta recusaria, e pior: sairia da conta errada).
 */
export function instagramAccountMismatch(business: Business, conversation: { channelAccountId?: string }): string {
  const ig = business.instagramIntegration;
  const accountId = String(conversation.channelAccountId || '');
  if (!ig?.igUserId || !accountId) return '';
  return accountId === ig.igUserId ? '' : INSTAGRAM_ACCOUNT_MISMATCH_DETAIL;
}

// ── Claim + entrega (mesmo desenho do WhatsApp) ─────────────────
export interface InstagramDeliveryResult {
  ok: boolean;
  status: 'sent' | 'pending' | 'failed' | 'claimed_by_other';
  externalId?: string;
  error?: string;
  /** Código estável para a rota/UI (ex.: `channel_account_mismatch`). */
  code?: string;
  nextRetryAt?: string;
  attempts?: number;
}

function igClaimLive(msg: Message, nowISO: string): boolean {
  if (!msg.claimToken) return false;
  if (!msg.claimExpiresAt) return true;
  return msg.claimExpiresAt > nowISO;
}

/**
 * Entrega UMA mensagem de uma conversa do Instagram.
 * Só toca mensagens do canal `instagram` — mensagem do WhatsApp nunca entra
 * aqui (e vice-versa).
 */
export async function deliverInstagramMessage(
  businessId: string,
  messageId: string,
  options?: { fetchFn?: typeof fetch; nowISO?: string },
): Promise<InstagramDeliveryResult> {
  assertOutsideDBTransaction();
  const nowISO = options?.nowISO || new Date().toISOString();
  const holder = `ig_${randomUUID().slice(0, 12)}`;

  const claim = await updateDB((db: DB) => {
    const msg = db.messages.find((m) => m.id === messageId && m.businessId === businessId);
    if (!msg || msg.direction !== 'out') return null;
    const conv = db.conversations.find((c) => c.id === msg.conversationId);
    if (!conv || conv.channel !== 'instagram') return null;
    if (msg.status !== 'pending' || igClaimLive(msg, nowISO)) return null;
    msg.claimToken = holder;
    msg.claimExpiresAt = new Date(Date.parse(nowISO) + WHATSAPP_CLAIM_LEASE_MS).toISOString();
    msg.attempts = (msg.attempts || 0) + 1;
    return {
      attempts: msg.attempts,
      conversationId: conv.id,
      to: conv.channelUserId || msg.channelUserId || '',
      body: msg.body,
    };
  });

  if (!claim) return { ok: false, status: 'claimed_by_other', error: 'Mensagem já reivindicada ou fora do estado pendente.' };

  const db = await readDB();
  const business = db.businesses.find((b) => b.id === businessId);
  const creds = business ? getInstagramCredentials(business) : null;
  const release = async (patch: Partial<Message>) => {
    await updateDB((d: DB) => {
      const msg = d.messages.find((m) => m.id === messageId);
      if (!msg || msg.claimToken !== holder) return;
      Object.assign(msg, patch);
      msg.claimToken = undefined;
      msg.claimExpiresAt = undefined;
    });
  };

  if (!business || !creds) {
    await release({ status: 'pending' });
    return { ok: false, status: 'pending', error: 'Instagram não está conectado nesta unidade.' };
  }

  const conversation = db.conversations.find((c) => c.id === claim.conversationId);
  if (!conversation) {
    await release({ status: 'failed', error: 'Conversa do Instagram não encontrada.', nextRetryAt: undefined });
    return { ok: false, status: 'failed', error: 'Conversa do Instagram não encontrada.' };
  }

  // 1. A conversa é da conta conectada AGORA? Depois de trocar de conta, o
  //    histórico antigo é leitura — nada sai pela credencial nova.
  const mismatch = instagramAccountMismatch(business, conversation);
  if (mismatch) {
    await release({ status: 'failed', error: INSTAGRAM_ACCOUNT_MISMATCH_MESSAGE, nextRetryAt: undefined });
    return {
      ok: false, status: 'failed', code: INSTAGRAM_ACCOUNT_MISMATCH_CODE,
      error: INSTAGRAM_ACCOUNT_MISMATCH_MESSAGE, attempts: claim.attempts,
    };
  }

  // 2. Política da Meta revalidada AGORA (não basta valer no enfileiramento):
  //    retry que só roda depois do fechamento da janela NÃO sai.
  const window = instagramConversationWindow(db, conversation, nowISO);
  if (!window.canReply) {
    await release({ status: 'failed', error: window.reason, nextRetryAt: undefined });
    return { ok: false, status: 'failed', error: window.reason, attempts: claim.attempts };
  }

  const sent = await sendInstagramMessage({
    igUserId: creds.igUserId,
    accessToken: creds.accessToken,
    to: claim.to,
    text: claim.body,
    fetchFn: options?.fetchFn,
  });

  if (sent.ok) {
    await updateDB((d: DB) => {
      const msg = d.messages.find((m) => m.id === messageId);
      if (msg) {
        msg.status = 'sent';
        msg.externalId = sent.externalId;
        msg.error = undefined;
        msg.claimToken = undefined;
        msg.claimExpiresAt = undefined;
      }
      const biz = d.businesses.find((b) => b.id === businessId);
      if (biz?.instagramIntegration) {
        biz.instagramIntegration.lastOutboundAt = nowISO;
        biz.instagramIntegration.lastError = undefined;
        biz.instagramIntegration.lastErrorAt = undefined;
      }
    });
    return { ok: true, status: 'sent', externalId: sent.externalId, attempts: claim.attempts };
  }

  if (sent.retryable && (claim.attempts || 1) < WHATSAPP_MAX_ATTEMPTS) {
    const wait = WHATSAPP_RETRY_INTERVALS_MS[Math.min((claim.attempts || 1) - 1, WHATSAPP_RETRY_INTERVALS_MS.length - 1)];
    const nextRetryAt = new Date(Date.parse(nowISO) + wait).toISOString();
    await release({ status: 'pending', error: sent.error, nextRetryAt });
    return { ok: false, status: 'pending', error: sent.error, nextRetryAt, attempts: claim.attempts };
  }

  await updateDB((d: DB) => {
    const msg = d.messages.find((m) => m.id === messageId);
    if (msg) {
      msg.status = 'failed';
      msg.error = sent.error;
      msg.claimToken = undefined;
      msg.claimExpiresAt = undefined;
    }
    const biz = d.businesses.find((b) => b.id === businessId);
    if (biz?.instagramIntegration) {
      biz.instagramIntegration.lastError = sent.error;
      biz.instagramIntegration.lastErrorAt = nowISO;
    }
  });
  return { ok: false, status: 'failed', error: sent.error, attempts: claim.attempts };
}

// ── Conector oficial (P6) ───────────────────────────────────────
// Registrar o conector é o que permite `send_channel_message` e o alvo
// `channel` da saída do P6 usarem o Instagram sem nenhum nó novo.
export const instagramChannelConnector: ChannelConnector = {
  provider: 'instagram',
  label: 'Instagram Direct',
  available: true,
  async send(ctx: ConnectorContext, message: OutboundChannelMessage): Promise<ChannelSendResult> {
    assertOutsideDBTransaction();
    const db = await readDB();
    const business = ctx.business || db.businesses.find((b) => b.id === ctx.businessId);
    if (!business) {
      return { ok: false, code: 'missing_credentials', detail: 'Unidade não encontrada para este canal.', retryable: false };
    }
    const ig = business.instagramIntegration;
    const creds = getInstagramCredentials(business);
    if (!ig || !creds) {
      return {
        ok: false, code: 'missing_credentials',
        detail: 'Instagram não conectado nesta unidade — conecte a conta em Canais e Integrações.',
        retryable: false,
      };
    }
    if (ig.status !== 'connected') {
      return {
        ok: false, code: 'skipped', retryable: false,
        detail: 'A conexão do Instagram ainda não foi confirmada (falta o webhook ou a primeira mensagem).',
      };
    }

    const to = String(message.to || '').trim();
    // A Meta só permite responder quem JÁ escreveu. Sem conversa real deste
    // participante com ESTA conta (e sem evidência de entrada), não existe DM
    // para iniciar — o conector recusa em vez de inventar destinatário.
    const conversation = to
      ? db.conversations.find((c) => c.businessId === business.id && c.channel === 'instagram'
        && c.channelAccountId === ig.igUserId && c.channelUserId === to)
      : undefined;
    if (!conversation) {
      // Conversa do mesmo participante com OUTRA conta conectada: a explicação
      // estável é o desencontro de conta (não "nunca escreveu").
      const fromOtherAccount = to
        ? db.conversations.find((c) => c.businessId === business.id && c.channel === 'instagram' && c.channelUserId === to)
        : undefined;
      if (fromOtherAccount) {
        return { ok: false, code: 'provider_error', retryable: false, detail: INSTAGRAM_ACCOUNT_MISMATCH_DETAIL };
      }
      return { ok: false, code: 'invalid_target', retryable: false, detail: INSTAGRAM_NO_INBOUND_MESSAGE };
    }
    if (!db.messages.some((m) => m.conversationId === conversation.id && m.direction === 'in')) {
      return { ok: false, code: 'invalid_target', retryable: false, detail: INSTAGRAM_NO_INBOUND_MESSAGE };
    }

    // Política da Meta: a janela é DESTA conversa (participante), revalidada no
    // momento do envio. Fora dela, nada sai — com motivo claro.
    const window = instagramConversationWindow(db, conversation, ctx.nowISO);
    if (!window.canReply) {
      return { ok: false, code: 'provider_error', retryable: false, detail: `Envio bloqueado pela política do Instagram: ${window.reason}` };
    }

    const res = await sendInstagramMessage({
      igUserId: creds.igUserId,
      accessToken: creds.accessToken,
      to,
      text: message.body,
      fetchFn: ctx.fetchFn,
    });
    if (res.ok && res.externalId) {
      return { ok: true, code: 'sent', detail: 'Mensagem aceita pelo Instagram.', externalId: res.externalId };
    }
    return { ok: false, code: 'provider_error', detail: res.error, retryable: res.retryable };
  },
};

registerChannelConnector(instagramChannelConnector);

// ── Retentativa periódica (mesmo desenho do WhatsApp) ───────────
/** Mensagem de saída vencida para nova tentativa. */
export function isInstagramMessageDue(msg: Message, nowISO = new Date().toISOString()): boolean {
  if (msg.direction !== 'out' || msg.status !== 'pending') return false;
  if (!msg.nextRetryAt) return true;
  return msg.nextRetryAt <= nowISO;
}

/**
 * Processa as mensagens pendentes do Instagram de UMA unidade.
 * Usa o MESMO claim de `deliverInstagramMessage` — não existe fila paralela.
 */
export async function deliverPendingInstagramMessages(
  businessId: string,
  options?: { nowISO?: string; fetchFn?: typeof fetch; limit?: number },
): Promise<{ processed: number; sent: number }> {
  assertOutsideDBTransaction();
  const nowISO = options?.nowISO || new Date().toISOString();
  const limit = options?.limit ?? 10;
  const db = await readDB();
  const ids: string[] = [];
  for (const msg of db.messages) {
    if (ids.length >= limit) break;
    if (msg.businessId !== businessId) continue;
    if (!isInstagramMessageDue(msg, nowISO)) continue;
    if (igClaimLive(msg, nowISO)) continue;
    const conv = db.conversations.find((c) => c.id === msg.conversationId);
    if (!conv || conv.channel !== 'instagram') continue;
    ids.push(msg.id);
  }

  let sent = 0;
  let processed = 0;
  for (const id of ids) {
    processed += 1;
    const res = await deliverInstagramMessage(businessId, id, { nowISO, fetchFn: options?.fetchFn });
    if (res.ok) sent += 1;
  }
  return { processed, sent };
}

export interface InstagramRetrySummary {
  businessesChecked: number;
  messagesProcessed: number;
  messagesSent: number;
  ranAt: string;
}

/** Uma passada por TODAS as unidades com mensagem pendente vencida. */
export async function processPendingInstagramRetries(options?: {
  nowISO?: string;
  fetchFn?: typeof fetch;
  limit?: number;
}): Promise<InstagramRetrySummary> {
  assertOutsideDBTransaction();
  const nowISO = options?.nowISO || new Date().toISOString();
  const db = await readDB();
  const due = new Set<string>();
  for (const msg of db.messages) {
    if (!isInstagramMessageDue(msg, nowISO)) continue;
    if (igClaimLive(msg, nowISO)) continue;
    const conv = db.conversations.find((c) => c.id === msg.conversationId);
    if (conv?.channel === 'instagram') due.add(msg.businessId);
  }

  let processed = 0;
  let sent = 0;
  for (const businessId of due) {
    const res = await deliverPendingInstagramMessages(businessId, { ...options, nowISO });
    processed += res.processed;
    sent += res.sent;
  }
  return { businessesChecked: due.size, messagesProcessed: processed, messagesSent: sent, ranAt: nowISO };
}

// ── Ciclo de vida do TOKEN (manutenção preventiva) ──────────────
/**
 * Margem de renovação: 7 dias antes do vencimento. O token longo do Instagram
 * dura ~60 dias e a renovação oficial (`ig_refresh_token`) exige um token ainda
 * VÁLIDO — renovar cedo dá folga para uma falha de rede sem derrubar o canal, e
 * evita renovar a cada execução do cron.
 */
export const INSTAGRAM_TOKEN_REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;
/** Validade presumida quando a Meta não informa `expires_in` (60 dias). */
export const INSTAGRAM_TOKEN_FALLBACK_TTL_MS = 60 * 24 * 60 * 60 * 1000;

/** A credencial desta unidade está perto de vencer (e pode ser renovada)? */
export function instagramTokenNeedsRefresh(
  ig: { encryptedAccessToken?: string; tokenExpiresAt?: string } | undefined,
  nowISO: string,
): boolean {
  if (!ig?.encryptedAccessToken) return false;
  const expires = Date.parse(String(ig.tokenExpiresAt || ''));
  if (!Number.isFinite(expires)) return false; // sem validade conhecida: não inventa
  const now = Date.parse(nowISO) || Date.now();
  if (expires <= now) return true; // vencido: ainda tentamos renovar
  return expires - now <= INSTAGRAM_TOKEN_REFRESH_MARGIN_MS;
}

export interface InstagramTokenRefreshSummary {
  businessesChecked: number;
  /** Renovações EFETIVAMENTE gravadas (o CAS confirmou a persistência). */
  refreshed: number;
  failed: number;
  /** Sem credencial utilizável no momento da passada. */
  skipped: number;
  /** A Meta devolveu token novo, mas a credencial mudou no meio (reconexão): o CAS NÃO sobrescreveu. */
  superseded: number;
  ranAt: string;
}

/**
 * Renova as credenciais próximas do vencimento, unidade por unidade:
 *   • a chamada à Meta acontece FORA de qualquer transação;
 *   • a gravação é CAS: se a credencial mudou no meio (reconexão), não
 *     sobrescreve o trabalho de ninguém;
 *   • falha NÃO apaga o token atual — só registra `lastError` e audita;
 *   • cada unidade é tratada separadamente (nunca cruza tenants).
 */
export async function refreshInstagramTokens(options?: {
  nowISO?: string;
  fetchFn?: typeof fetch;
  limit?: number;
}): Promise<InstagramTokenRefreshSummary> {
  assertOutsideDBTransaction();
  const nowISO = options?.nowISO || new Date().toISOString();
  const limit = options?.limit ?? 25;
  const db = await readDB();
  const due = db.businesses
    .filter((b) => instagramTokenNeedsRefresh(b.instagramIntegration, nowISO))
    .slice(0, limit);

  let refreshed = 0;
  let failed = 0;
  let skipped = 0;
  let superseded = 0;

  for (const business of due) {
    const ig = business.instagramIntegration!;
    const creds = getInstagramCredentials(business);
    if (!creds) { skipped += 1; continue; }
    const previousEncrypted = ig.encryptedAccessToken;

    const res = await refreshLongLivedToken({ accessToken: creds.accessToken, fetchFn: options?.fetchFn });

    if (!res.ok) {
      failed += 1;
      await updateDB((d: DB) => {
        const biz = d.businesses.find((b) => b.id === business.id);
        const current = biz?.instagramIntegration;
        if (!current || current.encryptedAccessToken !== previousEncrypted) return; // trocou no meio
        current.lastError = `Renovação da credencial: ${res.error}`;
        current.lastErrorAt = nowISO;
        pushAudit(d, {
          action: 'instagram.token_refresh_failed',
          actor: INSTAGRAM_SYSTEM_ACTOR,
          businessId: business.id,
          meta: { reason: res.error },
        });
      });
      continue;
    }

    const ttl = res.expiresIn > 0 ? res.expiresIn * 1000 : INSTAGRAM_TOKEN_FALLBACK_TTL_MS;
    const expiresAt = new Date((Date.parse(nowISO) || Date.now()) + ttl).toISOString();
    // A métrica segue a GRAVAÇÃO, não a resposta da Meta: se a reconexão trocou
    // a credencial no meio, o CAS não aplica e isso é `superseded` — nunca
    // "renovado". O resumo do cron precisa ser verdadeiro.
    const applied = await updateDB((d: DB): boolean => {
      const biz = d.businesses.find((b) => b.id === business.id);
      const current = biz?.instagramIntegration;
      if (!current || current.encryptedAccessToken !== previousEncrypted) return false; // trocou no meio
      current.encryptedAccessToken = encryptInstagramToken(res.accessToken);
      current.tokenIssuedAt = nowISO;
      current.tokenExpiresAt = expiresAt;
      current.lastError = undefined;
      current.lastErrorAt = undefined;
      pushAudit(d, {
        action: 'instagram.token_refreshed',
        actor: INSTAGRAM_SYSTEM_ACTOR,
        businessId: business.id,
        meta: { expiresAt },
      });
      return true;
    });
    if (applied) refreshed += 1;
    else superseded += 1;
  }

  return { businessesChecked: due.length, refreshed, failed, skipped, superseded, ranAt: nowISO };
}

// ── Gravação do resultado do onboarding (usada pelo callback) ────
export type InstagramAuthorizationResult =
  | { ok: true; integration: InstagramIntegration }
  | { ok: false; reason: 'business_not_found' | 'account_already_linked'; ownerBusinessId?: string };

/** Ator das ações de sistema (webhook, cron) no histórico de auditoria. */
export const INSTAGRAM_SYSTEM_ACTOR = { id: 'system', email: 'instagram@instalink.app', role: 'system' };

export function applyInstagramAuthorization(
  db: DB,
  input: {
    businessId: string;
    igUserId: string;
    username: string;
    displayName: string;
    encryptedAccessToken: string;
    now: string;
    tokenExpiresAt?: string;
    /** Quem autorizou (usado na auditoria). */
    actor?: { id: string; email: string; role?: string };
  },
): InstagramAuthorizationResult {
  const business = db.businesses.find((b) => b.id === input.businessId);
  if (!business) return { ok: false, reason: 'business_not_found' };

  // UMA conta pertence a UMA unidade. Se outra unidade já tem esta conta, não
  // gravamos nada: o webhook ficaria ambíguo e poderia entregar na unidade
  // errada. Fail-closed, com auditoria do motivo.
  const owner = instagramAccountTakenBy(db, input.igUserId, input.businessId);
  if (owner) {
    pushAudit(db, {
      action: 'instagram.onboarding_failed',
      actor: input.actor || INSTAGRAM_SYSTEM_ACTOR,
      businessId: input.businessId,
      meta: { step: 'authorize', reason: 'account_already_linked', ownerBusinessId: owner.id },
    });
    return { ok: false, reason: 'account_already_linked', ownerBusinessId: owner.id };
  }

  const tokenChanged = business.instagramIntegration?.encryptedAccessToken !== input.encryptedAccessToken;
  const previous = business.instagramIntegration;
  business.instagramIntegration = {
    status: 'webhook_pending',
    igUserId: input.igUserId,
    username: input.username,
    displayName: input.displayName,
    authorizedAt: input.now,
    // Reconectar renova a autorização: a assinatura anterior não vale como
    // prova da conta nova, então ela é zerada de propósito.
    webhookSubscribedAt: '',
    tokenIssuedAt: input.now,
    tokenExpiresAt: input.tokenExpiresAt || '',
    connectedAt: '',
    lastWebhookAt: '',
    lastInboundAt: previous?.lastInboundAt || '',
    lastOutboundAt: previous?.lastOutboundAt || '',
    requestedAt: previous?.requestedAt || input.now,
    encryptedAccessToken: input.encryptedAccessToken,
    keyFingerprint: instagramKeyFingerprint(),
    source: 'business_login',
  };
  if (tokenChanged) {
    business.instagramIntegration.lastError = undefined;
    business.instagramIntegration.lastErrorAt = undefined;
  }
  return { ok: true, integration: business.instagramIntegration };
}

// ── Identidade do contato (IGSID) por unidade ───────────────────
export function findChannelIdentity(
  db: DB,
  businessId: string,
  accountId: string,
  participantId: string,
): { contact: BusinessCustomer; identity: ChannelIdentity } | null {
  for (const contact of db.contacts) {
    if (contact.businessId !== businessId) continue;
    const identity = (contact.channelIdentities || []).find(
      (i) => i.provider === 'instagram' && i.accountId === accountId && i.participantId === participantId,
    );
    if (identity) return { contact, identity };
  }
  return null;
}

/**
 * Garante o contato da pessoa no Instagram SEM inventar telefone/e-mail.
 * - Se já existe identidade, devolve o contato (e completa o @ quando novo).
 * - Se não existe, cria um contato mínimo (só identidade) — a menos que o
 *   `customer` já venha resolvido de outro caminho (telefone/e-mail/conta),
 *   quando então só o vínculo é adicionado.
 * Regra dura: NUNCA deduplicar por nome (duas pessoas diferentes podem ter o
 * mesmo nome de exibição).
 */
export function ensureInstagramContact(
  db: DB,
  input: {
    businessId: string;
    accountId: string;
    participantId: string;
    username: string;
    displayName: string;
    customerId?: string;
    now: string;
  },
): BusinessCustomer {
  const existing = findChannelIdentity(db, input.businessId, input.accountId, input.participantId);
  if (existing) {
    if (!existing.identity.username && input.username) existing.identity.username = input.username;
    if (!existing.contact.name && input.displayName) existing.contact.name = input.displayName.slice(0, 80);
    existing.contact.lastInteraction = input.now;
    existing.contact.updatedAt = input.now;
    return existing.contact;
  }

  // Contato já conhecido por outra chave (conta/telefone/e-mail): só vincula.
  const byCustomer = input.customerId
    ? db.contacts.find((c) => c.businessId === input.businessId && c.customerId === input.customerId)
    : undefined;
  if (byCustomer) {
    if (!Array.isArray(byCustomer.channelIdentities)) byCustomer.channelIdentities = [];
    byCustomer.channelIdentities.push({
      provider: 'instagram', accountId: input.accountId, participantId: input.participantId,
      username: input.username || '', linkedAt: input.now,
    });
    byCustomer.lastInteraction = input.now;
    byCustomer.updatedAt = input.now;
    return byCustomer;
  }

  const contact: BusinessCustomer = {
    id: randomUUID(),
    businessId: input.businessId,
    customerId: '',
    name: (input.displayName || '').slice(0, 80),
    phone: '',
    email: '',
    createdAt: input.now,
    updatedAt: input.now,
    source: 'instagram',
    lastInteraction: input.now,
    marketingOptIn: false,
    channelIdentities: [{
      provider: 'instagram', accountId: input.accountId, participantId: input.participantId,
      username: input.username || '', linkedAt: input.now,
    }],
  };
  db.contacts.push(contact);
  return contact;
}

// ── Entrada de uma mensagem (webhook → CRM → inbox) ─────────────
export interface InstagramInboundOutcome {
  status: 'created' | 'duplicate' | 'ignored' | 'unmapped' | 'not_ready';
  businessId: string;
  conversationId: string;
  messageId: string;
  leadId: string;
  contactId: string;
  reason: string;
}

/**
 * Processa UMA notificação do webhook, já com o tenant resolvido:
 *   conta conectada → dedupe pelo id oficial → contato (identidade IGSID) →
 *   conversa → mensagem de entrada → lead (só quando é oportunidade nova) →
 *   auditoria.
 *
 * `profile` é o rótulo público do contato (opcional; quem busca é a rota do
 * webhook, FORA de qualquer lock). Sem rótulo, a pessoa existe só pela
 * identidade — nada de nome inventado e nada de telefone.
 *
 * Idempotência: o `mid` oficial é a chave. Reentrega da Meta não cria segunda
 * mensagem, segundo lead nem segunda automação.
 */
export async function ingestInstagramNotification(input: {
  notification: InstagramNotification;
  profile?: { username: string; name: string };
}): Promise<InstagramInboundOutcome> {
  const n = input.notification;
  const empty: InstagramInboundOutcome = {
    status: 'ignored', businessId: '', conversationId: '', messageId: '', leadId: '', contactId: '', reason: '',
  };
  if (n.kind !== 'text' && n.kind !== 'media' && n.kind !== 'unsupported') {
    return { ...empty, reason: `Evento ${n.kind} não vira mensagem de entrada.` };
  }
  if (!n.accountId || !n.participantId) return { ...empty, reason: 'Evento sem conta ou sem remetente.' };

  const dedupeKey = instagramDedupeKey(n);
  const now = new Date().toISOString();
  const username = String(input.profile?.username || '').trim().slice(0, 60);
  const displayName = String(input.profile?.name || '').trim().slice(0, 80);

  const before = await readDB();
  const owners = instagramAccountOwners(before, n.accountId);
  const business = resolveBusinessForInstagramAccountId(before, n.accountId);
  if (!business) {
    return {
      ...empty,
      status: 'unmapped',
      reason: owners.length > 1
        ? 'Esta conta do Instagram aparece conectada em mais de uma unidade — webhook ambíguo, nada foi gravado.'
        : 'Conta do Instagram não está conectada em nenhuma unidade.',
    };
  }
  const businessId = business.id;
  if (before.messages.some((m) => m.businessId === businessId && m.externalId === dedupeKey)) {
    return { ...empty, status: 'duplicate', businessId, reason: 'Evento já processado (mesmo id oficial).' };
  }

  const outcome = await updateDB<InstagramInboundOutcome>((db: DB) => {
    const result: InstagramInboundOutcome = { ...empty, businessId };
    const biz = db.businesses.find((b) => b.id === businessId);
    if (!biz?.instagramIntegration) return { ...result, reason: 'Instagram não conectado nesta unidade.' };
    // Rechecagem DENTRO da transação (duas entregas simultâneas da Meta).
    if (db.messages.some((m) => m.businessId === businessId && m.externalId === dedupeKey)) {
      return { ...result, status: 'duplicate', reason: 'Evento já processado (mesmo id oficial).' };
    }

    // Horário do evento: só vale se for confiável; senão, o recebimento manda.
    // Nunca usar um valor absurdo (futuro/passado fora da faixa) para ABRIR
    // janela — isso autorizaria envio que a Meta recusaria.
    const atISO = n.atReliable && n.at ? n.at : now;

    const known = findChannelIdentity(db, businessId, n.accountId, n.participantId);
    let contact: BusinessCustomer;
    let leadId = '';

    if (known) {
      // Pessoa já conhecida NESTE canal: nada de novo lead a cada mensagem.
      contact = known.contact;
      if (!known.identity.username && username) known.identity.username = username;
      if (!contact.name && displayName) contact.name = displayName;
      contact.lastInteraction = now;
      contact.updatedAt = now;
    } else if (displayName || username) {
      // Oportunidade nova: passa pelo MOTOR OFICIAL (origem/canal reais).
      const ingested = ingestLead(db, {
        businessId,
        name: displayName || `@${username}`,
        source: 'instagram',
        channel: 'instagram',
        instagram: username,
        message: n.kind === 'text' ? n.text : '',
        metadata: { channel: 'instagram', channelAccountId: n.accountId },
        now,
      });
      contact = ingested.contact || ensureInstagramContact(db, {
        businessId, accountId: n.accountId, participantId: n.participantId,
        username, displayName, now,
      });
      leadId = ingested.lead.id;
      if (!Array.isArray(contact.channelIdentities)) contact.channelIdentities = [];
      if (!contact.channelIdentities.some((i) => i.provider === 'instagram' && i.accountId === n.accountId && i.participantId === n.participantId)) {
        contact.channelIdentities.push({
          provider: 'instagram', accountId: n.accountId, participantId: n.participantId,
          username, linkedAt: now,
        });
      }
    } else {
      // Sem rótulo público: pessoa mínima, só identidade (sem telefone/e-mail).
      contact = ensureInstagramContact(db, {
        businessId, accountId: n.accountId, participantId: n.participantId,
        username, displayName, now,
      });
    }

    const contactName = contact.name || (username ? `@${username}` : 'Contato do Instagram');
    const existingConv = db.conversations.find(
      (c) => c.businessId === businessId && c.channel === 'instagram'
        && c.channelAccountId === n.accountId && c.channelUserId === n.participantId,
    );
    const preview = (n.kind === 'text' ? n.text : instagramInboundBody(n)).slice(0, 120);
    let conv: Conversation;
    if (existingConv) {
      conv = existingConv;
      if (!conv.name) conv.name = contactName;
      if (!conv.contactId) conv.contactId = contact.id;
      if (!conv.customerId && contact.customerId) conv.customerId = contact.customerId;
      if (!conv.channelUsername && username) conv.channelUsername = username;
      conv.lastMessageAt = now;
      conv.lastMessagePreview = preview;
      conv.unread = (conv.unread || 0) + 1;
      // A janela é DESTA conversa: mensagem nova do contato abre/renova só a
      // dela. Nunca retrocede com webhook atrasado (max).
      conv.lastInboundAt = instagramMaxISO(conv.lastInboundAt, atISO);
      // Nova mensagem real é nova demanda: conversa fechada volta a abrir, com
      // o MESMO id e o histórico inteiro.
      if (conv.status === 'closed') conv.status = 'open';
      if (leadId && !conv.context?.leadId) conv.context = { ...(conv.context || {}), leadId };
    } else {
      conv = {
        id: randomUUID(),
        businessId,
        channel: 'instagram',
        channelUserId: n.participantId,
        channelAccountId: n.accountId,
        channelUsername: username,
        contactId: contact.id,
        customerId: contact.customerId || '',
        name: contactName,
        phone: '', // o Instagram NÃO dá telefone: nunca fabricar.
        status: 'open',
        mode: 'human', // sem agente treinado para este canal: quem responde é a equipe
        unread: 1,
        lastMessageAt: now,
        lastMessagePreview: preview,
        lastInboundAt: atISO,
        createdAt: now,
        context: leadId ? { leadId } : {},
      };
      db.conversations.push(conv);
    }
    if (!leadId && conv.context?.leadId) leadId = String(conv.context.leadId);

    const message: Message = {
      id: randomUUID(),
      businessId,
      conversationId: conv.id,
      direction: 'in',
      body: instagramInboundBody(n),
      status: 'delivered',
      externalId: dedupeKey,
      by: 'contact',
      byName: contactName,
      channel: 'instagram',
      channelUserId: n.participantId,
      at: atISO,
      meta: {
        instagram: {
          kind: n.kind,
          attachments: n.attachmentTypes,
          accountId: n.accountId,
        },
      },
    };
    db.messages.push(message);

    biz.instagramIntegration.lastWebhookAt = now;
    // Telemetria GLOBAL da unidade (não autoriza envio — quem autoriza é a
    // janela da conversa). Também só avança.
    biz.instagramIntegration.lastInboundAt = instagramMaxISO(biz.instagramIntegration.lastInboundAt, atISO);
    // Só AQUI a conexão é declarada de verdade: a Meta entregou um evento.
    biz.instagramIntegration.status = 'connected';
    biz.instagramIntegration.connectedAt = biz.instagramIntegration.connectedAt || now;
    biz.instagramIntegration.lastError = undefined;
    biz.instagramIntegration.lastErrorAt = undefined;

    pushAudit(db, {
      action: 'instagram.webhook_received',
      actor: { id: 'system', email: 'webhook@instalink.app', role: 'system' },
      businessId,
      meta: { kind: n.kind, conversationId: conv.id, leadId },
    });

    return {
      ...result,
      status: 'created' as const,
      conversationId: conv.id,
      messageId: message.id,
      leadId,
      contactId: contact.id,
      reason: '',
    };
  });

  return outcome;
}
