'use client';
// ═══════════════════════════════════════════════════════════════
// F1B2 · SEÇÃO "PROBLEMAS" — PROBLEMAS / HIPÓTESES / DIAGNÓSTICOS
// ═══════════════════════════════════════════════════════════════
// O raciocínio clínico do profissional, registrado como LISTA COMPACTA no
// PRÓPRIO Encounter (`Encounter.clinical.problems`) — não é uma entidade nova,
// não é etiqueta (`tags`) e não é o motor legado de fichas.
//
// Regras desta tela:
//   • cada item tem IDENTIDADE ESTÁVEL (`id` próprio, nunca o índice do array):
//     editar/reordenar/remover não troca a identidade dos outros;
//   • o tipo é escolha do profissional (Problema · Hipótese · Diagnóstico):
//     NENHUMA classificação automática, nenhuma IA, nenhum vocabulário fechado
//     (CID/CIAP/SNOMED não entram nesta fase);
//   • remover item COM conteúdo pede confirmação explícita na própria linha
//     (sem `window.confirm`: o diálogo nativo some do fluxo de teclado);
//   • persistência é a do domínio (PATCH /api/encounters) com a versão vinda da
//     AUTORIDADE do workspace — uma versão só para o Encounter inteiro.
import { useMemo, useState } from 'react';
import { Button, ClinicalRecordSection, Input, ReadOnlyField, SelectMenu } from '@/components/ui';
import type { EncounterAuthority, EncounterAuthorityRow } from './useEncounterAuthority';
import { useClinicalSection } from './useClinicalSection';
import {
  CLINICAL_LIST_LIMITS, CLINICAL_PROBLEM_KINDS, CLINICAL_PROBLEM_KIND_LABELS,
  newClinicalItemId, normalizeEncounterClinical,
  type ClinicalProblemItem, type ClinicalProblemKind,
} from '@/lib/encounter-clinical';

interface Props {
  businessId: string;
  row: EncounterAuthorityRow;
  authority: EncounterAuthority;
  adoptToken: number;
  blocked: boolean;
  editable: boolean;
  readOnlyHint: string;
}

interface ProblemsForm {
  items: ClinicalProblemItem[];
}

const KIND_OPTIONS = CLINICAL_PROBLEM_KINDS.map((kind) => ({
  value: kind,
  label: CLINICAL_PROBLEM_KIND_LABELS[kind],
}));

const rowForm = (row: EncounterAuthorityRow): ProblemsForm => ({
  items: normalizeEncounterClinical(row.clinical).problems.map((item) => ({ ...item })),
});

/**
 * Só o que é GRAVÁVEL entra na assinatura e no payload: linha ainda sem
 * descrição (o profissional acabou de clicar em "Adicionar") não é mudança real
 * — senão a seção ficaria "pendente" para sempre e o autosave bateria à toa.
 */
const persistable = (items: ClinicalProblemItem[]): ClinicalProblemItem[] => items
  .filter((item) => item.label.trim() !== '')
  .map((item) => ({
    id: item.id,
    kind: item.kind,
    label: item.label.trim(),
    notes: item.notes.trim(),
  }));

const keyOf = (form: ProblemsForm): string => JSON.stringify(
  persistable(form.items).map((item) => [item.id, item.kind, item.label, item.notes]),
);

export function EncounterClinicalProblemsSection({
  businessId, row, authority, adoptToken, blocked, editable, readOnlyHint,
}: Props) {
  const [confirmingId, setConfirmingId] = useState('');
  const patchOf = useMemo(() => (form: ProblemsForm) => ({
    // Só a fatia DESTA seção: nada de reenviar anamnese/avaliação/conduta.
    clinical: { problems: persistable(form.items) },
  }), []);
  const { form, update } = useClinicalSection<ProblemsForm>({
    id: 'problemas', businessId, authority, row, adoptToken, blocked, editable,
    formOf: rowForm, keyOf, patchOf,
  });

  const disabled = !editable;
  const items = form.items;

  const setItem = (id: string, patch: Partial<ClinicalProblemItem>) => {
    update({ items: items.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  };
  const addItem = () => {
    if (items.length >= CLINICAL_LIST_LIMITS.problems.maxItems) return;
    update({
      items: [...items, {
        id: newClinicalItemId('prb'), kind: 'hypothesis' as ClinicalProblemKind, label: '', notes: '',
      }],
    });
  };
  const removeItem = (id: string) => {
    update({ items: items.filter((item) => item.id !== id) });
    setConfirmingId('');
  };
  /** Remoção de item COM conteúdo pede confirmação; item vazio sai direto. */
  const requestRemove = (item: ClinicalProblemItem) => {
    if (!item.label.trim() && !item.notes.trim()) { removeItem(item.id); return; }
    setConfirmingId((current) => (current === item.id ? '' : item.id));
  };

  // §11 — LEITURA = documento: cada problema/diagnóstico é uma linha de leitura
  // (tipo + descrição + observação), sem select nem input desabilitado.
  if (disabled) {
    return (
      <section className="encounter-workspace__section" aria-label="Problemas e diagnósticos" data-section="problemas" data-readonly="true">
        <div className="encounter-workspace__content">
          <ClinicalRecordSection title="Problemas e diagnósticos">
            {items.length === 0
              ? <ReadOnlyField label="Problemas deste atendimento" value="" empty="Nenhum problema registrado neste atendimento." block />
              : items.map((item, index) => (
                <ReadOnlyField
                  key={item.id}
                  label={`${CLINICAL_PROBLEM_KIND_LABELS[item.kind] || 'Registro'} ${index + 1}`}
                  value={item.label}
                  hint={item.notes || undefined}
                  block
                />
              ))}
          </ClinicalRecordSection>
          <p className="encounter-core__readonly" role="status">{readOnlyHint}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="encounter-workspace__section" aria-label="Problemas e diagnósticos" data-section="problemas">
      <div className="encounter-workspace__content">
        <p className="encounter-section__hint">
          Problema, hipótese ou diagnóstico deste atendimento — como o profissional registrou.
          O sistema não classifica, não sugere código e não interpreta o que foi escrito.
        </p>
        {disabled && <p className="encounter-core__readonly" role="status">{readOnlyHint}</p>}

        {items.length === 0 && (
          <p className="encounter-section__hint" data-testid="problems-empty">
            Nenhum problema registrado neste atendimento.
          </p>
        )}

        <ul className="encounter-clinical__list" data-testid="problems-list">
          {items.map((item, index) => {
            const confirming = confirmingId === item.id;
            const label = item.label.trim() || 'item sem descrição';
            return (
              <li key={item.id} className="encounter-clinical__list-item" data-problem-id={item.id}>
                <div className="encounter-clinical__row">
                  <SelectMenu
                    aria-label={`Tipo do problema ${index + 1}`}
                    value={item.kind}
                    disabled={disabled}
                    onChange={(v) => setItem(item.id, { kind: v as ClinicalProblemKind })}
                    options={KIND_OPTIONS}
                  />
                  <Input
                    aria-label={`Descrição do problema ${index + 1}`}
                    value={item.label}
                    maxLength={CLINICAL_LIST_LIMITS.problems.label}
                    disabled={disabled}
                    placeholder="Ex: otite externa / dermatite alérgica"
                    onChange={(e) => setItem(item.id, { label: e.target.value })}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remover ${CLINICAL_PROBLEM_KIND_LABELS[item.kind]}: ${label}`}
                    disabled={disabled}
                    onClick={() => requestRemove(item)}
                  >
                    Remover
                  </Button>
                </div>
                <Input
                  aria-label={`Observação do problema ${index + 1}`}
                  value={item.notes}
                  maxLength={CLINICAL_LIST_LIMITS.problems.notes}
                  disabled={disabled}
                  placeholder="Observação (opcional)"
                  onChange={(e) => setItem(item.id, { notes: e.target.value })}
                />
                {confirming && (
                  <p className="encounter-clinical__confirm" role="status">
                    <span>Remover “{label}”?</span>
                    <Button type="button" size="sm" variant="secondary" disabled={disabled}
                      onClick={() => removeItem(item.id)}>
                      Confirmar remoção
                    </Button>
                    <Button type="button" size="sm" variant="ghost" disabled={disabled}
                      onClick={() => setConfirmingId('')}>
                      Cancelar
                    </Button>
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={addItem}
          disabled={disabled || items.length >= CLINICAL_LIST_LIMITS.problems.maxItems}
        >
          Adicionar problema
        </Button>
        {items.length >= CLINICAL_LIST_LIMITS.problems.maxItems && (
          <p className="encounter-section__hint" role="status">
            Limite técnico de {CLINICAL_LIST_LIMITS.problems.maxItems} itens por atendimento.
          </p>
        )}
      </div>
    </section>
  );
}
