import type { Business, PublicBusiness } from './types';
import { normalizeFeatures } from './features';

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
    socials: b.socials || {},
    address: b.address,
    mapsUrl: b.mapsUrl,
    hours: b.hours,
    // A2-B5 (F9): fuso do negócio (não é segredo; a ilha de booking usa para
    // montar a lista de dias sem depender do fuso do navegador).
    businessTimezone: b.businessTimezone || '',
    paymentMethods: b.paymentMethods,
    deliveryFee: b.deliveryFee || 0,
    minOrder: b.minOrder || 0,
    booking: b.booking,
    nav: b.nav || [],
    navCustom: !!b.navCustom,
    navItems: Array.isArray(b.navItems) ? b.navItems : [],
    about: b.about || { title: '', text: '', image: '', enabled: false },
    googleUrl: b.googleUrl,
    published: b.published,
    features: normalizeFeatures(b),
    // A supressão da vitrine precisa chegar à página (não é segredo: diz
    // apenas que o dono desligou Produtos) — sem ela aqui, o fallback
    // legado de pedidos reativava a vitrine que o dono acabou de desligar.
    productsOff: b.productsOff === true,
    whatsappStatus: b.whatsappIntegration?.status || 'not_connected',
  };
}
