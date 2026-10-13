// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// DetailSideModal · variante `instant` (homologação PR #69 · R7)
// ═══════════════════════════════════════════════════════════════
// Contexto: no Chromium real o painel do detalhe do agendamento (Agenda) não
// tinha a entrada pintada de forma confiável. Fallback escopado: `instant`
// abre e fecha sem animação, só para o detalhe da Agenda. O contrato padrão
// (saída animada que avisa `onExited` ao terminar) continua valendo para os
// demais DetailSideModal (Prévia, Pet 360, contexto de conversa).
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

describe('DetailSideModal instant', () => {
  it('instant: fechar pelo pai desmonta o painel na hora e avisa onExited', async () => {
    const onExited = vi.fn();
    const { rerender } = render(
      <DetailSideModal open instant title="Detalhe" onClose={() => {}} onExited={onExited}><p>corpo</p></DetailSideModal>,
    );
    expect(document.querySelector('dialog.gd-detail')).toBeTruthy();
    rerender(<DetailSideModal open={false} instant title="Detalhe" onClose={() => {}} onExited={onExited}><p>corpo</p></DetailSideModal>);
    await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1));
    expect(document.querySelector('dialog.gd-detail')).toBeNull();
  });

  it('instant: o atributo data-instant identifica a variante (CSS sem animação)', () => {
    render(<DetailSideModal open instant title="Detalhe" onClose={() => {}}><p>corpo</p></DetailSideModal>);
    expect(document.querySelector('dialog.gd-detail')?.hasAttribute('data-instant')).toBe(true);
  });

  it('padrão: a saída continua animada (data-closing) e só desmonta depois', async () => {
    const onExited = vi.fn();
    const { rerender } = render(
      <DetailSideModal open title="Detalhe" onClose={() => {}} onExited={onExited}><p>corpo</p></DetailSideModal>,
    );
    rerender(<DetailSideModal open={false} title="Detalhe" onClose={() => {}} onExited={onExited}><p>corpo</p></DetailSideModal>);
    const dialog = document.querySelector('dialog.gd-detail');
    expect(dialog).toBeTruthy();
    expect(dialog?.hasAttribute('data-closing')).toBe(true);
    expect(dialog?.hasAttribute('data-instant')).toBe(false);
    await waitFor(() => expect(onExited).toHaveBeenCalledTimes(1), { timeout: 1500 });
  });

  it('o detalhe do agendamento da Agenda usa a variante instant', () => {
    const src = readFileSync(resolve(__dirname, '../dashboard/BookingDetailSheet.tsx'), 'utf8');
    const block = src.slice(src.indexOf('<DetailSideModal'), src.indexOf('<DetailSideModal') + 200);
    expect(block).toMatch(/\binstant\b/);
  });
});
