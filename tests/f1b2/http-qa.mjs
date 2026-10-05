// ═══════════════════════════════════════════════════════════════
// Clinical Encounter F1B2 — QA HTTP REAL (servidor `next start` local,
// banco DESCARTÁVEL, login REAL por cookie).
// ═══════════════════════════════════════════════════════════════
// Prova no nível do SERVIDOR (onde a autoridade mora) o que o F1B2 acrescenta
// ao MESMO Encounter do F1B1:
//   Atendimento → Anamnese → Avaliação → Problemas → Conduta → Procedimentos
// com uma única versão compartilhada (sem 409 interno), permissões impostas no
// servidor, validação estrita (tipo/id/duplicidade/limite/chave estranha),
// isolamento por vertical, ausência de efeito colateral (financeiro/estoque/
// pedido/tarefa/agenda) e 409 real de concorrência externa.
//
// Uso (local e descartável):
//   node scripts/seed-f1b1-qa.mjs && node scripts/seed-f1b2-qa.mjs
//   GODOUTOR_DB_FILE=.cache/f1b1/qa.json npm run start -- -p 3111
//   node tests/f1b2/http-qa.mjs
//
// Não substitui o QA de browser (`tests/f1b2/qa.mjs`): aqui é contrato,
// persistência, permissão, versionamento e efeitos colaterais.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3111';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent (local disposable QA).');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Local disposable QA only');

const BIZ = 'f1b1-vet-qa';
const OD = 'f1b1-odonto-qa';
const ES = 'f1b1-estetica-qa';
const OTHER = 'f1b1-outra-qa';
const password = 'GodoutorF1B12026!';
const today = new Date().toISOString().slice(0, 10);

const result = { checks: [], expected: [], server: [] };
const ok = (label) => { result.checks.push(label); console.log('PASS', label); };

function client() {
  const jar = new Map();
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const absorb = (res) => {
    for (const line of res.headers.getSetCookie?.() || []) {
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
  assert.equal(res.status, 200, `login ${email}: ${res.status} ${JSON.stringify(res.data)}`);
  assert.ok([...c.jar.keys()].length > 0, 'sessão por cookie');
  return c;
}

const PROBLEMS = [
  { id: 'prb-qa-1', kind: 'hypothesis', label: 'Dermatite alérgica', notes: 'Suspeita pela sazonalidade relatada.' },
  { id: 'prb-qa-2', kind: 'diagnosis', label: 'Otite externa direita', notes: 'Confirmado na otoscopia.' },
];
const PROCEDURES = [
  { id: 'proc-qa-1', name: 'Limpeza auricular', notes: 'Bilateral, sem secreção purulenta.' },
  { id: 'proc-qa-2', name: 'Coleta de citologia', notes: 'Procedimento custom (fora do catálogo).' },
];
const CONDUCT = 'Tratamento tópico por 14 dias; manter colar elisabetano; reavaliar em 15 dias.';

/** Fotografia do que NÃO pode ser tocado por um registro clínico. */
async function sideEffects(c) {
  const [orders, finance, tasks, bookings, catalog] = await Promise.all([
    c.request('GET', `/api/orders?businessId=${BIZ}&limit=200`),
    c.request('GET', `/api/finance?businessId=${BIZ}`),
    c.request('GET', `/api/tasks?businessId=${BIZ}&status=all`),
    c.request('GET', `/api/bookings?businessId=${BIZ}&mode=manage&from=${today}&to=${today}&limit=50`),
    c.request('GET', `/api/catalog/get?businessId=${BIZ}`),
  ]);
  for (const [label, res] of [['orders', orders], ['finance', finance], ['tasks', tasks], ['bookings', bookings], ['catalog', catalog]]) {
    assert.equal(res.status, 200, `${label}: ${res.status}`);
  }
  return JSON.stringify({
    orders: orders.data, finance: finance.data, tasks: tasks.data,
    bookings: (bookings.data.bookings || []).map((b) => [b.id, b.status, b.serviceId]),
    services: (catalog.data.services || []).map((s) => [s.id, s.name, s.price]),
  });
}

const read = async (c, id = encounterId) => {
  const res = await c.request('GET', `/api/encounters?businessId=${BIZ}&id=${id}`);
  assert.equal(res.status, 200);
  return res.data.encounter;
};
const auditCount = (encounter) => (encounter.audit?.length ?? encounter.auditTrail?.length ?? -1);
const snapshotOf = (encounter) => JSON.stringify([
  encounter.version, encounter.clinical, encounter.complaint, encounter.evolution,
  encounter.guidance, encounter.followUp, encounter.followUpMode, auditCount(encounter),
]);

let encounterId = '';

try {
  await fs.mkdir('.cache/f1b2', { recursive: true });

  // ── 0 · logins reais das personas ────────────────────────────────────────
  const michelle = await login('michelle.f1b1');      // responsável do agendamento
  const owner = await login('owner.f1b1');            // Owner sem vínculo Professional
  const maria = await login('recepcao.f1b1');         // Recepção
  const orlando = await login('orlando.f1b2');        // OUTRO profissional da MESMA unidade
  const fora = await login('fora.f1b1');              // outra unidade (cross-tenant)
  ok('login real: Michelle (responsável) · Owner · Recepção · Orlando (mesma unidade) · outra unidade');

  // ── 1 · MESMO Encounter do F1B1 (iniciar ou retomar) ─────────────────────
  const started = await michelle.request('POST', '/api/encounters/start', { businessId: BIZ, bookingId: 'bk-mel-2' });
  assert.equal(started.status, 200, `start: ${started.status} ${JSON.stringify(started.data)}`);
  encounterId = started.data.encounter.id;
  assert.ok(['created', 'resumed'].includes(started.data.outcome), started.data.outcome);
  // O fluxo abaixo prova que a versão sobe EXATAMENTE 1 por seção: isso só vale
  // em fixture limpa. Se o encontro já veio com dado B2, o correto é re-seedar
  // (o banco é descartável) — não afrouxar a afirmação.
  const already = started.data.encounter.clinical || {};
  if ((already.problems?.length || 0) > 0 || (already.procedures?.length || 0) > 0 || already.plan?.conduct) {
    throw Error('Fixture com dado B2 prévio: re-seede (seed-f1b1-qa.mjs + seed-f1b2-qa.mjs) e reinicie o servidor.');
  }
  const access = started.data.encounter.access;
  assert.equal(access.canEditCore, true);
  assert.equal(access.canEditVisitAnamnesis, true);
  assert.equal(access.canEditVeterinaryAssessment, true);
  assert.equal(access.canEditClinicalProblems, true);
  assert.equal(access.canEditCarePlan, true);
  assert.equal(access.canEditClinicalProcedures, true);
  assert.deepEqual(access.modules, ['core', 'vet']);
  ok(`MESMO Encounter (${encounterId.slice(0, 12)}…) com as 3 capacidades B2 ligadas pelo servidor`);

  // ── 2 · fluxo completo das 6 seções, uma versão compartilhada ────────────
  let row = started.data.encounter;
  const sendSection = async (label, payload) => {
    const res = await michelle.request('PATCH', '/api/encounters', {
      businessId: BIZ, id: encounterId, expectedVersion: row.version, ...payload,
    });
    assert.equal(res.status, 200, `${label}: ${res.status} ${JSON.stringify(res.data)}`);
    assert.equal(res.data.encounter.version, row.version + 1, `${label}: versão não subiu exatamente 1`);
    row = res.data.encounter;
    return row;
  };

  await sendSection('Atendimento', { complaint: 'Coceira nas orelhas há 3 dias.' });
  await sendSection('Anamnese', { clinical: { anamnesis: { history: 'Tutora relata coceira há 3 dias, piora à noite.', appetite: 'usual' } } });
  await sendSection('Avaliação', { clinical: { assessment: { veterinary: { weightKg: 9.1, temperatureC: 38.4, physicalExam: 'Eritema em orelha direita.' } } } });
  await sendSection('Problemas', { clinical: { problems: PROBLEMS } });
  await sendSection('Conduta', { clinical: { plan: { conduct: CONDUCT } } });
  await sendSection('Procedimentos', { clinical: { procedures: PROCEDURES } });
  ok('6 seções gravadas em sequência no MESMO Encounter (v+1 a cada uma, sem 409 interno)');

  assert.deepEqual(row.clinical.problems.map((p) => [p.id, p.kind]), [['prb-qa-1', 'hypothesis'], ['prb-qa-2', 'diagnosis']]);
  assert.equal(row.clinical.plan.conduct, CONDUCT);
  assert.deepEqual(row.clinical.procedures.map((p) => p.id), ['proc-qa-1', 'proc-qa-2']);
  assert.equal(row.clinical.assessment.veterinary.weightKg, 9.1);
  assert.equal(row.clinical.anamnesis.history, 'Tutora relata coceira há 3 dias, piora à noite.');
  ok('Problemas + Conduta + Procedimentos coexistem com anamnese/avaliação (merge parcial real)');

  // ── 3 · conduta NÃO duplica guidance/followUp/evolution ──────────────────
  await sendSection('Complementos', {
    evolution: 'Paciente apresentou eritema em orelha direita na avaliação.',
    guidance: 'Manter a orelha seca; colar elisabetano por 7 dias.',
    followUpMode: 'interval', followUpDays: 15,
  });
  assert.equal(row.clinical.plan.conduct, CONDUCT);
  assert.equal(row.guidance, 'Manter a orelha seca; colar elisabetano por 7 dias.');
  assert.equal(row.followUpMode, 'interval');
  assert.notEqual(row.clinical.plan.conduct, row.guidance);
  assert.notEqual(row.clinical.plan.conduct, row.evolution);
  ok('conduta é campo próprio: guidance/followUp/evolution continuam íntegros (UM lugar por conceito)');

  // ── 4 · identidade estável: reordenar/editar NÃO troca o id ──────────────
  const reordered = await sendSection('Reordenação', { clinical: { problems: [...PROBLEMS].reverse() } });
  assert.deepEqual(reordered.clinical.problems.map((p) => p.id), ['prb-qa-2', 'prb-qa-1']);
  assert.equal(reordered.clinical.problems[0].label, 'Otite externa direita');
  ok('identidade estável: reordenar preserva id e conteúdo de cada item (índice não é identidade)');

  // ── 5 · validação estrita do servidor (nada grava) ───────────────────────
  // Auditoria não tem endpoint público: é lida do banco DESCARTÁVEL (mesma
  // abordagem do QA HTTP do F1B1). Não é produção, não é dado real.
  const dbAuditFor = async () => {
    const doc = JSON.parse(await fs.readFile(process.env.GODOUTOR_DB_FILE || '.cache/f1b1/qa.json', 'utf8'));
    return (doc.audit || []).filter((a) => a.action === 'encounter.updated' && a.meta?.encounterId === encounterId);
  };
  const antes = snapshotOf(await read(michelle));
  const auditBefore = JSON.stringify(await dbAuditFor());
  const rejections = [
    ['tipo inválido', { problems: [{ id: 'prb-x', kind: 'suspeita', label: 'Tipo inventado' }] }],
    ['id duplicado', { problems: [{ id: 'prb-x', kind: 'problem', label: 'Um' }, { id: 'prb-x', kind: 'diagnosis', label: 'Dois' }] }],
    ['id malformado', { problems: [{ id: '0-índice', kind: 'problem', label: 'Id inválido' }] }],
    ['sem descrição', { problems: [{ id: 'prb-x', kind: 'problem', label: '   ' }] }],
    ['chave estranha (CID)', { problems: [{ id: 'prb-x', kind: 'problem', label: 'Com código', cid10: 'H60' }] }],
    ['problemas não é lista', { problems: { id: 'prb-x' } }],
    ['procedimento sem nome', { procedures: [{ id: 'proc-x', name: '  ' }] }],
    ['procedimento com preço', { procedures: [{ id: 'proc-x', name: 'Cobrança?', price: 5000 }] }],
    ['conduta não é texto', { plan: { conduct: 42 } }],
    ['prescrição escondida', { plan: { conduct: 'x', prescription: { drug: 'x' } } }],
    ['ramo fora do contrato', { attachments: [{ text: 'foto' }] }],
    ['teto de problemas', { problems: Array.from({ length: 31 }, (_, i) => ({ id: `prb-${i}`, kind: 'problem', label: `P${i}` })) }],
  ];
  for (const [label, clinical] of rejections) {
    const res = await michelle.request('PATCH', '/api/encounters', {
      businessId: BIZ, id: encounterId, expectedVersion: row.version, clinical,
    });
    assert.equal(res.status, 400, `${label}: esperado 400, veio ${res.status} ${JSON.stringify(res.data)}`);
    result.expected.push({ status: 400, who: `payload ${label}`, route: '/api/encounters' });
  }
  assert.equal(snapshotOf(await read(michelle)), antes, 'payload inválido alterou dado/versão');
  assert.equal(JSON.stringify(await dbAuditFor()), auditBefore, 'payload inválido gerou auditoria');
  ok(`validação estrita: ${rejections.length} payloads inválidos recusados (400) sem tocar dado, versão ou auditoria`);

  // ── 6 · teto de texto da conduta é truncado (sanitização declarada) ──────
  const longRes = await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: (await read(michelle)).version,
    clinical: { plan: { conduct: 'x'.repeat(4500) } },
  });
  assert.equal(longRes.status, 200);
  assert.equal(longRes.data.encounter.clinical.plan.conduct.length, 4000);
  ok('conduta acima do limite técnico é truncada no servidor (4000), nunca aceita sem limite');
  // restaura a conduta do fluxo
  row = (await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: longRes.data.encounter.version,
    clinical: { plan: { conduct: CONDUCT } },
  })).data.encounter;

  // ── 7 · procedimento custom, sem Service e SEM efeito colateral ──────────
  // A fotografia é feita pelo Owner (que TEM leitura de pedidos/financeiro/
  // tarefas): assim a prova de efeito colateral é independente de quem escreve.
  const before = await sideEffects(owner);
  row = await sendSection('Procedimento custom', {
    clinical: { procedures: [...PROCEDURES, { id: 'proc-qa-3', name: 'Procedimento fora do catálogo', notes: '' }] },
  });
  assert.equal(await sideEffects(owner), before, 'registro de procedimento gerou efeito colateral');
  const catalogNow = (await owner.request('GET', `/api/catalog/get?businessId=${BIZ}`)).data.services || [];
  const serviceNames = catalogNow.map((service) => service.name);
  assert.ok(serviceNames.length > 0, 'catálogo sem serviço (prova fraca)');
  for (const name of serviceNames) {
    assert.ok(!row.clinical.procedures.some((p) => p.name === name), `Service "${name}" virou procedimento`);
  }
  ok('procedimento custom gravado SEM exigir Service e SEM gerar cobrança/estoque/pedido/tarefa/agenda');

  // ── 8 · auditoria granular por bloco ─────────────────────────────────────
  const entries = await dbAuditFor();
  assert.ok(entries.length >= 6, `auditoria: ${entries.length}`);
  const fieldsSeen = new Set(entries.flatMap((e) => e.meta?.fields || []));
  for (const expected of ['clinical.problems', 'clinical.plan.conduct', 'clinical.procedures']) {
    assert.ok(fieldsSeen.has(expected), `auditoria sem ${expected}`);
  }
  assert.ok(!fieldsSeen.has('clinical'), 'auditoria com rótulo coarse "clinical"');
  ok('auditoria granular: clinical.problems · clinical.plan.conduct · clinical.procedures (sem rótulo coarse)');

  // ── 9 · sair → retomar: TUDO continua no MESMO Encounter ─────────────────
  const resumed = await michelle.request('POST', '/api/encounters/start', { businessId: BIZ, bookingId: 'bk-mel-2' });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.encounter.id, encounterId);
  assert.equal(resumed.data.outcome, 'resumed');
  const reloaded = resumed.data.encounter;
  assert.equal(reloaded.clinical.problems.length, 2);
  assert.equal(reloaded.clinical.plan.conduct, CONDUCT);
  assert.equal(reloaded.clinical.procedures.length, 3);
  assert.equal(reloaded.clinical.anamnesis.history, 'Tutora relata coceira há 3 dias, piora à noite.');
  assert.equal(reloaded.clinical.assessment.veterinary.weightKg, 9.1);
  ok('sair → retomar (mesmo id): problemas, conduta, procedimentos, anamnese e avaliação intactos');

  // ── 10 · concorrência EXTERNA: 409 real, nada sobrescrito ────────────────
  const stale = reloaded.version;
  const secondTab = await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: stale,
    clinical: { plan: { conduct: 'Gravado em OUTRA tela.' } },
  });
  assert.equal(secondTab.status, 200);
  const conflict = await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: stale,
    clinical: { problems: [{ id: 'prb-sobrescrever', kind: 'problem', label: 'Sobrescrever?' }] },
  });
  assert.equal(conflict.status, 409);
  const afterConflict = await read(michelle);
  assert.equal(afterConflict.clinical.plan.conduct, 'Gravado em OUTRA tela.');
  assert.equal(afterConflict.clinical.problems.length, 2, 'conflito apagou itens');
  const retry = await michelle.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: afterConflict.version,
    clinical: { plan: { conduct: CONDUCT } },
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.data.encounter.clinical.problems.length, 2);
  row = retry.data.encounter;
  ok('409 real entre duas telas: nada sobrescrito, nada perdido, retry com a versão atual grava');

  // ── 11 · permissões: só o responsável escreve ────────────────────────────
  const guarded = snapshotOf(await read(michelle));
  const forbidden = [
    ['Owner sem vínculo Professional', owner, 403],
    ['outro profissional da mesma unidade (Orlando)', orlando, 403],
  ];
  for (const [label, actor, status] of forbidden) {
    for (const [branch, clinical] of [
      ['problems', { problems: [{ id: 'prb-invasor', kind: 'problem', label: 'Não pode' }] }],
      ['plan', { plan: { conduct: 'Não pode' } }],
      ['procedures', { procedures: [{ id: 'proc-invasor', name: 'Não pode' }] }],
    ]) {
      const res = await actor.request('PATCH', '/api/encounters', {
        businessId: BIZ, id: encounterId, expectedVersion: row.version, clinical,
      });
      assert.equal(res.status, status, `${label} → ${branch}: ${res.status}`);
      result.expected.push({ status, who: label, route: `/api/encounters (${branch})` });
    }
  }
  const mariaWrite = await maria.request('PATCH', '/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion: row.version,
    clinical: { plan: { conduct: 'Recepção não escreve.' } },
  });
  assert.equal(mariaWrite.status, 403);
  result.expected.push({ status: 403, who: 'Recepção', route: '/api/encounters (plan)' });
  const foraWrite = await fora.request('PATCH', '/api/encounters', {
    businessId: OTHER, id: encounterId, expectedVersion: row.version,
    clinical: { problems: PROBLEMS, plan: { conduct: 'outro tenant' }, procedures: PROCEDURES },
  });
  assert.equal(foraWrite.status, 404);
  result.expected.push({ status: 404, who: 'outra unidade', route: '/api/encounters' });
  assert.equal(snapshotOf(await read(michelle)), guarded, 'request recusado alterou dado/versão/auditoria');
  ok('permissão imposta no servidor: Owner, Recepção, Orlando (mesma unidade) e cross-tenant NÃO escrevem');

  // capacidades resolvidas no servidor para quem não é o responsável
  const ownerView = (await owner.request('GET', `/api/encounters?businessId=${BIZ}&id=${encounterId}`)).data.encounter;
  assert.equal(ownerView.access.canEditClinicalProblems, false);
  assert.equal(ownerView.access.canEditCarePlan, false);
  assert.equal(ownerView.access.canEditClinicalProcedures, false);
  assert.equal(ownerView.access.reason, 'professional_required');
  ok('leitura devolve as capacidades B2 resolvidas no SERVIDOR (Owner vê, não edita)');

  // ── 12 · isolamento por vertical (o pacote B2 não vaza) ──────────────────
  for (const [tenant, email, id, label] of [
    [OD, 'odonto.f1b1', 'enc-odonto-qa', 'odontológica'],
    [ES, 'estetica.f1b1', 'enc-estetica-qa', 'estética'],
  ]) {
    const doctor = await login(email);
    const view = (await doctor.request('GET', `/api/encounters?businessId=${tenant}&id=${id}`)).data.encounter;
    assert.equal(view.access.canEditCore, true, `${label}: CORE universal`);
    assert.equal(view.access.canEditClinicalProblems, false, `${label}: problemas ligado`);
    assert.equal(view.access.canEditCarePlan, false, `${label}: conduta ligado`);
    assert.equal(view.access.canEditClinicalProcedures, false, `${label}: procedimentos ligado`);
    for (const clinical of [
      { problems: [{ id: 'prb-od', kind: 'problem', label: 'não pode' }] },
      { plan: { conduct: 'não pode' } },
      { procedures: [{ id: 'proc-od', name: 'não pode' }] },
    ]) {
      const res = await doctor.request('PATCH', '/api/encounters', {
        businessId: tenant, id, expectedVersion: view.version, clinical,
      });
      assert.equal(res.status, 400, `${label}: ${res.status}`);
      result.expected.push({ status: 400, who: `vertical ${label}`, route: '/api/encounters' });
    }
    const coreWrite = await doctor.request('PATCH', '/api/encounters', {
      businessId: tenant, id, expectedVersion: view.version, complaint: `Queixa no CORE da vertical ${label}.`,
    });
    assert.equal(coreWrite.status, 200, `${label}: CORE recusado`);
    assert.equal(coreWrite.data.encounter.complaint, `Queixa no CORE da vertical ${label}.`);
    assert.deepEqual(coreWrite.data.encounter.clinical?.problems || [], []);
  }
  ok('vertical: odonto e estética NÃO recebem o pacote B2 (400) e o CORE segue editável');

  // ── 13 · legado sem os campos novos normaliza vazio (nada inventado) ─────
  const odontoView = (await (await login('odonto.f1b1')).request('GET', `/api/encounters?businessId=${OD}&id=enc-odonto-qa`)).data.encounter;
  assert.deepEqual(odontoView.clinical?.problems || [], []);
  assert.deepEqual(odontoView.clinical?.procedures || [], []);
  assert.equal(odontoView.clinical?.plan?.conduct ?? '', '');
  ok('documento legado normaliza vazio: nenhum problema/diagnóstico derivado de texto antigo');

  // ── resumo ───────────────────────────────────────────────────────────────
  await fs.writeFile(
    '.cache/f1b2/http-qa-result.json',
    JSON.stringify({ at: new Date().toISOString(), checks: result.checks.length, expected: result.expected.length, server: result.server }, null, 2),
  );
  console.log('\n── resumo QA HTTP F1B2 ──');
  console.log(`checks: ${result.checks.length} · 5xx inesperados: ${result.server.length}`);
  console.log(`respostas esperadas (403/404/400/409 provocados): ${result.expected.length}`);
  if (result.server.length) {
    console.error('FALHA · 5xx inesperado:', JSON.stringify(result.server));
    process.exitCode = 1;
  } else {
    console.log('OK · QA HTTP F1B2 sem 5xx inesperado');
  }
} catch (error) {
  console.error('FALHA no QA HTTP F1B2:', error.message);
  console.error(error.stack?.split('\n').slice(0, 4).join('\n'));
  process.exitCode = 1;
}
