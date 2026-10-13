// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// Onda 1 · A — calendário do DatePicker dentro de dialog (R9)
// ═══════════════════════════════════════════════════════════════
// Defeito reproduzido em Chromium real (build de0 · 1440x900, Owner, Novo agendamento):
// o calendário (~264 px) abria abaixo do gatilho, que ficava perto da borda inferior do dialog.
// O dialog tem overflow:hidden, então a camada era cortada. Causa: flip/clamp mediam contra a
// JANELA, não contra o dialog que a contém.
// Contrato: dentro de dialog aberto, a camada fica inteiramente dentro do dialog (vira para cima
// quando não cabe abaixo) e nunca ultrapassa as bordas do dialog.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatePicker } from '@/components/ui';

const DIALOG = { top: 216, bottom: 684, left: 384, right: 1056 };      // dialog “Novo agendamento” (1440x900)
const TRIGGER = { top: 493, bottom: 533, left: 726, right: 1009 };     // caixa do campo (.gd-field__box) medida no Chromium
const LAYER_H = 264, LAYER_W = 306;

let origRect: typeof Element.prototype.getBoundingClientRect;
let origOffH: PropertyDescriptor | undefined;
let origOffW: PropertyDescriptor | undefined;

function rect(r: { top: number; bottom: number; left: number; right: number }) {
  return { ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top, toJSON() { return this; } } as DOMRect;
}

beforeEach(() => {
  // Janela do cenário reproduzido (1440x900). O padrão do jsdom (768) faria o flip acontecer por acaso.
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  origRect = Element.prototype.getBoundingClientRect;
  origOffH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  origOffW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return (this as HTMLElement).dataset.layerOrder ? LAYER_H : 0; } });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return (this as HTMLElement).dataset.layerOrder ? LAYER_W : 0; } });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.tagName === 'DIALOG') return rect(DIALOG);
    if (this.tagName === 'BUTTON' && this.getAttribute('aria-haspopup') === 'dialog') return rect(TRIGGER);
    if (this.getAttribute('data-layer') !== null) return rect({ top: 0, bottom: 0, left: 0, right: 0 });
    return origRect.call(this);
  };
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); };
});

afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = origRect;
  if (origOffH) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', origOffH);
  if (origOffW) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', origOffW);
});

describe('DatePicker dentro de dialog · calendário não é cortado (Onda 1 · A)', () => {
  it('vira para cima quando não cabe abaixo do gatilho dentro do dialog', () => {
    render(
      <dialog open aria-label="Novo agendamento" style={{ transform: 'none' }}>
        <DatePicker label="Data" value="2026-10-11" onChange={() => {}} />
      </dialog>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    const layer = document.querySelector('[data-layer]') as HTMLElement;
    expect(layer).toBeTruthy();
    const place = layer.dataset.place || '';
    const top = Number(/,t(-?\d+)/.exec(place)?.[1]);
    // Dentro do dialog: topo ≥ dialog.top e base ≤ dialog.bottom (o flip pode usar a área do dialog).
    expect(top).toBeGreaterThanOrEqual(DIALOG.top);
    expect(top + LAYER_H).toBeLessThanOrEqual(DIALOG.bottom);
    // E o flip foi para cima do gatilho (não sobre o campo): base ≤ topo do gatilho.
    expect(top + LAYER_H).toBeLessThanOrEqual(TRIGGER.top);
    // 1px de folga acima do dialog ainda basta para virar (regressão: a margem interna recusava o flip).
    expect(top).toBe(TRIGGER.top - 6 - LAYER_H);
  });
});
