'use client';
// ═══════════════════════════════════════════════════════════════
// TAREFAS — a fila de trabalho da equipe (extraído de AutomationsView)
// ═══════════════════════════════════════════════════════════════
// A1.2 · Bloco 1: tarefa é trabalho diário de gente (ligar, confirmar,
// separar), não um detalhe do motor. Ganhou porta própria (/tarefas, na seção
// Operação) e por isso saiu de dentro de Automações — virou componente
// reutilizável pelas duas portas, com os MESMOS dados (/api/tasks) e as
// MESMAS ações. Quem CRIA tarefa continua sendo a automação; aqui se opera.
import { useState } from 'react';
import { Badge, Button, Card, Input, Select } from '@/components/ui';
import { Icon } from '@/components/icons';
import { apiSend } from '@/lib/api-client';

export interface TaskView {
  id: string; title: string; note: string; status: string; dueAt: string; dueLabel: string;
  createdAt: string; assignedUserId: string; assigneeName: string; leadName: string;
  bookingLabel: string; fromAutomation: boolean; source: string;
}

export interface TaskSummaryView { open: number; overdue: number; dueToday: number; mine: number }

// ── tarefas geradas (por automação ou pela equipe) ──────────
export function TaskPanel({ tasks, summary, businessId, members, onChanged }: {
  tasks: TaskView[]; summary: TaskSummaryView;
  businessId: string; members: { userId: string; name: string }[]; onChanged: () => void;
}) {
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const open = tasks.filter((t) => t.status === 'open');
  const done = tasks.filter((t) => t.status !== 'open');

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[200px]">
            <span className="block text-[11px] font-semibold text-zinc-600 mb-1">Nova tarefa da equipe</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Ligar para o lead que respondeu o follow-up" maxLength={140} />
          </div>
          <Select className="max-w-[180px]" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Responsável">
            <option value="">qualquer um</option>
            {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </Select>
          <Button size="sm" disabled={busy || !title.trim()} onClick={async () => {
            setBusy(true);
            const res = await apiSend('/api/tasks', 'POST', { businessId, title, assignedUserId: assignee });
            setBusy(false);
            if (res.ok) { setTitle(''); onChanged(); }
          }}>Adicionar</Button>
        </div>
        <p className="text-[11px] text-zinc-400 mt-2">
          {summary.open} abertas · {summary.overdue} atrasadas · {summary.dueToday} para hoje
          {summary.mine ? ` · ${summary.mine} suas` : ''}
        </p>
      </Card>

      <Card className="divide-y divide-zinc-100">
        {!open.length && !done.length && <p className="p-4 text-sm text-zinc-500">Nenhuma tarefa ainda. Automações que “criam tarefa” enchem esta lista.</p>}
        {open.map((t) => (
          <div key={t.id} className="p-3 flex items-start gap-3">
            <button onClick={async () => { await apiSend('/api/tasks', 'PATCH', { businessId, id: t.id, status: 'done' }); onChanged(); }}
              className="mt-0.5 w-4 h-4 rounded border border-zinc-300 hover:border-emerald-600 shrink-0" aria-label={`Concluir tarefa: ${t.title}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-zinc-900">{t.title}</p>
              {t.note && <p className="text-[11px] text-zinc-500 mt-0.5">{t.note}</p>}
              <p className="text-[11px] text-zinc-400 mt-1">
                {t.dueLabel}{t.assigneeName ? ` · ${t.assigneeName}` : ''}{t.leadName ? ` · lead ${t.leadName}` : ''}{t.bookingLabel ? ` · agendamento ${t.bookingLabel}` : ''}
              </p>
            </div>
            {t.fromAutomation && <Badge tone="blue">automação</Badge>}
          </div>
        ))}
        {done.slice(0, 10).map((t) => (
          <div key={t.id} className="p-3 flex items-center gap-3 bg-zinc-50/60">
            <span className="w-4 h-4 rounded bg-emerald-600 shrink-0 inline-flex items-center justify-center text-white"><Icon n="check" size={11} /></span>
            <p className="text-sm text-zinc-500 line-through truncate">{t.title}</p>
            <span className="ml-auto text-[11px] text-zinc-400">{t.status === 'done' ? 'concluída' : 'cancelada'}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
