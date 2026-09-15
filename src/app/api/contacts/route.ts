import { NextRequest, NextResponse } from 'next/server';
import { updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { addContactNote, contactNotes, upsertContact } from '@/lib/contacts';
import { onlyDigits } from '@/lib/utils';
import { phoneKey } from '@/lib/whatsapp';
import type { BusinessCustomer } from '@/lib/types';

// CRM — contatos do negócio.
// GET  ?businessId=&q=&limit=  → busca por nome ou WhatsApp (para vincular a
//      um agendamento sem duplicar cadastro).
// POST { businessId, name, phone, email, marketingOptIn } → cria/atualiza o
//      contato (upsert idempotente: nunca duplica).
// PATCH { businessId, id, note?, marketingOptIn? } → edição do contato.
// PATCH { businessId, id, addNote: { text, bookingId? } } → ACRESCENTA uma
//       observação (append-only): nada é sobrescrito nem apagado e o registro
//       guarda autor + data + contexto.

function toDTO(c: BusinessCustomer) {
  return {
    id: c.id, customerId: c.customerId, name: c.name, phone: c.phone, email: c.email,
    registered: !!c.customerId, source: c.source, createdAt: c.createdAt,
    lastInteraction: c.lastInteraction, marketingOptIn: c.marketingOptIn === true,
    // Observação legada (compatível) + histórico append-only (P2).
    note: c.note || '',
    notes: contactNotes(c),
  };
}

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const guard = await requireBusiness(req, businessId, 'clientes');
  if (!guard.ok) return guard.res;
  const q = (req.nextUrl.searchParams.get('q') || '').trim().toLowerCase();
  const limit = Math.min(50, Math.max(1, Number(req.nextUrl.searchParams.get('limit')) || 12));
  const qd = onlyDigits(q);

  const all = guard.db.contacts.filter((c) => c.businessId === businessId);
  const filtered = q
    ? all.filter((c) =>
      (c.name || '').toLowerCase().includes(q) ||
      (qd.length >= 3 && phoneKey(c.phone).includes(phoneKey(qd))))
    : all;
  const sorted = [...filtered].sort((a, b) => (a.lastInteraction < b.lastInteraction ? 1 : -1)).slice(0, limit);
  return NextResponse.json({ contacts: sorted.map(toDTO), total: filtered.length });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'clientes');
    if (!guard.ok) return guard.res;
    const ctx = guard.ctx;
    const name = String(body.name || '').trim().slice(0, 80);
    const phone = onlyDigits(String(body.phone || ''));
    const email = String(body.email || '').trim().toLowerCase().slice(0, 120);
    if (!name && !phone) return NextResponse.json({ error: 'Informe nome ou WhatsApp.' }, { status: 400 });

    const contact = await updateDB((db) => {
      // consentimento NUNCA é presumido: só liga com `true` explícito
      const optIn = body.marketingOptIn === true ? true : undefined;
      const c = upsertContact(db, {
        businessId, name, phone, email, source: String(body.source || 'manual').slice(0, 40),
        marketingOptIn: optIn,
      });
      if (ctx.role === 'MASTER') {
        pushAudit(db, {
          action: 'member.updated', actor: { ...ctx.user, role: ctx.role },
          businessId, supportSessionId: ctx.support?.id, meta: { contactCreated: true },
        });
      }
      return c;
    });
    if (!contact) return NextResponse.json({ error: 'Informe nome ou WhatsApp.' }, { status: 400 });
    return NextResponse.json({ ok: true, contact: toDTO(contact) });
  } catch {
    return NextResponse.json({ error: 'Não foi possível salvar o contato.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'clientes');
    if (!guard.ok) return guard.res;
    const id = String(body.id || '');

    if (body.addNote !== undefined) {
      const text = String((body.addNote && body.addNote.text) || '');
      if (!text.trim()) return NextResponse.json({ error: 'Escreva a observação.' }, { status: 400 });
      const note = await updateDB((db) => {
        const c = db.contacts.find((x) => x.id === id && x.businessId === businessId);
        if (!c) return null;
        const created = addContactNote(c, {
          text,
          by: guard.ctx.user.id,
          byName: guard.ctx.user.name,
          bookingId: body.addNote?.bookingId ? String(body.addNote.bookingId) : '',
        });
        if (created) {
          pushAudit(db, {
            action: 'contact.note_added',
            actor: { ...guard.ctx.user, role: guard.ctx.role },
            businessId,
            supportSessionId: guard.ctx.support?.id,
            meta: { contactId: c.id, noteId: created.id },
          });
        }
        return created;
      });
      if (!note) return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 });
      return NextResponse.json({ ok: true, note });
    }

    const updated = await updateDB((db) => {
      const c = db.contacts.find((x) => x.id === id && x.businessId === businessId);
      if (!c) return null;
      if (body.name !== undefined) c.name = String(body.name || '').trim().slice(0, 80) || c.name;
      if (body.email !== undefined) c.email = String(body.email || '').trim().toLowerCase().slice(0, 120);
      if (body.note !== undefined) c.note = String(body.note || '').slice(0, 1000);
      // Consentimento: só muda com valor EXPLÍCITO (true/false). Ausente = intacto.
      if (body.marketingOptIn === true || body.marketingOptIn === false) {
        c.marketingOptIn = body.marketingOptIn === true;
      }
      c.updatedAt = new Date().toISOString();
      return toDTO(c);
    });
    if (!updated) return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, contact: updated });
  } catch {
    return NextResponse.json({ error: 'Não foi possível atualizar o contato.' }, { status: 500 });
  }
}
