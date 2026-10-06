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

const here = path.dirname(fileURLToPath(import.meta.url));
const phase = process.argv[2] || 'after';
const outDir = path.join(here, phase);
const fixture = JSON.parse(await fs.readFile(process.env.QA_UX_FIXTURE || '/home/user/.cache/qa-ux/fixture.json', 'utf8'));
const base = process.env.DESIGN_TEST_BASE_URL || fixture.base;
await fs.mkdir(outDir, { recursive: true });

const measurements = {};
const browser = await chromium.launch({
  executablePath: process.env.D1A_BROWSER_EXECUTABLE || '/tmp/chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer', '--no-zygote', '--font-render-hinting=none'],
  env: { ...process.env, LD_LIBRARY_PATH: process.env.LD_LIBRARY_PATH || '/tmp/nssstub:/tmp/ch-al2023/lib' },
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(String(e.message)));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

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
    // Troca de grupo sem fechar/reabrir
    const groups = await page.locator('[data-peek-group]').all();
    if (groups.length > 1) {
      const otherId = await groups[1].getAttribute('data-peek-group');
      await groups[1].hover();
      await page.waitForTimeout(300);
      const panelNow = page.locator('#ws-nav-panel');
      measurements[`panel-${tag}`].swapped = (await panelNow.count())
        ? { label: await panelNow.getAttribute('aria-label'), otherId } : null;
      await shot(`shell-${tag}-group-swap`);
    }
    await page.mouse.move(width - 4, height - 4);
    await page.waitForTimeout(700);
    measurements[`panel-${tag}`].closedAfterLeave = (await page.locator('#ws-nav-panel').count()) === 0;
    await shot(`shell-${tag}-group-closed`);
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

  // Novo agendamento (modal central?)
  await page.goto(agendaUrl());
  await page.waitForSelector('[data-agenda-page]');
  await page.waitForTimeout(700);
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
await fs.writeFile(path.join(outDir, 'measurements.json'), JSON.stringify(measurements, null, 2));
console.log(`Evidências ${phase} em`, outDir);
console.log('Erros de página:', consoleErrors.length ? consoleErrors.slice(0, 5) : 'nenhum');
await browser.close();
