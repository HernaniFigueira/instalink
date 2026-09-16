// ═══════════════════════════════════════════════════════════════
// CONSUMIDOR AUTOMÁTICO DA FILA DE RETRY DE WEBHOOKS (P3)
// ═══════════════════════════════════════════════════════════════
// Prova que a fila deixou de depender de chamada manual:
//  - entrega vencida é processada; entrega futura não;
//  - `failed` e `success` nunca voltam para a fila (sem retry infinito);
//  - o mesmo eventId (e a mesma assinatura) sobrevive às tentativas;
//  - duas execuções concorrentes NÃO entregam a mesma tentativa duas vezes;
//  - o endpoint do cron exige autenticação e nunca expõe segredo.
//
// O primeiro import é obrigatório: ele isola o banco em arquivo temporário
// (data/instalink.db.json do desenvolvedor nunca é tocado).
import './helpers/temp-db';

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, updateDB, writeDB } from '../db';
import * as webhooksLib from '../webhooks';
import {
  claimPendingWebhookDeliveries,
  countDueWebhookDeliveries,
  dispatchWebhook,
  isWebhookClaimLive,
  isWebhookDeliveryDue,
  processPendingWebhookDeliveries,
  verifyWebhookSignature,
  WEBHOOK_RETRY_CLAIM_LEASE_MS,
} from '../webhooks';
import { constantTimeEquals, extractCronBearer, verifyCronAuth } from '../cron-auth';
import { GET as cronWebhooksGET } from '@/app/api/cron/webhooks/route';
import { TEMP_DB_FILE } from './helpers/temp-db';
import type { DB, WebhookDelivery } from '../types';

// Segredo propositalmente único: qualquer vazamento na resposta é detectável.
const SECRET = 'whsec_segredo_de_teste_4f3a2b1c9d8e';
const CRON_SECRET = 'cron-secret-de-teste-1234567890';
const HOOK_URL = 'https://receptor.teste/webhook';
const EVENT_ID = 'evt_estavel_123456';

// O agendamento do próximo retry usa o relógio REAL (executeDeliveryAttempt
// chama new Date()). Estes testes, portanto, semeiam e avançam sempre em
// relação a Date.now(); o "agora" injetado (nowISO) só decide ELEGIBILIDADE.
const iso = (offsetMs: number, from = Date.now()) => new Date(from + offsetMs).toISOString();
const atMs = (value?: string) => new Date(value || 0).getTime();

function expectAround(actual: number, expected: number, toleranceMs = 5_000): void {
  expect(actual).toBeGreaterThanOrEqual(expected - toleranceMs);
  expect(actual).toBeLessThanOrEqual(expected + toleranceMs);
}

function makeDelivery(overrides: Partial<WebhookDelivery> = {}): WebhookDelivery {
  return {
    id: 'whd-1',
    webhookId: 'wh-1',
    businessId: 'biz-1',
    event: 'lead.created',
    eventId: EVENT_ID,
    url: HOOK_URL,
    payloadSummary: { lead: { id: 'lead-1', name: 'Cliente Teste' } },
    status: 'pending',
    attempts: 1,
    maxAttempts: 3,
    nextRetryAt: iso(-60_000), // vencida há 1 minuto
    attemptsHistory: [
      { attempt: 1, at: iso(-90_000), statusCode: 500, error: 'HTTP 500: Erro temporário', durationMs: 4 },
    ],
    createdAt: iso(-90_000),
    updatedAt: iso(-90_000),
    ...overrides,
  };
}

function makeDb(delivery: WebhookDelivery | null, hookActive = true): DB {
  const db = emptyDB();
  db.webhooks.push({
    id: 'wh-1',
    businessId: 'biz-1',
    url: HOOK_URL,
    events: ['lead.created'],
    active: hookActive,
    secret: SECRET,
    createdAt: iso(-120_000),
    updatedAt: iso(-120_000),
  });
  if (delivery) db.webhookDeliveries.push(delivery);
  return db;
}

/** Semeia o banco ISOLADO (arquivo temporário) usado pelo consumidor real. */
async function seedStore(delivery: WebhookDelivery | null, hookActive = true): Promise<void> {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await writeDB(makeDb(delivery, hookActive));
}

const okFetch = () => vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
const failFetch = (status = 500) =>
  vi.fn().mockResolvedValue({ ok: false, status, statusText: 'Internal Server Error' });

function cronRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/cron/webhooks', { headers });
}

async function runCron(authorization: string) {
  return cronWebhooksGET(cronRequest({ authorization }));
}

beforeEach(() => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────
describe('Fila de retry — elegibilidade', () => {
  it('processa entrega pending vencida e preserva o eventId', async () => {
    const db = makeDb(makeDelivery());
    const fetchMock = okFetch();
    const startedAt = Date.now();

    const processed = await processPendingWebhookDeliveries(db, iso(0), fetchMock as any);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(processed).toHaveLength(1);

    const delivery = db.webhookDeliveries[0];
    expect(delivery.status).toBe('success');
    expect(delivery.attempts).toBe(2);
    expect(atMs(delivery.deliveredAt)).toBeGreaterThanOrEqual(startedAt);
    expect(delivery.nextRetryAt).toBeUndefined();
    expect(delivery.eventId).toBe(EVENT_ID); // MESMO evento lógico na tentativa 2
    expect(delivery.attemptsHistory).toHaveLength(2);
    expect(delivery.claimToken).toBeUndefined(); // posse liberada ao fim do ciclo
    expect(delivery.claimExpiresAt).toBeUndefined();
  });

  it('não processa entrega cujo nextRetryAt ainda não venceu', async () => {
    const db = makeDb(makeDelivery({ nextRetryAt: iso(5 * 60_000) }));
    const fetchMock = okFetch();

    const processed = await processPendingWebhookDeliveries(db, iso(0), fetchMock as any);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(processed).toHaveLength(0);
    expect(db.webhookDeliveries[0].status).toBe('pending');
    expect(db.webhookDeliveries[0].attempts).toBe(1);
    expect(countDueWebhookDeliveries(db, iso(0))).toBe(0);
  });

  it('não reprocessa entrega failed (nada de retry infinito)', async () => {
    const db = makeDb(
      makeDelivery({ status: 'failed', attempts: 3, nextRetryAt: iso(-10 * 60_000) }),
    );
    const fetchMock = okFetch();

    const processed = await processPendingWebhookDeliveries(db, iso(0), fetchMock as any);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(processed).toHaveLength(0);
    expect(db.webhookDeliveries[0].status).toBe('failed');
    expect(db.webhookDeliveries[0].attempts).toBe(3);
    expect(isWebhookDeliveryDue(db.webhookDeliveries[0], iso(365 * 86400_000))).toBe(false);
  });

  it('não reprocessa entrega já entregue (success)', async () => {
    const deliveredAt = iso(-1000);
    const db = makeDb(
      makeDelivery({ status: 'success', attempts: 2, nextRetryAt: undefined, deliveredAt }),
    );
    const fetchMock = okFetch();

    const processed = await processPendingWebhookDeliveries(db, iso(0), fetchMock as any);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(processed).toHaveLength(0);
    expect(db.webhookDeliveries[0].attempts).toBe(2);
    expect(db.webhookDeliveries[0].deliveredAt).toBe(deliveredAt);
  });

  it('mantém o mesmo eventId e a assinatura HMAC válida nas tentativas', async () => {
    // Tentativa 2 vencida (a 1ª já falhou e agendou o retry no evento).
    const db = makeDb(makeDelivery());
    const fetchMock = failFetch(500);

    await processPendingWebhookDeliveries(db, iso(0), fetchMock as any);
    // Backoff da 2ª falha: a tentativa 3 só vence ~120s depois (relógio real).
    await processPendingWebhookDeliveries(db, iso(125_000), fetchMock as any);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls as any[]) {
      expect(url).toBe(HOOK_URL);
      const body = JSON.parse(init.body);
      expect(body.id).toBe(EVENT_ID);
      expect(init.headers['X-Instalink-Event-Id']).toBe(EVENT_ID);
      expect(verifyWebhookSignature(SECRET, init.body, init.headers['X-Instalink-Signature']).valid).toBe(true);
    }
    expect((fetchMock.mock.calls[0][1] as any).headers['X-Instalink-Attempt']).toBe('2');
    expect((fetchMock.mock.calls[1][1] as any).headers['X-Instalink-Attempt']).toBe('3');

    const delivery = db.webhookDeliveries[0];
    expect(delivery.eventId).toBe(EVENT_ID);
    expect(delivery.attempts).toBe(3);
    expect(delivery.status).toBe('failed'); // teto de tentativas respeitado
  });

  it('respeita posse viva de outra execução e libera quando o lease expira', async () => {
    const db = makeDb(makeDelivery({ claimToken: 'run_outra_instancia', claimExpiresAt: iso(30_000) }));
    const fetchMock = okFetch();

    // Posse viva: nem a seleção nem a reivindicação enxergam a entrega.
    expect(isWebhookClaimLive(db.webhookDeliveries[0], iso(0))).toBe(true);
    expect(countDueWebhookDeliveries(db, iso(0))).toBe(0);
    expect(claimPendingWebhookDeliveries(db, { nowISO: iso(0), holder: 'run_meu' })).toHaveLength(0);
    expect(await processPendingWebhookDeliveries(db, iso(0), fetchMock as any)).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();

    // Posse expirada (a execução anterior morreu): a entrega volta para a fila.
    const expired = makeDelivery({ claimToken: 'run_outra_instancia', claimExpiresAt: iso(-1000) });
    const db2 = makeDb(expired);
    expect(isWebhookClaimLive(expired, iso(0))).toBe(false);
    expect(await processPendingWebhookDeliveries(db2, iso(0), fetchMock as any)).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db2.webhookDeliveries[0].attempts).toBe(2);
  });

  it('encerra como failed a entrega cujo webhook foi desativado (comportamento do P3)', async () => {
    const db = makeDb(makeDelivery(), false);
    const fetchMock = okFetch();

    const processed = await processPendingWebhookDeliveries(db, iso(0), fetchMock as any);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(processed).toHaveLength(1);
    expect(db.webhookDeliveries[0].status).toBe('failed');
    expect(db.webhookDeliveries[0].nextRetryAt).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
describe('Consumidor automático no banco real (o que o cron executa)', () => {
  it('processa a fila vencida, grava o resultado e limpa a posse', async () => {
    await seedStore(makeDelivery());
    const fetchMock = okFetch();

    const processed = await processPendingWebhookDeliveries({ fetchFn: fetchMock as any });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(processed).toHaveLength(1);
    expect(processed[0].status).toBe('success');

    const stored = (await readDB()).webhookDeliveries[0];
    expect(stored.status).toBe('success');
    expect(stored.attempts).toBe(2);
    expect(stored.eventId).toBe(EVENT_ID);
    expect(stored.claimToken).toBeUndefined();
    expect(stored.claimExpiresAt).toBeUndefined();
    expect(stored.nextRetryAt).toBeUndefined();
  });

  it('não toca em entregas futuras nem em entregas encerradas', async () => {
    const db = makeDb(makeDelivery({ nextRetryAt: iso(10 * 60_000) }));
    db.webhookDeliveries.push(
      makeDelivery({ id: 'whd-failed', status: 'failed', attempts: 3, nextRetryAt: iso(-5000) }),
      makeDelivery({ id: 'whd-done', status: 'success', attempts: 2, nextRetryAt: undefined }),
    );
    await writeDB(db);
    const fetchMock = okFetch();

    const processed = await processPendingWebhookDeliveries({ fetchFn: fetchMock as any });

    expect(processed).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    const stored = (await readDB()).webhookDeliveries;
    expect(stored.map((d) => d.status)).toEqual(['pending', 'failed', 'success']);
    expect(stored.map((d) => d.attempts)).toEqual([1, 3, 2]);
  });

  it('a entrega nasce PERSISTIDA com nextRetryAt (callback assíncrono do updateDB)', async () => {
    // Regressão: o disparo acontece dentro de `updateDB(async …)`. Se a escrita
    // ocorrer antes do fim do callback, a entrega reivindicada pelo cron nunca
    // existiria no banco — a fila ficaria permanentemente vazia.
    await seedStore(null as unknown as WebhookDelivery); // só o webhook
    const fetchMock = failFetch(500);
    const t0 = Date.now();

    await updateDB(async (db) => {
      await dispatchWebhook(db, 'lead.created', 'biz-1', { lead: { id: 'lead-1' } }, fetchMock as any);
    });

    const stored = (await readDB()).webhookDeliveries;
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe('pending');
    expect(stored[0].attempts).toBe(1);
    expectAround(atMs(stored[0].nextRetryAt) - t0, 30_000);
    expect(stored[0].eventId.startsWith('evt_')).toBe(true);

    // E o consumidor automático consegue drenar essa mesma entrega depois.
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    const processed = await processPendingWebhookDeliveries({ nowISO: iso(31_000, t0), fetchFn: fetchMock as any });
    expect(processed.map((d) => d.status)).toEqual(['success']);
    expect((await readDB()).webhookDeliveries[0].status).toBe('success');
  });

  it('duas execuções concorrentes entregam a MESMA tentativa uma única vez', async () => {
    await seedStore(makeDelivery());
    const fetchMock = okFetch();

    const [runA, runB] = await Promise.all([
      processPendingWebhookDeliveries({ fetchFn: fetchMock as any }),
      processPendingWebhookDeliveries({ fetchFn: fetchMock as any }),
    ]);

    // Uma única requisição externa: a segunda execução desiste na posse viva.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(runA.length + runB.length).toBe(1);

    const stored = (await readDB()).webhookDeliveries[0];
    expect(stored.attempts).toBe(2);
    expect(stored.status).toBe('success');
    expect(stored.attemptsHistory).toHaveLength(2);
    expect(stored.claimToken).toBeUndefined();
  });

  it('respeita o teto de 3 tentativas e termina em failed (sem 4ª tentativa)', async () => {
    await seedStore(makeDelivery());
    const fetchMock = failFetch(503);
    const t0 = Date.now();

    // Tentativa 2 (vencida agora): falha retryable → reagenda no backoff do P3.
    await processPendingWebhookDeliveries({ nowISO: iso(0, t0), fetchFn: fetchMock as any });
    let stored = (await readDB()).webhookDeliveries[0];
    expect(stored.attempts).toBe(2);
    expect(stored.status).toBe('pending');
    expectAround(atMs(stored.nextRetryAt) - t0, 120_000);

    // Antes da hora (1 min depois): nada acontece.
    await processPendingWebhookDeliveries({ nowISO: iso(60_000, t0), fetchFn: fetchMock as any });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Tentativa 3: última permitida → falha definitiva.
    await processPendingWebhookDeliveries({ nowISO: iso(130_000, t0), fetchFn: fetchMock as any });
    stored = (await readDB()).webhookDeliveries[0];
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(stored.attempts).toBe(3);
    expect(stored.status).toBe('failed');
    expect(stored.nextRetryAt).toBeUndefined();

    // Muito depois: nenhuma tentativa extra (nenhum retry infinito).
    await processPendingWebhookDeliveries({ nowISO: iso(30 * 86400_000, t0), fetchFn: fetchMock as any });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stored = (await readDB()).webhookDeliveries[0];
    expect(stored.attempts).toBe(3);
    expect(stored.status).toBe('failed');
  });

  it('fluxo real: evento → falha retryable → pending → cron → success', async () => {
    const fetchMock = failFetch(500);
    const t0 = Date.now();

    // 1) EVENTO: a tentativa 1 acontece no disparo e agenda a tentativa 2 em 30s.
    const db = makeDb(null); // só o webhook: o evento cria a entrega (tentativa 1)
    await dispatchWebhook(db, 'lead.created', 'biz-1', { lead: { id: 'lead-1' } }, fetchMock as any);
    const scheduled = db.webhookDeliveries[0];
    const eventId = scheduled.eventId; // identidade do evento lógico
    expect(eventId.startsWith('evt_')).toBe(true);
    expect(scheduled.attempts).toBe(1);
    expect(scheduled.status).toBe('pending');
    expectAround(atMs(scheduled.nextRetryAt) - t0, 30_000); // backoff do P3 preservado
    await writeDB(db);

    // 2) CRON antes da hora: a entrega continua pendente, sem nova requisição.
    await processPendingWebhookDeliveries({ nowISO: iso(10_000, t0), fetchFn: fetchMock as any });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 3) CRON depois do vencimento, com o receptor de volta ao ar: entrega OK,
    //    MESMO eventId e assinatura válida na tentativa 2.
    fetchMock.mockImplementation(async () => ({ ok: true, status: 200, statusText: 'OK' }));
    const processed = await processPendingWebhookDeliveries({
      nowISO: iso(31_000, t0),
      fetchFn: fetchMock as any,
    });
    expect(processed.map((d) => d.status)).toEqual(['success']);

    const stored = (await readDB()).webhookDeliveries[0];
    expect(stored.status).toBe('success');
    expect(stored.attempts).toBe(2);
    expect(stored.eventId).toBe(eventId); // MESMO evento na tentativa 2
    expect(stored.nextRetryAt).toBeUndefined();
    expect(stored.claimToken).toBeUndefined();
    const retryBody = JSON.parse((fetchMock.mock.calls[1][1] as any).body);
    expect(retryBody.id).toBe(eventId);
    expect((fetchMock.mock.calls[1][1] as any).headers['X-Instalink-Event-Id']).toBe(eventId);
    // A tentativa 1 (no evento) usou exatamente o mesmo eventId:
    expect(JSON.parse((fetchMock.mock.calls[0][1] as any).body).id).toBe(eventId);
    expect((fetchMock.mock.calls[1][1] as any).headers['X-Instalink-Attempt']).toBe('2');
    expect(
      verifyWebhookSignature(SECRET, (fetchMock.mock.calls[1][1] as any).body, (fetchMock.mock.calls[1][1] as any).headers['X-Instalink-Signature']).valid,
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
describe('Endpoint do cron (/api/cron/webhooks)', () => {
  it('sem CRON_SECRET o consumidor fica DESATIVADO (fail-closed, nunca aberto)', async () => {
    vi.stubEnv('CRON_SECRET', '');
    await seedStore(makeDelivery());
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    const anon = await cronWebhooksGET(cronRequest());
    expect(anon.status).toBe(503);
    expect((await anon.json()).ok).toBe(false);

    const withBogusSecret = await cronWebhooksGET(cronRequest({ authorization: 'Bearer qualquer-coisa' }));
    expect(withBogusSecret.status).toBe(503);

    // Nada foi entregue e a rota nunca respondeu 2xx.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exige autenticação: sem header, vazio ou com segredo errado responde 401', async () => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET);
    await seedStore(makeDelivery());
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);

    expect((await cronWebhooksGET(cronRequest())).status).toBe(401);
    expect((await runCron('Bearer cron-secret-errado')).status).toBe(401);
    expect((await runCron('Bearer ')).status).toBe(401);
    expect((await runCron(`Token ${CRON_SECRET}`)).status).toBe(401);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('execução válida chama processPendingWebhookDeliveries() e devolve contadores', async () => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET);
    await seedStore(makeDelivery());
    const fetchMock = okFetch();
    vi.stubGlobal('fetch', fetchMock);
    const spy = vi.spyOn(webhooksLib, 'processPendingWebhookDeliveries');

    const res = await runCron(`Bearer ${CRON_SECRET}`);
    const body = await res.json();

    // A rota NÃO contém regra de retry: ela autentica e delega ao processador
    // central (sem argumentos = modo produção, lê o banco real).
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual([]);

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1); // a entrega vencida virou tentativa real
    expect(body).toMatchObject({ ok: true, processed: 1, delivered: 1, rescheduled: 0, failed: 0 });
    expect(typeof body.ranAt).toBe('string');
    expect(typeof body.durationMs).toBe('number');

    const stored = (await readDB()).webhookDeliveries[0];
    expect(stored.status).toBe('success');
    expect(stored.attempts).toBe(2);
  });

  it('resposta do cron não expõe segredo, assinatura, payload nem estado interno', async () => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET);
    await seedStore(makeDelivery());
    vi.stubGlobal('fetch', failFetch(500));

    const res = await runCron(`Bearer ${CRON_SECRET}`);
    const raw = JSON.stringify(await res.json());

    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('whsec');
    expect(raw).not.toContain('4f3a2b1c9d8e');
    expect(raw).not.toContain('X-Instalink-Signature');
    expect(raw).not.toContain('claimToken');
    expect(raw).not.toContain(HOOK_URL);
    expect(raw).not.toContain('t=');
    expect(Object.keys(JSON.parse(raw)).sort()).toEqual(
      ['delivered', 'durationMs', 'failed', 'ok', 'processed', 'ranAt', 'rescheduled'].sort(),
    );
  });

  it('falha de banco não vaza detalhes: resposta genérica 500', async () => {
    vi.stubEnv('CRON_SECRET', CRON_SECRET);
    // Arquivo de banco corrompido: a leitura lança (fail-closed) e a rota
    // responde de forma genérica, sem stack e sem segredo.
    fs.writeFileSync(TEMP_DB_FILE, '{ documento inválido');

    const res = await runCron(`Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(500);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain(SECRET);
    expect(raw).not.toContain('whsec');
    expect(raw).not.toContain('stack');
  });

  it('autenticação de cron aceita o Bearer exato e rejeita variações', () => {
    expect(extractCronBearer(new Headers({ authorization: `Bearer ${CRON_SECRET}` }))).toBe(CRON_SECRET);
    expect(extractCronBearer(new Headers({ authorization: `bearer ${CRON_SECRET}` }))).toBe(CRON_SECRET);
    expect(extractCronBearer(new Headers({ authorization: `Token ${CRON_SECRET}` }))).toBe('');
    expect(extractCronBearer(new Headers())).toBe('');

    expect(constantTimeEquals(CRON_SECRET, CRON_SECRET)).toBe(true);
    expect(constantTimeEquals(CRON_SECRET, `${CRON_SECRET}x`)).toBe(false);
    expect(constantTimeEquals('', '')).toBe(false);

    expect(verifyCronAuth(new Headers({ authorization: `Bearer ${CRON_SECRET}` }), CRON_SECRET)).toEqual({ ok: true });
    expect(verifyCronAuth(new Headers(), CRON_SECRET)).toMatchObject({ ok: false, status: 401 });
    expect(verifyCronAuth(new Headers({ authorization: `Bearer ${CRON_SECRET}` }), '')).toMatchObject({
      ok: false,
      status: 503,
    });
  });
});

// ─────────────────────────────────────────────────────────────
describe('Posse da fila (unitário)', () => {
  it('claimPendingWebhookDeliveries marca apenas as vencidas e livres', () => {
    const due = makeDelivery({ id: 'due' });
    const future = makeDelivery({ id: 'future', nextRetryAt: iso(60_000) });
    const db = makeDb(due);
    db.webhookDeliveries.push(future);

    const claimed = claimPendingWebhookDeliveries(db, { nowISO: iso(0), holder: 'run_test', limit: 5 });

    expect(claimed.map((c) => c.delivery.id)).toEqual(['due']);
    expect(claimed[0].secret).toBe(SECRET);
    expect(due.claimToken).toBe('run_test');
    expectAround(atMs(due.claimExpiresAt) - Date.now(), WEBHOOK_RETRY_CLAIM_LEASE_MS);
    expect(future.claimToken).toBeUndefined();
  });

  it('limite do lote respeita a ordem FIFO por nextRetryAt', () => {
    const older = makeDelivery({ id: 'older', nextRetryAt: iso(-120_000) });
    const newer = makeDelivery({ id: 'newer', nextRetryAt: iso(-30_000) });
    const db = makeDb(newer);
    db.webhookDeliveries.push(older);

    const claimed = claimPendingWebhookDeliveries(db, { nowISO: iso(0), holder: 'run_test', limit: 1 });

    expect(claimed.map((c) => c.delivery.id)).toEqual(['older']);
  });
});
