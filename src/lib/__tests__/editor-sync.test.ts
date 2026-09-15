import { describe, expect, it } from 'vitest';
import {
  blockModuleGate, featuresForActivatedBlocks, normalizeFeatures,
  visibleBlocks, withActivationBlock,
} from '../features';
import { paginate } from '../utils';
import type { Block, Business } from '../types';

function business(partial: Partial<Business> = {}): Business {
  return {
    id: 'b1', ownerId: 'u1', name: 'Studio', slug: 'studio', description: '',
    logo: '', cover: '', niche: 'beleza', modes: ['bookings'], features: undefined,
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

const allOff = { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false };
const B = (id: string, type: Block['type'], enabled = true, settings: Record<string, unknown> = {}): Block =>
  ({ id, type, order: 0, enabled, settings });

describe('withActivationBlock — ligar módulo garante a presença do bloco', () => {
  it('adiciona bloco quando o módulo com spec liga sem ele', () => {
    const out = withActivationBlock([B('a', 'profile')], 'gallery', true);
    expect(out.some((b) => b.type === 'gallery' && b.enabled)).toBe(true);
    expect(out[out.length - 1].order).toBe(1); // vem por último, preservando o resto
  });
  it('não duplica quando o bloco já existe (mesmo oculto — o lojista escondeu de propósito)', () => {
    const out = withActivationBlock([B('g', 'gallery', false)], 'gallery', true);
    expect(out.filter((b) => b.type === 'gallery').length).toBe(1);
  });
  it('desligar módulo NUNCA mexe nos blocos', () => {
    const blocks = [B('a', 'profile'), B('g', 'gallery')];
    expect(withActivationBlock(blocks, 'gallery', false)).toBe(blocks);
  });
  it('módulos sem spec (about, bookings) não inventam bloco', () => {
    const blocks = [B('a', 'profile')];
    expect(withActivationBlock(blocks, 'about', true)).toBe(blocks);
    expect(withActivationBlock(blocks, 'bookings', true)).toBe(blocks);
  });
  it('produtos liga com sua vitrine já presente no fim da ordem', () => {
    const out = withActivationBlock([B('a', 'profile')], 'products', true);
    const b = out[out.length - 1];
    expect(b.type).toBe('products');
    expect(b.enabled).toBe(true);
  });
});

describe('featuresForActivatedBlocks — intenção de salvar liga o módulo correspondente', () => {
  it('bloco novo de galeria liga o módulo gallery (o bug "salvei e não apareceu")', () => {
    const biz = business({ features: { ...allOff } });
    const patch = featuresForActivatedBlocks(biz, [B('a', 'profile')], [B('a', 'profile'), B('g', 'gallery', true, { images: ['x'] })]);
    expect(patch?.gallery).toBe(true);
  });
  it('reativar bloco oculto neste salvamento também liga', () => {
    const biz = business({ features: { ...allOff } });
    const patch = featuresForActivatedBlocks(biz, [B('f', 'faq', false)], [B('f', 'faq', true)]);
    expect(patch?.faq).toBe(true);
  });
  it('bloco que JÁ estava ativo não religa módulo desligado de propósito', () => {
    const biz = business({ features: { ...allOff } });
    const patch = featuresForActivatedBlocks(biz, [B('g', 'gallery', true)], [B('g', 'gallery', true)]);
    expect(patch).toBeNull();
  });
  it('módulo comercial (produtos) não é religado pelo editor', () => {
    const biz = business({ modes: [], features: { ...allOff } });
    const patch = featuresForActivatedBlocks(biz, [], [B('p', 'products', true)]);
    expect(patch).toBeNull();
  });
  it('testimonials → reviews; concierge → agent; whatsapp block → whatsapp', () => {
    const biz = business({ features: { ...allOff } });
    expect(featuresForActivatedBlocks(biz, [], [B('t', 'testimonials', true)])?.reviews).toBe(true);
    expect(featuresForActivatedBlocks(biz, [], [B('c', 'concierge', true)])?.agent).toBe(true);
    expect(featuresForActivatedBlocks(biz, [], [B('w', 'whatsapp', true)])?.whatsapp).toBe(true);
  });
  it('nunca DESLIGA nada ao materializar (patch só adiciona verdade)', () => {
    const biz = business({ features: { ...allOff, location: true } });
    const patch = featuresForActivatedBlocks(biz, [B('l', 'location', true)], [B('l', 'location', true), B('g', 'gallery', true)]);
    expect(patch?.location).toBe(true);
    expect(patch?.gallery).toBe(true);
  });
});

describe('blockModuleGate — o editor avisa ANTES de o bloco sumir na página', () => {
  it('bloco com módulo opcional desligado devolve o rótulo do módulo', () => {
    const biz = business({ features: { ...allOff } });
    expect(blockModuleGate(biz, 'gallery')).toBe('Galeria');
  });
  it('com módulo ligado não há portão', () => {
    const biz = business({ features: { ...allOff, gallery: true } });
    expect(blockModuleGate(biz, 'gallery')).toBe('');
  });
  it('services aceita bookings como alternativa; products aceita orders', () => {
    expect(blockModuleGate(business({ modes: ['bookings'] }), 'services')).toBe('');
    expect(blockModuleGate(business({ modes: [] }), 'services')).toBe('Serviços');
    expect(blockModuleGate(business({ modes: ['orders'] }), 'products')).toBe('');
  });
  it('blocos sem módulo (profile, cta, highlights) nunca são portados', () => {
    const biz = business({ features: { ...allOff } });
    expect(blockModuleGate(biz, 'cta')).toBe('');
    expect(blockModuleGate(biz, 'highlights')).toBe('');
    expect(blockModuleGate(biz, 'profile')).toBe('');
  });
});

describe('integração ativação → página pública (persistência de comportamento)', () => {
  it('após ligar o módulo e garantir o bloco, visibleBlocks mostra a galeria', () => {
    let biz = business({ features: { ...allOff } });
    let blocks: Block[] = [B('a', 'profile', true), B('g', 'gallery', true, { images: ['u1', 'u2'] })];
    expect(visibleBlocks(biz, blocks).some((b) => b.type === 'gallery')).toBe(false); // módulo off → fora da página
    biz = { ...biz, features: { ...normalizeFeatures(biz, blocks), gallery: true } };
    expect(visibleBlocks(biz, blocks).some((b) => b.type === 'gallery')).toBe(true);
  });
});

describe('paginate — controle do histórico 360', () => {
  const items = Array.from({ length: 12 }, (_, i) => i + 1);
  it('corta em páginas e reporta total', () => {
    const p = paginate(items, 1, 5);
    expect(p.slice).toEqual([1, 2, 3, 4, 5]);
    expect(p.pages).toBe(3);
    expect(p.total).toBe(12);
  });
  it('última página incompleta; página fora do intervalo é ajustada', () => {
    expect(paginate(items, 3, 5).slice).toEqual([11, 12]);
    expect(paginate(items, 99, 5).page).toBe(3);
    expect(paginate(items, 0, 5).page).toBe(1);
  });
  it('vazio não quebra (1 página, slice vazio)', () => {
    const p = paginate([], 4, 5);
    expect(p).toEqual({ slice: [], page: 1, pages: 1, total: 0 });
  });
});
