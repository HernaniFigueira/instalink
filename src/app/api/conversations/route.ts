import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { updateDB } from '@/lib/db';
import { emitAutomationEvent } from '@/lib/automation/events';
import { pushAudit } from '@/lib/audit';
import {
  buildHandoffSummary, conversationSideContext, effectiveAgentState, handoffToTeam,
  pauseAi, resumeAi, setAgentState, agentStateLabel,
} from '@/lib/inbox/assistant-ops';
import { requireBusiness } from '@/lib/access';
import { integrationStatus, serverCredentialsConfigured } from '@/lib/whatsapp';
import { deliverWhatsappMessage } from '@/lib/whatsapp-cloud-api';
import {
  INSTAGRAM_ACCOUNT_MISMATCH_CODE, INSTAGRAM_ACCOUNT_MISMATCH_MESSAGE,
  deliverInstagramMessage, getInstagramCredentials, instagramAccountMismatch, instagramConversationWindow,
} from '@/lib/instagram-api';
import { INSTAGRAM_TEXT_MAX_BYTES, instagramIntegrationStatus, instagramTextBytes, instagramTextLimitError } from '@/lib/instagram';
import type { Conversation, Message } from '@/lib/types';

// INBOX unificado (WhatsApp + Instagram) dentro do CRM.
// GET  ?businessId=&channel=&id=  → lista de conversas OU uma conversa + mensagens.
// POST { businessId, conversationId, body } → envio pelo canal DA CONVERSA.
// POST { businessId, conversationId, action: 'switch_mode', mode } → alternar automação/humano.
//
// Regra do Bloco 9: o canal é SEMPRE o da conversa. Nunca existe "responder no
// Instagram" a partir de uma conversa do WhatsApp (nem o contrário).
function looksClinicalSafe(t: string): boolean {
  return /\b(diagn[oó]stico|receita|rem[eé]dio|sintoma|urg[eê]ncia)\b/i.test(t);
}

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'whatsapp');
  if (!guard.ok) return guard.res;
  const { db, ctx } = guard;
  const whatsappConnected = integrationStatus(ctx.business, serverCredentialsConfigured()).status === 'connected';
  const igStatus = instagramIntegrationStatus(ctx.business.instagramIntegration?.status);
  const instagramConnected = ctx.business.instagramIntegration?.status === 'connected';
  const channels = { whatsapp: whatsappConnected, instagram: instagramConnected };

  const id = req.nextUrl.searchParams.get('id') || '';
  if (id) {
    const conv = db.conversations.find((c) => c.id === id && c.businessId === businessId);
    if (!conv) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });

    const messages = db.messages
      .filter((m) => m.conversationId === conv.id)
      .sort((a, b) => (a.at < b.at ? -1 : 1))
      .map((m) => {
        let byName = m.byName;
        if (!byName) {
          if (m.by === 'contact') byName = 'Cliente';
          else if (m.by === 'automation') byName = 'Automação';
          else {
            const u = db.users.find((user) => user.id === m.by);
            byName = u?.name || 'Equipe';
          }
        }
        return { ...m, byName };
      });

    const contact = db.contacts.find((c) => c.id === conv.contactId) || null;
    return NextResponse.json({
      conversation: {
        ...conv,
        mode: conv.mode || 'automation',
        agentState: effectiveAgentState(conv),
        agentStateLabel: agentStateLabel(effectiveAgentState(conv)),
        handoff: conv.handoff || null,
      },
      // F3-F — contexto lateral administrativo (nunca prontuário/anamnese)
      sideContext: conversationSideContext(db, businessId, conv),
      messages,
      contact: contact
        ? {
            id: contact.id,
            customerId: contact.customerId,
            name: contact.name,
            phone: contact.phone,
            email: contact.email,
            marketingOptIn: contact.marketingOptIn === true,
            note: contact.note || '',
            channelIdentities: contact.channelIdentities || [],
          }
        : null,
      connected: whatsappConnected,
      channels,
      channelConnected: conv.channel === 'instagram' ? instagramConnected : whatsappConnected,
      instagramStatus: igStatus,
      // Janela DESTA conversa (participante), não da unidade: mensagem do
      // cliente A não abre janela para o cliente B. Informativa aqui; o envio
      // revalida no momento de sair.
      window: conv.channel === 'instagram'
        ? instagramConversationWindow(db, conv, new Date().toISOString())
        : null,
      // Conversa de uma conta antiga: histórico visível, envio bloqueado.
      accountMismatch: conv.channel === 'instagram'
        ? !!instagramAccountMismatch(ctx.business, conv)
        : false,
      accountMismatchMessage: conv.channel === 'instagram'
        ? instagramAccountMismatch(ctx.business, conv)
        : '',
    });
  }

  const status = req.nextUrl.searchParams.get('status') || '';
  const channel = req.nextUrl.searchParams.get('channel') || '';
  const conversations = db.conversations
    .filter((c) => c.businessId === businessId && (!status || c.status === status) && (!channel || c.channel === channel))
    .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1))
    .map((c: Conversation) => ({
      ...c,
      mode: c.mode || 'automation',
      agentState: effectiveAgentState(c),
      agentStateLabel: agentStateLabel(effectiveAgentState(c)),
      registered: !!c.customerId,
      lastMessageAt: c.lastMessageAt,
      channelLabel: c.channel === 'instagram' ? 'Instagram' : c.channel === 'whatsapp' ? 'WhatsApp' : 'Site',
    }));

  return NextResponse.json({
    conversations,
    connected: whatsappConnected,
    channels,
    serverConfigured: serverCredentialsConfigured(),
    instagram: {
      ...igStatus,
      connected: instagramConnected,
      username: ctx.business.instagramIntegration?.username || '',
    },
    totals: {
      all: conversations.length,
      open: conversations.filter((c) => c.status === 'open').length,
      unread: conversations.reduce((s, c) => s + (c.unread || 0), 0),
      whatsapp: conversations.filter((c) => c.channel === 'whatsapp').length,
      instagram: conversations.filter((c) => c.channel === 'instagram').length,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'whatsapp');
    if (!guard.ok) return guard.res;
    const { db, ctx } = guard;
    const conversationId = String(body.conversationId || '');
    const action = String(body.action || '');

    // ── HANDOFF / TAKEOVER / DEVOLVER-IA / PAUSAR (F3-F) ──────────
    if (action === 'switch_mode' || action === 'takeover' || action === 'release' || action === 'setMode' || body.mode || action === 'resume_ai' || action === 'pause_ai' || action === 'handoff') {
      const now = new Date().toISOString();
      // Ações que DEVOLVEM para a IA (audit + sem msg espontânea)
      const toAi = action === 'release' || action === 'resume_ai'
        || body.mode === 'automation'
        || ((action === 'switch_mode' || action === 'setMode') && body.mode === 'automation');
      // Ações que o humano ASSUME
      const toHuman = action === 'takeover' || action === 'pause_ai' || action === 'handoff'
        || body.mode === 'human'
        || ((action === 'switch_mode' || action === 'setMode') && body.mode === 'human');
      // Legado: switch_mode sem mode explícito → assumir humano (compat)
      const legacyTakeover = (action === 'switch_mode' || action === 'takeover') && !toAi && !body.mode;
      const wantAi = toAi && !toHuman;
      const wantHuman = toHuman || legacyTakeover;

      const updated = await updateDB((db) => {
        const conv = db.conversations.find((c) => c.id === conversationId && c.businessId === businessId);
        if (!conv) return null;
        const actor = { id: ctx.user.id, email: ctx.user.email || '', role: ctx.user.role || '' };
        const prev = effectiveAgentState(conv);

        if (wantAi) {
          const r = resumeAi(db, {
            businessId,
            conversationId: conv.id,
            actor,
            at: now,
          });
          if (!r.ok && prev !== 'ai_active' && prev !== 'waiting_patient') return null;
        } else if (action === 'handoff') {
          const built = buildHandoffSummary(db, conv, looksClinicalSafe(String(body.summary || '')) ? 'clinico' : 'pedido_humano');
          const hr = handoffToTeam(db, {
            businessId,
            conversationId: conv.id,
            summary: String(body.summary || '').trim() || built.summary,
            intent: String(body.intent || built.intent),
            entities: built.entities,
            actions: built.actions,
            requestedBy: 'equipe',
            actor,
            at: now,
          });
          if (!hr.ok) return null;
        } else if (wantHuman) {
          const pr = pauseAi(db, {
            businessId,
            conversationId: conv.id,
            actor,
            at: now,
          });
          if (!pr.ok) return null;
        } else {
          // setMode com outro valor → assume humano por segurança
          const pr = pauseAi(db, {
            businessId,
            conversationId: conv.id,
            actor,
            at: now,
          });
          if (!pr.ok) return null;
        }

        return {
          id: conv.id,
          mode: conv.mode || 'automation',
          agentState: effectiveAgentState(conv),
          agentStateLabel: agentStateLabel(effectiveAgentState(conv)),
        };
      });

      if (!updated) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
      return NextResponse.json({ ok: true, ...updated });
    }

    // ── ENVIO DE MENSAGEM HUMANA ───────────────────────────────────
    const text = String(body.body || body.text || '').trim().slice(0, 4000);
    if (!text) return NextResponse.json({ error: 'Digite uma mensagem.' }, { status: 400 });

    // A conversa decide o canal (nada de cross-channel).
    let found = db.conversations.find((c) => c.id === conversationId && c.businessId === businessId);
    if (!found && body.phone) {
      const digits = String(body.phone).replace(/\D/g, '');
      found = db.conversations.find((c) => c.businessId === businessId && c.channel !== 'instagram' && c.phone === digits);
    }
    if (!found) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
    const conv = found;

    // ── CANAL INSTAGRAM ────────────────────────────────────────────
    if (conv.channel === 'instagram') {
      const creds = getInstagramCredentials(ctx.business);
      if (!creds) {
        return NextResponse.json({
          error: 'Instagram não conectado nesta unidade. Conecte a conta em Canais e Integrações para responder por aqui.',
          code: 'not_connected',
        }, { status: 409 });
      }

      // A conversa é da conta conectada AGORA? Depois de trocar de conta, o
      // histórico antigo continua visível, mas responder por ele sairia da
      // conta errada (e a Meta recusaria).
      const mismatch = instagramAccountMismatch(ctx.business, conv);
      if (mismatch) {
        return NextResponse.json({
          error: INSTAGRAM_ACCOUNT_MISMATCH_MESSAGE,
          detail: mismatch,
          code: INSTAGRAM_ACCOUNT_MISMATCH_CODE,
        }, { status: 409 });
      }

      // Limite oficial (1000 bytes UTF-8): recusa ANTES de gravar — o que sai
      // pelo canal precisa ser exatamente o que está no histórico.
      if (instagramTextBytes(text) > INSTAGRAM_TEXT_MAX_BYTES) {
        return NextResponse.json({
          error: instagramTextLimitError(INSTAGRAM_TEXT_MAX_BYTES),
          code: 'message_too_long',
          limitBytes: INSTAGRAM_TEXT_MAX_BYTES,
          bytes: instagramTextBytes(text),
        }, { status: 400 });
      }

      // Política revalidada AGORA, com a janela DESTA conversa.
      const window = instagramConversationWindow(db, conv, new Date().toISOString());
      if (!window.canReply) {
        return NextResponse.json({
          error: window.reason,
          code: 'outside_window',
          phase: window.phase,
        }, { status: 409 });
      }

      const created = await updateDB((db) => {
        const target = db.conversations.find((c) => c.id === conv.id && c.businessId === businessId);
        if (!target) return null;
        const now = new Date().toISOString();
        target.mode = 'human';
        const msg: Message = {
          id: randomUUID(),
          businessId,
          conversationId: target.id,
          direction: 'out',
          body: text,
          status: 'pending',
          externalId: '',
          by: ctx.user.id,
          byName: ctx.user.name || 'Equipe',
          channel: 'instagram',
          channelUserId: target.channelUserId || '',
          at: now,
        };
        db.messages.push(msg);
        target.lastMessageAt = now;
        target.lastMessagePreview = text.slice(0, 120);
        target.unread = 0;
        return { message: msg, conversationId: target.id, mode: target.mode };
      });
      if (!created) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });

      // Envio REAL pelo Instagram oficial (fora de qualquer lock).
      const sendResult = await deliverInstagramMessage(businessId, created.message.id);
      const finalMsg = {
        ...created.message,
        status: sendResult.status === 'claimed_by_other' ? 'pending' : sendResult.status,
        externalId: sendResult.externalId || '',
        error: sendResult.error,
        nextRetryAt: sendResult.nextRetryAt,
        attempts: sendResult.attempts,
      };
      return NextResponse.json({
        ok: true,
        message: finalMsg,
        conversationId: created.conversationId,
        mode: created.mode,
        channel: 'instagram',
      });
    }

    // ── CANAL WHATSAPP (e legado sem canal) ────────────────────────
    if (conv.channel && conv.channel !== 'whatsapp') {
      return NextResponse.json({
        error: `Esta conversa é do canal ${conv.channel} e não aceita resposta por aqui.`,
        code: 'unsupported_channel',
      }, { status: 409 });
    }

    const connected = integrationStatus(ctx.business, serverCredentialsConfigured()).status === 'connected';
    if (!connected) {
      return NextResponse.json({
        error: 'WhatsApp ainda não conectado. Conecte a conta oficial para enviar mensagens por aqui.',
        code: 'not_connected',
      }, { status: 409 });
    }

    const result = await updateDB((db) => {
      let target = db.conversations.find((c) => c.id === conv.id && c.businessId === businessId);
      if (!target && body.phone) {
        const digits = String(body.phone).replace(/\D/g, '');
        target = db.conversations.find((c) => c.businessId === businessId && c.phone === digits);
      }
      if (!target) return null;

      const now = new Date().toISOString();
      // O membro respondeu manualmente: humano + IA nunca juntos (F3-F)
      target.mode = 'human';
      setAgentState(target, 'human_active');

      const msg: Message = {
        id: randomUUID(),
        businessId,
        conversationId: target.id,
        direction: 'out',
        body: text,
        status: 'pending',
        externalId: '',
        by: ctx.user.id,
        byName: ctx.user.name || 'Equipe',
        channel: target.channel === 'instagram' ? 'instagram' : 'whatsapp',
        at: now,
      };

      db.messages.push(msg);
      target.lastMessageAt = now;
      target.lastMessagePreview = text.slice(0, 120);
      target.unread = 0;

      return { message: msg, conversationId: target.id, mode: target.mode };
    });

    if (!result) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });

    // Envio REAL pelo WhatsApp oficial (fora de qualquer lock)
    const sendResult = await deliverWhatsappMessage(businessId, result.message.id);
    const finalMsg = {
      ...result.message,
      status: sendResult.status === 'claimed_by_other' ? 'pending' : sendResult.status,
      externalId: sendResult.externalId || '',
      error: sendResult.error,
      nextRetryAt: sendResult.nextRetryAt,
      attempts: sendResult.attempts,
    };

    return NextResponse.json({
      ok: true,
      message: finalMsg,
      conversationId: result.conversationId,
      mode: result.mode,
      channel: 'whatsapp',
    });
  } catch {
    return NextResponse.json({ error: 'Não foi possível enviar a mensagem.' }, { status: 500 });
  }
}
