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
// Persistência: a MESMA do domínio (PATCH /api/encounters com `expectedVersion`),
// com autosave depois de o dedo parar e trava otimista — o texto de quem digita
// nunca é sobrescrito pela resposta de um save anterior.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { Field, Input, Textarea } from '@/components/ui';
import { apiSend } from '@/lib/api-client';
import {
  ENCOUNTER_AUTOSAVE_LABELS, ENCOUNTER_AUTOSAVE_MS, ENCOUNTER_LABELS, applySaveResult,
  canEditEncounter, encounterContentPayload, encounterDraftKey,
} from '@/lib/encounters';
import { supportsEncounterCapability, type EncounterCoreCapability } from '@/lib/encounter-sections';
import type { Encounter } from '@/lib/types';
import { persistenceState, useUnsavedChangesGuard } from './OverlayDismissGuard';

export interface EncounterCoreRow extends Encounter {
  version: number;
}

interface Props {
  businessId: string;
  /** Registro canônico (já lido pelo id — o workspace nunca cria por aqui). */
  encounter: EncounterCoreRow;
  /** Sincronização silenciosa depois de um save (o pai NÃO desmonta nada). */
  onSaved?: () => void;
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

export function EncounterCoreSection({ businessId, encounter, onSaved }: Props) {
  const [row, setRow] = useState<EncounterCoreRow>(encounter);
  const [form, setForm] = useState<CoreForm>(() => formOf(encounter));
  const [autoState, setAutoState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  // Fonte SÍNCRONA do que está na tela (a mesma regra de ouro do domínio).
  const latest = useRef({ row: encounter, form: formOf(encounter) });
  const lastSaved = useRef(encounterDraftKey({ ...formOf(encounter), followUpMode: '', followUpDate: '', followUpDays: 0 }));
  const inflight = useRef<Promise<boolean> | null>(null);

  // O registro mudou (outra retomada, outro F5): a tela acompanha o servidor.
  useEffect(() => {
    const next = formOf(encounter);
    latest.current = { row: encounter, form: next };
    setRow(encounter);
    setForm(next);
    lastSaved.current = encounterDraftKey({ ...next, followUpMode: '', followUpDate: '', followUpDays: 0 });
    setAutoState('idle');
    setConflict(false);
    setError('');
  }, [encounter]);

  const updateForm = useCallback((next: CoreForm) => {
    latest.current.form = next;
    setForm(next);
  }, []);

  const keyOf = (f: CoreForm) => encounterDraftKey({ ...f, followUpMode: '', followUpDate: '', followUpDays: 0 });

  const editable = canEditEncounter(row);
  const dirty = useMemo(() => keyOf(form) !== lastSaved.current, [form]);

  /**
   * Salva o conteúdo do núcleo. Envia SÓ as capacidades do núcleo: os campos
   * que o legado persistiu e o F1A não mostra (retorno estruturado, arquivos…)
   * NÃO são tocados — nada é apagado por uma tela que não os exibe.
   */
  const save = useCallback(async (): Promise<boolean> => {
    const current = latest.current.row;
    if (current.status !== 'draft') return false;
    const sentForm = latest.current.form;
    const sentKey = keyOf(sentForm);
    if (sentKey === lastSaved.current) return true;
    if (inflight.current) return inflight.current;

    setAutoState('saving');
    const run = (async () => {
      const res = await apiSend<{ encounter: EncounterCoreRow }>(
        '/api/encounters', 'PATCH',
        encounterContentPayload(businessId, current.id, { ...sentForm, followUpMode: '' }, current.version),
        { scope: 'action', area: 'Atendimento' },
      );
      if (!res.ok) {
        setAutoState('error');
        setConflict(res.status === 409);
        setError(res.message);
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
      setConflict(false);
      setError('');
      onSaved?.();
      return true;
    })();
    inflight.current = run;
    try {
      return await run;
    } finally {
      inflight.current = null;
    }
  }, [businessId, onSaved, updateForm]);

  // Autosave: só em rascunho, só com mudança real, um request por vez, só
  // depois de o dedo parar. Conflito desliga o automatismo (insistir só
  // repetiria o 409).
  useEffect(() => {
    if (row.status !== 'draft' || conflict) return;
    if (keyOf(form) === lastSaved.current) return;
    const t = setTimeout(() => { void save(); }, ENCOUNTER_AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [form, row, conflict, save]);

  // Sair da rota com texto não salvo: tenta gravar antes de ir embora.
  const flushing = useRef(false);
  useUnsavedChangesGuard(
    { dirty, saving: autoState === 'saving', error: autoState === 'error' ? error : '', context: 'edit' },
    {
      beforeNavigate: (_reason, proceed) => {
        if (flushing.current) return;
        flushing.current = true;
        void (async () => {
          try { await save(); } finally { flushing.current = false; proceed(); }
        })();
      },
    },
  );

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

        {autoState === 'error' && (
          <p className="encounter-core__error" role="alert">
            {conflict
              ? 'Este atendimento mudou em outra tela. Recarregue para continuar editando.'
              : error || 'Não foi possível salvar agora.'}
          </p>
        )}
      </div>

      <footer className="encounter-page__footer">
        <span
          className={`encounter-page__save-state encounter-page__save-state--${persistence}`}
          role="status"
          aria-live="polite"
        >
          {persistence === 'saving' ? ENCOUNTER_AUTOSAVE_LABELS.saving
            : persistence === 'error' ? ENCOUNTER_AUTOSAVE_LABELS.error
              : persistence === 'dirty' ? 'Salvando…'
                : persistence === 'saved' ? ENCOUNTER_AUTOSAVE_LABELS.saved : 'Rascunho'}
        </span>
      </footer>
    </section>
  );
}
