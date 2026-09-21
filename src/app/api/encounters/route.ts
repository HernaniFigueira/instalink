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
import { relationalActive } from '@/lib/relational/config';
import { onlyDigits as onlyDigitsUtil } from '@/lib/utils';
import { requireBusiness } from '@/lib/access';
import { NO_PROFESSIONAL_SCOPE } from '@/lib/access-core';
import { PROFESSIONAL_NOT_ELIGIBLE_ERROR, professionalServesService, serviceRequiresProfessional } from '@/lib/booking';
import { pushAudit } from '@/lib/audit';
import {
  ENCOUNTER_TEXT_FIELDS, ENCOUNTER_VERSION_REQUIRED_ERROR, cleanTags, cleanText, canFinalize,
  encounterForBooking, encounterForQueue, encounterInScope, encountersForCustomer,
  hasExpectedVersion, versionConflict,
} from '@/lib/encounters';
import { effectiveTimezone, nowHM, todayISO } from '@/lib/tz';
import { onlyDigits } from '@/lib/utils';
import { findContact } from '@/lib/contacts';
import type { DB, Encounter, QueueEntry } from '@/lib/types';

function err(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/** Leitura DIRECIONADA no SQL para o GET (histórico/registro por vínculo). */
async function relEncounterDoc(businessId: string, opts: {
  id?: string; queueId?: string; bookingId?: string; contactIds?: string[]; customerId?: string;
  limit?: number;
} = {}): Promise<DB> {
  const { getPool } = await import('@/lib/relational/pool');
  const { rowToEncounter } = await import('@/lib/relational/ops-store');
  const pool = getPool();
  const conds: string[] = [];
  const args: unknown[] = [];
  let ph = 1;
  if (opts.id) {
    conds.push(`(id = $${++ph})`);
    args.push(opts.id);
  }
  if (opts.queueId) {
    conds.push(`(queue_id = $${++ph})`);
    args.push(opts.queueId);
  }
  if (opts.bookingId) {
    conds.push(`(booking_id = $${++ph})`);
    args.push(opts.bookingId);
  }
  if (opts.contactIds?.length) {
    conds.push(`(contact_id = ANY($${++ph}))`);
    args.push(opts.contactIds);
  }
  if (opts.customerId) {
    conds.push(`(customer_id = $${++ph})`);
    args.push(opts.customerId);
  }
  const where = conds.length ? ` AND (${conds.join(' OR ')})` : '';
  const limit = opts.limit ?? 800;
  const rows = (await pool.query(
    `SELECT * FROM app.encounters WHERE business_id = $1${where}
      ORDER BY date DESC, time DESC LIMIT ${limit}`,
    [businessId, ...args],
  )).rows;
  const dbLite = { encounters: rows.map(rowToEncounter), professionals: [], services: [], bookings: [], queue: [], contacts: [] } as any as DB;
  // Nomes/vínculos para a visão (view resolve profissional, serviço, status do
  // agendamento, telefone do contato/fila).
  const encs = dbLite.encounters;
  const proIds = [...new Set(encs.map((e: any) => e.professionalId).filter(Boolean))];
  const svcIds = [...new Set(encs.map((e: any) => e.serviceId).filter(Boolean))];
  const bkgIds = [...new Set(encs.map((e: any) => e.bookingId).filter(Boolean))];
  const queIds = [...new Set(encs.map((e: any) => e.queueId).filter(Boolean))];
  const conIds = [...new Set(encs.map((e: any) => e.contactId).filter(Boolean))];
  if (proIds.length) dbLite.professionals = (await pool.query('SELECT * FROM app.professionals WHERE id = ANY($1)', [proIds])).rows as any;
  if (svcIds.length) dbLite.services = (await pool.query('SELECT * FROM app.services WHERE id = ANY($1)', [svcIds])).rows as any;
  if (bkgIds.length) dbLite.bookings = (await pool.query('SELECT * FROM app.bookings WHERE id = ANY($1)', [bkgIds])).rows as any;
  if (queIds.length) dbLite.queue = (await pool.query('SELECT * FROM app.queue_entries WHERE id = ANY($1)', [queIds])).rows.map(rowToEncounterLength) as any;
  if (conIds.length) dbLite.contacts = (await pool.query('SELECT * FROM app.contacts WHERE id = ANY($1)', [conIds])).rows as any;
  return dbLite;
}
// queue rows para a view: só id/customer_phone são lidos.
function rowToEncounterLength(r: any) {
  return { id: String(r.id), customerPhone: String(r.customer_phone ?? '') } as any;
}

/** Resolução de contato por telefone (atalho da tela de histórico). */
async function relContactIdByPhone(businessId: string, phone: string): Promise<string> {
  if (!phone) return '';
  const { getPool } = await import('@/lib/relational/pool');
  const r = await getPool().query(
    'SELECT id FROM app.contacts WHERE business_id = $1 AND phone = $2 LIMIT 1',
    [businessId, onlyDigitsUtil(phone)],
  );
  return r.rows[0] ? String(r.rows[0].id) : '';
}

/** Hora local (HH:MM) do fuso da unidade a partir de um ISO — para a chegada. */
function hmOf(iso: string, tz: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? nowHM(d, tz) : '';
}

/** Revisão atual do registro (documento legado sem o campo vale 1). */
function encounterVersionOf(row: { version?: number }): number {
  const v = Number(row?.version);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** Quem pode reabrir um registro finalizado: quem manda na unidade. */
function canReopen(role: string): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'MASTER';
}

/**
 * Visão de leitura: a entidade + o que a tela precisa para não fazer 3 GETs.
 *
 * O `customerPhone` NÃO é persistido no registro (não é snapshot do cadastro:
 * telefone muda, e o documento do atendimento não deve carregar dado velho).
 * Ele é RESOLVIDO na leitura, na ordem segura: contato do CRM → agendamento de
 * origem → entrada da fila. É o que permite "Agendar retorno" abrir o
 * formulário já preenchido, sem obrigar a recepção a redigitar o cliente.
 */
function view(e: Encounter, db: DB) {
  // Coleções defensivas: o doc do guard (relacional) é REDUZIDO — nem todas
  // as coleções existem nele; a visão nunca pode 500 por isso.
  const pro = (db.professionals || []).find((p) => p.id === e.professionalId);
  const svc = (db.services || []).find((s) => s.id === e.serviceId);
  const booking = e.bookingId ? (db.bookings || []).find((b) => b.id === e.bookingId && b.businessId === e.businessId) : undefined;
  const queue = e.queueId ? (db.queue || []).find((q) => q.id === e.queueId && q.businessId === e.businessId) : undefined;
  const contact = e.contactId
    ? (db.contacts || []).find((c) => c.id === e.contactId && c.businessId === e.businessId)
    : undefined;
  return {
    ...e,
    professionalName: pro?.name || '',
    serviceName: svc?.name || '',
    bookingStatus: booking?.status || '',
    customerPhone: contact?.phone || booking?.customerPhone || queue?.customerPhone || '',
  };
}

export async function GET(req: NextRequest) {
  const businessId = String(req.nextUrl.searchParams.get('businessId') || '');
  const guard = await requireBusiness(req, businessId, 'atendimento');
  if (!guard.ok) return guard.res;
  // MODO RELACIONAL: leitura DIRECIONADA no SQL por vínculo (a fatia do guard
  // não contém atendimentos).
  const db = relationalActive()
    ? await relEncounterDoc(businessId, {
      id: String(req.nextUrl.searchParams.get('id') || '') || undefined,
      queueId: String(req.nextUrl.searchParams.get('queueId') || '') || undefined,
      bookingId: String(req.nextUrl.searchParams.get('bookingId') || '') || undefined,
    })
    : guard.db;
  const id = String(req.nextUrl.searchParams.get('id') || '');
  const queueId = String(req.nextUrl.searchParams.get('queueId') || '');
  const bookingId = String(req.nextUrl.searchParams.get('bookingId') || '');
  const contactId = String(req.nextUrl.searchParams.get('contactId') || '');
  const customerId = String(req.nextUrl.searchParams.get('customerId') || '');
  const phone = String(req.nextUrl.searchParams.get('phone') || '');

  const scoped = (db.encounters || []).filter((e) => e.businessId === businessId && encounterInScope(e, guard.ctx.professionalScope));

  // Leitura POR ID: é o que a tela usa para "recarregar" depois de um conflito
  // de versão. Nunca cria nada — e por isso não pode virar POST por acidente.
  if (id) {
    const found = scoped.find((e) => e.id === id);
    if (!found) return NextResponse.json({ error: 'Registro de atendimento não encontrado.' }, { status: 404 });
    return NextResponse.json({ ok: true, encounter: view(found, db) });
  }
  if (queueId) {
    const found = encounterForQueue(scoped, businessId, queueId);
    return NextResponse.json({ ok: true, encounter: found ? view(found, db) : null });
  }
  if (bookingId) {
    const found = scoped.find((e) => e.bookingId === bookingId) || null;
    return NextResponse.json({ ok: true, encounter: found ? view(found, db) : null });
  }
  if (contactId || customerId || phone) {
    // Telefone é aceito como atalho da tela, mas quem resolve é a BASE: o
    // telefone vira o contato do CRM e o casamento segue por identidade.
    const resolvedContactId = contactId
      || (phone && relationalActive() ? await relContactIdByPhone(businessId, phone) : '')
      || (phone ? (db.contacts.find((c) => c.businessId === businessId && c.phone === onlyDigits(phone))?.id || '') : '');
    let list = encountersForCustomer(scoped, businessId, { contactId: resolvedContactId, customerId });
    if (relationalActive() && (customerId || phone) && list.length === 0) {
      // Identidade por conta (customerId) ou telefone direto no SQL.
      const dbAlt = await relEncounterDoc(businessId, { contactIds: resolvedContactId ? [resolvedContactId] : [], customerId: customerId || undefined });
      const scopedAlt = (dbAlt.encounters || []).filter((e: any) => e.businessId === businessId && encounterInScope(e, guard.ctx.professionalScope));
      list = encountersForCustomer(scopedAlt, businessId, { contactId: resolvedContactId, customerId });
      for (const e of list) if (!db.encounters.some((x: any) => x.id === e.id)) db.encounters.push(e as any);
    }
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

/** Mutação PURA de criação (DOIS motores): revalida 1:1, insere, audita. */
function insertEncounter(d: DB, row: Encounter, businessId: string, actor: { id: string }, meta: Record<string, unknown>, now: string): void {
  // Revalidação dentro da transação: nada de dois registros para o mesmo
  // agendamento (nem para a mesma entrada da fila) por corrida de clique.
  if (row.bookingId && encounterForBooking(d.encounters, businessId, row.bookingId)) {
    throw err('Este agendamento já tem registro de atendimento.', 409);
  }
  if (row.queueId && encounterForQueue(d.encounters, businessId, row.queueId)) {
    throw err('Esta entrada da fila já tem registro de atendimento.', 409);
  }
  d.encounters.push(row);
  pushAudit(d, {
    action: 'encounter.created', businessId, actor: actor as any, meta,
  }, now);
}

/** Entrada da fila no SQL (a fatia do guard não contém fila). */
async function relQueueEntry(businessId: string, queueId: string): Promise<QueueEntry | undefined> {
  if (!queueId) return undefined;
  const { getPool } = await import('@/lib/relational/pool');
  const { rowToQueueEntry } = await import('@/lib/relational/ops-store');
  const r = await getPool().query(
    'SELECT * FROM app.queue_entries WHERE id = $1 AND business_id = $2 LIMIT 1',
    [queueId, businessId],
  );
  return r.rows[0] ? rowToQueueEntry(r.rows[0]) as QueueEntry : undefined;
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
    // Registro sem agendamento: quem chegou direto no balcão. A entrada da
    // fila é a referência (horário e profissional vêm dela) — e NADA de
    // fabricar um Booking falso: a agenda continua dizendo a verdade.
    const queueId = String(body.queueId || '');
    const queueEntry = queueId
      ? (relationalActive() ? await relQueueEntry(businessId, queueId) : (db.queue || []).find((q) => q.id === queueId && q.businessId === businessId))
      : undefined;
    if (queueId && !queueEntry) {
      return NextResponse.json({ error: 'Entrada da fila não encontrada nesta unidade.' }, { status: 404 });
    }
    // 1:1 — um agendamento tem UM registro, e uma ENTRADA DA FILA também.
    // Se já existe, devolvemos o existente (a tela abre o que está lá em vez de
    // criar documento paralelo). Vale para os dois vínculos.
    const existingDoc = relationalActive()
      ? (await relEncounterDoc(businessId, { bookingId: bookingId || undefined, queueId: queueId || undefined, limit: 2 })).encounters as any[]
      : (db.encounters || []);
    const existing = encounterForBooking(existingDoc as any, businessId, bookingId)
      || encounterForQueue(existingDoc as any, businessId, queueId);
    if (existing) {
      if (!encounterInScope(existing, guard.ctx.professionalScope)) {
        return NextResponse.json({ error: 'Você só registra os seus próprios atendimentos.' }, { status: 403 });
      }
      return NextResponse.json({ ok: true, encounter: view(existing, db), reused: true });
    }

    // O profissional do registro é quem atendeu: o escopo manda; sem escopo,
    // o profissional do agendamento (ou o indicado explicitamente).
    // O papel de PROFISSIONAL sem vínculo vem como sentinela — não é pessoa.
    const scopeId = guard.ctx.professionalScope === NO_PROFESSIONAL_SCOPE ? '' : (guard.ctx.professionalScope || '');
    const professionalId = scopeId
      || String(body.professionalId || booking?.professionalId || queueEntry?.professionalId || '');
    if (booking && scopeId && booking.professionalId && booking.professionalId !== scopeId) {
      return NextResponse.json({ error: 'Você só registra os seus próprios atendimentos.' }, { status: 403 });
    }
    // A fila segue a MESMA régua do agendamento: entrada de outro profissional
    // não é registrada por quem não é ele.
    if (queueEntry && scopeId && queueEntry.professionalId && queueEntry.professionalId !== scopeId) {
      return NextResponse.json({ error: 'Você só registra os seus próprios atendimentos.' }, { status: 403 });
    }
    // ── A3.4 (teste humano) — SERVIÇO × PROFISSIONAL, revalidado AQUI ──
    // A tela já esconde o que não é elegível e a fila já recusa assumir: o
    // registro é a última porta e não confia em nenhuma das duas. Serviço com
    // `professionalIds` só é registrado por quem está na lista.
    //
    // A régua só vale quando HÁ profissional a conferir: quem opera o balcão
    // sem vínculo (dono/secretaria) não tem "vínculo inelegível" a fabricar —
    // o registro segue sem profissional, como sempre foi. O que nunca passa é
    // um profissional concreto que não atende o serviço.
    const encounterServiceId = String(body.serviceId || booking?.serviceId || queueEntry?.serviceId || '');
    const encounterService = (db.services || []).find((s) => s.id === encounterServiceId && s.businessId === businessId);
    if (encounterService && serviceRequiresProfessional(encounterService) && professionalId
      && !professionalServesService(encounterService, professionalId, db.professionals || [])) {
      return NextResponse.json({ error: PROFESSIONAL_NOT_ELIGIBLE_ERROR }, { status: 403 });
    }

    const row: Encounter = {
      id: randomUUID(),
      businessId,
      bookingId: booking?.id || '',
      queueId: queueEntry?.id || '',
      serviceId: encounterServiceId,
      professionalId,
      customerId: String(body.customerId || booking?.customerId || ''),
      // Vínculo com o CRM: sem contato explícito, resolvemos pelo telefone do
      // agendamento (mesma chave de identidade do resto do sistema) — é o que
      // faz o registro aparecer no histórico 360 do cliente. Nunca por nome.
      contactId: String(body.contactId || queueEntry?.contactId || '') || (findContact(
        db, businessId,
        String(body.customerId || booking?.customerId || ''),
        booking?.customerPhone || queueEntry?.customerPhone || String(body.customerPhone || ''),
        booking?.customerName || queueEntry?.customerName || String(body.customerName || ''),
      )?.id || ''),
      customerName: String(body.customerName || booking?.customerName || queueEntry?.customerName || '').slice(0, 80),
      date: String(body.date || booking?.date || queueEntry?.date || todayISO(new Date(), tz)),
      // Sem agendamento, o "horário" é a CHEGADA/INÍCIO da fila — o registro
      // diz quando o atendimento aconteceu, não um horário de agenda inventado.
      time: String(body.time || booking?.time
        || (queueEntry ? (queueEntry.startedAt ? hmOf(queueEntry.startedAt, tz) : hmOf(queueEntry.createdAt, tz)) : '')),
      complaint: cleanText(body.complaint, 'complaint'),
      evolution: cleanText(body.evolution, 'evolution'),
      guidance: cleanText(body.guidance, 'guidance'),
      followUp: cleanText(body.followUp, 'followUp'),
      internalNote: cleanText(body.internalNote, 'internalNote'),
      tags: cleanTags(body.tags),
      status: 'draft',
      version: 1,
      createdAt: now, updatedAt: now,
      createdBy: guard.ctx.user.id, updatedBy: guard.ctx.user.id,
      finalizedAt: '', finalizedBy: '', signedBy: '',
    };

    if (relationalActive()) {
      // Escrita no SQL: o registro + identidades candidatas (vínculo com o CRM).
      const { runOpsWrite } = await import('@/lib/relational/ops-store');
      await runOpsWrite(businessId, {
        encounters: {
          where: `($2 <> '' AND booking_id = $2) OR ($3 <> '' AND queue_id = $3)`,
          args: [bookingId, queueId],
        },
        contacts: {
          where: `($2 <> '' AND id = $2)
            OR ($3 <> '' AND phone = $3)
            OR ($4 <> '' AND name = $4 AND COALESCE(phone, '') = '' AND COALESCE(email, '') = '' AND (customer_id IS NULL OR customer_id = ''))`,
          args: [String(body.contactId || row.contactId || ''), (booking?.customerPhone || queueEntry?.customerPhone || String(body.customerPhone || '')) ? onlyDigits(booking?.customerPhone || queueEntry?.customerPhone || String(body.customerPhone || '')) : '', String(body.customerName || booking?.customerName || queueEntry?.customerName || '').trim()],
        },
        services: true,
        professionals: true,
      }, (d) => insertEncounter(d, row, businessId, guard.ctx.user as any, { encounterId: row.id, bookingId: row.bookingId, queueId: row.queueId, professionalId: row.professionalId }, now));
      const freshDb = await relEncounterDoc(businessId, { id: row.id, limit: 2 });
      return NextResponse.json({ ok: true, encounter: view(row, freshDb) });
    }
    await updateDB((d: DB) => insertEncounter(d, row, businessId, guard.ctx.user as any, { encounterId: row.id, bookingId: row.bookingId, queueId: row.queueId, professionalId: row.professionalId }, now));
    return NextResponse.json({ ok: true, encounter: view(row, await readDB()) });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[encounters] POST falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível abrir o atendimento.' : e.message }, { status });
  }
}

/** Mutação PURA de edição/finalização/reabertura (DOIS motores). */
function mutateEncounter(
  d: DB, id: string, businessId: string, body: Record<string, any>,
  ctx: { user: { id: string; name?: string }; professionalScope: string }, reopen: boolean,
  action: string, now: string,
): Encounter {
  const target = d.encounters.find((e: any) => e.id === id && e.businessId === businessId);
  if (!target) throw err('Registro de atendimento não encontrado.', 404);
  if (!encounterInScope(target, ctx.professionalScope)) {
    throw err('Você só registra os seus próprios atendimentos.', 403);
  }

  // ── Transições de estado (máquina explícita) ──
  // Na ordem: primeiro o que DESTRAVA o usuário (reabrir), depois a trava
  // de concorrência. Quem está numa versão velha E num registro finalizado
  // precisa ouvir a instrução certa — reabrir —, não um "recarregue".
  if (action === 'finalize') {
    const conflict = versionConflict(target, body.expectedVersion);
    if (conflict.conflict) throw err(conflict.message, 409);
    if (target.status === 'finalized') throw err('Este registro já está finalizado.', 409);
    const check = canFinalize(target);
    if (!check.ok) throw err(check.error, 400);
    target.status = 'finalized';
    target.finalizedAt = now;
    target.finalizedBy = ctx.user.id;
    target.signedBy = d.professionals.find((p: any) => p.id === target.professionalId)?.name
      || ctx.user.name || '';
    target.updatedAt = now;
    target.updatedBy = ctx.user.id;
    target.version = encounterVersionOf(target) + 1;
    pushAudit(d, {
      action: 'encounter.finalized', businessId, actor: ctx.user as any,
      meta: { encounterId: target.id, bookingId: target.bookingId, version: target.version },
    }, now);
    return target;
  }
  if (action === 'reopen') {
    const conflict = versionConflict(target, body.expectedVersion);
    if (conflict.conflict) throw err(conflict.message, 409);
    if (target.status === 'draft') throw err('Este registro ainda é rascunho.', 409);
    if (!reopen) throw err('Só quem administra a unidade reabre um registro finalizado.', 403);
    target.status = 'draft';
    target.updatedAt = now;
    target.updatedBy = ctx.user.id;
    target.version = encounterVersionOf(target) + 1;
    pushAudit(d, {
      action: 'encounter.reopened', businessId, actor: ctx.user as any,
      meta: { encounterId: target.id, version: target.version },
    }, now);
    return target;
  }

  // ── Edição de conteúdo ──
  // A3.4 fix (revisão B5): FINALIZADO É DOCUMENTO FECHADO. Nem OWNER nem
  // ADMIN editam conteúdo aqui: a única porta é `action:'reopen'` (que
  // fica na auditoria) e só então o rascunho volta a aceitar edição.
  if (target.status === 'finalized') {
    throw err('Registro finalizado não é editado direto. Use "Reabrir para editar" — a reabertura fica na auditoria.', 409);
  }
  const conflict = versionConflict(target, body.expectedVersion);
  if (conflict.conflict) throw err(conflict.message, 409);
  const before = { ...target };
  for (const field of ENCOUNTER_TEXT_FIELDS) {
    if (body[field] !== undefined) target[field] = cleanText(body[field], field);
  }
  if (body.tags !== undefined) target.tags = cleanTags(body.tags);
  const changed = (['complaint', 'evolution', 'guidance', 'followUp', 'internalNote', 'tags'] as const)
    .filter((f) => JSON.stringify((before as any)[f]) !== JSON.stringify((target as any)[f]));
  if (changed.length === 0) {
    // Nada mudou: não inventa versão nova nem suja a auditoria (o autosave
    // da tela bate aqui com frequência e precisa ser barato e honesto).
    return target;
  }
  target.updatedAt = now;
  target.updatedBy = ctx.user.id;
  target.version = encounterVersionOf(target) + 1;
  pushAudit(d, {
    action: 'encounter.updated', businessId, actor: ctx.user as any,
    meta: { encounterId: target.id, fields: changed, version: target.version },
  }, now);
  return target;
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'atendimento');
    if (!guard.ok) return guard.res;
    const db = guard.db;
    const id = String(body.id || '');
    // MODO RELACIONAL: o registro atual vem do SQL (fatia do guard não contém
    // atendimentos) — mesmo 404/403 ANTES da transação.
    let current: Encounter | undefined;
    if (relationalActive()) {
      const pre = (await relEncounterDoc(businessId, { id, limit: 2 })).encounters as any[];
      current = pre.find((e) => e.id === id);
    } else {
      current = (db.encounters || []).find((e) => e.id === id && e.businessId === businessId);
    }
    if (!current) return NextResponse.json({ error: 'Registro de atendimento não encontrado.' }, { status: 404 });
    if (!encounterInScope(current, guard.ctx.professionalScope)) {
      return NextResponse.json({ error: 'Você só registra os seus próprios atendimentos.' }, { status: 403 });
    }
    const role = String(guard.ctx.role || '');
    const reopen = canReopen(role);
    const action = String(body.action || '');
    const now = new Date().toISOString();
    // A trava de concorrência é OBRIGATÓRIA (2ª revisão): sem `expectedVersion`
    // qualquer PATCH seria um overwrite cego — e esta API é nova, não há
    // chamador legítimo para manter funcionando sem trava.
    if (!hasExpectedVersion(body.expectedVersion)) {
      return NextResponse.json({ error: ENCOUNTER_VERSION_REQUIRED_ERROR }, { status: 400 });
    }

    const mutateCtx = { user: guard.ctx.user, professionalScope: guard.ctx.professionalScope };
    let updated: Encounter;
    if (relationalActive()) {
      // Escrita no SQL: a linha do registro + profissionais (assinatura).
      const { runOpsWrite } = await import('@/lib/relational/ops-store');
      updated = await runOpsWrite(businessId, {
        encounters: { where: `id = $2`, args: [id] },
        professionals: true,
      }, (d) => mutateEncounter(d, id, businessId, body, mutateCtx as any, reopen, action, now));
    } else {
      updated = await updateDB((d: DB) => mutateEncounter(d, id, businessId, body, mutateCtx as any, reopen, action, now));
    }
    const freshDb = relationalActive() ? await relEncounterDoc(businessId, { id, limit: 2 }) : await readDB();
    return NextResponse.json({ ok: true, encounter: view(updated, freshDb) });
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
    const removeEncounter = (d: DB): void => {
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
    };
    if (relationalActive()) {
      const { runOpsWrite } = await import('@/lib/relational/ops-store');
      await runOpsWrite(businessId, { encounters: { where: `id = $2`, args: [id] } }, removeEncounter);
    } else {
      await updateDB(removeEncounter);
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[encounters] DELETE falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível apagar o registro.' : e.message }, { status });
  }
}
