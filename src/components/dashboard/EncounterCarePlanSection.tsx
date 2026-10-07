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
import { ClinicalRecordSection, ReadOnlyField, Textarea } from '@/components/ui';
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
}

const rowForm = (row: EncounterAuthorityRow): ClinicalCarePlan => ({
  conduct: normalizeEncounterClinical(row.clinical).plan.conduct,
});

const keyOf = (form: ClinicalCarePlan): string => JSON.stringify([form.conduct]);

export function EncounterCarePlanSection({
  businessId, row, authority, adoptToken, blocked, editable, readOnlyHint,
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
  const followUpText = row.followUp
    || (row.followUpMode === 'interval' && Number(row.followUpDays) > 0 ? `Em ${row.followUpDays} dias` : '')
    || (row.followUpMode === 'date' && row.followUpDate ? `Em ${row.followUpDate}` : '');

  // §11 — LEITURA = documento: a conduta é o texto que o profissional escreveu;
  // o contexto complementar continua em bloco, agora com valores de leitura.
  if (disabled) {
    return (
      <section className="encounter-workspace__section" aria-label="Conduta" data-section="conduta" data-readonly="true">
        <div className="encounter-workspace__content">
          <ClinicalRecordSection title="Conduta">
            <ReadOnlyField label="Plano / conduta clínica" value={form.conduct} multiline block
              empty="Sem conduta registrada neste atendimento." />
            <ReadOnlyField label="Orientações ao tutor" value={guidance} />
            <ReadOnlyField label="Retorno" value={followUpText} />
          </ClinicalRecordSection>
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

        <div className="encounter-clinical__context" data-testid="plan-context">
          <p className="il-type-label text-xs font-semibold text-[var(--text-muted)]">
            Complementos do plano (editados na seção Atendimento — mesma fonte de dados)
          </p>
          <dl className="encounter-clinical__context-list">
            <div>
              <dt>Orientações ao tutor</dt>
              <dd>{guidance || '—'}</dd>
            </div>
            <div>
              <dt>Retorno</dt>
              <dd>{followUpText || '—'}</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  );
}
