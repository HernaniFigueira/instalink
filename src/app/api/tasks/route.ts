// ═══════════════════════════════════════════════════════════════
// P4.5 — TAREFAS INTERNAS (a fila que a automação alimenta)
// ═══════════════════════════════════════════════════════════════
// Uma automação que "cria tarefa" precisa de um lugar onde a tarefa EXISTE e
// é operável — não de um campo solto. Esta rota expõe a estrutura única
// (`db.tasks`) para a equipe ver e concluir, sempre escopada pela unidade do
// contexto autenticado. Escrita: dono/admin/secretária/vendedor (permissões
// de esteira/agenda/clientes).
import { NextRequest, NextResponse } from 'next/server';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { pushAudit } from '@/lib/audit';
import { relationalActive } from '@/lib/relational/config';
import { runRelationalWrite, runRelationalRead, type SliceSpec } from '@/lib/relational/slice';
import {
  createTaskTx, openTasks, setTaskStatusTx, summarizeTasks, taskAssigneeOptions, taskDueLabel,
} from '@/lib/automation/tasks';
import { validateAssignedUser } from '@/lib/pipeline';
import { todayISO } from '@/lib/tz';
import type { Task } from '@/lib/types';

function view(db: any, t: Task) {
  // Toda referência é lida DENTRO da unidade da tarefa: um vínculo que não é
  // dali nunca vira nome exibido (defesa em profundidade — a criação já recusa).
  const lead = t.leadId ? (db.leads || []).find((l: any) => l.id === t.leadId && l.businessId === t.businessId) : null;
  const booking = t.bookingId ? (db.bookings || []).find((b: any) => b.id === t.bookingId && b.businessId === t.businessId) : null;
  // A3.4 fix (fechamento do B5): a ficha da pessoa mostra o contato — a view
  // devolve a quem a tarefa está amarrada para a equipe não ficar adivinhando.
  const contact = t.customerId
    ? (db.contacts || []).find((c: any) => (c.id === t.customerId || c.customerId === t.customerId) && c.businessId === t.businessId)
    : null;
  const assignee = t.assignedUserId ? (db.users || []).find((u: any) => u.id === t.assignedUserId) : null;
  return {
    ...t,
    dueLabel: taskDueLabel(t.dueAt, todayISO()),
    leadName: lead?.name || '',
    bookingLabel: booking ? `${booking.date.split('-').reverse().join('/')} ${booking.time}` : '',
    contactId: contact?.id || '',
    contactName: contact?.name || t.customerId && booking?.customerName || '',
    assigneeName: assignee?.name || '',
    fromAutomation: t.createdBy === 'automation',
  };
}

export async function GET(req: NextRequest) {
  const businessId = String(req.nextUrl.searchParams.get('businessId') || '');
  const guard = await requireBusiness(req, businessId, ['leads', 'agenda', 'clientes', 'config']);
  if (!guard.ok) return guard.res;
  const status = req.nextUrl.searchParams.get('status') || 'open';
  const mineOnly = req.nextUrl.searchParams.get('mine') === '1';
  const today = todayISO();
  /** View PURA (DOIS MOTORES): lista + resumo + responsáveis. */
  const listView = (db: any) => {
    const list = (db.tasks || []).filter((t: any) => t.businessId === businessId && (status === 'all' || t.status === status));
    const scoped = mineOnly ? list.filter((t: any) => t.assignedUserId === guard.ctx.user.id) : list;
    const items = (status === 'open' && !mineOnly ? openTasks(db, businessId, 100) : scoped.slice(-100).reverse())
      .map((t: any) => view(db, t));
    return {
      ok: true,
      tasks: items,
      summary: summarizeTasks(db, businessId, today, guard.ctx.user.id),
      // Responsáveis possíveis (mesma projeção do editor de automações). A tela
      // de Tarefas é porta própria: não pode depender de /api/automations (que
      // exige permissão de configuração) para conseguir atribuir uma tarefa.
      members: taskAssigneeOptions(db, businessId),
    };
  };
  if (relationalActive()) {
    // Fatia da tela: tarefas da unidade + referências que a view resolve
    // (lead/agendamento/contato) + equipe (responsáveis e resumo).
    const db = await runRelationalRead(businessId, {
      tasks: {}, leads: {}, bookings: {}, contacts: {}, members: {},
      users: (partial) => {
        const ids = new Set<string>((partial.members || []).map((m: any) => m.userId).filter(Boolean));
        if (ids.size === 0) return null;
        return { global: true, where: 'id = ANY($2)', args: [[...ids]] };
      },
    });
    return NextResponse.json(listView(db));
  }
  return NextResponse.json(listView(guard.db));
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const businessId = String(body.businessId || req.nextUrl.searchParams.get('businessId') || '');
    const guard = await requireBusiness(req, businessId, ['leads', 'agenda', 'clientes', 'config']);
    if (!guard.ok) return guard.res;

    /** Mutação PURA (DOIS motores): cria tarefa pela engine compartilhada.
     * Retorna { task, slice } para a view responder sem reler o legado. */
    const taskCreateTx = (d: any) => {
      // O responsável precisa ser da equipe desta unidade (a mesma regra que a
      // automação já passa — sem caminho paralelo de validação).
      const assignee = String(body.assignedUserId || '');
      if (assignee) {
        const check = validateAssignedUser(d, businessId, assignee);
        if (!check.valid) throw Object.assign(new Error(check.error || 'responsável inválido'), { status: 422 });
      }
      const res = createTaskTx(d, {
        businessId,
        title: String(body.title || ''),
        note: String(body.note || ''),
        dueAt: String(body.dueAt || ''),
        assignedUserId: assignee,
        createdBy: guard.ctx.user.id,
        source: 'manual',
        leadId: body.leadId ? String(body.leadId) : undefined,
        bookingId: body.bookingId ? String(body.bookingId) : undefined,
        encounterId: body.encounterId ? String(body.encounterId) : undefined,
        // Vínculo com a PESSOA: a tarefa do retorno precisa aparecer no
        // histórico de quem foi atendido. `Task.customerId` é o campo que a
        // ficha 360 e o resto do CRM já usam — e ele aceita o id do CONTATO
        // (`createTaskTx` valida por `c.id || c.customerId`). Por isso o
        // `contactId` que a tela manda é projetado AQUI, em vez de criar uma
        // segunda identidade concorrente na entidade.
        customerId: body.customerId ? String(body.customerId)
          : body.contactId ? String(body.contactId) : undefined,
      });
      if (!res.task) throw Object.assign(new Error(res.reason || 'não foi possível criar a tarefa'), { status: 422 });
      if (res.created) {
        pushAudit(d, {
          action: 'task.created',
          actor: guard.ctx.user,
          businessId,
          meta: {
            taskId: res.task.id, title: res.task.title,
            encounterId: res.task.encounterId || '', bookingId: res.task.bookingId || '',
            contactId: res.task.customerId || '',
          },
        });
      }
      return { task: res.task, slice: d };
    };
    let created: any;
    if (relationalActive()) {
      created = await runRelationalWrite(businessId, taskCreateTx, {
        load: {
          tasks: {}, members: {}, leads: {}, bookings: {}, encounters: {}, contacts: {},
          users: (partial) => {
            const ids = new Set<string>((partial.members || []).map((m: any) => m.userId).filter(Boolean));
            if (ids.size === 0) return null;
            return { global: true, where: 'id = ANY($2)', args: [[...ids]] };
          },
        } as SliceSpec,
      });
    } else {
      // A tx devolve { task, slice } — separar antes de montar a resposta.
      const txOut = await updateDB(taskCreateTx);
      const db = await readDB();
      created = { task: txOut.task, slice: db };
    }
    return NextResponse.json({ ok: true, task: view(created.slice, created.task!) }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Não foi possível criar a tarefa.' }, { status: e?.status || 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const businessId = String(body.businessId || req.nextUrl.searchParams.get('businessId') || '');
    const guard = await requireBusiness(req, businessId, ['leads', 'agenda', 'clientes', 'config']);
    if (!guard.ok) return guard.res;

    /** Mutação PURA (DOIS motores): edição operacional + máquina de status. */
    const taskPatchTx = (d: any) => {
      const taskId = String(body.id || '');
      const existing = (d.tasks || []).find((x: any) => x.id === taskId && x.businessId === businessId);
      if (!existing) throw Object.assign(new Error('Tarefa não encontrada.'), { status: 404 });
      // Edição operacional: título, nota, prazo, responsável, vínculos
      let touched = false;
      if (body.title !== undefined) {
        const title = String(body.title || '').trim().slice(0, 140);
        if (!title) throw Object.assign(new Error('Título não pode ser vazio.'), { status: 400 });
        existing.title = title;
        touched = true;
      }
      if (body.note !== undefined) {
        existing.note = String(body.note || '').trim().slice(0, 1000);
        touched = true;
      }
      if (body.dueAt !== undefined) {
        existing.dueAt = String(body.dueAt || '').trim().slice(0, 30);
        touched = true;
      }
      if (body.assignedUserId !== undefined) {
        const assignee = String(body.assignedUserId || '');
        if (assignee) {
          const check = validateAssignedUser(d, businessId, assignee);
          if (!check.valid) throw Object.assign(new Error(check.error || 'responsável inválido'), { status: 422 });
        }
        existing.assignedUserId = assignee;
        touched = true;
      }
      // Status
      if (body.status !== undefined) {
        const status = body.status === 'done' ? 'done' : body.status === 'cancelled' ? 'cancelled' : 'open';
        const res = setTaskStatusTx(d, { businessId, taskId, status, by: guard.ctx.user.id });
        if (!res) throw Object.assign(new Error('Tarefa não encontrada.'), { status: 404 });
        if (status === 'done') {
          pushAudit(d, { action: 'task.completed', actor: guard.ctx.user, businessId, meta: { taskId: res.id, title: res.title } });
        }
        return { task: res, slice: d };
      }
      if (touched) {
        existing.updatedAt = new Date().toISOString();
        return { task: existing, slice: d };
      }
      // fallback to status handler for legacy call with status
      const status = body.status === 'done' ? 'done' : body.status === 'cancelled' ? 'cancelled' : 'open';
      const task = setTaskStatusTx(d, { businessId, taskId, status, by: guard.ctx.user.id });
      if (!task) throw Object.assign(new Error('Tarefa não encontrada.'), { status: 404 });
      if (status === 'done') {
        pushAudit(d, { action: 'task.completed', actor: guard.ctx.user, businessId, meta: { taskId: task.id, title: task.title } });
      }
      return { task, slice: d };
    };
    let updated: any;
    if (relationalActive()) {
      updated = await runRelationalWrite(businessId, taskPatchTx, {
        load: {
          tasks: {}, members: {}, leads: {}, bookings: {}, encounters: {}, contacts: {},
          users: (partial) => {
            const ids = new Set<string>((partial.members || []).map((m: any) => m.userId).filter(Boolean));
            if (ids.size === 0) return null;
            return { global: true, where: 'id = ANY($2)', args: [[...ids]] };
          },
        } as SliceSpec,
      });
    } else {
      // A tx devolve { task, slice } — separar antes de montar a resposta.
      const txOut = await updateDB(taskPatchTx);
      const db = await readDB();
      updated = { task: txOut.task, slice: db };
    }
    return NextResponse.json({ ok: true, task: view(updated.slice, updated.task!) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Não foi possível atualizar a tarefa.' }, { status: e?.status || 400 });
  }
}
