// ═══════════════════════════════════════════════════════════════
// AGENDA — SCROLL ÚNICO + PROVA DE VIEWPORT (Chromium real)
// ═══════════════════════════════════════════════════════════════
// Harness objetivo, em navegador real, contra o servidor LOCAL isolado
// (fixture sintética de setup.mjs — zero escrita em banco remoto):
//
//   Para cada viewport 1440×900 · 1366×768 · 1280×720 · 1920×1080
//   e cada modo Dia/Semana (e Mês/Listagem):
//     • coleta window.innerHeight, documentElement.scrollHeight,
//       body.scrollHeight, alturas do shell/main/página da Agenda/grade e
//       grid.scrollHeight × grid.clientHeight;
//     • CRITÉRIO: scrollHeight do documento <= clientHeight + tolerância
//       (ZERO scroll vertical do document provocado pela Agenda);
//     • o grid POSSUI scroll interno quando as horas excedem a área;
//     • cabeçalho e toolbar NÃO rolam junto com o grid;
//     • modos continuam clicáveis e o CTA “Novo agendamento” visível.
//
// Também captura as evidências visuais A–H do relatório.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const f = JSON.parse(
  fs.readFileSync(process.env.DESIGN_TEST_FIXTURE || path.join(os.homedir(), '.cache/agenda-viewport/fixture.json'), 'utf8'),
);

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill(f.owner.email);
  await page.getByLabel('Senha', { exact: true }).fill(f.owner.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL(/dashboard/);
}

interface Metrics {
  label: string;
  innerHeight: number;
  docScrollH: number;
  docClientH: number;
  bodyScrollH: number;
  shellH: number | null;
  mainH: number | null;
  agendaPageH: number | null;
  gridH: number | null;
  gridScrollH: number | null;
  gridClientH: number | null;
}

async function metrics(page: Page, label: string): Promise<Metrics> {
  return page.evaluate((lbl) => {
    const doc = document.documentElement;
    const shell = document.querySelector('.workspace-shell');
    const main = document.querySelector('#workspace-content');
    const agenda = document.querySelector('[data-agenda-page="true"]');
    const grid = document.querySelector('[data-agenda-main] .ws-scroll');
    const rect = (el: Element | null) => (el ? Math.round(el.getBoundingClientRect().height) : null);
    return {
      label: lbl,
      innerHeight: window.innerHeight,
      docScrollH: doc.scrollHeight,
      docClientH: doc.clientHeight,
      bodyScrollH: document.body.scrollHeight,
      shellH: rect(shell),
      mainH: rect(main),
      agendaPageH: rect(agenda),
      gridH: rect(grid),
      gridScrollH: grid ? grid.scrollHeight : null,
      gridClientH: grid ? grid.clientHeight : null,
    };
  }, label);
}

/** Registra a medição no log do harness (evidência mensurável do relatório). */
function record(m: Metrics) {
  console.log(`[agenda-viewport] ${JSON.stringify(m)}`);
}

const TOLERANCE = 2; // px técnicos de borda/rounding — nunca scrollbar real.

for (const [w, h] of [[1440, 900], [1366, 768], [1280, 720], [1920, 1080]] as const) {
  for (const view of ['day', 'week'] as const) {
    test(`scroll único · ${w}x${h} · ${view}`, async ({ page }, info) => {
      await login(page);
      await page.setViewportSize({ width: w, height: h });
      await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=${view}`);
      await page.waitForSelector('[data-agenda-main]');
      await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Novo agendamento' })).toBeVisible();
      // Espera o estado carregado (o scroller da grade só existe depois dele).
      await page.waitForSelector('[data-agenda-main] .ws-scroll', { timeout: 20000 });
      await expect(page.getByText('08:00').first()).toBeVisible();

      const m = await metrics(page, `${w}x${h} ${view}`);
      record(m);

      // ZERO scroll vertical do document provocado pela Agenda.
      expect(m.docScrollH - m.docClientH).toBeLessThanOrEqual(TOLERANCE);
      expect(m.bodyScrollH - m.docClientH).toBeLessThanOrEqual(TOLERANCE);
      // O grid ocupa o viewport (altura real > 2/3 da janela = protagonista).
      expect(m.gridH ?? 0).toBeGreaterThan((h - 260));
      // O grid POSSUI scroll interno (as horas 08–18 excedem a área).
      expect(m.gridScrollH ?? 0).toBeGreaterThan(m.gridClientH ?? 0);
      // A página da Agenda não cresce além do shell.
      expect(m.agendaPageH ?? 0).toBeLessThanOrEqual((m.shellH ?? 0) + TOLERANCE);

      // Cabeçalho e toolbar NÃO rolam junto com o grid.
      const headerTop = await page.getByRole('heading', { level: 1, name: 'Agenda' }).evaluate((el) => el.getBoundingClientRect().top);
      const toolbar = page.locator('[data-agenda-main] .ws-panel');
      const toolbarTop = await toolbar.evaluate((el) => el.getBoundingClientRect().top);
      await page.locator('[data-agenda-main] .ws-scroll').evaluate((el) => el.scrollTo(0, 600));
      await page.waitForTimeout(150);
      expect(Math.abs((await page.getByRole('heading', { level: 1, name: 'Agenda' }).evaluate((el) => el.getBoundingClientRect().top)) - headerTop)).toBeLessThanOrEqual(1);
      expect(Math.abs((await toolbar.evaluate((el) => el.getBoundingClientRect().top)) - toolbarTop)).toBeLessThanOrEqual(1);
      // A coluna de horários acompanha o scroll (gutter sticky permanece visível).
      await expect(page.locator('[data-agenda-main] .sticky').first()).toBeVisible();

      // Modos continuam clicáveis e o CTA continua visível após o scroll.
      await expect(page.getByRole('tab', { name: /Semana|Dia/ }).first()).toBeEnabled();
      await expect(page.getByRole('button', { name: 'Novo agendamento' })).toBeVisible();

      // Screenshots A/B/E/F/G (por viewport/mode).
      const tag = view === 'day' ? ({ 1440: 'A', 1366: 'E', 1280: 'G', 1920: 'X' } as Record<number, string>)[w] : w === 1440 ? 'B' : w === 1366 ? 'F' : 'X';
      if (tag !== 'X') {
        await page.locator('[data-agenda-main] .ws-scroll').evaluate((el) => el.scrollTo(0, 0));
        await page.screenshot({ path: info.outputPath(`${tag}-${view}-${w}x${h}.png`) });
      }
      // D — grid após scroll interno (1440×900 dia).
      if (w === 1440 && view === 'day') {
        await page.locator('[data-agenda-main] .ws-scroll').evaluate((el) => el.scrollTo(0, 600));
        await page.waitForTimeout(150);
        await page.screenshot({ path: info.outputPath('D-grid-after-internal-scroll-1440.png') });
      }
    });
  }
}

test('Mês e Lista permanecem dentro do viewport (scroll só do painel do modo)', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1366, height: 768 });
  for (const view of ['month', 'list'] as const) {
    await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=${view}`);
    await page.waitForSelector('[data-agenda-main]');
    await page.waitForSelector('[data-agenda-main] .ag-mode-scroll', { timeout: 20000 });
    const m = await metrics(page, `1366x768 ${view}`);
    record(m);
    expect(m.docScrollH - m.docClientH).toBeLessThanOrEqual(TOLERANCE);
    expect(m.bodyScrollH - m.docClientH).toBeLessThanOrEqual(TOLERANCE);
  }
});

test('evidência C — Linha 1 + Linha 2 compactas (1440×900)', async ({ page }, info) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=day`);
  await page.waitForSelector('[data-agenda-main] .ws-scroll', { timeout: 20000 });
  const header = page.locator('[data-agenda-page="true"] > header');
  const toolbar = page.locator('[data-agenda-main] .ws-panel');
  const hb = (await header.boundingBox())!;
  const tb = (await toolbar.boundingBox())!;
  await page.screenshot({
    path: info.outputPath('C-linha1-linha2-1440.png'),
    clip: { x: 256, y: hb.y - 8, width: 1440 - 256 - 16, height: tb.y + tb.height - hb.y + 16 },
  });
  // As duas linhas são compactas: < 150px somadas.
  expect(tb.y + tb.height - hb.y).toBeLessThan(150);
});

test('evidência H — “+ Novo” global outline (quick create funcional)', async ({ page }, info) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=day`);
  await page.waitForSelector('[data-agenda-main]');
  const novo = page.getByRole('button', { name: 'Novo', exact: true });
  // Outline/neutro: fundo branco (superfície), não azul sólido.
  const bg = await novo.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgb(255, 255, 255)');
  await novo.click();
  await expect(page.getByRole('menu', { name: 'Criar novo' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /Novo agendamento/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath('H-novo-outline-1440.png') });
});

test('CTA “Novo agendamento” abre o fluxo de criação existente (sem gravar nada)', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=day`);
  await page.waitForSelector('[data-agenda-main] .ws-scroll', { timeout: 20000 });
  await page.getByRole('button', { name: 'Novo agendamento' }).click();
  await expect(page.getByRole('dialog', { name: 'Novo agendamento' })).toBeVisible();
  await expect(page.getByText(/Paciente → serviço → data e horário/)).toBeVisible();
  // Fecha sem criar — nenhum dado é escrito.
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
});

test('Filtros e Fila abrem na Linha 1; modos e data continuam operáveis', async ({ page }) => {
  await login(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/agenda?b=${f.b}&data=${f.date}&view=day`);
  await page.waitForSelector('[data-agenda-main] .ws-scroll', { timeout: 20000 });
  // Filtros (popover da Linha 1).
  const header = page.locator('[data-agenda-page="true"] > header');
  await header.getByRole('button', { name: /Filtros/ }).click();
  await expect(page.getByRole('dialog', { name: 'Filtros da agenda' })).toBeVisible();
  await page.keyboard.press('Escape');
  // Fila (toggle da Linha 1 → rail/drawer).
  await header.getByRole('button', { name: /Fila/ }).click();
  await expect(page.locator('[data-queue-panel="true"]')).toBeVisible();
  await header.getByRole('button', { name: /Fila/ }).click();
  // Navegação de data + modos.
  const before = new URL(page.url()).searchParams.get('data');
  await page.getByRole('button', { name: /Próximo dia/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('data')).not.toBe(before);
  await page.getByRole('button', { name: 'Hoje', exact: true }).click();
  await expect(page.getByRole('tab', { name: /Semana/ })).toBeVisible();
  await page.getByRole('tab', { name: /Semana/ }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('view')).toBe('week');
});
