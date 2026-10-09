// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// P0 · AUTOSAVE NÃO PODE APAGAR O TEXTO QUE ESTÁ SENDO DIGITADO
// ═══════════════════════════════════════════════════════════════
// Causa reproduzida: a seção do núcleo reidratava o formulário a partir da
// linha do servidor sempre que a prop `encounter` mudava. A autoridade publica
// uma linha nova a cada save (inclusive o eco do próprio save), então a
// resposta de um PATCH antigo voltava o texto para o snapshot de antes da
// digitação atual.
//
// Estes testes exercitam o componente REAL com latência controlada no PATCH:
//   • save A em voo → usuário continua digitando → A chega → texto novo fica;
//   • save A → digitação B → A confirma → B é gravado → A atrasada → B fica;
//   • linha atrasada (versão menor) nunca volta o formulário no tempo.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EncounterCoreSection, type EncounterCoreRow } from '../dashboard/EncounterCoreSection';
import { apiGet, apiSend } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({ apiSend: vi.fn(), apiGet: vi.fn() }));

const send = vi.mocked(apiSend);
const get = vi.mocked(apiGet);

type Result = Awaited<ReturnType<typeof apiSend>>;

function row(extra: Partial<EncounterCoreRow> = {}): EncounterCoreRow {
  return {
    id: 'e-race', businessId: 'b1', status: 'draft', version: 1,
    bookingId: 'bk-1', queueId: '', serviceId: 'svc-1', professionalId: 'pro-1',
    customerId: '', contactId: 'ct-1', customerName: 'Tutora QA',
    date: '2026-10-09', time: '14:00',
    complaint: 'Coceira', evolution: '', guidance: '', followUp: '', internalNote: '', tags: [],
    createdAt: '2026-10-09T17:00:00.000Z', updatedAt: '2026-10-09T17:00:00.000Z',
    createdBy: 'u1', updatedBy: 'u1', finalizedAt: '', finalizedBy: '', signedBy: '', petId: 'pet-1',
    ...extra,
  } as EncounterCoreRow;
}

function okResult(encounter: EncounterCoreRow): Result {
  return { ok: true, status: 200, data: { encounter }, message: '', denied: null, flow: 'stay', networkError: false } as Result;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

const evolutionField = () => screen.getByLabelText(/Evolução clínica/) as HTMLTextAreaElement;
const guidanceField = () => screen.getByLabelText(/Orientações ao tutor/) as HTMLTextAreaElement;

function mount(encounter = row()) {
  return render(<EncounterCoreSection businessId="b1" encounter={encounter} />);
}

/** Espera o autosave disparar (debounce real de ENCOUNTER_AUTOSAVE_MS). */
async function waitForSaveCall(n: number) {
  await waitFor(() => expect(send).toHaveBeenCalledTimes(n), { timeout: 4000 });
}

beforeEach(() => { send.mockReset(); get.mockReset(); });
afterEach(cleanup);

describe('P0 · autosave race (núcleo clínico)', () => {
  it('save A em voo → usuário continua digitando → resposta A chega → texto novo permanece', async () => {
    const dA = deferred<Result>();
    send.mockReturnValueOnce(dA.promise);
    send.mockResolvedValue(okResult(row({ version: 3, evolution: 'A continuação' })));

    const view = mount();
    fireEvent.change(evolutionField(), { target: { value: 'A' } });
    await waitForSaveCall(1);

    // enquanto A está em voo, a pessoa continua digitando em dois campos
    fireEvent.change(evolutionField(), { target: { value: 'A continuação' } });
    fireEvent.change(guidanceField(), { target: { value: 'Orientação digitada agora' } });

    await act(async () => {
      dA.resolve(okResult(row({ version: 2, evolution: 'A' })));
      await dA.promise;
    });
    // o workspace publica a linha confirmada (eco do save)
    view.rerender(<EncounterCoreSection businessId="b1" encounter={row({ version: 2, evolution: 'A' })} />);

    expect(evolutionField().value).toBe('A continuação');
    expect(guidanceField().value).toBe('Orientação digitada agora');
  });

  it('save A → digitação B → A confirma → B grava → resposta A atrasada → B continua na tela', async () => {
    const dA = deferred<Result>();
    const dB = deferred<Result>();
    send.mockReturnValueOnce(dA.promise).mockReturnValueOnce(dB.promise);

    const view = mount();
    fireEvent.change(evolutionField(), { target: { value: 'A' } });
    await waitForSaveCall(1);
    fireEvent.change(evolutionField(), { target: { value: 'AB' } });

    await act(async () => {
      dA.resolve(okResult(row({ version: 2, evolution: 'A' })));
      await dA.promise;
    });
    view.rerender(<EncounterCoreSection businessId="b1" encounter={row({ version: 2, evolution: 'A' })} />);

    // B é gravado com a versão CONFIRMADA por A (a autoridade, não o render)
    await waitForSaveCall(2);
    expect(send.mock.calls[1][2]).toMatchObject({ expectedVersion: 2, evolution: 'AB' });
    await act(async () => {
      dB.resolve(okResult(row({ version: 3, evolution: 'AB' })));
      await dB.promise;
    });
    view.rerender(<EncounterCoreSection businessId="b1" encounter={row({ version: 3, evolution: 'AB' })} />);

    // a resposta de A chega ATRASADA, depois de B já estar confirmado
    view.rerender(<EncounterCoreSection businessId="b1" encounter={row({ version: 2, evolution: 'A' })} />);

    expect(evolutionField().value).toBe('AB');
  });

  it('linha atrasada com versão menor não volta o formulário no tempo', async () => {
    const view = mount(row({ version: 5, evolution: 'Texto atual' }));
    expect(evolutionField().value).toBe('Texto atual');
    view.rerender(<EncounterCoreSection businessId="b1" encounter={row({ version: 4, evolution: 'Antigo' })} />);
    expect(evolutionField().value).toBe('Texto atual');
    expect(send).not.toHaveBeenCalled();
  });

  it('digitação em dois campos na mesma janela: nenhum campo vizinho é perdido', async () => {
    send.mockResolvedValue(okResult(row({ version: 2, evolution: 'E1', guidance: 'G1' })));
    mount();
    fireEvent.change(evolutionField(), { target: { value: 'E1' } });
    fireEvent.change(guidanceField(), { target: { value: 'G1' } });
    await waitForSaveCall(1);
    const sent = send.mock.calls[0][2] as Record<string, unknown>;
    expect(sent).toMatchObject({ evolution: 'E1', guidance: 'G1' });
  });
});
