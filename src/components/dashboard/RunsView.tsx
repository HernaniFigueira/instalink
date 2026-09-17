'use client';
// ═══════════════════════════════════════════════════════════════
// EXECUÇÕES — porta própria do "o que o sistema fez" (A1.2 · Bloco 1)
// ═══════════════════════════════════════════════════════════════
// Era a 4ª aba de /automacoes. Observar execuções é visita deliberada
// (diagnóstico depois de um erro, conferência depois de um disparo), não
// passagem diária: por isso é destino declarado FORA do menu (`sidebar: false`),
// alcançado pelo atalho contextual dentro de Automações ou pela URL.
//
// Nada foi reescrito: é o MESMO `recentRuns` de /api/automations e o MESMO
// painel passo a passo (RunsPanel). Nenhum dado novo, nenhuma regra do motor.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api-client';
import { useBusinessId } from '@/components/dashboard/useBusinessId';
import { ListSkeleton, Notice, PageHeader } from '@/components/ui';
import { AccessDenied, useAreaLoad } from '@/components/dashboard/AccessNotice';
import { RunsPanel, type RunView } from '@/components/dashboard/RunsPanel';
import { useRevalidateOnFocus } from '@/components/dashboard/use-revalidate';

export function RunsView() {
  const { businessId, noBusiness } = useBusinessId();
  const [runs, setRuns] = useState<RunView[]>([]);
  const [loading, setLoading] = useState(true);

  // 403 → aviso amigável (sessão preservada); nada de skeleton infinito.
  const { denied, failed, report } = useAreaLoad('Execuções');

  const load = useCallback(async () => {
    if (!businessId) return;
    const res = await apiGet<any>(`/api/automations?businessId=${businessId}`, { scope: 'area', area: 'Execuções' });
    setLoading(false);
    if (!report(res)) return;
    setRuns(res.data?.recentRuns || []);
  }, [businessId, report]);

  useEffect(() => { void load(); }, [load]);
  useRevalidateOnFocus(() => { void load(); });

  if (denied) return <AccessDenied area="Execuções" />;
  if (noBusiness) return <Notice tone="info">Crie sua empresa primeiro para ver as execuções das automações.</Notice>;

  const q = businessId ? `?b=${businessId}` : '';
  const failedRuns = runs.filter((r) => r.status === 'failed').length;
  const waiting = runs.filter((r) => r.status === 'waiting' || r.status === 'queued' || r.status === 'running').length;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Execuções"
        hint="Tudo o que as automações fizeram, na ordem em que aconteceu. Quando algo falha, o motivo e o passo exato ficam aqui."
        action={(
          <Link href={`/automacoes${q}`} className="text-xs font-semibold bg-white border border-zinc-200 rounded-md px-3 py-1.5 hover:bg-zinc-50">
            Editar automações
          </Link>
        )}
      />

      {failed && <Notice tone="error">{failed}</Notice>}

      <p className="text-xs text-zinc-500">
        {runs.length} execução(ões) recentes
        {waiting > 0 ? ` · ${waiting} em andamento ou aguardando` : ''}
        {failedRuns > 0 ? ` · ${failedRuns} com erro` : ''}
      </p>

      {loading ? <ListSkeleton rows={4} /> : <RunsPanel runs={runs} />}
    </div>
  );
}
