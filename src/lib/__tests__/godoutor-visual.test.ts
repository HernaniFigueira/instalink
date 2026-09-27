/**
 * GODOUTOR — missão visual (sidebar colorida + Visão geral com vida).
 *
 * Trava os CONTRATOS visuais novos, sem pixel:
 *  1. “Agendado no período” ganha ícone real (`cash` existe no registro);
 *  2. sidebar índigo-violeta forte + item ativo com ícone em superfície
 *     branca circular (a referência visual pedida);
 *  3. métricas do topo = UM card único horizontal com divisórias sutis;
 *  4. amarelo suave “sun” no bloco de boas-vindas (usado com parcimônia);
 *  5. paleta de ação migrada do azul antigo para índigo-violeta, sem
 *     reescrever a base dos botões (continuam token-driven).
 *
 * Estes contratos são VISUAIS: aqui eles são checados como contrato de
 * classe/token (mesma disciplina de homologacao-page-identity). Os números
 * continuam vindo do painel de dados — nada aqui muda regra de negócio.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import React from 'react';
import { Icon } from '../../components/icons';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

const css = read('src/app/globals.css');
const dash = read('src/app/(dashboard)/dashboard/page.tsx');
const agenda = read('src/app/(dashboard)/agenda/page.tsx');
const icons = read('src/components/icons.tsx');
const ui = read('src/components/ui.tsx');
const topbar = read('src/components/dashboard/WorkspaceTopbar.tsx');
const navTsx = read('src/components/dashboard/WorkspaceNavigation.tsx');

/** Regra CSS de `sel` no globals.css (bloco `{...}` inteiro). */
function ruleOf(sel: string): string {
  const at = css.indexOf(sel);
  expect(at, `regra ${sel} existe em globals.css`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  return css.slice(at, css.indexOf('}', open));
}

describe('1 · métricas do topo SEM duplicação (missão 7)', () => {
  it('o card de métricas não repete mais "Agendado no período" (vive só no resumo)', () => {
    const cells = dash.match(/className="dsh-metric"/g) ?? [];
    const labelsBlock = dash.slice(dash.indexOf('className="dsh-metrics"'), dash.indexOf('Missão 7 — a 6ª métrica'));
    expect(labelsBlock).not.toContain('Agendado no período');
    expect(cells.length).toBeLessThanOrEqual(6);
  });

  it('a 6ª métrica fecha o quadro do DIA (Cancelados), sem dinheiro repetido', () => {
    expect(dash).toContain('Cancelados');
    expect(dash).toContain('today.cancelled');
    // os quatro conceitos monetários (MESMO cálculo do Financeiro) vivem UMA
    // vez, dentro do card "Período · resumo".
    expect(dash).toContain('moneySemantics.realizado');
  });

  it('`Icon n="cash"` continua desenhando (registro íntegro)', () => {
    expect(icons).toMatch(/\n\s*cash:\s*\(/);
    const svg = renderToStaticMarkup(React.createElement(Icon, { n: 'cash', size: 19 }));
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
  });
});

describe('2 · sidebar colorida com ícone ativo em superfície branca', () => {
  it('fundo da sidebar é cor sólida forte (não mais branco)', () => {
    const rule = ruleOf('.il-platform .workspace-sidebar {');
    expect(rule).toContain('background: var(--il-nav)');
    expect(css).toMatch(/--il-nav:\s*#[0-9a-f]{6}/);
    expect(css).not.toMatch(/--il-nav:\s*#ffffff/);
  });

  it('item ativo = variação VISÍVEL da cor (bg próprio + fg branca)', () => {
    expect(css).toMatch(/--il-nav-active:\s*#[0-9a-f]{6}/);
    expect(css).toMatch(/--il-nav-active-fg:\s*#ffffff/);
    const navHex = css.match(/--il-nav:\s*(#[0-9a-f]{6})/)![1];
    const activeHex = css.match(/--il-nav-active:\s*(#[0-9a-f]{6})/)![1];
    expect(activeHex).not.toBe(navHex);
  });

  it('o ícone do item ativo entra em superfície branca circular', () => {
    const icon = ruleOf('.workspace-link__icon {');
    expect(icon).toContain('border-radius: 50%');
    const active = ruleOf('.workspace-link[aria-current="page"] .workspace-link__icon,');
    expect(active).toContain('background: var(--il-nav-active-fg)'); // branco
    expect(active).toMatch(/color: var\(--brand-strong\)/); // glifo na cor da marca
  });

  it('estado continua sendo aria-current (nunca só cor)', () => {
    expect(css).toContain(".workspace-link[aria-current='page']");
    expect(dash + read('src/components/dashboard/WorkspaceNavigation.tsx')).toMatch(/aria-current/);
  });
});

describe('3 · métricas do topo = UM card único com divisórias sutis', () => {
  it('existe um único contêiner `.dsh-metrics` com seis células', () => {
    const opens = dash.match(/className="dsh-metrics[^"]*"/g) ?? [];
    expect(opens).toHaveLength(1);
    // o contrato responsivo (a12-block4) segue vivo nas mesmas faixas do card
    expect(dash).toContain('grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6');
    // 5 células fixas + a 6ª que é um ternário (valores no período OU
    // Missão 7: 6 células (a 6ª = Cancelados; o fallback de fechamento saiu
    // junto com a duplicação de período).
    const cells = dash.match(/className="dsh-metric"/g) ?? [];
    expect(cells).toHaveLength(6);
    for (const label of ['Atendimentos hoje', 'Confirmados', 'Aguardando', 'Concluídos', 'Faltas', 'Cancelados']) {
      expect(dash, label).toContain(label);
    }
  });

  it('grid único com divisórias verticais (sem “6 cards soltos”)', () => {
    const card = ruleOf('.dsh-metrics {');
    expect(card).toContain('display: grid');
    expect(card).toContain('repeat(2');
    // 6 colunas chegam no breakpoint largo (media query própria)
    expect(css).toMatch(/\.dsh-metrics \{ grid-template-columns: repeat\(6/);
    const cell = ruleOf('.dsh-metric {');
    expect(cell).toContain('border-left: 1px solid var(--border-soft)');
    // nenhuma célula vira card próprio (as classes `dsh-kpi__*` seguem como
    // alias tipográfico em outras seções, mas o CARD solto sumiu)
    expect(dash).not.toMatch(/className="dsh-kpi"/);
    expect(css).not.toContain('.dsh-kpi {');
  });

  it('ícones das métricas mantêm chips de cor contextual', () => {
    for (const tone of ['var(--brand-soft)', 'var(--success-bg)', 'var(--warning-bg)', 'var(--ops-soft)', 'var(--danger-bg)']) {
      expect(dash, tone).toContain(tone);
    }
  });
});

describe('4 · amarelo “sun” com moderação (só acento secundário, nunca o topo)', () => {
  it('família sun definida em tokens (para os acentos pontuais)', () => {
    for (const t of ['--sun:', '--sun-strong:', '--sun-bg:', '--sun-bg-strong:', '--sun-border:', '--sun-fg:']) {
      expect(css, t).toContain(t);
    }
  });

  it('CORREÇÃO: o topo da Visão geral NÃO tem banner amarelo nem degradê', () => {
    // O header continua limpo (tipografia + espaçamento). O amarelo vive no
    // card único de métricas, em SÓLIDO (missão 4) — nunca em banner/degradê.
    expect(dash).not.toContain('dsh-hero');
    expect(css).not.toContain('.dsh-hero');
    expect(dash).toMatch(/<header className="mb-5 flex flex-wrap/);
    // e nenhum gradiente "sun" sobra no painel
    expect(css).not.toMatch(/linear-gradient\([^)]*--sun/);
    expect(css).not.toMatch(/linear-gradient\([^)]*247, 201, 72/);
  });
});

describe('5 · botões migrados pela BASE (tokens), sem hex por tela', () => {
  it('a base continua token-driven na cor da marca', () => {
    expect(ui).toMatch(/primary:\s*\n?\s*'bg-\[var\(--brand\)\]/);
    expect(ui).toMatch(/shadow-brand/);
    expect(ui).toContain('bg-[var(--surface-3)] text-[var(--brand-fg)]');
  });

  it('identidade índigo preservada (logo/sidebar padrão); a ação é preto premium (missão 7)', () => {
    // O rampo índigo continua definido — é a IDENTIDADE (logo GoDoutor) —
    // enquanto a AÇÃO do workspace (--brand) é PRETO sofisticado/ônix (missão 7:
    // estado normal já forte, sem cinza lavado).
    expect(css).toMatch(/--brand-600:\s*#4f46e5/);
    expect(css).toMatch(/--brand-700:\s*#4338ca/);
    expect(css).toMatch(/--brand:\s*#1c1917/); // missão 7: preto premium
    expect(css).toMatch(/--brand-strong:\s*#0c0a09/);
    // e a sidebar PADRÃO fala a família índigo aprovada
    expect(css).toMatch(/--il-nav:\s*#3f37c9/);
  });
});

// ═══════════════════════════════════════════════════════════════
// CORREÇÃO CIRÚRGICA — os oito defeitos visuais reportados
// ═══════════════════════════════════════════════════════════════
describe('6 · correções cirúrgicas (contrato dos 8 pontos)', () => {
  it('1 · busca: UM contorno só — input sem outline próprio no foco', () => {
    expect(css).toMatch(/\.global-search__input:focus-visible\s*\{\s*outline:\s*none/);
    // o anel visual é só o do wrapper (focus-within)
    expect(css).toMatch(/\.global-search__field:focus-within\s*\{[^}]*box-shadow:/);
  });

  it('2 · dashboard: métricas em card único sem degradê (missão 4: creme/amarelo SÓLIDO)', () => {
    const card = ruleOf('.dsh-metrics {');
    // MISSÃO 4 (premium): o amarelo/creme VOLTA como fundo SÓLIDO do único
    // card de métricas — sem degradê (a proibição de gradiente segue).
    expect(card).toContain('background: var(--sun-bg)');
    expect(card).not.toContain('gradient');
  });

  it('3 · o card de métricas é do dia inteiro (sem “Agendado no período” repetido)', () => {
    expect(icons).toMatch(/\n\s*cash:\s*\(/);
    const metricsBlock = dash.slice(dash.indexOf('className="dsh-metrics"'), dash.indexOf('Missão 7 — a 6ª métrica'));
    expect(metricsBlock).not.toContain('Agendado no período');
  });

  it('4 · tooltip do rail recolhido em portal/fixed (não é cortado pela Agenda)', () => {
    expect(navTsx).toContain('createPortal(');
    expect(navTsx).toMatch(/createPortal\(\s*\n?\s*<div className="ws-nav-tip"/);
    const tip = ruleOf('.ws-nav-tip {');
    expect(tip).toContain('position: fixed');
    expect(tip).toContain('z-index: 90');
  });

  it('5 · botão “Hoje” removido da navegação da Agenda', () => {
    expect(agenda).not.toMatch(/<button[^>]*>\s*Hoje\s*<\/button>/);
    expect(agenda).not.toContain("'Você já está em hoje'");
  });

  it('6 · modo “Mês” removido da UI (lógica profunda preservada)', () => {
    expect(agenda).not.toContain("label: 'Mês'");
    // …a lógica do modo mês continua para links diretos (view=month)
    expect(agenda).toContain("view === 'month'");
  });

  it('7 · quick create “+” de volta ao topo (missão 6 — premium)', () => {
    const quick = read('src/components/dashboard/QuickCreateMenu.tsx');
    expect(topbar).toContain('<QuickCreateMenu');
    expect(quick).toContain('ws-quickcreate-btn');
    // menu com ações filtradas pelo canCreate (nunca exposto sem permissão)
    expect(topbar).toContain('canCreate={canCreate}');
    // os demais itens da topbar permanecem
    expect(topbar).toContain('<GlobalSearch');
    expect(topbar).toContain('<NotificationsBell');
  });

  it('8 · “Novo agendamento” = violeta premium (CTA próprio, AA)', () => {
    expect(ui).toMatch(/cta:\s*\n?\s*'bg-\[var\(--cta-bg\)\]/);
    expect(css).toMatch(/--cta-bg:\s*#5b3fd4/);
    expect(css).toMatch(/--cta-bg-hover:\s*#4a31b8/);
    // sem degradê no CTA
    expect(css).not.toMatch(/--cta-[a-z-]*:\s*linear-gradient/);
  });
});
