// Concierge IA (MVD): motor de intenção baseado em REGRAS sobre dados
// estruturados reais do negócio. Não inventa nada: só responde o que
// existe no banco. Quando não sabe, conduz a ação segura (WhatsApp).
import type { Business, DB } from './types';
import { money } from './utils';

export interface ConciergeAction { label: string; target: string }
// target: '#produtos' | '#servicos' | '#agendar' | '#orcamento' | '#contato' | 'whatsapp'

export interface ConciergeReply { reply: string; actions: ConciergeAction[]; intent: string }

function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function conciergeAnswer(db: DB, business: Business, message: string): ConciergeReply {
  const bId = business.id;
  const q = norm(message);
  const wa: ConciergeAction = { label: 'Falar no WhatsApp', target: 'whatsapp' };

  const products = db.products.filter((p) => p.businessId === bId && p.active);
  const services = db.services.filter((s) => s.businessId === bId && s.active);
  const cats = db.categories.filter((c) => c.businessId === bId && c.active);

  const has = (...words: string[]) => words.some((w) => q.includes(norm(w)));

  // ── Saudação ──────────────────────────────────────────────
  if (!q.trim() || has('oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'opa')) {
    const opts: string[] = [];
    if (products.length) opts.push('ver produtos');
    if (services.length) opts.push('ver serviços');
    if (business.modes.includes('bookings')) opts.push('agendar horário');
    if (business.modes.includes('quote')) opts.push('pedir orçamento');
    return {
      intent: 'greeting',
      reply: `Olá! Bem-vindo(a) à ${business.name}. Posso ajudar você a ${opts.slice(0, 3).join(', ').replace(/, ([^,]*)$/, ' ou $1')}. O que você procura?`,
      actions: [
        ...(products.length ? [{ label: 'Ver produtos', target: '#produtos' } as ConciergeAction] : []),
        ...(services.length ? [{ label: 'Ver serviços', target: '#servicos' } as ConciergeAction] : []),
        ...(business.modes.includes('bookings') ? [{ label: 'Agendar', target: '#agendar' } as ConciergeAction] : []),
      ].slice(0, 3),
    };
  }

  // ── Preço de item específico ──────────────────────────────
  const allItems = [
    ...products.map((p) => ({ name: p.name, price: p.promoPrice > 0 ? p.promoPrice : p.price, kind: 'produto' as const })),
    ...services.map((s) => ({ name: s.name, price: s.price, kind: 'serviço' as const })),
  ];
  const mentioned = allItems.find((i) => {
    const words = norm(i.name).split(/\s+/).filter((w) => w.length > 3);
    return words.length > 0 && words.some((w) => q.includes(w));
  });
  if (mentioned && has('preco', 'valor', 'quanto', 'custa')) {
    return {
      intent: 'price',
      reply: `O ${mentioned.kind} "${mentioned.name}" custa ${money(mentioned.price)}. Quer continuar?`,
      actions: mentioned.kind === 'produto'
        ? [{ label: 'Ver no catálogo', target: '#produtos' }, wa]
        : business.modes.includes('bookings')
          ? [{ label: 'Agendar', target: '#agendar' }, wa] : [wa],
    };
  }
  if (mentioned) {
    return {
      intent: 'item_found',
      reply: `Temos "${mentioned.name}" por ${money(mentioned.price)}.`,
      actions: mentioned.kind === 'produto'
        ? [{ label: 'Ver no catálogo', target: '#produtos' }]
        : [{ label: 'Ver serviços', target: '#servicos' }],
    };
  }

  // ── Intenções diretas ─────────────────────────────────────
  if (has('agendar', 'agenda', 'horario', 'hora', 'marcar', 'reserva')) {
    if (!business.modes.includes('bookings') || services.length === 0) {
      return { intent: 'booking_unavailable', reply: 'Aqui o atendimento é direto pelo WhatsApp. Chama a gente que respondemos rapidinho!', actions: [wa] };
    }
    const names = services.slice(0, 4).map((s) => `${s.name} (${money(s.price)})`).join(' • ');
    return { intent: 'booking', reply: `Bora agendar! Nossos serviços: ${names}. Escolha abaixo e reserve seu horário:`, actions: [{ label: 'Agendar horário', target: '#agendar' }] };
  }
  if (has('pedir', 'pedido', 'delivery', 'entrega', 'comprar', 'quero', 'cardapio', 'menu')) {
    if (!products.length) {
      return { intent: 'order_unavailable', reply: 'Por aqui atendemos pelo WhatsApp. Me chama lá que te ajudo!', actions: [wa] };
    }
    const featured = products.filter((p) => p.featured).slice(0, 3);
    const names = (featured.length ? featured : products.slice(0, 3)).map((p) => p.name).join(', ');
    return { intent: 'order', reply: `Perfeito! Monte seu pedido no catálogo — destaques: ${names}.`, actions: [{ label: 'Ver catálogo', target: '#produtos' }] };
  }
  if (has('orcamento', 'orçamento', 'proposta', 'servico', 'reforma', 'quanto fica')) {
    return { intent: 'quote', reply: 'Claro! Preencha rapidinho que retornamos com o orçamento.', actions: business.modes.includes('quote') ? [{ label: 'Pedir orçamento', target: '#orcamento' }] : [wa] };
  }
  if (has('endereco', 'onde', 'local', 'localizacao', 'como chego', 'mapa')) {
    const addr = business.address || '';
    return {
      intent: 'location',
      reply: addr ? `Estamos em: ${addr}` : 'Nosso atendimento é pelo WhatsApp — chama a gente!',
      actions: addr ? [{ label: 'Ver localização', target: '#localizacao' }] : [wa],
    };
  }
  if (has('horario de funcionamento', 'aberto', 'funcionamento', 'abre', 'fecha', 'que horas abre')) {
    const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const parts: string[] = [];
    for (let d = 1; d <= 6; d++) {
      const h = business.hours?.[String(d)];
      if (h) parts.push(`${days[d]} ${h.open}–${h.close}`);
    }
    const h0 = business.hours?.['0'];
    const sun = h0 ? `Dom ${h0.open}–${h0.close}` : 'Dom fechado';
    const txt = parts.length ? `${parts.join(' • ')} • ${sun}` : '';
    return { intent: 'hours', reply: txt ? `Nosso horário: ${txt}` : 'Fale com a gente no WhatsApp para saber os horários!', actions: txt ? [] : [wa] };
  }
  if (has('entrega', 'delivery', 'taxa')) {
    return { intent: 'delivery', reply: 'Trabalhamos com entrega e retirada. Você escolhe na hora de finalizar o pedido!', actions: products.length ? [{ label: 'Ver catálogo', target: '#produtos' }] : [wa] };
  }
  if (has('pagamento', 'pagar', 'pix', 'cartao', 'dinheiro')) {
    const map: Record<string, string> = { pix: 'PIX', card: 'cartão', cash: 'dinheiro', on_delivery: 'pagamento na entrega' };
    const methods = (business.paymentMethods || []).map((m) => map[m] || m).join(', ');
    return { intent: 'payment', reply: methods ? `Aceitamos: ${methods}.` : 'Fale com a gente no WhatsApp para combinar o pagamento!', actions: methods ? [] : [wa] };
  }
  if (has('humano', 'atendente', 'whatsapp', 'falar com', 'contato', 'telefone')) {
    return { intent: 'human', reply: 'Claro! Fale direto com a gente!', actions: [wa] };
  }

  // ── Busca genérica no catálogo ────────────────────────────
  const qwords = q.split(/\s+/).filter((w) => w.length > 3);
  const matchCat = cats.find((c) => qwords.some((w) => norm(c.name).includes(w)));
  if (matchCat) {
    return { intent: 'category', reply: `Na categoria "${matchCat.name}" temos ótimas opções:`, actions: matchCat.kind === 'product' ? [{ label: `Ver ${matchCat.name}`, target: '#produtos' }] : [{ label: `Ver ${matchCat.name}`, target: '#servicos' }] };
  }
  const matchItem = allItems.find((i) => qwords.some((w) => norm(i.name).includes(w)));
  if (matchItem) {
    return {
      intent: 'search_hit',
      reply: `Encontrei "${matchItem.name}" por ${money(matchItem.price)}.`,
      actions: matchItem.kind === 'produto' ? [{ label: 'Ver no catálogo', target: '#produtos' }] : [{ label: 'Ver serviços', target: '#servicos' }],
    };
  }

  // ── Fallback seguro: nunca inventar ───────────────────────
  return {
    intent: 'fallback',
    reply: 'Não encontrei essa informação por aqui. Fale com a gente que ajudamos rapidinho!',
    actions: [wa],
  };
}
