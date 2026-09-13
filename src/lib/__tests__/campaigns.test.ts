import { describe, expect, it } from 'vitest';
import { audienceCount, audienceFor, hasMarketingConsent } from '../campaigns';
import type { AudienceContext } from '../campaigns';
import type { Booking, BusinessCustomer, Lead } from '../types';

function contact(partial: Partial<BusinessCustomer> = {}): BusinessCustomer {
  return {
    id: 'c1', businessId: 'b1', customerId: '', name: 'Ana', phone: '11999990000', email: '',
    source: 'page', createdAt: '2026-01-10T10:00:00.000Z', lastInteraction: '2026-09-01T10:00:00.000Z',
    marketingOptIn: false, note: '', ...partial,
  } as BusinessCustomer;
}

function booking(partial: Partial<Booking> = {}): Booking {
  return {
    id: 'bk1', businessId: 'b1', customerId: '', customerName: 'Ana', customerPhone: '11999990000',
    customerEmail: '', serviceId: 's1', professionalId: '', date: '2026-08-01', time: '10:00',
    status: 'completed', answers: [], note: '', history: [], createdAt: '', ...partial,
  } as Booking;
}

function lead(partial: Partial<Lead> = {}): Lead {
  return {
    id: 'l1', businessId: 'b1', customerId: '', name: 'Ana', phone: '11999990000', email: '',
    origin: 'quote', status: 'new', interest: 'Clareamento', action: '', createdAt: '2026-08-20T10:00:00.000Z', ...partial,
  } as Lead;
}

function ctx(partial: Partial<AudienceContext> = {}): AudienceContext {
  return { contacts: [], bookings: [], orders: [], leads: [], todayISO: '2026-09-13', ...partial };
}

// A REGRA CENTRAL: marketing só alcança quem autorizou explicitamente.
describe('campanhas — consentimento é a porta de entrada', () => {
  it('só marketingOptIn === true conta como consentimento', () => {
    expect(hasMarketingConsent({ marketingOptIn: true })).toBe(true);
    expect(hasMarketingConsent({ marketingOptIn: false })).toBe(false);
    expect(hasMarketingConsent({} as any)).toBe(false); // ausente = não autorizou

    expect(hasMarketingConsent({ marketingOptIn: 'true' } as any)).toBe(false); // string não vale
  });

  it('cliente cadastrado SEM consentimento fica fora de qualquer segmento', () => {
    const c = ctx({ contacts: [contact({ id: 'a', customerId: 'u1', marketingOptIn: false })] });
    expect(audienceFor('all_optin', '', c)).toEqual([]);
    expect(audienceFor('booked', '', c)).toEqual([]);
    expect(audienceCount('leads', '', { ...c, leads: [lead({ customerId: 'u1' })] })).toBe(0);
  });

  it('quem consentiu entra; compra/agendamento NÃO viram consentimento', () => {
    const c = ctx({
      contacts: [
        contact({ id: 'a', customerId: 'u1', marketingOptIn: true }),
        contact({ id: 'b', customerId: 'u2', marketingOptIn: false }),
      ],
      bookings: [booking({ customerId: 'u2', customerPhone: '11999990000' })],
    });
    const all = audienceFor('all_optin', '', c);
    expect(all.map((m) => m.contactId)).toEqual(['a']);
  });

  it('segmentos refinaram apenas quem consentiu', () => {
    const c = ctx({
      contacts: [
        contact({ id: 'novo', customerId: 'u1', name: 'Ana', phone: '11911110000', marketingOptIn: true, lastInteraction: '2026-09-10T10:00:00.000Z' }),
        contact({ id: 'antigo', customerId: 'u2', name: 'Bia', phone: '11922220000', marketingOptIn: true, lastInteraction: '2026-01-01T10:00:00.000Z' }),
        contact({ id: 'fiel', customerId: 'u3', name: 'Caio', phone: '11933330000', marketingOptIn: true, lastInteraction: '2026-06-01T10:00:00.000Z' }),
      ],
      bookings: [booking({ customerId: 'u3', customerPhone: '11933330000', date: '2026-08-15' })],
      leads: [lead({ customerId: 'u1', phone: '11911110000' })],
    });
    expect(audienceFor('new', '', c).map((m) => m.contactId)).toEqual(['novo', 'fiel']); // 'fiel' interagiu faz 29 dias
    expect(audienceFor('old', '', c).map((m) => m.contactId)).toEqual(['antigo']);
    expect(audienceFor('booked', '', c).map((m) => m.contactId)).toEqual(['fiel']);
    expect(audienceFor('never_booked', '', c).map((m) => m.contactId).sort()).toEqual(['antigo', 'novo']);
    expect(audienceFor('inactive', '', c).map((m) => m.contactId)).toEqual(['antigo']);
    expect(audienceFor('leads', '', c).map((m) => m.contactId)).toEqual(['novo']);
  });

  it('segmento por serviço usa o histórico real de agendamento', () => {
    const c = ctx({
      contacts: [contact({ id: 'a', customerId: 'u1', marketingOptIn: true })],
      bookings: [booking({ customerId: 'u1', serviceId: 'corte' })],
    });
    expect(audienceCount('by_service', 'corte', c)).toBe(1);
    expect(audienceCount('by_service', 'outro', c)).toBe(0);
  });

  it('telefone é o elo quando o contato não tem conta (lead/agendamento legado)', () => {
    const c = ctx({
      contacts: [contact({ id: 'a', customerId: '', phone: '(11) 99999-0000', marketingOptIn: true })],
      bookings: [booking({ customerId: '', customerPhone: '11999990000' })],
    });
    expect(audienceCount('booked', '', c)).toBe(1);
  });
});
