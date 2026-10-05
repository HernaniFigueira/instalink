'use client';
// ═══════════════════════════════════════════════════════════════
// F1B1 · RODAPÉ DE PERSISTÊNCIA E BLOCO DE CONFLITO (compartilhados)
// ═══════════════════════════════════════════════════════════════
// Um só contrato visual para todas as seções do workspace:
//   Salvando… · Salvo agora · Erro ao salvar
// Nunca um botão "Salvar" obrigatório por seção — o autosave é silencioso e o
// estado fica visível (o profissional precisa saber se está gravado).
import { ENCOUNTER_AUTOSAVE_LABELS } from '@/lib/encounters';
import { Button } from '@/components/ui';
import { persistenceState } from './OverlayDismissGuard';

export function EncounterSaveFooter({
  dirty, saving, error, label = 'Rascunho', testId,
}: {
  dirty: boolean;
  saving: boolean;
  error: string;
  label?: string;
  testId: string;
}) {
  const state = persistenceState({ dirty, saving, error, hasPersisted: true });
  return (
    <footer className="encounter-page__footer">
      <span
        className={`encounter-page__save-state encounter-page__save-state--${state}`}
        role="status"
        aria-live="polite"
        data-testid={testId}
        data-persistence-state={state}
      >
        {state === 'saving' ? ENCOUNTER_AUTOSAVE_LABELS.saving
          : state === 'error' ? ENCOUNTER_AUTOSAVE_LABELS.error
            : state === 'dirty' ? 'Salvando…'
              : state === 'saved' ? ENCOUNTER_AUTOSAVE_LABELS.saved : label}
      </span>
    </footer>
  );
}

/**
 * Conflito de versão: NUNCA navega sozinho e NUNCA sobrescreve. As duas saídas
 * são escolhas explícitas de quem edita — e o texto local continua na tela até
 * que ele decida.
 */
export function EncounterConflictNotice({
  message, onKeepEditing, onReload,
}: {
  message: string;
  onKeepEditing: () => void;
  onReload: () => void;
}) {
  if (!message) return null;
  return (
    <div className="encounter-core__conflict" role="alert">
      <p className="encounter-core__conflict-copy">
        Este atendimento foi alterado em outra tela. Suas alterações ainda não foram salvas.
      </p>
      <div className="encounter-core__conflict-actions">
        <Button size="sm" variant="secondary" onClick={onKeepEditing}>Continuar editando</Button>
        <Button size="sm" variant="secondary" onClick={onReload}>Recarregar versão atual</Button>
      </div>
      <p className="encounter-core__conflict-hint">{message}</p>
    </div>
  );
}
