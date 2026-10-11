// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// Drawer (variant="dialog") · clique fora fecha pelo mesmo requestClose
// ═══════════════════════════════════════════════════════════════
// Regressão real (homologação PR #69, rodada R5): o modal central tinha a caixa
// do <dialog> do tamanho do conteúdo; o clique no ::backdrop nativo tem o próprio
// <dialog> como alvo e NÃO fechava nada. O contrato: mousedown no alvo do dialog
// (fora da caixa) pede fechamento; mousedown dentro do conteúdo não fecha.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Drawer } from '../ui';

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
});
afterEach(cleanup);

function renderDialog(onClose = vi.fn()) {
  render(
    <Drawer open onClose={onClose} title="Novo agendamento" variant="dialog">
      <p>Conteúdo do formulário</p>
    </Drawer>,
  );
  return onClose;
}

describe('Drawer variant="dialog" · backdrop', () => {
  it('mousedown no alvo do dialog (área fora da caixa) pede fechamento', async () => {
    const onClose = renderDialog();
    const dialog = document.querySelector('dialog') as HTMLDialogElement;
    expect(dialog).toBeTruthy();
    fireEvent.mouseDown(dialog);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('mousedown dentro do conteúdo não fecha', async () => {
    const onClose = renderDialog();
    fireEvent.mouseDown(screen.getByText('Conteúdo do formulário'));
    await new Promise((r) => setTimeout(r, 300));
    expect(onClose).not.toHaveBeenCalled();
  });
});
