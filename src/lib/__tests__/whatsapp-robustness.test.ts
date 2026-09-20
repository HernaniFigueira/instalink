// ═══════════════════════════════════════════════════════════════════════════════
// TESTES DE ROBUSTEZ: ONBOARDING, WEBHOOK, COEXISTENCE E ESTADOS META
// ═══════════════════════════════════════════════════════════════════════════════
import './helpers/temp-db';

import fs from 'node:fs';
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, updateDB, writeDB } from '../db';
import { createSession } from '../auth';
import { GET as onboardingGET, POST as onboardingPOST } from '@/app/api/whatsapp/onboarding/route';
import { GET as whatsappGET, POST as whatsappPOST } from '@/app/api/whatsapp/route';
import { GET as webhookGET, POST as webhookPOST } from '@/app/api/whatsapp/webhook/route';
import { POST as masterWhatsappPOST } from '@/app/api/master/units/[id]/whatsapp/route';
import { issueSignupState } from '../whatsapp-onboarding-server';
import { computeConnectionStatus, onboardingSteps } from '../whatsapp-onboarding';
import { integrationStatus } from '../whatsapp';
import { encryptSecret, resolveTenantForChange } from '../whatsapp-cloud-api';
import { createBookingTx } from '../booking-create';
import { GET as masterWhatsappGET } from '@/app/api/master/units/[id]/whatsapp/route';
import type { Business, DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-20T12:00:00.000Z';
const BIZ_A = 'biz-unit-a';
const BIZ_B = 'biz-unit-b';
const OWNER_A = 'owner-a';
const MASTER_USER = 'master-user';
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const APP_SECRET = 'app_secret_test_xyz_123';
const VERIFY_TOKEN = 'verify_token_meta_123';

const PLATFORM_ENV = {
  META_APP_ID: 'app-id-1234',
  META_CONFIG_ID: 'config-id-5678',
  META_APP_SECRET: APP_SECRET,
  WHATSAPP_CREDENTIALS_KEY: KEY,
  WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
  WHATSAPP_APP_SECRET: APP_SECRET,
};

function signPayload(bodyStr: string, secret: string = APP_SECRET): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(bodyStr, 'utf8').digest('hex')}`;
}

function jsonReq(path: string, body: unknown, token?: string, method = 'POST', headers: Record<string, string> = {}): NextRequest {
  const reqHeaders: Record<string, string> = { 'content-type': 'application/json', ...headers };
  if (token) reqHeaders.authorization = `Bearer ${token}`;
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: reqHeaders,
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
}

function clinic(id: string, ownerId: string, phoneId = ''): Business {
  return {
    id,
    ownerId,
    organizationId: `org-${id}`,
    name: `Clínica ${id}`,
    slug: id,
    description: '',
    logo: '',
    cover: '',
    niche: 'saude',
    modes: ['services', 'bookings'],
    features: { whatsapp: true, agent: true } as any,
    phone: '+55 11 99999-0000',
    whatsapp: '+55 11 99999-0000',
    email: `${id}@test.com`,
    published: true,
    createdAt: NOW,
    updatedAt: NOW,
    businessTimezone: 'America/Sao_Paulo',
    whatsappIntegration: phoneId ? {
      status: 'connected',
      phoneNumberId: phoneId,
      wabaId: `waba-${id}`,
      encryptedAccessToken: encryptSecret('EAATokenSecretValid'),
      connectedAt: NOW,
    } : undefined,
  } as any;
}

let ownerToken = '';
let masterToken = '';
let envBackup: Record<string, string | undefined> = {};

beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  envBackup = { ...process.env };
  for (const [k, v] of Object.entries(PLATFORM_ENV)) process.env[k] = v;

  const db: DB = emptyDB();
  db.users.push(
    { id: OWNER_A, name: 'Dono A', email: 'owner@test.com', passwordHash: 'hash', role: 'owner', createdAt: NOW } as any,
    { id: MASTER_USER, name: 'Master User', email: 'master@test.com', passwordHash: 'hash', role: 'master', createdAt: NOW } as any,
  );
  db.businesses.push(clinic(BIZ_A, OWNER_A));
  db.businesses.push(clinic(BIZ_B, 'other-owner'));
  await writeDB(db);

  ownerToken = await createSession(OWNER_A);
  masterToken = await createSession(MASTER_USER);
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
  vi.restoreAllMocks();
});

describe('Meta WhatsApp Cloud API — Onboarding Coexistence e Standard', () => {
  it('onboarding standard: exige registro com PIN para conectar de fato', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'EAAToken123' }), { status: 200 });
      if (u.includes('/debug_token')) return new Response(JSON.stringify({
        data: {
          is_valid: true,
          app_id: PLATFORM_ENV.META_APP_ID,
          scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
          granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA-STD'] }],
        },
      }), { status: 200 });
      if (u.includes('/phone_numbers')) return new Response(JSON.stringify({ data: [{ id: 'PN-STD' }] }), { status: 200 });
      if (u.includes('/subscribed_apps')) return new Response(JSON.stringify({ success: true }), { status: 200 });
      if (u.includes('/PN-STD/register')) return new Response(JSON.stringify({ success: true }), { status: 200 });
      if (u.includes('/PN-STD?fields=')) return new Response(JSON.stringify({
        display_phone_number: '+55 11 98888-0001',
        verified_name: 'Clínica Standard',
        quality_rating: 'GREEN',
      }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
    }));

    const state = issueSignupState(KEY, { businessId: BIZ_A, userId: OWNER_A });

    // 1. Sem PIN: troca código, assina webhook, mas fica pendente de registro
    const resNoPin = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ_A,
      action: 'exchange',
      code: 'CODE-STANDARD-1',
      state,
      wabaId: 'WABA-STD',
      phoneNumberId: 'PN-STD',
      signup: { event: 'FINISH', waba_id: 'WABA-STD', phone_number_id: 'PN-STD' },
    }, ownerToken));

    expect(resNoPin.status).toBe(200);
    const bodyNoPin = await resNoPin.json();
    expect(bodyNoPin.ok).toBe(false);
    expect(bodyNoPin.pending).toBe(true);
    expect(bodyNoPin.reason).toBe('phone_registration_required');

    const db1 = await readDB();
    const wi1 = db1.businesses.find((b) => b.id === BIZ_A)?.whatsappIntegration;
    expect(wi1?.status).toBe('pending');
    expect(wi1?.registrationRequired).toBe(true);
    expect(wi1?.registeredAt).toBeFalsy();

    // 2. Chama action: register com PIN correto de 6 dígitos
    const resReg = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ_A,
      action: 'register',
      pin: '654321',
    }, ownerToken));

    expect(resReg.status).toBe(200);
    const bodyReg = await resReg.json();
    expect(bodyReg.ok).toBe(true);

    const db2 = await readDB();
    const wi2 = db2.businesses.find((b) => b.id === BIZ_A)?.whatsappIntegration;
    expect(wi2?.status).toBe('connected');
    expect(wi2?.registeredAt).toBeTruthy();
    expect(wi2?.registrationRequired).toBe(false);
  });

  it('onboarding coexistence: NÃO chama /register com PIN e conclui conexão', async () => {
    let registerCalled = false;
    vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'EAATokenCoex' }), { status: 200 });
      if (u.includes('/debug_token')) return new Response(JSON.stringify({
        data: {
          is_valid: true,
          app_id: PLATFORM_ENV.META_APP_ID,
          scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
          granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA-COEX'] }],
        },
      }), { status: 200 });
      if (u.includes('/phone_numbers')) return new Response(JSON.stringify({ data: [{ id: 'PN-COEX' }] }), { status: 200 });
      if (u.includes('/subscribed_apps')) return new Response(JSON.stringify({ success: true }), { status: 200 });
      if (u.includes('/register')) {
        registerCalled = true;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      }
      if (u.includes('/PN-COEX?fields=')) return new Response(JSON.stringify({
        display_phone_number: '+55 11 98888-0002',
        verified_name: 'Clínica Coex',
        quality_rating: 'GREEN',
        is_on_biz_app: true,
        platform_type: 'CLOUD_API',
      }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
    }));

    const state = issueSignupState(KEY, { businessId: BIZ_A, userId: OWNER_A });

    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ_A,
      action: 'exchange',
      code: 'CODE-COEX-1',
      state,
      wabaId: 'WABA-COEX',
      phoneNumberId: 'PN-COEX',
      signup: { event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', waba_id: 'WABA-COEX', phone_number_id: 'PN-COEX' },
    }, ownerToken));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // REGRA DE OURO: No modo coexistence, a Meta exige NÃO chamar /register com PIN
    expect(registerCalled).toBe(false);
    expect(body.registration.skipped).toBe(true);

    const db = await readDB();
    const wi = db.businesses.find((b) => b.id === BIZ_A)?.whatsappIntegration;
    expect(wi?.status).toBe('connected');
    expect(wi?.onboardingType).toBe('coexistence');
    expect(wi?.coexistenceConfirmedAt).toBeTruthy();
    expect(wi?.registrationRequired).toBe(false);

    // Tentar chamar register com PIN em conta coexistence retorna erro explicativo 400
    const resForbiddenPin = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ_A,
      action: 'register',
      pin: '123456',
    }, ownerToken));
    expect(resForbiddenPin.status).toBe(400);
    const errBody = await resForbiddenPin.json();
    expect(errBody.code).toBe('coexistence_no_register_needed');
  });

  it('coexistence server-to-server gate: rejeita Coexistence se a Meta não confirmar is_on_biz_app e CLOUD_API', async () => {
    // Caso 1: O cliente envia evento de Coexistence pelo postMessage, mas a Meta retorna is_on_biz_app=false
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'EAATokenForged' }), { status: 200 });
      if (u.includes('/debug_token')) return new Response(JSON.stringify({
        data: {
          is_valid: true,
          app_id: PLATFORM_ENV.META_APP_ID,
          scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
          granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA-GATE'] }],
        },
      }), { status: 200 });
      if (u.includes('/phone_numbers')) return new Response(JSON.stringify({ data: [{ id: 'PN-GATE' }] }), { status: 200 });
      if (u.includes('/subscribed_apps')) return new Response(JSON.stringify({ success: true }), { status: 200 });
      if (u.includes('/PN-GATE?fields=')) return new Response(JSON.stringify({
        display_phone_number: '+55 11 98888-0003',
        verified_name: 'Clínica Gate Test',
        quality_rating: 'GREEN',
        is_on_biz_app: false, // Meta diz NÃO!
        platform_type: 'ON_PREMISE',
      }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
    }));

    const state = issueSignupState(KEY, { businessId: BIZ_A, userId: OWNER_A });

    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ_A,
      action: 'exchange',
      code: 'CODE-GATE-FORGED',
      state,
      wabaId: 'WABA-GATE',
      phoneNumberId: 'PN-GATE',
      signup: { event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', waba_id: 'WABA-GATE', phone_number_id: 'PN-GATE' },
    }, ownerToken));

    expect(res.status).toBe(200);
    const body = await res.json();
    // NÃO pode conectar! Deve manter Coexistence com status pending e motivo explicativo
    expect(body.ok).toBe(false);
    expect(body.pending).toBe(true);
    expect(body.reason).toBe('coexistence_verification_pending');
    expect(body.message).toMatch(/não confirmou o status de Coexistência/i);

    const db = await readDB();
    const wi = db.businesses.find((b) => b.id === BIZ_A)?.whatsappIntegration;
    expect(wi?.status).toBe('pending');
    expect(wi?.onboardingType).toBe('coexistence');
    expect(wi?.registrationRequired).toBe(false);
    expect(wi?.registeredAt).toBeFalsy();
    expect(wi?.coexistenceConfirmedAt).toBeFalsy();

    // REGRA DE OURO: Enquanto a verificação de Coexistência estiver pendente/inconclusiva,
    // a rota /register NÃO PODE aceitar PIN de duas etapas
    const resForbiddenPin = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ_A,
      action: 'register',
      pin: '654321',
    }, ownerToken));
    expect(resForbiddenPin.status).toBe(400);
    const errBody = await resForbiddenPin.json();
    expect(errBody.code).toBe('coexistence_verification_pending');
  });

  it('rotas whatsapp/route.ts (test e connect) não fabricam status connected em contas pendentes', async () => {
    // 1. Configura unidade com token mas sem registro (pending)
    await updateDB((d) => {
      const b = d.businesses.find((x) => x.id === BIZ_A)!;
      b.whatsappIntegration = {
        status: 'pending',
        phoneNumberId: 'PN-PENDING',
        wabaId: 'WABA-PENDING',
        encryptedAccessToken: encryptSecret('TOKEN-VALID'),
        registrationRequired: true,
        source: 'embedded_signup',
      } as any;
    });

    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('/PN-PENDING?fields=')) return new Response(JSON.stringify({
        display_phone_number: '+55 11 98888-0004',
        verified_name: 'Clínica Teste Fake Connect',
      }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
    }));

    // Executa action === 'test'
    const resTest = await whatsappPOST(jsonReq('/api/whatsapp', {
      businessId: BIZ_A,
      action: 'test',
    }, ownerToken));
    expect(resTest.status).toBe(200);

    let db = await readDB();
    let wi = db.businesses.find((b) => b.id === BIZ_A)?.whatsappIntegration;
    // O teste NÃO pode transformar 'pending' em 'connected'!
    expect(wi?.status).toBe('pending');

    // Executa action === 'connect'
    const resConnect = await whatsappPOST(jsonReq('/api/whatsapp', {
      businessId: BIZ_A,
      action: 'connect',
      displayPhone: '11988880004',
    }, ownerToken));
    expect(resConnect.status).toBe(400);
    const bodyConnect = await resConnect.json();
    expect(bodyConnect.pending).toBe(true);
    expect(bodyConnect.status).toBe('pending');

    db = await readDB();
    wi = db.businesses.find((b) => b.id === BIZ_A)?.whatsappIntegration;
    expect(wi?.status).toBe('pending');
  });

  it('centralidade de computeConnectionStatus: registros antigos ou legados sem evidências completas nunca conectam', async () => {
    // 1. Registro antigo com status 'connected', mas SEM webhookSubscribedAt
    const oldWithoutWebhook = {
      status: 'connected',
      phoneNumberId: 'PN-OLD-1',
      wabaId: 'WABA-OLD-1',
      encryptedAccessToken: encryptSecret('TOKEN-1'),
      registeredAt: NOW,
      registrationRequired: false,
      onboardingType: 'standard' as const,
    };
    const c1 = computeConnectionStatus(oldWithoutWebhook as any);
    expect(c1.connected).toBe(false);
    expect(c1.status).toBe('pending');
    expect(c1.reason).toMatch(/Webhook da WABA/i);

    // Avalia também através de integrationStatus (usado pela leitura do painel)
    const bizFake1: any = { whatsappIntegration: oldWithoutWebhook };
    const status1 = integrationStatus(bizFake1, true);
    expect(status1.status).toBe('pending');

    // 2. Registro Standard sem registeredAt
    const stdWithoutReg = {
      status: 'connected', // Tentativa de mentir
      phoneNumberId: 'PN-OLD-2',
      wabaId: 'WABA-OLD-2',
      encryptedAccessToken: encryptSecret('TOKEN-2'),
      webhookSubscribedAt: NOW,
      onboardingType: 'standard' as const,
      registrationRequired: true,
    };
    const c2 = computeConnectionStatus(stdWithoutReg as any);
    expect(c2.connected).toBe(false);
    expect(c2.status).toBe('pending');
    expect(c2.registrationRequired).toBe(true);

    const bizFake2: any = { whatsappIntegration: stdWithoutReg };
    const status2 = integrationStatus(bizFake2, true);
    expect(status2.status).toBe('pending');

    // 3. Registro Coexistence sem confirmação completa (ex: sem isOnBizApp ou sem platformType CLOUD_API)
    const coexIncomplete = {
      status: 'connected',
      phoneNumberId: 'PN-OLD-3',
      wabaId: 'WABA-OLD-3',
      encryptedAccessToken: encryptSecret('TOKEN-3'),
      webhookSubscribedAt: NOW,
      onboardingType: 'coexistence' as const,
      coexistenceConfirmedAt: NOW,
      isOnBizApp: true,
      platformType: 'ON_PREMISE', // Inválido!
    };
    const c3 = computeConnectionStatus(coexIncomplete as any);
    expect(c3.connected).toBe(false);
    expect(c3.status).toBe('pending');
    expect(c3.reason).toMatch(/Coexistência não confirmada/i);

    // 4. Action connect com credenciais globais e sem credencial completa da unidade NÃO conecta
    await updateDB((d) => {
      const b = d.businesses.find((x) => x.id === BIZ_A)!;
      // Reseta integração para nula/básica
      b.whatsappIntegration = {
        status: 'not_connected',
        phoneNumberId: '',
        wabaId: '',
        connectedAt: '',
        requestedAt: '',
      } as any;
    });

    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('?fields=')) return new Response(JSON.stringify({
        display_phone_number: '+55 11 98888-0005',
        verified_name: 'Clínica Global Creds Test',
      }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
    }));

    // Tenta action connect
    const resGlobalConnect = await whatsappPOST(jsonReq('/api/whatsapp', {
      businessId: BIZ_A,
      action: 'connect',
      displayPhone: '11988880005',
    }, ownerToken));

    // Como faltam credenciais no servidor ou token na unidade, a rota retorna erro e mantém pending
    expect(resGlobalConnect.status).toBeGreaterThanOrEqual(400);
    const bodyGlobal = await resGlobalConnect.json();
    expect(bodyGlobal.status === 'pending' || bodyGlobal.code === 'not_configured').toBe(true);

    // Prova no banco que o status gravado é pending e NÃO connected
    const db = await readDB();
    const wiFinal = db.businesses.find((b) => b.id === BIZ_A)?.whatsappIntegration;
    expect(wiFinal?.status).toBe('pending');
  });

  it('rota Master não fabrica evidências e GET Master corrige status connected legado incompleto', async () => {
    // 1. Configuração Master de token e número válidos
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('?fields=')) return new Response(JSON.stringify({
        display_phone_number: '+55 11 98888-0099',
        verified_name: 'Clínica Master Config Test',
      }), { status: 200 });
      return new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 });
    }));

    const resMasterPost = await masterWhatsappPOST(jsonReq(`/api/master/units/${BIZ_A}/whatsapp`, {
      phoneNumberId: 'PN-MASTER-1',
      wabaId: 'WABA-MASTER-1',
      accessToken: 'EAATokenMasterValid',
      displayPhone: '11988880099',
    }, masterToken), { params: Promise.resolve({ id: BIZ_A }) });

    expect(resMasterPost.status).toBe(200);
    const bodyMasterPost = await resMasterPost.json();
    // A rota Master NÃO pode fabricar registeredAt nem webhookSubscribedAt
    expect(bodyMasterPost.ok).toBe(false);
    expect(bodyMasterPost.status).toBe('pending');

    const dbPost = await readDB();
    const wiPost = dbPost.businesses.find((b) => b.id === BIZ_A)?.whatsappIntegration;
    expect(wiPost?.status).toBe('pending');
    expect(wiPost?.registeredAt).toBeFalsy(); // NÃO inventou registeredAt
    expect(wiPost?.webhookSubscribedAt).toBeFalsy(); // NÃO inventou webhookSubscribedAt
    expect(wiPost?.encryptedAccessToken).toBeTruthy();

    // 2. Simula um registro legado no banco que tinha status: 'connected' mas sem evidências
    await updateDB((d) => {
      const b = d.businesses.find((x) => x.id === BIZ_A)!;
      b.whatsappIntegration = {
        status: 'connected', // Fabricado no passado
        phoneNumberId: 'PN-LEGACY',
        wabaId: 'WABA-LEGACY',
        encryptedAccessToken: encryptSecret('TOKEN-LEGACY'),
        // Sem webhookSubscribedAt e sem registeredAt
      } as any;
    });

    const resMasterGet = await masterWhatsappGET(jsonReq(`/api/master/units/${BIZ_A}/whatsapp`, undefined, masterToken, 'GET'), {
      params: Promise.resolve({ id: BIZ_A }),
    });
    expect(resMasterGet.status).toBe(200);
    const bodyMasterGet = await resMasterGet.json();
    // GET Master deve calcular pelo computeConnectionStatus e corrigir para 'pending'
    expect(bodyMasterGet.status).toBe('pending');
    expect(bodyMasterGet.connected).toBe(false);

    // 3. onboardingType: 'unknown', mesmo com timestamps antigos, nunca conecta
    const unknownWithTimestamps = {
      status: 'connected',
      phoneNumberId: 'PN-UNK',
      wabaId: 'WABA-UNK',
      encryptedAccessToken: encryptSecret('TOKEN-UNK'),
      webhookSubscribedAt: NOW,
      registeredAt: NOW,
      registrationRequired: false,
      onboardingType: 'unknown' as const,
    };
    const compUnknown = computeConnectionStatus(unknownWithTimestamps as any);
    expect(compUnknown.connected).toBe(false);
    expect(compUnknown.status).toBe('pending');
    expect(compUnknown.onboardingType).toBe('unknown');

    // 4. onboardingSteps NÃO marca webhook concluído apenas com WABA + token (exige webhookSubscribedAt)
    const bizSemWebhookSubscribed = {
      whatsappIntegration: {
        phoneNumberId: 'PN-TEST',
        wabaId: 'WABA-TEST',
        encryptedAccessToken: 'token-enc',
        // webhookSubscribedAt omitido
      },
    };
    const steps = onboardingSteps(bizSemWebhookSubscribed as any);
    const stepWebhook = steps.find((s) => s.id === 'webhook_subscribed');
    expect(stepWebhook?.ok).toBe(false);
  });

  it('troca de código com token inválido rejeita e não persiste credenciais', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'BAD_TOKEN' }), { status: 200 });
      if (u.includes('/debug_token')) return new Response(JSON.stringify({
        data: { is_valid: false },
      }), { status: 200 });
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }));

    const state = issueSignupState(KEY, { businessId: BIZ_A, userId: OWNER_A });
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ_A,
      action: 'exchange',
      code: 'CODE-INVALID-TOKEN',
      state,
      wabaId: 'WABA-1',
    }, ownerToken));

    expect(res.status).toBe(400);
    const db = await readDB();
    const wi = db.businesses.find((b) => b.id === BIZ_A)?.whatsappIntegration;
    expect(wi?.encryptedAccessToken).toBeFalsy();
    expect(wi?.status || 'not_connected').toBe('not_connected');
  });

  it('falha parcial depois da autorização (ex.: webhook recusado) não deixa falsamente conectado', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'TOKEN-OK' }), { status: 200 });
      if (u.includes('/debug_token')) return new Response(JSON.stringify({
        data: {
          is_valid: true,
          app_id: PLATFORM_ENV.META_APP_ID,
          scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
          granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA-1'] }],
        },
      }), { status: 200 });
      if (u.includes('/phone_numbers')) return new Response(JSON.stringify({ data: [{ id: 'PN-1' }] }), { status: 200 });
      if (u.includes('/subscribed_apps')) return new Response(JSON.stringify({ error: { message: 'Permission denied', code: 200 } }), { status: 400 });
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }));

    const state = issueSignupState(KEY, { businessId: BIZ_A, userId: OWNER_A });
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ_A,
      action: 'exchange',
      code: 'CODE-PARTIAL-FAIL',
      state,
      wabaId: 'WABA-1',
      phoneNumberId: 'PN-1',
    }, ownerToken));

    expect(res.status).toBe(400);
    const db = await readDB();
    const wi = db.businesses.find((b) => b.id === BIZ_A)?.whatsappIntegration;
    // Status deve ser 'pending', com erro explícito — NUNCA 'connected'
    expect(wi?.status).toBe('pending');
    expect(wi?.lastError).toMatch(/assinatura do webhook/i);
    expect(wi?.registeredAt).toBeFalsy();
  });

  it('reconexão limpa erros anteriores e atualiza credenciais', async () => {
    // Coloca a unidade em erro
    await updateDB((d) => {
      const b = d.businesses.find((x) => x.id === BIZ_A)!;
      b.whatsappIntegration = {
        status: 'error',
        lastError: 'Token expirado anteriormente',
        lastErrorAt: NOW,
        phoneNumberId: 'OLD-PHONE',
        wabaId: 'OLD-WABA',
        connectedAt: '',
        requestedAt: NOW,
      } as any;
    });

    vi.stubGlobal('fetch', vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('/oauth/access_token')) return new Response(JSON.stringify({ access_token: 'NEW-TOKEN' }), { status: 200 });
      if (u.includes('/debug_token')) return new Response(JSON.stringify({
        data: {
          is_valid: true,
          app_id: PLATFORM_ENV.META_APP_ID,
          scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
          granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['NEW-WABA'] }],
        },
      }), { status: 200 });
      if (u.includes('/phone_numbers')) return new Response(JSON.stringify({ data: [{ id: 'NEW-PN' }] }), { status: 200 });
      if (u.includes('/subscribed_apps')) return new Response(JSON.stringify({ success: true }), { status: 200 });
      if (u.includes('/register')) return new Response(JSON.stringify({ success: true }), { status: 200 });
      if (u.includes('/NEW-PN?fields=')) return new Response(JSON.stringify({
        display_phone_number: '+55 11 99999-8888',
        verified_name: 'Clínica Reconectada',
      }), { status: 200 });
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }));

    const state = issueSignupState(KEY, { businessId: BIZ_A, userId: OWNER_A });
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ_A,
      action: 'exchange',
      code: 'CODE-RECONNECT',
      state,
      pin: '123456',
      signup: { event: 'FINISH', waba_id: 'NEW-WABA', phone_number_id: 'NEW-PN' },
    }, ownerToken));

    expect(res.status).toBe(200);
    const db = await readDB();
    const wi = db.businesses.find((b) => b.id === BIZ_A)?.whatsappIntegration;
    expect(wi?.status).toBe('connected');
    expect(wi?.lastError).toBeUndefined();
    expect(wi?.phoneNumberId).toBe('NEW-PN');
    expect(wi?.wabaId).toBe('NEW-WABA');
  });

  it('máquina de estados e simplificação da tela: cliente comum não recebe diagnóstico técnico nem segredos', async () => {
    // 1. Consulta como cliente normal (owner)
    const resOwner = await whatsappGET(jsonReq(`/api/whatsapp?businessId=${BIZ_A}`, undefined, ownerToken, 'GET'));
    expect(resOwner.status).toBe(200);
    const bodyOwner = await resOwner.json();
    expect(bodyOwner.canViewDiagnostics).toBe(true); // Dono da unidade pode ver diagnóstico
    expect(bodyOwner.integration.encryptedAccessToken).toBeUndefined();
    expect(bodyOwner.integration.accessToken).toBeUndefined();

    // Cria atendente comum sem permissão de config/admin
    await updateDB((d) => {
      d.users.push({ id: 'attendant-1', name: 'Atendente', email: 'attendant@test.com', role: 'atendente', createdAt: NOW } as any);
      d.members.push({
        id: 'mem-1',
        businessId: BIZ_A,
        userId: 'attendant-1',
        role: 'ATENDENTE',
        permissions: {},
        active: true,
        note: '',
        invitedBy: OWNER_A,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });
    const attendantToken = await createSession('attendant-1');

    const resAttendant = await whatsappGET(jsonReq(`/api/whatsapp?businessId=${BIZ_A}`, undefined, attendantToken, 'GET'));
    expect(resAttendant.status).toBe(200);
    const bodyAttendant = await resAttendant.json();
    expect(bodyAttendant.canViewDiagnostics).toBe(false);
    expect(bodyAttendant.diagnostics).toBeUndefined();
    expect(bodyAttendant.server).toBeUndefined();
    expect(bodyAttendant.webhookPath).toBeUndefined();
  });

  it('isolamento multitenant e rejeição de unidade ambígua no webhook', async () => {
    // Duas empresas com o MESMO phoneNumberId por erro/ataque simulado
    await updateDB((d) => {
      const b1 = d.businesses.find((x) => x.id === BIZ_A)!;
      const b2 = d.businesses.find((x) => x.id === BIZ_B)!;
      b1.whatsappIntegration = { status: 'connected', phoneNumberId: 'DUP-PHONE', wabaId: 'WABA-1' } as any;
      b2.whatsappIntegration = { status: 'connected', phoneNumberId: 'DUP-PHONE', wabaId: 'WABA-2' } as any;
    });

    const db = await readDB();
    // resolveTenantForChange deve recusar unidade ambígua retornando null
    const ambiguous = resolveTenantForChange(db, 'DUP-PHONE', '');
    expect(ambiguous).toBeNull();
  });

  it('fluxo de agendamento no webhook com confirmação explícita antes de criar booking', async () => {
    // Configura serviços, profissionais e habilita agente para WhatsApp em BIZ_A
    await updateDB((d) => {
      const b = d.businesses.find((x) => x.id === BIZ_A)!;
      b.features = { ...(b.features || {}), whatsapp: true, agent: true, bookings: true } as any;
      b.whatsappIntegration = {
        status: 'connected',
        phoneNumberId: 'PN-FLOW-TEST',
        wabaId: 'WABA-FLOW',
        encryptedAccessToken: encryptSecret('TOKEN'),
      } as any;
      d.agents.push({
        id: `agent-${BIZ_A}`,
        businessId: BIZ_A,
        name: 'Assistente Virtual',
        enabled: true,
        greeting: 'Olá! Como posso ajudar?',
        tone: 'acolhedor',
        objectives: ['orientar_agendamento'],
        instructions: '',
        restrictions: '',
        handoffMessage: 'Vou transferir seu atendimento para a nossa equipe.',
        knowledgeOverride: '',
        channels: { site: true, whatsapp: true },
        createdAt: NOW,
        updatedAt: NOW,
      });
      d.services.push({
        id: 'srv-consulta',
        businessId: BIZ_A,
        name: 'Consulta Geral',
        durationMin: 30,
        price: 15000,
        active: true,
        bookable: true,
      } as any);
      d.availability.push({
        id: 'av-1',
        businessId: BIZ_A,
        weekday: 1, // segunda
        start: '09:00',
        end: '18:00',
        slotMin: 30,
      } as any);
      d.professionals.push({
        id: 'pro-1',
        businessId: BIZ_A,
        name: 'Dra. Luiza',
        active: true,
      } as any);
    });

    const sendMsg = async (bodyText: string) => {
      const payload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WABA-FLOW',
            changes: [
              {
                field: 'messages',
                value: {
                  messaging_product: 'whatsapp',
                  metadata: { phone_number_id: 'PN-FLOW-TEST' },
                  contacts: [{ profile: { name: 'Paciente Maria' }, wa_id: '5511999991234' }],
                  messages: [{
                    from: '5511999991234',
                    id: `wamid.${Date.now()}_${Math.random()}`,
                    text: { body: bodyText },
                    type: 'text',
                  }],
                },
              },
            ],
          },
        ],
      };
      const raw = JSON.stringify(payload);
      return webhookPOST(new NextRequest('http://localhost:3000/api/whatsapp/webhook', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hub-signature-256': signPayload(raw) },
        body: raw,
      }));
    };

    // 1. Paciente pede agendamento
    await sendMsg('Quero agendar uma consulta');
    let db = await readDB();
    expect(db.bookings.filter((b) => b.businessId === BIZ_A)).toHaveLength(0); // NADA criado ainda

    // 2. Paciente escolhe dia e horário
    await sendMsg('segunda 10:00');
    db = await readDB();
    expect(db.bookings.filter((b) => b.businessId === BIZ_A)).toHaveLength(0); // NADA criado ainda; agente pede confirmação

    const conv = db.conversations.find((c) => c.businessId === BIZ_A && c.phone.includes('999991234'));
    expect(conv?.lastMessagePreview).toMatch(/Confirma\?/i);

    // 3. Paciente confirma ("Sim, confirmo")
    await sendMsg('Sim, confirmo');
    db = await readDB();
    // Agora sim o Booking REAL é criado
    const bookings = db.bookings.filter((b) => b.businessId === BIZ_A && b.customerPhone.includes('999991234'));
    expect(bookings).toHaveLength(1);
    expect(bookings[0].time).toBe('10:00');
    expect(bookings[0].serviceId).toBe('srv-consulta');

    // 4. Proteção contra Double Booking: novo agendamento no mesmo horário é barrado
    await expect(
      updateDB((d) => {
        const s = d.services.find((x) => x.id === 'srv-consulta')!;
        const b = d.businesses.find((x) => x.id === BIZ_A)!;
        // Tenta criar outro booking síncrono no mesmo horário para outro paciente
        // Deve lançar erro de conflito de horário
        createBookingTx(d, {
          business: b,
          service: s,
          date: bookings[0].date,
          time: '10:00',
          actor: 'customer',
          customer: { id: '', name: 'Outro Paciente', phone: '5511999995555' },
        });
      })
    ).rejects.toThrow(/horário|ocupado|conflito/i);

    // Prova no banco que NENHUM segundo agendamento foi persistido no horário
    const dbFinal = await readDB();
    const finalBookingsAtSlot = dbFinal.bookings.filter(
      (b) => b.businessId === BIZ_A && b.date === bookings[0].date && b.time === '10:00'
    );
    expect(finalBookingsAtSlot).toHaveLength(1);
    expect(finalBookingsAtSlot[0].customerPhone).toContain('999991234');
  });
});
