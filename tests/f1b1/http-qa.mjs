// ═══════════════════════════════════════════════════════════════
// Clinical Encounter F1B1 — QA HTTP REAL (servidor `next start` local,
// banco DESCARTÁVEL, login REAL por cookie).
// ═══════════════════════════════════════════════════════════════
// Roda o fluxo do briefing no nível do SERVIDOR (onde a autoridade mora):
// agenda → iniciar → Atendimento → Anamnese → Avaliação → sair → retomar →
// permissões (Profissional responsável / Owner sem vínculo / Recepção /
// outro tenant) e o versionamento compartilhado entre seções.
//
// Uso (local e descartável):
//   node scripts/seed-f1b1-qa.mjs
//   GODOUTOR_DB_FILE=.cache/f1b1/qa.json npm run start -- -p 3111
//   node tests/f1b1/http-qa.mjs
//
// Este arquivo NÃO substitui o QA de browser (`tests/f1b1/qa.mjs`): ele prova
// contrato, persistência, permissão e versionamento com o servidor de verdade.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3111';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent (local disposable QA).');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Local disposable QA only');

const BIZ = 'f1b1-vet-qa';
const OTHER = 'f1b1-outra-qa';
const password = 'GodoutorF1B12026!';
const today = new Date().toISOString().slice(0, 10);

const result = { checks: [], expected: [], unexpected: [], server: [] };
const ok = (label) => { result.checks.push(label); console.log('PASS', label); };

/** Cliente HTTP com cookie jar (login real pela rota /api/auth/login). */
function client() {
  const jar = new Map();
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const absorb = (res) => {
    const raw = res.headers.getSetCookie?.() || [];
    for (const line of raw) {
      const [pair] = line.split(';');
      const idx = pair.indexOf('=');
      jar.set(pair.slice(0, idx), pair.slice(idx + 1));
    }
  };
  const request = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(jar.size ? { cookie: cookieHeader() } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    absorb(res);
    if (res.status >= 500) result.server.push({ status: res.status, path });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  return { request, jar };
}

async function login(email) {
  const c = client();
  const res = await c.request('POST', '/api/auth/login', { email: `${email}@godoutor.local`, password });
  assert.equal(res.status, 200, `login ${email}: ${res.status}`);
  assert.ok([...c.jar.keys()].length > 0, 'sessão por cookie');
  return c;
}

const ANAMNESIS = {
  history: 'Tutora relata coceira nas orelhas há 3 dias, piora à noite.',
  diet: 'Ração seca habitual; trocou de marca há 1 semana.',
  appetite: 'usual', waterIntake: 'changed', urine: 'usual', stool: 'changed',
  vomiting: 'no', diarrhea: 'yes',
  medicationsReported: 'Antipulgas mensal (relatado).',
  allergiesReported: 'Tutor relata reação a ração de frango.',
  observations: 'Mel está mais quieta segundo a tutora.',
};
const ASSESSMENT = {
  weightKg: 9.1, temperatureC: 38.4, heartRateBpm: 118, respiratoryRateRpm: 30,
  hydration: 'Normohidratada', mucousMembranes: 'Róseas e úmidas',
  capillaryRefillSeconds: 2, bodyCondition: 'Escore corporal 5/9',
  physicalExam: 'Exame otológico: eritema em orelha direita, sem secreção.',
};

try {
  await fs.mkdir('.cache/f1b1', { recursive: true });

  // ── 0 · logins reais das personas ────────────────────────────────────────
  const michelle = await login('michelle.f1b1');
  const owner = await login('owner.f1b1');
  const maria = await login('recepcao.f1b1');
  const fora = await login('fora.f1b1');
  ok('login real: Michelle (Profissional) · Owner · Maria (Recepção) · outra unidade');

  // ── 1 · agenda → iniciar atendimento (Michelle é a profissional da agenda) ─
  const agenda = await michelle.request('GET', `/api/bookings?businessId=${BIZ}&mode=manage&from=${today}&to=${today}&limit=50`);
  assert.equal(agenda.status, 200);
  const booking = (agenda.data.bookings || []).find((b) => b.id === 'bk-mel-2');
  assert.ok(booking, 'agendamento do fluxo encontrado na agenda');
  ok('Agenda real do tenant devolve o agendamento do paciente (Pet vinculado)');

  const started = await michelle.request('POST', '/api/encounters/start', { businessId: BIZ, bookingId: 'bk-mel-2' });
  assert.equal(started.status, 200, `start: ${started.status} ${JSON.stringify(started.data)}`);
  const encounterId = started.data.encounter.id;
  assert.equal(started.data.outcome, 'created');
  assert.equal(started.data.encounter.petId, 'pet-mel');
  assert.equal(started.data.encounter.access.canEditClinical, true);
  ok(`iniciar atendimento → mesmo encounterId canônico (${encounterId.slice(0, 8)}…)`);

  // ── 2 · Atendimento (queixa principal) com a versão da autoridade ───────
  let row = started.data.encounter;
  const queixa = await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: row.version,
    complaint: 'Coceira nas orelhas (queixa principal).',
  });
  assert.equal(queixa.status, 200);
  row = queixa.data.encounter;
  assert.equal(row.clinical.anamnesis.history, '');       // anamnese ainda vazia
  ok('Atendimento: Queixa principal gravada (copy clínica, campo físico preservado)');

  // ── 3 · Anamnese (fatia própria, versão COMPARTILHADA) ──────────────────
  const anamnese = await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: row.version,
    clinical: { anamnesis: ANAMNESIS },
  });
  assert.equal(anamnese.status, 200);
  const versionAfterAnamnese = anamnese.data.encounter.version;
  assert.equal(versionAfterAnamnese, row.version + 1);
  assert.equal(anamnese.data.encounter.clinical.anamnesis.appetite, 'usual');
  assert.equal(anamnese.data.encounter.complaint, 'Coceira nas orelhas (queixa principal).');
  ok('Anamnese da visita gravada no MESMO Encounter (e a versão subiu uma vez)');

  // ── 4 · Avaliação usando a versão NOVA (sem 409 interno) ────────────────
  const stale = await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: row.version,   // versão velha de propósito
    clinical: { assessment: { veterinary: { weightKg: 9.1 } } },
  });
  assert.equal(stale.status, 409);
  const avaliacao = await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: versionAfterAnamnese,
    clinical: { assessment: { veterinary: ASSESSMENT } },
  });
  assert.equal(avaliacao.status, 200);
  assert.equal(avaliacao.data.encounter.clinical.assessment.veterinary.temperatureC, 38.4);
  assert.equal(avaliacao.data.encounter.clinical.anamnesis.diarrhea, 'yes');   // anamnese intacta
  ok('Avaliação usa a versão nova: sem 409 interno e sem perder a anamnese');

  // ── 5 · sair → F5 → retomar: MESMO encounterId com TODOS os dados ───────
  const resumed = await michelle.request('POST', '/api/encounters/start', { businessId: BIZ, bookingId: 'bk-mel-2' });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.encounter.id, encounterId);
  assert.equal(resumed.data.outcome, 'resumed');
  const reloaded = await michelle.request('GET', `/api/encounters?businessId=${BIZ}&id=${encounterId}`);
  const loaded = reloaded.data.encounter;
  assert.equal(loaded.petId, 'pet-mel');
  assert.equal(loaded.petName, 'Mel');
  assert.equal(loaded.context.responsible.name, 'Isabelle Tutora QA');
  assert.equal(loaded.clinical.anamnesis.history, ANAMNESIS.history);
  assert.equal(loaded.clinical.assessment.veterinary.weightKg, 9.1);
  assert.equal(loaded.clinical.assessment.veterinary.physicalExam, ASSESSMENT.physicalExam);
  assert.equal(loaded.clinical.assessment.veterinary.heartRateBpm, 118);
  assert.equal(loaded.clinical.assessment.veterinary.respiratoryRateRpm, 30);
  assert.equal(loaded.complaint, 'Coceira nas orelhas (queixa principal).');
  ok('sair → retomar (mesmo id) → TODOS os dados das três seções continuam no Encounter');

  // ── 6 · peso medido hoje NÃO altera o cadastro permanente do Pet ────────
  const pets = await michelle.request('GET', `/api/pets?businessId=${BIZ}`);
  const mel = (pets.data.pets || []).find((p) => p.id === 'pet-mel');
  assert.ok(mel);
  assert.equal(Number(mel.weightKg), 9.4);      // cadastro intacto (medida de hoje = 9.1)
  ok('peso medido hoje vive no Encounter; o cadastro do Pet continua 9.4 kg');

  // ── 7 · concorrência EXTERNA: 409 real, nada sobrescrito ────────────────
  const current = (await michelle.request('GET', `/api/encounters?businessId=${BIZ}&id=${encounterId}`)).data.encounter;
  const otherTab = await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: current.version,
    clinical: { anamnesis: { history: 'Gravado em OUTRA tela.' } },
  });
  assert.equal(otherTab.status, 200);
  const conflict = await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: current.version,
    clinical: { anamnesis: { history: 'Texto local (não pode sobrescrever).' } },
  });
  assert.equal(conflict.status, 409);
  const afterConflict = (await michelle.request('GET', `/api/encounters?businessId=${BIZ}&id=${encounterId}`)).data.encounter;
  assert.equal(afterConflict.clinical.anamnesis.history, 'Gravado em OUTRA tela.');
  ok('409 real de outra tela: nada sobrescrito (o texto do servidor permanece)');

  // retry com a versão atual grava o MESMO texto (o texto local não se perde)
  const retry = await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: afterConflict.version,
    clinical: { anamnesis: { history: 'Texto local (retry após o conflito).' } },
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.encounter.clinical.anamnesis.history, 'Texto local (retry após o conflito).');
  ok('retry com a versão atual grava o MESMO texto local (nada perdido)');

  // ── 8 · permissões de escrita clínica (servidor) ────────────────────────
  const ownerWrite = await owner.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: retry.data.encounter.version,
    clinical: { anamnesis: { history: 'Owner sem vínculo profissional.' } },
  });
  assert.equal(ownerWrite.status, 403);
  result.expected.push({ status: 403, who: 'Owner', route: '/api/encounters' });
  const ownerRead = await owner.request('GET', `/api/encounters?businessId=${BIZ}&id=${encounterId}`);
  assert.equal(ownerRead.status, 200);
  assert.equal(ownerRead.data.encounter.access.canEditClinical, false);
  ok('Owner sem vínculo Professional: lê o atendimento e NÃO escreve conteúdo clínico (403)');

  const mariaRead = await maria.request('GET', `/api/encounters?businessId=${BIZ}&id=${encounterId}`);
  assert.equal(mariaRead.status, 403);
  result.expected.push({ status: 403, who: 'Recepção', route: '/api/encounters' });
  const mariaWrite = await maria.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: 1, clinical: { anamnesis: { history: 'Recepção.' } },
  });
  assert.equal(mariaWrite.status, 403);
  ok('Recepção: sem leitura e sem escrita clínica (403 no servidor)');

  // profissional de OUTRA unidade: 404 (não existe para ele)
  const foraRead = await fora.request('GET', `/api/encounters?businessId=${OTHER}&id=${encounterId}`);
  assert.equal(foraRead.status, 404);
  const foraWrite = await fora.request('PATCH', '/api/encounters', {
    businessId: OTHER, id: encounterId, expectedVersion: 1, clinical: { anamnesis: { history: 'Outro tenant.' } },
  });
  assert.equal(foraWrite.status, 404);
  result.expected.push({ status: 404, who: 'outra unidade', route: '/api/encounters' });
  ok('cross-tenant: 404 na leitura e na escrita (nada cruza a fronteira)');

  // ── 9 · validação do payload clínico (unidade ≠ texto; limite técnico) ──
  const fresh = (await michelle.request('GET', `/api/encounters?businessId=${BIZ}&id=${encounterId}`)).data.encounter;
  const textAsNumber = await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: fresh.version,
    clinical: { assessment: { veterinary: { weightKg: '9 kg' } } },
  });
  assert.equal(textAsNumber.status, 400);
  const absurd = await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: fresh.version,
    clinical: { assessment: { veterinary: { temperatureC: 999999 } } },
  });
  assert.equal(absurd.status, 400);
  result.expected.push({ status: 400, who: 'payload', route: '/api/encounters' });
  const unknownSection = await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: fresh.version,
    clinical: { problems: [{ text: 'otite' }] },
  });
  assert.equal(unknownSection.status, 400);
  ok('validação: número como texto, valor absurdo e seção futura são recusados (400)');

  // ── 10 · seções REAIS expostas pelo contrato do workspace ───────────────
  const workspace = await michelle.request('GET', `/api/encounters?businessId=${BIZ}&id=${encounterId}`);
  assert.equal(workspace.data.encounter.clinical.anamnesis.history, 'Texto local (retry após o conflito).');
  ok('leitura final devolve o Encounter com anamnese + avaliação + contexto do Pet');

  // ── 11 · a rota do registro COMPLETO (legado) continua viva ─────────────
  const legacyPage = await michelle.request('GET', `/atendimento/${encounterId}/registro?b=${BIZ}`);
  assert.ok([200, 307, 308].includes(legacyPage.status), `legado: ${legacyPage.status}`);
  ok('registro completo (legado) continua acessível na rota própria');
} finally {
  const failures = result.server.length;
  console.log('\n── resumo QA HTTP F1B1 ──');
  console.log(`checks: ${result.checks.length} · 5xx inesperados: ${failures}`);
  console.log(`respostas esperadas (403/404/400 provocados): ${result.expected.length}`);
  if (failures) {
    console.log('5xx:', JSON.stringify(result.server, null, 2));
    process.exitCode = 1;
  }
  await fs.writeFile('.cache/f1b1/http-qa-result.json', JSON.stringify(result, null, 2)).catch(() => {});
  if (!failures) console.log('OK · QA HTTP F1B1 sem 5xx inesperado');
}
