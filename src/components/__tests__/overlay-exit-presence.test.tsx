// @vitest-environment jsdom
// PR #69 · fechamento sistêmico de overlays: saída animada com superfície montada.
// Regressões cobertas:
//  - DetailSideModal com `open` virando false NÃO desmonta no mesmo quadro: mantém
//    `data-closing` até a saída terminar e só então sai do DOM.
//  - Drawer/DetailSideModal chamam `onExited` apenas após a saída, nunca na montagem.
//  - Limpeza de rascunho em `onExited` (não em `onClose`) preserva o conteúdo durante a saída.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Drawer, DetailSideModal } from '../../components/ui';

beforeEach(() => {
  // jsdom não implementa <dialog>.showModal/show/close (mesmo polyfill de WorkspaceSheet.test).
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
afterEach(() => { cleanup(); vi.useRealTimers(); });

function DetailHarness({ onExited }: { onExited: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(false)}>fechar externamente</button>
      <button type="button" onClick={() => setOpen(true)}>abrir</button>
      <DetailSideModal open={open} onClose={() => setOpen(false)} title="Detalhe de teste" onExited={onExited}>
        <p>conteúdo do detalhe</p>
      </DetailSideModal>
    </>
  );
}

function ButtonCloseHarness({ onExited }: { onExited: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <DetailSideModal open={open} onClose={() => setOpen(false)} title="Detalhe X" onExited={onExited}>
      <p>conteúdo</p>
    </DetailSideModal>
  );
}

describe('DetailSideModal · saída pela prop open', () => {
  it('fechamento externo mantém o painel montado com data-closing até o fim da saída', () => {
    vi.useFakeTimers();
    const onExited = vi.fn();
    const { container } = render(<DetailHarness onExited={onExited} />);
    expect(container.querySelector('dialog.gd-detail')).not.toBeNull();
    act(() => { screen.getByRole('button', { name: 'fechar externamente' }).click(); });
    const dialog = container.querySelector('dialog.gd-detail');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('data-closing')).toBe('true');
    expect(onExited).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.querySelector('dialog.gd-detail')).toBeNull();
    expect(onExited).toHaveBeenCalledTimes(1);
  });

  it('fechar pelo botão X anima, chama onExited uma única vez e não duplica a saída', () => {
    vi.useFakeTimers();
    const onExited = vi.fn();
    const { container } = render(<ButtonCloseHarness onExited={onExited} />);
    act(() => { screen.getByRole('button', { name: 'Fechar Detalhe X' }).click(); });
    const dialog = container.querySelector('dialog.gd-detail');
    expect(dialog?.getAttribute('data-closing')).toBe('true');
    expect(onExited).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(170); });
    expect(container.querySelector('dialog.gd-detail')).toBeNull();
    act(() => { vi.advanceTimersByTime(500); });
    expect(onExited).toHaveBeenCalledTimes(1);
  });

  it('reabrir durante a saída cancela o fechamento e não chama onExited', () => {
    vi.useFakeTimers();
    const onExited = vi.fn();
    const { container } = render(<DetailHarness onExited={onExited} />);
    act(() => { screen.getByRole('button', { name: 'fechar externamente' }).click(); });
    act(() => { screen.getByRole('button', { name: 'abrir' }).click(); });
    act(() => { vi.advanceTimersByTime(400); });
    const dialog = container.querySelector('dialog.gd-detail');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('data-closing')).toBeNull();
    expect(onExited).not.toHaveBeenCalled();
  });

  it('montagem já fechada não anima nem chama onExited', () => {
    vi.useFakeTimers();
    const onExited = vi.fn();
    const { container } = render(
      <DetailSideModal open={false} onClose={() => {}} title="Fechado" onExited={onExited}>
        <p>x</p>
      </DetailSideModal>,
    );
    act(() => { vi.advanceTimersByTime(400); });
    expect(container.querySelector('dialog.gd-detail')).toBeNull();
    expect(onExited).not.toHaveBeenCalled();
  });
});

function DrawerHarness({ onExited, onFormReset }: { onExited: () => void; onFormReset: () => void }) {
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState('rascunho do formulário');
  return (
    <>
      <button type="button" onClick={() => setOpen(false)}>fechar drawer</button>
      <Drawer open={open} modal onClose={() => setOpen(false)} title="Editor" onExited={() => { onExited(); setDraft(''); onFormReset(); }}>
        <p>{draft}</p>
      </Drawer>
    </>
  );
}

describe('Drawer · onExited e conteúdo durante a saída', () => {
  it('o rascunho permanece visível durante a saída e só é limpo em onExited', () => {
    vi.useFakeTimers();
    const onExited = vi.fn();
    const onFormReset = vi.fn();
    const { container } = render(<DrawerHarness onExited={onExited} onFormReset={onFormReset} />);
    act(() => { screen.getByRole('button', { name: 'fechar drawer' }).click(); });
    // Durante a saída o conteúdo continua presente (sem limpeza prematura).
    expect(screen.getByText('rascunho do formulário')).toBeTruthy();
    expect(container.querySelector('dialog.il-drawer')?.getAttribute('data-closing')).toBe('true');
    expect(onExited).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(200); });
    expect(container.querySelector('dialog.il-drawer')).toBeNull();
    expect(onExited).toHaveBeenCalledTimes(1);
    expect(onFormReset).toHaveBeenCalledTimes(1);
  });

  it('montado já aberto e sem fechar: onExited nunca dispara', () => {
    vi.useFakeTimers();
    const onExited = vi.fn();
    render(
      <Drawer open modal onClose={() => {}} title="Aberto" onExited={onExited}>
        <p>x</p>
      </Drawer>,
    );
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByText('x')).toBeTruthy();
    expect(onExited).not.toHaveBeenCalled();
  });
});
