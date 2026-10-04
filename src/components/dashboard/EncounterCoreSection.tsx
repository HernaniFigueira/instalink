'use client';
// ═══════════════════════════════════════════════════════════════
// F1A · ATENDIMENTO CORE — o corpo REAL do workspace clínico
// ═══════════════════════════════════════════════════════════════
// Este é o NÚCLEO do Clinical OS. Ele NÃO é o `EncounterSheet` legado com
// um `if` a mais: é uma peça própria, com as capacidades que esta etapa
// suporta declaradas em `lib/encounter-sections.ts`.
//
//   EncounterWorkspace
//     ├── AtendimentoCore      ← ESTE ARQUIVO (F1A)
//     ├── Anamnese             [F1B]
//     ├── Avaliação            [F1B]
//     ├── Problemas            [F1B]
//     ├── Conduta              [F1B]
//     ├── Procedimentos        [F1B]
//     └── Anexos               [fase apropriada]
//
// O que o núcleo suporta hoje (e só isso):
//   complaint · evolution · guidance · followUp · internalNote · tags.
//
// O que NÃO entra aqui, de propósito (o legado continua com eles, onde já
// funcionava — nada foi apagado):
//   anamnese · arquivos/anexos · registrar pagamento · pós-atendimento ·
//   reabrir para editar · módulos de especialidade.
//
// ── REGRA DE SAÍDA (P1 · esta revisão) ────────────────────────────────────
// Texto clínico NÃO pode ser perdido em silêncio. Sair com conteúdo pendente
// significa: tentar gravar; sair SÓ se a gravação estiver CONFIRMADA; ficar
// na tela (com o texto intacto e erro visível) quando ela falhar. Nunca há
// `proceed()` em `finally` — a navegação é consequência de persistência
// confirmada ou de descarte explicitamente confirmado por quem está na tela.
//
// Persistência: a MESMA do domínio (PATCH /api/encounters com `expectedVersion`),
// com autosave depois de o dedo parar e trava otimista — o texto de quem digita
// nunca é sobrescrito pela resposta de um save anterior.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { Button, Field, Input, Textarea } from '@/components/ui';
import { apiGet, apiSend } from '@/lib/api-client';
import {
  ENCOUNTER_AUTOSAVE_LABELS, ENCOUNTER_AUTOSAVE_MS, ENCOUNTER_LABELS, applySaveResult,
  canEditEncounter, encounterContentPayload, encounterDraftKey,
} from '@/lib/encounters';
import { supportsEncounterCapability, type EncounterCoreCapability } from '@/lib/encounter-sections';
import type { EncounterAuthority, EncounterSectionApi } from './useEncounterAuthority';
import type { Encounter } from '@/lib/types';
import {
  persistenceState, useUnsavedChangesGuard,
  type DismissReason,
} from './OverlayDismissGuard';

export interface EncounterCoreRow extends Encounter {
  version: number;
}

interface PendingLeave { reason: DismissReason; proceed: () => void; }

interface Props {
  businessId: string;
  /** Registro canônico (já lido pelo id — o workspace nunca cria por aqui). */
  encounter: EncounterCoreRow;
  /** Sincronização silenciosa depois de um save (o pai NÃO desmonta nada). */
  onSaved?: () => void;
  /**
   * Contrato ÚNICO de saída. O núcleo registra aqui a função que decide se a
   * navegação pode acontecer — é o mesmo caminho para o botão Voltar, para um
   * link do menu, para o Back do navegador e para qualquer saída programática.
   * Uma implementação só, usada por todos (nada de cinco guardas paralelas).
   */
  registerLeave?: (leave: (reason: DismissReason, proceed: () => void) => void) => void;
  /**
   * F1B1 — AUTORIDADE do workspace. Quando presente, esta seção NÃO guarda a
   * própria versão nem o próprio indicador: pergunta a versão na hora de
   * salvar, publica a linha confirmada e registra o flush compartilhado. Sem
   * autoridade (uso isolado/legado e testes do F1A), o comportamento é o de
   * sempre — o contrato do F1A não muda.
   */
  authority?: EncounterAuthority;
  /**
   * O workspace diz se este ator pode editar (capacidade resolvida no
   * SERVIDOR e devolvida na leitura). Ausente = a régua antiga (status).
   */
  canEdit?: boolean;
}

/**
 * Campos do núcleo, na ordem da tela. Cada um declara a CAPACIDADE que
 * representa: o que não está em `ENCOUNTER_CORE_CAPABILITIES` não renderiza,
 * e o dia em que uma capacidade nova entrar ela entra aqui — não por um `if`
 * de layout espalhado no componente antigo.
 */
const CORE_FIELDS: Array<{
  capability: EncounterCoreCapability;
  label: string;
  hint?: string;
  kind: 'textarea' | 'input';
  maxLength: number;
  placeholder: string;
}> = [
  {
    capability: 'complaint', label: ENCOUNTER_LABELS.complaint, kind: 'textarea', maxLength: 600,
    placeholder: 'Descreva o motivo do atendimento',
  },
  {
    capability: 'evolution', label: ENCOUNTER_LABELS.evolution, kind: 'textarea', maxLength: 4000,
    hint: 'O que foi feito neste atendimento — é o coração do registro.',
    placeholder: 'Registre o que foi realizado neste atendimento',
  },
  {
    capability: 'guidance', label: ENCOUNTER_LABELS.guidance, kind: 'textarea', maxLength: 2000,
    hint: 'Orientações que o tutor leva para casa.',
    placeholder: 'Registre as orientações fornecidas',
  },
  {
    capability: 'followUp', label: ENCOUNTER_LABELS.followUp, kind: 'input', maxLength: 200,
    hint: 'Texto livre sobre o retorno sugerido.',
    placeholder: 'Ex: retorno em 30 dias',
  },
  {
    capability: 'internalNote', label: ENCOUNTER_LABELS.internalNote, kind: 'textarea', maxLength: 2000,
    hint: 'Fica só na unidade — não sai na via do tutor.',
    placeholder: 'Ex: tutor relatou sensibilidade; acompanhar no próximo retorno',
  },
  {
    capability: 'tags', label: 'Etiquetas', kind: 'input', maxLength: 400,
    hint: 'Separe por vírgula (procedimento, material, região…).',
    placeholder: 'Ex.: procedimentos, materiais',
  },
];

const EMPTY = { complaint: '', evolution: '', guidance: '', followUp: '', internalNote: '', tags: '' };
type CoreForm = typeof EMPTY;

const formOf = (e: EncounterCoreRow): CoreForm => ({
  complaint: e.complaint || '',
  evolution: e.evolution || '',
  guidance: e.guidance || '',
  followUp: e.followUp || '',
  internalNote: e.internalNote || '',
  tags: (e.tags || []).join(', '),
});

/** Resultado de uma tentativa de gravação — é o que autoriza (ou não) a saída. */
interface SaveOutcome {
  ok: boolean;
  /** 409: outra tela gravou antes. Nunca sobrescreve, nunca descarta sozinho. */
  conflict: boolean;
  message: string;
}

const SAVED: SaveOutcome = { ok: true, conflict: false, message: '' };

export function EncounterCoreSection({
  businessId, encounter, onSaved, registerLeave, authority, canEdit,
}: Props) {
  const [row, setRow] = useState<EncounterCoreRow>(encounter);
  const [form, setForm] = useState<CoreForm>(() => formOf(encounter));
  const [autoState, setAutoState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  /** Uma saída foi bloqueada por falha de gravação (o erro aparece na tela). */
  const [leaveBlocked, setLeaveBlocked] = useState(false);
  // Fonte SÍNCRONA do que está na tela (a mesma regra de ouro do domínio).
  const latest = useRef({ row: encounter, form: formOf(encounter) });
  const lastSaved = useRef(encounterDraftKey({ ...formOf(encounter), followUpMode: '', followUpDate: '', followUpDays: 0 }));
  const inflight = useRef<Promise<boolean> | null>(null);
  /** Última tentativa de gravação: a saída só acontece quando `ok` é true. */
  const lastOutcome = useRef<SaveOutcome>(SAVED);
  /** Uma saída por vez (o duplo clique não dispara dois flush). */
  const leaving = useRef(false);
  /** Saída bloqueada por falha de gravação (só sai por escolha explícita). */
  const [pendingLeave, setPendingLeaveState] = useState<PendingLeave | null>(null);
  const pendingLeaveRef = useRef<PendingLeave | null>(null);
  const setPendingLeave = useCallback((value: PendingLeave | null) => {
    pendingLeaveRef.current = value;
    setPendingLeaveState(value);
  }, []);

  // O registro mudou (outra retomada, outro F5): a tela acompanha o servidor.
  useEffect(() => {
    const next = formOf(encounter);
    latest.current = { row: encounter, form: next };
    setRow(encounter);
    setForm(next);
    lastSaved.current = encounterDraftKey({ ...next, followUpMode: '', followUpDate: '', followUpDays: 0 });
    lastOutcome.current = SAVED;
    setAutoState('idle');
    setConflict(false);
    setError('');
    setLeaveBlocked(false);
    setPendingLeave(null);
  }, [encounter]);

  const updateForm = useCallback((next: CoreForm) => {
    latest.current.form = next;
    setForm(next);
  }, []);

  const keyOf = (f: CoreForm) => encounterDraftKey({ ...f, followUpMode: '', followUpDate: '', followUpDays: 0 });

  const editable = canEditEncounter(row) && (canEdit === undefined || canEdit === true);
  const dirty = useMemo(() => keyOf(form) !== lastSaved.current, [form]);

  /**
   * Grava o conteúdo do núcleo. Envia SÓ as capacidades do núcleo: os campos
   * que o legado persistiu e o F1A não mostra (retorno estruturado, arquivos…)
   * NÃO são tocados — nada é apagado por uma tela que não os exibe.
   *
   * Devolve `true` SOMENTE quando há confirmação de persistência (ou quando
   * não havia nada pendente). Nunca "true por educação": quem decide se pode
   * sair lê `lastOutcome`.
   */
  const save = useCallback(async (): Promise<boolean> => {
    const current = latest.current.row;
    if (current.status !== 'draft') {
      lastOutcome.current = { ok: false, conflict: false, message: 'Registro finalizado: leitura.' };
      return false;
    }
    const sentForm = latest.current.form;
    const sentKey = keyOf(sentForm);
    if (sentKey === lastSaved.current) { lastOutcome.current = SAVED; return true; }
    if (inflight.current) return inflight.current;

    setAutoState('saving');
    authority?.status('saving', '', 'atendimento');
    const run = (async () => {
      // A versão vem da AUTORIDADE (fonte única do workspace) quando ela
      // existe: outra seção pode ter gravado desde o último render e o 409
      // interno deixaria de ser um acidente para virar regra.
      const expectedVersion = authority ? authority.version() : current.version;
      const res = await apiSend<{ encounter: EncounterCoreRow }>(
        '/api/encounters', 'PATCH',
        encounterContentPayload(businessId, current.id, { ...sentForm, followUpMode: '' }, expectedVersion),
        { scope: 'action', area: 'Atendimento' },
      );
      if (!res.ok) {
        const outcome: SaveOutcome = {
          ok: false,
          conflict: res.status === 409,
          message: res.message || 'Não foi possível salvar o atendimento.',
        };
        lastOutcome.current = outcome;
        setAutoState('error');
        setConflict(outcome.conflict);
        setError(outcome.message);
        if (authority) {
          if (outcome.conflict) authority.conflict(outcome.message);
          else authority.status('error', outcome.message, 'atendimento');
        }
        return false;
      }
      const serverRow = res.data!.encounter;
      // O que o servidor gravou é `sentKey`. Se a tela já tem texto mais novo,
      // ele fica: o próximo ciclo salva o resto com a versão nova.
      const result = applySaveResult({
        sentKey, currentKey: keyOf(latest.current.form), serverVersion: serverRow.version,
      });
      lastSaved.current = result.lastSavedKey;
      latest.current.row = serverRow;
      setRow(serverRow);
      if (result.adoptServerForm) { updateForm(formOf(serverRow)); setAutoState('saved'); }
      else setAutoState('idle');
      lastOutcome.current = SAVED;
      setConflict(false);
      setError('');
      setLeaveBlocked(false);
      setPendingLeave(null);
      // Publica na autoridade: TODAS as seções passam a usar a versão nova.
      authority?.publish(serverRow);
      onSaved?.();
      return true;
    })();
    inflight.current = run;
    try {
      return await run;
    } finally {
      inflight.current = null;
    }
  }, [authority, businessId, onSaved, updateForm]);

  // Autosave: só em rascunho, só com mudança real, um request por vez, só
  // depois de o dedo parar. Conflito desliga o automatismo (insistir só
  // repetiria o 409).
  useEffect(() => {
    if (row.status !== 'draft' || conflict) return;
    if (keyOf(form) === lastSaved.current) return;
    const t = setTimeout(() => { void save(); }, ENCOUNTER_AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [form, row, conflict, save]);

  /**
   * Esvazia o que estiver pendente antes de sair. Insiste algumas vezes
   * (quem digitou durante o request ainda tem texto novo) e para no primeiro
   * fracasso: tentar de novo não conserta rede nem conflito.
   */
  const flushForLeave = useCallback(async (): Promise<SaveOutcome> => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (keyOf(latest.current.form) === lastSaved.current) return SAVED;   // nada pendente: sair não perde nada
      const ok = await save();
      if (!ok) return lastOutcome.current;
      if (keyOf(latest.current.form) === lastSaved.current) return SAVED;
    }
    return keyOf(latest.current.form) === lastSaved.current
      ? SAVED
      : { ok: false, conflict: false, message: 'Ainda há alterações para salvar.' };
  }, [save]);

  /** Volta o formulário ao último estado CONFIRMADO pelo servidor. */
  const discardEdits = useCallback(() => {
    const persisted = formOf(latest.current.row);
    updateForm(persisted);
    lastSaved.current = keyOf(persisted);
    lastOutcome.current = SAVED;
    setAutoState('idle');
    setConflict(false);
    setError('');
    setLeaveBlocked(false);
    setPendingLeave(null);
  }, [updateForm]);

  /** Recarrega a versão atual do servidor (escolha explícita de quem edita). */
  const reloadFromServer = useCallback(async () => {
    const res = await apiGet<{ encounter?: EncounterCoreRow }>(
      `/api/encounters?businessId=${encodeURIComponent(businessId)}&id=${encodeURIComponent(latest.current.row.id)}`,
      { scope: 'area', area: 'Atendimento' },
    );
    if (!res.ok || !res.data?.encounter) {
      setError(res.message || 'Não foi possível recarregar o atendimento.');
      return;
    }
    const server = res.data.encounter;
    const next = formOf(server);
    latest.current = { row: server, form: next };
    lastSaved.current = keyOf(next);
    lastOutcome.current = SAVED;
    setRow(server);
    updateForm(next);
    setAutoState('idle');
    setConflict(false);
    setError('');
    setLeaveBlocked(false);
    setPendingLeave(null);
  }, [businessId, updateForm]);

  // Quando o workspace comanda (autoridade presente), a guarda de navegação é
  // DELE — uma só para o atendimento inteiro. Aqui fica inerte para não existir
  // dois guardas disputando o mesmo clique/Back.
  const guardState = authority
    ? { dirty: false, saving: false, error: '', context: 'edit' as const }
    : {
      dirty,
      saving: autoState === 'saving',
      error: autoState === 'error' ? error : '',
      context: 'edit' as const,
    };
  /**
   * O contrato abaixo (`requestLeave`, registrado mais adiante) é a ÚNICA
   * resposta de saída do núcleo — inclusive para o Back do navegador, links do
   * menu e qualquer travessia: o guarda central NÃO decide sozinho, ele
   * pergunta ao núcleo, que tenta gravar antes de liberar.
   */
  const leaveRef = useRef<(reason: DismissReason, proceed: () => void) => void>(() => {});
  const { dialog, requestClose } = useUnsavedChangesGuard(guardState, {
    beforeNavigate: (reason, proceed) => { void leaveRef.current(reason, proceed); },
  });

  /**
   * A ÚNICA porta de saída do núcleo.
   *
   *   • gravou (ou não havia nada pendente) → `proceed()`, uma única vez;
   *   • falhou → NÃO navega, mantém o texto e mostra o erro;
   *   • conflito 409 → NÃO navega e NÃO sobrescreve: a tela oferece
   *     "Continuar editando" e "Recarregar versão atual".
   *
   * `proceed()` nunca fica em `finally` — sair é consequência de persistência
   * confirmada ou de descarte confirmado no diálogo central.
   */
  /** Sair SEM salvar: escolha explícita, sempre confirmada no diálogo central. */
  const leaveWithoutSaving = useCallback(() => {
    const pending = pendingLeaveRef.current;
    if (!pending) return;
    setPendingLeave(null);
    requestClose(pending.reason, {
      dirty: true, saving: false, error, context: 'edit',
    }, pending.proceed, discardEdits);
  }, [discardEdits, error, requestClose, setPendingLeave]);

  const requestLeave = useCallback(async (reason: DismissReason, proceed: () => void) => {
    if (leaving.current) return;
    leaving.current = true;
    try {
      const outcome = await flushForLeave();
      if (outcome.ok) { setPendingLeave(null); proceed(); return; }
      if (outcome.conflict) return;                          // bloco de conflito já está na tela
      // Ficou. A tela segue utilizável: o texto continua aqui, o erro aparece
      // e a saída só acontece por ESCOLHA EXPLÍCITA (botão → diálogo central).
      setPendingLeave({ reason, proceed });
      setLeaveBlocked(true);
    } finally {
      leaving.current = false;
    }
  }, [discardEdits, flushForLeave, requestClose]);

  // Registro do contrato: Voltar, menu, Back e saídas programáticas caem aqui.
  useEffect(() => { registerLeave?.(requestLeave); }, [registerLeave, requestLeave]);

  // F1B1 — flush compartilhado do workspace (troca de seção e saída) na MESMA
  // autoridade que a troca de seção consulta: `true` só quando a gravação foi
  // CONFIRMADA (mesma régua do `flushForLeave`).
  useEffect(() => {
    if (!authority) return;
    authority.registerSection({
      id: 'atendimento',
      flush: async () => (await flushForLeave()).ok,
      dirty: () => keyOf(latest.current.form) !== lastSaved.current,
    });
    return () => authority.unregisterSection('atendimento');
  }, [authority, flushForLeave]);

  // Sair da seção não deixa pendência fantasma (só no desmonte REAL).
  useEffect(() => () => authority?.sectionDirty('atendimento', false), [authority]);

  // Dirty REATIVO para o guard do workspace (ler o ref não re-renderiza).
  useEffect(() => {
    if (!authority) return;
    authority.sectionDirty('atendimento', dirty);
  }, [authority, dirty]);
  leaveRef.current = requestLeave;   // o guarda central pergunta ao núcleo

  const persistence = persistenceState({
    dirty, saving: autoState === 'saving', error: autoState === 'error' ? error : '', hasPersisted: true,
  });

  const fields = CORE_FIELDS.filter((f) => supportsEncounterCapability(f.capability));

  return (
    <section
      className="encounter-workspace__section"
      data-persistence-state={persistence}
      aria-label="Registro do atendimento"
    >
      <div className="encounter-workspace__content">
        {row.status === 'finalized' && (
          <p className="encounter-core__readonly">
            <Icon n="lock" size={13} /> Registro finalizado: a leitura fica disponível e a edição
            depende da reabertura (F1B/F1C).
          </p>
        )}

        {/* ── CONFLITO DE VERSÃO: nunca sai sozinho e nunca sobrescreve ──
            Duas saídas explícitas; nenhuma delas apaga o texto sem escolha. */}
        {conflict && !authority && (
          <div className="encounter-core__conflict" role="alert">
            <p className="encounter-core__conflict-copy">
              Este atendimento foi alterado em outra tela. Suas alterações ainda não foram salvas.
            </p>
            <div className="encounter-core__conflict-actions">
              <Button size="sm" variant="secondary" onClick={() => setConflict(false)}>
                Continuar editando
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void reloadFromServer()}>
                Recarregar versão atual
              </Button>
            </div>
            <p className="encounter-core__conflict-hint">
              Nada é sobrescrito em silêncio. “Recarregar versão atual” troca o texto desta tela pelo
              que está gravado.
            </p>
          </div>
        )}

        {fields.map((f) => (
          <Field key={f.capability} label={f.label} hint={f.hint}>
            {f.kind === 'textarea' ? (
              <Textarea
                value={(form as Record<string, string>)[f.capability]}
                disabled={!editable}
                maxLength={f.maxLength}
                onChange={(e) => updateForm({ ...form, [f.capability]: e.target.value })}
                placeholder={f.placeholder}
              />
            ) : (
              <Input
                value={(form as Record<string, string>)[f.capability]}
                disabled={!editable}
                maxLength={f.maxLength}
                onChange={(e) => updateForm({ ...form, [f.capability]: e.target.value })}
                placeholder={f.placeholder}
              />
            )}
          </Field>
        ))}

        {/* Um ÚNICO bloco de erro (nada de eco): o que falhou e o que
            acontece com o texto — ele continua aqui, não foi perdido. */}
        {autoState === 'error' && !conflict && (
          <div className="encounter-core__error-block">
            <p className="encounter-core__error" role="alert">
              {error || 'Não foi possível salvar agora.'}
              {leaveBlocked ? ' O texto continua nesta tela — nada foi perdido.' : ''}
            </p>
            {leaveBlocked && pendingLeave && (
              <Button size="sm" variant="secondary" onClick={leaveWithoutSaving}>
                Sair sem salvar
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Indicador de persistência: quando o WORKSPACE comanda, existe UM só
          (o do rodapé do workspace). Isolado, o núcleo mantém o seu. */}
      {!authority && (
        <footer className="encounter-page__footer">
          <span
            className={`encounter-page__save-state encounter-page__save-state--${persistence}`}
            role="status"
            aria-live="polite"
            data-testid="encounter-core-save-state"
          >
            {persistence === 'saving' ? ENCOUNTER_AUTOSAVE_LABELS.saving
              : persistence === 'error' ? ENCOUNTER_AUTOSAVE_LABELS.error
                : persistence === 'dirty' ? 'Salvando…'
                  : persistence === 'saved' ? ENCOUNTER_AUTOSAVE_LABELS.saved : 'Rascunho'}
          </span>
        </footer>
      )}
      {dialog}
    </section>
  );
}
