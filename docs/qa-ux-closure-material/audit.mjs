// ═══════════════════════════════════════════════════════════════
// AUDITORIA FUNCIONAL E VISUAL DA AGENDA — RODADA 2 (PR #64)
// ═══════════════════════════════════════════════════════════════
// Mede e fotografa, em Chromium REAL, nas quatro larguras exigidas
// (1440 · 1366 · 1024 · 390), sem sair da fixture QA descartável:
//
//   A. shell: rótulos de navegação (≥14px/20px), identidade, recolher/expandir,
//      grupos, rotas indevidas, chevrons;
//   B. toolbar da Agenda: TODOS os controles da linha, altura/raio/borda;
//   C. hover do evento: atraso medido, distância (8–12px), flip, permanência ao
//      entrar no cartão, fundo/sombra, CTA, ausência de tooltip nativo;
//   D. detalhe: painel preso à direita, 100dvh, foco/Escape/devolução de foco;
//   E. MENU DE CONTEXTO (botão direito + Shift+F10): itens reais, transições
//      VÁLIDAS da máquina de estados, execução de UMA transição na fixture,
//      conferência pela API e REVERSÃO;
//   F. resize de duração na fixture: minutos antes/depois, persistência,
//      cancelamento;
//   G. drag-create → ESC/clique fora (limpeza integral da seleção);
//   H. prévia do cliente: resumo à esquerda, conteúdo à direita;
//   I. ações rápidas do Dashboard (sem card-dentro-de-card);
//   J. permissões: Clientes admin × não-admin;
//   K. console e requisições com erro (explicados, não escondidos).
//
// Uso: node docs/qa-ux-closure-material/audit.mjs
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
const requests = [];
let etapa = 'boot';
const KNOWN = /ERR_CONNECTION_CLOSED|ERR_ABORTED|401 \(Unauthorized\)|Failed to load resource: the server responded with a status of 4/;
const registrar = (t) => (KNOWN.test(t) ? ruido : consoleErrors).push(t);

const runtime = await ensureBrowser();
const browser = await chromium.launch({
  executablePath: process.env.QA_BROWSER || runtime.executablePath,
  args: CHROMIUM_ARGS,
  env: { ...process.env, LD_LIBRARY_PATH: process.env.QA_BROWSER_LD || runtime.LD_LIBRARY_PATH },
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', (e) => registrar(`[${etapa}] pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') registrar(`[${etapa}] ${m.text()}`); });
page.on('response', (r) => {
  if (r.status() >= 400) requests.push({ etapa, status: r.status(), url: new URL(r.url()).pathname + new URL(r.url()).search });
});

const wait = (ms) => page.waitForTimeout(ms);
const shot = (name, opts = {}) => page.screenshot({ path: path.join(outDir, `${name}.png`), ...opts });
async function step(name, fn) {
  try { await fn(); } catch (e) { M[`ERRO-${name}`] = String((e && e.message) || e).slice(0, 300); }
}
const agendaUrl = () => `${base}/agenda?b=${fixture.b}&data=${fixture.day}&view=day`;

/** Chamadas de API pelo MESMO cookie da sessão (mesma origem do app). */
const api = (method, url, body) => page.evaluate(async ([m, u, b]) => {
  const res = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
  let data = null; try { data = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, data };
}, [method, url, body]);

async function login(email, password) {
  await page.goto(`${base}/login`);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL(/dashboard/, { timeout: 25000 });
  await page.waitForSelector('.workspace-sidebar');
  await wait(400);
}

const panelGeometry = () => page.evaluate(() => {
  const panel = document.querySelector('.gd-detail__panel');
  const dialog = document.querySelector('dialog.gd-detail');
  if (!panel) return null;
  const r = panel.getBoundingClientRect();
  const cs = getComputedStyle(panel);
  return {
    x: Math.round(r.x), largura: Math.round(r.width), altura: Math.round(r.height),
    topo: Math.round(r.top), distanciaDireita: Math.round(window.innerWidth - r.right),
    raio: cs.borderTopLeftRadius, sombra: cs.boxShadow, bordaEsquerda: cs.borderLeftWidth,
    viewport: { w: window.innerWidth, h: window.innerHeight },
    alturaDoDialogo: dialog ? getComputedStyle(dialog).height : null,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  };
});

const navAudit = () => page.evaluate(() => {
  const px = (v) => parseFloat(v) || 0;
  const side = document.querySelector('.workspace-sidebar');
  const panel = document.querySelector('#ws-nav-panel');
  const texto = (el) => (el ? el.textContent || '' : '');
  const fonte = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { tamanho: px(cs.fontSize), linha: cs.lineHeight };
  };
  return {
    rotulosIndevidos: ['Produtos', 'Recursos', 'Execuções', 'contextual']
      .filter((p) => texto(panel).includes(p) || texto(side).includes(p)),
    flagContextual: document.querySelectorAll('.ws-peek__flag').length,
    chevrons: side ? side.querySelectorAll('.workspace-link__chevron:not([hidden])').length : null,
    larguraRail: side ? Math.round(side.getBoundingClientRect().width) : null,
    fonteDoDestino: fonte(side?.querySelector('.workspace-link')),
    fonteDoTituloDeGrupo: fonte(document.querySelector('.workspace-nav-drawer__title, .gd-layer .gd-layer__label')),
    itensDoPainel: panel ? panel.querySelectorAll('.ws-peek__item').length : 0,
    fonteDoItemDoPainel: fonte(panel?.querySelector('.ws-peek__item')),
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  };
});

/** Altura/estilo de TODOS os controles da linha de ferramentas. */
const toolbarAudit = () => page.evaluate(() => {
  // A barra da Agenda é UMA faixa (`.ws-panel` com `.gd-toolbar`) que contém os
  // dois grupos: navegação no tempo (Hoje/setas/data) e visualização/ações
  // (Dia-Semana-Lista, Bloquear horário, Novo agendamento). A linha de
  // Filtros/Fila/legenda é a segunda faixa do cabeçalho.
  const faixas = [...document.querySelectorAll('.ag-page .ws-panel > .gd-toolbar, .ag-page .ws-panel .gd-toolbar')];
  const linha = faixas[0] || document.querySelector('.ag-page .gd-toolbar');
  if (!linha) return null;
  const desc = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const rotulo = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28);
    return {
      rotulo, altura: Math.round(r.height), largura: Math.round(r.width),
      raio: cs.borderTopLeftRadius, borda: cs.borderTopWidth + ' ' + cs.borderTopColor,
      fundo: cs.backgroundColor, linha: cs.lineHeight, fonte: cs.fontSize,
      visivel: r.width > 0 && r.height > 0,
    };
  };
  const daFaixa = (el) => [...el.querySelectorAll('button, a.il-control, [role="group"], .il-field-control, .gd-icon-control')]
    .filter((x) => !x.closest('[hidden]'))
    .filter((x) => x.offsetParent !== null || x.getBoundingClientRect().height > 0)
    .map(desc)
    .filter((c) => c.visivel);
  const controles = daFaixa(linha);
  const segunda = faixas[1] ? daFaixa(faixas[1]) : [];
  const terceira = faixas[2] ? daFaixa(faixas[2]) : [];
  const todas = [...controles, ...segunda, ...terceira];
  // Classificação honesta: o poço do seletor Dia/Semana/Lista é UM controle
  // (40px) com itens internos de 32px — eles NÃO são controles equivalentes a
  // Hoje/setas/data; a comparação de altura vale para os equivalentes.
  const grupoSeg = document.querySelector('.ag-page .il-segmented');
  const descSeg = grupoSeg ? desc(grupoSeg) : null;
  const ehInternoDoSeg = (rotulo) => ['Dia', 'Semana', 'Lista'].includes(rotulo);
  const equivalentes = todas.filter((c) => !ehInternoDoSeg(c.rotulo));
  const alturas = todas.map((c) => c.altura).filter((a) => a > 0);
  const alturaUnica = alturas.length ? Math.max(...alturas) - Math.min(...alturas) : null;
  const comBorda = todas.filter((c) => parseFloat(c.borda) > 0 && !/rgba?\(0, 0, 0, 0\)/.test(c.borda)).map((c) => c.rotulo);
  return {
    controles,
    segundaFaixa: segunda,
    terceiraFaixa: terceira,
    grupoSegmentado: descSeg,
    qtd: todas.length,
    alturaMin: Math.min(...alturas), alturaMax: Math.max(...alturas),
    variacaoDeAltura: alturaUnica,
    // O número que a homologação pede: controles EQUIVALENTES (fora do poço
    // segmentado), diferença máxima tolerada de 1px.
    qtdEquivalentes: equivalentes.length,
    variacaoDosEquivalentes: equivalentes.length
      ? Math.max(...equivalentes.map((c) => c.altura)) - Math.min(...equivalentes.map((c) => c.altura)) : null,
    alturaSemBorda: comBorda,
    comBordaVisivel: todas.filter((c) => parseFloat(c.borda) > 0 && !/rgba?\(0, 0, 0, 0\)/.test(c.borda)).map((c) => ({ rotulo: c.rotulo, borda: c.borda })),
    variacaoDaNavegacao: controles.length ? Math.max(...controles.map((c) => c.altura)) - Math.min(...controles.map((c) => c.altura)) : null,
    overflowX: document.documentElement.scrollWidth - window.innerWidth,
  };
});

// ═══ A · SHELL + MENU ══════════════════════════════════════════
async function shellFlow(w, tag) {
  etapa = `shell-${tag}`;
  await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
  await page.goto(`${base}/dashboard?b=${fixture.b}`);
  await page.waitForSelector('.ws-topbar');
  await wait(700);
  M[`shell-${tag}`] = await page.evaluate(() => {
    const logo = document.querySelector('.ws-clinic__logo, .ws-clinic__mark');
    const icone = document.querySelector('.workspace-sidebar .workspace-link__icon');
    const l = logo?.getBoundingClientRect(); const i = icone?.getBoundingClientRect();
    const cs = logo ? getComputedStyle(logo) : null;
    return {
      topbarAltura: Math.round(document.querySelector('.ws-topbar').getBoundingClientRect().height),
      logoAltura: l ? Math.round(l.height) : null, logoX: l ? Math.round(l.x) : null,
      iconeRailX: i ? Math.round(i.x) : null,
      deltaIdentidadeRail: l && i ? Math.round(l.x - i.x) : null,
      logoTemTile: cs ? { borda: cs.borderTopWidth, raio: cs.borderTopLeftRadius, fundo: cs.backgroundColor } : null,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  await shot(`a-shell-${tag}`);
  if (w < 1024) {
    await page.getByRole('button', { name: /Abrir menu|Menu/i }).first().click().catch(() => {});
    await wait(500);
    M[`menu-mobile-${tag}`] = await page.evaluate(() => {
      const d = document.querySelector('.workspace-nav-drawer');
      const t = d ? d.textContent || '' : '';
      const px = (v) => parseFloat(v) || 0;
      const title = d?.querySelector('.workspace-nav-drawer__title');
      const item = d?.querySelector('.workspace-link');
      return {
        aberto: !!d,
        rotulosIndevidos: ['Produtos', 'Recursos', 'Execuções', 'contextual'].filter((p) => t.includes(p)),
        titulos: d ? d.querySelectorAll('.workspace-nav-drawer__title').length : null,
        fonteDoTitulo: title ? px(getComputedStyle(title).fontSize) : null,
        linhaDoTitulo: title ? getComputedStyle(title).lineHeight : null,
        fonteDoDestino: item ? px(getComputedStyle(item).fontSize) : null,
        linhaDoDestino: item ? getComputedStyle(item).lineHeight : null,
        controleDeLargura: document.querySelectorAll('.workspace-foot__item--collapse').length,
      };
    });
    await shot(`a-menu-mobile-${tag}`);
    await page.keyboard.press('Escape'); await wait(400);
    return;
  }
  M[`menu-${tag}`] = await navAudit();
  const grupos = page.locator('[data-peek-group]');
  const n = await grupos.count();
  const paineis = [];
  for (let i = 0; i < n; i += 1) {
    await grupos.nth(i).hover();
    await page.waitForSelector('#ws-nav-panel', { timeout: 2500 }).catch(() => {});
    await wait(200);
    paineis.push({
      texto: (await page.locator('#ws-nav-panel').first().innerText().catch(() => '')).replace(/\n/g, ' · '),
      itens: await page.locator('#ws-nav-panel .ws-peek__item').count(),
      fonte: await page.locator('#ws-nav-panel .ws-peek__item').first()
        .evaluate((el) => ({ tamanho: parseFloat(getComputedStyle(el).fontSize), linha: getComputedStyle(el).lineHeight })).catch(() => null),
    });
  }
  M[`menu-${tag}`].paineis = paineis;
  M[`menu-${tag}`].rotulosIndevidosNosPaineis = ['Produtos', 'Recursos', 'Execuções', 'contextual']
    .filter((p) => paineis.some((x) => x.texto.includes(p)));
  if (n) await shot(`a-menu-grupo-${tag}`);
  await page.mouse.move(w - 140, 520, { steps: 6 }); await wait(400);

  const toggle = page.locator('.workspace-foot__item--collapse');
  await toggle.click(); await wait(450);
  M[`largura-${tag}`] = await page.evaluate(() => {
    const side = document.querySelector('.workspace-sidebar');
    const label = document.querySelector('.workspace-sidebar .workspace-label');
    return {
      dataNavWidth: side?.getAttribute('data-nav-width'),
      largura: Math.round(side.getBoundingClientRect().width),
      rotuloVisivel: label ? getComputedStyle(label).display !== 'none' : null,
      filhosNoFluxo: document.querySelectorAll('.workspace-sidebar .workspace-link--sub').length,
      painelFlutuanteAberto: document.querySelectorAll('#ws-nav-panel').length,
      armazenado: (() => { try { return localStorage.getItem('godoutor-side-v2'); } catch { return null; } })(),
      rotuloControle: document.querySelector('.workspace-foot__item--collapse')?.getAttribute('aria-label'),
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  await shot(`a-menu-aberto-${tag}`);
  await page.reload(); await page.waitForSelector('.workspace-sidebar'); await wait(600);
  M[`largura-${tag}`].aposReload = await page.evaluate(() => {
    const s = document.querySelector('.workspace-sidebar');
    return { dataNavWidth: s?.getAttribute('data-nav-width'), largura: Math.round(s.getBoundingClientRect().width) };
  });
  await shot(`a-menu-aberto-reload-${tag}`);
  await page.locator('.workspace-foot__item--collapse').click(); await wait(450);
  M[`largura-${tag}`].voltouAoRail = await page.evaluate(() => {
    const s = document.querySelector('.workspace-sidebar');
    return { dataNavWidth: s?.getAttribute('data-nav-width'), largura: Math.round(s.getBoundingClientRect().width) };
  });
}

// ═══ B · TOOLBAR + C · HOVER + D · DETALHE ═════════════════════
async function agendaFlows(w, tag) {
  etapa = `agenda-${tag}`;
  await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
  await page.goto(agendaUrl());
  await page.waitForSelector('[data-agenda-column]');
  await wait(900);
  M[`toolbar-${tag}`] = await toolbarAudit();
  await shot(`a-toolbar-${tag}`);

  // C · HOVER — atraso real medido pelo MutationObserver.
  await page.goto(agendaUrl());
  await page.waitForSelector('button.ag-event');
  await wait(900);
  const evento = page.locator('button.ag-event').nth(2);
  await evento.scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    window.__hoverT = null;
    // t0 = o INSTANTE em que o ponteiro entra no alvo (evento real do navegador):
    // o número medido é o atraso do produto, não o do harness.
    const t0Ref = { t: 0 };
    const alvo = document.querySelectorAll('button.ag-event')[2];
    alvo.addEventListener('mouseenter', () => { t0Ref.t = performance.now(); }, { capture: true, once: true });
    const obs = new MutationObserver(() => {
      if (document.querySelector('.gd-hovercard') && window.__hoverT === null && t0Ref.t) {
        window.__hoverT = performance.now() - t0Ref.t;
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });
  await evento.hover();
  await page.waitForSelector('.gd-hovercard', { timeout: 4000 }).catch(() => {});
  await wait(500);
  M[`hover-${tag}`] = await page.evaluate(() => {
    const card = document.querySelector('.gd-hovercard');
    const ev = document.querySelectorAll('button.ag-event')[2];
    const c = card?.getBoundingClientRect(); const e = ev?.getBoundingClientRect();
    const cs = card ? getComputedStyle(card) : null;
    const interna = document.querySelector('.ag-hover__card');
    return {
      existe: !!card,
      largura: c ? Math.round(c.width) : null, altura: c ? Math.round(c.height) : null,
      distanciaHorizontal: c && e ? Math.round(c.x - e.right) : null,
      distanciaVertical: c && e ? Math.round(c.y - e.top) : null,
      dentroDaViewport: c ? (c.x >= 0 && c.right <= window.innerWidth && c.y >= 0 && c.bottom <= window.innerHeight) : null,
      sobrepoeOEvento: c && e ? !(c.x >= e.right || c.right <= e.x || c.y >= e.bottom || c.bottom <= e.y) : null,
      fundo: cs ? cs.backgroundColor : null, sombra: cs ? cs.boxShadow.slice(0, 60) : null,
      paineisLateraisAbertos: document.querySelectorAll('.gd-detail__panel, .ws-sheet').length,
      temCtaVerDetalhes: !!card && /Ver detalhes/.test(card.textContent || ''),
      temStatus: !!card && /Pendente|Confirmado|Concluído|Faltou|Cancelado/.test(card.textContent || ''),
      itens: card ? [...card.querySelectorAll('.ag-hover__rows dt')].map((dt) => dt.textContent) : [],
      tituloNativoNoEvento: ev?.getAttribute('title') || null,
      fonteDoNome: interna ? getComputedStyle(document.querySelector('.ag-hover__name')).fontSize : null,
      atrasoDeAberturaMs: window.__hoverT,
    };
  });
  await shot(`a-hover-${tag}`);

  // C2 · PERMANÊNCIA: entrar no cartão não fecha o resumo.
  const caixa = await page.locator('.gd-hovercard').first().boundingBox();
  if (caixa) {
    await page.mouse.move(Math.round(caixa.x + caixa.width / 2), Math.round(caixa.y + 18), { steps: 8 });
    await wait(450);
    M[`hover-${tag}`].permaneceAoEntrarNoCartao = await page.locator('.gd-hovercard').count() === 1;
    await shot(`a-hover-dentro-${tag}`);
  }
  // C3 · viewport estreita: o cartão tem de inverter para a ESQUERDA.
  if (w === 390) {
    M[`hover-${tag}`].cabeNaViewportEstreita = await page.evaluate(() => {
      const c = document.querySelector('.gd-hovercard')?.getBoundingClientRect();
      return !!c && c.x >= 0 && c.right <= window.innerWidth;
    });
  }

  // D · DETALHE (clique) — painel preso à direita, altura cheia, foco/Escape.
  await evento.click();
  await page.waitForSelector('.gd-detail__panel', { timeout: 6000 }).catch(() => {});
  await wait(700);
  const geo = await panelGeometry();
  M[`detalhe-${tag}`] = {
    ...(geo || {}),
    titulo: await page.locator('.gd-detail__header h2').first().innerText().catch(() => null),
    focoNoTitulo: await page.evaluate(() => document.activeElement?.tagName === 'H2'),
    temFechar: await page.locator('.gd-detail__header button[aria-label^="Fechar"]').count(),
    alturaCheia: geo ? Math.abs(geo.altura - geo.viewport.h) <= 1 : null,
    preencheADireita: geo ? geo.distanciaDireita === 0 : null,
    larguraDoToken: geo ? geo.largura : null,
  };
  await shot(`a-detalhe-${tag}`);
  await page.keyboard.press('Escape');
  await wait(500);
  const dep = await page.evaluate(() => ({
    fechou: !document.querySelector('.gd-detail__panel'),
    focoNoEvento: !!document.activeElement?.classList?.contains('ag-event'),
  }));
  M[`detalhe-${tag}`].fechouComEscape = dep.fechou;
  M[`detalhe-${tag}`].focoDeVoltaNoEvento = dep.focoNoEvento;
}

// ═══ E · MENU DE CONTEXTO + status ═════════════════════════════
async function contextMenuFlow(w, tag, alvos) {
  etapa = `ctxmenu-${tag}`;
  await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
  await page.goto(agendaUrl());
  await page.waitForSelector('button.ag-event');
  await wait(900);
  // Evento de status PENDENTE (fixture) — as transições válidas são poucas.
  const idx = await page.evaluate((id) => {
    const btns = [...document.querySelectorAll('button.ag-event')];
    return btns.findIndex((b) => (b.getAttribute('aria-label') || '').includes(id));
  }, alvos.pendente.petOuNome);
  const alvo = page.locator('button.ag-event').nth(idx >= 0 ? idx : 2);
  await alvo.scrollIntoViewIfNeeded();
  M[`ctxmenu-${tag}`] = { indice: idx >= 0 ? idx : 2, rotuloEncontrado: await alvo.getAttribute('aria-label') };
  {
    await alvo.click({ button: 'right' });
    await page.waitForSelector('[role="menu"].gd-menu--context', { timeout: 4000 }).catch(() => {});
    await wait(400);
    M[`ctxmenu-${tag}`].botaoDireito = await page.evaluate(() => {
      const menu = document.querySelector('[role="menu"].gd-menu--context');
      if (!menu) return { abriu: false };
      const r = menu.getBoundingClientRect();
      return {
        abriu: true,
        itens: [...menu.querySelectorAll('[role="menuitem"]')].map((b) => (b.textContent || '').trim()),
        desabilitados: [...menu.querySelectorAll('[role="menuitem"][disabled]')].map((b) => (b.textContent || '').trim()),
        cabecalho: menu.querySelector('.gd-menu__header')?.innerText?.replace('\n', ' · ') || null,
        dentroDaViewport: r.x >= 0 && r.right <= window.innerWidth && r.y >= 0 && r.bottom <= window.innerHeight,
        focoNoPrimeiroItem: document.activeElement?.getAttribute('role') === 'menuitem',
        largura: Math.round(r.width), altura: Math.round(r.height),
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    await shot(`a-ctxmenu-${tag}`);
    // Teclado: Escape fecha e devolve foco; Shift+F10 reabre.
    await page.keyboard.press('Escape'); await wait(350);
    M[`ctxmenu-${tag}`].fechouComEscape = !(await page.locator('[role="menu"].gd-menu--context').count());
    M[`ctxmenu-${tag}`].focoDeVoltaNoEvento = await page.evaluate(() => !!document.activeElement?.classList?.contains('ag-event'));
    await alvo.focus();
    await page.keyboard.press('Shift+F10');
    await page.waitForSelector('[role="menu"].gd-menu--context', { timeout: 3000 }).catch(() => {});
    await wait(350);
    M[`ctxmenu-${tag}`].tecladoShiftF10 = await page.locator('[role="menu"].gd-menu--context').count() === 1;
    await shot(`a-ctxmenu-teclado-${tag}`);
    // Navegação por teclado dentro do menu (↓ muda o item ativo).
    const antesDeDescer = await page.evaluate(() => document.activeElement?.textContent?.trim());
    await page.keyboard.press('ArrowDown'); await wait(200);
    const depoisDeDescer = await page.evaluate(() => document.activeElement?.textContent?.trim());
    M[`ctxmenu-${tag}`].setasMudamOFoco = antesDeDescer !== depoisDeDescer;
    await page.keyboard.press('Escape'); await wait(300);
  }

  // TRANSIÇÃO REAL: escolher o item de status válido e conferir pela API.
  if (w === 1440) {
    await alvo.click({ button: 'right' });
    await page.waitForSelector('[role="menu"].gd-menu--context', { timeout: 4000 }).catch(() => {});
    await wait(350);
    const itemStatus = page.locator('[role="menu"].gd-menu--context [role="menuitem"]')
      .filter({ hasText: alvos.pendente.proximoRotulo }).first();
    M[`transicao-${tag}`] = { alvo: await alvo.getAttribute('aria-label'), antes: alvos.pendente.status };
    await itemStatus.click();
    await wait(1400);
    const depois = await api('GET', `/api/bookings?businessId=${fixture.b}&mode=manage&from=${fixture.day}&to=${fixture.day}&limit=200`);
    const linha = (depois.data?.bookings || []).find((b) => b.id === alvos.pendente.id);
    M[`transicao-${tag}`].depoisDoMenu = linha?.status || null;
    M[`transicao-${tag}`].historico = Array.isArray(linha?.history) ? linha.history.slice(-1) : null;
    await shot(`a-transicao-${tag}`);
    // REVERSÃO (a fixture é descartável, mas o ambiente fica como estava).
    const volta = await api('PATCH', '/api/bookings', { businessId: fixture.b, id: alvos.pendente.id, status: alvos.pendente.status });
    M[`transicao-${tag}`].reversaoStatus = volta.status;
    const conferencia = await api('GET', `/api/bookings?businessId=${fixture.b}&mode=manage&from=${fixture.day}&to=${fixture.day}&limit=200`);
    M[`transicao-${tag}`].restauradoPara = (conferencia.data?.bookings || []).find((b) => b.id === alvos.pendente.id)?.status || null;
    // TRANSIÇÕES INVÁLIDAS: com o estado FRESCO (a página é recarregada, então
    // o menu é derivado do status que está no banco), um atendimento `pending`
    // NÃO pode oferecer Concluído/Faltou — e o próprio status atual não pode
    // aparecer como destino.
    await page.reload();
    await page.waitForSelector('button.ag-event');
    await wait(1000);
    const alvoFresco = page.locator('button.ag-event').nth(idx >= 0 ? idx : 2);
    await alvoFresco.scrollIntoViewIfNeeded();
    let abriuFresco = false;
    for (let tent = 1; tent <= 3 && !abriuFresco; tent += 1) {
      await alvoFresco.click({ button: 'right' }).catch(() => {});
      abriuFresco = await page.waitForSelector('[role="menu"].gd-menu--context', { timeout: 3000 }).then(() => true).catch(() => false);
      if (!abriuFresco) await wait(400);
    }
    M[`transicao-${tag}`].abriuNoEstadoFresco = abriuFresco;
    await wait(350);
    M[`transicao-${tag}`].invalidasAusentes = await page.evaluate(() => {
      const itens = [...document.querySelectorAll('[role="menu"].gd-menu--context [role="menuitem"]')].map((b) => (b.textContent || '').trim());
      return {
        itens,
        semConcluido: !itens.some((t) => t.startsWith('Concluído')),
        semFaltou: !itens.some((t) => t.startsWith('Faltou')),
        semReabrir: !itens.some((t) => /reabrir/.test(t)),
        proximoValido: itens.some((t) => t.startsWith('Confirmado')),
      };
    });
    await shot(`a-ctxmenu-estado-fresco-${tag}`);
    await page.keyboard.press('Escape'); await wait(300);
    // O servidor também recusa: prova de que o menu não é a autoridade.
    const recusa = await api('PATCH', '/api/bookings', { businessId: fixture.b, id: alvos.pendente.id, status: 'completed' });
    M[`transicao-${tag}`].servidorRecusaInvalida = { status: recusa.status, erro: recusa.data?.error || null };
    // Duas recusas diferentes, de propósito:
    //   • 'completed' fora de hora  → 409 (regra TEMPORAL do agendamento);
    //   • 'no_show' saindo de 'pending' → 422 (MÁQUINA DE ESTADOS: não é
    //     transição válida em momento nenhum). É a prova de que o menu não é a
    //     autoridade e que a lista de itens não abre exceção.
    const recusaMaquina = await api('PATCH', '/api/bookings', { businessId: fixture.b, id: alvos.pendente.id, status: 'no_show' });
    M[`transicao-${tag}`].servidorRecusaMaquina = { status: recusaMaquina.status, erro: recusaMaquina.data?.error || null };
  }
}

// ═══ F · RESIZE NA FIXTURE (fluxo real: arraste → confirmar) ════
// O produto pede CONFIRMAÇÃO antes de gravar ("Confirmar duração"): o resize
// de um atendimento não é um efeito colateral invisível. A auditoria percorre
// o fluxo inteiro, mede os minutos antes/depois, confere a persistência pela
// API e REVERTE para a janela original da fixture.
async function resizeFlow(alvos) {
  etapa = 'resize';
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(agendaUrl());
  await page.waitForSelector('button.ag-event');
  await wait(1000);
  const antes = alvos.confirmado;
  const ler = async () => {
    const r = await api('GET', `/api/bookings?businessId=${fixture.b}&mode=manage&from=${fixture.day}&to=${fixture.day}&limit=200`);
    return (r.data?.bookings || []).find((b) => b.id === antes.id) || null;
  };
  const linhaAntes = await ler();
  M.resize = {
    alvo: antes.id, rotulo: antes.petOuNome,
    minutosAntes: linhaAntes?.durationMin ?? null,
    janelaAntes: { startAt: linhaAntes?.startAt, endAt: linhaAntes?.endAt },
    horaAntes: linhaAntes?.time,
  };
  const idx = await page.evaluate((id) => [...document.querySelectorAll('button.ag-event')]
    .findIndex((b) => (b.getAttribute('aria-label') || '').includes(id)), antes.petOuNome);
  const evento = page.locator('button.ag-event').nth(idx >= 0 ? idx : 0);
  await evento.scrollIntoViewIfNeeded();
  const caixa = await evento.boundingBox();
  if (!caixa) return;
  await evento.hover(); await wait(400);
  const alca = evento.locator('span[aria-label^="Redimensionar"]').first();
  const alcaCaixa = await alca.boundingBox().catch(() => null);
  M.resize.alcaVisivel = !!alcaCaixa;
  if (!alcaCaixa) return;
  const pxPorMinuto = caixa.height / Math.max(1, linhaAntes?.durationMin || 30);
  const alvoPx = Math.max(28, Math.round(pxPorMinuto * 15));
  await page.mouse.move(Math.round(alcaCaixa.x + alcaCaixa.width / 2), Math.round(alcaCaixa.y + alcaCaixa.height / 2));
  await page.mouse.down();
  await page.mouse.move(Math.round(alcaCaixa.x + alcaCaixa.width / 2), Math.round(alcaCaixa.y + alcaCaixa.height / 2 + alvoPx), { steps: 14 });
  M.resize.feedbackDuranteOArraste = await page.evaluate(() => document.querySelector('[data-resize-hint]')?.textContent || null);
  await shot('a-resize-arrastando-1440');
  await page.mouse.up();
  await wait(700);
  // Etapa 2 do fluxo: o diálogo de confirmação.
  M.resize.pediuConfirmacao = await page.evaluate(() => !!document.querySelector('dialog')?.textContent?.includes('Confirmar duração')
    || /Confirmar duração/.test(document.body.innerText));
  const confirmar = page.getByRole('button', { name: /^Confirmar$/ }).last();
  if (await confirmar.count()) {
    await confirmar.click().catch(() => {});
    await wait(1600);
  }
  const linhaDepois = await ler();
  M.resize.minutosDepois = linhaDepois?.durationMin ?? null;
  M.resize.janelaDepois = { startAt: linhaDepois?.startAt, endAt: linhaDepois?.endAt };
  M.resize.persistiu = !!linhaDepois && linhaDepois.endAt !== linhaAntes?.endAt;
  await shot('a-resize-depois-1440');

  // CANCELAMENTO: novo arraste e recusa na confirmação — nada é gravado.
  const endAntesDoCancel = (await ler())?.endAt;
  await evento.hover(); await wait(350);
  const c2 = await alca.boundingBox().catch(() => null);
  if (c2) {
    await page.mouse.move(Math.round(c2.x + c2.width / 2), Math.round(c2.y + c2.height / 2));
    await page.mouse.down();
    await page.mouse.move(Math.round(c2.x + c2.width / 2), Math.round(c2.y + c2.height / 2 + alvoPx), { steps: 12 });
    await page.mouse.up();
    await wait(700);
    await page.getByRole('button', { name: /^Cancelar$/ }).last().click().catch(() => {});
    await wait(1200);
  }
  M.resize.cancelamentoNaoGravou = (await ler())?.endAt === endAntesDoCancel;

  // REVERSÃO para a janela original: a rota de resize aceita SÓ `resizeEnd`
  // (hora de fim no relógio local) — é o mesmo payload da confirmação da tela.
  const volta = await api('PATCH', '/api/bookings', {
    businessId: fixture.b, id: antes.id,
    resizeEnd: antes.horaFimOriginal || undefined,
  });
  M.resize.reversaoStatus = volta.status;
  M.resize.restaurado = (await ler())?.endAt || null;
  M.resize.voltouAoOriginal = M.resize.restaurado === linhaAntes?.endAt;
}

// ═══ G · DRAG-CREATE → ESC / CLIQUE FORA ═══════════════════════
async function dragFlow(w, tag) {
  etapa = `drag-${tag}`;
  await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
  await page.goto(agendaUrl());
  await page.waitForSelector('[data-agenda-column]');
  await wait(900);
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
  if (!start) return;
  const gesto = async () => {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 50, { steps: 10 });
    await page.mouse.up();
    await wait(700);
  };
  await gesto();
  const aberto = await page.evaluate(() => ({
    faixa: !!document.querySelector('[data-testid="agenda-selected-range"]'),
    popover: !!document.querySelector('[role="dialog"]'),
    overlay: getComputedStyle(document.querySelector('[data-agenda-column] > div[aria-hidden="true"]')).display,
  }));
  await shot(`a-drag-aberto-${tag}`);
  await page.keyboard.press('Escape');
  const t0 = Date.now();
  const saiu = await page.waitForFunction(() => !document.querySelector('[data-testid="agenda-selected-range"]'), null, { timeout: 1500 })
    .then(() => true).catch(() => false);
  const ms = Date.now() - t0;
  await wait(250);
  const limpo = await page.evaluate(() => ({
    faixa: !!document.querySelector('[data-testid="agenda-selected-range"]'),
    popover: !!document.querySelector('[role="dialog"]'),
    overlay: getComputedStyle(document.querySelector('[data-agenda-column] > div[aria-hidden="true"]')).display,
  }));
  await shot(`a-drag-esc-${tag}`);
  // A próxima interação não herda estado: um clique simples abre o fluxo novo.
  const herda = await page.evaluate(() => !!document.querySelector('[data-testid="agenda-selected-range"]'));
  M[`drag-${tag}`] = { aberto, depoisDoEsc: limpo, saiuEmMs: saiu ? ms : null, limpezaIntegral: aberto.faixa && !limpo.faixa && !limpo.popover && limpo.overlay === 'none', herdaEstado: herda };
  // CANCELAR pelo PONTEIRO: o quick create fecha pelo X do popover e por clique
  // FORA — nos dois caminhos a seleção tem de sair da grade na mesma hora.
  // (O quick create não tem botão "X": os caminhos de cancelamento do gesto são
  // Escape e clique FORA — os dois medidos aqui.)
  await gesto();
  await page.mouse.click(10, 700);   // longe do popover e da grade
  await wait(700);
  M[`drag-${tag}`].cliqueForaTambemLimpa = !(await page.evaluate(() => !!document.querySelector('[data-testid="agenda-selected-range"]')));
  await shot(`a-drag-clique-fora-${tag}`);
}

// ═══ H · PRÉVIA DO CLIENTE (duas colunas) ══════════════════════
async function profileFlow(w, tag) {
  etapa = `perfil-${tag}`;
  await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
  await page.goto(`${base}/clientes?b=${fixture.b}`);
  await page.waitForSelector('button[title="Prévia rápida sem sair da lista"]', { timeout: 15000 }).catch(() => {});
  await wait(800);
  await page.locator('button[title="Prévia rápida sem sair da lista"]').first().click().catch(() => {});
  await page.waitForSelector('.gd-detail__panel', { timeout: 6000 }).catch(() => {});
  await wait(700);
  M[`perfil-${tag}`] = {
    ...(await panelGeometry()),
    colunas: await page.evaluate(() => {
      const painel = document.querySelector('.gd-detail__panel');
      if (!painel) return null;
      const grade = painel.querySelector('.grid');
      const nome = painel.querySelector('h2');
      const bloco = painel.querySelector('.rounded-\\[var\\(--radius-md\\)\\]');
      const rn = nome?.getBoundingClientRect(); const rb = bloco?.getBoundingClientRect();
      return {
        temGrade: !!grade,
        colunasDaGrade: grade ? getComputedStyle(grade).gridTemplateColumns : null,
        xDoResumo: rn ? Math.round(rn.x) : null,
        xDoConteudo: rb ? Math.round(rb.x) : null,
        resumoAEsquerda: rn && rb ? rn.x < rb.x : null,
      };
    }),
    gavetaFlutuante: await page.evaluate(() => document.querySelectorAll('.ws-sheet').length),
  };
  await shot(`a-perfil-${tag}`);
  await page.keyboard.press('Escape'); await wait(400);
}

// ═══ I · DASHBOARD (ações rápidas) ═════════════════════════════
async function dashboardFlow(w, tag) {
  etapa = `dashboard-${tag}`;
  await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
  await page.goto(`${base}/dashboard?b=${fixture.b}`);
  await page.waitForSelector('.dsh-quick', { timeout: 15000 }).catch(() => {});
  await wait(800);
  M[`acoes-${tag}`] = await page.evaluate(() => {
    const item = document.querySelector('.dsh-quick');
    if (!item) return null;
    const cs = getComputedStyle(item);
    const icone = item.querySelector('.dsh-quick__icon');
    const ci = icone ? getComputedStyle(icone) : null;
    const r = item.getBoundingClientRect(); const ri = icone?.getBoundingClientRect();
    return {
      itens: document.querySelectorAll('.dsh-quick').length,
      borda: cs.borderTopWidth, fundo: cs.backgroundColor,
      cardDentroDeCard: parseFloat(cs.borderTopWidth) > 0 && !/rgba?\(0, 0, 0, 0\)/.test(cs.backgroundColor),
      icone: ci ? { borda: ci.borderTopWidth, raio: ci.borderTopLeftRadius, fundo: ci.backgroundColor, tamanho: Math.round(ri.width) } : null,
      deltaCentroIcone: ri ? +(ri.x + ri.width / 2 - (r.x + r.width / 2)).toFixed(1) : null,
      alinhamento: cs.textAlign,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  await shot(`a-dashboard-${tag}`);
}

// ═══ EXECUÇÃO ══════════════════════════════════════════════════
await login(fixture.owner.email, fixture.owner.password);

// Dados da fixture (uma leitura só, antes de qualquer mutação).
const lista = await api('GET', `/api/bookings?businessId=${fixture.b}&mode=manage&from=${fixture.day}&to=${fixture.day}&limit=200`);
const bookings = lista.data?.bookings || [];
const pendente = bookings.find((b) => b.status === 'pending') || bookings[0];
const confirmado = bookings.find((b) => b.status === 'confirmed') || bookings[0];
const alvos = {
  pendente: {
    id: pendente?.id, status: pendente?.status, proximoRotulo: 'Confirmado',
    petOuNome: pendente?.petName || pendente?.customerName || '',
  },
  confirmado: {
    id: confirmado?.id, status: confirmado?.status, duracaoMin: confirmado?.durationMin || 30,
    startAt: confirmado?.startAt, endAt: confirmado?.endAt, time: confirmado?.time,
    petOuNome: confirmado?.petName || confirmado?.customerName || '',
    // Fim no RELÓGIO (o payload aceito pela rota de resize na reversão).
    horaFimOriginal: (() => {
      const [h, m] = String(confirmado?.time || '').split(':').map(Number);
      if (Number.isNaN(h)) return null;
      const total = h * 60 + m + (confirmado?.durationMin || 30);
      return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    })(),
  },
};
M.fixture = { totalNoDia: bookings.length, pendente: alvos.pendente, confirmado: alvos.confirmado };

for (const [w, , tag] of VIEWPORTS) {
  await step(`shell-${tag}`, () => shellFlow(w, tag));
  await step(`agenda-${tag}`, () => agendaFlows(w, tag));
  await step(`drag-${tag}`, () => dragFlow(w, tag));
  await step(`ctxmenu-${tag}`, () => contextMenuFlow(w, tag, alvos));
  await step(`perfil-${tag}`, () => profileFlow(w, tag));
  await step(`dashboard-${tag}`, () => dashboardFlow(w, tag));
}
await step('resize', () => resizeFlow(alvos));

// CLIENTS: administração × profissional (não-admin).
etapa = 'clientes';
await step('clientes-admin', async () => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/clientes?b=${fixture.b}`);
  await wait(900);
  M['clientes-admin'] = await page.evaluate(() => {
    const t = document.body.innerText;
    return { importar: t.includes('Importar'), exportar: t.includes('Exportar'), exportarTudo: t.includes('Exportar tudo (JSON)') };
  });
  await shot('a-clientes-admin-1440');
});
await step('clientes-naoadmin', async () => {
  await context.clearCookies();
  await login(fixture.clinicoEmail, SENHA_NAO_ADMIN);
  for (const [w, , tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
    await page.setViewportSize({ width: w, height: w === 390 ? 844 : 900 });
    await page.goto(`${base}/clientes?b=${fixture.b}`);
    await wait(900);
    const visto = await page.evaluate(() => {
      const t = document.body.innerText;
      return { importar: t.includes('Importar'), exportar: t.includes('Exportar'), exportarTudo: t.includes('Exportar tudo (JSON)') };
    });
    // E o SERVIDOR: a negação não pode depender de a tela esconder o botão.
    const csv = await api('GET', `/api/contacts/export?businessId=${fixture.b}`);
    const full = await api('GET', `/api/contacts/export-full?businessId=${fixture.b}`);
    const imp = await api('POST', '/api/contacts/import', { businessId: fixture.b, mode: 'preview', csv: 'nome;telefone\nQA;11999999999' });
    M[`clientes-naoadmin-${tag}`] = {
      ...visto,
      apiCsv: { status: csv.status, erro: csv.data?.error || null },
      apiFull: { status: full.status, erro: full.data?.error || null },
      apiImport: { status: imp.status, erro: imp.data?.error || null },
    };
    await shot(`a-clientes-naoadmin-${tag}`);
  }
});

M.console = {
  erros: consoleErrors,
  ruido,
  requisicoesComErro: requests,
  // Explicação: 403 esperados são PROVA das regras de permissão (profissional
  // não exporta/importa a base); 401 em revalidação de sessão é ruído do shell.
};
await fs.writeFile(path.join(outDir, 'audit-measurements.json'), JSON.stringify(M, null, 2));
await browser.close();
console.log('Auditoria em', path.join(outDir, 'audit-measurements.json'));
console.log('erros de console:', consoleErrors.length, '· requisições >=400:', requests.length);
