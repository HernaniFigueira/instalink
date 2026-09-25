import './helpers/temp-db';

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { encryptSecret } from '../whatsapp-cloud-api';
import { POST as whatsappPOST } from '@/app/api/whatsapp/route';
import type { Business, DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const BIZ = 'biz-andrioni-diag';
const ADMIN = 'admin-andrioni-diag';
const VIEWER = 'viewer-andrioni-diag';
const ORG = 'org-andrioni-diag';
const TOKEN = 'unit-token-only-in-test';
const APP_SECRET = 'app-secret-only-in-test';
const CREDENTIALS_KEY = 'diagnostic-key-with-32-characters';
const APP_ID = '1631409148434073';
const WABA_ID = '1802366907680005';
const PHONE_ID = '1311304095400435';
const NOW = '2026-09-24T12:00:00.000Z';

function business(): Business {
  return {
    id: BIZ, ownerId: 'owner-not-admin', organizationId: ORG, name: 'Andrioni', slug: 'andrioni',
    description: '', logo: '', cover: '', niche: 'saude', modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: true, about: false, agent: false },
    phone: '', whatsapp: '', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0, googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 30, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: NOW, updatedAt: NOW, businessTimezone: 'America/Sao_Paulo',
    whatsappIntegration: {
      status: 'connected', displayPhone: '+55 21 90000-0000', phoneNumberId: PHONE_ID, wabaId: WABA_ID,
      connectedAt: NOW, lastWebhookAt: NOW, requestedAt: NOW, encryptedAccessToken: encryptSecret(TOKEN),
      webhookSubscribedAt: NOW, registeredAt: NOW, registrationRequired: false,
    },
  } as Business;
}

function req(body: unknown, token: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/whatsapp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

const json = (res: Response) => res.json() as Promise<any>;
let adminSession = '';
let viewerSession = '';
let envBackup: Record<string, string | undefined> = {};

beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  envBackup = { ...process.env };
  process.env.META_APP_ID = APP_ID;
  process.env.META_APP_SECRET = APP_SECRET;
  process.env.WHATSAPP_CREDENTIALS_KEY = CREDENTIALS_KEY;

  const db: DB = emptyDB();
  db.users.push(
    { id: ADMIN, name: 'Admin', email: 'admin-diag@example.test', passwordHash: 'x', createdAt: NOW, role: 'owner' } as any,
    { id: VIEWER, name: 'Viewer', email: 'viewer-diag@example.test', passwordHash: 'x', createdAt: NOW, role: 'owner' } as any,
  );
  db.organizations.push({ id: ORG, name: 'Organização Andrioni', ownerId: 'owner-not-admin', metadata: {}, createdAt: NOW, updatedAt: NOW } as any);
  db.businesses.push(business());
  db.organizationMembers.push(
    { id: 'membership-admin', organizationId: ORG, userId: ADMIN, role: 'ADMIN', active: true, createdAt: NOW, updatedAt: NOW } as any,
    { id: 'membership-viewer', organizationId: ORG, userId: VIEWER, role: 'VIEWER', active: true, createdAt: NOW, updatedAt: NOW } as any,
  );
  await writeDB(db);
  adminSession = await createSession(ADMIN);
  viewerSession = await createSession(VIEWER);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const key of ['META_APP_ID', 'META_APP_SECRET', 'WHATSAPP_CREDENTIALS_KEY']) {
    if (envBackup[key] === undefined) delete process.env[key];
    else process.env[key] = envBackup[key];
  }
});

describe('diagnóstico temporário da assinatura WABA', () => {
  it('é exclusivo de Master/Admin e não expõe credencial', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await whatsappPOST(req({ businessId: BIZ, action: 'verify_waba_subscription' }, viewerSession));
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consulta subscribed_apps e, se inscrita, consulta apenas os campos seguros do número', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).not.toContain(TOKEN);
      expect(url).not.toContain(APP_SECRET);
      expect(url).toContain('appsecret_proof=');
      expect((init?.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
      if (url.includes('/subscribed_apps')) {
        return new Response(JSON.stringify({ data: [{ id: APP_ID, name: 'App público' }] }), { status: 200 });
      }
      expect(url).toContain(`/${PHONE_ID}?fields=status,account_mode,platform_type,webhook_configuration`);
      return new Response(JSON.stringify({
        id: PHONE_ID, status: 'CONNECTED', account_mode: 'LIVE', platform_type: 'CLOUD_API',
        webhook_configuration: { application: 'https://preview.example/api/whatsapp/webhook' },
        access_token: 'não deve voltar',
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const before = (await readDB()).businesses[0].whatsappIntegration?.encryptedAccessToken;
    const body = await json(await whatsappPOST(req({ businessId: BIZ, action: 'verify_waba_subscription' }, adminSession)));
    expect(body.ok).toBe(true);
    expect(body.subscription).toMatchObject({ wabaSubscribed: true, appIdFound: true, httpStatus: 200, error: '' });
    expect(body.phone).toEqual({
      httpStatus: 200, status: 'CONNECTED', accountMode: 'LIVE', platformType: 'CLOUD_API',
      webhookApplication: 'https://preview.example/api/whatsapp/webhook', error: '',
    });
    expect(JSON.stringify(body)).not.toContain(TOKEN);
    expect(JSON.stringify(body)).not.toContain(APP_SECRET);
    expect((await readDB()).businesses[0].whatsappIntegration?.encryptedAccessToken).toBe(before);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reassina somente com ação explícita e faz GET final', async () => {
    let subscribed = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/subscribed_apps') && init?.method === 'POST') {
        subscribed = true;
        expect(String(init.body)).toContain('appsecret_proof');
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (url.includes('/subscribed_apps')) {
        return new Response(JSON.stringify({ data: subscribed ? [{ id: APP_ID }] : [] }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'CONNECTED' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const body = await json(await whatsappPOST(req({ businessId: BIZ, action: 'resubscribe_waba' }, adminSession)));
    expect(body.ok).toBe(true);
    expect(body.reassigned).toBe(true);
    expect(body.postHttpStatus).toBe(200);
    expect(body.subscription).toMatchObject({ wabaSubscribed: true, appIdFound: true, httpStatus: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.method).toBe('GET');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit | undefined)?.method).toBe('POST');
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit | undefined)?.method).toBe('GET');
  });

  it('não faz POST quando o GET inicial já confirma o App ID', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/subscribed_apps')) {
        expect(init?.method).toBe('GET');
        return new Response(JSON.stringify({ data: [{ id: APP_ID }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'CONNECTED' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const body = await json(await whatsappPOST(req({ businessId: BIZ, action: 'resubscribe_waba' }, adminSession)));
    expect(body.ok).toBe(true);
    expect(body.reassigned).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('sanitiza erro da Graph e nunca devolve mensagem bruta ou credenciais', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: `token=${TOKEN} app_secret=${APP_SECRET}`, code: 10 },
    }), { status: 403 })));
    const body = await json(await whatsappPOST(req({ businessId: BIZ, action: 'verify_waba_subscription' }, adminSession)));
    expect(body.ok).toBe(false);
    expect(body.subscription).toMatchObject({ httpStatus: 403, appIdFound: false });
    expect(body.error).toContain('credencial ou a permissão');
    expect(body.error).not.toContain(TOKEN);
    expect(body.error).not.toContain(APP_SECRET);
  });
});
