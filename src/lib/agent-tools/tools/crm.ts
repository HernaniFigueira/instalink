// F3-D — tools de CRM (leads, etapas, tarefas, nota administrativa)
import type { ToolDef } from '../types';
import { ingestLead, findLead, moveLeadStage } from '../../pipeline';
import { createTaskTx } from '../../automation/tasks';
import { findContact, addContactNote } from '../../contacts';
import { randomUUID } from 'node:crypto';

export const createLead: ToolDef<{
  name?: string; phone?: string; email?: string; interest?: string; message?: string;
}, { leadId: string; isNew: boolean; name: string }> = {
  name: 'createLead',
  description: 'Cria/atualiza lead no funil (dedupe por telefone/e-mail).',
  domain: 'crm',
  sideEffect: 'write',
  requiresPermission: 'leads',
  requiresConfirm: false,
  inputSchema: [
    { name: 'name', type: 'string', required: false, max: 80 },
    { name: 'phone', type: 'string', required: false, max: 20 },
    { name: 'email', type: 'string', required: false, max: 120 },
    { name: 'interest', type: 'string', required: false, max: 200 },
    { name: 'message', type: 'string', required: false, max: 500 },
  ],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const out = ingestLead(ctx.db, {
      businessId: ctx.businessId,
      name: input.name,
      phone: input.phone,
      email: input.email,
      interest: input.interest,
      message: input.message,
      source: 'agent',
      actor: { type: 'agent', id: ctx.actor.userId, name: ctx.actor.name || ctx.actor.email },
      now: ctx.now,
    });
    return { leadId: out.lead.id, isNew: out.isNew, name: out.lead.name };
  },
};

export const updateLeadStage: ToolDef<{ leadId: string; stageId: string; note?: string }, {
  leadId: string; stageId: string;
}> = {
  name: 'updateLeadStage',
  description: 'Move lead de etapa na esteira oficial.',
  domain: 'crm',
  sideEffect: 'write',
  requiresPermission: 'leads',
  requiresConfirm: false,
  inputSchema: [
    { name: 'leadId', type: 'string', required: true, max: 64 },
    { name: 'stageId', type: 'string', required: true, max: 32 },
    { name: 'note', type: 'string', required: false, max: 300 },
  ],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const lead = findLead(ctx.db, ctx.businessId, { id: input.leadId });
    if (!lead) throw Object.assign(new Error('Lead não encontrado.'), { status: 404 });
    const updated = moveLeadStage(ctx.db, {
      businessId: ctx.businessId,
      leadId: lead.id,
      toStageId: input.stageId,
      note: input.note,
      actor: { id: ctx.actor.userId, name: ctx.actor.name || ctx.actor.email, role: ctx.actor.role },
      now: ctx.now,
    });
    return { leadId: updated.id, stageId: updated.stageId || updated.status };
  },
};

export const createTask: ToolDef<{ title: string; note?: string; dueAt?: string; leadId?: string }, {
  taskId: string | null; created: boolean; reason?: string;
}> = {
  name: 'createTask',
  description: 'Cria tarefa para a equipe.',
  domain: 'crm',
  sideEffect: 'write',
  requiresPermission: 'agenda',
  requiresConfirm: false,
  inputSchema: [
    { name: 'title', type: 'string', required: true, max: 140 },
    { name: 'note', type: 'string', required: false, max: 1000 },
    { name: 'dueAt', type: 'string', required: false, max: 40 },
    { name: 'leadId', type: 'string', required: false, max: 64 },
  ],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const res = createTaskTx(ctx.db, {
      businessId: ctx.businessId,
      title: input.title,
      note: input.note,
      dueAt: input.dueAt,
      leadId: input.leadId,
      createdBy: ctx.actor.userId,
      source: 'manual',
      now: ctx.now,
    });
    return { taskId: res.task?.id || null, created: res.created, reason: res.reason };
  },
};

export const addAdministrativeNote: ToolDef<{ contactId: string; text: string }, {
  contactId: string; ok: boolean;
}> = {
  name: 'addAdministrativeNote',
  description: 'Nota administrativa no contato (append-only).',
  domain: 'crm',
  sideEffect: 'write',
  requiresPermission: 'clientes',
  requiresConfirm: false,
  inputSchema: [
    { name: 'contactId', type: 'string', required: true, max: 64 },
    { name: 'text', type: 'string', required: true, max: 1000 },
  ],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const c = (ctx.db.contacts || []).find(
      (x) => x.id === input.contactId && x.businessId === ctx.businessId,
    );
    if (!c) throw Object.assign(new Error('Contato não encontrado.'), { status: 404 });
    const note = addContactNote(c, {
      text: input.text,
      by: ctx.actor.userId,
      byName: ctx.actor.name || ctx.actor.email,
      at: ctx.now,
    });
    if (!note) throw Object.assign(new Error('Nota vazia.'), { status: 400 });
    return { contactId: c.id, ok: true };
  },
};

export const crmTools = [createLead, updateLeadStage, createTask, addAdministrativeNote];
