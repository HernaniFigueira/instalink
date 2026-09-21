'use client';
// ═══════════════════════════════════════════════════════════════
// TAREFAS — porta própria da fila de trabalho (A1.2 · Bloco 1)
// ═══════════════════════════════════════════════════════════════
// Tarefa era a 5ª aba de /automacoes: para chegar em "ligar para o lead" era
// preciso abrir a tela que CONFIGURA o motor. Agora é destino declarado na
// seção Operação (uso diário), com o MESMO dado (/api/tasks) e as MESMAS ações.
// A automação continua sendo quem CRIA tarefas — a porta delas é outra.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api-client';
import { useBusinessId } from '@/components/dashboard/useBusinessId';
import { ListSkeleton, Notice, PageHeader } from '@/components/ui';
import { AccessDenied, AreaLoadError, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { TaskPanel, type TaskSummaryView, type TaskView } from '@/components/dashboard/TaskPanel';
import { useRevalidateOnFocus } from '@/components/dashboard/use-revalidate';

const EMPTY_SUMMARY: TaskSummaryView = { open: 0, overdue: 0, dueToday: 0, mine: 0 };

export function TasksView() {
  const { businessId, noBusiness } = useBusinessId();
  const [tasks, setTasks] = useState<TaskView[]>([]);
  const [summary, setSummary] = useState<TaskSummaryView>(EMPTY_SUMMARY);
  const [members, setMembers] = useState<{ userId: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);

  // 403 → aviso amigável (sessão preservada); nada de skeleton infinito.
  const { denied, failed, report } = useAreaLoad('Tarefas');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<any>(`/api/tasks?businessId=${businessId}&status=all`, { scope: 'area', area: 'Tarefas' });
    setLoading(false);
    if (!report(res)) return;
    setTasks(res.data?.tasks || []);
    setSummary(res.data?.summary || EMPTY_SUMMARY);
    setMembers(res.data?.members || []);
  }, [businessId, report]);

  useEffect(() => { void load(); }, [load]);
  useRevalidateOnFocus(() => { void load(); });

  if (denied) return <AccessDenied area="Tarefas" />;
  if (noBusiness) return <Notice tone="info">Crie sua empresa primeiro para acompanhar as tarefas da equipe.</Notice>;

  if (failed) return <AreaLoadError area="Tarefas" message={failed} onRetry={load} />;
  const q = businessId ? `?b=${businessId}` : '';

  return (
    <div className="space-y-4">
      <PageHeader
        title="Tarefas"
        hint="O que ficou combinado, com quem e com qual prazo. Uma tarefa nunca é apagada ao ser concluída — ela vira histórico."
        action={(
          <Link href={`/automacoes${q}`} className="text-xs font-semibold bg-white border border-zinc-200 rounded-md px-3 py-1.5 hover:bg-zinc-50">
            Automações que criam tarefas
          </Link>
        )}
      />

      {loading ? <ListSkeleton rows={4} /> : (
        <TaskPanel
          tasks={tasks}
          summary={summary}
          businessId={businessId}
          members={members}
          onChanged={() => { void load(); }}
        />
      )}
    </div>
  );
}
