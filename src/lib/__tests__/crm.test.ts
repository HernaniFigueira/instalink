import { describe, expect, it, vi } from 'vitest';
import { contactKey, findContact, upsertContact, backfillContacts } from '../contacts';
import { integrationStatus, isConnected, defaultWhatsappIntegration, phoneKey } from '../whatsapp';
import type { Business, BusinessCustomer, DB } from '../types';

function emptyDB(partial: Partial<DB> = {}): DB {
  return {
    users: [], sessions: [], customers: [], customerSessions: [], passwordResets: [],
    businesses: [], pages: [], categories: [], products: [], options: [], optionValues: [],
    services: [], professionals: [], availability: [], exceptions: [], orders: [], bookings: [],
    leads: [], contacts: [], reviews: [], events: [],
    ...partial,
  } as unknown as DB;
}

function contact(partial: Partial<BusinessCustomer> = {}): BusinessCustomer {
  return {
    id: 'c1', businessId: 'b1', customerId: '', name: 'Ana', phone: '11999990000', email: '',
    source: 'manual', createdAt: '2026-01-01T00:00:00.000Z', lastInteraction: '2026-01-01T00:00:00.000Z',
    marketingOptIn: false, note: '', ...partial,
  } as BusinessCustomer;
}

const biz = (partial: Partial<Business> = {}): Business => ({ id: 'b1', whatsappIntegration: undefined, ...partial } as Business);

describe('CRM — um cadastro por pessoa (sem duplicar)', () => {
  it('chave do contato prioriza o cliente logado e cai no telefone', () => {
    expect(contactKey('u1', '11999990000')).toBe('c:u1');
    expect(contactKey('', '(11) 99999-0000')).toBe('p:11999990000');
    expect(contactKey('', '')).toBe('');
  });

  it('encontra o contato por customerId OU por telefone (mesmo escrito diferente)', () => {
    const db = emptyDB({ contacts: [contact({ id: 'c1', phone: '11999990000' })] });
    expect(findContact(db, 'b1', '', '11999990000')?.id).toBe('c1');
    expect(findContact(db, 'b1', '', '(11) 99999-0000')?.id).toBe('c1');
    expect(findContact(db, 'b1', 'u9', '')?.id).toBeUndefined();
    expect(findContact(db, 'b1', '', '11888887777')).toBeUndefined();
  });

  it('upsert duas vezes NÃO duplica — atualiza o mesmo registro', () => {
    const db = emptyDB();
    const a = upsertContact(db, { businessId: 'b1', name: 'Ana', phone: '(11) 99999-0000', source: 'agendamento' });
    const b = upsertContact(db, { businessId: 'b1', name: 'Ana Paula', phone: '11999990000', email: 'ana@x.com', source: 'pedido' });
    expect(db.contacts).toHaveLength(1);
    expect(b!.id).toBe(a!.id);
    expect(b!.name).toBe('Ana Paula');
    expect(b!.email).toBe('ana@x.com');
  });

  it('cliente logado vincula o contato do telefone e enriquece o cadastro', () => {
    const db = emptyDB({ contacts: [contact({ id: 'c1', customerId: '', phone: '11999990000', name: 'Ana' })] });
    const c = upsertContact(db, { businessId: 'b1', name: 'Ana', phone: '11999990000', customerId: 'u9', source: 'cadastro' });
    expect(db.contacts).toHaveLength(1);
    expect(c!.customerId).toBe('u9');
  });

  it('consentimento só liga com true explícito (nunca inferido por outra fonte)', () => {
    const db = emptyDB();
    upsertContact(db, { businessId: 'b1', name: 'Ana', phone: '11999990000', source: 'agendamento' });
    expect(db.contacts[0].marketingOptIn).toBe(false);
    upsertContact(db, { businessId: 'b1', name: 'Ana', phone: '11999990000', source: 'manual' });
    expect(db.contacts[0].marketingOptIn).toBe(false);
    upsertContact(db, { businessId: 'b1', name: 'Ana', phone: '11999990000', source: 'manual', marketingOptIn: true });
    expect(db.contacts[0].marketingOptIn).toBe(true);
  });

  it('backfill cria contato a partir do histórico legado sem apagar nada', () => {
    const db = emptyDB({
      businesses: [{ id: 'b1', name: 'Clínica', slug: 'clinica' } as any],
      orders: [{ id: 'o1', businessId: 'b1', customerId: 'u1', customerName: 'Bia', customerPhone: '11888887777', createdAt: '2026-02-01T10:00:00.000Z', total: 0 } as any],
      bookings: [{ id: 'bk1', businessId: 'b1', customerId: 'u1', customerName: 'Bia', customerPhone: '11888887777', createdAt: '2026-05-01T10:00:00.000Z' } as any],
    });
    backfillContacts(db);
    expect(db.contacts).toHaveLength(1); // pedido + agendamento da MESMA pessoa
    const c = findContact(db, 'b1', 'u1', '11888887777');
    expect(c?.source).toBe('pedido'); // origem mais antiga preservada
    expect(c?.lastInteraction).toBe('2026-05-01T10:00:00.000Z');
  });
});

describe('WhatsApp — status honesto', () => {
  it('sem configuração salva o estado é "não conectado"', () => {
    expect(integrationStatus(biz()).status).toBe('not_connected');
    expect(isConnected(biz())).toBe(false);
    expect(defaultWhatsappIntegration().status).toBe('not_connected');
  });

  it('empresa diz conectado MAS servidor sem credenciais → volta para pendente (não mente)', () => {
    const b = biz({ whatsappIntegration: { ...defaultWhatsappIntegration(), status: 'connected', displayPhone: '+55 11 99999-9999' } });
    expect(integrationStatus(b, false).status).toBe('pending');
    expect(integrationStatus(b, true).status).toBe('connected');
    expect(isConnected(b, false)).toBe(false);
  });

  it('normaliza telefone para chave comparável', () => {
    expect(phoneKey('(11) 99999-0000')).toBe('11999990000');
    expect(phoneKey('+55 11 99999-0000')).toBe('11999990000');
  });
});
