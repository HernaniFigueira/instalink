import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { color, rawToken } from './helpers/ds-tokens';
import { PANEL_ROUTES } from '../panel';
import {
  DEFAULT_ACCENT_ID, NAV_ACCENTS, NAV_ACCENT_STORAGE_KEY,
  contrastRatio, getNavAccent, findAccent,
} from '../nav-accent';

const root = path.resolve(__dirname, '../../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');
const css = read('src/app/globals.css');
const ui = read('src/components/ui.tsx');
const shell = read('src/components/DashboardShell.tsx');
const themeCompatibility = read('src/lib/appearance.ts');
const topbar = read('src/components/dashboard/WorkspaceTopbar.tsx');
const uncomment = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('GoDoutor UI contract v2 · theme', () => {
  it('uses the existing azul-profundo preset as canonical default, without a duplicate', () => {
    expect(DEFAULT_ACCENT_ID).toBe('azul-profundo');
    expect(NAV_ACCENTS.filter((theme) => theme.id === 'azul-profundo')).toHaveLength(1);
    const deep = findAccent('azul-profundo')!;
    // DS 1.0 §13 — o preset pinta ACENTO, nunca superfície estrutural.
    expect(deep.vars['--accent']).toBe('#2563eb');
    expect(deep.vars['--il-nav-active']).toBe(deep.vars['--accent-soft']);
    expect(deep.vars['--il-nav-active-fg']).toBe(deep.vars['--accent-fg']);
    for (const structural of ['--il-nav', '--il-nav-fg', '--il-nav-hover', '--il-nav-border', '--il-nav-muted', '--il-nav-icon']) {
      expect(deep.vars[structural], structural).toBeUndefined();
    }
  });

  it('retains the existing valid local preference and does not rewrite storage', () => {
    const writes: Array<[string, string]> = [];
    const storage = {
      getItem: (key: string) => key === NAV_ACCENT_STORAGE_KEY ? 'vinho' : null,
      setItem: (key: string, value: string) => writes.push([key, value]),
    };
    (globalThis as { window?: unknown }).window = { localStorage: storage };
    expect(getNavAccent()).toBe('vinho');
    expect(writes).toEqual([]);
  });

  it('keeps all 21 presets and validates navigation/accent contrast with WCAG ratios', () => {
    expect(NAV_ACCENTS).toHaveLength(21);
    // Estrutura da navegação (branca, fixa) medida uma vez, na fonte única.
    expect(contrastRatio(color('--il-nav-fg'), color('--il-nav')), 'nav structure').toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color('--il-nav-muted'), color('--il-nav')), 'nav muted').toBeGreaterThanOrEqual(4.5);
    for (const theme of NAV_ACCENTS) {
      expect(contrastRatio(theme.vars['--il-nav-active-fg'], theme.vars['--il-nav-active']), `${theme.id} active`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.vars['--accent-contrast'], theme.vars['--accent']), `${theme.id} accent`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.vars['--accent-fg'], theme.vars['--accent-soft']), `${theme.id} accent foreground`).toBeGreaterThanOrEqual(4.5);
      for (const key of Object.keys(theme.vars)) {
        expect(key.startsWith('--il-nav-active') || key === '--il-nav-cta' || key.startsWith('--accent'), `${theme.id}.${key}`).toBe(true);
      }
    }
  });

  it('does not revive Business.appearance or introduce another theme path', () => {
    expect(themeCompatibility).toContain('APARÊNCIA LEGADA');
    expect(uncomment(shell)).not.toMatch(/navColorOf\(|navTokenStyle\(|business\.appearance/);
    expect(shell).toContain('getNavAccent()');
    expect(shell).toContain('DEFAULT_ACCENT_ID');
  });
});

describe('GoDoutor UI contract v2 · visual primitives', () => {
  it('has one theme-driven primary and no independent violet CTA or primary glow', () => {
    expect(ui).toContain("'bg-[var(--accent)] text-[var(--accent-contrast)]");
    expect(ui).toContain("cta: 'primary'");
    expect(ui).not.toContain('var(--cta-bg)');
    expect(ui).not.toContain('shadow-brand');
    expect(css).not.toContain('--cta-bg:');
    expect(css).toContain('--shadow-brand: none;');
  });

  it('uses neutral panels, compact radius tokens, and flat workspace surfaces', () => {
    // Escala compacta na FONTE ÚNICA; globals só aliasa.
    expect(rawToken('--gd-radius-xs')).toBe('4px');
    expect(rawToken('--gd-radius-sm')).toBe('8px');
    expect(rawToken('--gd-radius-md')).toBe('8px');
    for (const tok of ['lg', 'xl', '2xl']) expect(rawToken(`--gd-radius-${tok}`), tok).toBe('8px');
    expect(rawToken('--radius-xs')).toBe('var(--gd-radius-xs)');
    expect(rawToken('--workspace-bg')).toBe('var(--gd-bg-app)');
    expect(css).toMatch(/\.ws-panel\s*\{[^}]*box-shadow: none/);
    expect(css).toMatch(/\.il-platform\.workspace-shell\s*\{[^}]*background: var\(--workspace-bg\)/);
  });

  it('uses one page header accent, neutral topbar, and no route-area color injection', () => {
    expect(css).toMatch(/\.il-platform \.il-page-header__icon\s*\{[^}]*color: var\(--accent\)/);
    expect(css).toMatch(/\.ws-topbar\s*\{[^}]*background: var\(--surface\)/);
    expect(shell).not.toContain('--area-color');
    expect(css).not.toContain('var(--area-color');
  });

  it('offers canonical button anatomy with explicit semantic success and warning', () => {
    // MISSÃO UX CLOSURE · item 6: a família destrutiva tem DOIS níveis canônicos —
    // repouso (soft) e confirmação final (solid). O contrato protege os dois.
    expect(ui).toContain("'primary' | 'secondary' | 'ghost' | 'destructive' | 'destructive-soft' | 'link' | 'success' | 'warning'");
    expect(ui).toMatch(/  success:\n[\s\S]*?var\(--success\)/);
    expect(ui).toMatch(/  warning:\n[\s\S]*?var\(--warning-bg\)/);
    for (const alias of ["danger: 'destructive'", "soft: 'secondary'", "quiet: 'ghost'", "cta: 'primary'"]) {
      expect(ui).toContain(alias);
    }
    expect(ui).toContain("'disabled:bg-[var(--surface-3)]");
  });

  it('moves the conversations quick action to the topbar; no global floating shortcut', () => {
    expect(topbar).toContain('godoutor:open-conversations');
    expect(topbar).toContain('aria-label="Abrir Conversas"');
    expect(css).not.toMatch(/\.conversation-shortcut\s*\{[^}]*position:\s*fixed/);
    expect(css).not.toContain('.conversation-shortcut:hover');
  });
});


describe('GoDoutor UI contract v2 · scan guards', () => {
  it('keeps the legacy semantic utility bridge strictly inside the authenticated shell', () => {
    const start = css.indexOf('Authenticated workspace compatibility bridge.');
    const end = css.indexOf('Página pública: o avatar/logo', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const bridge = css.slice(start, end);
    const rules = bridge.split('\n').filter((line) => line.includes(':where('));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.trimStart()).toMatch(/^\.il-platform\.workspace-shell\s/);
      expect(rule).not.toMatch(/,\s*:where\(/);
    }
    expect(bridge).not.toContain('.il-page');
  });

  it('keeps the route audit matrix in sync with the authenticated route catalog', () => {
    const audit = read('docs/GODOUTOR-UI-AUDIT-V2.md');
    for (const route of PANEL_ROUTES) expect(audit, route.href).toContain(`| \`${route.href}\` |`);
  });
});
