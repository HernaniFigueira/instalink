// ═══════════════════════════════════════════════════════════════
// ENTREGA 1 · P0 — AUTOSAVE NO NAVEGADOR (Chromium real, banco descartável)
// ═══════════════════════════════════════════════════════════════
// Prova, em browser real, que o texto digitado nunca some nem volta durante
// o autosave. A latência é injetada na RESPOSTA do PATCH (o servidor grava de
// verdade; a resposta chega atrasada) — é exatamente o caso de "resposta
// antiga chegando depois de digitação nova".
//
// Cenários:
//   1. digitação contínua enquanto um save está em voo (2 campos);
//   2. troca de seção enquanto o save está em voo, e volta;
//   3. erro de rede no save: o texto permanece e a próxima gravação funciona;
//   4. F5 (reload) → texto igual ao digitado, lido também do SERVIDOR;
//   5. sair pelo menu e reabrir → texto igual, persistido.
//
// Rodar (com `next start` apontando para .cache/f1b1/qa.json, após
// `node scripts/seed-f1b1-qa.mjs`):
//   QA_EXECUTABLE_PATH=<chromium> node tests/uiux-entrega1/autosave-browser.mjs
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent (QA local descartável).');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('QA local apenas.');

const A = 'f1b1-vet-qa';
const password = 'GodoutorF1B12026!';
const today = new Date().toISOString().slice(0, 10);
const LATENCY_MS = Number(process.env.QA_LATENCY_MS || 2500);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.QA_EXECUTABLE_PATH) options.executablePath = process.env.QA_EXECUTABLE_PATH;
const browser = await chromium.launch(options);
const log = [];
const ok = (label) => { log.push(label); console.log('PASS', label); };

async function waitUntil(fn, label, { timeout = 20000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw Error(`timeout: ${label}`);
    await sleep(interval);
  }
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

// Latência na RESPOSTA do PATCH: o servidor grava na hora; o cliente só recebe depois.
let patchCount = 0;
let delayMs = 0;
let failNext = false;
await page.route('**/api/encounters', async (route) => {
  const req = route.request();
  if (req.method() !== 'PATCH') return route.continue();
  patchCount += 1;
  if (failNext) { failNext = false; return route.abort('internetdisconnected'); }
  const response = await route.fetch();
  if (delayMs) await sleep(delayMs);
  await route.fulfill({ response });
});

async function serverRow(encounterId) {
  return page.evaluate(async ({ businessId, id }) => {
    const res = await fetch(`/api/encounters?businessId=${encodeURIComponent(businessId)}&id=${encodeURIComponent(id)}`);
    const data = await res.json().catch(() => ({}));
    return data.encounter || null;
  }, { businessId: A, id: encounterId });
}

const field = (re) => page.getByLabel(re);
const saveState = () => page.locator('[data-testid="encounter-workspace-save-state"]');

try {
  // ── login e abertura do atendimento (profissional da unidade) ──────────
  await page.goto(`${base}/login`);
  await page.locator('input[type=email]').fill('michelle.f1b1@godoutor.local');
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

  await page.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);
  await page.locator('[data-agenda-column]').first().waitFor();
  const card = page.locator('button.ag-event').filter({ hasText: 'Mel' }).filter({ hasText: '15:00' }).first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.getByRole('heading', { name: 'Detalhe do agendamento', exact: true }).waitFor();
  await page.getByRole('button', { name: /Iniciar atendimento|Retomar atendimento/ }).click();
  await page.waitForURL(/\/atendimento\/[0-9a-f-]{36}/);
  const encounterId = new URL(page.url()).pathname.split('/').pop();
  await field(/Queixa principal/).waitFor();
  await waitUntil(async () => (await saveState().textContent())?.length > 0, 'indicador de salvamento');
  ok('abre atendimento real (Mel, 15:00) pelo fluxo da agenda');

  // ── 1 · digitação contínua durante save em voo, em dois campos ─────────
  delayMs = LATENCY_MS;
  const queixa = 'Coceira nas orelhas há três dias, piora à noite e começou depois do banho.';
  const evolucao = 'Exame físico sem alterações gerais; orelha direita com eritema leve.';
  // estado limpo: o banco de QA pode já ter texto de uma execução anterior
  for (const re of [/Queixa principal/, /Evolução clínica/, /Orientações ao tutor/, /Nota interna/]) await field(re).fill('');
  await waitUntil(async () => (await saveState().textContent())?.includes('Salvo'), 'limpeza gravada', { timeout: 40000 });
  const before = patchCount;
  await field(/Queixa principal/).click();
  await field(/Queixa principal/).fill('Coceira nas orelhas.');
  await waitUntil(async () => patchCount > before, 'save A disparado');   // A em voo (com latência)
  // continua digitando enquanto A está em voo — caractere a caractere
  await field(/Queixa principal/).fill('');
  await field(/Queixa principal/).pressSequentially(queixa, { delay: 45 });
  await field(/Evolução clínica/).pressSequentially(evolucao, { delay: 35 });
  await waitUntil(async () => (await saveState().textContent())?.includes('Salvo'), 'autosave concluir', { timeout: 40000 });
  await sleep(300);
  assert.equal(await field(/Queixa principal/).inputValue(), queixa, 'queixa perdeu caracteres');
  assert.equal(await field(/Evolução clínica/).inputValue(), evolucao, 'evolução perdeu caracteres');
  ok('cenário 1: digitação contínua durante save em voo (2 campos) — nenhum caractere some');

  // ── 2 · troca de seção com save em voo, e volta ─────────────────────────
  const orient = 'Retornar se não melhorar em cinco dias.';
  await field(/Orientações ao tutor/).fill('');
  await field(/Orientações ao tutor/).pressSequentially(orient, { delay: 30 });
  const currentSection = async () => (await page.locator('.encounter-workspace__nav-item[aria-current]').allTextContents())[0];
  await page.locator('.encounter-workspace__nav-item', { hasText: 'Anamnese' }).click();
  await waitUntil(async () => (await currentSection()) === 'Anamnese', 'trocar para Anamnese', { timeout: 40000 });
  await page.locator('.encounter-workspace__nav-item', { hasText: 'Atendimento' }).first().click();
  await waitUntil(async () => (await currentSection()) === 'Atendimento', 'voltar para Atendimento', { timeout: 40000 });
  await field(/Queixa principal/).waitFor();
  await field(/Orientações ao tutor/).waitFor();
  await waitUntil(async () => (await saveState().textContent())?.includes('Salvo'), 'salvar após troca de seção', { timeout: 40000 });
  assert.equal(await field(/Orientações ao tutor/).inputValue(), orient, 'orientações sumiram ao trocar de seção');
  ok('cenário 2: troca de seção com save em voo — orientações voltam intactas');

  // ── 3 · erro de rede no save: texto permanece; próxima gravação funciona ─
  delayMs = 0;
  failNext = true;
  const nota = 'Tutor orientado por telefone; retorno combinado.';
  await field(/Nota interna/).fill('');
  await waitUntil(async () => (await saveState().textContent())?.includes('Salvo'), 'nota limpa gravada', { timeout: 40000 });
  await field(/Nota interna/).pressSequentially(nota, { delay: 20 });
  await waitUntil(async () => (await saveState().textContent())?.length > 0, 'estado após falha', { timeout: 20000 });
  await sleep(1500);
  assert.equal(await field(/Nota interna/).inputValue(), nota, 'texto sumiu após erro de rede');
  await field(/Nota interna/).pressSequentially(' Retorno em 5 dias.', { delay: 20 });
  await waitUntil(async () => (await saveState().textContent())?.includes('Salvo'), 'recuperar após falha de rede', { timeout: 40000 });
  ok('cenário 3: falha de rede no save — texto permanece e a gravação seguinte confirma');

  // ── 4 · F5 → texto igual ao digitado, e igual no SERVIDOR ───────────────
  const expectNota = `${nota} Retorno em 5 dias.`;
  const srv = await serverRow(encounterId);
  assert.equal(srv.complaint, queixa, 'servidor não tem a queixa final');
  assert.equal(srv.evolution, evolucao, 'servidor não tem a evolução final');
  assert.equal(srv.guidance, orient, 'servidor não tem as orientações');
  assert.equal(srv.internalNote, expectNota, 'servidor não tem a nota interna');
  await page.reload();
  await field(/Queixa principal/).waitFor();
  assert.equal(await field(/Queixa principal/).inputValue(), queixa);
  assert.equal(await field(/Evolução clínica/).inputValue(), evolucao);
  assert.equal(await field(/Orientações ao tutor/).inputValue(), orient);
  assert.equal(await field(/Nota interna/).inputValue(), expectNota);
  ok('cenário 4: F5 — texto da tela igual ao servidor (queixa, evolução, orientações, nota)');

  // ── 5 · sair pelo menu e reabrir ────────────────────────────────────────
  await page.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);
  await page.goto(`${base}/atendimento/${encounterId}?b=${A}`);
  await field(/Queixa principal/).waitFor();
  assert.equal(await field(/Queixa principal/).inputValue(), queixa);
  assert.equal(await field(/Nota interna/).inputValue(), expectNota);
  ok('cenário 5: sair e reabrir — texto persistido');

  assert.deepEqual(errors, [], `erros de página: ${errors.join(' | ')}`);
  ok('nenhum erro de página (pageerror)');
  console.log(`\nAUTOSAVE BROWSER QA: ${log.length} verificações PASS. PATCHes: ${patchCount}. encounter=${encounterId}`);
} catch (err) {
  console.error('FAIL', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
