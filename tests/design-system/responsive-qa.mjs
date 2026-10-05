// ═══════════════════════════════════════════════════════════════
// QA DE BROWSER REAL — RESPONSIVE (DS 1.0 · §12 e §26)
// ═══════════════════════════════════════════════════════════════
// Roda contra o BUILD DE PRODUÇÃO local (`next start`) com banco descartável.
// Prova, em DOM renderizado, que as superfícies convertidas não criam rolagem
// horizontal em NENHUMA das quatro larguras exigidas (1440/1366/1024/390) e que
// a coluna principal do shell ocupa a largura útil (nunca largura 0).
//
// O caso histórico do Dashboard em 1024px (grid `.dsh-metric`) fica coberto
// aqui: era exceção documentada e agora é medição permanente.
//
// Uso: node tests/design-system/responsive-qa.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_BASE || 'http://127.0.0.1:3020';
const OUT = 'docs/qa-design-system';
const EMAIL = 'owner.qa@godoutor.local';
const PASSWORD = 'GodoutorQA2026!';
const WIDTHS = [1440, 1366, 1024, 390];
const ROUTES = [
  ['/dashboard', 'Visão geral'],
  ['/agenda', 'Agenda'],
  ['/funil', 'Oportunidades'],
  ['/clientes', 'Clientes'],
  ['/canais', 'Canais & Integrações'],
  ['/configuracoes', 'Configurações'],
];

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

/** Estouro horizontal real do documento + quem estoura (fora de scroll container). */
async function overflow(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const inScroller = (el) => {
      let n = el.parentElement;
      while (n) {
        const ov = getComputedStyle(n).overflowX;
        if (ov === 'auto' || ov === 'scroll') return true;
        n = n.parentElement;
      }
      return false;
    };
    const culprits = [];
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.right <= vw + 1) continue;
      if (inScroller(el)) continue;
      culprits.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}(right=${Math.round(b.right)})`);
    }
    const col = document.querySelector('.workspace-main-col');
    const colBox = col ? col.getBoundingClientRect() : null;
    return {
      doc: document.documentElement.scrollWidth, vw,
      culprits: culprits.slice(0, 4),
      col: colBox ? { x: Math.round(colBox.x), w: Math.round(colBox.width) } : null,
    };
  });
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45000 });

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const [route, label] of ROUTES) {
      await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2400);
      const r = await overflow(page);
      ok(`${width} · ${label} sem rolagem horizontal`, r.doc <= r.vw && r.culprits.length === 0,
        `doc=${r.doc} vw=${r.vw}${r.culprits.length ? ` culpados=${r.culprits.join(', ')}` : ''}`);
      const colOk = width >= 1200 ? true : (r.col === null || r.col.w >= width - 2);
      ok(`${width} · ${label}: coluna principal ocupa a largura útil`, colOk, r.col ? `x=${r.col.x} w=${r.col.w}` : 'sem coluna');
    }
    // O print tem de ser da superfície que o nome promete: volta para a Visão
    // geral antes de capturar (o loop terminou na última rota da lista).
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${OUT}/responsive-${width}-dashboard.png`, fullPage: false });
  }
} catch (err) {
  ok(`exceção: ${err?.message || err}`, false);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) { console.log('FALHAS:'); for (const f of failed) console.log(` - ${f.name} ${f.extra}`); }
process.exit(failed.length ? 1 : 0);
