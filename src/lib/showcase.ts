// ═══════════════════════════════════════════════════════════════
// VITRINE DE PRODUTOS — o módulo "Produtos" não é e-commerce
// ═══════════════════════════════════════════════════════════════
// Produtos existem como VITRINE: foto, nome, descrição, preço, categoria,
// ativo/oculto e destaque. A conversão acontece no WhatsApp do negócio com
// uma mensagem contextualizada ("Tenho interesse no produto X"). Não existe
// carrinho, checkout, pedido, adicionais, sabores, ingredientes ou entrega
// nesta experiência — e nada aqui gera um pedido interno.
//
// A disponibilidade do módulo continua decidida em lib/features.ts
// (isFeatureEnabled / productsVisible). Este arquivo é PURO e só define a
// apresentação/CTA da vitrine, para ser compartilhado e testável.
import { money } from './utils';
import type { BusinessMode } from './types';

export interface ShowcaseProductLike {
  name: string;
  price: number; // centavos
  promoPrice?: number; // centavos; 0/ausente = sem promoção
  active?: boolean;
  featured?: boolean;
}

/** Preço efetivo exibido na vitrine (promoção quando existir e for menor). */
export function showcasePriceCents(p: ShowcaseProductLike): number {
  const promo = Number(p.promoPrice) || 0;
  const base = Number(p.price) || 0;
  return promo > 0 && promo < base ? promo : base;
}

/**
 * Mensagem do CTA "Tenho interesse" — enviada pelo WhatsApp do negócio.
 * Com preço quando ele existe (0/nulo = sem preço; nunca inventamos valor).
 */
export function productInterestMessage(p: Pick<ShowcaseProductLike, 'name' | 'price' | 'promoPrice'>): string {
  const name = String(p.name || '').trim() || 'produto';
  const price = showcasePriceCents({ ...p, active: true });
  return price > 0
    ? `Olá! Tenho interesse no produto ${name} (${money(price)}).`
    : `Olá! Tenho interesse no produto ${name}.`;
}

/** Rótulo da seção na página pública. */
export const SHOWCASE_SECTION_TITLE = 'Vitrine';

/**
 * A vitrine aceita criação de pedido? NUNCA na experiência atual. Existe só
 * como guarda defensiva: módulos legados de pedido seguem lidos do banco,
 * mas nenhuma UI desta nova arquitetura cria pedido por produtos.
 */
export function showcaseAcceptsOrders(_modes: BusinessMode[]): boolean {
  return false;
}
