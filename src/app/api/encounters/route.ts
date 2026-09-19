// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 5 — REGISTRO DO ATENDIMENTO (rota única)
// ═══════════════════════════════════════════════════════════════
// Uma porta de leitura/escrita para o registro do atendimento, sempre:
//   • escopada pela unidade do contexto autenticado;
//   • protegida pela permissão própria `atendimento` (dado sensível: NÃO vem
//     junto com "clientes" e não é dada por padrão a quem só opera o balcão);
//   • escopada pelo profissional vinculado (quem atende vê o que atendeu);
//   • auditada em toda transição relevante (criar, finalizar, reabrir, apagar).
//
// O 1:1 com o agendamento é garantido no servidor: criar um segundo registro
// para o mesmo booking devolve o registro existente (idempotência de UI), nunca
// um documento duplicado.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import {
  cleanTags, cleanText, canFinalize, encounterForBooking, encounterInScope, encountersForCustomer,
} from '@/lib/encounters';
import { effectiveTimezone, todayISO } from '@/lib/tz';
import { onlyDigits } from '@/lib/utils';
import { findContact } from '@/lib/contacts';
import type { DB, Encounter } from '@/lib/types';

function err(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/** Quem pode reabrir um registro finalizado: quem manda na unidade. */
function canReopen(role: string): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'MASTER';
}

/** Visão de leitura: a entidade + o que a tela precisa para não fazer 3 GETs. */
function view(e: Encounter, db: DB) {
  const pro = db.professionals.find((p) => p.id === e.professionalId);
  const svc = db.services.find((s) => s.id === e.serviceId);
  const booking = e.bookingId ? db.bookings.find((b) => b.id === e.bookingId) : undefined;
  return {
    ...e,
    professionalName: pro?.name || '',
    serviceName: svc?.name || '',
    bookingStatus: booking?.status || '',
  };
}

export async function GET(req: NextRequest) {
  const businessId = String(req.nextUrl.searchParams.get('businessId') || '');
  const guard = await requireBusiness(req, businessId, 'atendimento');
  if (!guard.ok) return guard.res;
  const db = guard.db;
  const bookingId = String(req.nextUrl.searchParams.get('bookingId') || '');
  const contactId = String(req.nextUrl.searchParams.get('contactId') || '');
  const customerId = String(req.nextUrl.searchParams.get('customerId') || '');
  const phone = String(req.nextUrl.searchParams.get('phone') || '');

  const scoped = (db.encounters || []).filter((e) => e.businessId === businessId && encounterInScope(e, guard.ctx.professionalScope));

  if (bookingId) {
    const found = scoped.find((e) => e.bookingId === bookingId) || null;
    return NextResponse.json({ ok: true, encounter: found ? view(found, db) : null });
  }
  if (contactId || customerId || phone) {
    // Telefone é aceito como atalho da tela, mas quem resolve é a BASE: o
    // telefone vira o contato do CRM e o casamento segue por identidade.
    const resolvedContactId = contactId
      || (phone ? (db.contacts.find((c) => c.businessId === businessId && c.phone === onlyDigits(phone))?.id || '') : '');
    const list = encountersForCustomer(scoped, businessId, { contactId: resolvedContactId, customerId });
    return NextResponse.json({ ok: true, encounters: list.map((e) => view(e, db)) });
  }
  // Lista por período (agenda/relatório): `from`/`to` opcionais em YYYY-MM-DD.
  const from = String(req.nextUrl.searchParams.get('from') || '');
  const to = String(req.nextUrl.searchParams.get('to') || '');
  const list = scoped
    .filter((e) => (!from || e.date >= from) && (!to || e.date <= to))
    .sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1))
    .slice(0, 300);
  return NextResponse.json({ ok: true, encounters: list.map((e) => view(e, db)) });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'atendimento');
    if (!guard.ok) return guard.res;
    const db = guard.db;
    const business = guard.ctx.business;
    const tz = effectiveTimezone(business.businessTimezone);
    const now = new Date().toISOString();

    const bookingId = String(body.bookingId || '');
    const booking = bookingId
      ? db.bookings.find((b) => b.id === bookingId && b.businessId === businessId)
      : undefined;
    if (bookingId && !booking) {
      return NextResponse.json({ error: 'Agendamento não encontrado nesta unidade.' }, { status: 404 });
    }
    // 1:1 — um agendamento tem UM registro. Se já existe, devolvemos o
    // existente (a tela abre o que está lá em vez de criar documento paralelo).
    const existing = encounterForBooking(db.encounters || [], businessId, bookingId);
    if (existing) {
      if (!encounterInScope(existing, guard.ctx.professionalScope)) {
        return NextResponse.json({ error: 'Você só registra os seus próprios atendimentos.' }, { status: 403 });
      }
      return NextResponse.json({ ok: true, encounter: view(existing, db), reused: true });
    }

    // O profissional do registro é quem atendeu: o escopo manda; sem escopo,
    // o profissional do agendamento (ou o indicado explicitamente).
    const professionalId = guard.ctx.professionalScope
      || String(body.professionalId || booking?.professionalId || '');
    if (booking && guard.ctx.professionalScope && booking.professionalId && booking.professionalId !== guard.ctx.professionalScope) {
      return NextResponse.json({ error: 'Você só registra os seus próprios atendimentos.' }, { status: 403 });
    }

    const row: Encounter = {
      id: randomUUID(),
      businessId,
      bookingId: booking?.id || '',
      serviceId: String(body.serviceId || booking?.serviceId || ''),
      professionalId,
      customerId: String(body.customerId || booking?.customerId || ''),
      // Vínculo com o CRM: sem contato explícito, resolvemos pelo telefone do
      // agendamento (mesma chave de identidade do resto do sistema) — é o que
      // faz o registro aparecer no histórico 360 do cliente. Nunca por nome.
      contactId: String(body.contactId || '') || (findContact(
        db, businessId,
        String(body.customerId || booking?.customerId || ''),
        booking?.customerPhone || String(body.customerPhone || ''),
        booking?.customerName || String(body.customerName || ''),
      )?.id || ''),
      customerName: String(body.customerName || booking?.customerName || '').slice(0, 80),
      date: String(body.date || booking?.date || todayISO(new Date(), tz)),
      time: String(body.time || booking?.time || ''),
      complaint: cleanText(body.complaint, 'complaint'),
      evolution: cleanText(body.evolution, 'evolution'),
      guidance: cleanText(body.guidance, 'guidance'),
      followUp: cleanText(body.followUp, 'followUp'),
      internalNote: cleanText(body.internalNote, 'internalNote'),
      tags: cleanTags(body.tags),
      status: 'draft',
      createdAt: now, updatedAt: now,
      createdBy: guard.ctx.user.id, updatedBy: guard.ctx.user.id,
      finalizedAt: '', finalizedBy: '', signedBy: '',
    };

    await updateDB((d: DB) => {
      // Revalidação dentro da transação: nada de dois registros para o mesmo
      // agendamento por corrida de duplo clique.
      if (row.bookingId && encounterForBooking(d.encounters, businessId, row.bookingId)) {
        throw err('Este agendamento já tem registro de atendimento.', 409);
      }
      d.encounters.push(row);
      pushAudit(d, {
        action: 'encounter.created', businessId, actor: guard.ctx.user,
        meta: { encounterId: row.id, bookingId: row.bookingId, professionalId: row.professionalId },
      }, now);
    });
    return NextResponse.json({ ok: true, encounter: view(row, await readDB()) });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[encounters] POST falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível abrir o atendimento.' : e.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'atendimento');
    if (!guard.ok) return guard.res;
    const db = guard.db;
    const id = String(body.id || '');
    const current = (db.encounters || []).find((e) => e.id === id && e.businessId === businessId);
    if (!current) return NextResponse.json({ error: 'Registro de atendimento não encontrado.' }, { status: 404 });
    if (!encounterInScope(current, guard.ctx.professionalScope)) {
      return NextResponse.json({ error: 'Você só registra os seus próprios atendimentos.' }, { status: 403 });
    }
    const role = String(guard.ctx.role || '');
    const reopen = canReopen(role);
    const action = String(body.action || '');
    const now = new Date().toISOString();

    const updated = await updateDB((d: DB) => {
      const target = d.encounters.find((e) => e.id === id && e.businessId === businessId);
      if (!target) throw err('Registro de atendimento não encontrado.', 404);
      if (!encounterInScope(target, guard.ctx.professionalScope)) {
        throw err('Você só registra os seus próprios atendimentos.', 403);
      }

      // ── Transições de estado (máquina explícita) ──
      if (action === 'finalize') {
        if (target.status === 'finalized') throw err('Este registro já está finalizado.', 409);
        const check = canFinalize(target);
        if (!check.ok) throw err(check.error, 400);
        target.status = 'finalized';
        target.finalizedAt = now;
        target.finalizedBy = guard.ctx.user.id;
        target.signedBy = d.professionals.find((p) => p.id === target.professionalId)?.name
          || guard.ctx.user.name || '';
        target.updatedAt = now;
        target.updatedBy = guard.ctx.user.id;
        pushAudit(d, {
          action: 'encounter.finalized', businessId, actor: guard.ctx.user,
          meta: { encounterId: target.id, bookingId: target.bookingId },
        }, now);
        return target;
      }
      if (action === 'reopen') {
        if (target.status === 'draft') throw err('Este registro ainda é rascunho.', 409);
        if (!reopen) throw err('Só quem administra a unidade reabre um registro finalizado.', 403);
        target.status = 'draft';
        target.updatedAt = now;
        target.updatedBy = guard.ctx.user.id;
        pushAudit(d, {
          action: 'encounter.reopened', businessId, actor: guard.ctx.user,
          meta: { encounterId: target.id },
        }, now);
        return target;
      }

      // ── Edição de conteúdo ──
      // Finalizado só é editado por quem pode reabrir: o documento que o
      // cliente levou para casa não muda em silêncio.
      if (target.status === 'finalized' && !reopen) {
        throw err('Registro finalizado. Reabra o atendimento para editar (fica registrado na auditoria).', 403);
      }
      const before = { ...target };
      for (const field of ['complaint', 'evolution', 'guidance', 'followUp', 'internalNote'] as const) {
        if (body[field] !== undefined) target[field] = cleanText(body[field], field);
      }
      if (body.tags !== undefined) target.tags = cleanTags(body.tags);
      if (body.followUp !== undefined) target.followUp = cleanText(body.followUp, 'followUp');
      target.updatedAt = now;
      target.updatedBy = guard.ctx.user.id;
      const changed = (['complaint', 'evolution', 'guidance', 'followUp', 'internalNote', 'tags'] as const)
        .filter((f) => JSON.stringify((before as any)[f]) !== JSON.stringify((target as any)[f]));
      pushAudit(d, {
        action: 'encounter.updated', businessId, actor: guard.ctx.user,
        meta: { encounterId: target.id, fields: changed },
      }, now);
      return target;
    });
    return NextResponse.json({ ok: true, encounter: view(updated, await readDB()) });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[encounters] PATCH falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível salvar o atendimento.' : e.message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'atendimento');
    if (!guard.ok) return guard.res;
    const id = String(body.id || '');
    const role = String(guard.ctx.role || '');
    const now = new Date().toISOString();
    await updateDB((d: DB) => {
      const idx = d.encounters.findIndex((e) => e.id === id && e.businessId === businessId);
      if (idx < 0) throw err('Registro de atendimento não encontrado.', 404);
      const target = d.encounters[idx];
      if (!encounterInScope(target, guard.ctx.professionalScope)) {
        throw err('Você só registra os seus próprios atendimentos.', 403);
      }
      // Documento finalizado é histórico: só quem administra apaga.
      if (target.status === 'finalized' && !canReopen(role)) {
        throw err('Registro finalizado só é apagado por quem administra a unidade.', 403);
      }
      d.encounters.splice(idx, 1);
      pushAudit(d, {
        action: 'encounter.removed', businessId, actor: guard.ctx.user,
        meta: { encounterId: id, bookingId: target.bookingId, wasFinalized: target.status === 'finalized' },
      }, now);
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[encounters] DELETE falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível apagar o registro.' : e.message }, { status });
  }
}
