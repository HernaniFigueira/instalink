// ═══════════════════════════════════════════════════════════════════════════
// DIAGNÓSTICO DO INBOUND REAL (Preview) — reproduz o evento Meta de
// 24/09/2026 20:15:06 com os IDs públicos confirmados:
//   WABA_ID         = 1802366907680005
//   PHONE_NUMBER_ID = 1311304095400435
// Prova, sem rede, o que acontece em CADA saída do webhook:
//   200 persistido | 403 assinatura | 503 secret ausente |
//   tenant_missing (descarte antes só existia em silêncio) |
//   parsed_empty (CHEGADA agora marcada no painel = "último webhook").
// ═══════════════════════════════════════════════════════════════════════════
import './helpers/temp-db';

import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { resolveTenantForChange } from '../whatsapp-cloud-api';
import type { Business } from '../types';

import { GET as webhookGET, POST as webhookPOST } from '@/app/api/whatsapp/webhook/route';

// Mesmos valores das outras suítes (nenhum segredo real) — evita conflito se o
// worker de testes compartilar process.env entre arquivos.
const TEST_APP_SECRET = 'meta_app_secret_test_1234567890';
const TEST_VERIFY_TOKEN = 'test_verify_token_xyz_987';
const TEST_CRED_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

process.env.WHATSAPP_APP_SECRET = TEST_APP_SECRET;
process.env.WHATSAPP_VERIFY_TOKEN = TEST_VERIFY_TOKEN;
process.env.WHATSAPP_CREDENTIALS_KEY = TEST_CRED_KEY;

/** IDs reais públicos do Preview (não são segredos; constam do pedido). */
const WABA_ID = '1802366907680005';
const PHONE_NUMBER_ID = '1311304095400435';
const BIZ = 'biz-andrioni';
const OWNER = 'owner-andrioni';

function signPayload(rawBody: string, secret = TEST_APP_SECRET): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

function postWebhook(rawBody: string, signature?: string): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== undefined) headers['x-hub-signature-256'] = signature;
  return new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

/** Payload REAL no formato documentado pela Meta (webhooks/overview). */
function realMessagePayload(overrides?: { phoneNumberId?: string; wabaId?: string; messageId?: string }) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: overrides?.wabaId ?? WABA_ID,
        time: 1790291706,
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '5521999990000',
                phone_number_id: overrides?.phoneNumberId ?? PHONE_NUMBER_ID,
              },
              contacts: [
                { profile: { name: 'Paciente Andrioni' }, wa_id: '5521988887777' },
              ],
              messages: [
                {
                  from: '5521988887777',
                  id: overrides?.messageId ?? 'wamid.HBgLNTUyMTk4ODg4Nzc3NwECAQYBFIAb5Qm1',
                  timestamp: '1790291700',
                  type: 'text',
                  text: { body: 'Ola, tudo bem? Quero informacoes sobre horarios.' },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function createAndrioni(): Business {
  return {
    id: BIZ,
    ownerId: OWNER,
    name: 'Andrioni',
    slug: BIZ,
    title: 'Andrioni',
    subtitle: 'Clínica',
    description: '',
    phone: '+55 21 99999-0000',
    email: 'andrioni@teste.local',
    category: 'Saúde',
    address: 'Rua A 100',
    modes: ['agendamento'] as any,
    features: { whatsapp: true } as any,
    published: true,
    theme: {
      template: 'minimal',
      primaryColor: '#0ea5e9',
      backgroundColor: '#ffffff',
      surfaceColor: '#f8fafc',
      textColor: '#0f172a',
      mutedTextColor: '#64748b',
      accentColor: '#38bdf8',
      fontFamily: 'sans',
      borderRadius: '8px',
      buttonStyle: 'rounded',
      whatsappButton: 'wa.me',
    },
    hours: {
      monday: { start: '08:00', end: '18:00' },
      tuesday: { start: '08:00', end: '18:00' },
      wednesday: { start: '08:00', end: '18:00' },
      thursday: { start: '08:00', end: '18:00' },
      friday: { start: '08:00', end: '18:00' },
      saturday: { start: '08:00', end: '12:00' },
      sunday: { start: '09:00', end: '13:00' },
    } as any,
    daysInAdvance: 30,
    bookingInterval: 40,
    slotInterval: 40,
    whatsapp: '+55 21 99999-0000',
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    whatsappIntegration: {
      status: 'connected',
      phoneNumberId: PHONE_NUMBER_ID,
      wabaId: WABA_ID,
      displayPhone: '+55 21 99999-0000',
      verifiedName: 'Andrioni',
      connectedAt: '2026-09-24T19:50:00Z',
      lastWebhookAt: '',
      requestedAt: '',
      webhookSubscribedAt: '2026-09-24T19:55:00Z',
      registeredAt: '2026-09-24T20:00:00Z',
      registrationRequired: false,
      onboardingType: 'standard',
    } as any,
  } as any;
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  const db = emptyDB();
  db.businesses.push(createAndrioni());
  await writeDB(db);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  logSpy.mockRestore();
});

describe('Inbound Preview — reprodução do evento Meta 24/09/2026 20:15:06', () => {
  it('resolveTenantForChange encontra EXATAMENTE a Andrioni pelos IDs reais', async () => {
    const db = await readDB();
    const found = resolveTenantForChange(db, PHONE_NUMBER_ID, WABA_ID);
    expect(found?.id).toBe(BIZ);
    // phone_number_id tem precedência: outro número + WABA certa = rejeita
    // (guarda de ambiguidade — não há fallback silencioso para wabaId).
    expect(resolveTenantForChange(db, '999999999999999', WABA_ID)).toBeNull();
  });

  it('payload real assinado → 200, mensagem persistida e marcadores de painel atualizados', async () => {
    const rawBody = JSON.stringify(realMessagePayload());
    const res = await webhookPOST(postWebhook(rawBody, signPayload(rawBody)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, received: 1, mapped: true });

    const db = await readDB();
    const wi = db.businesses.find((b) => b.id === BIZ)!.whatsappIntegration!;
    expect(wi.wabaId).toBe(WABA_ID);                  // item 7 — armazenado
    expect(wi.phoneNumberId).toBe(PHONE_NUMBER_ID);   // item 7 — armazenado
    expect(wi.lastWebhookAt).toBeTruthy();            // painel: "último webhook"
    expect(wi.lastInboundAt).toBeTruthy();            // painel: "último inbound"

    const conv = db.conversations.find((c) => c.businessId === BIZ && c.channel === 'whatsapp');
    expect(conv).toBeTruthy();
    const msg = db.messages.find((m) => m.businessId === BIZ && m.direction === 'in');
    expect(msg?.body).toContain('horarios');
    expect(msg?.externalId).toContain('wamid.');
    expect(db.audit.some((a) => a.action === 'whatsapp.webhook_received' && a.businessId === BIZ)).toBe(true);

    expect(logSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes(`persisted business=${BIZ}`))).toBe(true);
  });

  it('assinatura inválida → 403 + marcador [WA-WEBHOOK] reason=signature_invalid', async () => {
    const rawBody = JSON.stringify(realMessagePayload());
    const res = await webhookPOST(postWebhook(rawBody, 'sha256=' + '0'.repeat(64)));
    expect(res.status).toBe(403);
    expect(
      warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes('[WA-WEBHOOK] POST status=403 reason=signature_invalid')),
    ).toBe(true);

    const db = await readDB();
    expect(db.businesses.find((b) => b.id === BIZ)!.whatsappIntegration!.lastWebhookAt).toBe('');
  });

  it('App Secret ausente → 503 fail-closed + marcador reason=app_secret_env_missing', async () => {
    const prevA = process.env.WHATSAPP_APP_SECRET;
    const prevB = process.env.META_APP_SECRET;
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.META_APP_SECRET;
    try {
      const rawBody = JSON.stringify(realMessagePayload());
      const res = await webhookPOST(postWebhook(rawBody, signPayload(rawBody)));
      expect(res.status).toBe(503);
      expect(
        warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes('reason=app_secret_env_missing')),
      ).toBe(true);
    } finally {
      if (prevA !== undefined) process.env.WHATSAPP_APP_SECRET = prevA;
      if (prevB !== undefined) process.env.META_APP_SECRET = prevB;
    }
  });

  it('tenant não encontrado → 200 mapped:false COM log tenant_missing (não silencioso)', async () => {
    const rawBody = JSON.stringify(realMessagePayload({ phoneNumberId: '999999999999999' }));
    const res = await webhookPOST(postWebhook(rawBody, signPayload(rawBody)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, received: 0, mapped: false });

    expect(
      warnSpy.mock.calls.some(
        (c: unknown[]) => String(c[0]).includes('reason=tenant_missing') && String(c[0]).includes('999999999999999'),
      ),
    ).toBe(true);

    const db = await readDB();
    // Nada persistiu para ninguém e a Andrioni NÃO foi marcada
    // (o evento não era dela).
    expect(db.conversations.length).toBe(0);
    expect(db.businesses.find((b) => b.id === BIZ)!.whatsappIntegration!.lastWebhookAt).toBe('');
  });

  it('assinatura válida sem eventos utilizáveis → 200 parsed_empty + CHEGADA marcada no painel', async () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: WABA_ID,
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '5521999990000', phone_number_id: PHONE_NUMBER_ID },
              },
            },
          ],
        },
      ],
    };
    const rawBody = JSON.stringify(payload);
    const res = await webhookPOST(postWebhook(rawBody, signPayload(rawBody)));
    expect(res.status).toBe(200);
    expect((await res.json()).received).toBe(0);

    expect(warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes('reason=parsed_empty'))).toBe(true);
    expect(
      warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes(`arrival_marked business=${BIZ}`)),
    ).toBe(true);

    const db = await readDB();
    const wi = db.businesses.find((b) => b.id === BIZ)!.whatsappIntegration!;
    expect(wi.lastWebhookAt).toBeTruthy(); // prova no painel de que a Meta CHEGOU
    expect(
      db.audit.some(
        (a) => a.action === 'whatsapp.webhook_received' && (a.meta as any)?.stage === 'parsed_empty',
      ),
    ).toBe(true);
  });

  it('GET handshake: 200 com token correto e 403 com errado (com marcadores)', async () => {
    const ok = await webhookGET(
      new NextRequest(
        `http://localhost:3000/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=challengexyz&hub.verify_token=${TEST_VERIFY_TOKEN}`,
      ),
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('challengexyz');

    const bad = await webhookGET(
      new NextRequest(
        'http://localhost:3000/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=challengexyz&hub.verify_token=wrong',
      ),
    );
    expect(bad.status).toBe(403);
    expect(
      warnSpy.mock.calls.some((c: unknown[]) => String(c[0]).includes('[WA-WEBHOOK] GET verify status=403')),
    ).toBe(true);
  });
});
