// ═══════════════════════════════════════════════════════════════
// MISSÃO SIDEBAR FINAL — evidências visuais + verificações programáticas
// Uso: node tools/shots/sidebar-evidence.mjs
// Login real; 1440×900; saída /home/user/shots/sidebar/*.png + relatório
// JSON com as verificações objetivas (scrollbar, estados, tokens).
// ═══════════════════════════════════════════════════════════════
import fs from 'node:fs';
import { createRequire } from 'node:module';
import puppeteer from 'puppeteer-core';

const require = createRequire(import.meta.url);
const chromiumMod = require('@sparticuz/chromium');
const chromium = chromiumMod.default || chromiumMod;
const lambdafs = require(new URL('../../node_modules/@sparticuz/chromium/build/lambdafs.js', import.meta.url).pathname);

const LIB_DIR = '/tmp/al2023/lib';
if (!fs.existsSync(LIB_DIR)) {
  await lambdafs.inflate(new URL('../../node_modules/@sparticuz/chromium/bin/al2023.tar.br', import.meta.url).pathname);
}
process.env.LD_LIBRARY_PATH = `${LIB_DIR}:${process.env.LD_LIBRARY_PATH || ''}`;

const BASE = process.env.BASE || 'http://127.0.0.1:3000';
const UNIT = process.env.UNIT || 'biz-clinicavitta';
const OUT = '/home/user/shots/sidebar';
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = {};
let failures = 0;
function check(name, ok, detail = '') {
  report[name] = { ok, detail };
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗ FALHA'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const browser = await puppeteer.launch({
  args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
  executablePath: await chromium.executablePath(),
  headless: 'shell',
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => console.log('⚠ pageerror:', e.message));

  // ── login real ──
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[type="email"]', 'demo@instalink.app');
  await page.type('input[type="password"]', 'demo1234');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }),
    page.click('form button:not([type])'),
  ]);

  const state = async () => page.evaluate(() => {
    const aside = document.querySelector('.workspace-sidebar');
    const primary = document.querySelector('.workspace-primary');
    const open = [...document.querySelectorAll('.workspace-group.is-open')].map((g) => g.id || g.querySelector('button')?.getAttribute('aria-label'));
    const active = document.querySelector('.workspace-link[aria-current="page"]');
    const activeStyle = active ? getComputedStyle(active) : null;
    return {
      logged: !!aside,
      collapsed: aside?.classList.contains('is-collapsed'),
      openGroups: open,
      sectionLabels: document.querySelectorAll('.workspace-section__label').length,
      horizontalScroll: primary ? primary.scrollWidth - primary.clientWidth : null,
      asideHorizontalScroll: aside ? aside.scrollWidth - aside.clientWidth : null,
      activeBg: activeStyle?.backgroundColor || null,
      activeColor: activeStyle?.color || null,
      activeWeight: activeStyle?.fontWeight || null,
      sidebarWidth: aside ? getComputedStyle(aside).width : null,
      clinicNameInHead: !!document.querySelector('.workspace-clinic-head__name'),
      clinicTextInHead: !!document.querySelector('.workspace-clinic-head__text'),
      submenuCount: document.querySelectorAll('.workspace-submenu').length,
      ilTipCount: document.querySelectorAll('.il-tip').length,
      navText: primary?.textContent?.replace(/\s+/g, ' ').trim() || '',
    };
  });

  // ── A: expandida, /dashboard (rota plana) ⇒ Clínica aberta por padrão ──
  await page.goto(`${BASE}/dashboard?b=${UNIT}`, { waitUntil: 'networkidle2' });
  await sleep(600);
  let s = await state();
  check('A1 login ok (sidebar presente)', s.logged);
  check('A2 /dashboard inicia com Clínica aberta (padrão)', s.openGroups.length === 1 && /Clínica/.test(s.openGroups[0] || ''), JSON.stringify(s.openGroups));
  check('A3 exatamente UM grupo aberto', s.openGroups.length === 1);
  check('A4 SEM títulos de seção', s.sectionLabels === 0 && !/Operação|Administração/.test(s.navText), s.navText.slice(0, 80));
  check('A5 SEM scrollbar horizontal (expandida)', s.horizontalScroll <= 0, `scrollWidth-clientWidth=${s.horizontalScroll}`);
  check('A6 largura ~256px', s.sidebarWidth === '256px', s.sidebarWidth);
  const activeBgOk = s.activeBg && s.activeBg !== 'rgba(0, 0, 0, 0)' && s.activeBg !== 'rgb(37, 99, 235)';
  check('A7 item ATIVO com fundo (não transparente, não azul sólido)', !!activeBgOk, `bg=${s.activeBg} color=${s.activeColor} weight=${s.activeWeight}`);
  check('A8 item ativo peso 600', s.activeWeight === '600', s.activeWeight);
  await page.screenshot({ path: `${OUT}/A-expandida-clinica-aberta.png` });

  // ── B: clicar Automação ⇒ fecha Clínica, abre Automação ──
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.workspace-link--group')].find((b) => b.getAttribute('aria-label') === 'Automação');
    btn?.click();
  });
  await sleep(500);
  s = await state();
  check('B1 clicar Automação abre Automação (e fecha Clínica)', s.openGroups.length === 1 && /Automação/.test(s.openGroups[0] || ''), JSON.stringify(s.openGroups));
  // clicar de novo NÃO fecha
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.workspace-link--group')].find((b) => b.getAttribute('aria-label') === 'Automação');
    btn?.click();
  });
  await sleep(400);
  s = await state();
  check('B2 clicar de novo em Automação NÃO fecha', s.openGroups.length === 1 && /Automação/.test(s.openGroups[0] || ''), JSON.stringify(s.openGroups));
  await page.screenshot({ path: `${OUT}/B-expandida-automacao-aberta.png` });

  // ── C: Gestão ──
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.workspace-link--group')].find((b) => b.getAttribute('aria-label') === 'Gestão');
    btn?.click();
  });
  await sleep(500);
  s = await state();
  check('C1 clicar Gestão troca para Gestão (um por vez)', s.openGroups.length === 1 && /Gestão/.test(s.openGroups[0] || ''), JSON.stringify(s.openGroups));
  await page.screenshot({ path: `${OUT}/C-expandida-gestao-aberta.png` });

  // ── D: deep-link /servicos abre Clínica; estado ativo azul-claro ──
  await page.goto(`${BASE}/servicos?b=${UNIT}`, { waitUntil: 'networkidle2' });
  await sleep(600);
  s = await state();
  check('D1 deep-link /servicos abre Clínica', s.openGroups.length === 1 && /Clínica/.test(s.openGroups[0] || ''), JSON.stringify(s.openGroups));
  check('D2 SEM scrollbar horizontal (servicos)', s.horizontalScroll <= 0, `delta=${s.horizontalScroll}`);
  await page.screenshot({ path: `${OUT}/D-ativo-azul-claro.png` });

  // ── E: recolhida ──
  await page.evaluate(() => {
    const btn = document.querySelector('.workspace-foot__item--collapse');
    btn?.click();
  });
  await sleep(600);
  s = await state();
  check('E1 sidebar recolhida', s.collapsed === true);
  check('E2 SEM nome/tipo da clínica no DOM do rail', s.clinicTextInHead === false && s.clinicNameInHead === false);
  check('E3 SEM submenu inline', s.submenuCount === 0);
  check('E4 SEM .il-tip (causa da scrollbar)', s.ilTipCount === 0);
  check('E5 SEM scrollbar horizontal (recolhida)', s.horizontalScroll <= 0, `delta=${s.horizontalScroll}`);
  check('E6 largura ~68px', s.sidebarWidth === '68px', s.sidebarWidth);
  const labelsHidden = await page.evaluate(() => {
    const el = document.querySelector('.workspace-sidebar .workspace-label');
    return el ? getComputedStyle(el).display === 'none' : null;
  });
  check('E7 labels ocultos por CSS no rail', labelsHidden === true);
  await page.screenshot({ path: `${OUT}/E-recolhida.png` });

  // ── F: tooltip no hover (rail) + clique em grupo expande e abre ──
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.workspace-link--group')].find((b) => b.getAttribute('aria-label') === 'Automação');
    btn?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
  await sleep(400);
  const tipText = await page.evaluate(() => document.querySelector('.ws-nav-tip')?.textContent || null);
  check('F1 tooltip aparece no hover do rail', tipText === 'Automação', `tip=${JSON.stringify(tipText)}`);
  await page.screenshot({ path: `${OUT}/F-tooltip-hover.png` });
  // clique no grupo do rail ⇒ expande + abre o grupo
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('.workspace-link--group')].find((b) => b.getAttribute('aria-label') === 'Automação');
    btn?.click();
  });
  await sleep(700);
  s = await state();
  check('F2 clique no grupo do rail EXPANDE a sidebar', s.collapsed === false);
  check('F3 ...e ABRE o grupo escolhido (Automação)', s.openGroups.length === 1 && /Automação/.test(s.openGroups[0] || ''), JSON.stringify(s.openGroups));

  // ── G: mobile drawer (390×844) — sem títulos, acordeão no próprio drawer ──
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/dashboard?b=${UNIT}`, { waitUntil: 'networkidle2' });
  await sleep(400);
  await page.evaluate(() => {
    const btn = document.querySelector('.ws-topbar__nav-toggle');
    btn?.click();
  });
  await sleep(600);
  const mob = await page.evaluate(() => {
    const dialog = document.querySelector('dialog[open]');
    const nav = dialog?.querySelector('nav');
    return {
      dialog: !!dialog,
      titles: nav ? /Operação|Administração/.test(nav.textContent || '') : null,
      groups: nav ? nav.querySelectorAll('.workspace-link--group').length : 0,
      agendaLink: nav ? !!([...nav.querySelectorAll('a')].find((a) => a.getAttribute('aria-label') === 'Agenda')) : false,
    };
  });
  check('G1 drawer móvel abre', mob.dialog);
  check('G2 drawer SEM títulos de seção', mob.titles === false);
  check('G3 drawer com os 4 grupos + links diretos', mob.groups === 4 && mob.agendaLink, `grupos=${mob.groups}`);
  await page.screenshot({ path: `${OUT}/G-mobile-drawer.png` });

  fs.writeFileSync(`${OUT}/report.json`, JSON.stringify({ failures, checks: report }, null, 2));
  console.log(`\n${failures === 0 ? 'TODAS AS VERIFICAÇÕES PASSARAM' : `${failures} FALHA(S)`} — relatório em ${OUT}/report.json`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  await browser.close();
}
