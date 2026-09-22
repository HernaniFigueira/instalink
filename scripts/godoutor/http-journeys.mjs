// ═══════════════════════════════════════════════════════════════
// JORNADAS HTTP REAIS — modo relacional ATIVO, origem legada INDISPONÍVEL.
// ═══════════════════════════════════════════════════════════════
// Prova que as jornadas listadas na revisão funcionam SEM o motor de
// documento: o Next sobe com DATABASE_URL apontando para uma PORTA MORTA
// (qualquer toque no documento legado derruba a requisição com ECONNREFUSED).
// Postgres real embutido recebe as migrações 0001+0002+0003 e o dataset
// sintético; o Storage é um servidor HTTP local que imita os endpoints usados
// (object/{bucket} e object/sign) — os contratos do cliente são exercidos de
// verdade, sem depender do projeto Supabase (indisponível neste ambiente).
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { execSync, spawn } from 'node:child_process';

const PG_PORT = 54420;
const FAKE_STORAGE_PORT = 54421;
const APP_PORT = 54422;
const PG_URL = `postgres://postgres:pw@127.0.0.1:${PG_PORT}/godoutor_journeys`;
const DEAD_LEGACY = 'postgres://legacy:legacy@127.0.0.1:59999/legado'; // NADA escuta aqui
let BASE = `http://127.0.0.1:${APP_PORT}`;
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'} · ${name}${extra ? ` — ${extra}` : ''}`);
};

// ── Senha no FORMATO preservado (scrypt:salt:hash — lib/auth.ts) ──
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

// ── Storage falso (contratos do cliente lib/storage.ts) ──
function startFakeStorage() {
  const server = http.createServer((req, res) => {
    const url = req.url || '';
    // /object/sign/ PRIMEIRO (o regex geral de upload também casa com ele).
    if (req.method === 'POST' && url.includes('/object/sign/')) {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ signedURL: `/object/sign/patient-files/fake?token=jornada${Date.now()}` }));
      });
      return;
    }
    if (req.method === 'POST' && /\/storage\/v1\/object\/[^/]+\/.+/.test(url)) {
      let body = [];
      req.on('data', (c) => body.push(c));
      req.on('end', () => {
        global.__storageWrites = (global.__storageWrites || 0) + 1;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      });
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  return new Promise((resolve) => server.listen(FAKE_STORAGE_PORT, '127.0.0.1', () => resolve(server)));
}

const jars = new Map();
async function call(name, method, urlPath, { body, jar, token, form } = {}) {
  const headers = {};
  if (body !== undefined && !form) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (jar && jars.get(jar)) headers.cookie = jars.get(jar);
  // next dev derruba a primeira conexão ao compilar uma rota — 1 retry.
  let res;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await fetch(`${BASE}${urlPath}`, {
        method,
        headers,
        body: form ? form : body !== undefined ? JSON.stringify(body) : undefined,
      });
      break;
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (jar) {
    const prev = jars.get(jar) || '';
    const map = new Map(prev.split('; ').filter(Boolean).map((c) => [c.split('=')[0], c]));
    for (const sc of setCookie) {
      const pair = sc.split(';')[0];
      map.set(pair.split('=')[0], pair);
    }
    jars.set(jar, [...map.values()].join('; '));
  }
  let json = null;
  try { json = await res.json(); } catch { /* html/redirect */ }
  return { status: res.status, json, headers: res.headers };
}

async function main() {
  // 1. Postgres real + migrações + dados
  const dir = fs.mkdtempSync(path.join('/tmp', 'godoutor-hj-'));
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: PG_PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('godoutor_journeys');
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: PG_URL });
  // 0002 toca storage.buckets (existe no Supabase; em Postgres vanilla, stub
  // mínimo só para o registro dos buckets — as POLÍCIAS reais são do Storage).
  await pool.query(`create schema if not exists storage;
    create table if not exists storage.buckets (
      id text primary key, name text, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[])`);
  for (const f of ['0001_godoutor_relational.sql', '0002_storage_buckets.sql', '0003_patient_files.sql']) {
    await pool.query(fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', f), 'utf8'));
  }
  execSync('npx tsx scripts/godoutor/seed-synthetic.mts --to "' + PG_URL + '"', { stdio: ['ignore', 'pipe', 'pipe'], cwd: process.cwd() });

  // Sessões de prova: senha REAL no formato preservado + equipe com escopo.
  await pool.query(`UPDATE app.users SET password_hash = $1 WHERE email = 'dona@godoutor.test'`, [hashPassword('SenhaForte1')]);
  await pool.query(`UPDATE app.users SET password_hash = $1 WHERE email = 'master@godoutor.test'`, [hashPassword('SenhaForte1')]);
  await pool.query(
    `INSERT INTO app.users (id, name, email, password_hash, role)
     VALUES ('usr_atende', 'Bruno Atende', 'bruno@godoutor.test', $1, 'owner')
     ON CONFLICT (id) DO NOTHING`,
    [hashPassword('SenhaForte1')],
  );
  await pool.query(
    `INSERT INTO app.members (id, business_id, user_id, role, permissions, active, created_at, updated_at)
     VALUES ('mem_atende', 'biz_unidade_a', 'usr_atende', 'PROFISSIONAL', '{}', true, now(), now())
     ON CONFLICT (id) DO NOTHING`,
  );
  await pool.query(`UPDATE app.professionals SET user_id = 'usr_atende' WHERE id = 'pro_biz_unidade_a_bruno'`);
  // Contato sem atendimento do Bruno (prova de escopo no upload) + módulo de
  // orçamentos habilitado na unidade A (jornada do lead).
  await pool.query(
    `INSERT INTO app.contacts (id, business_id, name, phone, created_at, updated_at)
     VALUES ('ct_a_nova', 'biz_unidade_a', 'Nova', '11912120000', now(), now())
     ON CONFLICT (id) DO NOTHING`,
  );
  await pool.query(`UPDATE app.businesses SET modes = '["bookings","quote"]'::jsonb WHERE id = 'biz_unidade_a'`);

  // 2. Storage falso + Next com legado MORTO
  const storage = await startFakeStorage();
  const env = {
    ...process.env,
    PORT: String(APP_PORT),
    GODOUTOR_PERSISTENCE: 'relational',
    SUPABASE_DB_URL: PG_URL,
    SUPABASE_URL: `http://127.0.0.1:${FAKE_STORAGE_PORT}`,
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-jornada',
    DATABASE_URL: DEAD_LEGACY, // origem legada INDISPONÍVEL de propósito
    CRON_SECRET: 'cron-secret-jornada',
    BLOB_READ_WRITE_TOKEN: '',
  };
  // Porta DINÂMICA: um next dev zumbi de execução anterior não pode derrubar
  // esta rodada (EADDRINUSE mascarado como falha intermitente).
  const appPort = Number(process.env.HJ_PORT) || 54500 + (process.pid % 400);
  const next = spawn('npx', ['next', 'dev', '-p', String(appPort), '-H', '127.0.0.1'], { cwd: process.cwd(), env: { ...env, PORT: String(appPort) }, stdio: ['ignore', 'pipe', 'pipe'] });
  BASE = `http://127.0.0.1:${appPort}`;
  let nextLog = '';
  fs.writeFileSync('/tmp/godoutor-next-dev.log', '');
  next.stdout.on('data', (d) => { nextLog += d; fs.appendFileSync('/tmp/godoutor-next-dev.log', d); });
  next.stderr.on('data', (d) => { nextLog += d; fs.appendFileSync('/tmp/godoutor-next-dev.log', d); });
  const deadline = Date.now() + 120_000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/auth/me`);
      if (r.status < 500 || r.status === 500) { up = true; break; }
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!up) {
    console.error('Next não subiu. Log:\n' + nextLog.slice(-3000));
    process.exit(1);
  }

  // next dev derruba conexões ao compilar rota nova — retry para fetches
  // feitos FORA de call() (páginas públicas, redirect de arquivo).
  const fetchRetry = async (url, opts = {}, attempts = 3) => {
    let last;
    for (let i = 0; i < attempts; i++) {
      try { return await fetch(url, opts); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 1500)); }
    }
    throw last;
  };
  try {
    // ── Jornada 1: login da EQUIPE (owner) ──
    const noAuth = await call('me sem sessão', 'GET', '/api/auth/me');
    ok('me sem sessão = 401', noAuth.status === 401);
    const badLogin = await call('login senha errada', 'POST', '/api/auth/login', { body: { email: 'dona@godoutor.test', password: 'errada' }, jar: 'owner' });
    ok('login com senha errada = 401', badLogin.status === 401);
    const login = await call('login equipe', 'POST', '/api/auth/login', { body: { email: 'dona@godoutor.test', password: 'SenhaForte1' }, jar: 'owner' });
    ok('login equipe 200 + cookie', login.status === 200 && !!jars.get('owner'), JSON.stringify(login.json || {}).slice(0, 80));
    const me = await call('me (equipe)', 'GET', '/api/auth/me', { jar: 'owner' });
    ok('me devolve as 2 unidades', me.status === 200 && me.json?.businesses?.length === 2, JSON.stringify(me.json?.businesses?.map((b) => b.id) || []));
    const cookieHeader = jars.get('owner');
    const bearer = await call('me via Bearer (token do login)', 'GET', '/api/auth/me', { token: login.json.token });
    ok('sessão funciona via Bearer também', bearer.status === 200 && bearer.json?.user?.email === 'dona@godoutor.test');
    void cookieHeader;

    // ── Jornada 2: PERMISSÕES (profissional com escopo) ──
    const loginAtende = await call('login atendente', 'POST', '/api/auth/login', { body: { email: 'bruno@godoutor.test', password: 'SenhaForte1' }, jar: 'atende' });
    ok('login atendente 200', loginAtende.status === 200);
    const meAtende = await call('me (atendente)', 'GET', '/api/auth/me', { jar: 'atende' });
    const bizA = meAtende.json?.businesses?.find((b) => b.id === 'biz_unidade_a');
    ok('atendente vê a unidade com escopo próprio', bizA && bizA.agendaScope === 'own', JSON.stringify({ agendaScope: bizA?.agendaScope, pro: bizA?.professionalName }));
    const manageScoped = await call('manage com escopo', 'GET', '/api/bookings?businessId=biz_unidade_a&mode=manage&limit=200', { jar: 'atende' });
    const ids = (manageScoped.json?.bookings || []).map((b) => b.professionalId);
    ok('lista de gestão do escopo só tem atendimentos do próprio', manageScoped.status === 200 && ids.every((p) => p === 'pro_biz_unidade_a_bruno'), JSON.stringify(ids.slice(0, 5)));

    // ── Jornada 3: AGENDA (slots públicos) ──
    const today = new Date();
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
    const dateISO = d.toISOString().slice(0, 10);
    const slots = await call('slots públicos', 'GET', `/api/bookings?businessId=biz_unidade_a&serviceId=srv_biz_unidade_a_consulta&date=${dateISO}`);
    ok('grade pública devolve horários', slots.status === 200 && (slots.json?.slots || []).length > 0, `(${slots.json?.slots?.length || 0} slots)`);
    const allSlots = slots.json.slots;
    const slotTime = allSlots.find((t) => t >= '14:00') || allSlots[allSlots.length - 1];
    const days = await call('mapa de dias', 'GET', `/api/bookings?businessId=biz_unidade_a&serviceId=srv_biz_unidade_a_consulta&from=${dateISO}&to=${dateISO}`);
    ok('mapa de dias devolve estado', days.status === 200 && !!days.json?.days?.[dateISO]);
    const manage = await call('manage (equipe)', 'GET', '/api/bookings?businessId=biz_unidade_a&mode=manage&limit=10', { jar: 'owner' });
    ok('lista de gestão pagina no SQL', manage.status === 200 && typeof manage.json?.total === 'number' && Array.isArray(manage.json?.bookings), `total=${manage.json?.total}`);
    const manageNoAuth = await call('manage sem sessão', 'GET', '/api/bookings?businessId=biz_unidade_a&mode=manage');
    ok('manage sem sessão = 401', manageNoAuth.status === 401);

    // ── Jornada 4: RESERVA PÚBLICA (guest) ──
    const publicBooking = await call('reserva pública', 'POST', '/api/bookings', {
      body: {
        businessId: 'biz_unidade_a', serviceId: 'srv_biz_unidade_a_consulta',
        date: dateISO, time: slotTime,
        customerName: 'Jornada Visitante', customerPhone: '11930000001',
        marketingOptIn: true,
      },
    });
    ok('reserva pública criada (pending)', publicBooking.status === 200 && publicBooking.json?.status === 'pending', JSON.stringify(publicBooking.json || publicBooking).slice(0, 100));
    const bookingId = publicBooking.json?.bookingId;
    // 2ª reserva no MESMO horário cai no OUTRO profissional (regra do motor:
    // o servidor resolve quem está livre). A 3ª, sem profissional livre = 409.
    const dup = await call('mesmo slot, 2º profissional', 'POST', '/api/bookings', {
      body: {
        businessId: 'biz_unidade_a', serviceId: 'srv_biz_unidade_a_consulta',
        date: dateISO, time: slotTime,
        customerName: 'Segundo Visitante', customerPhone: '11930000002',
      },
    });
    ok('2ª reserva no mesmo horário usa o outro profissional', dup.status === 200 && dup.json?.professionalId !== publicBooking.json?.professionalId, JSON.stringify({ a: publicBooking.json?.professionalId, b: dup.json?.professionalId }));
    const full = await call('slot lotado (sem profissional livre)', 'POST', '/api/bookings', {
      body: {
        businessId: 'biz_unidade_a', serviceId: 'srv_biz_unidade_a_consulta',
        date: dateISO, time: slotTime,
        customerName: 'Terceiro Visitante', customerPhone: '11930000005',
      },
    });
    ok('3ª reserva no mesmo horário = 409 (nada sobrepõe)', full.status === 409, JSON.stringify(full.json || {}).slice(0, 80));

    // ── Jornada 5: reserva pelo PAINEL (asOwner) ──
    // Painel: um slot livre DISTINTO; remarcação vai para outro ainda livre.
    const laterSlot = allSlots.filter((t) => t > slotTime)[0] || allSlots[0];
    const rescheduleTarget = allSlots.filter((t) => t !== slotTime && t !== laterSlot).pop() || allSlots[allSlots.length - 1];
    const ownerBooking = await call('reserva painel', 'POST', '/api/bookings', {
      jar: 'owner',
      body: {
        businessId: 'biz_unidade_a', serviceId: 'srv_biz_unidade_a_consulta',
        date: dateISO, time: laterSlot, asOwner: true,
        contactName: '', customerName: 'Cliente Painel', customerPhone: '11930000003',
      },
    });
    ok('reserva pelo painel (confirmada)', ownerBooking.status === 200 && ownerBooking.json?.status === 'confirmed', JSON.stringify(ownerBooking.json || {}).slice(0, 100));
    const panelBookingId = ownerBooking.json?.bookingId;

    // ── Jornada 6: ALTERAÇÃO/CANCELAMENTO (PATCH) ──
    const reschedule = await call('remarcar', 'PATCH', '/api/bookings', {
      jar: 'owner',
      body: { businessId: 'biz_unidade_a', id: panelBookingId, date: dateISO, time: rescheduleTarget },
    });
    ok('remarcação move o atendimento', reschedule.status === 200 && reschedule.json?.moved === true, JSON.stringify(reschedule.json || {}).slice(0, 100));
    const rescheduleConflict = await call('remarcar para slot ocupado', 'PATCH', '/api/bookings', {
      jar: 'owner',
      body: { businessId: 'biz_unidade_a', id: panelBookingId, date: dateISO, time: slotTime },
    });
    ok('remarcação para slot ocupado = 409', rescheduleConflict.status === 409);
    const checkin = await call('check-in', 'PATCH', '/api/bookings', {
      jar: 'owner',
      body: { businessId: 'biz_unidade_a', id: panelBookingId, action: 'check-in' },
    });
    ok('check-in registra quem e quando', checkin.status === 200 && !!checkin.json?.checkedInAt, JSON.stringify(checkin.json || {}).slice(0, 80));
    const cancel = await call('cancelar', 'PATCH', '/api/bookings', {
      jar: 'owner',
      body: { businessId: 'biz_unidade_a', id: panelBookingId, status: 'cancelled', note: 'jornada' },
    });
    ok('cancelamento aplica status', cancel.status === 200 && cancel.json?.status === 'cancelled');
    const cancelAgain = await call('cancelar de novo (idempotente)', 'PATCH', '/api/bookings', {
      jar: 'owner',
      body: { businessId: 'biz_unidade_a', id: panelBookingId, status: 'cancelled' },
    });
    ok('re-cancelar é no-op idempotente', cancelAgain.status === 200);
    const patchNoAuth = await call('patch sem sessão', 'PATCH', '/api/bookings', {
      body: { businessId: 'biz_unidade_a', id: bookingId, status: 'cancelled' },
    });
    ok('PATCH sem sessão = 401', patchNoAuth.status === 401);

    // ── Jornada 7: RECORRÊNCIA (série) ──
    const occ = (offset) => {
      const x = new Date(d);
      x.setUTCDate(x.getUTCDate() + offset);
      return x.toISOString().slice(0, 10);
    };
    const requestId = `jornada-serie-${Date.now()}-abc`;
    const serie = await call('criar série', 'POST', '/api/bookings', {
      jar: 'owner',
      body: {
        businessId: 'biz_unidade_a', serviceId: 'srv_biz_unidade_a_consulta',
        date: occ(7), time: '11:00', asOwner: true,
        customerName: 'Cliente Serie', customerPhone: '11930000004',
        series: { occurrences: [{ date: occ(7), time: '11:00' }, { date: occ(14), time: '11:00' }], requestId },
      },
    });
    ok('série cria 2 ocorrências', serie.status === 200 && serie.json?.count === 2, JSON.stringify(serie.json || serie).slice(0, 120));
    const serieReplay = await call('repetir série (mesma chave)', 'POST', '/api/bookings', {
      jar: 'owner',
      body: {
        businessId: 'biz_unidade_a', serviceId: 'srv_biz_unidade_a_consulta',
        date: occ(7), time: '11:00', asOwner: true,
        customerName: 'Cliente Serie', customerPhone: '11930000004',
        series: { occurrences: [{ date: occ(7), time: '11:00' }, { date: occ(14), time: '11:00' }], requestId },
      },
    });
    ok('replay da série é idempotente', serieReplay.status === 200 && serieReplay.json?.replayed === true && serieReplay.json?.count === 2);
    const seriePublic = await call('série sem sessão = 403', 'POST', '/api/bookings', {
      body: {
        businessId: 'biz_unidade_a', serviceId: 'srv_biz_unidade_a_consulta',
        date: occ(7), time: '13:30',
        customerName: 'X', customerPhone: '11930000009',
        series: { occurrences: [{ date: occ(7), time: '13:30' }, { date: occ(14), time: '13:30' }], requestId: `jornada-serie-publica-${Date.now()}-abc` },
      },
    });
    ok('recorrência exige permissão de agenda (403)', seriePublic.status === 403);

    // ── Jornada 8: PACIENTE (registrar, sessão, reserva pela conta) ──
    const creg = await call('registro paciente', 'POST', '/api/customer/register', {
      jar: 'paciente',
      body: { name: 'Paciente Jornada', phone: '11940000001', email: 'paciente@jornada.test', password: 'senha123', businessId: 'biz_unidade_a' },
    });
    ok('conta do paciente criada', creg.status === 200 && !!jars.get('paciente'), JSON.stringify(creg.json || {}).slice(0, 80));
    const clogin = await call('login paciente', 'POST', '/api/customer/login', {
      jar: 'paciente2',
      body: { login: '11940000001', password: 'senha123', businessId: 'biz_unidade_a' },
    });
    ok('login do paciente (telefone+senha)', clogin.status === 200 && clogin.json?.customer?.name === 'Paciente Jornada');
    const cme = await call('me do paciente', 'GET', '/api/customer/me', { jar: 'paciente' });
    ok('sessão do paciente válida', cme.status === 200 && cme.json?.customer?.id);
    const patientBooking = await call('reserva com sessão do paciente', 'POST', '/api/bookings', {
      jar: 'paciente',
      body: { businessId: 'biz_unidade_a', serviceId: 'srv_biz_unidade_a_consulta', date: occ(7), time: '14:00' },
    });
    ok('reserva usa identidade da conta (pending)', patientBooking.status === 200 && patientBooking.json?.status === 'pending', JSON.stringify(patientBooking.json || {}).slice(0, 100));

    // ── Jornada 9: UPLOADS ──
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1, 2, 3, 4]);
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(32, 7)]);
    const clinicForm = new FormData();
    clinicForm.append('businessId', 'biz_unidade_a');
    clinicForm.append('file', new Blob([png], { type: 'image/png' }), 'logo.png');
    const clinicUp = await call('upload logo', 'POST', '/api/upload', { jar: 'owner', form: clinicForm });
    ok('upload público (clinic-media) preserva { ok, url }', clinicUp.status === 200 && String(clinicUp.json?.url || '').includes('/clinic-media/'), JSON.stringify(clinicUp.json || {}).slice(0, 120));
    const fakeWrites = global.__storageWrites || 0;
    ok('bytes chegaram ao bucket via contrato do Storage', fakeWrites >= 1, `writes=${fakeWrites}`);
    const patientForm = new FormData();
    patientForm.append('businessId', 'biz_unidade_a');
    patientForm.append('kind', 'patient');
    patientForm.append('contactId', 'ct_a_carla');
    patientForm.append('file', new Blob([pdf], { type: 'application/pdf' }), 'exame.pdf');
    const patientUp = await call('upload paciente', 'POST', '/api/upload', { jar: 'owner', form: patientForm });
    ok('upload privado devolve URL temporária + fileId', patientUp.status === 200 && !!patientUp.json?.fileId && String(patientUp.json?.url || '').includes('/object/sign/'), JSON.stringify({ status: patientUp.status, body: patientUp.json }).slice(0, 300));
    const patientFileId = patientUp.json?.fileId;
    const fileRedirect = await fetchRetry(`${BASE}/api/files/${patientFileId}`, { headers: { cookie: jars.get('owner' || '') }, redirect: 'manual' });
    ok('leitura autorizada re-assina após expirar (302)', fileRedirect.status === 302 && String(fileRedirect.headers.get('location') || '').includes('token='), `status=${fileRedirect.status}`);
    const wrongUnit = new FormData();
    wrongUnit.append('businessId', 'biz_unidade_a');
    wrongUnit.append('kind', 'patient');
    wrongUnit.append('contactId', 'ct_b_diogo');
    wrongUnit.append('file', new Blob([pdf], { type: 'application/pdf' }), 'x.pdf');
    const crossUnit = await call('upload contato de outra unidade', 'POST', '/api/upload', { jar: 'owner', form: wrongUnit });
    ok('contato de OUTRA unidade = 404', crossUnit.status === 404);
    const scopedForm = new FormData();
    scopedForm.append('businessId', 'biz_unidade_a');
    scopedForm.append('kind', 'patient');
    scopedForm.append('contactId', 'ct_a_nova');
    scopedForm.append('file', new Blob([pdf], { type: 'application/pdf' }), 'x.pdf');
    const scopedUp = await call('upload fora do escopo do profissional', 'POST', '/api/upload', { jar: 'atende', form: scopedForm });
    ok('profissional sem vínculo = 403', scopedUp.status === 403, JSON.stringify(scopedUp.json || {}).slice(0, 100));
    const upNoAuth = new FormData();
    upNoAuth.append('businessId', 'biz_unidade_a');
    upNoAuth.append('file', new Blob([png], { type: 'image/png' }), 'x.png');
    const upAnon = await call('upload sem sessão', 'POST', '/api/upload', { form: upNoAuth });
    ok('upload sem sessão = 401', upAnon.status === 401);

    // ── Jornada 10: PIPELINE (lead público) + CRON ──
    const lead = await call('lead público', 'POST', '/api/leads', {
      body: { businessId: 'biz_unidade_a', name: 'Lead Jornada', phone: '11950000001', origin: 'formulario', interest: 'Consulta', message: 'quero agendar' },
    });
    ok('lead entra na esteira (ingestLead no SQL)', lead.status === 200 && !!lead.json?.lead?.id, JSON.stringify(lead.json || lead).slice(0, 100));
    const cron = await call('cron automações', 'GET', '/api/cron/automations', { token: 'cron-secret-jornada' });
    ok('cron drena a fila P4 no SQL', cron.status === 200 && cron.json?.ok === true, JSON.stringify(cron.json || {}).slice(0, 100));
    const cronNoAuth = await call('cron sem segredo', 'GET', '/api/cron/automations');
    ok('cron sem credencial = 401/503 (fail-closed)', [401, 503].includes(cronNoAuth.status), `status=${cronNoAuth.status}`);

    // ── Jornada 11: PÁGINA PÚBLICA (renderizada do SQL) ──
    const pubPage = await fetchRetry(`${BASE}/unidade-centro`);
    const pubHtml = await pubPage.text();
    ok('página pública renderizada (200 + nome no HTML)', pubPage.status === 200 && pubHtml.includes('Unidade Centro'), `status=${pubPage.status} len=${pubHtml.length}`);

    // ── Jornada 12: CADASTRO / CONFIGURAÇÃO / PUBLICAÇÃO de clínica ──
    const bizCreate = await call('criar unidade', 'POST', '/api/businesses', { jar: 'owner', body: { name: 'Clínica Jornada', whatsapp: '11961000001', address: 'Rua da Jornada, 1' } });
    ok('cadastro de clínica (SQL: org+unidade+página+auditoria)', bizCreate.status === 200 && !!bizCreate.json?.businessId && !!bizCreate.json?.slug, JSON.stringify(bizCreate.json || bizCreate).slice(0, 140));
    const newBizId = bizCreate.json?.businessId;
    const newSlug = bizCreate.json?.slug;
    const draftPage = await fetchRetry(`${BASE}/${newSlug}`);
    const draftHtml = await draftPage.text();
    ok('rascunho: página pública enxuta (não publicada)', draftPage.status === 200 && draftHtml.includes('ainda não foi publicada'), `status=${draftPage.status}`);
    const cfgNoAuth = await call('config sem sessão = 401', 'PATCH', `/api/businesses/${newBizId}`, { body: { description: 'x' } });
    ok('PATCH config sem sessão = 401', cfgNoAuth.status === 401, `status=${cfgNoAuth.status}`);
    const bizCfg = await call('configurar unidade', 'PATCH', `/api/businesses/${newBizId}`, { jar: 'owner', body: { description: 'Unidade da jornada', businessTimezone: 'America/Sao_Paulo', booking: { horizonDays: 45 } } });
    ok('configuração da clínica salva', bizCfg.status === 200 && bizCfg.json?.ok === true, JSON.stringify(bizCfg.json || {}).slice(0, 80));
    const cfgBadTz = await call('fuso inválido = 400', 'PATCH', `/api/businesses/${newBizId}`, { jar: 'owner', body: { businessTimezone: 'Marte/Cratera' } });
    ok('fuso IANA inválido = 400', cfgBadTz.status === 400, `status=${cfgBadTz.status}`);
    const pagesGet = await call('editor lê página', 'GET', `/api/pages?businessId=${newBizId}`, { jar: 'owner' });
    ok('editor lê página do SQL', pagesGet.status === 200 && pagesGet.json?.page?.businessId === newBizId, JSON.stringify(pagesGet.json || {}).slice(0, 110));
    const pagesPut = await call('salvar blocos + sobre', 'PUT', '/api/pages', { jar: 'owner', body: { businessId: newBizId, blocks: [{ id: 'b1', type: 'profile', enabled: true, settings: {} }], about: { title: 'Sobre nós', text: 'Cuidado humano', enabled: true } } });
    ok('edição da página salva (estado canônico)', pagesPut.status === 200 && pagesPut.json?.page?.businessId === newBizId, JSON.stringify(pagesPut.json || {}).slice(0, 130));
    const publish = await call('publicar página', 'PUT', '/api/pages', { jar: 'owner', body: { businessId: newBizId, published: true } });
    ok('publicação da página', publish.status === 200 && publish.json?.business?.published === true, JSON.stringify(publish.json || {}).slice(0, 110));
    const livePage = await fetchRetry(`${BASE}/${newSlug}`);
    const liveHtml = await livePage.text();
    ok('página publicada renderizada do SQL (nome + sobre)', livePage.status === 200 && liveHtml.includes('Clínica Jornada') && liveHtml.includes('Sobre nós'), `status=${livePage.status} len=${liveHtml.length}`);

    // ── Jornada 13: FILA DO BALCÃO ──
    const qCreate = await call('fila: chegada', 'POST', '/api/queue', { jar: 'owner', body: { businessId: 'biz_unidade_a', customerName: 'Walk Cliente', customerPhone: '11970000001', serviceId: 'srv_biz_unidade_a_consulta' } });
    ok('fila: entrada criada com contato do CRM (SQL)', qCreate.status === 200 && qCreate.json?.entry?.status === 'waiting' && !!qCreate.json?.entry?.contactId, JSON.stringify(qCreate.json || qCreate).slice(0, 160));
    const qId = qCreate.json?.entry?.id;
    const qGet = await call('fila: lista do dia', 'GET', '/api/queue?businessId=biz_unidade_a', { jar: 'owner' });
    ok('fila: entrada na lista', qGet.status === 200 && (qGet.json?.entries || []).some((e) => e.id === qId), `entries=${(qGet.json?.entries || []).length}`);
    const qCall = await call('fila: chamar', 'PATCH', '/api/queue', { jar: 'owner', body: { businessId: 'biz_unidade_a', id: qId, status: 'called' } });
    ok('fila: waiting → called', qCall.status === 200 && qCall.json?.entry?.status === 'called', JSON.stringify(qCall.json || qCall).slice(0, 120));
    const qBack = await call('fila: voltar para aguardando', 'PATCH', '/api/queue', { jar: 'owner', body: { businessId: 'biz_unidade_a', id: qId, status: 'waiting' } });
    ok('fila: called → waiting (chamou errado)', qBack.status === 200 && qBack.json?.entry?.status === 'waiting');
    const qStart = await call('fila: iniciar atendimento', 'PATCH', '/api/queue', { jar: 'owner', body: { businessId: 'biz_unidade_a', id: qId, status: 'in_service' } });
    ok('fila: waiting → in_service', qStart.status === 200 && qStart.json?.entry?.status === 'in_service');
    const qBad = await call('fila: transição proibida', 'PATCH', '/api/queue', { jar: 'owner', body: { businessId: 'biz_unidade_a', id: qId, status: 'called' } });
    ok('fila: in_service → called = 409 (máquina de estados)', qBad.status === 409, `status=${qBad.status}`);

    // ── Jornada 14: ATENDIMENTO (registro clínico) + HISTÓRICO ──
    const encCreate = await call('atendimento: abrir pela fila', 'POST', '/api/encounters', { jar: 'owner', body: { businessId: 'biz_unidade_a', queueId: qId } });
    ok('atendimento: registro criado (draft, vínculos da fila)', encCreate.status === 200 && encCreate.json?.encounter?.status === 'draft' && encCreate.json?.encounter?.queueId === qId, JSON.stringify(encCreate.json || encCreate).slice(0, 200));
    const encId = encCreate.json?.encounter?.id;
    const encRe = await call('atendimento: 2º POST = idempotente', 'POST', '/api/encounters', { jar: 'owner', body: { businessId: 'biz_unidade_a', queueId: qId } });
    ok('atendimento: reutilizado (não duplica)', encRe.status === 200 && encRe.json?.reused === true && encRe.json?.encounter?.id === encId, JSON.stringify(encRe.json || encRe).slice(0, 120));
    const encEdit = await call('atendimento: salvar conteúdo', 'PATCH', '/api/encounters', { jar: 'owner', body: { businessId: 'biz_unidade_a', id: encId, expectedVersion: 1, complaint: 'Dor lombar', evolution: 'Melhora progressiva' } });
    ok('atendimento: edição versiona (v2)', encEdit.status === 200 && encEdit.json?.encounter?.version === 2, JSON.stringify(encEdit.json || encEdit).slice(0, 140));
    const encConflict = await call('atendimento: versão velha = 409', 'PATCH', '/api/encounters', { jar: 'owner', body: { businessId: 'biz_unidade_a', id: encId, expectedVersion: 1, complaint: 'x' } });
    ok('atendimento: conflito de versão = 409', encConflict.status === 409, `status=${encConflict.status}`);
    const encNoVersion = await call('atendimento: sem trava = 400', 'PATCH', '/api/encounters', { jar: 'owner', body: { businessId: 'biz_unidade_a', id: encId, complaint: 'x' } });
    ok('atendimento: PATCH sem expectedVersion = 400', encNoVersion.status === 400, `status=${encNoVersion.status}`);
    const encFinal = await call('atendimento: finalizar', 'PATCH', '/api/encounters', { jar: 'owner', body: { businessId: 'biz_unidade_a', id: encId, action: 'finalize', expectedVersion: 2 } });
    ok('atendimento: finalizado (v3, assinado)', encFinal.status === 200 && encFinal.json?.encounter?.status === 'finalized' && !!encFinal.json?.encounter?.signedBy, JSON.stringify(encFinal.json || encFinal).slice(0, 160));
    const encFinal2 = await call('atendimento: finalizar de novo = 409', 'PATCH', '/api/encounters', { jar: 'owner', body: { businessId: 'biz_unidade_a', id: encId, action: 'finalize', expectedVersion: 3 } });
    ok('atendimento: re-finalizar = 409', encFinal2.status === 409, `status=${encFinal2.status}`);
    const encLocked = await call('atendimento: finalizado não edita', 'PATCH', '/api/encounters', { jar: 'owner', body: { businessId: 'biz_unidade_a', id: encId, expectedVersion: 3, complaint: 'x' } });
    ok('atendimento: edição em finalizado = 409', encLocked.status === 409, `status=${encLocked.status}`);
    const encReopen = await call('atendimento: reabrir (admin)', 'PATCH', '/api/encounters', { jar: 'owner', body: { businessId: 'biz_unidade_a', id: encId, action: 'reopen', expectedVersion: 3 } });
    ok('atendimento: reaberto (v4, fica na auditoria)', encReopen.status === 200 && encReopen.json?.encounter?.status === 'draft' && encReopen.json?.encounter?.version === 4, JSON.stringify(encReopen.json || encReopen).slice(0, 120));
    const encHistory = await call('histórico 360 por telefone', 'GET', '/api/encounters?businessId=biz_unidade_a&phone=11970000001', { jar: 'owner' });
    ok('histórico: registro aparece por telefone', encHistory.status === 200 && (encHistory.json?.encounters || []).some((e) => e.id === encId), `n=${(encHistory.json?.encounters || []).length}`);
    const encScoped = await call('histórico: escopo do profissional', 'GET', '/api/encounters?businessId=biz_unidade_a&phone=11970000001', { jar: 'atende' });
    ok('histórico: profissional não vê o que não atendeu', encScoped.status === 200 && (encScoped.json?.encounters || []).length === 0, `n=${(encScoped.json?.encounters || []).length}`);

    // ════════════════════════════════════════════════════════════
    // RODADA 4 · P1 PACIENTE — conta completa (ver/editar/remarcar/
    // cancelar/recuperar senha) e a EQUIPE vendo a mesma alteração.
    // ════════════════════════════════════════════════════════════
    // ── Jornada 15: MINHA CONTA (dados) + MINHAS RESERVAS ──
    const cmePatch = await call('paciente edita a conta', 'PATCH', '/api/customer/me', {
      jar: 'paciente', body: { name: 'Paciente Jornada Silva' },
    });
    ok('paciente atualiza o próprio nome (SQL)', cmePatch.status === 200 && cmePatch.json?.customer?.name === 'Paciente Jornada Silva', JSON.stringify(cmePatch.json || {}).slice(0, 100));
    const cmeRe = await call('nome persistiu (reload)', 'GET', '/api/customer/me', { jar: 'paciente' });
    ok('alteração da conta persiste (nova leitura)', cmeRe.status === 200 && cmeRe.json?.customer?.name === 'Paciente Jornada Silva');
    const myBookings = await call('minhas reservas', 'GET', `/api/customer/bookings?businessId=biz_unidade_a`, { jar: 'paciente' });
    const mineList = myBookings.json?.bookings || [];
    ok('minhas reservas mostra a reserva da jornada 8', myBookings.status === 200 && mineList.some((b) => b.id === patientBooking?.json?.bookingId), `n=${mineList.length}`);
    const foreignBooking = mineList[0];
    const notMine = await call('reserva alheia = 401', 'PATCH', '/api/customer/bookings', {
      jar: 'paciente2', body: { id: panelBookingId, status: 'cancelled' },
    });
    ok('paciente NÃO mexe em reserva de outro (401)', notMine.status === 401, `status=${notMine.status}`);
    void foreignBooking;

    // Remarcação pelo PACIENTE + a EQUIPE vê a mesma alteração
    const cResched = await call('paciente remarca', 'PATCH', '/api/customer/bookings', {
      jar: 'paciente', body: { id: patientBooking?.json?.bookingId, date: dateISO, time: rescheduleTarget },
    });
    ok('paciente remarca a própria reserva', cResched.status === 200 && (cResched.json?.booking?.time === rescheduleTarget || cResched.json?.moved === true || cResched.json?.ok === true), JSON.stringify(cResched.json || {}).slice(0, 120));
    const ownerSees = await call('equipe vê a remarcação', 'GET', '/api/bookings?businessId=biz_unidade_a&mode=manage&limit=200', { jar: 'owner' });
    const movedBooking = (ownerSees.json?.bookings || []).find((b) => b.id === patientBooking?.json?.bookingId);
    ok('a mesma alteração aparece na agenda da equipe (SQL)', !!movedBooking && movedBooking.date === dateISO && movedBooking.time === rescheduleTarget, JSON.stringify(movedBooking || {}).slice(0, 100));
    const cCancel = await call('paciente cancela', 'PATCH', '/api/customer/bookings', {
      jar: 'paciente', body: { id: patientBooking?.json?.bookingId, status: 'cancelled' },
    });
    ok('paciente cancela a própria reserva', cCancel.status === 200, JSON.stringify(cCancel.json || {}).slice(0, 100));
    const ownerSees2 = await call('equipe vê o cancelamento', 'GET', '/api/bookings?businessId=biz_unidade_a&mode=manage&limit=200', { jar: 'owner' });
    const cancelledBooking = (ownerSees2.json?.bookings || []).find((b) => b.id === patientBooking?.json?.bookingId);
    ok('cancelamento do paciente visível para a equipe', !!cancelledBooking && cancelledBooking.status === 'cancelled');

    // ── Jornada 16: RECUPERAÇÃO DE SENHA (token de uso único + login) ──
    const { createHash } = await import('node:crypto');
    const resetToken = randomBytes(32).toString('hex');
    const resetHash = createHash('sha256').update(resetToken).digest('hex');
    const custRow = await pool.query('SELECT id FROM app.customers WHERE email = $1', ['paciente@jornada.test']);
    await pool.query(
      `INSERT INTO app.password_resets (id, kind, account_id, token_hash, expires_at, used_at, created_at)
       VALUES ('prst_jornada', 'customer', $1, $2, now() + interval '1 hour', NULL, now())
       ON CONFLICT (id) DO NOTHING`,
      [custRow.rows[0].id, resetHash],
    );
    const cReset = await call('redefinir senha (token)', 'POST', '/api/customer/reset', {
      jar: 'paciente3', body: { token: resetToken, password: 'novaSenha123' },
    });
    ok('reset define nova senha e já loga', cReset.status === 200 && !!jars.get('paciente3'), JSON.stringify(cReset.json || {}).slice(0, 80));
    const cResetReplay = await call('mesmo token de novo', 'POST', '/api/customer/reset', {
      body: { token: resetToken, password: 'outraSenha9' },
    });
    ok('token de reset é de USO ÚNICO (replay = 400)', cResetReplay.status === 400, `status=${cResetReplay.status}`);
    const cRelogin = await call('login com a senha nova', 'POST', '/api/customer/login', {
      jar: 'paciente4', body: { login: 'paciente@jornada.test', password: 'novaSenha123', businessId: 'biz_unidade_a' },
    });
    ok('senha redefinida entra no SQL (login ok)', cRelogin.status === 200 && cRelogin.json?.customer?.email === 'paciente@jornada.test');
    const myOrders = await call('meus pedidos (vazio)', 'GET', `/api/customer/orders?businessId=biz_unidade_a`, { jar: 'paciente3' });
    ok('pedidos do consumidor lidos do SQL', myOrders.status === 200 && Array.isArray(myOrders.json?.orders), `n=${(myOrders.json?.orders || []).length}`);

    // ════════════════════════════════════════════════════════════
    // RODADA 4 · P2 OPERAÇÃO — telas de contatos, catálogo, equipe,
    // organizações, dashboard, tarefas, esteira e inbox.
    // ════════════════════════════════════════════════════════════
    // ── Jornada 17: CONTATOS / PACIENTES (lista, criação, nota, identidade) ──
    const ctList = await call('lista de contatos', 'GET', '/api/contacts?businessId=biz_unidade_a&limit=10', { jar: 'owner' });
    ok('contatos: lista paginada do SQL com total', ctList.status === 200 && typeof ctList.json?.total === 'number' && Array.isArray(ctList.json?.contacts), `total=${ctList.json?.total}`);
    const ctCreate = await call('criar contato', 'POST', '/api/contacts', {
      jar: 'owner', body: { businessId: 'biz_unidade_a', name: 'Cliente Operação', phone: '11981000001', email: 'operacao@jornada.test' },
    });
    ok('contato criado (SQL + dedupe de identidade)', ctCreate.status === 200 && !!ctCreate.json?.contact?.id, JSON.stringify(ctCreate.json || ctCreate).slice(0, 140));
    const ctId = ctCreate.json?.contact?.id;
    const ctDup = await call('criar duplicado', 'POST', '/api/contacts', {
      jar: 'owner', body: { businessId: 'biz_unidade_a', name: 'Cliente Operação 2', phone: '11981000001' },
    });
    ok('mesmo telefone reutiliza o contato (sem duplicar)', ctDup.status === 200 && ctDup.json?.contact?.id === ctId, JSON.stringify({ id: ctDup.json?.contact?.id }).slice(0, 80));
    const ctNote = await call('observação no contato', 'PATCH', '/api/contacts', {
      jar: 'owner', body: { businessId: 'biz_unidade_a', id: ctId, addNote: { text: 'Prefere atendimento pela manhã' } },
    });
    ok('observação gravada no contato', ctNote.status === 200 && !!ctNote.json?.note?.id, JSON.stringify(ctNote.json || {}).slice(0, 100));
    const ctPatch = await call('corrigir identidade', 'PATCH', '/api/contacts', {
      jar: 'owner', body: { businessId: 'biz_unidade_a', id: ctId, name: 'Cliente Operação Silva' },
    });
    ok('identidade do contato atualizada', ctPatch.status === 200 && ctPatch.json?.contact?.name === 'Cliente Operação Silva');
    const ctSearch = await call('busca acha o contato', 'GET', '/api/contacts?businessId=biz_unidade_a&q=Opera%C3%A7%C3%A3o%20Silva&limit=5', { jar: 'owner' });
    ok('busca por nome encontra (total correto)', ctSearch.status === 200 && (ctSearch.json?.contacts || []).some((c) => c.id === ctId) && ctSearch.json?.total >= 1, `total=${ctSearch.json?.total}`);
    const ctNoAuth = await call('contatos sem sessão = 401', 'GET', '/api/contacts?businessId=biz_unidade_a');
    ok('contatos sem sessão = 401', ctNoAuth.status === 401);

    // ── Jornada 18: EQUIPE / PERMISSÕES ──
    const teamGet = await call('lista da equipe', 'GET', '/api/team?businessId=biz_unidade_a', { jar: 'owner' });
    ok('equipe: lista com papéis/permissões', teamGet.status === 200 && Array.isArray(teamGet.json?.members) && Array.isArray(teamGet.json?.professionals), `members=${(teamGet.json?.members || []).length}`);
    const teamCreate = await call('criar acesso da equipe', 'POST', '/api/team', {
      jar: 'owner', body: { businessId: 'biz_unidade_a', name: 'Recepção Jornada', email: 'recepcao@jornada.test', password: 'senha123', role: 'ATENDENTE' },
    });
    ok('membro criado (login novo no SQL)', teamCreate.status === 200 && !!teamCreate.json?.memberId, JSON.stringify(teamCreate.json || teamCreate).slice(0, 120));
    const memberId = teamCreate.json?.memberId;
    const teamDup = await call('mesmo e-mail de novo', 'POST', '/api/team', {
      jar: 'owner', body: { businessId: 'biz_unidade_a', name: 'Recepção Jornada', email: 'recepcao@jornada.test', password: 'senha123', role: 'ATENDENTE' },
    });
    ok('e-mail já na equipe = 400 (nunca duplica conta)', teamDup.status === 400 && String(teamDup.json?.error || '').includes('já faz parte'), JSON.stringify(teamDup.json || {}).slice(0, 100));
    const teamPatch = await call('promover para ADMIN', 'PATCH', '/api/team', {
      jar: 'owner', body: { businessId: 'biz_unidade_a', id: memberId, role: 'ADMIN' },
    });
    ok('papel do membro atualizado', teamPatch.status === 200 && teamPatch.json?.member?.role === 'ADMIN', JSON.stringify(teamPatch.json || {}).slice(0, 80));
    const teamByPro = await call('criar equipe sem permissão', 'POST', '/api/team', {
      jar: 'atende', body: { businessId: 'biz_unidade_a', name: 'X', email: 'x@x.test', password: 'senha123', role: 'ATENDENTE' },
    });
    ok('profissional sem permissão de equipe = 403', teamByPro.status === 403, `status=${teamByPro.status}`);
    const teamDel = await call('remover acesso', 'DELETE', `/api/team?businessId=biz_unidade_a&id=${memberId}`, { jar: 'owner' });
    ok('membro removido', teamDel.status === 200);
    const teamSelfDel = await call('remover a si mesmo = 400', 'DELETE', `/api/team?businessId=biz_unidade_a&id=${(teamGet.json?.members || []).find((m) => m.userId === teamGet.json?.me?.userId)?.id || 'x'}`, { jar: 'owner' });
    ok('dono não remove o próprio acesso', teamSelfDel.status === 400, `status=${teamSelfDel.status}`);

    // ── Jornada 19: CATÁLOGO (dono) + DASHBOARD + RESULTADOS ──
    const catalogGet = await call('catálogo completo', 'GET', '/api/catalog/get?businessId=biz_unidade_a', { jar: 'owner' });
    ok('catálogo: serviços+profissionais+horários do SQL', catalogGet.status === 200 && (catalogGet.json?.services || []).length > 0 && (catalogGet.json?.professionals || []).length > 0, `svc=${(catalogGet.json?.services || []).length} pro=${(catalogGet.json?.professionals || []).length}`);
    const overviewGet = await call('dashboard (Início)', 'GET', '/api/overview?businessId=biz_unidade_a&period=30', { jar: 'owner' });
    ok('dashboard agrega do SQL (totais + CRM)', overviewGet.status === 200 && !!overviewGet.json?.totals && !!overviewGet.json?.crm && typeof overviewGet.json?.totals?.bookings === 'number', JSON.stringify({ totals: overviewGet.json?.totals?.bookings, crm: overviewGet.json?.crm?.contacts }).slice(0, 120));
    const analyticsGet = await call('analytics do período', 'GET', '/api/analytics?businessId=biz_unidade_a&period=30', { jar: 'owner' });
    ok('analytics agregado do SQL', analyticsGet.status === 200 && typeof analyticsGet.json?.totals?.pageViews === 'number' && Array.isArray(analyticsGet.json?.days), `pageViews=${analyticsGet.json?.totals?.pageViews}`);
    const resultsGet = await call('resultados da unidade', 'GET', '/api/results?businessId=biz_unidade_a&period=30', { jar: 'owner' });
    ok('resultados (motor de insights no SQL)', resultsGet.status === 200 && resultsGet.json?.scope === 'business' && !!resultsGet.json?.results, JSON.stringify(resultsGet.json || resultsGet).slice(0, 100));
    const resultsNoPerm = await call('resultados sem permissão', 'GET', '/api/results?businessId=biz_unidade_a&period=30', { jar: 'atende' });
    ok('resultados exige financeiro (403)', resultsNoPerm.status === 403, `status=${resultsNoPerm.status}`);

    // ── Jornada 20: ORGANIZAÇÕES / FILIAIS ──
    const orgsGet = await call('organizações do usuário', 'GET', '/api/organizations', { jar: 'owner' });
    ok('organizações agregadas do SQL', orgsGet.status === 200 && Array.isArray(orgsGet.json?.organizations), `n=${(orgsGet.json?.organizations || []).length}`);
    const orgCreate = await call('criar organização', 'POST', '/api/organizations', { jar: 'owner', body: { name: 'Rede Jornada' } });
    ok('organização criada (SQL + auditoria)', orgCreate.status === 201 && !!orgCreate.json?.organization?.id, JSON.stringify(orgCreate.json || orgCreate).slice(0, 100));
    const dupUnit = await call('duplicar unidade', 'POST', `/api/businesses/${newBizId}/duplicate`, { jar: 'owner', body: { name: 'Filial Jornada', address: 'Av. da Filial, 2' } });
    ok('filial criada por duplicação estrutural', dupUnit.status === 201 && !!dupUnit.json?.businessId && dupUnit.json?.businessId !== newBizId, JSON.stringify(dupUnit.json || dupUnit).slice(0, 120));
    const featureToggle = await call('ligar módulo de orçamentos', 'PATCH', `/api/businesses/${newBizId}/features`, { jar: 'owner', body: { feature: 'quote', enabled: true } });
    ok('recursos da unidade atualizados (SQL)', featureToggle.status === 200 && featureToggle.json?.ok === true, JSON.stringify(featureToggle.json || {}).slice(0, 100));

    // ── Jornada 21: TAREFAS + ESTEIRA (funil) + PAGINAÇÃO SQL DE LEADS ──
    const taskCreate = await call('criar tarefa', 'POST', '/api/tasks', {
      jar: 'owner', body: { businessId: 'biz_unidade_a', title: 'Ligar para Cliente Operação Silva', dueAt: `${dateISO}T18:00`, customerId: ctId },
    });
    ok('tarefa criada (SQL)', taskCreate.status === 201 && !!taskCreate.json?.task?.id, JSON.stringify(taskCreate.json || taskCreate).slice(0, 120));
    const taskDone = await call('concluir tarefa', 'PATCH', '/api/tasks', {
      jar: 'owner', body: { businessId: 'biz_unidade_a', id: taskCreate.json?.task?.id, status: 'done' },
    });
    ok('tarefa concluída (máquina de status)', taskDone.status === 200 && taskDone.json?.task?.status === 'done', JSON.stringify(taskDone.json || {}).slice(0, 100));
    const tasksGet = await call('lista de tarefas', 'GET', '/api/tasks?businessId=biz_unidade_a&status=all', { jar: 'owner' });
    ok('tarefas listadas com resumo', tasksGet.status === 200 && Array.isArray(tasksGet.json?.tasks) && !!tasksGet.json?.summary, `n=${(tasksGet.json?.tasks || []).length}`);
    for (let i = 1; i <= 3; i++) {
      await call(`lead manual ${i}`, 'POST', '/api/leads/manual', {
        jar: 'owner', body: { businessId: 'biz_unidade_a', name: `Lead Página ${i}`, phone: `1198200000${i}`, interest: 'Consulta de jornada' },
      });
    }
    const leadsP1 = await call('funil página 1', 'GET', '/api/leads?businessId=biz_unidade_a&page=1&limit=2', { jar: 'owner' });
    const leadsP2 = await call('funil página 2', 'GET', '/api/leads?businessId=biz_unidade_a&page=2&limit=2', { jar: 'owner' });
    ok('leads: total correto + página 1 paginada', leadsP1.status === 200 && leadsP1.json?.total >= 3 && (leadsP1.json?.leads || []).length === 2, `total=${leadsP1.json?.total}`);
    ok('leads: página 2 alcançável (sem corte de 500)', leadsP2.status === 200 && (leadsP2.json?.leads || []).length === Math.min(2, Math.max(0, (leadsP1.json?.total || 0) - 2)), `p2=${(leadsP2.json?.leads || []).length}/${leadsP1.json?.total}`);
    const pipelineGet = await call('esteira do funil', 'GET', '/api/pipeline?businessId=biz_unidade_a', { jar: 'owner' });
    ok('esteira lida do SQL com canEdit', pipelineGet.status === 200 && pipelineGet.json?.ok === true && (pipelineGet.json?.pipeline?.stages || []).length > 0);

    // ── Jornada 22: INBOX + AVALIAÇÕES + EVENTOS + BLOQUEIOS EXPLÍCITOS ──
    const convsGet = await call('inbox: lista', 'GET', '/api/conversations?businessId=biz_unidade_a', { jar: 'owner' });
    ok('conversas listadas do SQL (totais honestos)', convsGet.status === 200 && Array.isArray(convsGet.json?.conversations) && !!convsGet.json?.totals, `n=${(convsGet.json?.conversations || []).length}`);
    const reviewsManage = await call('avaliações (gestão)', 'GET', '/api/reviews?businessId=biz_unidade_a&manage=1', { jar: 'owner' });
    ok('avaliações: contagens do SQL', reviewsManage.status === 200 && !!reviewsManage.json?.counts, JSON.stringify(reviewsManage.json?.counts || {}).slice(0, 80));
    const evPost = await call('evento público', 'POST', '/api/events', { body: { businessId: 'biz_unidade_a', type: 'page_view', path: '/unidade-centro', meta: { vid: 'jornada-vid-1' } } });
    ok('evento de analytics gravado no SQL', evPost.status === 200 && evPost.json?.ok === true);
    const blockedIntegrations = await call('integrações bloqueadas', 'GET', '/api/integrations?businessId=biz_unidade_a', { jar: 'owner' });
    ok('módulo não migrado = 503 module_not_migrated', blockedIntegrations.status === 503 && blockedIntegrations.json?.code === 'module_not_migrated' && !!blockedIntegrations.headers?.get?.('x-godoutor-blocked'), `status=${blockedIntegrations.status}`);
    const blockedAutomations = await call('config de automações bloqueada', 'GET', '/api/automations?businessId=biz_unidade_a', { jar: 'owner' });
    ok('automações (config) também bloqueadas = 503', blockedAutomations.status === 503 && blockedAutomations.json?.code === 'module_not_migrated');
    const checkoutInfo = await call('checkout-info público', 'GET', '/api/checkout-info?businessId=biz_unidade_a');
    ok('checkout-info responde (público, do SQL)', [200].includes(checkoutInfo.status) && ('pixKey' in (checkoutInfo.json || {}) || checkoutInfo.json?.moduleOff === true), JSON.stringify(checkoutInfo.json || {}).slice(0, 80));
    void qId; void encId; void ctCreate;

    // ── Prova de isolamento: nada foi gravado no legado (porta morta) ──
    const rows = await pool.query('SELECT count(*)::int AS n FROM app.bookings WHERE business_id = $1', ['biz_unidade_a']);
    ok('agendamentos da jornada persistidos SOMENTE no SQL', rows.rows[0].n >= 7, `bookings=${rows.rows[0].n}`);
    const qRows = await pool.query('SELECT count(*)::int AS n FROM app.queue_entries WHERE business_id = $1', ['biz_unidade_a']);
    ok('fila persistida no SQL', qRows.rows[0].n >= 1, `queue=${qRows.rows[0].n}`);
    const eRows = await pool.query('SELECT count(*)::int AS n FROM app.encounters WHERE business_id = $1', ['biz_unidade_a']);
    ok('atendimento persistido no SQL', eRows.rows[0].n >= 1, `encounters=${eRows.rows[0].n}`);
    const newBizRows = await pool.query('SELECT count(*)::int AS n FROM app.businesses WHERE name = $1', ['Clínica Jornada']);
    ok('clínica criada na jornada está no SQL (e só nele)', newBizRows.rows[0].n === 1, `n=${newBizRows.rows[0].n}`);
    const auditRows = await pool.query(`SELECT count(*)::int AS n FROM app.audit WHERE business_id = $1 AND action LIKE 'encounter%'`, ['biz_unidade_a']);
    ok('auditoria do atendimento no SQL', auditRows.rows[0].n >= 4, `audit=${auditRows.rows[0].n}`);
  } finally {
    next.kill('SIGTERM');
    storage.close();
    await pool.end();
    await pg.stop();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== JORNADAS: ${results.length - failed.length}/${results.length} ===`);
  if (failed.length) {
    console.log('FALHAS:', failed.map((f) => f.name).join(' | '));
    if (process.env.HJ_SERVER_LOG) console.log('--- server log ---\n' + nextLog.slice(-16000));
    process.exit(1);
  }
  console.log('HTTP JOURNEYS PASSED');
}

main().catch((e) => {
  console.error('HARNESS CRASH:', e);
  process.exit(1);
});
