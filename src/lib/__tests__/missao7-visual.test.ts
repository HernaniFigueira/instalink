import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NAV_ACCENTS, NAV_ACCENT_DEFAULT, navAccentById, contrastRatio, relativeLuminance } from '../nav-accent';

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
// NOTA (missão final §5): o DECRETO NOVO substitui "primary preto" —
// o CTA PRINCIPAL agora SEGUE O TEMA (--accent). As travas de paleta
// abaixo foram atualizadas para o contrato universal de cor (4 categorias);
// Ônix preto, dashboard sem duplicação e pets continuam intocados.
// ═══════════════════════════════════════════════════════════════
describe('missão 7 · 1 — paleta de aparência (atual: 21 presets por famílias)', () => {
  it('os 8 ids aprovados continuam resolvendo (aliases legados); Ônix é preto de verdade', () => {
    const ids = NAV_ACCENTS.map((a) => a.id);
    // missão final: paleta por famílias (21 presets)
    expect(ids).toHaveLength(21);
    for (const legacy of ['azul-clinico', 'azul-amigavel', 'verde-salvia', 'ambar', 'onix', 'vinho', 'violeta', 'teal']) {
      expect(ids, legacy).toContain(legacy);
    }
    // nomes intermediários das missões anteriores continuam válidos (alias)
    expect(navAccentById('violeta-atual').id).toBe('violeta');
    expect(navAccentById('teal-medio').id).toBe('teal');
    const onix = navAccentById('onix');
    expect(onix.swatch).toBe('#18181b'); // preto sofisticado (não cinza)
    expect(ids).not.toContain('graphite');
    expect(ids).not.toContain('indigo');
    expect(NAV_ACCENT_DEFAULT).toBe('azul-profundo'); // default aprovado; preferência salva preservada
  });

  it('contraste AA real (WCAG): o texto do nav é legível em QUALQUER preset', () => {
    // A régua é a do módulo (lib/nav-accent.ts: relativeLuminance/contrastRatio
    // — WCAG), não uma fórmula paralela. Limiar AA para texto normal = 4.5.
    for (const a of NAV_ACCENTS) {
      const bg = a.vars['--il-nav'];
      const fg = a.vars['--il-nav-fg'];
      expect(contrastRatio(fg, bg), a.id).toBeGreaterThanOrEqual(4.5);
      // contrato A: em preset CLARO, o texto do nav é near-black; em escuro, claro
      const navIsDark = relativeLuminance(bg) < 0.35;
      if (navIsDark) {
        expect(relativeLuminance(fg), a.id).toBeGreaterThan(0.7);
      } else {
        expect(relativeLuminance(fg), a.id).toBeLessThan(0.1);
      }
    }
  });

  it('a escolha continua em Configurações → Aparência (não na shell)', () => {
    expect(config).toContain('data-testid="shell-appearance"');
    expect(config).toContain('NAV_ACCENTS');
  });
});

describe('missão 7 · 2 — primary PRETO supersedo: CTA principal segue o TEMA (§5)', () => {
  it('os tokens --accent* existem e o primary usa --accent (nunca --il-nav)', () => {
    expect(css).toMatch(/--accent:/);
    expect(css).toMatch(/--accent-contrast:/);
    const ui = read('src/components/ui.tsx');
    const primary = ui.slice(ui.indexOf('primary:'), ui.indexOf('primary:') + 240);
    expect(primary).toContain('var(--accent)');
    expect(primary).not.toContain('--il-nav');
  });

  it('secondary/ghost/quiet continuam NEUTROS (o tema só tinge o CTA principal)', () => {
    const ui = read('src/components/ui.tsx');
    const secondary = ui.slice(ui.indexOf('secondary:'), ui.indexOf('secondary:') + 240);
    expect(secondary).not.toContain('--accent');
    expect(secondary).not.toContain('--il-nav');
  });

  it('semânticas nunca tingidas: success/danger usam tokens próprios', () => {
    const ui = read('src/components/ui.tsx');
    const success = ui.slice(ui.indexOf('  success:\n'), ui.indexOf('  success:\n') + 220);
    const danger = ui.match(/  destructive:\n\s*'([^']+)'/)?.[1] ?? '';
    expect(success).toContain('var(--success)');
    expect(success).not.toContain('--accent');
    expect(danger).toContain('var(--danger)');
    expect(danger).not.toContain('--accent');
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
    // Refino final: o acabamento da junção é no canto INFERIOR (o de cima
    // estava errado) — par `overflow: clip` + border-bottom-left-radius.
    expect(css).toMatch(/\.workspace-main-col \{[\s\S]*?border-bottom-left-radius: var\(--radius-xl\)/);
  });

  it('divisórias mais nítidas (sem poluir)', () => {
    expect(css).toContain('--border-soft: #e6eaf3;');
  });

  it('modo claro preservado — sem tokens dark', () => {
    expect(css).not.toContain('data-theme=\'dark\'');
    expect(css).not.toContain('[data-mode=\'dark\'');
  });
});
