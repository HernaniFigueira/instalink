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
import { color, rawToken, hexContrast as contrastHex } from './helpers/ds-tokens';

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

describe('2 · DS 1.0 §13 — sidebar BRANCA com item ativo em acento suave', () => {
  it('fundo da sidebar é BRANCO fixo (estrutura não segue o tema)', () => {
    const rule = ruleOf('.il-platform .workspace-sidebar {');
    expect(rule).toContain('background: var(--il-nav)');
    // O token resolve para branco na FONTE ÚNICA, e nenhum preset o reescreve.
    expect(color('--il-nav')).toBe('#ffffff');
    expect(rawToken('--il-nav')).toBe('var(--gd-nav-bg)');
  });

  it('item ativo = acento SUAVE + texto do acento (variação visível, AA)', () => {
    expect(rawToken('--il-nav-active')).toBe('var(--gd-nav-active-bg)');
    expect(rawToken('--il-nav-active-fg')).toBe('var(--gd-nav-active-fg)');
    const active = color('--il-nav-active');
    const nav = color('--il-nav');
    expect(active).not.toBe(nav);
    expect(contrastHex(color('--il-nav-active-fg'), active)).toBeGreaterThanOrEqual(4.5);
  });

  it('o ícone do item ATIVO fica centrado, sem um segundo poço de seleção', () => {
    const icon = ruleOf('.workspace-link__icon {');
    expect(icon).toContain('border-radius: var(--radius-xs)');
    expect(icon).toContain('align-items: center');
    expect(icon).toContain('justify-content: center');
    // A linha já carrega a superfície ativa; o ícone preserva só a cor para
    // não criar dois planos preenchidos no rail.
    const active = ruleOf('.workspace-link[aria-current="page"] .workspace-link__icon {');
    expect(active).toContain('color: var(--il-nav-active-fg)');
    expect(active).toContain('background: transparent');
    expect(active).not.toContain('color-mix');
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
    // DECRETO FINAL: CTA primário e acento do header seguem o TEMA (--accent)
    expect(ui).toMatch(/primary:\s*\n?\s*'bg-\[var\(--accent\)\]/);
    expect(ui).not.toContain('shadow-brand'); // nenhum halo decorativo em CTA
    expect(ui).toContain('bg-[var(--surface-2)] text-[var(--accent)]');
  });

  it('identidade do logo preservada; default de navegação = Deep Blue', () => {
    // A marca do produto permanece; o default operacional é Deep Blue e
    // as preferências válidas salvas continuam prevalecendo.
    expect(css).toMatch(/--brand-600:\s*#4f46e5/);
    expect(css).toMatch(/--brand-700:\s*#4338ca/);
    expect(css).toMatch(/--brand:\s*var\(--accent\)/); // fallback do accent Deep Blue
    expect(css).toMatch(/--brand-strong:\s*var\(--accent-hover\)/);
    // DS 1.0 §13 — a estrutura da navegação é BRANCA (o acento vem do preset).
    expect(color('--il-nav')).toBe('#ffffff');
    expect(color('--accent')).toBe('#2563eb');
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

  it('2 · dashboard: métricas em card único neutro sem degradê', () => {
    const card = ruleOf('.dsh-metrics {');
    // O cartão de métricas não é um estado: usa superfície estrutural.
    expect(card).toContain('background: var(--surface)');
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

  it('5 · “Hoje” voltou como AÇÃO da toolbar canônica — nunca como botão de grade', () => {
    // DS 1.0 · §5 — a correção cirúrgica (que removeu o "Hoje") foi
    // SUPERSEDIDA pelo contrato da toolbar `Hoje · ‹ data ›`: ele é ação
    // explícita, ancorada no "hoje" do FUSO DO NEGÓCIO, e não um estado que
    // esconde a grade.
    expect(agenda).toContain('onClick={() => setFocus(today)}');
    expect(agenda).toContain("'Você já está em hoje'");
    // O rótulo "Hoje" existe na TOOLBAR (ação) e, desde a missão UX Closure,
    // também como ETIQUETA da coluna do dia atual (`ag-col-today`) — a data de
    // hoje não depende só de cor para ser reconhecida. Nenhum deles é
    // card/métrica, e não há uma segunda AÇÃO "Hoje".
    expect(agenda.match(/>\s*Hoje\s*</g)?.length).toBe(2);
    expect(agenda).toContain('ag-col-today');
    // A dependência do seletor nativo de data acabou: nenhum `<input
    // type="date">` no código (comentários que o citam não contam).
    const agendaCode = agenda.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(agendaCode).not.toMatch(/type="date"/);
  });

  it('6 · modo “Mês” volta ao seletor único (E3): Dia/Semana/Mês/Lista, com <SelectMenu>', () => {
    // E3: Mês é funcional e aparece no seletor canônico (SelectMenu), não como tab.
    expect(agenda).toContain("'Mês'");
    expect(agenda).toContain("view === 'month'");
    expect(agenda).toContain('<SelectMenu');
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

  it('8 · “Novo agendamento” usa CTA principal temático (AA)', () => {
    expect(ui).toMatch(/cta:\s*'primary'/);
    expect(ui).toMatch(/primary:[\s\S]*?bg-\[var\(--accent\)\]/);
    // sem degradê no CTA
    expect(css).not.toMatch(/--cta-[a-z-]*:\s*linear-gradient/);
  });
});
