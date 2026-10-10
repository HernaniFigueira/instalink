'use client';
// ═══════════════════════════════════════════════════════════════
// REGISTRO COMPLETO (LEGADO) — /atendimento/[encounterId]/registro
// ═══════════════════════════════════════════════════════════════
// O F1A entregou o WORKSPACE CANÔNICO em `/atendimento/[encounterId]`, com o
// NÚCLEO clínico (queixa, evolução, orientações, retorno, anotação interna e
// etiquetas). Tudo o que é de FASE FUTURA — anamnese, anexos, registrar
// pagamento, pós-atendimento, finalização e reabertura — NÃO entra lá.
//
// Nada disso foi apagado do sistema: o `EncounterSheet` legado continua
// inteiro e mora nesta rota, que é para onde o HISTÓRICO (Cliente 360 /
// Pet 360) aponta — exatamente como apontava antes do F1A.
//
// Compatibilidade: a rota antiga `/atendimento?id=<id>` continua válida; ela
// cai no resolvedor, que só assume a rota canônica (nunca recria registro).
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { EncounterSheet, type EncounterRow, type FollowUpSeed } from '@/components/dashboard/EncounterSheet';
import { AccessDenied } from '@/components/dashboard/AccessNotice';
import { useBusinessId } from '@/components/dashboard/useBusinessId';
import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';
import { apiGet } from '@/lib/api-client';
import { encounterReturnHref, encounterSurfaceHref } from '@/lib/encounter-workspace';
import { canReopenEncounter } from '@/lib/encounters';
import { Skeleton } from '@/components/ui';

/** Mesma chave de sempre: o agendamento de retorno abre pré-preenchido. */
const RETURN_BOOKING_KEY = 'godoutor:encounter-return-booking:v1';

export default function EncounterLegacyRecordPage() {
  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();
  const { businessId, resolving, noBusiness, contextError } = useBusinessId();
  const { permissions, role, ready: permissionsReady } = usePanelPermissions();
  // Quem reabre é quem administra a unidade (mesma régua do registro original).
  const canReopen = canReopenEncounter(role);
  const encounterId = String(params?.encounterId || '');
  const returnTo = encounterReturnHref(search.get('returnTo'), businessId);
  const [existing, setExisting] = useState<EncounterRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!businessId || !encounterId) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    setLoadError('');
    apiGet<{ encounter?: EncounterRow }>(
      `/api/encounters?businessId=${encodeURIComponent(businessId)}&id=${encodeURIComponent(encounterId)}`,
      { scope: 'area', area: 'Atendimento' },
    )
      .then((result) => {
        if (!active) return;
        if (!result.ok || !result.data?.encounter) {
          setLoadError(result.message || 'Não foi possível abrir este atendimento.');
        } else setExisting(result.data.encounter);
      })
      .catch(() => { if (active) setLoadError('Não foi possível carregar o atendimento.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId, encounterId]);

  const leave = useCallback(() => router.replace(returnTo), [router, returnTo]);
  const scheduleReturn = useCallback((seed: FollowUpSeed) => {
    try { sessionStorage.setItem(RETURN_BOOKING_KEY, JSON.stringify({ ...seed, businessId })); } catch { /* rota continua, sem seed; nada é gravado no domínio */ }
    router.push(`/agenda?b=${encodeURIComponent(businessId)}&retornoAtendimento=1`);
  }, [businessId, router]);

  if (resolving || !permissionsReady || loading) {
    return (
      <div className="encounter-route-loading" aria-busy="true">
        <Skeleton className="h-5 w-24" /><Skeleton className="h-10 w-72" /><Skeleton className="h-40 w-full" />
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
          Abra o registro por um atendimento existente (histórico do cliente).
        </p>
      </div>
    );
  }
  if (loadError) {
    return (
      <div role="alert" className="ws-panel p-5">
        <h1 className="font-semibold">Não foi possível abrir o atendimento</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{loadError}</p>
      </div>
    );
  }
  if (!existing) return null;

  return (
    <EncounterSheet
      layout="page"
      businessId={businessId}
      existing={existing}
      workspaceHref={encounterSurfaceHref('atendimento', encounterId, businessId, returnTo)}
      returnTo={returnTo}
      onOpenWorkspace={(href) => router.push(href)}
      canReopen={canReopen}
      onClose={leave}
      onScheduleReturn={scheduleReturn}
      onSaved={() => { /* autosave mantém a página e o documento montados */ }}
      onChanged={() => { /* APIs e listagens continuam sendo a fonte */ }}
    />
  );
}
