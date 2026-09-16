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
import {
  createTaskTx, openTasks, setTaskStatusTx, summarizeTasks, taskDueLabel,
} from '@/lib/automation/tasks';
import { validateAssignedUser } from '@/lib/pipeline';
import { todayISO } from '@/lib/tz';
import type { Task } from '@/lib/types';

function view(db: any, t: Task) {
  // Toda referência é lida DENTRO da unidade da tarefa: um vínculo que não é
  // dali nunca vira nome exibido (defesa em profundidade — a criação já recusa).
  const lead = t.leadId ? (db.leads || []).find((l: any) => l.id === t.leadId && l.businessId === t.businessId) : null;
  const booking = t.bookingId ? (db.bookings || []).find((b: any) => b.id === t.bookingId && b.businessId === t.businessId) : null;
  const assignee = t.assignedUserId ? (db.users || []).find((u: any) => u.id === t.assignedUserId) : null;
  return {
    ...t,
    dueLabel: taskDueLabel(t.dueAt, todayISO()),
    leadName: lead?.name || '',
    bookingLabel: booking ? `${booking.date.split('-').reverse().join('/')} ${booking.time}` : '',
    assigneeName: assignee?.name || '',
    fromAutomation: t.createdBy === 'automation',
  };
}

export async function GET(req: NextRequest) {
  const businessId = String(req.nextUrl.searchParams.get('businessId') || '');
  const guard = await requireBusiness(req, businessId, ['leads', 'agenda', 'clientes', 'config']);
  if (!guard.ok) return guard.res;
  const status = req.nextUrl.searchParams.get('status') || 'open';
  const db = guard.db;
  const mineOnly = req.nextUrl.searchParams.get('mine') === '1';
  const today = todayISO();
  const list = (db.tasks || []).filter((t) => t.businessId === businessId && (status === 'all' || t.status === status));
  const scoped = mineOnly ? list.filter((t) => t.assignedUserId === guard.ctx.user.id) : list;
  const items = (status === 'open' && !mineOnly ? openTasks(db, businessId, 100) : scoped.slice(-100).reverse())
    .map((t) => view(db, t));
  return NextResponse.json({
    ok: true,
    tasks: items,
    summary: summarizeTasks(db, businessId, today, guard.ctx.user.id),
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, any>));
    const businessId = String(body.businessId || req.nextUrl.searchParams.get('businessId') || '');
    const guard = await requireBusiness(req, businessId, ['leads', 'agenda', 'clientes', 'config']);
    if (!guard.ok) return guard.res;
    const created = await updateDB((d) => {
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
      });
      if (!res.task) throw Object.assign(new Error(res.reason || 'não foi possível criar a tarefa'), { status: 422 });
      if (res.created) {
        pushAudit(d, {
          action: 'task.created',
          actor: guard.ctx.user,
          businessId,
          meta: { taskId: res.task.id, title: res.task.title },
        });
      }
      return res.task;
    });
    const db = await readDB();
    return NextResponse.json({ ok: true, task: view(db, created!) }, { status: 201 });
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
    const status = body.status === 'done' ? 'done' : body.status === 'cancelled' ? 'cancelled' : 'open';
    const updated = await updateDB((d) => {
      const task = setTaskStatusTx(d, {
        businessId,
        taskId: String(body.id || ''),
        status,
        by: guard.ctx.user.id,
      });
      if (!task) throw Object.assign(new Error('Tarefa não encontrada.'), { status: 404 });
      if (status === 'done') {
        pushAudit(d, {
          action: 'task.completed',
          actor: guard.ctx.user,
          businessId,
          meta: { taskId: task.id, title: task.title },
        });
      }
      return task;
    });
    const db = await readDB();
    return NextResponse.json({ ok: true, task: view(db, updated!) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Não foi possível atualizar a tarefa.' }, { status: e?.status || 400 });
  }
}
