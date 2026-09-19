import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { updateDB } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { addContactNote, contactNotes, findContact, upsertContact } from '@/lib/contacts';
// A3.3 — carteirinha do cliente: dados cadastrais ricos (aditivos, opcionais).
import { ageFromBirthDate, applyContactProfile, clientTags, isValidCpf, profileOf } from '@/lib/contact-profile';
import { customersMatchingIdentity, generateTemporaryPassword, isValidCustomerEmail, isValidCustomerPhone, normalizeCustomerEmail, normalizeCustomerPhone } from '@/lib/customer-account';
import { onlyDigits } from '@/lib/utils';
import { phoneKey } from '@/lib/whatsapp';
import type { BusinessCustomer, Customer } from '@/lib/types';

// CRM — contatos do negócio.
// GET  ?businessId=&q=&limit=  → busca por nome ou WhatsApp (para vincular a
//      um agendamento sem duplicar cadastro).
// POST { businessId, name, phone, email, marketingOptIn } → cria/atualiza o
//      contato (upsert idempotente: nunca duplica).
// PATCH { businessId, id, note?, marketingOptIn? } → edição do contato.
// PATCH { businessId, id, addNote: { text, bookingId? } } → ACRESCENTA uma
//       observação (append-only): nada é sobrescrito nem apagado e o registro
//       guarda autor + data + contexto.

function toDTO(c: BusinessCustomer, customer?: Customer | null, counts?: { bookings?: number; leads?: number }) {
  const account = customer || null;
  const accountStatus = account ? ('active' as const) : ('none' as const);
  // Carteirinha (A3.3): perfil normalizado + idade DERIVADA + etiquetas.
  const profile = profileOf(c);
  return {
    id: c.id, customerId: c.customerId, name: c.name, phone: c.phone, email: c.email,
    // `customerId` só é considerado acesso ativo quando a conta realmente
    // existe. Contato/pessoa e conta continuam sendo conceitos distintos.
    registered: !!account,
    accountStatus,
    accountEmail: account?.email || '',
    accountPhone: account?.phone || '',
    mustChangePassword: account?.mustChangePassword === true,
    source: c.source, createdAt: c.createdAt,
    lastInteraction: c.lastInteraction, marketingOptIn: c.marketingOptIn === true,
    // Observação legada (compatível) + histórico append-only (P2).
    note: c.note || '',
    notes: contactNotes(c),
    profile,
    age: ageFromBirthDate(profile.birthDate),
    tags: clientTags({
      name: c.name,
      accountStatus,
      marketingOptIn: c.marketingOptIn === true,
      bookingsCount: counts?.bookings || 0,
      leadsCount: counts?.leads || 0,
      profile,
    }),
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
  return NextResponse.json({
    contacts: sorted.map((contact) => toDTO(
      contact,
      guard.db.customers.find((customer) => customer.id === contact.customerId) || null,
    )),
    total: filtered.length,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'clientes');
    if (!guard.ok) return guard.res;
    const ctx = guard.ctx;
    const name = String(body.name || '').trim().slice(0, 80);
    const phone = normalizeCustomerPhone(body.phone);
    const email = normalizeCustomerEmail(body.email);
    const wantsAccess = body.createAccount === true || body.createAccess === true;
    const noteText = String(body.note || '').trim().slice(0, 1000);

    if (!name) return NextResponse.json({ error: 'Informe o nome do cliente.' }, { status: 400 });
    if (phone && !isValidCustomerPhone(phone)) {
      return NextResponse.json({ error: 'Informe um WhatsApp válido.' }, { status: 400 });
    }
    if (email && !isValidCustomerEmail(email)) {
      return NextResponse.json({ error: 'Informe um e-mail válido.' }, { status: 400 });
    }
    if (!phone && !email) {
      return NextResponse.json({ error: 'Informe um WhatsApp ou e-mail.' }, { status: 400 });
    }
    if (wantsAccess && !isValidCustomerPhone(phone) && !isValidCustomerEmail(email)) {
      return NextResponse.json({ error: 'Para criar acesso, informe um WhatsApp ou e-mail válido.' }, { status: 400 });
    }

    let temporaryPassword = '';
    let accessCreated = false;
    const result = await updateDB((db) => {
      // A conta é GLOBAL: identidade por telefone/e-mail é resolvida antes
      // de criar qualquer registro. Se os dois dados apontarem para contas
      // diferentes, parar é mais seguro que vincular a pessoa errada.
      let customer: Customer | null = null;
      if (wantsAccess) {
        const matches = customersMatchingIdentity(db, phone, email);
        const unique = [...new Map(matches.map((item) => [item.id, item])).values()];
        if (unique.length > 1) {
          throw Object.assign(new Error('WhatsApp e e-mail pertencem a contas diferentes.'), { status: 409 });
        }
        customer = unique[0] || null;
        const existingContact = findContact(db, businessId, '', phone, name, email);
        if (existingContact?.customerId && existingContact.customerId !== customer?.id) {
          throw Object.assign(new Error('Este contato já está vinculado a outra conta.'), { status: 409 });
        }

        const now = new Date().toISOString();
        if (!customer) {
          customer = {
            id: randomUUID(),
            name,
            phone,
            email,
            passwordHash: '',
            googleId: '',
            avatar: '',
            createdAt: now,
            mustChangePassword: true,
            accessCreatedAt: now,
          };
          db.customers.push(customer);
        } else {
          // Nunca substitui uma identidade existente por dados vazios. Só
          // complementa o que faltava para o vínculo permanecer deduplicado.
          if (!customer.name) customer.name = name;
          if (!customer.phone && phone) customer.phone = phone;
          if (!customer.email && email) customer.email = email;
          if (!customer.passwordHash) {
            customer.accessCreatedAt = now;
            customer.mustChangePassword = true;
          }
        }

        // Conta Google sem senha também pode receber uma credencial temporária
        // pelo fluxo administrativo; o login público continua compatível.
        if (!customer.passwordHash) {
          accessCreated = true;
          temporaryPassword = generateTemporaryPassword();
          customer.passwordHash = hashPassword(temporaryPassword);
          customer.mustChangePassword = true;
          customer.accessCreatedAt = now;
        }
      }

      // Consentimento NUNCA é presumido. O formulário manual não oferece
      // opt-in marcado por padrão; só um true explícito pode ligar a flag.
      const optIn = body.marketingOptIn === true ? true : undefined;
      const wasContact = !!findContact(db, businessId, customer?.id || '', phone, name, email);
      const contact = upsertContact(db, {
        businessId,
        customerId: customer?.id || '',
        name,
        phone,
        email,
        source: String(body.source || 'manual').slice(0, 40),
        marketingOptIn: optIn,
      });
      if (!contact) throw Object.assign(new Error('Não foi possível salvar o contato.'), { status: 400 });
      if (noteText) {
        addContactNote(contact, {
          text: noteText,
          by: ctx.user.id,
          byName: ctx.user.name,
        });
      }
      // A3.3 — cadastro já pode nascer com dados da carteirinha.
      if (body.profile !== undefined) applyContactProfile(contact, body.profile);

      if (wantsAccess && customer && accessCreated) {
        pushAudit(db, {
          action: 'customer.access_created',
          actor: { ...ctx.user, role: ctx.role },
          businessId,
          supportSessionId: ctx.support?.id,
          meta: {
            contactId: contact.id,
            customerId: customer.id,
            created: !wasContact,
            temporaryCredentialIssued: !!temporaryPassword,
          },
        });
      }
      // O registro de contato também fica auditável para master, preservando o
      // comportamento anterior sem transformar todo contato em Customer.
      if (ctx.role === 'MASTER' && !wantsAccess) {
        pushAudit(db, {
          action: 'member.updated', actor: { ...ctx.user, role: ctx.role },
          businessId, supportSessionId: ctx.support?.id, meta: { contactCreated: !wasContact, contactId: contact.id },
        });
      }
      return { contact, customer };
    });

    return NextResponse.json({
      ok: true,
      contact: toDTO(result.contact, result.customer || null, { bookings: 0, leads: 0 }),
      ...(temporaryPassword ? { temporaryPassword } : {}),
      access: result.customer ? {
        status: 'active',
        temporaryCredentialIssued: !!temporaryPassword,
      } : { status: 'none', temporaryCredentialIssued: false },
    });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível salvar o contato.' : e.message }, { status });
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
      // Contagens reais para as etiquetas da carteirinha (derivadas, nunca chutadas).
      const counts = {
        bookings: db.bookings.filter((b) => b.businessId === businessId && b.customerId === c.customerId && c.customerId).length,
        leads: db.leads.filter((l) => l.businessId === businessId && l.customerId === c.customerId && c.customerId).length,
      };
      if (body.name !== undefined) c.name = String(body.name || '').trim().slice(0, 80) || c.name;
      if (body.email !== undefined) c.email = String(body.email || '').trim().toLowerCase().slice(0, 120);
      if (body.note !== undefined) c.note = String(body.note || '').slice(0, 1000);
      // Consentimento: só muda com valor EXPLÍCITO (true/false). Ausente = intacto.
      if (body.marketingOptIn === true || body.marketingOptIn === false) {
        c.marketingOptIn = body.marketingOptIn === true;
      }
      // A3.3 — dados cadastrais (carteirinha). PATCH PARCIAL: só os campos
      // enviados mudam; os demais ficam intactos. CPF inválido é rejeitado.
      if (body.profile !== undefined) {
        const cpf = body.profile && typeof body.profile === 'object' ? String((body.profile as any).cpf ?? '') : '';
        if (onlyDigits(cpf) && !isValidCpf(cpf)) {
          throw Object.assign(new Error('CPF inválido.'), { status: 400 });
        }
        applyContactProfile(c, body.profile);
      }
      c.updatedAt = new Date().toISOString();
      return toDTO(c, db.customers.find((customer) => customer.id === c.customerId) || null, counts);
    });
    if (!updated) return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, contact: updated });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível atualizar o contato.' : e.message }, { status });
  }
}
