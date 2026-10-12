// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// REGRESSÃO · CADASTRO COMPLETO DE CLIENTE (Missão 02)
//   1. WhatsApp já cadastrado → bloqueia a gravação e oferece o existente;
//   2. CPF inválido → erro junto do campo (aria-invalid), sem chamada à rede;
//   3. falha parcial do pet → tutor fica salvo, tutor travado, só o pet é
//      retentado (nunca um segundo POST /api/contacts).
// A rede é mockada no fetch; o servidor continua sendo a autoridade.
// ═══════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewClientForm } from '@/components/dashboard/NewClientSheet';

type Reply = { status: number; body: unknown };
let replies: Array<{ match: (url: string, method: string) => boolean; reply: Reply | ((n: number) => Reply) }> = [];
let calls: Array<{ url: string; method: string }> = [];

function mockFetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    calls.push({ url, method });
    const idx = calls.filter((c) => c.url === url && c.method === method).length;
    const hit = replies.find((r) => r.match(url, method));
    if (!hit) throw new Error(`sem resposta mockada para ${method} ${url}`);
    const reply = typeof hit.reply === 'function' ? hit.reply(idx) : hit.reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  }) as any;
}

const countCalls = (method: string, path: string) =>
  calls.filter((c) => c.method === method && c.url.startsWith(path)).length;

const originalFetch = global.fetch;
beforeEach(() => {
  calls = [];
  replies = [];
  (HTMLDialogElement.prototype as any).showModal = function () { this.setAttribute('open', ''); };
  (HTMLDialogElement.prototype as any).close = function () { this.removeAttribute('open'); };
  document.body.innerHTML = '';
});
afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
});

describe('cadastro completo · duplicidade', () => {
  it('WhatsApp já cadastrado bloqueia a gravação e oferece o cadastro existente', async () => {
    replies = [
      { match: (u, m) => m === 'GET' && u.startsWith('/api/contacts?'), reply: { status: 200, body: { ok: true, contacts: [{ id: 'c-9', name: 'Tereza Alves', phone: '21912345678' }] } } },
      { match: (u, m) => m === 'POST' && u.startsWith('/api/contacts'), reply: { status: 200, body: { ok: true, contact: { id: 'c-new' } } } },
    ];
    mockFetch();
    const onOpenExisting = vi.fn();
    const onSaved = vi.fn();
    render(
      <NewClientForm
        businessId="biz-1" onCancel={() => {}} onSaved={onSaved} onOpenExisting={onOpenExisting}
        initialName="Tereza" initialPhone="21912345678"
      />,
    );
    fireEvent.click(screen.getByText('Salvar cliente'));
    expect(await screen.findByText(/Já existe um cliente com este WhatsApp/)).toBeTruthy();
    // Nenhuma gravação: o POST faria upsert silencioso no contato existente.
    expect(countCalls('POST', '/api/contacts')).toBe(0);
    expect(onSaved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Abrir cadastro existente — Tereza Alves/));
    expect(onOpenExisting).toHaveBeenCalledWith({ id: 'c-9', name: 'Tereza Alves', phone: '21912345678' });
  });

  it('se a verificação de duplicidade falha, não grava às cegas', async () => {
    replies = [
      { match: (u, m) => m === 'GET' && u.startsWith('/api/contacts?'), reply: { status: 500, body: { error: 'Falha de leitura' } } },
      { match: (u, m) => m === 'POST' && u.startsWith('/api/contacts'), reply: { status: 200, body: { ok: true, contact: { id: 'c-new' } } } },
    ];
    mockFetch();
    render(<NewClientForm businessId="biz-1" onCancel={() => {}} onSaved={() => {}} initialName="Tereza" initialPhone="21912345678" />);
    fireEvent.click(screen.getByText('Salvar cliente'));
    // Erro da verificação aparece e o formulário volta a ficar utilizável (não gravou).
    await waitFor(() => expect((screen.getByText('Salvar cliente') as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByText('Falha de leitura')).toBeTruthy();
    expect(countCalls('POST', '/api/contacts')).toBe(0);
    expect(screen.queryByText('Cadastro salvo')).toBeNull();
  });
});

describe('cadastro completo · erro de validação', () => {
  it('CPF inválido: erro junto do campo com aria-invalid e nenhuma chamada à rede', async () => {
    mockFetch();
    render(<NewClientForm businessId="biz-1" onCancel={() => {}} onSaved={() => {}} initialName="Tereza" initialPhone="21912345678" />);
    // Missão · Etapa 1: CPF e endereço são campos visíveis (sem seção recolhida).
    const cpf = screen.getByLabelText('CPF') as HTMLInputElement;
    fireEvent.change(cpf, { target: { value: '111.111.111-11' } });
    fireEvent.click(screen.getByText('Salvar cliente'));
    // Erro junto do campo (não duplicado no aviso geral).
    expect(await screen.findByText('CPF inválido.')).toBeTruthy();
    expect(cpf.getAttribute('aria-invalid')).toBe('true');
    expect(cpf.getAttribute('aria-describedby')).toBe('client-cpf-error');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('cadastro completo · falha parcial do pet', () => {
  it('tutor salvo, pet recusado: tutor travado e retry só do pet, sem duplicar o tutor', async () => {
    replies = [
      { match: (u, m) => m === 'GET' && u.startsWith('/api/contacts?'), reply: { status: 200, body: { ok: true, contacts: [] } } },
      { match: (u, m) => m === 'POST' && u.startsWith('/api/contacts'), reply: { status: 200, body: { ok: true, contact: { id: 'c-new' } } } },
      {
        match: (u, m) => m === 'POST' && u.startsWith('/api/pets'),
        reply: (n) => (n === 1
          ? { status: 500, body: { error: 'Falha temporária ao gravar o pet' } }
          : { status: 200, body: { ok: true, pet: { id: 'p-1', name: 'Greg' } } }),
      },
    ];
    mockFetch();
    const onSaved = vi.fn();
    render(<NewClientForm businessId="biz-1" vetMode onCancel={() => {}} onSaved={onSaved} initialName="Bernardo" initialPhone="21912345678" />);
    fireEvent.change(screen.getByLabelText(/NOME DO PET/), { target: { value: 'Greg' } });
    fireEvent.click(screen.getByText('Salvar tutor e pet'));

    expect(await screen.findByText(/Tutor salvo, mas o pet não foi gravado/)).toBeTruthy();
    // Estado de retomada: o botão deixa claro que só o pet é tentado de novo.
    const retry = screen.getByText('Tentar salvar o pet de novo');
    expect(retry).toBeTruthy();
    // Tutor travado (fieldset desabilitado); o pet continua editável.
    // `fieldset disabled` torna o tutor efetivamente desabilitado (:disabled).
    expect((screen.getByLabelText('NOME *') as HTMLInputElement).matches(':disabled')).toBe(true);
    expect((screen.getByLabelText(/NOME DO PET/) as HTMLInputElement).matches(':disabled')).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();

    fireEvent.click(retry);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('c-new', expect.objectContaining({ contactId: 'c-new', petId: 'p-1' })));
    // O tutor NÃO foi regravado: um único POST /api/contacts no fluxo inteiro.
    expect(countCalls('POST', '/api/contacts')).toBe(1);
    expect(countCalls('POST', '/api/pets')).toBe(2);
    expect(screen.getByText('Cadastro salvo')).toBeTruthy();
  });
});
