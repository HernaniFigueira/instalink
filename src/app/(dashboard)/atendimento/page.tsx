'use client';
// ═══════════════════════════════════════════════════════════════
// F1A · /atendimento — RESOLVEDOR DE ENTRADA OPERACIONAL
// ═══════════════════════════════════════════════════════════════
// Esta rota NÃO é o workspace: é a porta por onde a operação chega (Agenda,
// fila do balcão, Cliente 360) quando ainda não se sabe o ID do atendimento.
//
//   ?bookingId=  → start or resume a partir do AGENDAMENTO;
//   ?queueId=    → start or resume a partir da ENTRADA DA FILA (walk-in);
//   ?id=         → compatibilidade: link antigo, já com registro conhecido.
//
// Em qualquer caso quem decide é o SERVIDOR (`/api/encounters/start`): ele
// cria quando não existe, devolve o existente quando já existe e devolve o
// finalizado para leitura sem recriar. Depois de resolvido, a navegação assume
// a rota canônica `/atendimento/[encounterId]` — é ela que sobrevive a F5.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/icons';
import { Button, PageBackAction, Skeleton } from '@/components/ui';
import { AccessDenied } from '@/components/dashboard/AccessNotice';
import { useBusinessId } from '@/components/dashboard/useBusinessId';
import { usePanelPermissions } from '@/components/dashboard/usePanelPermissions';
import { apiSend } from '@/lib/api-client';
import { isSafeInternalHref } from '@/lib/encounter-workspace';

interface StartPayload {
  encounter?: { id: string };
  encounterId?: string;
}

export default function AtendimentoPage() {
  const router = useRouter();
  const params = useSearchParams();
  const { businessId, resolving, noBusiness, contextError } = useBusinessId();
  const { permissions, ready: permissionsReady } = usePanelPermissions();
  const id = params.get('id') || '';
  const bookingId = params.get('bookingId') || '';
  const queueId = params.get('queueId') || '';
  const rawReturn = params.get('returnTo') || '';
  const returnTo = isSafeInternalHref(rawReturn) ? rawReturn : `/agenda?b=${encodeURIComponent(businessId)}`;
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // Uma resolução por abertura: F5/back refaz, mas o clique duplo não dispara
  // duas chamadas (e, se disparasse, o servidor não duplicaria o atendimento).
  const started = useRef(false);

  const resolve = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    // Já sei o registro: assumo a rota canônica sem tocar no domínio.
    if (id) {
      router.replace(`/atendimento/${encodeURIComponent(id)}?b=${encodeURIComponent(businessId)}&returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    setBusy(true);
    setError('');
    const res = await apiSend<StartPayload>('/api/encounters/start', 'POST', {
      businessId, bookingId, queueId,
    }, { scope: 'action', area: 'Atendimento' });
    setBusy(false);
    if (!res.ok || !res.data) {
      setError(res.message || 'Não foi possível abrir o atendimento.');
      started.current = false;
      return;
    }
    const encounterId = String(res.data.encounter?.id || res.data.encounterId || '');
    if (!encounterId) {
      setError('Não foi possível abrir o atendimento.');
      started.current = false;
      return;
    }
    router.replace(`/atendimento/${encodeURIComponent(encounterId)}?b=${encodeURIComponent(businessId)}&returnTo=${encodeURIComponent(returnTo)}`);
  }, [bookingId, businessId, id, queueId, returnTo, router]);

  useEffect(() => {
    if (resolving || !permissionsReady || !businessId) return;
    if (!id && !bookingId && !queueId) return;
    void resolve();
  }, [bookingId, businessId, id, permissionsReady, queueId, resolving, resolve]);

  const leave = useCallback(() => router.replace(returnTo), [router, returnTo]);

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
  if (!id && !bookingId && !queueId) {
    return (
      <div role="alert" className="ws-panel p-5">
        <h1 className="font-semibold">Registro de origem ausente</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          Abra o atendimento pela Agenda, pela fila ou pelo Cliente 360.
        </p>
        <PageBackAction className="mt-3" onClick={leave} label="Voltar" />
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="ws-panel p-5">
        <h1 className="font-semibold">Não foi possível abrir o atendimento</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">{error}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={() => void resolve()}>
            Tentar novamente
          </Button>
          <PageBackAction onClick={leave} label="Voltar" />
        </div>
      </div>
    );
  }
  return (
    <div className="encounter-route-loading" aria-busy="true" aria-live="polite">
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-9 w-72" />
      <p className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Icon n="clock" size={14} /> {busy ? 'Abrindo o atendimento…' : 'Abrindo o atendimento…'}
      </p>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
