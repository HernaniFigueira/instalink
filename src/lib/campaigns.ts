// ═══════════════════════════════════════════════════════════════
// CAMPANHAS — segmentação com CONSENTIMENTO como porta de entrada
// ═══════════════════════════════════════════════════════════════
// Regra absoluta: campanha de marketing só alcança contato com
// `marketingOptIn === true` EXPLÍCITO. Cadastro, agendamento, lead ou compra
// NUNCA viram consentimento — o campo só muda por ação explícita do cliente
// (ou registro manual do negócio com origem declarada).
//
// Este módulo é puro: recebe contatos + interações e devolve público
// elegível, contagens e prévia. O disparo real depende da integração oficial
// do WhatsApp (não simulada aqui).
import type {
  Booking, BusinessCustomer, CampaignSegment, Lead, Order,
} from './types';
import { phoneKey } from './whatsapp';

export interface AudienceContext {
  contacts: BusinessCustomer[];
  bookings: Booking[];
  orders: Order[];
  leads: Lead[];
  todayISO: string;
}

export interface AudienceMember {
  contactId: string;
  customerId: string;
  name: string;
  phone: string;
  email: string;
  booked: boolean;
  lastInteraction: string;
}

/** Somente consentimento explícito — nenhuma exceção. */
export function hasMarketingConsent(c: Pick<BusinessCustomer, 'marketingOptIn'>): boolean {
  return c.marketingOptIn === true;
}

function daysBetween(isoA: string, isoB: string): number {
  const a = Date.parse(`${(isoA || '').slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${(isoB || '').slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * Filtra o público de uma campanha. O primeiro filtro é SEMPRE o
 * consentimento; segmentos apenas refinam quem já consentiu.
 */
export function audienceFor(
  segment: CampaignSegment,
  segmentRef: string,
  ctx: AudienceContext,
): AudienceMember[] {
  const consented = ctx.contacts.filter(hasMarketingConsent);
  const bookingsByContact = new Map<string, Booking[]>();
  const push = (key: string, b: Booking) => {
    if (!key) return;
    const list = bookingsByContact.get(key) || [];
    list.push(b);
    bookingsByContact.set(key, list);
  };
  for (const b of ctx.bookings) {
    if (b.customerId) push(`c:${b.customerId}`, b);
    const p = phoneKey(b.customerPhone);
    if (p) push(`p:${p}`, b);
  }
  const leadsByContact = new Map<string, Lead[]>();
  for (const l of ctx.leads) {
    const key = l.customerId ? `c:${l.customerId}` : (phoneKey(l.phone) ? `p:${phoneKey(l.phone)}` : '');
    if (!key) continue;
    leadsByContact.set(key, [...(leadsByContact.get(key) || []), l]);
  }

  const members: AudienceMember[] = consented.map((c) => {
    const keys = [c.customerId ? `c:${c.customerId}` : '', c.phone ? `p:${phoneKey(c.phone)}` : ''].filter(Boolean);
    const booked = keys.some((k) => (bookingsByContact.get(k) || []).length > 0);
    const lastBooking = keys
      .flatMap((k) => bookingsByContact.get(k) || [])
      .reduce<string>((acc, b) => (b.date > acc ? b.date : acc), '');
    return {
      contactId: c.id,
      customerId: c.customerId,
      name: c.name,
      phone: c.phone,
      email: c.email,
      booked,
      lastInteraction: [c.lastInteraction, lastBooking].filter(Boolean).sort().pop() || c.lastInteraction,
      _keys: keys, // interno (removido abaixo)
    } as AudienceMember & { _keys: string[] };
  });

  const match = (m: AudienceMember & { _keys?: string[] }): boolean => {
    const keys = m._keys || [];
    switch (segment) {
      case 'new':
        return daysBetween(m.lastInteraction, ctx.todayISO) <= 30;
      case 'old':
        return daysBetween(m.lastInteraction, ctx.todayISO) >= 180;
      case 'booked':
        return m.booked === true;
      case 'never_booked':
        return m.booked !== true;
      case 'inactive':
        return daysBetween(m.lastInteraction, ctx.todayISO) >= 90;
      case 'by_service':
        return ctx.bookings.some(
          (b) =>
            (!segmentRef || b.serviceId === segmentRef) &&
            keys.includes(b.customerId ? `c:${b.customerId}` : `p:${phoneKey(b.customerPhone)}`),
        );
      case 'leads':
        return keys.some((k) => (leadsByContact.get(k) || []).length > 0);
      case 'all_optin':
      default:
        return true;
    }
  };

  return members
    .filter(match)
    .map(({ ...m }) => {
      const clean = { ...(m as any) };
      delete clean._keys;
      return clean as AudienceMember;
    })
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

/** Contagem de elegíveis (o número que o lojista vê antes de enviar). */
export function audienceCount(
  segment: CampaignSegment,
  segmentRef: string,
  ctx: AudienceContext,
): number {
  return audienceFor(segment, segmentRef, ctx).length;
}
