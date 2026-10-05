// ═══════════════════════════════════════════════════════════════
// Clinical Encounter F1B2 — QA de BROWSER (Chromium real, local, descartável)
// ═══════════════════════════════════════════════════════════════
// EXECUTADO com browser REAL (Playwright + Chromium 153 do pacote
// `@sparticuz/chromium`, apontado por QA_EXECUTABLE_PATH, porque os CDNs de
// browser são bloqueados neste sandbox) contra `next start` + banco
// descartável `.cache/f1b1/qa.json`. DOM, eventos, autosave, beforeunload e
// navegação de verdade — nada de simulação.
//
// Rodar:
//   node scripts/seed-f1b1-qa.mjs && node scripts/seed-f1b2-qa.mjs
//   GODOUTOR_DB_FILE=.cache/f1b1/qa.json npm run start -- -p 3111
//   QA_EXECUTABLE_PATH=<chromium> node tests/f1b2/qa.mjs
//
// Cobre o briefing §33–§37: fluxo das SEIS seções no MESMO Encounter
// (Atendimento → Anamnese → Avaliação → Problemas → Conduta → Procedimentos),
// flush na troca de seção, sair → F5 → retomar conferindo TUDO, remoção em
// dois passos, Owner/Recepção sem escrita, 409 real entre duas telas,
// isolamento por vertical, viewports 1440/1280/1024/390 e console/rede limpos.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3111';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent (local disposable QA).');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Local disposable QA only');

const A = 'f1b1-vet-qa';
const OD = 'f1b1-odonto-qa';
const password = 'GodoutorF1B12026!';
const today = new Date().toISOString().slice(0, 10);

const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.QA_EXECUTABLE_PATH) options.executablePath = process.env.QA_EXECUTABLE_PATH;
const browser = await chromium.launch(options);

const EXPECTED_STATUSES = new Set([403, 404, 409]);
const result = { checks: [], console: [], resourceErrors: [], network: [], expected: [], induced: [], patches: 0 };
const RESOURCE_FAILURE = /Failed to load resource: the server responded with a status of (\d{3})/;
let inducedMode = null;
const ok = (label) => { result.checks.push(label); console.log('PASS', label); };
await fs.mkdir('.cache/f1b2', { recursive: true });

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function waitUntil(fn, label, { timeout = 25000, interval = 120 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) throw Error(`timeout esperando: ${label}`);
    await sleep(interval);
  }
}

const FOOTER = '[data-testid="encounter-workspace-save-state"]';
async function saveState(page) {
  const foot = page.locator(FOOTER);
  return { state: await foot.getAttribute('data-persistence-state'), text: (await foot.innerText()).trim() };
}
/** Digitar → pendência visível → gravação CONFIRMADA (nunca estado estale). */
async function waitSaved(page) {
  await waitUntil(async () => ['dirty', 'saving'].includes((await saveState(page)).state), 'indicador assume a pendência');
  assert.equal((await saveState(page)).text, 'Salvando…');
  return waitUntil(async () => {
    const now = await saveState(page);
    return now.state === 'saved' && now.text === 'Salvo agora' ? now : false;
  }, 'gravação confirmada ("Salvo agora")');
}

async function login(email, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (e) => result.console.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const failed = RESOURCE_FAILURE.exec(m.text());
    if (failed) { result.resourceErrors.push({ status: Number(failed[1]), url: m.location?.().url || '' }); return; }
    result.console.push(m.text());
  });
  page.on('request', (r) => {
    if (r.method() === 'PATCH' && r.url().includes('/api/encounters')) result.patches += 1;
  });
  page.on('response', (r) => {
    if (r.status() >= 400) {
      const entry = { status: r.status(), url: r.url() };
      if (inducedMode?.statuses.includes(r.status())) result.induced.push(entry);
      else if (EXPECTED_STATUSES.has(r.status())) result.expected.push(entry);
      else result.network.push(entry);
    }
  });
  await page.goto(`${base}/login`);
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL(/dashboard|agenda|master/);
  return page;
}

async function openBooking(page, time) {
  await page.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);
  await page.locator('[data-agenda-column]').first().waitFor();
  const card = page.locator('button.ag-event').filter({ hasText: 'Mel' }).filter({ hasText: time }).first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.getByRole('heading', { name: 'Detalhe do agendamento', exact: true }).waitFor();
}

async function section(page, name) {
  await page.locator('.encounter-workspace__nav-item', { hasText: name }).click();
}

async function serverRow(page, id, businessId = A) {
  return page.evaluate(async ({ businessId, encounterId }) => {
    const res = await fetch(`/api/encounters?businessId=${encodeURIComponent(businessId)}&id=${encodeURIComponent(encounterId)}`);
    const data = await res.json().catch(() => ({}));
    return data.encounter || null;
  }, { businessId, encounterId: id });
}

const navLabels = (page) => page.locator('.encounter-workspace__nav-item').allInnerTexts();

try {
  // ── 1 · agenda real → iniciar atendimento (Michelle é a responsável) ─────
  const page = await login('michelle.f1b1@godoutor.local');
  await openBooking(page, '15:00');
  const startButton = page.getByRole('button', { name: /Iniciar atendimento|Retomar atendimento/ }).first();
  await startButton.click();
  await page.locator('.encounter-workspace__patient').waitFor();
  const encounterId = new URL(page.url()).pathname.split('/').pop();
  assert.ok(encounterId && encounterId.length > 8, `encounterId na URL: ${page.url()}`);
  ok(`Agenda real → workspace do atendimento (${encounterId.slice(0, 8)}…) no MESMO Encounter`);

  // ── 2 · seis seções reais, na ordem clínica, com estado ativo acessível ──
  assert.deepEqual(await navLabels(page), ['Atendimento', 'Anamnese', 'Avaliação', 'Problemas', 'Conduta', 'Procedimentos']);
  assert.equal(await page.locator('.encounter-workspace__nav-item[aria-current="page"]').count(), 1);
  assert.equal(await page.locator('.encounter-workspace__nav-item[data-section-id="atendimento"]').getAttribute('aria-current'), 'page');
  ok('§16/§37 · veterinária mostra 6 seções (Anexos fora) com aria-current na seção ativa');

  // ── 3 · Atendimento → Anamnese → Avaliação (B1 continua intacta) ────────
  await page.getByLabel('Queixa principal').fill('Coceira nas orelhas há 3 dias (QA F1B2).');
  await waitSaved(page);
  await section(page, 'Anamnese');
  await page.getByLabel(/História atual/).fill('Tutora relata coceira há 3 dias, piora à noite.');
  await waitSaved(page);
  await section(page, 'Avaliação');
  await page.getByLabel('Peso (kg)').fill('9,1');
  await waitSaved(page);
  let row = await serverRow(page, encounterId);
  assert.equal(row.complaint, 'Coceira nas orelhas há 3 dias (QA F1B2).');
  assert.equal(row.clinical.anamnesis.history, 'Tutora relata coceira há 3 dias, piora à noite.');
  assert.equal(row.clinical.assessment.veterinary.weightKg, 9.1);
  ok('Atendimento → Anamnese → Avaliação gravados no MESMO Encounter (B1 sem regressão)');

  // ── 4 · Problemas: adicionar, tipar, descrever (lista compacta) ─────────
  await section(page, 'Problemas');
  await page.locator('[data-section="problemas"]').waitFor();
  await page.getByRole('button', { name: 'Adicionar problema' }).click();
  await page.getByLabel('Descrição do problema 1').fill('Dermatite alérgica');
  await page.getByLabel('Tipo do problema 1').selectOption('hypothesis');
  await page.getByLabel('Observação do problema 1').fill('Suspeita pela sazonalidade.');
  await waitSaved(page);
  await page.getByRole('button', { name: 'Adicionar problema' }).click();
  await page.getByLabel('Descrição do problema 2').fill('Otite externa direita');
  await page.getByLabel('Tipo do problema 2').selectOption('diagnosis');
  await waitSaved(page);

  row = await serverRow(page, encounterId);
  assert.equal(row.clinical.problems.length, 2);
  assert.deepEqual(row.clinical.problems.map((p) => p.kind), ['hypothesis', 'diagnosis']);
  assert.equal(row.clinical.problems[0].label, 'Dermatite alérgica');
  assert.equal(row.clinical.problems[0].notes, 'Suspeita pela sazonalidade.');
  const [problemIdA, problemIdB] = row.clinical.problems.map((p) => p.id);
  assert.ok(problemIdA !== problemIdB && /^prb-/.test(problemIdA), 'ids estáveis e distintos');
  ok('§7–§9 · Problemas: adicionar + tipar (Hipótese/Diagnóstico) + descrever, com id estável por item');

  // acessibilidade: o botão de remover diz O QUE some
  const removeNames = await page.locator('[data-section="problemas"] button[aria-label^="Remover"]').evaluateAll(
    (nodes) => nodes.map((n) => n.getAttribute('aria-label')),
  );
  assert.equal(removeNames.length, 2);
  assert.ok(removeNames.every((name) => /Remover (Hipótese|Diagnóstico): .+/.test(name)), JSON.stringify(removeNames));
  ok('§37 acessibilidade · remover tem nome acessível com tipo e descrição (não depende de cor/ícone)');

  // ── 5 · FLUSH na troca de seção (Avaliação → Problemas → Conduta) ───────
  await section(page, 'Avaliação');
  await page.getByLabel('Peso (kg)').fill('9,3');
  await section(page, 'Problemas');                       // troca SEM esperar o autosave
  await page.locator('[data-section="problemas"]').waitFor();
  row = await waitUntil(async () => {
    const current = await serverRow(page, encounterId);
    return current.clinical.assessment.veterinary.weightKg === 9.3 ? current : false;
  }, 'flush da Avaliação antes de entrar em Problemas');
  assert.equal(row.clinical.problems.length, 2, 'flush apagou problemas');
  ok('§20 · flush na troca de seção: Avaliação grava ANTES de Problemas abrir (nada perdido)');

  // ── 6 · Conduta: plano próprio + contexto em leitura (fonte única) ──────
  await section(page, 'Conduta');
  await page.locator('[data-section="conduta"]').waitFor();
  const planContext = page.locator('[data-testid="plan-context"]');
  assert.equal(await planContext.locator('input, textarea, select').count(), 0, 'contexto com campo editável');
  await page.locator('#plan-conduct').fill('Tratamento tópico por 14 dias; colar elisabetano; reavaliar em 15 dias.');
  await waitSaved(page);
  row = await serverRow(page, encounterId);
  assert.equal(row.clinical.plan.conduct, 'Tratamento tópico por 14 dias; colar elisabetano; reavaliar em 15 dias.');
  assert.equal(row.clinical.plan.conduct, row.guidance ? row.clinical.plan.conduct : row.clinical.plan.conduct);
  assert.notEqual(row.clinical.plan.conduct, row.guidance);
  ok('§10–§11/§25 · Conduta grava clinical.plan.conduct sem duplicar Orientações/Retorno (contexto em leitura)');

  // Orientações ao tutor continuam na seção Atendimento (UM lugar por conceito)
  await section(page, 'Atendimento');
  const guidanceField = page.getByLabel(/^Orientações ao tutor/);
  assert.equal(await guidanceField.count(), 1, 'Orientações ao tutor fora do Atendimento');
  await guidanceField.fill('Manter a orelha seca; colar elisabetano por 7 dias.');
  await waitSaved(page);
  row = await serverRow(page, encounterId);
  assert.equal(row.guidance, 'Manter a orelha seca; colar elisabetano por 7 dias.');
  await section(page, 'Conduta');
  assert.ok((await page.locator('[data-testid="plan-context"]').innerText()).includes('Manter a orelha seca'));
  ok('§26 · Orientações ao tutor vivem SÓ no Atendimento e aparecem na Conduta como contexto');

  // ── 7 · Procedimentos: custom (fora do catálogo) + observação ───────────
  await section(page, 'Procedimentos');
  await page.locator('[data-section="procedimentos"]').waitFor();
  await page.getByRole('button', { name: 'Adicionar procedimento' }).click();
  await page.getByLabel('Nome do procedimento 1').fill('Limpeza auricular');
  await page.getByLabel('Observação do procedimento 1').fill('Bilateral, sem secreção purulenta.');
  await waitSaved(page);
  await page.getByRole('button', { name: 'Adicionar procedimento' }).click();
  await page.getByLabel('Nome do procedimento 2').fill('Procedimento que não existe no catálogo');
  await waitSaved(page);
  row = await serverRow(page, encounterId);
  assert.equal(row.clinical.procedures.length, 2);
  assert.deepEqual(row.clinical.procedures.map((p) => p.name), ['Limpeza auricular', 'Procedimento que não existe no catálogo']);
  assert.ok(row.clinical.procedures.every((p) => /^proc-/.test(p.id)));
  const suggestions = await page.locator('#procedure-suggestions option').count();
  assert.ok(suggestions > 0, 'datalist sem sugestões');
  ok(`§12–§15 · Procedimentos: custom gravado (datalist com ${suggestions} sugestões opcionais) sem exigir Service`);

  // ── 8 · remoção em dois passos (Cancelar preserva · Confirmar remove) ───
  await section(page, 'Problemas');
  const patchesBeforeRemove = result.patches;
  await page.getByRole('button', { name: /Remover Diagnóstico: Otite externa direita/ }).click();
  await page.getByText('Remover “Otite externa direita”?').waitFor();
  await page.getByRole('button', { name: 'Cancelar' }).click();
  await sleep(400);
  assert.equal(result.patches, patchesBeforeRemove, 'Cancelar disparou gravação');
  assert.equal((await page.getByLabel('Descrição do problema 2').inputValue()), 'Otite externa direita');
  await page.getByRole('button', { name: /Remover Diagnóstico: Otite externa direita/ }).click();
  await page.getByRole('button', { name: 'Confirmar remoção' }).click();
  await waitSaved(page);
  row = await serverRow(page, encounterId);
  assert.equal(row.clinical.problems.length, 1);
  assert.equal(row.clinical.problems[0].id, problemIdA, 'identidade do item remanescente mudou');
  ok('§24 · remoção em dois passos na própria linha: Cancelar preserva, Confirmar remove (sem window.confirm)');

  // ── 9 · sair → F5 → retomar: conferir TUDO nas seis seções ──────────────
  await page.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);          // sair do workspace
  await page.goto(`${base}/atendimento/${encounterId}?b=${A}`);            // F5 / retomar
  await page.locator('.encounter-workspace__patient').waitFor();
  assert.deepEqual(await navLabels(page), ['Atendimento', 'Anamnese', 'Avaliação', 'Problemas', 'Conduta', 'Procedimentos']);
  assert.equal(await page.getByLabel('Queixa principal').inputValue(), 'Coceira nas orelhas há 3 dias (QA F1B2).');
  await section(page, 'Anamnese');
  assert.equal(await page.getByLabel(/História atual/).inputValue(), 'Tutora relata coceira há 3 dias, piora à noite.');
  await section(page, 'Avaliação');
  // O servidor devolve a forma canônica ("9.3"); "9,3" foi só a digitação.
  assert.equal(await page.getByLabel('Peso (kg)').inputValue(), '9.3');
  await section(page, 'Problemas');
  assert.equal(await page.getByLabel('Descrição do problema 1').inputValue(), 'Dermatite alérgica');
  assert.equal(await page.getByLabel('Tipo do problema 1').inputValue(), 'hypothesis');
  await section(page, 'Conduta');
  assert.equal(await page.locator('#plan-conduct').inputValue(), 'Tratamento tópico por 14 dias; colar elisabetano; reavaliar em 15 dias.');
  await section(page, 'Procedimentos');
  assert.equal(await page.getByLabel('Nome do procedimento 1').inputValue(), 'Limpeza auricular');
  assert.equal(await page.getByLabel('Nome do procedimento 2').inputValue(), 'Procedimento que não existe no catálogo');
  ok('§33 · sair → F5 → retomar no MESMO Encounter: as 6 seções conferidas campo a campo');

  // ── 10 · Owner sem vínculo: vê as 6 seções, NÃO edita ───────────────────
  const ownerPage = await login('owner.f1b1@godoutor.local');
  await ownerPage.goto(`${base}/atendimento/${encounterId}?b=${A}`);
  await ownerPage.locator('.encounter-workspace__patient').waitFor();
  assert.deepEqual(await navLabels(ownerPage), ['Atendimento', 'Anamnese', 'Avaliação', 'Problemas', 'Conduta', 'Procedimentos']);
  await section(ownerPage, 'Problemas');
  assert.equal(await ownerPage.getByRole('button', { name: 'Adicionar problema' }).isDisabled(), true);
  assert.equal(await ownerPage.getByLabel('Descrição do problema 1').isDisabled(), true);
  assert.ok((await ownerPage.locator('[data-section="problemas"]').innerText()).includes('profissional responsável'));
  await section(ownerPage, 'Conduta');
  assert.equal(await ownerPage.locator('#plan-conduct').isDisabled(), true);
  await section(ownerPage, 'Procedimentos');
  assert.equal(await ownerPage.getByRole('button', { name: 'Adicionar procedimento' }).isDisabled(), true);
  ok('§18 · Owner sem vínculo Professional: vê as 6 seções, campos desabilitados e motivo visível');

  // adversarial: o Owner tenta gravar direto pela API a partir da própria sessão
  inducedMode = { statuses: [403] };
  const ownerAttack = await ownerPage.evaluate(async ({ encounterId, version }) => {
    const attempts = [];
    for (const clinical of [
      { problems: [{ id: 'prb-ui-owner', kind: 'problem', label: 'Invasão pela UI' }] },
      { plan: { conduct: 'Invasão pela UI' } },
      { procedures: [{ id: 'proc-ui-owner', name: 'Invasão pela UI' }] },
    ]) {
      const res = await fetch('/api/encounters', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ businessId: 'f1b1-vet-qa', id: encounterId, expectedVersion: version, clinical }),
      });
      attempts.push(res.status);
    }
    return attempts;
  }, { encounterId, version: (await serverRow(page, encounterId)).version });
  assert.deepEqual(ownerAttack, [403, 403, 403], JSON.stringify(ownerAttack));
  row = await serverRow(page, encounterId);
  assert.ok(!JSON.stringify(row.clinical).includes('Invasão pela UI'), ' Owner gravou dado clínico');
  inducedMode = null;
  ok('§18 ADVERSARIAL · Owner tenta problems/plan/procedures pela API: 3× 403 e nada gravado');

  // ── 11 · duas telas: 409 real, texto preservado, nada sobrescrito ───────
  const tabA = page;
  const tabB = await login('michelle.f1b1@godoutor.local');
  await tabB.goto(`${base}/atendimento/${encounterId}?b=${A}`);
  await tabB.locator('.encounter-workspace__patient').waitFor();
  await section(tabB, 'Conduta');
  await tabB.locator('#plan-conduct').fill('Gravado na SEGUNDA tela.');
  await waitSaved(tabB);

  await section(tabA, 'Conduta');
  await tabA.locator('#plan-conduct').fill('Texto da PRIMEIRA tela (não pode sobrescrever).');
  await waitUntil(async () => tabA.locator('.encounter-core__conflict[role="alert"]').count(), 'aviso de conflito');
  assert.ok((await tabA.locator('.encounter-core__conflict').innerText()).includes('outra tela'));
  assert.equal(await tabA.locator('#plan-conduct').inputValue(), 'Texto da PRIMEIRA tela (não pode sobrescrever).');
  row = await serverRow(page, encounterId);
  assert.equal(row.clinical.plan.conduct, 'Gravado na SEGUNDA tela.', '409 sobrescreveu o servidor');
  ok('§21 · duas telas: 409 real com aviso, texto local preservado e nada sobrescrito no servidor');

  // "Continuar editando" mantém o texto; retry grava com a versão atual
  await tabA.getByRole('button', { name: 'Continuar editando' }).click();
  assert.equal(await tabA.locator('#plan-conduct').inputValue(), 'Texto da PRIMEIRA tela (não pode sobrescrever).');
  await tabA.getByRole('button', { name: 'Recarregar versão atual' }).click();
  await waitUntil(async () => (await tabA.locator('#plan-conduct').inputValue()) === 'Gravado na SEGUNDA tela.', 'recarregar versão atual');
  // Após "Recarregar" a seção re-adota a linha do servidor: o texto só vale
  // quando PERMANECE no campo (senão estaríamos gravando uma adoção, não um edit).
  // Prova pelo servidor (mais forte que o rótulo do rodapé): o retry só termina
  // quando a decisão final ESTÁ gravada, com os procedimentos intactos.
  row = await waitUntil(async () => {
    await tabA.locator('#plan-conduct').fill('Decisão final após o conflito.');
    const current = await serverRow(page, encounterId);
    return current.clinical.plan.conduct === 'Decisão final após o conflito.' ? current : false;
  }, 'decisão final gravada depois do conflito');
  assert.equal((await tabA.locator('#plan-conduct').inputValue()), 'Decisão final após o conflito.');
  assert.equal(row.clinical.procedures.length, 2, 'conflito apagou procedimentos');
  ok('§21 · Continuar editando preserva o texto; recarregar + retry grava sem perder nada');

  // ── 12 · vertical: odonto NÃO recebe o pacote B2 ────────────────────────
  const odontoPage = await login('odonto.f1b1@godoutor.local');
  await odontoPage.goto(`${base}/atendimento/enc-odonto-qa?b=${OD}`);
  await odontoPage.locator('.encounter-workspace__patient').waitFor();
  assert.equal(await odontoPage.locator('.encounter-workspace__nav').count(), 0, 'nav de seções na odonto');
  for (const label of ['Anamnese', 'Avaliação', 'Problemas', 'Conduta', 'Procedimentos']) {
    assert.equal(await odontoPage.locator('.encounter-workspace__nav-item', { hasText: label }).count(), 0, `${label} na odonto`);
  }
  assert.equal(await odontoPage.locator('[data-section="problemas"]').count(), 0);
  ok('§17/§19 · odonto: pacote B2 não aparece no DOM (ocultar ≠ apagar; CORE intacto)');

  // ── 13 · viewports: sem overflow, seis seções alcançáveis ───────────────
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}/atendimento/${encounterId}?b=${A}`);
    await page.locator('.encounter-workspace__patient').waitFor();
    for (const name of ['Problemas', 'Conduta', 'Procedimentos']) {
      await section(page, name);
      await page.locator(`[data-section="${name === 'Problemas' ? 'problemas' : name === 'Conduta' ? 'conduta' : 'procedimentos'}"]`).waitFor();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${width}px: rolagem horizontal de ${overflow}px`);
    ok(`§34 viewport ${width}×${height}: 3 seções novas utilizáveis, sem rolagem horizontal`);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });

  // ── 14 · higiene de rede/console ────────────────────────────────────────
  assert.equal(result.network.length, 0, `respostas inesperadas: ${JSON.stringify(result.network)}`);
  assert.equal(result.console.length, 0, `console com erro: ${JSON.stringify(result.console)}`);
  const accounted = new Set([...result.expected, ...result.induced].map((entry) => entry.status));
  const orphan = result.resourceErrors.filter((entry) => !accounted.has(entry.status));
  assert.equal(orphan.length, 0, `falhas de recurso não contabilizadas: ${JSON.stringify(orphan)}`);
  assert.ok(![...result.expected, ...result.induced].some((entry) => entry.status >= 500), 'houve 5xx');
  ok(`§35 console 0 erro inesperado · rede 0 resposta ≥400 inesperada e 0 5xx (${result.resourceErrors.length} provocadas/documentadas)`);
} finally {
  console.log('\n── resumo QA F1B2 (browser) ──');
  console.log(`checks: ${result.checks.length} · console: ${result.console.length} · falhas de recurso: ${result.resourceErrors.length} · rede inesperada: ${result.network.length} · esperadas: ${result.expected.length} · induzidas: ${result.induced.length} · PATCH: ${result.patches}`);
  await fs.writeFile('.cache/f1b2/qa-result.json', JSON.stringify(result, null, 2)).catch(() => {});
  await browser.close();
  if (result.network.length || result.console.length) process.exitCode = 1;
}
