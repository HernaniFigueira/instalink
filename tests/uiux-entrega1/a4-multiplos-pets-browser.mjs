// ═══════════════════════════════════════════════════════════════
// ENTREGA 1 · A4 — TUTORA COM 2+ PETS, NO NAVEGADOR REAL
// ═══════════════════════════════════════════════════════════════
// Prova, em Chromium real e banco descartável (.cache/f1b1/qa.json):
//   1. a lista de pets da tutora com 2 pets mostra SOMENTE os dela (sem o pet de outro tutor);
//   2. nada vem pré-selecionado com 2+ pets; criar sem escolher é recusado;
//   3. o POST real da UI leva o petId escolhido e o servidor grava esse pet;
//   4. o servidor recusa associação incorreta com motivo explícito (sem descartar em silêncio):
//        • petId de pet de OUTRO tutor da mesma unidade → 400 "Este pet não pertence ao tutor selecionado."
//        • petId inexistente → 400 "Pet não encontrado nesta unidade."
//        • sem petId com pets ativos (veterinária) → 400 "selecione o pet…"
//   5. nenhum agendamento do pet de outro tutor é criado pela tentativa recusada.
//
// Rodar: QA_EXECUTABLE_PATH=<chromium> LD_LIBRARY_PATH=... node tests/uiux-entrega1/a4-multiplos-pets-browser.mjs
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent (QA local descartável).');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('QA local apenas.');

const A = 'f1b1-vet-qa';
const password = 'GodoutorF1B12026!';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
  .format(new Date(Date.now() + 24 * 3600 * 1000));
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.QA_EXECUTABLE_PATH) options.executablePath = process.env.QA_EXECUTABLE_PATH;
const browser = await chromium.launch(options);
const results = [];
const ok = (label) => { results.push(`PASS ${label}`); console.log('PASS', label); };

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
let capturedPost = null;
page.on('request', (req) => {
  if (req.method() === 'POST' && /\/api\/bookings(\?|$)/.test(req.url())) capturedPost = { url: req.url(), body: req.postData(), headers: req.headers() };
});

const popover = () => page.getByLabel('Criar agendamento neste horário');

try {
  await page.goto(`${base}/login`);
  await page.locator('input[type=email]').fill('owner.f1b1@godoutor.local');
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

  await page.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);
  const column = page.locator('[data-agenda-column]').first();
  await column.waitFor();
  const box = await column.boundingBox();
  let opened = false;
  for (let y = 260; y < box.height && !opened; y += 46) {
    await page.mouse.click(box.x + box.width / 2, box.y + y);
    opened = await popover().isVisible().catch(() => false);
    if (!opened) await sleep(150);
  }
  assert.ok(opened, 'criação rápida abriu');

  await popover().getByLabel(/^Paciente/).first().fill('Isabelle');
  await popover().getByRole('button', { name: /Isabelle Tutora QA/ }).first().click();
  await popover().getByText(/^Pet \(paciente\)/).first().waitFor({ timeout: 10000 });

  // 1 · 2 pets, nada pré-selecionado, lista só com os pets da tutora
  const petCombo = popover().getByRole('combobox', { name: /Pet \(paciente\)/ });
  await petCombo.waitFor();
  const petValueBefore = await petCombo.inputValue();
  assert.equal(petValueBefore, '', `nada pré-selecionado com 2 pets (valor do campo: "${petValueBefore}")`);
  assert.equal(await petCombo.getAttribute('placeholder'), 'Escolha o pet…', 'placeholder explícito');
  ok('2 pets · nenhum pet pré-selecionado (campo vazio, placeholder "Escolha o pet…")');

  await petCombo.click();
  const petNames = (await page.getByRole('option').allTextContents()).map((t) => t.trim());
  assert.ok(petNames.some((t) => /Mel/.test(t)) && petNames.some((t) => /Thor/.test(t)), `lista tem Mel e Thor: ${JSON.stringify(petNames)}`);
  assert.ok(!petNames.some((t) => /Bidu/.test(t)), `lista NÃO tem o pet de outro tutor (Bidu): ${JSON.stringify(petNames)}`);
  ok(`2 pets · lista de pets da tutora = ${JSON.stringify(petNames.filter((t) => /Mel|Thor/.test(t)))}, sem o pet de outro tutor (Bidu)`);
  await page.keyboard.press('Escape');

  // 2 · criar sem escolher o pet é recusado
  await popover().getByRole('combobox', { name: /Serviço/ }).click();
  await page.getByRole('option', { name: /·/ }).first().click();
  await popover().getByRole('button', { name: 'Criar agendamento', exact: true }).click();
  await popover().getByText('Escolha o pet (paciente) deste agendamento.', { exact: true }).waitFor({ timeout: 10000 });
  ok('2 pets · criar sem pet é recusado com "Escolha o pet (paciente) deste agendamento."');

  // 3 · escolhe Thor → POST real da UI grava petId=pet-thor
  await petCombo.click();
  await page.getByRole('option', { name: /Thor/ }).click();
  await popover().getByRole('button', { name: 'Criar agendamento', exact: true }).click();
  await page.getByLabel('Criar agendamento neste horário').waitFor({ state: 'detached', timeout: 15000 });
  assert.ok(capturedPost?.body, 'POST /api/bookings capturado');
  const realBody = JSON.parse(capturedPost.body);
  assert.equal(realBody.petId, 'pet-thor', `POST real levou petId=pet-thor (recebido ${realBody.petId})`);
  ok('2 pets · escolha do Thor → POST real leva petId=pet-thor e o agendamento é criado');

  // 4 · associação incorreta é recusada com motivo explícito (replay do POST real, só o petId muda)
  const replay = (patch) => page.evaluate(async ({ url, headers, body, patch }) => {
    const h = { ...headers }; delete h['content-length'];
    const payload = { ...JSON.parse(body), ...patch };
    for (const k of Object.keys(payload)) if (payload[k] === null) delete payload[k];
    const res = await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(payload) });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }, { url: capturedPost.url, headers: capturedPost.headers, body: capturedPost.body, patch });

  const otherTutor = await replay({ petId: 'pet-bidu' });
  assert.equal(otherTutor.status, 400, `pet de outro tutor é recusado (HTTP ${otherTutor.status})`);
  assert.equal(otherTutor.json.error, 'Este pet não pertence ao tutor selecionado.', `motivo explícito: ${JSON.stringify(otherTutor.json)}`);
  ok('servidor · petId do Bidu (pet de OUTRO tutor) → 400 "Este pet não pertence ao tutor selecionado."');

  const unknown = await replay({ petId: 'pet-inexistente' });
  assert.equal(unknown.status, 400, `pet inexistente é recusado (HTTP ${unknown.status})`);
  assert.equal(unknown.json.error, 'Pet não encontrado nesta unidade.', `motivo explícito: ${JSON.stringify(unknown.json)}`);
  ok('servidor · petId inexistente → 400 "Pet não encontrado nesta unidade."');

  const noPet = await replay({ petId: null });
  assert.equal(noPet.status, 400, `sem pet com pets ativos é recusado (HTTP ${noPet.status})`);
  assert.match(noPet.json.error || '', /selecione o pet/i, `motivo: ${JSON.stringify(noPet.json)}`);
  ok('servidor · sem petId com pets ativos (veterinária) → 400 "selecione o pet…"');

  // 5 · nenhuma tentativa recusada criou agendamento do Bidu nem do pet inexistente
  const bidu = await page.evaluate(async ({ businessId }) => (await fetch(`/api/bookings?businessId=${businessId}&mode=patient&petId=pet-bidu`)).json(), { businessId: A });
  const biduList = bidu.bookings || bidu.items || [];
  assert.equal(biduList.length, 0, `nenhum agendamento do Bidu foi criado (encontrados ${biduList.length})`);
  const thor = await page.evaluate(async ({ businessId }) => (await fetch(`/api/bookings?businessId=${businessId}&mode=patient&petId=pet-thor`)).json(), { businessId: A });
  assert.ok((thor.bookings || thor.items || []).length >= 1, 'agendamento do Thor persistido');
  ok('persistência · nenhum agendamento do Bidu criado pelas tentativas recusadas; agendamento do Thor persistido');

  // 6 · people360: conversas da mais recente para a mais antiga (inclui automáticas); a prévia usa a primeira
  const p360 = await page.evaluate(async ({ businessId }) => (await fetch(`/api/people360?businessId=${businessId}&q=Isabelle`)).json(), { businessId: A });
  const isa = (p360.people || p360.items || p360.data || []).find((x) => /Isabelle/.test(x.name || ''));
  assert.ok(isa, `Isabelle no 360 (chaves: ${Object.keys(p360).join(',')})`);
  const ats = isa.conversations.map((c) => c.at);
  assert.ok(ats.length >= 2, `Isabelle tem 2+ conversas (tem ${ats.length})`);
  const sorted = [...ats].sort((a, b) => (b || '').localeCompare(a || ''));
  assert.deepEqual(ats, sorted, `conversas em ordem de atividade (desc): ${JSON.stringify(ats)}`);
  assert.ok(isa.conversations[0].preview.startsWith('Oi! Desde ontem a Mel'), `primeira = mais recente (preview: ${isa.conversations[0].preview.slice(0, 40)})`);
  ok(`people360 · conversas da Isabelle em ordem de atividade (desc), primeira = mais recente (${ats.length} conversas)`);

  assert.deepEqual(errors, [], `sem erro de página: ${errors.join(' | ')}`);
  ok('nenhum erro de página (pageerror)');
  console.log(`A4 MÚLTIPLOS PETS: ${results.length} verificações PASS. data=${today}`);
} catch (err) {
  console.log('FAIL', err.message.split('\n')[0]);
  process.exitCode = 1;
} finally {
  await browser.close();
}
