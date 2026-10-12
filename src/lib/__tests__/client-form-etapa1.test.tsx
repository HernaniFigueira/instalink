// @vitest-environment jsdom
// ═══════════════════════════════════════════════════════════════
// REGRESSÃO · FICHA DE ADMISSÃO (Missão · Etapa 1)
//   • Identificação, Endereço e Informações adicionais visíveis (sem expandir);
//   • CPF vazio aceito; CPF/data inválidos bloqueiam o salvamento;
//   • CEP: consulta só com 8 dígitos; encontrado, não encontrado, indisponível,
//     atrasado (resposta antiga não sobrescreve) — rede MOCKADA, não homologação real.
// ═══════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewClientForm } from '@/components/dashboard/NewClientSheet';

type Json = { status: number; body: unknown };
let calls: Array<{ url: string; method: string }> = [];
let cepHandler: (cep: string) => Promise<Json> | Json;

beforeEach(() => {
  calls = [];
  cepHandler = () => ({ status: 200, body: { erro: true } });
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    calls.push({ url, method });
    let reply: Json;
    if (url.startsWith('https://viacep.com.br/ws/')) {
      reply = await cepHandler(url.split('/ws/')[1].split('/')[0]);
    } else if (url.startsWith('https://brasilapi.com.br/')) {
      reply = { status: 503, body: {} };
    } else if (method === 'GET' && url.includes('/api/contacts?')) {
      // Consulta de duplicidade por WhatsApp: nenhum cadastro existente.
      reply = { status: 200, body: { contacts: [] } };
    } else if (method === 'POST' && url.endsWith('/api/contacts')) {
      // Servidor de QA é a autoridade; aqui só provamos que a chamada saiu.
      reply = { status: 201, body: { contact: { id: 'c-1', name: 'Tereza', phone: '21912345678' } } };
    } else {
      reply = { status: 500, body: { error: 'mock: sem resposta de servidor' } };
    }
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  }) as any;
  document.body.innerHTML = '';
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderForm() {
  return render(<NewClientForm businessId="biz-1" onCancel={() => {}} onSaved={() => {}} initialName="" initialPhone="" />);
}
const viaCepCalls = () => calls.filter((c) => c.url.startsWith('https://viacep.com.br/')).length;
const postContacts = () => calls.filter((c) => c.method === 'POST' && c.url.includes('/api/contacts')).length;

describe('ficha de admissão · layout', () => {
  it('campos principais visíveis sem nenhum botão de expandir', () => {
    renderForm();
    for (const name of ['CPF', 'DATA DE NASCIMENTO', 'WHATSAPP *', 'E-MAIL', 'CEP', 'LOGRADOURO', 'NÚMERO', 'COMPLEMENTO', 'BAIRRO', 'CIDADE', 'UF', 'OBSERVAÇÕES']) {
      expect(screen.getByLabelText(new RegExp('^' + name.replace(/[*()]/g, '\\$&')))).toBeTruthy();
    }
    expect(screen.queryByText('Documento e endereço')).toBeNull();
    expect(screen.queryByText('Opcional')).toBeNull();
    expect(screen.getByText('Identificação')).toBeTruthy();
    expect(screen.getByText('Endereço')).toBeTruthy();
    expect(screen.getByText('Informações adicionais')).toBeTruthy();
  });
});

describe('CPF e data', () => {
  it('CPF vazio é aceito: nenhum erro e o salvamento chega ao servidor', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('NOME *'), { target: { value: 'Tereza' } });
    fireEvent.change(screen.getByLabelText(/WHATSAPP/), { target: { value: '21912345678' } });
    fireEvent.click(screen.getByText('Salvar cliente'));
    await waitFor(() => expect(postContacts()).toBe(1));
    expect(screen.queryByText(/CPF inválido/)).toBeNull();
  });

  it('CPF informado e inválido bloqueia o salvamento com erro junto do campo', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('NOME *'), { target: { value: 'Tereza' } });
    fireEvent.change(screen.getByLabelText(/WHATSAPP/), { target: { value: '21912345678' } });
    fireEvent.change(screen.getByLabelText('CPF'), { target: { value: '111.111.111-11' } });
    fireEvent.click(screen.getByText('Salvar cliente'));
    expect(await screen.findByText('CPF inválido.')).toBeTruthy();
    expect(screen.getByLabelText('CPF').getAttribute('aria-invalid')).toBe('true');
    expect(postContacts()).toBe(0);
  });

  it('data inexistente (31/02) mostra erro, marca o campo e não salva', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText('NOME *'), { target: { value: 'Tereza' } });
    fireEvent.change(screen.getByLabelText(/WHATSAPP/), { target: { value: '21912345678' } });
    const birth = screen.getByLabelText('DATA DE NASCIMENTO') as HTMLInputElement;
    fireEvent.change(birth, { target: { value: '31021990' } });
    expect(birth.value).toBe('31/02/1990');
    fireEvent.click(screen.getByText('Salvar cliente'));
    expect(await screen.findByText('Data inexistente. Confira dia e mês.')).toBeTruthy();
    expect(birth.getAttribute('aria-invalid')).toBe('true');
    expect(postContacts()).toBe(0);
  });

  it('data válida digitada em DD/MM/AAAA sem erro', () => {
    renderForm();
    const birth = screen.getByLabelText('DATA DE NASCIMENTO') as HTMLInputElement;
    fireEvent.change(birth, { target: { value: '12031990' } });
    expect(birth.value).toBe('12/03/1990');
    expect(birth.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('CEP · autopreenchimento', () => {
  it('digitação parcial não consulta; 8 dígitos consultam uma vez e preenchem os campos editáveis', async () => {
    cepHandler = () => ({ status: 200, body: { cep: '01310-100', logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' } });
    renderForm();
    const cep = screen.getByLabelText('CEP') as HTMLInputElement;
    fireEvent.change(cep, { target: { value: '0131' } });
    fireEvent.change(cep, { target: { value: '01310' } });
    expect(viaCepCalls()).toBe(0);
    fireEvent.change(cep, { target: { value: '01310100' } });
    await waitFor(() => expect((screen.getByLabelText('LOGRADOURO') as HTMLInputElement).value).toBe('Avenida Paulista'));
    expect((screen.getByLabelText('BAIRRO') as HTMLInputElement).value).toBe('Bela Vista');
    expect((screen.getByLabelText('CIDADE') as HTMLInputElement).value).toBe('São Paulo');
    expect((screen.getByLabelText(/^UF/) as HTMLSelectElement).value).toBe('SP');
    expect(viaCepCalls()).toBe(1);
    // Editável depois do preenchimento.
    fireEvent.change(screen.getByLabelText('LOGRADOURO'), { target: { value: 'Rua Ajustada' } });
    expect((screen.getByLabelText('LOGRADOURO') as HTMLInputElement).value).toBe('Rua Ajustada');
    expect(screen.getByText(/Endereço preenchido pelo CEP/)).toBeTruthy();
  });

  it('CEP inexistente: aviso e campos livres para preenchimento manual', async () => {
    cepHandler = () => ({ status: 200, body: { erro: true } });
    renderForm();
    fireEvent.change(screen.getByLabelText('CEP'), { target: { value: '99999999' } });
    expect(await screen.findByText('CEP não encontrado. Preencha o endereço manualmente.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('LOGRADOURO'), { target: { value: 'Rua Manual' } });
    expect((screen.getByLabelText('LOGRADOURO') as HTMLInputElement).value).toBe('Rua Manual');
  });

  it('serviço indisponível (ViaCEP e reserva falham): aviso e preenchimento manual', async () => {
    cepHandler = () => ({ status: 500, body: {} });
    renderForm();
    fireEvent.change(screen.getByLabelText('CEP'), { target: { value: '20040002' } });
    expect(await screen.findByText(/Não foi possível consultar o CEP agora/)).toBeTruthy();
    expect((screen.getByLabelText('CIDADE') as HTMLInputElement).disabled).toBe(false);
  });

  it('resposta atrasada de um CEP antigo não sobrescreve o endereço do CEP atual', async () => {
    let releaseFirst!: (v: Json) => void;
    cepHandler = (cep) => {
      if (cep === '01310100') return new Promise<Json>((r) => { releaseFirst = r; });
      return { status: 200, body: { logradouro: 'Rua Nova', bairro: 'Centro', localidade: 'Niterói', uf: 'RJ' } };
    };
    renderForm();
    const cep = screen.getByLabelText('CEP');
    fireEvent.change(cep, { target: { value: '01310100' } });
    fireEvent.change(cep, { target: { value: '24020000' } });
    await waitFor(() => expect((screen.getByLabelText('CIDADE') as HTMLInputElement).value).toBe('Niterói'));
    // A resposta antiga chega agora: deve ser ignorada.
    releaseFirst({ status: 200, body: { logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'SP' } });
    await new Promise((r) => setTimeout(r, 20));
    expect((screen.getByLabelText('LOGRADOURO') as HTMLInputElement).value).toBe('Rua Nova');
    expect((screen.getByLabelText('CIDADE') as HTMLInputElement).value).toBe('Niterói');
  });
});
