// Catálogo de itens de navegação da página pública (menu configurável).
// Ordem canônica fixa na v1 (futuramente pode ganhar reordenação no painel).
// Cada item tem um destino resolvido no momento do clique (seções/links reais).

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
