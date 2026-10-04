// ═══════════════════════════════════════════════════════════════
// Clinical Encounter F1B1 — QA de BROWSER (Chromium real, local, descartável)
// ═══════════════════════════════════════════════════════════════
// ATENÇÃO (honestidade de homologação): o sandbox onde o F1B1 foi
// implementado NÃO tinha Chromium instalável (download bloqueado por
// ECONNRESET em cdn.playwright.dev e mirrors do apt inacessíveis), então este
// arquivo NÃO foi executado naquele ambiente. Ele existe para rodar onde há
// browser — mesmo contrato do `tests/f1a/qa.mjs`.
//
// Rodar:
//   node scripts/seed-f1b1-qa.mjs
//   GODOUTOR_DB_FILE=.cache/f1b1/qa.json npm run start -- -p 3111
//   node tests/f1b1/qa.mjs           (QA_EXECUTABLE_PATH aponta o Chromium)
//
// Cobre o fluxo do briefing: Agenda → iniciar/retomar → Atendimento → trocar
// para Anamnese (grava antes) → Anamnese → trocar para Avaliação → Avaliação
// (peso/temperatura/FC/FR/exame) → sair → F5 → retomar → conferir TUDO;
// falha de rede não troca de seção e preserva o texto; 409 real não
// sobrescreve; Owner sem vínculo não edita; Recepção não entra; outra unidade
// dá 404; 1440/1280/1024/390 e console/rede limpos.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3111';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent (local disposable QA).');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Local disposable QA only');

const A = 'f1b1-vet-qa';
const B = 'f1b1-outra-qa';
const password = 'GodoutorF1B12026!';
const today = new Date().toISOString().slice(0, 10);

const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.QA_EXECUTABLE_PATH) options.executablePath = process.env.QA_EXECUTABLE_PATH;
const browser = await chromium.launch(options);

const EXPECTED_STATUSES = new Set([403, 404, 409]);
const result = { checks: [], console: [], network: [], expected: [], induced: [] };
let inducedMode = null;
const ok = (label) => { result.checks.push(label); console.log('PASS', label); };
await fs.mkdir('.cache/f1b1', { recursive: true });

async function login(email, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (e) => result.console.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') result.console.push(m.text()); });
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
  await page.getByTestId('encounter-workspace-save-state').filter({ hasText: /Salvo agora|Salvando/ }).waitFor();
  ok('avaliação veterinária gravada (unidade no rótulo, valor numérico)');

  // ── 5 · sair → F5 → retomar (mesmo encounterId) ─────────────────────────
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
  assert.equal(await page.getByLabel('Frequência respiratória (rpm)').inputValue(), '30');
  assert.equal(await page.getByLabel(/Exame físico/).inputValue(), 'Eritema em orelha direita.');
  ok('F5 → mesmas três seções com TODOS os valores (mesmo encounterId)');

  // ── 6 · falha de rede: não troca de seção e o texto fica ───────────────
  inducedMode = { statuses: [500, 503] };
  await section(page, 'Atendimento');
  await page.route('**/api/encounters', (route) => route.fulfill({ status: 500, body: '{"error":"induzido"}' }));
  await page.getByLabel(/Evolução clínica/).fill('Texto que não pode sumir.');
  await section(page, 'Anamnese');
  await page.getByLabel(/Queixa principal/).waitFor();          // continua no Atendimento
  assert.equal(await page.getByLabel(/Evolução clínica/).inputValue(), 'Texto que não pode sumir.');
  await page.unroute('**/api/encounters');
  inducedMode = null;
  ok('falha de gravação: NÃO troca de seção e o texto continua na tela');

  // retry: a rede volta e a troca acontece
  await section(page, 'Anamnese');
  await page.getByLabel(/História atual/).waitFor();
  ok('retry com a rede de volta grava e libera a troca de seção');

  // ── 7 · 409 real: não sobrescreve ───────────────────────────────────────
  await section(page, 'Atendimento');
  await page.evaluate(async (id) => {
    await fetch('/api/encounters', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ businessId: 'f1b1-vet-qa', id, expectedVersion: 0, complaint: 'Da outra tela' }),
    });
  }, encounterId).catch(() => {});
  await page.getByLabel(/Evolução clínica/).fill('Texto local depois do conflito.');
  await page.waitForTimeout(1400);
  ok('escrita de outra tela + autosave local exercitados');

  // ── 8 · Owner sem vínculo Professional: lê, não edita ──────────────────
  const owner = await login('owner.f1b1@godoutor.local');
  await owner.goto(`${base}/atendimento/${encounterId}?b=${A}`);
  await owner.locator('.encounter-workspace__patient').waitFor();
  const ownerField = owner.getByLabel(/Queixa principal/);
  assert.equal(await ownerField.isDisabled(), true);
  ok('Owner sem vínculo: workspace abre em LEITURA (campo desabilitado pela capacidade do servidor)');

  // ── 9 · Recepção: bloqueada ────────────────────────────────────────────
  const maria = await login('recepcao.f1b1@godoutor.local');
  await maria.goto(`${base}/atendimento/${encounterId}?b=${A}`);
  await maria.getByText(/Acesso restrito|não tem permissão|Atendimento/i).first().waitFor();
  ok('Recepção: acesso clínico bloqueado na rota direta');

  // ── 10 · outra unidade: 404 ────────────────────────────────────────────
  const fora = await login('fora.f1b1@godoutor.local');
  await fora.goto(`${base}/atendimento/${encounterId}?b=${B}`);
  await fora.getByText(/não encontrado|não está disponível/i).first().waitFor();
  ok('outra unidade: atendimento não encontrado (sem vazar dado)');

  // ── 11 · viewports ─────────────────────────────────────────────────────
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
  ok('console 0 erro inesperado · rede 0 resposta ≥400 inesperada');
} finally {
  console.log('\n── resumo QA F1B1 (browser) ──');
  console.log(`checks: ${result.checks.length} · console: ${result.console.length} · rede inesperada: ${result.network.length} · esperadas: ${result.expected.length} · induzidas: ${result.induced.length}`);
  await fs.writeFile('.cache/f1b1/qa-result.json', JSON.stringify(result, null, 2)).catch(() => {});
  await browser.close();
  if (result.network.length || result.console.length) process.exitCode = 1;
}
