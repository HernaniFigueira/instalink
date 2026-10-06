'use client';
// ═══════════════════════════════════════════════════════════════
// F1A · ROTA CANÔNICA DO ATENDIMENTO — /atendimento/[encounterId]
// ═══════════════════════════════════════════════════════════════
// A rota é o ID do atendimento porque é isso que precisa sobreviver a:
//   sair → F5 → colar a URL → voltar pela Agenda → Retomar atendimento.
//
// É FILHA de `/atendimento` no catálogo (lib/panel.ts): herda o arquétipo
// `record`, a permissão `atendimento` e a área — sem duplicar rota nem criar
// segundo registro de navegação.
//
// O ID NÃO concede acesso: o servidor valida tenant, permissão de Atendimento
// e ACESSO CLÍNICO em `/api/encounters?id=`; o workspace só desenha a resposta
// (e a desenha READ-ONLY quando o registro é de outro profissional — a escrita
// continua exclusiva do responsável, contrato F1).
import { useParams, useSearchParams } from 'next/navigation';
import { EncounterWorkspace } from '@/components/dashboard/EncounterWorkspace';
import { AccessDenied } from '@/components/dashboard/AccessNotice';
import { useBusinessId } from '@/components/dashboard/useBusinessId';
import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';
import { encounterReturnHref } from '@/lib/encounter-workspace';
import { Skeleton } from '@/components/ui';

export default function AtendimentoEncounterPage() {
  const params = useParams();
  const search = useSearchParams();
  const { businessId, resolving, noBusiness, contextError } = useBusinessId();
  const { permissions, ready: permissionsReady } = usePanelPermissions();
  const encounterId = String(params?.encounterId || '');
  const returnTo = encounterReturnHref(search.get('returnTo'), businessId);

  if (resolving || !permissionsReady) {
    return (
      <div className="encounter-route-loading" aria-busy="true">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (noBusiness || contextError) {
    return (
      <div role="alert" className="ws-panel p-5">
        <h1 className="font-semibold">Atendimento indisponível</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Não foi possível resolver a unidade ativa.</p>
      </div>
    );
  }
  if (permissions.atendimento !== true) {
    return <AccessDenied area="Atendimento" homeHref={`/agenda?b=${encodeURIComponent(businessId)}`} />;
  }
  if (!encounterId) {
    return (
      <div role="alert" className="ws-panel p-5">
        <h1 className="font-semibold">Atendimento não informado</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Abra o atendimento pela Agenda, pela fila ou pelo Cliente 360.
        </p>
      </div>
    );
  }
  return <EncounterWorkspace businessId={businessId} encounterId={encounterId} returnTo={returnTo} />;
}
