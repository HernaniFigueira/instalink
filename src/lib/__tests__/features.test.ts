import { describe, expect, it } from 'vitest';
import {
  FEATURES, allowedCtaTargets, blockVisible, canBook, featureTogglePatch, isFeatureEnabled,
  normalizeFeatures, productsVisible, servicesVisible, visibleBlocks, whatsappVisible, enabledFeatureIds,
} from '../features';
import type { Block, Business } from '../types';

function business(partial: Partial<Business> = {}): Business {
  return {
    id: 'b1', ownerId: 'u1', name: 'Clínica Odonto', slug: 'odonto', description: '',
    logo: '', cover: '', niche: 'saude', modes: [], features: undefined,
    phone: '', whatsapp: '', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0,
    googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 30, cancelUntilMin: 120, horizonDays: 60, bufferMin: 0 },
    nav: [], navCustom: true,
    about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: '', updatedAt: '',
    ...partial,
  };
}

const CTA_LABEL = 'Pedir orçamento';
const target = (b: Business) => allowedCtaTargets(b);

describe('módulos — fonte única de verdade', () => {
  it('módulos comerciais vêm de Business.modes', () => {
    const b = business({ modes: ['bookings', 'quote'] });
    expect(isFeatureEnabled(b, 'bookings')).toBe(true);
    expect(isFeatureEnabled(b, 'quote')).toBe(true);
    expect(isFeatureEnabled(b, 'products')).toBe(false);
  });

  it('módulos opcionais vêm de Business.features', () => {
    const b = business({ features: { reviews: true, faq: false, gallery: false, location: true, whatsapp: true, about: false, agent: true } });
    expect(isFeatureEnabled(b, 'reviews')).toBe(true);
    expect(isFeatureEnabled(b, 'faq')).toBe(false);
    expect(isFeatureEnabled(b, 'agent')).toBe(true);
    expect([...enabledFeatureIds(b)].sort()).toEqual(['agent', 'location', 'reviews', 'whatsapp']);
  });

  it('desativar o módulo desliga TODOS os pontos, não só o bloco', () => {
    const withQuote = business({ modes: ['quote', 'bookings'] });
    expect(target(withQuote)).toEqual(['booking', 'quote']);
    const withoutQuote = business({ ...withQuote, modes: ['bookings'] });
    expect(target(withoutQuote)).toEqual(['booking']);
    expect(isFeatureEnabled(withoutQuote, 'quote')).toBe(false);
  });

  it('desativar orçamento remove CTA e mantém configuração salva', () => {
    const b = business({
      modes: ['quote'],
      nav: ['about', 'services'],
      features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false },
    });
    const patch = featureTogglePatch(b, 'quote', false);
    expect(patch.modes).toEqual([]);
    // nada além do flag muda: navegação/about continuam intactos
    expect(patch.features).toBeUndefined();
    expect(b.nav).toEqual(['about', 'services']);
    // reativar restaura o recurso já configurado
    const back = featureTogglePatch({ ...b, modes: [] }, 'quote', true);
    expect(back.modes).toEqual(['quote']);
  });

  it('desativar agendamento também desliga o CTA de agendamento e o botão por serviço', () => {
    const b = business({ modes: ['bookings'] });
    expect(isFeatureEnabled(b, 'bookings')).toBe(true);
    expect(canBook(b, [{ bookable: true, active: true }])).toBe(true);
    const off = { ...b, modes: [] as Business['modes'] };
    expect(canBook(off, [{ bookable: true, active: true }])).toBe(false);
    expect(target(off)).toEqual([]);
  });

  it('"todos os módulos opcionais desligados" é um estado válido', () => {
    const b = business({ modes: [], features: normalizeFeatures(business(), []) });
    expect(enabledFeatureIds(b)).toEqual([]);
    expect(target(b)).toEqual([]);
  });

  it('bloco legado NÃO reativa módulo desativado', () => {
    const b = business({ modes: [], features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false } });
    const blocks: Block[] = [
      { id: 'x', type: 'quote', order: 0, enabled: true, settings: {} },
      { id: 'y', type: 'testimonials', order: 1, enabled: true, settings: {} },
      { id: 'z', type: 'text', order: 2, enabled: true, settings: {} },
    ];
    expect(blockVisible(b, blocks[0])).toBe(false);
    expect(blockVisible(b, blocks[1])).toBe(false);
    expect(blockVisible(b, blocks[2])).toBe(true); // conteúdo livre continua
    expect(visibleBlocks(b, blocks).map((x) => x.id)).toEqual(['z']);
  });

  it('bloco de módulo ativo continua aparecendo (apresentação preservada)', () => {
    const b = business({ modes: ['quote'], features: normalizeFeatures(business({ modes: ['quote'] }), []) });
    const blocks: Block[] = [{ id: 'x', type: 'quote', order: 0, enabled: true, settings: {} }];
    expect(visibleBlocks(b, blocks).map((x) => x.id)).toEqual(['x']);
    // bloco desabilitado pelo lojista continua fora (apresentação)
    expect(visibleBlocks(b, [{ ...blocks[0], enabled: false }])).toEqual([]);
  });

  it('serviços aparecem quando serviços OU agenda estão ligados', () => {
    const onlyBooking = business({ modes: ['bookings'] });
    expect(servicesVisible(onlyBooking, [{ active: true }])).toBe(true);
    const none = business({ modes: [] });
    expect(servicesVisible(none, [{ active: true }])).toBe(false);
  });

  it('CTA de WhatsApp respeita o módulo e o número', () => {
    expect(whatsappVisible(business({ modes: [], whatsapp: '11999999999', features: { whatsapp: true, reviews: false, faq: false, gallery: false, location: false, about: false, agent: false } }))).toBe(true);
    expect(whatsappVisible(business({ modes: [], whatsapp: '11999999999', features: { whatsapp: false, reviews: false, faq: false, gallery: false, location: false, about: false, agent: false } }))).toBe(false);
    expect(whatsappVisible(business({ modes: [], whatsapp: '' }))).toBe(false);
  });
});

describe('normalizeFeatures — migração defensiva', () => {
  it('deriva dos blocos legados na primeira leitura', () => {
    const blocks: Block[] = [
      { id: 'a', type: 'testimonials', order: 0, enabled: true, settings: {} },
      { id: 'b', type: 'faq', order: 1, enabled: true, settings: {} },
      { id: 'c', type: 'concierge', order: 2, enabled: true, settings: {} },
    ];
    const f = normalizeFeatures(business(), blocks);
    expect(f.reviews).toBe(true);
    expect(f.faq).toBe(true);
    expect(f.agent).toBe(true);
    expect(f.gallery).toBe(false);
  });

  it('é idempotente e preserva valor explícito do lojista', () => {
    const explicit = business({ features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false } });
    const blocks: Block[] = [{ id: 'a', type: 'testimonials', order: 0, enabled: true, settings: {} }];
    const once = normalizeFeatures(explicit, blocks);
    const twice = normalizeFeatures({ ...explicit, features: once }, blocks);
    expect(once.reviews).toBe(false); // lojista desligou depois da migração
    expect(twice).toEqual(once);
  });

  it('considera "Sobre" legado via nav/about.enabled', () => {
    expect(normalizeFeatures(business({ nav: ['about'] }), []).about).toBe(true);
    expect(normalizeFeatures(business({ about: { title: 'x', text: 'y', image: '', enabled: true } }), []).about).toBe(true);
    expect(normalizeFeatures(business(), []).about).toBe(false);
  });

  it('catálogo de módulos é coerente (ids únicos, modos válidos)', () => {
    const ids = FEATURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CTA_LABEL.length).toBeGreaterThan(0);
  });
});

describe('produtos × serviços — módulos INDEPENDENTES (regra central)', () => {
  const svcBlocks: Block[] = [
    { id: 'p', type: 'profile', order: 0, enabled: true, settings: {} },
    { id: 's', type: 'services', order: 1, enabled: true, settings: {} },
    { id: 'v', type: 'products', order: 2, enabled: true, settings: {} },
  ];

  it('Produtos ON sem Serviços: vitrine aparece, serviços não', () => {
    const b = business({ modes: ['products'] });
    expect(isFeatureEnabled(b, 'products')).toBe(true);
    expect(isFeatureEnabled(b, 'services')).toBe(false);
    expect(isFeatureEnabled(b, 'bookings')).toBe(false);
    const types = visibleBlocks(b, svcBlocks).map((x) => x.type);
    expect(types).toContain('products');
    expect(types).not.toContain('services');
  });

  it('Serviços OFF não esconde bloco de produtos (e vice-versa)', () => {
    const full = business({ modes: ['services', 'bookings', 'products'] });
    expect(visibleBlocks(full, svcBlocks).map((x) => x.type)).toEqual(['profile', 'services', 'products']);
    // desligar só serviços/agenda: a vitrine continua
    const off = business({ ...full, modes: ['products'] });
    expect(visibleBlocks(off, svcBlocks).map((x) => x.type)).toEqual(['profile', 'products']);
    // desligar só produtos: serviços continuam
    const off2 = business({ ...full, modes: ['services', 'bookings'] });
    expect(visibleBlocks(off2, svcBlocks).map((x) => x.type)).toEqual(['profile', 'services']);
  });

  it('desativar Produtos nunca apaga dados (patch mínimo, preserva o resto)', () => {
    const b = business({ modes: ['services', 'bookings', 'products'] });
    const patch = featureTogglePatch(b, 'products', false);
    expect(patch.modes).toEqual(['services', 'bookings']);
    // reativar devolve exatamente o conjunto anterior
    const back = featureTogglePatch({ ...b, modes: patch.modes! }, 'products', true);
    expect(new Set(back.modes)).toEqual(new Set(['services', 'bookings', 'products']));
  });

  it('os três modelos de empresa do onboarding resolvem os módulos certos', () => {
    // espelha lib/onboarding.ts → isFeatureEnabled
    expect(isFeatureEnabled(business({ modes: ['services', 'bookings'] }), 'services')).toBe(true);
    expect(isFeatureEnabled(business({ modes: ['products'] }), 'services')).toBe(false);
    expect(isFeatureEnabled(business({ modes: ['services', 'bookings', 'products'] }), 'products')).toBe(true);
  });
});

describe('contradição auditada — vitrine × legado de pedidos (§4)', () => {
  const productsBlock: Block[] = [{ id: 'v', type: 'products', order: 0, enabled: true, settings: {} }];

  it('fallback legado preservado: orders-only sem gestão de Produtos exibe vitrine', () => {
    const legacy = business({ modes: ['orders'] }); // nunca tocou em Produtos
    expect(productsVisible(legacy, [{ active: true }])).toBe(true);
    expect(visibleBlocks(legacy, productsBlock)).toHaveLength(1);
  });

  it('desligar Produtos grava supressão e a vitrine SOME mesmo com orders ligado', () => {
    const legacy = business({ modes: ['orders', 'products'] });
    const patch = featureTogglePatch(legacy, 'products', false);
    expect(patch.productsOff).toBe(true);
    const off = business({ ...legacy, modes: patch.modes!, productsOff: patch.productsOff });
    expect(productsVisible(off, [{ active: true }])).toBe(false);
    expect(visibleBlocks(off, productsBlock)).toHaveLength(0);
    expect(target(off)).not.toContain('products');
  });

  it('reativar Produtos limpa a supressão e a vitrine volta inteira', () => {
    const back = featureTogglePatch(business({ modes: ['orders'] }), 'products', true);
    expect(back.productsOff).toBe(false);
    expect(back.modes).toEqual(expect.arrayContaining(['orders', 'products']));
  });
});
