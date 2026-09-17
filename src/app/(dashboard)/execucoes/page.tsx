'use client';

// A1.2 · Bloco 1 — porta própria do histórico de execuções (fora do menu).
// Destinada a quem precisa investigar: o que o motor fez, em que passo parou e
// qual foi o motivo. O acesso é o MESMO guard do painel e o MESMO de
// Automações (permissão de configuração); /api/automations continua exigindo
// requireBusiness no servidor.
import { RunsView } from '@/components/dashboard/RunsView';

export default function ExecucoesPage() {
  return <RunsView />;
}
