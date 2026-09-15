import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { upsertContact } from '@/lib/contacts';
import { phoneKey, webhookVerifyToken } from '@/lib/whatsapp';
import { pushAudit } from '@/lib/audit';
import { agentFor, agentActive } from '@/lib/agent';
import { conciergeAnswer } from '@/lib/concierge';
import { createBookingTx } from '@/lib/booking-create';
import { onlyDigits } from '@/lib/utils';

// WEBHOOK do WhatsApp oficial (provedor → InstaLink).
// GET  ?hub.mode=subscribe&hub.verify_token=… → handshake de verificação.
// POST → recebe mensagens. Só processa quando o servidor tem o token de
//        verificação configurado; nada aqui inventa integração.
//
// Estrutura preparada: cria/atualiza CONVERSA + MENSAGEM, associa ao CONTATO
// do CRM (por telefone) e guarda o id externo (dedupe de reentrega).
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

// Normaliza o payload do provedor de forma defensiva (aceita o formato
// clássico do WhatsApp Cloud API e um formato simples { messages: [...] }).
function readMessages(payload: any): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  const push = (m: any) => {
    const phone = String(m?.from || m?.phone || '');
    const body = String(m?.text?.body ?? m?.body ?? '').slice(0, 2000);
    const externalId = String(m?.id || m?.externalId || '');
    if (!phone && !externalId) return;
    out.push({ externalId, phone, name: String(m?.profile?.name || m?.name || '').slice(0, 80), body });
  };
  if (Array.isArray(payload?.messages)) payload.messages.forEach(push);
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      for (const m of change?.value?.messages || []) push(m);
    }
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    if (!webhookVerifyToken()) {
      return NextResponse.json({ error: 'Webhook não configurado.' }, { status: 503 });
    }
    const payload = await req.json().catch(() => ({}));
    const messages = readMessages(payload);
    if (messages.length === 0) return NextResponse.json({ ok: true, received: 0 });

    const db = await readDB();
    // Cada mensagem chega com o identificador da conta oficial de destino.
    const phoneNumberId = String(
      payload?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id || payload?.phoneNumberId || '',
    );
    const business = db.businesses.find((b) =>
      b.whatsappIntegration?.phoneNumberId && b.whatsappIntegration.phoneNumberId === phoneNumberId);
    if (!business) {
      // Sem empresa mapeada: confirma o recebimento e não inventa conversa.
      return NextResponse.json({ ok: true, received: messages.length, mapped: false });
    }

    const saved = await updateDB((d) => {
      let count = 0;
      const now = new Date().toISOString();
      for (const m of messages) {
        const digits = phoneKey(m.phone);
        if (!digits) continue;
        if (m.externalId && d.messages.some((x) => x.externalId === m.externalId && x.businessId === business.id)) continue;
        const contact = upsertContact(d, {
          businessId: business.id, name: m.name, phone: digits, source: 'whatsapp', now,
        });
        let conv = d.conversations.find((c) => c.businessId === business.id && c.phone === digits);
        if (!conv) {
          conv = {
            id: randomUUID(), businessId: business.id, channel: 'whatsapp',
            contactId: contact?.id || '', customerId: contact?.customerId || '',
            name: contact?.name || m.name || digits, phone: digits,
            status: 'open', unread: 0, lastMessageAt: now, lastMessagePreview: m.body.slice(0, 120),
            createdAt: now,
          };
          d.conversations.push(conv);
        }
        d.messages.push({
          id: randomUUID(), businessId: business.id, conversationId: conv.id,
          direction: 'in', body: m.body, status: 'delivered',
          externalId: m.externalId, by: 'contact', at: now,
        });
        conv.contactId = contact?.id || conv.contactId;
        conv.customerId = contact?.customerId || conv.customerId;
        conv.status = 'open';
        conv.unread = (conv.unread || 0) + 1;
        conv.lastMessageAt = now;
        conv.lastMessagePreview = m.body.slice(0, 120);

        // ── MESMO ASSISTENTE no WhatsApp (sem duplicar inteligência) ──
        // A resposta nasce na FILA (status 'pending'): só a integração oficial
        // entrega. Nada é marcado como enviado sem ter sido.
        try {
          const agent = agentFor(d, business);
          if (agentActive(business, agent) && agent.channels?.whatsapp) {
            const contactName = (contact?.name || '').trim();
            const answer = conciergeAnswer(d, business, m.body, {
              agent,
              flow: (conv.context && conv.context.flow) || null,
              flowCtx: { channelPhone: digits, channelName: contactName },
            });
            let reply = answer.reply;
            if (answer.bookingRequest) {
              const rq = answer.bookingRequest;
              const svc = d.services.find((sv) => sv.id === rq.serviceId && sv.businessId === business.id);
              const phoneDigits = onlyDigits(rq.phone || digits);
              if (svc && rq.name && phoneDigits.length >= 10) {
                try {
                  createBookingTx(d, {
                    business, service: svc, date: rq.date, time: rq.time,
                    actor: 'agent',
                    customer: { id: '', name: rq.name, phone: phoneDigits },
                    source: 'whatsapp',
                  });
                  reply = `Agendado! ${svc.name} em ${rq.date.split('-').reverse().join('/')} às ${rq.time}. A ${business.name} confirma por aqui em instantes.`;
                } catch {
                  reply = 'Esse horário acabou de ocupar — me diz outro dia/horário que eu reservo na hora.';
                }
              }
            }
            if (reply && reply.trim()) {
              d.messages.push({
                id: randomUUID(), businessId: business.id, conversationId: conv.id,
                direction: 'out', body: reply.slice(0, 2000), status: 'pending',
                externalId: '', by: 'automation', at: now,
              });
              conv.lastMessageAt = now;
              conv.lastMessagePreview = reply.slice(0, 120);
            }
            conv.context = { ...(conv.context || {}), flow: answer.flow || null };
          }
        } catch { /* resposta do agente é melhor-esforço: a mensagem do cliente já está salva */ }
        count += 1;
      }
      const b = d.businesses.find((x) => x.id === business.id)!;
      b.whatsappIntegration = { ...(b.whatsappIntegration as any), lastWebhookAt: now };
      pushAudit(d, {
        action: 'whatsapp.webhook_received',
        actor: { id: 'system', email: 'webhook@instalink.app', role: 'system' },
        businessId: business.id, meta: { messages: count },
      });
      return count;
    });

    return NextResponse.json({ ok: true, received: saved, mapped: true });
  } catch {
    return NextResponse.json({ error: 'Falha ao processar o webhook.' }, { status: 500 });
  }
}
