import { test, type Page, type BrowserContext, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Entrega 3 · QA visual em navegador real (dados SINTÉTICOS). Gera capturas individuais
// por viewport/papel e um registro de overflow horizontal. Não faz asserts de produto:
// o que é contrato está em e3.browser.spec.ts; aqui é inspeção de renderização.
const f = JSON.parse(fs.readFileSync(process.env.E3_FIXTURE || path.join(os.homedir(), '.cache/e3/fixture.json'), 'utf8'));
const OUT = process.env.E3_QA_OUT || path.join(os.homedir(), '.cache/e3/shots/depois');
const LOG = path.join(OUT, '..', `qa-render-${process.env.E3_QA_TAG || 'depois'}.jsonl`);
fs.mkdirSync(OUT, { recursive: true });

const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();
async function login(page: Page, account: { email: string; password: string }) {
  const cached = sessions.get(account.email);
  if (cached) { await page.context().addCookies(cached.cookies); return; }
  await page.goto('/login');
  await page.waitForTimeout(400);
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForFunction(() => location.pathname !== '/login', undefined, { timeout: 30000 });
  sessions.set(account.email, await page.context().storageState());
}

async function render(page: Page, info: TestInfo, name: string, url: string, full = false) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(700);
  const metrics = await page.evaluate(() => ({
    vw: window.innerWidth,
    scrollW: document.documentElement.scrollWidth,
    overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
    h1: document.querySelector('h1')?.textContent?.trim() || '',
  }));
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
  fs.appendFileSync(LOG, JSON.stringify({ name, project: info.project.name, url, ...metrics }) + '\n');
}

const VIEWPORTS: Array<[string, number, number]> = [
  ['1440', 1440, 900], ['1366', 1366, 768], ['1024', 1024, 768], ['768', 768, 1024], ['390', 390, 844],
];
const DAY = `/agenda?b=${f.b}&view=day&data=${f.futureDate}`;

for (const [tag, w, h] of VIEWPORTS) {
  test.describe(`Agenda ${tag}`, () => {
    test.use({ viewport: { width: w, height: h } });
    test(`agenda ${tag}: visões e detalhe`, async ({ page }, info) => {
      await login(page, f.owner);
      const q = (v: string) => `/agenda?b=${f.b}&view=${v}&data=${f.futureDate}`;
      if (tag === '1440') {
        await render(page, info, `agenda-${tag}-dia`, DAY);
        await render(page, info, `agenda-${tag}-semana`, q('week'));
        await render(page, info, `agenda-${tag}-mes`, q('month'));
        await render(page, info, `agenda-${tag}-lista`, q('list'));
      } else if (tag === '1366') {
        await render(page, info, `agenda-${tag}-semana`, q('week'));
        await render(page, info, `agenda-${tag}-mes`, q('month'));
      } else if (tag === '1024') {
        await render(page, info, `agenda-${tag}-dia`, DAY);
        await render(page, info, `agenda-${tag}-semana`, q('week'));
        await render(page, info, `agenda-${tag}-mes`, q('month'));
      } else {
        await render(page, info, `agenda-${tag}-dia`, DAY);
      }
      // Seletor de visão aberto (popover canônico) em cada viewport.
      await page.goto(DAY, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(600);
      const trigger = page.getByRole('combobox', { name: 'Visualização da agenda' });
      if (await trigger.count()) {
        await trigger.click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, `agenda-${tag}-seletor-aberto.png`) });
        await page.keyboard.press('Escape');
      }
      // Detalhe do atendimento (drawer à direita).
      const ev = page.getByRole('button', { name: /Bernardo Almeida/ }).first();
      if (await ev.count()) {
        await ev.click();
        await page.waitForTimeout(500);
        await page.screenshot({ path: path.join(OUT, `agenda-${tag}-detalhe.png`) });
      }
    });
  });
}

test.describe('Dashboards por papel 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('Owner', async ({ page }, info) => {
    await login(page, f.owner);
    await render(page, info, 'dashboard-1440-owner', `/dashboard?b=${f.b}`, true);
  });
  test('Recepção (landing real: Agenda, sem Visão geral pelo preset)', async ({ page }, info) => {
    await login(page, f.recepcao);
    await render(page, info, 'recepcao-1440-agenda', `/agenda?b=${f.b}&view=day&data=${f.futureDate}`);
    await render(page, info, 'dashboard-1440-recepcao-acesso-negado', `/dashboard?b=${f.b}`);
  });
  test('Profissional (Michele)', async ({ page }, info) => {
    await login(page, f.michele);
    await render(page, info, 'dashboard-1440-profissional', `/dashboard?b=${f.b}`, true);
  });
});

test.describe('Dashboards 390 smoke', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('Profissional 390', async ({ page }, info) => {
    await login(page, f.michele);
    await render(page, info, 'dashboard-390-profissional', `/dashboard?b=${f.b}`);
  });
});
