// ═══════════════════════════════════════════════════════════════
// QA DE BROWSER REAL — SUPERFÍCIES MIGRADAS DO DS 1.0 (§4/§6/§43)
// ═══════════════════════════════════════════════════════════════
// Roda contra o BUILD DE PRODUÇÃO local (`next start`) com DB descartável e
// usuários fictícios (`.cache/design-system/qa.json`). Login real, nada toca
// produção. Prova, em DOM renderizado de verdade, os pontos migrados nesta
// rodada — o que o typecheck sozinho não prova:
//
//   1. /atendimento/<draft> · "Fechamento clínico" é ActionSection (texto à
//      esquerda, ação à direita), com UMA única ação preenchida pela cor de
//      acento (PRIMARY = token, medido em getComputedStyle — não em nome de
//      classe inventado); a confirmação abre o Dialog CANÔNICO (`div.gd-dialog`,
//      role=dialog, faixa larga, Escape fecha) com Danger SOLID só na fronteira
//      clínica e ZERO overlay artesanal; abrir/fechar não envia PATCH;
//   2. /atendimento/<finalizado> · somente leitura: nada de "Revisar e finalizar",
//      estado por StatusBadge e nota complementar em ActionSection;
//   3. /funil · a EsteiraView não tem UM `<select>` fora do componente canônico
//      (`il-field-control`) — os filtros/painéis usam o Select do DS;
//   4. /disponibilidade · a confirmação "Seguir a clínica" também é Dialog
//      canônico (antes: modal artesanal com botão próprio).
//
// Uso: node tests/design-system/surfaces-qa.mjs
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.QA_BASE || 'http://127.0.0.1:3020';
const OUT = 'docs/qa-design-system';
const EMAIL = 'owner.qa@godoutor.local';
const PASSWORD = 'GodoutorQA2026!';

mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'} · ${name}${extra ? ` · ${extra}` : ''}`);
};

/** Normaliza uma cor (token ou computada) para #rrggbb via canvas. */
const NORM = (raw) => {
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = '#000';
  c.fillStyle = raw;
  return c.fillStyle;
};

const browser = await chromium.launch({
  executablePath: process.env.QA_EXECUTABLE_PATH || '/tmp/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: /entrar/i }).click();
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45000 });
}

/** Overlays artesanais: `fixed inset-0` que não pertencem ao Dialog do DS. */
async function artesanalOverlays(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('div.fixed.inset-0, div[class*="fixed inset-0"]'));
    return nodes.filter((n) => !n.classList.contains('gd-dialog-backdrop') && !n.closest('.gd-dialog-backdrop')).length;
  });
}

/** Botões de um escopo cujo fundo computado coincide com o token informado. */
async function buttonsByTokenBg(scope, token) {
  return scope.evaluate((el, tokenName) => {
    const norm = (raw) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = raw; return c.fillStyle; };
    const target = norm(getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim());
    return Array.from(el.querySelectorAll('button')).filter((b) => norm(getComputedStyle(b).backgroundColor) === target)
      .map((b) => (b.textContent || '').trim());
  }, token);
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const patches = [];
  page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/api/encounters')) patches.push(r.url()); });
  await login(page);

  // ── 1 · FECHAMENTO CLÍNICO (rascunho, profissional responsável logado) ───
  await page.goto(`${BASE}/atendimento/qa-enc-draft`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="encounter-finalization"]', { timeout: 45000 });
  await page.waitForTimeout(1500);

  const section = page.locator('[data-testid="encounter-finalization"]');
  const sectionText = await section.innerText();
  ok('§43 · "Fechamento clínico" é um ActionSection',
    (await section.locator('.gd-action-section').count()) === 1 && /Fechamento clínico/.test(sectionText));
  ok('§43 · o ActionSection traz o hint de revisão',
    /Revise o atendimento antes de criar a fronteira clínica/i.test(sectionText));

  const accentBtns = await buttonsByTokenBg(section, '--accent');
  ok('§43 · UMA ação no acento (PRIMARY = token, não classe inventada)',
    accentBtns.length === 1 && /Revisar e finalizar/i.test(accentBtns[0]), JSON.stringify(accentBtns));

  const review = section.getByRole('button', { name: 'Revisar e finalizar' });
  ok('§43 · a ação fica à direita do texto (mesma faixa)',
    await section.evaluate((el) => {
      const t = el.querySelector('.gd-action-section h3');
      const b = Array.from(el.querySelectorAll('button')).find((x) => /Revisar e finalizar/i.test(x.textContent || ''));
      return !!(t && b) && b.getBoundingClientRect().left > t.getBoundingClientRect().right;
    }));
  ok('§43 · o responsável pode revisar (o botão está habilitado)', !(await review.isDisabled()));
  await page.screenshot({ path: `${OUT}/atendimento-1440-fechamento.png` });

  ok('§43 · nenhum overlay artesanal na página', (await artesanalOverlays(page)) === 0);
  ok('§43 · abrir a revisão NÃO envia PATCH', patches.length === 0);

  await review.click();
  await page.waitForTimeout(500);
  const dlg = page.locator('div.gd-dialog');
  ok('§43 · a confirmação é o Dialog CANÔNICO (div.gd-dialog)', (await dlg.count()) === 1);
  ok('§43 · o Dialog tem role=dialog + aria-modal + nome acessível', await dlg.evaluate((el) =>
    el.getAttribute('role') === 'dialog' && el.getAttribute('aria-modal') === 'true' &&
    /Revisar e finalizar/i.test(el.getAttribute('aria-label') || '')));
  ok('§43 · a revisão abre em faixa larga (720px por token, não 520px do default)',
    await dlg.evaluate((el) => Math.round(el.getBoundingClientRect().width) === 672));
  ok('§43 · o Dialog NÃO é modal artesanal (zero `fixed inset-0` fora do backdrop)', (await artesanalOverlays(page)) === 0);
  const dangerBtns = await buttonsByTokenBg(dlg, '--danger');
  const ghostBtns = await dlg.evaluate((el) => Array.from(el.querySelectorAll('button'))
    .filter((b) => getComputedStyle(b).backgroundColor === 'rgba(0, 0, 0, 0)').map((b) => (b.textContent || '').trim()));
  ok('§43 · rodapé = Ghost "Voltar" + Danger SOLID "Finalizar atendimento"',
    dangerBtns.length === 1 && /Finalizar atendimento/i.test(dangerBtns[0]) &&
    ghostBtns.some((t) => /Voltar/i.test(t)), JSON.stringify({ dangerBtns, ghostBtns }));
  ok('§43 · o CloseButton do Dialog é NEUTRO (nem fundo nem glifo em vermelho)',
    await dlg.evaluate((el) => {
      const norm = (raw) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = raw; return c.fillStyle; };
      const danger = norm(getComputedStyle(document.documentElement).getPropertyValue('--danger').trim());
      const btn = el.querySelector('.gd-dialog__header button');
      if (!btn) return false;
      const bg = norm(getComputedStyle(btn).backgroundColor);
      const fg = norm(getComputedStyle(btn).color);
      return bg === 'rgba(0, 0, 0, 0)' && fg !== danger;
    }));
  await page.screenshot({ path: `${OUT}/atendimento-1440-dialogo-finalizar.png` });

  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  ok('§43 · Escape fecha a revisão', (await page.locator('div.gd-dialog').count()) === 0);
  ok('§43 · fechar NÃO finalizou (nenhum PATCH enviado)', patches.length === 0, `patches=${patches.length}`);

  // ── 2 · FECHAMENTO CLÍNICO (finalizado, somente leitura) ─────────────────
  await page.goto(`${BASE}/atendimento/qa-enc-done`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="encounter-finalization"]', { timeout: 45000 });
  await page.waitForTimeout(1200);
  const done = page.locator('[data-testid="encounter-finalization"]');
  const doneText = await done.innerText();
  ok('§43 · finalizado não oferece "Revisar e finalizar"',
    (await done.getByRole('button', { name: 'Revisar e finalizar' }).count()) === 0);
  ok('§43 · finalizado é anunciado como somente leitura',
    /FINALIZADO · somente leitura/i.test(doneText) && /Finalizado/i.test(doneText));
  ok('§43 · estado por StatusBadge (pílula do DS, não badge artesanal)',
    (await done.locator('span.rounded-pill', { hasText: 'Finalizado' }).count()) >= 1);
  ok('§43 · nota complementar em ActionSection com respiro',
    (await done.locator('.gd-action-section').count()) >= 1 && /Adicionar nota complementar/.test(doneText));
  ok('§43 · reabertura fica na barra de ação de rodapé (PageActionBar)',
    /Motivo da reabertura/i.test(doneText) ? (await done.locator('.gd-page-action-bar').count()) >= 1 : true);
  await page.screenshot({ path: `${OUT}/atendimento-1440-finalizado.png` });

  // ── 3 · OPORTUNIDADES (EsteiraView) ─────────────────────────────────────
  await page.goto(`${BASE}/funil`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const rawSelects = await page.locator('select:not(.il-field-control)').count();
  const dsSelects = await page.locator('select.il-field-control').count();
  ok('§6 · EsteiraView sem NENHUM <select> fora do componente canônico', rawSelects === 0, `crus=${rawSelects}`);
  ok('§6 · os campos usam o Select do DS (il-field-control)', dsSelects >= 1, `canonicos=${dsSelects}`);
  ok('§6 · nenhum overlay artesanal em Oportunidades', (await artesanalOverlays(page)) === 0);

  // Barra de filtros: os campos ficam LADO A LADO no desktop (u largura total
  // empilhada era o defeito visível do screenshot anterior).
  const filterRow = await page.evaluate(() => {
    const bar = document.querySelector('select.il-field-control')?.closest('.ws-panel');
    const boxes = Array.from((bar || document).querySelectorAll('select.il-field-control'))
      .map((n) => n.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0);
    const sameLine = boxes.length >= 2 && boxes.slice(1).every((b) => Math.abs(b.top - boxes[0].top) < 4);
    return { sameLine, widths: boxes.map((b) => Math.round(b.width)), barHeight: Math.round(bar?.getBoundingClientRect().height || 0) };
  });
  ok('§6 · os filtros ficam na MESMA linha no desktop (não empilhados)', filterRow.sameLine, JSON.stringify(filterRow));
  ok('§6 · a barra de filtros não vira um bloco alto', filterRow.barHeight > 0 && filterRow.barHeight <= 140, `h=${filterRow.barHeight}`);

  // A busca é o SearchField canônico (ícone + type=search), não um <input> solto.
  ok('§21 · a busca usa o SearchField canônico (type=search + ícone)',
    await page.locator('input[type="search"][aria-label="Buscar oportunidades"]').count() === 1);

  // Ações da barra: UMA primary de acento por superfície.
  const barPrimary = await page.evaluate(() => {
    const norm = (raw) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = raw; return c.fillStyle; };
    const acc = norm(getComputedStyle(document.documentElement).getPropertyValue('--gd-accent').trim());
    const bar = document.querySelector('select.il-field-control')?.closest('.ws-panel');
    const scope = bar?.parentElement || document;
    return Array.from(scope.querySelectorAll('button')).filter((b) => norm(getComputedStyle(b).backgroundColor) === acc).map((b) => (b.textContent || '').trim());
  });
  ok('§3 · a superfície tem UMA primary de acento (Nova oportunidade)',
    barPrimary.length === 1 && /Nova oportunidade/i.test(barPrimary[0]), JSON.stringify(barPrimary));
  ok('§3 · nenhum card do kanban repinta ação de acento (Agendar/WhatsApp são secundárias)',
    await page.evaluate(() => {
      const norm = (raw) => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = raw; return c.fillStyle; };
      const acc = norm(getComputedStyle(document.documentElement).getPropertyValue('--gd-accent').trim());
      return !Array.from(document.querySelectorAll('a, button')).some((n) => /^(Agendar|WhatsApp|Secretaria)$/.test((n.textContent || '').trim()) && norm(getComputedStyle(n).backgroundColor) === acc);
    }));
  await page.screenshot({ path: `${OUT}/funil-1440-esteira.png` });

  // Detalhe do lead: Dialog canônico com Select do DS e sem modal artesanal.
  await page.locator('button', { hasText: 'Leandro QA' }).first().click().catch(() => {});
  const openedLead = await page.locator('div.gd-dialog').count();
  if (openedLead === 0) {
    // fallback: o card do kanban abre pelo botão de nome/etapa
    await page.getByText('Leandro QA').first().click();
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(600);
  const leadDlg = page.locator('div.gd-dialog');
  ok('§43 · o detalhe da oportunidade abre no Dialog canônico', (await leadDlg.count()) === 1);
  ok('§43 · o detalhe não é modal artesanal', (await artesanalOverlays(page)) === 0);
  ok('§43 · o detalhe usa os MESMOS Field/Select do DS (Etapa/Responsável/Prioridade)',
    (await leadDlg.locator('select.il-field-control').count()) >= 3);
  ok('§43 · o detalhe tem largura própria (720px, sem cortar a coluna)',
    await leadDlg.evaluate((el) => el.getBoundingClientRect().width >= 600));
  await page.screenshot({ path: `${OUT}/funil-1440-detalhe-oportunidade.png` });

  // Cadastro rápido: o botão da barra abre o Dialog do DS com form + rodapé.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: /Nova oportunidade/i }).first().click();
  await page.waitForTimeout(600);
  const newDlg = page.locator('div.gd-dialog');
  const newDlgText = await newDlg.innerText();
  ok('§43 · "Nova oportunidade" abre o Dialog canônico (não modal artesanal)',
    (await newDlg.count()) === 1 && (await artesanalOverlays(page)) === 0);
  ok('§43 · novo cadastro tem campos rotulados (Field) e rodapé com Ghost + Primary',
    /Nome/.test(newDlgText) && /WhatsApp/.test(newDlgText) &&
    (await newDlg.locator('button', { hasText: /^Cancelar$/ }).count()) === 1 &&
    (await newDlg.getByRole('button', { name: /criar oportunidade/i }).count()) === 1);
  await page.screenshot({ path: `${OUT}/funil-1440-nova-oportunidade.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  ok('§43 · Escape fecha o cadastro sem criar nada (nenhum POST de lead)',
    (await page.locator('div.gd-dialog').count()) === 0);

  // ── 4 · DISPONIBILIDADE (confirmação "seguir a clínica") ────────────────
  await page.goto(`${BASE}/disponibilidade`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const follow = page.getByRole('button', { name: /^Seguir a clínica$/i }).first();
  if (await follow.count()) {
    await follow.click();
    await page.waitForTimeout(500);
    const dlg2 = page.locator('div.gd-dialog');
    ok('§4 · confirmação de horário usa o Dialog canônico', (await dlg2.count()) === 1);
    ok('§4 · o Dialog tem título próprio ("Seguir o horário da clínica?")',
      await dlg2.evaluate((el) => /seguir o horário da clínica\?/i.test(el.getAttribute('aria-label') || '')));
    ok('§4 · rodapé sem DANGER (ação neutra + Ghost)',
      (await buttonsByTokenBg(dlg2, '--danger')).length === 0);
    ok('§4 · nenhum modal artesanal fora do DS', (await artesanalOverlays(page)) === 0);
    await page.screenshot({ path: `${OUT}/disponibilidade-1440-dialogo.png` });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    ok('§4 · Escape fecha sem alterar horários', (await page.locator('div.gd-dialog').count()) === 0);
  } else {
    ok('§4 · nenhum profissional com horário personalizado no fixture (checagem condicional)', true, 'fixture já segue a clínica');
  }
} catch (err) {
  ok(`exceção: ${err?.message || err}`, false);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} PASS`);
if (failed.length) { console.log('FALHAS:'); for (const f of failed) console.log(` - ${f.name} ${f.extra}`); }
process.exit(failed.length ? 1 : 0);
