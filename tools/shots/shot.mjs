// ═══════════════════════════════════════════════════════════════
// Harness de evidências visuais (rodar: node tools/shots/shot.mjs [cena|all])
// Usa puppeteer-core + chromium empacotado (@sparticuz/chromium, instalado
// com --no-save). Login real via formulário; cenas = rotas + interações.
// Saída: /home/user/shots/*.png (fora do repo; o que vira evidência é
// copiado para docs/evidence/).
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
const OUT = process.env.OUT || '/home/user/shots';
fs.mkdirSync(OUT, { recursive: true });

const VP = {
  desktop: { width: 1440, height: 900 },
  laptop: { width: 1366, height: 768 },
  mobile: { width: 390, height: 844 },
  w1600: { width: 1600, height: 900 },
  w1920: { width: 1920, height: 1080 },
};

/** cena: [viewport, fn(page)] */
const SCENES = {
  '01-dashboard': ['desktop', async (p) => go(p, `/dashboard?b=${UNIT}`)],
  '02-agenda': ['desktop', async (p) => go(p, `/agenda?b=${UNIT}`)],
  '13-agenda-semana': ['desktop', async (p) => go(p, `/agenda?b=${UNIT}&view=week`)],
  '20-agenda-dia': ['desktop', async (p) => go(p, `/agenda?b=${UNIT}&view=day`)],
  '19-pagina-modelo': ['desktop', async (p) => go(p, `/pagina?b=${UNIT}&tab=modelo`)],
  '14-pagina-perfil': ['desktop', async (p) => go(p, `/pagina?b=${UNIT}&tab=perfil`)],
  '05-conversas-sheet': ['desktop', async (p) => {
    await go(p, `/dashboard?b=${UNIT}`);
    await p.click('.conversation-shortcut');
    await sleep(600);
  }],
  '21-sidebar-expandida': ['desktop', async (p) => {
    await go(p, `/dashboard?b=${UNIT}`);
    await p.evaluate(() => localStorage.setItem('il-side-v2', 'full'));
    await go(p, `/dashboard?b=${UNIT}`);
  }],
  '22-sidebar-recolhida': ['desktop', async (p) => {
    await go(p, `/dashboard?b=${UNIT}`);
    await p.click('[aria-label="Recolher navegação"]');
    await sleep(400);
  }],
  '23-user-menu': ['desktop', async (p) => {
    await go(p, `/dashboard?b=${UNIT}`);
    await p.click('[aria-label^="Menu da conta"]');
    await sleep(400);
  }],
  '24-editor-1600': ['w1600', async (p) => go(p, `/pagina?b=${UNIT}`)],
  '25-editor-1920': ['w1920', async (p) => go(p, `/pagina?b=${UNIT}`)],
  '15-laptop-inicio': ['laptop', async (p) => go(p, `/dashboard?b=${UNIT}`)],
  '16-laptop-agenda': ['laptop', async (p) => go(p, `/agenda?b=${UNIT}&view=week`)],
  '17-mobile-inicio': ['mobile', async (p) => go(p, `/dashboard?b=${UNIT}`)],
  '18-mobile-agenda': ['mobile', async (p) => go(p, `/agenda?b=${UNIT}`)],
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function go(page, path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(700);
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.type('input[type="email"], input[name="email"]', 'demo@instalink.app');
  await page.type('input[type="password"]', 'demo1234');
  await Promise.all([
    page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 }),
    page.click('form button'),
  ]);
  await sleep(800);
  console.log('logged in at', BASE);
}

const want = process.argv[2] && process.argv[2] !== 'all' ? process.argv.slice(2) : Object.keys(SCENES);
const exe = await chromium.executablePath();
const browser = await puppeteer.launch({
  executablePath: exe,
  args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: VP.desktop,
});
try {
  const page = await browser.newPage();
  await login(page);
  for (const name of want) {
    const [vp, fn] = SCENES[name];
    if (!fn) { console.log('cena desconhecida:', name); continue; }
    await page.setViewport(VP[vp]);
    await fn(page);
    const file = `${OUT}/${name}.png`;
    await page.screenshot({ path: file });
    console.log(`✓ ${name} (${vp}) → ${file}`);
  }
  console.log('DONE ok');
} finally {
  await browser.close();
}
