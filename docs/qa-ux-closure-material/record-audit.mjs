// ═══════════════════════════════════════════════════════════════
// AUDITORIA · EVIDÊNCIA ANIMADA (PR #64) — 6 GIFs
// ═══════════════════════════════════════════════════════════════
// Cada GIF prova um GESTO (não um estado parado):
//   1. a-hover-resumo-detalhe.gif  — hover abre o resumo colado; clique abre o
//      painel preso à direita; Escape fecha e devolve o foco;
//   2. a-menu-contexto-status.gif  — botão direito abre o menu REAL, a seta
//      navega e a transição válida é aplicada (fixture QA; revertida no fim);
//   3. a-drag-esc.gif              — arraste desenha o intervalo e o ESC limpa
//      TUDO na hora; o botão Cancelar faz o mesmo pelo ponteiro;
//   4. a-resize.gif                — alça de duração: arraste, feedback e
//      gravação (fixture QA; revertida no fim);
//   5. a-sidebar-rail.gif          — rail: hover abre o painel do grupo, troca
//      de grupo sem fechar e retrai; o controle do rodapé expande/recolhe;
//   6. a-toolbar-views.gif         — toolbar unificada + Dia/Semana/Lista +
//      Filtros e o modal CENTRAL de criação.
//
// Uso: node docs/qa-ux-closure-material/record-audit.mjs
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
const frames = '/tmp/qa-audit-frames';
await fs.rm(frames, { recursive: true, force: true });
const ESCOPOS = ['hover', 'menu', 'drag', 'resize', 'rail', 'toolbar'];
for (const s of ESCOPOS) await fs.mkdir(path.join(frames, s), { recursive: true });

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

const agendaUrl = () => `${base}/agenda?b=${fixture.b}&data=${fixture.day}&view=day`;
const api = (method, url, body) => page.evaluate(async ([m, u, b]) => {
  const res = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  let data = null; try { data = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, data };
}, [method, url, body]);

let n = 0;
async function frame(scope, clip, ms = 90) {
  n += 1;
  await page.screenshot({ path: path.join(frames, scope, `${String(n).padStart(4, '0')}.png`), clip });
  await page.waitForTimeout(ms);
}
/** Ponto vago VISÍVEL da coluna (mesma régua do audit.mjs). */
const pontoVago = () => page.evaluate(() => {
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

// ── 1 · HOVER → RESUMO → DETALHE ────────────────────────────────
n = 0;
await page.goto(agendaUrl());
await page.waitForSelector('button.ag-event');
await page.waitForTimeout(1200);
const clipHover = { x: 520, y: 120, width: 920, height: 700 };
const evento = page.locator('button.ag-event').nth(2);
await evento.scrollIntoViewIfNeeded();
await page.mouse.move(300, 760);
for (let i = 0; i < 3; i += 1) await frame('hover', clipHover, 120);
await evento.hover();
for (let i = 0; i < 9; i += 1) await frame('hover', clipHover, 120);   // 180ms + cartão
await evento.click();
for (let i = 0; i < 9; i += 1) await frame('hover', clipHover, 130);
await page.keyboard.press('Escape');
for (let i = 0; i < 7; i += 1) await frame('hover', clipHover, 120);

// ── 2 · MENU DE CONTEXTO + TRANSIÇÃO ────────────────────────────
n = 0;
const lista = await api('GET', `/api/bookings?businessId=${fixture.b}&mode=manage&from=${fixture.day}&to=${fixture.day}&limit=200`);
const bookings = lista.data?.bookings || [];
const alvoPendente = bookings.find((b) => b.status === 'pending') || bookings[0];
const alvoConfirmado = bookings.find((b) => b.status === 'confirmed') || bookings[0];
const clipMenu = { x: 120, y: 200, width: 900, height: 640 };
if (alvoPendente) {
  const idx = await page.evaluate((nome) => [...document.querySelectorAll('button.ag-event')]
    .findIndex((b) => (b.getAttribute('aria-label') || '').includes(nome)), alvoPendente.petName || alvoPendente.customerName);
  const alvo = page.locator('button.ag-event').nth(idx >= 0 ? idx : 0);
  await alvo.scrollIntoViewIfNeeded();
  const c = await alvo.boundingBox();
  for (let i = 0; i < 3; i += 1) await frame('menu', clipMenu, 120);
  if (c) {
    await page.mouse.click(Math.round(c.x + c.width / 2), Math.round(c.y + c.height / 2), { button: 'right' });
    for (let i = 0; i < 7; i += 1) await frame('menu', clipMenu, 130);
    await page.screenshot({ path: path.join(outDir, 'a-menu-contexto-1440.png') });
    await page.keyboard.press('ArrowDown');
    for (let i = 0; i < 3; i += 1) await frame('menu', clipMenu, 130);
    await page.keyboard.press('Shift+F10');            // teclado reabre onde o foco está
    for (let i = 0; i < 4; i += 1) await frame('menu', clipMenu, 130);
    // Transição VÁLIDA (fixture QA): pendente → confirmado.
    await page.locator('[role="menu"].gd-menu--context [role="menuitem"]').filter({ hasText: 'Confirmado' }).first().click();
    for (let i = 0; i < 8; i += 1) await frame('menu', clipMenu, 140);
    await page.screenshot({ path: path.join(outDir, 'a-menu-transicao-1440.png') });
    await api('PATCH', '/api/bookings', { businessId: fixture.b, id: alvoPendente.id, status: alvoPendente.status });
    await page.reload(); await page.waitForSelector('button.ag-event'); await page.waitForTimeout(900);
  }
}

// ── 3 · DRAG → ESC → CANCELAR ───────────────────────────────────
n = 0;
await page.goto(agendaUrl());
await page.waitForSelector('[data-agenda-column]');
await page.waitForTimeout(1000);
const clipDrag = { x: 90, y: 250, width: 700, height: 620 };
const livre = await pontoVago();
if (livre) {
  for (let i = 0; i < 3; i += 1) await frame('drag', clipDrag, 120);
  await page.mouse.move(livre.x, livre.y);
  await page.mouse.down();
  await page.mouse.move(livre.x, livre.y + 46, { steps: 14 });
  for (let i = 0; i < 4; i += 1) await frame('drag', clipDrag, 110);
  await page.mouse.up();
  for (let i = 0; i < 5; i += 1) await frame('drag', clipDrag, 120);
  await page.screenshot({ path: path.join(outDir, 'a-drag-popover-1440.png') });
  await page.keyboard.press('Escape');
  await frame('drag', clipDrag, 40);
  for (let i = 0; i < 5; i += 1) await frame('drag', clipDrag, 130);
  await page.screenshot({ path: path.join(outDir, 'a-drag-esc-limpo-1440.png') });
  // Pelo ponteiro: gesto novo → botão Cancelar do popover.
  await page.mouse.move(livre.x, livre.y);
  await page.mouse.down();
  await page.mouse.move(livre.x, livre.y + 46, { steps: 12 });
  await page.mouse.up();
  for (let i = 0; i < 4; i += 1) await frame('drag', clipDrag, 130);
  await page.getByRole('button', { name: /Cancelar/i }).first().click().catch(() => {});
  for (let i = 0; i < 5; i += 1) await frame('drag', clipDrag, 130);
  await page.screenshot({ path: path.join(outDir, 'a-drag-cancelar-1440.png') });
}

// ── 4 · RESIZE (fixture QA, revertido) ──────────────────────────
n = 0;
await page.goto(agendaUrl());
await page.waitForSelector('button.ag-event');
await page.waitForTimeout(1000);
const clipResize = { x: 120, y: 140, width: 760, height: 700 };
if (alvoConfirmado) {
  const idxR = await page.evaluate((nome) => [...document.querySelectorAll('button.ag-event')]
    .findIndex((b) => (b.getAttribute('aria-label') || '').includes(nome)), alvoConfirmado.petName || alvoConfirmado.customerName);
  const evR = page.locator('button.ag-event').nth(idxR >= 0 ? idxR : 1);
  await evR.scrollIntoViewIfNeeded();
  const caixaR = await evR.boundingBox();
  for (let i = 0; i < 3; i += 1) await frame('resize', clipResize, 120);
  if (caixaR) {
    await evR.hover();
    for (let i = 0; i < 4; i += 1) await frame('resize', clipResize, 120);   // alça aparece
    const alca = evR.locator('span[aria-label^="Redimensionar"]').first();
    const cA = await alca.boundingBox().catch(() => null);
    if (cA) {
      const porMinuto = caixaR.height / Math.max(1, alvoConfirmado.durationMin || 30);
      const px = Math.max(24, Math.round(porMinuto * 15));
      await page.mouse.move(Math.round(cA.x + cA.width / 2), Math.round(cA.y + cA.height / 2));
      await page.mouse.down();
      await page.mouse.move(Math.round(cA.x + cA.width / 2), Math.round(cA.y + cA.height / 2 + px), { steps: 16 });
      for (let i = 0; i < 5; i += 1) await frame('resize', clipResize, 130);  // etiqueta +30min
      await page.mouse.up();
      for (let i = 0; i < 7; i += 1) await frame('resize', clipResize, 130);
      const depois = await api('GET', `/api/bookings?businessId=${fixture.b}&mode=manage&from=${fixture.day}&to=${fixture.day}&limit=200`);
      const linha = (depois.data?.bookings || []).find((b) => b.id === alvoConfirmado.id);
      await fs.writeFile(path.join(outDir, 'a-resize-medicao.json'), JSON.stringify({
        id: alvoConfirmado.id,
        minutosAntes: alvoConfirmado.durationMin, minutosDepois: linha?.durationMin,
        endAtAntes: alvoConfirmado.endAt, endAtDepois: linha?.endAt,
      }, null, 2));
      // Reversão: a rota de resize aceita SÓ `resizeEnd` (hora de fim no
      // relógio local) — qualquer outro campo faz a rota recusar com 400.
      const total = (() => {
        const [h, m] = String(alvoConfirmado.time || '').split(':').map(Number);
        if (Number.isNaN(h)) return null;
        const soma = h * 60 + m + (alvoConfirmado.durationMin || 30);
        return `${String(Math.floor(soma / 60) % 24).padStart(2, '0')}:${String(soma % 60).padStart(2, '0')}`;
      })();
      const volta = await api('PATCH', '/api/bookings', { businessId: fixture.b, id: alvoConfirmado.id, resizeEnd: total });
      if (volta.status !== 200) console.log('ATENÇÃO: reversão do resize falhou', volta.status, volta.data?.error);
      await page.reload(); await page.waitForSelector('button.ag-event'); await page.waitForTimeout(800);
    }
  }
}

// ── 5 · RAIL: hover → grupo → troca → retração → recolher/expandir ──
n = 0;
await page.goto(`${base}/dashboard?b=${fixture.b}`);
await page.waitForSelector('.workspace-sidebar');
await page.waitForTimeout(800);
const clipRail = { x: 0, y: 60, width: 660, height: 700 };
for (let i = 0; i < 4; i += 1) await frame('rail', clipRail, 110);
const grupos = page.locator('[data-peek-group]');
await grupos.nth(0).hover();
for (let i = 0; i < 7; i += 1) await frame('rail', clipRail, 110);
for (const g of [1, 2, 0]) {                        // troca SEM fechar
  await grupos.nth(g).hover();
  for (let i = 0; i < 4; i += 1) await frame('rail', clipRail, 110);
}
await page.mouse.move(1180, 500, { steps: 8 });      // sai: retrai
for (let i = 0; i < 6; i += 1) await frame('rail', clipRail, 110);
await page.locator('.workspace-foot__item--collapse').click();
for (let i = 0; i < 9; i += 1) await frame('rail', clipRail, 120);   // coluna aberta
await page.screenshot({ path: path.join(outDir, 'a-sidebar-aberta-1440.png') });
await page.locator('.workspace-foot__item--collapse').click();
for (let i = 0; i < 6; i += 1) await frame('rail', clipRail, 120);

// ── 6 · TOOLBAR + VIEWS + MODAL CENTRAL ─────────────────────────
n = 0;
await page.goto(agendaUrl());
await page.waitForSelector('.ag-page .gd-toolbar');
await page.waitForTimeout(1000);
const clipToolbar = { x: 60, y: 60, width: 1360, height: 470 };
for (let i = 0; i < 4; i += 1) await frame('toolbar', clipToolbar, 120);
await page.getByRole('button', { name: 'Próximo dia' }).first().click().catch(() => {});
for (let i = 0; i < 3; i += 1) await frame('toolbar', clipToolbar, 120);
await page.getByRole('button', { name: 'Hoje' }).first().click().catch(() => {});
for (let i = 0; i < 3; i += 1) await frame('toolbar', clipToolbar, 120);
for (const vista of ['Semana', 'Lista', 'Dia']) {
  await page.getByRole('button', { name: vista, exact: true }).first().click().catch(() => {});
  for (let i = 0; i < 4; i += 1) await frame('toolbar', { x: 60, y: 60, width: 1360, height: 620 }, 140);
}
await page.getByRole('button', { name: /Filtros/i }).first().click().catch(() => {});
for (let i = 0; i < 5; i += 1) await frame('toolbar', clipToolbar, 130);
await page.keyboard.press('Escape');
for (let i = 0; i < 3; i += 1) await frame('toolbar', clipToolbar, 130);
// Modal CENTRAL de criação (não é sheet lateral).
await page.getByRole('button', { name: /Novo agendamento/i }).first().click().catch(() => {});
for (let i = 0; i < 9; i += 1) await frame('toolbar', { x: 240, y: 40, width: 1000, height: 820 }, 140);
await page.screenshot({ path: path.join(outDir, 'a-modal-central-1440.png') });
await page.keyboard.press('Escape');
for (let i = 0; i < 4; i += 1) await frame('toolbar', { x: 240, y: 40, width: 1000, height: 820 }, 130);

// ── GIFs ────────────────────────────────────────────────────────
const FPS = 9;
const saidas = [
  ['hover', 'a-hover-resumo-detalhe.gif', '900x'],
  ['menu', 'a-menu-contexto-status.gif', '860x'],
  ['drag', 'a-drag-esc.gif', '760x'],
  ['resize', 'a-resize.gif', '760x'],
  ['rail', 'a-sidebar-rail.gif', '620x'],
  ['toolbar', 'a-toolbar-views.gif', '880x'],
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
    const palette = `/tmp/qa-audit-${scope}-palette.png`;
    const escala = resize.replace('x', ':-1');
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.png'),
      '-vf', `fps=${FPS},scale=${escala},palettegen=max_colors=128`, palette], { stdio: 'inherit' });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.png'), '-i', palette,
      '-lavfi', `fps=${FPS},scale=${escala}[x];[x][1:v]paletteuse=dither=bayer`, '-loop', '0', outFile], { stdio: 'inherit' });
  }
  const st = await fs.stat(outFile);
  console.log(`${out}: ${files.length} quadros · ${(st.size / 1024).toFixed(0)} kB`);
}
await browser.close();
console.log('Evidências animadas da auditoria em', outDir);
