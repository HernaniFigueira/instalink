import { randomUUID } from 'node:crypto';
import type { Business, DB } from './types';

/**
 * Copia somente configuração reutilizável de uma unidade.
 * Não copia agregados operacionais (clientes, agenda, leads, eventos etc.).
 * IDs e referências estruturais são recriados para o novo tenant.
 */
export function duplicateUnitStructure(db: DB, source: Business, target: Business): void {
  const categoryIds = new Map<string, string>();
  for (const category of db.categories.filter((x) => x.businessId === source.id && x.kind === 'service')) {
    const id = randomUUID();
    categoryIds.set(category.id, id);
    db.categories.push({ ...category, id, businessId: target.id });
  }

  for (const service of db.services.filter((x) => x.businessId === source.id)) {
    db.services.push({
      ...service,
      id: randomUUID(),
      businessId: target.id,
      categoryId: categoryIds.get(service.categoryId) || '',
      // Profissionais são operacionais da unidade e nunca são clonados.
      professionalIds: [],
      questions: [...(service.questions || [])],
    });
  }

  const page = db.pages.find((x) => x.businessId === source.id);
  if (page) {
    db.pages.push({
      ...page,
      id: randomUUID(),
      businessId: target.id,
      theme: { ...page.theme },
      blocks: page.blocks.map((block) => ({
        ...block,
        id: randomUUID(),
        settings: structuredClone(block.settings || {}),
      })),
      updatedAt: target.createdAt,
    });
  }
}

/** Whitelist da configuração da unidade; campos operacionais/segredos ficam vazios. */
export function duplicatedBusiness(source: Business, input: {
  id: string; name: string; slug: string; address: string; ownerId: string; now: string;
}): Business {
  return {
    ...source,
    id: input.id,
    organizationId: source.organizationId,
    ownerId: input.ownerId,
    name: input.name,
    slug: input.slug,
    address: input.address,
    description: source.description,
    logo: source.logo,
    cover: source.cover,
    features: source.features ? { ...source.features } : undefined,
    socials: source.socials ? { ...source.socials } : {},
    hours: structuredClone(source.hours || {}),
    paymentMethods: [...(source.paymentMethods || [])],
    booking: { ...source.booking },
    nav: [...(source.nav || [])],
    navItems: source.navItems?.map((x) => ({ ...x })),
    automations: source.automations ? { ...source.automations } : {},
    about: { ...source.about },
    // Unidade nova exige revisão/publicação e configuração dos seus canais.
    published: false,
    phone: '', whatsapp: '', email: '', mapsUrl: '', pixKey: '',
    googleUrl: '', googlePlaceId: '', googleApiKey: '',
    whatsappIntegration: undefined,
    createdAt: input.now, updatedAt: input.now,
    subscription: undefined,
  };
}
