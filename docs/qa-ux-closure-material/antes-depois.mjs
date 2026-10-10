// ANTES × DEPOIS — mesmo script, duas bases.
//   node docs/qa-ux-closure-material/antes-depois.mjs            → base 3000 (HEAD)
//   node docs/qa-ux-closure-material/antes-depois.mjs antes      → base 3001 (4cd669f)
// Saída: <prefixo>-*.png + <prefixo>-medicoes.json nesta pasta.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ensureBrowser, CHROMIUM_ARGS } from '../qa-ux-closure/browser.mjs';

const tag = process.argv[2] || 'depois';
const BASE = process.env.QA_BASE || (tag === 'antes' ? 'http://127.0.0.1:3001' : 'http://127.0.0.1:3000');
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await fs.readFile('/home/user/.cache/qa-ux/material.json', 'utf8'));
const M = { base: BASE, tag };

const runtime = await ensureBrowser();
const browser = await chromium.launch({
  executablePath: process.env.QA_BROWSER || runtime.executablePath,
  args: CHROMIUM_ARGS,
  env: { ...process.env, LD_LIBRARY_PATH: process.env.QA_BROWSER_LD || runtime.LD_LIBRARY_PATH },
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const wait = (ms) => page.waitForTimeout(ms);
const shot = (n) => page.screenshot({ path: path.join(here, `${tag}-${n}.png`) });

await page.goto(`${BASE}/login`);
await page.getByLabel('E-mail', { exact: true }).fill(fixture.owner.email);
await page.getByLabel('Senha', { exact: true }).fill(fixture.owner.password);
await page.getByRole('button', { name: 'Entrar', exact: true }).click();
await page.waitForURL(/dashboard/, { timeout: 30000 });
await wait(600);

// ── 1 · HOVER do evento (resumo contextual) ─────────────────────────────
await page.goto(`${BASE}/agenda?b=${fixture.b}&data=${fixture.day}&view=day`);
await page.waitForSelector('button.ag-event', { timeout: 25000 });
await wait(1200);
const evento = page.locator('button.ag-event').filter({ hasText: 'Ana Prado' }).first();
await evento.scrollIntoViewIfNeeded();
const caixaEvento = await evento.boundingBox();
const t0 = Date.now();
await evento.hover();
await page.waitForFunction(() => !!document.querySelector('.gd-hovercard, [data-hover-card]'), null, { timeout: 4000 }).catch(() => {});
M.hoverMsAteAparecer = Date.now() - t0;
await wait(250);
M.hover = await page.evaluate(() => {
  const card = document.querySelector('.gd-hovercard');
  if (!card) return null;
  const r = card.getBoundingClientRect();
  const cs = getComputedStyle(card);
  return {
    largura: Math.round(r.width), altura: Math.round(r.height),
    fundo: cs.backgroundColor, sombra: cs.boxShadow.slice(0, 80),
    temCta: /Ver detalhes/.test(card.textContent || ''),
    temStatus: /(Pendente|Confirmado|Concluído|Faltou|Cancelado)/.test(card.textContent || ''),
    texto: (card.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
  };
});
await shot('hover-1440');

// ── 2 · BOTÃO DIREITO (antes: só o resumo; depois: menu real) ───────────
await evento.click({ button: 'right' });
await wait(600);
M.ctxmenu = await page.evaluate(() => {
  const menu = document.querySelector('[role="menu"]');
  return {
    existe: !!menu,
    itens: menu ? [...menu.querySelectorAll('[role="menuitem"]')].map((b) => (b.textContent || '').trim()) : [],
    hoverAceso: !!document.querySelector('.gd-hovercard'),
  };
});
await shot('ctxmenu-1440');
// Teclado equivalente
await page.keyboard.press('Escape'); await wait(300);
await evento.focus();
await page.keyboard.press('Shift+F10'); await wait(500);
M.ctxmenuTeclado = await page.evaluate(() => !!document.querySelector('[role="menu"]'));
await page.keyboard.press('Escape'); await wait(300);

// ── 3 · TOOLBAR (alturas de todos os controles) ─────────────────────────
M.toolbar = await page.evaluate(() => {
  const faixa = document.querySelector('.ag-page .gd-toolbar');
  if (!faixa) return null;
  const alvos = [...faixa.querySelectorAll('button, a, [role="group"], .il-field-control')]
    .filter((el) => el.getBoundingClientRect().height > 0);
  const desc = (el) => ({
    rotulo: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24),
    altura: Math.round(el.getBoundingClientRect().height),
    borda: getComputedStyle(el).borderTopWidth,
    fundo: getComputedStyle(el).backgroundColor,
  });
  const todos = alvos.map(desc);
  const foraDoSeg = todos.filter((t) => !['Dia', 'Semana', 'Lista'].includes(t.rotulo));
  const alturas = todos.map((t) => t.altura);
  return {
    todos,
    qtd: todos.length,
    min: Math.min(...alturas), max: Math.max(...alturas),
    variacao: Math.max(...alturas) - Math.min(...alturas),
    comBorda: todos.filter((t) => parseFloat(t.borda) > 0).map((t) => t.rotulo),
    equivalentesVariacao: Math.max(...foraDoSeg.map((t) => t.altura)) - Math.min(...foraDoSeg.map((t) => t.altura)),
  };
});
await shot('toolbar-1440');

// ── 4 · SEMANA (alças de resize visíveis, sem mutar nada) ───────────────
// `role="tab"`: o getByRole('button') anterior era no-op silencioso e a
// medição saía da vista DIA com rótulo de Semana.
await page.getByRole('tab', { name: 'Semana', exact: true }).first().click().catch(() => {});
await wait(1400);
M.semana = await page.evaluate(() => ({
  vistaSelecionada: document.querySelector('.il-segmented [role="tab"][aria-selected="true"]')?.textContent?.trim() || null,
  colunas: document.querySelectorAll('[data-agenda-column]').length,
  eventos: document.querySelectorAll('button.ag-event').length,
  alcas: document.querySelectorAll('span[aria-label^="Redimensionar"]').length,
}));
await shot('semana-1440');
await page.getByRole('tab', { name: 'Dia', exact: true }).first().click().catch(() => {});
await wait(900);

// ── 5 · DETALHE (painel lateral preso à direita) ────────────────────────
await page.locator('button.ag-event').first().click();
await page.waitForSelector('.gd-detail__panel, .ws-sheet', { timeout: 8000 }).catch(() => {});
await wait(700);
M.detalhe1440 = await page.evaluate(() => {
  const el = document.querySelector('.gd-detail__panel') || document.querySelector('.ws-sheet');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    classe: el.className.slice(0, 60),
    x: Math.round(r.x), largura: Math.round(r.width), altura: Math.round(r.height),
    distanciaDireita: Math.round(window.innerWidth - r.right),
    alturaCheia: Math.abs(r.height - window.innerHeight) < 2,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    raio: cs.borderTopLeftRadius, sombra: cs.boxShadow.slice(0, 60),
  };
});
await shot('detalhe-1440');
await page.keyboard.press('Escape'); await wait(400);

// 390 · detalhe
await page.setViewportSize({ width: 390, height: 844 });
await wait(900);
await page.locator('button.ag-event').first().click();
await page.waitForSelector('.gd-detail__panel, .ws-sheet', { timeout: 8000 }).catch(() => {});
await wait(700);
M.detalhe390 = await page.evaluate(() => {
  const el = document.querySelector('.gd-detail__panel') || document.querySelector('.ws-sheet');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x), largura: Math.round(r.width), topo: Math.round(r.top),
    altura: Math.round(r.height), distanciaDireita: Math.round(window.innerWidth - r.right),
    flutua: Math.round(r.x) > 0 || Math.round(r.top) > 0,
  };
});
await shot('detalhe-390');
await page.keyboard.press('Escape'); await wait(400);

// ── 6 · MENU LATERAL (rótulos) ──────────────────────────────────────────
await page.setViewportSize({ width: 1440, height: 900 });
await wait(600);
M.menu = await page.evaluate(() => {
  const link = document.querySelector('.workspace-sidebar .workspace-link');
  const cs = link ? getComputedStyle(link) : null;
  return {
    rotulo: link ? (link.textContent || '').trim().slice(0, 24) : null,
    fonteDoDestino: cs ? cs.fontSize : null, linha: cs ? cs.lineHeight : null,
    larguraDoRail: Math.round(document.querySelector('.workspace-sidebar')?.getBoundingClientRect().width || 0),
    chevrons: document.querySelectorAll('.workspace-link__chevron').length,
  };
});
await shot('menu-1440');

// ── 7 · PERFIL DO PACIENTE (resumo à esquerda + conteúdo à direita) ─────
await page.goto(`${BASE}/clientes?b=${fixture.b}`);
await page.waitForSelector('button[title="Prévia rápida sem sair da lista"], button[aria-label^="Abrir perfil"]', { timeout: 20000 }).catch(() => {});
await wait(900);
const previa = page.locator('button[title="Prévia rápida sem sair da lista"]').first();
if (await previa.count()) { await previa.click().catch(() => {}); }
else { await page.locator('button[aria-label^="Abrir perfil"]').first().click().catch(() => {}); }
await page.waitForSelector('.gd-detail__panel, .ws-sheet', { timeout: 8000 }).catch(() => {});
await wait(800);
M.perfil = await page.evaluate(() => {
  const painel = document.querySelector('.gd-detail__panel') || document.querySelector('.ws-sheet');
  if (!painel) return null;
  const grade = painel.querySelector('.grid');
  const nome = painel.querySelector('h2');
  const bloco = painel.querySelector('.rounded-\\[var\\(--radius-md\\)\\]');
  return {
    temGrade: !!grade,
    colunas: grade ? getComputedStyle(grade).gridTemplateColumns : null,
    xResumo: nome ? Math.round(nome.getBoundingClientRect().x) : null,
    xConteudo: bloco ? Math.round(bloco.getBoundingClientRect().x) : null,
    resumoAEsquerda: nome && bloco ? nome.getBoundingClientRect().x < bloco.getBoundingClientRect().x : null,
  };
});
await shot('perfil-1440');
await page.keyboard.press('Escape'); await wait(400);

// ── 8 · DASHBOARD (Ações rápidas, card-em-card) ─────────────────────────
await page.goto(`${BASE}/dashboard?b=${fixture.b}`);
await page.waitForSelector('.dsh-quick, .dsh-card', { timeout: 20000 }).catch(() => {});
await wait(900);
M.dashboard = await page.evaluate(() => {
  const item = document.querySelector('.dsh-quick');
  if (!item) return null;
  const cs = getComputedStyle(item);
  return {
    itens: document.querySelectorAll('.dsh-quick').length,
    borda: cs.borderTopWidth, fundo: cs.backgroundColor,
    temAcoesRapidas: document.body.innerText.includes('Ações rápidas'),
  };
});
await shot('dashboard-1440');

await fs.writeFile(path.join(here, `${tag}-medicoes.json`), JSON.stringify(M, null, 2));
await browser.close();
console.log(`${tag}: ${JSON.stringify(M.ctxmenu)} · toolbar var ${M.toolbar?.equivalentesVariacao}`);
