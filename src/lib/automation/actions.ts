// ═══════════════════════════════════════════════════════════════
// P4.5 — AÇÕES (camada de orquestração: delega, nunca reimplementa)
// ═══════════════════════════════════════════════════════════════
// Regra inegociável deste arquivo: NENHUMA regra de negócio nasce aqui.
// Cada ação chama a função OFICIAL do sistema para aquele efeito:
//
//   mover de etapa     → lib/pipeline.ts · moveLeadStage   (histórico + status)
//   atribuir           → lib/pipeline.ts · assignLead      (valida a equipe)
//   observação         → lib/pipeline.ts · addLeadNote      (replica no contato)
//   atualizar lead     → lib/pipeline.ts · updateLeadFields (mesma do painel)
//   atualizar cliente  → lib/contacts.ts · addContactNote / upsertContact
//   tarefa             → lib/automation/tasks.ts · createTaskTx
//   agendar            → lib/pipeline.ts · bookLead → createBookingTx (slot!)
//   cancelar           → lib/booking-status.ts · applyBookingStatusTx (máquina de estados)
//   webhook            → lib/integrations/outbound.ts · enqueueOutboundWebhooksTx
//                        (P6 enfileira; pós-commit entrega pelo P3: HMAC + retry)
//
// Consequências:
//   • businessId é sempre o da EXECUÇÃO (o id do payload nunca é aceito cru);
//   • regras de agenda/esteira continuam valendo (409 de slot ocupado,
//     responsável de outra unidade rejeitado, etapa inexistente rejeitada);
//   • idempotência: ação já aplicada é reconhecida e PULADA (a retomada de
//     uma execução interrompida não duplica efeito);
//   • erro em ação não corrompe estado: o executor grava `failed` + mensagem.
import { randomUUID } from 'node:crypto';
import type {
  Automation, AutomationActionType, AutomationRun, Business, DB, WebhookEvent,
} from '../types';
import { VALID_WEBHOOK_EVENTS } from '../types';
import {
  addLeadNote, assignLead, bookLead, moveLeadStage, updateLeadFields, validateAssignedUser,
  type LeadActor,
} from '../pipeline';
import { addContactNote, findContact } from '../contacts';
import { applyBookingStatusTx } from '../booking-status';
// P6 — conector de saída (a ação não conhece provedor; a camada resolve).
import { enqueueOutboundWebhooksTx } from '../integrations/outbound';
import { createTaskTx } from './tasks';
import { renderParams } from './conditions';
import { addDaysISO, todayISO } from '../tz';
import { automationActionDef } from './model';
import { onlyDigits } from '../utils';

export const AUTOMATION_ACTOR: LeadActor = { id: 'automation', name: 'Automação', type: 'system' };

export interface ActionInput {
  db: DB;
  business: Business;
  automation: Automation;
  run: AutomationRun;
  nodeId: string;
  now: string;
  /** Parâmetros JÁ renderizados ({{lead.name}} substituído). */
  params: Record<string, any>;
}

export interface ActionResult {
  ok: boolean;
  /** Frase curta para o histórico (sem segredo, sem payload cru). */
  summary: string;
  /** true quando não havia o que fazer (não é erro). */
  skipped?: boolean;
  error?: string;
  /** Publicado em `run.context.result.<ação>` para os próximos passos. */
  contextPatch?: Record<string, unknown>;
}

function subjectLead(input: ActionInput) {
  const id = String(input.run.context?.lead?.id || '');
  if (!id) return null;
  return input.db.leads.find((l) => l.id === id && l.businessId === input.business.id) || null;
}

function subjectBooking(input: ActionInput) {
  const id = String(input.run.context?.booking?.id || '');
  if (!id) return null;
  return input.db.bookings.find((b) => b.id === id && b.businessId === input.business.id) || null;
}

function subjectContact(input: ActionInput) {
  const cid = String(input.run.context?.customer?.id || '');
  const lead = subjectLead(input);
  if (cid) {
    const direct = input.db.contacts.find((c) => c.id === cid && c.businessId === input.business.id);
    if (direct) return direct;
  }
  if (lead) {
    return findContact(input.db, input.business.id, lead.customerId || '', lead.phone || '', lead.name || '');
  }
  const booking = subjectBooking(input);
  if (booking) return findContact(input.db, input.business.id, booking.customerId || '', booking.customerPhone || '', '');
  return undefined;
}

function text(input: ActionInput, key: string, max = 1000): string {
  return String(input.params?.[key] ?? '').trim().slice(0, max);
}

function num(input: ActionInput, key: string): number | null {
  const raw = input.params?.[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Nome exibido no histórico da esteira (quem fez: a automação, pelo nome). */
function actorOf(input: ActionInput) {
  const name = `Automação · ${input.automation.name}`.slice(0, 60);
  return { id: AUTOMATION_ACTOR.id!, name, role: 'system' };
}

/** Menos carregado agora (tarefa atribuída + leads abertos sob sua guarda). */
function leastLoadedMember(db: DB, businessId: string): string {
  const candidates = db.members
    .filter((m) => m.businessId === businessId && m.active !== false)
    .map((m) => m.userId)
    .filter(Boolean);
  const business = db.businesses.find((b) => b.id === businessId);
  const pool = candidates.length > 0 ? [...new Set(candidates)] : business?.ownerId ? [business.ownerId] : [];
  if (pool.length === 0) return '';
  const openLeads = db.leads.filter(
    (l) => l.businessId === businessId && l.status !== 'converted' && l.status !== 'lost',
  );
  const openTasks = db.tasks.filter((t) => t.businessId === businessId && t.status === 'open');
  let best = pool[0];
  let bestLoad = Number.POSITIVE_INFINITY;
  for (const userId of pool) {
    const load = openLeads.filter((l) => l.assignedUserId === userId).length
      + openTasks.filter((t) => t.assignedUserId === userId).length * 0.5;
    if (load < bestLoad) { bestLoad = load; best = userId; }
  }
  return best;
}

/** Rótulo de um valor de contexto ausente → erro claro (nunca stack trace). */
function missing(what: string): ActionResult {
  return { ok: false, summary: '', error: `${what} indisponível neste gatilho` };
}

/**
 * Executa UMA ação do nó. Sincronamente sobre o `db` recebido (o executor está
 * dentro de uma transação). Webhook apenas grava a outbox; o HTTP acontece
 * depois do commit pelo consumidor P3, com claim, HMAC e retry existentes.
 * `params.__type` vem do nó (fora do `params` validado, para nenhum template
 * poder sobrescrever a ação a ser executada).
 */
export function executeAction(input: ActionInput): ActionResult {
  const actionType = input.params?.__type as AutomationActionType | undefined;
  const def = automationActionDef(actionType);
  if (!def) return { ok: false, summary: '', error: `ação desconhecida: ${actionType || '(vazia)'}` };
  const { db, business } = input;

  switch (actionType) {
    case 'change_lead_stage': {
      const lead = subjectLead(input);
      if (!lead) return missing('lead');
      const toStageId = text(input, 'stageId', 32);
      if (!toStageId) return { ok: false, summary: '', error: 'etapa de destino não informada' };
      const current = lead.stageId || lead.status || 'new';
      if (current === toStageId) {
        return { ok: true, skipped: true, summary: `já estava na etapa ${toStageId}` };
      }
      try {
        moveLeadStage(db, {
          businessId: business.id,
          leadId: lead.id,
          toStageId,
          note: text(input, 'note', 300) || undefined,
          actor: actorOf(input),
          now: input.now,
          origin: { runId: input.run.id, automationId: input.automation.id },
        });
      } catch (e: any) {
        return { ok: false, summary: '', error: e?.message || 'não foi possível mover o lead' };
      }
      return {
        ok: true,
        summary: `lead para a etapa ${lead.stageId}`,
        contextPatch: { leadStageId: lead.stageId, leadStatus: lead.status },
      };
    }

    case 'assign_lead': {
      const lead = subjectLead(input);
      if (!lead) return missing('lead');
      const target = text(input, 'target', 20) || 'member';
      const unassign = target === 'unassigned';
      let userId = unassign ? '' : target === 'auto'
        ? leastLoadedMember(db, business.id)
        : text(input, 'userId', 64);
      if (!userId && !unassign) {
        return { ok: false, summary: '', error: 'nenhuma pessoa disponível para receber o lead' };
      }
      const check = validateAssignedUser(db, business.id, userId);
      if (!check.valid) return { ok: false, summary: '', error: check.error || 'responsável inválido' };
      if ((lead.assignedUserId || '') === userId) {
        return { ok: true, skipped: true, summary: unassign ? 'lead já estava sem responsável' : 'responsável já é essa pessoa' };
      }
      try {
        assignLead(db, {
          businessId: business.id,
          leadId: lead.id,
          assignedUserId: userId,
          actor: actorOf(input),
          now: input.now,
          note: text(input, 'note', 300) || undefined,
          origin: { runId: input.run.id, automationId: input.automation.id },
        });
      } catch (e: any) {
        return { ok: false, summary: '', error: e?.message || 'não foi possível atribuir o lead' };
      }
      const assignedName = userId ? (db.users.find((u) => u.id === userId)?.name || 'responsável') : 'ninguém';
      return {
        ok: true,
        summary: userId ? `atribuído a ${assignedName}` : 'responsável removido',
        contextPatch: { assignedUserId: userId, assignedTo: assignedName },
      };
    }

    case 'add_lead_note': {
      const lead = subjectLead(input);
      if (!lead) return missing('lead');
      const body = text(input, 'text', 1000);
      if (!body) return { ok: false, summary: '', error: 'texto da observação vazio' };
      // Idempotência de retomada: mesma execução não repete a mesma nota.
      const already = (lead.notes || []).some((n) => n.by === `${AUTOMATION_ACTOR.id}:${input.run.id}:${input.nodeId}`);
      if (already) return { ok: true, skipped: true, summary: 'observação já registrada por esta execução' };
      try {
        addLeadNote(db, {
          businessId: business.id,
          leadId: lead.id,
          text: body,
          actor: { id: `${AUTOMATION_ACTOR.id}:${input.run.id}:${input.nodeId}`, name: actorOf(input).name },
          now: input.now,
        });
      } catch (e: any) {
        return { ok: false, summary: '', error: e?.message || 'não foi possível registrar a observação' };
      }
      return { ok: true, summary: 'observação registrada no lead' };
    }

    case 'update_lead': {
      const lead = subjectLead(input);
      if (!lead) return missing('lead');
      const patch: Parameters<typeof updateLeadFields>[1]['patch'] = {};
      const priority = text(input, 'priority', 12);
      if (priority) patch.priority = priority as any;
      const interest = text(input, 'interest', 500);
      if (interest) patch.interest = interest;
      const nextAction = text(input, 'nextAction', 300);
      if (nextAction) patch.nextAction = nextAction;
      if (Object.keys(patch).length === 0) return { ok: true, skipped: true, summary: 'nada para atualizar no lead' };
      try {
        updateLeadFields(db, {
          businessId: business.id, leadId: lead.id, patch, now: input.now,
          origin: { runId: input.run.id, automationId: input.automation.id },
        });
      } catch (e: any) {
        return { ok: false, summary: '', error: e?.message || 'não foi possível atualizar o lead' };
      }
      return { ok: true, summary: `lead atualizado (${Object.keys(patch).join(', ')})` };
    }

    case 'update_customer': {
      const contact = subjectContact(input);
      if (!contact) return missing('cliente na base');
      const name = text(input, 'name', 80);
      const email = text(input, 'email', 120);
      const note = text(input, 'note', 1000);
      const changed: string[] = [];
      if (name && name !== contact.name) { contact.name = name; changed.push('nome'); }
      if (email && email !== contact.email) { contact.email = email.toLowerCase(); changed.push('e-mail'); }
      if (input.params?.marketingOptIn === false && contact.marketingOptIn) {
        // Consentimento é só para RETIRAR por automação: ligar exigiria o
        // registro da vontade do próprio cliente (regra do produto, nunca
        // presumido). A automação respeita isso em vez de contornar.
        contact.marketingOptIn = false;
        changed.push('opt-out de campanhas');
      }
      if (note) {
        const already = (contact.notes || []).some((n) => n.by === `${AUTOMATION_ACTOR.id}:${input.run.id}:${input.nodeId}`);
        if (!already) {
          addContactNote(contact, {
            text: note,
            by: `${AUTOMATION_ACTOR.id}:${input.run.id}:${input.nodeId}`,
            byName: actorOf(input).name,
            at: input.now,
          });
          changed.push('observação');
        }
      }
      contact.updatedAt = input.now;
      if (changed.length === 0) return { ok: true, skipped: true, summary: 'nada para atualizar no cliente' };
      return { ok: true, summary: `cliente atualizado (${changed.join(', ')})` };
    }

    case 'create_task': {
      const title = text(input, 'title', 140);
      if (!title) return { ok: false, summary: '', error: 'tarefa sem título' };
      const dueMinutes = num(input, 'dueInMinutes');
      const lead = subjectLead(input);
      const booking = subjectBooking(input);
      const contact = subjectContact(input);
      const target = text(input, 'assignee', 20);
      let assignedUserId = text(input, 'assignedUserId', 64);
      if (target === 'leadOwner') assignedUserId = lead?.assignedUserId || '';
      else if (target === 'auto') assignedUserId = leastLoadedMember(db, business.id);
      if (assignedUserId && !validateAssignedUser(db, business.id, assignedUserId).valid) {
        return { ok: false, summary: '', error: 'responsável da tarefa não pertence a esta unidade' };
      }
      const res = createTaskTx(db, {
        businessId: business.id,
        title,
        note: text(input, 'note', 1000),
        dueAt: dueMinutes && dueMinutes > 0
          ? new Date(Date.parse(input.now) + dueMinutes * 60000).toISOString()
          : '',
        assignedUserId,
        createdBy: AUTOMATION_ACTOR.id!,
        source: 'automation',
        leadId: lead?.id,
        bookingId: booking?.id,
        customerId: contact?.id,
        automationId: input.automation.id,
        automationRunId: input.run.id,
        automationNodeId: input.nodeId,
        now: input.now,
      });
      if (!res.task) return { ok: false, summary: '', error: res.reason || 'não foi possível criar a tarefa' };
      if (!res.created) return { ok: true, skipped: true, summary: res.reason || 'tarefa já existe' };
      return { ok: true, summary: `tarefa criada: ${res.task.title}`.slice(0, 160), contextPatch: { taskId: res.task.id } };
    }

    case 'create_booking': {
      const lead = subjectLead(input);
      if (!lead) return missing('lead');
      const serviceId = text(input, 'serviceId', 64);
      const service = db.services.find((s) => s.id === serviceId && s.businessId === business.id && s.active !== false);
      if (!service) return { ok: false, summary: '', error: 'serviço inexistente ou inativo nesta empresa' };
      let date = text(input, 'date', 20);
      const days = num(input, 'daysFromTrigger');
      if (!date && days && days > 0) date = addDaysISO(todayISO(new Date(input.now)), Math.min(Math.floor(days), 365));
      if (!date) date = addDaysISO(todayISO(new Date(input.now)), 1);
      const time = text(input, 'time', 8);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
        return { ok: false, summary: '', error: 'data/hora do agendamento inválidas (use AAAA-MM-DD e HH:MM)' };
      }
      if (lead.bookingId && db.bookings.some((b) => b.id === lead.bookingId && ['pending', 'confirmed'].includes(b.status))) {
        return { ok: true, skipped: true, summary: 'o lead já tem um agendamento em aberto' };
      }
      try {
        const { booking } = bookLead(db, {
          business,
          service,
          leadId: lead.id,
          date,
          time,
          note: text(input, 'note', 300) || `Criado pela automação "${input.automation.name}"`,
          actor: actorOf(input),
          now: input.now,
          originRunId: input.run.id,
        });
        return {
          ok: true,
          summary: `agendado para ${date.split('-').reverse().join('/')} às ${time}`,
          contextPatch: { bookingId: booking.id },
        };
      } catch (e: any) {
        return { ok: false, summary: '', error: e?.message || 'a agenda recusou o novo horário' };
      }
    }

    case 'cancel_booking': {
      const booking = subjectBooking(input);
      if (!booking) return missing('agendamento');
      if (booking.status === 'cancelled') return { ok: true, skipped: true, summary: 'agendamento já cancelado' };
      const res = applyBookingStatusTx(db, {
        businessId: business.id,
        bookingId: booking.id,
        to: 'cancelled',
        by: 'system',
        note: text(input, 'reason', 300) || `Cancelado pela automação "${input.automation.name}"`.slice(0, 300),
        now: input.now,
        originRunId: input.run.id,
      });
      if (!res.ok) return { ok: false, summary: '', error: res.error || 'não foi possível cancelar' };
      return { ok: true, summary: 'agendamento cancelado' };
    }

    case 'dispatch_webhook': {
      const event = text(input, 'event', 40);
      if (!VALID_WEBHOOK_EVENTS.includes(event as any)) {
        return { ok: false, summary: '', error: `evento de webhook inválido: ${event || '(vazio)'}` };
      }
      const data: Record<string, any> = {
        source: 'automation',
        automationId: input.automation.id,
        automationRunId: input.run.id,
      };
      const lead = subjectLead(input);
      const booking = subjectBooking(input);
      if (lead) data.leadId = lead.id;
      if (booking) data.bookingId = booking.id;
      const note = text(input, 'note', 300);
      if (note) data.note = note;
      try {
        // P6 — só a parte transacional do destino webhook. O executor entrega
        // pelo P3 APÓS o commit; nunca chamar um conector HTTP neste passo.
        const dispatched = enqueueOutboundWebhooksTx(db, {
          businessId: business.id,
          event: event as WebhookEvent,
          data,
        }, `evt_auto_${input.run.id}_${input.nodeId}`);
        if (dispatched.webhooks.destinations === 0) {
          return { ok: true, skipped: true, summary: 'nenhum webhook ativo para este evento' };
        }
        return { ok: true, summary: `webhook ${event} enfileirado → ${dispatched.webhooks.deliveries.length} destino(s)` };
      } catch (e: any) {
        return { ok: false, summary: '', error: e?.message || 'falha ao enfileirar o webhook' };
      }
    }

    case 'send_channel_message': {
      const lead = subjectLead(input);
      const booking = subjectBooking(input);
      const contact = subjectContact(input);
      const rawPhone = lead?.phone || booking?.customerPhone || contact?.phone || input.run.context?.contact?.phone || input.params?.to || '';
      const phone = onlyDigits(String(rawPhone || ''));
      if (!phone || phone.length < 10) return missing('telefone do destinatário');

      const msgText = text(input, 'message', 2000) || text(input, 'body', 2000);
      if (!msgText) return { ok: false, summary: '', error: 'mensagem vazia' };

      const templateName = text(input, 'templateName', 120);

      let conv = db.conversations.find((c) => c.businessId === business.id && c.phone === phone);
      if (!conv) {
        conv = {
          id: randomUUID(),
          businessId: business.id,
          channel: 'whatsapp',
          contactId: contact?.id || lead?.customerId || '',
          customerId: contact?.customerId || lead?.customerId || '',
          name: contact?.name || lead?.name || phone,
          phone,
          status: 'open',
          mode: 'automation',
          unread: 0,
          lastMessageAt: input.now,
          lastMessagePreview: msgText.slice(0, 120),
          createdAt: input.now,
          context: lead ? { leadId: lead.id } : {},
        };
        db.conversations.push(conv);
      } else {
        conv.lastMessageAt = input.now;
        conv.lastMessagePreview = msgText.slice(0, 120);
      }

      const msgId = randomUUID();
      db.messages.push({
        id: msgId,
        businessId: business.id,
        conversationId: conv.id,
        direction: 'out',
        body: msgText,
        status: 'pending',
        externalId: '',
        by: 'automation',
        byName: 'Automação',
        at: input.now,
        meta: {
          templateName: templateName || undefined,
          originRunId: input.run.id,
        },
      });

      return {
        ok: true,
        summary: `mensagem para ${phone} enfileirada no WhatsApp`,
        contextPatch: { messageId: msgId, phone },
      };
    }

    default:
      return { ok: false, summary: '', error: `ação ainda não suportada: ${String(actionType)}` };
  }
}

/**
 * Renderiza os parâmetros do nó sobre o contexto e injeta o tipo da ação
 * (mantido fora de `params` para que templates não o substituam).
 */
export function prepareActionParams(nodeAction: { type: AutomationActionType; params: Record<string, any> } | undefined, run: AutomationRun): Record<string, any> {
  if (!nodeAction) return { __type: undefined };
  const rendered = renderParams(nodeAction.params || {}, run.context);
  return { ...rendered, __type: nodeAction.type };
}

