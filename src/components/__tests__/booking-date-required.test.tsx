// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// NOVO AGENDAMENTO · DATA OBRIGATÓRIA (integridade do submit)
// ═══════════════════════════════════════════════════════════════
// Contrato: o DatePicker sempre mantém um valor válido e NÃO é limpável pela UI.
// Logo, o estado "sem data" não é alcançável por interação humana. O guard
// `if (!serviceId || !date) fail(...)` em `save()` continua existindo como
// integridade defensiva: se o submit ocorrer sem data (ex.: estado inicial vindo
// de um chamador), a tela deve recusar, dizer o que falta, não chamar o
// servidor e não limpar o restante do formulário.
//
// Este teste prova o branch por comportamento real (render + submit), sem
// alterar o produto para forçar o erro.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { apiGet, apiSend } from '@/lib/api-client';
import { NewBookingSheet } from '../dashboard/NewBookingSheet';

vi.mock('@/lib/api-client', () => ({ apiGet: vi.fn(), apiSend: vi.fn() }));

const service = {
  id: 'svc-1', businessId: 'biz-1', categoryId: '', name: 'Consulta', description: '', image: '',
  price: 0, durationMin: 30, bookable: true, active: true, professionalIds: ['pro-1'],
} as any;
const pro = { id: 'pro-1', businessId: 'biz-1', name: 'Dra. Ana', role: '', photo: '', active: true } as any;

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.mocked(apiGet).mockResolvedValue({ ok: true, data: { contacts: [], pets: [] } } as any);
  vi.mocked(apiSend).mockResolvedValue({ ok: true, data: {} } as any);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Novo agendamento · data obrigatória no submit', () => {
  it('sem data: recusa com mensagem junto ao campo, sem chamar o servidor e sem perder o resto', async () => {
    const onCreated = vi.fn();
    render(
      <NewBookingSheet
        businessId="biz-1"
        services={[service]}
        pros={[pro]}
        horizonDays={30}
        initial={{ contactId: 'contact-1', name: 'Alex Souza', phone: '11999998888', serviceId: 'svc-1', professionalId: 'pro-1' }}
        onClose={vi.fn()}
        onCreated={onCreated}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Novo agendamento' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar agendamento' }));

    expect(await within(dialog).findByText('Escolha a data deste atendimento.')).toBeTruthy();
    expect(apiSend).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    // O restante do formulário permanece preenchido (nada foi limpo).
    expect(within(dialog).getByText('Alex Souza', { exact: false })).toBeTruthy();
  });

  it('o seletor de data não oferece ação de limpar (estado sem data inalcançável pela UI)', async () => {
    const { container } = render(
      <NewBookingSheet
        businessId="biz-1"
        services={[service]}
        pros={[pro]}
        horizonDays={30}
        initial={{ contactId: 'contact-1', name: 'Alex Souza', phone: '11999998888', serviceId: 'svc-1', professionalId: 'pro-1' }}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    await screen.findByRole('dialog', { name: 'Novo agendamento' });
    const dateField = container.querySelector('[data-field="date"]') as HTMLElement | null;
    expect(dateField).not.toBeNull();
    const clearButtons = within(dateField!).queryAllByRole('button', { name: /limpar|clear|remover|apagar/i });
    expect(clearButtons).toHaveLength(0);
    expect(apiSend).not.toHaveBeenCalled();
  });
});
