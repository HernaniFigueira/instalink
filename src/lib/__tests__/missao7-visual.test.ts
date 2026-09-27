import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NAV_ACCENTS, NAV_ACCENT_DEFAULT, navAccentById } from '../nav-accent';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const css = read('src/app/globals.css');
const dash = read('src/app/(dashboard)/dashboard/page.tsx');
const pets = read('src/components/dashboard/PetsSection.tsx');
const config = read('src/app/(dashboard)/configuracoes/page.tsx');

/** Luminância relativa (0–1) de um hex — contraste real, não regex. */
function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}


// ═══════════════════════════════════════════════════════════════
// MISSÃO 7 — refino visual premium final (aparência · dashboard · pets)
// ═══════════════════════════════════════════════════════════════
describe('missão 7 · 1 — paleta de aparência ampliada e refinada', () => {
  it('os 8 presets aprovados existem; Ônix é preto de verdade; grafite saiu', () => {
    const ids = NAV_ACCENTS.map((a) => a.id);
    expect(ids).toEqual([
      'azul-clinico', 'azul-amigavel', 'violeta', 'teal',
      'verde-salvia', 'ambar', 'onix', 'vinho',
    ]);
    const onix = navAccentById('onix');
    expect(onix.swatch).toBe('#18181b'); // preto sofisticado (não cinza)
    expect(ids).not.toContain('graphite');
    expect(ids).not.toContain('indigo');
    expect(NAV_ACCENT_DEFAULT).toBe('azul-clinico');
  });

  it('contraste automático: fg claro sobre fundo escuro em todos os presets', () => {
    for (const a of NAV_ACCENTS) {
      // contraste real por luminância: fg claro, fundo escuro
      expect(lum(a.vars['--il-nav-fg']), a.id).toBeGreaterThan(0.82);
      expect(lum(a.vars['--il-nav']), a.id).toBeLessThan(0.45);
      expect(a.vars['--il-nav-active-fg'], a.id).toBe('#ffffff');
    }
  });

  it('a escolha continua em Configurações → Aparência (não na shell)', () => {
    expect(config).toContain('data-testid="shell-appearance"');
    expect(config).toContain('NAV_ACCENTS');
  });
});

describe('missão 7 · 2 — botões primary em preto premium (estado normal forte)', () => {
  it('o primary nasce preto/ônix; hover ainda mais forte; texto branco AA', () => {
    expect(css).toMatch(/--brand:\s*#1c1917/);
    expect(css).toMatch(/--brand-strong:\s*#0c0a09/);
    // sem cinza lavado
    expect(css).not.toMatch(/--brand:\s*#[4-7][0-9a-f]{5}/);
  });

  it('a cor do tema NÃO tinge a família de botões (acento ≠ tinta)', () => {
    const ui = read('src/components/ui.tsx');
    // primary usa os tokens escuros da marca — nunca --il-nav
    const primary = ui.slice(ui.indexOf('primary:'), ui.indexOf('primary:') + 240);
    expect(primary).toContain('var(--brand)');
    expect(primary).not.toContain('--il-nav');
  });
});

describe('missão 7 · 3 — dashboard: sem duplicação + gráfico + pacientes', () => {
  it('a métrica "Agendado no período" saiu do card de métricas (só no resumo)', () => {
    const block = dash.slice(dash.indexOf('className="dsh-metrics"'), dash.indexOf('Missão 7 — a 6ª métrica'));
    expect(block).not.toContain('Agendado no período');
    expect(dash).toContain('Cancelados'); // 6ª célula fecha o quadro do dia
  });

  it('espaço vazio resolvido com gráfico de linha elegante (SVG, sem libs)', () => {
    expect(dash).toContain('function MiniTrendChart');
    expect(dash).toContain('<MiniTrendChart');
    expect(dash).toContain('/api/analytics'); // série real
  });

  it('card "Nossos pacientes": total, movimento do mês, espécies e imagem', () => {
    expect(dash).toContain('function PetsPatientsCard');
    expect(dash).toContain('Nossos pacientes');
    expect(dash).toContain('/img/pacientes-pets.png');
    expect(dash).toContain('newThisMonth');
    expect(dash).toContain('bySpecies');
  });
});

describe('missão 7 · 4 — pets: bloco, ação e cards', () => {
  it('o botão "+ Pet" saiu do canto superior; "Cadastrar pet" mora embaixo à esquerda', () => {
    expect(pets).toContain('Cadastrar pet');
    expect(pets).not.toMatch(/<Icon n="plus" size=\{14\} \/>\s*Pet\s*<\/Button>/);
    const header = pets.slice(pets.indexOf('flex items-center gap-2.5 min-w-0'), pets.indexOf('Nenhum pet cadastrado'));
    expect(header).not.toContain('<Button');
  });

  it('cards de pet com nome de destaque e chips aprimorados', () => {
    expect(pets).toContain('text-[16px] font-semibold leading-tight text-[var(--text-strong)]');
    expect(pets).toContain('size={44}');
  });

  it('pet sheet: grupos encaixados, textarea maior e rodapé elegante', () => {
    expect(pets).toContain('rounded-[var(--radius-md)] border border-[var(--border-soft)] bg-[var(--surface-subtle)] p-3.5');
    expect(pets).toContain('min-h-[104px]');
    expect(pets).toContain('Salvar pet');
  });
});

describe('missão 7 · 5 — encaixe estratégico e divisórias', () => {
  it('o painel principal assenta com um canto especial no encontro com a lateral', () => {
    expect(css).toMatch(/\.workspace-main-col \{[\s\S]*?overflow: clip/);
    expect(css).toMatch(/\.workspace-main-col \{[\s\S]*?border-top-left-radius: var\(--radius-xl\)/);
  });

  it('divisórias mais nítidas (sem poluir)', () => {
    expect(css).toContain('--border-soft: #e6eaf3;');
  });

  it('modo claro preservado — sem tokens dark', () => {
    expect(css).not.toContain('data-theme=\'dark\'');
    expect(css).not.toContain('[data-mode=\'dark\'');
  });
});
