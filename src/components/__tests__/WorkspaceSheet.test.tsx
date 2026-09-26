// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// WorkspaceSheet — Etapa B
// ═══════════════════════════════════════════════════════════════
// O contrato do slider do painel, independente de qualquer tela:
//   • fechado não renderiza nada; aberto expõe dialog[aria-modal] rotulado;
//   • ESC e o X fecham (com a janela da animação de saída);
//   • "Abrir página completa" só existe quando há destino REAL informado;
//   • minimizar NÃO desmonta o conteúdo e avisa o pai;
//   • o foco volta para o elemento que abriu o sheet.
// Sem nada disso as próximas telas (paciente, atendimento, tarefas…) teriam
// cinco drawers diferentes — exatamente o que o briefing proibiu.
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSheet } from '../dashboard/WorkspaceSheet';

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
});
afterEach(cleanup);

function sheet(props: Partial<React.ComponentProps<typeof WorkspaceSheet>> = {}) {
  return render(
    <WorkspaceSheet open onClose={vi.fn()} title="Conversas" {...props}>
      <p>conteúdo do sheet</p>
    </WorkspaceSheet>,
  );
}

describe('WorkspaceSheet', () => {
  it('fechado não renderiza nada; aberto expõe o dialog rotulado pelo título', () => {
    const { unmount } = render(<WorkspaceSheet open={false} onClose={vi.fn()} title="Conversas" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    sheet();
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Conversas' })).toBeTruthy();
    expect(screen.getByText('conteúdo do sheet')).toBeTruthy();
  });

  it('ESC fecha respeitando a janela da animação de saída', () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      sheet({ onClose });
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      expect(onClose).not.toHaveBeenCalled(); // ainda na animação de saída
      act(() => { vi.advanceTimersByTime(250); });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('o X fecha e é rotulado pelo título', () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      sheet({ onClose });
      fireEvent.click(screen.getByRole('button', { name: 'Fechar Conversas' }));
      act(() => { vi.advanceTimersByTime(250); });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('"Abrir página completa" só aparece com destino real informado', () => {
    const { unmount } = sheet();
    expect(screen.queryByText('Abrir página completa')).toBeNull();
    unmount();

    sheet({ fullPageHref: '/conversas?b=biz-x' });
    const link = screen.getByText('Abrir página completa').closest('a');
    expect(link?.getAttribute('href')).toBe('/conversas?b=biz-x');
  });

  it('minimizar avisa o pai, marca o estado e não desmonta o conteúdo', () => {
    const onMinimizedChange = vi.fn();
    const { rerender } = render(
      <WorkspaceSheet open onClose={vi.fn()} title="Conversas" minimizable minimized onMinimizedChange={onMinimizedChange}>
        <p>conteúdo do sheet</p>
      </WorkspaceSheet>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('data-minimized')).toBe('true');
    expect(screen.getByText('conteúdo do sheet')).toBeTruthy(); // monta mesmo minimizado

    fireEvent.click(screen.getByRole('button', { name: 'Restaurar Conversas' }));
    expect(onMinimizedChange).toHaveBeenCalledWith(false);
    rerender(
      <WorkspaceSheet open onClose={vi.fn()} title="Conversas" minimizable minimized={false} onMinimizedChange={onMinimizedChange}>
        <p>conteúdo do sheet</p>
      </WorkspaceSheet>,
    );
    expect(screen.getByRole('dialog').getAttribute('data-minimized')).toBeNull();
  });

  it('sem `minimizable` não oferece minimizar', () => {
    sheet();
    expect(screen.queryByRole('button', { name: /Minimizar|Restaurar/ })).toBeNull();
  });

  it('ao fechar, o foco volta para o elemento que abriu o sheet', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" id="opener" onClick={() => setOpen(true)}>dock</button>
          <WorkspaceSheet open={open} onClose={() => setOpen(false)} title="Conversas"><p>corpo</p></WorkspaceSheet>
        </>
      );
    }
    render(<Harness />);
    const opener = document.getElementById('opener') as HTMLElement;
    opener.focus(); // jsdom não move foco no click: simula o foco do clique
    fireEvent.click(opener);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(document.activeElement).not.toBe(opener); // foco entrou no sheet

    vi.useFakeTimers();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    act(() => { vi.advanceTimersByTime(250); });
    vi.useRealTimers();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
