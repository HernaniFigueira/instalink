// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Drawer } from '@/components/ui';
import { persistenceState } from '@/components/dashboard/OverlayDismissGuard';

beforeEach(() => {
  (HTMLDialogElement.prototype as any).showModal = function () { this.setAttribute('open', ''); };
  (HTMLDialogElement.prototype as any).close = function () { this.removeAttribute('open'); };
});
afterEach(cleanup);

function Harness({ initiallyDirty = false, side = false }: { initiallyDirty?: boolean; side?: boolean }) {
  const [open, setOpen] = useState(true);
  const [dirty, setDirty] = useState(initiallyDirty);
  const [sideOpen, setSideOpen] = useState(side);
  if (!open) return <p>closed</p>;
  return <Drawer open onClose={() => setOpen(false)} title="Novo agendamento"
    dismissGuard={{ dirty, context: 'new-booking' }}
    sideDismissGuard={{ dirty: side, context: 'new-client' }}
    side={sideOpen ? <button onClick={() => setSideOpen(false)}>Salvar paciente</button> : undefined}
    onSideClose={() => setSideOpen(false)}>
    <label>Observação <input aria-label="Observação" onChange={() => setDirty(true)} /></label>
  </Drawer>;
}

const backdrop = () => document.querySelector<HTMLElement>('.il-drawer [aria-hidden="true"]')!;
const closeX = () => screen.getByRole('button', { name: 'Fechar' });

describe('central overlay requestClose(reason)', () => {
  it('PRISTINE: backdrop fecha normalmente', () => {
    render(<Harness />);
    fireEvent.click(backdrop());
    expect(screen.getByText('closed')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('DIRTY: backdrop pede confirmação; continuar editando preserva os campos', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Observação'), { target: { value: 'manter' } });
    fireEvent.click(backdrop());
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Descartar novo agendamento?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));
    expect((screen.getByLabelText('Observação') as HTMLInputElement).value).toBe('manter');
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it.each(['escape', 'close-button'] as const)('DIRTY + %s não fecha sem decisão', (reason) => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Observação'), { target: { value: 'manter' } });
    if (reason === 'escape') fireEvent.keyDown(document.querySelector('dialog.il-drawer')!, { key: 'Escape' });
    else fireEvent.click(closeX());
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.queryByText('closed')).toBeNull();
  });

  it('Descartar é explícito e fecha o overlay dirty', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Observação'), { target: { value: 'descartar' } });
    fireEvent.click(closeX());
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.getByText('closed')).toBeTruthy();
  });

  it('Cadastro lateral dirty tem confirmação independente do agendamento base', () => {
    render(<Harness side />);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByText('Descartar cadastro?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.queryByText('Salvar paciente')).toBeNull();
    expect(document.querySelector('dialog.il-drawer')?.hasAttribute('open')).toBe(true);
  });

  it('formulários independentes preservam dirty lateral; fechar o pai considera ambos', () => {
    function CombinedHarness() {
      const [open, setOpen] = useState(true);
      const [bookingDirty, setBookingDirty] = useState(false);
      const [clientDirty, setClientDirty] = useState(false);
      const [clientOpen, setClientOpen] = useState(true);
      if (!open) return <p>parent closed</p>;
      return <Drawer open title="Agendamento" onClose={() => setOpen(false)}
        dismissGuard={{ dirty: bookingDirty || clientDirty, context: bookingDirty && clientDirty ? 'combined' : clientDirty ? 'new-client' : 'new-booking' }}
        sideDismissGuard={{ dirty: clientDirty, context: 'new-client' }}
        side={clientOpen ? <button onClick={() => setClientDirty(true)}>Editar cadastro</button> : undefined}
        onSideClose={() => setClientOpen(false)}>
        <button onClick={() => setBookingDirty(true)}>Editar agendamento</button>
      </Drawer>;
    }
    render(<CombinedHarness />);
    fireEvent.click(screen.getByText('Editar cadastro'));
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(screen.getByText('Descartar cadastro?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));
    expect(screen.getByText('Editar cadastro')).toBeTruthy();
    fireEvent.click(screen.getByText('Editar agendamento'));
    fireEvent.click(backdrop());
    expect(screen.getByText('Descartar alterações?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.getByText('parent closed')).toBeTruthy();
  });

  it('salvar deixa o estado persistido e permite fechar sem prompt', () => {
    function SavedHarness() {
      const [open, setOpen] = useState(true);
      return open ? <Drawer open title="Detalhe" onClose={() => setOpen(false)} dismissGuard={{ dirty: false, saving: false }}>
        <button onClick={() => setOpen(false)}>Salvar alterações</button>
      </Drawer> : <p>closed</p>;
    }
    render(<SavedHarness />);
    fireEvent.click(screen.getByText('Salvar alterações'));
    expect(screen.getByText('closed')).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('SAVING bloqueia o fechamento e explica que precisa aguardar', () => {
    render(<Drawer open title="Salvar" onClose={vi.fn()} dismissGuard={{ dirty: true, saving: true, context: 'edit' }}><p>form</p></Drawer>);
    fireEvent.click(closeX());
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Salvando informações')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Descartar' })).toBeNull();
  });

  it('autosave state contract distinguishes dirty, saving, saved and error', () => {
    expect(persistenceState({ dirty: false, saving: false })).toBe('pristine');
    expect(persistenceState({ dirty: false, saving: false, hasPersisted: true })).toBe('saved');
    expect(persistenceState({ dirty: true, saving: false })).toBe('dirty');
    expect(persistenceState({ dirty: true, saving: true })).toBe('saving');
    expect(persistenceState({ dirty: true, saving: false, error: 'offline' })).toBe('error');
  });
});
