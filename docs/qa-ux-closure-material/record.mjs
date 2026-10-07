// ═══════════════════════════════════════════════════════════════
// DS 1.1 · EVIDÊNCIA ANIMADA (§18 da missão)
// ═══════════════════════════════════════════════════════════════
// Quatro GIFs, um por comportamento que NÃO se prova com PNG parado:
//
//   1. rail-hover-swap-retract.gif   — rail: hover abre o painel conectado,
//      troca de grupo sem fechar, cursor dentro do painel permanece, saída
//      retrai com atraso curto. SEM chevron em nenhum quadro;
//   2. appointment-hover-vs-click.gif — hover no evento abre PRÉVIA (e NÃO o
//      detalhe); clique abre DIRETO o DetailSideModal; Escape fecha e devolve
//      o foco ao evento;
//   3. floating-label.gif            — campo canônico: vazio (rótulo dentro) →
//      foco (rótulo sobe e notcha) → preenchido (rótulo permanece acima) →
//      erro (contorno + texto);
//   4. icon-button-idle-hover.gif    — ação de ícone em repouso (sem caixa,
//      sem borda) e com hover/foco (fundo suave) — o lápis do pet.
//
// Implementação: captura de quadros no Playwright → GIF pelo ImageMagick
// (`convert`, disponível no ambiente) com queda para `ffmpeg`. Nada de
// dependência nova no projeto: é arquivo de documentação.
//
// Uso: node docs/qa-ux-closure-material/record.mjs
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
const frames = '/tmp/qa-material-frames';
await fs.rm(frames, { recursive: true, force: true });
for (const scope of ['rail', 'hover', 'campo', 'icone']) await fs.mkdir(path.join(frames, scope), { recursive: true });

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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${base}/login`);
await page.getByLabel('E-mail', { exact: true }).fill(fixture.owner.email);
await page.getByLabel('Senha', { exact: true }).fill(fixture.owner.password);
await page.getByRole('button', { name: 'Entrar', exact: true }).click();
await page.waitForURL(/dashboard/);
await page.waitForSelector('.workspace-sidebar');

let n = 0;
/** Um quadro do recorte pedido (região que importa, não a tela inteira). */
async function frame(scope, clip, ms = 90) {
  n += 1;
  await page.screenshot({ path: path.join(frames, scope, `${String(n).padStart(4, '0')}.png`), clip });
  await page.waitForTimeout(ms);
}

// ── 1 · RAIL: hover → swap → retract ────────────────────────────
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${base}/dashboard?b=${fixture.b}`);
await page.waitForSelector('.workspace-sidebar');
await page.waitForTimeout(700);
const clipRail = { x: 0, y: 0, width: 620, height: 620 };
for (let i = 0; i < 5; i += 1) await frame('rail', clipRail, 70);
const grupos = page.locator('[data-peek-group]');
await grupos.nth(0).hover();
for (let i = 0; i < 6; i += 1) await frame('rail', clipRail, 80);
const painel = page.locator('#ws-nav-panel');
await painel.waitFor();
const pb = await painel.boundingBox();
await page.mouse.move(pb.x + 30, pb.y + 30, { steps: 6 });
for (let i = 0; i < 4; i += 1) await frame('rail', clipRail, 90);
for (const idx of [1, 2, 0]) {                       // swap SEM fechar
  await grupos.nth(idx).hover();
  for (let i = 0; i < 4; i += 1) await frame('rail', clipRail, 80);
}
await page.mouse.move(1150, 430, { steps: 8 });      // sai: retrai
for (let i = 0; i < 6; i += 1) await frame('rail', clipRail, 110);

// ── 2 · EVENTO: hover (prévia) × clique (detalhe) ───────────────
n = 0;
await page.goto(`${base}/agenda?b=${fixture.b}&data=${fixture.day}&view=day`);
await page.waitForSelector('button.ag-event');
await page.waitForTimeout(900);
const clipAgenda = { x: 0, y: 60, width: 1200, height: 760 };
const evento = page.locator('button.ag-event').nth(2);
await evento.scrollIntoViewIfNeeded();
for (let i = 0; i < 4; i += 1) await frame('hover', clipAgenda, 90);
await evento.hover();
for (let i = 0; i < 8; i += 1) await frame('hover', clipAgenda, 110);   // prévia abre (sem detalhe)
await page.mouse.move(1120, 420, { steps: 8 });
for (let i = 0; i < 3; i += 1) await frame('hover', clipAgenda, 90);
await evento.click();                                                    // clique → detalhe DIRETO
for (let i = 0; i < 8; i += 1) await frame('hover', clipAgenda, 120);
await page.keyboard.press('Escape');
for (let i = 0; i < 5; i += 1) await frame('hover', clipAgenda, 110);

// ── 3 · CAMPO: vazio → foco → preenchido → erro ─────────────────
n = 0;
await page.goto(`${base}/agenda?b=${fixture.b}&data=${fixture.day}&view=day`);
await page.waitForSelector('[data-agenda-main]');
await page.waitForTimeout(600);
await page.getByRole('button', { name: 'Novo agendamento' }).first().click();
const drawer = page.locator('.il-drawer--dialog, .gd-dialog').first();
await drawer.waitFor();
await page.waitForTimeout(500);
const clipForm = { x: 380, y: 120, width: 700, height: 640 };
for (let i = 0; i < 4; i += 1) await frame('campo', clipForm, 90);
const fecharCampo = drawer.locator('.ws-sheet__close').first();
await drawer.locator('.gd-disclosure__trigger').first().click().catch(() => {});
await page.waitForTimeout(300);
const campoObservacao = drawer.locator('.gd-field').filter({ hasText: 'Observação' }).first();
const alvo = campoObservacao.locator('input').first();
await alvo.focus();
for (let i = 0; i < 5; i += 1) await frame('campo', clipForm, 110);      // rótulo sobe
await alvo.type('Paciente com sensibilidade', { delay: 45 });
for (let i = 0; i < 5; i += 1) await frame('campo', clipForm, 90);
await alvo.fill('');
await page.waitForTimeout(200);
const salvar = drawer.getByRole('button', { name: /Salvar agendamento/i }).first();
await salvar.click().catch(() => {});
for (let i = 0; i < 6; i += 1) await frame('campo', clipForm, 120);      // erro real do fluxo
void fecharCampo;

// ── 4 · AÇÃO DE ÍCONE: repouso × hover × foco (barra da Agenda) ──
// A ação de ícone do DS vive na toolbar da Agenda ("Dia anterior" /
// "Próximo dia" / legenda). O contrato do §7 é: em REPOUSO não existe caixa
// (nem borda visível), e no hover/foco entra um fundo suave — sem virar botão
// outlined. O GIF mostra os três estados no MESMO recorte.
n = 0;
await page.goto(`${base}/agenda?b=${fixture.b}&data=${fixture.day}&view=day`);
await page.waitForSelector('.ag-grid-surface, .gd-icon-control', { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1200);
const iconeAlvo = page.locator('button.gd-icon-control[aria-label="Próximo dia"], button.gd-icon-control[aria-label="Dia anterior"]').first();
if (await iconeAlvo.count()) {
  await iconeAlvo.scrollIntoViewIfNeeded();
  const lb = await iconeAlvo.boundingBox();
  // Recorte colado no ícone: repouso → hover → saída → foco (teclado) → repouso.
  const clipIcone = {
    x: Math.max(0, Math.round(lb.x) - 150), y: Math.max(0, Math.round(lb.y) - 40),
    width: 320, height: 110,
  };
  await page.mouse.move(10, 10);
  for (let i = 0; i < 4; i += 1) await frame('icone', clipIcone, 120);
  await iconeAlvo.hover();
  for (let i = 0; i < 5; i += 1) await frame('icone', clipIcone, 120);
  await page.mouse.move(10, Math.max(10, clipIcone.y - 20), { steps: 5 });
  for (let i = 0; i < 3; i += 1) await frame('icone', clipIcone, 120);
  await iconeAlvo.focus();
  for (let i = 0; i < 5; i += 1) await frame('icone', clipIcone, 120);
  await page.keyboard.press('Tab');
  for (let i = 0; i < 3; i += 1) await frame('icone', clipIcone, 120);
} else {
  // Sem a ação de ícone na toolbar (produto mudou): registra o motivo no diretório.
  await fs.writeFile(path.join(frames, 'icone', 'MOTIVO.txt'),
    'Nenhuma ação de ícone (.gd-icon-control) visível na toolbar da Agenda; ver measurements.json (icone-*).');
}

// ── GIFs ────────────────────────────────────────────────────────
const FPS = 9;
await fs.mkdir(outDir, { recursive: true });
const saidas = [
  ['rail', 'rail-hover-swap-retract.gif'],
  ['hover', 'appointment-hover-vs-click.gif'],
  ['campo', 'floating-label.gif'],
  ['icone', 'icon-button-idle-hover.gif'],
];
for (const [scope, out] of saidas) {
  const dir = path.join(frames, scope);
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.png')).sort();
  if (!files.length) { console.log(`${out}: SEM QUADROS`); continue; }
  const outFile = path.join(outDir, out);
  const magick = which('convert') || which('magick');
  if (magick) {
    execFileSync(magick, ['-delay', String(Math.round(100 / FPS)), '-loop', '0',
      ...files.map((f) => path.join(dir, f)), '-layers', 'Optimize', outFile], { stdio: 'inherit' });
  } else {
    const palette = `/tmp/qa-material-${scope}-palette.png`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.png'),
      '-vf', `fps=${FPS},palettegen=max_colors=128`, palette], { stdio: 'inherit' });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.png'), '-i', palette,
      '-lavfi', 'fps=9[x];[x][1:v]paletteuse=dither=bayer', '-loop', '0', outFile], { stdio: 'inherit' });
  }
  const st = await fs.stat(outFile);
  console.log(`${out}: ${files.length} quadros · ${(st.size / 1024).toFixed(0)} kB`);
}
await browser.close();
console.log('Evidências animadas em', outDir);
