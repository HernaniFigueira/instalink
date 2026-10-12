// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// DetailSideModal · contrato de presença e saída (sem variante `instant`)
// ═══════════════════════════════════════════════════════════════
// Histórico: o detalhe do agendamento usava `instant` (fallback da homologação
// R7) para "resolver" uma entrada que não aparecia. A causa real era a flag
// `data-instant`, que zerava `animation` no painel. A flag foi removida: a
// entrada e a saída são animadas para TODOS os DetailSideModal, e o pai só
// desmonta o conteúdo em `onExited`, depois da saída.
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DetailSideModal } from '../ui';

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
});
afterEach(cleanup);

describe('DetailSideModal · presença e saída', () => {
  it('não existe variante instant: nenhum atributo data-instant é renderizado', () => {
    render(<DetailSideModal open title="Detalhe" onClose={() => {}}><p>corpo</p></DetailSideModal>);
    expect(document.querySelector('dialog.gd-detail')?.hasAttribute('data-instant')).toBe(false);
  });

  it('fechar pelo pai: a saída fica animada (data-closing) e só desmonta depois de onExited', async () => {
    const onExited = vi.fn();
    const { rerender } = render(
      <DetailSideModal open title="Detalhe" onClose={() => {}} onExited={onExited}><p>corpo</p></DetailSideModal>,
    );
    rerender(<DetailSideModal open={false} title="Detalhe" onClose={() => {}} onExited={onExited}><p>corpo</p></DetailSideModal>);
    const dialog = document.querySelector('dialog.gd-detail');
    expect(dialog).toBeTruthy();
    expect(dialog?.hasAttribute('data-closing')).toBe(true);
    await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1), { timeout: 1500 });
    expect(document.querySelector('dialog.gd-detail')).toBeNull();
  });

  it('reabrir durante a saída cancela o desmonte e não dispara onExited', async () => {
    const onExited = vi.fn();
    const { rerender } = render(
      <DetailSideModal open title="Detalhe" onClose={() => {}} onExited={onExited}><p>corpo</p></DetailSideModal>,
    );
    rerender(<DetailSideModal open={false} title="Detalhe" onClose={() => {}} onExited={onExited}><p>corpo</p></DetailSideModal>);
    rerender(<DetailSideModal open title="Detalhe" onClose={() => {}} onExited={onExited}><p>corpo</p></DetailSideModal>);
    const dialog = document.querySelector('dialog.gd-detail');
    expect(dialog).toBeTruthy();
    expect(dialog?.hasAttribute('data-closing')).toBe(false);
    await new Promise((r) => setTimeout(r, 400));
    expect(onExited).not.toHaveBeenCalled();
    expect(document.querySelector('dialog.gd-detail')).toBeTruthy();
  });

  it('o detalhe do agendamento recebe open e onExited do pai (sem instant)', () => {
    const src = readFileSync(resolve(__dirname, '../dashboard/BookingDetailSheet.tsx'), 'utf8');
    const block = src.slice(src.indexOf('<DetailSideModal'), src.indexOf('<DetailSideModal') + 200);
    expect(block).not.toMatch(/\binstant\b/);
    expect(block).toMatch(/open=\{open\}/);
    expect(block).toMatch(/onExited=\{onExited\}/);
  });

  it('a Agenda só desmonta o agendamento em onExited; o fechamento principal anima', () => {
    const src = readFileSync(resolve(__dirname, '../../app/(dashboard)/agenda/page.tsx'), 'utf8');
    expect(src).toMatch(/onExited=\{\(\) => setDetail\(null\)\}/);
    expect(src).toMatch(/onClose=\{\(\) => \{ setDetailOpen\(false\);/);
  });
});
