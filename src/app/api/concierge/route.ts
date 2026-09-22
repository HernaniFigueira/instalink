import { NextRequest, NextResponse } from 'next/server';
import { blockIfRelational } from '@/lib/relational/blocked';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { conciergeAnswer } from '@/lib/concierge';
import { agentFor, applyAgentVoice, objectiveActions, renderGreeting } from '@/lib/agent';
import { bookingDoneReply, type AgentFlowState } from '@/lib/agent-flow';
import { createBookingTx } from '@/lib/booking-create';
import { canBook as canBookModule, isFeatureEnabled, whatsappVisible } from '@/lib/features';
import { visibleFaqItems } from '@/lib/faq';
import { customerFromRequest } from '@/lib/customer-auth';
import { onlyDigits } from '@/lib/utils';
import { ingestLead, getBusinessPipeline, normalizeLeadStageId, stageForLegacyStatus, moveLeadStage } from '@/lib/pipeline';
import { rateLimit, ipFrom } from '@/lib/rate-limit';
import type { DB } from '@/lib/types';

// POST público: pergunta ao AGENTE DE ATENDIMENTO da empresa.
// O agente é configurável (nome, saudação, tom, objetivos, orientações,
// limitações e handoff) e responde SOMENTE com dados reais do negócio.
//
// ASSISTENTE × AGENDA: quando o visitante quer agendar, o agente consulta a
// disponibilidade REAL (mesmo motor da Agenda) e cria o Booking pelo caminho
// único (lib/booking-create.ts) — nunca um mecanismo paralelo. Cliente novo é
// identificado pelo WhatsApp informado no chat (sem exigir conta completa);
// cliente conhecido é reaproveitado do CRM (não pergunta o nome de novo).
export async function POST(req: NextRequest) {
  const blocked = blockIfRelational('Concierge');
  if (blocked) return blocked;

  const rl = rateLimit(`cz:${ipFrom(req)}`, 30, 60000);
  if (!rl.ok) return NextResponse.json({ error: 'Muitas mensagens. Aguarde um instante.' }, { status: 429 });
  try {
    const { businessId, message, flow: flowIn, action } = await req.json();
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

    const customer = await customerFromRequest(req);
    const answer = conciergeAnswer(db, business, raw, {
      agent,
      faq,
      flow: (flowIn && typeof flowIn === 'object' && flowIn.step ? flowIn : null) as AgentFlowState | null,
      action: action && typeof action === 'object' ? action : null,
      flowCtx: {
        customer: customer
          ? { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email }
          : null,
      },
    });

    // ── Execução do agendamento (o fluxo só PLANEJA; aqui se cria de verdade) ──
    if (answer.bookingRequest) {
      const reqBooking = answer.bookingRequest;
      if (!isFeatureEnabled(business, 'bookings')) {
        return NextResponse.json({
          reply: 'No momento os agendamentos por aqui estão desativados. Chama a gente no WhatsApp!',
          actions: [{ label: 'Falar no WhatsApp', target: 'whatsapp' }],
          intent: 'booking_unavailable', flow: null, handoff: true,
        });
      }
      try {
        const service = db.services.find((s) => s.id === reqBooking.serviceId && s.businessId === business.id);
        const digits = onlyDigits(reqBooking.phone);
        if (!service || !reqBooking.name || digits.length < 10) {
          return NextResponse.json({
            reply: 'Faltou algum dado para fechar o horário. Me diz seu nome e WhatsApp (com DDD) que eu confirmo agora.',
            actions: [], intent: 'flow_ask_identity',
            flow: { step: 'identify', serviceId: reqBooking.serviceId, date: reqBooking.date, time: reqBooking.time },
          });
        }
        const result = await updateDB((d: DB) => createBookingTx(d, {
          business,
          service,
          date: reqBooking.date,
          time: reqBooking.time,
          actor: 'agent',
          customer: reqBooking.customer && reqBooking.customer.id
            ? reqBooking.customer
            : { id: '', name: reqBooking.name, phone: digits },
          source: 'agente',
        }));
        const done = bookingDoneReply(business.name, {
          date: reqBooking.date,
          time: reqBooking.time,
          serviceName: service.name,
          professionalName: result.professionalName,
        });
        return NextResponse.json({
          reply: done.reply,
          actions: [{ label: 'Ver na página', target: '#servicos' }],
          intent: done.intent,
          flow: null,
          agent: { name: agent.name, tone: agent.tone },
          booking: { id: result.bookingId, date: reqBooking.date, time: reqBooking.time },
        });
      } catch (e: any) {
        // Slot ocupado/dados inválidos: o agente NÃO insiste — oferece o caminho
        // humano ou o fluxo oficial da página.
        const status = e?.status || 500;
        if (status === 409) {
          return NextResponse.json({
            reply: 'Esse horário acabou de ser ocupado. Quer que eu mostre outros horários?',
            actions: [{ label: 'Ver outros horários', target: 'flow', payload: { kind: 'other_times', serviceId: reqBooking.serviceId, date: reqBooking.date } }],
            intent: 'flow_conflict',
            flow: { step: 'pick_slot', serviceId: reqBooking.serviceId },
            agent: { name: agent.name, tone: agent.tone },
          });
        }
        return NextResponse.json({
          reply: 'Tive um probleminha para fechar esse horário. O botão abaixo abre o agendamento oficial da página — ou me chama no WhatsApp!',
          actions: [{ label: 'Agendar horário', target: '#agendar' }, { label: 'Falar no WhatsApp', target: 'whatsapp' }],
          intent: 'booking_error', flow: null, handoff: true,
        });
      }
    }

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
    const isFlowIntent = String(answer.intent || '').startsWith('flow_');
    const actions = answer.intent === 'greeting' && configured.length > 0
      ? configured.slice(0, 3)
      : answer.actions;

    await updateDB((d) => {
      const now = new Date().toISOString();
      d.events.push({ id: randomUUID(), businessId, type: 'ai_started', path: '', meta: { intent: answer.intent, agent: agent.name }, createdAt: now });
      // CRM: interesse captado via ingestLead (única porta) — preserva pipeline,
      // stageHistory e gatilhos P4. O AGENDAMENTO em si só acontece pelo fluxo acima (createBookingTx).
      if (customer && agent.objectives.includes('interesse') && raw.trim().length > 3 && answer.intent !== 'greeting' && !isFlowIntent) {
        try {
          // ingestLead imported statically
          const digits = onlyDigits(customer.phone || '');
          const existing = d.leads.find((l) =>
            l.businessId === businessId &&
            ((l.customerId && l.customerId === customer.id) || (digits && onlyDigits(l.phone) === digits)));
          if (existing) {
            existing.lastInteraction = now;
            // A3: não escreve status cru; usa máquina oficial para avançar de new para contacted quando aplicável
            if (answer.intent === 'interest') existing.interest = raw.slice(0, 200);
            // Se lead ainda em 'new', move para etapa correspondente a 'contacted' via máquina oficial
            try {
              // pipeline helpers imported statically
              const pipeline = getBusinessPipeline(d, businessId);
              const currentStage = normalizeLeadStageId(pipeline, existing);
              if (currentStage === 'new') {
                const target = stageForLegacyStatus(pipeline, 'contacted');
                if (target) moveLeadStage(d, { businessId, leadId: existing.id, toStageId: target, actor: { id: 'agent', name: agent.name }, now });
              }
            } catch {}
          } else {
            // ingest imported statically
            const res = ingestLead(d, {
              businessId,
              customerId: customer.id,
              name: customer.name || '',
              phone: digits,
              email: customer.email || '',
              interest: raw.slice(0, 200),
              source: 'agente',
              actor: { id: customer.id, name: customer.name || 'Cliente', type: 'customer' },
              now,
            });
            res.lead.action = 'conversa_agente';
          }
        } catch (e) {
          // CRM auxiliar falhou: não cria lead paralelo, apenas não persiste CRM.
          // Operação principal do assistente permanece (reply já resolvido).
          // Em prod, log discreto para observabilidade.
          void e;
        }
      }
    });

    return NextResponse.json({
      reply, actions, intent: answer.intent,
      flow: answer.flow || null,
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
