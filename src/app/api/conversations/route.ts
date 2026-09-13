import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { integrationStatus, serverCredentialsConfigured } from '@/lib/whatsapp';
import type { Conversation, Message } from '@/lib/types';

// INBOX do WhatsApp dentro do CRM (estrutura pronta).
// GET  ?businessId=&id=  → lista de conversas OU uma conversa + mensagens.
// POST { businessId, conversationId, body } → envio de mensagem.
//
// HONESTIDADE: sem integração oficial conectada não existe envio real — a
// API responde 409 explicando e nenhuma mensagem é gravada como enviada.
// Com a integração conectada, a mensagem entra como 'pending' (fila) e o
// dispatcher do provedor (próxima etapa) atualiza o status para sent/read.
export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'whatsapp');
  if (!guard.ok) return guard.res;
  const { db, ctx } = guard;
  const connected = integrationStatus(ctx.business, serverCredentialsConfigured()).status === 'connected';

  const id = req.nextUrl.searchParams.get('id') || '';
  if (id) {
    const conv = db.conversations.find((c) => c.id === id && c.businessId === businessId);
    if (!conv) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
    const messages = db.messages
      .filter((m) => m.conversationId === conv.id)
      .sort((a, b) => (a.at < b.at ? -1 : 1));
    const contact = db.contacts.find((c) => c.id === conv.contactId) || null;
    return NextResponse.json({
      conversation: conv,
      messages,
      contact: contact
        ? { id: contact.id, customerId: contact.customerId, name: contact.name, phone: contact.phone, email: contact.email, marketingOptIn: contact.marketingOptIn === true, note: contact.note || '' }
        : null,
      connected,
    });
  }

  const status = req.nextUrl.searchParams.get('status') || '';
  const conversations = db.conversations
    .filter((c) => c.businessId === businessId && (!status || c.status === status))
    .sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1))
    .map((c: Conversation) => ({
      ...c,
      registered: !!c.customerId,
      lastMessageAt: c.lastMessageAt,
    }));
  return NextResponse.json({
    conversations,
    connected,
    serverConfigured: serverCredentialsConfigured(),
    totals: {
      all: conversations.length,
      open: conversations.filter((c) => c.status === 'open').length,
      unread: conversations.reduce((s, c) => s + (c.unread || 0), 0),
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'whatsapp');
    if (!guard.ok) return guard.res;
    const { ctx } = guard;
    const text = String(body.body || '').trim().slice(0, 2000);
    if (!text) return NextResponse.json({ error: 'Digite uma mensagem.' }, { status: 400 });

    const connected = integrationStatus(ctx.business, serverCredentialsConfigured()).status === 'connected';
    if (!connected) {
      return NextResponse.json({
        error: 'WhatsApp ainda não conectado. Conecte a conta oficial para enviar mensagens por aqui.',
        code: 'not_connected',
      }, { status: 409 });
    }

    const conversationId = String(body.conversationId || '');
    const result = await updateDB((db) => {
      let conv = db.conversations.find((c) => c.id === conversationId && c.businessId === businessId);
      if (!conv && body.phone) {
        const digits = String(body.phone).replace(/\D/g, '');
        conv = db.conversations.find((c) => c.businessId === businessId && c.phone === digits);
      }
      if (!conv) return null;
      const now = new Date().toISOString();
      const msg: Message = {
        id: randomUUID(), businessId, conversationId: conv.id, direction: 'out',
        body: text, status: 'pending', externalId: '', by: ctx.user.id, at: now,
      };
      db.messages.push(msg);
      conv.lastMessageAt = now;
      conv.lastMessagePreview = text.slice(0, 120);
      conv.unread = 0;
      return { message: msg, conversationId: conv.id };
    });
    if (!result) return NextResponse.json({ error: 'Conversa não encontrada.' }, { status: 404 });
    return NextResponse.json({ ok: true, ...result, queued: true });
  } catch {
    return NextResponse.json({ error: 'Não foi possível enviar a mensagem.' }, { status: 500 });
  }
}
