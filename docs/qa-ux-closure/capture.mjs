// ═══════════════════════════════════════════════════════════════
// QA UX CLOSURE — HOMOLOGAÇÃO VISUAL EM CHROMIUM REAL
// ═══════════════════════════════════════════════════════════════
// Captura a evidência exigida pela missão (App Shell + Agenda + Design
// System) e MEDE numericamente o que o critério de aceite exige:
//   • toolbar: mesma altura para Hoje / setas / data / Dia-Semana-Lista / CTAs;
//   • hover card: distância real até o evento e permanência na viewport;
//   • painel de grupo: conectado ao rail (sem gap morto).
//
// Uso:
//   node docs/qa-ux-closure/capture.mjs before            → /docs/qa-ux-closure/before
//   node docs/qa-ux-closure/capture.mjs after             → /docs/qa-ux-closure/after
// Requer a fixture de scripts/qa-ux-closure-fixture.mjs e o servidor local.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { ensureBrowser, CHROMIUM_ARGS } from './browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const phase = process.argv[2] || 'after';
const outDir = path.join(here, phase);
const fixture = JSON.parse(await fs.readFile(process.env.QA_UX_FIXTURE || '/home/user/.cache/qa-ux/fixture.json', 'utf8'));
const base = process.env.DESIGN_TEST_BASE_URL || fixture.base;
await fs.mkdir(outDir, { recursive: true });

const measurements = {};
// Navegador garantido na hora: o ambiente pode não trazer Chromium (/tmp e
// node_modules não sobrevivem entre execuções). Ver `browser.mjs`.
const runtime = await ensureBrowser();
const browser = await chromium.launch({
  executablePath: process.env.QA_BROWSER || runtime.executablePath,
  args: CHROMIUM_ARGS,
  env: { ...process.env, LD_LIBRARY_PATH: process.env.QA_BROWSER_LD || runtime.LD_LIBRARY_PATH },
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const consoleErrors = [];
const consoleRuido = [];
/** Ruído conhecido e NÃO-aplicacional: o prefetch RSC abortado pelo próprio
 *  roteador e o 401 esperado de `/api/auth/me` no estado deslogado. Sem esta
 *  separação, "erro de página" misturava aborrecimento de roteador com defeito
 *  real — e o relatório ficava ambíguo. */
const ruidoConhecido = (texto) => /ERR_CONNECTION_CLOSED|ERR_ABORTED|401 \(Unauthorized\)|session=expired/.test(texto);
const registrar = (texto) => (ruidoConhecido(texto) ? consoleRuido : consoleErrors).push(texto);
page.on('pageerror', (e) => registrar(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') registrar(m.text()); });

async function login() {
  await page.goto(`${base}/login`);
  await page.getByLabel('E-mail', { exact: true }).fill(fixture.owner.email);
  await page.getByLabel('Senha', { exact: true }).fill(fixture.owner.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.waitForURL(/dashboard/);
  await page.waitForSelector('.workspace-sidebar');
}
async function shot(name, opts = {}) {
  await page.screenshot({ path: path.join(outDir, `${name}.png`), ...opts });
}
// `view` é do PRÓPRIO helper: antes o sufixo `&view=week` era colado depois de
// um `view=day` já presente, o navegador mandava `view=day&view=week` e a tela
// (que lê a PRIMEIRA ocorrência) seguia em Dia — as capturas de Semana/Lista
// eram, na verdade, o Dia. Aqui a view é argumento, nunca sobra.
const agendaUrl = (extra = '', view = 'day') => `${base}/agenda?b=${fixture.b}&data=${fixture.day}&view=${view}${extra}`;

// ── 1. Topbar + rail + painel de grupo ─────────────────────────
async function shellEvidence(width, height, tag) {
  await page.setViewportSize({ width, height });
  await page.goto(`${base}/dashboard?b=${fixture.b}`);
  await page.waitForSelector('.workspace-sidebar', { state: 'attached' });
  await page.waitForTimeout(600);
  await shot(`shell-${tag}-rail-closed`);
  const rail = await page.locator('.workspace-sidebar').boundingBox();
  const topbar = await page.locator('.ws-topbar').boundingBox();
  measurements[`rail-${tag}`] = { width: rail?.width, visible: !!rail, topbarTop: topbar?.top, topbarWidth: topbar?.width };

  // IDENTIDADE (item 2) — medida em TODAS as larguras, inclusive 390: a topbar
  // é a mesma nas quatro, então a identidade precisa ser aprovável também no
  // celular (antes o early-return do rail pulava a métrica em 390).
  measurements[`identity-${tag}`] = {
    // Item 2 da missão: logo + NOME COMPLETO da clínica na topbar.
    clinicName: await page.locator('.ws-clinic__name').first().innerText().catch(() => null),
    clinicNameVisible: await page.locator('.ws-clinic__name').first().isVisible().catch(() => false),
    // Nome CORTADO por elipse = identidade ilegível (item 2). Precisa ser falso
    // em 1440/1366/1024 e em 390.
    clinicNameTruncated: await page.evaluate(() => {
      const el = document.querySelector('.ws-clinic__name');
      return el ? el.scrollWidth > el.clientWidth + 1 : null;
    }),
    hasLogo: await page.locator('.ws-clinic__logo, .ws-clinic__mark').count(),
    clinicLeftX: (await page.locator('[data-clinic-identity="true"]').first().boundingBox().catch(() => null))?.x ?? null,
    topbarText: (await page.locator('.ws-topbar').innerText()).split('\n').slice(0, 4),
    // Sem sidebar (abaixo do breakpoint) a checagem roda no drawer aberto — o
    // menu móvel é a "sidebar" desta largura e também não repete a identidade.
    sidebarText: await page.evaluate(() =>
      (document.querySelector('.workspace-sidebar')?.textContent || '').split('\n').slice(0, 6)),
    sidebarHasClinicName: await page.evaluate(() => {
      const clinic = document.querySelector('.ws-clinic__name')?.textContent?.trim() || '';
      const side = document.querySelector('.workspace-sidebar')?.textContent || '';
      return !!clinic && side.includes(clinic);
    }),
    // Nenhum controle de expandir/recolher a navegação (o rail é fixo).
    railCollapseControls: await page.evaluate(() =>
      document.querySelectorAll('.workspace-sidebar [aria-label*="navegação"], .workspace-sidebar .workspace-foot__item--collapse').length),
  };

  if (!rail) {
    // Abaixo do breakpoint o rail não existe: registra o menu móvel como a
    // navegação disponível nesta largura (antes/depois).
    const toggle = page.getByRole('button', { name: 'Abrir navegação' });
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
      await page.waitForTimeout(500);
      await shot(`shell-${tag}-drawer`);
      // O drawer móvel também não repete a identidade da topbar.
      measurements[`identity-${tag}`].drawerText = await page.evaluate(() =>
        (document.querySelector('.workspace-nav-drawer')?.textContent || '').split('\n').slice(0, 6));
      measurements[`identity-${tag}`].drawerHasClinicName = await page.evaluate(() => {
        const clinic = document.querySelector('.ws-clinic__name')?.textContent?.trim() || '';
        const drawer = document.querySelector('.workspace-nav-drawer')?.textContent || '';
        return !!clinic && drawer.includes(clinic);
      });
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    }
    return;
  }
  // Hover no grupo Clínica → painel conectado ao rail
  const group = page.locator('[data-peek-group]').first();
  const groupLabel = await group.getAttribute('data-peek-group').catch(() => null);
  await group.hover();
  await page.waitForTimeout(400);
  const panel = page.locator('#ws-nav-panel');
  if (await panel.count()) {
    const pb = await panel.boundingBox();
    const rb = await page.locator('.workspace-sidebar').boundingBox();
    measurements[`panel-${tag}`] = { group: groupLabel, railRight: rb && rb.x + rb.width, panelLeft: pb?.x, gap: pb && rb ? pb.x - (rb.x + rb.width) : null, panelWidth: pb?.width };
    await shot(`shell-${tag}-group-open`);
    // Cursor dentro do painel: continua aberto
    await page.mouse.move((pb?.x || 0) + 40, (pb?.y || 0) + 40);
    await page.waitForTimeout(350);
    measurements[`panel-${tag}`].openWithCursorInside = await panel.count();
    await shot(`shell-${tag}-group-cursor-inside`);
    // Troca de grupo sem fechar/reabrir — Automação e depois GESTÃO (a troca
    // Clínica→Gestão é item explícito da homologação).
    const groups = await page.locator('[data-peek-group]').all();
    const swapTo = async (index, name) => {
      if (groups.length <= index) return;
      const otherId = await groups[index].getAttribute('data-peek-group');
      await groups[index].hover();
      await page.waitForTimeout(320);
      const panelNow = page.locator('#ws-nav-panel');
      const stillOpen = await panelNow.count();
      // O swap troca o CONTEÚDO sem desmontar o painel: mesma posição na tela.
      const boxNow = stillOpen ? await panelNow.boundingBox() : null;
      measurements[`panel-${tag}`][name] = stillOpen
        ? { label: await panelNow.getAttribute('aria-label'), groupId: otherId, panelLeft: boxNow?.x, gap: rb && boxNow ? boxNow.x - (rb.x + rb.width) : null }
        : null;
      await shot(`shell-${tag}-group-swap-${name}`);
    };
    await swapTo(1, 'automacao');
    await swapTo(2, 'gestao');

    // EQUIVALENTE POR TECLADO (item 1): foco no grupo + ArrowRight abre e TRAVA
    // o painel; o foco entra nos destinos; Escape fecha e devolve o foco.
    await page.mouse.move(width - 4, height - 4);
    await page.waitForTimeout(700);
    measurements[`panel-${tag}`].closedAfterLeave = (await page.locator('#ws-nav-panel').count()) === 0;
    await shot(`shell-${tag}-group-closed`);
    await group.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(320);
    const kbPanel = page.locator('#ws-nav-panel');
    const kbOpen = await kbPanel.count();
    measurements[`panel-${tag}`].keyboard = { openedByArrow: kbOpen > 0 };
    if (kbOpen) {
      await page.keyboard.press('ArrowDown');
      measurements[`panel-${tag}`].keyboard.focusInPanel = await page.evaluate(() =>
        (document.activeElement?.getAttribute('role') || '') === 'menuitem');
      await shot(`shell-${tag}-group-keyboard`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(260);
      measurements[`panel-${tag}`].keyboard.closedByEscape = (await page.locator('#ws-nav-panel').count()) === 0;
      measurements[`panel-${tag}`].keyboard.focusBackOnGroup = await page.evaluate(() =>
        document.activeElement?.getAttribute('data-peek-group') !== null);
    }
  }
  // Tooltip nativo no rail?
  measurements[`native-title-${tag}`] = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.workspace-sidebar [title]')).length);
}

// ── 2. Agenda: Dia / Semana / Lista + toolbar + hover + detalhe ──
async function agendaEvidence(width, height, tag) {
  await page.setViewportSize({ width, height });
  await page.goto(agendaUrl());
  await page.waitForSelector('[data-agenda-page]');
  await page.waitForTimeout(900);
  await shot(`agenda-day-${tag}`);

  // Igualdade exata pedida pela missão: Hoje e as SETAS são o mesmo controle.
  // ITEM 5 — "UMA métrica": não basta o Hoje e as setas; TODOS os controles da
  // linha 1 são medidos individualmente e a igualdade é AFIRMADA por um booleano
  // (`identical`). Antes a medição só olhava o Hoje e as setas e passava mesmo
  // com um `h-[37px]` em qualquer outro controle.
  measurements[`toolbar-row1-heights-${tag}`] = await page.evaluate(() => {
    const page1 = document.querySelector('[data-agenda-page]');
    const byLabel = (re) => Array.from(page1.querySelectorAll('button, .il-field-control, [role="combobox"]'))
      .find((b) => re.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
    const ctrl = {
      hoje: byLabel(/^Hoje$/),
      anterior: page1.querySelector('[aria-label*="Anterior" i], [aria-label*="anterior" i]'),
      proximo: page1.querySelector('[aria-label*="Próximo" i], [aria-label*="proximo" i], [aria-label*="Próxim" i]'),
      data: byLabel(/^(Escolher|Data|Hoje,)/) || page1.querySelector('[aria-label*="ata" i]'),
      dia: byLabel(/^Dia$/), semana: byLabel(/^Semana$/), lista: byLabel(/^Lista$/),
      filtros: byLabel(/^Filtros?$/), fila: byLabel(/^Fila$/),
      bloquear: byLabel(/^Bloquear/), novo: byLabel(/^Novo agendamento$/),
    };
    // A régua é a do CONTROLE: no `Segmented` (Dia/Semana/Lista) a superfície
    // medida é o TRILHO (`role=tablist`), não a opção interna — o contrato do
    // DS é que o trilho tenha a altura do Button do nível e a opção seja um
    // recorte interno. Sem isso, a opção (32) pareceria divergir de 40.
    const h = {};
    const opcoes = {};
    for (const [k, el] of Object.entries(ctrl)) {
      if (!el) continue;
      const trilho = el.closest('.il-segmented');
      h[k] = Math.round((trilho || el).getBoundingClientRect().height);
      if (trilho) opcoes[k] = Math.round(el.getBoundingClientRect().height);
    }
    const icones = ['anterior', 'proximo'].filter((k) => h[k] != null);
    const quadrados = icones.every((k) => {
      const r = ctrl[k].getBoundingClientRect();
      return Math.abs(r.width - r.height) <= 1;
    });
    const presentes = Object.keys(h);
    const valores = [...new Set(Object.values(h))];
    return { alturas: h, distintos: valores, identical: valores.length === 1, opcoesInternas: opcoes, iconButtonsQuadrados: quadrados };
  });

  measurements[`toolbar-${tag}`] = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-agenda-page] button, [data-agenda-page] [role="group"] button, [data-agenda-page] .il-field-control'));
    return nodes.slice(0, 40).map((n) => {
      const r = n.getBoundingClientRect();
      return { text: (n.textContent || '').trim().slice(0, 22), h: Math.round(r.height * 10) / 10, w: Math.round(r.width * 10) / 10 };
    }).filter((x) => x.h > 0);
  });

  // Hover do evento
  const event = page.locator('button.ag-event').first();
  if (await event.count()) {
    const eb = await event.boundingBox();
    await event.hover();
    await page.waitForTimeout(500);
    const card = page.locator('.gd-hovercard');
    if (await card.count()) {
      const cb = await card.boundingBox();
      measurements[`hovercard-${tag}`] = {
        event: eb, card: cb,
        gapX: cb && eb ? Math.round((cb.x - (eb.x + eb.width)) * 10) / 10 : null,
        gapY: cb && eb ? Math.round((cb.y - eb.y) * 10) / 10 : null,
        insideViewport: cb ? cb.x >= 0 && cb.y >= 0 && cb.x + cb.width <= width && cb.y + cb.height <= height : null,
        text: (await card.innerText()).split('\n').slice(0, 8),
      };
      await shot(`agenda-day-hover-${tag}`);
      // Ver detalhes a partir do card
      const ver = card.getByRole('link', { name: /Ver detalhes/i }).or(card.getByRole('button', { name: /Ver detalhes/i }));
      if (await ver.count()) {
        await ver.first().click();
        await page.waitForTimeout(600);
        await shot(`agenda-detail-${tag}`);
        // O papel de DETALHE é o painel (`--gd-detail-w`), não o wrapper do
        // `<dialog>` — medir o wrapper devolvia a viewport inteira e escondia a
        // largura real de 460px. Medimos o painel: largura, encostado à direita
        // com a margem do token, e o Escape devolvendo a agenda.
        const panel = page.locator('.gd-detail__panel').first();
        const pb = await panel.boundingBox().catch(() => null);
        const pbWidth = await panel.evaluate((el) => getComputedStyle(el).width).catch(() => null);
        measurements[`detail-${tag}`] = {
          panel: pb,
          panelWidthCss: pbWidth,
          widthPct: pb ? Math.round((pb.width / width) * 100) : null,
          rightGap: pb ? Math.round(width - (pb.x + pb.width)) : null,
          topGap: pb ? Math.round(pb.y) : null,
          title: await page.locator('.gd-detail__panel h2').first().innerText().catch(() => null),
          viewport: { width, height },
        };
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
        measurements[`detail-${tag}`].escClosed = (await page.locator('.gd-detail__panel').count()) === 0;
        measurements[`detail-${tag}`].focusBackOnEvent = await page.evaluate(() =>
          !!document.activeElement?.classList?.contains('ag-event'));
      }
      // Mantém-se aberto com o cursor DENTRO do card (não é um tooltip fugitivo).
      await card.hover();
      await page.waitForTimeout(320);
      measurements[`hovercard-${tag}`].openWithCursorInside = (await card.count()) > 0;
      await shot(`agenda-hover-cursor-inside-${tag}`);
      await page.mouse.move(Math.round(width / 2), Math.round(height - 8));
      await page.waitForTimeout(420);

      // POSICIONAMENTO em TODOS os atendimentos da grade (item 3A): o resumo
      // sai à direita quando cabe, FLIPA à esquerda quando o evento está na
      // coluna da direita e, quando a tela não comporta nenhum dos lados (toque),
      // empilha fora do evento. Sempre a 8–12px e dentro da viewport.
      const allEvents = page.locator('[data-agenda-column] button.ag-event');
      const count = await allEvents.count();
      const placements = [];
      for (let i = 0; i < count; i += 1) {
        const ev = allEvents.nth(i);
        await ev.scrollIntoViewIfNeeded().catch(() => {});
        const box = await ev.boundingBox();
        if (!box) continue;
        await ev.hover();
        await page.waitForTimeout(330);
        const c = page.locator('.gd-hovercard');
        if (!(await c.count())) { placements.push({ i, absent: true }); continue; }
        const cb = await c.boundingBox();
        const right = box.x + box.width, cRight = cb.x + cb.width;
        const stacked = cb.y >= box.y + box.height - 1 || cb.y + cb.height <= box.y + 1;
        const side = cRight <= box.x + 1 ? 'left' : cb.x >= right - 1 ? 'right' : (stacked ? 'stacked' : 'overlap');
        const gap = cRight <= box.x ? +(box.x - cRight).toFixed(1)
          : cb.x >= right ? +(cb.x - right).toFixed(1)
          : cb.y >= box.y + box.height ? +(cb.y - (box.y + box.height)).toFixed(1)
          : +(box.y - (cb.y + cb.height)).toFixed(1);
        placements.push({
          i, side, gap,
          insideViewport: cb.x >= 0 && cRight <= width && cb.y >= 0 && cb.y + cb.height <= height,
          place: await c.getAttribute('data-place'),
        });
        if (side === 'left' && !placements.some((p) => p.side === 'left' && p.shot)) {
          placements[placements.length - 1].shot = true;
          await shot(`agenda-hover-flip-${tag}`);
        }
        await page.mouse.move(Math.round(width / 2), Math.round(height - 8));
        await page.waitForTimeout(380);
      }
      measurements[`hovercard-placement-${tag}`] = {
        total: placements.length,
        sides: placements.map((p) => p.side),
        gapsOk: placements.every((p) => p.gap != null && p.gap >= 8 && p.gap <= 12),
        allInsideViewport: placements.every((p) => p.insideViewport !== false),
        noOverlap: placements.every((p) => p.side !== 'overlap'),
        details: placements,
      };
    } else {
      measurements[`hovercard-${tag}`] = { present: false };
    }
    // Tooltip NATIVO no evento (o defeito que a missão manda eliminar) e em
    // qualquer elemento da GRADE — a barra de ferramentas tem dicas próprias.
    measurements[`native-title-events-${tag}`] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-agenda-page] button.ag-event[title]')).length);
    measurements[`native-title-grid-${tag}`] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-agenda-page] [data-agenda-column] [title]')).length);
  }

  // Bloqueio operacional: indicador compacto + hachura na grade (item 4).
  measurements[`blocks-${tag}`] = await page.evaluate(() => {
    const bar = document.querySelector('.ag-blocks-bar');
    const r = bar?.getBoundingClientRect();
    return {
      indicator: bar ? { h: Math.round(r.height), text: (bar.textContent || '').trim().slice(0, 90) } : null,
      gridBlocks: document.querySelectorAll('.ag-block').length,
      hatched: !!document.querySelector('.ag-block__hatch'),
      bigAmberBox: !!document.querySelector('[data-agenda-page] .bg-amber-50.border-amber-500'),
    };
  });

  // CONSISTÊNCIA GLOBAL (item 6): fora da Agenda também — botões, inputs,
  // selects e date pickers das telas principais têm de cair na MESMA escala de
  // controle do DS (28/34/40/44). Qualquer altura fora da escala é reportada.
  const CONTROL_SCALE = [28, 34, 40, 44];
  // A varredura do item 6 é GLOBAL: as quatro páginas da homologação mais as
  // outras superfícies do shell, para que a sobra (se houver) seja MEDIDA em
  // cada uma — nunca afirmada de memória.
  const auditPages = ['/dashboard', '/agenda', '/clientes', '/configuracoes',
    '/equipe', '/servicos', '/pagina', '/campanhas', '/produtos', '/pedidos', '/recursos', '/agente'];
  const audit = {};
  for (const path of auditPages) {
    await page.goto(`${base}${path}?b=${fixture.b}`);
    await page.waitForSelector('[data-agenda-page], main, .workspace-content', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
    audit[path] = await page.evaluate((scale) => {
      // A régua é do CONTROLE, então cada altura fora da escala é CLASSIFICADA
      // antes de virar violação:
      //   • nested → elemento interno de um controle (o input dentro do campo de
      //     40px, o chip dentro do trilho do Segmented): a métrica do controle
      //     é a do conjunto, não a do filho;
      //   • link   → sem caixa (sem borda e sem fundo): é link, não controle;
      //   • row    → superfície de linha/card (lista), não um botão de ação.
      const klass = (n) => {
        const cs = getComputedStyle(n);
        // textarea é MULTILINHA por contrato (min-height 76): a régua de altura
        // de controle não se aplica — o que se cobra é o mínimo canônico.
        if (n.tagName === 'TEXTAREA') return n.getBoundingClientRect().height >= 76 ? 'nested' : 'violacao';
        // Interruptor (switch) tem trilho próprio — o alvo é maior que o trilho.
        if (n.getAttribute('role') === 'switch' || n.closest('[role="switch"]') || /\bh-6\b/.test(String(n.className))) return 'switch';
        if (n.parentElement?.closest('.il-segmented, .global-search__field, .il-field-control, .il-control, .gd-control')) return 'nested';
        if (cs.borderTopWidth === '0px' && (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent')) return 'link';
        if (n.closest('li, tr, [role="row"], .dsh-card')) return 'row';
        return 'violacao';
      };
      const heights = Array.from(document.querySelectorAll('button, input, select, .il-field-control, .il-control'))
        .map((n) => ({ el: n, h: Math.round(n.getBoundingClientRect().height),
          label: (n.getAttribute('aria-label') || n.textContent || '').trim().slice(0, 24) }))
        .filter((x) => x.h > 0);
      const off = heights.filter((x) => !scale.includes(x.h));
      const byClass = {};
      for (const x of off) { const k = klass(x.el); (byClass[k] ||= []).push({ label: x.label, h: x.h }); }
      return {
        total: heights.length,
        distinct: [...new Set(heights.map((x) => x.h))].sort((a, b) => a - b),
        foraDaEscala: off.length,
        nested: (byClass.nested || []).length,
        link: (byClass.link || []).length,
        row: (byClass.row || []).length,
        violacoes: byClass.violacao || [],
      };
    }, CONTROL_SCALE);
  }
  measurements[`controls-global-${tag}`] = audit;

  for (const view of ['week', 'list']) {
    await page.goto(agendaUrl('', view));
    await page.waitForSelector('[data-agenda-page]');
    await page.waitForTimeout(900);
    await shot(`agenda-${view}-${tag}`);
    // Evidência verificável: a URL tem UMA view e é a pedida (não sobrou a
    // anterior). Sem isso, um `view` duplicado passaria como captura válida.
    const modes = await page.evaluate(() => {
      const params = new URL(location.href).searchParams;
      // O seletor de modo é o `Segmented` do DS (role="tab" + aria-selected).
      const pressed = Array.from(document.querySelectorAll('[data-agenda-page] [role="tab"][aria-selected="true"]')).map((b) => (b.textContent || '').trim());
      return { views: params.getAll('view'), pressed: pressed.slice(0, 4) };
    });
    measurements[`view-${view}-${tag}`] = modes;
  }

  // De volta à visão DIA (o loop acima termina em Lista): é aqui que o slot
  // vazio existe para o teste de criação rápida.
  await page.goto(agendaUrl());
  await page.waitForSelector('[data-agenda-page]');
  await page.waitForTimeout(700);

  // SLOT VAZIO → popover CURTO (criação rápida) com "Mais opções", que abre o
  // MESMO modal central já pré-preenchido (item 3C). Aqui a evidência é a
  // geometria: popover pequeno no slot vs. modal central de 672px.
  // A grade é mais alta que a dobra: `boundingBox()` devolve coordenadas de
  // PÁGINA, e clicar em 75% da altura caía fora da viewport (o clique nunca
  // chegava na coluna). O ponto é escolhido DENTRO da dobra, numa área vazia
  // no topo da grade.
  const slotColumn = page.locator('[data-agenda-column]').first();
  const slotBox = await slotColumn.boundingBox();
  const slotPoint = { x: Math.round(slotBox.x + slotBox.width / 2), y: Math.max(90, Math.round(slotBox.y) + 46) };
  await page.mouse.move(slotPoint.x, slotPoint.y);
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
  await page.waitForTimeout(700);
  const quick = page.locator('.gd-popover').first();
  if (await quick.count()) {
    measurements[`slot-point-${tag}`] = slotPoint;
    const qb = await quick.boundingBox();
    measurements[`slot-popover-${tag}`] = { box: qb, width: qb?.width, height: qb?.height,
      hasMoreOptions: await quick.getByRole('button', { name: /Mais opções/i }).count() > 0 };
    await shot(`agenda-slot-popover-${tag}`);
    const more = quick.getByRole('button', { name: /Mais opções/i });
    if (await more.count()) {
      await more.click();
      await page.waitForTimeout(700);
      const dlg = page.getByRole('dialog').first();
      const db = await dlg.boundingBox().catch(() => null);
      measurements[`slot-more-modal-${tag}`] = { box: db, widthPct: db ? Math.round((db.width / width) * 100) : null,
        isCentralDialog: await page.locator('dialog.il-drawer--dialog').count() > 0 };
      await shot(`agenda-slot-more-modal-${tag}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
  } else {
    measurements[`slot-popover-${tag}`] = { present: false };
  }

  // Novo agendamento (modal central?)
  await page.getByRole('button', { name: /Novo agendamento/i }).first().click();
  await page.waitForTimeout(700);
  await shot(`agenda-new-booking-${tag}`);
  const newBox = await page.getByRole('dialog').first().boundingBox().catch(() => null);
  measurements[`new-booking-${tag}`] = newBox ? {
    box: newBox,
    centered: Math.abs((newBox.x + newBox.width / 2) - width / 2) < width * 0.12,
    widthPct: Math.round((newBox.width / width) * 100),
  } : null;
  await page.keyboard.press('Escape').catch(() => {});
}

await login();
await shellEvidence(1440, 900, '1440');
await agendaEvidence(1440, 900, '1440');
await shellEvidence(1366, 768, '1366');
await agendaEvidence(1366, 768, '1366');
await shellEvidence(1024, 768, '1024');
await agendaEvidence(1024, 768, '1024');
await shellEvidence(390, 844, '390');
await agendaEvidence(390, 844, '390');
// Mobile: drawer de navegação
{
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/dashboard?b=${fixture.b}`);
  await page.waitForSelector('.ws-topbar');
  await page.waitForTimeout(500);
  const toggle = page.getByRole('button', { name: 'Abrir navegação' });
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click();
    await page.waitForTimeout(500);
    await shot('shell-390-mobile-drawer');
  }
  await shot('dashboard-390');
}

measurements.consoleErrors = consoleErrors.slice(0, 20);
measurements.consoleRuidoConhecido = consoleRuido.slice(0, 20);
await fs.writeFile(path.join(outDir, 'measurements.json'), JSON.stringify(measurements, null, 2));
console.log(`Evidências ${phase} em`, outDir);
console.log('Erros de página:', consoleErrors.length ? consoleErrors.slice(0, 5) : 'nenhum');
console.log('Ruído conhecido (prefetch abortado / 401 deslogado):', consoleRuido.length, consoleRuido.slice(0, 2));
await browser.close();
