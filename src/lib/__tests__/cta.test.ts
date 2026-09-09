import { describe, expect, it } from 'vitest';
import { resolveCtaTarget, defaultCtaTarget } from '../cta';

describe('resolveCtaTarget — agendar nunca abre produtos', () => {
  it('"Agendar atendimento" com loja+agenda → booking', () => {
    expect(resolveCtaTarget(['orders', 'bookings'], 'Agendar atendimento')).toBe('booking');
    expect(resolveCtaTarget(['products', 'bookings'], 'Agendar horário')).toBe('booking');
  });
  it('explícito vence (quando o modo existe)', () => {
    expect(resolveCtaTarget(['orders', 'bookings'], 'Agendar', 'products')).toBe('products');
    expect(resolveCtaTarget(['orders'], 'Pedir', 'booking')).toBe('products'); // modo ausente → ignora
  });
  it('orçamento e loja pelo texto', () => {
    expect(resolveCtaTarget(['quote', 'bookings'], 'Pedir orçamento')).toBe('quote');
    expect(resolveCtaTarget(['orders', 'bookings'], 'Pedir agora')).toBe('products');
  });
  it('fallback: booking antes de produtos', () => {
    expect(resolveCtaTarget(['orders', 'bookings'], 'Começar')).toBe('booking');
    expect(resolveCtaTarget(['orders'], 'Começar')).toBe('products');
    expect(resolveCtaTarget([], 'Oi')).toBe('whatsapp');
  });
});

describe('defaultCtaTarget', () => {
  it('pedidos vencem na criação; agenda antes de orçamento', () => {
    expect(defaultCtaTarget(['orders', 'bookings'])).toBe('products');
    expect(defaultCtaTarget(['bookings', 'quote'])).toBe('booking');
    expect(defaultCtaTarget(['services'])).toBe('whatsapp');
  });
});
