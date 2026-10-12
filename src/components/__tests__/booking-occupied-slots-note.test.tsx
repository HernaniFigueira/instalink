// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// NOVO AGENDAMENTO · horários ocupados explicados (Onda 1 · B)
// ═══════════════════════════════════════════════════════════════
// Defeito reproduzido em Chromium real (12/10, 1440x900, Owner): ao escolher a Dra. Michele, o 10:00
// SUMIA da lista sem nenhuma explicação (09:30 → 10:30). A API já devolvia `occupied`; a tela não usava.
// Contrato: quando horários da grade estão ocupados, a lista diz quantos não aparecem.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewBookingSheet } from '../dashboard/NewBookingSheet';

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn().mockResolvedValue({ ok: true, data: { contacts: [], pets: [] } }),
  apiSend: vi.fn().mockResolvedValue({ ok: true, data: {} }),
}));

// Novo agendamento navega para /clientes/novo pelo App Router (Missão 02).
// Este teste monta o sheet isoladamente: o router é um stub sem efeito.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
}));

const service = {
  id: 'svc-1', businessId: 'biz-1', categoryId: '', name: 'Consulta', description: '', image: '',
  price: 0, durationMin: 30, bookable: true, active: true, professionalIds: ['pro-1'],
} as any;
const pro = { id: 'pro-1', businessId: 'biz-1', name: 'Dra. Ana', role: '', photo: '', active: true } as any;

const DATE = '2026-10-12';
// Data futura relativa ao relógio do teste: o produto recusa horário já passado no dia
// corrente (fuso do negócio, America/Sao_Paulo). Um DATE fixo que vira "hoje" quebra o teste.
const FUTURE_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderWithSlots(payload: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => payload } as Response);
  return render(
    <NewBookingSheet
      businessId="biz-1"
      services={[service]}
      pros={[pro]}
      horizonDays={30}
      initial={{ contactId: 'contact-1', name: 'Bernardo Almeida', phone: '11999998888', serviceId: 'svc-1', professionalId: 'pro-1', date: DATE } as any}
      onClose={vi.fn()}
      onCreated={vi.fn()}
    />,
  );
}

describe('Novo agendamento · horários ocupados não somem em silêncio', () => {
  it('lista os horários livres e diz quantos ocupados não aparecem', async () => {
    renderWithSlots({ slots: ['09:00', '09:30', '10:30'], occupied: ['10:00'], closed: false, state: 'open' });
    await waitFor(() => expect(screen.getByRole('button', { name: '09:30' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: '10:00' })).toBeNull();
    expect(screen.getByText('1 horário ocupado não aparece nesta lista.')).toBeTruthy();
  });

  it('sem ocupação: nenhuma nota é exibida', async () => {
    renderWithSlots({ slots: ['09:00', '09:30'], occupied: [], closed: false, state: 'open' });
    await waitFor(() => expect(screen.getByRole('button', { name: '09:00' })).toBeTruthy());
    expect(screen.queryByText(/ocupad[oa]s? não aparece/)).toBeNull();
  });
});

// ── Dica do profissional automático só quando NÃO há profissional escolhida (Onda 1 · B) ──
// Defeito reproduzido no Chromium (12/10, pré-preenchido pela coluna da Dra. Michele): o campo mostrava
// "Dra. Michele Martins" e, logo abaixo, "Em branco: a agenda equilibra a equipe" — texto do modo automático.
describe('Novo agendamento · dica do profissional automático', () => {
  const twoPros = [pro, { id: 'pro-2', businessId: 'biz-1', name: 'Dr. Orlando', role: '', photo: '', active: true } as any];
  const twoProService = { ...service, professionalIds: ['pro-1', 'pro-2'] };
  const base = { contactId: 'contact-1', name: 'Bernardo Almeida', phone: '11999998888', serviceId: 'svc-1', date: DATE };

  it('com profissional escolhida, não exibe a dica de modo automático', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ slots: ['09:00'], occupied: [], closed: false, state: 'open' }) } as Response);
    render(<NewBookingSheet businessId="biz-1" services={[twoProService]} pros={twoPros} horizonDays={30} initial={{ ...base, professionalId: 'pro-1' } as any} onClose={vi.fn()} onCreated={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '09:00' })).toBeTruthy());
    expect(screen.queryByText('Em branco: a agenda equilibra a equipe')).toBeNull();
  });

  it('sem profissional escolhida (2+ elegíveis), mantém a dica do automático', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ slots: ['09:00'], occupied: [], closed: false, state: 'open' }) } as Response);
    render(<NewBookingSheet businessId="biz-1" services={[twoProService]} pros={twoPros} horizonDays={30} initial={{ ...base } as any} onClose={vi.fn()} onCreated={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Em branco: a agenda equilibra a equipe')).toBeTruthy());
  });
});

// ── Resumo do agendamento criado mostra o PET (paciente clínico em veterinária) ──
// Defeito reproduzido no Chromium (12/10, Bernardo/Thor): a confirmação mostrava cliente, serviço,
// profissional, data e horário, mas não o paciente que foi agendado.
describe('Novo agendamento · confirmação mostra o pet', () => {
  it('após criar, o resumo inclui o pet escolhido', async () => {
    const pet = { id: 'pet-thor', name: 'Thor', species: 'dog', tutorId: 'contact-1', businessId: 'biz-1' } as any;
    const apiClient = await import('@/lib/api-client');
    vi.mocked(apiClient.apiGet).mockResolvedValue({ ok: true, data: { contacts: [], pets: [pet], vet: true } } as any);
    vi.mocked(apiClient.apiSend).mockResolvedValue({ ok: true, data: { ok: true, bookingId: 'b1', professionalName: 'Dra. Ana' } } as any);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ slots: ['09:00'], occupied: [], closed: false, state: 'open' }) } as Response);
    render(<NewBookingSheet businessId="biz-1" services={[service]} pros={[pro]} horizonDays={30} initial={{ contactId: 'contact-1', name: 'Bernardo Almeida', phone: '11999998888', serviceId: 'svc-1', professionalId: 'pro-1', petId: 'pet-thor', date: FUTURE_DATE, time: '09:00' } as any} onClose={vi.fn()} onCreated={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '09:00' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Criar agendamento' }));
    await waitFor(() => expect(document.querySelector('[data-booking-created="true"]')).toBeTruthy());
    const resumo = document.querySelector('[data-booking-created="true"]') as HTMLElement;
    expect(resumo.textContent).toContain('Pet');
    expect(resumo.textContent).toContain('Thor');
  });
});
