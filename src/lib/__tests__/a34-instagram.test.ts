// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 9 — INSTAGRAM DIRECT NO INBOX UNIFICADO
// ═══════════════════════════════════════════════════════════════
// O que esta suíte prova (os 8 grupos exigidos pelo bloco):
//
//   CATALOG     — o produto conta a verdade: o Instagram é conectável de
//                 verdade e o conector existe;
//   IDENTIDADE  — a chave é conta + IGSID (nunca nome, nunca @, nunca
//                 telefone); echo/apagada não vira entrada; mídia não quebra;
//   WEBHOOK     — handshake, fail-closed sem segredo, assinatura HMAC,
//                 roteamento por CONTA, duplicata idempotente;
//   CRM         — contato sem telefone inventado, lead pelo motor oficial,
//                 nada duplicado e nada fundido por nome;
//   OUTBOUND    — envio exige `message_id`, janela/política respeitadas,
//                 isolamento por unidade;
//   AUTOMAÇÃO   — `send_channel_message channel=instagram` (sem nó novo),
//                 erro controlado quando desconectado ou fora da janela;
//   ONBOARDING  — BLOCKED_EXTERNAL honesto, state ligado a unidade+usuário e
//                 separado do WhatsApp, token sempre criptografado/fora da
//                 resposta;
//   UX          — filtro por canal, badge e compositor por canal (prova por
//                 fonte, já que componente JSX não roda no vitest).
import './helpers/temp-db';

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, updateDB, writeDB } from '../db';
import { createSession } from '../auth';
import { decryptSecret, encryptSecret } from '../whatsapp-cloud-api';
import { issueSignupState, verifySignupState } from '../whatsapp-onboarding-server';
import { PROVIDERS } from '../integrations/catalog';
import { channelConnectorAvailable, channelConnectorFor } from '../integrations/connectors';
import { AUTOMATION_ACTION_DEFS, automationActionDef } from '../automation/model';
import { executeAction } from '../automation/actions';
import {
  INSTAGRAM_TEXT_MAX_BYTES, instagramAuthorizeUrl, instagramConversationKey, instagramDedupeKey,
  instagramEventTimestamp, instagramInboundBody, instagramMaxISO, instagramMessagingWindow,
  instagramPlan, instagramTextBytes, instagramTextFits, instagramTextLimitError, parseInstagramWebhook,
} from '../instagram';
import {
  INSTAGRAM_ACCOUNT_MISMATCH_CODE, INSTAGRAM_ACCOUNT_MISMATCH_MESSAGE, INSTAGRAM_NO_INBOUND_MESSAGE,
  INSTAGRAM_TOKEN_REFRESH_MARGIN_MS, applyInstagramAuthorization, deliverInstagramMessage,
  ensureInstagramContact, exchangeInstagramCode, fetchInstagramProfile, getInstagramCredentials,
  ingestInstagramNotification, instagramAccountMismatch, instagramAccountOwners, instagramAppSecret,
  instagramConversationLastInboundAt, instagramConversationWindow, instagramMissingPlatformConfig,
  instagramTokenNeedsRefresh, instagramVerifyToken,
  issueInstagramState, processPendingInstagramRetries, readInstagramState, refreshInstagramTokens,
  resolveBusinessForInstagramAccountId, sendInstagramMessage, subscribeInstagramAccount, verifyInstagramState,
} from '../instagram-api';
import { GET as igWebhookGET, POST as igWebhookPOST } from '@/app/api/instagram/webhook/route';
import { GET as igOnboardingGET, POST as igOnboardingPOST } from '@/app/api/instagram/onboarding/route';
import { GET as igCallbackGET } from '@/app/api/instagram/onboarding/callback/route';
import { GET as conversationsGET, POST as conversationsPOST } from '@/app/api/conversations/route';
import { GET as cronInstagramGET } from '@/app/api/cron/instagram/route';
import type { Business, DB, Message } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const BIZ_A = 'biz-ig-a';
const BIZ_B = 'biz-ig-b';
const OWNER_A = 'owner-ig-a';
const OWNER_B = 'owner-ig-b';
const ACC_A = '17841400000000001'; // conta profissional da unidade A
const ACC_B = '17841400000000002'; // conta profissional da unidade B
const TOKEN_A = 'IGQVJ-token-da-unidade-A';
const TOKEN_B = 'IGQVJ-token-da-unidade-B';
const KEY = 'chave-de-teste-do-cofre-ig-32-caracteres';
const APP_ID = '9876543210123456';
const APP_SECRET = 'segredo-app-instagram-teste';

function business(id: string, owner: string): Business {
  return {
    id, ownerId: owner, organizationId: `org-${id}`, name: `Negócio ${id}`, slug: id,
    description: '', logo: '', cover: '', niche: 'saude', modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: true, about: false, agent: false },
    phone: '', whatsapp: '', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0,
    googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 30, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: NOW, updatedAt: NOW, businessTimezone: 'America/Sao_Paulo',
  } as Business;
}

function integrationFor(igUserId: string, token: string, status: 'connected' | 'waiting_first_event' = 'connected') {
  return {
    status,
    igUserId,
    username: igUserId === ACC_A ? 'clinica.a' : 'clinica.b',
    displayName: igUserId === ACC_A ? 'Clínica A' : 'Clínica B',
    authorizedAt: NOW,
    webhookSubscribedAt: NOW,
    tokenIssuedAt: NOW,
    tokenExpiresAt: '2026-11-18T12:00:00.000Z',
    connectedAt: status === 'connected' ? NOW : '',
    lastWebhookAt: status === 'connected' ? NOW : '',
    lastInboundAt: NOW,
    lastOutboundAt: '',
    requestedAt: NOW,
    encryptedAccessToken: encryptSecret(token),
    keyFingerprint: 'fp-ig',
    source: 'business_login',
  } as any;
}

async function seed(options: { withInstagram?: boolean; status?: 'connected' | 'waiting_first_event' } = {}) {
  const db: DB = emptyDB();
  db.users.push(
    { id: OWNER_A, name: 'Ana', email: 'ana@ig.test', passwordHash: 'hash', createdAt: NOW, role: 'owner' } as any,
    { id: OWNER_B, name: 'Bruno', email: 'bruno@ig.test', passwordHash: 'hash', createdAt: NOW, role: 'owner' } as any,
  );
  const a = business(BIZ_A, OWNER_A);
  const b = business(BIZ_B, OWNER_B);
  if (options.withInstagram !== false) {
    a.instagramIntegration = integrationFor(ACC_A, TOKEN_A, options.status || 'connected');
    b.instagramIntegration = integrationFor(ACC_B, TOKEN_B, options.status || 'connected');
  }
  db.businesses.push(a, b);
  await writeDB(db);
}

function instagramPayload(input: {
  accountId?: string;
  senderId?: string;
  mid?: string;
  text?: string;
  isEcho?: boolean;
  isDeleted?: boolean;
  isUnsupported?: boolean;
  attachments?: Array<{ type: string }>;
  /** Valor cru de `messaging[].timestamp` (segundos OU ms) — como a Meta manda. */
  timestamp?: number | string;
}) {
  const message: Record<string, any> = { mid: input.mid || 'mid-1' };
  if (input.text !== undefined) message.text = input.text;
  if (input.isEcho) message.is_echo = true;
  if (input.isDeleted) message.is_deleted = true;
  if (input.isUnsupported) message.is_unsupported = true;
  if (input.attachments) message.attachments = input.attachments;
  return {
    object: 'instagram',
    entry: [{
      id: input.accountId || ACC_A,
      time: input.timestamp || 1_758_000_000_000,
      messaging: [{
        sender: { id: input.senderId || 'igsid-ana' },
        recipient: { id: input.accountId || ACC_A },
        timestamp: input.timestamp ?? 1_758_000_000,
        message,
      }],
    }],
  };
}

/** Conversa do Instagram com evidência de ENTRADA (o que a Meta exige). */
function nowPlusDays(days: number): string {
  return new Date(Date.parse(NOW) + days * 24 * 60 * 60 * 1000).toISOString();
}

async function seedInstagramConversation(input: {
  conversationId: string;
  accountId?: string;
  participantId?: string;
  lastInboundAt?: string;
  inboundAt?: string;
  status?: 'open' | 'closed';
  unread?: number;
  withInbound?: boolean;
}) {
  const db = await readDB();
  const now = input.inboundAt || NOW;
  const conversation = {
    id: input.conversationId,
    businessId: BIZ_A,
    channel: 'instagram' as const,
    channelUserId: input.participantId || 'igsid-ana',
    channelAccountId: input.accountId || ACC_A,
    channelUsername: 'ana.souza',
    contactId: '',
    customerId: '',
    name: 'Ana Souza',
    phone: '',
    status: input.status || ('open' as const),
    mode: 'human' as const,
    unread: input.unread ?? 0,
    lastMessageAt: now,
    lastMessagePreview: 'oi',
    lastInboundAt: input.lastInboundAt ?? (input.withInbound === false ? '' : now),
    createdAt: now,
    context: {},
  };
  db.conversations.push(conversation as any);
  if (input.withInbound !== false) {
    db.messages.push({
      id: `in-${input.conversationId}`, businessId: BIZ_A, conversationId: conversation.id,
      direction: 'in', body: 'oi', status: 'delivered', externalId: `ig:in-${input.conversationId}`,
      by: 'contact', channel: 'instagram', channelUserId: conversation.channelUserId, at: now,
    } as any);
  }
  await writeDB(db);
  return conversation;
}

function jsonReq(path: string, options: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  return new NextRequest(`http://localhost:3000${path}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

function signedWebhookReq(payload: unknown, secret = APP_SECRET) {
  const raw = JSON.stringify(payload);
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`;
  return new NextRequest('http://localhost:3000/api/instagram/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature },
    body: raw,
  });
}

/** Stub do Graph API com os FORMATOS OFICIAIS (nunca um mock "mágico"). */
function stubGraph(options: {
  profile?: { username: string; name: string } | null;
  sendMessageId?: string | null;
  sendStatus?: number;
  subscribe?: boolean;
} = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: any) => {
    const href = String(url);
    calls.push(href);
    if (href.includes('/messages')) {
      const status = options.sendStatus ?? 200;
      const body = options.sendMessageId === null
        ? { recipient_id: 'igsid-ana' }
        : { recipient_id: 'igsid-ana', message_id: options.sendMessageId ?? 'mid-enviada-1' };
      return { ok: status < 300, status, json: async () => body } as any;
    }
    if (href.includes('/subscribed_apps')) {
      return { ok: true, status: 200, json: async () => (options.subscribe === false ? {} : { success: true }) } as any;
    }
    if (href.includes('/oauth/access_token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'token-curto', user_id: ACC_A }) } as any;
    }
    if (href.includes('access_token=') && href.includes('ig_exchange_token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'token-longo-60-dias', expires_in: 5_184_000 }) } as any;
    }
    if (href.includes('refresh_access_token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'token-renovado', expires_in: 5_184_000 }) } as any;
    }
    // Perfil do contato / dados da conta
    if (options.profile === null) {
      return { ok: false, status: 400, json: async () => ({ error: { message: 'Perfil indisponível' } }) } as any;
    }
    const profile = options.profile || { username: 'ana.souza', name: 'Ana Souza' };
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: 'igsid-ana', username: profile.username, name: profile.name, profile_pic: 'https://cdn/pic.jpg' }),
    } as any;
  }));
  return calls;
}

let tokenA = '';
let tokenB = '';
let envBackup: Record<string, string | undefined> = {};

// O cofre precisa existir ANTES do seed (as credenciais nascem criptografadas).
process.env.WHATSAPP_CREDENTIALS_KEY = KEY;

const IG_ENV = {
  INSTAGRAM_APP_ID: APP_ID,
  INSTAGRAM_APP_SECRET: APP_SECRET,
  INSTAGRAM_VERIFY_TOKEN: 'ig-verify-token-b9',
  WHATSAPP_CREDENTIALS_KEY: KEY,
};

function clearIgEnv() {
  for (const key of Object.keys(IG_ENV)) delete process.env[key];
  delete process.env.META_APP_SECRET;
  delete process.env.WHATSAPP_VERIFY_TOKEN;
  delete process.env.INSTAGRAM_VERIFY_TOKEN;
}

beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  process.env.WHATSAPP_CREDENTIALS_KEY = KEY;
  await seed();
  tokenA = await createSession(OWNER_A);
  tokenB = await createSession(OWNER_B);
  envBackup = { ...process.env };
  clearIgEnv();
  process.env.WHATSAPP_CREDENTIALS_KEY = KEY;
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in envBackup)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(envBackup)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

// ═══════════════════════════════════════════════════════════════
describe('B9 · CATALOG — o produto conta a verdade sobre o Instagram', () => {
  it('o provedor do Instagram é conectável e não promete mais "em breve"', () => {
    const ig = PROVIDERS.find((p) => p.provider === 'instagram')!;
    expect(ig.kind).toBe('channel');
    expect(ig.canConnect).toBe(true);
    expect(ig.nativePending).toBe(false);
    expect(ig.hint).toContain('Direct');
    const flat = JSON.stringify(ig);
    expect(flat).not.toContain('P6.1');
    expect(flat).not.toContain('em breve');
    expect(flat).not.toMatch(/coment[áa]rios/i);
    expect(ig.unavailableReason).toBeUndefined();
  });

  it('o conector oficial do Instagram está registrado e disponível', () => {
    expect(channelConnectorAvailable('instagram')).toBe(true);
    const connector = channelConnectorFor('instagram')!;
    expect(connector.provider).toBe('instagram');
    expect(connector.label).toContain('Instagram');
    expect(connector.available).toBe(true);
  });

  it('não existe nó novo de automação: o canal é um CAMPO da ação existente', () => {
    expect(AUTOMATION_ACTION_DEFS.some((a) => (a.type as string) === 'send_instagram_message')).toBe(false);
    const action = automationActionDef('send_channel_message')!;
    const channelField = action.fields.find((f) => f.key === 'channel')!;
    expect(channelField).toBeDefined();
    expect(channelField.options?.map((o) => o.value)).toEqual(['whatsapp', 'instagram']);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('B9 · IDENTIDADE — conta + IGSID, nunca nome/@/telefone', () => {
  it('lê o webhook oficial e ignora echo/apagada sem virar entrada', () => {
    const parsed = parseInstagramWebhook({
      object: 'instagram',
      entry: [{
        id: ACC_A,
        messaging: [
          { sender: { id: 'igsid-ana' }, recipient: { id: ACC_A }, timestamp: 1_758_000_000, message: { mid: 'm1', text: 'oi' } },
          { sender: { id: ACC_A }, recipient: { id: 'igsid-ana' }, timestamp: 1_758_000_001, message: { mid: 'm2', text: 'resposta nossa', is_echo: true } },
          { sender: { id: 'igsid-ana' }, recipient: { id: ACC_A }, timestamp: 1_758_000_002, message: { mid: 'm3', is_deleted: true } },
        ],
      }],
    });
    expect(parsed.isInstagram).toBe(true);
    expect(parsed.notifications).toHaveLength(3);
    expect(parsed.notifications[0]).toMatchObject({ accountId: ACC_A, participantId: 'igsid-ana', messageId: 'm1', kind: 'text' });
    expect(parsed.notifications[1].kind).toBe('echo');
    expect(parsed.notifications[1].isEcho).toBe(true);
    expect(parsed.notifications[2].kind).toBe('deleted');
  });

  it('corpo de outro objeto é ignorado (mesmo endpoint, outro produto)', () => {
    const parsed = parseInstagramWebhook({ object: 'page', entry: [] });
    expect(parsed.isInstagram).toBe(false);
    expect(parsed.notifications).toHaveLength(0);
  });

  it('mídia não quebra: o texto é o rótulo honesto do que chegou', () => {
    const parsed = parseInstagramWebhook(instagramPayload({ mid: 'm-img', attachments: [{ type: 'image' }] }));
    const n = parsed.notifications[0];
    expect(n.kind).toBe('media');
    expect(n.attachmentTypes).toEqual(['image']);
    expect(instagramInboundBody(n)).toBe('Imagem recebida');
    expect(instagramInboundBody(n)).not.toContain('oi');
  });

  it('mensagem não suportada é declarada como tal (sem fingir conteúdo)', () => {
    const parsed = parseInstagramWebhook(instagramPayload({ mid: 'm-un', isUnsupported: true }));
    const n = parsed.notifications[0];
    expect(n.kind).toBe('unsupported');
    expect(instagramInboundBody(n)).toContain('não suportada');
    expect(instagramDedupeKey(n)).toBe('ig:m-un');
    // A chave da conversa é conta + participante (nunca telefone/nome).
    expect(instagramConversationKey(ACC_A, 'igsid-ana')).toBe(`ig:${ACC_A}:igsid-ana`);
  });

  it('o limite de texto é medido em BYTES (nunca cortado em silêncio)', () => {
    const text = 'á'.repeat(600); // 2 bytes por caractere em UTF-8
    expect(instagramTextBytes(text)).toBe(1200);
    expect(instagramTextFits(text)).toBe(false);
    expect(instagramTextFits('á'.repeat(499))).toBe(true);
    expect(instagramTextFits('🙂'.repeat(250))).toBe(true); // 4 bytes cada = 1000
    expect(instagramTextFits('🙂'.repeat(251))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('B9 · WEBHOOK — handshake, fail-closed, HMAC, tenant e duplicata', () => {
  it('responde o desafio quando o verify token confere', async () => {
    process.env.INSTAGRAM_VERIFY_TOKEN = 'ig-verify-token-b9';
    const res = await igWebhookGET(jsonReq('/api/instagram/webhook?hub.mode=subscribe&hub.challenge=abc123&hub.verify_token=ig-verify-token-b9'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('abc123');
  });

  it('recusa verify token errado (403) e fica desligado sem token configurado (503)', async () => {
    process.env.INSTAGRAM_VERIFY_TOKEN = 'ig-verify-token-b9';
    const wrong = await igWebhookGET(jsonReq('/api/instagram/webhook?hub.mode=subscribe&hub.challenge=abc&hub.verify_token=nao'));
    expect(wrong.status).toBe(403);
    delete process.env.INSTAGRAM_VERIFY_TOKEN;
    const off = await igWebhookGET(jsonReq('/api/instagram/webhook?hub.mode=subscribe&hub.challenge=abc&hub.verify_token=ig-verify-token-b9'));
    expect(off.status).toBe(503);
  });

  it('falha fechado sem App Secret (503) e recusa assinatura inválida (403)', async () => {
    const payload = instagramPayload({ text: 'oi' });
    const noSecret = await igWebhookPOST(signedWebhookReq(payload));
    expect(noSecret.status).toBe(503);

    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    const badSignature = new NextRequest('http://localhost:3000/api/instagram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=deadbeef' },
      body: JSON.stringify(payload),
    });
    const res = await igWebhookPOST(badSignature);
    expect(res.status).toBe(403);
    const db = await readDB();
    expect(db.messages).toHaveLength(0);
  });

  it('assinatura válida cria conversa e mensagem do Instagram (e só então "conectado")', async () => {
    await seed({ status: 'waiting_first_event' });
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    stubGraph();
    const res = await igWebhookPOST(signedWebhookReq(instagramPayload({ mid: 'm-webhook-1', text: 'Bom dia!' })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(1);

    const db = await readDB();
    const conv = db.conversations.find((c) => c.businessId === BIZ_A && c.channel === 'instagram')!;
    expect(conv.channelAccountId).toBe(ACC_A);
    expect(conv.channelUserId).toBe('igsid-ana');
    expect(conv.phone).toBe('');
    const msg = db.messages.find((m) => m.conversationId === conv.id)!;
    expect(msg.externalId).toBe('ig:m-webhook-1');
    expect(msg.direction).toBe('in');
    // A conexão só é declarada depois da entrega real.
    expect(db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!.status).toBe('connected');
    expect(db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!.lastWebhookAt).toBeTruthy();
  });

  it('reentrega da Meta não cria segunda mensagem nem segundo lead', async () => {
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    stubGraph();
    const payload = instagramPayload({ mid: 'm-repetida', text: 'de novo' });
    await igWebhookPOST(signedWebhookReq(payload));
    const second = await igWebhookPOST(signedWebhookReq(payload));
    const body = await second.json();
    expect(body.duplicate).toBe(1);
    expect(body.created).toBe(0);
    const db = await readDB();
    expect(db.messages.filter((m) => m.externalId === 'ig:m-repetida')).toHaveLength(1);
    expect(db.leads).toHaveLength(1);
  });

  it('conta não conectada é ignorada sem vazar entre negócios', async () => {
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    stubGraph();
    const res = await igWebhookPOST(signedWebhookReq(instagramPayload({ accountId: '17841400000009999', mid: 'm-orfa' })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(body.unmappedAccounts).toContain('17841400000009999');
    const db = await readDB();
    expect(db.messages).toHaveLength(0);
    expect(db.conversations).toHaveLength(0);
  });

  it('webhook da conta A grava SÓ na unidade A', async () => {
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    stubGraph();
    await igWebhookPOST(signedWebhookReq(instagramPayload({ mid: 'm-a', text: 'só A' })));
    await igWebhookPOST(signedWebhookReq(instagramPayload({ accountId: ACC_B, mid: 'm-b', text: 'só B' })));
    const db = await readDB();
    const a = db.conversations.filter((c) => c.businessId === BIZ_A);
    const b = db.conversations.filter((c) => c.businessId === BIZ_B);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].channelAccountId).toBe(ACC_A);
    expect(b[0].channelAccountId).toBe(ACC_B);
  });

  it('perfil indisponível não impede a mensagem de entrar (nada de inventar nome)', async () => {
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    stubGraph({ profile: null });
    const res = await igWebhookPOST(signedWebhookReq(instagramPayload({ mid: 'm-sem-perfil', text: 'oi' })));
    expect(res.status).toBe(200);
    const db = await readDB();
    const conv = db.conversations.find((c) => c.channel === 'instagram')!;
    expect(conv.name).toBe('Contato do Instagram');
    expect(db.contacts.find((c) => c.id === conv.contactId)!.name).toBe('');
    // Sem rótulo público não existe lead honesto (o motor exige nome/telefone/e-mail).
    expect(db.leads).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('B9 · CRM — contato sem telefone inventado e lead pelo motor oficial', () => {
  it('primeira mensagem cria contato com identidade do canal e lead de origem instagram', async () => {
    stubGraph();
    const res = await ingestInstagramNotification({
      notification: parseInstagramWebhook(instagramPayload({ mid: 'm-crm-1', text: 'Olá, quero agendar' })).notifications[0],
      profile: { username: 'ana.souza', name: 'Ana Souza' },
    });
    expect(res.status).toBe('created');

    const db = await readDB();
    const contact = db.contacts.find((c) => c.id === res.contactId)!;
    expect(contact.phone).toBe('');
    expect(contact.email).toBe('');
    expect(contact.name).toBe('Ana Souza');
    expect(contact.channelIdentities?.[0]).toMatchObject({ provider: 'instagram', accountId: ACC_A, participantId: 'igsid-ana' });

    const lead = db.leads.find((l) => l.id === res.leadId)!;
    expect(lead.origin).toBe('instagram');
    expect(lead.channel).toBe('instagram');
    expect(lead.instagram).toBe('ana.souza');
    expect(lead.phone).toBe('');
  });

  it('a segunda mensagem não recria oportunidade nem muda a conversa', async () => {
    stubGraph();
    const first = await ingestInstagramNotification({
      notification: parseInstagramWebhook(instagramPayload({ mid: 'm-2a', text: 'oi' })).notifications[0],
      profile: { username: 'ana.souza', name: 'Ana Souza' },
    });
    const second = await ingestInstagramNotification({
      notification: parseInstagramWebhook(instagramPayload({ mid: 'm-2b', text: 'tudo bem?' })).notifications[0],
    });
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.contactId).toBe(first.contactId);
    const db = await readDB();
    expect(db.leads).toHaveLength(1);
    expect(db.contacts.filter((c) => c.businessId === BIZ_A)).toHaveLength(1);
    expect(db.messages.filter((m) => m.direction === 'in')).toHaveLength(2);
    // O lead continua sendo o mesmo da conversa.
    expect(db.conversations[0].context?.leadId).toBe(first.leadId);
  });

  it('duas pessoas com o MESMO nome de exibição não são fundidas (nome não é chave)', async () => {
    stubGraph({ profile: { username: 'ana.um', name: 'Ana Souza' } });
    await ingestInstagramNotification({
      notification: parseInstagramWebhook(instagramPayload({ mid: 'p1', senderId: 'igsid-1', text: 'oi' })).notifications[0],
      profile: { username: 'ana.um', name: 'Ana Souza' },
    });
    await ingestInstagramNotification({
      notification: parseInstagramWebhook(instagramPayload({ mid: 'p2', senderId: 'igsid-2', text: 'oi' })).notifications[0],
      profile: { username: 'ana.dois', name: 'Ana Souza' },
    });
    const db = await readDB();
    expect(db.contacts.filter((c) => c.businessId === BIZ_A)).toHaveLength(2);
    expect(db.leads).toHaveLength(2);
    expect(db.conversations).toHaveLength(2);
  });

  it('o MESMO identificador em contas diferentes não é a mesma pessoa', async () => {
    stubGraph();
    await ingestInstagramNotification({
      notification: parseInstagramWebhook(instagramPayload({ accountId: ACC_A, mid: 'x1', senderId: 'igsid-compartilhado', text: 'oi' })).notifications[0],
      profile: { username: 'mesmo.id', name: 'Mesmo Id' },
    });
    await ingestInstagramNotification({
      notification: parseInstagramWebhook(instagramPayload({ accountId: ACC_B, mid: 'x2', senderId: 'igsid-compartilhado', text: 'oi' })).notifications[0],
      profile: { username: 'mesmo.id', name: 'Mesmo Id' },
    });
    const db = await readDB();
    const contacts = db.contacts.filter((c) => c.channelIdentities?.some((i) => i.participantId === 'igsid-compartilhado'));
    expect(contacts).toHaveLength(2);
    expect(new Set(contacts.map((c) => c.businessId))).toEqual(new Set([BIZ_A, BIZ_B]));
  });

  it('ensureInstagramContact é idempotente por identidade', async () => {
    const db = await readDB();
    const c1 = ensureInstagramContact(db, { businessId: BIZ_A, accountId: ACC_A, participantId: 'igsid-novo', username: 'novo', displayName: 'Novo', now: NOW });
    const c2 = ensureInstagramContact(db, { businessId: BIZ_A, accountId: ACC_A, participantId: 'igsid-novo', username: 'novo', displayName: 'Novo', now: NOW });
    expect(c2.id).toBe(c1.id);
    expect(c1.phone).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('B9 · OUTBOUND — prova de envio, janela e isolamento', () => {
  it('2xx SEM message_id NÃO é sucesso (não-retryable e explícito)', async () => {
    stubGraph({ sendMessageId: null });
    const res = await sendInstagramMessage({ igUserId: ACC_A, accessToken: TOKEN_A, to: 'igsid-ana', text: 'oi' });
    expect(res.ok).toBe(false);
    expect(res.externalId).toBe('');
    expect(res.retryable).toBe(false);
    expect(res.error).toContain('identificador');
  });

  it('2xx COM message_id devolve o id oficial', async () => {
    stubGraph({ sendMessageId: 'mid-oficial-9' });
    const res = await sendInstagramMessage({ igUserId: ACC_A, accessToken: TOKEN_A, to: 'igsid-ana', text: 'oi' });
    expect(res.ok).toBe(true);
    expect(res.externalId).toBe('mid-oficial-9');
  });

  it('o envio usa o host oficial do Instagram e manda recipient+message.text', async () => {
    const calls = stubGraph({ sendMessageId: 'mid-1' });
    await sendInstagramMessage({ igUserId: ACC_A, accessToken: TOKEN_A, to: 'igsid-ana', text: 'olá' });
    const url = calls.find((u) => u.includes('/messages'))!;
    expect(url).toContain('graph.instagram.com');
    expect(url).toContain(`/${ACC_A}/messages`);
    expect(url).not.toContain(TOKEN_A); // o token vai no header, não na URL
  });

  it('o perfil do contato usa os campos oficiais (name, username, profile_pic)', async () => {
    const calls = stubGraph();
    const profile = await fetchInstagramProfile({ igUserId: ACC_A, accessToken: TOKEN_A, participantId: 'igsid-ana' });
    expect(profile.ok).toBe(true);
    expect(profile.username).toBe('ana.souza');
    const url = calls[0];
    expect(url).toContain('fields=name%2Cusername%2Cprofile_pic');
  });

  it('a assinatura do webhook vai por subscribed_apps com o campo messages', async () => {
    const calls = stubGraph();
    const ok = await subscribeInstagramAccount({ igUserId: ACC_A, accessToken: TOKEN_A });
    expect(ok.ok).toBe(true);
    expect(calls[0]).toContain(`/${ACC_A}/subscribed_apps`);
    expect(calls[0]).toContain('subscribed_fields=messages');

    stubGraph({ subscribe: false });
    const failed = await subscribeInstagramAccount({ igUserId: ACC_A, accessToken: TOKEN_A });
    expect(failed.ok).toBe(false);
  });

  it('conector exige conversa iniciada pelo contato (a Meta não permite DM fria)', async () => {
    const calls = stubGraph();
    const res = await channelConnectorFor('instagram')!.send(
      { businessId: BIZ_A, nowISO: NOW },
      { businessId: BIZ_A, integrationId: 'ig', provider: 'instagram', to: 'igsid-nunca-escreveu', body: 'oi' },
    );
    expect(res.ok).toBe(false);
    expect(res.detail).toBe(INSTAGRAM_NO_INBOUND_MESSAGE);
    expect(calls).toHaveLength(0); // nenhuma chamada à Meta
  });

  it('conector recusa fora da janela do PARTICIPANTE com motivo (política da Meta)', async () => {
    const past = '2026-09-14T12:00:00.000Z'; // 5 dias atrás: fora das 24 h, dentro do HUMAN_AGENT
    await seedInstagramConversation({ conversationId: 'conv-antiga-janela', lastInboundAt: past, inboundAt: past });
    const calls = stubGraph();
    const res = await channelConnectorFor('instagram')!.send(
      { businessId: BIZ_A, nowISO: NOW },
      { businessId: BIZ_A, integrationId: 'ig', provider: 'instagram', to: 'igsid-ana', body: 'oi' },
    );
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/24 h|HUMAN_AGENT|janela/i);
    expect(calls).toHaveLength(0);
  });

  it('conector envia quando a janela DESTA conversa está aberta e devolve o id oficial', async () => {
    await seedInstagramConversation({ conversationId: 'conv-conector' });
    stubGraph({ sendMessageId: 'mid-conector' });
    const res = await channelConnectorFor('instagram')!.send(
      { businessId: BIZ_A, nowISO: NOW },
      { businessId: BIZ_A, integrationId: 'ig', provider: 'instagram', to: 'igsid-ana', body: 'oi' },
    );
    expect(res.ok).toBe(true);
    expect(res.externalId).toBe('mid-conector');
  });

  it('conector de unidade sem Instagram responde missing_credentials', async () => {
    const db = await readDB();
    db.businesses.find((b) => b.id === BIZ_B)!.instagramIntegration = undefined;
    await writeDB(db);
    const res = await channelConnectorFor('instagram')!.send(
      { businessId: BIZ_B, nowISO: NOW },
      { businessId: BIZ_B, integrationId: 'ig', provider: 'instagram', to: 'x', body: 'oi' },
    );
    expect(res.ok).toBe(false);
    expect(res.code).toBe('missing_credentials');
  });

  it('deliverInstagramMessage entrega pendente do Instagram e ignora conversa de WhatsApp', async () => {
    const db = await readDB();
    const now = NOW;
    const igConv = {
      id: 'conv-ig-1', businessId: BIZ_A, channel: 'instagram' as const, channelUserId: 'igsid-ana',
      channelAccountId: ACC_A, contactId: '', customerId: '', name: 'Ana', phone: '', status: 'open' as const,
      mode: 'human' as const, unread: 0, lastMessageAt: now, lastMessagePreview: 'oi',
      lastInboundAt: now, createdAt: now, context: {},
    };
    db.messages.push({
      id: 'in-conv-ig-1', businessId: BIZ_A, conversationId: 'conv-ig-1', direction: 'in', body: 'oi',
      status: 'delivered', externalId: 'ig:in-conv-ig-1', by: 'contact', channel: 'instagram',
      channelUserId: 'igsid-ana', at: now,
    } as Message);
    const waConv = {
      id: 'conv-wa-1', businessId: BIZ_A, channel: 'whatsapp' as const, channelUserId: '5511999990000',
      contactId: '', customerId: '', name: 'Ana', phone: '5511999990000', status: 'open' as const,
      mode: 'human' as const, unread: 0, lastMessageAt: now, lastMessagePreview: 'oi', createdAt: now, context: {},
    };
    const igMsg: Message = {
      id: 'msg-ig-1', businessId: BIZ_A, conversationId: igConv.id, direction: 'out', body: 'Bom dia',
      status: 'pending', externalId: '', by: 'user', at: now,
    };
    const waMsg: Message = { ...igMsg, id: 'msg-wa-1', conversationId: waConv.id };
    db.conversations.push(igConv, waConv);
    db.messages.push(igMsg, waMsg);
    await writeDB(db);

    stubGraph({ sendMessageId: 'mid-delivery' });
    const res = await deliverInstagramMessage(BIZ_A, igMsg.id);
    expect(res.ok).toBe(true);
    expect(res.externalId).toBe('mid-delivery');

    // A mensagem do WhatsApp não é tocada pelo caminho do Instagram.
    const wa = await deliverInstagramMessage(BIZ_A, waMsg.id);
    expect(wa.status).toBe('claimed_by_other');
    const after = await readDB();
    expect(after.messages.find((m) => m.id === waMsg.id)!.status).toBe('pending');
    expect(after.messages.find((m) => m.id === igMsg.id)!.status).toBe('sent');
  });

  it('credencial é decifrada só no servidor e fica criptografada no documento', async () => {
    const db = await readDB();
    const biz = db.businesses.find((b) => b.id === BIZ_A)!;
    expect(biz.instagramIntegration!.encryptedAccessToken).not.toContain(TOKEN_A);
    expect(decryptSecret(biz.instagramIntegration!.encryptedAccessToken!)).toBe(TOKEN_A);
    expect(getInstagramCredentials(biz)!.accessToken).toBe(TOKEN_A);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('B9 · AUTOMAÇÃO — send_channel_message com canal Instagram', () => {
  function actionInput(params: Record<string, any>, context: Record<string, any> = {}) {
    return {
      db: undefined as unknown as DB,
      business: undefined as unknown as Business,
      automation: { id: 'auto-1', businessId: BIZ_A } as any,
      run: { id: 'run-1', businessId: BIZ_A, context } as any,
      nodeId: 'node-1',
      now: NOW,
      params: { message: 'Olá!', ...params },
    };
  }

  it('desconectado ⇒ erro controlado (nada é gravado)', async () => {
    const db = await readDB();
    db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration = undefined;
    const input = actionInput({ __type: 'send_channel_message', channel: 'instagram' });
    input.db = db;
    input.business = db.businesses.find((b) => b.id === BIZ_A)!;
    const res = executeAction(input as any);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Instagram não conectado/i);
    expect(db.messages).toHaveLength(0);
  });

  it('IGSID arbitrário sem conversa iniciada ⇒ nada é criado e a Meta não é chamada', async () => {
    const db = await readDB();
    const calls = stubGraph();
    const input = actionInput({ __type: 'send_channel_message', channel: 'instagram', to: '17841499999999999' });
    input.db = db;
    input.business = db.businesses.find((b) => b.id === BIZ_A)!;
    const res = executeAction(input as any);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(INSTAGRAM_NO_INBOUND_MESSAGE);
    expect(db.conversations).toHaveLength(0);
    expect(db.messages).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('vínculo do contato sem conversa real ⇒ continua recusando (identidade não é prova)', async () => {
    const db = await readDB();
    const contact = ensureInstagramContact(db, {
      businessId: BIZ_A, accountId: ACC_A, participantId: 'igsid-sem-conversa', username: 'x', displayName: 'Cliente X', now: NOW,
    });
    await writeDB(db);
    const fresh = await readDB();
    const input = actionInput(
      { __type: 'send_channel_message', channel: 'instagram' },
      { customer: { id: contact.id } },
    );
    input.db = fresh;
    input.business = fresh.businesses.find((b) => b.id === BIZ_A)!;
    const res = executeAction(input as any);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(INSTAGRAM_NO_INBOUND_MESSAGE);
    expect(fresh.conversations).toHaveLength(0);
    expect(fresh.messages).toHaveLength(0);
  });

  it('conectado + conversa iniciada + janela aberta ⇒ mensagem pendente na conversa existente', async () => {
    await seedInstagramConversation({ conversationId: 'conv-auto', participantId: 'igsid-automacao' });
    const db = await readDB();
    const contact = ensureInstagramContact(db, {
      businessId: BIZ_A, accountId: ACC_A, participantId: 'igsid-automacao', username: 'auto', displayName: 'Cliente Auto', now: NOW,
    });
    await writeDB(db);
    const fresh = await readDB();
    const input = actionInput(
      { __type: 'send_channel_message', channel: 'instagram' },
      { customer: { id: contact.id } },
    );
    input.db = fresh;
    input.business = fresh.businesses.find((b) => b.id === BIZ_A)!;
    const res = executeAction(input as any);
    expect(res.ok).toBe(true);
    expect(res.summary).toMatch(/Instagram/i);
    // NENHUMA conversa nova: usa a que o contato já tinha iniciado.
    expect(fresh.conversations.filter((c) => c.channel === 'instagram')).toHaveLength(1);
    const conv = fresh.conversations[0];
    expect(conv.channelUserId).toBe('igsid-automacao');
    expect(conv.channelAccountId).toBe(ACC_A);
    expect(conv.contactId).toBe(contact.id);
    const msg = fresh.messages.find((m) => m.direction === 'out')!;
    expect(msg.channel).toBe('instagram');
    expect(msg.status).toBe('pending');
    expect(msg.body).toBe('Olá!');
  });

  it('fora da janela da conversa ⇒ erro explícito de política (nada enfileirado)', async () => {
    await seedInstagramConversation({
      conversationId: 'conv-velha', participantId: 'igsid-velho',
      lastInboundAt: '2026-08-01T00:00:00.000Z', inboundAt: '2026-08-01T00:00:00.000Z',
    });
    const db = await readDB();
    const input = actionInput({ __type: 'send_channel_message', channel: 'instagram', to: 'igsid-velho' });
    input.db = db;
    input.business = db.businesses.find((b) => b.id === BIZ_A)!;
    const res = executeAction(input as any);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Instagram/i);
    expect(db.messages.filter((m) => m.direction === 'out')).toHaveLength(0);
  });

  it('texto acima do limite ⇒ recusa explícita, sem Message e sem chamada à Meta', async () => {
    await seedInstagramConversation({ conversationId: 'conv-limite' });
    const db = await readDB();
    const calls = stubGraph();
    const input = actionInput({ __type: 'send_channel_message', channel: 'instagram', message: '🙂'.repeat(300) });
    input.db = db;
    input.business = db.businesses.find((b) => b.id === BIZ_A)!;
    const res = executeAction(input as any);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/excede o limite/i);
    expect(db.messages.filter((m) => m.direction === 'out')).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('sem o campo channel, o comportamento do WhatsApp continua igual', async () => {
    const db = await readDB();
    const input = actionInput({ __type: 'send_channel_message' });
    input.db = db;
    input.business = db.businesses.find((b) => b.id === BIZ_A)!;
    const res = executeAction(input as any);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/telefone do destinatário/i);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('B9 · ONBOARDING — BLOCKED_EXTERNAL honesto, state e credencial', () => {
  it('sem a plataforma configurada o plano é BLOCKED_EXTERNAL (nada de botão que finge)', async () => {
    const db = await readDB();
    const plan = instagramPlan({ env: {}, business: db.businesses[0], siteUrl: 'https://app.instalink.test' });
    expect(plan.state).toBe('platform_blocked');
    expect(plan.code).toBe('BLOCKED_EXTERNAL');
    expect(plan.clientConfig).toBeNull();
    expect(plan.layers[0].missing).toContain('INSTAGRAM_APP_ID');
  });

  it('estados honestos: não conectado → webhook pendente → aguardando 1ª mensagem → conectado', async () => {
    const env = { ...IG_ENV };
    const siteUrl = 'https://app.instalink.test';
    const empty = business(BIZ_A, OWNER_A);
    const notConnected = instagramPlan({ env, business: empty, siteUrl });
    expect(notConnected.state).toBe('not_connected');
    expect(notConnected.nextAction.kind).toBe('authorize');

    const authorizedOnly = business(BIZ_A, OWNER_A);
    authorizedOnly.instagramIntegration = { ...integrationFor(ACC_A, TOKEN_A), status: 'webhook_pending', webhookSubscribedAt: '', connectedAt: '', lastWebhookAt: '' } as any;
    const pending = instagramPlan({ env, business: authorizedOnly, siteUrl });
    expect(pending.state).toBe('webhook_pending');
    expect(pending.nextAction.kind).toBe('retry_subscribe');

    const subscribed = business(BIZ_A, OWNER_A);
    subscribed.instagramIntegration = { ...integrationFor(ACC_A, TOKEN_A), status: 'waiting_first_event', connectedAt: '', lastWebhookAt: '' } as any;
    const waiting = instagramPlan({ env, business: subscribed, siteUrl });
    expect(waiting.state).toBe('waiting_first_event');
    expect(waiting.steps.find((s) => s.current)!.id).toBe('first_event');

    const connected = business(BIZ_A, OWNER_A);
    connected.instagramIntegration = integrationFor(ACC_A, TOKEN_A);
    const ok = instagramPlan({ env, business: connected, siteUrl });
    expect(ok.state).toBe('connected');
    expect(ok.code).toBe('OK');
  });

  it('o clientConfig nunca carrega segredo', async () => {
    const env = { ...IG_ENV };
    const db = await readDB();
    const plan = instagramPlan({ env, business: db.businesses[0], siteUrl: 'https://app.instalink.test' });
    const flat = JSON.stringify(plan);
    expect(flat).not.toContain(APP_SECRET);
    expect(flat).not.toContain(TOKEN_A);
    expect(flat).toContain(APP_ID);
    expect(plan.clientConfig!.scopes).toEqual(['instagram_business_basic', 'instagram_business_manage_messages']);
    expect(plan.clientConfig!.redirectUri).toContain('/api/instagram/onboarding/callback');
    expect(plan.webhookPath).toBe('/api/instagram/webhook');
  });

  it('a URL de autorização é a oficial e leva o state', () => {
    const url = instagramAuthorizeUrl({ appId: APP_ID, redirectUri: 'https://app.instalink.test/api/instagram/onboarding/callback', state: 'st-1' });
    expect(url.startsWith('https://www.instagram.com/oauth/authorize?')).toBe(true);
    expect(url).toContain(`client_id=${APP_ID}`);
    expect(url).toContain('response_type=code');
    expect(url).toContain('scope=instagram_business_basic%2Cinstagram_business_manage_messages');
    expect(url).toContain('state=st-1');
  });

  it('o state é ligado à unidade e ao usuário — e a outra unidade não serve', async () => {
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    const state = issueInstagramState({ businessId: BIZ_A, userId: OWNER_A });
    expect(verifyInstagramState(state, { businessId: BIZ_A, userId: OWNER_A }).ok).toBe(true);
    expect(verifyInstagramState(state, { businessId: BIZ_B, userId: OWNER_A }).ok).toBe(false);
    expect(verifyInstagramState(state, { businessId: BIZ_A, userId: OWNER_B }).ok).toBe(false);
    const read = readInstagramState(state);
    expect(read.ok).toBe(true);
    expect(read.businessId).toBe(BIZ_A);
    expect(read.userId).toBe(OWNER_A);
  });

  it('state do Instagram NÃO é aceito como state do WhatsApp (e vice-versa)', async () => {
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    const igState = issueInstagramState({ businessId: BIZ_A, userId: OWNER_A });
    // O B8 assina com o app secret "cru"; o Instagram deriva um segredo por canal.
    const waCheck = verifySignupState(igState, APP_SECRET, { businessId: BIZ_A, userId: OWNER_A });
    expect(waCheck.ok).toBe(false);
    const waState = issueSignupState(APP_SECRET, { businessId: BIZ_A, userId: OWNER_A });
    expect(readInstagramState(waState).ok).toBe(false);
  });

  it('GET da rota de onboarding devolve plano + URL oficial sem token/segredo', async () => {
    process.env.INSTAGRAM_APP_ID = APP_ID;
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    process.env.INSTAGRAM_VERIFY_TOKEN = 'ig-verify-token-b9';
    const res = await igOnboardingGET(jsonReq(`/api/instagram/onboarding?businessId=${BIZ_A}`, { token: tokenA }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorizeUrl).toContain('https://www.instagram.com/oauth/authorize');
    expect(body.state).toBeTruthy();
    const flat = JSON.stringify(body);
    expect(flat).not.toContain(APP_SECRET);
    expect(flat).not.toContain(TOKEN_A);
  });

  it('GET da rota de onboarding exige permissão da unidade (usuário de fora não lê)', async () => {
    process.env.INSTAGRAM_APP_ID = APP_ID;
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    const res = await igOnboardingGET(jsonReq(`/api/instagram/onboarding?businessId=${BIZ_A}`, { token: tokenB }));
    expect([401, 403]).toContain(res.status);
  });

  it('desconectar apaga a credencial, audita e preserva o histórico', async () => {
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    const before = await readDB();
    before.conversations.push({
      id: 'conv-antiga', businessId: BIZ_A, channel: 'instagram', channelUserId: 'igsid-x', channelAccountId: ACC_A,
      contactId: '', customerId: '', name: 'X', phone: '', status: 'open', mode: 'human', unread: 0,
      lastMessageAt: NOW, lastMessagePreview: 'oi', createdAt: NOW, context: {},
    } as any);
    await writeDB(before);

    const res = await igOnboardingPOST(jsonReq('/api/instagram/onboarding', { method: 'POST', body: { businessId: BIZ_A, action: 'disconnect' }, token: tokenA }));
    expect(res.status).toBe(200);
    const db = await readDB();
    expect(db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration).toBeUndefined();
    expect(db.conversations.find((c) => c.id === 'conv-antiga')).toBeTruthy();
    expect(db.audit.some((a: any) => a.action === 'instagram.disconnected' && a.businessId === BIZ_A)).toBe(true);
  });

  it('callback troca o código, criptografa o token, assina o webhook e não vaza nada na URL', async () => {
    process.env.INSTAGRAM_APP_ID = APP_ID;
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    const state = issueInstagramState({ businessId: BIZ_A, userId: OWNER_A });
    stubGraph();
    const req = jsonReq(`/api/instagram/onboarding/callback?code=code-123&state=${encodeURIComponent(state)}`, {
      token: tokenA,
      headers: { cookie: '' },
    });
    const res = await igCallbackGET(req);
    expect([302, 303]).toContain(res.status);
    const location = res.headers.get('location') || '';
    expect(location).toContain('/canais');
    expect(location).toContain('instagram=ok');
    expect(location).not.toContain('code-123');
    expect(location).not.toContain('token-longo');

    const db = await readDB();
    const ig = db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!;
    expect(ig.encryptedAccessToken).toBeTruthy();
    expect(ig.encryptedAccessToken).not.toContain('token-longo-60-dias');
    expect(decryptSecret(ig.encryptedAccessToken!)).toBe('token-longo-60-dias');
    expect(ig.status).toBe('waiting_first_event');
    expect(ig.webhookSubscribedAt).toBeTruthy();
    expect(ig.username).toBe('ana.souza');
  });

  it('callback com webhook recusado fica em webhook_pending (não finge conexão)', async () => {
    process.env.INSTAGRAM_APP_ID = APP_ID;
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    const state = issueInstagramState({ businessId: BIZ_A, userId: OWNER_A });
    stubGraph({ subscribe: false });
    const res = await igCallbackGET(jsonReq(`/api/instagram/onboarding/callback?code=c&state=${encodeURIComponent(state)}`, { token: tokenA }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('instagram=pending');
    const db = await readDB();
    const ig = db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!;
    expect(ig.status).toBe('webhook_pending');
    expect(ig.lastError).toBeTruthy();
  });

  it('callback com state de OUTRO usuário não grava nada', async () => {
    process.env.INSTAGRAM_APP_ID = APP_ID;
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    const state = issueInstagramState({ businessId: BIZ_A, userId: OWNER_B });
    stubGraph();
    const res = await igCallbackGET(jsonReq(`/api/instagram/onboarding/callback?code=c&state=${encodeURIComponent(state)}`, { token: tokenA }));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('instagram=error');
    const db = await readDB();
    expect(db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!.encryptedAccessToken).not.toContain('token-longo');
  });

  it('cancelar na tela do Instagram volta como "denied" e não escreve nada', async () => {
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    const res = await igCallbackGET(jsonReq('/api/instagram/onboarding/callback?error=access_denied&error_description=User+denied'));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('instagram=denied');
  });

  it('troca do código exige o redirect_uri exato e explica a recusa da Meta', async () => {
    process.env.INSTAGRAM_APP_ID = APP_ID;
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 400, json: async () => ({ error: { message: 'Invalid redirect_uri', code: 191 } }),
    })) as any);
    const res = await exchangeInstagramCode({ code: 'c', redirectUri: 'https://app.instalink.test/api/instagram/onboarding/callback' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Invalid redirect_uri');
  });

  it('o cron do Instagram exige CRON_SECRET (falha fechada)', async () => {
    delete process.env.CRON_SECRET;
    const res = await cronInstagramGET(jsonReq('/api/cron/instagram'));
    expect(res.status).toBe(503);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('B9 · INBOX — canal, badge e compositor por canal', () => {
  it('a API do inbox devolve o canal da conversa e o estado dos canais', async () => {
    const db = await readDB();
    db.conversations.push({
      id: 'conv-lista-ig', businessId: BIZ_A, channel: 'instagram', channelUserId: 'igsid-ana', channelAccountId: ACC_A,
      channelUsername: 'ana.souza', contactId: '', customerId: '', name: 'Ana', phone: '', status: 'open',
      mode: 'human', unread: 2, lastMessageAt: NOW, lastMessagePreview: 'oi', createdAt: NOW, context: {},
    } as any);
    await writeDB(db);
    const res = await conversationsGET(jsonReq(`/api/conversations?businessId=${BIZ_A}`, { token: tokenA }));
    expect(res.status).toBe(200);
    const body = await res.json();
    const conv = body.conversations.find((c: any) => c.id === 'conv-lista-ig');
    expect(conv.channel).toBe('instagram');
    expect(conv.channelLabel).toBe('Instagram');
    expect(body.channels.instagram).toBe(true);
    expect(body.totals.instagram).toBe(1);
  });

  it('responder numa conversa do Instagram usa o canal DA CONVERSA (não o WhatsApp)', async () => {
    await seedInstagramConversation({ conversationId: 'conv-responder' });
    const calls = stubGraph({ sendMessageId: 'mid-resposta' });
    const res = await conversationsPOST(jsonReq('/api/conversations', {
      method: 'POST', token: tokenA,
      body: { businessId: BIZ_A, conversationId: 'conv-responder', body: 'Bom dia!' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.channel).toBe('instagram');
    expect(body.message.channel).toBe('instagram');
    expect(body.message.status).toBe('sent');
    expect(body.message.externalId).toBe('mid-resposta');
    expect(calls.some((u) => u.includes('graph.instagram.com') && u.includes('/messages'))).toBe(true);
  });

  it('fora da janela, o inbox recusa com 409 e motivo (nunca "enviado" falso)', async () => {
    // Conversa sem mensagem de entrada: não existe janela para este contato.
    await seedInstagramConversation({ conversationId: 'conv-janela', withInbound: false, lastInboundAt: '' });
    stubGraph();
    const res = await conversationsPOST(jsonReq('/api/conversations', {
      method: 'POST', token: tokenA,
      body: { businessId: BIZ_A, conversationId: 'conv-janela', body: 'Oi de novo' },
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('outside_window');
    const after = await readDB();
    expect(after.messages).toHaveLength(0);
  });

  it('a tela de Conversas tem filtro por canal, badge e compositor por canal (fonte)', () => {
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    const page = read('src/app/(dashboard)/conversas/page.tsx');
    expect(page).toContain('Todos');
    expect(page).toContain("label: 'WhatsApp'");
    expect(page).toContain("label: 'Instagram'");
    expect(page).toContain('canal');
    expect(page).toContain('Responder no Instagram');
    expect(page).toContain('window.canReply');
    expect(page).toContain("n=\"instagram\"");
    expect(page).not.toContain('localhost');
    expect(page).not.toContain('127.0.0.1');
  });

  it('o painel do Instagram mostra as duas camadas e nunca oferece token/segredo', () => {
    const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    const panel = read('src/components/dashboard/InstagramChannelPanel.tsx');
    expect(panel).toContain('LayerCard');
    expect(panel).toContain('Bloqueio da plataforma');
    expect(panel).toContain('plan.steps');
    expect(panel).toContain('authorizeUrl');
    expect(panel).toContain('instagram=');
    expect(panel).not.toContain('localStorage');
    expect(panel).not.toMatch(/encryptedAccessToken|access_token|appSecret/);

    const canais = read('src/app/(dashboard)/canais/page.tsx');
    expect(canais).toContain('InstagramChannelPanel');
    expect(canais).toContain('WhatsappChannelPanel');
  });
});

// ═══════════════════════════════════════════════════════════════
// B9 FIX — janela POR PARTICIPANTE, tempo do webhook, isolamento de conta,
// limite de texto, credencial e reabertura de conversa fechada.
// ═══════════════════════════════════════════════════════════════
describe('B9 fix · TEMPO DO EVENTO — segundos, milissegundos e valores absurdos', () => {
  it('epoch em SEGUNDOS vira a data correta', () => {
    const t = instagramEventTimestamp(1_758_000_000, Date.now());
    expect(t.reliable).toBe(true);
    expect(t.iso).toBe('2025-09-16T05:20:00.000Z');
  });

  it('epoch em MILISSEGUNDOS dá exatamente a MESMA data (nunca ×1000)', () => {
    const seconds = instagramEventTimestamp(1_758_000_000, Date.now());
    const millis = instagramEventTimestamp(1_758_000_000_000, Date.now());
    expect(millis.reliable).toBe(true);
    expect(millis.iso).toBe(seconds.iso);
  });

  it('timestamp inválido, zero, negativo ou fora da faixa não é confiável', () => {
    for (const value of ['', 'abc', null, undefined, 0, -10, 1, 999]) {
      const t = instagramEventTimestamp(value as any, Date.now());
      expect(t.reliable).toBe(false);
      expect(t.iso).toBe('');
    }
  });

  it('timestamp no futuro absurdo não abre janela futura', () => {
    const t = instagramEventTimestamp(9_999_999_999_999, Date.now());
    expect(t.reliable).toBe(false);
  });

  it('webhook realista de 13 dígitos grava Message.at correto', async () => {
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    stubGraph();
    const res = await igWebhookPOST(signedWebhookReq(instagramPayload({ mid: 'm-ms', text: 'oi', timestamp: 1_758_000_000_000 })));
    expect(res.status).toBe(200);
    const db = await readDB();
    const msg = db.messages.find((m) => m.externalId === 'ig:m-ms')!;
    expect(msg.at).toBe('2025-09-16T05:20:00.000Z');
    const conv = db.conversations.find((c) => c.id === msg.conversationId)!;
    expect(conv.lastInboundAt).toBe('2025-09-16T05:20:00.000Z');
    // E a janela abriu (mensagem recente de verdade, 24 h a partir do horário).
    expect(instagramMessagingWindow({ lastInboundAt: conv.lastInboundAt, nowISO: NOW }).canReply).toBe(false);
    expect(instagramMessagingWindow({ lastInboundAt: conv.lastInboundAt, nowISO: '2025-09-16T23:00:00.000Z' }).canReply).toBe(true);
  });

  it('timestamp absurdo cai no horário de RECEBIMENTO (sem janela inventada)', async () => {
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    stubGraph();
    await igWebhookPOST(signedWebhookReq(instagramPayload({ mid: 'm-absurdo', text: 'oi', timestamp: 9_999_999_999_999 })));
    const db = await readDB();
    const msg = db.messages.find((m) => m.externalId === 'ig:m-absurdo')!;
    expect(Date.parse(msg.at)).toBeLessThanOrEqual(Date.now() + 60_000);
    expect(Date.parse(msg.at)).toBeGreaterThan(Date.now() - 60 * 60 * 1000);
    const conv = db.conversations.find((c) => c.id === msg.conversationId)!;
    expect(conv.lastInboundAt).toBe(msg.at);
  });

  it('webhook atrasado não RETROCEDE a janela da conversa (max)', async () => {
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    stubGraph();
    await igWebhookPOST(signedWebhookReq(instagramPayload({ mid: 'm-novo', text: 'agora', timestamp: 1_758_000_000 })));
    const before = await readDB();
    const conv = before.conversations.find((c) => c.channel === 'instagram')!;
    expect(conv.lastInboundAt).toBe('2025-09-16T05:20:00.000Z');
    // Entrega fora de ordem: mensagem ANTIGA chega depois.
    await igWebhookPOST(signedWebhookReq(instagramPayload({ mid: 'm-antigo', text: 'atrasada', timestamp: 1_757_000_000 })));
    const after = await readDB();
    expect(after.conversations.find((c) => c.id === conv.id)!.lastInboundAt).toBe('2025-09-16T05:20:00.000Z');
  });
});

describe('B9 fix · JANELA POR CONVERSA — a mensagem de A não abre (nem renova) a de B', () => {
  it('A escreveu agora e B há 2 dias: A pode responder, B não', async () => {
    const twoDaysAgo = '2026-09-17T12:00:00.000Z';
    await seedInstagramConversation({ conversationId: 'conv-a', participantId: 'igsid-a' });
    await seedInstagramConversation({ conversationId: 'conv-b', participantId: 'igsid-b', lastInboundAt: twoDaysAgo, inboundAt: twoDaysAgo });
    const db = await readDB();
    const convA = db.conversations.find((c) => c.id === 'conv-a')!;
    const convB = db.conversations.find((c) => c.id === 'conv-b')!;
    expect(instagramConversationWindow(db, convA, NOW).canReply).toBe(true);
    const winB = instagramConversationWindow(db, convB, NOW);
    expect(winB.canReply).toBe(false);
    expect(winB.phase).toBe('human_agent');
  });

  it('mensagem de OUTRO participante não renova a janela desta conversa', async () => {
    const old = '2026-09-17T12:00:00.000Z';
    await seedInstagramConversation({ conversationId: 'conv-b2', participantId: 'igsid-b', lastInboundAt: old, inboundAt: old });
    await seedInstagramConversation({ conversationId: 'conv-a2', participantId: 'igsid-a' });
    stubGraph();
    // A escreve de novo agora.
    await igWebhookPOST(signedWebhookReq(instagramPayload({ mid: 'm-a-nova', senderId: 'igsid-a', text: 'oi' })));
    const db = await readDB();
    const convB = db.conversations.find((c) => c.id === 'conv-b2')!;
    expect(convB.lastInboundAt).toBe(old);
    // Telemetria global da unidade avança (não autoriza envio).
    expect(db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!.lastInboundAt! >= old).toBe(true);
  });

  it('conversa antiga SEM o campo derivado da mensagem mais recente (compatibilidade)', async () => {
    const at = '2026-09-18T09:00:00.000Z';
    const db = await readDB();
    db.conversations.push({
      id: 'conv-legado', businessId: BIZ_A, channel: 'instagram', channelUserId: 'igsid-legado',
      channelAccountId: ACC_A, contactId: '', customerId: '', name: 'Legado', phone: '', status: 'open',
      mode: 'human', unread: 0, lastMessageAt: at, lastMessagePreview: 'oi', createdAt: at, context: {},
    } as any);
    db.messages.push({
      id: 'in-legado', businessId: BIZ_A, conversationId: 'conv-legado', direction: 'in', body: 'oi',
      status: 'delivered', externalId: 'ig:legado', by: 'contact', channel: 'instagram', at,
    } as any);
    await writeDB(db);
    const fresh = await readDB();
    expect(instagramConversationLastInboundAt(fresh, fresh.conversations.find((c) => c.id === 'conv-legado')!)).toBe(at);
  });

  it('retry revalida a janela NO MOMENTO DO ENVIO (retry depois do fechamento não sai)', async () => {
    await seedInstagramConversation({ conversationId: 'conv-retry' });
    const db = await readDB();
    db.messages.push({
      id: 'out-retry', businessId: BIZ_A, conversationId: 'conv-retry', direction: 'out', body: 'Bom dia',
      status: 'pending', externalId: '', by: 'user', at: NOW,
    } as any);
    await writeDB(db);
    // O tempo passa: a última mensagem do contato já está fora da janela.
    const later = await readDB();
    later.conversations.find((c) => c.id === 'conv-retry')!.lastInboundAt = '2026-09-11T12:00:00.000Z';
    await writeDB(later);

    const calls = stubGraph({ sendMessageId: 'mid-nao-devia-sair' });
    const res = await processPendingInstagramRetries({ nowISO: NOW });
    expect(res.messagesSent).toBe(0);
    expect(calls).toHaveLength(0);
    const after = await readDB();
    const msg = after.messages.find((m) => m.id === 'out-retry')!;
    expect(msg.status).toBe('failed');
    expect(msg.error).toMatch(/janela|24 h|7 dias/i);
  });
});

describe('B9 fix · ISOLAMENTO DE CONTA — troca de conta e unicidade', () => {
  it('conversa da conta antiga não é enviada pela conta nova (rota responde 409)', async () => {
    await seedInstagramConversation({ conversationId: 'conv-conta-antiga', accountId: ACC_A });
    const db = await readDB();
    const biz = db.businesses.find((b) => b.id === BIZ_A)!;
    biz.instagramIntegration!.igUserId = ACC_B; // trocou de conta no painel
    biz.instagramIntegration!.encryptedAccessToken = encryptSecret(TOKEN_B);
    await writeDB(db);

    const calls = stubGraph();
    const res = await conversationsPOST(jsonReq('/api/conversations', {
      method: 'POST', token: tokenA,
      body: { businessId: BIZ_A, conversationId: 'conv-conta-antiga', body: 'oi' },
    }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe(INSTAGRAM_ACCOUNT_MISMATCH_CODE);
    expect(body.error).toBe(INSTAGRAM_ACCOUNT_MISMATCH_MESSAGE);
    expect(calls).toHaveLength(0);
    const after = await readDB();
    expect(after.messages.filter((m) => m.direction === 'out')).toHaveLength(0);
  });

  it('a entrega também recusa (channel_account_mismatch) e o histórico continua legível', async () => {
    await seedInstagramConversation({ conversationId: 'conv-mismatch' });
    const db = await readDB();
    const biz = db.businesses.find((b) => b.id === BIZ_A)!;
    biz.instagramIntegration!.igUserId = ACC_B;
    biz.instagramIntegration!.encryptedAccessToken = encryptSecret(TOKEN_B);
    db.messages.push({
      id: 'out-mismatch', businessId: BIZ_A, conversationId: 'conv-mismatch', direction: 'out', body: 'oi',
      status: 'pending', externalId: '', by: 'user', at: NOW,
    } as any);
    await writeDB(db);

    const calls = stubGraph();
    const res = await deliverInstagramMessage(BIZ_A, 'out-mismatch', { nowISO: NOW });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(INSTAGRAM_ACCOUNT_MISMATCH_CODE);
    expect(res.error).toBe(INSTAGRAM_ACCOUNT_MISMATCH_MESSAGE);
    expect(calls).toHaveLength(0);

    // A conversa (e o histórico) continua visível na listagem do inbox.
    const list = await conversationsGET(jsonReq(`/api/conversations?businessId=${BIZ_A}`, { token: tokenA }));
    const body = await list.json();
    expect(body.conversations.some((c: any) => c.id === 'conv-mismatch')).toBe(true);

    // E a tela recebe o aviso explícito.
    const detail = await conversationsGET(jsonReq(`/api/conversations?businessId=${BIZ_A}&id=conv-mismatch`, { token: tokenA }));
    const detailBody = await detail.json();
    expect(detailBody.accountMismatch).toBe(true);
    expect(detailBody.accountMismatchMessage).toContain(INSTAGRAM_ACCOUNT_MISMATCH_MESSAGE);
    expect(instagramAccountMismatch(biz, { channelAccountId: ACC_A })).toBeTruthy();
  });

  it('a MESMA conta não pode pertencer a duas unidades (recusa + auditoria)', async () => {
    const db = await readDB();
    const res = applyInstagramAuthorization(db, {
      businessId: BIZ_B,
      igUserId: ACC_A, // já é da unidade A
      username: 'clinica.b',
      displayName: 'Clínica B',
      encryptedAccessToken: encryptSecret(TOKEN_B),
      now: NOW,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('account_already_linked');
      expect(res.ownerBusinessId).toBe(BIZ_A);
    }
    expect(db.businesses.find((b) => b.id === BIZ_B)!.instagramIntegration!.igUserId).toBe(ACC_B);
    expect(db.audit.some((a: any) => a.action === 'instagram.onboarding_failed'
      && a.meta?.reason === 'account_already_linked' && a.businessId === BIZ_B)).toBe(true);
  });

  it('webhook de conta duplicada é ambíguo: fail-closed, nada gravado em nenhuma unidade', async () => {
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    const db = await readDB();
    // Duas unidades com a MESMA conta (estado inconsistente que precisa ser seguro).
    db.businesses.find((b) => b.id === BIZ_B)!.instagramIntegration = {
      ...integrationFor(ACC_B, TOKEN_B), igUserId: ACC_A,
    } as any;
    await writeDB(db);
    expect(instagramAccountOwners(await readDB(), ACC_A)).toHaveLength(2);
    expect(resolveBusinessForInstagramAccountId(await readDB(), ACC_A)).toBeUndefined();

    stubGraph();
    const res = await igWebhookPOST(signedWebhookReq(instagramPayload({ mid: 'm-ambiguo', text: 'oi' })));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(0);
    expect(body.unmappedAccounts).toContain(ACC_A);
    const after = await readDB();
    expect(after.messages.filter((m) => m.externalId === 'ig:m-ambiguo')).toHaveLength(0);
    expect(after.conversations).toHaveLength(0);
  });

  it('resolver por conta devolve a unidade quando o dono é ÚNICO', async () => {
    const db = await readDB();
    expect(resolveBusinessForInstagramAccountId(db, ACC_A)!.id).toBe(BIZ_A);
    expect(resolveBusinessForInstagramAccountId(db, ACC_B)!.id).toBe(BIZ_B);
    expect(resolveBusinessForInstagramAccountId(db, '17841400000000099')).toBeUndefined();
  });
});

describe('B9 fix · LIMITE DE TEXTO — recusa explícita, nunca truncar', () => {
  it('a rota recusa acima do limite (emoji/multibyte) e NÃO grava nada', async () => {
    await seedInstagramConversation({ conversationId: 'conv-limite-rota' });
    const calls = stubGraph();
    const text = '🙂'.repeat(251); // 1004 bytes
    expect(instagramTextBytes(text)).toBeGreaterThan(INSTAGRAM_TEXT_MAX_BYTES);
    const res = await conversationsPOST(jsonReq('/api/conversations', {
      method: 'POST', token: tokenA,
      body: { businessId: BIZ_A, conversationId: 'conv-limite-rota', body: text },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('message_too_long');
    expect(body.error).toBe(instagramTextLimitError(INSTAGRAM_TEXT_MAX_BYTES));
    expect(calls).toHaveLength(0);
    const after = await readDB();
    expect(after.messages.filter((m) => m.direction === 'out')).toHaveLength(0);
  });

  it('no limite exato, passa — e o corpo salvo é EXATAMENTE o enviado', async () => {
    await seedInstagramConversation({ conversationId: 'conv-limite-ok' });
    const text = '🙂'.repeat(250); // exatamente 1000 bytes
    const calls = stubGraph({ sendMessageId: 'mid-limite' });
    const res = await conversationsPOST(jsonReq('/api/conversations', {
      method: 'POST', token: tokenA,
      body: { businessId: BIZ_A, conversationId: 'conv-limite-ok', body: text },
    }));
    expect(res.status).toBe(200);
    const after = await readDB();
    const msg = after.messages.find((m) => m.direction === 'out')!;
    expect(msg.body).toBe(text);
    expect(calls.some((u) => u.includes('/messages'))).toBe(true);
  });

  it('sendInstagramMessage é fail-closed quando chamado direto (sem cortar)', async () => {
    const calls = stubGraph({ sendMessageId: 'mid-nao-devia' });
    const res = await sendInstagramMessage({
      igUserId: ACC_A, accessToken: TOKEN_A, to: 'igsid-ana', text: 'á'.repeat(600), // 1200 bytes
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/excede o limite/i);
    expect(calls).toHaveLength(0);
  });
});

describe('B9 fix · AMBIENTE — painel e servidor decidem igual (fallbacks)', () => {
  it('META_APP_SECRET + WHATSAPP_VERIFY_TOKEN bastam (mesmo app da Meta)', async () => {
    process.env.INSTAGRAM_APP_ID = APP_ID;
    process.env.META_APP_SECRET = APP_SECRET;
    process.env.WHATSAPP_VERIFY_TOKEN = 'verify-compartilhado';
    delete process.env.INSTAGRAM_APP_SECRET;
    delete process.env.INSTAGRAM_VERIFY_TOKEN;

    const db = await readDB();
    const plan = instagramPlan({ env: process.env, business: db.businesses[0], siteUrl: 'https://app.instalink.test' });
    expect(plan.layers[0].ready).toBe(true);
    expect(plan.layers[0].missing).toEqual([]);
    expect(plan.clientConfig).not.toBeNull();
    expect(instagramMissingPlatformConfig()).toEqual([]);
    expect(instagramAppSecret()).toBe(APP_SECRET);
    expect(instagramVerifyToken()).toBe('verify-compartilhado');
  });

  it('sem os fallbacks, painel e servidor apontam exatamente os mesmos nomes', async () => {
    for (const key of ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_VERIFY_TOKEN', 'WHATSAPP_VERIFY_TOKEN', 'META_APP_SECRET', 'WHATSAPP_CREDENTIALS_KEY']) {
      delete process.env[key];
    }
    const db = await readDB();
    const plan = instagramPlan({ env: {}, business: db.businesses[0], siteUrl: 'https://app.instalink.test' });
    expect(plan.layers[0].missing).toEqual(instagramMissingPlatformConfig());
    expect(plan.layers[0].missing).toEqual([
      'INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_VERIFY_TOKEN', 'WHATSAPP_CREDENTIALS_KEY',
    ]);
  });
});

describe('B9 fix · CREDENCIAL — renovação preventiva e isolada por unidade', () => {
  it('só renova quem está dentro da margem e mantém o token criptografado', async () => {
    const db = await readDB();
    db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!.tokenExpiresAt = '2026-09-24T12:00:00.000Z'; // 5 dias
    db.businesses.find((b) => b.id === BIZ_B)!.instagramIntegration!.tokenExpiresAt = '2026-10-30T12:00:00.000Z'; // 41 dias
    await writeDB(db);
    const fresh = await readDB();
    expect(instagramTokenNeedsRefresh(fresh.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration, NOW)).toBe(true);
    expect(instagramTokenNeedsRefresh(fresh.businesses.find((b) => b.id === BIZ_B)!.instagramIntegration, NOW)).toBe(false);
    expect(INSTAGRAM_TOKEN_REFRESH_MARGIN_MS).toBe(7 * 24 * 60 * 60 * 1000);

    const calls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return { ok: true, status: 200, json: async () => ({ access_token: 'token-renovado-A', expires_in: 5_184_000 }) } as any;
    }) as any;

    const summary = await refreshInstagramTokens({ nowISO: NOW, fetchFn });
    expect(summary.businessesChecked).toBe(1);
    expect(summary.refreshed).toBe(1);
    expect(summary.failed).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('refresh_access_token');

    const after = await readDB();
    const igA = after.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!;
    const igB = after.businesses.find((b) => b.id === BIZ_B)!.instagramIntegration!;
    expect(igA.encryptedAccessToken).not.toContain('token-renovado-A');
    expect(decryptSecret(igA.encryptedAccessToken!)).toBe('token-renovado-A');
    expect(igA.tokenIssuedAt).toBe(NOW);
    expect(igA.tokenExpiresAt).toBe(nowPlusDays(60));
    expect(decryptSecret(igB.encryptedAccessToken!)).toBe(TOKEN_B); // outra unidade intacta
    expect(after.audit.some((a: any) => a.action === 'instagram.token_refreshed' && a.businessId === BIZ_A)).toBe(true);
    expect(after.audit.some((a: any) => a.action === 'instagram.token_refreshed' && a.businessId === BIZ_B)).toBe(false);
  });

  it('falha na renovação NÃO apaga o token atual (só registra o motivo)', async () => {
    const db = await readDB();
    const before = db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!.encryptedAccessToken;
    db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!.tokenExpiresAt = '2026-09-21T12:00:00.000Z';
    await writeDB(db);
    const fetchFn = (async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'Session expired' } }) })) as any;
    const summary = await refreshInstagramTokens({ nowISO: NOW, fetchFn });
    expect(summary.failed).toBe(1);
    const after = await readDB();
    const igA = after.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!;
    expect(igA.encryptedAccessToken).toBe(before);
    expect(igA.lastError).toMatch(/Session expired|Renovação/i);
    expect(after.audit.some((a: any) => a.action === 'instagram.token_refresh_failed' && a.businessId === BIZ_A)).toBe(true);
  });

  it('não sobrescreve credencial trocada no meio (CAS) — e a métrica não mente', async () => {
    const db = await readDB();
    db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!.tokenExpiresAt = '2026-09-21T12:00:00.000Z';
    await writeDB(db);
    const fetchFn = (async () => {
      // Alguém reconectou a conta enquanto a Meta respondia.
      await updateDB((d) => {
        d.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!.encryptedAccessToken = encryptSecret('token-novo-da-reconexao');
      });
      return { ok: true, status: 200, json: async () => ({ access_token: 'token-renovado', expires_in: 5_184_000 }) } as any;
    }) as any;
    const summary = await refreshInstagramTokens({ nowISO: NOW, fetchFn });
    // A Meta devolveu token novo, mas o CAS NÃO aplicou: nada de "renovado".
    expect(summary.refreshed).toBe(0);
    expect(summary.superseded).toBe(1);
    expect(summary.failed).toBe(0);
    const after = await readDB();
    expect(decryptSecret(after.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!.encryptedAccessToken!))
      .toBe('token-novo-da-reconexao');
    // Sem renovação aplicada, não existe auditoria de sucesso para esta unidade.
    expect(after.audit.some((a: any) => a.action === 'instagram.token_refreshed')).toBe(false);
  });

  it('o resumo do cron distingue renovado, falho, pulado e superseded', async () => {
    const db = await readDB();
    db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!.tokenExpiresAt = '2026-09-21T12:00:00.000Z';
    db.businesses.find((b) => b.id === BIZ_B)!.instagramIntegration!.tokenExpiresAt = '2026-09-23T12:00:00.000Z';
    // Terceira unidade: credencial ilegível (cofre não decifra) ⇒ `skipped`.
    db.businesses.push({
      ...db.businesses.find((b) => b.id === BIZ_B)!,
      id: 'biz-ig-c',
      instagramIntegration: {
        ...db.businesses.find((b) => b.id === BIZ_B)!.instagramIntegration!,
        igUserId: '17841400000000003',
        encryptedAccessToken: 'nao-e-um-cifra-valido',
      } as any,
    } as any);
    await writeDB(db);

    const calls: string[] = [];
    const fetchFn = (async (url: string | URL | Request) => {
      const u = new URL(String(url));
      calls.push(u.toString());
      const token = u.searchParams.get('access_token') || '';
      if (token === TOKEN_B) {
        return { ok: false, status: 400, json: async () => ({ error: { message: 'token expirado' } }) } as any;
      }
      return { ok: true, status: 200, json: async () => ({ access_token: 'renovado-A', expires_in: 5_184_000 }) } as any;
    }) as any;

    const summary = await refreshInstagramTokens({ nowISO: NOW, fetchFn });
    expect(summary).toMatchObject({ businessesChecked: 3, refreshed: 1, failed: 1, skipped: 1, superseded: 0 });
    // O resumo é sempre fechado: nada "sumiu" nem foi contado duas vezes.
    expect(summary.refreshed + summary.failed + summary.skipped + summary.superseded).toBe(summary.businessesChecked);

    const after = await readDB();
    expect(decryptSecret(after.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!.encryptedAccessToken!))
      .toBe('renovado-A');
    const igB = after.businesses.find((b) => b.id === BIZ_B)!.instagramIntegration!;
    expect(decryptSecret(igB.encryptedAccessToken!)).toBe(TOKEN_B); // falha não apaga
    expect(igB.lastError).toMatch(/token expirado|Renovação/i);
    expect(after.businesses.find((b) => b.id === 'biz-ig-c')!.instagramIntegration!.encryptedAccessToken)
      .toBe('nao-e-um-cifra-valido'); // intocada
    expect(calls).toHaveLength(2); // só as duas unidades com credencial utilizável
  });
});

describe('B9 fix · CONVERSA FECHADA — nova mensagem real reabre', () => {
  it('closed → inbound → open, com o MESMO id, unread incrementado e histórico preservado', async () => {
    process.env.INSTAGRAM_APP_SECRET = APP_SECRET;
    await seedInstagramConversation({ conversationId: 'conv-fechada', status: 'closed', unread: 0 });
    stubGraph();
    const res = await igWebhookPOST(signedWebhookReq(instagramPayload({ mid: 'm-reabre', text: 'voltei' })));
    expect(res.status).toBe(200);
    const db = await readDB();
    const conv = db.conversations.find((c) => c.id === 'conv-fechada')!;
    expect(conv.status).toBe('open');
    expect(conv.unread).toBe(1);
    expect(db.conversations.filter((c) => c.channel === 'instagram')).toHaveLength(1);
    expect(db.messages.filter((m) => m.conversationId === 'conv-fechada')).toHaveLength(2);
    expect(db.messages.some((m) => m.externalId === 'ig:m-reabre')).toBe(true);
  });
});

describe('B9 fix · CONTA TROCADA — o motivo estável aparece em TODOS os caminhos', () => {
  it('conector explica o desencontro de conta (não "nunca escreveu")', async () => {
    await seedInstagramConversation({ conversationId: 'conv-conta-velha', accountId: ACC_A });
    const db = await readDB();
    const biz = db.businesses.find((b) => b.id === BIZ_A)!;
    biz.instagramIntegration!.igUserId = ACC_B; // conta trocada no painel
    biz.instagramIntegration!.encryptedAccessToken = encryptSecret(TOKEN_B);
    await writeDB(db);
    const calls = stubGraph();
    const res = await channelConnectorFor('instagram')!.send(
      { businessId: BIZ_A, nowISO: NOW },
      { businessId: BIZ_A, integrationId: 'ig', provider: 'instagram', to: 'igsid-ana', body: 'oi' },
    );
    expect(res.ok).toBe(false);
    expect(res.detail).toContain(INSTAGRAM_ACCOUNT_MISMATCH_MESSAGE);
    expect(calls).toHaveLength(0);
  });

  it('automação explica o desencontro de conta quando o vínculo é de outra conta', async () => {
    await seedInstagramConversation({ conversationId: 'conv-auto-antiga', accountId: ACC_A });
    const db = await readDB();
    const contact = ensureInstagramContact(db, {
      businessId: BIZ_A, accountId: ACC_A, participantId: 'igsid-ana', username: 'ana', displayName: 'Ana', now: NOW,
    });
    const biz = db.businesses.find((b) => b.id === BIZ_A)!;
    biz.instagramIntegration!.igUserId = ACC_B;
    biz.instagramIntegration!.encryptedAccessToken = encryptSecret(TOKEN_B);
    await writeDB(db);
    const fresh = await readDB();
    const input = {
      db: fresh,
      business: fresh.businesses.find((b) => b.id === BIZ_A)!,
      automation: { id: 'auto-1', businessId: BIZ_A } as any,
      run: { id: 'run-1', businessId: BIZ_A, context: { customer: { id: contact.id } } } as any,
      nodeId: 'node-1',
      now: NOW,
      params: { __type: 'send_channel_message', channel: 'instagram', message: 'Olá!' },
    };
    const res = executeAction(input as any);
    expect(res.ok).toBe(false);
    expect(res.error).toBe(INSTAGRAM_ACCOUNT_MISMATCH_MESSAGE);
    expect(fresh.messages.filter((m) => m.direction === 'out')).toHaveLength(0);
  });
});
