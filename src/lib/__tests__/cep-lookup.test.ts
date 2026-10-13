// Consulta de CEP: ViaCEP → BrasilAPI (reserva) → indisponível. Sem rede real: fetch injetado.
import { describe, expect, it, vi } from 'vitest';
import { lookupCep, type FetchLike } from '@/lib/cep-lookup';

type Step = { status: number; body?: unknown } | 'network' | 'hang';

function fakeFetch(routes: Record<string, Step>) {
  const calls: string[] = [];
  const fn: FetchLike = vi.fn(async (url, init) => {
    calls.push(url);
    const step = Object.entries(routes).find(([k]) => url.startsWith(k))?.[1];
    if (!step) throw new Error('rota não mockada: ' + url);
    if (step === 'network') throw new TypeError('Failed to fetch');
    if (step === 'hang') {
        // Como o fetch real: sinal já abortado rejeita na hora; senão rejeita no abort.
      return new Promise<never>((_, reject) => {
        const sig = init?.signal;
        const fail = () => reject(sig?.reason ?? new DOMException('aborted', 'AbortError'));
        if (sig?.aborted) return fail();
        sig?.addEventListener('abort', fail);
      });
    }
    return { ok: step.status >= 200 && step.status < 300, status: step.status, json: async () => step.body ?? {} };
  });
  return { fn, calls };
}

const VIA_OK = { cep: '01310-100', logradouro: 'Avenida Paulista', bairro: 'Bela Vista', localidade: 'São Paulo', uf: 'sp' };

describe('lookupCep', () => {
  it('ViaCEP encontrado: preenche logradouro, bairro, cidade e UF (UF em maiúsculas)', async () => {
    const { fn, calls } = fakeFetch({ 'https://viacep.com.br/': { status: 200, body: VIA_OK } });
    const r = await lookupCep('01310-100', { fetch: fn });
    expect(r).toEqual({ status: 'found', provider: 'viacep', address: { street: 'Avenida Paulista', district: 'Bela Vista', city: 'São Paulo', state: 'SP' } });
    expect(calls).toHaveLength(1);
  });

  it('ViaCEP com erro:true é "não encontrado" e NÃO consulta a reserva', async () => {
    const { fn, calls } = fakeFetch({ 'https://viacep.com.br/': { status: 200, body: { erro: true } } });
    expect(await lookupCep('99999999', { fetch: fn })).toEqual({ status: 'notfound' });
    expect(calls.some((u) => u.includes('brasilapi'))).toBe(false);
  });

  it('ViaCEP 5xx cai na BrasilAPI e devolve o endereço dela', async () => {
    const { fn, calls } = fakeFetch({
      'https://viacep.com.br/': { status: 503 },
      'https://brasilapi.com.br/': { status: 200, body: { street: 'Rua X', neighborhood: 'Centro', city: 'Niterói', state: 'RJ' } },
    });
    const r = await lookupCep('24020000', { fetch: fn });
    expect(r).toEqual({ status: 'found', provider: 'brasilapi', address: { street: 'Rua X', district: 'Centro', city: 'Niterói', state: 'RJ' } });
    expect(calls).toHaveLength(2);
  });

  it('falha de rede no ViaCEP e 404 na BrasilAPI = não encontrado', async () => {
    const { fn } = fakeFetch({ 'https://viacep.com.br/': 'network', 'https://brasilapi.com.br/': { status: 404 } });
    expect(await lookupCep('00000000', { fetch: fn })).toEqual({ status: 'notfound' });
  });

  it('os dois provedores indisponíveis = indisponível (sem exceção)', async () => {
    const { fn } = fakeFetch({ 'https://viacep.com.br/': 'network', 'https://brasilapi.com.br/': { status: 500 } });
    expect(await lookupCep('20040002', { fetch: fn })).toEqual({ status: 'unavailable' });
  });

  it('provedor que não responde dentro do prazo vira indisponível', async () => {
    const { fn } = fakeFetch({ 'https://viacep.com.br/': 'hang', 'https://brasilapi.com.br/': 'hang' });
    expect(await lookupCep('20040002', { fetch: fn, timeoutMs: 20 })).toEqual({ status: 'unavailable' });
  });

  it('cancelamento do formulário propaga o abort (não é falha do provedor)', async () => {
    const ctl = new AbortController();
    const { fn } = fakeFetch({ 'https://viacep.com.br/': 'hang' });
    const p = lookupCep('20040002', { fetch: fn, signal: ctl.signal, timeoutMs: 5000 });
    ctl.abort();
    await expect(p).rejects.toBeTruthy();
  });

  it('CEP com menos de 8 dígitos não gera chamada nenhuma', async () => {
    const { fn, calls } = fakeFetch({});
    expect(await lookupCep('0131', { fetch: fn })).toEqual({ status: 'notfound' });
    expect(calls).toHaveLength(0);
  });
});
