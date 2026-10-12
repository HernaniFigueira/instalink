// @vitest-environment jsdom
// Contrato único de presença das superfícies modais (useOverlayPresence com exit):
// Dialog, WorkspaceSheet, Drawer e DetailSideModal. Cobre o defeito em que o pai
// põe open=false e a superfície sumia no mesmo quadro, além de reabertura durante
// a saída, troca de entidade, guarda de descarte, foco e movimento reduzido.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Dialog, DetailSideModal, Drawer } from '@/components/ui';
import { WorkspaceSheet } from '@/components/dashboard/WorkspaceSheet';

// jsdom não roda CSS animations: o fim da saída é disparado manualmente.
function endAnimation(el: Element | null, animationName: string) {
  if (!el) throw new Error('superfície de saída ausente');
  const ev = new Event('animationend', { bubbles: true });
  Object.defineProperty(ev, 'animationName', { value: animationName });
  act(() => { el.dispatchEvent(ev); });
}

function setReducedMotion(reduce: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
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
  vi.useFakeTimers();
  setReducedMotion(false);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setReducedMotion(false);
});

describe('Dialog · fechamento pelo pai (defeito corrigido)', () => {
  function Host({ initialOpen = true, onExited }: { initialOpen?: boolean; onExited?: () => void }) {
    const [open, setOpen] = useState(initialOpen);
    return (
      <>
        <button type="button" onClick={() => setOpen(false)}>pai fecha</button>
        <button type="button" onClick={() => setOpen(true)}>pai abre</button>
        <Dialog open={open} onClose={() => setOpen(false)} title="Ficha" label="Ficha" onExited={onExited}>corpo</Dialog>
      </>
    );
  }

  it('o pai põe open=false: o dialog continua montado com data-closing até o animationend', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'pai fecha' }));
    const dialog = screen.getByRole('dialog', { name: 'Ficha' });
    expect(dialog.getAttribute('data-closing')).not.toBeNull();
    endAnimation(dialog, 'gd-dialog-out');
    expect(screen.queryByRole('dialog', { name: 'Ficha' })).toBeNull();
  });

  it('onExited dispara uma única vez, depois da saída e não na montagem', () => {
    const onExited = vi.fn();
    render(<Host onExited={onExited} />);
    expect(onExited).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'pai fecha' }));
    endAnimation(screen.getByRole('dialog', { name: 'Ficha' }), 'gd-dialog-out');
    expect(onExited).toHaveBeenCalledTimes(1);
  });

  it('reabrir durante a saída cancela o desmonte e não dispara onExited', () => {
    const onExited = vi.fn();
    render(<Host onExited={onExited} />);
    fireEvent.click(screen.getByRole('button', { name: 'pai fecha' }));
    fireEvent.click(screen.getByRole('button', { name: 'pai abre' }));
    const dialog = screen.getByRole('dialog', { name: 'Ficha' });
    expect(dialog.hasAttribute('data-closing')).toBe(false);
    // Um animationend tardio da saída cancelada não pode desmontar o dialog aberto.
    endAnimation(dialog, 'gd-dialog-out');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('dialog', { name: 'Ficha' })).toBeTruthy();
    expect(onExited).not.toHaveBeenCalled();
  });

  it('sem animationend, a rede de segurança desmonta uma única vez', () => {
    const onExited = vi.fn();
    render(<Host onExited={onExited} />);
    fireEvent.click(screen.getByRole('button', { name: 'pai fecha' }));
    act(() => { vi.advanceTimersByTime(150 + 120 + 5); });
    expect(screen.queryByRole('dialog', { name: 'Ficha' })).toBeNull();
    expect(onExited).toHaveBeenCalledTimes(1);
  });

  it('movimento reduzido: o pai fecha e o dialog desmonta na hora, sem espera', () => {
    setReducedMotion(true);
    const onExited = vi.fn();
    render(<Host onExited={onExited} />);
    // Movimento reduzido não entra em estado de saída: nenhum data-closing é aplicado.
    const mo = new MutationObserver(() => {});
    mo.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['data-closing'] });
    fireEvent.click(screen.getByRole('button', { name: 'pai fecha' }));
    const closingSet = mo.takeRecords().filter((r) => (r.target as Element).hasAttribute('data-closing'));
    mo.disconnect();
    expect(closingSet).toHaveLength(0);
    expect(screen.queryByRole('dialog', { name: 'Ficha' })).toBeNull();
    expect(onExited).toHaveBeenCalledTimes(1);
  });
});

describe('WorkspaceSheet · fechamento pelo pai (defeito corrigido)', () => {
  function Host({ onClose }: { onClose?: () => void }) {
    const [open, setOpen] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setOpen(false)}>pai fecha</button>
        <button type="button" onClick={() => setOpen(true)}>pai abre</button>
        <WorkspaceSheet open={open} onClose={() => { onClose?.(); setOpen(false); }} title="Conversa">
          corpo
        </WorkspaceSheet>
      </>
    );
  }

  it('o pai põe open=false: o sheet segue montado com data-closing até ws-sheet-out terminar', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'pai fecha' }));
    const sheet = screen.getByRole('dialog', { name: 'Conversa' });
    expect(sheet.getAttribute('data-closing')).not.toBeNull();
    endAnimation(sheet, 'ws-sheet-out');
    expect(screen.queryByRole('dialog', { name: 'Conversa' })).toBeNull();
  });

  it('animationend de outra animação (filho) não encerra a saída', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'pai fecha' }));
    const sheet = screen.getByRole('dialog', { name: 'Conversa' });
    const child = sheet.querySelector('.ws-sheet__body') as Element;
    endAnimation(child, 'ws-sheet-out');
    expect(screen.getByRole('dialog', { name: 'Conversa' })).toBeTruthy();
    endAnimation(sheet, 'ws-sheet-out');
    expect(screen.queryByRole('dialog', { name: 'Conversa' })).toBeNull();
  });

  it('Escape anima a saída e chama onClose só ao fim', () => {
    const onClose = vi.fn();
    render(<Host onClose={onClose} />);
    const sheet = screen.getByRole('dialog', { name: 'Conversa' });
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.getAttribute('data-closing')).not.toBeNull();
    endAnimation(sheet, 'ws-sheet-out');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Conversa' })).toBeNull();
  });

  it('foco volta ao gatilho quando a saída termina', () => {
    function Trigger() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>abrir conversa</button>
          <WorkspaceSheet open={open} onClose={() => setOpen(false)} title="Conversa">corpo</WorkspaceSheet>
        </>
      );
    }
    render(<Trigger />);
    const trigger = screen.getByRole('button', { name: 'abrir conversa' });
    trigger.focus();
    fireEvent.click(trigger);
    const sheet = screen.getByRole('dialog', { name: 'Conversa' });
    fireEvent.click(screen.getByRole('button', { name: 'Fechar Conversa' }));
    endAnimation(sheet, 'ws-sheet-out');
    expect(screen.queryByRole('dialog', { name: 'Conversa' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

describe('Drawer · saída pelo pai e por Escape', () => {
  it('o pai põe open=false: a faixa segue com data-closing e só depois desmonta', () => {
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>pai fecha</button>
          <Drawer open={open} onClose={() => setOpen(false)} title="Equipe">corpo</Drawer>
        </>
      );
    }
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'pai fecha' }));
    const dialog = screen.getByRole('dialog', { name: /Equipe/ });
    expect(dialog.hasAttribute('data-closing')).toBe(true);
    endAnimation(dialog.querySelector('.il-drawer__strip'), 'gd-drawer-strip-out');
    expect(screen.queryByRole('dialog', { name: /Equipe/ })).toBeNull();
  });
});

describe('DetailSideModal · regressão do contrato existente', () => {
  it('fechar pelo X anima antes de chamar onClose, e o pai desmonta no fim', () => {
    const onClose = vi.fn();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <DetailSideModal open={open} onClose={() => { onClose(); setOpen(false); }} title="Pet" label="Pet">corpo</DetailSideModal>
      );
    }
    render(<Host />);
    const dialog = screen.getByRole('dialog', { name: 'Pet' });
    fireEvent.click(screen.getByRole('button', { name: /Fechar Pet/ }));
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog.getAttribute('data-closing')).not.toBeNull();
    endAnimation(dialog.querySelector('.gd-detail__panel'), 'gd-detail-out');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Pet' })).toBeNull();
  });
});

describe('guarda de descarte com saída animada', () => {
  it('com alteração não salva, Escape abre a confirmação e nada sai antes de "Descartar"', () => {
    const onClose = vi.fn();
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <WorkspaceSheet
          open={open}
          onClose={() => { onClose(); setOpen(false); }}
          title="Cadastro"
          dismissGuard={{ dirty: true, saving: false, context: 'new-client' }}
        >
          corpo
        </WorkspaceSheet>
      );
    }
    render(<Host />);
    const sheet = screen.getByRole('dialog', { name: 'Cadastro' });
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(sheet.hasAttribute('data-closing')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Descartar/ }));
    expect(sheet.getAttribute('data-closing')).not.toBeNull();
    endAnimation(sheet, 'ws-sheet-out');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
