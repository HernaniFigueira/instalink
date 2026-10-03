import { isLegacyPagesEnabled } from './product';
// ═══════════════════════════════════════════════════════════════
// LEADS — rótulos de origem (FONTE ÚNICA)
// ═══════════════════════════════════════════════════════════════
// `Lead.origin` guarda um identificador CURTO gravado pelo fluxo que gerou o
// lead (`agendamento`, `agente`, `pedido`, `orcamento`, `formulario`…). O
// rótulo apresentado ao lojista vivia duplicado (api/analytics + clientes).
// Aqui existe UMA tabela, usada por Resultados, Clientes e Dashboard.
//
// REGRA: origem desconhecida NUNCA é inventada nem agregada em um rótulo
// falso — mostramos o valor real gravado (higienizado). Sem origem gravada →
// "Não informada".
export const LEAD_ORIGIN_LABELS: Record<string, string> = {
  instagram: 'Instagram',
  whatsapp: 'WhatsApp',
  whatsapp_click: 'WhatsApp',
  pagina: 'Página pública',
  site: 'Página pública',
  public_page: 'Página pública',
  external_site: 'Site externo',
  site_externo: 'Site externo',
  landing_page: 'Landing page',
  api: 'API',
  widget: 'Widget',
  agendamento: 'Página pública',
  booking_cta: 'Página pública',
  formulario: 'Formulário',
  orcamento: 'Orçamento',
  quote: 'Orçamento',
  agente: 'Assistente',
  chat_ai: 'Assistente',
  pedido: 'Pedido',
  share: 'Indicação',
  cart_abandoned: 'Carrinho',
  automacao: 'Automação',
  manual: 'Manual',
  outro: 'Outro',
};

/** Origens conhecidas na ordem canônica da visão de Resultados. */
export const LEAD_ORIGIN_ORDER: string[] = [
  'Instagram', 'WhatsApp', 'Página pública', 'Site externo', 'Landing page', 'API', 'Widget', 'Assistente', 'Formulário',
  'Orçamento', 'Pedido', 'Indicação', 'Carrinho', 'Automação', 'Manual', 'Outro',
];

/** Rótulo de uma origem gravada (`''`/ausente → "Não informada"). */
export function leadOriginLabel(origin: unknown, legacyPagesEnabled = isLegacyPagesEnabled()): string {
  const raw = String(origin ?? '').trim();
  if (!raw) return 'Não informada';
  const known = LEAD_ORIGIN_LABELS[raw.toLowerCase()];
  if (known) return originDisplayLabel(known, legacyPagesEnabled);
  // Valor desconhecido: mostra o dado REAL (nunca um rótulo inventado).
  return raw.slice(0, 40);
}

// Historical identifiers stay untouched; only active Clinical OS copy changes.
function originDisplayLabel(label: string, legacy: boolean): string {
  if (legacy) return label;
  return ({ 'Página pública': 'Cadastro online (legado)', Pedido: 'Registro comercial (legado)', Carrinho: 'Interesse comercial (legado)' } as Record<string, string>)[label] || label;
}

/** Ordem dos rótulos na apresentação (desconhecidos ao final, alfabético). */
export function leadOriginRank(label: string): number {
  const i = LEAD_ORIGIN_ORDER.map(value => originDisplayLabel(value, isLegacyPagesEnabled())).indexOf(label);
  return i === -1 ? LEAD_ORIGIN_ORDER.length : i;
}
