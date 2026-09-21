import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';

// Evaluate actual CSS variables; no snapshots/string-matching of class names.
const css = postcss.parse(readFileSync(resolve('src/app/globals.css'), 'utf8'));
const tokens = new Map<string, string>();
for (const selector of [':root', '.il-platform']) {
  css.walkRules(selector, rule => { rule.walkDecls(/^--/, decl => { tokens.set(decl.prop, decl.value); }); });
}
function color(token: string, seen = new Set<string>()): string {
  if (token.startsWith('#')) return token;
  if (seen.has(token)) throw new Error(`Cyclic token: ${token}`);
  seen.add(token);
  const value = tokens.get(token);
  if (!value) throw new Error(`Missing color: ${token}`);
  const alias = value.match(/^var\((--[^)]+)\)$/);
  if (alias) return color(alias[1], seen);
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Not a solid sRGB color: ${token}=${value}`);
  return value;
}
function luminance(token: string): number {
  const hex = color(token);
  const linear = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
function contrast(a: string, b: string): number {
  const pair = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (pair[0] + .05) / (pair[1] + .05);
}

describe('D1a — computed WCAG sRGB contrast of the scoped palette', () => {
  for (const fg of ['--text', '--text-strong', '--text-muted', '--text-faint', '--text-soft']) {
    for (const bg of ['--bg', '--surface', '--surface-2', '--surface-3', '--surface-hover']) {
      it(`${fg} on ${bg} meets AA for normal text`, () => {
        expect(contrast(fg, bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  for (const family of ['brand', 'success', 'info', 'warning', 'danger']) {
    it(`${family}: semantic text and filled actions meet AA`, () => {
      const bg = family === 'brand' ? '--brand-soft' : `--${family}-bg`;
      expect(contrast(`--${family}-fg`, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(`#ffffff`, `--${family}`)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(`#ffffff`, `--${family}-strong`)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('navigation remains readable in default, hover and selected states', () => {
    expect(contrast('--il-nav-fg', '--il-nav')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('--il-nav-muted', '--il-nav-hover')).toBeGreaterThanOrEqual(4.5);
    expect(contrast('--il-nav-active-fg', '--il-nav-active')).toBeGreaterThanOrEqual(4.5);
  });
  it('focus and input outlines meet non-text contrast on surfaces', () => {
    for (const bg of ['--bg', '--surface', '--surface-2', '--surface-3']) {
      expect(contrast('--brand', bg)).toBeGreaterThanOrEqual(3);
      expect(contrast('--border-strong', bg)).toBeGreaterThanOrEqual(3);
    }
  });
});
