'use client';
// ═══════════════════════════════════════════════════════════════
// F1A · WORKSPACE CLÍNICO DO ATENDIMENTO
// ═══════════════════════════════════════════════════════════════
// Não é um card no dashboard: é a ÁREA DE TRABALHO do atendimento.
//
//   • cabeçalho CONTEXTUAL PERSISTENTE com o PACIENTE (pet) como protagonista
//     e o tutor como contexto — nunca o contrário;
//   • estado clínico visível em texto (Não iniciado · Em atendimento ·
//     Finalizado) — nunca só por cor;
//   • o corpo é o NÚCLEO REAL do atendimento (`EncounterCoreSection`) — o
//     EncounterSheet legado NÃO é montado aqui (ele carrega anamnese, anexos,
//     pagamento e pós-atendimento, que são de fases futuras);
//   • navegação interna preparada para F1B: só o que está DISPONÍVEL é
//     renderizado (nada de aba morta, placeholder decorativo ou módulo falso).
//
// Persistência é do SERVIDOR: abrir, sair, dar F5, colar a URL ou voltar pela
// Agenda caem no MESMO `encounterId` — o workspace apenas LÊ por id.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icons';
import { PageBackAction, Skeleton, StatusBadge } from '@/components/ui';
import { EncounterCoreSection, type EncounterCoreRow } from './EncounterCoreSection';
import { AccessDenied } from './AccessNotice';
import { usePanelPermissions } from './usePanelPermissions';
import { apiGet } from '@/lib/api-client';
import { ENCOUNTER_CLINICAL_STATE } from '@/lib/encounters';
import { availableEncounterSections, resolveEncounterSection } from '@/lib/encounter-sections';
import { formatDateBR } from '@/lib/tz';

export interface EncounterWorkspaceRow extends EncounterCoreRow {
  /**
   * Nomes resolvidos na LEITURA (a mesma conveniência do modelo antigo).
   * O cabeçalho prefere `context` e cai aqui só quando o vínculo não resolveu.
   */
  petName?: string;
  serviceName?: string;
  professionalName?: string;
  bookingStatus?: string;
  customerPhone?: string;
  context?: {
    clinicalState: 'not_started' | 'in_progress' | 'finalized';
    patient: { id: string; name: string; speciesLabel: string; breed: string; ageLabel: string } | null;
    responsible: { id: string; name: string; phone: string };
    service: { id: string; name: string; durationMin: number } | null;
    professional: { id: string; name: string; role: string } | null;
    booking: { id: string; date: string; time: string; status: string } | null;
  };
}

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
  const [sectionId, setSectionId] = useState<string>('');

  // Seções REAIS (F1A: somente "Atendimento"). A navegação interna só aparece
  // quando existe mais de uma seção implementada — o contrato de estrutura
  // (F1B) vive em lib/encounter-sections.ts, não em aba desabilitada.
  const sections = useMemo(() => availableEncounterSections(), []);
  const section = useMemo(() => resolveEncounterSection(sectionId), [sectionId]);

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

  const leave = useCallback(() => router.replace(returnTo), [router, returnTo]);

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
  const subtitle = patient
    ? joinParts([patient.speciesLabel, patient.breed, patient.ageLabel])
    : '';
  const meta = joinParts([
    ctx?.service?.name || row.serviceName || '',
    ctx?.professional?.name || row.professionalName || '',
    row.date ? `${formatDateBR(row.date)}${row.time ? ` · ${row.time}` : ''}` : '',
  ]);

  return (
    <main className="encounter-workspace" data-clinical-state={state.id} data-encounter-id={row.id}>
      {/* ── Cabeçalho contextual persistente ── */}
      <header className="encounter-workspace__header">
        <PageBackAction className="encounter-workspace__back" onClick={leave} label="Voltar" />
        <div className="encounter-workspace__heading">
          <div className="encounter-workspace__identity">
            <p className="encounter-workspace__eyebrow">
              {row.bookingId ? 'Atendimento' : 'Atendimento do balcão'}
            </p>
            <h1 className="encounter-workspace__patient">{headline}</h1>
            {subtitle && <p className="encounter-workspace__subtitle">{subtitle}</p>}
            {patient && (ctx?.responsible?.name || row.customerName) && (
              <p className="encounter-workspace__tutor">
                Tutor: {ctx?.responsible?.name || row.customerName}
              </p>
            )}
            {meta && <p className="encounter-workspace__meta">{meta}</p>}
          </div>
          {/* Estado clínico SEMPRE textual: a cor acompanha, nunca substitui. */}
          <StatusBadge tone={state.tone}>{state.label.toUpperCase()}</StatusBadge>
        </div>
      </header>

      {/* ── Navegação interna: só quando há mais de uma seção REAL ── */}
      {sections.length > 1 && (
        <nav className="encounter-workspace__nav" aria-label="Seções do atendimento">
          {sections.map((s) => {
            const active = s.id === section.id;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                data-active={active || undefined}
                className="encounter-workspace__nav-item"
                onClick={() => setSectionId(s.id)}
              >
                {s.label}
              </button>
            );
          })}
        </nav>
      )}

      {/* ── Corpo: a seção REAL (núcleo clínico F1A) ──
          É o `EncounterCoreSection`, NÃO o `EncounterSheet` legado: o núcleo
          declara as capacidades que suporta e nada de F1B/F1C entra aqui
          (anamnese, anexos, pagamento, pós-atendimento, reabertura). O
          componente legado continua existindo, intacto, onde já funcionava. */}
      {section.id === 'atendimento' && (
        <EncounterCoreSection
          businessId={businessId}
          encounter={row as EncounterCoreRow}
          onSaved={() => { /* autosave mantém o workspace montado */ }}
        />
      )}

      {row.status === 'finalized' && (
        <p className="encounter-workspace__hint">
          <Icon n="lock" size={13} /> Registro finalizado: a finalização completa e a revisão clínica
          entram no F1B/F1C.
        </p>
      )}
    </main>
  );
}
