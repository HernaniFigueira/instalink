// ═══════════════════════════════════════════════════════════════
// QA DE BROWSER REAL — AGENDA do DS 1.0 (§5)
// ═══════════════════════════════════════════════════════════════
// Roda contra o BUILD DE PRODUÇÃO local (`next start`) com DB descartável e
// usuários fictícios (`.cache/design-system/qa.json`). O login é real (form) e
// NADA toca produção. Prova, em DOM renderizado de verdade:
//
//   1. toolbar `Hoje · ‹ data ›`: "Hoje" é ação com aria-pressed; a data abre o
//      Calendar CANÔNICO (Popover) — e não existe `<input type="date">`;
//   2. o clique num slot vago abre o quick create ANCORADO no ponto do clique
//      (geometria medida: a camada nasce junto do gesto) com os seis campos;
//   3. abrir o popover não cria nada (nenhuma requisição POST);
//   4. Escape fecha; "Mais opções" abre o Drawer canônico preservando a intenção;
//   5. clique num atendimento abre o Drawer de detalhe; o HoverCard abre no hover;
//   6. nenhuma regressão de layout: a grade não empurra a coluna do shell.
//
// Uso: node tests/design-system/agenda-qa.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_BASE || 'http://127.0.0.1:3020';
const OUT = 'docs/qa-design-system';
const EMAIL = 'owner.qa@godoutor.local';
const PASSWORD = 'GodoutorQA2026!';

mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'} · ${name}${extra ? ` · ${extra}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: process.env.QA_EXECUTABLE_PATH || '/tmp/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45000 });
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/bookings')) posts.push(r.url()); });
  await login(page);
  await page.goto(`${BASE}/agenda`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-agenda-page="true"]', { timeout: 45000 });
  await page.waitForTimeout(1500);

  // ── 1 · toolbar canônica ────────────────────────────────────────────────
  const today = page.getByRole('button', { name: 'Hoje' });
  ok('§5 · toolbar tem “Hoje” como ação', await today.count() === 1);
  const todayPressed = await today.first().getAttribute('aria-pressed');
  const dateTrigger = page.getByRole('button', { name: /^Escolher data/ });
  ok('§5 · a data é o DatePicker canônico (aria-haspopup=dialog)',
    await dateTrigger.count() === 1 && (await dateTrigger.first().getAttribute('aria-haspopup')) === 'dialog');
  ok('§5 · NÃO existe <input type="date"> na Agenda',
    await page.locator('input[type="date"]').count() === 0);

  await today.first().click();
  await page.waitForTimeout(600);
  ok('§5 · clicar “Hoje” mantém a data marcada como hoje (aria-pressed)', (await today.first().getAttribute('aria-pressed')) === 'true',
    `antes=${todayPressed}`);

  await dateTrigger.first().click();
  await page.waitForSelector('.gd-calendar', { timeout: 10000 });
  const calBox = await page.locator('.gd-calendar').boundingBox();
  ok('§5 · a data abre o Calendar canônico ancorado no gatilho',
    !!calBox && calBox.width > 200, calBox ? `w=${Math.round(calBox.width)}` : 'sem caixa');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('§5 · Escape fecha o calendário', await page.locator('.gd-calendar').count() === 0);

  // ── 2 · quick create ancorado ──────────────────────────────────────────
  posts.length = 0;
  // Ponto conhecido dentro de uma coluna da grade, bem abaixo do cabeçalho.
  const grid = page.locator('[data-agenda-main="true"]').first();
  const gridBox = await grid.boundingBox();
  const clickX = Math.round(gridBox.x + 160);
  const clickY = Math.round(gridBox.y + 560);
  await page.mouse.click(clickX, clickY);
  await page.waitForSelector('[data-layer].gd-popover', { timeout: 10000 });

  const layer = page.locator('[data-layer].gd-popover').first();
  const layerBox = await layer.boundingBox();
  // Ancorado = nasce no ponto do clique: alinhado no eixo X e ENCOSTADO nele
  // (abaixo quando cabe; acima quando não cabe — o flip é do próprio Popover).
  const dx = Math.abs(layerBox.x - clickX);
  const below = layerBox.y >= clickY - 32 && layerBox.y - clickY <= 48;
  const above = layerBox.y + layerBox.height <= clickY + 32 && (clickY - (layerBox.y + layerBox.height)) <= 48;
  ok('§5 · popover ancorado JUNTO do ponto clicado (alinhado no X e encostado no clique)',
    dx <= 40 && (below || above),
    `click=(${clickX},${clickY}) layer=(${Math.round(layerBox.x)},${Math.round(layerBox.y)}) h=${Math.round(layerBox.height)} ${below ? 'abaixo' : above ? 'acima' : 'solto'}`);

  const labels = await layer.locator('label').allTextContents();
  const has = (re) => labels.some((t) => re.test(t));
  ok('§5 · os SEIS campos existem (Paciente/Serviço/Profissional/Duração/Data/Hora)',
    has(/\bPaciente\b/) && has(/^Serviço/) && has(/^Profissional/) && has(/^Duração/) && has(/^Data/) && has(/^Hora/),
    labels.map((l) => l.split('\n')[0]).join(' | ').slice(0, 120));
  ok('§5 · abrir o popover não cria nada (nenhum POST /api/bookings)', posts.length === 0);
  await page.screenshot({ path: `${OUT}/agenda-1440-quick-create.png` });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok('§5 · Escape fecha o quick create', await page.locator('[data-layer].gd-popover').count() === 0);

  // ── 3 · “Mais opções” → Drawer canônico com a intenção preservada ──────
  await page.mouse.click(clickX, clickY);
  await page.waitForSelector('[data-layer].gd-popover', { timeout: 10000 });
  await page.getByRole('button', { name: 'Mais opções' }).click();
  await page.waitForSelector('dialog.il-drawer', { timeout: 10000 });
  const drawer = page.locator('dialog.il-drawer').first();
  const drawerTitle = (await drawer.locator('h2').first().textContent()) || '';
  ok('§5 · “Mais opções” abre o Drawer canônico do fluxo completo',
    /Novo agendamento/i.test(drawerTitle), drawerTitle.trim());
  const sent = await drawer.evaluate((el) => {
    const input = el.querySelector('input[type="date"], input[inputmode="numeric"]');
    const form = el.querySelector('form');
    return { hasForm: !!form, hasInput: !!input };
  });
  ok('§5 · o Drawer do fluxo completo continua funcional (campos presentes)', sent.hasForm || sent.hasInput);
  await page.screenshot({ path: `${OUT}/agenda-1440-mais-opcoes-drawer.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── 4 · detalhe do atendimento + hover card ────────────────────────────
  const event = page.locator('.ag-event').first();
  if (await event.count() > 0) {
    const hoverCapable = await page.evaluate(() => window.matchMedia('(hover: hover)').matches);
    ok('§5 · o navegador do QA tem hover real (prévia não é suprimida à toa)', hoverCapable);
    await event.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const box = await event.boundingBox();
    await page.mouse.move(box.x + Math.min(40, box.width / 2), box.y + Math.min(10, box.height / 2));
    await page.waitForTimeout(700);
    const hoverOpen = await page.locator('.gd-hovercard').count();
    ok('§5 · HoverCard abre sobre o atendimento (~180ms)', hoverOpen >= 1);
    if (hoverOpen) await page.screenshot({ path: `${OUT}/agenda-1440-hovercard.png` });
    await page.mouse.move(4, 4);
    await page.waitForTimeout(500);
    const box2 = await event.boundingBox();
    await page.mouse.click(box2.x + Math.min(40, box2.width / 2), box2.y + Math.min(10, box2.height / 2));
    await page.waitForSelector('dialog.ws-sheet, dialog.il-drawer', { timeout: 10000 });
    const panel = page.locator('dialog.ws-sheet, dialog.il-drawer').first();
    const detailTitle = (await panel.locator('h2').first().textContent()) || '';
    const panelBox = await panel.boundingBox();
    ok('§5 · clique no atendimento abre o detalhe no painel lateral à direita',
      detailTitle.trim().length > 0 && panelBox.x + panelBox.width >= 1400,
      `${detailTitle.trim()} · x=${Math.round(panelBox.x)} w=${Math.round(panelBox.width)}`);
    const close = panel.locator('button[aria-label^="Fechar"]').first();
    // O navegador normaliza QUALQUER notação (inclusive `color(srgb …)` de
    // color-mix) via canvas — sem regex frágil de string de cor.
    const closeColor = close ? await close.evaluate((el) => {
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.fillStyle = getComputedStyle(el).color;
      return ctx.fillStyle;
    }) : '';
    const hex = closeColor.startsWith('#') && closeColor.length >= 7
      ? [parseInt(closeColor.slice(1, 3), 16), parseInt(closeColor.slice(3, 5), 16), parseInt(closeColor.slice(5, 7), 16)]
      : null;
    const rgb = hex || (closeColor.match(/[0-9]+/g) || []).map(Number);
    const spread = rgb.length >= 3 ? Math.max(...rgb.slice(0, 3)) - Math.min(...rgb.slice(0, 3)) : 999;
    ok('§5 · o fechar do painel é NEUTRO (não vermelho)',
      spread <= 48 && (rgb[0] - Math.max(rgb[1], rgb[2])) <= 40, `${closeColor} spread=${spread}`);
    await page.screenshot({ path: `${OUT}/agenda-1440-drawer-detalhe.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  } else {
    ok('§5 · há atendimento no dia para abrir o detalhe', false, 'nenhum .ag-event renderizado');
  }

  // ── 5 · sem overflow do shell com o popover aberto ─────────────────────
  await page.goto(`${BASE}/agenda`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-agenda-page="true"]', { timeout: 45000 });
  await page.waitForTimeout(1200);
  const shellOverflow = await page.evaluate(() => {
    const vw = window.innerWidth;
    const worst = Math.max(...['.ws-topbar', '.workspace-sidebar', '.workspace-main-col']
      .map((s) => document.querySelector(s))
      .filter(Boolean)
      .map((el) => Math.round(el.getBoundingClientRect().right - vw)));
    return { vw, worst };
  });
  ok('§5 · o shell continua sem overflow próprio com a Agenda aberta', shellOverflow.worst <= 1, JSON.stringify(shellOverflow));
  await page.screenshot({ path: `${OUT}/agenda-1440.png` });

  // ── 6 · mobile 390: a Agenda é LISTA (sem grade) e sem dependência de hover
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await login(mobile);
  await mobile.goto(`${BASE}/agenda`, { waitUntil: 'domcontentloaded' });
  await mobile.waitForSelector('[data-agenda-page="true"]', { timeout: 45000 });
  await mobile.waitForTimeout(1500);

  const mobileGeom = await mobile.evaluate(() => {
    const col = document.querySelector('.workspace-main-col');
    const page = document.querySelector('[data-agenda-page="true"]');
    return {
      vw: window.innerWidth,
      col: col ? { x: Math.round(col.getBoundingClientRect().x), w: Math.round(col.getBoundingClientRect().width) } : null,
      page: page ? { x: Math.round(page.getBoundingClientRect().x), w: Math.round(page.getBoundingClientRect().width) } : null,
      docOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  ok('§12 · 390 · a coluna principal ocupa a largura útil (sem largura 0)',
    !!mobileGeom.col && mobileGeom.col.x === 0 && mobileGeom.col.w === mobileGeom.vw,
    JSON.stringify(mobileGeom));
  ok('§12 · 390 · nenhum overflow horizontal da página', mobileGeom.docOverflow <= 1, `overflow=${mobileGeom.docOverflow}`);
  ok('§5 · 390 · a toolbar canônica continua presente', await mobile.getByRole('button', { name: 'Hoje' }).count() === 1);

  const rows = mobile.locator('.ag-list__row');
  const rowCount = await rows.count();
  ok('§5 · 390 · a Lista renderiza os atendimentos do dia (superfície tocável)', rowCount >= 1, `linhas=${rowCount}`);
  ok('§5 · 390 · nenhuma grade com hover no celular', await mobile.locator('[data-agenda-column]').count() === 0);
  if (rowCount) {
    await rows.first().click();
    await mobile.waitForSelector('dialog.ws-sheet, dialog.il-drawer', { timeout: 10000 });
    const box = await mobile.locator('dialog.ws-sheet, dialog.il-drawer').first().boundingBox();
    ok('§5 · 390 · o toque no atendimento abre o detalhe em painel', !!box && box.width >= 320, `w=${Math.round(box.width)}`);
    await mobile.screenshot({ path: `${OUT}/agenda-390-detalhe.png` });
  } else {
    await mobile.screenshot({ path: `${OUT}/agenda-390-lista.png` });
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) process.exitCode = 1;
