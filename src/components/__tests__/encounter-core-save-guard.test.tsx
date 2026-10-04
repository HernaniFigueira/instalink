// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// F1A · P1 — SAIR SÓ DEPOIS DE PERSISTIR (o texto clínico não pode sumir)
// ═══════════════════════════════════════════════════════════════
// O achado: `beforeNavigate` chamava `proceed()` em `finally`, então uma falha
// de gravação (rede, servidor, 409) navegava mesmo assim — o texto digitado
// era perdido em silêncio. Em registro clínico isso é inaceitável.
//
// Estas travas provam o contrato no componente REAL (não em um mock de lógica):
//
//   • save falha            → `proceed` NÃO é chamado e o texto fica na tela;
//   • 409 (versão)          → `proceed` NÃO é chamado, nada é sobrescrito, e a
//                             tela oferece "Continuar editando" / "Recarregar";
//   • flush com sucesso     → `proceed` é chamado UMA vez;
//   • retry que funciona    → limpa o pendente e a saída volta a ser livre;
//   • sem nada pendente     → saída imediata (a proteção fica inerte);
//   • descarte              → só acontece por escolha explícita no diálogo;
//   • autosave normal        → continua gravando sozinho (sem regressão).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EncounterCoreSection, type EncounterCoreRow } from '../dashboard/EncounterCoreSection';
import { apiGet, apiSend } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({ apiSend: vi.fn(), apiGet: vi.fn() }));

const send = vi.mocked(apiSend);
const get = vi.mocked(apiGet);

function row(extra: Partial<EncounterCoreRow> = {}): EncounterCoreRow {
  return {
    id: 'e-1', businessId: 'b1', status: 'draft', version: 1,
    bookingId: 'bk-1', queueId: '', serviceId: 'svc-1', professionalId: 'pro-1',
    customerId: '', contactId: 'ct-1', customerName: 'Isabelle Tutora',
    date: '2026-10-04', time: '14:00',
    complaint: 'Coceira', evolution: '', guidance: '', followUp: '', internalNote: '', tags: [],
    createdAt: '2026-10-04T17:00:00.000Z', updatedAt: '2026-10-04T17:00:00.000Z',
    createdBy: 'u1', updatedBy: 'u1', finalizedAt: '', finalizedBy: '', signedBy: '', petId: 'pet-1',
    ...extra,
  } as EncounterCoreRow;
}

type Result = Awaited<ReturnType<typeof apiSend>>;

function okResult(encounter: EncounterCoreRow): Result {
  return { ok: true, status: 200, data: { encounter }, message: '', denied: null, flow: 'stay', networkError: false };
}
function failResult(status: number, message: string): Result {
  return { ok: false, status, data: null, message, denied: null, flow: 'stay', networkError: status === 0 };
}

/** Renderiza o núcleo expondo o contrato de saída (é o que o workspace usa). */
function mount(encounter = row()) {
  let leave: ((reason: 'close-button', proceed: () => void) => void) | null = null;
  const view = render(
    <EncounterCoreSection
      businessId="b1"
      encounter={encounter}
      registerLeave={(fn) => { leave = fn as typeof leave; }}
    />,
  );
  return { view, leave: (proceed: () => void) => leave!('close-button', proceed) };
}

const TEXTO = 'Conduta realizada e tutora orientada.';
// F1B1 §6 — a copy da tela é clínica agora; o CAMPO físico continua `evolution`.
const evolutionField = () => screen.getByLabelText(/Evolução clínica/) as HTMLTextAreaElement;

async function typeDraft() {
  fireEvent.change(evolutionField(), { target: { value: TEXTO } });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => { send.mockReset(); get.mockReset(); });
afterEach(cleanup);

describe('F1A · sair exige persistência confirmada', () => {
  it('SUCESSO: grava e chama proceed UMA vez', async () => {
    send.mockResolvedValue(okResult(row({ version: 2, evolution: TEXTO })));
    const { leave } = mount();
    await typeDraft();
    const proceed = vi.fn();
    await act(async () => { leave(proceed); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('FALHA DE REDE: NÃO chama proceed e o texto continua na tela', async () => {
    send.mockResolvedValue(failResult(0, 'Não foi possível conectar ao servidor.'));
    const { leave } = mount();
    await typeDraft();
    const proceed = vi.fn();
    await act(async () => { leave(proceed); });
    expect(proceed).not.toHaveBeenCalled();
    expect(evolutionField().value).toBe(TEXTO);
    // O erro está visível e diz que nada foi perdido.
    expect(screen.getByRole('alert').textContent).toMatch(/nada foi perdido/i);
    // Nenhum modal automático: a tela continua utilizável para tentar de novo.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // Sair sem gravar existe, mas é escolha explícita → confirmação no diálogo.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sair sem salvar' })); });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continuar editando' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy();
    expect(proceed).not.toHaveBeenCalled();
  });

  it('ERRO 500: NÃO chama proceed (servidor fora do ar não autoriza saída)', async () => {
    send.mockResolvedValue(failResult(500, 'O servidor não respondeu. Tente novamente em instantes.'));
    const { leave } = mount();
    await typeDraft();
    const proceed = vi.fn();
    await act(async () => { leave(proceed); });
    expect(proceed).not.toHaveBeenCalled();
    expect(evolutionField().value).toBe(TEXTO);
  });

  it('409 · CONFLITO: NÃO chama proceed, não sobrescreve e oferece as duas saídas', async () => {
    send.mockResolvedValue(failResult(409, 'Este registro mudou. Recarregue para continuar.'));
    const { leave } = mount();
    await typeDraft();
    const proceed = vi.fn();
    await act(async () => { leave(proceed); });
    expect(proceed).not.toHaveBeenCalled();
    // Mensagem canônica do conflito + texto intacto.
    expect(screen.getByRole('alert').textContent).toMatch(/alterado em outra tela/i);
    expect(evolutionField().value).toBe(TEXTO);
    // Nenhuma gravação extra: insistir só repetiria o 409.
    expect(send).toHaveBeenCalledTimes(1);
    // As duas ações existem; nenhuma delas navega sozinha.
    expect(screen.getByRole('button', { name: 'Continuar editando' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Recarregar versão atual' })).toBeTruthy();
  });

  it('409 · “Recarregar versão atual” adota o servidor (escolha explícita, nunca silenciosa)', async () => {
    send.mockResolvedValueOnce(failResult(409, 'Este registro mudou. Recarregue para continuar.'));
    const { leave } = mount();
    await typeDraft();
    await act(async () => { leave(vi.fn()); });           // conflito na tela
    get.mockResolvedValueOnce({
      ok: true, status: 200, data: { encounter: row({ version: 3, evolution: 'Texto da outra tela' }) },
      message: '', denied: null, flow: 'stay', networkError: false,
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Recarregar versão atual' }));
      await Promise.resolve();
    });
    await waitFor(() => expect(evolutionField().value).toBe('Texto da outra tela'));
    // Depois de recarregar, nada fica pendente: sair é livre de novo.
    send.mockResolvedValue(okResult(row({ version: 4 })));
    const proceed = vi.fn();
    const callsBefore = send.mock.calls.length;
    await act(async () => { leave(proceed); });
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.length).toBe(callsBefore);     // nada a gravar
  });

  it('RETRY: depois que a rede volta, o flush salva, limpa o pendente e a saída acontece', async () => {
    send.mockResolvedValueOnce(failResult(0, 'Não foi possível conectar ao servidor.'));
    const { leave } = mount();
    await typeDraft();
    const first = vi.fn();
    await act(async () => { leave(first); });
    expect(first).not.toHaveBeenCalled();
    // Rede de volta: a nova tentativa grava e a saída é liberada.
    send.mockResolvedValueOnce(okResult(row({ version: 2, evolution: TEXTO })));
    const second = vi.fn();
    await act(async () => { leave(second); });
    expect(second).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
    // Persistência real: o indicador volta a "Salvo" (dirty zerado).
    await waitFor(() => expect(screen.getByTestId('encounter-core-save-state').textContent).toMatch(/Salvo/));
  });

  it('DESCARTE: só sai por escolha explícita — “Continuar editando” fica, “Descartar” sai', async () => {
    send.mockResolvedValue(failResult(0, 'Não foi possível conectar ao servidor.'));
    const { leave } = mount();
    await typeDraft();
    const proceed = vi.fn();
    await act(async () => { leave(proceed); });
    expect(screen.queryByRole('alertdialog')).toBeNull();      // falhou: erro na tela
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sair sem salvar' })); });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    // Continuar editando: fecha o diálogo e NÃO navega.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' })); });
    expect(proceed).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(evolutionField().value).toBe(TEXTO);                // texto intacto
    // Tentar sair de novo: a proteção continua viva (erro + escolha explícita).
    await act(async () => { leave(proceed); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sair sem salvar' })); });
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    // Descartar: escolha explícita → aí sim, navega.
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Descartar' })); });
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it('SEM NADA PENDENTE: a saída é imediata e a proteção fica inerte', async () => {
    const { leave } = mount();
    const proceed = vi.fn();
    await act(async () => { leave(proceed); });
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('SAÍDA DUPLA não dispara dois flush (proceed continua sendo uma vez)', async () => {
    send.mockResolvedValue(okResult(row({ version: 2, evolution: TEXTO })));
    const { leave } = mount();
    await typeDraft();
    const proceed = vi.fn();
    await act(async () => {
      leave(proceed);
      leave(proceed);
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledTimes(1);
  });
});

describe('F1A · autosave normal (sem regressão)', () => {
  it('depois de digitar, o núcleo grava sozinho e a proteção de saída desaparece', async () => {
    send.mockResolvedValue(okResult(row({ version: 2, evolution: TEXTO })));
    const { leave } = mount();
    await typeDraft();
    await act(async () => { await new Promise((r) => { setTimeout(r, 1150); }); });
    expect(send).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('encounter-core-save-state').textContent).toMatch(/Salvo/));
    const proceed = vi.fn();
    await act(async () => { leave(proceed); });
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);   // já estava gravado: sair não regrava
  });
});
