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
// Este arquivo é PURO (sem I/O) para poder ser usado no cliente (painel) e
// no servidor (página pública + APIs) sem duplicar regra.
import type {
  Block, BlockType, Business, BusinessMode, OptionalFeatureId, PublicBusiness,
} from './types';
import { VALID_OPTIONAL_FEATURES } from './types';

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
}

// Ordem canônica de apresentação (painel e página).
export const FEATURES: FeatureDef[] = [
  {
    id: 'bookings', label: 'Agendamentos', group: 'Atendimento', icon: 'calendar', mode: 'bookings',
    blocks: ['booking'],
    hint: 'Cliente escolhe dia e horário na sua página',
    disabledHint: 'Some a agenda, o botão Agendar e o agendamento da página pública.',
  },
  {
    id: 'services', label: 'Serviços', group: 'Atendimento', icon: 'scissors', mode: 'services',
    blocks: ['services'],
    hint: 'Lista de serviços com preço e duração',
    disabledHint: 'A vitrine de serviços sai da página (os serviços continuam salvos).',
  },
  {
    id: 'quote', label: 'Orçamentos', group: 'Atendimento', icon: 'chat', mode: 'quote',
    blocks: ['quote'],
    hint: 'Formulário de orçamento que vira lead no CRM',
    disabledHint: 'Some o formulário, o CTA e o item de menu de orçamento.',
  },
  {
    id: 'products', label: 'Produtos', group: 'Catálogo', icon: 'bag', mode: 'products',
    blocks: ['products'],
    hint: 'Catálogo com carrinho',
    disabledHint: 'O catálogo sai da página (produtos continuam salvos).',
  },
  {
    id: 'orders', label: 'Pedidos', group: 'Catálogo', icon: 'truck', mode: 'orders',
    blocks: ['products'],
    hint: 'Receber pedidos com entrega ou retirada',
    disabledHint: 'A página para de aceitar pedidos novos.',
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
    hint: 'Agente de atendimento que responde com os dados da empresa',
    disabledHint: 'O botão do assistente some da página (a configuração fica salva).',
  },
  {
    id: 'whatsapp', label: 'WhatsApp', group: 'Canais', icon: 'whatsapp',
    blocks: ['whatsapp'],
    hint: 'Atalho de conversa na página pública',
    disabledHint: 'Some o botão de WhatsApp da página pública.',
  },
];

export const FEATURE_IDS: FeatureId[] = FEATURES.map((f) => f.id);

export function featureDef(id: FeatureId): FeatureDef | undefined {
  return FEATURES.find((f) => f.id === id);
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

/** O catálogo aparece? (produtos OU pedidos ligados) */
export function productsVisible(
  business: Pick<Business, 'modes' | 'features'>,
  products: Array<{ active?: boolean }>,
): boolean {
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
 */
export function allowedCtaTargets(
  business: Pick<Business, 'modes' | 'features' | 'whatsapp'>,
): Array<'products' | 'booking' | 'quote' | 'whatsapp'> {
  const out: Array<'products' | 'booking' | 'quote' | 'whatsapp'> = [];
  if (isFeatureEnabled(business, 'products') || isFeatureEnabled(business, 'orders')) out.push('products');
  if (isFeatureEnabled(business, 'bookings')) out.push('booking');
  if (isFeatureEnabled(business, 'quote')) out.push('quote');
  if (whatsappVisible(business)) out.push('whatsapp');
  return out;
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
