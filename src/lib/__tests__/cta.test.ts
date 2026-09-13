import { describe, expect, it } from 'vitest';
import { resolveCtaTarget, requestedCtaTarget, defaultCtaTarget } from '../cta';

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

describe('requestedCtaTarget — o que o botão ANUNCIA (sem olhar módulo)', () => {
  it('respeita o alvo explícito do bloco', () => {
    expect(requestedCtaTarget('Fale com a gente', 'booking')).toBe('booking');
    expect(requestedCtaTarget('Agendar atendimento', 'whatsapp')).toBe('whatsapp');
  });
  it('deduz do rótulo quando não há alvo explícito', () => {
    expect(requestedCtaTarget('Agendar atendimento')).toBe('booking');
    expect(requestedCtaTarget('Pedir orçamento')).toBe('quote');
    expect(requestedCtaTarget('Pedir agora')).toBe('products');
    expect(requestedCtaTarget('Fale com a gente')).toBe('whatsapp');
  });
  it('módulo desligado ⇒ destino real difere do anunciado (o rótulo cai para WhatsApp)', () => {
    // Bloco pede agendamento, mas a empresa desligou o módulo de agenda:
    // o destino permitido é o WhatsApp e o texto NÃO pode prometer agenda.
    const anunciado = requestedCtaTarget('Agendar atendimento', 'booking');
    const permitido = resolveCtaTarget(['services'], 'Agendar atendimento', 'booking');
    expect(anunciado).toBe('booking');
    expect(permitido).toBe('whatsapp');
    expect(anunciado).not.toBe(permitido);
  });
  it('módulo ligado ⇒ destino real mantém o rótulo original', () => {
    const anunciado = requestedCtaTarget('Agendar atendimento', 'booking');
    const permitido = resolveCtaTarget(['services', 'bookings'], 'Agendar atendimento', 'booking');
    expect(anunciado).toBe(permitido);
  });
});

describe('defaultCtaTarget', () => {
  it('pedidos vencem na criação; agenda antes de orçamento', () => {
    expect(defaultCtaTarget(['orders', 'bookings'])).toBe('products');
    expect(defaultCtaTarget(['bookings', 'quote'])).toBe('booking');
    expect(defaultCtaTarget(['services'])).toBe('whatsapp');
  });
});
