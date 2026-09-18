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
import Link from 'next/link';
import { Badge, Button, Card, Input, Select } from '@/components/ui';
import { Icon } from '@/components/icons';
import { apiSend } from '@/lib/api-client';

export interface TaskView {
  id: string; title: string; note: string; status: string; dueAt: string; dueLabel: string;
  createdAt: string; assignedUserId: string; assigneeName: string; leadName: string;
  bookingLabel: string; fromAutomation: boolean; source: string;
  leadId?: string; bookingId?: string;
}

export interface TaskSummaryView { open: number; overdue: number; dueToday: number; mine: number }

// ── tarefas geradas (por automação ou pela equipe) ──────────
export function TaskPanel({ tasks, summary, businessId, members, onChanged }: {
  tasks: TaskView[]; summary: TaskSummaryView;
  businessId: string; members: { userId: string; name: string }[]; onChanged: () => void;
}) {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [assignee, setAssignee] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editDueAt, setEditDueAt] = useState('');
  const [editAssignee, setEditAssignee] = useState('');
  const open = tasks.filter((t) => t.status === 'open');
  const done = tasks.filter((t) => t.status !== 'open');

  async function createTask(){
    setError('');
    if (!title.trim()) { setError('Informe o título da tarefa.'); return; }
    setBusy(true);
    const res = await apiSend('/api/tasks', 'POST', { businessId, title: title.trim(), note: note.trim(), dueAt: dueAt.trim(), assignedUserId: assignee });
    setBusy(false);
    if (res.ok) { setTitle(''); setNote(''); setDueAt(''); setAssignee(''); onChanged(); } else { setError(res.message || 'Não foi possível criar.'); }
  }

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[200px]">
              <span className="block text-[11px] font-semibold text-zinc-600 mb-1">Nova tarefa da equipe</span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Ligar para o lead que respondeu o follow-up" maxLength={140} />
            </div>
            <Select className="max-w-[180px]" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Responsável">
              <option value="">qualquer um</option>
              {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
            </Select>
            <Button size="sm" disabled={busy || !title.trim()} onClick={createTask}>Adicionar</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input value={dueAt} onChange={(e)=> setDueAt(e.target.value)} placeholder="Prazo (YYYY-MM-DD)" className="max-w-[170px]" />
            <Input value={note} onChange={(e)=> setNote(e.target.value)} placeholder="Nota / detalhes (opcional)" className="flex-1 min-w-[180px]" />
          </div>
          {error && <p className="text-xs font-medium text-red-600">{error}</p>}
          <p className="text-[11px] text-zinc-400">
            {summary.open} abertas · {summary.overdue} atrasadas · {summary.dueToday} para hoje
            {summary.mine ? ` · ${summary.mine} suas` : ''}
          </p>
        </div>
      </Card>

      <Card className="divide-y divide-zinc-100">
        {!open.length && !done.length && <p className="p-4 text-sm text-zinc-500">Nenhuma tarefa ainda. Automações que “criam tarefa” enchem esta lista.</p>}
        {open.map((t) => (
          <div key={t.id} className="p-3 flex items-start gap-3">
            <button onClick={async () => { await apiSend('/api/tasks', 'PATCH', { businessId, id: t.id, status: 'done' }); onChanged(); }}
              className="mt-0.5 w-4 h-4 rounded border border-zinc-300 hover:border-emerald-600 shrink-0" aria-label={`Concluir tarefa: ${t.title}`} />
            <div className="min-w-0 flex-1">
              {editingId===t.id ? (
                <div className="space-y-2">
                  <Input value={editTitle} onChange={(e)=> setEditTitle(e.target.value)} placeholder="Título" />
                  <Input value={editNote} onChange={(e)=> setEditNote(e.target.value)} placeholder="Nota" />
                  <div className="flex gap-2">
                    <Input value={editDueAt} onChange={(e)=> setEditDueAt(e.target.value)} placeholder="Prazo YYYY-MM-DD" className="max-w-[150px]" />
                    <Select value={editAssignee} onChange={(e)=> setEditAssignee(e.target.value)} className="max-w-[150px]">
                      <option value="">qualquer um</option>
                      {members.map((m)=> <option key={m.userId} value={m.userId}>{m.name}</option>)}
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={async()=>{ const r=await apiSend('/api/tasks','PATCH',{businessId, id:t.id, title:editTitle, note: editNote, dueAt:editDueAt, assignedUserId:editAssignee}); if(r.ok){ setEditingId(null); onChanged(); }}}>Salvar</Button>
                    <Button size="sm" variant="ghost" onClick={()=> setEditingId(null)}>Cancelar</Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-zinc-900">{t.title}</p>
                  {t.note && <p className="text-[11px] text-zinc-500 mt-0.5">{t.note}</p>}
                  <p className="text-[11px] text-zinc-400 mt-1 flex flex-wrap gap-1.5 items-center">
                    <span>{t.dueLabel}</span>
                    {t.assigneeName ? <span>· {t.assigneeName}</span> : null}
                    {t.leadName ? <span>· lead {t.leadName}</span> : null}
                    {t.bookingLabel ? <span>· agendamento {t.bookingLabel}</span> : null}
                    {t.leadId && <Link href={`/funil?b=${businessId}#${t.leadId}`} className="underline text-zinc-600">Ver no funil</Link>}
                    {t.bookingId && <Link href={`/agenda?b=${businessId}`} className="underline text-zinc-600">Ver agenda</Link>}
                  </p>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {t.fromAutomation && <Badge tone="blue">automação</Badge>}
              {editingId!==t.id && <button onClick={()=>{setEditingId(t.id); setEditTitle(t.title); setEditNote(t.note||''); setEditDueAt(t.dueAt||''); setEditAssignee(t.assignedUserId||'');}} className="text-[11px] text-zinc-500 border border-zinc-200 rounded px-2 py-1 hover:bg-zinc-50">Editar</button>}
              {editingId!==t.id && <button onClick={async()=>{ if(confirm('Cancelar esta tarefa?')) { await apiSend('/api/tasks','PATCH',{businessId, id:t.id, status:'cancelled'}); onChanged(); } }} className="text-[11px] text-zinc-500 border border-zinc-200 rounded px-2 py-1 hover:bg-zinc-50">Cancelar</button>}
            </div>
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
