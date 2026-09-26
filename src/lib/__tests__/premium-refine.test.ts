/**
 * MISSÃO 4 — refinamento premium (contrato visual, sem pixel).
 *
 * Trava o que foi decretado:
 *  1. AÇÃO = carvão quente (botões carvão+branco, conteúdo escuro sofisticado)
 *     com a IDENTIDADE índigo preservada (--brand-600/700 do logo, --il-nav*
 *     da sidebar intocados);
 *  2. ABAS SEM sublinhado em todo o sistema (padrão pill/segmentado, ativo por
 *     superfície — a antiga "direction correction" com border-bottom foi
 *     removida);
 *  3. Topo do Cliente 360 (.il-idcard) em sólido quente creme — sem degradê,
 *     sem arco/efeitos;
 *  4. Card único de métricas do Dashboard com amarelo/creme SÓLIDO (sem
 *     degradê, sem banner);
 *  5. Pet sheet: ícone de PET (não de pessoa), subtítulo com o tutor, blocos
 *     com respiro, rodapé limpo e consentimento "Aceita receber promoções?";
 *  6. Anotações administrativas com visual de bloquinho (persistência intacta
 *     — sem autosave novo: cada observação continua sendo gravada por ação
 *     explícita).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

const css = read('src/app/globals.css');
const ui = read('src/components/ui.tsx');
const drawer = read('src/components/dashboard/ClientProfileDrawer.tsx');
const pets = read('src/components/dashboard/PetsSection.tsx');
const pet360 = read('src/components/dashboard/Pet360Sheet.tsx');
const newClient = read('src/components/dashboard/NewClientSheet.tsx');
const clientes = read('src/app/(dashboard)/clientes/page.tsx');

function ruleOf(sel: string): string {
  const at = css.indexOf(sel);
  expect(at, `regra ${sel} existe em globals.css`).toBeGreaterThan(-1);
  const open = css.indexOf('{', at);
  return css.slice(at, css.indexOf('}', open));
}

describe('missão 4 · 1 — ação carvão com identidade preservada', () => {
  it('a AÇÃO do workspace é carvão quente (root + plataforma)', () => {
    expect(css).toMatch(/--brand:\s*#45413c/);
    expect(css).toMatch(/--brand-strong:\s*#322e2a/);
    expect(css).toMatch(/--brand-fg:\s*#4b443c/);
  });

  it('identidade índigo e sidebar lilás continuam intactas', () => {
    expect(css).toMatch(/--brand-600:\s*#4f46e5/);
    expect(css).toMatch(/--brand-700:\s*#4338ca/);
    expect(css).toMatch(/--il-nav:\s*#3f37c9/);
    expect(css).toMatch(/--cta-bg:\s*#5b3fd4/); // CTA violeta aprovado (missão 3)
  });

  it('botões seguem token-driven: primary carvão+branco, secondary contornado', () => {
    expect(ui).toMatch(/primary:\s*\n?\s*'bg-\[var\(--brand\)\]/);
    expect(ui).toMatch(/primary:[^}]*text-white/);
    expect(ui).toMatch(/secondary:\s*\n?\s*'bg-white text-\[var\(--text\)\] border/);
    expect(ui).toMatch(/danger:\s*\n?\s*'bg-\[var\(--danger\)\]/); // destrutivo = vermelho mantido
  });
});

describe('missão 4 · 2 — abas SEM sublinhado em todo o sistema', () => {
  it('nenhuma regra de aba desenha border-bottom de sublinhado', () => {
    expect(css).not.toMatch(/\.il-tab[^{]*\{[^}]*border-bottom:\s*3px/);
    expect(css).not.toContain('border-bottom-color');
  });

  it('o padrão pill (ativo por superfície) é o único', () => {
    const bar = ruleOf('.il-tabbar {');
    expect(bar).toContain('border-radius: var(--radius-pill)');
    const tab = ruleOf('.il-tab {');
    expect(tab).toContain('border-radius: var(--radius-pill)');
    const active = ruleOf(".il-tab[aria-selected='true'] {");
    expect(active).toContain('background: var(--surface)');
  });
});

describe('missão 4 · 3 — topo do Cliente 360 sólido e quente', () => {
  it('.il-idcard é sólido (creme), sem degradê e sem arco', () => {
    const card = ruleOf('.il-idcard {');
    expect(card).toContain('background: var(--sun-bg)');
    expect(card).not.toContain('gradient');
    expect(css).not.toContain('.il-idcard::after');
  });

  it('a ficha usa o bloco sem efeitos (sem shadow-md no topo)', () => {
    expect(drawer).toMatch(/il-idcard rounded-2xl border border-\[var\(--sun-border\)\] shadow-sm/);
    expect(drawer).not.toMatch(/il-idcard[^"]*shadow-md/);
  });
});

describe('missão 4 · 4 — métricas do Dashboard em amarelo/creme SÓLIDO', () => {
  it('card único com fundo sun sólido (sem degradê)', () => {
    const card = ruleOf('.dsh-metrics {');
    expect(card).toContain('background: var(--sun-bg)');
    expect(card).not.toContain('gradient');
  });
});

describe('missão 4 · 5 — pet sheet premium (visual; lógica intacta)', () => {
  it('ícone de PET no modo veterinário (não de pessoa)', () => {
    expect(newClient).toContain("icon={vetMode ? 'paw' : 'users'}");
    expect(pets).toContain('icon="paw"');
  });

  it('subtítulo exibe o tutor; rodapé limpo Cancelar/Salvar', () => {
    expect(newClient).toContain('Tutor: ${');
    expect(pets).toContain('Tutor: ${tutorName}');
    expect(pets).toMatch(/footer=\{\(\s*\n\s*<div className="flex w-full items-center justify-end gap-2">/);
  });

  it('checkbox premium e consentimento "Aceita receber promoções?"', () => {
    expect(css).toContain('.il-check {');
    expect(newClient).toContain('Aceita receber promoções?');
    expect(newClient).toContain('className="il-check');
    expect(newClient).not.toContain('accent-zinc-900');
  });

  it('campos e strings de contrato do form preservados (lógica intacta)', () => {
    expect(newClient).toContain('Adicionar pet');
    expect(newClient).toContain('Salvar tutor e pet');
    expect(newClient).toContain("action: 'create'");
  });
});

describe('missão 4 · 6 — Pet 360 com dados claros + anotações em bloquinho', () => {
  it('Pet 360: nome forte e chips de espécie/raça/idade/peso', () => {
    expect(pet360).toMatch(/text-lg font-semibold text-\[var\(--text\)\] leading-tight/);
    expect(pet360).toContain('rounded-pill border border-[var(--border)] bg-[var(--surface-3)]');
  });

  it('anotações administrativas com visual de bloquinho (sun sólido)', () => {
    expect(drawer).toContain('Salvar anotação');
    expect(drawer).toMatch(/rounded-xl border border-\[var\(--sun-border\)\] bg-\[var\(--sun-bg\)\]/);
    // persistência INTACTA: gravação continua sendo ação explícita (addNote)
    expect(drawer).toContain('async function addNote()');
  });
});

describe('missão 4 · 7 — tela Clientes coerente com o novo padrão', () => {
  it('ações do header refinadas sem perder função', () => {
    expect(clientes).toContain('> Importar');
    expect(clientes).toContain('Exportar');
    expect(clientes).toContain('Exportar tudo (JSON)');
    expect(clientes).toContain('> Novo cliente');
    expect(clientes).toContain("buttonCls('secondary', 'sm')");
    // filtros seguem nas abas pill do design system
    expect(clientes).toContain('<Tabs items={tabItems}');
  });
});
