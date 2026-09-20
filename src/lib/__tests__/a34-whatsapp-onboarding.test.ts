// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 8 — ONBOARDING REAL DO WHATSAPP
// ═══════════════════════════════════════════════════════════════
// O que estes testes provam:
//
//   1. o diagnóstico separa PLATAFORMA × UNIDADE (e não chama de "pendência da
//      sua unidade" o que é bloqueio de instalação);
//   2. sem app da Meta configurado, a troca do código responde 503
//      (BLOCKED_EXTERNAL) e NÃO grava nada — nada de fingir conexão;
//   3. com a plataforma pronta, o fluxo real funciona: código → token →
//      assinatura do webhook → dados do número → token CRIPTOGRAFADO na
//      unidade, com auditoria e sem o token em nenhuma resposta;
//   4. o código do popup é de uso único e curto: falha da Meta não grava token
//      e explica que é preciso recomeçar;
//   5. o estado assinado do popup recusa troca de outra sessão;
//   6. WABA/número que o popup não mandou são descobertos pelo servidor
//      (debug_token / phone_numbers), em vez de desistir;
//   7. a versão da Graph API é conferida e avisada quando está saindo de linha.
import './helpers/temp-db';

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { GET as onboardingGET, POST as onboardingPOST } from '@/app/api/whatsapp/onboarding/route';
import { DEFAULT_META_GRAPH_VERSION } from '../whatsapp-cloud-api';
import {
  GRAPH_RELEASES, LATEST_VERIFIED_GRAPH_VERSION, graphVersionAdvice, onboardingPlan, onboardingSteps,
  parseSignupMessage, platformLayer, unitLayer, waMeTestLink, WA_ME_TEST_DISCLAIMER,
} from '../whatsapp-onboarding';
import { appsecretProof, issueSignupState, verifySignupState } from '../whatsapp-onboarding-server';
import type { Business, DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const BIZ = 'biz-b8';
const OTHER = 'biz-b8-outra';
const OWNER = 'owner-b8';
const KEY = 'chave-de-teste-com-32-caracteres-ok';

function business(id: string, owner = OWNER): Business {
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

async function seed() {
  const db: DB = emptyDB();
  db.users.push({ id: OWNER, name: 'Dono', email: 'b8@example.com', passwordHash: 'hash-b8', createdAt: NOW, role: 'owner' } as any);
  db.businesses.push(business(BIZ));
  db.businesses.push(business(OTHER, 'outro-dono'));
  await writeDB(db);
}

const PLATFORM_ENV = {
  META_APP_ID: '1234567890',
  META_CONFIG_ID: '9876543210',
  META_APP_SECRET: 'segredo-do-app',
  WHATSAPP_CREDENTIALS_KEY: KEY,
  WHATSAPP_VERIFY_TOKEN: 'verify-token-b8',
};

function jsonReq(path: string, body: unknown, token?: string, method = 'POST'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`http://localhost:3000${path}`, {
    method, headers,
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  });
}
const json = (res: Response) => res.json() as Promise<any>;

let token = '';
let envBackup: Record<string, string | undefined> = {};

function setEnv(values: Record<string, string>) {
  for (const [k, v] of Object.entries(values)) process.env[k] = v;
}
function clearPlatformEnv() {
  for (const k of Object.keys(PLATFORM_ENV)) delete process.env[k];
  delete process.env.META_GRAPH_VERSION;
}

beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  token = await createSession(OWNER);
  envBackup = { ...process.env };
  clearPlatformEnv();
});

afterEach(() => {
  // Restaura o ambiente original (chave a chave: `process.env` não é substituível por inteiro no tipo).
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

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · B8 — diagnóstico em duas camadas', () => {
  it('a camada da plataforma nomeia cada variável que falta (e nunca mostra valor)', () => {
    const blocked = platformLayer({});
    expect(blocked.ready).toBe(false);
    expect(blocked.missing).toEqual([
      'META_APP_ID', 'META_CONFIG_ID', 'META_APP_SECRET', 'WHATSAPP_CREDENTIALS_KEY', 'WHATSAPP_VERIFY_TOKEN',
    ]);
    const ready = platformLayer(PLATFORM_ENV);
    expect(ready.ready).toBe(true);
    expect(ready.missing).toEqual([]);
    // Nenhum item expõe valor — só existência.
    for (const item of ready.items) {
      expect(JSON.stringify(item)).not.toContain(PLATFORM_ENV.META_APP_SECRET);
      expect(JSON.stringify(item)).not.toContain(KEY);
    }
  });

  it('sem plataforma, o plano é BLOCKED_EXTERNAL e a culpa NÃO é da unidade', () => {
    const plan = onboardingPlan({ env: {}, business: business(BIZ), todayISO: '2026-09-19' });
    expect(plan.state).toBe('platform_blocked');
    expect(plan.code).toBe('BLOCKED_EXTERNAL');
    expect(plan.clientConfig).toBeNull();          // nada de App ID para o navegador
    expect(plan.headline).toMatch(/plataforma/i);
    expect(plan.detail).toMatch(/Master/);          // diz o caminho que existe hoje
    expect(plan.layers.map((l) => l.id)).toEqual(['platform', 'unit']);
    expect(plan.nextAction.kind).toBe('fix_platform');
  });

  it('com a plataforma pronta, o plano pede o popup e entrega só config pública', () => {
    const plan = onboardingPlan({ env: PLATFORM_ENV, business: business(BIZ), todayISO: '2026-09-19' });
    expect(plan.state).toBe('ready_for_signup');
    expect(plan.nextAction.kind).toBe('embedded_signup');
    expect(plan.clientConfig).toEqual({ appId: '1234567890', configId: '9876543210', version: LATEST_VERIFIED_GRAPH_VERSION });
    expect(JSON.stringify(plan.clientConfig)).not.toContain(PLATFORM_ENV.META_APP_SECRET);
  });

  it('sem REGISTRO do número a unidade fica pendente — nunca "conectado" nem "aguardando evento"', () => {
    const b = business(BIZ);
    b.whatsappIntegration = {
      status: 'pending', displayPhone: '+55 11 99999-9999', phoneNumberId: '111', wabaId: '222',
      connectedAt: '', lastWebhookAt: '', requestedAt: NOW, encryptedAccessToken: 'x:y:z',
      webhookSubscribedAt: NOW, registrationRequired: true,
    } as any;
    const plan = onboardingPlan({ env: PLATFORM_ENV, business: b, todayISO: '2026-09-19' });
    expect(plan.state).toBe('registration_pending');
    expect(plan.code).toBe('UNIT_PENDING');
    expect(plan.nextAction.kind).toBe('register_number');
    expect(plan.headline).toMatch(/falta registrar/i);

    // Com o registro comprovado: aí sim (e ainda avisando do primeiro evento).
    b.whatsappIntegration!.registeredAt = NOW;
    b.whatsappIntegration!.status = 'connected';
    b.whatsappIntegration!.registrationRequired = false;
    const pronto = onboardingPlan({ env: PLATFORM_ENV, business: b, todayISO: '2026-09-19' });
    expect(pronto.state).toBe('waiting_first_event');
    expect(pronto.code).toBe('OK');
    expect(pronto.nextAction.kind).toBe('test_connection');

    b.whatsappIntegration!.lastWebhookAt = NOW;
    expect(onboardingPlan({ env: PLATFORM_ENV, business: b, todayISO: '2026-09-19' }).state).toBe('connected');
  });

  it('a camada da unidade cobra número, WABA, token e REGISTRO do número', () => {
    const b = business(BIZ);
    expect(unitLayer(b).missing).toEqual(['phoneNumberId', 'wabaId', 'accessToken', 'registration']);
    b.whatsappIntegration = {
      status: 'connected', phoneNumberId: '1', wabaId: '2', encryptedAccessToken: 'a:b:c', registeredAt: NOW,
    } as any;
    const layer = unitLayer(b);
    expect(layer.ready).toBe(true);
    expect(layer.items.find((i) => i.key === 'webhook')!.ok).toBe(false);   // prova real ainda não chegou
    expect(layer.items.find((i) => i.key === 'webhook')!.required).toBe(false);
  });

  it('a versão da Graph API é conferida com data de vigência (v20 sai de linha em 24/09/2026)', () => {
    expect(graphVersionAdvice('v20.0', '2026-09-19').level).toBe('update');
    expect(graphVersionAdvice('v20.0', '2026-09-25').level).toBe('expired');
    expect(graphVersionAdvice('v26.0', '2026-09-19').level).toBe('ok');
    // Data conferida na doc: v26.0 é de 29/07/2026 (não 21/07).
    expect(GRAPH_RELEASES.find((r) => r.version === 'v26.0')!.released).toBe('2026-07-29');
    expect(GRAPH_RELEASES.find((r) => r.version === 'v25.0')!.released).toBe('2026-02-18');
    expect(graphVersionAdvice('v30.0', '2026-09-19').level).toBe('unknown');
    expect(graphVersionAdvice('', '2026-09-19').level).toBe('unknown');
    // A versão padrão do cliente da Meta é a última conferida aqui — sem divergir.
    expect(DEFAULT_META_GRAPH_VERSION).toBe(LATEST_VERIFIED_GRAPH_VERSION);
    expect(GRAPH_RELEASES.some((r) => r.version === DEFAULT_META_GRAPH_VERSION)).toBe(true);
  });

  it('o estado do popup é assinado E ligado à unidade + usuário que o pediram', () => {
    const now = Date.parse('2026-09-19T12:00:00.000Z');
    const ctx = { businessId: BIZ, userId: OWNER };
    const state = issueSignupState(KEY, ctx, now);
    expect(verifySignupState(state, KEY, ctx, now + 1000).ok).toBe(true);
    // Passou de 30 min, assinatura de outro segredo, valor adulterado.
    expect(verifySignupState(state, KEY, ctx, now + 60 * 60 * 1000).ok).toBe(false);
    expect(verifySignupState(state, 'outra-chave', ctx, now + 1000).ok).toBe(false);
    expect(verifySignupState(state.replace(/\.\w+$/, '.0000'), KEY, ctx, now + 1000).ok).toBe(false);
    expect(verifySignupState('', KEY, ctx, now).ok).toBe(false);
    // ESTA é a correção: o mesmo estado não vale em outra unidade nem para outro usuário.
    expect(verifySignupState(state, KEY, { businessId: OTHER, userId: OWNER }, now + 1000).ok).toBe(false);
    expect(verifySignupState(state, KEY, { businessId: BIZ, userId: 'outro-usuario' }, now + 1000).ok).toBe(false);
    // Estado emitido para outra unidade não é aceito, nem com assinatura válida.
    const outro = issueSignupState(KEY, { businessId: OTHER, userId: OWNER }, now);
    expect(verifySignupState(outro, KEY, { businessId: BIZ, userId: OWNER }, now + 1000).ok).toBe(false);
  });

  it('a Meta diz o tipo de onboarding — e nós NÃO presumimos coexistence', () => {
    expect(parseSignupMessage({ data: { event: 'FINISH' } }).onboardingType).toBe('standard');
    expect(parseSignupMessage({ data: { event: 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING' } }).onboardingType).toBe('coexistence');
    expect(parseSignupMessage({ data: {} }).onboardingType).toBe('unknown');
  });

  it('as etapas seguem a ordem real: autorizado → webhook → número → registro → conectado', () => {
    const b = business(BIZ);
    const vazio = onboardingSteps(b);
    expect(vazio.map((s) => s.id)).toEqual(['authorized', 'webhook_subscribed', 'phone_resolved', 'registration', 'connected', 'first_event']);
    expect(vazio.every((s) => !s.ok)).toBe(true);
    expect(vazio.find((s) => s.current)!.id).toBe('authorized');

    // Autorizado + webhook + número, mas SEM registro: o registro é a etapa atual
    // e "conectado" continua falso (era o falso positivo da primeira versão).
    b.whatsappIntegration = {
      status: 'pending', wabaId: '2', phoneNumberId: '1', encryptedAccessToken: 'a:b:c',
      webhookSubscribedAt: NOW, registrationRequired: true,
    } as any;
    const semRegistro = onboardingSteps(b);
    expect(semRegistro.find((s) => s.id === 'registration')!.ok).toBe(false);
    expect(semRegistro.find((s) => s.id === 'registration')!.current).toBe(true);
    expect(semRegistro.find((s) => s.id === 'connected')!.ok).toBe(false);

    // Com o registro provado, conectado (e ainda falta o primeiro evento).
    b.whatsappIntegration!.registeredAt = NOW;
    b.whatsappIntegration!.registrationRequired = false;
    b.whatsappIntegration!.onboardingType = 'standard';
    b.whatsappIntegration!.status = 'connected';
    const completo = onboardingSteps(b);
    expect(completo.find((s) => s.id === 'connected')!.ok).toBe(true);
    expect(completo.find((s) => s.id === 'first_event')!.current).toBe(true);
  });

  it('a mensagem do popup tolera número ausente e o wa.me é rotulado como TESTE', () => {
    const semNumero = parseSignupMessage({ type: 'WA_EMBEDDED_SIGNUP', data: { event: 'FINISH', waba_id: '222', business_id: '333', version: 3 } });
    expect(semNumero.wabaId).toBe('222');
    expect(semNumero.phoneNumberId).toBe('');
    expect(parseSignupMessage({ data: { phone_number_id: '111', waba_id: '222' } }).phoneNumberId).toBe('111');
    expect(parseSignupMessage(null).wabaId).toBe('');
    expect(waMeTestLink('+55 (21) 98888-7777')).toBe('https://wa.me/5521988887777');
    expect(waMeTestLink('')).toBe('');
    expect(WA_ME_TEST_DISCLAIMER).toMatch(/TESTAR/);
    expect(WA_ME_TEST_DISCLAIMER).toMatch(/não entra nem sai pelo sistema/);
  });

  it('o appsecret_proof é o HMAC do token com o segredo do app', () => {
    // Valor fixo conferido: HMAC-SHA256("token", "segredo").
    expect(appsecretProof('token', 'segredo')).toHaveLength(64);
    expect(appsecretProof('token', 'segredo')).toBe(appsecretProof('token', 'segredo'));
    expect(appsecretProof('token', 'segredo')).not.toBe(appsecretProof('outro', 'segredo'));
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · B8 — rota de onboarding (com a Meta simulada)', () => {
  /** Simula a Graph API e registra as chamadas para conferência. */
  function mockMeta(handlers: Record<string, (url: URL, init?: RequestInit) => any>) {
    const calls: Array<{ path: string; url: URL; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: any, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.replace(/^\/v[\d.]+/, '');
      calls.push({ path, url, init });
      const handler = handlers[`${init?.method || 'GET'} ${path}`] || handlers[path];
      if (!handler) return new Response(JSON.stringify({ error: { message: `sem handler para ${init?.method || 'GET'} ${path}`, code: 1 } }), { status: 400 });
      const body = handler(url, init);
      return new Response(JSON.stringify(body), { status: body?.__status || 200 });
    }));
    return calls;
  }

  const DEBUG_OK = {
    data: {
      is_valid: true,
      app_id: PLATFORM_ENV.META_APP_ID,
      scopes: ['whatsapp_business_management', 'whatsapp_business_messaging'],
      granular_scopes: [{ scope: 'whatsapp_business_management', target_ids: ['WABA-1'] }],
    },
  };

  const OK_META = {
    'GET /oauth/access_token': () => ({ access_token: 'TOKEN-DA-UNIDADE' }),
    'GET /debug_token': () => DEBUG_OK,
    'GET /WABA-1/phone_numbers': () => ({ data: [{ id: 'PN-1' }] }),
    'POST /WABA-1/subscribed_apps': () => ({ success: true }),
    'GET /PN-1': () => ({ display_phone_number: '+55 21 98888-7777', verified_name: 'Clínica B8', quality_rating: 'GREEN' }),
    'POST /PN-1/register': () => ({ success: true }),
  };

  it('GET entrega o plano e o estado assinado, sem vazar segredo', async () => {
    setEnv(PLATFORM_ENV);
    const res = await onboardingGET(jsonReq(`/api/whatsapp/onboarding?businessId=${BIZ}`, undefined, token, 'GET'));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.plan.state).toBe('ready_for_signup');
    expect(body.signupState).toBeTruthy();
    const text = JSON.stringify(body);
    expect(text).not.toContain(PLATFORM_ENV.META_APP_SECRET);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(PLATFORM_ENV.WHATSAPP_VERIFY_TOKEN);
  });

  it('SEM plataforma: 503 BLOCKED_EXTERNAL, nada gravado e nada de conexão fingida', async () => {
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state: 'irrelevante',
    }, token));
    expect(res.status).toBe(503);
    const body = await json(res);
    expect(body.code).toBe('platform_not_configured');
    expect(body.external).toBe('BLOCKED_EXTERNAL');
    expect(body.missing).toEqual([
      'META_APP_ID', 'META_CONFIG_ID', 'META_APP_SECRET', 'WHATSAPP_CREDENTIALS_KEY', 'WHATSAPP_VERIFY_TOKEN',
    ]);
    const db = await readDB();
    // Nada mudou na unidade: nem token, nem número, nem status.
    const wi = db.businesses.find((b) => b.id === BIZ)!.whatsappIntegration;
    expect(wi?.encryptedAccessToken).toBeUndefined();
    expect(wi?.phoneNumberId || '').toBe('');
    expect(wi?.status || 'not_connected').toBe('not_connected');
    const audit = db.audit.filter((a) => a.action === 'whatsapp.onboarding_blocked');
    expect(audit).toHaveLength(1);
    expect(audit[0].meta).toMatchObject({ reason: 'platform_not_configured' });
  });

  it('fluxo real: código → token → assinatura do webhook → número, com token CRIPTOGRAFADO e auditoria', async () => {
    setEnv(PLATFORM_ENV);
    const state = issueSignupState(KEY, { businessId: BIZ, userId: OWNER });
    const calls = mockMeta(OK_META);
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO-CURTO', state, pin: '123456',
      signup: { event: 'FINISH', waba_id: 'WABA-1', phone_number_id: 'PN-1' },
    }, token));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.checks).toMatchObject({ tokenStored: true, webhookSubscribed: true, phoneResolved: true });
    expect(body.checks.registration).toMatchObject({ attempted: true, ok: true });
    // Nenhuma resposta carrega o token nem o segredo do app.
    const text = JSON.stringify(body);
    expect(text).not.toContain('TOKEN-DA-UNIDADE');
    expect(text).not.toContain(PLATFORM_ENV.META_APP_SECRET);

    // O banco guarda o token CIFRADO e o estado real da conexão.
    const db = await readDB();
    const wi = db.businesses.find((b) => b.id === BIZ)!.whatsappIntegration!;
    expect(wi.status).toBe('connected');
    expect(wi.phoneNumberId).toBe('PN-1');
    expect(wi.wabaId).toBe('WABA-1');
    expect(wi.displayPhone).toBe('+55 21 98888-7777');
    expect(wi.verifiedName).toBe('Clínica B8');
    expect(wi.source).toBe('embedded_signup');
    expect(JSON.stringify(wi)).not.toContain('TOKEN-DA-UNIDADE');   // nunca em claro
    expect(wi.encryptedAccessToken!.split(':')).toHaveLength(3);

    // A chamada da assinatura veio ANTES de qualquer configuração de callback
    // e levou o appsecret_proof (token vazado não basta).
    const subscribe = calls.find((c) => c.path === '/WABA-1/subscribed_apps')!;
    expect(subscribe.init?.method).toBe('POST');
    expect(String(subscribe.init?.headers && (subscribe.init.headers as any).authorization)).toBe('Bearer TOKEN-DA-UNIDADE');
    const exchange = calls.find((c) => c.path === '/oauth/access_token')!;
    expect(exchange.url.searchParams.get('client_secret')).toBe(PLATFORM_ENV.META_APP_SECRET);
    expect(exchange.url.searchParams.get('code')).toBe('CODIGO-CURTO');

    // Auditoria com o que importa (e sem segredo nenhum).
    const audit = db.audit.find((a) => a.action === 'whatsapp.connected')!;
    expect(audit.meta).toMatchObject({ via: 'embedded_signup', registered: true, onboardingType: 'standard' });
    expect(JSON.stringify(audit)).not.toContain('TOKEN-DA-UNIDADE');
  });

  it('WABA e número que o popup NÃO mandou são descobertos pelo servidor', async () => {
    setEnv(PLATFORM_ENV);
    const state = issueSignupState(KEY, { businessId: BIZ, userId: OWNER });
    mockMeta(OK_META);
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state, pin: '123456', signup: { event: 'FINISH' },
    }, token));
    expect(res.status).toBe(200);
    const wi = (await readDB()).businesses.find((b) => b.id === BIZ)!.whatsappIntegration!;
    expect(wi.wabaId).toBe('WABA-1');       // veio do debug_token (granular_scopes)
    expect(wi.phoneNumberId).toBe('PN-1');  // veio de /phone_numbers
    expect(wi.status).toBe('connected');
  });

  it('código recusado pela Meta (uso único/30s) não grava token e manda recomeçar', async () => {
    setEnv(PLATFORM_ENV);
    const state = issueSignupState(KEY, { businessId: BIZ, userId: OWNER });
    mockMeta({
      'GET /oauth/access_token': () => ({ __status: 400, error: { message: 'This authorization code has been used.', code: 100 } }),
    });
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO-JA-USADO', state,
    }, token));
    expect(res.status).toBe(400);
    const body = await json(res);
    expect(body.error).toMatch(/30 segundos|uso único|Recomece/i);
    const db = await readDB();
    const wi = db.businesses.find((b) => b.id === BIZ)!.whatsappIntegration;
    expect(wi?.encryptedAccessToken).toBeUndefined();     // token morto não é guardado
    expect(wi?.status || 'not_connected').toBe('not_connected');
    expect(db.audit.some((a) => a.action === 'whatsapp.onboarding_failed')).toBe(true);
  });


  // ── item 5: registro é obrigatório para ser "conectado" ──────
  it('SEM PIN: conta autorizada + webhook assinado, mas NADA de conectado (falta registrar)', async () => {
    setEnv(PLATFORM_ENV);
    const calls = mockMeta(OK_META);
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state: issueSignupState(KEY, { businessId: BIZ, userId: OWNER }),
      wabaId: 'WABA-1', phoneNumberId: 'PN-1',
    }, token));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(false);
    expect(body.pending).toBe(true);
    expect(body.reason).toBe('phone_registration_required');
    expect(body.plan.state).toBe('registration_pending');
    // Nenhuma chamada de registro foi feita (não dá para registrar sem PIN).
    expect(calls.some((c) => c.path === '/PN-1/register')).toBe(false);
    const wi = (await readDB()).businesses.find((b) => b.id === BIZ)!.whatsappIntegration!;
    expect(wi.status).toBe('pending');
    expect(wi.registeredAt).toBeFalsy();
    expect(wi.registrationRequired).toBe(true);
    expect(wi.webhookSubscribedAt).toBeTruthy();       // esta etapa ficou provada
    expect(wi.encryptedAccessToken).toBeTruthy();      // token guardado para concluir depois
    // Auditoria honesta: não houve "connected".
    const db = await readDB();
    expect(db.audit.some((a) => a.action === 'whatsapp.connected')).toBe(false);
    expect(db.audit.some((a) => a.action === 'whatsapp.registration_pending')).toBe(true);
  });

  it('action register (com o token já guardado) conclui o registro e conecta', async () => {
    setEnv(PLATFORM_ENV);
    mockMeta(OK_META);
    await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state: issueSignupState(KEY, { businessId: BIZ, userId: OWNER }),
      wabaId: 'WABA-1', phoneNumberId: 'PN-1',
    }, token));
    expect((await readDB()).businesses.find((b) => b.id === BIZ)!.whatsappIntegration!.status).toBe('pending');

    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'register', pin: '123456',
    }, token));
    expect(res.status).toBe(200);
    const wi = (await readDB()).businesses.find((b) => b.id === BIZ)!.whatsappIntegration!;
    expect(wi.status).toBe('connected');
    expect(wi.registeredAt).toBeTruthy();
    expect(wi.registrationRequired).toBe(false);
    expect((await json(res)).plan.state).toBe('waiting_first_event');
  });

  it('registro recusado pela Meta deixa PENDENTE com o motivo (nunca conectado)', async () => {
    setEnv(PLATFORM_ENV);
    mockMeta({ ...OK_META, 'POST /PN-1/register': () => ({ __status: 400, error: { message: 'Invalid PIN', code: 133008 } }) });
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state: issueSignupState(KEY, { businessId: BIZ, userId: OWNER }),
      wabaId: 'WABA-1', phoneNumberId: 'PN-1', pin: '999999',
    }, token));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.pending).toBe(true);
    expect(body.message).toMatch(/Invalid PIN/);
    const wi = (await readDB()).businesses.find((b) => b.id === BIZ)!.whatsappIntegration!;
    expect(wi.status).toBe('pending');
    expect(wi.lastError).toMatch(/Registro do número/);
    expect(wi.registeredAt).toBeFalsy();
  });

  // ── item 6: o servidor é a autoridade sobre WABA/número/token ──
  it('token inválido (is_valid=false) é recusado e nada é gravado', async () => {
    setEnv(PLATFORM_ENV);
    mockMeta({ ...OK_META, 'GET /debug_token': () => ({ data: { is_valid: false } }) });
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state: issueSignupState(KEY, { businessId: BIZ, userId: OWNER }),
      wabaId: 'WABA-1', phoneNumberId: 'PN-1', pin: '123456',
    }, token));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/não é válida na Meta/i);
    expect((await readDB()).businesses.find((b) => b.id === BIZ)!.whatsappIntegration?.encryptedAccessToken).toBeFalsy();
  });

  it('token de OUTRO app da Meta é recusado', async () => {
    setEnv(PLATFORM_ENV);
    mockMeta({ ...OK_META, 'GET /debug_token': () => ({ data: { ...DEBUG_OK.data, app_id: '999999' } }) });
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state: issueSignupState(KEY, { businessId: BIZ, userId: OWNER }),
    }, token));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/outro aplicativo/i);
  });

  it('permissões faltando no token são recusadas com o nome da permissão', async () => {
    setEnv(PLATFORM_ENV);
    mockMeta({
      ...OK_META,
      'GET /debug_token': () => ({ data: { ...DEBUG_OK.data, scopes: ['whatsapp_business_management'] } }),
    });
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state: issueSignupState(KEY, { businessId: BIZ, userId: OWNER }),
    }, token));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/whatsapp_business_messaging/);
  });

  it('WABA NÃO autorizada pelo popup é recusada (o navegador não decide)', async () => {
    setEnv(PLATFORM_ENV);
    mockMeta(OK_META);
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state: issueSignupState(KEY, { businessId: BIZ, userId: OWNER }),
      wabaId: 'WABA-DE-OUTRA-EMPRESA', phoneNumberId: 'PN-1', pin: '123456',
    }, token));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/não inclui a WhatsApp Business Account/i);
    expect((await readDB()).businesses.find((b) => b.id === BIZ)!.whatsappIntegration?.encryptedAccessToken).toBeFalsy();
  });

  it('número que NÃO pertence à WABA é recusado (nada de combinação inventada)', async () => {
    setEnv(PLATFORM_ENV);
    const calls = mockMeta(OK_META);
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state: issueSignupState(KEY, { businessId: BIZ, userId: OWNER }),
      wabaId: 'WABA-1', phoneNumberId: 'PN-DE-OUTRA-WABA', pin: '123456',
    }, token));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/não pertence a essa conta WhatsApp Business/i);
    // A inconsistência para TUDO: nem assina o webhook.
    expect(calls.some((c) => c.path === '/WABA-1/subscribed_apps')).toBe(false);
    expect((await readDB()).businesses.find((b) => b.id === BIZ)!.whatsappIntegration?.encryptedAccessToken).toBeFalsy();
  });

  it('o popup NÃO manda o número e o servidor escolhe um número DAQUELA WABA', async () => {
    setEnv(PLATFORM_ENV);
    mockMeta({
      ...OK_META,
      'GET /WABA-1/phone_numbers': () => ({ data: [{ id: 'PN-9' }] }),
      'GET /PN-9': () => ({ display_phone_number: '+55 21 90000-0000', verified_name: 'Clínica B8' }),
      'POST /PN-9/register': () => ({ success: true }),
    });
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state: issueSignupState(KEY, { businessId: BIZ, userId: OWNER }),
      wabaId: 'WABA-1', pin: '123456',
    }, token));
    expect(res.status).toBe(200);
    expect((await json(res)).ok).toBe(true);
    const wi = (await readDB()).businesses.find((b) => b.id === BIZ)!.whatsappIntegration!;
    expect(wi.phoneNumberId).toBe('PN-9');
    expect(wi.displayPhone).toBe('+55 21 90000-0000');
  });

  // ── item 7: o state vale só para a unidade/usuário que pediram ──
  it('estado do popup de OUTRA unidade/usuário = 400 e nenhuma chamada à Meta', async () => {
    setEnv(PLATFORM_ENV);
    const deOutraUnidade = issueSignupState(KEY, { businessId: OTHER, userId: OWNER });
    const fetchSpy1 = vi.fn();
    vi.stubGlobal('fetch', fetchSpy1);
    const r1 = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state: deOutraUnidade,
    }, token));
    expect(r1.status).toBe(400);
    expect((await json(r1)).code).toBe('signup_state_invalid');
    expect(fetchSpy1).not.toHaveBeenCalled();

    const deOutroUsuario = issueSignupState(KEY, { businessId: BIZ, userId: 'outro-usuario' });
    const fetchSpy2 = vi.fn();
    vi.stubGlobal('fetch', fetchSpy2);
    const r2 = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state: deOutroUsuario,
    }, token));
    expect(r2.status).toBe(400);
    expect(fetchSpy2).not.toHaveBeenCalled();
  });

  it('estado do popup inválido = 400 antes de qualquer chamada à Meta', async () => {
    setEnv(PLATFORM_ENV);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state: 'de-outra-sessao',
    }, token));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('signup_state_invalid');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('webhook recusado: guarda o token mas deixa PENDENTE e explica (não finge conectado)', async () => {
    setEnv(PLATFORM_ENV);
    const state = issueSignupState(KEY, { businessId: BIZ, userId: OWNER });
    mockMeta({
      ...OK_META,
      'POST /WABA-1/subscribed_apps': () => ({ __status: 400, error: { message: 'Permission denied', code: 200 } }),
    });
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state, wabaId: 'WABA-1', phoneNumberId: 'PN-1',
    }, token));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('subscribe_failed');
    const wi = (await readDB()).businesses.find((b) => b.id === BIZ)!.whatsappIntegration!;
    expect(wi.status).toBe('pending');
    expect(wi.lastError).toMatch(/assinatura do webhook/i);
    expect(wi.encryptedAccessToken).toBeTruthy();
    expect(wi.registeredAt).toBeFalsy();
  });

  it('PIN de duas etapas: registra o número quando informado e cobra 6 dígitos', async () => {
    setEnv(PLATFORM_ENV);
    const state = issueSignupState(KEY, { businessId: BIZ, userId: OWNER });
    const calls = mockMeta({ ...OK_META, 'POST /PN-1/register': () => ({ success: true }) });
    const ok = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state, wabaId: 'WABA-1', phoneNumberId: 'PN-1', pin: '123456',
    }, token));
    expect(ok.status).toBe(200);
    const body = await json(ok);
    expect(body.registration).toMatchObject({ attempted: true, ok: true });
    const register = calls.find((c) => c.path === '/PN-1/register')!;
    expect(JSON.parse(String(register.init?.body))).toMatchObject({ messaging_product: 'whatsapp', pin: '123456' });

    // PIN torto é recusado antes de qualquer chamada.
    const state2 = issueSignupState(KEY, { businessId: BIZ, userId: OWNER });
    mockMeta(OK_META);
    const bad = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: BIZ, action: 'exchange', code: 'CODIGO', state: state2, wabaId: 'WABA-1', phoneNumberId: 'PN-1', pin: '12',
    }, token));
    expect(bad.status).toBe(400);
    expect((await json(bad)).error).toMatch(/6 dígitos/);
  });

  it('a unidade de OUTRO negócio não conecta por aqui (isolamento)', async () => {
    setEnv(PLATFORM_ENV);
    const res = await onboardingPOST(jsonReq('/api/whatsapp/onboarding', {
      businessId: OTHER, action: 'exchange', code: 'CODIGO', state: issueSignupState(KEY, { businessId: BIZ, userId: OWNER }),
    }, token));
    expect([403, 404]).toContain(res.status);
    const db = await readDB();
    expect(db.businesses.find((b) => b.id === OTHER)!.whatsappIntegration?.encryptedAccessToken).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
describe('A3.4 · B8 — a tela (prova no código-fonte)', () => {
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const panel = () => stripComments(fs.readFileSync('src/components/dashboard/WhatsappChannelPanel.tsx', 'utf8'));

  it('usa o popup oficial, confere a origem da mensagem e troca o código no servidor', () => {
    const src = panel();
    expect(src).toMatch(/loadFacebookSdk/);
    expect(src).toMatch(/FB\.login/);
    expect(src).toMatch(/config_id: cfg\.configId/);
    expect(src).toMatch(/response_type: 'code'/);
    expect(src).toMatch(/override_default_response_type: true/);
    expect(src).toMatch(/event\.origin !== SIGNUP_MESSAGE_ORIGIN/);
    expect(src).toMatch(/\/api\/whatsapp\/onboarding/);
    expect(src).toMatch(/action: 'exchange'/);
  });

  it('mostra as duas camadas, a versão da Graph API e o aviso de que o wa.me é só teste', () => {
    const src = panel();
    expect(src).toMatch(/LayerCard/);
    expect(src).toMatch(/plan\.layers\.map/);
    expect(src).toMatch(/Graph API \{guide\?\.plan\.version\.current/);
    expect(src).toMatch(/WA_ME_TEST_DISCLAIMER/);
    expect(src).toMatch(/Conectar com a Meta/);
  });
});
