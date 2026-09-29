// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { apiGet, apiSend } from '@/lib/api-client';
import { PetsSection } from '../dashboard/PetsSection';
import { NewBookingSheet } from '../dashboard/NewBookingSheet';
import { AnamneseFiller } from '../dashboard/AnamneseFiller';
import type { AnamneseResponse, AnamneseTemplate, Pet } from '@/lib/types';

vi.mock('@/lib/api-client', () => ({ apiGet: vi.fn(), apiSend: vi.fn() }));

const pet: Pet = {
  id: 'pet-1', businessId: 'biz-1', tutorId: 'contact-1', name: 'Nina', photo: '',
  species: 'gato', breed: '', sex: '', birthDate: '', weightKg: 0, notes: '', active: true,
  createdAt: '', updatedAt: '',
};
const template: AnamneseTemplate = {
  id: 'template-1', businessId: 'biz-1', name: 'Anamnese veterinária',
  description: '', preset: 'veterinaria', active: true, createdAt: '', updatedAt: '',
  fields: [
    { id: 'motivo', label: 'Motivo da consulta', type: 'textarea', required: false },
    { id: 'agua', label: 'Consumo de água', type: 'select', options: ['Normal', 'Reduzido'], required: false },
    { id: 'vomitos', label: 'Vômitos', type: 'boolean', required: false },
  ],
};
const savedResponse: AnamneseResponse = {
  id: 'response-1', businessId: 'biz-1', templateId: template.id, encounterId: 'enc-1',
  contactId: 'contact-1', petId: 'pet-1', professionalId: 'pro-1',
  answers: { motivo: 'Tosse', agua: 'Normal', vomitos: false },
  createdAt: '2026-09-28T12:00:00.000Z', updatedAt: '2026-09-28T12:00:00.000Z', createdBy: 'user-1',
};

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  vi.mocked(apiGet).mockImplementation(async (url: string) => {
    if (url.startsWith('/api/pets')) return { ok: true, data: { vet: true, pets: [pet] } } as any;
    return { ok: true, data: { templates: [template], responses: [] } } as any;
  });
  vi.mocked(apiSend).mockResolvedValue({ ok: true, data: { response: savedResponse } } as any);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });

async function openNewPet() {
  render(<PetsSection businessId="biz-1" tutorId="contact-1" tutorName="Alex" />);
  await screen.findByText('Pets de Alex');
  fireEvent.click(screen.getByRole('button', { name: 'Cadastrar pet' }));
  await screen.findByRole('dialog');
  fireEvent.change(document.getElementById('pet-name') as HTMLInputElement, { target: { value: 'Pipoca' } });
  return screen.getByRole('dialog');
}

function requestPetDismiss(dialog: HTMLElement, reason: 'backdrop' | 'escape' | 'x') {
  if (reason === 'backdrop') fireEvent.click(dialog);
  else if (reason === 'escape') fireEvent.keyDown(dialog, { key: 'Escape' });
  else fireEvent.click(screen.getByRole('button', { name: 'Fechar Novo pet' }));
}

describe('homologação manual — Novo pet protege trabalho dirty', () => {
  it.each(['backdrop', 'escape', 'x'] as const)('DIRTY + %s pede decisão e mantém os dados ao continuar', async (reason) => {
    const dialog = await openNewPet();
    requestPetDismiss(dialog, reason);
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Descartar cadastro do pet?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continuar editando' }).className).toContain('il-control--secondary');
    expect(screen.getByRole('button', { name: 'Descartar' }).className).toContain('il-control--destructive');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((document.getElementById('pet-name') as HTMLInputElement).value).toBe('Pipoca');
  });

  it('PRISTINE + backdrop fecha sem pedir confirmação', async () => {
    render(<PetsSection businessId="biz-1" tutorId="contact-1" tutorName="Alex" />);
    await screen.findByText('Pets de Alex');
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar pet' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('salvar o pet fecha sem confirmação de descarte', async () => {
    await openNewPet();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar pet' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('homologação manual — Novo agendamento mantém o guard dirty e a faixa ampliada', () => {
  it('dirty + backdrop mantém o sheet e oferece continuar editando ou descartar', async () => {
    const onClose = vi.fn();
    render(<NewBookingSheet businessId="biz-1" services={[]} pros={[]} horizonDays={30} onClose={onClose} onCreated={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Novo agendamento' });
    // Largura operacional compartilhada (nem esticado, nem estreito).
    expect(document.querySelector('.il-drawer__strip')?.className).toContain('max-w-2xl');
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar cliente' }), { target: { value: 'Alex' } });
    fireEvent.click(dialog.querySelector('[aria-hidden="true"]')!);
    const confirmation = await screen.findByRole('alertdialog');
    expect(confirmation).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continuar editando' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Descartar' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Buscar cliente' }) as HTMLInputElement).value).toBe('Alex');
    expect(onClose).not.toHaveBeenCalled();
  });
});

async function openAnamnese(onSaved = vi.fn(), onClose = vi.fn(), responses: AnamneseResponse[] = []) {
  vi.mocked(apiGet).mockResolvedValue({ ok: true, data: { templates: [template], responses } } as any);
  render(<AnamneseFiller open onClose={onClose} businessId="biz-1" templateId={template.id}
    contactId="contact-1" petId="pet-1" professionalId="pro-1" encounterId="enc-1" onSaved={onSaved} />);
  const dialog = await screen.findByRole('dialog');
  return { dialog, onSaved, onClose };
}

function requestAnamneseDismiss(dialog: HTMLElement, reason: 'backdrop' | 'escape' | 'x') {
  if (reason === 'backdrop') fireEvent.click(dialog);
  else if (reason === 'escape') fireEvent.keyDown(dialog, { key: 'Escape' });
  else fireEvent.click(screen.getByRole('button', { name: 'Fechar Anamnese veterinária' }));
}

describe('homologação manual — Anamnese mantém semântica e protege trabalho', () => {
  it('booleano pristine permanece Não informado, não Não', async () => {
    await openAnamnese();
    const answer = screen.getByLabelText('Vômitos') as HTMLSelectElement;
    expect(answer.value).toBe('');
    expect(screen.getByRole('option', { name: 'Não informado' }).getAttribute('value')).toBe('');
  });

  it.each(['backdrop', 'escape', 'x'] as const)('DIRTY + %s pede decisão e mantém respostas', async (reason) => {
    const { dialog } = await openAnamnese();
    fireEvent.change(screen.getByLabelText('Motivo da consulta'), { target: { value: 'Tosse' } });
    requestAnamneseDismiss(dialog, reason);
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText('Descartar preenchimento da anamnese?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar editando' }));
    expect((screen.getByLabelText('Motivo da consulta') as HTMLTextAreaElement).value).toBe('Tosse');
  });

  it('salvar comunica a resposta completa ao pai antes de fechar', async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    await openAnamnese(onSaved, onClose);
    fireEvent.change(screen.getByLabelText('Motivo da consulta'), { target: { value: 'Tosse' } });
    fireEvent.change(screen.getByLabelText('Vômitos'), { target: { value: 'false' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar ficha' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedResponse));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.invocationCallOrder[0]).toBeLessThan(onClose.mock.invocationCallOrder[0]);
  });

  it('histórico usa labels humanos, respeita respostas antigas false e mostra ausentes como Não informado', async () => {
    const response = { ...savedResponse, answers: { motivo: 'Tosse', agua: 'Normal', vomitos: false } };
    await openAnamnese(vi.fn(), vi.fn(), [response]);
    fireEvent.click(screen.getByRole('button', { name: 'Ver histórico' }));
    const history = screen.getByTestId('anamnese-history');
    expect(within(history).getByText('Motivo da consulta')).toBeTruthy();
    expect(within(history).getByText('Consumo de água')).toBeTruthy();
    expect(within(history).getByText('Não', { exact: true })).toBeTruthy();
    expect(within(history).queryByText('motivo:')).toBeNull();

    cleanup();
    await openAnamnese(vi.fn(), vi.fn(), [{ ...response, answers: { motivo: 'Tosse' } }]);
    fireEvent.click(screen.getByRole('button', { name: 'Ver histórico' }));
    expect(within(screen.getByTestId('anamnese-history')).getByText('Não informado')).toBeTruthy();
  });
});
