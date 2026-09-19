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
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { decryptSecret, encryptSecret } from '../whatsapp-cloud-api';
import { issueSignupState, verifySignupState } from '../whatsapp-onboarding-server';
import { PROVIDERS } from '../integrations/catalog';
import { channelConnectorAvailable, channelConnectorFor } from '../integrations/connectors';
import { AUTOMATION_ACTION_DEFS, automationActionDef } from '../automation/model';
import { executeAction } from '../automation/actions';
import {
  clipInstagramText, instagramAuthorizeUrl, instagramConversationKey, instagramDedupeKey,
  instagramInboundBody, instagramMessagingWindow, instagramPlan, parseInstagramWebhook,
} from '../instagram';
import {
  deliverInstagramMessage, ensureInstagramContact, exchangeInstagramCode, fetchInstagramProfile,
  getInstagramCredentials, ingestInstagramNotification, issueInstagramState, readInstagramState,
  sendInstagramMessage, subscribeInstagramAccount, verifyInstagramState,
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
  timestamp?: number;
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
        timestamp: input.timestamp || 1_758_000_000,
        message,
      }],
    }],
  };
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

  it('o corte de texto respeita os 1000 bytes sem quebrar caractere', () => {
    const text = 'á'.repeat(600); // 2 bytes por caractere em UTF-8
    const clipped = clipInstagramText(text);
    expect(Buffer.byteLength(clipped, 'utf8')).toBeLessThanOrEqual(1000);
    expect(clipped.endsWith('á')).toBe(true);
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

  it('conector recusa fora da janela de 24h com motivo (política da Meta)', async () => {
    const past = '2026-09-14T12:00:00.000Z'; // 5 dias atrás: fora das 24 h e dentro do HUMAN_AGENT
    await writeDB({
      ...(await readDB()),
      businesses: (await readDB()).businesses.map((b) => b.id === BIZ_A
        ? { ...b, instagramIntegration: { ...b.instagramIntegration!, lastInboundAt: past } }
        : b),
    } as DB);
    stubGraph();
    const res = await channelConnectorFor('instagram')!.send(
      { businessId: BIZ_A, nowISO: NOW },
      { businessId: BIZ_A, integrationId: 'ig', provider: 'instagram', to: 'igsid-ana', body: 'oi' },
    );
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/24 h|HUMAN_AGENT|janela/i);

    const window = instagramMessagingWindow({ lastInboundAt: past, nowISO: NOW });
    expect(window.phase).toBe('human_agent');
    expect(window.canReply).toBe(false);
  });

  it('conector envia quando a janela está aberta e devolve o id oficial', async () => {
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
      mode: 'human' as const, unread: 0, lastMessageAt: now, lastMessagePreview: 'oi', createdAt: now, context: {},
    };
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

  it('sem vínculo do contato ⇒ erro explícito de identidade', async () => {
    const db = await readDB();
    const input = actionInput(
      { __type: 'send_channel_message', channel: 'instagram' },
      { customer: { id: 'contato-sem-vinculo' } },
    );
    input.db = db;
    input.business = db.businesses.find((b) => b.id === BIZ_A)!;
    const res = executeAction(input as any);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/vínculo do contato no Instagram/i);
  });

  it('conectado + janela aberta ⇒ mensagem pendente na conversa do Instagram', async () => {
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
    const conv = fresh.conversations.find((c) => c.channel === 'instagram')!;
    expect(conv.channelUserId).toBe('igsid-automacao');
    expect(conv.channelAccountId).toBe(ACC_A);
    const msg = fresh.messages.find((m) => m.conversationId === conv.id)!;
    expect(msg.channel).toBe('instagram');
    expect(msg.status).toBe('pending');
    expect(msg.body).toBe('Olá!');
    expect(contact.id).toBe(conv.contactId);
  });

  it('fora da janela ⇒ erro explícito de política (nada enfileirado)', async () => {
    const db = await readDB();
    ensureInstagramContact(db, {
      businessId: BIZ_A, accountId: ACC_A, participantId: 'igsid-velho', username: 'velho', displayName: 'Cliente Velho', now: NOW,
    });
    db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!.lastInboundAt = '2026-08-01T00:00:00.000Z';
    const input = actionInput({ __type: 'send_channel_message', channel: 'instagram' });
    input.db = db;
    input.business = db.businesses.find((b) => b.id === BIZ_A)!;
    const res = executeAction(input as any);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Instagram/i);
    expect(db.messages).toHaveLength(0);
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
    const db = await readDB();
    db.conversations.push({
      id: 'conv-responder', businessId: BIZ_A, channel: 'instagram', channelUserId: 'igsid-ana', channelAccountId: ACC_A,
      contactId: '', customerId: '', name: 'Ana', phone: '', status: 'open', mode: 'human', unread: 0,
      lastMessageAt: NOW, lastMessagePreview: 'oi', createdAt: NOW, context: {},
    } as any);
    await writeDB(db);
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
    const db = await readDB();
    db.businesses.find((b) => b.id === BIZ_A)!.instagramIntegration!.lastInboundAt = '2026-08-01T00:00:00.000Z';
    db.conversations.push({
      id: 'conv-janela', businessId: BIZ_A, channel: 'instagram', channelUserId: 'igsid-ana', channelAccountId: ACC_A,
      contactId: '', customerId: '', name: 'Ana', phone: '', status: 'open', mode: 'human', unread: 0,
      lastMessageAt: NOW, lastMessagePreview: 'oi', createdAt: NOW, context: {},
    } as any);
    await writeDB(db);
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
