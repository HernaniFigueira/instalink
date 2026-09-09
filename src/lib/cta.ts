// Destino do botão de ação principal (CTA) da página pública.
// REGRA DE OURO: agendar abre agendamento — nunca produtos.
// O destino é explícito (settings.target do bloco); a inferência abaixo
// existe só para páginas antigas criadas sem target.
import type { BusinessMode } from './types';

export type CtaTarget = 'products' | 'booking' | 'quote' | 'whatsapp';

export function resolveCtaTarget(
  modes: BusinessMode[],
  label: string,
  explicit?: string,
): CtaTarget {
  const hasProducts = modes.includes('orders') || modes.includes('products');
  const hasBooking = modes.includes('bookings');
  const hasQuote = modes.includes('quote');

  if (explicit === 'products' && hasProducts) return 'products';
  if (explicit === 'booking' && hasBooking) return 'booking';
  if (explicit === 'quote' && hasQuote) return 'quote';
  if (explicit === 'whatsapp') return 'whatsapp';

  const text = label || '';
  if (/agend|reserv|hor[aá]rio|marc/i.test(text) && hasBooking) return 'booking';
  if (/or[çc]amento/i.test(text) && hasQuote) return 'quote';
  if (/pedir|card[aá]pio|\bloja\b|ver produtos|comprar|delivery/i.test(text) && hasProducts) return 'products';

  // Fallback: booking primeiro (negócio com agenda + loja e rótulo
  // genérico ainda abre a agenda — produtos têm área própria).
  if (hasBooking) return 'booking';
  if (hasProducts) return 'products';
  if (hasQuote) return 'quote';
  return 'whatsapp';
}

// Destino padrão na criação da página (espelha a prioridade do rótulo).
export function defaultCtaTarget(modes: BusinessMode[]): CtaTarget {
  if (modes.includes('orders')) return 'products';
  if (modes.includes('bookings')) return 'booking';
  if (modes.includes('quote')) return 'quote';
  if (modes.includes('products')) return 'products';
  return 'whatsapp';
}
