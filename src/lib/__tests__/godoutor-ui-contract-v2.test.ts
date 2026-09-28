import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
    expect(deep.vars['--il-nav']).toBe('#071a33');
    expect(deep.vars['--il-nav-hover']).toBe('#102d52');
    expect(deep.vars['--il-nav-active']).toBe('#123b68');
    expect(deep.vars['--il-nav-active-fg']).toBe('#93c5fd');
    expect(deep.vars['--accent']).toBe('#2563eb');
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
    for (const theme of NAV_ACCENTS) {
      expect(contrastRatio(theme.vars['--il-nav-fg'], theme.vars['--il-nav']), `${theme.id} nav`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.vars['--il-nav-active-fg'], theme.vars['--il-nav-active']), `${theme.id} active`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.vars['--accent-contrast'], theme.vars['--accent']), `${theme.id} accent`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.vars['--accent-fg'], theme.vars['--accent-soft']), `${theme.id} accent foreground`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(theme.vars['--il-nav-icon'], theme.vars['--il-nav']), `${theme.id} icon`).toBeGreaterThanOrEqual(3);
      for (const key of Object.keys(theme.vars)) {
        expect(key.startsWith('--il-nav') || key.startsWith('--accent'), `${theme.id}.${key}`).toBe(true);
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
    expect(css).toContain('--radius-xs: 4px;');
    expect(css).toContain('--radius-sm: 6px;');
    expect(css).toContain('--radius-md: 8px;');
    expect(css).toMatch(/--radius-(?:lg|xl|2xl): 8px;/);
    expect(css).toContain('--workspace-bg: var(--bg);');
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
    expect(ui).toContain("'primary' | 'secondary' | 'ghost' | 'destructive' | 'link' | 'success' | 'warning'");
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
