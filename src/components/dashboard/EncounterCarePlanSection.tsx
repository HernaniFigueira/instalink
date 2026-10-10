'use client';
// ═══════════════════════════════════════════════════════════════
// F1B2 · SEÇÃO "CONDUTA" — O QUE FOI DECIDIDO FAZER
// ═══════════════════════════════════════════════════════════════
// Conduta NÃO é evolução:
//   • Evolução clínica (`evolution`, seção Atendimento) = o que ACONTECEU /
//     foi observado / foi realizado neste atendimento;
//   • Conduta (`clinical.plan.conduct`) = o que o profissional DECIDIU fazer
//     a partir da avaliação.
// Os dois têm storage próprio e copy própria — nenhum é copiado para o outro.
//
// SEM DUPLICAÇÃO (§ não duplicar campos): "Orientações ao tutor" (`guidance`)
// e "Retorno" (`followUp`/retorno estruturado) continuam com UMA fonte só, na
// seção Atendimento. Aqui eles aparecem apenas como CONTEXTO EM LEITURA, para
// o profissional ver o plano completo sem existir um segundo lugar de edição.
import { useMemo } from 'react';
import { Button, ClinicalRecordSection, ReadOnlyField, Textarea } from '@/components/ui';
import { followUpSummary } from './EncounterFollowUpPlanner';
import type { EncounterAuthority, EncounterAuthorityRow } from './useEncounterAuthority';
import { useClinicalSection } from './useClinicalSection';
import { CLINICAL_PLAN_LIMITS, normalizeEncounterClinical, type ClinicalCarePlan } from '@/lib/encounter-clinical';

interface Props {
  businessId: string;
  row: EncounterAuthorityRow;
  authority: EncounterAuthority;
  adoptToken: number;
  blocked: boolean;
  editable: boolean;
  readOnlyHint: string;
  /** Leva à seção Atendimento, onde orientações e retorno são EDITADOS. */
  onEditInAtendimento?: () => void;
}

const rowForm = (row: EncounterAuthorityRow): ClinicalCarePlan => ({
  conduct: normalizeEncounterClinical(row.clinical).plan.conduct,
});

const keyOf = (form: ClinicalCarePlan): string => JSON.stringify([form.conduct]);

export function EncounterCarePlanSection({
  businessId, row, authority, adoptToken, blocked, editable, readOnlyHint, onEditInAtendimento,
}: Props) {
  const patchOf = useMemo(() => (form: ClinicalCarePlan) => ({
    // Só a fatia DESTA seção vai no payload.
    clinical: { plan: { conduct: form.conduct } },
  }), []);
  const { form, update } = useClinicalSection<ClinicalCarePlan>({
    id: 'conduta', businessId, authority, row, adoptToken, blocked, editable,
    formOf: rowForm, keyOf, patchOf,
  });

  const disabled = !editable;
  // Contexto em LEITURA (fonte única continua na seção Atendimento).
  const guidance = row.guidance || '';
  const followUpText = followUpSummary(row);

  // §11 — LEITURA = documento: a conduta é o texto que o profissional escreveu;
  // o contexto complementar continua em bloco, agora com valores de leitura.
  if (disabled) {
    return (
      <section className="encounter-workspace__section" aria-label="Conduta" data-section="conduta" data-readonly="true">
        <div className="encounter-workspace__content">
          <ClinicalRecordSection title="Decisão clínica">
            <ReadOnlyField label="Plano / conduta clínica" value={form.conduct} multiline block
              empty="Sem conduta registrada neste atendimento." />
          </ClinicalRecordSection>
          <PlanSummary guidance={guidance} followUp={followUpText} />
          <p className="encounter-core__readonly" role="status">{readOnlyHint}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="encounter-workspace__section" aria-label="Conduta" data-section="conduta">
      <div className="encounter-workspace__content">
        <p className="encounter-section__hint">
          O que será feito a partir desta avaliação. Não é a evolução do atendimento (o que
          aconteceu fica na seção Atendimento) — aqui entra a decisão clínica.
        </p>
        {disabled && <p className="encounter-core__readonly" role="status">{readOnlyHint}</p>}

        <label className="il-type-body block" htmlFor="plan-conduct">
          <span className="il-type-label block text-xs font-semibold text-[var(--text-muted)] mb-1.5">
            Plano / conduta clínica
          </span>
          <Textarea
            id="plan-conduct"
            rows={5}
            maxLength={CLINICAL_PLAN_LIMITS.conduct}
            disabled={disabled}
            value={form.conduct}
            placeholder="Ex: tratamento tópico por 14 dias; solicitar hemograma; reavaliar em 15 dias"
            onChange={(e) => update({ conduct: e.target.value })}
          />
          <span className="il-type-help block text-xs text-[var(--text-muted)] mt-1">
            Pedidos de exame e prescrição estruturada ainda não existem no sistema (módulo
            próprio, fase posterior): aqui vale o texto da decisão.
          </span>
        </label>

        <PlanSummary guidance={guidance} followUp={followUpText} onEdit={onEditInAtendimento} />
      </div>
    </section>
  );
}

/**
 * RESUMO em leitura do que o tutor leva (orientações + retorno). Fonte única:
 * seção Atendimento — aqui é só contexto do plano, rotulado como resumo e com
 * o caminho explícito para editar no lugar canônico. Nunca um segundo editor.
 */
function PlanSummary({ guidance, followUp, onEdit }: { guidance: string; followUp: string; onEdit?: () => void }) {
  return (
    <div className="encounter-plan-summary" data-testid="plan-context">
      <div className="encounter-plan-summary__head">
        <p className="encounter-plan-summary__title">Resumo · editado em Atendimento</p>
        {onEdit && <Button type="button" variant="ghost" size="xs" onClick={onEdit}>Editar em Atendimento</Button>}
      </div>
      <dl className="encounter-plan-summary__list">
        <div>
          <dt>Orientações ao tutor</dt>
          <dd>{guidance || 'Não informado'}</dd>
        </div>
        <div>
          <dt>Retorno</dt>
          <dd>{followUp || 'Sem retorno definido'}</dd>
        </div>
      </dl>
    </div>
  );
}
