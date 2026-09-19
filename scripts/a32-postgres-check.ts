// Integração opt-in contra banco Postgres DESCARTÁVEL (sobrescreve instalink_doc).
// A32_TEST_DATABASE_URL=postgres://... PGSSLMODE=disable npx --yes --package=tsx tsx scripts/a32-postgres-check.ts
// Usa dois PROCESSOS independentes; não pode passar por causa do mutex em memória.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

async function main() {
  if (!process.env.A32_TEST_DATABASE_URL) throw new Error('Defina A32_TEST_DATABASE_URL para um banco DESCARTÁVEL.');
  process.env.DATABASE_URL = process.env.A32_TEST_DATABASE_URL;
  const { emptyDB, writeDB, readDB, updateDB } = await import('../src/lib/db');
  const { biz, service } = await import('../src/lib/__tests__/helpers/automation-fixtures');
  const { createSeriesTx } = await import('../src/lib/booking-series');
  const { addDaysISO, todayISO } = await import('../src/lib/tz');
  const business = biz('b1'); const srv = service('s1', 'b1');
  const date = addDaysISO(todayISO(), 7);
  const params = { business, service: srv, date, time: '14:00', actor: 'owner' as const, customer: { id: '', name: 'Teste PG', phone: '11987654321' } };
  const occurrences = [0, 7, 14].map((n) => ({ date: addDaysISO(date, n), time: '14:00', professionalId: '' }));
  const worker = process.argv[2];
  if (worker === 'worker') {
    try {
      const result = await updateDB(async (d) => {
        // Força janela de corrida caso a leitura não esteja bloqueada.
        await new Promise((resolve) => setTimeout(resolve, 350));
        return createSeriesTx(d, params, occurrences, process.argv[3]);
      });
      console.log(JSON.stringify({ ok: true, ...result }));
    } catch (e: any) { console.log(JSON.stringify({ ok: false, status: e.status, error: e.message })); }
    return;
  }
  async function seed() {
    const d = emptyDB(); d.businesses.push(business); d.services.push(srv);
    for (let weekday = 0; weekday < 7; weekday++) d.availability.push({ id: `a${weekday}`, businessId: 'b1', weekday, start: '09:00', end: '18:00', slotMin: 30, professionalId: '', serviceId: '' });
    await writeDB(d);
  }
  async function runWorker(key: string) {
    const { stdout } = await promisify(execFile)(process.execPath, [...process.execArgv, process.argv[1], 'worker', key], { env: process.env });
    return JSON.parse(stdout.trim());
  }
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
  await assert.rejects(updateDB((d) => {
    createSeriesTx(d, params, occurrences, randomUUID());
    throw new Error('rollback proposital');
  }), /rollback proposital/);
  const after = await readDB();
  assert.equal(after.bookings.length, 0); assert.equal(after.contacts.length, 0);
  assert.equal(after.automationRuns.length, 0);
  console.log('✓ rollback real: nenhum booking, contato ou execução parcial');
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
