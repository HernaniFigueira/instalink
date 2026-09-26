import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { emitAutomationEvent } from '@/lib/automation/events';
import { upsertContact, findContact } from '@/lib/contacts';
import { phoneKey, webhookVerifyToken } from '@/lib/whatsapp';
import { pushAudit } from '@/lib/audit';
import { agentFor, agentActive } from '@/lib/agent';
import {
  aiShouldRespond, buildHandoffSummary, effectiveAgentState, handoffToTeam,
  receiveInbound, sendOutbound, setAgentState, wantsHuman, looksClinical,
} from '@/lib/inbox/assistant-ops';
import { conciergeAnswer } from '@/lib/concierge';
import { createBookingTx } from '@/lib/booking-create';
import { findLead, ingestLead } from '@/lib/pipeline';
import { onlyDigits } from '@/lib/utils';
import { formatDateBR } from '@/lib/tz';
import {
  deliverWhatsappMessage,
  resolveTenantForChange,
  verifyMetaWebhookSignature,
} from '@/lib/whatsapp-cloud-api';
import { normalizeInboundMessage, interactiveIntent } from '@/lib/messaging/normalize';
import { applyOutreachReply } from '@/lib/follow-up-outreach';
import { shouldAdvanceStatus } from '@/lib/messaging/status';
import type { Message, Conversation, Business, DB } from '@/lib/types';

// WEBHOOK do WhatsApp oficial (provedor → GoDoutor).
// GET  ?hub.mode=subscribe&hub.verify_token=… → handshake de verificação.
// POST → recebe mensagens e atualizações de status da Meta com fail-closed.
//
// DIAGNÓSTICO: TODA decisão desta rota emite um log com o marcador
// `[WA-WEBHOOK]` (Vercel → Functions → Logs). Contagens e IDs de recurso
// (WABA/phone_number_id) nunca corpo/segredo — permitem responder “a Meta
// chamou? com qual status?” sem ler payload nem expor nada sensível.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const mode = q.get('hub.mode');
  const token = q.get('hub.verify_token') || '';
  const challenge = q.get('hub.challenge') || '';
  const expected = webhookVerifyToken();

  if (!expected) {
    console.warn('[WA-WEBHOOK] GET verify status=503 reason=verify_token_env_missing');
    return NextResponse.json({ error: 'Webhook não configurado (WHATSAPP_VERIFY_TOKEN ausente).' }, { status: 503 });
  }
  const tokenMatch = token === expected;
  if (mode === 'subscribe' && tokenMatch) {
    console.log('[WA-WEBHOOK] GET verify status=200 mode=subscribe challenge_len=' + String(challenge.length));
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  console.warn(`[WA-WEBHOOK] GET verify status=403 mode=${mode || 'absent'} token_match=${tokenMatch}`);
  return NextResponse.json({ error: 'Verificação inválida.' }, { status: 403 });
}

interface IncomingMessage {
  externalId: string;
  phone: string;
  name: string;
  body: string;
  msgType?: string;
  interactiveId?: string;
  interactiveTitle?: string;
}

interface IncomingStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  recipientId: string;
  timestamp: string;
  errors?: Array<{ code: number; title: string; message?: string }>;
}

interface WebhookChangeBatch {
  phoneNumberId: string;
  wabaId: string;
  messages: IncomingMessage[];
  statuses: IncomingStatus[];
}

/** Alvos (phone_number_id / waba) citados num payload bruto — só para diagnóstico. */
function rawWebhookTargets(payload: any): Array<{ pId: string; wabaId: string }> {
  const targets: Array<{ pId: string; wabaId: string }> = [];
  const seen = new Set<string>();
  for (const entry of payload?.entry || []) {
    const wabaId = String(entry?.id || '');
    for (const change of entry?.changes || []) {
      const pId = String(change?.value?.metadata?.phone_number_id || '');
      const key = `${pId}|${wabaId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ pId, wabaId });
    }
  }
  return targets;
}

function parseWebhookBatches(payload: any): WebhookChangeBatch[] {
  const batches: WebhookChangeBatch[] = [];

  for (const entry of payload?.entry || []) {
    const wabaId = String(entry?.id || '');
    for (const change of entry?.changes || []) {
      const val = change?.value;
      const phoneNumberId = String(val?.metadata?.phone_number_id || '');
      const messages: IncomingMessage[] = [];
      const statuses: IncomingStatus[] = [];

      const contactMap = new Map<string, string>();
      if (Array.isArray(val?.contacts)) {
        for (const c of val.contacts) {
          if (c?.wa_id && c?.profile?.name) {
            contactMap.set(String(c.wa_id), String(c.profile.name));
          }
        }
      }

      if (Array.isArray(val?.messages)) {
        for (const m of val.messages) {
          const phone = String(m?.from || m?.phone || '');
          const mappedName = contactMap.get(phone) || String(m?.profile?.name || m?.name || '').slice(0, 80);
          const norm = normalizeInboundMessage(m, mappedName);
          if (!norm) continue;
          const externalId = norm.providerMessageId || String(m?.externalId || '');
          if (!phone && !externalId) continue;
          messages.push({
            externalId,
            phone,
            name: mappedName,
            body: (norm.text || '').slice(0, 4000),
            msgType: norm.type,
            interactiveId: norm.interactiveReply?.id || '',
            interactiveTitle: norm.interactiveReply?.title || '',
          });
        }
      }

      if (Array.isArray(val?.statuses)) {
        for (const s of val.statuses) {
          const id = String(s?.id || '');
          const status = s?.status;
          if (!id || !['sent', 'delivered', 'read', 'failed'].includes(status)) continue;
          statuses.push({
            id,
            status,
            recipientId: String(s?.recipient_id || ''),
            timestamp: String(s?.timestamp || ''),
            errors: Array.isArray(s?.errors) ? s.errors : undefined,
          });
        }
      }

      if (messages.length > 0 || statuses.length > 0) {
        batches.push({
          phoneNumberId,
          wabaId,
          messages,
          statuses,
        });
      }
    }
  }

  // Suporte a payload plano direto (testes legados / mock)
  if (batches.length === 0 && (Array.isArray(payload?.messages) || Array.isArray(payload?.statuses))) {
    const messages: IncomingMessage[] = [];
    const statuses: IncomingStatus[] = [];
    for (const m of payload.messages || []) {
      const phone = String(m?.from || m?.phone || '');
      const body = String(m?.text?.body ?? m?.body ?? '').slice(0, 4000);
      const externalId = String(m?.id || m?.externalId || '');
      if (phone || externalId) {
        messages.push({ externalId, phone, name: String(m?.name || '').slice(0, 80), body });
      }
    }
    for (const s of payload.statuses || []) {
      const id = String(s?.id || '');
      if (id && ['sent', 'delivered', 'read', 'failed'].includes(s?.status)) {
        statuses.push({ id, status: s.status, recipientId: String(s?.recipient_id || ''), timestamp: String(s?.timestamp || ''), errors: s?.errors });
      }
    }
    if (messages.length > 0 || statuses.length > 0) {
      batches.push({
        phoneNumberId: String(payload?.phoneNumberId || ''),
        wabaId: String(payload?.wabaId || ''),
        messages,
        statuses,
      });
    }
  }

  return batches;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-hub-signature-256');

    // 1. FAIL-CLOSED: segredo ausente rejeita imediatamente com 503
    const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
    if (!appSecret || appSecret.trim().length === 0) {
      console.warn('[WA-WEBHOOK] POST status=503 reason=app_secret_env_missing bytes=' + String(rawBody.length));
      return NextResponse.json({ error: 'Configuração do App Secret ausente no servidor.' }, { status: 503 });
    }

    // 2. Validação criptográfica de assinatura (HMAC SHA-256)
    if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
      // Nunca loga corpo/segredo: só o fato (distingue 403 nosso de 403 do proxy).
      console.warn(
        `[WA-WEBHOOK] POST status=403 reason=signature_invalid bytes=${String(rawBody.length)} header=${signature ? 'present' : 'absent'}`,
      );
      return NextResponse.json({ error: 'Assinatura do webhook inválida.' }, { status: 403 });
    }

    const payload = JSON.parse(rawBody || '{}');
    const batches = parseWebhookBatches(payload);

    if (batches.length === 0) {
      // Assinatura VÁLIDA mas nada utilizável: registrar a CHEGADA para o
      // painel (“último webhook”) quando o tenant resolver — sem isso o
      // descarte fica indistinguível de “Meta nunca enviou”.
      const targets = rawWebhookTargets(payload);
      console.warn(
        `[WA-WEBHOOK] POST status=200 reason=parsed_empty entries=${String(payload?.entry?.length ?? 0)} targets=${targets.length ? targets.map((t) => `${t.pId || '-'}/${t.wabaId || '-'}`).join(',') : 'none'}`,
      );
      try {
        const arrivalDb = await readDB();
        const found = new Map<string, true>();
        for (const t of targets) {
          const b = resolveTenantForChange(arrivalDb, t.pId, t.wabaId);
          if (b && !found.has(b.id)) {
            found.set(b.id, true);
            const at = new Date().toISOString();
            await updateDB((d) => {
              const dbiz = d.businesses.find((x) => x.id === b.id);
              if (dbiz?.whatsappIntegration) dbiz.whatsappIntegration.lastWebhookAt = at;
              pushAudit(d, {
                action: 'whatsapp.webhook_received',
                actor: { id: 'system', email: 'webhook@instalink.app', role: 'system' },
                businessId: b.id,
                meta: { messages: 0, statuses: 0, stage: 'parsed_empty' },
              });
            });
            console.warn(`[WA-WEBHOOK] POST arrival_marked business=${b.id} stage=parsed_empty`);
          }
        }
      } catch (markErr) {
        console.warn('[WA-WEBHOOK] POST arrival_mark_failed err=' + (markErr instanceof Error ? markErr.name : 'unknown'));
      }
      return NextResponse.json({ ok: true, received: 0 });
    }

    const db = await readDB();
    let totalProcessed = 0;
    const postCommitOutbound: Array<{ businessId: string; messageId: string }> = [];

    // 3. Processa CADA entry/change isoladamente para o seu respectivo tenant (Item 7)
    for (const batch of batches) {
      const business = resolveTenantForChange(db, batch.phoneNumberId, batch.wabaId);
      if (!business) {
        // Unidade não mapeada: ignora para não vazar dados entre negócios.
        // Log explícito: era o único descarte 100% silencioso do caminho.
        console.warn(
          `[WA-WEBHOOK] POST status=200 reason=tenant_missing phone_number_id=${batch.phoneNumberId || 'absent'} waba_id=${batch.wabaId || 'absent'} messages=${batch.messages.length} statuses=${batch.statuses.length}`,
        );
        continue;
      }

      const businessId = business.id;
      const newOutboundMessageIds: string[] = [];

      await updateDB((d) => {
        const now = new Date().toISOString();
        const b = d.businesses.find((x) => x.id === businessId)!;
        if (!b.whatsappIntegration) {
          b.whatsappIntegration = {
            status: 'not_connected', displayPhone: '', phoneNumberId: '', wabaId: '',
            connectedAt: '', lastWebhookAt: '', requestedAt: '',
          };
        }
        b.whatsappIntegration.lastWebhookAt = now;

        // 3.1. Processar atualizações de status da Meta
        for (const st of batch.statuses) {
          const target = d.messages.find((m) => m.externalId === st.id && m.businessId === businessId);
          if (target) {
            if (shouldAdvanceStatus(target.status, st.status)) {
              target.status = st.status as typeof target.status;
            }
            if (st.status === 'failed' && target.status === 'failed') {
              const errDetail = st.errors?.[0]?.message || st.errors?.[0]?.title || 'Mensagem rejeitada pela Meta.';
              target.error = errDetail;
              b.whatsappIntegration.lastError = errDetail;
              b.whatsappIntegration.lastErrorAt = now;
            }
          }
        }

        // 3.2. Processar mensagens recebidas (inbound)
        for (const m of batch.messages) {
          const rawDigits = onlyDigits(m.phone);
          const digits = phoneKey(m.phone);
          if (!digits && !rawDigits) continue;

          // Deduplicação estrita de reentrega da Meta
          if (m.externalId && d.messages.some((x) => x.externalId === m.externalId && x.businessId === businessId)) {
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
          const existingConv = d.conversations.find((c) => c.businessId === businessId && (c.phone === digits || (c.channelUserId && (c.channelUserId === rawDigits || c.channelUserId === digits))));
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
              agentState: 'ai_active',
              unread: 0,
              lastMessageAt: now,
              lastMessagePreview: m.body.slice(0, 120),
              createdAt: now,
              context: leadId ? { leadId } : {},
            };
            d.conversations.push(conv);
            emitAutomationEvent(d, {
              event: 'conversation.started',
              businessId,
              at: now,
              data: { conversationId: conv.id, channel: 'whatsapp', phone: conv.phone || digits },
            });
          } else {
            conv = existingConv;
            conv.channelUserId = rawDigits || digits;
            conv.contactId = contact?.id || conv.contactId;
            conv.customerId = contact?.customerId || existingCustomer?.id || conv.customerId;
            if (!conv.mode) conv.mode = 'automation';
            if (!conv.agentState) setAgentState(conv, conv.mode === 'human' ? 'human_active' : 'ai_active');
            if (leadId && (!conv.context || !conv.context.leadId)) {
              conv.context = { ...(conv.context || {}), leadId };
            }
          }

          // Grava mensagem inbound (F3-F: idempotência provider+providerMessageId)
          const inbound = receiveInbound(d, {
            businessId,
            conversationId: conv.id,
            body: m.body,
            provider: 'whatsapp',
            providerMessageId: String(m.externalId || ''),
            at: now,
            channelUserId: conv.channelUserId || '',
            contactName: contact?.name || m.name || 'Cliente',
          });
          if (inbound.duplicate) {
            continue;
          }
          // F3-H — resposta do paciente num outreach de retorno/reativação
          applyOutreachReply(d, {
            businessId,
            conversationId: conv.id,
            body: m.body,
            now,
          });
          {
            const storedIn = d.messages.find((x) => x.id === inbound.messageId);
            if (storedIn && (m.msgType || m.interactiveId)) {
              storedIn.meta = {
                ...(storedIn.meta || {}),
                provider: 'whatsapp',
                msgType: m.msgType || 'text',
                ...(m.interactiveId ? { interactiveId: m.interactiveId } : {}),
                ...(m.interactiveTitle ? { interactiveTitle: m.interactiveTitle } : {}),
                ...(m.interactiveId || m.interactiveTitle
                  ? { intent: interactiveIntent({ id: m.interactiveId, title: m.interactiveTitle }) }
                  : {}),
              };
            }
          }
          b.whatsappIntegration.lastInboundAt = now;

          // 3.3. Atendimento Concierge / Agente — só quando a IA está ativa
          // (humano + IA nunca respondem juntos).
          if (!aiShouldRespond(conv)) {
            continue;
          }

          if (wantsHuman(m.body) || looksClinical(m.body)) {
            const reason = looksClinical(m.body) ? 'clinico' : 'pedido_humano';
            const built = buildHandoffSummary(d, conv, reason);
            handoffToTeam(d, {
              businessId,
              conversationId: conv.id,
              summary: built.summary,
              intent: built.intent,
              entities: built.entities,
              actions: built.actions,
              requestedBy: reason === 'clinico' ? 'sistema' : 'paciente',
              at: now,
            });
            const agent = agentFor(d, business);
            const replyText = reason === 'clinico'
              ? 'Vou encaminhar sua mensagem para o nosso profissional. Um atendente já vai te responder por aqui!'
              : (agent.handoffMessage || 'Vou transferir seu atendimento para a nossa equipe. Um atendente já vai te responder por aqui!');
            sendOutbound(d, {
              businessId,
              conversationId: conv.id,
              body: replyText,
              by: 'automation',
              byName: 'Automação',
              provider: 'whatsapp',
              at: now,
              status: 'pending',
            });
            newOutboundMessageIds.push(
              d.messages[d.messages.length - 1]!.id,
            );
            continue;
          }

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
                    reply = 'Esse horário acabou de ser ocupado. Por favor, escolha outro horário ou dia que reservo para você na hora.';
                  }
                }
              }

              if (reply && reply.trim()) {
                const outId = randomUUID();
                d.messages.push({
                  id: outId,
                  businessId,
                  conversationId: conv.id,
                  direction: 'out',
                  body: reply.slice(0, 2000),
                  status: 'pending',
                  externalId: '',
                  by: 'automation',
                  byName: 'Automação',
                  at: now,
                  meta: { provider: 'whatsapp' },
                });
                conv.lastMessageAt = now;
                conv.lastMessagePreview = reply.slice(0, 120);
                newOutboundMessageIds.push(outId);
                // F3-F: enviou e aguarda o paciente (estado explícito).
                setAgentState(conv, 'waiting_patient');
              }

              conv.context = {
                ...(conv.context || {}),
                flow: answer.flow || null,
              };
            }
          } catch {
            // Defensivo
          }
        }

        pushAudit(d, {
          action: 'whatsapp.webhook_received',
          actor: { id: 'system', email: 'webhook@instalink.app', role: 'system' },
          businessId,
          meta: { messages: batch.messages.length, statuses: batch.statuses.length },
        });
      });

      totalProcessed += batch.messages.length + batch.statuses.length;
      console.log(
        `[WA-WEBHOOK] POST status=200 persisted business=${businessId} messages=${batch.messages.length} statuses=${batch.statuses.length}`,
      );
      for (const msgId of newOutboundMessageIds) {
        postCommitOutbound.push({ businessId, messageId: msgId });
      }
    }

    // 4. DISPARO REAL PÓS-COMMIT (FORA DO LOCK)
    for (const item of postCommitOutbound) {
      try {
        await deliverWhatsappMessage(item.businessId, item.messageId);
      } catch {
        // Falha pós-commit é absorvida; outbox mantém para retry
      }
    }

    return NextResponse.json({
      ok: true,
      received: totalProcessed,
      mapped: totalProcessed > 0,
    });
  } catch (err) {
    console.error('[WA-WEBHOOK] POST status=500 reason=handler_error name=' + (err instanceof Error ? err.name : 'unknown'));
    return NextResponse.json({ error: 'Falha ao processar o webhook.' }, { status: 500 });
  }
}
