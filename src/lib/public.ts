import { cookies } from 'next/headers';
import { readDB } from './db';
import { COOKIE_NAME, getUserBySession } from './auth';
import type { Business, Category, DB, Page, Product, ProductOption, ProductOptionValue, Professional, PublicBusiness, Review, Service } from './types';

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
}

// Whitelist explícita: segredos (ownerId, pixKey, googleApiKey) NUNCA
// saem para a página pública.
export function toPublicBusiness(b: Business): PublicBusiness {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    description: b.description,
    logo: b.logo,
    cover: b.cover,
    niche: b.niche,
    modes: b.modes,
    phone: b.phone,
    whatsapp: b.whatsapp,
    email: b.email,
    instagram: b.instagram,
    tiktok: b.tiktok,
    address: b.address,
    mapsUrl: b.mapsUrl,
    hours: b.hours,
    paymentMethods: b.paymentMethods,
    deliveryFee: b.deliveryFee || 0,
    minOrder: b.minOrder || 0,
    booking: b.booking,
    nav: b.nav || [],
    navCustom: !!b.navCustom,
    about: b.about || { title: '', text: '', image: '', enabled: false },
    googleUrl: b.googleUrl,
    published: b.published,
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
    return { business: toPublicBusiness(business), page, categories: [], products: [], options: [], optionValues: [], services: [], serviceCategories: [], professionals: [], reviews: [], isOwnerPreview: false, notPublished: true };
  }
  return {
    business: toPublicBusiness(business), page,
    categories: db.categories.filter((c) => c.businessId === business.id && c.kind === 'product' && c.active).sort((a, b) => a.order - b.order),
    products: db.products.filter((p) => p.businessId === business.id && p.active).sort((a, b) => Number(b.featured) - Number(a.featured) || a.order - b.order),
    options: db.options.filter((o) => o.businessId === business.id),
    optionValues: db.optionValues.filter((v) => db.options.some((o) => o.id === v.optionId && o.businessId === business.id && v.active)),
    services: db.services.filter((s) => s.businessId === business.id && s.active),
    serviceCategories: db.categories.filter((c) => c.businessId === business.id && c.kind === 'service' && c.active),
    professionals: db.professionals.filter((p) => p.businessId === business.id && p.active),
    reviews: (db.reviews || []).filter((r) => r.businessId === business.id && r.status === 'published').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 4),
    isOwnerPreview: isOwner && !business.published,
  };
}
