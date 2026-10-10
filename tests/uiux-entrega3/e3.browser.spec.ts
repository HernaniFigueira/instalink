import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Entrega 3 · navegador real, dados SINTÉTICOS (fixture de scripts/seed-entrega3-qa.mjs).
const f = JSON.parse(fs.readFileSync(process.env.E3_FIXTURE || path.join(os.homedir(), '.cache/e3/fixture.json'), 'utf8'));
const SHOTS = process.env.E3_SHOTS || path.join(os.homedir(), '.cache/e3/shots');
fs.mkdirSync(SHOTS, { recursive: true });
const BR = (iso: string) => iso.split('-').reverse().join('/');

// Sessões reutilizadas só quando obtidas pelo login REAL (limite do servidor: 15 logins/min).
const sessions = new Map<string, Awaited<ReturnType<BrowserContext['storageState']>>>();
async function login(page: Page, account: { email: string; password: string }) {
  const cached = sessions.get(account.email);
  if (cached) {
    await page.context().addCookies(cached.cookies);
    return;
  }
  await page.goto('/login');
  await page.waitForTimeout(500);
  await page.getByLabel('E-mail', { exact: true }).fill(account.email);
  await page.getByLabel('Senha', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForFunction(() => location.pathname !== '/login', undefined, { timeout: 30000 });
  sessions.set(account.email, await page.context().storageState());
}
async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}
function noPageErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.describe.configure({ mode: 'serial' });

test.describe('Entrega 3 · Agenda', () => {
  test('Dashboard · "Ver agenda" abre a DATA e o profissional do próximo atendimento (não hoje)', async ({ page }) => {
    const errors = noPageErrors(page);
    await login(page, f.owner);
    // Fonte da verdade: o próximo atendimento real que o painel recebe do servidor.
    await page.goto(`/dashboard?b=${f.b}`);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    // fetch same-origin (cookies do navegador) — mesma fonte que o painel consome.
    const ov = await page.evaluate(async (bid: string) => (await fetch(`/api/overview?businessId=${bid}`)).json(), f.b);
    const next = ov.upcoming[0];
    expect(next, 'precisa existir próximo atendimento').toBeTruthy();
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Próximos atendimentos' }) });
    await expect(card).toBeVisible();
    // 1) CTA do cartão: precisa levar a data EXATA e o profissional do próximo atendimento.
    const cta = card.getByRole('link', { name: 'Ver agenda →' });
    const ctaUrl = new URL((await cta.getAttribute('href'))!, 'http://qa.local');
    expect(ctaUrl.searchParams.get('data')).toBe(next.date);
    expect(ctaUrl.searchParams.get('view')).toBe('day');
    if (next.professionalId) expect(ctaUrl.searchParams.get('professionalId')).toBe(next.professionalId);
    await cta.click();
    await page.waitForURL(new RegExp(`data=${next.date}`), { timeout: 20000 });
    expect(new URL(page.url()).searchParams.get('view')).toBe('day');
    await shot(page, 'dashboard-ver-agenda-proximo');
    // 2) A LINHA do atendimento FUTURO (Michele · Thor) abre o dia dele, não hoje.
    await page.goto(`/dashboard?b=${f.b}`);
    const row = card.getByRole('link', { name: new RegExp(`Bernardo Almeida.*${f.futureDate.slice(8, 10)}/${f.futureDate.slice(5, 7)}`) }).first();
    await row.click();
    await page.waitForURL(new RegExp(`data=${f.futureDate}`), { timeout: 20000 });
    expect(new URL(page.url()).searchParams.get('view')).toBe('day');
    expect(new URL(page.url()).searchParams.get('professionalId')).toBe(f.micheleId);
    expect(errors).toEqual([]);
  });

  test('Seletor de visão: menu canônico (sem <select> nativo), teclado, Escape e Mês funcional', async ({ page }) => {
    const errors = noPageErrors(page);
    await login(page, f.owner);
    await page.goto(`/agenda?b=${f.b}&view=day&data=${f.futureDate}`);
    const trigger = page.getByRole('combobox', { name: 'Visualização da agenda' });
    await expect(trigger).toBeVisible();
    expect(await page.locator('select').count()).toBe(0);
    // Teclado: abre, ↓↓ (Dia → Semana → Mês), Enter
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.waitForURL(/view=month/);
    await expect(page.locator('[data-agenda-view="month"]')).toBeVisible();
    await expect(trigger).toBeFocused();
    // Escape fecha SEM trocar de visão e devolve o foco ao gatilho
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(trigger).toBeFocused();
    expect(new URL(page.url()).searchParams.get('view')).toBe('month');
    // Mês: navegação entre meses
    await page.getByRole('button', { name: 'Próximo mês' }).click();
    await page.waitForURL(/data=\d{4}-\d{2}-01/);
    const nextMonth = new URL(page.url()).searchParams.get('data') || '';
    expect(nextMonth.slice(0, 7)).not.toBe(f.futureDate.slice(0, 7));
    await page.goto(`/agenda?b=${f.b}&view=month&data=${f.futureDate}`);
    const cell = page.locator(`[data-month-day="${f.futureDate}"]`);
    await expect(cell).toBeVisible();
    await shot(page, 'agenda-mes-1440');
    // Abrir agendamento a partir do Mês (mesmo detalhe da agenda)
    await cell.getByRole('button', { name: /Bernardo Almeida/ }).click();
    await expect(page.getByRole('dialog').first()).toBeVisible();
    await expect(page.getByRole('dialog').first()).toContainText('Bernardo Almeida');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Toolbar · "Bloquear horário" é ícone de cadeado com nome acessível e tooltip', async ({ page }) => {
    await login(page, f.owner);
    await page.goto(`/agenda?b=${f.b}&view=day&data=${f.futureDate}`);
    const lock = page.getByRole('button', { name: 'Bloquear horário', exact: true });
    await expect(lock).toBeVisible();
    await expect(lock).toHaveAttribute('title', 'Bloquear horário');
    expect((await lock.textContent())?.trim() || '').toBe('');
  });
});

// Cadeia ÚNICA E2E A → E2E B: o booking criado pela Recepção na UI. O E2E B NÃO escolhe
// paciente por nome/status: localiza exatamente este bookingId (dashboard e agenda).
const CHAIN = path.join(os.homedir(), '.cache/e3/e2e-chain.json');
type Chain = { bookingId: string; date: string; time: string; petId: string; professionalId: string; contactId: string };
function readChain(): Chain {
  if (!fs.existsSync(CHAIN)) throw new Error('E2E B exige o booking criado pela Recepção no E2E A (cadeia ausente).');
  return JSON.parse(fs.readFileSync(CHAIN, 'utf8')) as Chain;
}
const bookingEvent = (page: Page, bookingId: string) => page.locator(`[data-booking-id="${bookingId}"]`).first();

test.describe('Entrega 3 · E2E A — Recepção', () => {
  test('agenda → data futura → criar agendamento (tutora, pet, serviço, profissional) → detalhe → check-in', async ({ page }) => {
    const errors = noPageErrors(page);
    fs.rmSync(CHAIN, { force: true });
    await login(page, f.recepcao);
    await page.goto(`/agenda?b=${f.b}&view=day&data=${f.futureDate}`);
    await expect(page.getByText(BR(f.futureDate)).first()).toBeVisible();
    await page.getByRole('button', { name: 'Novo agendamento', exact: true }).click();
    const sheet = page.getByRole('dialog').first();
    await expect(sheet).toBeVisible();
    // Tutora
    await sheet.getByRole('searchbox', { name: 'Buscar cliente' }).fill('Bernardo');
    await sheet.getByRole('button', { name: /Bernardo Almeida/ }).first().click();
    // Pet correto (tutor tem Thor e Luna)
    await sheet.getByRole('combobox', { name: 'Pet (paciente)' }).click();
    await page.getByRole('option', { name: /Luna/ }).click();
    // Serviço e profissional
    await sheet.getByPlaceholder('Buscar serviço…').fill('Consulta');
    await page.getByRole('option', { name: /Consulta clínica/ }).first().click();
    await sheet.getByPlaceholder('Buscar profissional…').fill('Michele');
    await page.getByRole('option', { name: /Michele/ }).first().click();
    // Horário livre (primeiro da grade) e salvar
    const slotBtn = sheet.locator('button[aria-pressed]').filter({ hasText: /^\d{2}:\d{2}$/ }).first();
    await expect(slotBtn).toBeVisible({ timeout: 20000 });
    const slotTime = (await slotBtn.textContent())?.trim() || '';
    expect(slotTime).toMatch(/^\d{2}:\d{2}$/);
    await slotBtn.click();
    await shot(page, 'quick-create-1440');
    const created = page.waitForResponse((r) => r.url().includes('/api/bookings') && r.request().method() === 'POST', { timeout: 30000 });
    await sheet.getByRole('button', { name: 'Salvar agendamento', exact: true }).click();
    const createdRes = await created;
    expect(createdRes.ok()).toBeTruthy();
    // ID real do booking criado PELA UI + o que a UI enviou (pet e profissional escolhidos).
    const createdBody = await createdRes.json();
    const bookingId = String(createdBody.bookingId || createdBody.booking?.id || createdBody.id || '');
    expect(bookingId).toMatch(/^[\w-]{8,}$/);
    const sent = createdRes.request().postDataJSON() as Record<string, unknown>;
    expect(sent.petId).toBe(f.pets.lunaId);
    expect(sent.professionalId).toBe(f.micheleId);
    await expect(sheet.getByText('Agendamento criado')).toBeVisible({ timeout: 20000 });
    await sheet.locator('button').filter({ hasText: /^Fechar$/ }).last().click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Detalhe do PRÓPRIO booking (pelo id) → check-in (Chegou), sem alterar BookingStatus
    const ev = bookingEvent(page, bookingId);
    await expect(ev).toBeVisible({ timeout: 20000 });
    await expect(ev).toHaveAttribute('aria-label', /Bernardo Almeida · Consulta clínica .* · Dra\. Michele Martins/);
    await ev.click();
    const detail = page.getByRole('dialog').first();
    await expect(detail).toBeVisible();
    await detail.getByRole('button', { name: 'Registrar chegada', exact: true }).click();
    await expect(page.getByText(/Chegada registrada/).first()).toBeVisible({ timeout: 15000 });
    await expect(bookingEvent(page, bookingId)).toHaveAttribute('aria-label', /cliente já chegou/, { timeout: 15000 });
    await shot(page, 'pos-check-in-1440');
    fs.mkdirSync(path.dirname(CHAIN), { recursive: true });
    fs.writeFileSync(CHAIN, JSON.stringify({
      bookingId, date: f.futureDate, time: slotTime,
      petId: f.pets.lunaId, professionalId: f.micheleId, contactId: f.tutor.id,
    } satisfies Chain, null, 2), { mode: 0o600 });
    expect(errors).toEqual([]);
  });
});

test.describe('Entrega 3 · E2E B — Profissional (mesmo booking da Recepção)', () => {
  test('dashboard → booking criado pela Recepção → atendimento → finalização → Registro → Agenda → Cliente 360', async ({ page }) => {
    const errors = noPageErrors(page);
    const chain = readChain();
    await login(page, f.michele);
    // 1) Dashboard: a linha do PRÓPRIO bookingId em "Próximos atendimentos"
    await page.goto(`/dashboard?b=${f.b}`);
    const upcomingCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Próximos atendimentos' }) });
    await expect(upcomingCard.locator(`[data-booking-id="${chain.bookingId}"]`)).toBeVisible({ timeout: 20000 });
    await shot(page, 'dashboard-profissional-1440');
    await upcomingCard.locator(`[data-booking-id="${chain.bookingId}"]`).click();
    // 2) Agenda: mesma data e profissional; o MESMO bookingId, já com chegada
    await page.waitForURL(/data=/, { timeout: 20000 });
    const agendaUrl = new URL(page.url());
    expect(agendaUrl.searchParams.get('data')).toBe(chain.date);
    expect(agendaUrl.searchParams.get('professionalId')).toBe(chain.professionalId);
    const ev = bookingEvent(page, chain.bookingId);
    await expect(ev).toBeVisible({ timeout: 20000 });
    await expect(ev).toHaveAttribute('aria-label', /cliente já chegou/);
    await ev.click();
    const detail = page.getByRole('dialog').first();
    await detail.getByRole('button', { name: /^(Iniciar atendimento|Retomar atendimento|Ver atendimento)$/ }).click();
    await page.waitForURL(/\/atendimento\//, { timeout: 30000 });
    const encounterUrl = page.url();
    const encounterId = new URL(encounterUrl).pathname.split('/')[2];
    // 3) Vínculo PROVADO pelo servidor: encounter → mesmo booking, tutor, pet e profissional
    const got = await page.evaluate(async (u: string) => {
      const r = await fetch(u);
      return { status: r.status, body: await r.json() };
    }, `/api/encounters?businessId=${f.b}&id=${encounterId}`);
    expect(got.status).toBe(200);
    const enc = got.body.encounter ?? got.body;
    expect(enc.bookingId).toBe(chain.bookingId);
    expect(enc.professionalId).toBe(chain.professionalId);
    expect(enc.petId).toBe(chain.petId);
    expect(enc.contactId).toBe(chain.contactId);
    const timer = page.getByRole('timer').first();
    await expect(timer).toContainText('Em atendimento', { timeout: 20000 });
    await shot(page, 'atendimento-timer-1440');
    // Autosave contínuo: preenche as seções clínicas e espera o indicador "Salvo"
    const section = (name: string) => page.getByRole('navigation', { name: 'Seções do atendimento' }).getByRole('button', { name, exact: true });
    const field = () => page.locator('main textarea:visible').first();
    const stamp = `E3 ${Date.now()}`;
    const texts: Record<string, string> = {
      Atendimento: `Coceira intensa nas axilas — ${stamp}`,
      Anamnese: `Tutor relata coceira noturna — ${stamp}`,
      Avaliação: `Eritema axilar e otite leve — ${stamp}`,
      Conduta: `Oclacitinib por 14 dias — ${stamp}`,
    };
    for (const name of ['Atendimento', 'Anamnese', 'Avaliação', 'Problemas', 'Conduta', 'Procedimentos']) {
      await section(name).click();
      if (texts[name]) {
        await field().fill(texts[name]);
        await expect(page.getByText('Salvo agora').first()).toBeVisible({ timeout: 20000 });
      }
    }
    await shot(page, 'atendimento-secoes-1440');
    // Persistência: recarrega e confirma o que foi digitado em cada seção
    await page.reload();
    for (const name of ['Atendimento', 'Anamnese', 'Avaliação', 'Conduta']) {
      await section(name).click();
      await expect(field()).toHaveValue(texts[name], { timeout: 20000 });
    }
    // Finalizar: revisão → confirmar → somente leitura
    await page.getByRole('button', { name: 'Finalizar atendimento', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Revisar e finalizar' });
    await expect(review).toBeVisible();
    await shot(page, 'revisar-finalizar-1440');
    await review.getByRole('button', { name: 'Finalizar atendimento', exact: true }).click();
    await expect(page.getByText(/Atendimento finalizado|Finalizado/).first()).toBeVisible({ timeout: 30000 });
    await shot(page, 'atendimento-finalizado-1440');
    // Somente leitura: nenhum campo clínico editável (o ADENDO é append-only e segue disponível)
    await section('Atendimento').click();
    await expect(page.locator('main textarea:visible:not(#encounter-addendum):not(:disabled)')).toHaveCount(0);
    // Registro completo (switcher) e volta para a Agenda com o mesmo contexto
    await page.getByRole('navigation', { name: 'Superfícies do atendimento' }).getByRole('button', { name: 'Registro completo', exact: true }).click();
    await page.waitForURL(/\/registro/, { timeout: 30000 });
    await shot(page, 'registro-completo-1440');
    await page.getByRole('navigation', { name: 'Superfícies do atendimento' }).getByRole('button', { name: 'Atendimento', exact: true }).click();
    await page.waitForURL(/\/atendimento\/[^/]+(\?|$)/, { timeout: 30000 });
    await page.getByRole('button', { name: 'Voltar para agenda', exact: true }).click();
    await page.waitForURL(/\/agenda/, { timeout: 30000 });
    const back = new URL(page.url());
    expect(back.searchParams.get('data')).toBe(chain.date);
    expect(back.searchParams.get('view')).toBe('day');
    expect(back.searchParams.get('professionalId')).toBe(chain.professionalId);
    await expect(bookingEvent(page, chain.bookingId)).toBeVisible({ timeout: 20000 });
    await shot(page, 'agenda-apos-atendimento-1440');
    // Cliente 360: o atendimento deste booking aparece na história do Bernardo
    await page.goto(`/clientes?b=${f.b}`);
    await page.getByRole('button', { name: 'Abrir perfil de Bernardo Almeida' }).first().click();
    await expect(page.getByText('Thor').first()).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(stamp).first()).toBeVisible({ timeout: 20000 });
    await shot(page, 'cliente-360-historia-1440');
    expect(errors).toEqual([]);
    expect(encounterUrl).toContain('/atendimento/');
  });
});

test.describe('Entrega 3 · Segundo E2E — Cliente 360 → Registro → Voltar', () => {
  test('Cliente 360 → Atendimento → Registro → "Voltar para [Cliente]" (returnTo, nome, sem salto para Agenda)', async ({ page }) => {
    const errors = noPageErrors(page);
    await login(page, f.michele);
    await page.goto(`/clientes?b=${f.b}`);
    await page.getByRole('button', { name: 'Abrir perfil de Bernardo Almeida' }).first().click();
    await expect(page.getByText('Thor').first()).toBeVisible({ timeout: 20000 });
    const clientPath = new URL(page.url()).pathname;
    await page.getByRole('button', { name: 'Abrir registro' }).first().click();
    await page.waitForURL(/\/atendimento\/|\/registro/, { timeout: 30000 });
    await shot(page, 'cliente-360-para-registro-1440');
    const back = page.getByRole('button', { name: 'Voltar para Bernardo' });
    await expect(back).toBeVisible({ timeout: 20000 });
    await expect(page.getByRole('button', { name: 'Voltar para agenda', exact: true })).toHaveCount(0);
    await back.click();
    await page.waitForURL(/\/clientes\//, { timeout: 30000 });
    expect(new URL(page.url()).pathname).toBe(clientPath);
    expect(page.url()).not.toContain('/agenda');
    await expect(page.getByText('Thor').first()).toBeVisible({ timeout: 20000 });
    expect(errors).toEqual([]);
  });
});
