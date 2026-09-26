// ═══════════════════════════════════════════════════════════════
// POSICIONAMENTO DO PRODUTO (refatoração 2026) — testes de contrato
// ═══════════════════════════════════════════════════════════════
// InstaLink = página + agendamento + relacionamento para negócios de
// atendimento. Estes testes travam as decisões centrais da refatoração:
//   • cadastro novo SEM wizard de nicho/forma de venda (uma tela só);
//   • negócio nasce com Agendamentos+Serviços ATIVOS e Produtos DESATIVADO;
//   • produtos são VITRINE com CTA "Tenho interesse" → WhatsApp (nunca pedido);
//   • pedidos/orçamentos saem da experiência (ficam legados resolúveis);
//   • a configuração da página não tem segunda fonte em Configurações;
//   • dashboard com progresso REAL (checklist não inventa conclusão).
// Os testes estáticos seguem o mesmo padrão de panel.test.ts (API_GUARDS):
// leem o código-fonte para impedir que conceitos removidos voltem pela UI.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ALL_FEATURES, FEATURES, LEGACY_FEATURES, OFFERED_FEATURE_IDS, withActivationBlock,
  allowedCtaTargets, blockVisible, featureDef, isFeatureEnabled, isLegacyFeature,
  isValidFeature, normalizeFeatures, productsVisible, visibleBlocks,
} from '../features';
import { NEW_BUSINESS_DEFAULTS, defaultBlocks, ctaFor } from '../templates';
import { productInterestMessage, showcaseAcceptsOrders, showcasePriceCents } from '../showcase';
import { setupChecklist, setupProgress, dashboardModules } from '../dashboard';
import type { Block, Business } from '../types';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

function business(partial: Partial<Business> = {}): Business {
  return {
    id: 'b1', ownerId: 'u1', name: 'Studio', slug: 'studio', description: '',
    logo: '', cover: '', niche: 'servicos', modes: [], features: undefined,
    phone: '', whatsapp: '', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0,
    googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 30, cancelUntilMin: 120, horizonDays: 60, bufferMin: 0 },
    nav: [], navCustom: false,
    about: { title: '', text: '', image: '', enabled: false },
    published: false, createdAt: '', updatedAt: '',
    ...partial,
  };
}

/** Negócio recém-criado pelo fluxo novo (sem corpo niche/modes). */
function newBusiness(): Business {
  const modes = NEW_BUSINESS_DEFAULTS.modes;
  const blocks = defaultBlocks(NEW_BUSINESS_DEFAULTS.niche, modes);
  return business({ modes, features: normalizeFeatures(business({ modes }), blocks) });
}

describe('cadastro: padrão de atendimento, sem onboarding de "tipo de venda"', () => {
  it('negócio novo nasce com Agenda+Serviços ativos e Produtos DESLIGADO', () => {
    const b = newBusiness();
    expect(isFeatureEnabled(b, 'bookings')).toBe(true);
    expect(isFeatureEnabled(b, 'services')).toBe(true);
    expect(isFeatureEnabled(b, 'products')).toBe(false);
    expect(isFeatureEnabled(b, 'orders')).toBe(false);
    expect(isFeatureEnabled(b, 'quote')).toBe(false);
  });

  it('CTA padrão da página nova aponta para agendamento', () => {
    const b = newBusiness();
    const blocks = defaultBlocks(b.niche, b.modes);
    const cta = blocks.find((x) => x.type === 'cta');
    expect(cta?.settings.target).toBe('booking');
    expect(String(cta?.settings.label)).toMatch(/agendar/i);
    expect(ctaFor(['services', 'bookings'])).toMatch(/agendar/i);
  });

  it('a página de criação é UMA tela e não pergunta nicho/forma de vender', () => {
    const src = read('src/app/onboarding/page.tsx');
    expect(src).not.toMatch(/from '@\/lib\/templates'/);
    expect(src).not.toMatch(/\bNICHES\b|\bMODES\b/);
    expect(src).toMatch(/Crie o seu negócio/);
    // registra direto para o dashboard (sem wizard de múltiplas etapas)
    expect(src).toMatch(/router\.push\(`\/dashboard/);
  });

  it('a API de criação aplica o padrão quando niche/modes não vêm no corpo', () => {
    const src = read('src/app/api/businesses/route.ts');
    expect(src).toMatch(/NEW_BUSINESS_DEFAULTS/);
    expect(src).toMatch(/Array\.isArray\(body\.modes\) \? body\.modes : NEW_BUSINESS_DEFAULTS\.modes/);
  });
});

describe('pedidos e orçamentos: fora da experiência, preservados por compatibilidade', () => {
  it('FEATURES (o que o painel oferece) não inclui Pedidos nem Orçamentos', () => {
    const ids = FEATURES.map((f) => f.id);
    expect(ids).not.toContain('orders');
    expect(ids).not.toContain('quote');
    expect(OFFERED_FEATURE_IDS).toEqual(ids);
  });

  it('módulos legados continuam RESOLVÍVEIS (dados antigos não quebram)', () => {
    expect(LEGACY_FEATURES.map((f) => f.id).sort()).toEqual(['orders', 'quote']);
    expect(isValidFeature('orders')).toBe(true); // API aceita o id (compat)
    expect(featureDef('orders')?.legacy).toBe(true);
    expect(isLegacyFeature('quote')).toBe(true);
    expect(isFeatureEnabled(business({ modes: ['orders'] }), 'orders')).toBe(true);
    // bloco legado de pedido só APRESENTA; o módulo manda
    const legacyCatalog = business({ modes: ['orders'], features: normalizeFeatures(business({ modes: ['orders'] }), []) });
    const productsBlock: Block = { id: 'p', type: 'products', order: 0, enabled: true, settings: {} };
    expect(blockVisible(legacyCatalog, productsBlock)).toBe(true);
  });

  it('negócio novo não vê nada de pedido na página (produtos desligados)', () => {
    const b = newBusiness();
    expect(productsVisible(b, [{ active: true }])).toBe(false);
    const blocks: Block[] = [{ id: 'p', type: 'products', order: 0, enabled: true, settings: {} }];
    expect(visibleBlocks(b, blocks)).toEqual([]);
  });

  it('a vitrine NUNCA aceita criar pedido', () => {
    expect(showcaseAcceptsOrders(['products'])).toBe(false);
    expect(showcaseAcceptsOrders(['products', 'orders'])).toBe(false);
    // a API de pedidos exige o módulo legado 'orders' (produtos sozinhos não criam)
    const src = read('src/app/api/orders/route.ts');
    expect(src).toMatch(/isFeatureEnabled\(business, 'orders'\)/);
    expect(src).not.toMatch(/!isFeatureEnabled\(business, 'orders'\) && !isFeatureEnabled\(business, 'products'\)/);
  });

  it('Pedidos/Orçamento/Delivery não são caminhos principais', () => {
    const panel = read('src/lib/panel.ts');
    // A1.2 · Bloco 1: o campo `hidden` morreu — o destino continua DECLARADO no
    // catálogo (rota, rótulo, descrição, permissão).
    //
    // A3.4: Pedidos passa a APARECER em Operação, mas SOMENTE quando o módulo
    // de pedidos estiver ativo (`modes: ['orders']`). Módulo desligado ⇒ porta
    // inexistente para o usuário: o gate é de MÓDULO, não mais `sidebar:false`.
    const pedidosRoute = panel.match(/href: '\/pedidos'[\s\S]*?\n  \},/)?.[0] || '';
    expect(pedidosRoute).toContain("modes: ['orders']");
    expect(pedidosRoute).not.toContain('sidebar: false');
    expect(pedidosRoute).not.toMatch(/hidden/);       // o campo antigo não volta
    expect(panel).not.toMatch(/label: 'Orçamentos'/);
    expect(panel).not.toMatch(/label: '(Delivery|Restaurante|Loja)'/);
    const landing = read('src/app/page.tsx');
    expect(landing).not.toMatch(/hamburgues|pizzaria|cardápio/i);
  });
});

describe('produtos = vitrine com CTA no WhatsApp', () => {
  it('com módulo ativo, a vitrine aparece na página e no catálogo', () => {
    const b = business({ modes: ['products'], features: normalizeFeatures(business({ modes: ['products'] }), []) });
    expect(isFeatureEnabled(b, 'products')).toBe(true);
    expect(productsVisible(b, [{ active: true }])).toBe(true);
    const blocks: Block[] = [{ id: 'p', type: 'products', order: 0, enabled: true, settings: {} }];
    expect(visibleBlocks(b, blocks).map((x) => x.id)).toEqual(['p']);
  });

  it('desativar o módulo some com a vitrine e NÃO apaga produtos/configuração', () => {
    const b = business({
      modes: ['products', 'bookings'],
      features: normalizeFeatures(business({ modes: ['products', 'bookings'] }), []),
    });
    const productsBlock: Block = { id: 'p', type: 'products', order: 0, enabled: true, settings: { title: 'Meus produtos' } };
    expect(blockVisible(b, productsBlock)).toBe(true);
    const off = { ...b, modes: ['bookings'] as Business['modes'] };
    expect(blockVisible(off, productsBlock)).toBe(false);
    expect(productsBlock.settings.title).toBe('Meus produtos'); // apresentação intacta
  });

  it('mensagem do CTA "Tenho interesse" contextualiza o produto (e o preço, se houver)', () => {
    expect(productInterestMessage({ name: 'Sérum Facial', price: 0 }))
      .toBe('Olá! Tenho interesse no produto Sérum Facial.');
    // money() usa Intl (NBSP entre "R$" e o valor) → compara com folga no espaço.
    expect(productInterestMessage({ name: 'Sérum Facial', price: 8900 }).replace(/\s+/g, ' '))
      .toBe('Olá! Tenho interesse no produto Sérum Facial (R$ 89,00).');
    expect(productInterestMessage({ name: 'Kit', price: 10000, promoPrice: 8000 }))
      .toMatch(/80,00/);
  });

  it('preço efetivo usa a promoção legado apenas quando menor', () => {
    expect(showcasePriceCents({ name: 'x', price: 5000, promoPrice: 0 })).toBe(5000);
    expect(showcasePriceCents({ name: 'x', price: 5000, promoPrice: 4000 })).toBe(4000);
    expect(showcasePriceCents({ name: 'x', price: 5000, promoPrice: 9000 })).toBe(5000);
  });

  it('a página pública não renderiza carrinho/checkout nem abre sheet de catálogo', () => {
    const page = read('src/app/[slug]/page.tsx');
    expect(page).toMatch(/ProductShowcase/);
    expect(page).not.toMatch(/CatalogIsland/);
    expect(page).not.toMatch(/Cardápio/);
    const showcase = read('src/components/public/showcase.tsx');
    expect(showcase).toMatch(/Tenho interesse/);
    expect(showcase).toMatch(/waLink/);
    // nenhuma chamada de compra/pedido na vitrine (comentários são livres)
    expect(showcase).not.toMatch(/api\/orders|api\/checkout|CartDrawer|ProductModal/);
  });

  it('o admin de produtos é cadastro mínimo (sem opções/adicionais/variações)', () => {
    const admin = read('src/app/(dashboard)/produtos/page.tsx');
    // sem UI de opções/variações nem chamadas a option.* da API de catálogo
    expect(admin).not.toMatch(/OptionsEditor|option\.save|option\.delete|'options'|productOptions/);
    expect(admin).toMatch(/vitrine/i);
  });

  it('ativar o módulo reflete na página na hora (garante o bloco, aditivo)', () => {
    const none: Block[] = [{ id: 'a', type: 'profile', order: 0, enabled: true, settings: {} }];
    const added = withActivationBlock(none, 'products', true);
    expect(added).not.toBe(none);
    expect(added.some((b) => b.type === 'products')).toBe(true);
    expect(added[0]).toBe(none[0]); // nada existente foi tocado
    // reativar não duplica; desativar nunca remove bloco/configuração
    const again = withActivationBlock(added, 'products', true);
    expect(again.filter((b) => b.type === 'products').length).toBe(1);
    expect(withActivationBlock(added, 'products', false)).toBe(added);
    // agenda não ganha bloco próprio (destino único, padrão do produto)
    expect(withActivationBlock(none, 'bookings', true)).toBe(none);
  });
});

describe('CTA e destinos: agendamento primeiro', () => {
  it('com agenda + vitrine, o destino disponível prioriza booking', () => {
    const b = business({
      modes: ['products', 'bookings'],
      whatsapp: '11999999999',
      features: { ...normalizeFeatures(business(), []), whatsapp: true },
    });
    expect(allowedCtaTargets(b)[0]).toBe('booking');
  });
});

describe('página: uma só fonte de construção', () => {
  it('Configurações não duplica a edição da página (nem nav, nem Sobre)', () => {
    const cfg = read('src/app/(dashboard)/configuracoes/page.tsx');
    expect(cfg).not.toMatch(/NAV_ORDER/);
    expect(cfg).not.toMatch(/Navegação da página/);
    expect(cfg).not.toMatch(/setAbout|about\.title/);
    // apenas o ponteiro para o editor
    expect(cfg).toMatch(/Editar página pública/);
  });

  it('o editor da página carrega a navegação e o Sobre', () => {
    const editor = read('src/app/(dashboard)/pagina/page.tsx');
    // v2: o editor resolve a disponibilidade real (módulo/conteúdo) com a
    // MESMA regra da página pública (lib/nav.ts) e edita NavItemConfig[].
    expect(editor).toMatch(/availableNavIds/);
    expect(editor).toMatch(/NAV_ANCHORS/);
    expect(editor).toMatch(/navItems/);
    expect(editor).toMatch(/PageNavTab/);
    expect(editor).toMatch(/Sobre a empresa/);
  });

  it('a API aceita nav/about pelo editor sem remover o PATCH legado do negócio', () => {
    const pages = read('src/app/api/pages/route.ts');
    expect(pages).toMatch(/VALID_NAV/);
    expect(pages).toMatch(/navCustom/);
    const biz = read('src/app/api/businesses/[id]/route.ts');
    expect(biz).toMatch(/body\.nav/); // PATCH legado continua aceito (compat)
  });
});

describe('dashboard: checklist "Comece por aqui" com progresso real', () => {
  const modules = dashboardModules(business({ modes: ['services', 'bookings'] }));

  it('negócio recém-criado: nada marcado como feito sem existir dado', () => {
    const fresh = business({ description: '', logo: '', cover: '', whatsapp: '', published: false });
    const items = setupChecklist({
      business: fresh, modules,
      counts: { services: 0, availability: 0, professionals: 0, products: 0 },
    });
    expect(items.every((i) => i.done === false)).toBe(true);
    expect(setupProgress(items)).toBe(0);
  });

  it('itens aparecem/desaparecem conforme módulos e dados reais', () => {
    const done = setupChecklist({
      business: business({ description: 'Clínica de estética', whatsapp: '11988887777', published: true }),
      modules,
      counts: { services: 2, availability: 5, professionals: 1, products: 0 },
      // FASE 2 · P8 — os dois sinais novos do caminho operacional.
      pageCustomized: true,
      whatsappConnected: true,
    });
    expect(done.every((i) => i.done)).toBe(true);
    expect(setupProgress(done)).toBe(100);
    expect(done.map((i) => i.id)).not.toContain('products'); // vitrine desligada não cobra produto
    // Ordem do ciclo (P8): serviço → profissional → horários → personalizar → publicar → WhatsApp.
    const ids = done.map((i) => i.id);
    expect(ids.indexOf('services')).toBeLessThan(ids.indexOf('team'));
    expect(ids.indexOf('team')).toBeLessThan(ids.indexOf('hours'));
    expect(ids.indexOf('personalize')).toBeLessThan(ids.indexOf('publish'));
    expect(done.find((i) => i.id === 'whatsapp')?.optional).toBe(true);

    const withProducts = setupChecklist({
      business: business({ description: 'x', whatsapp: '1', published: false }),
      modules: dashboardModules(business({ modes: ['services', 'bookings', 'products'] })),
      counts: { services: 1, availability: 1, professionals: 1, products: 0 },
    });
    expect(withProducts.some((i) => i.id === 'products' && i.done === false)).toBe(true);
  });
});
