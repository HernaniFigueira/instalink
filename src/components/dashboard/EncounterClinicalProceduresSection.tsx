'use client';
// ═══════════════════════════════════════════════════════════════
// F1B2 · SEÇÃO "PROCEDIMENTOS" — O QUE FOI REALIZADO NESTE ENCONTRO
// ═══════════════════════════════════════════════════════════════
// PROCEDIMENTO REALIZADO ≠ SERVICE DO AGENDAMENTO. O agendamento diz o que foi
// marcado ("Consulta dermatológica"); esta seção registra o que foi FEITO
// clinicamente ("limpeza auricular", "coleta citológica", "curativo simples").
//
// Regras desta tela:
//   • NENHUM vínculo obrigatório com catálogo: procedimento custom é o caso
//     normal (o atendimento real não espera cadastro). As sugestões são só
//     autocomplete opcional — o texto digitado sempre vale;
//   • NENHUM efeito financeiro/operacional: não lança cobrança, não cria conta
//     a receber, não baixa estoque, não calcula comissão, não gera pedido e não
//     altera o agendamento. É registro clínico do fato;
//   • identidade estável por item (`id`), nunca índice de array;
//   • persistência pela AUTORIDADE do workspace (uma versão por Encounter).
import { useMemo, useState } from 'react';
import { Button, ClinicalRecordSection, Input, ReadOnlyField } from '@/components/ui';
import type { EncounterAuthority, EncounterAuthorityRow } from './useEncounterAuthority';
import { useClinicalSection } from './useClinicalSection';
import {
  CLINICAL_LIST_LIMITS, newClinicalItemId, normalizeEncounterClinical,
  type ClinicalProcedureItem,
} from '@/lib/encounter-clinical';
// Sugestões de catálogo (APENAS autocomplete): não é vínculo, não é preço.
import { VET_CATALOG } from '@/lib/vet-service-catalog';

interface Props {
  businessId: string;
  row: EncounterAuthorityRow;
  authority: EncounterAuthority;
  adoptToken: number;
  blocked: boolean;
  editable: boolean;
  readOnlyHint: string;
}

interface ProceduresForm {
  items: ClinicalProcedureItem[];
}

const SUGGESTIONS = VET_CATALOG
  .filter((item) => item.grupo === 'Procedimentos' || item.grupo === 'Exames')
  .slice(0, 24);

const rowForm = (row: EncounterAuthorityRow): ProceduresForm => ({
  items: normalizeEncounterClinical(row.clinical).procedures.map((item) => ({ ...item })),
});

/** Linha ainda sem nome não é mudança real (não grava item vazio). */
const persistable = (items: ClinicalProcedureItem[]): ClinicalProcedureItem[] => items
  .filter((item) => item.name.trim() !== '')
  .map((item) => ({ id: item.id, name: item.name.trim(), notes: item.notes.trim() }));

const keyOf = (form: ProceduresForm): string => JSON.stringify(
  persistable(form.items).map((item) => [item.id, item.name, item.notes]),
);

export function EncounterClinicalProceduresSection({
  businessId, row, authority, adoptToken, blocked, editable, readOnlyHint,
}: Props) {
  const [confirmingId, setConfirmingId] = useState('');
  const patchOf = useMemo(() => (form: ProceduresForm) => ({
    clinical: { procedures: persistable(form.items) },
  }), []);
  const { form, update } = useClinicalSection<ProceduresForm>({
    id: 'procedimentos', businessId, authority, row, adoptToken, blocked, editable,
    formOf: rowForm, keyOf, patchOf,
  });

  const disabled = !editable;
  const items = form.items;

  const setItem = (id: string, patch: Partial<ClinicalProcedureItem>) => {
    update({ items: items.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
  };
  const addItem = () => {
    if (items.length >= CLINICAL_LIST_LIMITS.procedures.maxItems) return;
    update({ items: [...items, { id: newClinicalItemId('proc'), name: '', notes: '' }] });
  };
  const removeItem = (id: string) => {
    update({ items: items.filter((item) => item.id !== id) });
    setConfirmingId('');
  };
  const requestRemove = (item: ClinicalProcedureItem) => {
    if (!item.name.trim() && !item.notes.trim()) { removeItem(item.id); return; }
    setConfirmingId((current) => (current === item.id ? '' : item.id));
  };

  // §11 — LEITURA = documento: procedimento e observação em linhas de leitura.
  if (disabled) {
    return (
      <section className="encounter-workspace__section" aria-label="Procedimentos realizados" data-section="procedimentos" data-readonly="true">
        <div className="encounter-workspace__content">
          <ClinicalRecordSection title="Procedimentos realizados">
            {items.length === 0
              ? <ReadOnlyField label="Procedimentos deste atendimento" value="" empty="Nenhum procedimento registrado neste atendimento." block />
              : items.map((item, index) => (
                <ReadOnlyField key={item.id} label={`Procedimento ${index + 1}`} value={item.name}
                  hint={item.notes || undefined} block />
              ))}
          </ClinicalRecordSection>
          <p className="encounter-core__readonly" role="status">{readOnlyHint}</p>
        </div>
      </section>
    );
  }

  const addButton = (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      onClick={addItem}
      disabled={disabled || items.length >= CLINICAL_LIST_LIMITS.procedures.maxItems}
    >
      Adicionar procedimento
    </Button>
  );

  return (
    <section className="encounter-workspace__section" aria-label="Procedimentos realizados" data-section="procedimentos">
      <div className="encounter-workspace__content">
        <p className="encounter-section__hint">
          O que foi realizado clinicamente neste atendimento. Não é o serviço do agendamento e
          não gera cobrança, pedido, estoque nem comissão — é o registro clínico do fato.
        </p>
        {disabled && <p className="encounter-core__readonly" role="status">{readOnlyHint}</p>}

        {/* Autocomplete opcional: sugestão nunca vira vínculo nem valor. */}
        <datalist id="procedure-suggestions">
          {SUGGESTIONS.map((item) => <option key={item.id} value={item.name} />)}
        </datalist>

        {/* Estado vazio: texto + CTA no MESMO bloco, alinhados à esquerda (sem
            card). Com itens, a lista vem antes e a ação fica logo abaixo dela. */}
        {items.length === 0 ? (
          <div className="encounter-clinical__empty" data-testid="procedures-empty-state">
            <p className="encounter-section__hint" data-testid="procedures-empty">
              Nenhum procedimento registrado neste atendimento.
            </p>
            {addButton}
          </div>
        ) : (<>
        <ul className="encounter-clinical__list" data-testid="procedures-list">
          {items.map((item, index) => {
            const confirming = confirmingId === item.id;
            const label = item.name.trim() || 'procedimento sem nome';
            return (
              <li key={item.id} className="encounter-clinical__list-item" data-procedure-id={item.id}>
                <div className="encounter-clinical__row">
                  <Input
                    aria-label={`Nome do procedimento ${index + 1}`}
                    value={item.name}
                    maxLength={CLINICAL_LIST_LIMITS.procedures.name}
                    disabled={disabled}
                    list="procedure-suggestions"
                    placeholder="Ex: limpeza auricular / curativo simples"
                    onChange={(e) => setItem(item.id, { name: e.target.value })}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-label={`Remover procedimento: ${label}`}
                    disabled={disabled}
                    onClick={() => requestRemove(item)}
                  >
                    Remover
                  </Button>
                </div>
                <Input
                  aria-label={`Observação do procedimento ${index + 1}`}
                  value={item.notes}
                  maxLength={CLINICAL_LIST_LIMITS.procedures.notes}
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

        <div className="encounter-clinical__actions">
          {addButton}
          {items.length >= CLINICAL_LIST_LIMITS.procedures.maxItems && (
            <p className="encounter-section__hint" role="status">
              Limite técnico de {CLINICAL_LIST_LIMITS.procedures.maxItems} itens por atendimento.
            </p>
          )}
        </div>
        </>)}
      </div>
    </section>
  );
}
