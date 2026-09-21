/**
 * Mapper business_row → Business (documento). ÚNICA implementação — o slice
 * reexporta. Mora num módulo próprio para que consumidores leves (auth-store,
 * rotas públicas) NÃO puxem a graph de automação (executor → conectores de
 * canal) só por importar o mapper.
 */
const s = (v: unknown): string => String(v ?? '');
const n = (v: unknown, d = 0): number => (Number.isFinite(Number(v)) ? Number(v) : d);
const b = (v: unknown, d = false): boolean => (typeof v === 'boolean' ? v : d);
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));
const j = <T>(v: unknown, d: T): T => {
  try {
    const parsed = typeof v === 'string' ? JSON.parse(v) : v;
    return (parsed ?? d) as T;
  } catch {
    return d;
  }
};
const jn = <T>(v: unknown, d: T): T => (v == null ? d : (typeof v === 'object' ? v as T : (j(v, d))));

export function rowToBusiness(r: any) {
  return {
    id: s(r.id), organizationId: s(r.organization_id), ownerId: s(r.owner_id),
    name: s(r.name), slug: s(r.slug), description: s(r.description),
    logo: s(r.logo), cover: s(r.cover), niche: s(r.niche) || 'outro',
    modes: jn(r.modes, [] as string[]), ...(r.features ? { features: j(r.features, {}) } : {}),
    ...(r.products_off == null ? {} : { productsOff: b(r.products_off) }),
    ...(r.whatsapp_integration ? { whatsappIntegration: j(r.whatsapp_integration, null) } : {}),
    ...(r.instagram_integration ? { instagramIntegration: j(r.instagram_integration, null) } : {}),
    phone: s(r.phone), whatsapp: s(r.whatsapp), email: s(r.email),
    instagram: s(r.instagram), tiktok: s(r.tiktok),
    socials: jn(r.socials, {} as any), address: s(r.address), mapsUrl: s(r.maps_url),
    hours: jn(r.hours, {} as any), ...(r.business_timezone ? { businessTimezone: s(r.business_timezone) } : {}),
    paymentMethods: jn(r.payment_methods, [] as string[]), pixKey: s(r.pix_key),
    deliveryFee: n(r.delivery_fee), minOrder: n(r.min_order),
    googleUrl: s(r.google_url), googlePlaceId: s(r.google_place_id), googleApiKey: s(r.google_api_key),
    booking: jn(r.booking, null as any), nav: jn(r.nav, [] as any[]), navCustom: b(r.nav_custom),
    ...(r.nav_items ? { navItems: j(r.nav_items, null) } : {}),
    ...(r.automations ? { automations: j(r.automations, {}) } : {}),
    ...(r.capability_flags ? { capabilityFlags: j(r.capability_flags, {}) } : {}),
    about: jn(r.about, null as any), ...(r.appearance ? { appearance: j(r.appearance, null) } : {}),
    published: b(r.published), ...(r.subscription ? { subscription: j(r.subscription, null) } : {}),
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  } as any;
}
