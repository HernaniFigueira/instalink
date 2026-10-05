import { describe, expect, it } from 'vitest';
import { contrast } from './helpers/ds-tokens';

// Avalia os tokens REAIS do DS 1.0 (fonte única: godoutor-design-system.css,
// com os aliases de globals.css resolvidos) — nenhum snapshot de classe.
// D1a — computed WCAG sRGB contrast of the scoped palette

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
