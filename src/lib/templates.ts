// Templates = apenas configurações iniciais. Nenhum código duplicado por nicho.
//
// POSICIONAMENTO: o InstaLink nasceu como plataforma "universal"; hoje é
// especializada em negócios de atendimento. Por isso:
//   • o cadastro NÃO pergunta mais "o que você vende" — todo negócio novo
//     nasce com o padrão de atendimento (Serviços + Agendamentos ligados,
//     vitrine de produtos DESLIGADA, sem pedidos/orçamentos);
//   • o nicho continua ARMAZENADO por compatibilidade (templates de tema),
//     mas não escolhe arquitetura comercial nem cria caminhos paralelos.
import type { Block, BlockType, BusinessMode, Niche, Theme } from './types';
import { NICHE_PRESET, presetById } from './themes';
import { uid } from './utils';
import { defaultCtaTarget } from './cta';

/** Padrão comercial de um negócio novo (fonte única usada pelo cadastro/API). */
export const NEW_BUSINESS_DEFAULTS: { niche: Niche; modes: BusinessMode[] } = {
  niche: 'servicos',
  modes: ['services', 'bookings'],
};

export function defaultTheme(niche: Niche): Theme {
  return { ...presetById(NICHE_PRESET[niche]).theme };
}

export function defaultPresetId(niche: Niche): string {
  return NICHE_PRESET[niche];
}

export function ctaFor(modes: BusinessMode[], _niche?: Niche): string {
  // O agendamento é o centro do produto; o rótulo acompanha isso.
  if (modes.includes('bookings')) return 'Agendar horário';
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

  // Vitrine de produtos (opcional, desligada por padrão) — nunca carrinho.
  if (wants('products')) blocks.push(block('products', order++, { title: 'Vitrine' }));
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
  profile: { label: 'Perfil', hint: 'Nome, logo e descrição vêm do cadastro do negócio' },
  cta: { label: 'Ação principal', hint: 'Botão de conversão da página' },
  buttons: { label: 'Botões', hint: 'Links personalizados' },
  text: { label: 'Texto', hint: 'Título + parágrafo livre' },
  image: { label: 'Imagem', hint: 'Banner ou foto com link opcional' },
  gallery: { label: 'Galeria', hint: 'Fotos do negócio' },
  products: { label: 'Vitrine de produtos', hint: 'Produtos com CTA "Tenho interesse" no WhatsApp' },
  services: { label: 'Serviços', hint: 'Lista de serviços (com Agendar quando a agenda está ativa)' },
  booking: { label: 'Agendamento', hint: 'Fluxo de reserva de horário' },
  testimonials: { label: 'Depoimentos', hint: 'Prova social' },
  faq: { label: 'Perguntas frequentes', hint: 'Dúvidas comuns' },
  location: { label: 'Localização', hint: 'Mapa — só aparece com link do Google Maps' },
  whatsapp: { label: 'WhatsApp', hint: 'Botão flutuante de conversa' },
  quote: { label: 'Orçamento', hint: 'Formulário de orçamento (legado)' },
  concierge: { label: 'Assistente virtual', hint: 'Ajuda o visitante a agendar' },
};
