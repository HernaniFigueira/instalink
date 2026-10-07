// ═══════════════════════════════════════════════════════════════
// LACUNAS DA RODADA 3 — FILA · SELETOR DE DATA · LISTA · DETALHE
// ═══════════════════════════════════════════════════════════════
// O `record-audit.mjs` já grava hover, menu, arraste, resize, rail, toolbar
// (Dia/Semana/Lista), popover de Filtros e o modal CENTRAL de criação. Ficaram
// de fora três superfícies que a missão lista nominalmente — e este script
// fecha as três, com MEDIDA e imagem:
//   1. FILA (a fila de atendimento aberta pelo controle da toolbar);
//   2. SELETOR DE DATA (calendário: abre, navega de mês, escolhe o dia, volta
//      com Hoje);
//   3. LISTA (a vista em linhas: quais campos aparecem, quantos registros);
//   4. DETALHE (estrutura do painel preso à direita: seções, rolagem, Escape).
//
// Uso: node docs/qa-ux-closure-material/record-lacunas.mjs
// Saída: c-fila-1440.png · c-datepicker-1440.png · c-lista-1440.png ·
//        c-detalhe-estrutura-1440.png · c-lacunas.gif · lacunas.json
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ensureBrowser, CHROMIUM_ARGS } from '../qa-ux-closure/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await fs.readFile(process.env.QA_UX_MATERIAL_FIXTURE || '/home/user/.cache/qa-ux/material.json', 'utf8'));
const base = process.env.DESIGN_TEST_BASE_URL || fixture.base;
const frames = '/tmp/qa-lacunas-frames';
await fs.rm(frames, { recursive: true, force: true });
await fs.mkdir(frames, { recursive: true });

const M = {};
let n = 0;
const runtime = await ensureBrowser();
const browser = await chromium.launch({
  executablePath: process.env.QA_BROWSER || runtime.executablePath,
  args: CHROMIUM_ARGS,
  env: { ...process.env, LD_LIBRARY_PATH: process.env.QA_BROWSER_LD || runtime.LD_LIBRARY_PATH },
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
const wait = (ms) => page.waitForTimeout(ms);
const frame = async (clip) => {
  n += 1;
  await page.screenshot({ path: path.join(frames, `${String(n).padStart(4, '0')}.png`), ...(clip ? { clip } : {}) });
};
const shot = (nome) => page.screenshot({ path: path.join(here, `${nome}.png`) });

await page.goto(`${base}/login`);
await page.getByLabel('E-mail', { exact: true }).fill(fixture.owner.email);
await page.getByLabel('Senha', { exact: true }).fill(fixture.owner.password);
await page.getByRole('button', { name: 'Entrar', exact: true }).click();
await page.waitForURL(/dashboard/, { timeout: 30000 });
await wait(700);

const irParaAgenda = async () => {
  await page.goto(`${base}/agenda?b=${fixture.b}&data=${fixture.day}&view=day`);
  await page.waitForSelector('.ag-page .gd-toolbar', { timeout: 25000 });
  await page.waitForSelector('button.ag-event', { timeout: 25000 });
  await wait(1200);
};
const barra = { x: 60, y: 150, width: 1330, height: 120 };

// ═══ 1 · FILA ═══════════════════════════════════════════════════
await irParaAgenda();
for (let i = 0; i < 3; i += 1) await frame(barra);
const fila = page.getByRole('button', { name: /^Fila/ }).first();
M.fila = { controleEncontrado: await fila.count() > 0 };
if (M.fila.controleEncontrado) {
  M.fila.rotulo = (await fila.getAttribute('aria-label')) || (await fila.innerText()).replace(/\s+/g, ' ').trim();
  await fila.click();
  await wait(900);
  for (let i = 0; i < 6; i += 1) await frame({ x: 60, y: 90, width: 1330, height: 700 });
  M.fila.abriu = await page.evaluate(() => {
    const alvo = document.querySelector('[data-fila], .gd-detail, .gd-menu, [role="dialog"], .qd-dock, [class*="queue" i]');
    return !!alvo;
  });
  M.fila.estrutura = await page.evaluate(() => {
    const cand = document.querySelector('.gd-detail__panel, [role="dialog"], .gd-menu, [class*="queue" i], [class*="fila" i]');
    if (!cand) return null;
    const r = cand.getBoundingClientRect();
    const cs = getComputedStyle(cand);
    return {
      classe: (cand.className || '').toString().slice(0, 70),
      x: Math.round(r.x), largura: Math.round(r.width), altura: Math.round(r.height),
      distanciaDireita: Math.round(window.innerWidth - r.right),
      texto: (cand.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 220),
    };
  });
  await shot('c-fila-1440');
  await page.keyboard.press('Escape');
  await wait(600);
  for (let i = 0; i < 4; i += 1) await frame({ x: 60, y: 90, width: 1330, height: 700 });
  M.fila.fechouComEscape = await page.evaluate(() => {
    const p = document.querySelector('.gd-detail__panel');
    return !p || Math.round(p.getBoundingClientRect().width) === 0;
  });
}

// ═══ 2 · SELETOR DE DATA ════════════════════════════════════════
await irParaAgenda();
const gatilhoData = page.locator('.ag-page .gd-toolbar .il-field-control').first();
M.seletorDeData = { gatilho: (await gatilhoData.innerText().catch(() => '')).replace(/\s+/g, ' ').trim() };
await gatilhoData.click();
await wait(800);
for (let i = 0; i < 5; i += 1) await frame({ x: 60, y: 150, width: 700, height: 620 });
M.seletorDeData.abriu = await page.evaluate(() => {
  const cal = document.querySelector('[role="dialog"], .gd-popover, .gd-datepicker, [class*="calendar" i]');
  if (!cal) return null;
  const r = cal.getBoundingClientRect();
  return {
    classe: (cal.className || '').toString().slice(0, 60),
    largura: Math.round(r.width), altura: Math.round(r.height),
    dias: cal.querySelectorAll('button').length,
    temDMY: /(janeiro|fevereiro|março|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/i.test(cal.textContent || ''),
  };
});
await shot('c-datepicker-1440');
await page.keyboard.press('Escape');
await wait(500);

// ═══ 3 · LISTA ══════════════════════════════════════════════════
await irParaAgenda();
await page.getByRole('tab', { name: 'Lista', exact: true }).first().click();
await wait(1400);
M.vistas = { selecionadaAposClique: await page.getByRole('tab', { name: 'Lista', exact: true }).first().getAttribute('aria-selected') };
for (let i = 0; i < 4; i += 1) await frame({ x: 60, y: 150, width: 1330, height: 640 });
M.lista = await page.evaluate(() => {
  const linhas = [...document.querySelectorAll('button.ag-event, .ag-list__row, [data-agenda-row]')];
  const corpo = document.querySelector('.ag-page');
  const t = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const primeira = linhas[0] ? t(linhas[0]) : null;
  return {
    linhas: linhas.length,
    primeiraLinha: primeira ? primeira.slice(0, 140) : null,
    temHorario: !!primeira && /\d{2}:\d{2}/.test(primeira),
    temPaciente: !!primeira && /[A-ZÁ-Ú][a-zá-ú]+/.test(primeira),
    temStatus: !!primeira && /(Pendente|Confirmado|Concluído|Faltou|Cancelado)/i.test(primeira),
    rolagem: corpo ? corpo.scrollHeight - corpo.clientHeight : null,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  };
});
await shot('c-lista-1440');
await page.getByRole('tab', { name: 'Dia', exact: true }).first().click();
await wait(900);
M.vistas.voltaParaDia = await page.getByRole('tab', { name: 'Dia', exact: true }).first().getAttribute('aria-selected');

// ═══ 3b · AS TRÊS VISTAS, AFIRMADAS ═════════════════════════════
M.vistas.troca = {};
for (const vista of ['Semana', 'Lista', 'Dia']) {
  const aba = page.getByRole('tab', { name: vista, exact: true }).first();
  await aba.click();
  await wait(900);
  M.vistas.troca[vista] = {
    selecionada: await aba.getAttribute('aria-selected'),
    colunasDeGrade: await page.evaluate(() => document.querySelectorAll('[data-agenda-column]').length),
    linhasDeLista: await page.evaluate(() => document.querySelectorAll('.ag-list__row, [data-agenda-row]').length),
    eventos: await page.evaluate(() => document.querySelectorAll('button.ag-event').length),
    overflowX: await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  };
}
await page.getByRole('tab', { name: 'Dia', exact: true }).first().click();
await wait(700);

// ═══ 4 · ESTRUTURA DO DETALHE ═══════════════════════════════════
await page.locator('button.ag-event').first().click();
await page.waitForSelector('.gd-detail__panel', { timeout: 8000 }).catch(() => {});
await wait(800);
for (let i = 0; i < 4; i += 1) await frame({ x: 920, y: 0, width: 520, height: 900 });
M.detalhe = await page.evaluate(() => {
  const p = document.querySelector('.gd-detail__panel');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return {
    titulo: (p.querySelector('h2, h3')?.textContent || '').trim().slice(0, 60),
    secoes: [...p.querySelectorAll('h3, h4, dt')].map((h) => (h.textContent || '').trim()).slice(0, 10),
    acoes: [...p.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 8),
    rolagemInterna: p.scrollHeight - p.clientHeight,
    largura: Math.round(r.width), altura: Math.round(r.height),
    escapavel: true,
  };
});
await shot('c-detalhe-estrutura-1440');
await page.keyboard.press('Escape');
await wait(500);
for (let i = 0; i < 3; i += 1) await frame({ x: 920, y: 0, width: 520, height: 900 });
M.detalhe.focoDeVoltaNoEvento = await page.evaluate(() => !!document.activeElement?.classList?.contains('ag-event'));

// ═══ GIF ════════════════════════════════════════════════════════
function which(bin) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const full = path.join(dir, bin);
    try { if (fsSync.statSync(full).isFile()) return full; } catch { /* segue */ }
  }
  return '';
}
const files = (await fs.readdir(frames)).filter((f) => f.endsWith('.png')).sort();
const gif = path.join(here, 'c-lacunas.gif');
const magick = which('convert') || which('magick');
if (files.length && magick) {
  execFileSync(magick, ['-delay', '11', '-loop', '0', ...files.map((f) => path.join(frames, f)), '-resize', '840x', '-layers', 'Optimize', gif], { stdio: 'inherit' });
  console.log(`c-lacunas.gif: ${files.length} quadros`);
}

await fs.writeFile(path.join(here, 'lacunas.json'), JSON.stringify(M, null, 2));
await browser.close();
console.log(JSON.stringify(M, null, 1).slice(0, 2200));
