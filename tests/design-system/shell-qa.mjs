// ═══════════════════════════════════════════════════════════════
// QA DE BROWSER REAL — App Shell do DS 1.0 (§12/§13/§15/§18)
// ═══════════════════════════════════════════════════════════════
// Roda contra o BUILD DE PRODUÇÃO local (`next start`) com DB descartável e
// usuários fictícios (`.cache/design-system/qa.json`). O login é feito pelo
// FORMULÁRIO real — nenhuma sessão é forjada. Nenhuma chamada toca produção.
//
// Uso: node tests/design-system/shell-qa.mjs
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
  // O form tem um botão de mostrar senha (type=button) ANTES do submit:
  // clica pelo rótulo real de entrar, nunca pelo primeiro botão do form.
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 });
  await page.waitForLoadState('networkidle').catch(() => {});
}

const box = async (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom, right: r.right };
}, sel);

const cssVar = (page, name) => page.evaluate(
  (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

// ── Desktop 1440 ───────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await login(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const topbar = await box(page, '.ws-topbar');
  const sidebar = await box(page, '.workspace-sidebar');
  ok('§12 · topbar ocupa 100% da largura (x=0, largura = viewport)',
    topbar && Math.round(topbar.x) === 0 && Math.round(topbar.w) === 1440, JSON.stringify(topbar));
  ok('§12 · topbar ACIMA da sidebar (sidebar começa onde a topbar termina)',
    topbar && sidebar && Math.round(sidebar.y) === Math.round(topbar.bottom),
    `topbar.bottom=${topbar?.bottom} sidebar.y=${sidebar?.y}`);
  ok('§12 · sidebar encostada na esquerda', sidebar && Math.round(sidebar.x) === 0);

  const navBg = await page.evaluate(() => {
    const el = document.querySelector('.workspace-sidebar');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  ok('§13 · sidebar BRANCA (rgb(255,255,255))', navBg === 'rgb(255, 255, 255)', navBg);

  ok('§13 · rail recolhido por padrão (56–64px)', sidebar && sidebar.w >= 56 && sidebar.w <= 64, `w=${sidebar?.w}`);
  ok('§19 · sem breadcrumb global', await page.evaluate(() => !document.querySelector('.ws-crumbs, [data-breadcrumb]')));

  await page.screenshot({ path: `${OUT}/shell-1440-rail.png`, fullPage: false });

  // Painel de grupo: hover abre SEM reflow
  const before = await box(page, '.workspace-main-col');
  const groupBtn = page.locator('.workspace-link--group').first();
  const groupName = await groupBtn.getAttribute('aria-label');
  await groupBtn.hover();
  await page.waitForTimeout(400);
  const panel = await box(page, '#ws-nav-panel');
  const after = await box(page, '.workspace-main-col');
  ok('§15 · hover de grupo abre o painel lateral', !!panel, `grupo=${groupName}`);
  ok('§15 · painel começa ABAIXO da topbar', panel && Math.round(panel.y) === Math.round(topbar.bottom),
    `panel.y=${panel?.y} topbar.bottom=${topbar?.bottom}`);
  ok('§15 · painel ancorado na borda da navegação (rail + respiro)',
    panel && Math.round(panel.x) >= Math.round(sidebar.right) && Math.round(panel.x) <= Math.round(sidebar.right) + 12,
    `panel.x=${panel?.x} rail.right=${sidebar?.right}`);
  ok('§18 · NÃO há reflow: o conteúdo não se move',
    before && after && Math.round(before.x) === Math.round(after.x) && Math.round(before.w) === Math.round(after.w),
    `antes x=${before?.x} w=${before?.w} · depois x=${after?.x} w=${after?.w}`);
  const panelBg = await page.evaluate(() => {
    const el = document.querySelector('#ws-nav-panel');
    return el ? getComputedStyle(el).backgroundColor : null;
  });
  ok('§15 · painel branco com borda sutil', panelBg === 'rgb(255, 255, 255)', panelBg);
  await page.screenshot({ path: `${OUT}/shell-1440-painel-grupo.png` });

  // Escape fecha
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  ok('§15 · Escape fecha o painel', !(await page.$('#ws-nav-panel')));

  // Pin: expande e empurra o conteúdo
  await page.click('button[aria-label="Expandir navegação"]');
  await page.waitForTimeout(400);
  const sidebarWide = await box(page, '.workspace-sidebar');
  const contentPinned = await box(page, '.workspace-main-col');
  ok('§18 · pin expande a navegação (~248px)', sidebarWide && sidebarWide.w >= 240 && sidebarWide.w <= 260, `w=${sidebarWide?.w}`);
  ok('§18 · pin EMPURRA o conteúdo (sem overlay)',
    contentPinned && Math.round(contentPinned.x) === Math.round(sidebarWide.right),
    `conteúdo.x=${contentPinned?.x} nav.right=${sidebarWide?.right}`);
  await page.screenshot({ path: `${OUT}/shell-1440-expandida.png` });

  // Persistência do pin
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const afterReload = await box(page, '.workspace-sidebar');
  ok('§18 · pin lembrado localmente após reload', afterReload && afterReload.w >= 240, `w=${afterReload?.w}`);

  // Volta ao rail
  await page.click('button[aria-label="Recolher navegação"]');
  await page.waitForTimeout(300);
  const backToRail = await box(page, '.workspace-sidebar');
  ok('§18 · recolher volta ao rail (56–64px)', backToRail && backToRail.w >= 56 && backToRail.w <= 64);

  // Tokens do DS aplicados
  const topbarH = await cssVar(page, '--gd-topbar-h');
  const railW = await cssVar(page, '--gd-rail-w');
  const accent = await cssVar(page, '--gd-accent');
  ok('§5 · tokens --gd-* ativos na página', topbarH === '56px' && railW === '60px' && accent === '#2563eb',
    `topbar=${topbarH} rail=${railW} accent=${accent}`);

  // Agenda (primeira superfície) — está estável o suficiente para retrato
  await page.goto(`${BASE}/agenda`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/agenda-1440.png` });
  ok('§12 · Agenda renderiza dentro do shell novo', !!(await page.$('.workspace-sidebar')) && !!(await page.$('.ws-topbar')));

  await ctx.close();
}

// ── Viewports intermediários ───────────────────────────────────
for (const width of [1366, 1024]) {
  const ctx = await browser.newContext({ viewport: { width, height: 860 } });
  const page = await ctx.newPage();
  await login(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const topbar = await box(page, '.ws-topbar');
  // O shell não pode criar overflow: medimos o próprio shell (topbar/nav/
  // conteúdo), não o miolo de cada página (achados de página vão para o
  // relatório de auditoria, não viram falso positivo do shell).
  const shellOverflow = await page.evaluate(() => {
    let worst = 0;
    for (const sel of ['.ws-topbar', '.workspace-sidebar', '.workspace-main-col']) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      worst = Math.max(worst, Math.round(r.right - window.innerWidth));
    }
    return worst;
  });
  ok(`${width} · topbar 100% da largura e shell sem overflow próprio`,
    topbar && Math.round(topbar.w) === width && shellOverflow <= 1,
    `${JSON.stringify(topbar)} overflow=${shellOverflow}`);
  await page.screenshot({ path: `${OUT}/shell-${width}.png` });
  await ctx.close();
}

// ── Mobile 390 ─────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await login(page);
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  const sidebarVisible = await page.evaluate(() => {
    const el = document.querySelector('.workspace-sidebar');
    return el ? getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0 : false;
  });
  ok('390 · navegação lateral não ocupa a tela (drawer é a porta)', !sidebarVisible);
  const topbar = await box(page, '.ws-topbar');
  ok('390 · topbar presente e full-width', topbar && Math.round(topbar.w) === 390);
  await page.screenshot({ path: `${OUT}/shell-390.png` });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) {
  console.log('FALHAS:', failed.map((f) => f.name).join(' | '));
  process.exitCode = 1;
}
