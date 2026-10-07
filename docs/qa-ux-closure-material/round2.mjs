// ═══════════════════════════════════════════════════════════════
// RODADA 2 · EVIDÊNCIA EM CHROMIUM REAL (PR #64, mesma branch)
// ═══════════════════════════════════════════════════════════════
// Os OITO fluxos pedidos na homologação, medidos e fotografados nas QUATRO
// larguras exigidas (1440 · 1366 · 1024 · 390):
//
//   1. drag-create → ESC  (a seleção tem de SAIR da grade na hora)
//   2. hover no evento    (resumo compacto, colado no bloco, SEM painel lateral)
//   3. clique no evento   (modal lateral preso à direita, altura cheia)
//   4. prévia do cliente  (MESMO padrão de modal lateral)
//   5. menu recolher/expandir (controle no rodapé + preferência persistida)
//   6. Clientes admin × não-admin (Importar/Exportar só para administração)
//   7. ações rápidas do Dashboard (sem card-dentro-de-card)
//   8. toolbar da Agenda (uma métrica, sem contorno ocioso)
//
// Uso:
//   node docs/qa-ux-closure-material/round2.mjs
// Requer: dev server local (`npm run dev`) + scripts/qa-ux-closure-fixture.mjs
// + scripts/qa-material-fixture.mjs (a fixture DS 1.1 traz o login NÃO-admin).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ensureBrowser, CHROMIUM_ARGS } from '../qa-ux-closure/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = here;
const fixture = JSON.parse(await fs.readFile(process.env.QA_UX_MATERIAL_FIXTURE || '/home/user/.cache/qa-ux/material.json', 'utf8'));
const base = process.env.DESIGN_TEST_BASE_URL || fixture.base;
const SENHA_NAO_ADMIN = 'GodoutorDS11-QA!';
const VIEWPORTS = [[1440, 900, '1440'], [1366, 768, '1366'], [1024, 768, '1024'], [390, 844, '390']];

const M = {};
const consoleErrors = [];
const ruido = [];
const respostas4xx = [];
let etapa = 'boot';
const ruidoConhecido = (t) => /ERR_CONNECTION_CLOSED|ERR_ABORTED|401 \(Unauthorized\)|session=expired|Failed to load resource: the server responded with a status of 4/.test(t);
const registrar = (t) => (ruidoConhecido(t) ? ruido : consoleErrors).push(t);

const runtime = await ensureBrowser();
const browser = await chromium.launch({
  executablePath: process.env.QA_BROWSER || runtime.executablePath,
  args: CHROMIUM_ARGS,
  env: { ...process.env, LD_LIBRARY_PATH: process.env.QA_BROWSER_LD || runtime.LD_LIBRARY_PATH },
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
const page = await context.newPage();
page.on('pageerror', (e) => registrar(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') registrar(`[${etapa}] ${m.text()}`); });
page.on('response', (r) => {
  if (r.status() >= 400) respostas4xx.push({ url: new URL(r.url()).pathname, status: r.status(), etapa });
});

const wait = (ms) => page.waitForTimeout(ms);
const shot = (name, opts = {}) => page.screenshot({ path: path.join(outDir, `${name}.png`), ...opts });
const boxOf = async (sel) => page.locator(sel).first().boundingBox().catch(() => null);
/** Executa um passo isolado: uma falha de medição não derruba a rodada inteira. */
async function step(name, fn) {
  try { await fn(); } catch (e) { M[`ERRO-${name}`] = String(e.message || e).slice(0, 300); }
}
const agendaUrl = () => `${base}/agenda?b=${fixture.b}&data=${fixture.day}&view=day`;
const clientesUrl = () => `${base}/clientes?b=${fixture.b}`;

async function login(email, password) {
  await page.goto(`${base}/login`);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL(/dashboard/, { timeout: 25000 });
  await page.waitForSelector('.workspace-sidebar', { state: 'attached' });
  await wait(500);
}

/** Geometria do painel lateral que está aberto (o CONTRATO do detalhe). */
const panelGeometry = () => page.evaluate(() => {
  const panel = document.querySelector('.gd-detail__panel');
  const dialog = document.querySelector('dialog.gd-detail');
  if (!panel) return null;
  const r = panel.getBoundingClientRect();
  const cs = getComputedStyle(panel);
  return {
    x: Math.round(r.x), y: Math.round(r.y), largura: Math.round(r.width), altura: Math.round(r.height),
    topo: Math.round(r.top), distanciaDireita: Math.round(window.innerWidth - r.right),
    raio: cs.borderTopLeftRadius, sombra: cs.boxShadow, bordaEsquerda: cs.borderLeftWidth,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    dialogClasse: dialog ? dialog.className : null,
  };
});

/** Auditoria de MENU: rótulos proibidos, chevrons, controle de largura. */
const navAudit = () => page.evaluate(() => {
  const side = document.querySelector('.workspace-sidebar');
  const painel = document.querySelector('#ws-nav-panel');
  const texto = (el) => (el ? el.textContent || '' : '');
  const proibidos = ['Produtos', 'Recursos', 'Execuções', 'contextual', 'CONTEXTUAL'];
  const presentes = proibidos.filter((p) => texto(painel).includes(p) || (!painel && texto(side).includes(p)));
  return {
    rotulosIndevidos: presentes,
    flagContextual: document.querySelectorAll('.ws-peek__flag').length,
    chevrons: side ? side.querySelectorAll('.workspace-link__chevron').length : null,
    toggle: (() => {
      const b = document.querySelector('.workspace-foot__item--collapse');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return {
        rotulo: b.getAttribute('aria-label'),
        largura: Math.round(r.width), altura: Math.round(r.height),
        x: Math.round(r.x), y: Math.round(r.y),
        noRodape: !!b.closest('.workspace-foot'),
        // Alvo de toque/mouse do DS (40px na régua MD).
        alvoOk: Math.round(r.height) >= 34,
      };
    })(),
    armazenado: (() => { try { return localStorage.getItem('godoutor-side-v2'); } catch { return null; } })(),
    larguraRail: side ? Math.round(side.getBoundingClientRect().width) : null,
  };
});

// ═══ 1 · SHELL: controle de largura, alinhamento da identidade, menu ═══
async function shell(w, tag) {
  etapa = `shell-${tag}`;
  await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
  await page.goto(`${base}/dashboard?b=${fixture.b}`);
  await page.waitForSelector('.ws-topbar');
  await wait(700);
  M[`shell-${tag}`] = await page.evaluate(() => {
    const logo = document.querySelector('.ws-clinic__logo, .ws-clinic__mark');
    const icone = document.querySelector('.workspace-sidebar .workspace-link__icon');
    const topbar = document.querySelector('.ws-topbar');
    const l = logo?.getBoundingClientRect();
    const i = icone?.getBoundingClientRect();
    const cs = logo ? getComputedStyle(logo) : null;
    return {
      topbarAltura: topbar ? Math.round(topbar.getBoundingClientRect().height) : null,
      logoAltura: l ? Math.round(l.height) : null,
      logoProporcao: l && l.height ? +(l.width / l.height).toFixed(2) : null,
      logoX: l ? Math.round(l.x) : null,
      iconeRailX: i ? Math.round(i.x) : null,
      deltaIdentidadeRail: l && i ? Math.round(l.x - i.x) : null,
      logoTemTile: cs ? { borda: cs.borderTopWidth, raio: cs.borderTopLeftRadius, fundo: cs.backgroundColor } : null,
    };
  });
  await shot(`r2-shell-${tag}`);

  if (w < 1024) {
    // 390: o rail vive no drawer; o menu aberto é o do toque.
    await page.getByRole('button', { name: /Abrir menu|Menu/i }).first().click().catch(() => {});
    await wait(500);
    M[`menu-mobile-${tag}`] = await page.evaluate(() => {
      const drawer = document.querySelector('.workspace-nav-drawer');
      const texto = drawer ? drawer.textContent || '' : '';
      return {
        aberto: !!drawer,
        rotulosIndevidos: ['Produtos', 'Recursos', 'Execuções', 'contextual'].filter((p) => texto.includes(p)),
        titulosDeGrupo: drawer ? drawer.querySelectorAll('.workspace-nav-drawer__title').length : null,
        controleDeLargura: document.querySelectorAll('.workspace-foot__item--collapse').length,
      };
    });
    await shot(`r2-menu-mobile-${tag}`);
    await page.keyboard.press('Escape');
    await wait(400);
    return;
  }

  M[`menu-${tag}`] = await navAudit();
  // Hover em cada grupo: nenhum rótulo proibido aparece na extensão.
  const grupos = page.locator('[data-peek-group]');
  const n = await grupos.count();
  const textos = [];
  for (let i = 0; i < n; i += 1) {
    await grupos.nth(i).hover();
    await page.waitForSelector('#ws-nav-panel', { timeout: 2000 }).catch(() => {});
    await wait(180);
    textos.push((await page.locator('#ws-nav-panel').first().innerText().catch(() => '')).replace(/\n/g, ' · '));
  }
  M[`menu-${tag}`].paineis = textos;
  M[`menu-${tag}`].rotulosIndevidosNosPaineis = ['Produtos', 'Recursos', 'Execuções', 'contextual']
    .filter((p) => textos.some((t) => t.includes(p)));
  if (n) await shot(`r2-menu-${tag}`);
  await page.mouse.move(w - 120, 500, { steps: 6 });
  await wait(400);

  // RECOLHER → EXPANDIR (o controle do rodapé), com persistência medida.
  const toggle = page.locator('.workspace-foot__item--collapse');
  await toggle.click();
  await wait(400);
  M[`largura-${tag}`] = await page.evaluate(() => {
    const side = document.querySelector('.workspace-sidebar');
    const label = document.querySelector('.workspace-sidebar .workspace-label');
    const grupoTitulo = document.querySelector('.workspace-sidebar .workspace-nav-drawer__title');
    return {
      classe: side?.className,
      dataNavWidth: side?.getAttribute('data-nav-width'),
      largura: side ? Math.round(side.getBoundingClientRect().width) : null,
      rotuloVisivel: label ? getComputedStyle(label).display !== 'none' : null,
      tituloDeGrupoNoFluxo: !!grupoTitulo,
      filhosNoFluxo: document.querySelectorAll('.workspace-sidebar .workspace-link--sub').length,
      painelFlutuanteAberto: document.querySelectorAll('#ws-nav-panel, .ws-peek').length,
      armazenado: (() => { try { return localStorage.getItem('godoutor-side-v2'); } catch { return null; } })(),
      rotuloControle: document.querySelector('.workspace-foot__item--collapse')?.getAttribute('aria-label'),
    };
  });
  await shot(`r2-menu-aberto-${tag}`);
  // Sobrevive ao reload (preferência real, não estado de sessão).
  await page.reload();
  await page.waitForSelector('.workspace-sidebar');
  await wait(600);
  M[`largura-${tag}`].aposReload = await page.evaluate(() => {
    const side = document.querySelector('.workspace-sidebar');
    return { dataNavWidth: side?.getAttribute('data-nav-width'), largura: side ? Math.round(side.getBoundingClientRect().width) : null };
  });
  await shot(`r2-menu-aberto-reload-${tag}`);
  await page.locator('.workspace-foot__item--collapse').click();
  await wait(400);
  M[`largura-${tag}`].voltouAoRail = await page.evaluate(() => {
    const side = document.querySelector('.workspace-sidebar');
    return { dataNavWidth: side?.getAttribute('data-nav-width'), largura: side ? Math.round(side.getBoundingClientRect().width) : null };
  });
}

// ═══ 2 · AGENDA: drag-create → ESC, toolbar, hover, clique ═══
async function agendaFlows(w, tag) {
  etapa = `agenda-${tag}`;
  await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
  await page.goto(agendaUrl());
  await page.waitForSelector('[data-agenda-column]');
  await wait(900);

  // ── 8 · TOOLBAR: uma métrica, sem contorno ocioso ──
  M[`toolbar-${tag}`] = await page.evaluate(() => {
    const desc = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        altura: Math.round(r.height), raio: cs.borderTopLeftRadius,
        borda: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor,
        fundo: cs.backgroundColor,
      };
    };
    const porTexto = (t) => [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().startsWith(t));
    const linha = document.querySelector('.ag-page .gd-toolbar');
    const controles = linha ? [...linha.children] : [];
    return {
      hoje: desc(porTexto('Hoje')),
      seta: desc(document.querySelector('button.gd-icon-control[aria-label]')),
      data: desc(document.querySelector('.ag-page .gd-toolbar .il-field-control')),
      segmentado: desc(document.querySelector('.il-segmented')),
      itemSegmentado: desc(document.querySelector('.il-segmented__item')),
      filtros: desc(porTexto('Filtros')),
      fila: desc(porTexto('Fila')),
      alturasDaMesmaLinha: controles.map((c) => Math.round(c.getBoundingClientRect().height)),
      regra: 'visitante',
    };
  }).catch(() => null);
  await shot(`r2-toolbar-${tag}`);

  // ── 1 · DRAG-CREATE → ESC ──
  // Ponto de partida: o PRIMEIRO espaço vago VISÍVEL da coluna (de baixo para
  // cima, para cair fora do horário de pico). Varre com `elementFromPoint`, a
  // mesma pergunta que o usuário responde com o olho: "aqui está vazio?".
  const start = await page.evaluate(() => {
    const col = document.querySelector('[data-agenda-column]');
    if (!col) return null;
    const r = col.getBoundingClientRect();
    const x = Math.round(r.x + r.width / 2);
    const topo = Math.max(r.top + 60, 120);
    const base = Math.min(r.bottom - 80, window.innerHeight - 160);
    for (let y = base; y > topo; y -= 10) {
      const el = document.elementFromPoint(x, y);
      if (!el || !el.closest('[data-agenda-column]')) continue;
      if (el.closest('button')) continue;
      return { x, y: Math.round(y) };
    }
    return null;
  });
  if (start) {
    const { x, y: y0 } = start;
    await page.mouse.move(x, y0);
    await page.mouse.down();
    await page.mouse.move(x, y0 + 55, { steps: 8 });
    await page.mouse.up();
    await page.waitForSelector('[data-testid="agenda-selected-range"]', { timeout: 4000 }).catch(() => {});
    await wait(500);
    const antes = await page.evaluate(() => ({
      faixa: !!document.querySelector('[data-testid="agenda-selected-range"]'),
      popover: !!document.querySelector('[role="dialog"]'),
    }));
    await shot(`r2-drag-create-${tag}`);
    await page.keyboard.press('Escape');
    const t0 = Date.now();
    const saiu = await page.waitForFunction(
      () => !document.querySelector('[data-testid="agenda-selected-range"]'),
      null, { timeout: 1500 },
    ).then(() => true).catch(() => false);
    const ms = Date.now() - t0;
    await wait(250);
    const depois = await page.evaluate(() => ({
      faixa: !!document.querySelector('[data-testid="agenda-selected-range"]'),
      popover: !!document.querySelector('[role="dialog"]'),
      // Nenhum resíduo do gesto: nada de overlay de arraste ligado.
      overlayDeArraste: (() => {
        const o = document.querySelector('[data-agenda-column] > div[aria-hidden="true"]');
        return o ? getComputedStyle(o).display : null;
      })(),
    }));
    M[`drag-esc-${tag}`] = { pontoDoGesto: start, antes, depois, faixaSaiuEmMs: saiu ? ms : null, saiuNaHora: antes.faixa && !depois.faixa && !depois.popover };
    await shot(`r2-drag-esc-${tag}`);
    // Cancelamento pelo SIMPLES CLIQUE (mesma régua): clique num horário vago
    // abre o quick create; ESC (ou clique fora) também tem de limpar.
    await page.mouse.click(x, y0);
    await wait(600);
    const clicou = await page.evaluate(() => !!document.querySelector('[data-testid="agenda-selected-range"]'));
    await page.keyboard.press('Escape');
    await wait(400);
    M[`drag-esc-${tag}`].cliqueTambemLimpa = clicou && !(await page.evaluate(() => !!document.querySelector('[data-testid="agenda-selected-range"]')));
  }

  // ── 2 · HOVER: resumo compacto colado no evento, sem painel lateral ──
  await page.goto(agendaUrl());
  await page.waitForSelector('button.ag-event');
  await wait(900);
  const evento = page.locator('button.ag-event').nth(2);
  await evento.scrollIntoViewIfNeeded();
  const evBox = await evento.boundingBox();
  await evento.hover();
  await page.waitForSelector('.gd-hovercard', { timeout: 4000 }).catch(() => {});
  await wait(450);
  M[`hover-${tag}`] = await page.evaluate(() => {
    const card = document.querySelector('.gd-hovercard');
    const ev = document.querySelectorAll('button.ag-event')[2];
    const c = card?.getBoundingClientRect();
    const e = ev?.getBoundingClientRect();
    const card2 = document.querySelector('.ag-hover__card');
    const cs = card2 ? getComputedStyle(card2) : null;
    return {
      existe: !!card,
      largura: c ? Math.round(c.width) : null,
      altura: c ? Math.round(c.height) : null,
      // Colado: distância horizontal do bloco até o cartão (offset do DS 8–12px).
      distanciaHorizontal: c && e ? Math.round(c.x - e.right) : null,
      sobrepoeOEvento: c && e ? !(c.x >= e.right || c.right <= e.x || c.y >= e.bottom || c.bottom <= e.y) : null,
      paineisLateraisAbertos: document.querySelectorAll('dialog.gd-detail, .gd-detail__panel, .ws-sheet').length,
      temCtaVerDetalhes: !!card && /Ver detalhes/.test(card.textContent || ''),
      itens: card ? [...card.querySelectorAll('.ag-hover__rows dt')].map((dt) => dt.textContent) : [],
      fundoDoCartao: cs ? cs.backgroundColor : null,
      tituloNativoNoEvento: ev?.getAttribute('title') || null,
    };
  });
  await shot(`r2-hover-${tag}`);

  // ── 3 · CLIQUE → MODAL LATERAL PRESO À DIREITA ──
  await evento.click();
  await page.waitForSelector('.gd-detail__panel', { timeout: 6000 }).catch(() => {});
  await wait(700);
  M[`detalhe-${tag}`] = await panelGeometry();
  M[`detalhe-${tag}`] = {
    ...(M[`detalhe-${tag}`] || {}),
    titulo: await page.locator('.gd-detail__header h2').first().innerText().catch(() => null),
    temFechar: await page.locator('.gd-detail__header button[aria-label^="Fechar"]').count(),
    focoNoTitulo: await page.evaluate(() => document.activeElement?.tagName === 'H2'),
  };
  await shot(`r2-detalhe-${tag}`);
  const evBoxApos = await evento.boundingBox().catch(() => null);
  await page.keyboard.press('Escape');
  await wait(500);
  M[`detalhe-${tag}`].fechouComEscape = !(await page.evaluate(() => !!document.querySelector('.gd-detail__panel')));
  M[`detalhe-${tag}`].focoDeVoltaNoEvento = await page.evaluate(() => document.activeElement?.classList?.contains('ag-event') || false);
  void evBoxApos; void evBox;
}

// ═══ 3 · CLIENTES: prévia do cliente (mesmo modal) e permissões ═══
async function clientesFlows(w, tag, { admin }) {
  etapa = `clientes-${tag}-${admin ? 'admin' : 'naoadmin'}`;
  await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
  await page.goto(clientesUrl());
  await page.waitForSelector('button[aria-label^="Abrir perfil"]', { timeout: 15000 }).catch(() => {});
  await wait(900);

  M[`clientes-base-${tag}-${admin ? 'admin' : 'naoadmin'}`] = await page.evaluate(() => {
    const texto = document.body.innerText;
    const tem = (t) => texto.includes(t);
    const botao = (t) => [...document.querySelectorAll('button, a')].find((b) => (b.textContent || '').trim() === t);
    const visual = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        borda: cs.borderTopWidth, corDaBorda: cs.borderTopColor, estilo: cs.borderTopStyle,
        fundo: cs.backgroundColor, altura: Math.round(el.getBoundingClientRect().height), raio: cs.borderTopLeftRadius,
      };
    };
    return {
      importar: tem('Importar'), exportar: tem('Exportar'), exportarTudo: tem('Exportar tudo (JSON)'),
      importarVisual: visual(botao('Importar')),
      exportarVisual: visual(botao('Exportar')),
    };
  });
  await shot(`r2-clientes-${admin ? 'admin' : 'naoadmin'}-${tag}`);

  if (!admin) return;

  // ── 4 · PRÉVIA RÁPIDA DO CLIENTE ──
  await page.locator('button[title="Prévia rápida sem sair da lista"]').first().click();
  await page.waitForSelector('.gd-detail__panel', { timeout: 6000 }).catch(() => {});
  await wait(700);
  M[`previa-cliente-${tag}`] = {
    ...(await panelGeometry()),
    titulo: await page.locator('.gd-detail__header h2').first().innerText().catch(() => null),
    temIconeDoAssunto: await page.locator('.gd-detail__panel .gd-detail__icon').count(),
    saidaParaFichaCompleta: await page.locator('.gd-detail__fullpage').first().innerText().catch(() => null),
    gavetaFlutuanteNaTela: await page.evaluate(() => document.querySelectorAll('.ws-sheet').length),
    corpo: await page.locator('.gd-detail__panel').first().innerText().then((t) => t.slice(0, 120)).catch(() => null),
  };
  await shot(`r2-previa-cliente-${tag}`);
  await page.keyboard.press('Escape');
  await wait(450);
}

// ═══ 4 · DASHBOARD: ações rápidas ═══
async function dashboardActions(w, tag) {
  etapa = `dashboard-${tag}`;
  await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
  await page.goto(`${base}/dashboard?b=${fixture.b}`);
  await page.waitForSelector('.dsh-quick', { timeout: 15000 }).catch(() => {});
  await wait(800);
  M[`acoes-rapidas-${tag}`] = await page.evaluate(() => {
    const item = document.querySelector('.dsh-quick');
    if (!item) return null;
    const icone = item.querySelector('.dsh-quick__icon');
    const cs = getComputedStyle(item);
    const ci = icone ? getComputedStyle(icone) : null;
    const r = item.getBoundingClientRect();
    const ri = icone?.getBoundingClientRect();
    const span = item.querySelector('span:not(.dsh-quick__icon)');
    // Centralização medida: centro do ícone × centro do item.
    const riCentro = ri ? ri.x + ri.width / 2 : null;
    const itemCentro = r.x + r.width / 2;
    return {
      itens: document.querySelectorAll('.dsh-quick').length,
      bordaDoItem: cs.borderTopWidth, fundoDoItem: cs.backgroundColor,
      cardDentroDeCard: cs.borderTopWidth !== '0px' || cs.backgroundColor !== 'rgba(0, 0, 0, 0)',
      icone: ci ? { borda: ci.borderTopWidth, raio: ci.borderTopLeftRadius, fundo: ci.backgroundColor, w: Math.round(ri.width), h: Math.round(ri.height) } : null,
      deltaCentroIcone: riCentro !== null ? +(riCentro - itemCentro).toFixed(1) : null,
      conteudo: item.textContent || '',
      alinhamentoTexto: cs.textAlign,
      rotuloVisivel: span ? span.textContent : null,
    };
  });
  await shot(`r2-dashboard-${tag}`);
}

// ═══ EXECUÇÃO ══════════════════════════════════════════════════
await login(fixture.owner.email, fixture.owner.password);
for (const [w, , tag] of VIEWPORTS) {
  await step(`shell-${tag}`, () => shell(w, tag));
  await step(`agenda-${tag}`, () => agendaFlows(w, tag));
  await step(`clientes-${tag}`, () => clientesFlows(w, tag, { admin: true }));
  await step(`dashboard-${tag}`, () => dashboardActions(w, tag));
}

// NÃO-ADMIN (profissional com acesso clínico, sem papel de administração).
etapa = 'logout';
await context.clearCookies();
await step('clientes-naoadmin', async () => {
  await login(fixture.clinicoEmail, SENHA_NAO_ADMIN);
  for (const [w, , tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
    await clientesFlows(w, tag, { admin: false });
  }
});

M['console'] = { erros: consoleErrors, ruido, respostas4xx };
await fs.writeFile(path.join(outDir, 'round2-measurements.json'), JSON.stringify(M, null, 2));
await browser.close();
console.log('Medições da rodada 2 em', path.join(outDir, 'round2-measurements.json'));
if (consoleErrors.length) console.log('ERROS DE CONSOLE:', consoleErrors.slice(0, 8));
