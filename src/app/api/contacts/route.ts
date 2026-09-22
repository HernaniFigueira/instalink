import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { updateDB } from '@/lib/db';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalWrite } from '@/lib/relational/slice';
import { hashPassword } from '@/lib/auth';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { addContactNote, contactNotes, findContact, upsertContact } from '@/lib/contacts';
// A3.3 — carteirinha do cliente: dados cadastrais ricos (aditivos, opcionais).
import { ageFromBirthDate, applyContactProfile, clientTags, countAttended, profileCpfError, profileOf } from '@/lib/contact-profile';
import { cepError, emailError, isValidPhoneBR, phoneError } from '@/lib/field-quality';
// A3.3 (fechamento) — regra canônica de edição de nome/telefone/e-mail.
import { resolveContactIdentity } from '@/lib/contact-identity';
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

function rowToContactLight(r: any): BusinessCustomer {
  const isoOf = (v: any) => (v instanceof Date ? v.toISOString() : String(v ?? ''));
  return {
    id: String(r.id), businessId: String(r.business_id), customerId: String(r.customer_id || ''),
    name: String(r.name || ''), phone: String(r.phone || ''), email: String(r.email || ''),
    createdAt: isoOf(r.created_at), updatedAt: isoOf(r.updated_at),
    source: String(r.source || 'interaction'),
    ...(r.last_interaction ? { lastInteraction: isoOf(r.last_interaction) } : {}),
    marketingOptIn: r.marketing_opt_in === true, note: String(r.note || ''),
    ...(r.notes ? { notes: typeof r.notes === 'string' ? JSON.parse(r.notes) : r.notes } : {}),
    ...(r.profile ? { profile: typeof r.profile === 'string' ? JSON.parse(r.profile) : r.profile } : {}),
    ...(r.channel_identities ? { channelIdentities: typeof r.channel_identities === 'string' ? JSON.parse(r.channel_identities) : r.channel_identities } : {}),
  } as any;
}

function toDTO(c: BusinessCustomer, customer?: Customer | null, counts?: { bookings?: number; attended?: number; leads?: number }) {
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
      // Ponto 9: só o que foi concluído autoriza "Cliente atendido".
      attendedCount: counts?.attended || 0,
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

  // MODO RELACIONAL: busca/paginação no SQL (total correto, sem corte fixo).
  if (relationalActive()) {
    const { getPool } = await import('@/lib/relational/pool');
    const pool = getPool();
    const conds = ['business_id = $1'];
    const args: unknown[] = [businessId];
    if (q) {
      args.push(`%${q}%`);
      conds.push(`lower(name) LIKE $${args.length}`);
      if (qd.length >= 3) {
        args.push(`%${qd}%`);
        conds.push(`regexp_replace(phone, '\\D', '', 'g') LIKE $${args.length}`);
      }
    }
    const where = conds.join(' AND ');
    const total = Number((await pool.query(`SELECT count(*)::int AS n FROM app.contacts WHERE ${where}`, args)).rows[0].n);
    const rows = (await pool.query(
      `SELECT * FROM app.contacts WHERE ${where}
        ORDER BY COALESCE(last_interaction, created_at) DESC LIMIT ${limit}`,
      args,
    )).rows;
    const custIds = [...new Set(rows.map((r: any) => r.customer_id).filter(Boolean))] as string[];
    const customers = custIds.length
      ? (await pool.query('SELECT * FROM app.customers WHERE id = ANY($1)', [custIds])).rows
      : [];
    const custOf = new Map(customers.map((c: any) => [String(c.id), c]));
    const dtoOf = (r: any) => {
      const c = rowToContactLight(r);
      const account = c.customerId ? custOf.get(c.customerId) : undefined;
      return toDTO(c, account
        ? { id: String(account.id), name: String(account.name || ''), phone: String(account.phone || ''), email: String(account.email || ''), passwordHash: '', googleId: '', avatar: '', mustChangePassword: account.must_change_password === true, createdAt: new Date(account.created_at).toISOString() } as any
        : null);
    };
    return NextResponse.json({ contacts: rows.map(dtoOf), total });
  }
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
    // A3.4 · Bloco 6 — a régua de telefone/e-mail é a MESMA da tela e da
    // importação (`lib/field-quality.ts`), com mensagem ESPECÍFICA: o cliente
    // digitou DDD errado? faltou um dígito? o e-mail está sem domínio?
    if (phone && !isValidPhoneBR(phone)) {
      return NextResponse.json({ error: phoneError(phone) || 'Telefone inválido.' }, { status: 400 });
    }
    if (email && !isValidCustomerEmail(email)) {
      return NextResponse.json({ error: emailError(email) || 'Informe um e-mail válido.' }, { status: 400 });
    }
    // CEP opcional, mas completo quando informado (8 dígitos).
    const cepMsg = cepError((body.profile as Record<string, any> | undefined)?.address?.cep);
    if (cepMsg) return NextResponse.json({ error: cepMsg }, { status: 400 });
    if (!phone && !email) {
      return NextResponse.json({ error: 'Informe um WhatsApp ou e-mail.' }, { status: 400 });
    }
    if (wantsAccess && !isValidCustomerPhone(phone) && !isValidCustomerEmail(email)) {
      return NextResponse.json({ error: 'Para criar acesso, informe um WhatsApp ou e-mail válido.' }, { status: 400 });
    }
    // A3.3 (ponto 4) — o POST valida os MESMOS CPFs que o PATCH, no servidor e
    // ANTES de escrever: `profile.cpf` e `profile.guardian.cpf`. '' = não
    // informado; havendo valor, precisa ser CPF válido.
    const cpfError = profileCpfError(body.profile);
    if (cpfError) return NextResponse.json({ error: cpfError }, { status: 400 });

    let temporaryPassword = '';
    let accessCreated = false;
    /** Mutação PURA (DOIS motores): conta global + contato dedup + notas + auditoria. */
    const createContactTx = (db: any) => {
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
      return { contact, customer, temporaryPassword, accessCreated };
    };
    let result: any;
    if (relationalActive()) {
      // SQL: identidades candidatas globais (conta) + contato da unidade.
      result = await runRelationalWrite(businessId, createContactTx, {
        load: {
          businesses: {},
          contacts: {
            where: `($2 <> '' AND phone = $2) OR ($3 <> '' AND lower(email) = $3)
              OR ($4 <> '' AND name = $4 AND COALESCE(phone, '') = '' AND COALESCE(email, '') = '' AND (customer_id IS NULL OR customer_id = ''))
              OR ($2 <> '' AND regexp_replace(phone, '\\D', '', 'g') = $2)`,
            args: [phone, email, name],
          },
          customers: (partial) => {
            const phones: string[] = [];
            const emails: string[] = [];
            for (const c of partial.contacts) {
              if (c.phone) phones.push(c.phone);
              if (c.email) emails.push(c.email.toLowerCase());
            }
            if (phone) phones.push(phone);
            if (email) emails.push(email.toLowerCase());
            if (!phones.length && !emails.length) return null;
            const conds: string[] = [];
            const cargs: unknown[] = [];
            if (phones.length) { conds.push(`regexp_replace(phone, '\\D', '', 'g') = ANY($1)`); cargs.push(phones); }
            if (emails.length) { conds.push(`lower(email) = ANY($${cargs.length + 1})`); cargs.push(emails); }
            return { where: conds.join(' OR '), args: cargs, global: true };
          },
        },
      });
    } else {
      result = await updateDB(createContactTx);
    }
    temporaryPassword = result.temporaryPassword || '';
    accessCreated = result.accessCreated === true;

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
      const addNoteTx = (db: any) => {
        const c = db.contacts.find((x: any) => x.id === id && x.businessId === businessId);
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
      };
      if (relationalActive()) {
        const note = await runRelationalWrite(businessId, addNoteTx, { load: { contacts: { where: `id = $2`, args: [id] } } });
        if (!note) return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 });
        return NextResponse.json({ ok: true, note });
      }
      const note = await updateDB(addNoteTx);
      if (!note) return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 });
      return NextResponse.json({ ok: true, note });
    }
    /** Mutação PURA (DOIS motores): identidade + perfil + consentimento + contagens. */
    const editContactTx = (db: any) => {
      const c = db.contacts.find((x: any) => x.id === id && x.businessId === businessId);
      if (!c) return null;
      // A3.3 (ponto 9) — "cliente atendido" é quem TEM atendimento CONCLUÍDO.
      // Agendamento futuro, pendente, cancelado ou falta não é atendimento
      // realizado; contar tudo transformava "tem booking" em "foi atendido".
      // Os dois números seguem separados: o total explica o histórico, o de
      // concluídos decide a etiqueta.
      const mine = db.bookings.filter((b: any) => b.businessId === businessId && b.customerId === c.customerId && c.customerId);
      const counts = {
        bookings: mine.length,
        attended: countAttended(mine),
        leads: db.leads.filter((l: any) => l.businessId === businessId && l.customerId === c.customerId && c.customerId).length,
      };
      // Identidade (nome/telefone/e-mail) pela regra canônica: normaliza,
      // valida e RECUSA conflito com outro contato da mesma unidade. Nunca
      // toca no Customer global — a conta de login é outra coisa.
      if (body.name !== undefined || body.phone !== undefined || body.email !== undefined) {
        const resolved = resolveContactIdentity(db, businessId, c, {
          name: body.name, phone: body.phone, email: body.email,
        });
        if (!resolved.ok) {
          throw Object.assign(new Error(resolved.error), { status: resolved.status });
        }
        if (resolved.changed.length > 0) {
          const before = { name: c.name, phone: c.phone, email: c.email };
          c.name = resolved.name;
          c.phone = resolved.phone;
          c.email = resolved.email;
          pushAudit(db, {
            action: 'contact.identity_updated',
            actor: { ...guard.ctx.user, role: guard.ctx.role },
            businessId,
            supportSessionId: guard.ctx.support?.id,
            meta: {
              contactId: c.id,
              fields: resolved.changed,
              // Só o que mudou, e sem a conta global: auditoria de cadastro.
              from: Object.fromEntries(resolved.changed.map((f: any) => [f, before[f as keyof typeof before]])),
              to: Object.fromEntries(resolved.changed.map((f: any) => [f, resolved[f as keyof typeof resolved]])),
              customerTouched: false,
            },
          });
        }
      }
      if (body.note !== undefined) c.note = String(body.note || '').slice(0, 1000);
      // Consentimento: só muda com valor EXPLÍCITO (true/false). Ausente = intacto.
      if (body.marketingOptIn === true || body.marketingOptIn === false) {
        c.marketingOptIn = body.marketingOptIn === true;
      }
      // A3.3 — dados cadastrais (carteirinha). PATCH PARCIAL em TODOS os
      // níveis: `address` e `guardian` preservam os subcampos ausentes.
      // CPF do cliente E do responsável são validados aqui, no servidor.
      if (body.profile !== undefined) {
        const cpfError = profileCpfError(body.profile);
        if (cpfError) throw Object.assign(new Error(cpfError), { status: 400 });
        applyContactProfile(c, body.profile);
      }
      c.updatedAt = new Date().toISOString();
      return toDTO(c, db.customers.find((customer: any) => customer.id === c.customerId) || null, counts);
    };
    let updated: any;
    if (relationalActive()) {
      updated = await runRelationalWrite(businessId, editContactTx, {
        load: {
          contacts: {
            where: `(id = $2) OR ($3 <> '' AND phone = $3) OR ($4 <> '' AND lower(email) = $4)
              OR ($5 <> '' AND name = $5 AND COALESCE(phone, '') = '' AND COALESCE(email, '') = '' AND (customer_id IS NULL OR customer_id = ''))`,
            args: [id, String(body.phone || ''), String(body.email || ''), String(body.name || '')],
          },
          bookings: { where: `customer_id = (SELECT customer_id FROM app.contacts WHERE id = $2 AND business_id = $1 AND customer_id IS NOT NULL)`, args: [id] },
          leads: { where: `customer_id = (SELECT customer_id FROM app.contacts WHERE id = $2 AND business_id = $1 AND customer_id IS NOT NULL)`, args: [id] },
          customers: () => ({}), // planner de ids referenciados (contacts/bookings/leads)
        },
      });
    } else {
      updated = await updateDB(editContactTx);
    }
    if (!updated) return NextResponse.json({ error: 'Contato não encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, contact: updated });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return NextResponse.json({ error: status === 500 ? 'Não foi possível atualizar o contato.' : e.message }, { status });
  }
}
