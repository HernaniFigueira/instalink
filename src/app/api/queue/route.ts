// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 4 — FILA DE ESPERA (rota única)
// ═══════════════════════════════════════════════════════════════
// A fila do balcão vive FORA da agenda (`db.queue`, entidade `QueueEntry`):
// quem chega sem horário marcado não vira um Booking falso. Esta rota é a
// única porta de leitura/escrita da fila, sempre escopada pela unidade do
// contexto autenticado e pela permissão de Agenda.
//
// Escopo do profissional (P2) vale aqui também: um login vinculado a um
// profissional opera as entradas dele (ou as sem dono) — nunca as dos outros.
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { upsertContact } from '@/lib/contacts';
import {
  QUEUE_STATUS, isQueueStatus, queueForDay, queueSummary, queueTransitionAllowed,
} from '@/lib/queue';
import { todayISO, nowHM, effectiveTimezone } from '@/lib/tz';
import { onlyDigits } from '@/lib/utils';
import type { DB, QueueEntry, QueueStatus } from '@/lib/types';

function err(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/** A entrada está no escopo de quem está operando? */
function canAccess(entry: QueueEntry, ctx: { professionalScope: string }): boolean {
  if (!ctx.professionalScope) return true;
  return !entry.professionalId || entry.professionalId === ctx.professionalScope;
}

function view(entry: QueueEntry, db: DB) {
  const service = db.services.find((s) => s.id === entry.serviceId);
  const pro = db.professionals.find((p) => p.id === entry.professionalId);
  return {
    ...entry,
    serviceName: service?.name || '',
    professionalName: pro?.name || '',
    statusLabel: QUEUE_STATUS[entry.status]?.label || entry.status,
  };
}

export async function GET(req: NextRequest) {
  const businessId = String(req.nextUrl.searchParams.get('businessId') || '');
  const guard = await requireBusiness(req, businessId, 'agenda');
  if (!guard.ok) return guard.res;
  const business = guard.ctx.business;
  const tz = effectiveTimezone(business.businessTimezone);
  const date = String(req.nextUrl.searchParams.get('date') || '') || todayISO(new Date(), tz);
  const db = guard.db;
  // Encerradas do dia (para conferência) + fila viva (qualquer data: uma fila
  // que virou a noite não desaparece da tela por causa do relógio).
  const doneToday = (db.queue || []).filter((e) =>
    e.businessId === businessId && e.date === date && !QUEUE_STATUS[e.status]?.active);
  const active = (db.queue || []).filter((e) => e.businessId === businessId && QUEUE_STATUS[e.status]?.active);
  const visible = (list: QueueEntry[]) => list
    .filter((e) => canAccess(e, guard.ctx))
    .sort((a, b) => (a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1));
  return NextResponse.json({
    ok: true,
    date,
    timezone: tz,
    now: nowHM(new Date(), tz),
    entries: visible(queueForDay(db.queue || [], businessId, date).concat(active.filter((e) => e.date !== date))).map((e) => view(e, db)),
    done: visible(doneToday).map((e) => view(e, db)),
    summary: queueSummary(db.queue || [], businessId, date, new Date()),
    services: db.services.filter((s) => s.businessId === businessId && s.active !== false).map((s) => ({ id: s.id, name: s.name })),
    professionals: db.professionals.filter((p) => p.businessId === businessId && p.active !== false).map((p) => ({ id: p.id, name: p.name })),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'agenda');
    if (!guard.ok) return guard.res;
    const business = guard.ctx.business;
    const tz = effectiveTimezone(business.businessTimezone);
    const now = new Date();

    const name = String(body.customerName || '').trim().slice(0, 80);
    const phone = onlyDigits(String(body.customerPhone || ''));
    if (!name && phone.length < 10) {
      return NextResponse.json({ error: 'Informe o nome (ou o WhatsApp) de quem chegou.' }, { status: 400 });
    }
    const professionalId = String(body.professionalId || '') || (guard.ctx.professionalScope || '');
    if (professionalId && !(guard.db.professionals || []).some((p) => p.id === professionalId && p.businessId === businessId)) {
      return NextResponse.json({ error: 'Profissional indisponível.' }, { status: 400 });
    }
    const entry = await updateDB((d: DB) => {
      // O CRM é alimentado como em qualquer atendimento — fila não é terra de
      // ninguém: quem chegou vira contato (dedupe por telefone) e a entrada
      // guarda o vínculo.
      const contact = (name || phone)
        ? upsertContact(d, { businessId, name: name || phone, phone, source: 'fila', now: now.toISOString() })
        : null;
      const row: QueueEntry = {
        id: randomUUID(),
        businessId,
        customerName: contact?.name || name || phone,
        customerPhone: phone,
        contactId: contact?.id || '',
        serviceId: String(body.serviceId || ''),
        professionalId,
        bookingId: String(body.bookingId || ''),
        note: String(body.note || '').slice(0, 200),
        status: 'waiting',
        date: todayISO(now, tz),
        createdAt: now.toISOString(),
        calledAt: '',
        startedAt: '',
        endedAt: '',
        updatedBy: guard.ctx.user.id,
        updatedAt: now.toISOString(),
      };
      d.queue.push(row);
      pushAudit(d, {
        action: 'queue.created', businessId, actor: guard.ctx.user,
        meta: { entryId: row.id, serviceId: row.serviceId, hasBooking: !!row.bookingId },
      }, now.toISOString());
      return row;
    });
    // A visão é montada sobre a leitura FRESCA: nome de serviço/profissional
    // recém-gravados não pode sair vazio por causa do snapshot do guard.
    return NextResponse.json({ ok: true, entry: view(entry, await readDB()) });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[queue] POST falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível adicionar à fila.' : e.message }, { status });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'agenda');
    if (!guard.ok) return guard.res;
    const business = guard.ctx.business;
    const tz = effectiveTimezone(business.businessTimezone);
    const id = String(body.id || '');
    const current = (guard.db.queue || []).find((e) => e.id === id && e.businessId === businessId);
    if (!current) return NextResponse.json({ error: 'Entrada da fila não encontrada.' }, { status: 404 });
    if (!canAccess(current, guard.ctx)) {
      return NextResponse.json({ error: 'Você só pode operar a sua fila.' }, { status: 403 });
    }
    const to = body.status as QueueStatus;
    if (!isQueueStatus(to)) return NextResponse.json({ error: 'Status inválido.' }, { status: 400 });

    const updated = await updateDB((d: DB) => {
      const target = d.queue.find((e) => e.id === id && e.businessId === businessId);
      if (!target) throw err('Entrada da fila não encontrada.', 404);
      if (!canAccess(target, guard.ctx)) throw err('Você só pode operar a sua fila.', 403);
      // Máquina de estados da fila: a UI não inventa caminho (memória e
      // servidor falam a MESMA regra).
      if (!queueTransitionAllowed(target.status, to)) {
        throw err(`Não é possível ir de “${QUEUE_STATUS[target.status].label}” para “${QUEUE_STATUS[to].label}”.`, 409);
      }
      const nowIso = new Date().toISOString();
      target.status = to;
      target.updatedAt = nowIso;
      target.updatedBy = guard.ctx.user.id;
      if (to === 'called') target.calledAt = nowIso;
      // Voltar para "aguardando" (chamou a pessoa errada) limpa a chamada.
      if (to === 'waiting') { target.calledAt = ''; }
      if (to === 'in_service' && !target.startedAt) target.startedAt = nowIso;
      if (to === 'done' || to === 'left') target.endedAt = nowIso;
      if (body.serviceId !== undefined) target.serviceId = String(body.serviceId || '');
      if (body.professionalId !== undefined) target.professionalId = String(body.professionalId || '');
      if (body.note !== undefined) target.note = String(body.note || '').slice(0, 200);
      pushAudit(d, {
        action: 'queue.updated', businessId, actor: guard.ctx.user,
        meta: { entryId: target.id, from: current.status, to },
      }, nowIso);
      return target;
    });
    return NextResponse.json({ ok: true, entry: view(updated, await readDB()), at: nowHM(new Date(), tz) });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[queue] PATCH falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível atualizar a fila.' : e.message }, { status });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'agenda');
    if (!guard.ok) return guard.res;
    const id = String(body.id || '');
    await updateDB((d: DB) => {
      const idx = d.queue.findIndex((e) => e.id === id && e.businessId === businessId);
      if (idx < 0) throw err('Entrada da fila não encontrada.', 404);
      if (!canAccess(d.queue[idx], guard.ctx)) throw err('Você só pode operar a sua fila.', 403);
      d.queue.splice(idx, 1);
      pushAudit(d, {
        action: 'queue.removed', businessId, actor: guard.ctx.user, meta: { entryId: id },
      }, new Date().toISOString());
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[queue] DELETE falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível remover da fila.' : e.message }, { status });
  }
}
