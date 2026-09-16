import { describe, expect, it, vi } from 'vitest';
import { emptyDB } from '../db';
import {
  createApiKey, revokeApiKey, authenticateKey, listApiKeys,
  hashApiKey,
} from '../api-keys';
import {
  upsertWebhook, deleteWebhook, signWebhookPayload,
  verifyWebhookSignature, dispatchWebhook, maskWebhookSecret,
  sanitizeWebhookForDisplay, executeDeliveryAttempt,
  processPendingWebhookDeliveries, retryWebhookDelivery,
  isRetryableWebhookStatus,
} from '../webhooks';
import {
  checkIdempotency, saveIdempotency, extractIdempotencyKey,
} from '../idempotency';
import { pushIntegrationLog } from '../integration-logs';
import type { Business, DB, Organization, WebhookConfig, WebhookDelivery } from '../types';

function mockUnit(id: string, orgId: string): Business {
  return {
    id,
    organizationId: orgId,
    ownerId: 'u-owner',
    name: `Unidade ${id}`,
    slug: id,
    description: '',
    logo: '',
    cover: '',
    niche: 'saude',
    modes: ['services', 'bookings'],
    phone: '11999990000',
    whatsapp: '11999990000',
    email: 'unit@test.com',
    instagram: '',
    tiktok: '',
    address: '',
    mapsUrl: '',
    hours: {},
    paymentMethods: [],
    pixKey: '',
    deliveryFee: 0,
    minOrder: 0,
    googleUrl: '',
    googlePlaceId: '',
    googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 60, bufferMin: 0 },
    nav: [],
    navCustom: false,
    about: { title: '', text: '', image: '', enabled: false },
    published: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe('P3 API Keys — Geração, Validação e Revogação', () => {
  it('gera chave com prefixo ik_live_, armazena apenas hash e exibe segredo uma única vez', () => {
    const db = emptyDB();
    db.businesses.push(mockUnit('biz-a', 'org-1'));

    const { apiKey, fullSecret } = createApiKey(db, 'biz-a', 'Integração Site Principal', 'u-owner');

    expect(fullSecret.startsWith('ik_live_')).toBe(true);
    expect(fullSecret.length).toBeGreaterThan(30);

    expect(apiKey.keyPrefix.startsWith('ik_live_')).toBe(true);
    expect(apiKey.keyHash).toBe(hashApiKey(fullSecret));
    expect((apiKey as any).secret).toBeUndefined(); // Nunca guarda segredo puro

    // Autenticação bem sucedida
    const auth = authenticateKey(db, fullSecret);
    expect(auth).not.toBeNull();
    expect(auth?.business.id).toBe('biz-a');
    expect(auth?.apiKey.id).toBe(apiKey.id);
  });

  it('revoga chave imediatamente e impede autenticação', () => {
    const db = emptyDB();
    db.businesses.push(mockUnit('biz-a', 'org-1'));

    const { apiKey, fullSecret } = createApiKey(db, 'biz-a', 'Key Temporária');
    expect(authenticateKey(db, fullSecret)).not.toBeNull();

    const ok = revokeApiKey(db, 'biz-a', apiKey.id);
    expect(ok).toBe(true);

    // Chave revogada falha imediatamente
    expect(authenticateKey(db, fullSecret)).toBeNull();
  });

  it('listApiKeys não expõe o hash criptográfico', () => {
    const db = emptyDB();
    db.businesses.push(mockUnit('biz-a', 'org-1'));
    createApiKey(db, 'biz-a', 'Key 1');

    const list = listApiKeys(db, 'biz-a');
    expect(list.length).toBe(1);
    expect((list[0] as any).keyHash).toBeUndefined();
    expect(list[0].keyPrefix).toBeDefined();
  });
});

describe('P3 Tenant Isolation & Organization Isolation', () => {
  it('chave de Business A NUNCA concede acesso a Business B, mesmo da mesma Organization', () => {
    const db = emptyDB();
    db.businesses.push(mockUnit('unit-1', 'org-matrix'));
    db.businesses.push(mockUnit('unit-2', 'org-matrix'));

    const { fullSecret: keyUnit1 } = createApiKey(db, 'unit-1', 'Key Unidade 1');
    const { fullSecret: keyUnit2 } = createApiKey(db, 'unit-2', 'Key Unidade 2');

    const auth1 = authenticateKey(db, keyUnit1);
    const auth2 = authenticateKey(db, keyUnit2);

    expect(auth1?.business.id).toBe('unit-1');
    expect(auth2?.business.id).toBe('unit-2');

    // unit-1 nunca resolve unit-2
    expect(auth1?.business.id).not.toBe('unit-2');
  });

  it('chave de Business A de Org A não acessa Business B de Org B', () => {
    const db = emptyDB();
    db.businesses.push(mockUnit('biz-alfa', 'org-alfa'));
    db.businesses.push(mockUnit('biz-beta', 'org-beta'));

    const { fullSecret: keyAlfa } = createApiKey(db, 'biz-alfa', 'Key Alfa');

    const auth = authenticateKey(db, keyAlfa);
    expect(auth?.business.id).toBe('biz-alfa');
    expect(auth?.business.organizationId).toBe('org-alfa');
  });
});

describe('P3 Webhooks — Assinatura, Validação e Replay', () => {
  it('gera assinatura HMAC-SHA256 correta e valida payload íntegro', () => {
    const secret = 'whsec_test_secret_1234567890';
    const payload = JSON.stringify({ event: 'lead.created', leadId: 'lead-01' });
    const timestamp = Math.floor(Date.now() / 1000);

    const sig = signWebhookPayload(secret, payload, timestamp);
    const header = `t=${timestamp},v1=${sig}`;

    const res = verifyWebhookSignature(secret, payload, header, timestamp, 300);
    expect(res.valid).toBe(true);
  });

  it('rejeita segredo incorreto ou payload alterado (spoofing)', () => {
    const secret = 'whsec_correto_123';
    const payload = JSON.stringify({ event: 'lead.created' });
    const timestamp = Math.floor(Date.now() / 1000);

    const sig = signWebhookPayload(secret, payload, timestamp);
    const header = `t=${timestamp},v1=${sig}`;

    // Segredo errado
    expect(verifyWebhookSignature('whsec_errado_999', payload, header, timestamp).valid).toBe(false);

    // Payload alterado
    const tampered = JSON.stringify({ event: 'lead.created', hacker: true });
    expect(verifyWebhookSignature(secret, tampered, header, timestamp).valid).toBe(false);
  });

  it('rejeita requisições com timestamp fora da tolerância (prevenção contra replay)', () => {
    const secret = 'whsec_test_123';
    const payload = '{}';
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutos atrás

    const sig = signWebhookPayload(secret, payload, oldTimestamp);
    const header = `t=${oldTimestamp},v1=${sig}`;

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const res = verifyWebhookSignature(secret, payload, header, currentTimestamp, 300);
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('expirada');
  });

  it('permite cadastrar e remover webhooks com eventos selecionados', () => {
    const db = emptyDB();
    const hook = upsertWebhook(db, 'biz-1', {
      url: 'https://exemplo.com/webhook',
      events: ['lead.created', 'booking.created'],
    });

    expect(hook.id).toBeDefined();
    expect(hook.events).toEqual(['lead.created', 'booking.created']);
    expect(db.webhooks.length).toBe(1);

    const removed = deleteWebhook(db, 'biz-1', hook.id);
    expect(removed).toBe(true);
    expect(db.webhooks.length).toBe(0);
  });

  it('protege o secret do webhook nunca expondo o segredo completo após criação', () => {
    const secret = 'whsec_999888777666555444333222111000aa';
    const masked = maskWebhookSecret(secret);

    expect(masked.startsWith('whsec_••••••••')).toBe(true);
    expect(masked.endsWith('00aa')).toBe(true);
    expect(masked).not.toContain('999888777');

    const config: WebhookConfig = {
      id: 'wh-1',
      businessId: 'biz-1',
      url: 'https://cliente.com/webhook',
      secret,
      events: ['lead.created'],
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const safe = sanitizeWebhookForDisplay(config);
    expect((safe as any).secret).toBeUndefined();
    expect(safe.secretMasked).toBe(masked);
    expect(safe.url).toBe(config.url);
    expect(safe.events).toEqual(['lead.created']);
  });
});

describe('P3 Webhooks — Retry Controlado, Idempotência e Histórico', () => {
  it('identifica corretamente status passíveis de retry (timeout, 429, 5xx vs 4xx permanente)', () => {
    expect(isRetryableWebhookStatus(0)).toBe(true); // Erro de rede ou timeout
    expect(isRetryableWebhookStatus(429)).toBe(true); // Rate limit
    expect(isRetryableWebhookStatus(500)).toBe(true); // Internal Server Error
    expect(isRetryableWebhookStatus(502)).toBe(true); // Bad Gateway
    expect(isRetryableWebhookStatus(503)).toBe(true); // Service Unavailable
    expect(isRetryableWebhookStatus(504)).toBe(true); // Gateway Timeout

    expect(isRetryableWebhookStatus(400)).toBe(false); // Bad Request (erro cliente)
    expect(isRetryableWebhookStatus(401)).toBe(false); // Unauthorized
    expect(isRetryableWebhookStatus(403)).toBe(false); // Forbidden
    expect(isRetryableWebhookStatus(404)).toBe(false); // Not Found
    expect(isRetryableWebhookStatus(422)).toBe(false); // Unprocessable Entity
  });

  it('falha transitória (503) agenda retry com mesmo eventId e registra histórico', async () => {
    const db = emptyDB();
    upsertWebhook(db, 'biz-1', {
      url: 'https://servidor-instavel.com/webhook',
      events: ['lead.created'],
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    const deliveries = await dispatchWebhook(
      db,
      'lead.created',
      'biz-1',
      { leadId: 'lead-01', name: 'Carlos' },
      mockFetch as any,
    );

    expect(deliveries.length).toBe(1);
    const d = deliveries[0];
    expect(d.status).toBe('pending');
    expect(d.attempts).toBe(1);
    expect(d.maxAttempts).toBe(3);
    expect(d.nextRetryAt).toBeDefined();
    expect(d.error).toContain('503');
    expect(d.attemptsHistory.length).toBe(1);
    expect(d.attemptsHistory[0].attempt).toBe(1);
    expect(d.attemptsHistory[0].statusCode).toBe(503);

    const initialEventId = d.eventId;
    expect(initialEventId.startsWith('evt_')).toBe(true);

    // Tentativa 2: falha novamente com 500
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Error',
    });

    const retried1 = await retryWebhookDelivery(db, d.id, mockFetch as any);
    expect(retried1?.status).toBe('pending');
    expect(retried1?.attempts).toBe(2);
    expect(retried1?.eventId).toBe(initialEventId); // Preserva o MESMO eventId!
    expect(retried1?.attemptsHistory.length).toBe(2);

    // Tentativa 3: agora o receptor se recupera e retorna 200 OK!
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: 'OK',
    });

    const retried2 = await retryWebhookDelivery(db, d.id, mockFetch as any);
    expect(retried2?.status).toBe('success');
    expect(retried2?.attempts).toBe(3);
    expect(retried2?.deliveredAt).toBeDefined();
    expect(retried2?.nextRetryAt).toBeUndefined(); // Limpa agendamento
    expect(retried2?.eventId).toBe(initialEventId); // Preserva o MESMO eventId para idempotência
    expect(retried2?.attemptsHistory.length).toBe(3);
  });

  it('respeita o teto de 3 tentativas e transiciona para falha definitiva sem retry infinito', async () => {
    const db = emptyDB();
    upsertWebhook(db, 'biz-1', {
      url: 'https://servidor-offline.com/webhook',
      events: ['booking.created'],
    });

    const mockFetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const [d] = await dispatchWebhook(
      db,
      'booking.created',
      'biz-1',
      { bookingId: 'b-01' },
      mockFetch as any,
    );

    expect(d.attempts).toBe(1);
    expect(d.status).toBe('pending');

    // Tentativa 2
    await retryWebhookDelivery(db, d.id, mockFetch as any);
    expect(d.attempts).toBe(2);
    expect(d.status).toBe('pending');

    // Tentativa 3 (última permitida)
    await retryWebhookDelivery(db, d.id, mockFetch as any);
    expect(d.attempts).toBe(3);
    expect(d.status).toBe('failed'); // Falha definitiva
    expect(d.nextRetryAt).toBeUndefined();

    // Nova chamada não deve disparar tentativa excedente
    const countBefore = mockFetch.mock.calls.length;
    await processPendingWebhookDeliveries(db, new Date(Date.now() + 9999999).toISOString(), mockFetch as any);
    expect(mockFetch.mock.calls.length).toBe(countBefore);
  });

  it('erro não-retryável (ex: 404 Not Found) falha imediatamente sem agendar retries inúteis', async () => {
    const db = emptyDB();
    upsertWebhook(db, 'biz-1', {
      url: 'https://endpoint-removido.com/404',
      events: ['lead.stage_changed'],
    });

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const [d] = await dispatchWebhook(
      db,
      'lead.stage_changed',
      'biz-1',
      { leadId: 'l1', stage: 'qualified' },
      mockFetch as any,
    );

    expect(d.attempts).toBe(1);
    expect(d.status).toBe('failed'); // Falha imediata para 4xx
    expect(d.nextRetryAt).toBeUndefined();
  });
});

describe('P3 Idempotência', () => {
  it('salva e recupera resposta idempotente para a mesma chave e endpoint', () => {
    const db = emptyDB();
    const key = 'idem_key_abc_123';
    const endpoint = '/api/external/leads';

    expect(checkIdempotency(db, 'biz-1', key, endpoint)).toBeNull();

    const mockResponse = { ok: true, lead: { id: 'l1', name: 'Carlos' } };
    saveIdempotency(db, 'biz-1', key, endpoint, 201, mockResponse);

    const cached = checkIdempotency(db, 'biz-1', key, endpoint);
    expect(cached).not.toBeNull();
    expect(cached?.statusCode).toBe(201);
    expect(cached?.responseBody).toEqual(mockResponse);

    // Mesma chave para endpoint ou negócio diferente não colide
    expect(checkIdempotency(db, 'biz-2', key, endpoint)).toBeNull();
    expect(checkIdempotency(db, 'biz-1', key, '/api/external/bookings')).toBeNull();
  });

  it('extrai corretamente header Idempotency-Key ou X-Idempotency-Key', () => {
    const h1 = new Headers({ 'idempotency-key': 'chv-01' });
    expect(extractIdempotencyKey(h1)).toBe('chv-01');

    const h2 = new Headers({ 'x-idempotency-key': 'chv-02' });
    expect(extractIdempotencyKey(h2)).toBe('chv-02');
  });
});

describe('P3 Observabilidade de Integrações', () => {
  it('registra operações sem armazenar segredos nem dados sensíveis', () => {
    const db = emptyDB();
    const log = pushIntegrationLog(db, {
      businessId: 'biz-1',
      endpoint: '/api/external/leads',
      method: 'POST',
      source: 'api',
      status: 201,
    });

    expect(log.id).toBeDefined();
    expect(log.operationId).toBeDefined();
    expect(log.endpoint).toBe('/api/external/leads');
    expect(log.status).toBe(201);
    expect((log as any).secret).toBeUndefined();
    expect((log as any).apiKey).toBeUndefined();
    expect(db.integrationLogs.length).toBe(1);
  });
});
