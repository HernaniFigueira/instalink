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
import { Button, ReadOnlyField } from '@/components/ui';
import { EncounterFollowUpPlanner, followUpPlanLabel } from './EncounterFollowUpPlanner';
import { EncounterCoreSection } from './EncounterCoreSection';
import { EncounterVisitAnamnesisSection } from './EncounterVisitAnamnesisSection';
import { EncounterVeterinaryAssessmentSection } from './EncounterVeterinaryAssessmentSection';
// F1B2 — raciocínio clínico, conduta e procedimentos no MESMO Encounter.
import { EncounterClinicalProblemsSection } from './EncounterClinicalProblemsSection';
import { EncounterCarePlanSection } from './EncounterCarePlanSection';
import { EncounterClinicalProceduresSection } from './EncounterClinicalProceduresSection';
import { EncounterConflictNotice } from './EncounterSectionChrome';
import { EncounterSessionFooter } from './EncounterSessionFooter';
import {
  fetchEncounterRow, useEncounterAuthority,
  type EncounterAuthorityRow,
} from './useEncounterAuthority';
import { useUnsavedChangesGuard, type DismissReason } from './OverlayDismissGuard';
import { availableEncounterSections, resolveEncounterSection } from '@/lib/encounter-sections';
import { EncounterFinalizationPanel } from './EncounterFinalizationPanel';

interface Props {
  businessId: string;
  row: EncounterAuthorityRow;
  /** Cabeçalho do workspace acompanha a linha mais recente (versão/estado). */
  onRow: (row: EncounterAuthorityRow) => void;
  /** O corpo registra aqui o caminho ÚNICO de saída (Voltar/menu/Back). */
  registerLeave: (leave: (reason: DismissReason, proceed: () => void) => void) => void;
  /** Rota do registro completo (legado: anexos, pós-atendimento). */
  fullRecordHref?: string;
  /** Navegação do workspace (router). Sempre passa pela guarda de saída. */
  onNavigate?: (href: string) => void;
}

/** Navegação contextual AGRUPADA. Só seções reais; grupos sem itens não aparecem. */
const SECTION_GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: 'Atendimento', ids: ['atendimento', 'anamnese', 'avaliacao'] },
  { label: 'Plano clínico', ids: ['problemas', 'conduta', 'procedimentos'] },
];

const FILE_DATE = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' });

/**
 * Histórico e arquivos — conteúdo COMPARTILHADO da sessão (não pertence à aba
 * ativa). Fica numa faixa própria, separada do conteúdo da seção, e é a mesma
 * em todas as abas. Somente leitura aqui; anexar é no Registro completo.
 */
function EncounterHistoryBlock({ files, onOpenRecord }: {
  files: NonNullable<EncounterAuthorityRow['files']>;
  onOpenRecord?: () => void;
}) {
  return (
    <section className="encounter-workspace__block encounter-shared" aria-labelledby="encounter-history-title" data-testid="encounter-history">
      <div className="encounter-shared__inner">
        <p className="encounter-shared__eyebrow">Da sessão · comum a todas as seções</p>
        <h2 id="encounter-history-title" className="encounter-workspace__block-title">Histórico e arquivos</h2>
        <p className="encounter-workspace__block-hint">
          O histórico de todos os atendimentos do paciente fica na ficha do paciente, em Clientes.
        </p>
        {files.length === 0 ? (
          <p className="encounter-workspace__block-empty">Nenhum arquivo neste atendimento.</p>
        ) : (
          <ul className="encounter-workspace__files" aria-label="Arquivos do atendimento">
            {files.map((file) => (
              <li key={file.id} className="encounter-workspace__file">
                <a href={file.url} target="_blank" rel="noreferrer" className="encounter-workspace__file-name">{file.name}</a>
                <span className="encounter-workspace__file-meta tabular-nums">
                  {Math.max(1, Math.round((Number(file.size) || 0) / 1024))} KB
                  {file.createdAt ? ` · ${FILE_DATE.format(new Date(file.createdAt))}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {/* Sem botão: anexar é no Registro completo, alcançado pelo switcher
            do rail (um só caminho, no mesmo lugar nas duas telas). */}
        {onOpenRecord && (
          <p className="encounter-workspace__block-hint">
            Para anexar exames, laudos ou imagens, use <strong>Registro completo</strong> no contexto da sessão.
          </p>
        )}
      </div>
    </section>
  );
}

interface PendingLeave { reason: DismissReason; proceed: () => void; }

export function EncounterWorkspaceBody({ businessId, row, onRow, registerLeave, fullRecordHref, onNavigate }: Props) {
  const {
    authority, row: current, saveState, saveError, conflictMessage, dirtySections,
    publish, clearConflict, pendingSections, anyDirty,
  } = useEncounterAuthority(row, onRow);
  // A NAVEGAÇÃO vem da VERTICAL (Business.clinicType resolvido no servidor):
  // clínica veterinária liga Anamnese/Avaliação; as demais ficam só com o CORE
  // até que a abstração de paciente daquela vertical seja fechada. Nenhum
  // `if (clinicType === ...)` aqui: a autoridade é `availableEncounterSections`.
  const [sectionId, setSectionId] = useState<string>(() => resolveEncounterSection('atendimento', row.clinicType).id);
  const [adoptToken, setAdoptToken] = useState(0);
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null);
  // Revisão de finalização: elevada aqui para o rodapé abrir o MESMO diálogo.
  const [reviewOpen, setReviewOpen] = useState(false);
  const leaving = useRef(false);
  const sectionsAvailable = useMemo(() => availableEncounterSections(current.clinicType), [current.clinicType]);

  // A vertical mudou (ou a seção ativa deixou de existir nesta unidade): cai
  // para a inicial SEM apagar nada — o dado clínico continua no Encounter.
  useEffect(() => {
    if (sectionsAvailable.some((section) => section.id === sectionId)) return;
    setSectionId(sectionsAvailable[0]?.id || 'atendimento');
  }, [sectionId, sectionsAvailable]);

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
    // Grava TUDO o que está pendente (a seção Atendimento tem duas fatias:
    // núcleo e retorno estruturado). Falhou → a seção continua aberta.
    const ok = await flushAll();
    if (!ok) return;
    setSectionId(id);
  }, [flushAll, sectionId]);

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

  // Registro completo → "Ir para o fechamento": chega com #encounter-closing.
  useEffect(() => {
    if (typeof window === 'undefined' || window.location.hash !== '#encounter-closing') return;
    const t = window.setTimeout(() => {
      document.getElementById('encounter-closing')?.scrollIntoView({ block: 'start' });
    }, 60);
    return () => window.clearTimeout(t);
  }, []);

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
  // Capacidades SEPARADAS (não uma flag ambígua): o núcleo é universal; as
  // seções clínicas da visita (anamnese, avaliação, problemas, conduta e
  // procedimentos) são do módulo ligado na vertical + paciente válido.
  const canEditCore = access ? access.canEditCore : false;
  const canEditVisitAnamnesis = access ? access.canEditVisitAnamnesis : false;
  const canEditVeterinaryAssessment = access ? access.canEditVeterinaryAssessment : false;
  const canEditClinicalProblems = access ? access.canEditClinicalProblems : false;
  const canEditCarePlan = access ? access.canEditCarePlan : false;
  const canEditClinicalProcedures = access ? access.canEditClinicalProcedures : false;
  const readOnlyHint = useMemo(() => {
    const reason = access?.reason;
    if (reason === 'finalized') {
      return 'Registro finalizado: a leitura continua disponível e a edição depende da reabertura (F1C).';
    }
    if (reason === 'pet_required') {
      return 'Vincule o Pet a este atendimento para registrar anamnese, avaliação, problemas, conduta e procedimentos.';
    }
    if (reason === 'pet_invalid') {
      return 'O Pet deste atendimento não pôde ser validado nesta unidade — a escrita clínica está bloqueada.';
    }
    if (reason === 'responsible_unavailable') {
      return 'O profissional responsável deste atendimento não está mais ativo na unidade: a escrita clínica está bloqueada.';
    }
    return 'Somente o profissional responsável vinculado edita o conteúdo clínico deste atendimento.';
  }, [access?.reason]);

  const activeSection = sectionsAvailable.length > 1 ? sectionsAvailable.find((section) => section.id === sectionId) : undefined;
  const activeGroup = SECTION_GROUPS.find((group) => group.ids.includes(sectionId))?.label || 'Outras seções';

  // Falhou gravar: o texto fica e a saída só acontece por escolha explícita.
  const blockedLeave = Boolean(pendingLeave) && saveState === 'error' && !conflictMessage;

  return (
    <>
      {/* Navegação clínica contextual: só seções REAIS entram aqui, agrupadas. */}
      {sectionsAvailable.length > 1 && (
        <nav className="encounter-workspace__nav" aria-label="Seções do atendimento">
          {(() => {
            const grouped = new Set(SECTION_GROUPS.flatMap((group) => group.ids));
            const groups = SECTION_GROUPS.map((group) => ({
              label: group.label,
              items: sectionsAvailable.filter((section) => group.ids.includes(section.id)),
            }));
            // Seção real sem grupo declarado: não some da navegação.
            const loose = sectionsAvailable.filter((section) => !grouped.has(section.id));
            if (loose.length) groups.push({ label: 'Outras seções', items: loose });
            return groups.filter((group) => group.items.length > 0).map((group) => (
              <div key={group.label} role="group" aria-label={group.label} className="encounter-workspace__nav-group">
                <span className="encounter-workspace__nav-label" aria-hidden="true">{group.label}</span>
                <div className="encounter-workspace__nav-items">
                  {group.items.map((section) => {
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
                </div>
              </div>
            ));
          })()}
        </nav>
      )}

      {conflictMessage && (
        <EncounterConflictNotice
          message={conflictMessage}
          onKeepEditing={() => clearConflict()}
          onReload={() => { void reloadFromServer(); }}
        />
      )}

      {activeSection && (
        <header className="encounter-section-head" data-group={activeGroup}>
          {/* O grupo só aparece quando acrescenta algo ("Atendimento › Atendimento" não). */}
          {activeGroup.toLowerCase() !== activeSection.label.toLowerCase() && (
            <p className="encounter-section-head__group">{activeGroup}</p>
          )}
          <h2 className="encounter-section-head__title">{activeSection.label}</h2>
        </header>
      )}

      {sectionId === 'atendimento' && (
        <EncounterCoreSection
          businessId={businessId}
          encounter={current}
          authority={authority}
          adoptToken={adoptToken}
          canEdit={canEditCore}
          onSaved={onCoreSaved}
          readOnlyHint={readOnlyHint}
          beforeFollowUp={canEditCore ? (
            <EncounterFollowUpPlanner
              businessId={businessId}
              row={current}
              authority={authority}
              adoptToken={adoptToken}
              blocked={Boolean(conflictMessage)}
              editable={canEditCore}
            />
          ) : (
            <ReadOnlyField label="Retorno" value={followUpPlanLabel(current)} empty="Sem retorno definido" />
          )}
        />
      )}

      {sectionId === 'anamnese' && (
        <EncounterVisitAnamnesisSection
          businessId={businessId}
          row={current}
          authority={authority}
          adoptToken={adoptToken}
          blocked={Boolean(conflictMessage)}
          editable={canEditVisitAnamnesis}
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
          editable={canEditVeterinaryAssessment}
          readOnlyHint={readOnlyHint}
          petWeightKg={current.context?.patient?.weightKg || 0}
        />
      )}

      {sectionId === 'problemas' && (
        <EncounterClinicalProblemsSection
          businessId={businessId}
          row={current}
          authority={authority}
          adoptToken={adoptToken}
          blocked={Boolean(conflictMessage)}
          editable={canEditClinicalProblems}
          readOnlyHint={readOnlyHint}
        />
      )}

      {sectionId === 'conduta' && (
        <EncounterCarePlanSection
          businessId={businessId}
          row={current}
          authority={authority}
          adoptToken={adoptToken}
          blocked={Boolean(conflictMessage)}
          editable={canEditCarePlan}
          readOnlyHint={readOnlyHint}
          onEditInAtendimento={sectionsAvailable.some((section) => section.id === 'atendimento')
            ? () => { void goToSection('atendimento'); }
            : undefined}
        />
      )}

      {sectionId === 'procedimentos' && (
        <EncounterClinicalProceduresSection
          businessId={businessId}
          row={current}
          authority={authority}
          adoptToken={adoptToken}
          blocked={Boolean(conflictMessage)}
          editable={canEditClinicalProcedures}
          readOnlyHint={readOnlyHint}
        />
      )}

      <EncounterHistoryBlock
        files={current.files || []}
        onOpenRecord={fullRecordHref && onNavigate && current.status === 'draft'
          ? () => { void requestLeave('navigation', () => onNavigate(fullRecordHref)); }
          : undefined}
      />

      <div id="encounter-closing" className="encounter-workspace__closing">
        <EncounterFinalizationPanel
          businessId={businessId}
          row={current}
          canFinalize={canEditCore && current.status === 'draft'}
          flush={flushAll}
          authority={authority}
          revisions={current.finalizationRevisions || []}
          addenda={current.addenda || []}
          reopenEvents={current.reopenEvents || []}
          canReopen={Boolean(current.canReopen)}
          canAddendum={Boolean(current.canAddendum)}
          reviewOpen={reviewOpen}
          onReviewOpenChange={setReviewOpen}
        />
      </div>

      {blockedLeave && (
        <div className="encounter-core__error-block">
          <p className="encounter-core__error" role="alert">
            {saveError || 'Não foi possível salvar agora.'} O texto continua nesta tela — nada foi perdido.
          </p>
          <Button size="sm" variant="secondary" onClick={leaveWithoutSaving}>Sair sem salvar</Button>
        </div>
      )}

      {/* §11 — estado de GRAVAÇÃO é informação de RASCUNHO. Num atendimento
          finalizado/em leitura, "Salvo agora" seria falso (nada está sendo
          gravado) e a tela vira DOCUMENTO: o chip "Finalizado" e o painel de
          fechamento já dizem o estado do registro. */}
      <EncounterSessionFooter
        status={current.status === 'finalized' ? 'finalized' : 'draft'}
        finalizedAt={current.finalizedAt}
        canEdit={canEditCore}
        canFinalize={canEditCore && current.status === 'draft'}
        responsibleName={current.professionalName || ''}
        dirty={dirtySections.length > 0 || anyDirty()}
        saving={saveState === 'saving'}
        error={saveState === 'error' ? saveError : ''}
        onFinalize={() => setReviewOpen(true)}
        onShowClosing={() => {
          document.getElementById('encounter-closing')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}
      />

      {dialog}
    </>
  );
}
