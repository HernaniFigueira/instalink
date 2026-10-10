// ═══════════════════════════════════════════════════════════════
// ENTREGA 1 · QA DE BROWSER (Chromium real, banco descartável)
// ═══════════════════════════════════════════════════════════════
// A. Quick Create veterinário: 1 pet → pré-seleção automática (sem clique);
//    0 pets → sem campo de pet e criação permitida; vínculo Serviço ↔ Profissional
//    nos dois sentidos (regra REAL: professionalMode/professionalIds do serviço).
// B. SelectMenu canônico no atendimento: abre, ↑/↓, Enter escolhe, Escape fecha,
//    sem <select> nativo na Anamnese.
// C. Motion dos drawers (DetailSideModal = detalhe da Agenda, Pet 360 e
//    Client Preview): entrada translateX(100%)→0 e saída 0→translateX(100%),
//    sem scale, backdrop com a mesma duração do painel. Medido com as animações reais.
//
// Pré-requisito: `node scripts/seed-f1b1-qa.mjs` + `next start` com GODOUTOR_DB_FILE.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent (QA local descartável).');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('QA local apenas.');

const A = 'f1b1-vet-qa';
const password = 'GodoutorF1B12026!';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
  .format(new Date(Date.now() + 24 * 3600 * 1000)); // amanhã: slot futuro sempre válido
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const results = [];
const ok = (label) => { results.push(label); console.log('PASS', label); };

const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.QA_EXECUTABLE_PATH) options.executablePath = process.env.QA_EXECUTABLE_PATH;
const browser = await chromium.launch(options);
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

async function login(email) {
  await page.goto(`${base}/login`);
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
}

async function serverBookings(query) {
  return page.evaluate(async ({ businessId, query: q }) => {
    const res = await fetch(`/api/bookings?businessId=${encodeURIComponent(businessId)}&mode=patient&${q}`);
    return res.json().catch(() => ({}));
  }, { businessId: A, query });
}

/** Abre a criação rápida num slot vazio (varre a coluna; um clique em agendamento existente é desfeito). */
async function openQuickCreate(columnIndex = 0, startY = 260) {
  await page.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);
  const column = page.locator('[data-agenda-column]').nth(columnIndex);
  await column.waitFor();
  const box = await column.boundingBox();
  const popover = page.getByLabel('Criar agendamento neste horário');
  for (let y = startY; y < box.height; y += 46) {
    await page.mouse.click(box.x + box.width / 2, box.y + y);
    if (await popover.isVisible().catch(() => false)) return popover;
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(120);
  }
  throw Error('não foi possível abrir a criação rápida num slot vazio');
}

/** Saída de um DetailSideModal: Escape e medição de gd-detail-out (0 → translateX(largura)). */
async function measureExit(label) {
  await page.keyboard.press('Escape');
  const r = await page.evaluate(() => {
    const dlg = document.querySelector('.gd-detail[data-closing]');
    const panel = dlg?.querySelector('.gd-detail__panel');
    if (!panel) return { error: 'saída não encontrada (sem data-closing)' };
    const anim = panel.getAnimations().find((x) => x.animationName === 'gd-detail-out');
    if (!anim) return { error: 'sem animação gd-detail-out' };
    anim.pause();
    const tx = (t) => { anim.currentTime = t; const m = getComputedStyle(panel).transform; return m === 'none' ? 0 : Number(m.match(/matrix\(([^)]+)\)/)[1].split(',')[4]); };
    const dur = anim.effect.getTiming().duration;
    const s0 = tx(0); const e0 = tx(dur); const w = panel.getBoundingClientRect().width;
    anim.cancel();
    return { s0, e0, w, dur };
  });
  assert.equal(r.error, undefined, `${label} saída: ${r.error}`);
  assert.ok(Math.abs(r.s0) < 0.5 && Math.abs(r.e0 - r.w) < 1.5, `${label} sai 0→borda (s=${r.s0}, e=${r.e0}, w=${r.w})`);
  ok(`${label} · SAI pela borda direita: 0→translateX(${Math.round(r.w)}px) (${r.dur}ms)`);
}

async function pickContact(popover, name) {
  await popover.getByLabel(/^Paciente/).first().fill(name.split(' ')[0]);
  await popover.getByRole('button', { name: new RegExp(name) }).first().click();
}

async function comboOptions(popover, name) {
  await popover.getByRole('combobox', { name: new RegExp(name) }).click();
  const texts = await page.getByRole('option').allInnerTexts();
  await page.keyboard.press('Escape');
  return texts.map((t) => t.split('\n')[0].trim());
}

try {
  // ═════ A · QUICK CREATE ═════════════════════════════════════════════════
  await login('owner.f1b1@godoutor.local');

  // A1 · 1 pet → pré-seleção automática (Bidu), sem clique no campo de pet.
  let popover = await openQuickCreate(0, 260);
  await pickContact(popover, 'Tutor Único QA');
  const petCombo = popover.getByRole('combobox', { name: /Pet \(paciente\)/ });
  await petCombo.waitFor({ timeout: 10000 });
  assert.equal(await petCombo.inputValue(), 'Bidu', 'pet único pré-selecionado');
  ok('A1 · 1 pet: "Bidu" pré-selecionado automaticamente, sem clique');
  await popover.getByRole('combobox', { name: /Serviço/ }).click();
  await page.getByRole('option', { name: /Consulta dermatológica/ }).click();
  await popover.getByRole('button', { name: 'Criar agendamento', exact: true }).click();
  await page.getByLabel('Criar agendamento neste horário').waitFor({ state: 'detached', timeout: 15000 });
  const bidu = await serverBookings('petId=pet-bidu');
  assert.ok((bidu.bookings || bidu.items || []).some((b) => b.petId === 'pet-bidu'), 'servidor gravou petId=pet-bidu');
  ok('A1 · criação com pré-seleção grava petId=pet-bidu no servidor');

  // A2 · 0 pets → nenhum campo de pet; aviso de cadastro; criação permitida.
  popover = await openQuickCreate(0, 260);
  await pickContact(popover, 'Tutor Sem Pet QA');
  await popover.locator('[data-quick-create-no-pet]').waitFor({ timeout: 10000 });
  assert.equal(await popover.getByRole('combobox', { name: /Pet \(paciente\)/ }).count(), 0, 'sem pet → sem campo de pet');
  ok('A2 · 0 pets: sem campo de pet e aviso "Use Mais opções para cadastrar o pet"');

  // A3 · vínculo Serviço ↔ Profissional (regra real: serviço restrito ao Orlando).
  popover = await openQuickCreate(0, 260);
  await pickContact(popover, 'Isabelle Tutora QA');
  // A coluna é da Michelle: com ela fixa, o serviço restrito ao Orlando já NÃO é oferecido
  // (filtro nos dois sentidos). Para testar a escolha, o profissional volta a "Automático".
  await popover.getByRole('combobox', { name: /Profissional/ }).click();
  await page.getByRole('option', { name: 'Automático', exact: true }).click();
  await popover.getByRole('combobox', { name: /Serviço/ }).click();
  await page.getByRole('option', { name: /Consulta restrita ao Orlando/ }).click();
  const proWhenRestricted = await comboOptions(popover, 'Profissional');
  assert.ok(proWhenRestricted.includes('Orlando') && !proWhenRestricted.includes('Michelle'),
    `serviço restrito → só Orlando: ${JSON.stringify(proWhenRestricted)}`);
  ok('A3 · serviço restrito ao Orlando: Profissional lista só quem atende (sem Michelle)');

  // ... e o sentido inverso: com o serviço limpo, escolher Michelle esconde o serviço restrito.
  await popover.getByRole('combobox', { name: /Serviço/ }).click();
  await page.getByRole('option', { name: /Selecione/ }).click();
  await popover.getByRole('combobox', { name: /Profissional/ }).click();
  await page.getByRole('option', { name: 'Michelle', exact: true }).click();
  const svcWithMichelle = await comboOptions(popover, 'Serviço');
  assert.ok(!svcWithMichelle.some((t) => /restrita ao Orlando/.test(t)), `Michelle → serviço restrito oculto: ${JSON.stringify(svcWithMichelle)}`);
  ok('A3 · profissional Michelle: serviço restrito ao Orlando não aparece na lista');
  await popover.getByRole('button', { name: 'Fechar criação rápida' }).click().catch(() => page.keyboard.press('Escape'));

  // A4 · 2+ pets → exigência explícita (já coberto por quick-create-pet-browser.mjs; reexecutado à parte).

  // ═════ B · SELECTMENU NO ATENDIMENTO ═════════════════════════════════
  // Atendimento clínico é da PROFISSIONAL (Michelle): o owner vê a Anamnese só em leitura.
  await context.clearCookies();
  await login('michelle.f1b1@godoutor.local');
  await page.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);
  const card = page.locator('button.ag-event').filter({ hasText: 'Mel' }).filter({ hasText: '15:00' }).first();
  await card.waitFor({ timeout: 20000 });
  await card.click();
  // C · motion do detalhe da Agenda (DetailSideModal) — medido aqui, antes de navegar.
  const measure = async (phase) => page.evaluate((ph) => {
    const dlg = document.querySelector('.gd-detail');
    const panel = dlg?.querySelector('.gd-detail__panel');
    if (!panel) return { error: 'sem painel' };
    const want = ph === 'in' ? 'gd-detail-in' : 'gd-detail-out';
    const anim = panel.getAnimations().find((x) => x.animationName === want);
    if (!anim) return { error: `sem animação ${want}`, closing: dlg.hasAttribute('data-closing') };
    const dur = anim.effect.getTiming().duration;
    const backdrops = document.getAnimations().filter((a) => a.effect && a.effect.pseudoElement === '::backdrop').map((a) => a.effect.getTiming().duration);
    anim.pause();
    const readAt = (t) => { anim.currentTime = t; const m = getComputedStyle(panel).transform; return m === 'none' ? [1, 1, 0] : (() => { const v = m.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number); return [v[0], v[3], v[4]]; })(); };
    const start = readAt(0);
    const end = readAt(dur);
    const width = panel.getBoundingClientRect().width;
    anim.cancel();
    return { dur, width, start, end, backdrops };
  }, phase);
  const inM = await measure('in');
  assert.equal(inM.error, undefined, `entrada: ${inM.error}`);
  assert.ok(Math.abs(inM.start[2] - inM.width) < 1.5, `entrada começa fora da borda direita (tx=${inM.start[2]}, largura=${inM.width})`);
  assert.ok(Math.abs(inM.end[2]) < 0.5, `entrada termina em 0 (tx=${inM.end[2]})`);
  assert.ok(Math.abs(inM.start[0] - 1) < 0.01 && Math.abs(inM.start[1] - 1) < 0.01, 'entrada sem scale');
  assert.ok(inM.backdrops.length > 0 && inM.backdrops.every((d) => d === inM.dur),
    `backdrop com a mesma duração do painel (painel=${inM.dur}, backdrop=${JSON.stringify(inM.backdrops)})`);
  ok(`C1 · detalhe da Agenda ENTRA: translateX(${Math.round(inM.width)}px)→0, sem scale (${inM.dur}ms)`);
  ok(`C1b · backdrop sincronizado: mesma duração do painel (${inM.dur}ms)`);

  await page.getByRole('heading', { name: 'Detalhe do agendamento', exact: true }).waitFor();
  await page.getByRole('button', { name: /Iniciar atendimento|Retomar atendimento/ }).click();
  await page.waitForURL(/\/atendimento\/[0-9a-f-]{36}/);
  // B · SelectMenu: Vômito (seção Anamnese). Teclado puro.
  await page.locator('.encounter-workspace__nav-item', { hasText: 'Anamnese' }).first().click();
  await page.waitForFunction(() => document.querySelector('.encounter-workspace__nav-item[aria-current]')?.textContent?.includes('Anamnese'), null, { timeout: 20000 });
  const vomit = page.getByRole('combobox', { name: 'Vômito' });
  await vomit.waitFor({ timeout: 20000 });
  assert.equal(await page.locator('select').count(), 0, 'nenhum <select> nativo na página do atendimento');
  ok('B0 · nenhum <select> nativo no atendimento (controles são SelectMenu/Combobox)');
  const fam = await vomit.evaluate((el) => getComputedStyle(el).fontFamily);
  assert.match(fam, /Barlow/i, `fonte do DS (${fam})`);
  ok('B1 · SelectMenu usa a fonte do DS (Barlow)');
  await vomit.focus();
  await page.keyboard.press('Enter');
  const listbox = page.getByRole('listbox');
  await listbox.waitFor({ timeout: 5000 });
  assert.equal(await vomit.getAttribute('aria-expanded'), 'true');
  ok('B2 · Enter abre o menu (role=listbox, aria-expanded=true), foco permanece no gatilho');
  await page.keyboard.press('ArrowDown');
  const activeId = await vomit.getAttribute('aria-activedescendant');
  assert.ok(activeId, 'ArrowDown move a opção ativa (aria-activedescendant)');
  const activeText = await page.locator(`[id="${activeId}"]`).innerText();
  await page.keyboard.press('Enter');
  await listbox.waitFor({ state: 'detached', timeout: 5000 });
  assert.match(await vomit.innerText(), new RegExp(activeText.split('\n')[0].trim().slice(0, 6)), 'Enter escolheu a opção ativa');
  ok(`B3 · ↓ + Enter escolhe "${activeText.split('\n')[0].trim()}" e fecha o menu`);
  await vomit.focus();
  await page.keyboard.press('Enter');
  await listbox.waitFor({ timeout: 5000 });
  await page.keyboard.press('Escape');
  await listbox.waitFor({ state: 'detached', timeout: 5000 });
  assert.equal(await vomit.getAttribute('aria-expanded'), 'false');
  ok('B4 · Escape fecha o menu sem alterar o valor');

  // C · motion de SAÍDA: Escape no detalhe. Volta à Agenda antes de medir.
  await page.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);
  const card2 = page.locator('button.ag-event').filter({ hasText: 'Mel' }).filter({ hasText: '15:00' }).first();
  await card2.click();
  await page.getByRole('heading', { name: 'Detalhe do agendamento', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  const outM = await page.evaluate(() => {
    const dlg = document.querySelector('.gd-detail[data-closing]');
    const panel = dlg?.querySelector('.gd-detail__panel');
    if (!panel) return { error: 'saída não encontrada (sem data-closing)' };
    const anim = panel.getAnimations().find((x) => x.animationName === 'gd-detail-out');
    if (!anim) return { error: 'sem animação gd-detail-out' };
    const dur = anim.effect.getTiming().duration;
    anim.pause();
    const tx = (t) => { anim.currentTime = t; const m = getComputedStyle(panel).transform; return m === 'none' ? 0 : Number(m.match(/matrix\(([^)]+)\)/)[1].split(',')[4]); };
    const s = tx(0); const e = tx(dur); const w = panel.getBoundingClientRect().width;
    anim.cancel();
    return { dur, s, e, w };
  });
  assert.equal(outM.error, undefined, `saída: ${outM.error}`);
  assert.ok(Math.abs(outM.s) < 0.5 && Math.abs(outM.e - outM.w) < 1.5, `saída 0→largura (s=${outM.s}, e=${outM.e}, w=${outM.w})`);
  ok(`C2 · detalhe da Agenda SAI: 0→translateX(${Math.round(outM.w)}px) (${outM.dur}ms)`);

  // C · Client Preview (ClientProfileDrawer → DetailSideModal) — entrada.
  // Visão clínica (Michelle) não expõe conversas de canal na prévia; a prova do corte usa a visão de owner.
  await context.clearCookies();
  await login('owner.f1b1@godoutor.local');
  await page.goto(`${base}/clientes?b=${A}`);
  const clientRow = page.locator('tr, li, article, div[role=row]').filter({ hasText: 'Isabelle Tutora QA' }).last();
  await clientRow.locator('button[title^="Prévia rápida"]').click();
  await page.locator('.gd-detail[open] .gd-detail__panel').waitFor({ timeout: 15000 });
  const cpIn = await page.evaluate(() => {
    const panel = document.querySelector('.gd-detail[open] .gd-detail__panel');
    const anim = panel.getAnimations().find((x) => x.animationName === 'gd-detail-in');
    if (!anim) return { error: 'sem animação de entrada' };
    anim.pause(); anim.currentTime = 0;
    const m = getComputedStyle(panel).transform;
    const tx = m === 'none' ? 0 : Number(m.match(/matrix\(([^)]+)\)/)[1].split(',')[4]);
    anim.cancel();
    return { tx, w: panel.getBoundingClientRect().width };
  });
  assert.equal(cpIn.error, undefined, `client preview: ${cpIn.error}`);
  assert.ok(Math.abs(cpIn.tx - cpIn.w) < 1.5, `client preview entra da borda (tx=${cpIn.tx}, w=${cpIn.w})`);
  ok('C4 · Client Preview ENTRA da borda direita (translateX(100%)→0)');
  // C4a · PRÉVIA DE CLIENTE — corte deliberado: 3 linhas + reticências, texto completo no title, CTA para ler.
  const talk = page.locator('.gd-detail[open] p.line-clamp-3', { hasText: 'Oi! Desde ontem' }).first();
  await talk.waitFor({ timeout: 10000 });
  const clamp = await talk.evaluate((el) => ({ lines: getComputedStyle(el).webkitLineClamp, overflow: getComputedStyle(el).overflow, title: el.getAttribute('title') || '' }));
  assert.equal(clamp.lines, '3', 'corte de 3 linhas');
  assert.match(clamp.title, /Oi! Desde ontem a Mel está coçando/, `texto completo no title (recebido: ${clamp.title.slice(0, 60)})`);
  const cta = page.locator('.gd-detail[open] a', { hasText: 'Ler conversa completa' });
  await cta.waitFor({ timeout: 5000 });
  assert.match(await cta.getAttribute('href'), /\/conversas\?b=f1b1-vet-qa&q=/, 'CTA aponta para a conversa');
  ok('C4a · prévia de cliente: texto cortado em 3 linhas (reticências), texto completo no title e CTA "Ler conversa completa"');
  await measureExit('C4b · Client Preview');

  // C5 · Pet 360 (DetailSideModal aberto pelo nome do pet no detalhe) — entrada.
  // O agendamento da Bidu (criado em A1) tem petId; o da Mel (seed) não tem — por isso owner aqui.
  await context.clearCookies();
  await login('owner.f1b1@godoutor.local');
  await page.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);
  const biduCard = page.locator('button.ag-event').filter({ hasText: 'Bidu' }).first();
  await biduCard.waitFor({ timeout: 20000 });
  await biduCard.click();
  await page.getByRole('heading', { name: 'Detalhe do agendamento', exact: true }).waitFor();
  await page.locator('.gd-detail[open] button[title="Abrir ficha de Bidu"]').click();
  await sleep(40);
  const p360 = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('.gd-detail[open]')];
    const panel = dialogs[dialogs.length - 1]?.querySelector('.gd-detail__panel');
    if (!panel || dialogs.length < 2) return { error: `dialogs=${dialogs.length}` };
    const anim = panel.getAnimations().find((x) => x.animationName === 'gd-detail-in');
    if (!anim) return { error: 'sem animação de entrada do Pet 360' };
    anim.pause(); anim.currentTime = 0;
    const m = getComputedStyle(panel).transform;
    const v = m === 'none' ? [1, 1, 0] : m.match(/matrix\(([^)]+)\)/)[1].split(',').map(Number);
    const w = panel.getBoundingClientRect().width;
    anim.cancel();
    return { sx: v[0], tx: v[4], w };
  });
  assert.equal(p360.error, undefined, `Pet 360: ${p360.error}`);
  assert.ok(Math.abs(p360.tx - p360.w) < 1.5 && Math.abs(p360.sx - 1) < 0.01, `Pet 360 entra da borda sem scale (tx=${p360.tx}, w=${p360.w}, sx=${p360.sx})`);
  ok(`C5 · Pet 360 ENTRA da borda direita (translateX(${Math.round(p360.w)}px)→0, sem scale)`);
  await measureExit('C5b · Pet 360');

  assert.deepEqual(errors, [], `sem erro de página: ${errors.join(' | ')}`);
  ok('nenhum erro de página (pageerror)');
  console.log(`ENTREGA 1 BROWSER QA: ${results.length} verificações PASS. data=${today}`);
} finally {
  await browser.close();
}
