// ═══════════════════════════════════════════════════════════════
// ENTREGA 1 · DRAWERS COM CONTEÚDO LONGO — ROLAGEM, FUNDO, ACESSO E FOCO
// ═══════════════════════════════════════════════════════════════
// Complementa drawers-a11y-browser.mjs (16 PASS, não alterado). Em Chromium real,
// abre cada overlay e injeta, no corpo dele, conteúdo que NÃO cabe na altura da tela
// (30 parágrafos + 12 botões, o último "Ação QA final"). Prova que:
//   • há um contêiner de rolagem interna real (scrollHeight > clientHeight);
//   • a roda do mouse rola o conteúdo DO overlay, e o fundo (scroll da página) não se move;
//   • o scroll do fundo continua travado enquanto aberto;
//   • o último item é alcançável por teclado (Tab) e fica visível dentro do painel;
//   • Escape fecha, devolve o foco ao gatilho e libera o scroll.
// Overlays: Drawer lateral e Dialog da vitrine do DS; DetailSideModal (gd-detail) da Agenda.
// Rodar: QA_EXECUTABLE_PATH=<chromium> LD_LIBRARY_PATH=... node tests/uiux-entrega1/drawers-conteudo-longo-browser.mjs
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
const ok = (label) => console.log('PASS', label);
let count = 0;

async function login(page) {
  await page.goto(`${base}/login`);
  await page.locator('input[type=email]').fill('owner.f1b1@godoutor.local');
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
}

// Injeta conteúdo longo no corpo do overlay aberto. Retorna o último botão.
const inject = (page, sel, bodySelectors) => page.evaluate(({ sel, bodySelectors }) => {
  const root = document.querySelector(sel);
  if (!root) return { error: 'overlay ausente' };
  const body = bodySelectors.map((s) => root.querySelector(s)).find(Boolean) || root;
  const wrap = document.createElement('div');
  wrap.setAttribute('data-qa-long', 'true');
  for (let i = 1; i <= 30; i++) {
    const p = document.createElement('p');
    p.textContent = `Linha de conteúdo QA ${i} — texto de preenchimento para exigir rolagem interna.`;
    p.style.margin = '8px 0';
    wrap.appendChild(p);
  }
  for (let i = 1; i <= 11; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `Ação QA ${i}`;
    b.style.display = 'block';
    b.style.margin = '6px 0';
    wrap.appendChild(b);
  }
  const last = document.createElement('button');
  last.type = 'button';
  last.setAttribute('data-qa-last', 'true');
  last.textContent = 'Ação QA final';
  last.style.display = 'block';
  wrap.appendChild(last);
  body.appendChild(wrap);
  return { ok: true, bodyTag: body.className || body.tagName };
}, { sel, bodySelectors });

// Contêiner de rolagem: o ancestral mais próximo do conteúdo injetado que rola de verdade.
const scrollerInfo = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-qa-long]');
  let n = el?.parentElement;
  while (n) {
    const st = getComputedStyle(n);
    if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 4) {
      const r = n.getBoundingClientRect();
      return { found: true, cls: n.className.toString().slice(0, 60), scrollable: n.scrollHeight - n.clientHeight, top: r.top, bottom: r.bottom };
    }
    n = n.parentElement;
  }
  return { found: false };
});

const pageLock = (page) => page.evaluate(() => (getComputedStyle(document.body).overflow === 'hidden' || getComputedStyle(document.documentElement).overflow === 'hidden'));
const pageY = (page) => page.evaluate(() => window.scrollY);

async function runCase({ page, name, trigger, triggerLabel, sel, openSel, bodySelectors, wheelAt }) {
  await trigger().click();
  await page.waitForSelector(openSel, { timeout: 8000 });
  await sleep(60);
  const inj = await inject(page, sel, bodySelectors);
  assert.ok(inj.ok, `${name}: ${inj.error}`);
  await sleep(40);

  // 1 · contêiner de rolagem interna real
  const sc = await scrollerInfo(page);
  assert.ok(sc.found, `${name}: conteúdo longo SEM contêiner de rolagem (conteúdo inacessível)`);
  ok(`${name} · conteúdo longo tem rolagem interna (contêiner ${sc.cls}, ${Math.round(sc.scrollable)}px rolável)`);
  count++;

  // 2 · roda do mouse rola o overlay; fundo não se move; scroll da página continua travado
  const yBefore = await pageY(page);
  const scrollBefore = await page.evaluate(() => document.querySelector('[data-qa-long]').parentElement.scrollTop);
  const scrollerSel = await page.evaluate(() => {
    const el = document.querySelector('[data-qa-long]'); let n = el.parentElement;
    while (n && !(/(auto|scroll)/.test(getComputedStyle(n).overflowY) && n.scrollHeight > n.clientHeight + 4)) n = n.parentElement;
    n.setAttribute('data-qa-scroller', 'true'); return true;
  });
  assert.ok(scrollerSel);
  const box = await page.locator('[data-qa-scroller="true"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 500);
  await sleep(300);
  const scrolled = await page.evaluate(() => document.querySelector('[data-qa-scroller="true"]').scrollTop);
  assert.ok(scrolled > scrollBefore + 50, `${name}: roda do mouse rola o overlay (scrollTop ${scrollBefore} → ${scrolled})`);
  assert.equal(await pageY(page), yBefore, `${name}: fundo NÃO rola com a roda`);
  assert.ok(await pageLock(page), `${name}: scroll do fundo continua travado`);
  ok(`${name} · roda do mouse rola o conteúdo (${Math.round(scrolled)}px) e o fundo permanece parado e travado`);
  count++;

  // 3 · último item alcançável por teclado e visível dentro do painel
  let reached = false;
  for (let i = 0; i < 300 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.hasAttribute('data-qa-last'));
  }
  assert.ok(reached, `${name}: Tab alcança o último item do conteúdo longo`);
  const vis = await page.evaluate(() => {
    const last = document.querySelector('[data-qa-last]');
    const scr = document.querySelector('[data-qa-scroller="true"]');
    const a = last.getBoundingClientRect(), b = scr.getBoundingClientRect();
    return a.top >= b.top - 1 && a.bottom <= b.bottom + 1;
  });
  assert.ok(vis, `${name}: último item visível dentro do painel após Tab`);
  ok(`${name} · último item alcançável por Tab e visível dentro do painel`);
  count++;

  // 4 · Escape fecha, foco volta ao gatilho, scroll liberado
  await page.keyboard.press('Escape');
  await page.waitForFunction((s) => !document.querySelector(s), sel, { timeout: 3000 });
  const back = await page.evaluate(() => document.activeElement?.textContent?.trim() || '');
  assert.ok(back.includes(triggerLabel), `${name}: foco volta ao gatilho (ativo: "${back.slice(0, 40)}")`);
  assert.equal(await pageLock(page), false, `${name}: scroll liberado após fechar`);
  ok(`${name} · Escape fecha, foco volta ao gatilho ("${triggerLabel}") e o scroll é liberado`);
  count++;
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);

  // Drawer lateral (DS)
  await page.goto(`${base}/dev/design-system?dev=1`);
  await page.getByRole('button', { name: 'Drawer / Sheet', exact: true }).waitFor({ timeout: 20000 });
  await runCase({
    page, name: 'Drawer lateral (DS, conteúdo longo)',
    trigger: () => page.getByRole('button', { name: 'Drawer / Sheet', exact: true }),
    triggerLabel: 'Drawer / Sheet', sel: 'dialog.il-drawer', openSel: 'dialog.il-drawer[open]',
    bodySelectors: ['.il-drawer__panel--base .ws-sheet__body', '.ws-sheet__body'],
  });

  // Dialog (DS)
  await page.getByRole('button', { name: 'Dialog', exact: true }).waitFor({ timeout: 10000 });
  await runCase({
    page, name: 'Dialog (DS, conteúdo longo)',
    trigger: () => page.getByRole('button', { name: 'Dialog', exact: true }),
    triggerLabel: 'Dialog', sel: '.gd-dialog', openSel: '.gd-dialog',
    bodySelectors: ['.gd-dialog__body', '.gd-dialog__content', '.gd-dialog'],
  });

  // DetailSideModal (gd-detail) na Agenda
  await page.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);
  const card = page.locator('button.ag-event').first();
  await card.waitFor({ timeout: 20000 });
  const cardText = ((await card.textContent()) || '').trim().slice(0, 15);
  await card.click();
  await page.waitForSelector('.gd-detail[open]', { timeout: 8000 });
  await sleep(60);
  const inj = await inject(page, '.gd-detail[open]', ['.gd-detail__body']);
  assert.ok(inj.ok, inj.error);
  await sleep(40);
  const sc = await scrollerInfo(page);
  assert.ok(sc.found, 'gd-detail (conteúdo longo) SEM contêiner de rolagem');
  ok(`gd-detail (Agenda, conteúdo longo) · rolagem interna (contêiner ${sc.cls}, ${Math.round(sc.scrollable)}px rolável)`);
  count++;
  let reached = false;
  for (let i = 0; i < 300 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.hasAttribute('data-qa-last'));
  }
  assert.ok(reached, 'gd-detail: Tab alcança o último item');
  ok('gd-detail (Agenda, conteúdo longo) · último item alcançável por Tab (foco preso ao detalhe)');
  count++;
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.gd-detail[open]'), null, { timeout: 3000 });
  const back = await page.evaluate(() => document.activeElement?.textContent?.trim() || '');
  assert.ok(back.includes(cardText.slice(0, 10)), `gd-detail: foco volta ao cartão (ativo: "${back.slice(0, 40)}", esperado "${cardText}")`);
  assert.equal(await pageLock(page), false, 'gd-detail: scroll liberado');
  ok('gd-detail (Agenda, conteúdo longo) · Escape fecha, foco volta ao cartão, scroll liberado');
  count++;

  assert.deepEqual(errors, [], `sem pageerror: ${errors.join(' | ')}`);
  console.log(`DRAWERS CONTEÚDO LONGO: ${count} verificações PASS. data=${today}`);
  await ctx.close();
} catch (err) {
  console.log('FAIL', err.message.split('\n')[0]);
  process.exitCode = 1;
} finally {
  await browser.close();
}
