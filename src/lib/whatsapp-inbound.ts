import { logWhatsapp } from '@/lib/whatsapp-log';
import { randomUUID } from 'node:crypto';
import { updateDB } from '@/lib/db';
import { upsertContact, findContact } from '@/lib/contacts';
import { phoneKey } from '@/lib/whatsapp';
import { agentFor, agentActive } from '@/lib/agent';
import { conciergeAnswer } from '@/lib/concierge';
import { createBookingTx } from '@/lib/booking-create';
import { findLead, ingestLead } from '@/lib/pipeline';
import { onlyDigits } from '@/lib/utils';
import { visibleFaqItems } from '@/lib/faq';
import { formatDateBR } from '@/lib/tz';
import { deliverWhatsappMessage } from '@/lib/whatsapp-cloud-api';
import type { Message, Conversation, WhatsappProvider } from '@/lib/types';


/** Provider adapters resolve tenant from persisted bindings BEFORE calling this service.
 * All business effects + inbound idempotency + outbound are one DB transaction.
 * External HTTP remains outside the transaction. No vendor payloads here.
 */
export interface NormalizedWhatsappInbound {
  provider: WhatsappProvider;
  businessId: string;
  externalId: string;
  phone: string;
  name: string;
  body: string;
  timestamp?: string;
  instance?: string;
}

export async function processWhatsappInbound(input: NormalizedWhatsappInbound) {
  const { businessId, provider } = input;
  const newOutboundMessageIds = await updateDB((d) => {
    const business = d.businesses.find((b) => b.id === businessId);
    if (!business?.whatsappIntegration || (business.whatsappIntegration.provider || 'meta_cloud') !== provider) return { ids: [] as string[], status: 'ignored' };
    if (provider === 'whatsapp_web' && (business.whatsappIntegration.instanceName !== input.instance || business.whatsappIntegration.status !== 'connected')) return { ids: [] as string[], status: 'ignored' };
    const b = business;
    const now = new Date().toISOString();
    const newOutboundMessageIds: string[] = [];
    let processed = false;
    const messages = [input];
    // Processar a entrada normalizada no mesmo pipeline de negócio.
    for (const m of messages) {
      const rawDigits = onlyDigits(m.phone);
      const digits = phoneKey(m.phone);
      if ((!digits && !rawDigits) || !m.externalId || !m.body.trim()) continue;

      // Deduplicação estrita por unidade + provider + ID externo
      if (m.externalId && d.messages.some((x) => x.externalId === m.externalId && x.businessId === businessId && x.direction === 'in' && (x.whatsappProvider || 'meta_cloud') === provider)) {
        continue;
      }

      // Reconhecimento de pessoa (Contato existente vs Novo contato)
      const existingContact = findContact(d, businessId, '', digits) || (rawDigits ? findContact(d, businessId, '', rawDigits) : undefined);
      const existingCustomer = existingContact?.customerId
        ? d.customers.find((c) => c.id === existingContact.customerId)
        : d.customers.find((c) => c.phone && (onlyDigits(c.phone) === digits || onlyDigits(c.phone) === rawDigits));
      const isKnown = !!(existingContact || existingCustomer);

      let contact = existingContact || null;
      let leadId: string | undefined;

      if (!isKnown) {
        contact = upsertContact(d, {
          businessId,
          name: m.name,
          phone: digits,
          source: 'whatsapp',
          now,
        });

        try {
          const ingestRes = ingestLead(d, {
            businessId,
            customerId: contact?.customerId || undefined,
            name: m.name || contact?.name || '',
            phone: digits,
            source: 'whatsapp',
            channel: 'whatsapp',
            message: m.body,
            now,
          });
          leadId = ingestRes.lead.id;
        } catch { /* ingestLead defensivo */ }
      } else {
        contact = upsertContact(d, {
          businessId,
          customerId: existingCustomer?.id || existingContact?.customerId,
          name: existingContact?.name || existingCustomer?.name || m.name,
          phone: digits,
          source: 'whatsapp',
          now,
        });

        const activeLead = findLead(d, businessId, {
          customerId: contact?.customerId || existingCustomer?.id,
          phone: digits,
        });
        if (activeLead) leadId = activeLead.id;
      }

      // Conversa única ligada à pessoa
      const existingConv = d.conversations.find((c) => c.businessId === businessId && c.channel === 'whatsapp' && (c.phone === digits || (c.channelUserId && (c.channelUserId === rawDigits || c.channelUserId === digits))));
      let conv: Conversation;
      if (!existingConv) {
        conv = {
          id: randomUUID(),
          businessId,
          channel: 'whatsapp',
          channelUserId: rawDigits || digits,
          contactId: contact?.id || '',
          customerId: contact?.customerId || existingCustomer?.id || '',
          name: contact?.name || m.name || digits,
          phone: digits,
          status: 'open',
          mode: 'automation',
          unread: 0,
          lastMessageAt: now,
          lastMessagePreview: m.body.slice(0, 120),
          createdAt: now,
          context: leadId ? { leadId } : {},
        };
        d.conversations.push(conv);
      } else {
        conv = existingConv;
        conv.channelUserId = rawDigits || digits;
        conv.contactId = contact?.id || conv.contactId;
        conv.customerId = contact?.customerId || existingCustomer?.id || conv.customerId;
        if (!conv.mode) conv.mode = 'automation';
        if (leadId && (!conv.context || !conv.context.leadId)) {
          conv.context = { ...(conv.context || {}), leadId };
        }
      }

      // Grava mensagem inbound
      const inMsg: Message = {
        id: randomUUID(),
        businessId,
        conversationId: conv.id,
        direction: 'in',
        body: m.body,
        status: 'delivered',
        externalId: m.externalId,
        whatsappProvider: provider,
        channel: 'whatsapp',
        by: 'contact',
        byName: contact?.name || m.name || 'Cliente',
        at: now,
      };
      d.messages.push(inMsg);
      processed = true;

      conv.unread = (conv.unread || 0) + 1;
      conv.lastMessageAt = now;
      conv.lastMessagePreview = m.body.slice(0, 120);
      b.whatsappIntegration!.lastInboundAt = now;

      // 3.3. Atendimento Concierge / Agente (Silenciado em modo humano)
      if (conv.mode === 'human') {
        continue;
      }

      const wantsHuman = /\b(humano|atendente|falar com (uma )?pessoa|falar com atendente|suporte humano|atendente humano)\b/i.test(m.body);
      const activeAgent = agentFor(d, business);
      const automationEnabled = agentActive(business, activeAgent, 'whatsapp') && activeAgent.channels?.whatsapp;
      if (wantsHuman) {
        conv.mode = 'human';
        conv.context = { ...(conv.context || {}), flow: null };
        if (!automationEnabled) continue;
        const agent = agentFor(d, business);
        const replyText = agent.handoffMessage || 'Vou transferir seu atendimento para a nossa equipe. Um atendente já vai te responder por aqui!';
        const outId = randomUUID();
        d.messages.push({
          meta: { handoff: true, agentReply: true },
          id: outId,
          businessId,
          conversationId: conv.id,
          direction: 'out',
          body: replyText,
          status: 'pending',
          externalId: '',
          whatsappProvider: provider,
          channel: 'whatsapp',
          by: 'automation',
          byName: 'Automação',
          at: now,
        });
        conv.lastMessageAt = now;
        conv.lastMessagePreview = replyText.slice(0, 120);
        newOutboundMessageIds.push(outId);
        continue;
      }

      try {
        const agent = agentFor(d, business);
        if (agentActive(business, agent, 'whatsapp') && agent.channels?.whatsapp) {
          const contactName = (contact?.name || '').trim();
          const answer = conciergeAnswer(d, business, m.body, {
            agent,
            faq: visibleFaqItems(d.pages.find((p) => p.businessId === businessId)?.blocks.find((b) => b.type === 'faq')?.settings?.items),
            flow: conv.context?.flow || null,
            flowCtx: {
              channelPhone: digits,
              channelName: contactName,
              customer: existingCustomer || null,
            },
          });

          let reply = answer.reply;
          // O WhatsApp de texto não tem os botões do chat web.
          const choices = answer.actions.filter((a) => a.target === 'flow' && ['service', 'day'].includes(a.payload?.kind));
          if (choices.length) reply += '\n' + choices.map((a) => a.label).join(' · ');

          // Conclusão de agendamento: cria Booking REAL e move lead para scheduled
          if (answer.bookingRequest) {
            const rq = answer.bookingRequest;
            const svc = d.services.find((sv) => sv.id === rq.serviceId && sv.businessId === businessId);
            const phoneDigits = onlyDigits(rq.phone || digits);

            if (svc && phoneDigits.length >= 10) {
              try {
                const bookingRes = createBookingTx(d, {
                  business,
                  service: svc,
                  date: rq.date,
                  time: rq.time,
                  actor: 'agent',
                  customer: {
                    id: existingCustomer?.id || contact?.customerId || '',
                    name: rq.name || contactName || 'Cliente',
                    phone: phoneDigits,
                  },
                  source: 'whatsapp',
                  leadId: conv.context?.leadId || leadId,
                });
                const proName = bookingRes.professionalName ? ` com ${bookingRes.professionalName}` : '';
                reply = `Agendado! ${svc.name} em ${formatDateBR(rq.date)} às ${rq.time}${proName}. A ${business.name} confirma por aqui em instantes.`;
              } catch {
                answer.flow = { step: 'pick_slot', serviceId: rq.serviceId, date: rq.date };
                reply = 'Esse horário acabou de ser ocupado. Por favor, escolha outro horário ou dia que reservo para você na hora.';
              }
            }
          }

          if (reply && reply.trim()) {
            const outId = randomUUID();
            d.messages.push({
              id: outId,
              meta: { agentReply: true },
              businessId,
              conversationId: conv.id,
              direction: 'out',
              body: reply.slice(0, 2000),
              status: 'pending',
              externalId: '',
              whatsappProvider: provider,
              channel: 'whatsapp',
              by: 'automation',
              byName: 'Automação',
              at: now,
            });
            conv.lastMessageAt = now;
            conv.lastMessagePreview = reply.slice(0, 120);
            newOutboundMessageIds.push(outId);
          }

          conv.context = {
            ...(conv.context || {}),
            flow: answer.flow || null,
          };
        }
      } catch {
        b.whatsappIntegration!.lastError = 'Falha ao processar o atendimento automático.';
        b.whatsappIntegration!.lastErrorAt = now;
      }
    }

    return { ids: newOutboundMessageIds, status: processed ? 'processed' : 'duplicate_or_invalid' };
  });
  logWhatsapp({ provider, businessId, instance: input.instance, direction: 'in', event: 'inbound', externalId: input.externalId, status: newOutboundMessageIds.status });
  for (const id of newOutboundMessageIds.ids) await deliverWhatsappMessage(businessId, id);
  return { outbound: newOutboundMessageIds.ids.length };
}
