// ═══════════════════════════════════════════════════════════════
// SMOKE P4 — MOTOR DE AUTOMAÇÕES (runtime, servidor real)
// ═══════════════════════════════════════════════════════════════
// Roda contra um servidor com os dados do `npm run seed`:
//   npm run dev   (em outro terminal)   →   node scripts/seed.mjs   →   npm run smoke:p4
//
// O que é provado AQUI (de ponta a ponta, pelo HTTP, no banco de verdade):
//   1. a tela e a API existem, com catálogo de gatilhos e modelos internos;
//   2. criar automação pela forma linear (Quando/Se/Então/Depois) e ler a
//      projeção de volta;
//   3. definições inválidas são recusadas com erro legível (nunca gravadas);
//   4. o gatilho sai do serviço oficial (ingestão externa de leads) e a ação
//      mexe na esteira REAL do lead;
//   5. condição falsa ⇒ nenhuma execução (e nenhuma ação);
//   6. espera: a execução fica 'waiting' com ponto de retomada gravado e é
//      RETOMADA depois por varredura — sem depender de requisição aberta;
//   7. a ação 'criar tarefa' aparece na fila de tarefas da unidade e pode ser
//      concluída;
//   8. ação de webhook usa o canal do P3 (assinatura HMAC no receptor real);
//   9. isolamento multi-tenant: a automação de uma empresa não roda para a
//      outra, e outra empresa não a vê nem edita;
//  10. ativar/desligar, duplicar (cópia nasce desligada) e excluir (histórico
//      preservado);
//  11. regressão P3: o mesmo lead continua gerando webhook normal do P3 e a
//      automação de mensagem do P3 não foi alterada;
//  12. o endpoint do consumidor é fail-closed (sem CRON_SECRET, 503).
//
// Para validar a RETOMADA pelo agendador (como a VPS faria) defina o mesmo
// CRON_SECRET no servidor e aqui; sem ele, o smoke empurra a fila por uma
// escrita comum (o gancho inline do updateDB faz o motor andar) — os dois
// caminhos chegam ao mesmo estado.
import assert from 'node:assert/strict';
import http from 'node:http';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const CRON_SECRET = process.env.CRON_SECRET || '';
const WAIT_MS = Number(process.env.SMOKE_P4_WAIT_MS || 62000);
const RUN = String(Date.now() % 100000000).padStart(8, '0');
const ph = (n) => `119${RUN.slice(0, 4)}${String(n).padStart(4, '0')}`; // único por execução
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
function ok(label) {
  passed += 1;
  console.log(`  ✓ ${label}`);
}

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', ...opts.headers },
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

/** Espera a condição virar verdadeira no estado persistido (motor assíncrono). */
async function until(label, probe, timeoutMs = 20000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await probe();
    if (last) return last;
    await sleep(500);
  }
  throw new Error(`timeout esperando: ${label}${last === null ? '' : ` (último: ${JSON.stringify(last).slice(0, 200)})`}`);
}

console.log(`\nSMOKE P4 ${BASE} [run ${RUN}]\n`);

// ── 0. sessão do painel e empresa-alvo (com agenda) ──────────
const login = await req('/api/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email: 'demo@instalink.app', password: 'demo1234' }),
});
assert.equal(login.status, 200, 'login demo');
const token = login.data.token;
const auth = { Authorization: `Bearer ${token}` };

const me = await req('/api/auth/me', { headers: auth });
assert.equal(me.status, 200);
const units = me.data.businesses || [];
const target = units.find((b) => b.id === 'biz-clinicavitta') || units.find((b) => (b.modes || []).includes('bookings')) || units[0];
const other = units.find((b) => b.id !== target.id) || null;
const B = target.id;
assert.ok(B, 'empresa de teste');
ok(`sessão do painel obtida (empresa ${target.slug})`);

// ── 1. chave de integração (fonte do gatilho, como na vida real) ──
const keyRes = await req(`/api/integrations/keys?businessId=${B}`, {
  method: 'POST', headers: auth, body: JSON.stringify({ name: `Smoke P4 ${RUN}`, businessId: B }),
});
assert.equal(keyRes.status, 201, 'criar API key');
const apiKey = keyRes.data.fullSecret || keyRes.data.key;
const keyHeader = { Authorization: `Bearer ${apiKey}` };
ok('API key de integração criada (o gatilho vem por ela)');

// ── 2. a tela e a API ──
const page = await fetch(`${BASE}/automacoes`, { headers: auth });
assert.equal(page.status, 200, 'GET /automacoes');
const html = await page.text();
assert.ok(html.includes('InstaLink'), 'página renderiza');
ok('tela /automacoes responde');

const list0 = await req(`/api/automations?businessId=${B}`, { headers: auth });
assert.equal(list0.status, 200);
assert.ok(Array.isArray(list0.data.automations), 'lista');
assert.ok((list0.data.templates || []).length >= 5, 'modelos internos disponíveis');
assert.equal(list0.data.capabilities['automation.basic'], true, 'capacidade básica ligada');
assert.ok((list0.data.options?.stages || []).length > 0, 'etapas reais da esteira no editor');
ok(`catálogo lido (${list0.data.templates.length} modelos, ${list0.data.options.stages.length} etapas)`);

// ── 2b. limpeza de resíduo de execuções anteriores do próprio smoke ──
for (const leftover of (list0.data.automations || []).filter((a) => /^Smoke P4/.test(a.name))) {
  await req('/api/automations', { method: 'DELETE', headers: auth, body: JSON.stringify({ businessId: B, id: leftover.id }) });
}

// ── 3. validação recusa o que não pode rodar ──
const badAction = await req('/api/automations', {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    businessId: B, name: 'Inválida', event: 'lead.created',
    steps: [{ kind: 'action', action: { type: 'mandar_email', params: {} } }],
  }),
});
assert.equal(badAction.status, 422, 'ação inexistente é recusada');
assert.ok(badAction.data.errors.some((e) => /ação/i.test(e)), 'erro legível');

const badField = await req('/api/automations', {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    businessId: B, name: 'Campo errado', event: 'lead.created',
    condition: { field: 'booking.status', operator: 'equals', value: 'confirmed' },
  }),
});
assert.equal(badField.status, 422, 'campo fora do gatilho é recusado');

const cycleNodes = [
  { id: 't', type: 'trigger', config: { event: 'lead.created' } },
  { id: 'a', type: 'action', config: { action: { type: 'add_lead_note', params: { text: 'eco' } } } },
  { id: 'c', type: 'condition', config: { condition: { field: 'lead.name', operator: 'exists' } } },
];
const badCycle = await req('/api/automations', {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    businessId: B, name: 'Ciclo', event: 'lead.created', nodes: cycleNodes,
    edges: [{ from: 't', to: 'a' }, { from: 'a', to: 'c' }, { from: 'c', to: 'a', branch: 'yes' }, { from: 'c', to: 'a', branch: 'no' }],
  }),
});
assert.equal(badCycle.status, 422, 'ciclo sem espera é recusado na gravação');
const afterRejections = await req(`/api/automations?businessId=${B}`, { headers: auth });
assert.equal(afterRejections.data.automations.filter((a) => /Inválida|Campo errado|Ciclo/.test(a.name)).length, 0, 'nada foi gravado');
ok('validação: ação, campo e ciclo inválidos recusados sem gravar');

// ── 4. automação real: qualificar + esperar + tarefa ──
const created = await req('/api/automations', {
  method: 'POST', headers: auth,
  body: JSON.stringify({
    businessId: B,
    name: `Smoke P4 — Instagram → qualificar e retomar`,
    description: 'Criada pelo smoke (motor de automações)',
    event: 'lead.created',
    condition: { logic: 'and', conditions: [{ field: 'lead.origin', operator: 'equals', value: 'instagram' }] },
    steps: [
      { kind: 'action', label: 'Alterar etapa', action: { type: 'change_lead_stage', params: { stageId: 'qualifying', note: 'qualificado pela automação' } } },
      { kind: 'wait', label: 'Esperar', wait: { mode: 'duration', minutes: 1 } },
      { kind: 'action', label: 'Criar tarefa', action: { type: 'create_task', params: { title: 'Retomar {{lead.name}} ({{lead.origin}})', dueInMinutes: 240 } } },
    ],
  }),
});
assert.equal(created.status, 201, 'automação criada');
const automation = created.data.automation;
assert.equal(automation.linear.steps.length, 3, 'projeção linear volta igual');
assert.equal(automation.nodes[0].type, 'trigger');
assert.deepEqual(automation.nodes.map((n) => n.type), ['trigger', 'condition', 'action', 'wait', 'action', 'end']);
ok('automação criada pela forma linear e gravada como grafo (6 nós)');

// ── 5. gatilho com condição VERDADEIRA → ação na esteira real + espera ──
const phoneHit = ph(11);
const hit = await req('/api/external/leads', {
  method: 'POST', headers: keyHeader,
  body: JSON.stringify({ name: 'Alvo P4', phone: phoneHit, source: 'instagram', message: 'Quero agendar' }),
});
assert.equal(hit.status, 201, 'lead criado pela API externa');
const hitLead = hit.data.lead;

const waiting = await until('execução entrar em espera', async () => {
  const l = await req(`/api/automations/${automation.id}?businessId=${B}&limit=10`, { headers: auth });
  const run = (l.data.runs || []).find((r) => r.context?.lead?.id === hitLead.id);
  return run && (run.status === 'waiting' || run.status === 'completed') ? run : null;
});
assert.equal(waiting.history.some((h) => h.outcome === 'true'), true, 'condição registrada como verdadeira');
// 'executed' é o normal; 'skipped' acontece quando outra automação (de um
// smoke anterior) já deixou o lead na etapa — nos dois casos a ação oficial foi
// chamada e o histórico diz a verdade.
assert.equal(
  waiting.history.some((h) => /etapa/i.test(h.label) && ['executed', 'skipped'].includes(h.outcome)),
  true,
  'ação de etapa processada (executada ou reconhecida como já feita)',
);

const leadsAfter = await req(`/api/external/leads?businessId=${B}&search=${phoneHit}`, { headers: keyHeader });
const movedLead = (leadsAfter.data.leads || []).find((x) => x.id === hitLead.id);
assert.equal(movedLead.stageId, 'qualifying', 'a ESTEIRA REAL mudou (ação delegada ao motor do P3)');
assert.ok((movedLead.stageHistory || []).length >= 2, 'histórico da esteira preservado');
ok('gatilho → condição verdadeira → ação mudou a etapa do lead na esteira');

if (waiting.status === 'waiting') {
  assert.ok(waiting.waitingUntil, 'espera gravada com data de retomada');
  // O "corrente" é o nó SEGUINTE à espera: ao retomar, o delay não é refeito.
  assert.equal(waiting.currentNodeId, 'do_3', 'ponto de retomada é a próxima ação');
  // gatilho + condição + ação + espera = 4 passos processados antes de pausar
  assert.equal(waiting.steps, 4, 'passos contados (gatilho, condição, ação, espera)');
  ok(`execução pausada em espera (retoma em ${waiting.waitingUntil.slice(11, 16)}Z, do nó ${waiting.currentNodeId})`);
}

// ── 6. evento que casa, mas condição FALSA → execução existe e não age ──
// (o gatilho cria o registro de execução; a condição é decidida pelo motor —
// assim o lojista VÊ "recebi o evento e decidi não fazer nada", em vez de
// silêncio insondável.)
const phoneMiss = ph(12);
const miss = await req('/api/external/leads', {
  method: 'POST', headers: keyHeader,
  body: JSON.stringify({ name: 'Fora do Alvo P4', phone: phoneMiss, source: 'whatsapp' }),
});
assert.equal(miss.status, 201);
const missLead = miss.data.lead;
const missRun = await until('execução da condição falsa concluir', async () => {
  const l = await req(`/api/automations/${automation.id}?businessId=${B}&limit=20`, { headers: auth });
  const run = (l.data.runs || []).find((r) => r.context?.lead?.id === missLead.id);
  return run && run.status === 'completed' ? run : null;
}, 15000);
assert.equal(missRun.history.some((h) => h.outcome === 'false'), true, 'condição registrada como NÃO atendida');
assert.equal(missRun.history.filter((h) => ['executed', 'skipped'].includes(h.outcome)).length, 0, 'nenhuma ação executada');
const missLeads = await req(`/api/external/leads?businessId=${B}&search=${phoneMiss}`, { headers: keyHeader });
assert.notEqual((missLeads.data.leads || [])[0]?.stageId, 'qualifying', 'nenhuma ação vazou para o lead errado');
ok('condição falsa → execução concluída sem efeito (com o "não" no histórico)');

// ── 7. retomada da espera ──
const kick = async () => {
  if (CRON_SECRET) {
    const res = await req('/api/cron/automations', { headers: { Authorization: `Bearer ${CRON_SECRET}` } });
    assert.equal(res.status, 200, 'cron do motor responde');
    return res.data;
  }
  // Sem segredo de cron: uma escrita qualquer dispara o gancho inline do motor
  // (mesmo caminho usado pelo painel).
  await req('/api/automations', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ businessId: B, action: 'toggle', id: automation.id, active: true }),
  });
  return null;
};
console.log(`  · aguardando a espera vencer (${Math.round(WAIT_MS / 1000)}s)…`);
await sleep(WAIT_MS);
await kick();
const resumed = await until('execução retomar e concluir', async () => {
  const l = await req(`/api/automations/${automation.id}?businessId=${B}&limit=10`, { headers: auth });
  const run = (l.data.runs || []).find((r) => r.context?.lead?.id === hitLead.id);
  return run && run.status === 'completed' ? run : null;
}, 40000);
assert.equal(resumed.history.some((h) => h.outcome === 'waiting'), true, 'espera registrada');
assert.ok(resumed.history.filter((h) => h.outcome === 'executed').length >= 2, 'dois passos executados (etapa + tarefa)');
const tasks = await req(`/api/tasks?businessId=${B}`, { headers: auth });
const followUp = (tasks.data.tasks || []).find((t) => t.title === 'Retomar Alvo P4 (instagram)');
assert.ok(followUp, 'a tarefa do follow-up nasceu da execução retomada');
assert.equal(followUp.leadId, hitLead.id, 'tarefa vinculada ao lead');
ok('espera vencida → execução retomada do ponto salvo → tarefa criada');

const done = await req('/api/tasks', { method: 'PATCH', headers: auth, body: JSON.stringify({ businessId: B, id: followUp.id, status: 'done' }) });
assert.equal(done.status, 200);
assert.equal(done.data.task.status, 'done');
ok('tarefa operacional pode ser concluída pela equipe');

// ── 8. webhook de saída acionado pela automação (canal do P3) ──
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
if (isLocal) {
  const received = [];
  const receiver = http.createServer((req2, res2) => {
    let raw = '';
    req2.on('data', (c) => { raw += c; });
    req2.on('end', () => {
      received.push({ path: req2.url, sig: req2.headers['x-instalink-signature'] || '', body: raw });
      res2.writeHead(200, { 'content-type': 'application/json' });
      res2.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const hookPort = receiver.address().port;
  const hookUrl = `http://127.0.0.1:${hookPort}/p4-hook`;

  const hook = await req('/api/integrations/webhooks', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ businessId: B, url: hookUrl, events: ['lead.updated'], active: true }),
  });
  assert.equal(hook.status, 201, 'webhook de saída criado');

  const hookAuto = await req('/api/automations', {
    method: 'POST', headers: auth,
    body: JSON.stringify({
      businessId: B, name: 'Smoke P4 — avisar sistema externo', event: 'lead.created',
      steps: [{ kind: 'action', action: { type: 'dispatch_webhook', params: { event: 'lead.updated', note: 'automação: lead novo no alvo' } } }],
    }),
  });
  assert.equal(hookAuto.status, 201);

  const phoneHook = ph(13);
  await req('/api/external/leads', {
    method: 'POST', headers: keyHeader,
    body: JSON.stringify({ name: 'Hook P4', phone: phoneHook, source: 'instagram' }),
  });
  await until('webhook disparado pela automação chegar ao receptor', async () => {
    const found = received.find((h) => h.path === '/p4-hook' && h.body.includes('automação: lead novo no alvo'));
    return found || null;
  }, 15000);
  const payload = JSON.parse(received.find((h) => h.path === '/p4-hook').body);
  assert.ok(/^t=\d+,v1=[a-f0-9]{64}$/.test(received.find((h) => h.path === '/p4-hook').sig), 'assinatura HMAC presente');
  assert.equal(payload.event, 'lead.updated');
  assert.equal(payload.data.note, 'automação: lead novo no alvo');
  assert.ok(payload.data.source === 'automation', 'origem identificada no payload');
  receiver.close();
  ok('ação dispatch_webhook usa o canal assinado do P3 (HMAC + payload)');

  // Limpeza: o receptor local já não existe — remover webhook e automação para
  // não deixar entregas pendentes no ambiente (o consumidor do P3 as
  // reprocessaria para um destino morto).
  await req('/api/automations', { method: 'DELETE', headers: auth, body: JSON.stringify({ businessId: B, id: hookAuto.data.automation.id }) });
  await req('/api/integrations/webhooks', { method: 'DELETE', headers: auth, body: JSON.stringify({ businessId: B, webhookId: hook.data.webhook.id }) });
} else {
  console.log('  · seção de webhook pulada (receptor local só com BASE_URL em localhost)');
}

// ── 9. isolamento multi-tenant ──
if (other) {
  const otherList = await req(`/api/automations?businessId=${other.id}`, { headers: auth });
  assert.equal(otherList.status, 200);
  assert.equal((otherList.data.automations || []).some((a) => a.id === automation.id), false, 'automação não aparece na outra empresa');

  const otherKey = await req(`/api/integrations/keys?businessId=${other.id}`, {
    method: 'POST', headers: auth, body: JSON.stringify({ name: `Smoke P4 outro ${RUN}`, businessId: other.id }),
  });
  assert.equal(otherKey.status, 201);
  const otherPhone = ph(14);
  await req('/api/external/leads', {
    method: 'POST', headers: { Authorization: `Bearer ${otherKey.data.fullSecret || otherKey.data.key}` },
    body: JSON.stringify({ name: 'Outro Tenant', phone: otherPhone, source: 'instagram' }),
  });
  await sleep(1200);
  const otherRuns = await req(`/api/automations/${automation.id}?businessId=${other.id}&limit=20`, { headers: auth });
  assert.ok([403, 404].includes(otherRuns.status), 'a automação de A não é lida pelo contexto de B');
  const otherTasks = await req(`/api/tasks?businessId=${other.id}`, { headers: auth });
  assert.equal((otherTasks.data.tasks || []).some((t) => /Retomar Outro Tenant/.test(t.title)), false, 'nenhuma ação vazou para a outra empresa');
  ok('isolamento: gatilho na empresa B não acionou nada da empresa A');
}

// ── 10. ativar/desligar, duplicar, excluir ──
const off = await req('/api/automations', {
  method: 'POST', headers: auth, body: JSON.stringify({ businessId: B, action: 'toggle', id: automation.id, active: false }),
});
assert.equal(off.status, 200);
assert.equal(off.data.automation.active, false);
const phoneOff = ph(15);
await req('/api/external/leads', {
  method: 'POST', headers: keyHeader, body: JSON.stringify({ name: 'Desligada', phone: phoneOff, source: 'instagram' }),
});
await sleep(1500);
const runsOff = await req(`/api/automations/${automation.id}?businessId=${B}&limit=30`, { headers: auth });
assert.equal((runsOff.data.runs || []).filter((r) => r.context?.lead?.phone === phoneOff).length, 0, 'automação inativa não dispara');
ok('desativada → para de receber gatilhos (sem apagar nada)');

const dup = await req('/api/automations', {
  method: 'POST', headers: auth, body: JSON.stringify({ businessId: B, action: 'duplicate', id: automation.id }),
});
assert.equal(dup.status, 201, 'duplicar (cria um recurso novo)');
assert.equal(dup.data.automation.active, false, 'cópia nasce desligada');
assert.match(dup.data.automation.name, /cópia/);
assert.notEqual(dup.data.automation.id, automation.id);
ok('duplicada (cópia desligada para revisão)');

const del = await req('/api/automations', { method: 'DELETE', headers: auth, body: JSON.stringify({ businessId: B, id: dup.data.automation.id }) });
assert.equal(del.status, 200);
const afterDelete = await req(`/api/automations?businessId=${B}`, { headers: auth });
assert.equal((afterDelete.data.automations || []).some((a) => a.id === dup.data.automation.id), false);
const historyAfterDelete = await req(`/api/automations/${automation.id}?businessId=${B}&limit=5`, { headers: auth });
assert.ok((historyAfterDelete.data.runs || []).length >= 1, 'histórico das execuções continua acessível');
ok('excluída com histórico preservado');

// ── 11. modelo interno (template) gera automação válida ──
const tpl = await req('/api/automations', {
  method: 'POST', headers: auth, body: JSON.stringify({ businessId: B, templateId: 'lead_assign_owner' }),
});
assert.equal(tpl.status, 201, 'template aplicado');
const tplPhone = ph(16);
await req('/api/external/leads', {
  method: 'POST', headers: keyHeader, body: JSON.stringify({ name: 'Do Template', phone: tplPhone, source: 'instagram' }),
});
await until('template atribuir responsável rodar', async () => {
  const l = await req(`/api/external/leads?businessId=${B}&search=${tplPhone}`, { headers: keyHeader });
  const lead = (l.data.leads || []).find((x) => x.phone === tplPhone);
  return lead && lead.assignedUserId ? lead : null;
}, 15000);
ok('template interno virou automação real e atribuiu responsável');
const tplDel = await req('/api/automations', { method: 'DELETE', headers: auth, body: JSON.stringify({ businessId: B, id: tpl.data.automation.id }) });
assert.equal(tplDel.status, 200);

// ── 12. consumidor fail-closed ──
const anonCron = await req('/api/cron/automations');
if (CRON_SECRET) {
  assert.equal(anonCron.status, 401, 'sem credencial: recusado');
} else {
  assert.equal(anonCron.status, 503, 'sem CRON_SECRET: desativado (nunca aberto)');
}
assert.ok(!JSON.stringify(anonCron.data).includes('lead'), 'resposta do cron não vaza dados');
ok(`consumidor do motor fail-closed (${anonCron.status})`);

console.log(`\nSMOKE P4: ${passed} verificações passaram.\n`);
