import { toPublicBusiness } from './public-business';
import { cookies } from 'next/headers';
import { readDB } from './db';
import { COOKIE_NAME, getUserBySession } from './auth';
import type { Business, BusinessAgent, Category, DB, Page, Product, ProductOption, ProductOptionValue, Professional, PublicBusiness, Review, Service } from './types';
import { agentFor, defaultAgent } from './agent';
import { getBusinessOpenStatus, type OpenStatus } from './hours';

export interface PublicData {
  business: PublicBusiness;
  page: Page;
  categories: Category[];
  products: Product[];
  options: ProductOption[];
  optionValues: ProductOptionValue[];
  services: Service[];
  serviceCategories: Category[];
  professionals: Professional[];
  reviews: Review[];
  isOwnerPreview: boolean;
  agent: BusinessAgent; // configuração do agente da empresa (módulo/permissão já resolvidos na página)
  // A2-B5 (F3): "Aberto agora" calculado NO SERVIDOR pela MESMA fonte da
  // Agenda (Availability + exceptions, fuso do negócio). `null` = sem
  // configuração — a página não mostra chip.
  openNow: OpenStatus | null;
}

// Whitelist explícita: segredos (ownerId, pixKey, googleApiKey) NUNCA
// saem para a página pública.
export { toPublicBusiness } from './public-business';
/** Dados públicos enxutos quando a página ainda não foi publicada. */
function emptyPublicBusiness(b: Business): PublicBusiness {
  return {
    ...toPublicBusiness(b),
    nav: [], // rascunho não expõe navegação/configuração ao público
  };
}

export async function getPublicData(slug: string): Promise<(PublicData & { notFound?: boolean; notPublished?: boolean }) | null> {
  const db: DB = await readDB();
  const business = db.businesses.find((b) => b.slug === slug);
  if (!business) return null;
  const page = db.pages.find((p) => p.businessId === business.id);
  if (!page) return null;

  const user = await getUserBySession(cookies().get(COOKIE_NAME)?.value);
  const isOwner = !!user && business.ownerId === user.id;
  if (!business.published && !isOwner) {
    return { business: emptyPublicBusiness(business), page, categories: [], products: [], options: [], optionValues: [], services: [], serviceCategories: [], professionals: [], reviews: [], isOwnerPreview: false, notPublished: true, agent: defaultAgent(business.id, business.name), openNow: null };
  }
  // A2-B5 (F3): "Aberto agora" pela fonte da AGENDA (Availability+exceptions,
  // fuso do negócio) — nunca Business.hours como regra paralela.
  const openNow = getBusinessOpenStatus(
    business,
    db.availability.filter((a) => a.businessId === business.id),
    db.exceptions.filter((e) => e.businessId === business.id),
  );
  return {
    business: toPublicBusiness(business), page, openNow,
    categories: db.categories.filter((c) => c.businessId === business.id && c.kind === 'product' && c.active).sort((a, b) => a.order - b.order),
    products: db.products.filter((p) => p.businessId === business.id && p.active).sort((a, b) => Number(b.featured) - Number(a.featured) || a.order - b.order),
    options: db.options.filter((o) => o.businessId === business.id),
    optionValues: db.optionValues.filter((v) => db.options.some((o) => o.id === v.optionId && o.businessId === business.id && v.active)),
    services: db.services.filter((s) => s.businessId === business.id && s.active),
    serviceCategories: db.categories.filter((c) => c.businessId === business.id && c.kind === 'service' && c.active),
    professionals: db.professionals.filter((p) => p.businessId === business.id && p.active),
    reviews: (db.reviews || []).filter((r) => r.businessId === business.id && r.status === 'published').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 4),
    isOwnerPreview: isOwner && !business.published,
    agent: agentFor(db, business),
  };
}
