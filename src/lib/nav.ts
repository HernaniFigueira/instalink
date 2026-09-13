// Catálogo de itens de navegação da página pública (menu configurável).
// Ordem canônica fixa na v1 (futuramente pode ganhar reordenação no painel).
// Cada item tem um destino resolvido no momento do clique (seções/links reais).
//
// REGRA: a DISPONIBILIDADE de um item vem do MÓDULO da empresa
// (lib/features.ts) — configuração de página só escolhe apresentação/ordem.
import { canBook, isFeatureEnabled, servicesVisible, whatsappVisible } from './features';
import type { Block, Business, PublicBusiness, Review } from './types';

export interface NavItemDef {
  id: string;
  label: string;
}

export const NAV_ORDER: NavItemDef[] = [
  { id: 'about', label: 'Sobre a empresa' },
  { id: 'services', label: 'Serviços' },
  { id: 'reviews', label: 'Avaliações' },
  { id: 'faq', label: 'Dúvidas frequentes' },
  { id: 'directions', label: 'Como chegar' },
  { id: 'contact', label: 'Contato' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
];

export const VALID_NAV = NAV_ORDER.map((n) => n.id);

export function navLabel(id: string): string {
  return NAV_ORDER.find((n) => n.id === id)?.label || id;
}

export interface AboutSection {
  title: string;
  text: string;
  image: string;
  enabled: boolean;
}

export function defaultAbout(): AboutSection {
  return { title: '', text: '', image: '', enabled: false };
}

/** A seção "Sobre" só aparece quando ativa E tem conteúdo real. */
export function aboutVisible(about?: Partial<AboutSection> | null): boolean {
  if (!about || !about.enabled) return false;
  return !!(String(about.title || '').trim() || String(about.text || '').trim() || String(about.image || '').trim());
}

// ── Disponibilidade dos itens (módulo manda) ─────────────────
export interface NavAvailabilityInput {
  business: Pick<Business, 'modes' | 'features' | 'nav' | 'navCustom' | 'about' | 'mapsUrl' | 'instagram' | 'tiktok' | 'whatsapp'>;
  blocks: Block[];
  services: Array<{ bookable?: boolean; active?: boolean }>;
  products: Array<{ active?: boolean }>;
  reviews: Pick<Review, 'id'>[];
  hasFaq: boolean;
  hasTestimonialItems: boolean;
}

/**
 * Quais itens de menu a página OFERECE agora. Um módulo desativado remove o
 * item — o menu nunca aponta para recurso desligado.
 */
export function availableNavIds(input: NavAvailabilityInput): string[] {
  const { business, blocks } = input;
  const has = (type: Block['type']) => blocks.some((b) => b.type === type && b.enabled !== false);
  const out: string[] = [];

  if (isFeatureEnabled(business, 'about') && aboutVisible(business.about)) out.push('about');
  if (servicesVisible(business, input.services) && has('services')) out.push('services');
  if (isFeatureEnabled(business, 'reviews') && (input.reviews.length > 0 || input.hasTestimonialItems)) out.push('reviews');
  if (isFeatureEnabled(business, 'faq') && has('faq') && input.hasFaq) out.push('faq');
  if (isFeatureEnabled(business, 'location') && business.mapsUrl) out.push('directions', 'contact');
  if (business.instagram) out.push('instagram');
  if (business.tiktok) out.push('tiktok');
  return out;
}

/** Ids efetivos do menu: explícito do lojista (navCustom) ∩ disponíveis. */
export function resolvedNavIds(input: NavAvailabilityInput): string[] {
  const available = new Set(availableNavIds(input));
  const chosen = input.business.navCustom && Array.isArray(input.business.nav)
    ? input.business.nav
    : NAV_ORDER.map((n) => n.id);
  return NAV_ORDER.map((n) => n.id).filter((id) => available.has(id) && chosen.includes(id));
}

/** Atalho de conveniência para a página pública. */
export function publicNavIds(input: {
  business: PublicBusiness;
  blocks: Block[];
  services: Array<{ bookable?: boolean; active?: boolean }>;
  products: Array<{ active?: boolean }>;
  reviews: Pick<Review, 'id'>[];
  hasFaq: boolean;
  hasTestimonialItems: boolean;
}): string[] {
  return resolvedNavIds(input);
}

export { canBook, whatsappVisible };
