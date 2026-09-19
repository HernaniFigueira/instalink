import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { upsertContact, findContact } from '@/lib/contacts';
import { phoneKey, webhookVerifyToken } from '@/lib/whatsapp';
import { pushAudit } from '@/lib/audit';
import { agentFor, agentActive } from '@/lib/agent';
import { conciergeAnswer } from '@/lib/concierge';
import { createBookingTx } from '@/lib/booking-create';
import { findLead, ingestLead } from '@/lib/pipeline';
import { onlyDigits } from '@/lib/utils';
import { formatDateBR } from '@/lib/tz';
import {
  deliverWhatsappMessage,
  verifyMetaWebhookSignature,
} from '@/lib/whatsapp-cloud-api';
import type { Message, Conversation } from '@/lib/types';

// WEBHOOK do WhatsApp oficial (provedor → InstaLink).
// GET  ?hub.mode=subscribe&hub.verify_token=… → handshake de verificação.
// POST → recebe mensagens e atualizações de status da Meta.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const mode = q.get('hub.mode');
  const token = q.get('hub.verify_token') || '';
  const challenge = q.get('hub.challenge') || '';
  const expected = webhookVerifyToken();

  if (!expected) {
    return NextResponse.json({ error: 'Webhook não configurado (WHATSAPP_VERIFY_TOKEN ausente).' }, { status: 503 });
  }
  if (mode === 'subscribe' && token === expected) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return NextResponse.json({ error: 'Verificação inválida.' }, { status: 403 });
}

interface IncomingMessage {
  externalId: string;
  phone: string;
  name: string;
  body: string;
}

interface IncomingStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipientId: string;
  timestamp: string;
  errors?: Array<{ code: number; title: string; message?: string }>;
}

function readWebhookPayload(payload: any): { messages: IncomingMessage[]; statuses: IncomingStatus[] } {
  const messages: IncomingMessage[] = [];
  const statuses: IncomingStatus[] = [];

  const pushMsg = (m: any, defaultName = '') => {
    const phone = String(m?.from || m?.phone || '');
    const body = String(m?.text?.body ?? m?.body ?? '').slice(0, 4000);
    const externalId = String(m?.id || m?.externalId || '');
    if (!phone && !externalId) return;
    const name = String(m?.profile?.name || m?.name || defaultName || '').slice(0, 80);
    messages.push({
      externalId,
      phone,
      name,
      body,
    });
  };

  const pushStatus = (s: any) => {
    const id = String(s?.id || '');
    const status = s?.status;
    if (!id || !['sent', 'delivered', 'read', 'failed'].includes(status)) return;
    statuses.push({
      id,
      status,
      recipientId: String(s?.recipient_id || ''),
      timestamp: String(s?.timestamp || ''),
      errors: Array.isArray(s?.errors) ? s.errors : undefined,
    });
  };

  if (Array.isArray(payload?.messages)) payload.messages.forEach((m: any) => pushMsg(m));
  if (Array.isArray(payload?.statuses)) payload.statuses.forEach(pushStatus);

  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const val = change?.value;
      const contactMap = new Map<string, string>();
      if (Array.isArray(val?.contacts)) {
        for (const c of val.contacts) {
          if (c?.wa_id && c?.profile?.name) {
            contactMap.set(String(c.wa_id), String(c.profile.name));
          }
        }
      }

      if (Array.isArray(val?.messages)) {
        val.messages.forEach((m: any) => {
          const from = String(m?.from || '');
          const mappedName = contactMap.get(from) || '';
          pushMsg(m, mappedName);
        });
      }
      if (Array.isArray(val?.statuses)) val.statuses.forEach(pushStatus);
    }
  }

  return { messages, statuses };
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-hub-signature-256');

    // Validação de autenticidade (segredo do App Meta)
    if (!verifyMetaWebhookSignature(rawBody, signature)) {
      return NextResponse.json({ error: 'Assinatura do webhook inválida.' }, { status: 403 });
    }

    const payload = JSON.parse(rawBody || '{}');
    const { messages, statuses } = readWebhookPayload(payload);

    if (messages.length === 0 && statuses.length === 0) {
      return NextResponse.json({ ok: true, received: 0 });
    }

    // Identificador oficial da conta Meta (phone_number_id e waba_id)
    const phoneNumberId = String(
      payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ||
      payload?.phoneNumberId ||
      '',
    );
    const wabaId = String(payload?.entry?.[0]?.id || payload?.wabaId || '');

    const db = await readDB();
    const business = db.businesses.find((b) => {
      const wi = b.whatsappIntegration;
      if (!wi) return false;
      if (phoneNumberId && wi.phoneNumberId === phoneNumberId) return true;
      if (wabaId && wi.wabaId === wabaId) return true;
      return false;
    });

    if (!business) {
      // Sem empresa mapeada: confirma o recebimento e não vaza dados para outra unidade
      return NextResponse.json({ ok: true, received: 0, mapped: false });
    }

    const newOutboundMessageIds: string[] = [];

    await updateDB((d) => {
      const now = new Date().toISOString();
      const b = d.businesses.find((x) => x.id === business.id)!;
      if (!b.whatsappIntegration) {
        b.whatsappIntegration = {
          status: 'not_connected', displayPhone: '', phoneNumberId: '', wabaId: '',
          connectedAt: '', lastWebhookAt: '', requestedAt: '',
        };
      }
      b.whatsappIntegration.lastWebhookAt = now;

      // ── 1. PROCESSAR ATUALIZAÇÕES DE STATUS (sent, delivered, read, failed) ──
      for (const st of statuses) {
        const target = d.messages.find((m) => m.externalId === st.id && m.businessId === business.id);
        if (target) {
          target.status = st.status;
          if (st.status === 'failed') {
            const errDetail = st.errors?.[0]?.message || st.errors?.[0]?.title || 'Mensagem rejeitada pela Meta.';
            target.error = errDetail;
            b.whatsappIntegration.lastError = errDetail;
            b.whatsappIntegration.lastErrorAt = now;
          }
        }
      }

      // ── 2. PROCESSAR MENSAGENS INBOUND ──
      for (const m of messages) {
        const rawDigits = onlyDigits(m.phone);
        const digits = phoneKey(m.phone);
        if (!digits && !rawDigits) continue;

        // Dedupe de reentrega da Meta
        if (m.externalId && d.messages.some((x) => x.externalId === m.externalId && x.businessId === business.id)) {
          continue;
        }

        // Reconhecimento canônico de pessoa (Novo Contato × Cliente Existente)
        const existingContact = findContact(d, business.id, '', digits) || (rawDigits ? findContact(d, business.id, '', rawDigits) : undefined);
        const existingCustomer = existingContact?.customerId
          ? d.customers.find((c) => c.id === existingContact.customerId)
          : d.customers.find((c) => c.phone && (onlyDigits(c.phone) === digits || onlyDigits(c.phone) === rawDigits));
        const isKnown = !!(existingContact || existingCustomer);

        let contact = existingContact || null;
        let leadId: string | undefined;

        if (!isKnown) {
          // NOVO CONTATO: WhatsApp inbound → upsertContact → ingestLead
          contact = upsertContact(d, {
            businessId: business.id,
            name: m.name,
            phone: digits,
            source: 'whatsapp',
            now,
          });

          try {
            const ingestRes = ingestLead(d, {
              businessId: business.id,
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
          // CLIENTE EXISTENTE: atualiza contato sem criar Lead desnecessário
          contact = upsertContact(d, {
            businessId: business.id,
            customerId: existingCustomer?.id || existingContact?.customerId,
            name: existingContact?.name || existingCustomer?.name || m.name,
            phone: digits,
            source: 'whatsapp',
            now,
          });

          // Recupera lead ativo se existir
          const activeLead = findLead(d, business.id, {
            customerId: contact?.customerId || existingCustomer?.id,
            phone: digits,
          });
          if (activeLead) leadId = activeLead.id;
        }

        // Conversa única ligada à pessoa
        const existingConv = d.conversations.find((c) => c.businessId === business.id && (c.phone === digits || (c.channelUserId && (c.channelUserId === rawDigits || c.channelUserId === digits))));
        let conv: Conversation;
        if (!existingConv) {
          conv = {
            id: randomUUID(),
            businessId: business.id,
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
          businessId: business.id,
          conversationId: conv.id,
          direction: 'in',
          body: m.body,
          status: 'delivered',
          externalId: m.externalId,
          by: 'contact',
          byName: contact?.name || m.name || 'Cliente',
          at: now,
        };
        d.messages.push(inMsg);

        conv.unread = (conv.unread || 0) + 1;
        conv.lastMessageAt = now;
        conv.lastMessagePreview = m.body.slice(0, 120);
        b.whatsappIntegration.lastInboundAt = now;

        // ── 3. ATENDIMENTO PELO AGENTE / CONCIERGE ──
        // Se a conversa estiver em modo humano, a automação NÃO responde
        if (conv.mode === 'human') {
          continue;
        }

        // Handoff explícito solicitado pelo cliente
        const wantsHuman = /\b(humano|atendente|falar com (uma )?pessoa|falar com atendente|suporte humano|atendente humano)\b/i.test(m.body);
        if (wantsHuman) {
          conv.mode = 'human';
          const agent = agentFor(d, business);
          const replyText = agent.handoffMessage || 'Vou transferir seu atendimento para a nossa equipe. Um atendente já vai te responder por aqui!';
          const outId = randomUUID();
          d.messages.push({
            id: outId,
            businessId: business.id,
            conversationId: conv.id,
            direction: 'out',
            body: replyText,
            status: 'pending',
            externalId: '',
            by: 'automation',
            byName: 'Automação',
            at: now,
          });
          conv.lastMessageAt = now;
          conv.lastMessagePreview = replyText.slice(0, 120);
          newOutboundMessageIds.push(outId);
          continue;
        }

        // Triagem inteligente com dados reais e regras de agendamento
        try {
          const agent = agentFor(d, business);
          if (agentActive(business, agent) && agent.channels?.whatsapp) {
            const contactName = (contact?.name || '').trim();
            const answer = conciergeAnswer(d, business, m.body, {
              agent,
              flow: conv.context?.flow || null,
              flowCtx: {
                channelPhone: digits,
                channelName: contactName,
                customer: existingCustomer || null,
              },
            });

            let reply = answer.reply;

            // Se o fluxo concluiu intenção de agendamento: cria Booking REAL
            if (answer.bookingRequest) {
              const rq = answer.bookingRequest;
              const svc = d.services.find((sv) => sv.id === rq.serviceId && sv.businessId === business.id);
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
                  reply = 'Esse horário acabou de ser ocupado. Por favor, escolha outro horário ou dia que reservo para você na hora.';
                }
              }
            }

            if (reply && reply.trim()) {
              const outId = randomUUID();
              d.messages.push({
                id: outId,
                businessId: business.id,
                conversationId: conv.id,
                direction: 'out',
                body: reply.slice(0, 2000),
                status: 'pending',
                externalId: '',
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
          // Agente é melhor esforço; mensagem do cliente permanece gravada
        }
      }

      pushAudit(d, {
        action: 'whatsapp.webhook_received',
        actor: { id: 'system', email: 'webhook@instalink.app', role: 'system' },
        businessId: business.id,
        meta: { messages: messages.length, statuses: statuses.length },
      });
    });

    // ── 4. DISPARO REAL PÓS-COMMIT (FORA DO LOCK DO BANCO) ──
    // Entrega mensagens pendentes geradas nesta rodada
    for (const msgId of newOutboundMessageIds) {
      try {
        await deliverWhatsappMessage(business.id, msgId);
      } catch {
        // Falha pós-commit é tratada e agendada para retry
      }
    }

    return NextResponse.json({
      ok: true,
      received: messages.length + statuses.length,
      mapped: true,
    });
  } catch (err) {
    console.error('[WHATSAPP WEBHOOK POST ERROR]', err);
    return NextResponse.json({ error: 'Falha ao processar o webhook.' }, { status: 500 });
  }
}
