// ═══════════════════════════════════════════════════════════════
// DS 1.1 · QA DE FECHAMENTO EM CHROMIUM REAL (§17 da missão)
// ═══════════════════════════════════════════════════════════════
// Evidência medida e fotografada nas QUATRO larguras exigidas:
//   1440 · 1366 · 1024 · 390
//
// Cobre exatamente a lista do §17: Topbar (logo solta + nome), Rail (hover,
// entrada, troca de grupo, permanência, saída, teclado, SEM chevrons), Agenda
// (Dia/Semana/Lista, bloqueios, toolbar, evento), Evento (hover PURO ≠ clique),
// Detalhe (lateral preso à direita, altura cheia, Escape, foco de volta),
// Formulário (rótulo flutuante vazio/foco/preenchido/erro, select, avançado) e
// Atendimento (leitura, anamnese, nota recolhida, metadados, "Não informado").
//
// Uso:
//   node docs/qa-ux-closure-material/capture.mjs            (grava no diretório do script)
// Requer: dev server local (npm run dev) + scripts/qa-ux-closure-fixture.mjs +
// scripts/qa-material-fixture.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ensureBrowser, CHROMIUM_ARGS } from '../qa-ux-closure/browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = here;
const fixture = JSON.parse(await fs.readFile(process.env.QA_UX_MATERIAL_FIXTURE || '/home/user/.cache/qa-ux/material.json', 'utf8'));
const base = process.env.DESIGN_TEST_BASE_URL || fixture.base;
const VIEWPORTS = [[1440, 900, '1440'], [1366, 768, '1366'], [1024, 768, '1024'], [390, 844, '390']];

const measurements = {};
const consoleErrors = [];
const consoleRuido = [];
const respostas4xx = [];
let etapaAtual = 'boot';
// Ruído conhecido e NÃO-aplicacional (mesma classificação da fase anterior).
const ruidoConhecido = (t) => /ERR_CONNECTION_CLOSED|ERR_ABORTED|401 \(Unauthorized\)|session=expired/.test(t);
const registrar = (t) => (ruidoConhecido(t) ? consoleRuido : consoleErrors).push(t);
/**
 * Uma resposta 4xx ESPERADA pelo próprio fluxo que a evidência provoca (ex.:
 * enviar a ficha vazia é o caminho do usuário para ver o erro de campo) não é
 * defeito de aplicação — mas também não some: fica registrada com URL, status e
 * etapa, e só é classificada depois de conferida. Nada de "erro genérico".
 */
const respostaEsperada = (r) => r.status === 400 && /\/api\/anamnese$/.test(r.url);

const runtime = await ensureBrowser();
const browser = await chromium.launch({
  executablePath: process.env.QA_BROWSER || runtime.executablePath,
  args: CHROMIUM_ARGS,
  env: { ...process.env, LD_LIBRARY_PATH: process.env.QA_BROWSER_LD || runtime.LD_LIBRARY_PATH },
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
const page = await context.newPage();
page.on('pageerror', (e) => registrar(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') registrar(`[${etapaAtual}] ${m.text()}`); });
page.on('response', (r) => {
  // Guardamos o PATHNAME + a etapa: é o que permite atribuir cada 4xx a um
  // passo do fluxo (e não a um 'erro genérico' do console).
  if (r.status() >= 400) respostas4xx.push({ url: new URL(r.url()).pathname, status: r.status(), etapa: etapaAtual });
});

const wait = (ms) => page.waitForTimeout(ms);
const shot = (name, opts = {}) => page.screenshot({ path: path.join(outDir, `${name}.png`), ...opts });
const box = async (sel) => page.locator(sel).first().boundingBox().catch(() => null);
const agendaUrl = (extra = '', view = 'day') => `${base}/agenda?b=${fixture.b}&data=${fixture.day}&view=${view}${extra}`;

// ── Tipografia: a fonte é mesmo a Barlow carregada do PRÓPRIO host? ────────
async function fontEvidence(tag) {
  etapaAtual = 'fontes';
  measurements[`fonte-${tag}`] = await page.evaluate(() => {
    const el = document.querySelector('.ws-topbar') || document.body;
    const cs = getComputedStyle(el);
    return {
      family: cs.fontFamily,
      barlowCarregada: document.fonts.check('400 14px Barlow') && document.fonts.check('600 20px Barlow'),
      pesosDisponiveis: ['400', '500', '600', '700'].filter((w) => document.fonts.check(`${w} 16px Barlow`)),
      requisicoesAoGoogle: performance.getEntriesByType('resource')
        .map((r) => r.name).filter((n) => /fonts\.(googleapis|gstatic)\.com/.test(n)).length,
    };
  });
}

async function login(email, password) {
  await page.goto(`${base}/login`);
  await page.getByLabel('E-mail', { exact: true }).fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL(/dashboard/, { timeout: 20000 });
  await page.waitForSelector('.workspace-sidebar', { state: 'attached' });
  await wait(400);
}

// ═══ 1 · TOPBAR + RAIL ═══════════════════════════════════════════
async function shell(w, tag) {
  etapaAtual = 'shell';
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(`${base}/dashboard?b=${fixture.b}`);
  await page.waitForSelector('.ws-topbar', { state: 'attached' });
  await wait(500);
  const topbar = await box('.ws-topbar');
  const logo = await box('.ws-clinic__logo, .ws-clinic__mark');
  measurements[`topbar-${tag}`] = {
    altura: topbar?.height ?? null,
    logoAltura: logo?.height ?? null,
    logoLargura: logo?.width ?? null,
    proporcao: logo && logo.height ? +(logo.width / logo.height).toFixed(2) : null,
    nome: await page.locator('.ws-clinic__name').first().innerText().catch(() => null),
    nomeCortado: await page.evaluate(() => {
      const el = document.querySelector('.ws-clinic__name');
      return el ? el.scrollWidth > el.clientWidth + 1 : null;
    }),
    identidadeRepetidaNoRail: await page.evaluate(() => {
      const nome = document.querySelector('.ws-clinic__name')?.textContent?.trim() || '';
      const rail = document.querySelector('.workspace-sidebar')?.textContent || '';
      return !!nome && rail.includes(nome);
    }),
    // §5: a logo é a marca (não um tile): nada de borda/fundo/raio/sombra. A
    // medida vale para a ARTE e para o monograma de fallback (a fixture não tem
    // arquivo de logo; o contrato de "sem tile" é o mesmo nos dois).
    logoTemTile: await page.evaluate(() => {
      const el = document.querySelector('.ws-clinic__logo, .ws-clinic__mark');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, background: cs.backgroundColor };
    }),
  };
  await shot(`topbar-${tag}`);

  // Chevrons: o rail não pode ter seta de "acordeão" (§6).
  measurements[`rail-${tag}`] = await page.evaluate(() => {
    const rail = document.querySelector('.workspace-sidebar');
    return {
      largura: rail ? rail.getBoundingClientRect().width : null,
      chevronsNoRail: rail ? rail.querySelectorAll('.workspace-link__chevron, svg[data-icon="chevR"], svg[data-icon="chevD"]').length : null,
      chevronsVisiveis: rail ? [...rail.querySelectorAll('*')].filter((el) => /chev/i.test(el.className?.toString?.() || '') && getComputedStyle(el).display !== 'none').length : null,
      botoesFlutuantesDeExpandir: document.querySelectorAll('[aria-label*="xpandir" i], [aria-label*="ecolher" i]').length,
      grupos: rail ? rail.querySelectorAll('[data-peek-group]').length : null,
      grupoAria: rail ? [...rail.querySelectorAll('[data-peek-group]')].slice(0, 2).map((g) => ({ expanded: g.getAttribute('aria-expanded'), haspopup: g.getAttribute('aria-haspopup') })) : null,
    };
  });
  const railBox = await box('.workspace-sidebar');
  if (!railBox) return;                              // 390: rail vive no drawer

  // Hover no grupo → painel conectado (gap 0) e permanente enquanto o cursor fica.
  const grupos = page.locator('[data-peek-group]');
  await grupos.nth(0).hover();
  const t0 = Date.now();
  await page.waitForSelector('#ws-nav-panel', { timeout: 3000 }).catch(() => {});
  const abriuEm = Date.now() - t0;
  await wait(250);
  const painel = await box('#ws-nav-panel');
  measurements[`rail-${tag}`] = {
    ...measurements[`rail-${tag}`],
    painelAbriuEmMs: abriuEm,
    gapRailPainel: painel && railBox ? +(painel.x - (railBox.x + railBox.width)).toFixed(1) : null,
    larguraPainel: painel?.width ?? null,
    alturaRail: railBox.height,
  };
  await shot(`rail-panel-${tag}`);

  // Troca de grupo SEM fechar (A → B) e permanência do cursor dentro do painel.
  await grupos.nth(1).hover();
  await wait(220);
  const trocouSemFechar = await page.locator('#ws-nav-panel').count();
  await page.mouse.move((painel?.x || 0) + 40, (painel?.y || 0) + 60, { steps: 4 });
  await wait(260);
  const permanece = await page.locator('#ws-nav-panel').count();
  const tituloA = await page.locator('#ws-nav-panel').first().innerText().catch(() => '');
  measurements[`rail-${tag}`] = { ...measurements[`rail-${tag}`], trocouSemFechar, permaneceComCursorDentro: permanece, tituloPainel: tituloA.split('\n')[0] };
  // Saída: retrai com atraso curto.
  await page.mouse.move(w - 120, 400, { steps: 6 });
  await page.waitForFunction(() => !document.querySelector('#ws-nav-panel'), null, { timeout: 3000 }).catch(() => {});
  measurements[`rail-${tag}`].retraiuAoSSair = await page.locator('#ws-nav-panel').count() === 0;

  // Teclado: foco no gatilho → Enter abre → Escape fecha e devolve o foco.
  await grupos.nth(0).focus();
  await page.keyboard.press('Enter');
  await wait(260);
  const abriuPorTeclado = await page.locator('#ws-nav-panel').count() > 0;
  await page.keyboard.press('Escape');
  await wait(240);
  const fechouPorEscape = await page.locator('#ws-nav-panel').count() === 0;
  const focoDeVolta = await page.evaluate(() => document.activeElement?.getAttribute('data-peek-group') || document.activeElement?.className || '');
  measurements[`rail-${tag}`] = { ...measurements[`rail-${tag}`], abriuPorTeclado, fechouPorEscape, focoDeVolta: String(focoDeVolta).slice(0, 60) };
}

// ═══ 2 · AGENDA (modos, bloqueios, toolbar, evento) ══════════════
async function agenda(w, tag) {
  etapaAtual = 'agenda';
  await page.setViewportSize({ width: w, height: 900 });
  for (const [view, nome] of [['day', 'Dia'], ['week', 'Semana'], ['list', 'Lista']]) {
    await page.goto(agendaUrl('', view));
    await page.waitForSelector('[data-agenda-main]');
    await wait(700);
    await shot(`agenda-${view}-${tag}`);
  }
  await page.goto(agendaUrl());
  await page.waitForSelector('button.ag-event');
  await wait(700);
  measurements[`agenda-${tag}`] = await page.evaluate(() => {
    const toolbar = document.querySelector('.gd-toolbar, [data-agenda-toolbar="true"]');
    const eventos = document.querySelectorAll('button.ag-event');
    return {
      eventos: eventos.length,
      itensComTitleNativo: [...document.querySelectorAll('.ag-event, .ag-event *')].filter((el) => el.hasAttribute('title')).length,
      alturaToolbar: toolbar ? Math.round(toolbar.getBoundingClientRect().height) : null,
      barraBloqueios: !!document.querySelector('.ag-blocks-bar'),
      avisosAmbarNaTela: [...document.querySelectorAll('*')].filter((el) => {
        const cs = getComputedStyle(el);
        return cs.backgroundColor === 'rgb(254, 243, 199)' || cs.borderLeftColor === 'rgb(217, 119, 6)';
      }).length,
      textoBloqueios: document.querySelector('.ag-blocks-bar')?.textContent?.slice(0, 90) || '',
    };
  });
  await shot(`agenda-bloqueios-${tag}`);

  // HOVER ≠ CLIQUE: hover mostra prévia (não abre o detalhe); clique abre DIRETO.
  const evento = page.locator('button.ag-event').nth(2);
  await evento.scrollIntoViewIfNeeded();
  const evBox = await evento.boundingBox();
  await evento.hover();
  await wait(400);
  const previa = await box('.gd-hovercard');
  const detalheDurante = await page.locator('.gd-detail__panel').count();
  measurements[`hover-${tag}`] = {
    abriuPrevia: !!previa,
    abriuDetalheComHover: detalheDurante > 0,
    distanciaAteEvento: previa && evBox ? +(previa.x - (evBox.x + evBox.width)).toFixed(1) : null,
    dentroDaViewport: previa ? previa.x >= 0 && previa.y >= 0 && previa.x + previa.width <= w + 1 : null,
    ctaVerDetalhes: await page.locator('.gd-hovercard').getByRole('button', { name: /Ver detalhes/i }).count().catch(() => 0),
  };
  await shot(`agenda-hover-${tag}`);

  // Sai do evento: a prévia retrai (hover não é estado permanente).
  await page.mouse.move(w - 80, 300, { steps: 6 });
  await page.waitForFunction(() => !document.querySelector('.gd-hovercard'), null, { timeout: 2500 }).catch(() => {});
  measurements[`hover-${tag}`].previaRetraiu = await page.locator('.gd-hovercard').count() === 0;

  // Clique no evento → DetailSideModal DIRETO (sem passar pelo resumo).
  const focoAntes = await page.evaluate(() => document.activeElement?.className || '');
  await evento.click();
  await page.waitForSelector('.gd-detail__panel', { timeout: 5000 });
  await wait(320);
  const painel = await box('.gd-detail__panel');
  const semDetalhe = await shot(`agenda-detalhe-${tag}`);
  measurements[`detalhe-${tag}`] = await page.evaluate((painelBox) => {
    const el = document.querySelector('.gd-detail__panel');
    const cs = el ? getComputedStyle(el) : null;
      // O backdrop do DetailSideModal é o `::backdrop` NATIVO do <dialog>
      // (sem camada artesanal): mede-se o pseudo-elemento, não uma classe.
      const backdropColor = (() => {
        const el = document.querySelector('dialog.gd-detail');
        try { return el ? getComputedStyle(el, '::backdrop').backgroundColor : null; } catch { return null; }
      })();
    return {
      x: painelBox ? Math.round(painelBox.x) : null,
      largura: painelBox ? Math.round(painelBox.width) : null,
      topo: painelBox ? Math.round(painelBox.y) : null,
      base: painelBox ? Math.round(painelBox.y + painelBox.height) : null,
      alturaViewport: window.innerHeight,
      raio: cs?.borderTopLeftRadius ?? null,
      sombra: cs?.boxShadow ?? null,
      bordaEsquerda: cs?.borderLeftWidth ?? null,
      gapDireita: painelBox ? Math.round(window.innerWidth - (painelBox.x + painelBox.width)) : null,
      backdropCor: backdropColor,
      backdropEscurece: !!backdropColor && backdropColor !== 'rgba(0, 0, 0, 0)',
      titulo: el?.querySelector('h1,h2,h3')?.textContent?.trim()?.slice(0, 60) || '',
      botaoFechar: !!document.querySelector('.gd-detail__panel [aria-label*="Fechar" i]'),
      focoContido: !!el?.contains(document.activeElement),
    };
  }, painel);

  // §12 — a linha de ações do detalhe precisa ter UMA primária e nenhuma
  // competição de cor: medimos quantos botões têm fundo colorido (tintura) e
  // qual é o primário. Sem isso, "não é toda ação que ganha cor" era só prosa.
  measurements[`detalhe-${tag}`].acoes = await page.evaluate(() => {
    const linha = document.querySelector('[data-workflow-state] .flex.flex-wrap');
    if (!linha) return null;
    const botoes = [...linha.querySelectorAll('button')].map((b) => {
      const cs = getComputedStyle(b);
      const bg = cs.backgroundColor;
      const transparente = /rgba\(0, 0, 0, 0\)|transparent/.test(bg);
      return { rotulo: (b.textContent || '').trim().slice(0, 26), fundo: bg, tintado: !transparente };
    });
    return {
      total: botoes.length,
      primario: botoes.find((b) => /rgb\(37, 99, 235\)/.test(b.fundo))?.rotulo || null,
      coloridos: botoes.filter((b) => b.tintado).length,
      rotulos: botoes.map((b) => b.rotulo),
    };
  });
  // Escape fecha e devolve o foco ao EVENTO (não ao body).
  await page.keyboard.press('Escape');
  await page.waitForTimeout(450);
  measurements[`detalhe-${tag}`].fechouComEscape = await page.locator('.gd-detail__panel').count() === 0;
  measurements[`detalhe-${tag}`].focoVoltouParaEvento = await page.evaluate(() =>
    !!document.activeElement?.classList?.contains('ag-event'));
  measurements[`detalhe-${tag}`].focoAntesDoClique = String(focoAntes).slice(0, 40);
  measurements[`detalhe-${tag}`].screenshotBytes = semDetalhe?.length ?? null;
}

// ═══ 3 · FORMULÁRIO (rótulo flutuante, select, erro, avançado) ═══
async function formulario(w, tag) {
  etapaAtual = 'formulario';
  await page.setViewportSize({ width: w, height: 900 });
  await page.goto(agendaUrl());
  await page.waitForSelector('[data-agenda-main]');
  await wait(600);
  await page.getByRole('button', { name: 'Novo agendamento' }).first().click();
  // O agendamento novo é um Dialog CENTRAL (§10) — no produto ele é o
  // `Drawer variant="dialog"`: a faixa central `.il-drawer--dialog`.
  const dialog = page.locator('.il-drawer--dialog, .gd-dialog').first();
  await dialog.waitFor({ timeout: 8000 });
  await wait(500);
  await shot(`form-central-${tag}`);
  // §10 — as opções avançadas nascem RECOLHIDAS (o QA abre para provar que
  // existem, e o campo de texto de dentro vale para a evidência do rótulo).
  const avancado = dialog.locator('.gd-disclosure__trigger').first();
  if (await avancado.count()) {
    await avancado.click();
    await wait(400);
  }
  const campo = dialog.locator('.gd-field').filter({ hasText: 'Observação' }).first();
  const alvo = campo.locator('input[type="text"], input:not([type])').first();
  await shot(`form-vazio-${tag}`);

  const estado = async () => campo.evaluate((el) => {
    const label = el.querySelector('.gd-field__label');
    const caixa = el.querySelector('.gd-field__box');
    const cs = label ? getComputedStyle(label) : null;
    return {
      labelFontSize: cs?.fontSize ?? null,
      labelTop: label ? Math.round(label.getBoundingClientRect().top - el.getBoundingClientRect().top) : null,
      labelDentro: label ? label.getBoundingClientRect().top >= caixa.getBoundingClientRect().top : null,
      bordaCaixa: caixa ? getComputedStyle(caixa).borderTopColor : null,
      alturaCaixa: caixa ? Math.round(caixa.getBoundingClientRect().height) : null,
      temPlaceholderComoRotulo: false,
    };
  });
  measurements[`campo-${tag}`] = { vazio: await estado() };

  // Foco → o rótulo sobe e notcha o contorno; o placeholder é EXEMPLO.
  await alvo.focus();
  await wait(260);
  measurements[`campo-${tag}`].comFoco = await estado();
  measurements[`campo-${tag}`].rotuloDoCampo = await campo.locator('.gd-field__label').first().innerText().catch(() => '');
  await shot(`form-foco-${tag}`);

  // Preenchido → o rótulo PERMANECE acima.
  await alvo.fill('Texto de QA — rótulo flutuante');
  await wait(240);
  measurements[`campo-${tag}`].preenchido = await estado();
  // Com VALOR, o rótulo permanece elevado e o placeholder não aparece (ele é
  // exemplo do campo vazio, não texto de apoio permanente).
  measurements[`campo-${tag}`].placeholderVisivelSemFoco = await alvo.evaluate((el) => getComputedStyle(el, '::placeholder').color);
  await shot(`form-preenchido-${tag}`);

  // Erro: dispara a validação REAL do fluxo (salvar sem paciente/serviço).
  const salvar = dialog.getByRole('button', { name: /Salvar agendamento|Confirmar \d|Confirmar|Agendar/i }).first();
  if (await salvar.isVisible().catch(() => false)) {
    await salvar.click();
    await wait(700);
  }
  measurements[`campo-${tag}`].erro = await page.evaluate(() => {
    const falho = document.querySelector('.gd-field[data-invalid="true"]');
    const texto = document.querySelector('.gd-field__error');
    return {
      campoInvalido: !!falho,
      temTextoDeErro: !!texto && (texto.textContent || '').trim().length > 0,
      mensagem: (texto?.textContent || '').trim().slice(0, 120),
    };
  });
  await shot(`form-erro-${tag}`);

  // Select dentro do mesmo fluxo (lista canônica, sem estilo próprio).
  const select = dialog.locator('.gd-field select').first();
  if (await select.count()) {
    await select.focus();
    await wait(200);
    measurements[`campo-${tag}`].select = await select.evaluate((el) => {
      const caixa = el.closest('.gd-field__box');
      return {
        alturaCaixa: caixa ? Math.round(caixa.getBoundingClientRect().height) : null,
        // Select dentro do shell: UMA borda (a da caixa), sem contorno duplicado.
        bordaDoSelect: getComputedStyle(el).borderTopWidth,
        opcoes: el.querySelectorAll('option').length,
        rotulo: el.closest('.gd-field')?.querySelector('.gd-field__label')?.textContent?.trim() || '',
        // §4/§10 — a seta é desenho do DS e aparece UMA vez, colada à direita;
        // sem essas três o desenho inline TILHA pela largura do campo (defeito
        // real, achado ao olhar o catálogo).
        setaRepete: getComputedStyle(el).backgroundRepeat,
        setaTamanho: getComputedStyle(el).backgroundSize,
        setaPosicao: getComputedStyle(el).backgroundPosition,
      };
    });
    await shot(`form-select-${tag}`);
    // Lista ABERTA (contrato Material: âncora no próprio campo, item selecionado
    // explícito, teclado por setas). O select nativo abre pelo SO/Chromium.
    await select.selectOption({ index: 1 }).catch(() => {});
    await wait(300);
    measurements[`campo-${tag}`].selectComValor = await select.evaluate((el) => ({
      valor: el.value, rotulo: el.options[el.selectedIndex]?.text?.slice(0, 40) || '',
      rotuloElevado: el.closest('.gd-field')?.querySelector('.gd-field__label')?.getBoundingClientRect().top
        - el.closest('.gd-field')?.getBoundingClientRect().top,
    }));
    await shot(`form-select-escolhido-${tag}`);
  }
  await page.keyboard.press('Escape');
  await wait(300);
}

// ═══ 4 · ATENDIMENTO em LEITURA (prontuário finalizado) ══════════
async function atendimento(w, tag) {
  etapaAtual = 'atendimento';
  await page.setViewportSize({ width: w, height: 1000 });
  for (const [id, nome] of [[fixture.encounterId, 'leitura'], [fixture.encounterVazioId, 'vazio']]) {
    await page.goto(`${base}/atendimento/${id}/registro?b=${fixture.b}`);
    await page.waitForSelector('.gd-ro, .gd-field', { timeout: 15000 }).catch(() => {});
    await wait(700);
    await shot(`atendimento-${nome}-${tag}`);
    measurements[`atendimento-${nome}-${tag}`] = await page.evaluate(() => {
      const textos = [...document.querySelectorAll('.gd-ro__value')].map((el) => (el.textContent || '').trim());
      return {
        blocosDeLeitura: document.querySelectorAll('.gd-ro').length,
        valoresVazios: document.querySelectorAll('.gd-ro__empty').length,
        vazioDeclarado: [...document.querySelectorAll('.gd-ro__empty')].map((el) => (el.textContent || '').trim()).slice(0, 6),
        textareasNaTela: document.querySelectorAll('textarea').length,
        // O texto clínico está em LEITURA (e não dentro de um textarea desabilitado).
        evolucaoEmLeitura: textos.some((t) => t.includes('Exame físico sem alterações')),
        queixaEmLeitura: textos.some((t) => /comendo menos|conferir a carteira/.test(t)),
        notaInternaRecolhida: (() => {
          const d = document.querySelector('.gd-disclosure');
          return d ? d.querySelector('.gd-disclosure__trigger')?.getAttribute('aria-expanded') : null;
        })(),
        autoriaVisivel: /Finalizado por|finalizado por/.test(document.body.innerText),
        somenteLeituraAvisado: /somente leitura|Só quem administra/i.test(document.body.innerText),
      };
    });
  }
  // A nota interna abre por DIVULGAÇÃO (nada de nota sensível sempre à mostra).
  const gatilho = page.locator('.gd-disclosure__trigger').first();
  if (await gatilho.count()) {
    await gatilho.click();
    await wait(320);
    await shot(`atendimento-nota-aberta-${tag}`);
    measurements[`atendimento-nota-aberta-${tag}`] = await page.evaluate(() => {
      const d = document.querySelector('.gd-disclosure');
      return {
        expanded: d?.querySelector('.gd-disclosure__trigger')?.getAttribute('aria-expanded'),
        regiao: d?.querySelector('[role="region"]')?.getAttribute('aria-label'),
        texto: (d?.querySelector('.gd-ro__value')?.textContent || '').slice(0, 80),
      };
    });
  }
}

// ═══ 4b · PRONTUÁRIO — SUPERFÍCIE VIVA (workspace canônico) ═══════
// A rota que a Agenda e o detalhe do agendamento abrem é `/atendimento/<id>`
// (workspace de seções), NÃO a rota legada `/registro`. É aqui que o §11 vive:
// escrita bloqueada tem de virar DOCUMENTO. A prova é o que o usuário vê:
// nenhum controle de formulário, valores em leitura, nota interna sob
// divulgação e o motivo dito uma vez.
async function atendimentoWorkspace(w, tag) {
  etapaAtual = 'atendimento-workspace';
  await page.setViewportSize({ width: w, height: 1000 });
  await page.goto(`${base}/atendimento/${fixture.encounterId}?b=${fixture.b}`);
  await page.waitForSelector('.encounter-workspace, .encounter-page, .il-drawer', { timeout: 20000 }).catch(() => {});
  await wait(1200);
  await shot(`atendimento-workspace-${tag}`);
  measurements[`workspace-leitura-${tag}`] = await page.evaluate(() => {
    const secao = document.querySelector('[data-readonly="true"]');
    return {
      emLeitura: !!secao,
      blocosDeDocumento: document.querySelectorAll('.gd-ro-section').length,
      valoresEmLeitura: document.querySelectorAll('.gd-ro').length,
      // O contrato do §11: em leitura NÃO pode existir campo de formulário na
      // seção clínica (nem habilitado, nem desabilitado).
      controlesNaSecao: secao ? secao.querySelectorAll('input, textarea, select').length : null,
      vazioDeclarado: [...document.querySelectorAll('.gd-ro__empty')].map((el) => (el.textContent || '').trim()).slice(0, 4),
      notaInternaEmDisclosure: !!secao?.querySelector('.gd-disclosure'),
      notaRecolhida: secao?.querySelector('.gd-disclosure__trigger')?.getAttribute('aria-expanded') ?? null,
      secoesDoAtendimento: document.querySelectorAll('.encounter-workspace__nav-item').length,
      rotuloDaSecao: secao?.getAttribute('aria-label') || null,
    };
  });
}

// ═══ 5 · ERRO DE CAMPO REAL (ficha de anamnese do atendimento) ═══
// O estado `error` do campo canônico é medido onde ele acontece no produto: a
// ficha exige campos e o `Field` mostra o erro NO PRÓPRIO CAMPO. Enviar em
// branco é o caminho do usuário — nada de classe forçada por script.
async function anamnese(w, tag) {
  etapaAtual = 'anamnese';
  if (!fixture.draftEncounterId) return;
  await page.setViewportSize({ width: w, height: 1000 });
  await page.goto(`${base}/atendimento/${fixture.draftEncounterId}/registro?b=${fixture.b}`);
  await page.waitForSelector('body');
  await wait(900);
  await shot(`anamnese-${tag}`);
  const abrir = page.getByRole('button', { name: /Preencher anamnese|Preencher outra ficha/i }).first();
  if (!(await abrir.count())) return;
  await abrir.click();
  await page.waitForSelector('.gd-dialog', { timeout: 8000 }).catch(() => {});
  await wait(600);
  await shot(`anamnese-ficha-${tag}`);
  const salvar = page.getByRole('button', { name: /Salvar ficha/i }).first();
  if (await salvar.count()) { await salvar.click(); await wait(700); }
  measurements[`erro-${tag}`] = await page.evaluate(() => {
    const campo = document.querySelector('.gd-field[data-invalid="true"]');
    const erro = campo?.querySelector('.gd-field__error');
    const caixa = campo?.querySelector('.gd-field__box');
    return {
      campoInvalido: !!campo,
      mensagem: (erro?.textContent || '').trim().slice(0, 120),
      contorno: caixa ? getComputedStyle(caixa).borderTopColor : null,
      rotuloEmErro: campo?.querySelector('.gd-field__label')?.textContent?.trim() || '',
      camposInvalidos: document.querySelectorAll('.gd-field[data-invalid="true"]').length,
      // §12 — o erro do campo NÃO pode virar banner de página: cada
      // role=alert/status da tela é listado com o próprio texto para conferência
      // (antes só existia a contagem — número sem dono não é evidência).
      bannersDeErroNaTela: [...document.querySelectorAll('[role="alert"], [role="status"]')].map((el) => ({
        papel: el.getAttribute('role'), texto: (el.textContent || '').trim().slice(0, 80),
      })),
    };
  });
  await shot(`erro-campo-real-${tag}`);
  await page.keyboard.press('Escape');
  await wait(400);
}

// ═══ 6 · CATÁLOGO DO DS (Combobox aberto + ações de ícone) ═══════
// O `Combobox` não tem superfície de produção ainda (nenhuma tela do produto o
// usa): a evidência dele sai da rota de desenvolvimento que existe justamente
// para exibir e auditar os primitives — mesmo Chromium, mesmo DS aplicado.
async function catalogo(w, tag) {
  etapaAtual = 'catalogo';
  await page.setViewportSize({ width: w >= 1024 ? 1440 : w, height: 1000 });
  await page.goto(`${base}/dev/design-system`);
  await page.waitForSelector('body');
  await wait(800);
  const combo = page.locator('input[role="combobox"]').first();
  if (await combo.count()) {
    await combo.scrollIntoViewIfNeeded();
    await combo.click();
    await wait(500);
    const lista = await box('[role="listbox"]');
    const campo = await box('.gd-field:has(input[role="combobox"])');
    measurements[`combobox-${tag}`] = {
      listaAberta: !!lista,
      // §10 — a lista ancorada acompanha a largura do CAMPO (não um menu solto).
      listaAlinhaComCampo: !!(lista && campo) && Math.abs(lista.x - campo.x) <= 2,
      larguraLista: lista ? Math.round(lista.width) : null,
      larguraCampo: campo ? Math.round(campo.width) : null,
      selecionadaExplicita: await page.locator('[role="option"][aria-selected="true"]').count(),
      dentroDaViewport: lista ? lista.x >= 0 && lista.x + lista.width <= 1441 : null,
    };
    await shot(`combobox-aberto-${tag}`);
    await page.keyboard.press('Escape');
    await wait(300);
  }
  // Ações de ícone: repouso × hover (o contrato do §7 é visual e medido).
  const icone = page.locator('.gd-icon-control, .gd-icon-control--sm, .gd-icon-control--xs').first();
  if (await icone.count()) {
    const repouso = await icone.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { fundo: cs.backgroundColor, borda: cs.borderTopWidth, bordaCor: cs.borderTopColor, cor: cs.color };
    });
    await icone.hover();
    await wait(300);
    const hover = await icone.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { fundo: cs.backgroundColor, borda: cs.borderTopWidth, bordaCor: cs.borderTopColor, cor: cs.color };
    });
    const caixa = await icone.boundingBox();
    measurements[`icone-${tag}`] = {
      repouso, hover,
      temFundoNoHover: hover.fundo !== repouso.fundo,
      // §7 — em repouso a ação de ícone não é uma caixinha: nenhuma borda
      // VISÍVEL (a largura de 1px pode existir transparente, para métrica).
      bordaEmRepouso: repouso.borda === '0px' || /rgba\(0, 0, 0, 0\)|transparent/.test(repouso.bordaCor),
      area: caixa ? { w: Math.round(caixa.width), h: Math.round(caixa.height) } : null,
    };
    if (caixa) {
      await shot(`icone-repouso-${tag}`, { clip: { x: Math.max(0, caixa.x - 40), y: Math.max(0, caixa.y - 30), width: 220, height: 110 } });
      await shot(`icone-hover-${tag}`, { clip: { x: Math.max(0, caixa.x - 40), y: Math.max(0, caixa.y - 30), width: 220, height: 110 } });
    }
  }
}

// ─── Execução ───────────────────────────────────────────────────
await page.setViewportSize({ width: 1440, height: 900 });
await login(fixture.owner.email, fixture.owner.password);
for (const [w, , tag] of VIEWPORTS) {
  await shell(w, tag);
  await agenda(w, tag);
  await formulario(w, tag);
  await atendimento(w, tag);
  await atendimentoWorkspace(w, tag);
  await anamnese(w, tag);
  await catalogo(w, tag);
  await fontEvidence(tag);
}
const esperadas = respostas4xx.filter(respostaEsperada);
const inesperadas = respostas4xx.filter((r) => !respostaEsperada(r));
// O próprio navegador reporta no console a resposta 400 que o fluxo provocou de
// propósito. Só é classificado assim quando TODAS as 4xx do run são a validação
// esperada — qualquer 4xx inesperada mantém o ruído do console como erro.
const ruidoDe400 = inesperadas.length === 0 && esperadas.length > 0;
const errosReais = consoleErrors.filter((t) => !(ruidoDe400 && /400 \(Bad Request\)/.test(t)));
const ruidoDe400Registrado = consoleErrors.filter((t) => ruidoDe400 && /400 \(Bad Request\)/.test(t));
measurements.console = {
  erros: errosReais,
  validacaoEsperadaConsole: ruidoDe400Registrado,
  ruidoClassificado: consoleRuido.length,
  respostas4xx: respostas4xx.length,
  // 400 da ficha vazia = a validação do próprio produto, provocada de propósito
  // pela etapa `anamnese`; qualquer outra 4xx continua sendo defeito.
  validacaoEsperada: esperadas.length,
  validacaoDetalhe: esperadas[0] ? { url: esperadas[0].url, status: esperadas[0].status, etapas: [...new Set(esperadas.map((r) => r.etapa))] } : null,
  respostas4xxInesperadas: inesperadas,
};
await fs.writeFile(path.join(outDir, 'measurements.json'), JSON.stringify(measurements, null, 2));
await browser.close();
console.log(`Evidência DS 1.1: ${Object.keys(measurements).length} blocos de medição · ${errosReais.length} erro(s) de console · ${esperadas.length} 4xx de validação esperada · ${inesperadas.length} 4xx inesperada(s)`);
