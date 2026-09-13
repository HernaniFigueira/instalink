import { describe, expect, it } from 'vitest';
import { backfillContacts, contactKey, upsertContact } from '../contacts';
import { emptyDB } from '../db';
import type { DB } from '../types';

function seededDB(): DB {
  const db = emptyDB();
  db.businesses.push({
    id: 'biz-1', ownerId: 'u1', name: 'Clínica Aurora', slug: 'clinica', description: '',
    logo: '', cover: '', niche: 'saude', modes: ['services', 'bookings'], phone: '', whatsapp: '', email: '',
    instagram: '', tiktok: '', address: '', mapsUrl: '', hours: {}, paymentMethods: [],
    pixKey: '', deliveryFee: 0, minOrder: 0, googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'auto', leadMin: 60, cancelUntilMin: 180, horizonDays: 30, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
  });
  return db;
}

describe('contactKey', () => {
  it('conta tem prioridade sobre telefone', () => {
    expect(contactKey('c1', '11999998888')).toBe('c:c1');
  });
  it('sem conta cai para telefone normalizado', () => {
    expect(contactKey('', '(11) 99999-8888')).toBe('p:11999998888');
  });
});

describe('upsertContact', () => {
  it('não duplica por customerId', () => {
    const db = seededDB();
    upsertContact(db, { businessId: 'biz-1', customerId: 'c1', name: 'Marlene', phone: '11999998888', source: 'signup' });
    upsertContact(db, { businessId: 'biz-1', customerId: 'c1', name: 'Marlene S.', phone: '11999998888', source: 'login' });
    expect(db.contacts.filter((c) => c.businessId === 'biz-1').length).toBe(1);
    const c = db.contacts[0];
    expect(c.name).toBe('Marlene S.');
    expect(c.source).toBe('signup'); // fonte original preservada
  });

  it('promove contato guest (telefone) para conta quando customerId aparece', () => {
    const db = seededDB();
    upsertContact(db, { businessId: 'biz-1', name: 'Marlene', phone: '11999998888', source: 'pedido' });
    expect(db.contacts[0].customerId).toBe('');
    upsertContact(db, { businessId: 'biz-1', customerId: 'c1', name: 'Marlene', phone: '11999998888', source: 'signup' });
    expect(db.contacts.length).toBe(1);
    expect(db.contacts[0].customerId).toBe('c1');
  });

  it('mesmo Customer em outro negócio vira outro CONTATO (conta global, relação contextual)', () => {
    const db = seededDB();
    db.businesses.push({ ...db.businesses[0], id: 'biz-2', slug: 'barbearia' });
    upsertContact(db, { businessId: 'biz-1', customerId: 'c1', name: 'Marlene', phone: '11999998888' });
    upsertContact(db, { businessId: 'biz-2', customerId: 'c1', name: 'Marlene', phone: '11999998888' });
    expect(db.contacts.length).toBe(2);
    expect(db.customers.length).toBe(0); // nenhum Customer duplicado
  });

  it('marketingOptIn nunca é presumido', () => {
    const db = seededDB();
    upsertContact(db, { businessId: 'biz-1', customerId: 'c1', name: 'Marlene', phone: '11999998888' });
    expect(db.contacts[0].marketingOptIn).toBe(false);
  });
});

describe('backfillContacts (migração defensiva)', () => {
  it('cria contatos de pedidos/agendamentos/leads sem duplicar por telefone', () => {
    const db = seededDB();
    db.bookings.push({
      id: 'b1', businessId: 'biz-1', customerId: 'c1', serviceId: 's1', professionalId: 'p1',
      date: '2026-09-10', time: '09:00', customerName: 'Marlene Silva', customerPhone: '11999998888',
      status: 'confirmed', note: '', answers: [], createdAt: '2026-09-02T10:00:00.000Z',
      updatedAt: '2026-09-02T10:00:00.000Z', history: [],
    });
    db.leads.push({
      id: 'l1', businessId: 'biz-1', customerId: '', name: 'Marlene Silva', phone: '11999998888',
      email: '', instagram: '', origin: 'agendamento', interest: 'Consulta', action: 'agendamento',
      status: 'converted', createdAt: '2026-09-03T10:00:00.000Z', lastInteraction: '2026-09-03T10:00:00.000Z',
    });
    backfillContacts(db);
    const biz = db.contacts.filter((c) => c.businessId === 'biz-1');
    expect(biz.length).toBe(1);
    expect(biz[0].customerId).toBe('c1');
    expect(biz[0].phone).toBe('11999998888');
  });

  it('é idempotente', () => {
    const db = seededDB();
    db.orders.push({
      id: 'o1', businessId: 'biz-1', customerId: '', code: '#1', customerName: 'João', customerPhone: '11911112222',
      customerAddress: '', type: 'pickup', payment: 'pix', items: [], subtotal: 0, total: 0,
      status: 'completed', note: '', createdAt: '2026-09-02T10:00:00.000Z', updatedAt: '', history: [],
    });
    backfillContacts(db);
    const n = db.contacts.length;
    backfillContacts(db);
    expect(db.contacts.length).toBe(n);
  });
});
