// ═══════════════════════════════════════════════════════════════
// ENTREGA 1 · QUICK CREATE VETERINÁRIO — PACIENTE (PET) NO NAVEGADOR
// ═══════════════════════════════════════════════════════════════
// Prova, em Chromium real e banco descartável, que:
//   • a criação rápida mostra "Pet (paciente)" quando o tutor tem pets;
//   • com 2+ pets, NÃO cria sem escolher o pet (mensagem explícita);
//   • escolhido o pet, o agendamento é criado com esse petId (conferido no servidor).
// A seleção automática com exatamente 1 pet é coberta por teste unitário
// (src/lib/__tests__/booking-quick-create-pet.test.ts) — o banco de QA tem a
// tutora com 2 pets, e o caso de 1 pet não é reproduzido aqui.
//
// Rodar (com `next start` apontando para .cache/f1b1/qa.json):
//   QA_EXECUTABLE_PATH=<chromium> LD_LIBRARY_PATH=... node tests/uiux-entrega1/quick-create-pet-browser.mjs
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent (QA local descartável).');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('QA local apenas.');

const A = 'f1b1-vet-qa';
const password = 'GodoutorF1B12026!';
// Amanhã no fuso do negócio: um slot futuro é sempre válido (horário passado é recusado pelo produto).
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
  .format(new Date(Date.now() + 24 * 3600 * 1000));
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.QA_EXECUTABLE_PATH) options.executablePath = process.env.QA_EXECUTABLE_PATH;
const browser = await chromium.launch(options);
const ok = (label) => console.log('PASS', label);

const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const popover = () => page.getByLabel('Criar agendamento neste horário');

try {
  // ── login como owner (sem escopo profissional: vê os 2 pets da tutora) ────────────────────────────────────────────────
  await page.goto(`${base}/login`);
  await page.locator('input[type=email]').fill('owner.f1b1@godoutor.local');
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });

  await page.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);
  const column = page.locator('[data-agenda-column]').first();
  await column.waitFor();
  const box = await column.boundingBox();
  assert.ok(box, 'coluna da agenda visível');

  // ── abre a criação rápida num slot vazio (varre a coluna até a popover abrir) ──
  let opened = false;
  for (let y = 260; y < box.height && !opened; y += 46) {
    await page.mouse.click(box.x + box.width / 2, box.y + y);
    opened = await popover().isVisible().catch(() => false);
    if (!opened) await sleep(150);
  }
  assert.ok(opened, 'criação rápida abriu por clique em slot vazio');
  ok('criação rápida abre a partir de um slot vazio da agenda');

  // ── escolhe a tutora (paciente) — o pet aparece em primeiro plano ───────
  await popover().getByLabel(/^Paciente/).first().fill('Isabelle');
  await popover().getByRole('button', { name: /Isabelle Tutora QA/ }).first().click();
  await popover().getByText(/^Pet \(paciente\)/).first().waitFor({ timeout: 10000 });
  ok('com tutora escolhida, "Pet (paciente)" aparece no primeiro plano (antes do serviço)');

  // ── 2 pets: sem escolha → recusa com mensagem explícita ─────────────────
  // serviço obrigatório também: escolhe o primeiro serviço disponível
  await popover().getByRole('combobox', { name: /Serviço/ }).click();
  await page.getByRole('option', { name: /·/ }).first().click(); // primeiro serviço real (a 1ª opção é o placeholder)
  await popover().getByRole('button', { name: 'Criar agendamento', exact: true }).click();
  await popover().getByText('Escolha o pet (paciente) deste agendamento.', { exact: true }).waitFor({ timeout: 10000 });
  ok('2 pets: criar sem escolher o pet é recusado com "Escolha o pet (paciente) deste agendamento."');

  // ── escolhe o Thor → cria; servidor grava o petId ───────────────────────
  await popover().getByRole('combobox', { name: /Pet \(paciente\)/ }).click();
  await page.getByRole('option', { name: /Thor/ }).click();
  await popover().getByRole('button', { name: 'Criar agendamento', exact: true }).click();
  await page.getByLabel('Criar agendamento neste horário').waitFor({ state: 'detached', timeout: 15000 });
  ok('com o pet escolhido, a criação rápida fecha (agendamento criado)');

  const bookings = await page.evaluate(async ({ businessId }) => {
    const res = await fetch(`/api/bookings?businessId=${encodeURIComponent(businessId)}&mode=patient&petId=pet-thor`);
    return res.json().catch(() => ({}));
  }, { businessId: A });
  const list = bookings.bookings || bookings.items || [];
  assert.ok(list.some((b) => b.petId === 'pet-thor'), `servidor gravou petId=pet-thor (recebido: ${JSON.stringify(bookings).slice(0, 200)})`);
  ok('servidor confirma o agendamento com petId=pet-thor (persistido)');

  assert.deepEqual(errors, [], `sem erro de página: ${errors.join(' | ')}`);
  ok('nenhum erro de página (pageerror)');
  console.log(`QUICK CREATE PET QA: 6 verificações PASS. data=${today}`);
} finally {
  await browser.close();
}
