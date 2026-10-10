// VERIFICAÇÕES COMPLEMENTARES (rodada 3) — o que o audit principal não mede:
//   • zoom 200% (viewport 720×450 @2x): nada vaza, painel continua preso;
//   • CONTRASTE dos textos-chave (WCAG AA ≥ 4.5:1 para texto normal);
//   • confirmação das ações destrutivas (cancelar) antes de qualquer gravação;
//   • import/export: negativa no SERVIDOR para perfil não-admin;
//   • menu: nenhuma rota legada/contextual ressuscitada.
// Saída: complementares.json + c-*.png nesta pasta.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ensureBrowser, CHROMIUM_ARGS } from '../qa-ux-closure/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await fs.readFile('/home/user/.cache/qa-ux/material.json', 'utf8'));
const base = fixture.base;
const M = {};

const runtime = await ensureBrowser();
const browser = await chromium.launch({
  executablePath: process.env.QA_BROWSER || runtime.executablePath,
  args: CHROMIUM_ARGS,
  env: { ...process.env, LD_LIBRARY_PATH: process.env.QA_BROWSER_LD || runtime.LD_LIBRARY_PATH },
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: path.join(here, `${n}.png`) });

async function login(email, senha) {
  await page.goto(`${base}/login`);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(senha);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL(/dashboard/, { timeout: 25000 });
  await wait(500);
}
const api = (method, url, body) => page.evaluate(async ([m, u, b]) => {
  const res = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  let data = null; try { data = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, data };
}, [method, url, body]);

await login(fixture.owner.email, fixture.owner.password);

// ── 1 · ZOOM 200% (720×450 CSS @2x) ─────────────────────────────────────
const zoomCtx = await browser.newContext({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
const zp = await zoomCtx.newPage();
await zp.goto(`${base}/login`);
await zp.getByLabel('E-mail', { exact: true }).fill(fixture.owner.email);
await zp.getByLabel('Senha', { exact: true }).fill(fixture.owner.password);
await zp.getByRole('button', { name: 'Entrar', exact: true }).click();
await zp.waitForURL(/dashboard/, { timeout: 25000 });
await zp.goto(`${base}/agenda?b=${fixture.b}&data=${fixture.day}&view=day`);
await zp.waitForSelector('button.ag-event', { timeout: 25000 });
await zp.waitForTimeout(1000);
M.zoom200 = await zp.evaluate(() => ({
  overflowX: document.documentElement.scrollWidth - window.innerWidth,
  eventos: document.querySelectorAll('button.ag-event').length,
  controlesDaBarra: [...document.querySelectorAll('.ag-page .gd-toolbar button')].filter((b) => b.getBoundingClientRect().height > 0).length,
  menorAlvoDeToque: Math.min(...[...document.querySelectorAll('.ag-page .gd-toolbar button')].map((b) => Math.round(b.getBoundingClientRect().height)).filter((h) => h > 0)),
}));
await zp.locator('button.ag-event').first().click();
await zp.waitForSelector('.gd-detail__panel', { timeout: 8000 }).catch(() => {});
await zp.waitForTimeout(600);
M.zoom200.detalhe = await zp.evaluate(() => {
  const el = document.querySelector('.gd-detail__panel');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), largura: Math.round(r.width), distanciaDireita: Math.round(window.innerWidth - r.right), alturaCheia: Math.abs(r.height - window.innerHeight) < 2 };
});
await zp.screenshot({ path: path.join(here, 'c-zoom200-detalhe.png') });
await zoomCtx.close();

// ── 2 · CONTRASTE (WCAG) dos textos-chave ───────────────────────────────
await page.goto(`${base}/agenda?b=${fixture.b}&data=${fixture.day}&view=day`);
await page.waitForSelector('button.ag-event', { timeout: 25000 });
await wait(900);
M.contraste = await page.evaluate(() => {
  const lum = (c) => {
    const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const fundoReal = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) return bg;
      n = n.parentElement;
    }
    return 'rgb(255, 255, 255)';
  };
  const razao = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const f = lum(cs.color); const b = lum(fundoReal(el));
    const r = (Math.max(f, b) + 0.05) / (Math.min(f, b) + 0.05);
    return { cor: cs.color, fundo: fundoReal(el), razao: +r.toFixed(2), tamanho: cs.fontSize, ok: r >= 4.5 };
  };
  return {
    nav: razao(document.querySelector('.workspace-sidebar .workspace-link')),
    tituloDaPagina: razao(document.querySelector('.ag-page h1, .ag-page h2')),
    nomeDoEvento: razao(document.querySelector('button.ag-event .ag-event__name, button.ag-event span')),
    horaNaGrade: razao(document.querySelector('.ag-page .ag-hours, .ag-page [class*="hour"]')),
    rotuloDeStatus: razao(document.querySelector('.ag-event__status, button.ag-event')),
  };
});

// ── 3 · CONFIRMAÇÃO DE AÇÃO DESTRUTIVA (sem gravar nada) ────────────────
await page.locator('button.ag-event').filter({ hasText: 'Ana Prado' }).first().click({ button: 'right' });
await page.waitForSelector('[role="menu"]', { timeout: 5000 }).catch(() => {});
await wait(400);
const itemCancelar = page.getByRole('menuitem', { name: /Cancelar atendimento/i });
M.destrutiva = { itemNoMenu: await itemCancelar.count() === 1 };
if (M.destrutiva.itemNoMenu) {
  await itemCancelar.click();
  await wait(700);
  M.destrutiva.pediuConfirmacao = await page.evaluate(() => {
    const t = document.body.innerText;
    return /Confirmar|Tem certeza|não pode ser desfeito|cancelamento/i.test(t);
  });
  M.destrutiva.textoDaConfirmacao = await page.evaluate(() => {
    const d = document.querySelector('dialog, .overlay-confirm');
    return d ? (d.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160) : null;
  });
  await shot('c-confirmacao-cancelar');
  // SAI SEM CONFIRMAR — nenhum status é gravado.
  await page.keyboard.press('Escape'); await wait(400);
  const depois = await api('GET', `/api/bookings?businessId=${fixture.b}&mode=manage&from=${fixture.day}&to=${fixture.day}&limit=200`);
  const alvo = (depois.data?.bookings || []).find((b) => /Ana Prado/.test(b.petName || b.customerName || ''));
  M.destrutiva.statusPreservado = alvo?.status || null;
}

// ── 4 · IMPORT/EXPORT — negativa no SERVIDOR (não-admin) ────────────────
await ctx.clearCookies();
await login(fixture.clinicoEmail, 'GodoutorDS11-QA!');
M.naoAdmin = {
  csv: await api('GET', `/api/contacts/export?businessId=${fixture.b}`),
  full: await api('GET', `/api/contacts/export-full?businessId=${fixture.b}`),
  imp: await api('POST', '/api/contacts/import', { businessId: fixture.b, mode: 'preview', csv: 'nome;telefone\nQA;11999999999' }),
};
for (const k of ['csv', 'full', 'imp']) M.naoAdmin[k] = { status: M.naoAdmin[k].status, erro: M.naoAdmin[k].data?.error || null };

// ── 5 · MENU: nenhuma rota legada/contextual ────────────────────────────
M.menu = await page.evaluate(() => {
  const t = document.querySelector('.workspace-sidebar')?.textContent || '';
  const proibidos = ['Recursos', 'Execuções', 'Payload', 'Testes internos'];
  return { proibidosPresentes: proibidos.filter((p) => t.includes(p)), itens: document.querySelectorAll('.workspace-sidebar a').length };
});

await fs.writeFile(path.join(here, 'complementares.json'), JSON.stringify(M, null, 2));
await browser.close();
console.log('complementares.json escrito');
console.log('zoom 200%:', JSON.stringify(M.zoom200));
console.log('contraste:', JSON.stringify(M.contraste));
console.log('destrutiva:', JSON.stringify(M.destrutiva));
console.log('não-admin:', JSON.stringify(M.naoAdmin));
