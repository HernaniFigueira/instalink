// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// REGRESSÃO · Missão 02 — confirmação de descarte acessível pelo menu móvel.
// O menu de navegação (dialog modal, top layer) cobria a confirmação do guarda
// (div com z-index): o link do menu dispara o guarda e o botão ficava inacessível.
// Correção: o guarda fecha o menu de onde partiu o link antes de perguntar.
// ═══════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useUnsavedChangesGuard } from '@/components/dashboard/OverlayDismissGuard';

function Harness() {
  const guard = useUnsavedChangesGuard({ dirty: true, context: 'new-client' });
  return <>{guard.dialog}</>;
}

beforeEach(() => {
  (HTMLDialogElement.prototype as any).showModal = function () { this.setAttribute('open', ''); };
  (HTMLDialogElement.prototype as any).close = function () { this.removeAttribute('open'); };
});
afterEach(() => cleanup());

describe('guarda de descarte com menu de navegação modal aberto', () => {
  it('link do menu com alterações pendentes: fecha o menu e mostra a confirmação', () => {
    render(
      <>
        <dialog className="workspace-nav-drawer" open>
          <a href="/agenda">Agenda</a>
        </dialog>
        <Harness />
      </>,
    );
    const menu = document.querySelector('dialog.workspace-nav-drawer') as HTMLDialogElement;
    fireEvent.click(screen.getByText('Agenda'));
    expect(menu.hasAttribute('open')).toBe(false);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Continuar editando')).toBeTruthy();
  });

  it('link fora de menu modal: o menu do app não é tocado (guarda continua pedindo confirmação)', () => {
    render(
      <>
        <a href="/agenda">Agenda</a>
        <Harness />
      </>,
    );
    fireEvent.click(screen.getByText('Agenda'));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });
});
