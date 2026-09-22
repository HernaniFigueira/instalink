import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalWrite, runRelationalRead } from '@/lib/relational/slice';
import { integrationStatus, serverCredentialsConfigured } from '@/lib/whatsapp';
import { deliverWhatsappMessage } from '@/lib/whatsapp-cloud-api';
import {
  INSTAGRAM_ACCOUNT_MISMATCH_CODE, INSTAGRAM_ACCOUNT_MISMATCH_MESSAGE,
  deliverInstagramMessage, getInstagramCredentials, instagramAccountMismatch, instagramConversationWindow,
} from '@/lib/instagram-api';
import { INSTAGRAM_TEXT_MAX_BYTES, instagramIntegrationStatus, instagramTextBytes, instagramTextLimitError } from '@/lib/instagram';
import type { Conversation, Message } from '@/lib/types';

function httpError(status: number, message: string, extras?: Record<string, unknown>) {
  return Object.assign(new Error(message), { status, extras });
}

/** View PURA (DOIS MOTORES): conversa única + mensagens + contato. */
function conversationDetailView(db: any, conv: any, ctx: any, channels: { whatsapp: boolean; instagram: boolean }, whatsappConnected: boolean) {
  const igStatus = instagramIntegrationStatus(ctx.business.instagramIntegration?.status);
  const instagramConnected = ctx.business.instagramIntegration?.status === 'connected';
  const messages = (db.messages || [])
    .filter((m: any) => m.conversationId === conv.id)
    .sort((a: any, b: any) => (a.at < b.at ? -1 : 1))
    .map((m: any) => {
      let byName = m.byName;
      if (!byName) {
        if (m.by === 'contact') byName = 'Cliente';
        else if (m.by === 'automation') byName = 'Automação';
        else {
          const u = (db.users || []).find((user: any) => user.id === m.by);
          byName = u?.name || 'Equipe';
        }
      }
      return { ...m, byName };
    });

  const contact = (db.contacts || []).find((c: any) => c.id === conv.contactId) || null;
  return {
    conversation: {
      ...conv,
      mode: conv.mode || 'automation',
    },
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
  };
}

// INBOX unificado (WhatsApp + Instagram) dentro do CRM.
// GET  ?businessId=&channel=&id=  → lista de conversas OU uma conversa + mensagens.
// POST { businessId, conversationId, body } → envio pelo canal DA CONVERSA.
// POST { businessId, conversationId, action: 'switch_mode', mode } → alternar automação/humano.
//
// Regra do Bloco 9: o canal é SEMPRE o da conversa. Nunca existe "responder no
// Instagram" a partir de uma conversa do WhatsApp (nem o contrário).
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'whatsapp');
  if (!guard.ok) return guard.res;
  const { ctx } = guard;
  const whatsappConnected = integrationStatus(ctx.business, serverCredentialsConfigured()).status === 'connected';
  const igStatus = instagramIntegrationStatus(ctx.business.instagramIntegration?.status);
  const instagramConnected = ctx.business.instagramIntegration?.status === 'connected';
  const channels = { whatsapp: whatsappConnected, instagram: instagramConnected };

  const id = req.nextUrl.searchParams.get('id') || '';
  if (id) {
    if (relationalActive()) {
      // Fatia da conversa: a conversa pedida, as mensagens DELA (ordenadas),
      // o contato referenciado e os usuários citados como remetentes.
      const db = await runRelationalRead(businessId, {
        conversations: { where: 'id = $2', args: [id] },
        messages: (partial) => ((partial.conversations || [])[0]
          ? { where: 'conversation_id = $2', args: [id], order: 'at ASC' }
          : null),
        contacts: (partial) => {
          const conv = (partial.conversations || [])[0];
          return conv?.contactId ? { where: 'id = $2', args: [conv.contactId] } : null;
        },
        users: (partial) => {
          const ids = new Set<string>();
          for (const m of partial.messages || []) {
            if (m.by && m.by !== 'contact' && m.by !== 'automation') ids.add(m.by);
          }
          if (ids.size === 0) return null;
          return { global: true, where: 'id = ANY($2)', args: [[...ids]] };
        },
      });
      const conv = (db.conversations || [])[0];
      if (!conv) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
      return NextResponse.json(conversationDetailView(db, conv, ctx, channels, whatsappConnected));
    }
    const { db } = guard;
    const conv = db.conversations.find((c) => c.id === id && c.businessId === businessId);
    if (!conv) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
    return NextResponse.json(conversationDetailView(db, conv, ctx, channels, whatsappConnected));
  }

  const status = req.nextUrl.searchParams.get('status') || '';
  const channel = req.nextUrl.searchParams.get('channel') || '';
  /** View PURA (DOIS MOTORES): lista + totais da caixa entrada. */
  const listView = (conversations: any[]) => ({
    conversations: conversations.map((c: Conversation) => ({
      ...c,
      mode: c.mode || 'automation',
      registered: !!c.customerId,
      lastMessageAt: c.lastMessageAt,
      channelLabel: c.channel === 'instagram' ? 'Instagram' : c.channel === 'whatsapp' ? 'WhatsApp' : 'Site',
    })),
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
      open: conversations.filter((c: any) => c.status === 'open').length,
      unread: conversations.reduce((s: number, c: any) => s + (c.unread || 0), 0),
      whatsapp: conversations.filter((c: any) => c.channel === 'whatsapp').length,
      instagram: conversations.filter((c: any) => c.channel === 'instagram').length,
    },
  });

  if (relationalActive()) {
    // Lista do SQL: filtros de status/canal viram WHERE; ordenação por última
    // mensagem (nulos por último — conversa recém-aberta não pula pra frente).
    const conds: string[] = [];
    const args: unknown[] = [];
    if (status) { args.push(status); conds.push(`status = $${args.length + 1}`); }
    if (channel) { args.push(channel); conds.push(`channel = $${args.length + 1}`); }
    const db = await runRelationalRead(businessId, {
      conversations: {
        where: conds.join(' AND ') || undefined,
        order: 'last_message_at DESC NULLS LAST',
      },
    });
    return NextResponse.json(listView(db.conversations || []));
  }
  const { db } = guard;
  const conversations = db.conversations
    .filter((c) => c.businessId === businessId && (!status || c.status === status) && (!channel || c.channel === channel))
    .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
  return NextResponse.json(listView(conversations));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'whatsapp');
    if (!guard.ok) return guard.res;
    const { ctx } = guard;
    const conversationId = String(body.conversationId || '');
    const action = String(body.action || '');

    // ── ALTERNAR MODO (Automação ↔ Humano) ─────────────────────────
    if (action === 'switch_mode' || action === 'takeover' || action === 'release' || action === 'setMode' || body.mode) {
      const newMode: 'automation' | 'human' =
        action === 'takeover' || body.mode === 'human' ? 'human' : 'automation';

      /** Mutação PURA (DOIS motores): alterna modo da conversa. */
      const modeTx = (db: any) => {
        const conv = (db.conversations || []).find((c: any) => c.id === conversationId && c.businessId === businessId);
        if (!conv) return null;
        conv.mode = newMode;
        return { id: conv.id, mode: conv.mode };
      };
      let updated: any;
      if (relationalActive()) {
        updated = await runRelationalWrite(businessId, modeTx, {
          load: { conversations: { where: 'id = $2', args: [conversationId] } },
        });
      } else {
        updated = await updateDB(modeTx);
      }
      if (!updated) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
      return NextResponse.json({ ok: true, ...updated });
    }

    // ── ENVIO DE MENSAGEM HUMANA ───────────────────────────────────
    const text = String(body.body || body.text || '').trim().slice(0, 4000);
    if (!text) return NextResponse.json({ error: 'Digite uma mensagem.' }, { status: 400 });

    /** Mutação PURA (DOIS motores): localiza a conversa (id OU telefone),
     * revalida canal/conta/janela e grava a mensagem pendente de envio.
     * As checagens com código de erro carregam `extras` (code/phase/detail). */
    const sendTx = (db: any) => {
      let conv = (db.conversations || []).find((c: any) => c.id === conversationId && c.businessId === businessId);
      if (!conv && body.phone) {
        const digits = String(body.phone).replace(/\D/g, '');
        conv = (db.conversations || []).find((c: any) => c.businessId === businessId && c.channel !== 'instagram' && c.phone === digits);
      }
      if (!conv) throw httpError(404, 'Conversa não encontrada.');

      // ── CANAL INSTAGRAM ────────────────────────────────────────
      if (conv.channel === 'instagram') {
        const creds = getInstagramCredentials(ctx.business);
        if (!creds) {
          throw httpError(409, 'Instagram não conectado nesta unidade. Conecte a conta em Canais e Integrações para responder por aqui.', { code: 'not_connected' });
        }
        // A conversa é da conta conectada AGORA? Depois de trocar de conta, o
        // histórico antigo continua visível, mas responder por ele sairia da
        // conta errada (e a Meta recusaria).
        const mismatch = instagramAccountMismatch(ctx.business, conv);
        if (mismatch) {
          throw httpError(409, INSTAGRAM_ACCOUNT_MISMATCH_MESSAGE, { detail: mismatch, code: INSTAGRAM_ACCOUNT_MISMATCH_CODE });
        }
        // Limite oficial (1000 bytes UTF-8): recusa ANTES de gravar — o que sai
        // pelo canal precisa ser exatamente o que está no histórico.
        if (instagramTextBytes(text) > INSTAGRAM_TEXT_MAX_BYTES) {
          throw httpError(400, instagramTextLimitError(INSTAGRAM_TEXT_MAX_BYTES), {
            code: 'message_too_long',
            limitBytes: INSTAGRAM_TEXT_MAX_BYTES,
            bytes: instagramTextBytes(text),
          });
        }
        // Política revalidada AGORA, com a janela DESTA conversa.
        const window = instagramConversationWindow(db, conv, new Date().toISOString());
        if (!window.canReply) {
          throw httpError(409, window.reason, { code: 'outside_window', phase: window.phase });
        }
        const now = new Date().toISOString();
        conv.mode = 'human';
        const msg: Message = {
          id: randomUUID(),
          businessId,
          conversationId: conv.id,
          direction: 'out',
          body: text,
          status: 'pending',
          externalId: '',
          by: ctx.user.id,
          byName: ctx.user.name || 'Equipe',
          channel: 'instagram',
          channelUserId: conv.channelUserId || '',
          at: now,
        };
        (db.messages || []).push(msg);
        conv.lastMessageAt = now;
        conv.lastMessagePreview = text.slice(0, 120);
        conv.unread = 0;
        return { message: msg, conversationId: conv.id, mode: conv.mode, channel: 'instagram' as const };
      }

      // ── CANAL WHATSAPP (e legado sem canal) ────────────────────
      if (conv.channel && conv.channel !== 'whatsapp') {
        throw httpError(409, `Esta conversa é do canal ${conv.channel} e não aceita resposta por aqui.`, { code: 'unsupported_channel' });
      }
      const connected = integrationStatus(ctx.business, serverCredentialsConfigured()).status === 'connected';
      if (!connected) {
        throw httpError(409, 'WhatsApp ainda não conectado. Conecte a conta oficial para enviar mensagens por aqui.', { code: 'not_connected' });
      }
      const now = new Date().toISOString();
      // O membro respondeu manualmente: passa o atendimento para 'human'
      conv.mode = 'human';
      const msg: Message = {
        id: randomUUID(),
        businessId,
        conversationId: conv.id,
        direction: 'out',
        body: text,
        status: 'pending',
        externalId: '',
        by: ctx.user.id,
        byName: ctx.user.name || 'Equipe',
        channel: conv.channel === 'instagram' ? 'instagram' : 'whatsapp',
        at: now,
      };
      (db.messages || []).push(msg);
      conv.lastMessageAt = now;
      conv.lastMessagePreview = text.slice(0, 120);
      conv.unread = 0;
      return { message: msg, conversationId: conv.id, mode: conv.mode, channel: 'whatsapp' as const };
    };

    const digits = body.phone ? String(body.phone).replace(/\D/g, '') : '';
    let result: any;
    if (relationalActive()) {
      // Fatia: conversas candidatas (por id OU telefone) e, quando a conversa
      // é do Instagram, as mensagens DELA (janela de 24h). Envio REAL fica
      // para o despachante HTTP (o outbox SQL segue 'pending' — lacuna
      // documentada na matriz §3; o cron não depende do documento legado).
      result = await runRelationalWrite(businessId, sendTx, {
        load: {
          conversations: {
            where: `(id = $2) OR ($3 <> '' AND channel <> 'instagram' AND phone = $3)`,
            args: [conversationId, digits],
          },
          messages: (partial) => {
            const conv = (partial.conversations || []).find((c: any) => c.channel === 'instagram');
            return conv ? { where: 'conversation_id = $2', args: [conv.id], order: 'at ASC' } : null;
          },
        },
      });
    } else {
      // Legado (rollback): mesmas checagens fora da escrita, respostas
      // idênticas; a tx compartilhada re-valida dentro do updateDB.
      let found = (guard.db.conversations || []).find((c: any) => c.id === conversationId && c.businessId === businessId);
      if (!found && body.phone) {
        const legacyDigits = String(body.phone).replace(/\D/g, '');
        found = (guard.db.conversations || []).find((c: any) => c.businessId === businessId && c.channel !== 'instagram' && c.phone === legacyDigits);
      }
      if (!found) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
      if (found.channel === 'instagram') {
        const creds = getInstagramCredentials(ctx.business);
        if (!creds) {
          return NextResponse.json({
            error: 'Instagram não conectado nesta unidade. Conecte a conta em Canais e Integrações para responder por aqui.',
            code: 'not_connected',
          }, { status: 409 });
        }
        const mismatch = instagramAccountMismatch(ctx.business, found);
        if (mismatch) {
          return NextResponse.json({
            error: INSTAGRAM_ACCOUNT_MISMATCH_MESSAGE,
            detail: mismatch,
            code: INSTAGRAM_ACCOUNT_MISMATCH_CODE,
          }, { status: 409 });
        }
        if (instagramTextBytes(text) > INSTAGRAM_TEXT_MAX_BYTES) {
          return NextResponse.json({
            error: instagramTextLimitError(INSTAGRAM_TEXT_MAX_BYTES),
            code: 'message_too_long',
            limitBytes: INSTAGRAM_TEXT_MAX_BYTES,
            bytes: instagramTextBytes(text),
          }, { status: 400 });
        }
        const window = instagramConversationWindow(guard.db, found, new Date().toISOString());
        if (!window.canReply) {
          return NextResponse.json({
            error: window.reason,
            code: 'outside_window',
            phase: window.phase,
          }, { status: 409 });
        }
      } else {
        if (found.channel && found.channel !== 'whatsapp') {
          return NextResponse.json({
            error: `Esta conversa é do canal ${found.channel} e não aceita resposta por aqui.`,
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
      }
      result = await updateDB(sendTx);
      if (!result) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });

      // Envio REAL pelo canal oficial (fora de qualquer lock) — SÓ no legado.
      const sendResult = result.channel === 'instagram'
        ? await deliverInstagramMessage(businessId, result.message.id)
        : await deliverWhatsappMessage(businessId, result.message.id);
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
        channel: result.channel,
      });
    }

    // Relacional: mensagem gravada como 'pending' no outbox SQL. O despachante
    // HTTP é rodada própria (matriz §3) — NUNCA chamamos o entregador legado
    // aqui, para não tocar no documento antigo.
    return NextResponse.json({
      ok: true,
      message: result.message,
      conversationId: result.conversationId,
      mode: result.mode,
      channel: result.channel,
    });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    if (status === 500) return NextResponse.json({ error: 'Não foi possível enviar a mensagem.' }, { status: 500 });
    return NextResponse.json({ error: e.message, ...(e.extras || {}) }, { status });
  }
}
