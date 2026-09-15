// Navegação da página pública — catálogo, disponibilidade e resolução.
//
// v2 (âncoras + links externos): cada item de menu tem NOME, TIPO
// (âncora interna × link externo), DESTINO, ATIVO e ORDEM (a ordem do array
// `business.navItems`). Negócios legados continuam resolvidos por
// nav/navCustom (detecção automática) — nada quebra.
//
// REGRA: a DISPONIBILIDADE de um item vem do MÓDULO/conteúdo REAL da empresa
// (lib/features.ts + blocos/dados) — configuração de página só escolhe
// apresentação/ordem. O menu nunca aponta para recurso desligado ou vazio.
import { canBook, isFeatureEnabled, servicesVisible, whatsappVisible } from './features';
import type { Block, Business, NavItemConfig, PublicBusiness, Review, SocialNetworkId } from './types';

export interface NavItemDef {
  id: string;
  label: string;
}

// ── Catálogo canônico (âncoras internas) ─────────────────────
// O destino é o id da seção na página pública (scroll suave).
export const NAV_ANCHORS: Record<string, { label: string; target: string }> = {
  about: { label: 'Sobre a empresa', target: '#sobre' },
  services: { label: 'Serviços', target: '#servicos' },
  highlights: { label: 'Diferenciais', target: '#diferenciais' },
  professionals: { label: 'Profissionais', target: '#profissionais' },
  gallery: { label: 'Conheça o espaço', target: '#espaco' },
  reviews: { label: 'Avaliações', target: '#avaliacoes' },
  faq: { label: 'Dúvidas frequentes', target: '#faq' },
  contact: { label: 'Contato', target: '#contato' },
};

// Ordem canônica legada (v1) — continua válida para resolução automática.
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
  return NAV_ORDER.find((n) => n.id === id)?.label || NAV_ANCHORS[id]?.label || id;
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

// ── Disponibilidade dos itens (módulo/conteúdo manda) ────────
export interface NavAvailabilityInput {
  business: Pick<
    Business,
    'modes' | 'features' | 'nav' | 'navCustom' | 'navItems' | 'about' | 'mapsUrl' | 'instagram' | 'tiktok' | 'socials' | 'whatsapp'
  >;
  blocks: Block[];
  services: Array<{ bookable?: boolean; active?: boolean }>;
  products: Array<{ active?: boolean }>;
  reviews: Pick<Review, 'id'>[];
  hasFaq: boolean;
  hasTestimonialItems: boolean;
  /** Profissionais ATIVOS do negócio (para a seção/âncora de equipe). */
  professionals?: Array<{ active?: boolean }>;
}

function hasBlock(blocks: Block[], type: Block['type']): boolean {
  return blocks.some((b) => b.type === type && b.enabled !== false);
}

/** Âncoras disponíveis AGORA (módulo ligado + seção com conteúdo). */
export function availableAnchors(input: NavAvailabilityInput): Set<string> {
  const { business, blocks } = input;
  const out = new Set<string>();
  if (isFeatureEnabled(business, 'about') && aboutVisible(business.about)) out.add('about');
  if (servicesVisible(business, input.services) && hasBlock(blocks, 'services')) out.add('services');
  if (isFeatureEnabled(business, 'gallery') && hasBlock(blocks, 'gallery')
    && blocks.some((b) => b.type === 'gallery' && b.enabled !== false && Array.isArray(b.settings?.images) && b.settings.images.filter(Boolean).length > 0)) {
    out.add('gallery');
  }
  if (hasBlock(blocks, 'professionals') && (input.professionals || []).some((p) => p.active !== false)) out.add('professionals');
  if (hasBlock(blocks, 'highlights') && blocks.some((b) => b.type === 'highlights' && b.enabled !== false
    && Array.isArray(b.settings?.items) && b.settings.items.some((x: any) => String(x?.title || '').trim()))) {
    out.add('highlights');
  }
  if (isFeatureEnabled(business, 'reviews') && (input.reviews.length > 0 || input.hasTestimonialItems)) out.add('reviews');
  if (isFeatureEnabled(business, 'faq') && hasBlock(blocks, 'faq') && input.hasFaq) out.add('faq');
  if (isFeatureEnabled(business, 'location') && business.mapsUrl) out.add('contact');
  return out;
}

/** URL final de uma rede social (legado @perfil × socials com URL completa). */
export function socialUrl(business: Pick<Business, 'instagram' | 'tiktok' | 'socials'>, network: SocialNetworkId): string {
  const socials = business.socials || {};
  const raw = String(socials[network] || '').trim();
  if (network === 'instagram') {
    if (raw) return raw.startsWith('http') ? raw : `https://instagram.com/${raw.replace(/^@/, '')}`;
    const handle = String(business.instagram || '').trim();
    return handle ? `https://instagram.com/${handle.replace('@', '')}` : '';
  }
  if (network === 'tiktok') {
    if (raw) return raw.startsWith('http') ? raw : `https://tiktok.com/@${raw.replace(/^@/, '')}`;
    const handle = String(business.tiktok || '').trim();
    return handle ? `https://tiktok.com/@${handle.replace('@', '')}` : '';
  }
  if (!raw) return '';
  return raw.startsWith('http') ? raw : `https://${raw}`;
}

/** Redes sociais configuradas (só as que têm URL/usuário) → item de menu. */
export function availableSocialLinks(
  business: Pick<Business, 'instagram' | 'tiktok' | 'socials'>,
): Array<{ id: string; label: string; url: string }> {
  const nets: Array<{ id: SocialNetworkId; label: string }> = [
    { id: 'instagram', label: 'Instagram' },
    { id: 'tiktok', label: 'TikTok' },
    { id: 'facebook', label: 'Facebook' },
    { id: 'youtube', label: 'YouTube' },
    { id: 'linkedin', label: 'LinkedIn' },
    { id: 'site', label: 'Site' },
  ];
  return nets
    .map((n) => ({ id: n.id, label: n.label, url: socialUrl(business, n.id) }))
    .filter((n) => n.url.length > 0);
}

/**
 * Quais itens de menu a página OFERECE agora (âncoras + redes). Um módulo
 * desativado remove o item — o menu nunca aponta para recurso desligado.
 */
export function availableNavIds(input: NavAvailabilityInput): string[] {
  const { business } = input;
  const out: string[] = [...availableAnchors(input)];
  if (isFeatureEnabled(business, 'location') && business.mapsUrl) out.push('directions');
  for (const l of availableSocialLinks(business)) out.push(l.id);
  return out;
}

/** Ids efetivos do menu (v1): explícito do lojista ∩ disponíveis. */
export function resolvedNavIds(input: NavAvailabilityInput): string[] {
  const available = new Set(availableNavIds(input));
  const chosen = input.business.navCustom && Array.isArray(input.business.nav)
    ? input.business.nav
    : NAV_ORDER.map((n) => n.id);
  return NAV_ORDER.map((n) => n.id).filter((id) => available.has(id) && chosen.includes(id));
}

// ── Resolução v2: NavItemConfig[] (nome, tipo, destino, ativo, ordem) ──

/** Item padrão de uma âncora disponível. */
function anchorItem(id: string): NavItemConfig | null {
  const def = NAV_ANCHORS[id];
  if (!def) return null;
  return { id, label: def.label, type: 'anchor', target: def.target, active: true };
}

/**
 * Configuração automática (o que a página decide sozinha quando o lojista
 * não personalizou): âncoras na ordem canônica + redes configuradas.
 */
export function autoNavItems(input: NavAvailabilityInput): NavItemConfig[] {
  const items: NavItemConfig[] = [];
  const anchors = availableAnchors(input);
  for (const id of Object.keys(NAV_ANCHORS)) {
    if (anchors.has(id)) {
      const it = anchorItem(id);
      if (it) items.push(it);
    }
  }
  if (isFeatureEnabled(input.business, 'location') && input.business.mapsUrl) {
    items.push({ id: 'directions', label: 'Como chegar', type: 'link', target: input.business.mapsUrl, active: true });
  }
  for (const l of availableSocialLinks(input.business)) {
    items.push({ id: l.id, label: l.label, type: 'link', target: l.url, active: true });
  }
  return items;
}

/**
 * Navegação EFETIVA da página pública (v2).
 *  • `business.navItems` configurado ⇒ é a fonte (ordem/nome/ativo do lojista),
 *    filtrada pelo que está REALMENTE disponível (âncora de seção vazia ou
 *    desligada não entra; link sem URL não entra).
 *  • Caso contrário ⇒ detecção automática (v2, mesma regra da v1 ampliada).
 */
export function resolvedNavItems(input: NavAvailabilityInput): NavItemConfig[] {
  const configured = Array.isArray(input.business.navItems) ? input.business.navItems : [];
  if (configured.length === 0) return autoNavItems(input);

  const anchors = availableAnchors(input);
  const socialById = new Map(availableSocialLinks(input.business).map((l) => [l.id, l]));
  const out: NavItemConfig[] = [];
  for (const item of configured) {
    if (!item || typeof item !== 'object' || item.active === false) continue;
    const label = String(item.label || '').trim().slice(0, 40);
    if (item.type === 'anchor') {
      if (!anchors.has(item.id)) continue; // seção desligada/vazia: o item some
      const def = NAV_ANCHORS[item.id];
      out.push({
        id: item.id,
        label: label || def?.label || item.id,
        type: 'anchor',
        target: def?.target || String(item.target || ''),
        active: true,
      });
    } else {
      // Link externo: rede conhecida resolve a URL; senão usa o target salvo.
      const social = socialById.get(item.id);
      const url = social ? social.url : String(item.target || '').trim();
      if (!url || !/^https?:\/\//i.test(url)) continue;
      out.push({
        id: item.id,
        label: label || social?.label || item.id,
        type: 'link',
        target: url,
        active: true,
      });
    }
  }
  return out;
}

/** Atalho de conveniência para a página pública (mantém a assinatura v1). */
export function publicNavIds(input: {
  business: PublicBusiness;
  blocks: Block[];
  services: Array<{ bookable?: boolean; active?: boolean }>;
  products: Array<{ active?: boolean }>;
  reviews: Pick<Review, 'id'>[];
  hasFaq: boolean;
  hasTestimonialItems: boolean;
}): string[] {
  return resolvedNavIds(input as NavAvailabilityInput);
}

export { canBook, whatsappVisible };
