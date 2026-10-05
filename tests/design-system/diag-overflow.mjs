// Diagnóstico de overflow horizontal em várias larguras/rotas (somente leitura).
// Uso: QA_WIDTHS=390,768,1024,1366,1440 QA_ROUTES=/dashboard,/agenda node tests/design-system/diag-overflow.mjs
import { chromium } from 'playwright-core';

const BASE = process.env.QA_BASE || 'http://127.0.0.1:3020';
const WIDTHS = (process.env.QA_WIDTHS || '390,768,1024,1199,1366,1440').split(',').map(Number);
const ROUTES = (process.env.QA_ROUTES || '/dashboard').split(',');

const browser = await chromium.launch({
  executablePath: process.env.QA_EXECUTABLE_PATH || '/tmp/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#email', 'owner.qa@godoutor.local');
await page.fill('#password', 'GodoutorQA2026!');
await page.getByRole('button', { name: /entrar/i }).click();
await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45000 });

for (const w of WIDTHS) {
  await page.setViewportSize({ width: w, height: 900 });
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2600);
    const r = await page.evaluate(() => {
      const vw = window.innerWidth;
      const culprits = [];
      document.querySelectorAll('*').forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.right <= vw + 1) return;
        let d = 0, n = el; while ((n = n.parentElement)) d++;
        culprits.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 70), right: Math.round(b.right), w: Math.round(b.width), depth: d });
      });
      culprits.sort((a, b) => a.depth - b.depth);
      const g = document.querySelector('.dsh-metrics');
      return {
        doc: document.documentElement.scrollWidth, vw,
        grid: g ? { cols: getComputedStyle(g).gridTemplateColumns, w: Math.round(g.getBoundingClientRect().width) } : null,
        culprits: culprits.slice(0, 6),
      };
    });
    const worst = r.culprits[0] ? ` pior=${r.culprits[0].tag}.${r.culprits[0].cls.split(' ')[0]} right=${r.culprits[0].right} w=${r.culprits[0].w}` : '';
    console.log(`${w}px ${route}: overflow=${r.doc - r.vw} (doc=${r.doc}${r.grid ? ` grid=${r.grid.cols}` : ''})${worst}`);
  }
}
await browser.close();
