'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { EncounterSheet, type EncounterRow, type FollowUpSeed } from '@/components/dashboard/EncounterSheet';
import { useBusinessId } from '@/components/dashboard/useBusinessId';
import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';
import { AccessDenied } from '@/components/dashboard/AccessNotice';
import { apiGet } from '@/lib/api-client';
import { encounterReturnHref } from '@/lib/encounter-workspace';
import { canReopenEncounter } from '@/lib/encounters';
import { Skeleton } from '@/components/ui';
import { Icon } from '@/components/icons';

const RETURN_BOOKING_KEY = 'godoutor:encounter-return-booking:v1';

export default function AtendimentoPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { businessId, resolving, noBusiness, contextError } = useBusinessId();
  const { permissions, role, ready: permissionsReady } = usePanelPermissions();
  const canReopen = canReopenEncounter(role);
  const id = params.get('id') || '';
  const bookingId = params.get('bookingId') || '';
  const queueId = params.get('queueId') || '';
  const returnTo = useMemo(() => encounterReturnHref(params.get('returnTo'), businessId), [params, businessId]);
  const [existing, setExisting] = useState<EncounterRow | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(!!id);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!businessId || !id) { setLoadingExisting(false); return; }
    let active = true;
    setLoadingExisting(true);
    setLoadError('');
    apiGet<{ encounter?: EncounterRow }>(`/api/encounters?businessId=${encodeURIComponent(businessId)}&id=${encodeURIComponent(id)}`, { scope: 'area', area: 'Atendimento' })
      .then((result) => {
        if (!active) return;
        if (!result.ok || !result.data?.encounter) setLoadError(result.message || 'Não foi possível abrir este atendimento.');
        else setExisting(result.data.encounter);
      })
      .catch(() => { if (active) setLoadError('Não foi possível carregar o atendimento.'); })
      .finally(() => { if (active) setLoadingExisting(false); });
    return () => { active = false; };
  }, [businessId, id]);

  const leave = useCallback(() => router.replace(returnTo), [router, returnTo]);
  const scheduleReturn = useCallback((seed: FollowUpSeed) => {
    try { sessionStorage.setItem(RETURN_BOOKING_KEY, JSON.stringify({ ...seed, businessId })); } catch { /* rota continua, sem seed; nada é gravado no domínio */ }
    router.push(`/agenda?b=${encodeURIComponent(businessId)}&retornoAtendimento=1`);
  }, [businessId, router]);

  if (resolving || !permissionsReady || loadingExisting) {
    return <div className="encounter-route-loading" aria-busy="true"><Skeleton className="h-5 w-24" /><Skeleton className="h-10 w-72" /><Skeleton className="h-40 w-full" /></div>;
  }
  if (noBusiness || contextError) {
    return <div role="alert" className="ws-panel p-5"><h1 className="font-semibold">Atendimento indisponível</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Não foi possível resolver a unidade ativa.</p></div>;
  }
  if (permissions.atendimento !== true) return <AccessDenied area="Atendimento" homeHref={`/agenda?b=${encodeURIComponent(businessId)}`} />;
  if (!id && !bookingId && !queueId) {
    return <div role="alert" className="ws-panel p-5"><h1 className="font-semibold">Registro de origem ausente</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Abra o atendimento pela Agenda, pela fila ou pelo Cliente 360.</p><button type="button" className="mt-3 il-control il-control--secondary" onClick={leave}><Icon n="chevL" size={14} /> Voltar</button></div>;
  }
  if (loadError) {
    return <div role="alert" className="ws-panel p-5"><h1 className="font-semibold">Não foi possível abrir o atendimento</h1><p className="mt-1 text-sm text-[var(--text-muted)]">{loadError}</p><button type="button" className="mt-3 il-control il-control--secondary" onClick={leave}>Voltar</button></div>;
  }

  return <EncounterSheet
    layout="page"
    businessId={businessId}
    bookingId={bookingId || undefined}
    queueId={queueId || undefined}
    existing={existing}
    canReopen={canReopen}
    onClose={leave}
    onScheduleReturn={scheduleReturn}
    onSaved={() => { /* autosave mantém a página e o documento montados */ }}
    onChanged={() => { /* APIs e listagens continuam sendo a fonte após alteração clínica */ }}
  />;
}
