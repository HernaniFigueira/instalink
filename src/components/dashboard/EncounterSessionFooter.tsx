'use client';
// ═══════════════════════════════════════════════════════════════
// F1 · RODAPÉ PERSISTENTE DA SESSÃO CLÍNICA (workspace canônico)
// ═══════════════════════════════════════════════════════════════
// Fica sempre visível enquanto o atendimento está aberto:
//   esquerda → estado de GRAVAÇÃO real (Salvando… · Salvo agora · Erro ao
//              salvar) — ou o estado de leitura;
//   direita  → o CTA "Finalizar atendimento", que abre a MESMA revisão do
//              painel de fechamento (nenhuma regra nova de finalização aqui).
//
// Entrega 2: o TIMER mora no rail da sessão (contexto, ao lado da identidade
// do paciente) e a troca para o Registro completo é o switcher do rail — o
// rodapé não repete nenhum dos dois.
import { Button } from '@/components/ui';
import { ENCOUNTER_AUTOSAVE_LABELS } from '@/lib/encounters';
import { formatDateBR } from '@/lib/tz';
import { persistenceState } from './OverlayDismissGuard';

interface Props {
  status: 'draft' | 'finalized';
  finalizedAt?: string;
  /** O profissional responsável pode gravar e finalizar. */
  canEdit: boolean;
  canFinalize: boolean;
  responsibleName: string;
  dirty: boolean;
  saving: boolean;
  error: string;
  onFinalize: () => void;
  onShowClosing: () => void;
}

export function EncounterSessionFooter({
  status, finalizedAt, canEdit, canFinalize, responsibleName,
  dirty, saving, error, onFinalize, onShowClosing,
}: Props) {
  const draft = status === 'draft';
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
