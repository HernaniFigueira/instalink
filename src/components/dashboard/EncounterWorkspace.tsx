'use client';
// ═══════════════════════════════════════════════════════════════
// F1A/F1B1 · WORKSPACE CLÍNICO DO ATENDIMENTO
// ═══════════════════════════════════════════════════════════════
// Não é um card no dashboard: é a ÁREA DE TRABALHO do atendimento.
//
//   • cabeçalho CONTEXTUAL PERSISTENTE com o PACIENTE (pet) como protagonista
//     e o tutor como contexto — nunca o contrário; o Pet continua mostrando
//     nome, espécie, raça e idade (dado permanente vem do cadastro, em leitura);
//   • estado clínico visível em texto (Em atendimento · Finalizado) — nunca só
//     por cor;
//   • o corpo é o workspace (`EncounterWorkspaceBody`), que reúne as SEÇÕES
//     REAIS: Atendimento (núcleo do F1A), Anamnese (relatado nesta visita) e
//     Avaliação (exame veterinário de hoje). O `EncounterSheet` legado NÃO é
//     montado aqui — ele continua intacto na rota `/registro`;
//   • navegação interna: só o que está DISPONÍVEL é renderizado (nada de aba
//     morta, placeholder decorativo ou módulo falso);
//   • a persistência tem UMA autoridade (versão única do Encounter) e a saída
//     (Voltar/menu/Back/F5) só acontece com gravação confirmada ou descarte
//     explícito — a invariante do F1A continua valendo para todas as seções.
//
// Persistência é do SERVIDOR: abrir, sair, dar F5, colar a URL ou voltar pela
// Agenda caem no MESMO `encounterId` — o workspace apenas LÊ por id.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageBackAction, Skeleton } from '@/components/ui';
import { EncounterSessionRail } from './EncounterSessionRail';
import type { DismissReason } from './OverlayDismissGuard';
import { AccessDenied } from './AccessNotice';
import { usePanelPermissions } from './usePanelPermissions';
import { apiGet } from '@/lib/api-client';
import { ENCOUNTER_CLINICAL_STATE } from '@/lib/encounters';
import { BOOKING_STATUS } from '@/lib/status';
import type { BookingStatus } from '@/lib/types';
import { EncounterWorkspaceBody } from './EncounterWorkspaceBody';
import type { EncounterAuthorityRow } from './useEncounterAuthority';
import { formatDateBR } from '@/lib/tz';

export type EncounterWorkspaceRow = EncounterAuthorityRow & {
  /**
   * Nomes resolvidos na LEITURA (a mesma conveniência do modelo antigo).
   * O cabeçalho prefere `context` e cai aqui só quando o vínculo não resolveu.
   */
  petName?: string;
  serviceName?: string;
  professionalName?: string;
  bookingStatus?: string;
  customerPhone?: string;
  finalizationRevisions?: import('@/lib/types').EncounterFinalizationRevision[];
  addenda?: import('@/lib/types').EncounterAddendum[];
  reopenEvents?: Array<{ at: string; actorUserId: string; meta?: Record<string, unknown> }>;
  canReopen?: boolean;
  context?: {
    clinicalState: 'not_started' | 'in_progress' | 'finalized';
    patient: { id: string; name: string; speciesLabel: string; breed: string; ageLabel: string; weightKg?: number } | null;
    responsible: { id: string; name: string; phone: string };
    service: { id: string; name: string; durationMin: number } | null;
    professional: { id: string; name: string; role: string } | null;
    booking: { id: string; date: string; time: string; status: string } | null;
  };
};

interface Props {
  businessId: string;
  /** Registro canônico (rota `/atendimento/[encounterId]`). */
  encounterId: string;
  /** Para onde "Voltar" leva (já saneado: só rota interna). */
  returnTo: string;
}

/** Linha do cabeçalho: só mostra o que EXISTE (nada de "—" decorativo). */
function joinParts(parts: Array<string | undefined | null>, sep = ' · '): string {
  return parts.map((p) => String(p || '').trim()).filter(Boolean).join(sep);
}

export function EncounterWorkspace({ businessId, encounterId, returnTo }: Props) {
  const router = useRouter();
  const { permissions, ready: permissionsReady } = usePanelPermissions();
  const [row, setRow] = useState<EncounterWorkspaceRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    if (!businessId || !encounterId) return;
    let active = true;
    setLoading(true);
    setLoadError('');
    setNotFound(false);
    setForbidden(false);
    apiGet<{ encounter?: EncounterWorkspaceRow }>(
      `/api/encounters?businessId=${encodeURIComponent(businessId)}&id=${encodeURIComponent(encounterId)}`,
      { scope: 'area', area: 'Atendimento' },
    )
      .then((result) => {
        if (!active) return;
        if (result.status === 404) { setNotFound(true); return; }
        // 403 do servidor = fora do escopo clínico (ex.: atendimento de outro
        // profissional). Não é "não encontrado": a tela diz o que é.
        if (result.status === 403) { setForbidden(true); return; }
        if (!result.ok || !result.data?.encounter) {
          setLoadError(result.message || 'Não foi possível abrir este atendimento.');
          return;
        }
        setRow(result.data.encounter);
      })
      .catch(() => { if (active) setLoadError('Não foi possível carregar o atendimento.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [businessId, encounterId]);

  /**
   * SAIR PASSA PELO CORPO. O botão Voltar não navega por conta própria: quem
   * decide é o `EncounterWorkspaceBody`, que tenta gravar TODAS as seções
   * pendentes e só autoriza a saída com persistência confirmada (ou descarte
   * confirmado no diálogo). Texto clínico não sai da tela sem estar gravado.
   */
  const guardedLeave = useRef<((reason: DismissReason, proceed: () => void) => void) | null>(null);
  const registerLeave = useCallback((leave: (reason: DismissReason, proceed: () => void) => void) => {
    guardedLeave.current = leave;
  }, []);
  const leave = useCallback(() => {
    const guard = guardedLeave.current;
    // Sem corpo montado (erro/404/estado vazio) não há texto a perder.
    if (guard) guard('close-button', () => router.replace(returnTo));
    else router.replace(returnTo);
  }, [router, returnTo]);

  /** O cabeçalho acompanha a linha mais recente publicada pela autoridade. */
  const syncRow = useCallback((next: EncounterAuthorityRow) => {
    setRow((prev) => (prev ? { ...prev, ...next } : (next as EncounterWorkspaceRow)));
  }, []);

  if (!permissionsReady || loading) {
    return (
      <div className="encounter-route-loading" aria-busy="true" aria-live="polite">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (permissions.atendimento !== true) {
    return <AccessDenied area="Atendimento" homeHref={`/agenda?b=${encodeURIComponent(businessId)}`} />;
  }

  if (forbidden) {
    return <AccessDenied area="Atendimento" homeHref={`/agenda?b=${encodeURIComponent(businessId)}`} />;
  }
  // 404 do servidor = não existe (ou não é desta unidade). Mensagem humana,
  // sem ecoar ID nem erro técnico: quem não pode ver não precisa saber por quê.
  if (notFound || loadError) {
    return (
      <div className="ws-panel encounter-workspace__notice" role="alert">
        <h1 className="text-base font-semibold text-[var(--text)]">
          {notFound ? 'Atendimento não encontrado' : 'Não foi possível abrir o atendimento'}
        </h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {notFound
            ? 'Este atendimento não está disponível para você nesta unidade. Abra o atendimento pela Agenda.'
            : loadError}
        </p>
        <PageBackAction className="mt-3" onClick={leave} label="Voltar para a agenda" />
      </div>
    );
  }
  if (!row) return null;

  const ctx = row.context;
  const state = ENCOUNTER_CLINICAL_STATE[ctx?.clinicalState || 'in_progress'] || ENCOUNTER_CLINICAL_STATE.in_progress;
  const patient = ctx?.patient || null;
  // Vet primeiro: o PACIENTE é o pet; o humano é o responsável/contexto.
  const headline = patient?.name || ctx?.responsible?.name || row.customerName || row.petName || 'Paciente';
  // Só dados que EXISTEM no cadastro do pet (espécie, raça, idade, sexo).
  const sexLabel = patient?.sex === 'M' ? 'Macho' : patient?.sex === 'F' ? 'Fêmea' : '';
  const patientLine = patient ? joinParts([patient.speciesLabel, patient.breed, patient.ageLabel, sexLabel]) : '';
  const tutorName = ctx?.responsible?.name || row.customerName || '';
  const tutorPhone = ctx?.responsible?.phone || '';
  const serviceName = ctx?.service?.name || row.serviceName || '';
  const professionalName = ctx?.professional?.name || row.professionalName || '';
  const when = row.date ? `${formatDateBR(row.date)}${row.time ? ` · ${row.time}` : ''}` : '';
  // Status do AGENDAMENTO é um eixo separado do estado CLÍNICO do atendimento.
  const bookingStatus = ctx?.booking?.status as BookingStatus | undefined;
  const bookingLabel = bookingStatus && BOOKING_STATUS[bookingStatus] ? BOOKING_STATUS[bookingStatus].panel : '';

  return (
    <main className="encounter-workspace encounter-session" data-clinical-state={state.id} data-encounter-id={row.id}>
      {/* ── Contexto PERSISTENTE à esquerda (rail): paciente protagonista,
          tutor e fatos do atendimento ficam visíveis durante todo o scroll.
          O cabeçalho alto deixou de ser o eixo da página. ── */}
      <EncounterSessionRail
        onBack={leave}
        eyebrow={row.bookingId ? 'Atendimento' : 'Atendimento do balcão'}
        headline={headline}
        patientLine={patientLine}
        tutor={tutorName}
        tutorPhone={tutorPhone}
        facts={[
          { label: 'Serviço', value: serviceName },
          { label: 'Profissional', value: professionalName },
          { label: 'Agendado', value: when },
        ]}
        statusLabel={state.label.toUpperCase()}
        statusTone={state.tone}
        bookingLabel={bookingLabel}
      />

      <div className="encounter-session__main">
      {/* ── Corpo: SEÇÕES REAIS sobre UMA autoridade de persistência ──
          É o `EncounterWorkspaceBody` (e não o `EncounterSheet` legado, que
          continua vivo na rota `/registro` com os módulos de F1B2/F1C). */}
      <EncounterWorkspaceBody
        businessId={businessId}
        row={row}
        onRow={syncRow}
        registerLeave={registerLeave}
        fullRecordHref={`/atendimento/${encodeURIComponent(row.id)}/registro?returnTo=${encodeURIComponent(returnTo)}`}
        onNavigate={(href) => router.push(href)}
      />
      </div>
    </main>
  );
}
