// Templates = apenas configurações iniciais. Nenhum código duplicado por nicho.
import type { Block, BlockType, BusinessMode, Niche, Theme } from './types';
import { NICHE_PRESET, presetById } from './themes';
import { uid } from './utils';
import { defaultCtaTarget } from './cta';

export const NICHES: Array<{ id: Niche; label: string; hint: string }> = [
  { id: 'alimentacao', label: 'Alimentação', hint: 'Restaurantes, hamburguerias, pizzarias, delivery' },
  { id: 'loja', label: 'Loja', hint: 'Roupas, cosméticos, produtos físicos' },
  { id: 'beleza', label: 'Beleza', hint: 'Salão, barbearia, manicure, estética' },
  { id: 'saude', label: 'Saúde', hint: 'Clínicas, consultórios, odonto, terapias' },
  { id: 'servicos', label: 'Serviços', hint: 'Reformas, manutenção, assistência' },
  { id: 'profissional', label: 'Profissional', hint: 'Consultor, fotógrafo, personal, coach' },
  { id: 'educacao', label: 'Educação', hint: 'Professores, cursos, mentorias' },
  { id: 'pet', label: 'Pet', hint: 'Banho, tosa, veterinária, adestramento' },
  { id: 'outro', label: 'Outro', hint: 'Qualquer outro negócio' },
];

export const MODES: Array<{ id: BusinessMode; label: string; hint: string }> = [
  { id: 'products', label: 'Produtos', hint: 'Catálogo com carrinho e pedido' },
  { id: 'services', label: 'Serviços', hint: 'Lista de serviços com preços' },
  { id: 'bookings', label: 'Agendamentos', hint: 'Cliente escolhe dia e horário' },
  { id: 'orders', label: 'Pedidos', hint: 'Receber pedidos com entrega/retirada' },
  { id: 'quote', label: 'Orçamentos', hint: 'Formulário de solicitação de orçamento' },
];

export function defaultTheme(niche: Niche): Theme {
  return { ...presetById(NICHE_PRESET[niche]).theme };
}

export function defaultPresetId(niche: Niche): string {
  return NICHE_PRESET[niche];
}

export function ctaFor(modes: BusinessMode[], niche: Niche): string {
  if (modes.includes('orders') || (modes.includes('products') && niche === 'alimentacao')) return 'Pedir agora';
  if (modes.includes('bookings')) {
    if (niche === 'beleza') return 'Agendar horário';
    if (niche === 'saude') return 'Agendar atendimento';
    return 'Agendar';
  }
  if (modes.includes('quote')) return 'Pedir orçamento';
  if (modes.includes('products')) return 'Ver produtos';
  if (modes.includes('services')) return 'Ver serviços';
  return 'Falar no WhatsApp';
}

function block(type: BlockType, order: number, settings: Record<string, any> = {}): Block {
  return { id: uid(), type, order, enabled: true, settings };
}

export function defaultBlocks(niche: Niche, modes: BusinessMode[]): Block[] {
  const blocks: Block[] = [block('profile', 0)];
  let order = 1;
  const wants = (m: BusinessMode) => modes.includes(m);

  blocks.push(block('cta', order++, { label: ctaFor(modes, niche), target: defaultCtaTarget(modes) }));

  if (wants('products') || wants('orders')) blocks.push(block('products', order++, { title: niche === 'alimentacao' ? 'Cardápio' : 'Produtos' }));
  if (wants('services') || wants('bookings')) blocks.push(block('services', order++, { title: 'Serviços' }));
  // Sem bloco 'booking' separado: CTA + menu Agendar + botão por serviço
  // abrem o mesmo fluxo (destino único, sem duplicação visual).
  if (wants('quote')) blocks.push(block('quote', order++, { title: 'Solicite um orçamento' }));

  blocks.push(block('testimonials', order++, {}));
  blocks.push(block('faq', order++, {}));
  blocks.push(block('location', order++, {}));
  blocks.push(block('whatsapp', order++, { label: 'Falar no WhatsApp' }));
  blocks.push(block('concierge', order++, { title: 'Precisa de ajuda?' }));
  return blocks;
}

export const BLOCK_DEFS: Partial<Record<BlockType, { label: string; hint: string }>> = {
  profile: { label: 'Perfil', hint: 'Logo, nome e descrição do negócio' },
  cta: { label: 'Ação principal', hint: 'Botão grande de conversão' },
  buttons: { label: 'Botões', hint: 'Links personalizados' },
  text: { label: 'Texto', hint: 'Título + parágrafo livre' },
  image: { label: 'Imagem', hint: 'Banner ou foto com link opcional' },
  gallery: { label: 'Galeria', hint: 'Fotos do negócio' },
  products: { label: 'Produtos', hint: 'Catálogo com carrinho' },
  services: { label: 'Serviços', hint: 'Lista de serviços' },
  booking: { label: 'Agendamento', hint: 'Fluxo de reserva de horário' },
  testimonials: { label: 'Depoimentos', hint: 'Prova social' },
  faq: { label: 'Perguntas frequentes', hint: 'Dúvidas comuns' },
  location: { label: 'Localização', hint: 'Mapa — só aparece com link do Google Maps' },
  whatsapp: { label: 'WhatsApp', hint: 'Botão flutuante de conversa' },
  quote: { label: 'Orçamento', hint: 'Formulário de orçamento' },
  concierge: { label: 'Assistente virtual', hint: 'Ajuda o visitante a decidir' },
};
