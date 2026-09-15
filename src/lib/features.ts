// ═══════════════════════════════════════════════════════════════
// MÓDULOS DA EMPRESA — FONTE ÚNICA DE VERDADE
// ═══════════════════════════════════════════════════════════════
// REGRA DO PRODUTO (inviolável):
//
//   MÓDULO DA EMPRESA     → define se o recurso EXISTE / está habilitado
//   CONFIGURAÇÃO DA PÁGINA → define aparência, conteúdo, ordem e apresentação
//
// Consequências obrigatórias:
//   • ativar/desativar um módulo reflete imediatamente na página pública;
//   • menu público, CTA e rotas obedecem ao módulo;
//   • bloco legado NUNCA reativa um módulo desativado (bloco só APRESENTA);
//   • desativar não apaga configuração; reativar restaura o que já existia;
//   • nenhum componente público decide sozinho que um recurso está ativo.
//
// POSICIONAMENTO (2026): o InstaLink é uma plataforma de página, agendamento
// e relacionamento para negócios de atendimento. O eixo do produto é
// Serviços → Agenda → Cliente → Histórico → WhatsApp. Módulos da antiga fase
// "universal" (pedidos, orçamentos) NÃO fazem mais parte da experiência: eles
// continuam RESOLVÍVEIS aqui (dados legados não são apagados nem quebrados),
// mas saem de FEATURES — ou seja, fora do catálogo oferecido no painel
// (Recursos), no cadastro e na navegação. `LEGACY_FEATURES` é o depósito
// isolado desses módulos.
//
// Este arquivo é PURO (sem I/O) para poder ser usado no cliente (painel) e
// no servidor (página pública + APIs) sem duplicar regra.
import type {
  Block, BlockType, Business, BusinessMode, OptionalFeatureId, PublicBusiness,
} from './types';
import { VALID_OPTIONAL_FEATURES } from './types';
import { uid } from './utils';

export type FeatureId =
  | 'products' | 'services' | 'bookings' | 'orders' | 'quote'
  | OptionalFeatureId;

export type FeatureGroup = 'Atendimento' | 'Catálogo' | 'Conteúdo' | 'Canais';

export interface FeatureDef {
  id: FeatureId;
  label: string;
  hint: string; // o que o recurso faz
  disabledHint: string; // o que acontece ao desativar (UX de consequência)
  icon: string;
  group: FeatureGroup;
  mode?: BusinessMode; // módulo armazenado em Business.modes (comercial)
  blocks: BlockType[]; // tipos de bloco que este módulo apresenta
  extraBlocks?: BlockType[]; // blocos que TAMBÉM aparecem quando ele está ativo
  /** true = fora da experiência do produto; só resolvido p/ compatibilidade. */
  legacy?: boolean;
}

// ── Módulos da experiência atual (o que o painel oferece) ──────
// Ordem canônica de apresentação (painel e página).
export const FEATURES: FeatureDef[] = [
  {
    id: 'bookings', label: 'Agendamentos', group: 'Atendimento', icon: 'calendar', mode: 'bookings',
    blocks: ['booking'],
    hint: 'Cliente escolhe dia e horário na sua página',
    disabledHint: 'Some a agenda, o botão Agendar e o agendamento da página pública.',
  },
  {
    id: 'services', label: 'Serviços', group: 'Atendimento', icon: 'service', mode: 'services',
    blocks: ['services'],
    hint: 'Catálogo de serviços com preço e duração',
    disabledHint: 'A vitrine de serviços sai da página (os serviços continuam salvos).',
  },
  {
    id: 'products', label: 'Produtos', group: 'Catálogo', icon: 'bag', mode: 'products',
    blocks: ['products'],
    hint: 'Vitrine de produtos com CTA direto para o WhatsApp',
    disabledHint: 'A vitrine sai da página (os produtos continuam salvos).',
  },
  {
    id: 'reviews', label: 'Avaliações', group: 'Conteúdo', icon: 'star',
    blocks: ['testimonials'],
    hint: 'Depoimentos publicados e prova social',
    disabledHint: 'A seção de avaliações e o item de menu somem da página.',
  },
  {
    id: 'faq', label: 'FAQ', group: 'Conteúdo', icon: 'chat',
    blocks: ['faq'],
    hint: 'Perguntas frequentes respondidas',
    disabledHint: 'O FAQ some da página e do assistente.',
  },
  {
    id: 'gallery', label: 'Galeria', group: 'Conteúdo', icon: 'image',
    blocks: ['gallery'],
    hint: 'Fotos do negócio em grade',
    disabledHint: 'A galeria some da página (as fotos continuam salvas).',
  },
  {
    id: 'location', label: 'Localização', group: 'Conteúdo', icon: 'pin',
    blocks: ['location'],
    hint: 'Mapa e endereço para o cliente chegar',
    disabledHint: 'Some o mapa, o item de menu e o atalho de rota.',
  },
  {
    id: 'about', label: 'Sobre a empresa', group: 'Conteúdo', icon: 'store',
    blocks: [],
    hint: 'História, diferenciais e imagem do negócio',
    disabledHint: 'A seção "Sobre" e o item de menu somem da página.',
  },
  {
    id: 'agent', label: 'Assistente', group: 'Canais', icon: 'spark',
    blocks: ['concierge'],
    hint: 'Assistente de atendimento que responde com os dados da empresa',
    disabledHint: 'O botão do assistente some da página (a configuração fica salva).',
  },
  {
    id: 'whatsapp', label: 'WhatsApp', group: 'Canais', icon: 'whatsapp',
    blocks: ['whatsapp'],
    hint: 'Atalho de conversa na página pública',
    disabledHint: 'Some o botão de WhatsApp da página pública.',
  },
];

// ── Módulos legados (fora da experiência; preservados p/ compatibilidade) ──
// NUNCA entram em Recursos, no cadastro ou na navegação. Empresas que já
// tinham esses módulos continuam funcionando (dados e renderização legados),
// mas nada NOVO é criado por aqui: produtos viraram vitrine com CTA de
// WhatsApp e o fluxo de pedido não faz mais parte do produto.
export const LEGACY_FEATURES: FeatureDef[] = [
  {
    id: 'quote', label: 'Orçamentos', group: 'Atendimento', icon: 'chat', mode: 'quote',
    blocks: ['quote'],
    hint: 'Formulário de orçamento que vira lead no CRM (legado)',
    disabledHint: 'Some o formulário, o CTA e o item de menu de orçamento.',
    legacy: true,
  },
  {
    id: 'orders', label: 'Pedidos', group: 'Catálogo', icon: 'truck', mode: 'orders',
    blocks: ['products'],
    hint: 'Pedidos com entrega ou retirada (legado — fora do produto)',
    disabledHint: 'A página para de aceitar pedidos novos.',
    legacy: true,
  },
];

/** Todos os módulos conhecidos (experiência + legado resolúvel). */
export const ALL_FEATURES: FeatureDef[] = [...FEATURES, ...LEGACY_FEATURES];

/** Ids que o painel/Recursos oferece (nunca os legados). */
export const OFFERED_FEATURE_IDS: FeatureId[] = FEATURES.map((f) => f.id);

export const FEATURE_IDS: FeatureId[] = ALL_FEATURES.map((f) => f.id);

export function isLegacyFeature(id: FeatureId): boolean {
  return featureDef(id)?.legacy === true;
}

export function featureDef(id: FeatureId): FeatureDef | undefined {
  return ALL_FEATURES.find((f) => f.id === id);
}

/** Um id é um módulo válido? */
export function isValidFeature(id: unknown): id is FeatureId {
  return typeof id === 'string' && FEATURE_IDS.includes(id as FeatureId);
}

/** Este módulo é armazenado em Business.modes (comercial)? */
export function featureMode(id: FeatureId): BusinessMode | undefined {
  return featureDef(id)?.mode;
}

// ── Derivação defensiva (migração de dados legados) ────────────
// Dados antigos não tinham `features`: derivamos dos blocos existentes.
// NUNCA inventamos módulo novo, apenas reconhecemos o que a página já fazia.
export function deriveLegacyFeature(
  id: OptionalFeatureId,
  business: Pick<Business, 'about' | 'nav'>,
  blocks: Block[],
): boolean {
  const hasBlock = (types: BlockType[]) =>
    blocks.some((b) => types.includes(b.type) && b.enabled !== false);
  switch (id) {
    case 'reviews': return hasBlock(['testimonials']);
    case 'faq': return hasBlock(['faq']);
    case 'gallery': return hasBlock(['gallery']);
    case 'location': return hasBlock(['location']);
    case 'whatsapp': return hasBlock(['whatsapp']);
    case 'agent': return hasBlock(['concierge']);
    case 'about': return !!business?.about?.enabled || (business?.nav || []).includes('about');
    default: return false;
  }
}

/**
 * Preenche `business.features` de forma IDEMPOTENTE e aditiva:
 * valores já definidos pelo lojista são preservados; ausentes são derivados
 * do comportamento legado. Nada é apagado.
 */
export function normalizeFeatures(
  business: Business,
  blocks: Block[] = [],
): Record<OptionalFeatureId, boolean> {
  const current = (business.features || {}) as Partial<Record<OptionalFeatureId, boolean>>;
  const out = {} as Record<OptionalFeatureId, boolean>;
  for (const id of VALID_OPTIONAL_FEATURES) {
    out[id] = typeof current[id] === 'boolean'
      ? current[id] as boolean
      : deriveLegacyFeature(id, business, blocks);
  }
  return out;
}

// ── A FUNÇÃO CENTRAL ──────────────────────────────────────────
/**
 * isFeatureEnabled(business, feature) — única decisão de módulo do sistema.
 * Painel, página pública, menu, CTA e APIs devem usar SOMENTE esta função.
 */
export function isFeatureEnabled(business: Pick<Business, 'modes' | 'features'>, id: FeatureId): boolean {
  const def = featureDef(id);
  if (!def) return false;
  if (def.mode) return (business.modes || []).includes(def.mode);
  const value = (business.features || {})[id as OptionalFeatureId];
  return value === true;
}

/** Estado de todos os módulos (para a área "Recursos da empresa"). */
export function featureState(
  business: Pick<Business, 'modes' | 'features'>,
): Array<{ def: FeatureDef; enabled: boolean }> {
  return ALL_FEATURES.map((def) => ({ def, enabled: isFeatureEnabled(business, def.id) }));
}

/** Estado APENAS dos módulos oferecidos na experiência (o que Recursos lista). */
export function offeredFeatureState(
  business: Pick<Business, 'modes' | 'features'>,
): Array<{ def: FeatureDef; enabled: boolean }> {
  return FEATURES.map((def) => ({ def, enabled: isFeatureEnabled(business, def.id) }));
}

/** Módulos ligados, na ordem canônica. */
export function enabledFeatureIds(business: Pick<Business, 'modes' | 'features'>): FeatureId[] {
  return FEATURE_IDS.filter((id) => isFeatureEnabled(business, id));
}

/**
 * Ativar/desativar sem perder configuração: devolve o PATCH a aplicar no
 * negócio (modes para módulos comerciais; features para os opcionais).
 * Desativar nunca apaga dados — só o flag.
 */
export function featureTogglePatch(
  business: Business,
  id: FeatureId,
  enabled: boolean,
): { modes?: BusinessMode[]; features?: Record<OptionalFeatureId, boolean>; about?: Business['about'] } {
  const def = featureDef(id);
  if (!def) return {};
  if (def.mode) {
    const set = new Set(business.modes || []);
    if (enabled) set.add(def.mode); else set.delete(def.mode);
    return { modes: [...set] };
  }
  const features = normalizeFeatures(business);
  features[id as OptionalFeatureId] = enabled;
  const patch: { features: Record<OptionalFeatureId, boolean>; about?: Business['about'] } = { features };
  // "Sobre" mantém o flag legado do campo about em sincronia (compatibilidade).
  if (id === 'about') patch.about = { ...(business.about || { title: '', text: '', image: '', enabled: false }), enabled };
  return patch;
}

// ── Blocos × módulos (apresentação obedece ao módulo) ──────────
const BLOCK_FEATURE: Partial<Record<BlockType, FeatureId>> = {
  products: 'products',
  services: 'services',
  booking: 'bookings',
  quote: 'quote',
  testimonials: 'reviews',
  faq: 'faq',
  gallery: 'gallery',
  location: 'location',
  whatsapp: 'whatsapp',
  concierge: 'agent',
};

/** Módulo responsável por um tipo de bloco (null = bloco de conteúdo livre). */
export function blockFeature(type: BlockType): FeatureId | null {
  return BLOCK_FEATURE[type] || null;
}

/**
 * O bloco aparece? Regras:
 *  1. o próprio bloco precisa estar habilitado (apresentação);
 *  2. se o bloco pertence a um módulo, o MÓDULO manda — bloco legado não
 *     reativa recurso desativado;
 *  3. blocos de vitrine de serviços também aparecem quando o módulo de
 *     agendamentos está ligado (os serviços são a base da agenda).
 */
export function blockVisible(
  business: Pick<Business, 'modes' | 'features'>,
  block: Block,
): boolean {
  if (block.enabled === false) return false;
  const feature = blockFeature(block.type);
  if (!feature) return true;
  if (isFeatureEnabled(business, feature)) return true;
  if (feature === 'services' && isFeatureEnabled(business, 'bookings')) return true;
  if (feature === 'products' && isFeatureEnabled(business, 'orders')) return true;
  return false;
}

/** Blocos que a página pública deve renderizar, em ordem. */
export function visibleBlocks(
  business: Pick<Business, 'modes' | 'features'>,
  blocks: Block[],
): Block[] {
  return [...blocks].sort((a, b) => a.order - b.order).filter((b) => blockVisible(business, b));
}

// ── Consultas de negócio usadas por página/menu/CTA ────────────

/** A página oferece agendamento agora? (módulo + serviço agendável) */
export function canBook(
  business: Pick<Business, 'modes' | 'features'>,
  services: Array<{ bookable?: boolean; active?: boolean }>,
): boolean {
  if (!isFeatureEnabled(business, 'bookings')) return false;
  return services.some((s) => s.active !== false && s.bookable !== false);
}

/** A vitrine de serviços aparece? (serviços OU agenda ligados) */
export function servicesVisible(
  business: Pick<Business, 'modes' | 'features'>,
  services: Array<{ active?: boolean }>,
): boolean {
  const on = isFeatureEnabled(business, 'services') || isFeatureEnabled(business, 'bookings');
  return on && services.some((s) => s.active !== false);
}

/** O catálogo/vitrine aparece? (módulo produtos; legado: pedidos também) */
export function productsVisible(
  business: Pick<Business, 'modes' | 'features'>,
  products: Array<{ active?: boolean }>,
): boolean {
  // 'orders' continua contando APENAS para não quebrar páginas antigas que
  // exibiam catálogo via pedidos; a renderização atual é a vitrine (CTA no
  // WhatsApp) — carrinho e checkout saíram da experiência.
  const on = isFeatureEnabled(business, 'products') || isFeatureEnabled(business, 'orders');
  return on && products.some((p) => p.active !== false);
}

/** WhatsApp disponível publicamente (módulo ligado + número configurado)? */
export function whatsappVisible(business: Pick<Business, 'modes' | 'features' | 'whatsapp'>): boolean {
  return isFeatureEnabled(business, 'whatsapp') && !!String(business.whatsapp || '').trim();
}

/**
 * Destino do CTA respeitando os módulos: um destino desativado é rebaixado
 * para o próximo disponível (nunca abre recurso desligado).
 * AGENDAMENTO É O CENTRO: o primeiro destino possível é sempre a agenda —
 * a vitrine vem depois como espaço próprio (e nunca "compra").
 */
export function allowedCtaTargets(
  business: Pick<Business, 'modes' | 'features' | 'whatsapp'>,
): Array<'products' | 'booking' | 'quote' | 'whatsapp'> {
  const out: Array<'products' | 'booking' | 'quote' | 'whatsapp'> = [];
  if (isFeatureEnabled(business, 'bookings')) out.push('booking');
  if (isFeatureEnabled(business, 'products') || isFeatureEnabled(business, 'orders')) out.push('products');
  if (isFeatureEnabled(business, 'quote')) out.push('quote');
  if (whatsappVisible(business)) out.push('whatsapp');
  return out;
}

// ── Ativação = o recurso aparece na página (regra aditiva) ─────
// Negócios novos nascem com módulos desligados e SEM o bloco de apresentação
// correspondente. Ligar o módulo precisa refletir na página pública na hora —
// então a ativação GARANTE o bloco (aditivo: desativar nunca remove nem
// apaga; blocos já existentes continuam intocados).
const ACTIVATION_BLOCK: Partial<Record<FeatureId, { type: BlockType; settings?: Record<string, any> }>> = {
  products: { type: 'products', settings: { title: 'Vitrine' } },
  services: { type: 'services', settings: { title: 'Serviços' } },
  quote: { type: 'quote', settings: { title: 'Solicite um orçamento' } },
  // 'bookings' NÃO ganha bloco próprio: CTA + "Agendar" por serviço + menu já
  // abrem o fluxo (destino único — mesmo padrão do cadastro inicial).
};

/**
 * Devolve os blocos com o bloco de apresentação do módulo garantido quando
 * `enabled` é true. Puro e determinístico para o mesmo input (id gerado via
 * uid). Desativar NUNCA remove bloco — a apresentação fica guardada.
 */
export function withActivationBlock(
  blocks: Block[],
  id: FeatureId,
  enabled: boolean,
): Block[] {
  if (!enabled) return blocks;
  const spec = ACTIVATION_BLOCK[id];
  if (!spec) return blocks;
  if (blocks.some((b) => b.type === spec.type)) return blocks;
  const order = blocks.reduce((m, b) => Math.max(m, b.order), -1) + 1;
  return [...blocks, { id: uid(), type: spec.type, order, enabled: true, settings: spec.settings || {} }];
}

/** O módulo exige garantir bloco ao ligar? (usado pela API de features) */
export function needsActivationBlock(id: FeatureId): boolean {
  return Boolean(ACTIVATION_BLOCK[id]);
}

/**
 * Impacto de desativar um módulo — mostrado ANTES de confirmar na UX.
 * Nunca incluímos "apagar": desativar sempre preserva a configuração.
 */
export function featureImpact(id: FeatureId): { toggledOff: string[]; keeps: string } {
  const def = featureDef(id);
  return {
    toggledOff: def ? [def.disabledHint] : [],
    keeps: 'Nada é apagado: textos, fotos, serviços e histórico continuam salvos e voltam ao reativar.',
  };
}

// ── DTO público: módulos efetivos para o visitante ────────────
/**
 * Enxuga o DTO público para o que está REALMENTE ligado — a página nunca
 * recebe um modo desativado (evita qualquer componente "decidir sozinho").
 */
export function publicFeatures<T extends Pick<Business, 'modes' | 'features'>>(
  business: T,
): { features: FeatureId[] } {
  return { features: enabledFeatureIds(business) };
}

// Reexport de conveniência para o painel (evita import cruzado).
export type { PublicBusiness };
