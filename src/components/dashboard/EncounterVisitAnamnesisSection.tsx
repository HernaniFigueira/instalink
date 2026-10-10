'use client';
// ═══════════════════════════════════════════════════════════════
// F1B1 · SEÇÃO "ANAMNESE" — ANAMNESE DA VISITA
// ═══════════════════════════════════════════════════════════════
// Isto NÃO é o cadastro permanente do Pet e NÃO é o motor de fichas legado
// (`AnamneseTemplate`/`AnamneseResponse`, que continua intacto na rota de
// registro e em Estrutura → Fichas). É o dado RELATADO NESTA VISITA, morando
// no PRÓPRIO Encounter:
//
//   Encounter.clinical.anamnesis = { história, alimentação, apetite, água,
//   urina, fezes, vômito, diarreia, medicações relatadas, alergias relatadas,
//   observações }
//
// Regras desta tela:
//   • "alergia/medicação" aqui significam "o que foi RELATADO nesta visita" —
//     nada é copiado para o cadastro permanente do Pet, nem no sentido inverso;
//   • apetite/água/urina/fezes usam Normal · Alterado · Não informado; vômito e
//     diarreia usam Sim · Não · Não informado. Nenhuma inferência clínica,
//     nenhum alerta automático, nenhum diagnóstico;
//   • a persistência é a do domínio (PATCH /api/encounters) com a versão vinda
//     da AUTORIDADE do workspace — uma versão só para o Encounter inteiro.
import { useMemo } from 'react';
import { ClinicalRecordSection, Field, ReadOnlyField, Select, Textarea } from '@/components/ui';
import type { EncounterAuthority, EncounterAuthorityRow } from './useEncounterAuthority';
import { useClinicalSection } from './useClinicalSection';
import {
  normalizeEncounterClinical,
  type EncounterVisitAnamnesis, type VisitChangeStatus, type VisitYesNoStatus,
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

const CHANGE_OPTIONS: Array<{ value: VisitChangeStatus; label: string }> = [
  { value: 'not_reported', label: 'Não informado' },
  { value: 'usual', label: 'Normal' },
  { value: 'changed', label: 'Alterado' },
];

const YES_NO_OPTIONS: Array<{ value: VisitYesNoStatus; label: string }> = [
  { value: 'not_reported', label: 'Não informado' },
  { value: 'yes', label: 'Sim' },
  { value: 'no', label: 'Não' },
];

const TEXT_FIELDS: Array<{
  key: 'history' | 'diet' | 'medicationsReported' | 'allergiesReported' | 'observations';
  label: string;
  hint?: string;
  placeholder: string;
  maxLength: number;
  rows?: number;
}> = [
  {
    key: 'history', label: 'História atual / evolução do problema',
    hint: 'O que o tutor relata sobre o problema de hoje e como ele vem evoluindo.',
    placeholder: 'Ex: coceira nas orelhas há 3 dias, piora à noite',
    maxLength: 4000, rows: 4,
  },
  {
    key: 'diet', label: 'Alimentação', hint: 'Ração, dieta caseira, petiscos, mudanças recentes.',
    placeholder: 'Ex: ração seca habitual; trocou de marca há 1 semana',
    maxLength: 1200, rows: 2,
  },
  {
    key: 'medicationsReported', label: 'Medicações em uso (relatadas nesta visita)',
    hint: 'O que o tutor disse que o animal está tomando. Não altera o cadastro do paciente.',
    placeholder: 'Ex: antipulgas mensal; vermífugo há 15 dias',
    maxLength: 2000, rows: 2,
  },
  {
    key: 'allergiesReported', label: 'Alergias (relatadas nesta visita)',
    hint: 'O que o tutor relatou. Não altera o cadastro do paciente.',
    placeholder: 'Ex: reação a ração de frango segundo o tutor',
    maxLength: 2000, rows: 2,
  },
  {
    key: 'observations', label: 'Observações da anamnese',
    placeholder: 'Outros pontos relatados que importam para este atendimento',
    maxLength: 2000, rows: 2,
  },
];

const STATUS_FIELDS: Array<{ key: 'appetite' | 'waterIntake' | 'urine' | 'stool'; label: string; hint: string }> = [
  { key: 'appetite', label: 'Apetite', hint: 'Comparado ao normal do paciente.' },
  { key: 'waterIntake', label: 'Ingestão de água', hint: 'Comparado ao normal do paciente.' },
  { key: 'urine', label: 'Urina', hint: 'Frequência/aparência relatadas.' },
  { key: 'stool', label: 'Fezes', hint: 'Consistência/frequência relatadas.' },
];

const rowForm = (row: EncounterAuthorityRow): EncounterVisitAnamnesis => normalizeEncounterClinical(row.clinical).anamnesis;

const keyOf = (form: EncounterVisitAnamnesis): string => JSON.stringify([
  form.history, form.diet, form.appetite, form.waterIntake, form.urine, form.stool,
  form.vomiting, form.diarrhea, form.medicationsReported, form.allergiesReported, form.observations,
]);

export function EncounterVisitAnamnesisSection({
  businessId, row, authority, adoptToken, blocked, editable, readOnlyHint,
}: Props) {
  const patchOf = useMemo(() => (form: EncounterVisitAnamnesis) => ({
    // Só a fatia DESTA seção vai no payload: nada de reenviar avaliação.
    clinical: { anamnesis: { ...form } },
  }), []);
  const { form, update } = useClinicalSection<EncounterVisitAnamnesis>({
    id: 'anamnese', businessId, authority, row, adoptToken, blocked, editable,
    formOf: rowForm, keyOf, patchOf,
  });

  const setField = <K extends keyof EncounterVisitAnamnesis>(key: K, value: EncounterVisitAnamnesis[K]) => {
    update({ ...form, [key]: value });
  };
  const disabled = !editable;
  const rotulo = <T extends string>(opcoes: Array<{ value: T; label: string }>, v: T) =>
    opcoes.find((o) => o.value === v)?.label || 'Não informado';

  // §11 — LEITURA = documento: o que foi relatado vira texto, com os mesmos
  // rótulos e a mesma fonte de dado. Nenhum campo desabilitado.
  if (!editable) {
    return (
      <section className="encounter-workspace__section" aria-label="Anamnese da visita" data-section="anamnese" data-readonly="true">
        <div className="encounter-workspace__content">
          <ClinicalRecordSection title="Anamnese da visita">
            {TEXT_FIELDS.map((f) => (
              <ReadOnlyField key={f.key} label={f.label} value={form[f.key]} multiline block />
            ))}
            {STATUS_FIELDS.map((f) => (
              <ReadOnlyField key={f.key} label={f.label} value={rotulo(CHANGE_OPTIONS, form[f.key])} />
            ))}
            <ReadOnlyField label="Vômito" value={rotulo(YES_NO_OPTIONS, form.vomiting)} />
            <ReadOnlyField label="Diarreia" value={rotulo(YES_NO_OPTIONS, form.diarrhea)} />
          </ClinicalRecordSection>
          <p className="encounter-core__readonly" role="status">{readOnlyHint}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="encounter-workspace__section" aria-label="Anamnese da visita" data-section="anamnese">
      <div className="encounter-workspace__content">
        <p className="encounter-section__hint">
          O que foi relatado nesta visita. Não altera o cadastro permanente do paciente — e nada do
          cadastro permanente é copiado para cá automaticamente.
        </p>
        {disabled && <p className="encounter-core__readonly" role="status">{readOnlyHint}</p>}

        <Field
          label="História atual / evolução do problema"
          hint={TEXT_FIELDS[0].hint}
          htmlFor="an-history"
        >
          <Textarea id="an-history" rows={4} maxLength={TEXT_FIELDS[0].maxLength} disabled={disabled}
            value={form.history} placeholder={TEXT_FIELDS[0].placeholder}
            onChange={(e) => setField('history', e.target.value)} />
        </Field>

        <div className="encounter-clinical__grid">
          <Field label="Alimentação" hint={TEXT_FIELDS[1].hint} htmlFor="an-diet">
            <Textarea id="an-diet" rows={2} maxLength={TEXT_FIELDS[1].maxLength} disabled={disabled}
              value={form.diet} placeholder={TEXT_FIELDS[1].placeholder}
              onChange={(e) => setField('diet', e.target.value)} />
          </Field>

          {STATUS_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint} htmlFor={`an-${f.key}`}>
              <Select id={`an-${f.key}`} disabled={disabled}
                value={form[f.key]} onChange={(e) => setField(f.key, e.target.value as VisitChangeStatus)}>
                {CHANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </Field>
          ))}

          <Field label="Vômito" hint="Relatado nesta visita." htmlFor="an-vomiting">
            <Select id="an-vomiting" disabled={disabled}
              value={form.vomiting} onChange={(e) => setField('vomiting', e.target.value as VisitYesNoStatus)}>
              {YES_NO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label="Diarreia" hint="Relatado nesta visita." htmlFor="an-diarrhea">
            <Select id="an-diarrhea" disabled={disabled}
              value={form.diarrhea} onChange={(e) => setField('diarrhea', e.target.value as VisitYesNoStatus)}>
              {YES_NO_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>

          <Field label="Medicações em uso (relatadas nesta visita)" hint={TEXT_FIELDS[2].hint} htmlFor="an-medications">
            <Textarea id="an-medications" rows={2} maxLength={TEXT_FIELDS[2].maxLength} disabled={disabled}
              value={form.medicationsReported} placeholder={TEXT_FIELDS[2].placeholder}
              onChange={(e) => setField('medicationsReported', e.target.value)} />
          </Field>
          <Field label="Alergias (relatadas nesta visita)" hint={TEXT_FIELDS[3].hint} htmlFor="an-allergies">
            <Textarea id="an-allergies" rows={2} maxLength={TEXT_FIELDS[3].maxLength} disabled={disabled}
              value={form.allergiesReported} placeholder={TEXT_FIELDS[3].placeholder}
              onChange={(e) => setField('allergiesReported', e.target.value)} />
          </Field>
        </div>

        <Field label="Observações da anamnese" htmlFor="an-observations">
          <Textarea id="an-observations" rows={2} maxLength={TEXT_FIELDS[4].maxLength} disabled={disabled}
            value={form.observations} placeholder={TEXT_FIELDS[4].placeholder}
            onChange={(e) => setField('observations', e.target.value)} />
        </Field>

        <p className="encounter-section__hint">
          Campos sem informação ficam como “Não informado” — o sistema não inventa resposta e não
          interpreta o que foi relatado.
        </p>
      </div>
    </section>
  );
}
