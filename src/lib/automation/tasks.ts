// ═══════════════════════════════════════════════════════════════
// P4.5 — TAREFAS INTERNAS DA UNIDADE (fila de trabalho da equipe)
// ═══════════════════════════════════════════════════════════════
// O sistema NÃO tinha "tarefa": a automação precisava de um lugar honesto para
// dizer "alguém precisa fazer X". Em vez de inventar um campo solto no lead
// (que viraria segundo CRM), existe UMA estrutura (`Task`) compartilhada pela
// automação e pela equipe, com vínculo opcional em lead/agendamento/cliente.
//
// Regras:
//   • isolamento por `businessId` em toda leitura e escrita;
//   • criação idempotente por execução+nó (retry do motor não duplica tarefa);
//   • concluir/cancelar nunca apaga o registro (histórico preservado);
//   • espelha `Lead.nextAction` quando a tarefa é de um lead — a esteira fica
//     informada SEM criar segunda fonte de verdade (o espelhamento é sempre
//     daqui, nunca o contrário).
import { randomUUID } from 'node:crypto';
import type { DB, Task, TaskStatus } from '../types';

export interface CreateTaskInput {
  businessId: string;
  title: string;
  note?: string;
  /** Prazo absoluto (ISO). */
  dueAt?: string;
  assignedUserId?: string;
  createdBy: string; // userId ou 'automation'
  source?: 'automation' | 'manual';
  leadId?: string;
  bookingId?: string;
  customerId?: string;
  automationId?: string;
  automationRunId?: string;
  /** Nó que criou a tarefa (dedupe em retomada de execução). */
  automationNodeId?: string;
  now?: string;
}

export const TASK_TITLE_MAX = 140;
export const TASK_NOTE_MAX = 1000;
/** Teto de tarefas abertas por unidade (proteção contra criação descontrolada). */
export const MAX_OPEN_TASKS_PER_BUSINESS = 500;

export function tasksOf(db: DB, businessId: string): Task[] {
  if (!Array.isArray(db.tasks)) db.tasks = [];
  return db.tasks.filter((t) => t && t.businessId === businessId);
}

/** Tarefas abertas (as vencidas primeiro), com teto de listagem. */
export function openTasks(db: DB, businessId: string, limit = 50): Task[] {
  return tasksOf(db, businessId)
    .filter((t) => t.status === 'open')
    .sort((a, b) => {
      const ad = a.dueAt || '9999';
      const bd = b.dueAt || '9999';
      if (ad !== bd) return ad < bd ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : 1;
    })
    .slice(0, Math.max(1, Math.min(limit, 200)));
}

export function taskById(db: DB, businessId: string, taskId: string): Task | undefined {
  return tasksOf(db, businessId).find((t) => t.id === taskId);
}

/**
 * Cria a tarefa. Retorna `{ task, created:false }` quando uma tarefa idêntica
 * já existe para a MESMA execução+nó (retomada não duplica) ou quando o teto
 * de tarefas abertas foi atingido (falha segura — a automação não explode).
 */
export function createTaskTx(db: DB, input: CreateTaskInput): { task: Task | null; created: boolean; reason?: string } {
  if (!Array.isArray(db.tasks)) db.tasks = [];
  const title = String(input.title || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, TASK_TITLE_MAX);
  if (!title) return { task: null, created: false, reason: 'tarefa sem título' };

  // Vínculos pertencem à UNIDADE da tarefa. Um id de outra empresa nunca é
  // aceito (nem gravado, nem lido de volta): é o mesmo critério do resto do
  // produto — a unidade autenticada decide o alcance de qualquer referência.
  if (input.leadId && !db.leads.some((l) => l.id === input.leadId && l.businessId === input.businessId)) {
    return { task: null, created: false, reason: 'lead não pertence a esta unidade' };
  }
  if (input.bookingId && !db.bookings.some((b) => b.id === input.bookingId && b.businessId === input.businessId)) {
    return { task: null, created: false, reason: 'agendamento não pertence a esta unidade' };
  }
  if (input.customerId && !db.contacts.some(
    (c) => (c.id === input.customerId || c.customerId === input.customerId) && c.businessId === input.businessId,
  )) {
    return { task: null, created: false, reason: 'cliente não pertence a esta unidade' };
  }

  // Idempotência por execução + nó (o motor pode reaplicar o passo).
  if (input.automationRunId && input.automationNodeId) {
    const dup = db.tasks.find(
      (t) => t.businessId === input.businessId
        && t.automationRunId === input.automationRunId
        && t.automationNodeId === input.automationNodeId,
    );
    if (dup) return { task: dup, created: false, reason: 'tarefa já criada por esta execução' };
  }

  const open = db.tasks.filter((t) => t.businessId === input.businessId && t.status === 'open').length;
  if (open >= MAX_OPEN_TASKS_PER_BUSINESS) {
    return { task: null, created: false, reason: `limite de ${MAX_OPEN_TASKS_PER_BUSINESS} tarefas abertas atingido` };
  }

  const now = input.now || new Date().toISOString();
  const task: Task = {
    id: randomUUID(),
    businessId: input.businessId,
    title,
    note: String(input.note || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, TASK_NOTE_MAX),
    status: 'open',
    dueAt: String(input.dueAt || ''),
    createdAt: now,
    updatedAt: now,
    doneAt: '',
    assignedUserId: String(input.assignedUserId || ''),
    createdBy: String(input.createdBy || 'automation'),
    source: input.source === 'manual' ? 'manual' : 'automation',
  };
  if (input.leadId) task.leadId = input.leadId;
  if (input.bookingId) task.bookingId = input.bookingId;
  if (input.customerId) task.customerId = input.customerId;
  if (input.automationId) task.automationId = input.automationId;
  if (input.automationRunId) task.automationRunId = input.automationRunId;
  db.tasks.push(task);

  // Espelha a "próxima ação" no lead (a esteira mostra a pendência) — só
  // quando ainda não há nada anotado ou quando a tarefa veio da automação.
  if (input.leadId) {
    const lead = db.leads.find((l) => l.id === input.leadId && l.businessId === input.businessId);
    if (lead && (!lead.nextAction || lead.nextAction.trim() === '')) {
      lead.nextAction = title.slice(0, 300);
    }
  }
  return { task, created: true };
}

/** Conclui (ou reabre) uma tarefa da unidade. Nunca apaga o registro. */
export function setTaskStatusTx(
  db: DB,
  input: { businessId: string; taskId: string; status: TaskStatus; by?: string; now?: string },
): Task | null {
  const task = taskById(db, input.businessId, input.taskId);
  if (!task) return null;
  const now = input.now || new Date().toISOString();
  task.status = input.status;
  task.updatedAt = now;
  task.doneAt = input.status === 'done' ? now : '';
  if (input.by) task.assignedUserId = task.assignedUserId || '';
  return task;
}

export interface TaskSummary {
  open: number;
  overdue: number;
  dueToday: number;
  mine: number;
}

/** Contadores para a tela (e para o card de Automações no dashboard). */
export function summarizeTasks(db: DB, businessId: string, todayISO: string, userId = ''): TaskSummary {
  const open = tasksOf(db, businessId).filter((t) => t.status === 'open');
  return {
    open: open.length,
    overdue: open.filter((t) => !!t.dueAt && t.dueAt.slice(0, 10) < todayISO).length,
    dueToday: open.filter((t) => !!t.dueAt && t.dueAt.slice(0, 10) === todayISO).length,
    mine: userId ? open.filter((t) => t.assignedUserId === userId).length : 0,
  };
}

/** Rótulo curto de prazo (usado no painel e no histórico da automação). */
export function taskDueLabel(dueAt: string, todayISO: string): string {
  if (!dueAt) return 'sem prazo';
  const day = dueAt.slice(0, 10);
  const hm = dueAt.length > 10 ? ` ${dueAt.slice(11, 16)}` : '';
  if (day === todayISO) return `hoje${hm}`;
  if (day < todayISO) return `atrasada (${day.split('-').reverse().join('/')})`;
  return `${day.split('-').reverse().join('/')}${hm}`;
}
