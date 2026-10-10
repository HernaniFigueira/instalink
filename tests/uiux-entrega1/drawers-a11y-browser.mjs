// ═══════════════════════════════════════════════════════════════
// ENTREGA 1 · DRAWERS GENÉRICOS + gd-detail — ACESSIBILIDADE E MOVIMENTO
// ═══════════════════════════════════════════════════════════════
// Chromium real, banco descartável. Para cada overlay (Drawer lateral e Dialog
// da vitrine do DS em /dev/design-system?dev=1, e DetailSideModal (gd-detail)
// do detalhe de agendamento na Agenda), prova:
//   • abertura: foco entra no overlay; scroll do fundo travado;
//   • Tab/Shift+Tab circulam SOMENTE dentro do overlay;
//   • Escape fecha e devolve o foco ao gatilho; scroll do fundo é liberado;
//   • clique no fundo (backdrop) fecha e devolve o foco;
//   • movimento: com motion normal, a entrada/saída animam; com prefers-reduced-motion,
//     não há animação e o fechamento é imediato.
// Rodar: QA_EXECUTABLE_PATH=<chromium> LD_LIBRARY_PATH=... node tests/uiux-entrega1/drawers-a11y-browser.mjs
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
const ok = (label) => { results.push(label); console.log('PASS', label); };

async function login(page) {
  await page.goto(`${base}/login`);
  await page.locator('input[type=email]').fill('owner.f1b1@godoutor.local');
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
}

// Estado observável do overlay aberto: foco, scroll do fundo e animações do painel.
const probe = (page, sel) => page.evaluate((sel) => {
  const dlg = document.querySelector(sel);
  const inside = !!dlg && dlg.contains(document.activeElement);
  const panel = dlg?.querySelector(sel.includes('gd-detail') ? '.gd-detail__panel' : '.il-drawer__strip');
  const anims = panel ? panel.getAnimations().map((a) => a.animationName) : [];
  return {
    open: !!dlg && (dlg.tagName !== 'DIALOG' || dlg.open),
    inside,
    active: document.activeElement?.tagName + ':' + (document.activeElement?.textContent || '').trim().slice(0, 30),
    bodyLocked: getComputedStyle(document.body).overflow === 'hidden' || getComputedStyle(document.documentElement).overflow === 'hidden',
    anims,
  };
}, sel);

const closedProbe = (page, sel) => page.evaluate((sel) => ({
  present: !!document.querySelector(sel),
  bodyLocked: getComputedStyle(document.body).overflow === 'hidden' || getComputedStyle(document.documentElement).overflow === 'hidden',
}), sel);

// Mede o tempo entre a tecla e o overlay sair do DOM (fechamento imediato em reduced motion).
async function timeToClose(page, sel, press) {
  const t0 = Date.now();
  await press();
  await page.waitForFunction((s) => !document.querySelector(s), sel, { timeout: 3000 });
  return Date.now() - t0;
}

// Circula com Tab e confere que o foco nunca sai do overlay.
async function tabTrap(page, sel, times = 40) {
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
    const inside = await page.evaluate((s) => !!document.querySelector(s)?.contains(document.activeElement), sel);
    if (!inside) return false;
  }
  return true;
}

async function runOverlayCase({ name, page, trigger, sel, triggerLabel, backdropPoint, native = true }) {
  // `native`: <dialog open> (Drawer). Dialog do DS é <div role=dialog> sem atributo open.
  const openSel = native ? `${sel}[open]` : sel;
  // ── abertura ─────────────────────────────────────────────────────────
  await trigger().click();
  await page.waitForSelector(openSel, { timeout: 8000 });
  await sleep(60);
  const opened = await probe(page, openSel);
  assert.ok(opened.open, `${name}: abriu`);
  assert.ok(opened.inside, `${name}: foco entra no overlay (ativo: ${opened.active})`);
  assert.ok(opened.bodyLocked, `${name}: scroll do fundo travado enquanto aberto`);
  ok(`${name} · abre com foco dentro do overlay e scroll do fundo travado`);

  // ── tab / shift+tab presos ──────────────────────────────────────────
  assert.ok(await tabTrap(page, openSel), `${name}: Tab/Shift+Tab ficam presos ao overlay`);
  ok(`${name} · Tab/Shift+Tab circulam só dentro do overlay (40 teclas)`);

  // ── Escape: fecha, devolve foco, libera scroll ──────────────────────
  const escMs = await timeToClose(page, sel, () => page.keyboard.press('Escape'));
  const afterEsc = await closedProbe(page, sel);
  assert.ok(!afterEsc.present, `${name}: Escape fecha`);
  assert.ok(!afterEsc.bodyLocked, `${name}: scroll do fundo liberado após Escape`);
  const focusBack = await page.evaluate((t) => document.activeElement?.textContent?.trim() || '', triggerLabel);
  assert.match(focusBack, new RegExp(triggerLabel.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')), `${name}: foco volta ao gatilho (ativo: "${focusBack}")`);
  ok(`${name} · Escape fecha em ${escMs}ms, foco volta ao gatilho e scroll é liberado`);

  // ── clique no fundo fecha e devolve foco ────────────────────────────
  await trigger().click();
  await page.waitForSelector(openSel, { timeout: 8000 });
  await sleep(60);
  await page.mouse.click(backdropPoint.x, backdropPoint.y);
  await page.waitForFunction((s) => !document.querySelector(s), sel, { timeout: 3000 });
  const focusBack2 = await page.evaluate((t) => document.activeElement?.textContent?.trim() || '', triggerLabel);
  assert.match(focusBack2, new RegExp(triggerLabel.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&')), `${name}: foco volta após clique no fundo (ativo: "${focusBack2}")`);
  ok(`${name} · clique no fundo fecha e devolve o foco ao gatilho`);
}

try {
  // ═════ 1 · MOVIMENTO NORMAL ═════════════════════════════════════════
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);

  await page.goto(`${base}/dev/design-system?dev=1`);
  await page.getByRole('button', { name: 'Drawer / Sheet', exact: true }).waitFor({ timeout: 20000 });

  await runOverlayCase({
    name: 'Drawer lateral (DS)',
    page,
    trigger: () => page.getByRole('button', { name: 'Drawer / Sheet', exact: true }),
    triggerLabel: 'Drawer / Sheet',
    sel: 'dialog.il-drawer',
    backdropPoint: { x: 40, y: 450 },
  });

  // Entrada/saída animadas no movimento normal (prova de que o motion está ativo).
  await page.getByRole('button', { name: 'Drawer / Sheet', exact: true }).click();
  await page.waitForSelector('dialog.il-drawer[open]', { timeout: 8000 });
  const enter = await probe(page, 'dialog.il-drawer[open]');
  assert.ok(enter.anims.some((n) => /drawer-strip-in/.test(n)), `entrada animada (animações: ${JSON.stringify(enter.anims)})`);
  ok('Drawer lateral (DS) · entrada animada no movimento normal (gd-drawer-strip-in)');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.il-drawer'), null, { timeout: 3000 });

  // Dialog (variante de modal) — mesmo Drawer com variant="dialog" é o que a Agenda usa para Bloquear horário/Confirmar.
  // A vitrine expõe o componente Dialog; a prova cobre o contrato comum (foco, Tab, Escape, fundo).
  await runOverlayCase({
    name: 'Dialog (DS)',
    page,
    trigger: () => page.getByRole('button', { name: 'Dialog', exact: true }),
    triggerLabel: 'Dialog',
    sel: '.gd-dialog',
    native: false,
    backdropPoint: { x: 8, y: 8 },
  }).catch((e) => { throw new Error(`Dialog (DS): ${e.message}`); });

  // ── gd-detail (DetailSideModal) na Agenda: regressão de foco/Escape/scroll ──
  await page.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);
  // Qualquer cartão do dia serve (o detalhe é o mesmo componente); o foco deve voltar ao MESMO cartão.
  const bidu = page.locator('button.ag-event').first();
  await bidu.waitFor({ timeout: 20000 });
  const cardLabel = ((await bidu.textContent()) || '').trim().slice(0, 40);
  await bidu.focus();
  await bidu.click();
  await page.waitForSelector('.gd-detail[open]', { timeout: 8000 });
  await sleep(60);
  const gd = await probe(page, '.gd-detail[open]');
  assert.ok(gd.inside, `gd-detail: foco entra no detalhe (ativo: ${gd.active})`);
  assert.ok(gd.bodyLocked, 'gd-detail: scroll do fundo travado');
  assert.ok(gd.anims.some((n) => n === 'gd-detail-in'), `gd-detail: entrada animada (${JSON.stringify(gd.anims)})`);
  ok('gd-detail (Agenda) · abre com foco dentro, scroll travado e entrada gd-detail-in');
  assert.ok(await tabTrap(page, '.gd-detail[open]'), 'gd-detail: foco preso');
  ok('gd-detail (Agenda) · Tab/Shift+Tab presos ao detalhe');
  const gdEsc = await timeToClose(page, '.gd-detail', () => page.keyboard.press('Escape'));
  const gdFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() || '');
  assert.ok(gdFocus.includes(cardLabel.slice(0, 15)), `gd-detail: foco volta ao cartão do agendamento (ativo: "${gdFocus.slice(0, 40)}", esperado: "${cardLabel}")`);
  assert.ok(!(await closedProbe(page, '.gd-detail')).bodyLocked, 'gd-detail: scroll liberado');
  ok(`gd-detail (Agenda) · Escape fecha em ${gdEsc}ms, foco volta ao cartão, scroll liberado`);
  assert.deepEqual(errors, [], `sem pageerror: ${errors.join(' | ')}`);
  await ctx.close();

  // ═════ 2 · PREFERS-REDUCED-MOTION ═══════════════════════════════════
  const rctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const rp = await rctx.newPage();
  const rerrors = [];
  rp.on('pageerror', (e) => rerrors.push(e.message));
  await login(rp);

  await rp.goto(`${base}/dev/design-system?dev=1`);
  await rp.getByRole('button', { name: 'Drawer / Sheet', exact: true }).waitFor({ timeout: 20000 });
  await rp.getByRole('button', { name: 'Drawer / Sheet', exact: true }).click();
  await rp.waitForSelector('dialog.il-drawer[open]', { timeout: 8000 });
  const rEnter = await probe(rp, 'dialog.il-drawer[open]');
  assert.equal(rEnter.anims.length, 0, `reduced motion: sem animação de entrada (animações: ${JSON.stringify(rEnter.anims)})`);
  ok('reduced motion · Drawer lateral abre SEM animação (0 animações no painel)');
  const rClose = await timeToClose(rp, 'dialog.il-drawer', () => rp.keyboard.press('Escape'));
  assert.ok(rClose < 120, `reduced motion: fechamento imediato (${rClose}ms)`);
  ok(`reduced motion · Drawer lateral fecha imediatamente (${rClose}ms, sem janela de 170ms)`);

  await rp.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);
  const rbidu = rp.locator('button.ag-event').first();
  await rbidu.waitFor({ timeout: 20000 });
  const rCard = ((await rbidu.textContent()) || '').trim().slice(0, 15);
  await rbidu.click();
  await rp.waitForSelector('.gd-detail[open]', { timeout: 8000 });
  const rGd = await probe(rp, '.gd-detail[open]');
  assert.equal(rGd.anims.length, 0, `reduced motion: gd-detail sem animação (${JSON.stringify(rGd.anims)})`);
  ok('reduced motion · gd-detail abre SEM animação');
  const rGdClose = await timeToClose(rp, '.gd-detail', () => rp.keyboard.press('Escape'));
  assert.ok(rGdClose < 120, `reduced motion: gd-detail fecha imediatamente (${rGdClose}ms)`);
  const rGdFocus = await rp.evaluate(() => document.activeElement?.textContent?.trim() || '');
  assert.ok(rGdFocus.includes(rCard), 'reduced motion: foco volta ao cartão');
  ok(`reduced motion · gd-detail fecha imediatamente (${rGdClose}ms) e devolve o foco`);
  assert.deepEqual(rerrors, [], `sem pageerror (reduced): ${rerrors.join(' | ')}`);
  await rctx.close();

  console.log(`DRAWERS A11Y/MOTION: ${results.length} verificações PASS. data=${today}`);
} catch (err) {
  console.log('FAIL', err.message.split('\n')[0]);
  process.exitCode = 1;
} finally {
  await browser.close();
}
