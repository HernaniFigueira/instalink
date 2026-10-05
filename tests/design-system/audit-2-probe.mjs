// AUDIT #2 — varredura adversarial das telas migradas nesta rodada que ainda
// não tinham QA próprio: Configurações (Integrações/Canais) e Campanhas.
// Prova em DOM renderizado: a página carrega, nenhum overlay artesanal existe,
// os Dialogs canônicos abrem e fecham com Escape, e o CloseButton é neutro.
import { chromium } from 'playwright-core';

const BASE = process.env.QA_BASE || 'http://127.0.0.1:3020';
const EMAIL = 'owner.qa@godoutor.local';
const PASSWORD = 'GodoutorQA2026!';

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

const artesanal = (page) => page.evaluate(() => Array.from(
  document.querySelectorAll('div.fixed.inset-0, div[class*="fixed inset-0"]'),
).filter((n) => !n.classList.contains('gd-dialog-backdrop') && !n.closest('.gd-dialog-backdrop')).length);

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
  await login(page);

  for (const route of ['/configuracoes', '/canais', '/campanhas']) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const heading = await page.locator('h1').first().innerText().catch(() => '');
    ok(`AUDIT#2 · ${route} carrega sem erro de runtime`, !!heading && (await artesanal(page)) === 0,
      `h1="${heading.trim().slice(0, 40)}" artesanais=${await artesanal(page)}`);
  }

  // /canais → aba "Integrações" (onde vivem os Dialogs migrados de Integrações/Canais).
  await page.goto(`${BASE}/canais`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  // As abas de Canais usam role=tab (Tabs canônico) — não `button`.
  await page.locator('[role="tab"]', { hasText: /integra/i }).first().click().catch(() => {});
  await page.waitForTimeout(2500);
  const triggers = await page.evaluate(() => {
    const hit = ['Gerar nova chave', 'Gerar chave', 'Adicionar webhook', 'Conectar'];
    return Array.from(document.querySelectorAll('button')).filter((b) =>
      hit.some((t) => new RegExp(t, 'i').test(b.textContent || ''))).map((b) => (b.textContent || '').trim()).slice(0, 6);
  });
  let opened = 0;
  for (const label of triggers) {
    const btn = page.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).first();
    if (!(await btn.count())) continue;
    await btn.click({ trial: false }).catch(() => {});
    await page.waitForTimeout(700);
    const dlg = page.locator('div.gd-dialog');
    if (await dlg.count()) {
      opened += 1;
      const contained = await page.evaluate(() => {
        const d = document.querySelector('div.gd-dialog');
        return !!d && d.contains(document.activeElement);
      });
      ok(`AUDIT#2 · Dialog "${label}" foca dentro do overlay e não é artesanal`,
        contained && (await artesanal(page)) === 0);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
      ok(`AUDIT#2 · Dialog "${label}" fecha com Escape`, (await page.locator('div.gd-dialog').count()) === 0);
    }
  }
  ok('AUDIT#2 · há pelo menos um Dialog canônico exercitado em Canais & Integrações', opened >= 2, `abertos=${opened}`);

  // Sub-aba interna "Webhooks" do IntegracoesView — o Dialog do webhook fica ali.
  await page.locator('[role="tab"]', { hasText: /webhooks/i }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  const webhookBtn = page.getByRole('button', { name: /^Adicionar webhook$/i }).first();
  if (await webhookBtn.count()) {
    await webhookBtn.click();
    await page.waitForTimeout(600);
    const wdlg = page.locator('div.gd-dialog');
    ok('AUDIT#2 · Dialog "Adicionar webhook" é canônico (zero artesanal)',
      (await wdlg.count()) === 1 && (await artesanal(page)) === 0 &&
      /Novo webhook de saída/i.test((await wdlg.getAttribute('aria-label')) || ''));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    ok('AUDIT#2 · Escape fecha o webhook sem criar nada', (await page.locator('div.gd-dialog').count()) === 0);
  } else {
    ok('AUDIT#2 · botão "Adicionar webhook" disponível na sub-aba', false, 'não encontrado');
  }

  // Campanhas → abre "Nova campanha" e confere o Dialog canônico.
  await page.goto(`${BASE}/campanhas`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const newCampaign = page.getByRole('button', { name: /nova campanha/i }).first();
  if (await newCampaign.count()) {
    await newCampaign.click();
    await page.waitForTimeout(700);
    const dlg = page.locator('div.gd-dialog');
    ok('AUDIT#2 · "Nova campanha" abre o Dialog canônico (zero artesanal)',
      (await dlg.count()) === 1 && (await artesanal(page)) === 0);
    ok('AUDIT#2 · Dialog de campanha sem Danger e com CloseButton neutro',
      await dlg.evaluate((el) => {
        const norm = (raw) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = raw; return c.fillStyle; };
        const danger = norm(getComputedStyle(document.documentElement).getPropertyValue('--danger').trim());
        const btn = el.querySelector('.gd-dialog__header button');
        return !!btn && norm(getComputedStyle(btn).color) !== danger;
      }));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    ok('AUDIT#2 · Escape fecha sem criar campanha',
      (await page.locator('div.gd-dialog').count()) === 0 && (await artesanal(page)) === 0);
  } else {
    ok('AUDIT#2 · botão "Nova campanha" disponível no fixture', false, 'não encontrado');
  }

  const fatal = errors.filter((e) => !/favicon|manifest|Download the React DevTools/i.test(e));
  ok('AUDIT#2 · nenhum erro de console inesperado nas telas migradas', fatal.length === 0, fatal.slice(0, 2).join(' | '));
} catch (err) {
  ok(`exceção: ${err?.message || err}`, false);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
process.exit(failed.length ? 1 : 0);
