// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// DS 2.0 · CP1 — MOTION COMPARTILHADO DOS OVERLAYS
// ═══════════════════════════════════════════════════════════════
// Protege o contrato do Blueprint (§11/§12):
//   • a duração de saída vem do TOKEN CSS (fonte única), não de número solto;
//   • o Dialog NÃO desmonta de corte: fica montado com data-closing e só então
//     avisa o pai (entrada/saída simétricas);
//   • prefers-reduced-motion ⇒ sem espera;
//   • o DetailSideModal esmaece o backdrop na saída (sem efeito fantasma).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { Dialog, DetailSideModal, overlayMotionMs } from '@/components/ui';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const dsCss = read('src/styles/godoutor-design-system.css');
const ui = read('src/components/ui.tsx');

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query, onchange: null,
    addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  })) as unknown as typeof window.matchMedia;
}

// jsdom não implementa <dialog>.showModal/close — polyfill mínimo só para o teste.
const dialogProto = (globalThis as unknown as { HTMLDialogElement?: { prototype: Record<string, unknown> } }).HTMLDialogElement?.prototype;
if (dialogProto) {
  if (!dialogProto.showModal) dialogProto.showModal = function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  if (!dialogProto.close) dialogProto.close = function (this: HTMLDialogElement) { this.removeAttribute('open'); };
}

beforeEach(() => { vi.useFakeTimers(); setReducedMotion(false); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('overlayMotionMs · token CSS é a fonte da duração', () => {
  it('cai no fallback quando o token não está carregado (jsdom/SSR)', () => {
    expect(overlayMotionMs('--gd-motion-dialog-out', 150)).toBe(150);
  });

  it('reduced-motion ⇒ 0 (desmonta já)', () => {
    setReducedMotion(true);
    expect(overlayMotionMs('--gd-motion-dialog-out', 150)).toBe(0);
  });

  it('o DetailSideModal NÃO repete 170 solto: lê o token de saída', () => {
    expect(ui).toMatch(/overlayMotionMs\('--gd-motion-side-modal-out', 170\)/);
    expect(ui).not.toMatch(/\? 0 : 170/);
  });

  it('os tokens de Dialog existem no DS e a saída é mais curta que a entrada', () => {
    const inMs = Number(dsCss.match(/--gd-motion-dialog:\s*(\d+)ms/)?.[1]);
    const outMs = Number(dsCss.match(/--gd-motion-dialog-out:\s*(\d+)ms/)?.[1]);
    expect(inMs).toBeGreaterThan(0);
    expect(outMs).toBeGreaterThan(0);
    expect(outMs).toBeLessThan(inMs);
  });
});

describe('Dialog · saída animada', () => {
  it('fechar pelo X mantém o dialog montado com data-closing e só chama onClose ao fim', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Teste de saída">corpo</Dialog>);
    const dialog = screen.getByRole('dialog');
    expect(dialog.hasAttribute('data-closing')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /fechar/i }));
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.getAttribute('data-closing')).not.toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();

    act(() => { vi.advanceTimersByTime(149); });
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape também usa a saída animada (mesmo contrato do X)', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Teste Escape">corpo</Dialog>);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reduced-motion ⇒ fecha imediatamente, sem espera', () => {
    setReducedMotion(true);
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Teste reduzido">corpo</Dialog>);
    fireEvent.click(screen.getByRole('button', { name: /fechar/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('DetailSideModal · saída sem efeito fantasma', () => {
  it('fechar marca data-closing e só desmonta depois da saída', () => {
    const onClose = vi.fn();
    render(<DetailSideModal open onClose={onClose} title="Detalhe">corpo</DetailSideModal>);
    fireEvent.click(screen.getByRole('button', { name: /fechar detalhe/i }));
    const dialog = document.querySelector('dialog.gd-detail') as HTMLElement;
    expect(dialog.getAttribute('data-closing')).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(170); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('CSS compartilhado · entrada/saída simétricas', () => {
  it('o backdrop do detail tem saída (gd-fade-out), não só entrada', () => {
    expect(dsCss).toMatch(/\.gd-detail\[data-closing\]::backdrop\s*\{[^}]*gd-fade-out/);
  });

  it('o dialog e o backdrop têm saída com data-closing e keyframes próprios', () => {
    expect(dsCss).toMatch(/\.gd-dialog\[data-closing\]\s*\{[^}]*gd-dialog-out/);
    expect(dsCss).toMatch(/\.gd-dialog-backdrop\[data-closing\]\s*\{[^}]*gd-fade-out/);
    expect(dsCss).toMatch(/@keyframes gd-dialog-in \{ from \{ opacity: 0; transform: translateY\(8px\) scale\(\.985\)/);
  });

  it('reduced-motion desliga as animações novas', () => {
    const block = dsCss.slice(dsCss.indexOf('@media (prefers-reduced-motion: reduce) {\n  .gd-layer'));
    expect(block).toMatch(/\.gd-dialog,/);
    expect(block).toMatch(/\.gd-detail\[data-closing\]::backdrop/);
  });
});
