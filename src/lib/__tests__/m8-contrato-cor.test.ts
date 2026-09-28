// ═══════════════════════════════════════════════════════════════
// CONTRATO UNIVERSAL DE COR (§§2–6) — 9 TRAVAS
// Categorias: A) TEXTO near-black · B) TEMA (sidebar/topbar/acento/CTAs) ·
// C) SEMÂNTICAS independentes · D) FUNDO neutro universal.
// Paletas travadas: branco/azul/verde/âmbar/vinho/ônix (de 21).
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  NAV_ACCENTS, contrastRatio, findAccent, relativeLuminance,
} from '../nav-accent';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');
const css = read('src/app/globals.css');
const ui = read('src/components/ui.tsx');

describe('contrato de cor · A — TEXTO sempre near-black (o tema não muda texto)', () => {
  it('trava 1: títulos e corpo usam --text; o preset NUNCA redefine --text', () => {
    for (const a of NAV_ACCENTS) {
      expect(Object.keys(a.vars), a.id).not.toContain('--text');
      expect(Object.keys(a.vars), a.id).not.toContain('--text-muted');
    }
    // PageHeader: TÍTULO em var(--text) — nunca em cor de tema
    const header = ui.slice(ui.indexOf('export function PageHeader'), ui.indexOf('export function PageHeader') + 1200);
    const h1 = header.slice(header.indexOf('<h1'), header.indexOf('</h1>'));
    expect(h1).toContain('text-[var(--text)]');
    expect(h1).not.toContain('accent'); // o acento vive só no icon-container
  });

  it('trava 2: em presets claros, texto do nav é near-black (nunca cor de marca)', () => {
    for (const a of NAV_ACCENTS) {
      const navIsLight = relativeLuminance(a.vars['--il-nav']) >= 0.35;
      if (navIsLight) {
        expect(relativeLuminance(a.vars['--il-nav-fg']), a.id).toBeLessThan(0.1);
      }
    }
  });
});

describe('contrato de cor · B — TEMA controla sidebar/topbar/acento/CTAs', () => {
  it('trava 3: cada preset traz os 5 tokens --accent* completos', () => {
    for (const a of NAV_ACCENTS) {
      for (const k of ['--accent', '--accent-hover', '--accent-soft', '--accent-border', '--accent-contrast']) {
        expect(a.vars[k], `${a.id}.${k}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('trava 4: CTA PRINCIPAL segue o tema (primary = --accent; contrast AA)', () => {
    const primary = ui.slice(ui.indexOf('primary:'), ui.indexOf('primary:') + 260);
    expect(primary).toContain('var(--accent)');
    expect(primary).toContain('var(--accent-contrast)');
    for (const a of NAV_ACCENTS) {
      expect(contrastRatio(a.vars['--accent-contrast'], a.vars['--accent']), a.id).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('trava 5: topbar permanece neutra e independente do tema', () => {
    const topbar = css.slice(css.indexOf('.ws-topbar {'), css.indexOf('.ws-unitpill'));
    expect(topbar).toContain('background: var(--surface)');
    expect(topbar).not.toContain('--il-nav');
    expect(topbar).not.toContain('--accent');
  });
});

describe('contrato de cor · C — SEMÂNTICAS independentes (nunca tingidas)', () => {
  it('trava 6: success/danger/attention usam tokens próprios; preset não os toca', () => {
    const success = ui.slice(ui.indexOf('  success:\n'), ui.indexOf('  success:\n') + 220);
    const danger = ui.slice(ui.indexOf('  destructive:\n'), ui.indexOf('  destructive:\n') + 220);
    expect(success).toContain('var(--success)');
    expect(danger).toContain('var(--danger)');
    for (const a of NAV_ACCENTS) {
      const keys = Object.keys(a.vars).join(' ');
      expect(keys, a.id).not.toMatch(/success|danger|attention|warning/);
    }
  });
});

describe('contrato de cor · D — FUNDO do workspace neutro universal', () => {
  it('trava 7: fundo sólido neutro; não depende do tema', () => {
    expect(css).toMatch(/--bg-top:\s*#f4f6f8/);
    expect(css).toMatch(/--bg-bottom:\s*#f8f9fb/);
    // UMA fonte de verdade: --workspace-bg herda o neutro sólido.
    expect(css).toMatch(/--workspace-bg:\s*var\(--bg\)/);
    const shell = css.slice(css.indexOf('.il-platform.workspace-shell {'), css.indexOf('.il-platform.workspace-shell {') + 300);
    expect(shell).toContain('background: var(--workspace-bg)');
    expect(shell).not.toContain('--il-nav'); // neutro: nunca tingido
    for (const a of NAV_ACCENTS) {
      expect(Object.keys(a.vars), a.id).not.toContain('--bg');
    }
  });
});

describe('paletas travadas (6 de 21) + separação de categorias', () => {
  it('trava 8: branco/azul/verde/âmbar/vinho/ônix existem e são AA', () => {
    for (const id of ['branco', 'azul-clinico', 'verde-salvia', 'ambar', 'vinho', 'onix']) {
      const a = findAccent(id);
      expect(a, id).toBeTruthy();
      expect(contrastRatio(a!.vars['--il-nav-fg'], a!.vars['--il-nav']), id).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(a!.vars['--accent-contrast'], a!.vars['--accent']), id).toBeGreaterThanOrEqual(4.5);
    }
    // Ônix é preto de verdade (missão 7 preservada)
    expect(findAccent('onix')!.swatch).toBe('#18181b');
  });

  it('trava 9: --accent/--il-nav/--text nunca se misturam (categorias separadas)', () => {
    for (const a of NAV_ACCENTS) {
      const keys = Object.keys(a.vars);
      // tema só reescreve tokens de TEMA (nav + accent) — nunca texto, nunca brand
      for (const k of keys) {
        expect(k === '--text' || k.startsWith('--il-nav') || k.startsWith('--accent'), `${a.id}.${k}`).toBe(true);
      }
      expect(keys, a.id).not.toContain('--brand');
    }
  });
});
