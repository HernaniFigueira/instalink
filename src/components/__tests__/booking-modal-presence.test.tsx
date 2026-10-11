// @vitest-environment jsdom
// PR #69 · correção de superfícies do Novo agendamento (contrato definitivo).
// Regressões cobertas:
//  - a criação completa é MODAL CENTRAL (variant="dialog", largura = token do DS),
//    nunca a faixa lateral: um retorno silencioso à lateral faz este teste falhar;
//  - o pai controla `open` e a superfície só é desmontada após o FIM da saída
//    (animationend da faixa), nunca no mesmo render em que o pai zera o estado;
//  - durante a saída o conteúdo fica congelado no último estado aberto;
//  - Escape fecha pelo mesmo caminho guardado; reabrir começa com formulário limpo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async () => ({ ok: true, data: {} })),
  apiSend: vi.fn(async () => ({ ok: true, data: {} })),
}));

import { NewBookingSheet } from '../dashboard/NewBookingSheet';

// Termina a animação de saída (jsdom não roda CSS animations).
function endExitAnimation(el: Element | null, animationName: string) {
  if (!el) throw new Error('faixa de saída ausente');
  const ev = new Event('animationend', { bubbles: true });
  Object.defineProperty(ev, 'animationName', { value: animationName });
  act(() => { el.dispatchEvent(ev); });
}

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.show) {
    HTMLDialogElement.prototype.show = function () { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
});
afterEach(() => { cleanup(); });

// Pai no mesmo padrão das telas reais: `open` controlado e zera o estado ao fechar.
function Parent({ onZero }: { onZero?: () => void }) {
  const [creating, setCreating] = useState<{ name: string } | null>({ name: 'Ana' });
  return (
    <>
      <button type="button" onClick={() => setCreating(null)}>zerar estado do pai</button>
      <button type="button" onClick={() => setCreating({ name: 'Bia' })}>reabrir</button>
      <NewBookingSheet
        open={!!creating}
        businessId="biz-1"
        services={[]}
        pros={[]}
        horizonDays={30}
        initial={{ name: creating?.name || '', phone: '' }}
        onClose={() => { onZero?.(); setCreating(null); }}
        onCreated={vi.fn()}
      />
    </>
  );
}

describe('Novo agendamento · contrato de superfície', () => {
  it('criação completa é modal central com largura pelo token do DS (não faixa lateral)', () => {
    render(<NewBookingSheet businessId="biz-1" services={[]} pros={[]} horizonDays={30} onClose={vi.fn()} onCreated={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: 'Novo agendamento' });
    expect(dialog.className).toContain('il-drawer--dialog');
    expect(dialog.getAttribute('style') || '').toContain('--il-dialog-w: var(--gd-booking-modal-w)');
    expect(document.querySelector('.il-drawer__strip')?.className).not.toMatch(/max-w-\[560px\]/);
  });
});

describe('Novo agendamento · presença (saída animada antes de desmontar)', () => {
  it('pai zera o estado: a superfície permanece com data-closing e só sai após o animationend', () => {
    render(<Parent />);
    const dialog = screen.getByRole('dialog', { name: 'Novo agendamento' });
    fireEvent.click(screen.getByRole('button', { name: 'zerar estado do pai' }));
    // Mesmo render em que o pai zerou: ainda montada, em saída.
    const closing = document.querySelector('dialog[data-closing]');
    expect(closing).toBe(dialog);
    // Enquanto sai, o título não muda por trás da animação.
    expect(screen.getByRole('heading', { name: 'Novo agendamento' })).toBeTruthy();
    endExitAnimation(document.querySelector('.il-drawer__strip'), 'gd-fade-out');
    expect(screen.queryByRole('dialog', { name: 'Novo agendamento' })).toBeNull();
  });

  it('animationend de um filho (não da faixa) não encerra a saída', () => {
    render(<Parent />);
    fireEvent.click(screen.getByRole('button', { name: 'zerar estado do pai' }));
    const child = document.querySelector('.il-drawer__strip')?.querySelector('h2');
    endExitAnimation(child ?? null, 'gd-fade-out');
    expect(document.querySelector('dialog[data-closing]')).toBeTruthy();
  });

  it('Escape passa pelo caminho de fechamento (onClose) e então sai animado', () => {
    const onZero = vi.fn();
    render(<Parent onZero={onZero} />);
    const dialog = screen.getByRole('dialog', { name: 'Novo agendamento' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onZero).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog[data-closing]')).toBeTruthy();
    endExitAnimation(document.querySelector('.il-drawer__strip'), 'gd-fade-out');
    expect(screen.queryByRole('dialog', { name: 'Novo agendamento' })).toBeNull();
  });

  it('reabrir após a saída monta uma superfície nova: mostra o novo contexto, não o anterior', () => {
    render(<Parent />);
    expect(screen.getAllByText('Ana').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'zerar estado do pai' }));
    endExitAnimation(document.querySelector('.il-drawer__strip'), 'gd-fade-out');
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'reabrir' }));
    expect(screen.getByRole('dialog', { name: 'Novo agendamento' })).toBeTruthy();
    expect(screen.queryByText('Ana')).toBeNull();
    expect(screen.getAllByText('Bia').length).toBeGreaterThan(0);
    expect(document.querySelector('dialog[data-closing]')).toBeNull();
  });
});
