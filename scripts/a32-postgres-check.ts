// Integração opt-in contra banco Postgres DESCARTÁVEL (sobrescreve instalink_doc).
// A32_TEST_DATABASE_URL=postgres://... PGSSLMODE=disable npx --yes --package=tsx tsx scripts/a32-postgres-check.ts
// Usa dois PROCESSOS independentes; não pode passar por causa do mutex em memória.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { Pool } from 'pg';

async function main() {
  if (!process.env.A32_TEST_DATABASE_URL) throw new Error('Defina A32_TEST_DATABASE_URL para um banco DESCARTÁVEL.');
  process.env.DATABASE_URL = process.env.A32_TEST_DATABASE_URL;
  process.env.AUTOMATION_INLINE = '0';
  const { emptyDB, writeDB, readDB, updateDB } = await import('../src/lib/db');
  const { biz, service, user, buildAutomation, addLead } = await import('../src/lib/__tests__/helpers/automation-fixtures');
  const { createSeriesTx } = await import('../src/lib/booking-series');
  const { createBookingTx } = await import('../src/lib/booking-create');
  const { addDaysISO, todayISO } = await import('../src/lib/tz');
  const { enqueueWebhookTx, deliverWebhookIds, verifyWebhookSignature, processPendingWebhookDeliveries } = await import('../src/lib/webhooks');
  const { drainAutomations } = await import('../src/lib/automation/executor');
  const { emitAutomationEvent } = await import('../src/lib/automation/events');
  const business = biz('b1'); const srv = service('s1', 'b1');
  const date = addDaysISO(todayISO(), 7);
  const params = { business, service: srv, date, time: '14:00', actor: 'owner' as const, customer: { id: '', name: 'Teste PG', phone: '11987654321' } };
  const occurrences = [0, 7, 14].map((n) => ({ date: addDaysISO(date, n), time: '14:00', professionalId: '' }));
  const worker = process.argv[2];
  if (worker === 'deliver') {
    const result = await deliverWebhookIds([process.argv[3]]);
    console.log(JSON.stringify(result.map(({ id, status, attempts }) => ({ id, status, attempts }))));
    return;
  }
  if (worker === 'route') {
    const { NextRequest } = await import('next/server');
    const { POST } = await import('../src/app/api/leads/manual/route');
    const response = await POST(new NextRequest('http://localhost/api/leads/manual', { method: 'POST', headers: { authorization: `Bearer ${process.argv[3]}`, 'content-type': 'application/json' }, body: JSON.stringify({ businessId: 'b1', name: 'PG slow route', phone: '11912345678' }) }));
    assert.equal(response.status, 200);
    console.log(JSON.stringify({ ok: true }));
    return;
  }
  if (worker === 'automation') {
    console.log(JSON.stringify(await drainAutomations({ businessId: 'b1' })));
    return;
  }
  if (worker === 'independent') {
    await updateDB((d) => { d.businesses.find((b) => b.id === 'b2')!.description = 'independent-commit'; });
    console.log(JSON.stringify({ ok: true }));
    return;
  }
  if (worker === 'worker' || worker === 'single') {
    try {
      const result = await updateDB((d) => {
        // Mutação síncrona; processos competem pela mesma linha Postgres.
        return worker === 'single' ? createBookingTx(d, params) : createSeriesTx(d, params, occurrences, process.argv[3]);
      });
      console.log(JSON.stringify({ ok: true, ...result }));
    } catch (e: any) { console.log(JSON.stringify({ ok: false, status: e.status, error: e.message })); }
    return;
  }
  async function seed() {
    const d = emptyDB(); d.businesses.push(business, biz('b2')); d.services.push(srv); d.users.push(user('owner-b1', 'Dono'));
    for (let weekday = 0; weekday < 7; weekday++) d.availability.push({ id: `a${weekday}`, businessId: 'b1', weekday, start: '09:00', end: '18:00', slotMin: 30, professionalId: '', serviceId: '' });
    await writeDB(d);
  }
  async function child(mode: string, arg = '', timeout = 20_000) {
    const { stdout } = await promisify(execFile)(process.execPath, [...process.execArgv, process.argv[1], mode, arg], { env: process.env, timeout });
    return JSON.parse(stdout.trim());
  }
  const runWorker = (key: string) => child('worker', key);
  await seed();
  const sameKey = randomUUID();
  const same = await Promise.all([runWorker(sameKey), runWorker(sameKey)]);
  assert.ok(same.every((r) => r.ok));
  assert.equal(same[0].seriesId, same[1].seriesId);
  assert.equal(same.filter((r) => r.replayed).length, 1);
  assert.equal((await readDB()).bookings.length, 3);
  console.log('✓ dois processos / mesma chave: uma série, replay idempotente');

  await seed();
  const different = await Promise.all([runWorker(randomUUID()), runWorker(randomUUID())]);
  assert.equal(different.filter((r) => r.ok).length, 1);
  assert.equal(different.find((r) => !r.ok)?.status, 409);
  assert.equal((await readDB()).bookings.length, 3);
  console.log('✓ dois processos / chaves distintas / mesmo slot: uma série e um 409');

  await seed();
  const singles = await Promise.all([child('single'), child('single')]);
  assert.equal(singles.filter((r) => r.ok).length, 1);
  assert.equal(singles.find((r) => !r.ok)?.status, 409);
  assert.equal((await readDB()).bookings.length, 1);
  console.log('✓ dois bookings normais / mesmo slot: um sucesso e um 409');

  await seed();
  await assert.rejects(updateDB((d) => {
    createSeriesTx(d, params, occurrences, randomUUID());
    throw new Error('rollback proposital');
  }), /rollback proposital/);
  const after = await readDB();
  assert.equal(after.bookings.length, 0); assert.equal(after.contacts.length, 0);
  assert.equal(after.automationRuns.length, 0);
  console.log('✓ rollback real: nenhum booking, contato ou execução parcial');

  // Receptor REAL mantém a resposta aberta até que a escrita do outro processo
  // faça commit. O teste não pode passar simplesmente esperando o HTTP acabar.
  for (const mode of ['deliver', 'route', 'automation'] as const) {
    await seed();
    let release!: ServerResponse;
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    let hits = 0;
    let signed = false;
    const server = createServer((req, res) => {
      hits += 1; let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => {
        signed = verifyWebhookSignature('whsec_pg_test', raw, String(req.headers['x-instalink-signature'] || '')).valid;
        release = res; enter(); // NÃO responde até a escrita independente terminar
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    let sending: Promise<any> | undefined;
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    const observer: Pool = new Pool({ connectionString: process.env.A32_TEST_DATABASE_URL, ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false } });
    try {
      const ids = await updateDB((d) => {
        d.webhooks.push({ id: 'slow', businessId: 'b1', url: `http://127.0.0.1:${address.port}/slow`, secret: 'whsec_pg_test', events: ['lead.created', 'lead.updated'], active: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        if (mode === 'deliver') return enqueueWebhookTx(d, 'lead.updated', 'b1', {}).map((x) => x.id);
        if (mode === 'route') return [];
        addLead(d);
        d.automations.push(buildAutomation({ steps: [{ kind: 'action', action: { type: 'dispatch_webhook', params: { event: 'lead.updated' } } }] }));
        emitAutomationEvent(d, { event: 'lead.created', businessId: 'b1', leadId: 'lead-1' });
        return [];
      });
      const arg = mode === 'route' ? await (await import('../src/lib/auth')).createSession('owner-b1') : ids[0];
      sending = child(mode, arg);
      await Promise.race([entered, new Promise<never>((_, reject) => { waitTimer = setTimeout(() => reject(new Error('HTTP não iniciou')), 10_000); }), sending.then(() => { throw new Error('worker acabou antes de iniciar HTTP'); })]);
      clearTimeout(waitTimer);
      assert.ok(signed, 'assinatura HMAC preservada');
      const inFlight = (await readDB()).webhookDeliveries[0];
      assert.equal(inFlight.attempts, 0, 'outbox persistida ANTES de fazer HTTP');
      assert.ok(inFlight.claimToken, 'claim durável protege cron concorrente');
      const tx = await observer.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND state = 'idle in transaction'");
      assert.equal(tx.rows[0].n, 0, 'nenhuma transação aberta enquanto espera a resposta HTTP');
      assert.equal((await child('independent', '', 2500)).ok, true, 'outro processo escreve SEM liberar HTTP');
      assert.equal(release.writableEnded, false, 'escrita concluiu antes do receptor responder');
      assert.equal(release.destroyed, false, 'HTTP continua pendente (não passou por timeout)');
      assert.deepEqual(await processPendingWebhookDeliveries(), [], 'cron concorrente respeita o claim');
      release.end('ok');
      await sending;
      const saved = await readDB();
      assert.equal(saved.businesses.find((b) => b.id === 'b2')!.description, 'independent-commit', 'ack não sobrescreve outra escrita');
      assert.equal(saved.webhookDeliveries.length, 1);
      assert.equal(saved.webhookDeliveries[0].status, 'success');
      assert.equal(saved.webhookDeliveries[0].attempts, 1);
      assert.equal(hits, 1, 'não houve disparo duplicado');
      console.log(`✓ HTTP lento (${mode}): sem transação aberta; outro processo faz commit antes da resposta; cron não duplica; sem lost update`);
    } finally {
      clearTimeout(waitTimer);
      if (release && !release.writableEnded) release.end('cleanup');
      await sending?.catch(() => {});
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await observer.end();
    }
  }

}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
