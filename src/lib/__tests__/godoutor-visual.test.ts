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
const icons = read('src/components/icons.tsx');
const ui = read('src/components/ui.tsx');

/** Regra CSS de `sel` no globals.css (bloco `{...}` inteiro). */
function ruleOf(sel: string): string {
  const at = css.indexOf(sel);
  expect(at, `regra ${sel} existe em globals.css`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  return css.slice(at, css.indexOf('}', open));
}

describe('1 · “Agendado no período” tem ícone coerente (o que estava faltando)', () => {
  it('`cash` existe no registro de ícones (banknote)', () => {
    expect(icons).toMatch(/\n\s*cash:\s*\(/);
  });

  it('o KPI de valores renderiza `Icon n="cash"`', () => {
    expect(dash).toContain('<Icon n="cash"');
    expect(dash).toContain('Agendado no período');
    // o ícone vem ANTES do rótulo dentro da mesma célula
    const cell = dash.slice(dash.indexOf('Agendado no período') - 800, dash.indexOf('Agendado no período'));
    expect(cell).toContain('<Icon n="cash"');
  });

  it('`Icon n="cash"` desenha de fato (não renderiza vazio)', () => {
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
    // “precisam de fechamento”) = 7 marcações no source, 6 células renderizadas.
    const cells = dash.match(/className="dsh-metric"/g) ?? [];
    expect(cells).toHaveLength(7);
    // os seis rótulos seguem presentes, na mesma ordem do painel de dados
    for (const label of ['Atendimentos hoje', 'Confirmados', 'Aguardando', 'Concluídos', 'Faltas', 'Agendado no período']) {
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

describe('4 · amarelo suave “sun” com inteligência (só no bloco de destaque)', () => {
  it('família sun definida em tokens', () => {
    for (const t of ['--sun:', '--sun-strong:', '--sun-bg:', '--sun-bg-strong:', '--sun-border:', '--sun-fg:']) {
      expect(css, t).toContain(t);
    }
  });

  it('a saudação vira o bloco quente `.dsh-hero`', () => {
    expect(dash).toContain('className="dsh-hero"');
    const hero = ruleOf('.dsh-hero {');
    expect(hero).toContain('var(--sun-bg)');
    expect(hero).toContain('var(--sun-border)');
    expect(ruleOf('.dsh-hero__date {')).toContain('var(--sun-fg)');
  });

  it('o amarelo NÃO toma conta do painel (parcimônia)', () => {
    // uso do sun em regras de componente é pontual: hero, data-chip, ênfases
    const sunUses = css.match(/var\(--sun(-[a-z]+)?\)/g) ?? [];
    expect(sunUses.length).toBeLessThanOrEqual(12);
  });
});

describe('5 · botões migrados pela BASE (tokens), sem hex por tela', () => {
  it('a base continua token-driven na cor da marca', () => {
    expect(ui).toMatch(/primary:\s*\n?\s*'bg-\[var\(--brand\)\]/);
    expect(ui).toMatch(/shadow-brand/);
    expect(ui).toContain('bg-[var(--surface-3)] text-[var(--brand-fg)]');
  });

  it('a ação saiu do azul antigo para índigo-violeta', () => {
    expect(css).not.toContain('#2563eb');
    expect(css).not.toContain('#1d4ed8');
    expect(css).toMatch(/--brand-600:\s*#4f46e5/);
    expect(css).toMatch(/--brand-700:\s*#4338ca/);
    // e a sidebar fala a MESMA família (só mais forte)
    expect(css).toMatch(/--il-nav:\s*#3f37c9/);
  });
});
