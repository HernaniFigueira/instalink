// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { Combobox, Textarea, Field } from '@/components/ui';

const CSS = readFileSync('src/styles/godoutor-design-system.css', 'utf8');
const UI = readFileSync('src/components/ui.tsx', 'utf8');
const GLOBALS = readFileSync('src/app/globals.css', 'utf8');
afterEach(() => cleanup());

describe('CP1 · estados canônicos', () => {
  it('Combobox: aria-selected marca o VALOR, não o item destacado pelo teclado', () => {
    render(<Combobox label="Profissional" value="p2" onChange={() => {}} options={[
      { value: 'p1', label: 'Dra. Michele' }, { value: 'p2', label: 'Dr. Orlando' },
    ]} />);
    fireEvent.focus(screen.getByRole('combobox', { name: 'Profissional' }));
    const opts = screen.getAllByRole('option');
    expect(opts.find((o) => o.getAttribute('data-value') === 'p2')?.getAttribute('aria-selected')).toBe('true');
    expect(opts.find((o) => o.getAttribute('data-value') === 'p1')?.getAttribute('aria-selected')).toBe('false');
    expect(opts[0].getAttribute('data-active')).toBe('true');
    expect(opts[1].getAttribute('data-selected')).toBe('true');
    expect(CSS).toMatch(/\.gd-menu__item\[data-selected='true'\]/);
  });

  it('Textarea: altura mínima é o token único de 96px (também dentro de Field)', () => {
    render(<Field label="Observações"><Textarea /></Field>);
    expect(screen.getByRole('textbox', { name: 'Observações' }).tagName).toBe('TEXTAREA');
    expect(CSS).toContain('--gd-textarea-min-h: 96px');
    expect(CSS).toMatch(/\.gd-field__box > textarea\.il-field-control \{ min-height: var\(--gd-textarea-min-h\)/);
    expect(GLOBALS).toContain('.il-platform textarea.il-field-control { min-height: var(--gd-textarea-min-h); }');
    expect(GLOBALS).not.toMatch(/textarea\.il-field-control \{ min-height: 76px/);
    expect(UI).not.toMatch(/min-h-\[72px\]'/);
  });

  it('IconButton: toggle real (aria-pressed) e estado :active têm regra própria', () => {
    render(<Combobox label="x" value="" onChange={() => {}} options={[]} />);
    expect(CSS).toMatch(/\.gd-icon-control:active/);
    expect(CSS).toMatch(/\.gd-icon-control\[aria-pressed='true'\]/);
  });

  it('Drawer: saída mantém a superfície montada até o fim (data-closing) e entrada/saída usam tokens', () => {
    expect(UI).toContain("overlayMotionMs('--gd-motion-sheet-out', 170)");
    expect(UI).toMatch(/if \(!present\) return null;/);
    expect(CSS).toMatch(/\.il-drawer\[data-closing\] \.il-drawer__strip/);
    expect(CSS).toMatch(/\.il-drawer__strip:not\(\[data-expanded\]\)/);
  });
});
