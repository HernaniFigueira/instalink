'use client';

// P4 — tela de administração das automações (lista, editor linear, execuções e
// tarefas). O acesso é o MESMO guard do painel: sem a permissão, o shell mostra
// o 403 amigável; a API nunca confia na tela (requireBusiness em cada rota).
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { AutomationsView } from '@/components/dashboard/AutomationsView';

export default function AutomacoesPage() {
  const { denied } = useAreaLoad('Automações');

  if (denied) return <AccessDenied area="Automações" />;

  return <AutomationsView />;
}
