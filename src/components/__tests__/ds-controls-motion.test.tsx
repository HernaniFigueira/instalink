// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { Button, Input, Checkbox, Radio, Switch } from '@/components/ui';

const CSS = readFileSync('src/styles/godoutor-design-system.css', 'utf8');
const APP_CSS = readFileSync('src/app/globals.css', 'utf8');
const UI = readFileSync('src/components/ui.tsx', 'utf8');

afterEach(() => cleanup());

describe('CP1 — controles canônicos usam tokens de motion', () => {
  it('Button usa --gd-motion-fast e não tem duração fixa', () => {
    render(<Button>Salvar</Button>);
    const cls = screen.getByRole('button', { name: 'Salvar' }).className;
    expect(cls).toContain('duration-[var(--gd-motion-fast)]');
    expect(cls).not.toMatch(/duration-150\b/);
    expect(UI).not.toMatch(/duration-150\b/);
  });

  it('Button loading: inerte, aria-busy e rótulo estável', () => {
    render(<Button loading>Salvar</Button>);
    const b = screen.getByRole('button', { name: 'Salvar' }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(b.getAttribute('aria-busy')).toBe('true');
    expect(b.getAttribute('data-loading')).toBe('true');
  });

  it('Button sem loading não expõe aria-busy', () => {
    render(<Button>Salvar</Button>);
    expect(screen.getByRole('button', { name: 'Salvar' }).hasAttribute('aria-busy')).toBe(false);
  });

  it('Input, Checkbox, Radio e Switch com duração por token', () => {
    const { container } = render(
      <>
        <Input aria-label="Nome" />
        <Checkbox label="Aceito" checked={false} onChange={() => {}} />
        <Radio label="Opção" checked={false} onChange={() => {}} />
        <Switch checked={false} onChange={() => {}} label="Ativo" />
      </>,
    );
    expect(screen.getByLabelText('Nome').className).toContain('duration-[var(--gd-motion-fast)]');
    expect(container.innerHTML).toContain('duration-[var(--gd-motion-fast)]');
    expect(container.innerHTML).toContain('duration-[var(--gd-motion-base)]');
    expect(container.innerHTML).toContain('shadow-[var(--gd-focus-ring)]');
  });

  it('Checkbox desabilitado não mostra hover de borda', () => {
    const { container } = render(<Checkbox label="X" checked={false} disabled onChange={() => {}} />);
    expect(container.innerHTML).toContain('bg-[var(--surface-3)]');
  });
});

describe('CP1 — painéis e sheets sem duração literal', () => {
  it('ws-sheet entrada/saída usam tokens de sheet', () => {
    expect(APP_CSS).toContain('animation: ws-sheet-in var(--gd-motion-sheet)');
    expect(APP_CSS).toContain('animation: ws-sheet-out var(--gd-motion-sheet-out)');
    expect(APP_CSS).not.toMatch(/ws-sheet-(in|out) 200ms/);
  });

  it('drawer lateral il-drawer usa token side-modal', () => {
    expect(APP_CSS).toContain('il-drawer-side-in var(--gd-motion-side-modal)');
    expect(APP_CSS).not.toMatch(/il-drawer-side-in(-mobile)? 200ms/);
  });

  it('tokens --gd-motion-sheet(-out) existem e reduced-motion zera os painéis', () => {
    expect(CSS).toContain('--gd-motion-sheet: 200ms');
    expect(CSS).toContain('--gd-motion-sheet-out: 170ms');
    const rm = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)', CSS.indexOf('.gd-page-action-bar')));
    expect(rm).toContain('dialog.ws-sheet');
    expect(rm).toContain('.il-drawer__panel--side');
  });
});
