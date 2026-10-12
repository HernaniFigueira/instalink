// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// Pet 360 → Atendimento (A-06 · homologação PR #69, rodada R7)
// ═══════════════════════════════════════════════════════════════
// Defeito reproduzido em Chromium real (build b588435): a linha de atendimento
// da aba Atendimentos fechava o Pet 360 e o Encounter nunca abria. Causa: a
// superfície do Pet 360 retornava `null` quando `open` virava false, então o
// DetailSideModal desmontava sem rodar a saída animada; `onExited` (que dispara
// a navegação agendada em ClientProfileDrawer) nunca era chamado.
//
// Contrato coberto aqui:
//  • abertura: a aba Atendimentos lista o registro e a linha entrega o registro;
//  • fechamento: a ficha continua montada durante a saída e avisa `onExited` só
//    ao terminar (não antes, não nunca);
//  • navegação: o atendimento abre DEPOIS da saída, uma única vez;
//  • fechamento sem atendimento escolhido: não navega;
//  • retorno: após a saída a ficha sai do DOM (sem overlay residual).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { Pet } from '@/lib/types';
import type { EncounterRow } from '@/components/dashboard/EncounterSheet';

const apiGetMock = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiGet: (...args: unknown[]) => apiGetMock(...args) }));
// Contrato único (R9): a própria Pet 360 navega ao atendimento depois da saída. O roteador é o único
// efeito observado — o consumidor não passa mais `onOpenEncounter`/`onExited` (ver Pet360Sheet).
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }));

import { Pet360Sheet } from '@/components/dashboard/Pet360Sheet';

const pet = {
  id: 'pet-thor', name: 'Thor', species: 'dog', breed: 'Golden Retriever', tutorId: 'tutor-1',
  sex: 'M', weightKg: 31.4, birthDate: '2019-03-02',
} as unknown as Pet;

const encounter = {
  id: 'enc-thor-1', petId: 'pet-thor', status: 'draft', date: '2026-10-11T16:30:00.000Z',
  professionalName: 'Dra. Michele Martins', serviceName: 'Consulta clínica', files: [],
} as unknown as EncounterRow;

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
  apiGetMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/encounters')) return { ok: true, data: { encounters: [encounter] } };
    if (url.startsWith('/api/bookings')) return { ok: true, data: { bookings: [] } };
    if (url.startsWith('/api/anamnese')) return { ok: true, data: { templates: [], responses: [] } };
    if (url.startsWith('/api/pets')) return { ok: true, data: { pets: [pet] } };
    return { ok: true, data: {} };
  });
});
afterEach(cleanup);

/** Consumidor mínimo: só `open`/`onClose`. A navegação é responsabilidade da Pet 360. */
function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>reabrir ficha</button>
      <Pet360Sheet
        open={open}
        onClose={() => setOpen(false)}
        businessId="biz-1"
        pet={pet}
        tutorName="Bernardo Almeida"
      />
    </>
  );
}

async function openAtendimentos() {
  const tab = await screen.findByRole('tab', { name: /Atendimentos/ });
  fireEvent.click(tab);
  return screen.findByText('Sem descrição');
}

describe('Pet 360 → Atendimento · abertura, fechamento e navegação (A-06)', () => {
  it('abertura: a aba Atendimentos lista o registro do pet', async () => {
    render(<Harness />);
    expect(await openAtendimentos()).toBeTruthy();
  });

  it('navegação: o atendimento abre depois da saída, exatamente uma vez', async () => {
    pushMock.mockClear();
    render(<Harness />);
    fireEvent.click(await openAtendimentos());
    // Durante a saída a navegação ainda não aconteceu.
    expect(pushMock).not.toHaveBeenCalled();
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('/atendimento/enc-thor-1'));
  });

  it('fechamento: a ficha permanece montada durante a saída e sai do DOM ao terminar', async () => {
    render(<Harness />);
    fireEvent.click(await openAtendimentos());
    // Logo após o pedido de fechamento a superfície ainda existe (animação de saída),
    // em vez de desaparecer no mesmo quadro como antes da correção.
    const dialog = document.querySelector('dialog.gd-detail') as HTMLDialogElement | null;
    expect(dialog).toBeTruthy();
    expect(dialog?.hasAttribute('data-closing')).toBe(true);
    await waitFor(() => expect(document.querySelector('dialog.gd-detail')).toBeNull(), { timeout: 2000 });
  });

  it('retorno: após a saída o overlay não bloqueia a interface', async () => {
    render(<Harness />);
    fireEvent.click(await openAtendimentos());
    await waitFor(() => expect(document.querySelector('dialog.gd-detail')).toBeNull(), { timeout: 2000 });
    // Nada de backdrop/diálogo residual; o gatilho externo continua acionável.
    expect(document.querySelectorAll('dialog[open]').length).toBe(0);
    expect(screen.getByRole('button', { name: 'reabrir ficha' })).toBeTruthy();
  });

  it('fechamento sem atendimento escolhido: não navega', async () => {
    pushMock.mockClear();
    render(<Harness />);
    await screen.findByRole('tab', { name: /Atendimentos/ });
    fireEvent.click(screen.getByRole('button', { name: /Fechar Thor/i }));
    await waitFor(() => expect(document.querySelector('dialog.gd-detail')).toBeNull(), { timeout: 2000 });
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('reabertura durante a saída mantém a ficha aberta (sem desmontar)', async () => {
    pushMock.mockClear();
    render(<Harness />);
    fireEvent.click(await openAtendimentos());
    // Reabre antes da saída terminar: a superfície continua aberta (sem desmontar).
    fireEvent.click(screen.getByRole('button', { name: 'reabrir ficha' }));
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    const dialog = document.querySelector('dialog.gd-detail');
    expect(dialog).toBeTruthy();
    expect(dialog?.hasAttribute('data-closing')).toBe(false);
  });
});
