'use client';
// ═══════════════════════════════════════════════════════════════
// F1B1 · SEÇÃO "AVALIAÇÃO" — EXAME CLÍNICO VETERINÁRIO (PACOTE VET)
// ═══════════════════════════════════════════════════════════════
// O que o profissional MEDIU/EXAMINOU hoje, no Encounter:
//
//   Encounter.clinical.assessment.veterinary =
//     { peso (kg), temperatura (°C), FC (bpm), FR (rpm), hidratação, mucosas,
//       TPC (s), condição corporal, exame físico }
//
// Regras (invariantes desta entrega):
//   • NADA de interpretação automática: não existe "temperatura alta",
//     "taquicardia" nem "obesidade" calculados aqui. O GoDoutor REGISTRA o
//     dado; a interpretação é do profissional;
//   • o peso de hoje NÃO sobrescreve `Pet.weightKg` (cadastro permanente);
//     ele vive neste atendimento;
//   • unidades são estrutura, não enfeite: os campos numéricos são NÚMEROS
//     com unidade no rótulo (kg · °C · bpm · rpm · s) — nunca "8 kg" como texto;
//   • vazio é permitido: campo em branco não vira 0 nem inventa leitura;
//   • o servidor valida número finito e limite técnico (contra lixo/overflow).
import { useMemo } from 'react';
import { Field, Input, Textarea } from '@/components/ui';
import type { EncounterAuthority, EncounterAuthorityRow } from './useEncounterAuthority';
import { useClinicalSection } from './useClinicalSection';
import {
  normalizeEncounterClinical,
  type VeterinaryAssessment,
} from '@/lib/encounter-clinical';

interface Props {
  businessId: string;
  row: EncounterAuthorityRow;
  authority: EncounterAuthority;
  adoptToken: number;
  blocked: boolean;
  editable: boolean;
  readOnlyHint: string;
  /** Peso do cadastro permanente — CONTEXTO; nunca a fonte do peso de hoje. */
  petWeightKg?: number;
}

type NumberKey = 'weightKg' | 'temperatureC' | 'heartRateBpm' | 'respiratoryRateRpm' | 'capillaryRefillSeconds';
type TextKey = 'hydration' | 'mucousMembranes' | 'bodyCondition' | 'physicalExam';

/** Rascunho da tela: números como TEXTO digitado (vírgula ou ponto) para o
 *  teclado brasileiro funcionar — o payload continua NÚMERO (ou null). */
type AssessmentForm = Record<NumberKey | TextKey, string>;

const NUMBER_FIELDS: Array<{
  key: NumberKey;
  label: string;
  unit: string;
  step: string;
  hint?: string;
  min: number;
  max: number;
}> = [
  {
    key: 'weightKg', label: 'Peso', unit: 'kg', step: '0.01',
    hint: 'Medido neste atendimento. Não altera o peso do cadastro do paciente.',
    min: 0, max: 100000,
  },
  { key: 'temperatureC', label: 'Temperatura', unit: '°C', step: '0.1', min: -273.15, max: 1000 },
  { key: 'heartRateBpm', label: 'Frequência cardíaca', unit: 'bpm', step: '1', min: 0, max: 1000000 },
  { key: 'respiratoryRateRpm', label: 'Frequência respiratória', unit: 'rpm', step: '1', min: 0, max: 1000000 },
  {
    key: 'capillaryRefillSeconds', label: 'Tempo de preenchimento capilar', unit: 's', step: '0.1',
    hint: 'Tempo de preenchimento capilar observado.', min: 0, max: 1000000,
  },
];

const TEXT_FIELDS: Array<{
  key: 'hydration' | 'mucousMembranes' | 'bodyCondition';
  label: string;
  hint: string;
  placeholder: string;
}> = [
  {
    key: 'hydration', label: 'Hidratação',
    hint: 'Descreva o que você observou (ex.: normohidratado, leve desidratação).',
    placeholder: 'Ex: normohidratado',
  },
  {
    key: 'mucousMembranes', label: 'Mucosas',
    hint: 'Cor e aspecto observados.',
    placeholder: 'Ex: róseas e úmidas',
  },
  {
    key: 'bodyCondition', label: 'Condição corporal',
    hint: 'Sua avaliação (ex.: escore 5/9). O sistema não classifica por você.',
    placeholder: 'Ex: escore corporal 5/9',
  },
];

const NUMBER_KEYS: NumberKey[] = ['weightKg', 'temperatureC', 'heartRateBpm', 'respiratoryRateRpm', 'capillaryRefillSeconds'];
const TEXT_KEYS: TextKey[] = ['hydration', 'mucousMembranes', 'bodyCondition', 'physicalExam'];

const rowForm = (row: EncounterAuthorityRow): AssessmentForm => {
  const vet: VeterinaryAssessment = normalizeEncounterClinical(row.clinical).assessment.veterinary;
  const out = {} as AssessmentForm;
  for (const key of NUMBER_KEYS) {
    const value = vet[key];
    out[key] = value === null || value === undefined ? '' : String(value);
  }
  for (const key of TEXT_KEYS) out[key] = String(vet[key] || '');
  return out;
};

const ALL_KEYS: Array<NumberKey | TextKey> = [...NUMBER_KEYS, ...TEXT_KEYS];
const NUMBER_KEY_SET = new Set<string>(NUMBER_KEYS);

/** Texto digitado → número. `NaN` = inválido (a seção não grava e diz por quê). */
function parseNumberInput(raw: string): number | null {
  const text = String(raw || '').trim().replace(',', '.');
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : Number.NaN;
}

/**
 * Chave canônica do rascunho numérico: "9,1" e "9.1" são a MESMA mudança.
 * Sem isto, o valor que VOLTA do servidor (9.1) pareceria uma alteração nova
 * depois de gravar "9,1" — um segundo PATCH do mesmo número e um piscar de
 * "Salvando…" que não representa nada. Texto inválido continua sendo mudança
 * distinta: o erro fica visível e nada é gravado.
 */
function canonicalNumber(raw: string): string {
  const parsed = parseNumberInput(raw);
  if (Number.isNaN(parsed)) return `!${String(raw)}`;
  return parsed === null ? '' : String(parsed);
}

const keyOf = (form: AssessmentForm): string => JSON.stringify(
  ALL_KEYS.map((key) => (NUMBER_KEY_SET.has(key) ? canonicalNumber(form[key]) : form[key])),
);

/** Campos numéricos com texto que não é número (ex.: "8,5x"). */
function invalidFields(form: AssessmentForm): NumberKey[] {
  return NUMBER_KEYS.filter((key) => {
    const text = String(form[key] || '').trim();
    if (!text) return false;
    return Number.isNaN(parseNumberInput(text));
  });
}

function payloadOf(form: AssessmentForm): VeterinaryAssessment {
  const out = {} as VeterinaryAssessment;
  for (const key of NUMBER_KEYS) {
    const parsed = parseNumberInput(form[key]);
    out[key] = parsed === null || Number.isNaN(parsed) ? null : parsed;
  }
  for (const key of TEXT_KEYS) out[key] = String(form[key] || '');
  return out;
}

export function EncounterVeterinaryAssessmentSection({
  businessId, row, authority, adoptToken, blocked, editable, readOnlyHint, petWeightKg,
}: Props) {
  const patchOf = useMemo(() => (form: AssessmentForm) => ({
    // Só a fatia DESTA seção (o pacote veterinário) — anamnese intacta.
    // Os números saem daqui já como NÚMERO (nunca "8 kg" como texto).
    clinical: { assessment: { veterinary: payloadOf(form) } },
  }), []);
  // Validação LOCAL: enquanto houver texto não numérico, a seção NÃO grava —
  // o valor precisa ser corrigido antes (nada de perder o que foi digitado).
  const validate = (value: AssessmentForm): string => {
    const invalids = invalidFields(value);
    if (!invalids.length) return '';
    const labels = invalids.map((key) => NUMBER_FIELDS.find((f) => f.key === key)?.label || key);
    return `Revise os campos numéricos: ${labels.join(', ')} precisa(m) de um número válido.`;
  };
  const { form, update } = useClinicalSection<AssessmentForm>({
    id: 'avaliacao', businessId, authority, row, adoptToken, blocked, editable,
    formOf: rowForm, keyOf, patchOf, validate,
  });
  const invalids = invalidFields(form);

  const setValue = (key: keyof AssessmentForm, value: string) => {
    update({ ...form, [key]: value });
  };
  const disabled = !editable;

  return (
    <section className="encounter-workspace__section" aria-label="Avaliação clínica veterinária" data-section="avaliacao">
      <div className="encounter-workspace__content">
        <p className="encounter-section__hint">
          Exame de hoje: o GoDoutor registra o dado e o profissional interpreta. Não há faixa de
          normalidade, alerta automático nem diagnóstico nesta tela.
        </p>
        {disabled && <p className="encounter-core__readonly" role="status">{readOnlyHint}</p>}

        <div className="encounter-clinical__grid">
          {NUMBER_FIELDS.map((f) => (
            <Field
              key={f.key}
              label={`${f.label} (${f.unit})`}
              hint={f.hint}
              htmlFor={`av-${f.key}`}
              error={invalids.includes(f.key) ? 'Informe um número válido.' : undefined}
            >
              <Input
                id={`av-${f.key}`}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={invalids.includes(f.key) || undefined}
                disabled={disabled}
                value={form[f.key]}
                placeholder={f.key === 'weightKg' ? 'Ex: 8,4' : 'Ex: 38,5'}
                onChange={(e) => setValue(f.key, e.target.value)}
              />
            </Field>
          ))}
        </div>

        {petWeightKg ? (
          <p className="encounter-section__hint">
            Peso do cadastro do paciente: {petWeightKg} kg — contexto de leitura. O peso medido hoje é
            o campo acima.
          </p>
        ) : null}

        <div className="encounter-clinical__grid">
          {TEXT_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint} htmlFor={`av-${f.key}`}>
              <Input id={`av-${f.key}`} disabled={disabled} maxLength={600}
                value={form[f.key]} placeholder={f.placeholder}
                onChange={(e) => setValue(f.key, e.target.value)} />
            </Field>
          ))}
        </div>

        <Field
          label="Exame físico / achados gerais"
          hint="O que foi examinado e encontrado neste atendimento."
          htmlFor="av-physicalExam"
        >
          <Textarea id="av-physicalExam" rows={4} maxLength={4000} disabled={disabled}
            value={form.physicalExam} placeholder="Ex: exame otológico com eritema em orelha direita"
            onChange={(e) => setValue('physicalExam', e.target.value)} />
        </Field>
      </div>
    </section>
  );
}
