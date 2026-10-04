// Clinical Encounter F1A — browser QA (local, disposable, real Chromium).
// Run against `next start` + scripts/seed-f1a-qa.mjs ONLY.
// Usage: node tests/f1a/qa.mjs   (QA_BASE_URL default http://127.0.0.1:3111)
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3111';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent (local disposable QA).');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('Local disposable QA only');
const A = 'f1a-vet-qa';
const password = 'GodoutorF1A2026!';
const today = new Date().toISOString().slice(0, 10);

const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.QA_EXECUTABLE_PATH) options.executablePath = process.env.QA_EXECUTABLE_PATH;
const browser = await chromium.launch(options);

/** Status que a própria QA provoca de propósito (bloqueio/recusa canônica). */
const EXPECTED_STATUSES = new Set([403, 404, 409]);
const result = { checks: [], console: [], network: [], expected: [], induced: [], aborted: [] };
/** Falha PROVOCADA de propósito (abort de rede / 500 induzido): rótulo próprio. */
let inducedMode = null;
const ok = (label) => { result.checks.push(label); console.log('PASS', label); };
await fs.mkdir('.cache/f1a', { recursive: true });

/** Login REAL pela UI (e-mail + senha locais), com coletores de console/rede. */
async function login(email, viewport = { width: 1440, height: 1000 }) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (e) => result.console.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') result.console.push(m.text()); });
  page.on('response', (r) => {
    if (r.status() >= 400) {
      const entry = { status: r.status(), url: r.url() };
      // Provas DELIBERADAS de bloqueio/recusa: permissão (403), cross-tenant
      // (404) e invariante clínica (409 — sem profissional responsável).
      if (inducedMode?.statuses.includes(r.status())) result.induced.push(entry);
      else if (EXPECTED_STATUSES.has(r.status())) result.expected.push(entry);
      else result.network.push(entry);
    }
  });
  await page.goto(`${base}/login`);
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL(/dashboard|agenda|master/);
  return page;
}

async function openBooking(page, time) {
  await page.goto(`${base}/agenda?b=${A}&data=${today}&view=day`);
  await page.locator('[data-agenda-column]').first().waitFor();
  // O cartão do agendamento é o evento real da grade (sem atalho paralelo).
  const card = page.locator('button.ag-event').filter({ hasText: 'Mel' }).filter({ hasText: time }).first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.getByRole('heading', { name: 'Detalhe do agendamento', exact: true }).waitFor();
}

try {
  // ── 1 · FLUXO CANÔNICO: Agenda → chegada → iniciar → workspace ──
  const p = await login('owner.f1a@godoutor.local');
  await openBooking(p, '14:00');
  ok('Agenda aberta e detalhe do agendamento real');

  await p.getByRole('button', { name: 'Registrar chegada' }).click();
  await p.getByText('Chegada registrada.').waitFor();
  ok('Check-in pela UI (etapa operacional preservada)');

  await p.getByRole('button', { name: 'Iniciar atendimento' }).click();
  await p.waitForURL(/\/atendimento\/[0-9a-f-]{36}/);
  const encounterId = new URL(p.url()).pathname.split('/').pop();
  assert.match(encounterId, /^[0-9a-f-]{36}$/);
  ok(`Iniciar atendimento → rota canônica /atendimento/${encounterId}`);

  // ── 2 · HEADER CONTEXTUAL do workspace (protagonista = PET) ──
  const header = p.locator('.encounter-workspace__header');
  await header.waitFor();
  const h1 = (await p.locator('.encounter-workspace__patient').innerText()).trim();
  assert.equal(h1, 'Mel');
  const subtitle = await p.locator('.encounter-workspace__subtitle').innerText();
  assert.match(subtitle, /Cachorro/);
  assert.match(subtitle, /SRD/);
  assert.match(await p.locator('.encounter-workspace__tutor').innerText(), /Tutor: Isabelle Tutora QA/);
  const meta = await p.locator('.encounter-workspace__meta').innerText();
  assert.match(meta, /Consulta dermatológica/);
  assert.match(meta, /Michelle/);
  assert.match(meta, /\d{2}\/\d{2}\/\d{4}/);
  assert.equal((await p.locator('.encounter-workspace__header').getByText('EM ATENDIMENTO').count()), 1);
  assert.equal(await p.locator(`[data-encounter-id="${encounterId}"]`).count(), 1);
  ok('Header: PET em destaque, tutor secundário, serviço/profissional/data e EM ATENDIMENTO');

  // F1A não tem aba morta: só a seção real é renderizada.
  assert.equal(await p.locator('.encounter-workspace__nav').count(), 0);
  assert.equal(await p.locator('.encounter-workspace__section').count(), 1);
  ok('Nenhuma aba decorativa: só a seção real (Atendimento) é renderizada');

  // ── 2a · O NÚCLEO é só o núcleo: nada de F1B/F1C entrou aqui ──
  const bodyText = await p.locator('main.encounter-workspace').innerText();
  for (const forbidden of ['Preencher anamnese', 'Arquivos', 'Registrar pagamento', 'Reabrir para editar', 'Agendar retorno']) {
    assert.ok(!bodyText.includes(forbidden), `módulo fora do escopo no workspace: ${forbidden}`);
    assert.equal(await p.getByText(forbidden, { exact: false }).count(), 0, `achou "${forbidden}"`);
  }
  // E os campos do núcleo estão todos lá, com os rótulos oficiais.
  for (const label of ['O que o cliente procurou', 'O que foi feito', 'Orientações para o cliente', 'Retorno sugerido', 'Anotação interna', 'Etiquetas']) {
    assert.ok(bodyText.includes(label), `campo do núcleo ausente: ${label}`);
  }
  ok('Workspace = núcleo clínico: sem anamnese/arquivos/pagamento/reabrir, com os 6 campos');

  // Confere a TELA (não só o texto): a seção está visível, com área real, e
  // os controles do núcleo são exatamente os 6 campos aprovados.
  const shape = await p.evaluate(() => {
    const section = document.querySelector('.encounter-workspace__section');
    const box = section?.getBoundingClientRect();
    return {
      visible: !!box && box.width > 0 && box.height > 0,
      textareas: section?.querySelectorAll('textarea').length || 0,
      inputs: section?.querySelectorAll('input').length || 0,
      footer: !!document.querySelector('.encounter-page__footer .encounter-page__save-state')?.textContent?.trim(),
    };
  });
  assert.ok(shape.visible, 'a seção do núcleo ocupa área real na tela');
  assert.equal(shape.textareas, 4, '4 campos longos (queixa, evolução, orientações, anotação interna)');
  assert.equal(shape.inputs, 2, '2 campos curtos (retorno sugerido e etiquetas)');
  assert.ok(shape.footer, 'indicador de persistência visível no rodapé');
  ok('Tela conferida: 6 controles do núcleo, área real e indicador de salvamento');

  // ── 2b · CONTRATO DE UI: área de trabalho, não muro de cards ──
  const ui = await p.evaluate(() => {
    const header = document.querySelector('.encounter-workspace__header');
    const nodes = [...document.querySelectorAll('.encounter-workspace, .encounter-workspace *')];
    return {
      position: getComputedStyle(header).position,
      gradients: nodes.filter((n) => getComputedStyle(n).backgroundImage.includes('gradient')).length,
      shadows: nodes.filter((n) => {
        const b = getComputedStyle(n).boxShadow;
        return b !== 'none' && !/inset/.test(b) && parseFloat(b.split('px')[2] || '0') > 8;
      }).length,
      back: !!document.querySelector('.encounter-workspace__back'),
    };
  });
  assert.equal(ui.position, 'sticky', 'cabeçalho contextual persistente');
  assert.equal(ui.gradients, 0, 'nenhum gradiente decorativo');
  assert.equal(ui.shadows, 0, 'nenhum glow decorativo');
  assert.ok(ui.back, 'ação de saída sempre visível');
  ok('UI: cabeçalho fixo, sem gradiente/glow, área de trabalho limpa');

  // ── 3 · SAIR → F5 → VOLTAR → RETOMAR (mesmo encounterId) ──
  await p.goto(`${base}/dashboard?b=${A}`);
  const workspaceUrl = `${base}/atendimento/${encounterId}?b=${A}`;
  await p.goto(workspaceUrl);
  await p.reload(); // F5 na rota canônica
  await p.locator(`[data-encounter-id="${encounterId}"]`).waitFor();
  ok('F5 na URL direta: MESMO atendimento (persistência real)');

  await openBooking(p, '14:00');
  await p.getByRole('button', { name: 'Retomar atendimento' }).click();
  await p.waitForURL(new RegExp(encounterId));
  assert.equal(new URL(p.url()).pathname.split('/').pop(), encounterId);
  ok('Retomar atendimento: MESMO encounterId (sem duplicação)');

  // Repetir o start pelo endpoint canônico: idempotente.
  const repeat = await p.evaluate(async ({ biz, bookingId }) => {
    const r = await fetch('/api/encounters/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: biz, bookingId }),
    });
    return { status: r.status, data: await r.json() };
  }, { biz: A, bookingId: 'bk-mel' });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.data.created, false);
  assert.equal(repeat.data.outcome, 'resumed');
  assert.equal(repeat.data.encounterId, encounterId);
  ok('start repetido: idempotente (created=false, mesmo id)');

  // Concorrência: duas chamadas simultâneas → um só atendimento.
  const concurrent = await p.evaluate(async ({ biz, bookingId }) => {
    const call = () => fetch('/api/encounters/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: biz, bookingId }),
    }).then((r) => r.json());
    const [a, b] = await Promise.all([call(), call()]);
    return { a: a.encounterId, b: b.encounterId, createdA: a.created, createdB: b.created };
  }, { biz: A, bookingId: 'bk-mel' });
  assert.equal(concurrent.a, concurrent.b);
  assert.equal(concurrent.a, encounterId);
  assert.equal(concurrent.createdA, false);
  assert.equal(concurrent.createdB, false);
  ok('Chamadas concorrentes: nenhuma duplicação');

  const total = await p.evaluate(async ({ biz, id }) => {
    const r = await fetch(`/api/encounters?businessId=${encodeURIComponent(biz)}&id=${encodeURIComponent(id)}`);
    const d = await r.json();
    return { status: r.status, startedAt: d.encounter?.startedAt, petId: d.encounter?.petId };
  }, { biz: A, id: encounterId });
  assert.equal(total.status, 200);
  assert.ok(String(total.startedAt).startsWith(today));
  assert.equal(total.petId, 'pet-mel');
  ok('GET por id: mesmo registro com startedAt e paciente preservados');

  await p.goto(workspaceUrl);
  await p.locator('.encounter-workspace__header').waitFor();
  await p.screenshot({ path: '.cache/f1a/workspace-1440.png', fullPage: false });
  ok('Screenshot desktop 1440');

  // ── 3b · INVARIANTE: Owner + agendamento SEM profissional não inicia ──
  await openBooking(p, '16:30');
  await p.getByRole('button', { name: 'Iniciar atendimento' }).click();
  await p.getByRole('heading', { name: /Não foi possível abrir o atendimento/i }).waitFor();
  const refusal = await p.locator('div.ws-panel[role=alert]').innerText();
  assert.match(refusal, /Defina o profissional responsável antes de iniciar o atendimento\./);
  assert.ok(!/\/atendimento\/[0-9a-f-]{36}/.test(p.url()), 'não navegou: não criou atendimento');
  const orphan = await p.evaluate(async ({ biz, bookingId }) => {
    const r = await fetch(`/api/encounters?businessId=${encodeURIComponent(biz)}&bookingId=${encodeURIComponent(bookingId)}`);
    const d = await r.json();
    return { status: r.status, total: (d.encounters || []).length };
  }, { biz: A, bookingId: 'bk-sem-prof' });
  assert.equal(orphan.status, 200);
  assert.equal(orphan.total, 0, 'nenhum atendimento órfão foi criado');
  ok('Owner + agendamento SEM profissional: recusa humana e zero atendimento criado');

  // ── 3c · LEGADO PRESERVADO: o registro completo continua existindo ──
  await p.goto(`${base}/atendimento/${encounterId}/registro?b=${A}`);
  await p.locator('.encounter-page').waitFor();
  const legacyText = await p.locator('.encounter-page').innerText();
  assert.match(legacyText, /Conduta|Foi ao veterinário|O que foi feito/);
  assert.match(legacyText, /Finalizar atendimento/);       // finalização NÃO foi apagada do sistema
  ok('Registro completo (legado) preservado em /atendimento/<id>/registro');

  // O caminho que JÁ EXISTIA: histórico do Cliente 360 → registro completo.
  const ddmmyyyy = (() => { const [y, m, d] = today.split('-'); return `${d}/${m}/${y}`; })();
  await p.goto(`${base}/clientes/contact%3Act-isabelle?b=${A}`);
  await p.getByRole('tab', { name: /Atendimento/ }).click();
  await p.locator('button').filter({ hasText: ddmmyyyy }).first().click();
  await p.waitForURL(/\/atendimento\/[0-9a-f-]{36}\/registro/);
  await p.locator('.encounter-page').waitFor();       // a tela carregou de verdade
  const legacyFromHistory = await p.locator('.encounter-page').innerText();
  assert.match(legacyFromHistory, /Finalizar atendimento/);   // nada foi apagado
  ok('Histórico (Cliente 360) abre o registro completo — caminho antigo preservado');

  // ── 3d · SAIR SÓ DEPOIS DE GRAVAR: o texto clínico não pode se perder ──
  // Regra canônica: (A) tenta gravar; (B) gravou → sai; (C) falhou → NÃO sai,
  // fica no atendimento, mostra erro humano e mantém tudo que foi digitado.
  const EVOLUTION = 'textarea[placeholder^="Registre o que foi realizado"]';
  const workspacePath = `/atendimento/${encounterId}`;
  const PATH_PATCH = '**/api/encounters**';
  const stamp = () => Date.now().toString(36).slice(-5);

  async function openWorkspace(page) {
    await page.goto(workspaceUrl);
    await page.locator('.encounter-workspace__header').waitFor();
    await page.locator(EVOLUTION).waitFor();
  }
  const samePath = () => new URL(p.url()).pathname;
  /** Entrada pela UI (histórico real de SPA): o Back do navegador é same-document. */
  async function resumeWorkspace(page) {
    await openBooking(page, '14:00');
    await page.getByRole('button', { name: 'Retomar atendimento' }).click();
    await page.waitForURL(new RegExp(encounterId));
    await page.locator(EVOLUTION).waitFor();
  }

  // (1) SUCESSO: grava no ato de sair — antes mesmo do autosave (1s).
  const t1 = `Evolução gravada na saída ${stamp()}`;
  await openWorkspace(p);
  await p.locator(EVOLUTION).fill(t1);
  await p.locator('.encounter-workspace__back').click();      // sair < 1s do autosave
  await p.waitForURL(/\/agenda/);
  await openWorkspace(p);
  assert.equal((await p.locator(EVOLUTION).inputValue()).trim(), t1);
  ok('SAIR COM SUCESSO: grava no ato de sair (antes do autosave) e o texto volta inteiro');

  // (2) FALHA DE REDE: PATCH abortado → NÃO sai, texto intacto, volta do navegador
  // também barrada; com a rede de volta, o retry grava e aí sim sai.
  const t2 = `Texto que não pode sumir ${stamp()}`;
  await resumeWorkspace(p);                                // histórico SPA (Back real)
  await p.locator(EVOLUTION).fill(t2);
  await p.route(PATH_PATCH, async (route) => {
    if (route.request().method() === 'PATCH') { result.aborted.push(route.request().url()); await route.abort('failed'); return; }
    await route.continue();
  });
  await p.locator('.encounter-workspace__back').click();
  await p.locator('p.encounter-core__error').waitFor();
  assert.equal(samePath(), workspacePath, 'falhou o save e a tela SAIU mesmo assim');
  assert.equal((await p.locator(EVOLUTION).inputValue()).trim(), t2, 'o texto digitado sumiu');
  assert.match(await p.locator('p.encounter-core__error').innerText(), /não foi possível|não foi possivel|conectar|servidor/i);
  // Sem modal automático: a tela segue utilizável; sair sem gravar é escolha EXPLÍCITA.
  assert.equal(await p.locator('.overlay-confirm[role=alertdialog]').count(), 0);
  assert.equal(await p.getByRole('button', { name: 'Sair sem salvar' }).count(), 1);
  // Botão voltar do navegador: MESMA guarda, mesma recusa (histórico same-document).
  await p.evaluate(() => window.history.back());
  await p.waitForTimeout(700);
  assert.equal(samePath(), workspacePath, 'o Back do navegador furou a guarda');
  assert.equal((await p.locator(EVOLUTION).inputValue()).trim(), t2);
  // Link do menu lateral: MESMO contrato (o guarda central pergunta ao núcleo).
  await p.locator('aside a[href^="/clientes"]').first().click();
  await p.waitForTimeout(600);
  assert.equal(samePath(), workspacePath, 'o link do menu lateral furou a guarda');
  assert.equal((await p.locator(EVOLUTION).inputValue()).trim(), t2);
  // F5 / fechar a aba com texto pendente: proteção NATIVA (beforeunload) e nada
  // se perde — o diálogo do navegador é recusado e a tela fica exatamente como está.
  let nativeGuard = false;
  p.once('dialog', async (d) => { nativeGuard = d.type() === 'beforeunload'; await d.dismiss(); });
  await p.reload({ timeout: 5000 }).catch(() => {});       // recusado pelo beforeunload
  await p.waitForTimeout(400);
  assert.ok(nativeGuard, 'F5 com texto pendente NÃO avisou (beforeunload ausente)');
  assert.equal(samePath(), workspacePath, 'o F5 furou a guarda');
  assert.equal((await p.locator(EVOLUTION).inputValue()).trim(), t2, 'o F5 levou o texto');
  await p.unroute(PATH_PATCH);
  // Rede volta: retry pela MESMA ação de saída.
  await p.locator('.encounter-workspace__back').click();
  await p.waitForURL(/\/agenda/);
  await openWorkspace(p);
  assert.equal((await p.locator(EVOLUTION).inputValue()).trim(), t2);
  ok('FALHA DE REDE: não sai (Voltar, Back e link do menu), texto preservado, erro na tela; retry grava e sai');
  ok('F5/fechar com texto pendente: beforeunload nativo avisa, a tela fica e nada se perde');

  // (3) CONFLITO 409 REAL (outra tela gravou primeiro): não sai, não sobrescreve.
  const t3 = `Texto local em conflito ${stamp()}`;
  await openWorkspace(p);
  const bump = await p.evaluate(async ({ biz, id }) => {
    const read = await fetch(`/api/encounters?businessId=${encodeURIComponent(biz)}&id=${encodeURIComponent(id)}`).then((r) => r.json());
    const r = await fetch('/api/encounters', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, businessId: biz, expectedVersion: read.encounter.version, evolution: 'Outra tela gravou primeiro.' }),
    });
    return { status: r.status };
  }, { biz: A, id: encounterId });
  assert.equal(bump.status, 200, 'o “outro usuário” conseguiu gravar (base do conflito)');
  await p.locator(EVOLUTION).fill(t3);
  await p.locator('.encounter-workspace__back').click();
  const conflict = p.locator('.encounter-core__conflict');
  await conflict.waitFor();
  assert.equal(samePath(), workspacePath, 'conflito 409 e a tela saiu assim mesmo');
  assert.equal((await p.locator(EVOLUTION).inputValue()).trim(), t3, 'o texto local foi perdido no conflito');
  const conflictText = await conflict.innerText();
  assert.match(conflictText, /Este atendimento foi alterado em outra tela\. Suas alterações ainda não foram salvas\./);
  assert.equal(await p.getByRole('button', { name: 'Continuar editando' }).count(), 1);
  assert.equal(await p.getByRole('button', { name: 'Recarregar versão atual' }).count(), 1);
  ok('CONFLITO 409 REAL: não sai, não sobrescreve, texto local intacto e 2 saídas explícitas');

  // “Recarregar versão atual” = escolha EXPLÍCITA: adota o servidor e libera a saída.
  await p.getByRole('button', { name: 'Recarregar versão atual' }).click();
  await p.waitForFunction((sel) => document.querySelector(sel)?.value?.startsWith('Outra tela gravou primeiro.'), EVOLUTION, { timeout: 8000 });
  assert.equal(await conflict.count(), 0, 'bloco de conflito não fechou');
  await p.locator('.encounter-workspace__back').click();
  await p.waitForURL(/\/agenda/);
  ok('“Recarregar versão atual”: adota o servidor por escolha explícita e a saída volta a funcionar');

  // (4) SAVE LENTO: sucesso → a saída ESPERA a gravação terminar; falha → fica.
  const t4 = `Texto com gravação lenta ${stamp()}`;
  await openWorkspace(p);
  await p.locator(EVOLUTION).fill(t4);
  await p.route(PATH_PATCH, async (route) => {
    if (route.request().method() === 'PATCH') await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const slowStart = Date.now();
  await p.locator('.encounter-workspace__back').click();
  await p.waitForURL(/\/agenda/, null, { timeout: 20000 });
  assert.ok(Date.now() - slowStart >= 1200, 'a saída não esperou o save devagar');
  await p.unroute(PATH_PATCH);
  await openWorkspace(p);
  assert.equal((await p.locator(EVOLUTION).inputValue()).trim(), t4);
  ok('SAVE LENTO COM SUCESSO: a saída espera a gravação terminar e o texto chega inteiro');

  const t5 = `Texto com gravação lenta que falha ${stamp()}`;
  await openWorkspace(p);
  await p.locator(EVOLUTION).fill(t5);
  inducedMode = { statuses: [500] };
  await p.route(PATH_PATCH, async (route) => {
    if (route.request().method() === 'PATCH') {
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"induzido pela QA"}' });
      return;
    }
    await route.continue();
  });
  await p.locator('.encounter-workspace__back').click();
  await p.locator('p.encounter-core__error').waitFor();
  assert.equal(samePath(), workspacePath, '500 devagar e a tela saiu assim mesmo');
  assert.equal((await p.locator(EVOLUTION).inputValue()).trim(), t5, 'o texto foi perdido no 500');
  await p.unroute(PATH_PATCH);
  inducedMode = null;
  await p.locator(EVOLUTION).fill('');                    // volta ao que está gravado
  await p.locator('.encounter-workspace__back').click();
  await p.waitForURL(/\/agenda/);
  ok('SAVE LENTO COM FALHA (500 induzido): não sai, texto preservado, erro na tela');

  await p.context().close();

  // ── 4 · MOBILE 390 ──
  const m = await login('owner.f1a@godoutor.local', { width: 390, height: 844 });
  await m.goto(workspaceUrl);
  await m.locator('.encounter-workspace__header').waitFor();
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `overflow horizontal: ${overflow}px`);
  await m.screenshot({ path: '.cache/f1a/workspace-390.png', fullPage: false });
  ok('Mobile 390: workspace sem rolagem horizontal');
  await m.context().close();

  // ── 5 · PROFISSIONAL autorizado (vínculo real, não e-mail) ──
  const pro = await login('michelle.f1a@godoutor.local');
  await pro.goto(workspaceUrl);
  await pro.locator(`[data-encounter-id="${encounterId}"]`).waitFor();
  assert.match(await pro.locator('.encounter-workspace__meta').innerText(), /Michelle/);
  ok('Profissional vinculado: lê e retoma o próprio atendimento');

  // Profissional + agendamento SEM profissional: assume o PRÓPRIO vínculo
  // (nunca o primeiro da lista, nunca o e-mail de quem abriu).
  const own = await pro.evaluate(async ({ biz, bookingId }) => {
    const r = await fetch('/api/encounters/start', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId: biz, bookingId }),
    });
    return { status: r.status, data: await r.json() };
  }, { biz: A, bookingId: 'bk-sem-prof' });
  assert.equal(own.status, 200);
  assert.equal(own.data.created, true);
  assert.equal(own.data.encounter.professionalId, 'pro-michelle');
  assert.equal(own.data.encounter.context.professional.name, 'Michelle');
  assert.equal(own.data.encounter.createdBy !== own.data.encounter.professionalId, true);
  ok('Profissional + agendamento sem dono: resolve para o PRÓPRIO profissional');
  await pro.context().close();

  // ── 6 · RECEPÇÃO não ganha acesso clínico ──
  const rec = await login('recepcao.f1a@godoutor.local');
  await rec.goto(workspaceUrl);
  await rec.getByRole('heading', { name: /permissão|área/i }).first().waitFor();
  const recBody = await rec.locator('body').innerText();
  assert.ok(/não inclui a área|Sem permissão/i.test(recBody), recBody.slice(0, 200));
  assert.ok(!recBody.includes('Isabelle'), 'Recepção não vê dado clínico');
  // O registro completo (legado) tem a MESMA guarda: nada muda por ser legado.
  await rec.goto(`${base}/atendimento/${encounterId}/registro?b=${A}`);
  await rec.getByRole('heading', { name: /permissão|área/i }).first().waitFor();
  assert.ok(!(await rec.locator('body').innerText()).includes('Isabelle'), 'Recepção não vê o registro completo');
  ok('Recepção: bloqueada no workspace E no registro completo (403 sem vazar dado)');
  await rec.context().close();

  // ── 7 · CROSS-TENANT (outra unidade) ──
  const out = await login('fora.f1a@godoutor.local');
  await out.goto(workspaceUrl);
  await out.getByRole('heading', { name: /Atendimento não encontrado|não foi possível abrir/i }).first().waitFor();
  const outBody = await out.locator('body').innerText();
  assert.ok(!outBody.includes('Isabelle') && !outBody.includes('Mel'), 'cross-tenant vazou dado');
  ok('Outra unidade: URL direta bloqueada, sem vazar o atendimento');
  await out.context().close();

  // ── 8 · REDE/CONSOLE ──
  // Os 403/404 de PROVA DE BLOQUEIO (permissão / cross-tenant) também aparecem como
  // "Failed to load resource" no console do Chromium: cada um é casado com a resposta
  // esperada correspondente (mesmo status) antes de sobrar erro de verdade.
  const unexpectedConsole = [];
  const inducedLeft = [...result.induced];      // 500/409/503 que a própria QA provocou
  const abortedLeft = [...result.aborted];      // PATCH abortado de propósito (sem status)
  for (const message of result.console) {
    const status = message.match(/status of (\d{3})/)?.[1];
    const byProof = status ? result.expected.findIndex((e) => String(e.status) === status) : -1;
    const byInduced = status ? inducedLeft.findIndex((e) => String(e.status) === status) : -1;
    const inducedNetwork = /net::ERR|Failed to fetch|ERR_FAILED/i.test(message);
    if (byProof >= 0) result.expected.splice(byProof, 1);
    else if (byInduced >= 0) inducedLeft.splice(byInduced, 1);
    else if (inducedNetwork && abortedLeft.length > 0) abortedLeft.pop();
    else unexpectedConsole.push(message);
  }
  const fiveXx = [...result.network, ...result.expected].filter((r) => r.status >= 500);
  assert.equal(unexpectedConsole.length, 0, JSON.stringify(unexpectedConsole));
  assert.equal(result.network.length, 0, JSON.stringify(result.network));
  assert.equal(fiveXx.length, 0, JSON.stringify(fiveXx));
  ok(`Console 0 erro · network >=400 inesperado 0 · 5xx 0 (provas deliberadas: ${result.expected.length} × 403/404/409 + ${result.induced.length + result.aborted.length} falhas induzidas pela QA)`);
} finally {
  await fs.writeFile('.cache/f1a/browser-report.json', JSON.stringify(result, null, 2));
  await browser.close();
}
