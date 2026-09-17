'use client';

// A1.2 · Bloco 1 — porta própria da fila de trabalho da equipe.
// O acesso é o MESMO guard do painel: sem permissão, o shell mostra o 403
// amigável (e a própria tela trata o 403 da API); o servidor nunca confia na
// tela — /api/tasks exige requireBusiness(['leads','agenda','clientes','config']).
import { TasksView } from '@/components/dashboard/TasksView';

export default function TarefasPage() {
  return <TasksView />;
}
