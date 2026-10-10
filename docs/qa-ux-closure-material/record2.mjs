// ═══════════════════════════════════════════════════════════════
// RODADA 2 · EVIDÊNCIA ANIMADA (PR #64, mesma branch)
// ═══════════════════════════════════════════════════════════════
// Três gestos que NÃO se provam com PNG parado — o que importa é a TRANSIÇÃO:
//
//   1. r2-drag-create-esc.gif   — arraste em horário vago desenha o intervalo,
//      ESC limpa a seleção NA HORA (a faixa sai da grade; sobra o popover que
//      já era o fluxo de criação, e o clique em "Cancelar" fecha);
//   2. r2-hover-vs-click.gif    — hover = resumo compacto colado no evento (sem
//      painel lateral); clique = modal preso à direita, altura cheia; ESC fecha
//      e devolve o foco ao evento;
//   3. r2-menu-collapse.gif     — o controle do rodapé expande a navegação
//      (títulos de grupo + destinos no fluxo, sem painel flutuante) e recolhe
//      de volta ao rail; a preferência sobrevive ao reload (provado no PNG).
//
// Uso: node docs/qa-ux-closure-material/record2.mjs
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ensureBrowser, CHROMIUM_ARGS } from '../qa-ux-closure/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = here;
const fixture = JSON.parse(await fs.readFile(process.env.QA_UX_MATERIAL_FIXTURE || '/home/user/.cache/qa-ux/material.json', 'utf8'));
const base = process.env.DESIGN_TEST_BASE_URL || fixture.base;
const frames = '/tmp/qa-r2-frames';
await fs.rm(frames, { recursive: true, force: true });
for (const scope of ['drag', 'hover', 'menu']) await fs.mkdir(path.join(frames, scope), { recursive: true });

function which(bin) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const full = path.join(dir, bin);
    try { if (fsSync.statSync(full).isFile()) return full; } catch { /* segue */ }
  }
  return '';
}

const runtime = await ensureBrowser();
const browser = await chromium.launch({
  executablePath: process.env.QA_BROWSER || runtime.executablePath,
  args: CHROMIUM_ARGS,
  env: { ...process.env, LD_LIBRARY_PATH: process.env.QA_BROWSER_LD || runtime.LD_LIBRARY_PATH },
});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage();
await page.goto(`${base}/login`);
await page.getByLabel('E-mail', { exact: true }).fill(fixture.owner.email);
await page.getByLabel('Senha', { exact: true }).fill(fixture.owner.password);
await page.getByRole('button', { name: 'Entrar', exact: true }).click();
await page.waitForURL(/dashboard/, { timeout: 25000 });
await page.waitForSelector('.workspace-sidebar');
await page.waitForTimeout(600);

let n = 0;
async function frame(scope, clip, ms = 90) {
  n += 1;
  await page.screenshot({ path: path.join(frames, scope, `${String(n).padStart(4, '0')}.png`), clip });
  await page.waitForTimeout(ms);
}
const agendaUrl = () => `${base}/agenda?b=${fixture.b}&data=${fixture.day}&view=day`;

// ── 1 · DRAG-CREATE → ESC (a seleção SAI da grade) ──────────────
n = 0;
await page.goto(agendaUrl());
await page.waitForSelector('[data-agenda-column]');
await page.waitForTimeout(1200);
const start = await page.evaluate(() => {
  const col = document.querySelector('[data-agenda-column]');
  if (!col) return null;
  const r = col.getBoundingClientRect();
  const x = Math.round(r.x + r.width / 2);
  const topo = Math.max(r.top + 60, 120);
  const baseY = Math.min(r.bottom - 80, window.innerHeight - 160);
  for (let y = baseY; y > topo; y -= 10) {
    const el = document.elementFromPoint(x, y);
    if (!el || !el.closest('[data-agenda-column]')) continue;
    if (el.closest('button')) continue;
    return { x, y: Math.round(y) };
  }
  return null;
});
const clipDrag = { x: 90, y: 250, width: 700, height: 620 };
if (!start) {
  await fs.writeFile(path.join(frames, 'drag', 'MOTIVO.txt'), 'Nenhum horário vago visível para o gesto.');
} else {
  for (let i = 0; i < 3; i += 1) await frame('drag', clipDrag, 120);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y + 46, { steps: 14 });
  for (let i = 0; i < 4; i += 1) await frame('drag', clipDrag, 110);   // faixa desenhada
  await page.mouse.up();
  for (let i = 0; i < 5; i += 1) await frame('drag', clipDrag, 120);   // popover ancorado
  await page.keyboard.press('Escape');
  // Sem `delay`: os três primeiros quadros mostram a faixa SUMINDO na hora.
  await frame('drag', clipDrag, 40);
  for (let i = 0; i < 5; i += 1) await frame('drag', clipDrag, 130);
}

// ── 2 · HOVER × CLIQUE (resumo colado → modal preso à direita) ──
n = 0;
await page.goto(agendaUrl());
await page.waitForSelector('button.ag-event');
await page.waitForTimeout(1200);
const clipHover = { x: 560, y: 120, width: 880, height: 700 };
const evento = page.locator('button.ag-event').nth(2);
await evento.scrollIntoViewIfNeeded();
await page.mouse.move(300, 700);
for (let i = 0; i < 3; i += 1) await frame('hover', clipHover, 120);
await evento.hover();
for (let i = 0; i < 9; i += 1) await frame('hover', clipHover, 120);   // resumo abre COLADO
await evento.click();
for (let i = 0; i < 9; i += 1) await frame('hover', clipHover, 130);   // modal entra da borda
await page.keyboard.press('Escape');
for (let i = 0; i < 7; i += 1) await frame('hover', clipHover, 120);   // fecha e volta o foco

// ── 3 · MENU: recolher → expandir → recolher ────────────────────
n = 0;
await page.goto(`${base}/dashboard?b=${fixture.b}`);
await page.waitForSelector('.workspace-foot__item--collapse');
await page.waitForTimeout(900);
const clipMenu = { x: 0, y: 60, width: 470, height: 840 };
for (let i = 0; i < 4; i += 1) await frame('menu', clipMenu, 130);
await page.locator('.workspace-foot__item--collapse').click();
for (let i = 0; i < 10; i += 1) await frame('menu', clipMenu, 130);    // abre com grupos no fluxo
await page.locator('.workspace-foot__item--collapse').click();
for (let i = 0; i < 8; i += 1) await frame('menu', clipMenu, 130);     // volta ao rail

// ── GIFs ────────────────────────────────────────────────────────
const FPS = 9;
const saidas = [
  ['drag', 'r2-drag-create-esc.gif', '900x'],
  ['hover', 'r2-hover-vs-click.gif', '900x'],
  ['menu', 'r2-menu-collapse.gif', '460x'],
];
for (const [scope, out, resize] of saidas) {
  const dir = path.join(frames, scope);
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.png')).sort();
  if (!files.length) { console.log(`${out}: SEM QUADROS`); continue; }
  const outFile = path.join(outDir, out);
  const magick = which('convert') || which('magick');
  if (magick) {
    execFileSync(magick, ['-delay', String(Math.round(100 / FPS)), '-loop', '0',
      ...files.map((f) => path.join(dir, f)), '-resize', resize, '-layers', 'Optimize', outFile], { stdio: 'inherit' });
  } else {
    const palette = `/tmp/qa-r2-${scope}-palette.png`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.png'),
      '-vf', `fps=${FPS},scale=${resize.replace('x', ':-1')},palettegen=max_colors=128`, palette], { stdio: 'inherit' });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.png'), '-i', palette,
      '-lavfi', `fps=${FPS},scale=${resize.replace('x', ':-1')}[x];[x][1:v]paletteuse=dither=bayer`, '-loop', '0', outFile], { stdio: 'inherit' });
  }
  const st = await fs.stat(outFile);
  console.log(`${out}: ${files.length} quadros · ${(st.size / 1024).toFixed(0)} kB`);
}
await browser.close();
console.log('Evidências animadas da rodada 2 em', outDir);
