// ═══════════════════════════════════════════════════════════════
// REGRESSÃO · RETORNO AO AGENDAMENTO (Missão 02)
//   • rascunho válido só volta para a MESMA unidade e na versão certa;
//   • a URL do cadastro e do retorno nunca carrega dados pessoais;
//   • salvar o cliente injeta tutor/pet reais no rascunho (sem perder o resto).
// ═══════════════════════════════════════════════════════════════
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  continueBookingHref,
  newClientFromBookingHref,
  newClientFromListHref,
  parseBookingReturn,
  readBookingReturn,
  readClientsListQuery,
  rememberClientsListQuery,
  withRegisteredClient,
  writeBookingReturn,
  clearBookingReturn,
  type BookingReturnDraft,
} from '@/lib/booking-return';

const base = {
  v: 1 as const,
  businessId: 'biz-1',
  savedAt: 1_700_000_000_000,
  contactId: '',
  name: '',
  phone: '',
  query: 'Tereza Alves',
  petId: '',
  serviceId: 'svc-1',
  professionalId: 'pro-1',
  date: '2026-10-20',
  time: '10:00',
  durationMin: 60 as number | '',
  note: 'retorno',
  vetMode: true,
};

describe('parseBookingReturn', () => {
  it('aceita rascunho válido da mesma unidade', () => {
    const d = parseBookingReturn(JSON.stringify(base), 'biz-1');
    expect(d).not.toBeNull();
    expect(d?.query).toBe('Tereza Alves');
  });

  it('rejeita rascunho de outra unidade (não vaza entre unidades)', () => {
    expect(parseBookingReturn(JSON.stringify(base), 'biz-OUTRA')).toBeNull();
  });

  it('rejeita versão desconhecida, JSON inválido e tipos errados', () => {
    expect(parseBookingReturn(JSON.stringify({ ...base, v: 2 }), 'biz-1')).toBeNull();
    expect(parseBookingReturn('{nao-json', 'biz-1')).toBeNull();
    expect(parseBookingReturn(JSON.stringify({ ...base, time: 1000 }), 'biz-1')).toBeNull();
    expect(parseBookingReturn(JSON.stringify({ ...base, vetMode: 'sim' }), 'biz-1')).toBeNull();
    expect(parseBookingReturn(JSON.stringify({ ...base, durationMin: 'x' }), 'biz-1')).toBeNull();
    expect(parseBookingReturn(null, 'biz-1')).toBeNull();
    expect(parseBookingReturn('', 'biz-1')).toBeNull();
  });
});

describe('withRegisteredClient', () => {
  const draft = parseBookingReturn(JSON.stringify(base), 'biz-1') as BookingReturnDraft;

  it('injeta tutor e pet recém-criados e preserva serviço, data, horário e observação', () => {
    const next = withRegisteredClient(draft, { contactId: 'c-1', petId: 'p-1', name: 'Bernardo', phone: '21912345678' });
    expect(next.contactId).toBe('c-1');
    expect(next.petId).toBe('p-1');
    expect(next.name).toBe('Bernardo');
    expect(next.phone).toBe('21912345678');
    expect(next.query).toBe('');
    expect(next.serviceId).toBe('svc-1');
    expect(next.professionalId).toBe('pro-1');
    expect(next.date).toBe('2026-10-20');
    expect(next.time).toBe('10:00');
    expect(next.durationMin).toBe(60);
    expect(next.note).toBe('retorno');
  });

  it('sem pet, zera o pet anterior (não reaproveita pet de outro tutor)', () => {
    const withPet = { ...draft, petId: 'p-antigo' };
    const next = withRegisteredClient(withPet, { contactId: 'c-2' });
    expect(next.petId).toBe('');
  });
});

describe('URLs de ida e volta: sem dados pessoais', () => {
  it('cadastro e retorno carregam apenas a unidade e a origem', () => {
    const urls = [
      newClientFromBookingHref('biz-1'),
      newClientFromListHref('biz-1'),
      continueBookingHref('biz-1'),
    ];
    for (const url of urls) {
      expect(url).toMatch(/^\/(clientes\/novo|agenda)\?/);
      expect(url).toContain('b=biz-1');
      expect(url).not.toMatch(/Tereza|Alves|21912|@|cpf|phone|name|q=/i);
    }
    expect(newClientFromBookingHref('biz-1')).toContain('from=agenda');
    expect(newClientFromListHref('biz-1')).toContain('from=clientes');
    expect(continueBookingHref('biz-1')).toContain('retomar=agendamento');
  });
});

describe('armazenamento de sessão (por unidade)', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as any).window = {
      sessionStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
      },
    };
  });
  afterEach(() => {
    delete (globalThis as any).window;
  });

  it('grava, lê e limpa o rascunho da unidade; outra unidade não vê', () => {
    const written = writeBookingReturn({ ...base, contactId: '', name: '', phone: '' });
    expect(written?.savedAt).toBeTypeOf('number');
    expect(readBookingReturn('biz-1')?.query).toBe('Tereza Alves');
    expect(readBookingReturn('biz-2')).toBeNull();
    clearBookingReturn('biz-1');
    expect(readBookingReturn('biz-1')).toBeNull();
  });

  it('a busca da lista de Clientes volta exatamente como estava', () => {
    rememberClientsListQuery('biz-1', 'q=Tereza&page=2');
    expect(readClientsListQuery('biz-1')).toBe('q=Tereza&page=2');
    expect(readClientsListQuery('biz-2')).toBe('');
  });

  it('sem window (SSR) não lança e não devolve dados', () => {
    delete (globalThis as any).window;
    expect(readBookingReturn('biz-1')).toBeNull();
    expect(writeBookingReturn({ ...base, contactId: '', name: '', phone: '' })).toBeNull();
    expect(readClientsListQuery('biz-1')).toBe('');
  });
});
