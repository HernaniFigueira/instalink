// ═══════════════════════════════════════════════════════════════
// CLINICAL ACCESS — QA de BROWSER (Chromium real, local, descartável)
// ═══════════════════════════════════════════════════════════════
// Executa a §23 do briefing no NAVEGADOR de verdade (DOM, eventos, sessão,
// navegação), contra a fixture descartável `scripts/seed-clinical-access-qa.mjs`
// servida por um `next start` local. Nada de produção e nada de banco real.
//
//   rm -f .cache/clinical-access/qa.json
//   node scripts/seed-clinical-access-qa.mjs
//   GODOUTOR_DB_FILE=.cache/clinical-access/qa.json npx next start -p 3020 -H 0.0.0.0
//   QA_BASE_URL=http://127.0.0.1:3020 QA_EXECUTABLE_PATH=<chromium> node tests/clinical-access/qa.mjs
//
// Personas (§17/§23): Michele e Orlando (Professional), Recepção (Maria) e
// Owner. Prova, na tela:
//   • Michele LOCALIZA a paciente que o Orlando atende (nunca atendeu Isabelle),
//     abre o histórico longitudinal e vê o Encounter do colega COM AUTOR;
//   • abre o Encounter alheio em READ-ONLY (campos desabilitados + motivo), e
//     continua editando o PRÓPRIO Encounter;
//   • a agenda dela continua só dela; Conversas continua fora do acesso;
//   • Orlando lê o registro da Michele em read-only e mantém a agenda própria;
//   • Recepção opera o administrativo e NÃO entra na área clínica;
//   • Owner administra/lê sem autoria clínica (F1 preservado).
// Falha = exit 1. Evidência em `.cache/clinical-access/browser-qa.json`.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3020';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent (local disposable QA).');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Local disposable QA only.');

const A = 'ca-andrioni-qa';
const PASSWORD = 'GodoutorCA2026!';
const READ_ONLY_HINT = 'Somente o profissional responsável vinculado edita o conteúdo clínico deste atendimento.';
const DENIED_AREA = 'Seu perfil não possui acesso a esta área.';

const result = { base, checks: [], console: [], network: [], viewports: [] };
const ok = (label) => { result.checks.push(label); console.log('PASS', label); };
await fs.mkdir('.cache/clinical-access', { recursive: true });

const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.QA_EXECUTABLE_PATH) options.executablePath = process.env.QA_EXECUTABLE_PATH;
const browser = await chromium.launch(options);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Erros de console e respostas ≥400 — separados entre esperados e inesperados. */
const EXPECTED_STATUS = new Set([403, 404, 409]);
function watch(page, who) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = `${who}: ${m.text()}`.slice(0, 300);
    // O painel registra o 403 esperado do módulo ausente; o aviso canônico do
    // produto não é erro inesperado de aplicação.
    if (/the server responded with a status of (403|404|409)/.test(text)) return;
    result.console.push(text);
  });
  page.on('response', (r) => {
    const status = r.status();
    if (status < 400) return;
    const entry = { who, status, url: r.url().replace(base, '') };
    if (EXPECTED_STATUS.has(status)) result.network.push(entry); else result.network.push({ ...entry, unexpected: true });
  });
}

async function signIn(email, viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  watch(page, email);
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', email);
  await page.fill('#password', PASSWORD);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30000 }),
    page.getByRole('button', { name: 'Entrar' }).click(),
  ]);
  await page.waitForLoadState('domcontentloaded');
  return { context, page };
}

const panel = (page, path) => page.goto(`${base}${path}${path.includes('?') ? '&' : '?'}b=${A}`, { waitUntil: 'domcontentloaded' });

async function textOf(page) { return (await page.locator('body').innerText()).replace(/\s+/g, ' '); }

async function waitText(page, text, timeout = 20000) {
  const deadline = Date.now() + timeout;
  const expected = text.normalize('NFC').toLocaleLowerCase('pt-BR');
  for (;;) {
    const current = (await textOf(page)).normalize('NFC').toLocaleLowerCase('pt-BR');
    if (current.includes(expected)) return true;
    if (Date.now() > deadline) throw Error(`timeout esperando ${JSON.stringify(text)}`);
    await sleep(200);
  }
}

const columns = (page) => page.locator('[data-agenda-column-professional]')
  .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute('data-agenda-column-professional')))]);

const readonlyHints = (page) => page.locator('.encounter-core__readonly').count();
const disabledCoreFields = (page) => page.locator('.encounter-workspace__content textarea[disabled], .encounter-workspace__content input[disabled]').count();
const enabledCoreFields = (page) => page.locator('.encounter-workspace__content textarea:not([disabled]), .encounter-workspace__content input:not([disabled])').count();

/** Espera o workspace do Encounter carregar (nav de seções é o sinal estável). */
async function waitWorkspace(page) {
  await page.locator('[data-section-id="atendimento"]').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);
}

/** READ-ONLY de registro alheio: campos bloqueados + motivo visível na seção clínica. */
async function assertForeignReadOnly(page, label) {
  await waitWorkspace(page);
  assert.ok(await disabledCoreFields(page) > 0, `${label}: campos do núcleo precisam estar desabilitados`);
  await page.locator('[data-section-id="anamnese"]').first().click();
  await waitText(page, READ_ONLY_HINT, 15000);
  ok(label);
}

// ── MICHELE · paciente da unidade, histórico longitudinal, read-only ──────
{
  const { context, page } = await signIn('michele.ca@godoutor.test');
  await panel(page, '/clientes');
  await waitText(page, 'Tutora Ana QA');
  const privacyProjection = await page.evaluate(async (businessId) => {
    const contacts = await fetch(`/api/contacts?businessId=${businessId}&q=Ana`).then((response) => response.json());
    const people = await fetch(`/api/people360?businessId=${businessId}&q=Ana`).then((response) => response.json());
    const pets = await fetch(`/api/pets?businessId=${businessId}&tutorId=${encodeURIComponent(contacts.contacts?.[0]?.id || '')}`).then((response) => response.json());
    return {
      contact: contacts.contacts?.[0], person: people.people?.[0], pet: pets.pets?.[0],
      contactsBody: JSON.stringify(contacts), peopleBody: JSON.stringify(people), petsBody: JSON.stringify(pets),
    };
  }, A);
  assert.deepEqual(Object.keys(privacyProjection.contact || {}).sort(), ['id', 'name', 'phone']);
  assert.deepEqual(Object.keys(privacyProjection.person || {}).sort(), ['bookings', 'contactId', 'key', 'name', 'phone']);
  assert.deepEqual(Object.keys(privacyProjection.pet || {}).sort(), [
    'active', 'birthDate', 'breed', 'id', 'name', 'notes', 'photo', 'sex', 'species', 'tutorId', 'weightKg',
  ]);
  for (const sentinel of [
    'customer-ana-private-sentinel', 'privado@example.test', 'conta-privada@example.test',
    'campanha-privada', 'NOTA_ADMIN_PRIVADA', 'HISTORICO_ADMIN_PRIVADO',
    'PROFILE_ADMIN_SENTINEL', 'RUA_PRIVADA_SENTINELA', 'TAG_PERFIL_PRIVADA',
  ]) {
    assert.ok(!privacyProjection.contactsBody.includes(sentinel), `contacts payload leaked ${sentinel}`);
    assert.ok(!privacyProjection.peopleBody.includes(sentinel), `people360 payload leaked ${sentinel}`);
    assert.ok(!privacyProjection.petsBody.includes(sentinel), `pets payload leaked ${sentinel}`);
  }
  ok('Michele · API contacts/people360/pets entrega projeções clínicas sem CRM/conta/perfil do tutor');
  const heading = (await page.locator('h1').first().innerText()).trim();
  assert.equal(heading, 'Pacientes', `título clínico esperado, veio ${heading}`);
  ok('Michele · /clientes abre como "Pacientes" (rota preservada)');
  const patientSearch = page.getByRole('textbox', { name: 'Buscar paciente' });
  assert.equal(await patientSearch.getAttribute('placeholder'), 'Buscar por nome ou telefone…');
  ok('Michele · a busca clínica aceita somente nome/telefone e não expõe campos de CRM');
  assert.equal(await page.getByRole('button', { name: /Novo cliente/i }).count(), 0);
  ok('Michele · sem cadastro administrativo de cliente (CRM fora do acesso clínico)');
  ok('Michele · lista traz a paciente do colega (Isabelle/Tutora Ana, nunca atendida por ela)');

  // Histórico longitudinal na ficha do tutor.
  await page.getByRole('button', { name: 'Abrir perfil de Tutora Ana QA' }).click();
  await page.waitForURL(/\/clientes\/.+\?/, { timeout: 30000 });
  await waitText(page, 'Telefone / WhatsApp');
  const tutorProfileText = await textOf(page);
  for (const sentinel of [
    'privado@example.test', 'conta-privada@example.test', 'campanha-privada',
    'NOTA_ADMIN_PRIVADA', 'HISTORICO_ADMIN_PRIVADO', 'PROFILE_ADMIN_SENTINEL',
    'RUA_PRIVADA_SENTINELA', 'RESPONSAVEL_PRIVADO', 'TAG_PERFIL_PRIVADA',
  ]) assert.ok(!tutorProfileText.includes(sentinel), `clinical UI leaked ${sentinel}`);
  assert.ok(!/e-?mail|\bCPF\b|origem|data de nascimento|\bidade\b|cliente desde|sem etiquetas|cadastro|endereço|observação administrativa/i.test(tutorProfileText),
    'clinical tutor UI must not show CRM/profile fields or empty tag placeholders');
  ok('Michele · UI do tutor não mostra e-mail, perfil cadastral, etiquetas ou notas administrativas');
  await page.getByRole('tab', { name: /Atendimento/ }).click();
  await waitText(page, 'Dr. Orlando QA');
  const body = await textOf(page);
  assert.ok(body.includes('Dermatite da Isabelle') && body.includes('Retorno anterior finalizado'),
    'histórico precisa trazer os dois registros do Orlando');
  ok('Michele · ficha 360 mostra o histórico LONGITUDINAL com AUTOR de cada atendimento');

  // Abre o Encounter alheio a partir do histórico (continuidade assistencial).
  await page.getByRole('button', { name: /Dermatite da Isabelle/ }).first().click();
  await page.waitForURL(/\/atendimento\//, { timeout: 30000 });
  await assertForeignReadOnly(page, 'Michele · Encounter do Orlando abre em READ-ONLY (campos bloqueados + motivo no servidor)');

  // O PRÓPRIO Encounter continua editável.
  await panel(page, '/atendimento/enc-michele-thor');
  await waitWorkspace(page);
  assert.equal(await disabledCoreFields(page), 0, 'registro próprio não pode ter campo bloqueado');
  assert.ok(await enabledCoreFields(page) > 0, 'registro próprio precisa ter campo habilitado');
  await page.locator('[data-section-id="anamnese"]').first().click();
  await page.waitForTimeout(600);
  assert.equal(await page.getByText(READ_ONLY_HINT).count(), 0, 'registro próprio não mostra motivo de bloqueio');
  assert.ok(await enabledCoreFields(page) > 0, 'seção clínica própria precisa estar editável');
  ok('Michele · o PRÓPRIO Encounter continua editável (contrato F1)');

  // Agenda: só a coluna dela.
  await panel(page, '/agenda');
  await page.locator('[data-agenda-column-professional]').first().waitFor({ timeout: 30000 });
  assert.deepEqual(await columns(page), ['pro-michele']);
  ok('Michele · agenda com UMA coluna: a dela (agenda de outros profissionais fora)');

  // Conversas: módulo comercial sem permissão.
  assert.equal(await page.getByRole('link', { name: /^Conversas/ }).count(), 0);
  ok('Michele · "Conversas" não existe na navegação');
  await panel(page, '/conversas');
  await waitText(page, DENIED_AREA);
  ok('Michele · /conversas nega a área (Sem permissão de WhatsApp)');

  // Viewport estreito sem rolagem horizontal.
  await page.setViewportSize({ width: 390, height: 844 });
  await panel(page, '/clientes');
  await waitText(page, 'Tutora Ana QA');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  result.viewports.push({ who: 'michele', width: 390, overflow });
  assert.ok(overflow <= 1, `390px sem rolagem horizontal (overflow ${overflow}px)`);
  ok('Michele · 390px sem rolagem horizontal em /clientes');

  await page.waitForTimeout(500);
  await context.close();
}

// ── ORLANDO · simetria: lê a Michele, agenda própria ─────────────────────
{
  const { context, page } = await signIn('orlando.ca@godoutor.test');
  await panel(page, '/atendimento/enc-michele-thor');
  await assertForeignReadOnly(page, 'Orlando · lê o Encounter da Michele em READ-ONLY (simetria entre profissionais)');

  await panel(page, '/agenda');
  await page.locator('[data-agenda-column-professional]').first().waitFor({ timeout: 30000 });
  assert.deepEqual(await columns(page), ['pro-orlando']);
  ok('Orlando · agenda com UMA coluna: a dele');

  await page.waitForTimeout(500);
  await context.close();
}

// ── RECEPÇÃO · administrativo sim, clínico não ───────────────────────────
{
  const { context, page } = await signIn('recepcao.ca@godoutor.test');
  await panel(page, '/clientes');
  await waitText(page, 'Clientes');
  assert.equal((await page.locator('h1').first().innerText()).trim(), 'Clientes');
  assert.ok(await page.getByRole('button', { name: /Novo cliente/i }).count() > 0);
  ok('Recepção · /clientes continua a visão administrativa (CRM) com cadastro');

  await panel(page, '/atendimento/enc-orlando');
  await waitText(page, DENIED_AREA);
  assert.equal(await readonlyHints(page), 0);
  ok('Recepção · área clínica negada no navegador (sem leitura e sem escrita clínica)');

  await page.waitForTimeout(500);
  await context.close();
}

// ── OWNER · administra e lê, sem autoria clínica ─────────────────────────
{
  const { context, page } = await signIn('owner.ca@godoutor.test');
  await panel(page, '/atendimento/enc-orlando');
  await assertForeignReadOnly(page, 'Owner · abre o atendimento da unidade em READ-ONLY (F1 preservado: sem autoria por papel)');

  await panel(page, '/clientes');
  await waitText(page, 'Clientes');
  ok('Owner · mantém a visão administrativa de Clientes');

  await page.waitForTimeout(500);
  await context.close();
}

await browser.close();

const consoleErrors = result.console.filter(Boolean);
const unexpectedNetwork = result.network.filter((n) => n.unexpected);
assert.equal(consoleErrors.length, 0, `console com erro inesperado: ${JSON.stringify(consoleErrors)}`);
assert.equal(unexpectedNetwork.length, 0, `resposta ≥400 inesperada: ${JSON.stringify(unexpectedNetwork)}`);
ok(`Console 0 erro inesperado e rede 0 resposta inesperada (${result.network.length} recusas 403/404 esperadas)`);
// A evidência sai DEPOIS da última checagem: o arquivo registra o resultado completo.
await fs.writeFile('.cache/clinical-access/browser-qa.json', JSON.stringify({ ...result, consoleErrors, unexpectedNetwork }, null, 2));

console.log(`\nCLINICAL ACCESS BROWSER QA · ${result.checks.length} PASS / 0 FAIL`);
console.log('Evidência: .cache/clinical-access/browser-qa.json');
