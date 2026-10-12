// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// REGRESSÃO · FECHAMENTO DA MISSÃO 02 (cadastro em /clientes/novo)
//   1. Salvar → Cliente 360 automático (sem botão intermediário), chave da
//      ficha resolvida pelo contactId; estado da lista preservado;
//   2. ficha que não resolve NÃO redireciona em silêncio: aviso + tentativa;
//   3. Voltar do topo usa a MESMA guarda de Cancelar (sem saída direta);
//   4. pet pendente: a saída avisa que o pet não foi gravado.
// Rede mockada no fetch; o servidor segue sendo a autoridade.
// ═══════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const routerMock = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
const searchRef = vi.hoisted(() => ({ value: 'b=biz-1&from=clientes' }));

vi.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => new URLSearchParams(searchRef.value),
}));
vi.mock('@/components/dashboard/useBusinessId', () => ({
  useBusinessId: () => ({ businessId: 'biz-1', resolving: false, noBusiness: false }),
}));
vi.mock('@/components/dashboard/WorkspaceContext', () => ({
  useWorkspace: () => ({ agendaScope: 'all' }),
}));

import NovoClientePage from '@/app/(dashboard)/clientes/novo/page';
import { bookingReturnStorageKey, rememberClientsListQuery } from '@/lib/booking-return';

type Reply = { status: number; body: unknown };
let replies: Array<{ match: (url: string, method: string) => boolean; reply: Reply }> = [];
let calls: Array<{ url: string; method: string }> = [];

function mockFetch() {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    calls.push({ url, method });
    const hit = replies.find((r) => r.match(url, method));
    if (!hit) throw new Error(`sem resposta mockada para ${method} ${url}`);
    return new Response(JSON.stringify(hit.reply.body), { status: hit.reply.status, headers: { 'Content-Type': 'application/json' } });
  }) as any;
}

const contactOk = { match: (u: string, m: string) => m === 'POST' && u.startsWith('/api/contacts'), reply: { status: 200, body: { ok: true, contact: { id: 'c-7' } } } };
const noDuplicate = { match: (u: string, m: string) => m === 'GET' && u.startsWith('/api/contacts?'), reply: { status: 200, body: { ok: true, contacts: [] } } };
const petsNoVet = { match: (u: string, m: string) => m === 'GET' && u.startsWith('/api/pets?'), reply: { status: 200, body: { ok: true, vet: false } } };
const petsVet = { match: (u: string, m: string) => m === 'GET' && u.startsWith('/api/pets?'), reply: { status: 200, body: { ok: true, vet: true } } };
const peopleFound = { match: (u: string, m: string) => m === 'GET' && u.startsWith('/api/people360?'), reply: { status: 200, body: { ok: true, people: [{ key: 'k-7', contactId: 'c-7' }] } } };
const peopleEmpty = { match: (u: string, m: string) => m === 'GET' && u.startsWith('/api/people360?'), reply: { status: 200, body: { ok: true, people: [] } } };

function field(label: string): HTMLInputElement {
  const el = screen.getByText(label).closest('label')?.querySelector('input');
  if (!el) throw new Error(`campo ${label} não encontrado`);
  return el as HTMLInputElement;
}
async function fillTutor() {
  // Só depois de a página resolver unidade e tipo (estado "ready"), o formulário existe.
  await screen.findByText('Salvar cliente').catch(() => screen.findByText('Salvar tutor e pet'));
  fireEvent.change(field('NOME *'), { target: { value: 'Ana Souza' } });
  fireEvent.change(field('WHATSAPP *'), { target: { value: '21912345678' } });
}

beforeEach(() => {
  replies = [];
  calls = [];
  routerMock.replace.mockReset();
  routerMock.push.mockReset();
  searchRef.value = 'b=biz-1&from=clientes';
  sessionStorage.clear();
  (HTMLDialogElement.prototype as any).showModal = function () { this.setAttribute('open', ''); };
  (HTMLDialogElement.prototype as any).close = function () { this.removeAttribute('open'); };
});
afterEach(() => { cleanup(); });

describe('pós-salvamento · ficha automática', () => {
  it('salvar leva ao Cliente 360 pela CHAVE resolvida do contato e preserva a busca/página da lista', async () => {
    rememberClientsListQuery('biz-1', 'q=Ana&page=2');
    replies = [petsNoVet, noDuplicate, contactOk, peopleFound];
    mockFetch();
    render(<NovoClientePage />);
    await fillTutor();
    fireEvent.click(await screen.findByText('Salvar cliente'));

    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledTimes(1));
    const target = new URL(`http://x${routerMock.replace.mock.calls[0][0]}`);
    expect(target.pathname).toBe('/clientes/k-7');
    expect(target.searchParams.get('b')).toBe('biz-1');
    expect(target.searchParams.get('q')).toBe('Ana');
    expect(target.searchParams.get('page')).toBe('2');
    // Sem botão intermediário e sem o contactId na rota.
    expect(screen.queryByText('Ver Cliente 360')).toBeNull();
    expect(target.pathname).not.toContain('c-7');
    expect(routerMock.push).not.toHaveBeenCalled();
  });

  it('ficha que não resolve NÃO redireciona em silêncio: mostra aviso e tenta de novo', async () => {
    replies = [petsNoVet, noDuplicate, contactOk, peopleEmpty];
    mockFetch();
    render(<NovoClientePage />);
    await fillTutor();
    fireEvent.click(await screen.findByText('Salvar cliente'));

    expect(await screen.findByText('Cadastro salvo, mas a ficha não abriu')).toBeTruthy();
    expect(routerMock.replace).not.toHaveBeenCalled();
    expect(routerMock.push).not.toHaveBeenCalled();

    // Nova tentativa: a ficha agora existe → segue para ela.
    replies = [petsNoVet, noDuplicate, contactOk, peopleFound];
    mockFetch();
    fireEvent.click(screen.getByText('Tentar abrir o Cliente 360'));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledWith('/clientes/k-7?b=biz-1'));
  });

  it('vindo do agendamento, a ficha recebe o marcador de retorno (sem busca nem telefone na URL)', async () => {
    searchRef.value = 'b=biz-1&from=agenda';
    // Rascunho válido da mesma unidade: o retorno ao agendamento existe.
    sessionStorage.setItem(bookingReturnStorageKey('biz-1'), JSON.stringify({
      v: 1, businessId: 'biz-1', savedAt: Date.now(), contactId: '', name: '', phone: '', query: '',
      petId: '', serviceId: '', professionalId: '', date: '', time: '', durationMin: '', note: '', vetMode: false,
    }));
    replies = [petsNoVet, noDuplicate, contactOk, peopleFound];
    mockFetch();
    render(<NovoClientePage />);
    await fillTutor();
    fireEvent.click(await screen.findByText('Salvar cliente'));
    await waitFor(() => expect(routerMock.replace).toHaveBeenCalledTimes(1));
    const target = new URL(`http://x${routerMock.replace.mock.calls[0][0]}`);
    expect(target.pathname).toBe('/clientes/k-7');
    expect(target.searchParams.get('retorno')).toBe('agendamento');
    expect(target.searchParams.get('phone')).toBeNull();
    expect(target.searchParams.get('q')).toBeNull();
  });
});

describe('Voltar do topo usa a guarda de descarte', () => {
  it('com alterações não salvas, pede confirmação e só sai com "Descartar"', async () => {
    replies = [petsNoVet, noDuplicate];
    mockFetch();
    render(<NovoClientePage />);
    await fillTutor();
    await screen.findByText('Salvar cliente');
    fireEvent.click(screen.getByText('Voltar para clientes'));

    expect(routerMock.push).not.toHaveBeenCalled();
    expect(await screen.findByText('Descartar cadastro?')).toBeTruthy();

    fireEvent.click(screen.getByText('Continuar editando'));
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(screen.queryByText('Descartar cadastro?')).toBeNull();

    fireEvent.click(screen.getByText('Voltar para clientes'));
    fireEvent.click(await screen.findByText('Descartar'));
    expect(routerMock.push).toHaveBeenCalledWith('/clientes?b=biz-1');
  });

  it('com formulário limpo, volta direto (sem diálogo)', async () => {
    replies = [petsNoVet, noDuplicate];
    mockFetch();
    render(<NovoClientePage />);
    await screen.findByText('Salvar cliente');
    fireEvent.click(screen.getByText('Voltar para clientes'));
    expect(routerMock.push).toHaveBeenCalledWith('/clientes?b=biz-1');
    expect(screen.queryByText('Descartar cadastro?')).toBeNull();
  });
});

describe('falha parcial do pet', () => {
  it('tutor salvo e pet pendente: sair avisa que o pet não será cadastrado', async () => {
    replies = [
      petsVet, noDuplicate, contactOk,
      { match: (u, m) => m === 'POST' && u.startsWith('/api/pets'), reply: { status: 500, body: { ok: false, error: 'falha' } } },
    ];
    mockFetch();
    render(<NovoClientePage />);
    await fillTutor();
    fireEvent.change(field('NOME DO PET *'), { target: { value: 'Luna' } });
    fireEvent.click(await screen.findByText('Salvar tutor e pet'));
    expect(await screen.findByText(/Tutor salvo, mas o pet não foi gravado/)).toBeTruthy();

    fireEvent.click(screen.getByText('Voltar para clientes'));
    expect(await screen.findByText('Pet ainda não gravado')).toBeTruthy();
    expect(routerMock.push).not.toHaveBeenCalled();
    // O tutor é gravado UMA vez; sair não regrava nem cria outro cadastro.
    expect(calls.filter((c) => c.method === 'POST' && c.url.startsWith('/api/contacts')).length).toBe(1);
  });
});
