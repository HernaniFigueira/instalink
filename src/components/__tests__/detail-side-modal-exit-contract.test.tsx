// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// DetailSideModal · contrato de presença e saída
// ═══════════════════════════════════════════════════════════════
// Histórico: o detalhe do agendamento usava `instant` (fallback da homologação
// R7) porque a entrada do painel não era pintada no Chromium. A integração
// (PR #69 × checkpoint) manteve `instant` SOMENTE neste consumidor, por EXCEÇÃO
// VISUAL APROVADA pelo usuário (Master Plan · pendência visual "DetailSideModal
// instant na Agenda"). Todas as outras superfícies animam entrada e saída.
// Cobertura preservada: abertura, fechamento animado, reabertura durante a saída,
// desmonte só em onExited, foco e ausência de estados órfãos.
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
  it('padrão sem `instant`: nenhum atributo data-instant é renderizado', () => {
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

  it('o detalhe do agendamento recebe open e onExited do pai; `instant` só existe nesta exceção aprovada', () => {
    const src = readFileSync(resolve(__dirname, '../dashboard/BookingDetailSheet.tsx'), 'utf8');
    const block = src.slice(src.indexOf('<DetailSideModal'), src.indexOf('<DetailSideModal') + 200);
    expect(block).toMatch(/open=\{open\}/);
    expect(block).toMatch(/onExited=\{onExited\}/);
    // Exceção aprovada: o detalhe da Agenda é o ÚNICO consumidor com `instant`.
    expect(block).toMatch(/\binstant\b/);
  });

  it('exceção visual: nenhuma outra superfície DetailSideModal usa `instant`', () => {
    const roots = [resolve(__dirname, '..'), resolve(__dirname, '../../app')];
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = resolve(dir, name);
        if (statSync(full).isDirectory()) { if (!name.startsWith('__')) walk(full); }
        else if (/\.(tsx|ts)$/.test(name)) files.push(full);
      }
    };
    roots.forEach(walk);
    const offenders: string[] = [];
    for (const file of files) {
      if (file.endsWith('BookingDetailSheet.tsx')) continue;
      const src = readFileSync(file, 'utf8');
      let i = src.indexOf('<DetailSideModal');
      while (i >= 0) {
        const chunk = src.slice(i, i + 400);
        const end = chunk.indexOf('>');
        if (/\binstant\b/.test(chunk.slice(0, end > 0 ? end : 400))) offenders.push(file);
        i = src.indexOf('<DetailSideModal', i + 1);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a Agenda só desmonta o agendamento em onExited; o fechamento principal anima', () => {
    const src = readFileSync(resolve(__dirname, '../../app/(dashboard)/agenda/page.tsx'), 'utf8');
    expect(src).toMatch(/onExited=\{\(\) => setDetail\(null\)\}/);
    expect(src).toMatch(/onClose=\{\(\) => \{ setDetailOpen\(false\);/);
  });
});
