import './helpers/temp-db';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, updateDB, updateDBWithCas, readDB, writeDB } from '../db';
import { assertOutsideDBTransaction } from '../db-transaction';
import { enqueueWebhookTx, deliverWebhookIds, processPendingWebhookDeliveries, applyWebhookRetryResults, claimPendingWebhookDeliveries } from '../webhooks';
import { biz, user, buildAutomation, addLead } from './helpers/automation-fixtures';
import { emitAutomationEvent } from '../automation/events';
import { claimDueAutomationRuns, stepAutomationRun, drainAutomations } from '../automation/executor';
import { limitsFor } from '../automation/capabilities';
import { createApiKey } from '../api-keys';
import { POST as externalLead } from '@/app/api/external/leads/route';

const now = () => new Date().toISOString();
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
async function seed() {
  const d = emptyDB(); d.businesses.push(biz('b1'), biz('b2')); d.users.push(user('owner-b1', 'Dono'));
  d.webhooks.push({ id: 'h1', businessId: 'b1', url: 'https://receiver.test/hook', secret: 'whsec_test', events: ['lead.created', 'lead.updated'], active: true, createdAt: now(), updatedAt: now() });
  await writeDB(d);
}
beforeEach(async () => { vi.stubEnv('AUTOMATION_INLINE', '0'); await seed(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const success = () => ({ ok: true, status: 200, statusText: 'OK' }) as Response;

it('enfileiramento sem I/O, normalização mantém attempts=0 e snapshot não muda com o lead', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await updateDB((d) => {
    const lead = { name: 'Original' };
    enqueueWebhookTx(d, 'lead.created', 'b1', { lead }, 'evento-estavel');
    lead.name = 'Alterado';
    enqueueWebhookTx(d, 'lead.created', 'b1', { lead }, 'evento-estavel');
  });
  const deliveries = (await readDB()).webhookDeliveries;
  expect(deliveries).toHaveLength(1); expect(deliveries[0].attempts).toBe(0);
  expect(deliveries[0].payloadSummary.lead.name).toBe('Original'); expect(fetch).not.toHaveBeenCalled();
});

it('rollback do negócio também remove a outbox; não existe entrega antes do commit', async () => {
  await expect(updateDB((d) => {
    d.businesses[0].name = 'não persistir'; enqueueWebhookTx(d, 'lead.created', 'b1', {});
    throw new Error('conflito');
  })).rejects.toThrow('conflito');
  expect((await readDB()).webhookDeliveries).toHaveLength(0);
  expect((await readDB()).businesses[0].name).not.toBe('não persistir');
});

it('HTTP lento libera a escrita; cron concorrente não duplica; ack não perde outra mutação', async () => {
  const entered = deferred<void>(), release = deferred<Response>();
  const fetch = vi.fn(async () => { entered.resolve(); return release.promise; });
  const ids = await updateDB((d) => enqueueWebhookTx(d, 'lead.created', 'b1', {}).map((x) => x.id));
  const sending = deliverWebhookIds(ids, fetch as any);
  await entered.promise;
  try {
    const stored = (await readDB()).webhookDeliveries[0];
    expect(stored.claimToken).toBeTruthy(); expect(stored.attempts).toBe(0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        updateDB((d) => { d.businesses[1].description = 'escrita independente'; }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('HTTP está bloqueando a escrita')), 1500); }),
      ]);
    } finally { clearTimeout(timer); }
    expect(await processPendingWebhookDeliveries({ fetchFn: fetch as any })).toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
  } finally { release.resolve(success()); }
  await sending;
  const d = await readDB(); expect(d.businesses[1].description).toBe('escrita independente');
  expect(d.webhookDeliveries[0].status).toBe('success'); expect(d.webhookDeliveries[0].attempts).toBe(1);
  expect(d.webhookDeliveries[0].claimToken).toBeUndefined();
});

it('worker interrompido após enqueue: cron recupera a primeira tentativa', async () => {
  await updateDB((d) => enqueueWebhookTx(d, 'lead.created', 'b1', {}));
  const fetch = vi.fn(async () => success());
  await processPendingWebhookDeliveries({ fetchFn: fetch as any });
  expect(fetch).toHaveBeenCalledOnce(); expect((await readDB()).webhookDeliveries[0].attempts).toBe(1);
});

it('resultado atrasado não sobrescreve posse assumida por outro worker', async () => {
  const snapshot = await updateDB((d) => {
    enqueueWebhookTx(d, 'lead.created', 'b1', {});
    return claimPendingWebhookDeliveries(d, { nowISO: now(), holder: 'old' })[0].delivery;
  });
  await updateDB((d) => { d.webhookDeliveries[0].claimToken = 'new'; });
  expect(await updateDB((d) => applyWebhookRetryResults(d, 'old', [{ ...snapshot, status: 'success', attempts: 1 }]))).toBe(0);
  expect((await readDB()).webhookDeliveries[0].status).toBe('pending');
});

it('CAS também recusa callback async e a fronteira bloqueia I/O por adapter', async () => {
  const called = vi.fn();
  // @ts-expect-error mesma restrição para callbacks CAS
  await expect(updateDBWithCas(async () => { called(); })).rejects.toThrow(/síncrono/);
  expect(called).not.toHaveBeenCalled();
  await expect(updateDB(() => assertOutsideDBTransaction())).rejects.toThrow(/I\/O externo/);
});

it('passo da automação persiste avanço + outbox sem HTTP e não enfileira novamente', async () => {
  const d = await readDB(); addLead(d);
  d.automations.push(buildAutomation({ steps: [{ kind: 'action', action: { type: 'dispatch_webhook', params: { event: 'lead.updated' } } }] }));
  const run = emitAutomationEvent(d, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' }).created[0];
  await writeDB(d);
  const fetch = vi.fn(async () => success()); vi.stubGlobal('fetch', fetch);
  const holder = 'step-worker';
  await updateDB((d) => claimDueAutomationRuns(d, { nowISO: now(), holder }));
  for (let i = 0; i < 5; i++) await updateDB((d) => stepAutomationRun(d, { runId: run.id, holder, nowISO: now(), limits: limitsFor(d.businesses[0]) }));
  let saved = await readDB(); expect(saved.webhookDeliveries).toHaveLength(1); expect(saved.webhookDeliveries[0].attempts).toBe(0);
  expect(saved.automationRuns[0].status).toBe('completed'); expect(fetch).not.toHaveBeenCalled();
  await drainAutomations(); // execução já concluída, não cria outra entrega
  await processPendingWebhookDeliveries({ fetchFn: fetch });
  saved = await readDB(); expect(saved.webhookDeliveries).toHaveLength(1); expect(fetch).toHaveBeenCalledOnce();
});

it('duas chamadas externas com a mesma chave: um lead, uma outbox e uma tentativa', async () => {
  const key = await updateDB((d) => createApiKey(d, 'b1', 'Teste').fullSecret);
  const fetch = vi.fn(async () => success()); vi.stubGlobal('fetch', fetch);
  const request = () => new NextRequest('http://localhost/api/external/leads', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'Idempotency-Key': 'same-operation', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Cliente', phone: '11912345678' }) });
  const results = await Promise.all([externalLead(request()), externalLead(request())]);
  expect(results.map((r) => r.status)).toEqual([201, 201]);
  expect(results.filter((r) => r.headers.get('X-Idempotent-Replay') === 'true')).toHaveLength(1);
  const d = await readDB(); expect(d.leads).toHaveLength(1); expect(d.webhookDeliveries).toHaveLength(1); expect(fetch).toHaveBeenCalledOnce();
});
