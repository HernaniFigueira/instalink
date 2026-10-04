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
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { emitAutomationEvent } from '@/lib/automation/events';
import {
  ENCOUNTER_TEXT_FIELDS, ENCOUNTER_VERSION_REQUIRED_ERROR, cleanTags, cleanText, canFinalize,
  encounterClinicalState, encounterForQueue, encounterInScope, encountersForCustomer,
  encounterView as view, type EncounterClinicalState,
  hasExpectedVersion, versionConflict,
  // FASE 2 · P3 — retorno estruturado + arquivos (aditivos).
  cleanEncounterFiles, isFollowUpMode, validateFollowUp,
} from '@/lib/encounters';
// F1A — operação canônica de iniciar/retomar (mesma usada por /encounters/start).
import { startOrResumeEncounter } from '@/lib/encounter-start';
import { applyBookingStatusTx } from '@/lib/booking-status';
import { assertCanFinalizeCare } from '@/lib/appointment-workflow-tx';
import { publishWorkflowEvent } from '@/lib/workflow-events';
import { effectiveTimezone } from '@/lib/tz';
import { onlyDigits } from '@/lib/utils';
import type { DB, Encounter } from '@/lib/types';

function err(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
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

export async function GET(req: NextRequest) {
  const businessId = String(req.nextUrl.searchParams.get('businessId') || '');
  const guard = await requireBusiness(req, businessId, 'atendimento');
  if (!guard.ok) return guard.res;
  const db = guard.db;
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
    // F1A — LEITURA POR ID (rota direta do workspace): primeiro o TENANT,
    // depois o ESCOPO. A ordem importa: um registro de outro profissional da
    // MESMA unidade é 403 ("não é seu"), e não 404 ("não existe") — é a mesma
    // régua do PATCH/DELETE e evita a mentira de "não encontrado" para quem
    // simplesmente não tem vínculo com aquele atendimento. Nenhum dado vaza:
    // a resposta de erro nunca carrega o registro.
    const found = (db.encounters || []).find((e) => e.id === id && e.businessId === businessId);
    if (!found) return NextResponse.json({ error: 'Registro de atendimento não encontrado.' }, { status: 404 });
    if (!encounterInScope(found, guard.ctx.professionalScope)) {
      return NextResponse.json({ error: 'Você só registra os seus próprios atendimentos.' }, { status: 403 });
    }
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

/**
 * POST — ABRIR O ATENDIMENTO (iniciar ou retomar).
 *
 * F1A: o corpo desta rota agora delega à operação canônica
 * `startOrResumeEncounter` (lib/encounter-start.ts), a MESMA usada por
 * /api/encounters/start. Não existe mais um caminho "de criação" paralelo:
 * retomar, iniciar e reaproveitar finalizado passam pela mesma função, dentro
 * da mesma transação, com as mesmas invariantes.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, 'atendimento');
    if (!guard.ok) return guard.res;
    const now = new Date().toISOString();
    const result = await updateDB((d: DB) => startOrResumeEncounter(d, {
      businessId,
      bookingId: String(body.bookingId || ''),
      queueId: String(body.queueId || ''),
      actor: guard.ctx.user,
      now,
      tz: effectiveTimezone(guard.ctx.business.businessTimezone),
      professionalScope: guard.ctx.professionalScope || '',
      body,
    }));
    if (result.created) {
      void publishWorkflowEvent({
        businessId, type: 'encounter.started', entityType: 'encounter', entityId: result.encounter.id,
        actor: { id: guard.ctx.user.id, name: guard.ctx.user.name }, bookingId: result.encounter.bookingId || undefined,
        from: result.encounter.bookingId ? 'arrived' : undefined, to: 'in_care', at: now,
      });
    }
    return NextResponse.json({
      ok: true,
      encounter: view(result.encounter, await readDB()),
      // `reused` é o contrato histórico da tela (abre o que já existe).
      reused: !result.created,
      created: result.created,
      outcome: result.outcome,
    });
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
    // A trava de concorrência é OBRIGATÓRIA (2ª revisão): sem `expectedVersion`
    // qualquer PATCH seria um overwrite cego — e esta API é nova, não há
    // chamador legítimo para manter funcionando sem trava.
    if (!hasExpectedVersion(body.expectedVersion)) {
      return NextResponse.json({ error: ENCOUNTER_VERSION_REQUIRED_ERROR }, { status: 400 });
    }

    const updated = await updateDB((d: DB) => {
      const target = d.encounters.find((e) => e.id === id && e.businessId === businessId);
      if (!target) throw err('Registro de atendimento não encontrado.', 404);
      if (!encounterInScope(target, guard.ctx.professionalScope)) {
        throw err('Você só registra os seus próprios atendimentos.', 403);
      }

      // ── Transições de estado (máquina explícita) ──
      // Na ordem: primeiro o que DESTRAVA o usuário (reabrir), depois a trava
      // de concorrência. Quem está numa versão velha E num registro finalizado
      // precisa ouvir a instrução certa — reabrir —, não um "recarregue".
      if (action === 'finalize') {
        const conflict = versionConflict(target, body.expectedVersion);
        if (conflict.conflict) throw err(conflict.message, 409);
        assertCanFinalizeCare(target); // in_care → finalized
        const check = canFinalize(target);
        if (!check.ok) throw err(check.error, 400);
        target.status = 'finalized';
        target.finalizedAt = now;
        target.finalizedBy = guard.ctx.user.id;
        target.signedBy = d.professionals.find((p) => p.id === target.professionalId)?.name
          || guard.ctx.user.name || '';
        target.updatedAt = now;
        target.updatedBy = guard.ctx.user.id;
        target.version = encounterVersionOf(target) + 1;
        // FASE 2 · P3 — finalizar CONCLUI o agendamento de origem pelo serviço
        // OFICIAL (histórico + automações + evento P4 + conversão do lead):
        // Results/Funil leem booking.status — sem isto o ciclo mentiria.
        // Cancelado/falta ficam intocados (máquina de estados preservada) e o
        // registro clínico NUNCA é apagado por remarcação/cancelamento.
        if (target.bookingId) {
          const bk = d.bookings.find((b) => b.id === target.bookingId && b.businessId === businessId);
          if (bk && bk.status === 'pending') {
            // pending → completed é proibido pela máquina (só via confirmed).
            applyBookingStatusTx(d, {
              businessId, bookingId: bk.id, to: 'confirmed', by: 'system', now,
              note: 'Atendimento em andamento (finalização do registro)',
            });
          }
          if (bk && (bk.status === 'confirmed')) {
            applyBookingStatusTx(d, {
              businessId, bookingId: bk.id, to: 'completed', by: 'owner', now,
              note: 'Atendimento finalizado',
            });
          }
        }
        pushAudit(d, {
          action: 'encounter.finalized', businessId, actor: guard.ctx.user,
          meta: { encounterId: target.id, bookingId: target.bookingId, version: target.version, workflow: 'in_care>finalized' },
        }, now);
        emitAutomationEvent(d, {
          event: 'encounter.completed',
          businessId,
          at: now,
          bookingId: target.bookingId || undefined,
          customerId: target.customerId || undefined,
          data: { encounterId: target.id, professionalId: target.professionalId, serviceId: target.serviceId, version: target.version },
        });
        return target;
      }
      if (action === 'reopen') {
        const conflict = versionConflict(target, body.expectedVersion);
        if (conflict.conflict) throw err(conflict.message, 409);
        if (target.status === 'draft') throw err('Este registro ainda é rascunho.', 409);
        if (!reopen) throw err('Só quem administra a unidade reabre um registro finalizado.', 403);
        target.status = 'draft';
        target.updatedAt = now;
        target.updatedBy = guard.ctx.user.id;
        target.version = encounterVersionOf(target) + 1;
        pushAudit(d, {
          action: 'encounter.reopened', businessId, actor: guard.ctx.user,
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
      // FASE 2 · P3 — retorno estruturado (validado antes de gravar).
      if (body.followUpMode !== undefined) {
        const problem = validateFollowUp({
          followUpMode: body.followUpMode, followUpDate: body.followUpDate ?? target.followUpDate,
          followUpDays: body.followUpDays ?? target.followUpDays,
        });
        if (problem) throw err(problem, 400);
        if (!isFollowUpMode(body.followUpMode)) throw err('Forma de retorno inválida.', 400);
        target.followUpMode = body.followUpMode;
        if (body.followUpDate !== undefined) target.followUpDate = String(body.followUpDate || '').slice(0, 10);
        if (body.followUpDays !== undefined) {
          const n = Math.round(Number(body.followUpDays));
          target.followUpDays = Number.isFinite(n) && n > 0 ? n : 0;
        }
      }
      // FASE 2 · P3 — arquivos: só referências (o binário fica no Storage).
      if (body.files !== undefined) target.files = cleanEncounterFiles(body.files);
      const changed = ([
        'complaint', 'evolution', 'guidance', 'followUp', 'internalNote', 'tags',
        'followUpMode', 'followUpDate', 'followUpDays', 'files',
      ] as const)
        .filter((f) => JSON.stringify((before as any)[f]) !== JSON.stringify((target as any)[f]));
      if (changed.length === 0) {
        // Nada mudou: não inventa versão nova nem suja a auditoria (o autosave
        // da tela bate aqui com frequência e precisa ser barato e honesto).
        return target;
      }
      target.updatedAt = now;
      target.updatedBy = guard.ctx.user.id;
      target.version = encounterVersionOf(target) + 1;
      pushAudit(d, {
        action: 'encounter.updated', businessId, actor: guard.ctx.user,
        meta: { encounterId: target.id, fields: changed, version: target.version },
      }, now);
      return target;
    });
    if (action === 'finalize') {
      void publishWorkflowEvent({
        businessId, type: 'encounter.finalized', entityType: 'encounter', entityId: updated.id,
        actor: { id: guard.ctx.user.id, name: guard.ctx.user.name }, bookingId: updated.bookingId || undefined,
        from: 'in_care', to: 'finalized', at: now,
      });
    }
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
