'use client';
// ═══════════════════════════════════════════════════════════════
// F1 · RODAPÉ PERSISTENTE DA SESSÃO CLÍNICA (workspace canônico)
// ═══════════════════════════════════════════════════════════════
// Fica sempre visível enquanto o atendimento está aberto:
//   esquerda → estado de GRAVAÇÃO real (Salvando… · Salvo agora · Erro ao
//              salvar) e o TEMPO de atendimento;
//   direita  → ações secundárias que já existem (Registro completo) e o CTA
//              "Finalizar atendimento", que abre a MESMA revisão do painel de
//              fechamento (nenhuma regra nova de finalização aqui).
//
// TIMER — regra de honestidade:
//   • só existe a partir de `startedAt`, o instante PERSISTIDO pelo servidor no
//     início do atendimento (F1A). Nenhum início é criado no cliente (relógio do navegador não grava nada);
//   • o relógio do tempo decorrido é apenas exibição: lê o início gravado e
//     recalcula; não tem estado próprio que possa zerar em re-render;
//   • se o início não é do dia corrente (registro antigo cujo início veio de
//     `createdAt`, ou atendimento que atravessou a meia-noite), NÃO conta ao
//     vivo: mostra o horário de início gravado e a data.
//   • sem timestamp válido, o timer simplesmente não aparece.
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { ENCOUNTER_AUTOSAVE_LABELS } from '@/lib/encounters';
import { effectiveTimezone, formatDateBR, todayISO } from '@/lib/tz';
import { persistenceState } from './OverlayDismissGuard';

/** Texto do tempo de atendimento a partir do início PERSISTIDO. `null` = sem timer. */
export function encounterTimeLabel(startedAt: string | undefined, now: Date, tz?: string | null): string | null {
  if (!startedAt) return null;
  const started = new Date(startedAt);
  if (Number.isNaN(started.getTime())) return null;
  const zone = effectiveTimezone(tz);
  const hm = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(started);
  const startedDay = todayISO(started, zone);
  if (startedDay !== todayISO(now, zone)) {
    return `Iniciado em ${formatDateBR(startedDay)} às ${hm}`;
  }
  const minutes = Math.max(0, Math.floor((now.getTime() - started.getTime()) / 60000));
  const elapsed = minutes < 60
    ? `${minutes} min`
    : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
  return `Em atendimento há ${elapsed} · início às ${hm}`;
}

/** Relógio de EXIBIÇÃO do tempo decorrido (não é um timestamp de criação). */
function useDisplayClock(active: boolean): Date {
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    if (!active) return undefined;
    setNow(new Date());
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

interface Props {
  status: 'draft' | 'finalized';
  startedAt?: string;
  finalizedAt?: string;
  timezone?: string | null;
  /** O profissional responsável pode gravar e finalizar. */
  canEdit: boolean;
  canFinalize: boolean;
  responsibleName: string;
  dirty: boolean;
  saving: boolean;
  error: string;
  onFinalize: () => void;
  onShowClosing: () => void;
  /** Ausente = sem registro completo nesta superfície (nada de botão morto). */
  onFullRecord?: () => void;
}

export function EncounterSessionFooter({
  status, startedAt, finalizedAt, timezone, canEdit, canFinalize, responsibleName,
  dirty, saving, error, onFinalize, onShowClosing, onFullRecord,
}: Props) {
  const draft = status === 'draft';
  const liveTimer = draft && canEdit;
  const now = useDisplayClock(liveTimer);
  const timer = draft ? encounterTimeLabel(startedAt, now, timezone) : null;
  const state = persistenceState({ dirty, saving, error, hasPersisted: true });
  const saveLabel = state === 'saving' ? ENCOUNTER_AUTOSAVE_LABELS.saving
    : state === 'error' ? ENCOUNTER_AUTOSAVE_LABELS.error
      : state === 'dirty' ? 'Salvando…'
        : ENCOUNTER_AUTOSAVE_LABELS.saved;

  return (
    <footer className="encounter-workspace__footer" aria-label="Ações do atendimento" data-testid="encounter-session-footer">
      <div className="encounter-workspace__footer-state">
        {draft && canEdit ? (
          <>
            {timer && <span className="encounter-workspace__timer tabular-nums" data-testid="encounter-timer">{timer}</span>}
            <span
              className={`encounter-page__save-state encounter-page__save-state--${state}`}
              role="status"
              aria-live="polite"
              data-testid="encounter-workspace-save-state"
              data-persistence-state={state}
            >
              {saveLabel}
            </span>
          </>
        ) : draft ? (
          <span className="encounter-workspace__timer" data-testid="encounter-readonly-state">
            Somente leitura · responsável: {responsibleName || 'profissional do atendimento'}
          </span>
        ) : (
          <span className="encounter-workspace__timer" data-testid="encounter-finalized-state">
            Finalizado{finalizedAt ? ` em ${formatDateBR(finalizedAt.slice(0, 10))}` : ''} · somente leitura
          </span>
        )}
      </div>
      <div className="encounter-workspace__footer-actions">
        {onFullRecord && (
          <Button type="button" variant="secondary" size="sm" onClick={onFullRecord}>Registro completo</Button>
        )}
        {draft && canEdit && (
          <Button type="button" size="sm" onClick={onFinalize} disabled={!canFinalize}>
            Finalizar atendimento
          </Button>
        )}
        {!draft && (
          <Button type="button" variant="secondary" size="sm" onClick={onShowClosing}>Ver fechamento</Button>
        )}
      </div>
    </footer>
  );
}
