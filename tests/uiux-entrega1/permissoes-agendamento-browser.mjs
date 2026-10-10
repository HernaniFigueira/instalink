// ═══════════════════════════════════════════════════════════════
// ENTREGA 1 · MATRIZ DE PERMISSÕES NA CRIAÇÃO DE AGENDAMENTO (POST /api/bookings)
// ═══════════════════════════════════════════════════════════════
// Cada papel faz o POST real (asOwner:true, o mesmo payload do Quick Create) pelo
// navegador, logado com a própria conta. Esperado:
//   • OWNER, ADMIN, Recepção (SECRETARIA padrão), PROFISSIONAL (própria agenda) → criam;
//   • VIEWER, VENDEDOR, Recepção com agenda:false → 403 (sem permissão de agenda);
//   • usuário de OUTRA unidade → 401/403 (sem acesso a este negócio);
//   • sem sessão com asOwner → 401; público (sem asOwner) enviando petId → 403.
// E a validação do pet continua obrigatória para quem cria:
//   • pet de outro tutor → 400; pet de outra unidade → 400; 2+ pets sem escolha → 400.
// Rodar: QA_EXECUTABLE_PATH=<chromium> LD_LIBRARY_PATH=... node tests/uiux-entrega1/permissoes-agendamento-browser.mjs
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3000';
if (process.env.DATABASE_URL) throw Error('DATABASE_URL must be absent (QA local descartável).');
if (!['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw Error('QA local apenas.');

const A = 'f1b1-vet-qa';
const password = 'GodoutorF1B12026!';
const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
  .format(new Date(Date.now() + 24 * 3600 * 1000));

const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
if (process.env.QA_EXECUTABLE_PATH) options.executablePath = process.env.QA_EXECUTABLE_PATH;
const browser = await chromium.launch(options);
const ok = (label) => console.log('PASS', label);
const results = [];
const record = (label) => { results.push(label); ok(label); };

async function login(page, email) {
  await page.goto(`${base}/login`);
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[type=password]').fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
}

// POST real com o payload do Quick Create (asOwner:true). `page` já logada (ou anônima).
const post = (page, body) => page.evaluate(async (body) => {
  const res = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}, body);

const base_ = (over) => ({
  businessId: A, asOwner: true, serviceId: 'svc-derma', professionalId: 'pro-michelle',
  date: tomorrow, customerName: 'Tutor Único QA', customerPhone: '11988880002',
  contactId: 'ct-unico', petId: 'pet-bidu', ...over,
});

const ctxOf = async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  return { context, page: await context.newPage() };
};

try {
  // ── 1 · PAPÉIS QUE PODEM CRIAR ──────────────────────────────────────────
  const allowed = [
    ['owner.f1b1@godoutor.local', 'OWNER', '10:00', 'pro-michelle'],
    ['admin.f1b1@godoutor.local', 'ADMIN', '10:30', 'pro-michelle'],
    ['recepcao.f1b1@godoutor.local', 'SECRETARIA (Recepção padrão)', '11:00', 'pro-michelle'],
    ['michelle.f1b1@godoutor.local', 'PROFISSIONAL (própria agenda)', '11:30', 'pro-michelle'],
  ];
  for (const [email, role, time, pro] of allowed) {
    const { context, page } = await ctxOf();
    await login(page, email);
    const r = await post(page, base_({ time, professionalId: pro, contactId: 'ct-unico', petId: 'pet-bidu' }));
    assert.ok(r.status >= 200 && r.status < 300, `${role} deve criar agendamento (HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 160)})`);
    record(`PERMITIDO · ${role} cria agendamento com pet (HTTP ${r.status})`);
    await context.close();
  }

  // ── 2 · PAPÉIS QUE NÃO PODEM CRIAR ─────────────────────────────────────
  const denied = [
    ['visualizador.f1b1@godoutor.local', 'VIEWER (somente leitura)'],
    ['vendedor.f1b1@godoutor.local', 'VENDEDOR (sem agenda)'],
    ['semagenda.f1b1@godoutor.local', 'Recepção com agenda:false (override)'],
  ];
  for (const [email, role] of denied) {
    const { context, page } = await ctxOf();
    await login(page, email);
    const r = await post(page, base_({ time: '16:00', professionalId: 'pro-michelle' }));
    assert.equal(r.status, 403, `${role} deve ser recusado com 403 (HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 160)})`);
    assert.match(r.json.error || "", /permiss|visualização|bloqueadas/i, `${role}: motivo de bloqueio (${JSON.stringify(r.json)})`);
    record(`RECUSADO · ${role} → 403 "${r.json.error}"`);
    await context.close();
  }

  // ── 3 · OUTRA UNIDADE ──────────────────────────────────────────────────
  {
    const { context, page } = await ctxOf();
    await login(page, 'fora.f1b1@godoutor.local');
    const r = await post(page, base_({ time: '10:30' }));
    assert.ok([401, 403].includes(r.status), `dono de OUTRA unidade não cria na unidade A (HTTP ${r.status})`);
    record(`RECUSADO · dono de outra unidade → HTTP ${r.status} "${r.json.error}"`);
    await context.close();
  }

  // ── 4 · SEM SESSÃO ─────────────────────────────────────────────────────
  {
    const { context, page } = await ctxOf();
    await page.goto(`${base}/login`);
    const r1 = await post(page, base_({ time: '11:00' }));
    assert.equal(r1.status, 401, `anônimo com asOwner → 401 (HTTP ${r1.status})`);
    record(`RECUSADO · sem sessão com asOwner → 401`);
    const r2 = await post(page, base_({ asOwner: false, time: '11:30' }));
    assert.equal(r2.status, 403, `público (sem asOwner) com petId → 403 (HTTP ${r2.status})`);
    assert.match(r2.json.error || '', /Escolha de pet exige permissão/, `motivo: ${JSON.stringify(r2.json)}`);
    record(`RECUSADO · público enviando petId → 403 "${r2.json.error}" (nunca descarta em silêncio)`);
    await context.close();
  }

  // ── 5 · VALIDAÇÃO DO PET CONTINUA OBRIGATÓRIA PARA QUEM PODE CRIAR ─────
  {
    const { context, page } = await ctxOf();
    await login(page, 'recepcao.f1b1@godoutor.local');
    const other = await post(page, base_({ time: '12:00', contactId: 'ct-isabelle', petId: 'pet-bidu' }));
    assert.equal(other.status, 400, `Recepção: pet de OUTRO tutor → 400 (HTTP ${other.status})`);
    assert.equal(other.json.error, 'Este pet não pertence ao tutor selecionado.');
    record('VALIDAÇÃO · Recepção com pet de outro tutor → 400 "Este pet não pertence ao tutor selecionado."');
    const otherUnit = await post(page, base_({ time: '12:30', petId: 'pet-outra-b' }));
    assert.equal(otherUnit.status, 400, `Recepção: pet de outra unidade → 400 (HTTP ${otherUnit.status})`);
    assert.equal(otherUnit.json.error, 'Pet não encontrado nesta unidade.');
    record('VALIDAÇÃO · Recepção com pet de outra unidade → 400 "Pet não encontrado nesta unidade."');
    const noPet = await post(page, base_({ time: '13:00', contactId: 'ct-isabelle', petId: undefined }));
    assert.equal(noPet.status, 400, `Recepção: tutora com 2 pets sem escolha → 400 (HTTP ${noPet.status})`);
    assert.match(noPet.json.error || '', /selecione o pet/i);
    record('VALIDAÇÃO · Recepção, tutora com 2 pets sem escolha → 400 "selecione o pet…"');
    await context.close();
  }

  // ── 6 · PERSISTÊNCIA: a criação permitida gravou o pet do tutor certo ──
  {
    const { context, page } = await ctxOf();
    await login(page, 'owner.f1b1@godoutor.local');
    const list = await page.evaluate(async ({ businessId }) => {
      const r = await fetch(`/api/bookings?businessId=${businessId}&mode=patient&petId=pet-bidu`);
      return r.json();
    }, { businessId: A });
    const bookings = list.bookings || list.items || [];
    assert.ok(bookings.length >= 1 && bookings.every((b) => b.petId === 'pet-bidu'), `agendamentos do Bidu gravados (${bookings.length})`);
    record(`PERSISTÊNCIA · ${bookings.length} agendamento(s) do Bidu gravados com petId=pet-bidu; nenhum pet de outro tutor`);
    await context.close();
  }

  console.log(`PERMISSÕES: ${results.length} verificações PASS. data=${tomorrow}`);
} catch (err) {
  console.log('FAIL', err.message.split('\n')[0]);
  process.exitCode = 1;
} finally {
  await browser.close();
}
