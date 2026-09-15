// Concierge IA (MVD): motor de intenção baseado em REGRAS sobre dados
// estruturados reais do negócio. Não inventa nada: só responde o que
// existe no banco. Quando não sabe, conduz a ação segura (WhatsApp).
//
// AGENDAMENTO PELO ASSISTENTE: antes das intenções gerais roda o fluxo de
// agendamento (lib/agent-flow.ts), que consulta a disponibilidade REAL
// (mesmo motor da Agenda) e cria o Booking pelo caminho único
// (lib/booking-create.ts). Preços só aparecem quando o serviço libera
// (Service.showPrice).
import type { Business, BusinessAgent, DB } from './types';
import { money } from './utils';
import { parseKnowledgeOverride } from './agent';
import { isFeatureEnabled, whatsappVisible } from './features';
import { priceVisible } from './pricing';
import { agentFlowStep, type AgentFlowState, type FlowContext } from './agent-flow';

export interface ConciergeAction { label: string; target: string; payload?: Record<string, any> }
// target: '#produtos' | '#servicos' | '#agendar' | '#orcamento' | '#contato' | 'whatsapp' | 'flow'

export interface ConciergeReply {
  reply: string;
  actions: ConciergeAction[];
  intent: string;
  /** Estado do fluxo de agendamento (ecoado pelo cliente/conversa). */
  flow?: AgentFlowState | null;
  /** Presente quando o fluxo decidiu CRIAR o agendamento (a rota executa). */
  bookingRequest?: {
    serviceId: string; date: string; time: string;
    customer: { id: string; name: string; phone: string; email?: string } | null;
    name: string; phone: string;
  };
}

function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export interface ConciergeOptions {
  agent?: BusinessAgent; // configuração da empresa (tom/objetivos/handoff)
  faq?: Array<{ q: string; a: string }>; // conhecimento do FAQ (bloco ativo)
  flow?: AgentFlowState | null; // estado do fluxo de agendamento
  action?: Record<string, any> | null; // ação de botão do chat (payload)
  flowCtx?: FlowContext; // identidade (conta logada / canal WhatsApp)
}

export function conciergeAnswer(
  db: DB,
  business: Business,
  message: string,
  options: ConciergeOptions = {},
): ConciergeReply {
  // ── Fluxo de agendamento (Assistente × Agenda — mesmas regras) ──
  const flowReply = agentFlowStep(db, business, message, {
    flow: options.flow || null,
    action: options.action || null,
    ctx: options.flowCtx,
  });
  if (flowReply.intent) {
    return {
      reply: flowReply.reply,
      actions: flowReply.actions,
      intent: flowReply.intent,
      flow: flowReply.flow,
      ...(flowReply.bookingRequest ? { bookingRequest: flowReply.bookingRequest } : {}),
    };
  }
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
    if (isFeatureEnabled(business, 'bookings')) opts.push('agendar horário');
    if (isFeatureEnabled(business, 'quote')) opts.push('pedir orçamento');
    return {
      intent: 'greeting',
      reply: `Olá! Bem-vindo(a) à ${business.name}. Posso ajudar você a ${opts.slice(0, 3).join(', ').replace(/, ([^,]*)$/, ' ou $1')}. O que você procura?`,
      actions: [
        ...(products.length ? [{ label: 'Ver produtos', target: '#produtos' } as ConciergeAction] : []),
        ...(services.length ? [{ label: 'Ver serviços', target: '#servicos' } as ConciergeAction] : []),
        ...(isFeatureEnabled(business, 'bookings') ? [{ label: 'Agendar', target: '#agendar' } as ConciergeAction] : []),
      ].slice(0, 3),
    };
  }

  // ── Preço de item específico ──────────────────────────────
  // Preço de SERVIÇO só é revelado quando o serviço libera (showPrice);
  // sem liberação, o assistente convida a falar com a equipe (nunca inventa).
  const allItems = [
    ...products.map((p) => ({ name: p.name, price: p.promoPrice > 0 ? p.promoPrice : p.price, kind: 'produto' as const })),
    ...services.map((s) => ({ name: s.name, price: s.price, kind: 'serviço' as const, service: s })),
  ];
  const mentioned = allItems.find((i) => {
    const words = norm(i.name).split(/\s+/).filter((w) => w.length > 3);
    return words.length > 0 && words.some((w) => q.includes(w));
  });
  if (mentioned && has('preco', 'valor', 'quanto', 'custa')) {
    if (mentioned.kind === 'serviço' && !priceVisible(mentioned.service as any)) {
      return {
        intent: 'price_private',
        reply: 'O valor desse atendimento a gente passa pessoalmente — fale com a equipe que eles te informam agora mesmo!',
        actions: [wa],
      };
    }
    return {
      intent: 'price',
      reply: `O ${mentioned.kind} "${mentioned.name}" custa ${money(mentioned.price)}. Quer continuar?`,
      actions: mentioned.kind === 'produto'
        ? isFeatureEnabled(business, 'products') || isFeatureEnabled(business, 'orders')
          ? [{ label: 'Ver no catálogo', target: '#produtos' }, wa]
          : [wa]
        : isFeatureEnabled(business, 'bookings')
          ? [{ label: 'Agendar', target: '#agendar' }, wa] : [wa],
    };
  }
  if (mentioned) {
    const priceTxt = mentioned.kind === 'serviço' && !priceVisible(mentioned.service as any)
      ? ''
      : ` por ${money(mentioned.price)}`;
    return {
      intent: 'item_found',
      reply: `Temos "${mentioned.name}"${priceTxt}.`,
      actions: mentioned.kind === 'produto'
        ? isFeatureEnabled(business, 'products') || isFeatureEnabled(business, 'orders')
          ? [{ label: 'Ver no catálogo', target: '#produtos' }]
          : [wa]
        : isFeatureEnabled(business, 'services') || isFeatureEnabled(business, 'bookings')
          ? [{ label: 'Ver serviços', target: '#servicos' }]
          : [wa],
    };
  }

  // ── Intenções diretas ─────────────────────────────────────
  // Horário de FUNCIONAMENTO é pergunta sobre a empresa (vem antes de
  // "agendar", que também fala em horário). Fonte: business.hours.
  if (has('funcionamento', 'que horas abre', 'abre', 'fecha', 'aberto', 'horario de atendimento')) {
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
  if (has('agendar', 'agenda', 'marcar', 'reserva', 'horario', 'hora', 'vaga')) {
    if (!isFeatureEnabled(business, 'bookings') || services.length === 0) {
      return { intent: 'booking_unavailable', reply: 'Aqui o atendimento é direto pelo WhatsApp. Chama a gente que respondemos rapidinho!', actions: [wa] };
    }
    // Preço só aparece para serviço que libera (showPrice).
    const names = services.slice(0, 4).map((s) =>
      `${s.name}${s.showPrice !== false ? ` (${money(s.price)})` : ''}`).join(' • ');
    return { intent: 'booking', reply: `Bora agendar! Nossos serviços: ${names}. Escolha abaixo e reserve seu horário:`, actions: [{ label: 'Agendar horário', target: '#agendar' }] };
  }
  if (has('pedir', 'pedido', 'delivery', 'entrega', 'comprar', 'quero', 'cardapio', 'menu')) {
    if (!products.length || !(isFeatureEnabled(business, 'products') || isFeatureEnabled(business, 'orders'))) {
      return { intent: 'order_unavailable', reply: 'Por aqui atendemos pelo WhatsApp. Me chama lá que te ajudo!', actions: [wa] };
    }
    const featured = products.filter((p) => p.featured).slice(0, 3);
    const names = (featured.length ? featured : products.slice(0, 3)).map((p) => p.name).join(', ');
    // VITRINE, não carrinho: o interesse é tratado no WhatsApp do negócio.
    return { intent: 'order', reply: `Confira nossa vitrine — destaques: ${names}. Toque em "Tenho interesse" que a gente combina tudo pelo WhatsApp!`, actions: [{ label: 'Ver vitrine', target: '#produtos' }] };
  }
  if (has('orcamento', 'orçamento', 'proposta', 'servico', 'reforma', 'quanto fica')) {
    return { intent: 'quote', reply: 'Claro! Preencha rapidinho que retornamos com o orçamento.', actions: isFeatureEnabled(business, 'quote') ? [{ label: 'Pedir orçamento', target: '#orcamento' }] : [wa] };
  }
  if (has('endereco', 'onde', 'local', 'localizacao', 'como chego', 'mapa')) {
    const addr = business.address || '';
    return {
      intent: 'location',
      reply: addr ? `Estamos em: ${addr}` : 'Nosso atendimento é pelo WhatsApp — chama a gente!',
      actions: addr ? [{ label: 'Ver localização', target: '#localizacao' }] : [wa],
    };
  }
  if (has('entrega', 'delivery', 'taxa')) {
    // Só prometemos entrega onde o módulo legado de pedidos ainda existe.
    // Para os demais, o assistente diz a verdade (atendimento/agendamento).
    if (isFeatureEnabled(business, 'orders')) {
      return { intent: 'delivery', reply: 'Trabalhamos com entrega e retirada. Você escolhe na hora de finalizar o pedido!', actions: [{ label: 'Ver catálogo', target: '#produtos' }] };
    }
    return { intent: 'delivery', reply: 'Por aqui nosso atendimento é com hora marcada (ou pelo WhatsApp). Entrega, só se a loja combinar direto com você!', actions: isFeatureEnabled(business, 'bookings') && services.length ? [{ label: 'Agendar horário', target: '#agendar' }] : [wa] };
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
      actions: matchItem.kind === 'produto'
        ? (isFeatureEnabled(business, 'products') || isFeatureEnabled(business, 'orders')
          ? [{ label: 'Ver no catálogo', target: '#produtos' }]
          : [wa])
        : (isFeatureEnabled(business, 'services') || isFeatureEnabled(business, 'bookings')
          ? [{ label: 'Ver serviços', target: '#servicos' }]
          : [wa]),
    };
  }

  // ── Conhecimento do negócio: FAQ publicado ───────────────
  const words = q.split(/\s+/).filter((w) => w.length > 3);
  const faqHit = (options.faq || []).find((item) => {
    const qWords = norm(item.q).split(/\s+/).filter((w) => w.length > 3);
    const hits = qWords.filter((w) => words.some((x) => x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5))));
    return qWords.length > 0 && hits.length >= Math.min(2, qWords.length);
  });
  if (faqHit?.a) {
    return {
      intent: 'faq',
      reply: faqHit.a,
      actions: whatsappVisible(business) ? [wa] : [],
    };
  }

  // ── Orientações do negócio (campo "Orientações do agente") ──
  const extra = parseKnowledgeOverride(options.agent?.knowledgeOverride || '');
  const extraHit = extra.find((item) => {
    const t = norm(item.topic).split(/\s+/).filter((w) => w.length > 3);
    return t.length > 0 && t.some((w) => words.some((x) => x.startsWith(w.slice(0, 5))));
  });
  if (extraHit && extraHit.answer && extraHit.answer !== extraHit.topic) {
    const txt = extraHit.answer.trim();
    const reply = txt.charAt(0).toUpperCase() + txt.slice(1);
    return { intent: 'knowledge', reply, actions: whatsappVisible(business) ? [wa] : [] };
  }

  // ── Fallback seguro: nunca inventar (handoff configurado) ──
  const handoff = (options.agent?.handoffMessage || '').trim();
  return {
    intent: 'fallback',
    reply: handoff || 'Não encontrei essa informação por aqui. Fale com a gente que ajudamos rapidinho!',
    actions: [wa],
  };
}
