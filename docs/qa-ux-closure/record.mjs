// ═══════════════════════════════════════════════════════════════
// QA UX CLOSURE — GRAVAÇÃO DE FLUXO (item 8 da missão)
// ═══════════════════════════════════════════════════════════════
// Grava dois fluxos curtos para a homologação, lado a lado com as capturas:
//   1. shell: rail → hover no grupo Clínica (abre conectado) → cursor dentro do
//      painel → troca para Automação e Gestão SEM fechar → sai e retrai;
//   2. agenda: hover no atendimento → resumo colado no evento → "Ver detalhes"
//      → painel lateral (Escape devolve o foco ao evento).
//
// Implementação: screenshot loop do Playwright → GIF (ImageMagick `convert`,
// com queda para `ffmpeg` quando ele existir). Nada de lib nova no projeto: a
// evidência é arquivo de docs.
//
// Uso:  node docs/qa-ux-closure/record.mjs [outDir]
// Requer o dev server local com a fixture de QA (scripts/qa-ux-closure-fixture.mjs).
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

/** Caminho de um binário no PATH (sem depender de shell). */
function which(bin) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const full = path.join(dir, bin);
    try { if (fsSync.statSync(full).isFile()) return full; } catch { /* segue */ }
  }
  return '';
}

const fixture = JSON.parse(await fs.readFile(process.env.QA_UX_FIXTURE || '/home/user/.cache/qa-ux/fixture.json', 'utf8'));
const outDir = process.argv[2] || 'docs/qa-ux-closure/after';
const frames = '/tmp/qa-ux-closure-frames';
const executablePath = process.env.QA_BROWSER || '/tmp/chromium';
const LD_LIBRARY_PATH = process.env.QA_BROWSER_LD || '/tmp/nssstub:/tmp/ch-al2023/lib';
await fs.rm(frames, { recursive: true, force: true });
await fs.mkdir(path.join(frames, 'shell'), { recursive: true });
await fs.mkdir(path.join(frames, 'agenda'), { recursive: true });

const browser = await chromium.launch({
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--no-zygote'],
  env: { ...process.env, LD_LIBRARY_PATH },
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${fixture.base}/login`);
await page.getByLabel('E-mail', { exact: true }).fill(fixture.owner.email);
await page.getByLabel('Senha', { exact: true }).fill(fixture.owner.password);
await page.getByRole('button', { name: 'Entrar', exact: true }).click();
await page.waitForURL(/dashboard/);

let n = 0;
async function frame(scope, ms = 90) {
  n += 1;
  // Só a área do shell/agenda interessa: recorta topbar + rail + grade.
  await page.screenshot({ path: path.join(frames, scope, `${String(n).padStart(4, '0')}.png`), clip: { x: 0, y: 0, width: 1440, height: 720 } });
  await page.waitForTimeout(ms);
}

// ── 1. Shell: rail → grupo → troca de grupo → retração ────────────
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${fixture.base}/dashboard?b=${fixture.b}`);
await page.waitForSelector('.workspace-sidebar');
await page.waitForTimeout(700);
for (let i = 0; i < 6; i += 1) await frame('shell', 60);

const groups = page.locator('[data-peek-group]');
const clinica = groups.first();
await clinica.hover();
await page.waitForTimeout(320);
const panel = page.locator('#ws-nav-panel');
await panel.waitFor();
const pb = await panel.boundingBox();
// Dentro do painel (conexão física: mesmo y do ícone, sem vão).
await page.mouse.move(pb.x + 30, pb.y + 30, { steps: 6 });
for (let i = 0; i < 5; i += 1) await frame('shell', 90);
// Troca de grupo sem fechar: Automação, Gestão e volta para Clínica.
for (const id of ['automacao', 'gestao', 'clinica']) {
  await groups.nth(id === 'automacao' ? 1 : id === 'gestao' ? 2 : 0).hover();
  await page.waitForTimeout(220);
  for (let i = 0; i < 4; i += 1) await frame('shell', 80);
}
// Sai do rail + painel: retrai com o atraso curto.
await page.mouse.move(1100, 420, { steps: 8 });
for (let i = 0; i < 6; i += 1) await frame('shell', 120);

// ── 2. Agenda: hover no evento → resumo → detalhe ─────────────────
await page.goto(`${fixture.base}/agenda?b=${fixture.b}&data=${fixture.day}&view=day`);
await page.waitForSelector('button.ag-event');
await page.waitForTimeout(900);
n = 0;
const event = page.locator('button.ag-event').nth(2);
await event.scrollIntoViewIfNeeded();
for (let i = 0; i < 4; i += 1) await frame('agenda', 60);
await event.hover();
await page.waitForFunction(() => !!document.querySelector('.gd-hovercard'), null, { timeout: 4000 }).catch(() => {});
for (let i = 0; i < 5; i += 1) await frame('agenda', 110);
const card = page.locator('.gd-hovercard').first();
await card.getByRole('button', { name: /Ver detalhes/i }).click();
await page.waitForSelector('.gd-detail__panel');
for (let i = 0; i < 6; i += 1) await frame('agenda', 130);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
for (let i = 0; i < 4; i += 1) await frame('agenda', 120);

// ── GIFs ─────────────────────────────────────────────────────────
// GIF animado é evidência de INTERAÇÃO (o que o PNG não mostra). 9 fps ≈ o
// ritmo real dos 140–220ms de transição do DS.
const FPS = 9;
await fs.mkdir(outDir, { recursive: true });
for (const [scope, out] of [['shell', 'shell-nav-hover-swap-retract.gif'], ['agenda', 'agenda-hover-summary-detail.gif']]) {
  const dir = path.join(frames, scope);
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.png')).sort();
  const outFile = path.join(outDir, out);
  const magick = which('convert') || which('magick');
  if (magick) {
    // -layers Optimize reduz sem perder o quadro; largura 960 mantém o GIF leve.
    execFileSync(magick, ['-delay', String(Math.round(100 / FPS)), '-loop', '0', ...files.map((f) => path.join(dir, f)),
      '-resize', '960x', '-layers', 'Optimize', outFile], { stdio: 'inherit' });
  } else {
    const palette = `/tmp/qa-ux-${scope}-palette.png`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.png'),
      '-vf', `fps=${FPS},scale=960:-1:flags=lanczos,palettegen=max_colors=128`, palette], { stdio: 'inherit' });
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%04d.png'), '-i', palette,
      '-lavfi', `fps=${FPS},scale=960:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer`, '-loop', '0', outFile], { stdio: 'inherit' });
  }
  const st = await fs.stat(outFile);
  console.log(`${out}: ${files.length} quadros · ${(st.size / 1024).toFixed(0)} kB`);
}
await browser.close();
console.log('Evidências animadas em', path.resolve(outDir));
