'use client';
// ═══════════════════════════════════════════════════════════════
// F1B1 · CORPO DO WORKSPACE (uma autoridade, três seções reais)
// ═══════════════════════════════════════════════════════════════
//   Atendimento  → núcleo do F1A (queixa principal, evolução clínica,
//                  orientações ao tutor, retorno, nota interna, etiquetas)
//   Anamnese     → o que foi RELATADO nesta visita
//   Avaliação    → exame clínico veterinário de hoje (peso, temperatura, FC,
//                  FR, TPC, hidratação, mucosas, condição corporal, exame)
//
// O que este componente garante:
//   • UMA versão por Encounter: quem salva pergunta a versão à autoridade e
//     publica a linha confirmada (a outra seção recebe a versão nova);
//   • trocar de seção GRAVA ANTES: se a gravação falhar, fica onde está e o
//     texto continua na tela (mesma regra do F1A para sair);
//   • sair (Voltar, menu, Back, F5) passa pelo MESMO caminho: flush → só
//     navega com persistência confirmada, ou com descarte explícito;
//   • um único indicador de persistência (Salvando… · Salvo agora · Erro ao
//     salvar) e um único bloco de conflito para o atendimento inteiro.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { EncounterCoreSection } from './EncounterCoreSection';
import { EncounterVisitAnamnesisSection } from './EncounterVisitAnamnesisSection';
import { EncounterVeterinaryAssessmentSection } from './EncounterVeterinaryAssessmentSection';
import { EncounterConflictNotice, EncounterSaveFooter } from './EncounterSectionChrome';
import {
  fetchEncounterRow, useEncounterAuthority,
  type EncounterAuthorityRow,
} from './useEncounterAuthority';
import { useUnsavedChangesGuard, type DismissReason } from './OverlayDismissGuard';
import { availableEncounterSections, resolveEncounterSection } from '@/lib/encounter-sections';

interface Props {
  businessId: string;
  row: EncounterAuthorityRow;
  /** Cabeçalho do workspace acompanha a linha mais recente (versão/estado). */
  onRow: (row: EncounterAuthorityRow) => void;
  /** O corpo registra aqui o caminho ÚNICO de saída (Voltar/menu/Back). */
  registerLeave: (leave: (reason: DismissReason, proceed: () => void) => void) => void;
}

interface PendingLeave { reason: DismissReason; proceed: () => void; }

export function EncounterWorkspaceBody({ businessId, row, onRow, registerLeave }: Props) {
  const {
    authority, row: current, saveState, saveError, conflictMessage, dirtySections,
    publish, clearConflict, pendingSections, anyDirty,
  } = useEncounterAuthority(row, onRow);
  const [sectionId, setSectionId] = useState<string>(() => resolveEncounterSection('atendimento').id);
  const [adoptToken, setAdoptToken] = useState(0);
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null);
  const leaving = useRef(false);
  const sectionsAvailable = useMemo(() => availableEncounterSections(), []);

  // Identidades ESTÁVEIS para as seções: props novas a cada render fazem a
  // seção re-registrar o flush sem necessidade (e o re-registro não pode, em
  // hipótese alguma, apagar o estado de "pendente" de quem está digitando).
  const onCoreSaved = useCallback(() => { /* a autoridade publica a linha */ }, []);

  /** Grava TODAS as seções pendentes. `true` só com persistência confirmada. */
  const flushAll = useCallback(async (): Promise<boolean> => {
    for (const pending of pendingSections()) {
      const ok = await pending.flush();
      if (!ok) return false;
    }
    return true;
  }, [pendingSections]);

  /** Troca de seção: grava antes; falhou → permanece com o texto na tela. */
  const goToSection = useCallback(async (id: string) => {
    if (id === sectionId) return;
    const active = authority.registeredSection(sectionId);
    if (active?.dirty()) {
      const ok = await active.flush();
      if (!ok) return;                       // conflito/erro: a seção continua aberta
    }
    setSectionId(id);
  }, [authority, sectionId]);

  const requestLeave = useCallback(async (reason: DismissReason, proceed: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    try {
      const ok = await flushAll();
      if (ok) { setPendingLeave(null); proceed(); return; }
      setPendingLeave({ reason, proceed });
    } finally {
      leaving.current = false;
    }
  }, [flushAll]);

  useEffect(() => { registerLeave(requestLeave); }, [registerLeave, requestLeave]);

  const { dialog, requestClose, allowNavigation } = useUnsavedChangesGuard(
    {
      dirty: dirtySections.length > 0,
      saving: saveState === 'saving',
      error: saveState === 'error' ? saveError : '',
      context: 'edit',
    },
    { beforeNavigate: (reason, proceed) => { void requestLeave(reason, proceed); } },
  );

  /**
   * Sair SEM salvar é escolha explícita e CONFIRMADA (diálogo central). Quando
   * o humano confirma o descarte, a navegação já está autorizada: o guard não
   * pode perguntar de novo sobre rascunhos que ele acabou de mandar descartar
   * (era um laço de diálogos que impedia a saída).
   */
  const leaveWithoutSaving = useCallback(() => {
    const pending = pendingLeave;
    if (!pending) return;
    setPendingLeave(null);
    requestClose(
      pending.reason,
      { dirty: true, saving: false, error: saveError, context: 'edit' },
      () => { allowNavigation(); pending.proceed(); },
      undefined,
    );
  }, [allowNavigation, pendingLeave, requestClose, saveError]);

  /** "Recarregar versão atual": adota o servidor por escolha explícita. */
  const reloadFromServer = useCallback(async () => {
    const fresh = await fetchEncounterRow(businessId, current.id);
    if (!fresh) return;
    publish(fresh);
    clearConflict();
    setAdoptToken((token) => token + 1);   // as seções descartam o rascunho local
  }, [businessId, clearConflict, current.id, publish]);

  const access = current.access;
  const canEditCore = access ? access.canEditCore : false;
  const canEditClinical = access ? access.canEditClinical : false;
  const readOnlyHint = useMemo(() => {
    const reason = access?.reason;
    if (reason === 'finalized') {
      return 'Registro finalizado: a leitura continua disponível e a edição depende da reabertura (F1C).';
    }
    if (reason === 'pet_required') {
      return 'Vincule o Pet a este atendimento para registrar anamnese e avaliação.';
    }
    if (reason === 'pet_invalid') {
      return 'O Pet deste atendimento não pôde ser validado nesta unidade — a escrita clínica está bloqueada.';
    }
    if (reason === 'responsible_unavailable') {
      return 'O profissional responsável deste atendimento não está mais ativo na unidade: a escrita clínica está bloqueada.';
    }
    return 'Somente o profissional responsável vinculado edita o conteúdo clínico deste atendimento.';
  }, [access?.reason]);

  // Falhou gravar: o texto fica e a saída só acontece por escolha explícita.
  const blockedLeave = Boolean(pendingLeave) && saveState === 'error' && !conflictMessage;

  return (
    <>
      {/* Navegação clínica contextual: só seções REAIS entram aqui. */}
      {sectionsAvailable.length > 1 && (
        <nav className="encounter-workspace__nav" aria-label="Seções do atendimento">
          {sectionsAvailable.map((section) => {
            const active = section.id === sectionId;
            return (
              <button
                key={section.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                data-active={active || undefined}
                data-section-id={section.id}
                className="encounter-workspace__nav-item"
                onClick={() => { void goToSection(section.id); }}
              >
                {section.label}
              </button>
            );
          })}
        </nav>
      )}

      {conflictMessage && (
        <EncounterConflictNotice
          message={conflictMessage}
          onKeepEditing={() => clearConflict()}
          onReload={() => { void reloadFromServer(); }}
        />
      )}

      {sectionId === 'atendimento' && (
        <EncounterCoreSection
          businessId={businessId}
          encounter={current}
          authority={authority}
          canEdit={canEditCore}
          onSaved={onCoreSaved}
        />
      )}

      {sectionId === 'anamnese' && (
        <EncounterVisitAnamnesisSection
          businessId={businessId}
          row={current}
          authority={authority}
          adoptToken={adoptToken}
          blocked={Boolean(conflictMessage)}
          editable={canEditClinical}
          readOnlyHint={readOnlyHint}
        />
      )}

      {sectionId === 'avaliacao' && (
        <EncounterVeterinaryAssessmentSection
          businessId={businessId}
          row={current}
          authority={authority}
          adoptToken={adoptToken}
          blocked={Boolean(conflictMessage)}
          editable={canEditClinical}
          readOnlyHint={readOnlyHint}
          petWeightKg={current.context?.patient?.weightKg || 0}
        />
      )}

      {blockedLeave && (
        <div className="encounter-core__error-block">
          <p className="encounter-core__error" role="alert">
            {saveError || 'Não foi possível salvar agora.'} O texto continua nesta tela — nada foi perdido.
          </p>
          <Button size="sm" variant="secondary" onClick={leaveWithoutSaving}>Sair sem salvar</Button>
        </div>
      )}

      <EncounterSaveFooter
        dirty={dirtySections.length > 0 || anyDirty()}
        saving={saveState === 'saving'}
        error={saveState === 'error' ? saveError : ''}
        testId="encounter-workspace-save-state"
      />

      {dialog}
    </>
  );
}
