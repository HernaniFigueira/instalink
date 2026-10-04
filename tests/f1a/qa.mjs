// Clinical Encounter F1A — browser QA (local, disposable, real Chromium).
// Run against `next start` + scripts/seed-f1a-qa.mjs ONLY.
// Usage: node tests/f1a/qa.mjs   (QA_BASE_URL default http://127.0.0.1:3111)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3111';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent (local disposable QA).');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Local disposable QA only');
const A = 'f1a-vet-qa';
const password = 'GodoutorF1A2026!';
const today = new Date().toISOString().slice(0, 10);

const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.QA_EXECUTABLE_PATH) options.executablePath = process.env.QA_EXECUTABLE_PATH;
const browser = await chromium.launch(options);

const result = { checks: [], console: [], network: [], expected: [] };
const ok = (label) => { result.checks.push(label); console.log('PASS', label); };
await fs.mkdir('.cache/f1a', { recursive: true });

/** Login REAL pela UI (e-mail + senha locais), com coletores de console/rede. */
async function login(email, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (e) => result.console.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') result.console.push(m.text()); });
  page.on('response', (r) => {
    if (r.status() >= 400) {
      const entry = { status: r.status(), url: r.url() };
      // 403/404 de PROVA DE BLOQUEIO são esperados (permissão e cross-tenant).
      if (r.status() === 403 || r.status() === 404) result.expected.push(entry);
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
  // O cartão do agendamento é o evento real da grade (sem atalho paralelo).
  const card = page.locator('button.ag-event').filter({ hasText: 'Mel' }).filter({ hasText: time }).first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.getByRole('heading', { name: 'Detalhe do agendamento', exact: true }).waitFor();
}

try {
  // ── 1 · FLUXO CANÔNICO: Agenda → chegada → iniciar → workspace ──
  const p = await login('owner.f1a@godoutor.local');
  await openBooking(p, '14:00');
  ok('Agenda aberta e detalhe do agendamento real');

  await p.getByRole('button', { name: 'Registrar chegada' }).click();
  await p.getByText('Chegada registrada.').waitFor();
  ok('Check-in pela UI (etapa operacional preservada)');

  await p.getByRole('button', { name: 'Iniciar atendimento' }).click();
  await p.waitForURL(/\/atendimento\/[0-9a-f-]{36}/);
  const encounterId = new URL(p.url()).pathname.split('/').pop();
  assert.match(encounterId, /^[0-9a-f-]{36}$/);
  ok(`Iniciar atendimento → rota canônica /atendimento/${encounterId}`);

  // ── 2 · HEADER CONTEXTUAL do workspace (protagonista = PET) ──
  const header = p.locator('.encounter-workspace__header');
  await header.waitFor();
  const h1 = (await p.locator('.encounter-workspace__patient').innerText()).trim();
  assert.equal(h1, 'Mel');
  const subtitle = await p.locator('.encounter-workspace__subtitle').innerText();
  assert.match(subtitle, /Cachorro/);
  assert.match(subtitle, /SRD/);
  assert.match(await p.locator('.encounter-workspace__tutor').innerText(), /Tutor: Isabelle Tutora QA/);
  const meta = await p.locator('.encounter-workspace__meta').innerText();
  assert.match(meta, /Consulta dermatológica/);
  assert.match(meta, /Michelle/);
  assert.match(meta, /\d{2}\/\d{2}\/\d{4}/);
  assert.equal((await p.locator('.encounter-workspace__header').getByText('EM ATENDIMENTO').count()), 1);
  assert.equal(await p.locator(`[data-encounter-id="${encounterId}"]`).count(), 1);
  ok('Header: PET em destaque, tutor secundário, serviço/profissional/data e EM ATENDIMENTO');

  // F1A não tem aba morta: só a seção real é renderizada.
  assert.equal(await p.locator('.encounter-workspace__nav').count(), 0);
  assert.equal(await p.locator('.encounter-workspace__section').count(), 1);
  ok('Nenhuma aba decorativa: só a seção real (Atendimento) é renderizada');

  // ── 2b · CONTRATO DE UI: área de trabalho, não muro de cards ──
  const ui = await p.evaluate(() => {
    const header = document.querySelector('.encounter-workspace__header');
    const nodes = [...document.querySelectorAll('.encounter-workspace, .encounter-workspace *')];
    return {
      position: getComputedStyle(header).position,
      gradients: nodes.filter((n) => getComputedStyle(n).backgroundImage.includes('gradient')).length,
      shadows: nodes.filter((n) => {
        const b = getComputedStyle(n).boxShadow;
        return b !== 'none' && !/inset/.test(b) && parseFloat(b.split('px')[2] || '0') > 8;
      }).length,
      back: !!document.querySelector('.encounter-workspace__back'),
    };
  });
  assert.equal(ui.position, 'sticky', 'cabeçalho contextual persistente');
  assert.equal(ui.gradients, 0, 'nenhum gradiente decorativo');
  assert.equal(ui.shadows, 0, 'nenhum glow decorativo');
  assert.ok(ui.back, 'ação de saída sempre visível');
  ok('UI: cabeçalho fixo, sem gradiente/glow, área de trabalho limpa');

  // ── 3 · SAIR → F5 → VOLTAR → RETOMAR (mesmo encounterId) ──
  await p.goto(`${base}/dashboard?b=${A}`);
  const workspaceUrl = `${base}/atendimento/${encounterId}?b=${A}`;
  await p.goto(workspaceUrl);
  await p.reload(); // F5 na rota canônica
  await p.locator(`[data-encounter-id="${encounterId}"]`).waitFor();
  ok('F5 na URL direta: MESMO atendimento (persistência real)');

  await openBooking(p, '14:00');
  await p.getByRole('button', { name: 'Retomar atendimento' }).click();
  await p.waitForURL(new RegExp(encounterId));
  assert.equal(new URL(p.url()).pathname.split('/').pop(), encounterId);
  ok('Retomar atendimento: MESMO encounterId (sem duplicação)');

  // Repetir o start pelo endpoint canônico: idempotente.
  const repeat = await p.evaluate(async ({ biz, bookingId }) => {
    const r = await fetch('/api/encounters/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: biz, bookingId }),
    });
    return { status: r.status, data: await r.json() };
  }, { biz: A, bookingId: 'bk-mel' });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.data.created, false);
  assert.equal(repeat.data.outcome, 'resumed');
  assert.equal(repeat.data.encounterId, encounterId);
  ok('start repetido: idempotente (created=false, mesmo id)');

  // Concorrência: duas chamadas simultâneas → um só atendimento.
  const concurrent = await p.evaluate(async ({ biz, bookingId }) => {
    const call = () => fetch('/api/encounters/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: biz, bookingId }),
    }).then((r) => r.json());
    const [a, b] = await Promise.all([call(), call()]);
    return { a: a.encounterId, b: b.encounterId, createdA: a.created, createdB: b.created };
  }, { biz: A, bookingId: 'bk-mel' });
  assert.equal(concurrent.a, concurrent.b);
  assert.equal(concurrent.a, encounterId);
  assert.equal(concurrent.createdA, false);
  assert.equal(concurrent.createdB, false);
  ok('Chamadas concorrentes: nenhuma duplicação');

  const total = await p.evaluate(async ({ biz, id }) => {
    const r = await fetch(`/api/encounters?businessId=${encodeURIComponent(biz)}&id=${encodeURIComponent(id)}`);
    const d = await r.json();
    return { status: r.status, startedAt: d.encounter?.startedAt, petId: d.encounter?.petId };
  }, { biz: A, id: encounterId });
  assert.equal(total.status, 200);
  assert.ok(String(total.startedAt).startsWith(today));
  assert.equal(total.petId, 'pet-mel');
  ok('GET por id: mesmo registro com startedAt e paciente preservados');

  await p.goto(workspaceUrl);
  await p.locator('.encounter-workspace__header').waitFor();
  await p.screenshot({ path: '.cache/f1a/workspace-1440.png', fullPage: false });
  ok('Screenshot desktop 1440');
  await p.context().close();

  // ── 4 · MOBILE 390 ──
  const m = await login('owner.f1a@godoutor.local', { width: 390, height: 844 });
  await m.goto(workspaceUrl);
  await m.locator('.encounter-workspace__header').waitFor();
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `overflow horizontal: ${overflow}px`);
  await m.screenshot({ path: '.cache/f1a/workspace-390.png', fullPage: false });
  ok('Mobile 390: workspace sem rolagem horizontal');
  await m.context().close();

  // ── 5 · PROFISSIONAL autorizado (vínculo real, não e-mail) ──
  const pro = await login('michelle.f1a@godoutor.local');
  await pro.goto(workspaceUrl);
  await pro.locator(`[data-encounter-id="${encounterId}"]`).waitFor();
  assert.match(await pro.locator('.encounter-workspace__meta').innerText(), /Michelle/);
  ok('Profissional vinculado: lê e retoma o próprio atendimento');
  await pro.context().close();

  // ── 6 · RECEPÇÃO não ganha acesso clínico ──
  const rec = await login('recepcao.f1a@godoutor.local');
  await rec.goto(workspaceUrl);
  await rec.getByRole('heading', { name: /permissão|área/i }).first().waitFor();
  const recBody = await rec.locator('body').innerText();
  assert.ok(/não inclui a área|Sem permissão/i.test(recBody), recBody.slice(0, 200));
  assert.ok(!recBody.includes('Isabelle'), 'Recepção não vê dado clínico');
  ok('Recepção: bloqueada no workspace (403 sem vazar dado)');
  await rec.context().close();

  // ── 7 · CROSS-TENANT (outra unidade) ──
  const out = await login('fora.f1a@godoutor.local');
  await out.goto(workspaceUrl);
  await out.getByRole('heading', { name: /Atendimento não encontrado|não foi possível abrir/i }).first().waitFor();
  const outBody = await out.locator('body').innerText();
  assert.ok(!outBody.includes('Isabelle') && !outBody.includes('Mel'), 'cross-tenant vazou dado');
  ok('Outra unidade: URL direta bloqueada, sem vazar o atendimento');
  await out.context().close();

  // ── 8 · REDE/CONSOLE ──
  // Os 403/404 de PROVA DE BLOQUEIO (permissão / cross-tenant) também aparecem como
  // "Failed to load resource" no console do Chromium: cada um é casado com a resposta
  // esperada correspondente (mesmo status) antes de sobrar erro de verdade.
  const unexpectedConsole = [];
  for (const message of result.console) {
    const status = message.match(/status of (\d{3})/)?.[1];
    const idx = status ? result.expected.findIndex((e) => String(e.status) === status) : -1;
    if (idx >= 0) result.expected.splice(idx, 1);
    else unexpectedConsole.push(message);
  }
  const fiveXx = [...result.network, ...result.expected].filter((r) => r.status >= 500);
  assert.equal(unexpectedConsole.length, 0, JSON.stringify(unexpectedConsole));
  assert.equal(result.network.length, 0, JSON.stringify(result.network));
  assert.equal(fiveXx.length, 0, JSON.stringify(fiveXx));
  ok(`Console 0 erro · network >=400 inesperado 0 · 5xx 0 (esperados: ${result.expected.length} × 403/404 de bloqueio)`);
} finally {
  await fs.writeFile('.cache/f1a/browser-report.json', JSON.stringify(result, null, 2));
  await browser.close();
}
