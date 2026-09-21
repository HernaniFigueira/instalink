// ═══════════════════════════════════════════════════════════════
// TESTES DE INTEGRAÇÃO — persistência relacional GoDoutor (Supabase).
// ═══════════════════════════════════════════════════════════════
// Roda contra POSTGRES REAL (binários embutidos via embedded-postgres) —
// nada de mock de SQL: transações, advisory locks, constraint de exclusão,
// RLS e grants valem exatamente como no projeto alvo sefwhobqafkretljjlqx.
// Não há credenciais de Supabase neste ambiente (bloqueio declarado na PR):
// os testes provam o esquema e a camada em Postgres idêntico ao do Supabase.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import EmbeddedPostgres from 'embedded-postgres';

import { syntheticDocument } from '../relational/testing/helpers/synthetic';
import type { DB } from '../types';
import { importDocument, tableCounts } from '../relational/import/run';
import { validateImport } from '../relational/import/validate';
import { loadAgendaSlice, slotsForDate, listBookingsManage } from '../relational/agenda';
import { runRelationalWrite } from '../relational/slice';
import { closePool } from '../relational/pool';
import { createBookingTx } from '../booking-create';
import { createSeriesTx } from '../booking-series';
import { applyBookingStatusTx } from '../booking-status';
import {
  authorizePatientUpload, registerPatientFile, getPatientFileRecord,
} from '../storage';
import { withTransaction } from '../relational/pool';
import { computeSlots } from '../slots';
import { weekdayOf } from '../tz';

const PORT = 54399;
const URL = `postgres://postgres:pw@127.0.0.1:${PORT}/godoutor_test`;

let pg: InstanceType<typeof EmbeddedPostgres>;
let pool: Pool;
const doc: DB = syntheticDocument();

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join('/tmp', 'godoutor-pg-'));
  pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('godoutor_test');
  // O pool singleton da camada relacional aponta para o Postgres de teste.
  process.env.SUPABASE_DB_URL = URL;
  pool = new Pool({ connectionString: URL, max: 10 });
  await pool.query(fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/0001_godoutor_relational.sql'), 'utf8'));
  await pool.query(fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/0003_patient_files.sql'), 'utf8'));
  // Cria o papel da Data API localmente para provar a NEGAÇÃO (no Supabase
  // ele já existe; aqui recriamos o mesmo isolamento).
  await pool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon LOGIN PASSWORD 'anonpw'; END IF;
  END $$;`);
  await pool.query('REVOKE ALL ON SCHEMA app FROM anon');
  await pool.query('REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon');
  await pool.query('ALTER ROLE godoutor_app PASSWORD \'testpw\'');
  const report = await importDocument(pool, doc, { mode: 'upsert', allowPopulated: true });
  if (!report.ok) throw new Error(`setup import falhou: ${report.error?.message}`);
}, 120_000);

afterAll(async () => {
  delete process.env.SUPABASE_DB_URL;
  await closePool(); // pool singleton do modo relacional — sem conexões pendentes
  await pool?.end();
  // Escoa os sockets fechados antes do SIGTERM do Postgres: sem isso o
  // desligamento devolve 57P01 ("administrator command") como erro órfão.
  await new Promise((r) => setTimeout(r, 200));
  await pg?.stop();
});

describe('migração 0001 — esquema relacional', () => {
  it('cria todas as tabelas das coleções do documento', async () => {
    const counts = await tableCounts(pool);
    for (const t of ['app.users', 'app.businesses', 'app.bookings', 'app.contacts', 'app.services',
      'app.professionals', 'app.availability', 'app.queue_entries', 'app.encounters', 'app.conversations',
      'app.messages', 'app.automations', 'app.integration_events']) {
      expect(counts[t]).toBeDefined();
    }
  });

  it('recusa leitura do papel exposto da Data API (RLS sem política = negação)', async () => {
    const anon = new Pool({ connectionString: URL.replace('postgres://postgres:pw@', 'postgres://anon:anonpw@'), max: 1 });
    await expect(anon.query('SELECT * FROM app.bookings LIMIT 1')).rejects.toThrow(/denied|privileg/i);
    await anon.end();
  });

  it('permite DML da role da aplicação (godoutor_app)', async () => {
    const app = new Pool({ connectionString: URL.replace('postgres://postgres:pw@', 'postgres://godoutor_app:testpw@'), max: 1 });
    const r = await app.query('SELECT count(*)::int AS n FROM app.events');
    expect(r.rows[0].n).toBeGreaterThan(0);
    await app.end();
  });
});

describe('importador — repetível, validado, honesto', () => {
  it('importa todas as coleções e valida contagens/conteúdo/vínculos', async () => {
    const validation = await validateImport(pool, doc);
    expect(validation.ok).toBe(true);
    expect(validation.contentErrors).toHaveLength(0);
    expect(validation.orphanErrors.every((o) => o.count === 0)).toBe(true);
    const bookings = validation.counts.find((c) => c.table === 'bookings');
    expect(bookings?.source).toBe(6);
    expect(bookings?.target).toBeGreaterThanOrEqual(6);
  });

  it('re-importar não duplica (upsert por id preservado)', async () => {
    const before = await tableCounts(pool);
    const report = await importDocument(pool, doc, { mode: 'upsert', allowPopulated: true });
    expect(report.ok).toBe(true);
    const after = await tableCounts(pool);
    expect(after['app.bookings']).toBe(before['app.bookings']);
  });

  it('recusa destino populado sem decisão explícita', async () => {
    const report = await importDocument(pool, doc, {});
    expect(report.ok).toBe(false);
    expect(report.error?.table).toBe('target');
  });

  it('detecta sobreposição de horário JÁ EXISTENTE na origem (pré-flight)', async () => {
    const bad = syntheticDocument();
    bad.bookings.push({
      ...bad.bookings.find((b) => b.id === 'bk_a2')!,
      id: 'bk_a2_gemeo', time: '10:15', // 15min depois, mesmo profissional (30min de duração)
    });
    const report = await importDocument(pool, bad, { mode: 'upsert', allowPopulated: true });
    expect(report.ok).toBe(false);
    expect(report.conflicts.length).toBeGreaterThan(0);
  });
});

describe('consultas por clínica, unidade e período', () => {
  it('loadAgendaSlice devolve SOMENTE a janela pedida da unidade', async () => {
    const from = doc.bookings.find((b) => b.id === 'bk_a2')!.date;
    const to = doc.bookings.find((b) => b.id === 'bk_a3')!.date;
    const slice = await loadAgendaSlice(pool, 'biz_unidade_a', { from, to });
    expect(slice).not.toBeNull();
    expect(slice!.bookings.every((b) => b.businessId === 'biz_unidade_a')).toBe(true);
    expect(slice!.bookings.map((b) => b.id).sort()).toEqual(['bk_a2', 'bk_a3']);
    // Isolamento entre unidades: nada da unidade B vaza.
    const sliceB = await loadAgendaSlice(pool, 'biz_unidade_b', { from, to });
    expect(sliceB!.bookings.every((b) => b.businessId === 'biz_unidade_b')).toBe(true);
  });

  it('unidade desconhecida não existe (404 na raiz)', async () => {
    const slice = await loadAgendaSlice(pool, 'biz_outro_dono', { from: '2026-01-01', to: '2026-12-31' });
    expect(slice).toBeNull();
  });

  it('slotsForDate reproduz o motor do documento com os MESMOS dados', async () => {
    // O par esperado vem do motor puro sobre o DOCUMENTO (fonte de verdade
    // das regras) — o SQL só muda de onde vêm os dados.
    const date = doc.bookings.find((b) => b.id === 'bk_a3')!.date;
    const service = doc.services.find((s) => s.id === 'srv_biz_unidade_a_consulta')!;
    const expected = computeSlots({
      rules: doc.availability.filter((a) => a.businessId === 'biz_unidade_a'),
      exceptions: doc.exceptions.filter((e) => e.businessId === 'biz_unidade_a'),
      bookings: doc.bookings.filter((b) => b.businessId === 'biz_unidade_a'),
      services: doc.services.filter((s) => s.businessId === 'biz_unidade_a'),
      professionals: doc.professionals.filter((p) => p.businessId === 'biz_unidade_a'),
      dateISO: date, weekday: weekdayOf(date), serviceId: service.id,
      durationMin: service.durationMin, professionalId: '', eligibleProIds: [],
      nowHM: '', leadMin: 30, bufferMin: 0,
    });
    const outcome = await slotsForDate(pool, { businessId: 'biz_unidade_a', serviceId: service.id, date });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.slots).toEqual(expected.slots);
      expect(outcome.result.occupied).toEqual(expected.occupied);
    }
  });

  it('lista de gestão pagina no SQL e respeita período', async () => {
    const all = await listBookingsManage(pool, { businessId: 'biz_unidade_a', page: 1, limit: 2 });
    expect(all).not.toBeNull();
    expect(all!.total).toBe(4);
    expect(all!.bookings).toHaveLength(2);
    expect(all!.page).toBe(1);
    const windowed = await listBookingsManage(pool, {
      businessId: 'biz_unidade_a',
      from: doc.bookings.find((b) => b.id === 'bk_a2')!.date,
      to: doc.bookings.find((b) => b.id === 'bk_a2')!.date,
    });
    expect(windowed!.total).toBe(1);
    expect(windowed!.bookings[0].id).toBe('bk_a2');
  });
});

describe('criação de agendamento — regras preservadas', () => {
  const unitA = 'biz_unidade_a';
  const service = 'srv_biz_unidade_a_consulta';
  // Caminho CANÔNICO do modo relacional: motores do documento sobre a fatia
  // (o mesmo mecanismo que a rota HTTP usa — createBookingTx via slice).
  const book = (over: Record<string, unknown> = {}) => runRelationalWrite(
    (over.businessId as string) || unitA,
    (db) => {
      // Stubs mínimos: createBookingTx REVALIDA negócio/serviço na fatia
      // (serviço de outra unidade ⇒ 'Serviço indisponível.' 400, etc.).
      const business = { id: (over.businessId as string) || unitA };
      const svc = { id: (over.serviceId as string) || service };
      return createBookingTx(db, {
        business: business as any, service: svc as any,
        date: (over.date as string) || futureDate,
        time: (over.time as string) || '09:00',
        actor: (over.actor as 'owner' | 'customer') || 'owner',
        customer: (over.customer as any) || { id: '', name: 'X', phone: '11900000000' },
        professionalId: (over.professionalId as string) || '',
        note: over.note as string | undefined,
        bookingKind: over.bookingKind as 'fit_in' | undefined,
        fitInConfirmed: over.fitInConfirmed as boolean | undefined,
        now: (over.now as string) || '2026-09-21T12:00:00Z',
      });
    },
  );
  const futureDate = (() => {
    // Um dia útil futuro dentro do horizonte (regras: seg–sex 08:00–18:00).
    const d = new Date(Date.UTC(2026, 9, 5)); // segunda-feira
    return d.toISOString().slice(0, 10);
  })();

  it('cria agendamento (dono) + CRM + eventos + automação + gatilho P4', async () => {
    const result = await book({ time: '09:00', customer: { id: '', name: 'Helena Teste', phone: '11912345678', email: 'helena@test.test' }, note: 'primeira consulta' });
    expect(result.status).toBe('confirmed');
    expect(result.professionalId).toBeTruthy();

    const booking = await pool.query('SELECT * FROM app.bookings WHERE id = $1', [result.bookingId]);
    expect(booking.rows[0].status).toBe('confirmed');
    expect(booking.rows[0].customer_name).toBe('Helena Teste');
    expect(booking.rows[0].start_min).toBe(540);
    expect(booking.rows[0].end_min).toBe(570);

    // CRM: contato criado UMA vez.
    const contacts = await pool.query(
      'SELECT * FROM app.contacts WHERE business_id = $1 AND phone = $2',
      [unitA, '11912345678'],
    );
    expect(contacts.rows).toHaveLength(1);
    expect(contacts.rows[0].source).toBe('agendamento');

    // Eventos analíticos do caminho único (carimbo vem do relógio do payload,
    // igual ao motor do documento).
    const events = await pool.query(
      `SELECT type FROM app.events WHERE business_id = $1 AND created_at = $2
         AND type IN ('booking_created','conversion') ORDER BY type`,
      [unitA, '2026-09-21T12:00:00Z'],
    );
    const types = events.rows.map((e) => e.type);
    expect(types).toContain('booking_created');
    expect(types).toContain('conversion');

    // Mensagem de confirmação na fila (WhatsApp oficial) com dedupe por chave.
    const msgs = await pool.query(
      `SELECT * FROM app.messages WHERE business_id = $1 AND external_id = $2`,
      [unitA, `auto:booking_confirmation:${result.bookingId}`],
    );
    expect(msgs.rows).toHaveLength(1);
    expect(msgs.rows[0].status).toBe('pending');

    // Gatilho P4 booking.created enfileirado (idempotente).
    const runs = await pool.query(
      `SELECT * FROM app.automation_runs WHERE business_id = $1 AND context->'booking'->>'id' = $2`,
      [unitA, result.bookingId],
    );
    expect(runs.rows).toHaveLength(1);
    expect(runs.rows[0].status).toBe('queued');
  });

  it('segunda reserva para o MESMO slot é recusada (409) — sequencial', async () => {
    // Profissional EXPLÍCITO (Ana): o slot tem um único dono possível —
    // segunda tentativa no mesmo horário não tem "cadeira livre" para cair.
    const primeiro = await book({ time: '08:00', professionalId: 'pro_biz_unidade_a_ana', customer: { id: '', name: 'Primeiro Da Fila', phone: '11900000001' } });
    expect(primeiro.status).toBe('confirmed');
    await expect(book({ time: '08:00', professionalId: 'pro_biz_unidade_a_ana', customer: { id: '', name: 'Outro Cliente', phone: '11900000000' } }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('DUAS TENTATIVAS SIMULTÂNEAS: exatamente uma vence, a outra recebe 409', async () => {
    // Grade de 30min dentro da janela da Ana, sem colidir com os agendamentos
    // anteriores (08:00 e 09:00 já ocupados por outros testes).
    for (const time of ['10:00', '10:30', '11:00']) {
      const attempts = [1, 2].map((n) => book({
        time,
        professionalId: 'pro_biz_unidade_a_ana',
        customer: { id: '', name: n === 1 ? 'Corrida Um' : 'Corrida Dois', phone: `1190000000${n}` },
      }));
      const results = await Promise.allSettled(attempts);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const conflict = results.filter((r) => r.status === 'rejected' && ((r.reason as any)?.status) === 409);
      expect(ok).toHaveLength(1);
      expect(conflict).toHaveLength(1);
    }
    const rows = await pool.query(
      `SELECT count(*)::int AS n FROM app.bookings
        WHERE business_id = $1 AND date = $2 AND customer_name LIKE 'Corrida %'`,
      [unitA, futureDate],
    );
    expect(rows.rows[0].n).toBe(3); // uma por rodada — nada duplicado
  });

  it('a constraint do BANCO recusa sobreposição mesmo por INSERT cru (23P01)', async () => {
    await expect(pool.query(
      `INSERT INTO app.bookings
         (id, business_id, service_id, professional_id, date, time, start_min, end_min,
          customer_name, customer_phone, status, created_at, updated_at)
       VALUES ('bk_cru_1', $1, $2, 'pro_biz_unidade_a_ana', $3, '09:15', 555, 585,
               'Cru', '11999999999', 'confirmed', now(), now())`,
      [unitA, service, futureDate],
    )).rejects.toMatchObject({ code: '23P01' });
  });

  it('recusa cruzamento entre clínicas: serviço de outra unidade não agenda', async () => {
    await expect(book({
      businessId: unitA, serviceId: 'srv_biz_unidade_b_consulta',
      time: '16:00', customer: { id: '', name: 'Cross Tenant', phone: '11988880000' },
    })).rejects.toMatchObject({ status: 400 });
    const leaked = await pool.query(
      `SELECT 1 FROM app.bookings WHERE business_id = $1 AND customer_name = 'Cross Tenant'`,
      [unitA],
    );
    expect(leaked.rows).toHaveLength(0);
  });

  it('recusa paciente de outra clínica ao criar contato de atendimento', async () => {
    // Contato da unidade B não pode ser vinculado a agendamento da unidade A:
    // o upsert de contato é por UNIDADE — never cross.
    await book({ time: '16:00', customer: { id: '', name: 'Diogo', phone: '11977776666' } });
    const contactsA = await pool.query(
      `SELECT * FROM app.contacts WHERE business_id = $1 AND phone = '11977776666'`,
      [unitA],
    );
    // Um NOVO contato é criado na unidade A (a base da unidade B fica intacta).
    expect(contactsA.rows).toHaveLength(1);
    const contactsB = await pool.query(
      `SELECT * FROM app.contacts WHERE business_id = $1 AND phone = '11977776666'`,
      ['biz_unidade_b'],
    );
    expect(contactsB.rows).toHaveLength(1);
    expect(contactsB.rows[0].id).toBe('ct_b_diogo');
  });

  it('encaixe (fit_in) exige autorização e confirmação de conflito', async () => {
    // Cliente NUNCA encaixa.
    await expect(book({
      time: '09:00', actor: 'customer', bookingKind: 'fit_in', fitInConfirmed: true,
      customer: { id: '', name: 'Encaixe Público', phone: '11900011111' },
    })).rejects.toMatchObject({ status: 403 });
    // Equipe encaixa APENAS com confirmação explícita do conflito.
    await expect(book({
      time: '09:00', bookingKind: 'fit_in', fitInConfirmed: false,
      customer: { id: '', name: 'Encaixe Sem Confirmação', phone: '11900022222' },
    })).rejects.toMatchObject({ status: 409 });
    const fitIn = await book({
      time: '09:00', bookingKind: 'fit_in', fitInConfirmed: true,
      customer: { id: '', name: 'Encaixe Confirmado', phone: '11900033333' },
    });
    expect(fitIn.status).toBe('confirmed');
  });

  it('validações do caminho único: passado, horizonte e profissional inelegível', async () => {
    const params = (over: Record<string, unknown>) => book({ time: '17:00', customer: { id: '', name: 'X', phone: '11955550000' }, ...over }) as Promise<unknown>;
    await expect(params({ date: '2026-01-01' })).rejects.toMatchObject({ status: 400 });
    await expect(params({ date: '2032-09-21' })).rejects.toMatchObject({ status: 400 });
    await expect(params({ professionalId: 'pro_biz_unidade_b_ana' })).rejects.toMatchObject({ status: 400 });
    await expect(params({ serviceId: 'nao-existe' })).rejects.toMatchObject({ status: 400 });
    await expect(params({ businessId: 'biz_fantasma' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('série, status e write-back (caminho canônico da rota)', () => {
  const unitA = 'biz_unidade_a';
  const service = 'srv_biz_unidade_a_consulta';
  // Próximo dia ÚTIL (a agenda sintética abre seg–sex) e o mesmo dia da
  // semana seguinte — dentro do horizonte real da agenda.
  const nextWeekday = (() => {
    const d = new Date();
    do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    return d.toISOString().slice(0, 10);
  })();
  const addDays = (isoDate: string, days: number) => {
    const d = new Date(`${isoDate}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const occ2Date = addDays(nextWeekday, 7);
  const seriesParams = (db: any) => ({
    business: db.businesses.find((b: any) => b.id === unitA),
    service: { id: service } as any,
    date: nextWeekday, time: '13:00',
    actor: 'owner' as const,
    customer: { id: '', name: 'Cliente Serie', phone: '11966660000' },
    professionalId: '',
  });
  const requestId = 'serie-integracao-0001';

  it('cria série recorrente (dono) e REPLAY da mesma chave não duplica', async () => {
    const occurrences = [{ date: nextWeekday, time: '13:00' }, { date: occ2Date, time: '13:00' }];
    const first = await runRelationalWrite(unitA, (db) => {
      const p = seriesParams(db);
      return createSeriesTx(db, p, occurrences, requestId, '');
    });
    expect(first.count).toBe(2);
    expect(first.replayed).toBe(false);
    const rows = await pool.query(
      'SELECT * FROM app.bookings WHERE business_id = $1 AND series_request_id = $2 ORDER BY series_index',
      [unitA, requestId],
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].status).toBe('confirmed');

    // Replay idempotente (mesma chave + mesmo conteúdo).
    const replay = await runRelationalWrite(unitA, (db) => {
      const p = seriesParams(db);
      return createSeriesTx(db, p, occurrences, requestId, '');
    });
    expect(replay.replayed).toBe(true);
    const after = await pool.query('SELECT count(*)::int AS n FROM app.bookings WHERE business_id = $1 AND series_request_id = $2', [unitA, requestId]);
    expect(after.rows[0].n).toBe(2);
  });

  it('transição de status (pendente → confirmada) grava histórico e fila P3', async () => {
    const out = await runRelationalWrite(unitA, (db) =>
      applyBookingStatusTx(db, { businessId: unitA, bookingId: 'bk_a3', to: 'confirmed', by: 'owner' }));
    expect(out.ok).toBe(true);
    const row = await pool.query('SELECT status, history FROM app.bookings WHERE id = $1', ['bk_a3']);
    expect(row.rows[0].status).toBe('confirmed');
    const hist = row.rows[0].history;
    expect(hist.some((h: any) => h.to === 'confirmed')).toBe(true);
    // Mensagem de confirmação dedupe por chave (P3).
    const msg = await pool.query(
      'SELECT * FROM app.messages WHERE business_id = $1 AND external_id = $2',
      [unitA, `auto:booking_confirmation:bk_a3::confirmed`],
    );
    expect(msg.rows.length).toBeGreaterThanOrEqual(1);
  });

  it('write-back SEM mudanças não toca nas linhas (updatedAt intacto)', async () => {
    const before = await pool.query('SELECT max(updated_at) AS t FROM app.bookings WHERE business_id = $1', [unitA]);
    await new Promise((r) => setTimeout(r, 30));
    await runRelationalWrite(unitA, () => 'noop');
    const after = await pool.query('SELECT max(updated_at) AS t FROM app.bookings WHERE business_id = $1', [unitA]);
    expect(new Date(after.rows[0].t).getTime()).toBe(new Date(before.rows[0].t).getTime());
  });
});

describe('arquivos privados — autorização e referência permanente', () => {
  it('recusa contato de OUTRA unidade e operador fora do escopo', async () => {
    const ok = await authorizePatientUpload('biz_unidade_a', 'ct_b_diogo', { professionalScope: '' });
    expect(ok).toMatchObject({ ok: false, reason: 'not_found' });
    // Contato da unidade sem NENHUM atendimento da Ana ⇒ fora do escopo dela;
    // para quem atende (Bruno fez bk_a2) o mesmo contato é permitido.
    await pool.query(
      `INSERT INTO app.contacts (id, business_id, name, phone, created_at, updated_at)
       VALUES ('ct_a_nova', 'biz_unidade_a', 'Nova', '11912120000', now(), now())
       ON CONFLICT (id) DO NOTHING`,
    );
    const scoped = await authorizePatientUpload('biz_unidade_a', 'ct_a_nova', { professionalScope: 'pro_biz_unidade_a_ana' });
    expect(scoped).toMatchObject({ ok: false, reason: 'out_of_scope' });
    const liberado = await authorizePatientUpload('biz_unidade_a', 'ct_a_nova', { professionalScope: '' });
    expect(liberado).toMatchObject({ ok: true });
  });

  it('contato da unidade + escopo liberado → grava e RELÊ a referência permanente', async () => {
    const authz = await authorizePatientUpload('biz_unidade_a', 'ct_a_carla', { professionalScope: '' });
    expect(authz).toMatchObject({ ok: true });
    const fileId = await registerPatientFile({
      businessId: 'biz_unidade_a', contactId: 'ct_a_carla', bucket: 'patient-files',
      path: 'biz_unidade_a/ct_a_carla/teste.pdf', contentType: 'application/pdf',
      sizeBytes: 123, uploadedBy: 'user_teste', originalName: 'exame.pdf',
    });
    expect(fileId).toBeTruthy();
    const rec = await getPatientFileRecord(fileId);
    expect(rec).toMatchObject({ businessId: 'biz_unidade_a', contactId: 'ct_a_carla', path: 'biz_unidade_a/ct_a_carla/teste.pdf' });
  });
});

describe('integração da rota /api/bookings (prova estrutural — bloqueio 1)', () => {
  it('GET, POST e PATCH chamam o modo relacional (nada de import morto)', async () => {
    const src = await fs.promises.readFile(path.join(process.cwd(), 'src/app/api/bookings/route.ts'), 'utf8');
    expect(src).toMatch(/relationalBookingsGET\(q,/);
    expect(src).toMatch(/relationalBookingsPOST\(\{/);
    expect(src).toMatch(/relationalBookingsPATCH\(\{/);
    expect(src).toMatch(/if \(relRes\) return relationalHeader\(relRes\);/);
  });
});

describe('exportação de segurança (rollback)', () => {
  it('contagens do dump refletem o destino', async () => {
    const counts = await tableCounts(pool);
    expect(counts['app.bookings']).toBeGreaterThanOrEqual(12);
    const r = await pool.query('SELECT count(*)::int AS n FROM app.bookings');
    expect(r.rows[0].n).toBe(counts['app.bookings']);
  });
});
