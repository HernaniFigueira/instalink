'use client';
// ═══════════════════════════════════════════════════════════════
// ENTREGA 2 · REGISTRO COMPLETO = DOCUMENTO DA SESSÃO
// ═══════════════════════════════════════════════════════════════
// O Registro completo é a CONTINUAÇÃO do Atendimento: o mesmo Encounter lido
// como documento, com as MESMAS seções e rótulos do workspace (Atendimento ·
// Anamnese · Avaliação · Problemas · Conduta · Procedimentos). Nada aqui é
// editor: escrever acontece no Atendimento (fonte única). Seção vazia vira uma
// linha discreta, não um formulário em branco.
import { ReadOnlyField } from '@/components/ui';
import { availableEncounterSections } from '@/lib/encounter-sections';
import {
  CLINICAL_PROBLEM_KIND_LABELS, normalizeEncounterClinical,
} from '@/lib/encounter-clinical';
import { ENCOUNTER_LABELS } from '@/lib/encounters';
import type { Encounter } from '@/lib/types';
import {
  ANAMNESIS_CHANGE_OPTIONS, ANAMNESIS_STATUS_FIELDS, ANAMNESIS_TEXT_FIELDS, ANAMNESIS_YES_NO_OPTIONS,
} from './EncounterVisitAnamnesisSection';
import { ASSESSMENT_NUMBER_FIELDS, ASSESSMENT_TEXT_FIELDS } from './EncounterVeterinaryAssessmentSection';
import { followUpPlanLabel } from './EncounterFollowUpPlanner';

type DocRow = Encounter & { clinicType?: unknown };

function DocSection({ id, group, title, children, empty }: {
  id: string; group?: string; title: string; children?: React.ReactNode; empty?: string;
}) {
  return (
    <section className="encounter-doc__section" aria-labelledby={`doc-${id}`} data-doc-section={id}>
      <header className="encounter-doc__head">
        {group && <p className="encounter-doc__group">{group}</p>}
        <h3 id={`doc-${id}`} className="encounter-doc__title">{title}</h3>
      </header>
      {empty ? <p className="encounter-doc__empty">{empty}</p> : <div className="encounter-doc__grid">{children}</div>}
    </section>
  );
}

const optionLabel = <T extends string>(options: Array<{ value: T; label: string }>, value: T) =>
  options.find((o) => o.value === value)?.label || 'Não informado';

export function EncounterClinicalDocument({ row }: { row: DocRow }) {
  const sections = new Set(availableEncounterSections(row.clinicType).map((s) => s.id));
  const clinical = normalizeEncounterClinical(row.clinical);
  const a = clinical.anamnesis;
  const v = clinical.assessment.veterinary;
  const anamnesisFilled = ANAMNESIS_TEXT_FIELDS.some((f) => String(a[f.key] || '').trim())
    || ANAMNESIS_STATUS_FIELDS.some((f) => a[f.key] !== 'not_reported')
    || a.vomiting !== 'not_reported' || a.diarrhea !== 'not_reported';
  const assessmentFilled = ASSESSMENT_NUMBER_FIELDS.some((f) => v[f.key] !== null && v[f.key] !== undefined)
    || ASSESSMENT_TEXT_FIELDS.some((f) => String(v[f.key] || '').trim()) || Boolean(v.physicalExam?.trim());
  const plan = followUpPlanLabel(row);

  return (
    <div className="encounter-doc" data-testid="encounter-clinical-document">
      <DocSection id="atendimento" group="Atendimento" title="Atendimento">
        <ReadOnlyField label={ENCOUNTER_LABELS.complaint} value={row.complaint} multiline block />
        <ReadOnlyField label={ENCOUNTER_LABELS.evolution} value={row.evolution} multiline block />
        <ReadOnlyField label={ENCOUNTER_LABELS.guidance} value={row.guidance} multiline block
          hint="Sai na via impressa que o tutor leva." />
        <ReadOnlyField label="Retorno" value={plan} empty="Sem retorno definido" />
        <ReadOnlyField label="Orientação de retorno" value={row.followUp} />
        <ReadOnlyField label="Etiquetas" value={(row.tags || []).join(', ')} />
      </DocSection>

      {sections.has('anamnese') && (
        <DocSection id="anamnese" title="Anamnese da visita" empty={anamnesisFilled ? undefined : 'Nada relatado nesta visita.'}>
          {ANAMNESIS_TEXT_FIELDS.map((f) => (
            <ReadOnlyField key={f.key} label={f.label} value={a[f.key]} multiline block />
          ))}
          {ANAMNESIS_STATUS_FIELDS.map((f) => (
            <ReadOnlyField key={f.key} label={f.label} value={optionLabel(ANAMNESIS_CHANGE_OPTIONS, a[f.key])} />
          ))}
          <ReadOnlyField label="Vômito" value={optionLabel(ANAMNESIS_YES_NO_OPTIONS, a.vomiting)} />
          <ReadOnlyField label="Diarreia" value={optionLabel(ANAMNESIS_YES_NO_OPTIONS, a.diarrhea)} />
        </DocSection>
      )}

      {sections.has('avaliacao') && (
        <DocSection id="avaliacao" title="Avaliação clínica" empty={assessmentFilled ? undefined : 'Sem avaliação registrada.'}>
          {ASSESSMENT_NUMBER_FIELDS.map((f) => (
            <ReadOnlyField key={f.key} label={`${f.label} (${f.unit})`} value={v[f.key] === null || v[f.key] === undefined ? '' : String(v[f.key]).replace('.', ',')} />
          ))}
          {ASSESSMENT_TEXT_FIELDS.map((f) => (
            <ReadOnlyField key={f.key} label={f.label} value={v[f.key]} />
          ))}
          <ReadOnlyField label="Exame físico / achados gerais" value={v.physicalExam} multiline block />
        </DocSection>
      )}

      {sections.has('problemas') && (
        <DocSection id="problemas" group="Plano clínico" title="Problemas e diagnósticos"
          empty={clinical.problems.length ? undefined : 'Nenhum problema registrado.'}>
          {clinical.problems.map((p) => (
            <ReadOnlyField key={p.id} label={CLINICAL_PROBLEM_KIND_LABELS[p.kind]} value={p.notes ? `${p.label} — ${p.notes}` : p.label} block />
          ))}
        </DocSection>
      )}

      {sections.has('conduta') && (
        <DocSection id="conduta" title="Conduta" empty={clinical.plan.conduct.trim() ? undefined : 'Sem conduta registrada.'}>
          <ReadOnlyField label="Plano / conduta clínica" value={clinical.plan.conduct} multiline block />
        </DocSection>
      )}

      {sections.has('procedimentos') && (
        <DocSection id="procedimentos" title="Procedimentos realizados"
          empty={clinical.procedures.length ? undefined : 'Nenhum procedimento registrado.'}>
          {clinical.procedures.map((p) => (
            <ReadOnlyField key={p.id} label={p.name} value={p.notes} empty="Sem observação" block />
          ))}
        </DocSection>
      )}
    </div>
  );
}
