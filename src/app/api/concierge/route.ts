import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { conciergeAnswer } from '@/lib/concierge';
import { agentFor, applyAgentVoice, objectiveActions, renderGreeting } from '@/lib/agent';
import { canBook as canBookModule, isFeatureEnabled, whatsappVisible } from '@/lib/features';
import { visibleFaqItems } from '@/lib/faq';
import { customerFromRequest } from '@/lib/customer-auth';
import { onlyDigits } from '@/lib/utils';
import { rateLimit, ipFrom } from '@/lib/rate-limit';

// POST público: pergunta ao AGENTE DE ATENDIMENTO da empresa.
// O agente é configurável (nome, saudação, tom, objetivos, orientações,
// limitações e handoff) e responde SOMENTE com dados reais do negócio.
// NUNCA cria/cancela/remarca agendamento nem promete condições inexistentes.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`cz:${ipFrom(req)}`, 30, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas mensagens. Aguarde um instante.' }, { status: 429 });
  try {
    const { businessId, message } = await req.json();
    const db = await readDB();
    const business = db.businesses.find((b) => b.id === businessId);
    if (!business) return NextResponse.json({ error: 'Negócio não encontrado.' }, { status: 404 });

    const agent = agentFor(db, business);
    // Módulo desligado ou agente desativado ⇒ assistente indisponível.
    if (!isFeatureEnabled(business, 'agent') || !agent.enabled) {
      return NextResponse.json({ error: 'O assistente não está disponível.', code: 'agent_disabled' }, { status: 403 });
    }

    const raw = String(message || '').slice(0, 500);
    const faqBlock = db.pages
      .find((p) => p.businessId === business.id)
      ?.blocks.find((b) => b.type === 'faq' && b.enabled !== false);
    const faq = isFeatureEnabled(business, 'faq') ? visibleFaqItems(faqBlock?.settings?.items) : [];

    const answer = conciergeAnswer(db, business, raw, { agent, faq });
    const services = db.services.filter((s) => s.businessId === business.id && s.active !== false);
    const reply = answer.intent === 'greeting'
      ? renderGreeting(agent, business.name)
      : applyAgentVoice(agent, business.name, answer.reply, answer.intent);

    // Ações sugeridas seguem os objetivos configurados E os módulos ligados.
    const configured = objectiveActions(agent, {
      canBook: canBookModule(business, services),
      hasProducts: isFeatureEnabled(business, 'products') || isFeatureEnabled(business, 'orders'),
      hasQuote: isFeatureEnabled(business, 'quote'),
      hasWhatsapp: whatsappVisible(business),
    });
    const actions = answer.intent === 'greeting' && configured.length > 0 ? configured.slice(0, 3) : answer.actions;

    const customer = await customerFromRequest(req);
    await updateDB((d) => {
      const now = new Date().toISOString();
      d.events.push({ id: randomUUID(), businessId, type: 'ai_started', path: '', meta: { intent: answer.intent, agent: agent.name }, createdAt: now });
      // CRM: interesse captado vira/atualiza lead — nunca cria agendamento.
      if (customer && agent.objectives.includes('interesse') && raw.trim().length > 3 && answer.intent !== 'greeting') {
        const digits = onlyDigits(customer.phone || '');
        const existing = d.leads.find((l) =>
          l.businessId === businessId &&
          ((l.customerId && l.customerId === customer.id) || (digits && onlyDigits(l.phone) === digits)));
        if (existing) {
          existing.lastInteraction = now;
          if (existing.status === 'new') existing.status = 'contacted';
          if (answer.intent === 'interest') existing.interest = raw.slice(0, 200);
        } else {
          d.leads.push({
            id: randomUUID(), businessId, customerId: customer.id,
            name: customer.name || '', phone: digits, email: customer.email || '',
            instagram: '', origin: 'agente', interest: raw.slice(0, 200),
            action: 'conversa_agente', status: 'new', createdAt: now, lastInteraction: now,
          });
          d.events.push({ id: randomUUID(), businessId, type: 'lead_created', path: '', meta: { origin: 'agente' }, createdAt: now });
        }
      }
    });

    return NextResponse.json({
      reply, actions, intent: answer.intent,
      agent: { name: agent.name, tone: agent.tone },
      handoff: answer.intent === 'fallback',
    });
  } catch {
    return NextResponse.json({
      reply: 'Tive um probleminha aqui. Fale com a gente no WhatsApp!',
      actions: [{ label: 'Falar no WhatsApp', target: 'whatsapp' }],
      intent: 'error',
    });
  }
}
