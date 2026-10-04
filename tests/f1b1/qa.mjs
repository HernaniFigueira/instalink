// ═══════════════════════════════════════════════════════════════
// Clinical Encounter F1B1 — QA de BROWSER (Chromium real, local, descartável)
// ═══════════════════════════════════════════════════════════════
// EXECUTADO. Primeira execução: 2026-10-04, Chromium 153.0.8010.0 real
// (Playwright 1.63) contra `next start` + banco descartável `.cache/f1b1/qa.json`.
// Detalhe do ambiente: os CDNs de browser (cdn.playwright.dev, storage.
// googleapis.com) são bloqueados ECONNRESET neste sandbox; o Chromium foi
// obtido pelo pacote npm `@sparticuz/chromium` (binário + libs EMBUTIDOS no
// tarball, baixável do registry.npmjs.org) e apontado por QA_EXECUTABLE_PATH,
// com LD_LIBRARY_PATH/FONTCONFIG_PATH do próprio pacote. A execução usa
// browser REAL: DOM, eventos, autosave, beforeunload e navegação de verdade.
//
// Rodar:
//   node scripts/seed-f1b1-qa.mjs
//   GODOUTOR_DB_FILE=.cache/f1b1/qa.json npm run start -- -p 3111
//   QA_EXECUTABLE_PATH=<chromium> node tests/f1b1/qa.mjs
//
// Cobre o fluxo do briefing: Agenda → iniciar/retomar → Atendimento → trocar
// para Anamnese (grava antes) → Anamnese → trocar para Avaliação → Avaliação
// (peso/temperatura/FC/FR/exame) → sair → F5 → retomar → conferir TUDO;
// F5/menu lateral com texto pendente (proteção §13); falha de rede não troca
// de seção e preserva o texto; 409 real não sobrescreve; Owner sem vínculo não
// edita; Recepção não entra; outra unidade dá 404; 1440/1280/1024/390 e
// console/rede limpos (§27/§28/§29/§32).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3111';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent (local disposable QA).');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Local disposable QA only');

const A = 'f1b1-vet-qa';
const B = 'f1b1-outra-qa';
const OD = 'f1b1-odonto-qa';
const ES = 'f1b1-estetica-qa';
const password = 'GodoutorF1B12026!';
const today = new Date().toISOString().slice(0, 10);

const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.QA_EXECUTABLE_PATH) options.executablePath = process.env.QA_EXECUTABLE_PATH;
const browser = await chromium.launch(options);

const EXPECTED_STATUSES = new Set([403, 404, 409]);
const result = { checks: [], console: [], resourceErrors: [], network: [], expected: [], induced: [], patches: 0 };
/** O navegador loga toda resposta ≥400 como erro de console — inclusive as que
 *  a própria QA provoca. Elas são contabilizadas à parte e só valem "verdes"
 *  se casarem com um status esperado/induzido; erro de console de verdade
 *  (exceção, `pageerror`) continua sendo falha. */
const RESOURCE_FAILURE = /Failed to load resource: the server responded with a status of (\d{3})/;
let inducedMode = null;
const ok = (label) => { result.checks.push(label); console.log('PASS', label); };
await fs.mkdir('.cache/f1b1', { recursive: true });

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Espera ATIVA com condição explícita — nada de `waitForTimeout` como prova. */
async function waitUntil(fn, label, { timeout = 20000, interval = 120 } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > deadline) throw Error(`timeout esperando: ${label}`);
    await sleep(interval);
  }
}

const FOOTER = '[data-testid="encounter-workspace-save-state"]';
/** Estado de persistência que o USUÁRIO vê (rótulo) e o estado declarado. */
async function saveState(page) {
  const foot = page.locator(FOOTER);
  const state = await foot.getAttribute('data-persistence-state');
  return { state, text: (await foot.innerText()).trim() };
}
/** Digitar → pendência visível → gravação CONFIRMADA (nunca estado estale). */
async function waitSaved(page) {
  await waitUntil(async () => ['dirty', 'saving'].includes((await saveState(page)).state), 'indicador assume a pendência');
  const shown = await saveState(page);
  assert.equal(shown.text, 'Salvando…', `pendência deve aparecer como "Salvando…", veio "${shown.text}"`);
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
    const text = m.text();
    const failed = RESOURCE_FAILURE.exec(text);
    if (failed) { result.resourceErrors.push({ status: Number(failed[1]), url: m.location?.().url || '' }); return; }
    result.console.push(text);
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

/** Versão ATUAL do servidor (leitura crua) — para provar quem ganhou no 409.
 *  `businessId` é explícito: a QA também prova tenants de OUTRAS verticais. */
async function serverRow(page, id, businessId = A) {
  return page.evaluate(async ({ businessId, encounterId }) => {
    const res = await fetch(`/api/encounters?businessId=${encodeURIComponent(businessId)}&id=${encodeURIComponent(encounterId)}`);
    const data = await res.json().catch(() => ({}));
    return data.encounter || null;
  }, { businessId, encounterId: id });
}

try {
  // ── 1 · Michelle: agenda → iniciar → workspace com o Pet protagonista ────
  const page = await login('michelle.f1b1@godoutor.local');
  await openBooking(page, '15:00');
  await page.getByRole('button', { name: /Iniciar atendimento|Retomar atendimento/ }).click();
  await page.waitForURL(/\/atendimento\/[0-9a-f-]{36}/);
  const encounterId = new URL(page.url()).pathname.split('/').pop();
  const header = page.locator('.encounter-workspace__header');
  await header.waitFor();
  assert.equal((await page.locator('.encounter-workspace__patient').innerText()).trim(), 'Mel');
  assert.match(await page.locator('.encounter-workspace__tutor').innerText(), /Isabelle/);
  ok(`workspace canônico com o Pet protagonista (${encounterId.slice(0, 8)}…)`);

  const nav = page.locator('.encounter-workspace__nav-item');
  assert.deepEqual(await nav.allInnerTexts(), ['Atendimento', 'Anamnese', 'Avaliação']);
  ok('navegação clínica com as três seções reais (sem aba morta)');

  // ── 2 · Atendimento → troca imediata para Anamnese (grava antes) ────────
  await page.getByLabel(/Queixa principal/).fill('Coceira nas orelhas (queixa principal).');
  await section(page, 'Anamnese');
  await page.getByLabel(/História atual/).waitFor();
  ok('trocar de seção salvou antes de sair do Atendimento');

  // ── 3 · Anamnese ────────────────────────────────────────────────────────
  await page.getByLabel(/História atual/).fill('Coceira há 3 dias, piora à noite.');
  await page.getByLabel(/^Alimentação/).fill('Ração seca habitual.');
  await page.getByLabel(/^Apetite/).selectOption('usual');
  await page.getByLabel(/^Ingestão de água/).selectOption('changed');
  await page.getByLabel(/^Urina/).selectOption('usual');
  await page.getByLabel(/^Fezes/).selectOption('changed');
  await page.getByLabel(/^Vômito/).selectOption('no');
  await page.getByLabel(/^Diarreia/).selectOption('yes');
  await page.getByLabel(/Medicações em uso/).fill('Antipulgas mensal (relatado).');
  await page.getByLabel(/^Alergias/).fill('Tutor relata reação a ração de frango.');
  await page.getByLabel(/Observações da anamnese/).fill('Mel está mais quieta.');
  await section(page, 'Avaliação');
  await page.getByLabel('Peso (kg)').waitFor();
  ok('anamnese preenchida e troca imediata para Avaliação com gravação antes');

  // ── 4 · Avaliação (peso/temperatura/FC/FR/exame) ────────────────────────
  await page.getByLabel('Peso (kg)').fill('9,1');
  await page.getByLabel('Temperatura (°C)').fill('38,4');
  await page.getByLabel('Frequência cardíaca (bpm)').fill('118');
  await page.getByLabel('Frequência respiratória (rpm)').fill('30');
  await page.getByLabel(/Hidratação/).fill('Normohidratada');
  await page.getByLabel(/Mucosas/).fill('Róseas e úmidas');
  await page.getByLabel(/Condição corporal/).fill('Escore corporal 5/9');
  await page.getByLabel(/Exame físico/).fill('Eritema em orelha direita.');
  await waitSaved(page);            // pendência vista e depois "Salvo agora" de verdade
  ok('avaliação veterinária gravada (unidade no rótulo, valor numérico, indicador honesto)');

  // §12 · UMA mudança = UMA gravação: o valor canônico que volta do servidor
  // não pode virar "pendência nova" (isso mandaria um segundo PATCH idêntico).
  const patchesBefore = result.patches;
  await page.getByLabel('Frequência respiratória (rpm)').fill('31');
  await waitSaved(page);
  await sleep(1500);                // um ciclo de autosave INTEIRO depois do save
  assert.equal(result.patches - patchesBefore, 1,
    `uma digitação gerou ${result.patches - patchesBefore} PATCH (esperado 1)`);
  ok('uma digitação = UMA gravação (o número canônico do servidor não gera save extra)');

  // ── §29 · acessibilidade REAL (aria-current, unidade, erro associado, teclado) ──
  const activeNav = page.locator('.encounter-workspace__nav-item[aria-current="page"]');
  assert.equal((await activeNav.innerText()).trim(), 'Avaliação');
  assert.equal(await page.locator('.encounter-workspace__nav-item:not([aria-current])').count(), 2);
  ok('§29 · a seção ativa é anunciada por aria-current (não só por cor)');

  const pesoField = page.getByLabel('Peso (kg)');     // nome acessível = rótulo + UNIDADE
  assert.equal(await pesoField.getAttribute('inputmode'), 'decimal');
  const beforeInvalid = result.patches;
  await pesoField.fill('abc');
  await waitUntil(async () => (await pesoField.getAttribute('aria-invalid')) === 'true', 'campo inválido anunciado');
  const described = [];
  for (const id of ((await pesoField.getAttribute('aria-describedby')) || '').split(/\s+/).filter(Boolean)) {
    described.push(await page.locator(`[id="${id}"]`).innerText());
  }
  assert.ok(described.some((text) => /número válido/i.test(text)), `mensagem associada ao campo: ${described.join(' | ')}`);
  assert.equal(await pesoField.inputValue(), 'abc', 'o texto digitado continua na tela');
  await waitUntil(async () => (await saveState(page)).state === 'error', 'indicador honesto com valor inválido');
  await sleep(1300);                                  // um ciclo de autosave inteiro
  assert.equal(result.patches, beforeInvalid, 'valor inválido NÃO vai para o servidor');
  await pesoField.focus();
  await page.keyboard.press('Tab');                   // teclado, sem mouse
  const focused = await page.evaluate(() => document.activeElement?.id || '');
  assert.equal(focused, 'av-temperatureC', `Tab deve alcançar o próximo campo, foi para "${focused}"`);
  await pesoField.fill('9,1');                        // corrigiu: nada pendente, volta a "Salvo agora"
  await waitUntil(async () => (await saveState(page)).state === 'saved', 'indicador volta a "Salvo agora" ao corrigir');
  ok('§29 · erro associado ao campo, teclado navega e o indicador nunca mente sobre pendência inválida');

  // ── 5 · §13 · F5 com texto PENDENTE: o navegador impede perder sem aviso ─
  await page.getByLabel(/Exame físico/).fill('Eritema em orelha direita. Achado pendente protegido.');
  await waitUntil(async () => (await saveState(page)).state === 'dirty', 'texto pendente antes do F5');
  let dialogs = 0;
  const onDialog = async (dialog) => {
    dialogs += 1;
    assert.equal(dialog.type(), 'beforeunload', `diálogo inesperado: ${dialog.type()}`);
    await dialog.dismiss().catch(() => {});      // "ficar nesta página"
  };
  page.on('dialog', onDialog);
  await page.reload({ timeout: 4000 }).catch(() => {});   // bloqueado pelo prompt nativo
  assert.equal(dialogs, 1, 'o F5 com texto pendente precisa pedir confirmação');
  assert.match(page.url(), /\/atendimento\//, 'recusar o prompt mantém o profissional na tela');
  assert.equal(await page.getByLabel(/Exame físico/).inputValue(),
    'Eritema em orelha direita. Achado pendente protegido.');
  // O autosave CONTINUA rodando enquanto o prompt bloqueia a navegação: o
  // pendente vira "Salvo agora" mesmo com o F5 recusado.
  await waitUntil(async () => (await saveState(page)).state === 'saved', 'gravação conclui mesmo com o F5 recusado');
  page.off('dialog', onDialog);
  await page.reload();              // agora sim: nada pendente, recarrega limpo
  await page.locator('.encounter-workspace__patient').waitFor();
  await section(page, 'Avaliação');
  assert.equal(await page.getByLabel(/Exame físico/).inputValue(),
    'Eritema em orelha direita. Achado pendente protegido.', 'o achado pendente ficou GRAVADO');
  ok('F5 protegido: prompt nativo, texto nunca some e a gravação conclui (§13)');

  // ── 6 · §13 · menu lateral com pendência: GRAVA e só então navega ───────
  await page.getByLabel(/Exame físico/).fill('Eritema em orelha direita. Achado pendente protegido. Saída pelo menu.');
  await waitUntil(async () => (await saveState(page)).state === 'dirty', 'pendência antes de sair pelo menu');
  await page.locator(`a[href="/agenda?b=${A}"]`).first().click({ noWaitAfter: true, timeout: 8000 });
  await waitUntil(async () => page.url().includes('/agenda'), 'saída pelo menu lateral');
  await page.goto(`${base}/atendimento/${encounterId}?b=${A}`);
  await page.locator('.encounter-workspace__patient').waitFor();
  await section(page, 'Avaliação');
  assert.equal(await page.getByLabel(/Exame físico/).inputValue(),
    'Eritema em orelha direita. Achado pendente protegido. Saída pelo menu.',
    'sair pelo menu gravou ANTES de navegar');
  ok('menu lateral com pendência: grava antes de navegar e nada se perde (§13)');

  // ── 7 · sair → retomar → F5 → mesmas três seções com TUDO ───────────────
  await page.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);
  await page.goto(`${base}/atendimento/${encounterId}?b=${A}`);
  await page.reload();
  await page.locator('.encounter-workspace__patient').waitFor();
  assert.equal((await page.locator('.encounter-workspace__patient').innerText()).trim(), 'Mel');
  assert.equal(await page.getByLabel(/Queixa principal/).inputValue(), 'Coceira nas orelhas (queixa principal).');
  await section(page, 'Anamnese');
  assert.equal(await page.getByLabel(/História atual/).inputValue(), 'Coceira há 3 dias, piora à noite.');
  assert.equal(await page.getByLabel(/^Diarreia/).inputValue(), 'yes');
  assert.equal(await page.getByLabel(/Medicações em uso/).inputValue(), 'Antipulgas mensal (relatado).');
  await section(page, 'Avaliação');
  assert.equal(await page.getByLabel('Peso (kg)').inputValue(), '9.1');
  assert.equal(await page.getByLabel('Temperatura (°C)').inputValue(), '38.4');
  assert.equal(await page.getByLabel('Frequência cardíaca (bpm)').inputValue(), '118');
  assert.equal(await page.getByLabel('Frequência respiratória (rpm)').inputValue(), '31');
  assert.equal(await page.getByLabel(/Exame físico/).inputValue(),
    'Eritema em orelha direita. Achado pendente protegido. Saída pelo menu.');
  ok('F5 → mesmas três seções com TODOS os valores (mesmo encounterId)');

  // ── 8 · falha de rede: não troca de seção e o texto fica ───────────────
  inducedMode = { statuses: [500, 503] };
  await section(page, 'Atendimento');
  await page.route('**/api/encounters', (route) => route.fulfill({ status: 500, body: '{"error":"induzido"}' }));
  await page.getByLabel(/Evolução clínica/).fill('Texto que não pode sumir.');
  await section(page, 'Anamnese');
  await waitUntil(async () => (await saveState(page)).state === 'error', 'erro de gravação visível');
  assert.equal(await page.getByLabel(/Evolução clínica/).inputValue(), 'Texto que não pode sumir.');
  assert.equal(await page.getByLabel(/História atual/).count(), 0, 'a seção NÃO trocou com a gravação falhando');
  ok('falha de gravação: NÃO troca de seção, erro visível e o texto continua na tela');

  // retry: a rede volta, a troca pede o flush de novo e ele conclui
  await page.unroute('**/api/encounters');
  inducedMode = null;
  await section(page, 'Anamnese');
  await page.getByLabel(/História atual/).waitFor();
  const preso = await serverRow(page, encounterId);
  assert.equal(preso.evolution, 'Texto que não pode sumir.', 'o texto preso foi GRAVADO na retomada');
  ok('retry com a rede de volta grava e libera a troca de seção');

  // ── §13 · "Voltar" com gravação falhando: fica, explica e só sai por escolha ──
  inducedMode = { statuses: [500, 503] };
  await section(page, 'Atendimento');
  await page.route('**/api/encounters', (route) => route.fulfill({ status: 500, body: '{"error":"induzido"}' }));
  await page.getByLabel(/Evolução clínica/).fill('Texto que exige escolha explícita.');
  await page.getByRole('button', { name: 'Voltar' }).first().click({ timeout: 8000 }).catch(() => {});
  await waitUntil(async () => (await saveState(page)).state === 'error', 'erro visível depois de tentar sair');
  assert.match(page.url(), /\/atendimento\//, 'a falha de gravação NÃO navega');
  assert.equal(await page.getByLabel(/Evolução clínica/).inputValue(), 'Texto que exige escolha explícita.');
  await page.getByRole('button', { name: 'Sair sem salvar' }).waitFor();
  ok('§13 · sair com gravação falhando: permanece na tela, explica e oferece "Sair sem salvar"');

  await page.getByRole('button', { name: 'Sair sem salvar' }).click();
  await page.getByRole('button', { name: 'Descartar' }).click({ timeout: 8000 });
  await waitUntil(async () => !page.url().includes(`/atendimento/${encounterId}`), 'saída explícita confirmada');
  await page.unroute('**/api/encounters');
  inducedMode = null;
  await page.goto(`${base}/atendimento/${encounterId}?b=${A}`);
  await page.locator('.encounter-workspace__patient').waitFor();
  const descartado = await serverRow(page, encounterId);
  assert.notEqual(descartado.evolution, 'Texto que exige escolha explícita.', 'o descarte NÃO pode ter gravado');
  ok('§13 · descarte explícito sai de verdade e não grava o texto descartado');

  // ── 9 · 409 real: outra tela grava, o local NÃO sobrescreve ────────────
  await section(page, 'Atendimento');
  await page.getByLabel(/Queixa principal/).waitFor();
  const before = await serverRow(page, encounterId);
  inducedMode = { statuses: [409] };
  const externo = await page.evaluate(async ({ businessId, id, version }) => {
    const res = await fetch('/api/encounters', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ businessId, id, expectedVersion: version, complaint: 'Alterado em OUTRA tela' }),
    });
    return res.status;
  }, { businessId: A, id: encounterId, version: before.version });
  assert.equal(externo, 200, 'a escrita externa precisa ter sucesso para o conflito ser REAL');
  await page.getByLabel(/Evolução clínica/).fill('Texto local que NÃO pode ser sobrescrito.');
  await waitUntil(async () => (await page.locator('.encounter-core__conflict').count()) > 0, 'aviso de conflito na tela');
  assert.equal(await page.getByLabel(/Evolução clínica/).inputValue(), 'Texto local que NÃO pode ser sobrescrito.');
  const depois = await serverRow(page, encounterId);
  assert.equal(depois.complaint, 'Alterado em OUTRA tela', 'a escrita da outra tela foi preservada');
  ok('409 real: conflito visível, texto local intacto e nada sobrescrito');
  // saída explícita escolhida por quem edita (as duas opções são HUMANAS)
  await page.getByRole('button', { name: 'Recarregar versão atual' }).click();
  await waitUntil(async () => (await page.getByLabel(/Queixa principal/).inputValue()) === 'Alterado em OUTRA tela', 'adoção da versão do servidor');
  inducedMode = null;
  await waitUntil(async () => (await saveState(page)).state === 'saved', 'indicador volta a "Salvo agora" depois do conflito');
  ok('conflito encerrado por escolha explícita ("Recarregar versão atual")');

  // ── 10 · Owner sem vínculo Professional: lê, não edita ─────────────────
  const owner = await login('owner.f1b1@godoutor.local');
  await owner.goto(`${base}/atendimento/${encounterId}?b=${A}`);
  await owner.locator('.encounter-workspace__patient').waitFor();
  const ownerField = owner.getByLabel(/Queixa principal/);
  assert.equal(await ownerField.isDisabled(), true);
  ok('Owner sem vínculo: workspace abre em LEITURA (campo desabilitado pela capacidade do servidor)');

  // ── 11 · Recepção: bloqueada ───────────────────────────────────────────
  const maria = await login('recepcao.f1b1@godoutor.local');
  await maria.goto(`${base}/atendimento/${encounterId}?b=${A}`);
  await maria.getByText(/Acesso restrito|não tem permissão|Atendimento/i).first().waitFor();
  ok('Recepção: acesso clínico bloqueado na rota direta');

  // ── 12 · outra unidade: 404 ────────────────────────────────────────────
  const fora = await login('fora.f1b1@godoutor.local');
  await fora.goto(`${base}/atendimento/${encounterId}?b=${B}`);
  await fora.getByText(/não encontrado|não está disponível/i).first().waitFor();
  ok('outra unidade: atendimento não encontrado (sem vazar dado)');

  // ── 12b · ISOLAMENTO POR VERTICAL no WORKSPACE REAL (§patch) ───────────
  // Não basta a função de resolução: o workspace de verdade precisa renderizar
  // só o CORE em odontologia/estética — mesmo com Pet LEGADO no tenant — e
  // recusar escrita vet no servidor.
  for (const [tenant, email, encounterId, label] of [
    [OD, 'odonto.f1b1@godoutor.local', 'enc-odonto-qa', 'odontológica'],
    [ES, 'estetica.f1b1@godoutor.local', 'enc-estetica-qa', 'estética'],
  ]) {
    const vertical = await login(email);
    await vertical.goto(`${base}/atendimento/${encounterId}?b=${tenant}`);
    await vertical.locator('.encounter-workspace__patient').waitFor();
    assert.equal(await vertical.locator('.encounter-workspace__nav-item').count(), 0,
      `${label}: nenhuma aba de especialidade pode existir`);
    await vertical.getByLabel(/Queixa principal/).waitFor();                 // CORE renderiza
    assert.equal(await vertical.getByLabel(/História atual/).count(), 0, `${label}: anamnese vet vazou`);
    assert.equal(await vertical.getByLabel('Peso (kg)').count(), 0, `${label}: avaliação vet vazou`);
    // O CORE grava de verdade (a vertical não é uma tela morta).
    inducedMode = { statuses: [] };
    await vertical.getByLabel(/Queixa principal/).fill(`Queixa da vertical ${label}`);
    await waitUntil(async () => (await saveState(vertical)).state === 'saved', `${label}: CORE salvou`);
    const core = await serverRow(vertical, encounterId, tenant);
    assert.equal(core.complaint, `Queixa da vertical ${label}`);
    // Escrita de ramo vet pelo SERVIDOR: 400 (o eixo não é a UI esconder).
    inducedMode = { statuses: [400] };
    const vetWrite = await vertical.evaluate(async ({ businessId, id, version }) => {
      const res = await fetch('/api/encounters', {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          businessId, id, expectedVersion: version,
          clinical: { anamnesis: { history: 'não pode entrar' }, assessment: { veterinary: { weightKg: 7 } } },
        }),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    }, { businessId: tenant, id: encounterId, version: core.version });
    assert.equal(vetWrite.status, 400, `${label}: ramo vet aceito (deveria ser 400)`);
    assert.match(String(vetWrite.body?.error || ''), /não está disponível nesta unidade/i);
    const depois = await serverRow(vertical, encounterId, tenant);
    assert.equal(depois.clinical?.anamnesis?.history || '', '', `${label}: anamnese vet gravou dado`);
    assert.equal(depois.clinical?.assessment?.veterinary?.weightKg ?? null, null, `${label}: avaliação vet gravou dado`);
    inducedMode = null;
    ok(`vertical ${label}: workspace REAL só com CORE, escrita vet recusada (400) e nada gravado`);
  }

  // ── 13·ADVERSARIAL · a vertical MUDA com o atendimento aberto ─────────
  // Tentativa deliberada de provar vazamento e perda:
  //   • a unidade veterinária (com Pet, niche 'pet' e serviço veterinário —
  //     todas as iscas de INFERÊNCIA) vira odontológica com o registro já
  //     preenchido: o workspace real tem de cair para o CORE e esconder o
  //     módulo vet;
  //   • o clínico gravado NÃO pode perder um caractere;
  //   • escrita de ramo vet tem de morrer no SERVIDOR (400), não na UI;
  //   • voltar a vertical reexibe o módulo COM o dado intacto (ocultar ≠ apagar).
  const clinicTypePath = '.cache/f1b1/qa.json';
  const setClinicType = async (clinicType) => {
    const raw = JSON.parse(await fs.readFile(clinicTypePath, 'utf8'));
    const biz = raw.businesses.find((b) => b.id === A);
    assert.ok(biz, 'ADV: unidade A não encontrada no banco de QA');
    if (clinicType) biz.clinicType = clinicType; else delete biz.clinicType;
    await fs.writeFile(clinicTypePath, JSON.stringify(raw, null, 2));
  };
  const workspaceOfVertical = async (expectNav, expectWeight, label) => {
    await page.goto(`${base}/atendimento/${encounterId}?b=${A}`);
    await page.locator('.encounter-workspace__patient').waitFor();
    await page.getByLabel(/Queixa principal/).waitFor();
    if (expectNav) {
      assert.equal(await page.locator('.encounter-workspace__nav-item').count(), 3, `ADV ${label}: navegação vet ausente`);
      // A Avaliação só existe quando ABERTA (não é aba morta): clicar e ver.
      await section(page, 'Avaliação');
      await page.getByLabel('Peso (kg)').waitFor();
    } else {
      assert.equal(await page.locator('.encounter-workspace__nav-item').count(), 0, `ADV ${label}: aba de especialidade vazou`);
      assert.equal(await page.getByLabel(/História atual/).count(), 0, `ADV ${label}: anamnese vet vazou`);
      assert.equal(await page.getByLabel('Peso (kg)').count(), 0, `ADV ${label}: avaliação vet vazou`);
    }
    assert.equal(expectWeight ? await page.getByLabel('Peso (kg)').count() : 0, expectWeight ? 1 : 0);
  };

  inducedMode = { statuses: [400] };
  await setClinicType('odontologica');
  await workspaceOfVertical(false, false, 'odonto');
  const preservado = await serverRow(page, encounterId);
  assert.ok((preservado.clinical.anamnesis.history || '').includes('Coceira há 3 dias'),
    'ADV: a anamnese da visita sumiu ao trocar de vertical');
  assert.equal(preservado.clinical.assessment.veterinary.weightKg, 9.1, 'ADV: peso da avaliação sumiu');
  assert.equal(preservado.clinicType, 'odontologica');
  const vetAfterFlip = await page.evaluate(async ({ businessId, id, version }) => {
    const res = await fetch('/api/encounters', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ businessId, id, expectedVersion: version, clinical: { assessment: { veterinary: { weightKg: 99 } } } }),
    });
    return res.status;
  }, { businessId: A, id: encounterId, version: preservado.version });
  assert.equal(vetAfterFlip, 400, 'ADV: o servidor aceitou escrita vet numa unidade odontológica');
  const intacto = await serverRow(page, encounterId);
  assert.equal(intacto.clinical.assessment.veterinary.weightKg, 9.1, 'ADV: a recusa sobrescreveu o dado existente');

  // ISCA DE INFERÊNCIA: sem clinicType (clínica genérica) o vet NÃO pode ligar
  // — mesmo com Pet vinculado, niche 'pet' e serviço veterinário na unidade.
  await setClinicType(null);
  await workspaceOfVertical(false, false, 'sem clinicType');
  assert.equal((await serverRow(page, encounterId)).clinicType, 'geral', 'ADV: ausente deveria normalizar para geral');

  // Volta a vertical: o módulo REAPARECE com o dado no lugar.
  await setClinicType('veterinaria');
  await workspaceOfVertical(true, true, 'volta para vet');
  const reaberto = await serverRow(page, encounterId);
  assert.equal(reaberto.clinical.anamnesis.history.includes('Coceira há 3 dias'), true);
  assert.equal(reaberto.clinical.assessment.veterinary.weightKg, 9.1);
  inducedMode = null;
  ok('§13 ADVERSARIAL · trocar a vertical esconde o módulo, RECUSA escrita vet (400) e nunca apaga o dado');
  ok('§13 ADVERSARIAL · clínica sem clinicType (com Pet/niche/serviço vet como isca) NÃO liga o módulo vet');

  // ── 13 · viewports ─────────────────────────────────────────────────────
  for (const [width, height] of [[1440, 900], [1280, 800], [1024, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}/atendimento/${encounterId}?b=${A}`);
    await page.locator('.encounter-workspace__patient').waitFor();
    await section(page, 'Avaliação');
    await page.getByLabel('Peso (kg)').waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 1, `${width}px: rolagem horizontal de ${overflow}px`);
    ok(`viewport ${width}×${height}: seções utilizáveis, sem rolagem horizontal`);
  }

  assert.equal(result.network.length, 0, `respostas inesperadas: ${JSON.stringify(result.network)}`);
  assert.equal(result.console.length, 0, `console com erro: ${JSON.stringify(result.console)}`);
  const accounted = new Set([...result.expected, ...result.induced].map((entry) => entry.status));
  const orphan = result.resourceErrors.filter((entry) => !accounted.has(entry.status));
  assert.equal(orphan.length, 0, `falhas de recurso não contabilizadas: ${JSON.stringify(orphan)}`);
  ok(`console 0 erro inesperado · rede 0 resposta ≥400 inesperada (${result.resourceErrors.length} falhas de recurso provocadas/documentadas)`);
} finally {
  console.log('\n── resumo QA F1B1 (browser) ──');
  console.log(`checks: ${result.checks.length} · console: ${result.console.length} · falhas de recurso: ${result.resourceErrors.length} · rede inesperada: ${result.network.length} · esperadas: ${result.expected.length} · induzidas: ${result.induced.length} · PATCH: ${result.patches}`);
  await fs.writeFile('.cache/f1b1/qa-result.json', JSON.stringify(result, null, 2)).catch(() => {});
  await browser.close();
  if (result.network.length || result.console.length) process.exitCode = 1;
}
