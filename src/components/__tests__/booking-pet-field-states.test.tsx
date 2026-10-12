// @vitest-environment jsdom
// P1 · campo "Pet (paciente)" no Novo agendamento: estados explícitos da leitura.
// Regressões cobertas:
//  - falha de /api/pets NUNCA vira "tutor sem pet" nem some em silêncio;
//  - leitura sem businessId não é disparada (400 "Negócio não informado.");
//  - clínica não veterinária com falha de pets não ganha campo nem aviso de pet;
//  - "Tentar novamente" refaz a leitura e mostra os pets reais do tutor;
//  - nenhum pet é escolhido automaticamente (exige escolha explícita).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/api-client', () => ({
  apiGet: vi.fn(async () => ({ ok: true, status: 200, data: {}, message: '', denied: null, flow: 'stay', networkError: false })),
  apiSend: vi.fn(async () => ({ ok: true, status: 200, data: {}, message: '', denied: null, flow: 'stay', networkError: false })),
}));

import { apiGet } from '@/lib/api-client';
import { NewBookingSheet } from '../dashboard/NewBookingSheet';

type Resp = { ok: boolean; status: number; data: any };
// Novo agendamento navega para /clientes/novo pelo App Router (Missão 02).
// Este teste monta o sheet isoladamente: o router é um stub sem efeito.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
}));

const ok = (data: any): Resp => ({ ok: true, status: 200, data });
const fail = (status: number): Resp => ({ ok: false, status, data: { error: 'falha' } });

const LUNA = { id: 'pet-luna', name: 'Luna', tutorId: 'tutor-1', active: true, species: 'gato' };
const THOR = { id: 'pet-thor', name: 'Thor', tutorId: 'tutor-1', active: true, species: 'cachorro' };

/** Respostas por URL: a leitura do tutor é controlada por `tutorReply`. */
let vetFlagReply: Resp;
let tutorReply: () => Resp;
let calls: string[];

function setup(over: { vet?: boolean; flagFails?: boolean } = {}) {
  calls = [];
  vetFlagReply = over.flagFails ? fail(500) : ok({ vet: over.vet ?? true, clinicType: over.vet === false ? 'medica' : 'veterinaria', pets: [] });
  vi.mocked(apiGet).mockImplementation(async (url: string) => {
    calls.push(url);
    if (url.includes('/api/pets') && url.includes('tutorId=')) return tutorReply() as any;
    if (url.includes('/api/pets')) return vetFlagReply as any;
    return ok({}) as any;
  });
}

beforeEach(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  }
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderSheet(businessId = 'biz-vet') {
  return render(
    <NewBookingSheet
      open
      businessId={businessId}
      services={[]}
      pros={[]}
      horizonDays={30}
      initial={{ contactId: 'tutor-1', name: 'Bernardo Almeida', phone: '21987650011' }}
      onClose={() => {}}
      onCreated={() => {}}
    />,
  );
}

const tutorCalls = () => calls.filter((u) => u.includes('tutorId='));

describe('Novo agendamento · leitura de pets do tutor', () => {
  it('falha de /api/pets aparece como erro, não como "tutor sem pet"', async () => {
    setup({ vet: true });
    tutorReply = () => fail(500);
    renderSheet();
    await waitFor(() => expect(document.querySelector('[data-pets-state="error"]')).not.toBeNull());
    expect(document.querySelector('[data-vet-pet-empty="true"]')).toBeNull();
    expect(document.querySelector('[data-field="pet"]')).toBeNull();
    expect(screen.getByText(/Não foi possível carregar os pets deste tutor/)).toBeTruthy();
    expect(screen.queryByText(/ainda não tem pet cadastrado/)).toBeNull();
  });

  it('"Tentar novamente" refaz a leitura e mostra os dois pets para escolha explícita', async () => {
    setup({ vet: true });
    tutorReply = () => fail(403);
    renderSheet();
    await waitFor(() => expect(document.querySelector('[data-pets-state="error"]')).not.toBeNull());
    tutorReply = () => ok({ vet: true, pets: [LUNA, THOR] });
    const before = tutorCalls().length;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(document.querySelector('[data-field="pet"]')).not.toBeNull());
    expect(tutorCalls().length).toBe(before + 1);
    expect(document.querySelector('[data-pets-state="error"]')).toBeNull();
    // Nenhum pet escolhido automaticamente: o gatilho mostra o placeholder.
    expect(screen.getByText('Selecione o pet…')).toBeTruthy();
  });

  it('leitura com pets carregados mostra o seletor sem escolher automaticamente', async () => {
    setup({ vet: true });
    tutorReply = () => ok({ vet: true, pets: [LUNA, THOR] });
    renderSheet();
    await waitFor(() => expect(document.querySelector('[data-field="pet"]')).not.toBeNull());
    expect(screen.getByText('Selecione o pet…')).toBeTruthy();
    expect(screen.queryByText('Luna')).toBeNull();
  });

  it('clínica não veterinária com falha de pets: sem campo, sem aviso de pet', async () => {
    setup({ vet: false });
    tutorReply = () => fail(500);
    renderSheet('biz-medica');
    await waitFor(() => expect(tutorCalls().length).toBeGreaterThan(0));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[data-field="pet"]')).toBeNull();
    expect(document.querySelector('[data-pets-state="error"]')).toBeNull();
    expect(document.querySelector('[data-vet-pet-empty="true"]')).toBeNull();
  });

  it('nunca consulta /api/pets com businessId vazio', async () => {
    setup({ vet: true });
    tutorReply = () => ok({ vet: true, pets: [] });
    renderSheet('');
    await act(async () => { await Promise.resolve(); });
    expect(calls.some((u) => /businessId=(&|$)/.test(u))).toBe(false);
    expect(calls.some((u) => u.includes('/api/pets'))).toBe(false);
  });
});
