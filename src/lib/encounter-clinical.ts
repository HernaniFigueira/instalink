import type { DB, Encounter } from './types';
import { encounterModulesForClinic, normalizeClinicType, type EncounterModuleId } from './encounter-sections';

/** A reported change, not an automated clinical assessment. */
export type VisitChangeStatus = 'not_reported' | 'usual' | 'changed';
export type VisitYesNoStatus = 'not_reported' | 'yes' | 'no';

export interface EncounterVisitAnamnesis {
  history: string;
  diet: string;
  appetite: VisitChangeStatus;
  waterIntake: VisitChangeStatus;
  urine: VisitChangeStatus;
  stool: VisitChangeStatus;
  vomiting: VisitYesNoStatus;
  diarrhea: VisitYesNoStatus;
  medicationsReported: string;
  allergiesReported: string;
  observations: string;
}

/**
 * Visit measurements and findings. These are deliberately separate from the
 * permanent Pet profile; a blank measurement is null, never copied from Pet.
 */
export interface VeterinaryAssessment {
  weightKg: number | null;
  temperatureC: number | null;
  heartRateBpm: number | null;
  respiratoryRateRpm: number | null;
  hydration: string;
  mucousMembranes: string;
  capillaryRefillSeconds: number | null;
  bodyCondition: string;
  physicalExam: string;
}

/**
 * F1B2 — RACIOCÍNIO CLÍNICO REGISTRADO (não é decisão automática).
 *
 * `problem`   → o que está sendo tratado/observado (Problema);
 * `hypothesis`→ suspeita ainda não confirmada (Hipótese);
 * `diagnosis` → conclusão do profissional (Diagnóstico).
 *
 * Texto livre estruturado: NENHUM vocabulário médico fechado (CID/CIAP/SNOMED)
 * e NENHUMA classificação por IA nesta fase. Quem classifica é o profissional.
 */
export const CLINICAL_PROBLEM_KINDS = ['problem', 'hypothesis', 'diagnosis'] as const;
export type ClinicalProblemKind = typeof CLINICAL_PROBLEM_KINDS[number];

export const CLINICAL_PROBLEM_KIND_LABELS: Record<ClinicalProblemKind, string> = {
  problem: 'Problema',
  hypothesis: 'Hipótese',
  diagnosis: 'Diagnóstico',
};

/** Item da lista de problemas/hipóteses/diagnósticos. `id` é estável e próprio. */
export interface ClinicalProblemItem {
  id: string;
  kind: ClinicalProblemKind;
  label: string;
  notes: string;
}

/** F1B2 — Conduta: o que o profissional DECIDIU fazer a partir da avaliação. */
export interface ClinicalCarePlan {
  conduct: string;
}

/**
 * F1B2 — Procedimento REALIZADO neste Encounter. É o fato clínico, não o
 * serviço do agendamento: não carrega preço, cobrança, estoque nem comissão,
 * e não exige item de catálogo (procedimento custom é o caso normal).
 */
export interface ClinicalProcedureItem {
  id: string;
  name: string;
  notes: string;
}

export interface EncounterClinicalData {
  anamnesis: EncounterVisitAnamnesis;
  assessment: {
    veterinary: VeterinaryAssessment;
    [key: string]: unknown;
  };
  /** F1B2 — problemas/hipóteses/diagnósticos desta visita (lista ordenada). */
  problems: ClinicalProblemItem[];
  /** F1B2 — plano/conduta clínica decidida. */
  plan: ClinicalCarePlan;
  /** F1B2 — procedimentos realizados nesta visita. */
  procedures: ClinicalProcedureItem[];
  [key: string]: unknown;
}

export const EMPTY_ENCOUNTER_ANAMNESIS: EncounterVisitAnamnesis = {
  history: '',
  diet: '',
  appetite: 'not_reported',
  waterIntake: 'not_reported',
  urine: 'not_reported',
  stool: 'not_reported',
  vomiting: 'not_reported',
  diarrhea: 'not_reported',
  medicationsReported: '',
  allergiesReported: '',
  observations: '',
};

export const EMPTY_VETERINARY_ASSESSMENT: VeterinaryAssessment = {
  weightKg: null,
  temperatureC: null,
  heartRateBpm: null,
  respiratoryRateRpm: null,
  hydration: '',
  mucousMembranes: '',
  capillaryRefillSeconds: null,
  bodyCondition: '',
  physicalExam: '',
};

export const EMPTY_ENCOUNTER_CLINICAL: EncounterClinicalData = {
  anamnesis: EMPTY_ENCOUNTER_ANAMNESIS,
  assessment: { veterinary: EMPTY_VETERINARY_ASSESSMENT },
  problems: [],
  plan: { conduct: '' },
  procedures: [],
};

/**
 * F1B2 — LIMITES TÉCNICOS (segurança de entrada, não regra clínica).
 * Textos são truncados no servidor; quantidade acima do teto é recusada (400)
 * em vez de truncada em silêncio — perder item clínico sem avisar é pior.
 */
export const CLINICAL_LIST_LIMITS = {
  problems: { maxItems: 30, label: 200, notes: 1000 },
  procedures: { maxItems: 40, name: 200, notes: 1000 },
} as const;

export const CLINICAL_PLAN_LIMITS = { conduct: 4000 } as const;

/** Teto do identificador estável de item (o índice do array NUNCA é identidade). */
export const CLINICAL_ITEM_ID_MAX = 64;
/** Identificador estável: começa alfanumérico, aceita `-`/`_`. */
export const CLINICAL_ITEM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/**
 * F1B2 — identidade ESTÁVEL de item de lista (problema/procedimento).
 *
 * O índice do array NUNCA é identidade: reordenar, editar ou remover um item
 * não pode trocar a identidade dos outros (é o que permite auditoria e edição
 * seguras). Gerado no cliente ao criar o item e preservado pelo servidor.
 */
export function newClinicalItemId(prefix: 'prb' | 'proc'): string {
  const random = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}-${time}-${random}`.slice(0, CLINICAL_ITEM_ID_MAX);
}

export const ENCOUNTER_ANAMNESIS_TEXT_LIMITS = {
  history: 4000,
  diet: 1200,
  medicationsReported: 2000,
  allergiesReported: 2000,
  observations: 2000,
} as const satisfies Partial<Record<keyof EncounterVisitAnamnesis, number>>;

export const VETERINARY_ASSESSMENT_TEXT_LIMITS = {
  hydration: 600,
  mucousMembranes: 600,
  bodyCondition: 600,
  physicalExam: 4000,
} as const satisfies Partial<Record<keyof VeterinaryAssessment, number>>;

/** Technical/input-safety bounds only; these are not clinical reference ranges. */
export const VETERINARY_ASSESSMENT_NUMBER_LIMITS = {
  weightKg: { min: 0, max: 100_000 },
  temperatureC: { min: -273.15, max: 1_000 },
  heartRateBpm: { min: 0, max: 1_000_000 },
  respiratoryRateRpm: { min: 0, max: 1_000_000 },
  capillaryRefillSeconds: { min: 0, max: 1_000_000 },
} as const satisfies Record<string, { min: number; max: number }>;

export type ClinicalWriteReason =
  | 'editable'
  | 'professional_required'
  | 'responsible_unavailable'
  | 'pet_required'
  | 'pet_invalid'
  /** A vertical desta unidade não liga o módulo da seção (ex.: vet em odonto). */
  | 'module_unavailable'
  | 'finalized';

export interface EncounterClinicalAccess {
  /**
   * Campos do núcleo (queixa/evolução/orientações/retorno/nota): exigem
   * profissional responsável + atendimento em andamento. Vale em QUALQUER
   * vertical — o CORE não depende de especialidade nem de Pet.
   */
  canEditCore: boolean;
  /**
   * Anamnese DA VISITA: capacidade com nome próprio (não uma flag genérica).
   * Nesta entrega a anamnese é a da visita veterinária e depende do paciente
   * do Encounter (Pet VÁLIDO no tenant) — o vínculo é revalidado no servidor.
   */
  canEditVisitAnamnesis: boolean;
  /**
   * Avaliação veterinária (medidas e achados do exame): mesma régua da
   * anamnese — profissional responsável + Pet válido + módulo VET ligado.
   */
  canEditVeterinaryAssessment: boolean;
  /**
   * F1B2 — Problemas/hipóteses/diagnósticos: profissional responsável +
   * paciente válido + módulo ligado na vertical. Capacidade com nome próprio
   * (nunca uma flag genérica "pode editar clínico").
   */
  canEditClinicalProblems: boolean;
  /** F1B2 — Conduta/plano clínico: mesma régua dos problemas. */
  canEditCarePlan: boolean;
  /** F1B2 — Procedimentos realizados: mesma régua (fato clínico do paciente). */
  canEditClinicalProcedures: boolean;
  /**
   * Módulos que a VERTICAL desta unidade liga (autoridade única:
   * `encounterModulesForClinic(Business.clinicType)`). A tela resolve a
   * navegação por aqui em vez de adivinhar por nome/serviço/Pet.
   */
  modules: EncounterModuleId[];
  reason: ClinicalWriteReason;
}

const CHANGE_STATUSES = new Set<VisitChangeStatus>(['not_reported', 'usual', 'changed']);
const YES_NO_STATUSES = new Set<VisitYesNoStatus>(['not_reported', 'yes', 'no']);
const ANAMNESIS_TEXT_FIELDS = Object.keys(ENCOUNTER_ANAMNESIS_TEXT_LIMITS) as Array<keyof typeof ENCOUNTER_ANAMNESIS_TEXT_LIMITS>;
const ASSESSMENT_TEXT_FIELDS = Object.keys(VETERINARY_ASSESSMENT_TEXT_LIMITS) as Array<keyof typeof VETERINARY_ASSESSMENT_TEXT_LIMITS>;
const ASSESSMENT_NUMBER_FIELDS = Object.keys(VETERINARY_ASSESSMENT_NUMBER_LIMITS) as Array<keyof typeof VETERINARY_ASSESSMENT_NUMBER_LIMITS>;
const ANAMNESIS_FIELDS = new Set<keyof EncounterVisitAnamnesis>([
  'history', 'diet', 'appetite', 'waterIntake', 'urine', 'stool', 'vomiting', 'diarrhea',
  'medicationsReported', 'allergiesReported', 'observations',
]);
const ASSESSMENT_FIELDS = new Set<keyof VeterinaryAssessment>([
  ...ASSESSMENT_TEXT_FIELDS, ...ASSESSMENT_NUMBER_FIELDS,
]);

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').slice(0, maxLength)
    : '';
}

function normalizeNumber(value: unknown, field: keyof typeof VETERINARY_ASSESSMENT_NUMBER_LIMITS): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const { min, max } = VETERINARY_ASSESSMENT_NUMBER_LIMITS[field];
  return value >= min && value <= max ? value : null;
}

function normalizeAnamnesis(value: unknown): EncounterVisitAnamnesis {
  const raw = recordOf(value) || {};
  const out: EncounterVisitAnamnesis = { ...EMPTY_ENCOUNTER_ANAMNESIS };
  for (const field of ANAMNESIS_TEXT_FIELDS) {
    out[field] = cleanText(raw[field], ENCOUNTER_ANAMNESIS_TEXT_LIMITS[field]);
  }
  for (const field of ['appetite', 'waterIntake', 'urine', 'stool'] as const) {
    const status = raw[field];
    out[field] = typeof status === 'string' && CHANGE_STATUSES.has(status as VisitChangeStatus)
      ? status as VisitChangeStatus
      : 'not_reported';
  }
  for (const field of ['vomiting', 'diarrhea'] as const) {
    const status = raw[field];
    out[field] = typeof status === 'string' && YES_NO_STATUSES.has(status as VisitYesNoStatus)
      ? status as VisitYesNoStatus
      : 'not_reported';
  }
  return out;
}

function normalizeVeterinaryAssessment(value: unknown): VeterinaryAssessment {
  const raw = recordOf(value) || {};
  const out: VeterinaryAssessment = { ...EMPTY_VETERINARY_ASSESSMENT };
  for (const field of ASSESSMENT_TEXT_FIELDS) {
    out[field] = cleanText(raw[field], VETERINARY_ASSESSMENT_TEXT_LIMITS[field]);
  }
  for (const field of ASSESSMENT_NUMBER_FIELDS) {
    out[field] = normalizeNumber(raw[field], field);
  }
  return out;
}

// ── F1B2 · PROBLEMAS / CONDUTA / PROCEDIMENTOS ───────────────────────────
// Duas funções por lista, com papéis diferentes:
//   normalize*List → TOTAL, usada na leitura (documento legado/corrompido vira
//                    lista válida; item inválido é descartado, nunca inventado);
//   parse*List     → ESTRITA, usada na escrita (payload inválido = 400 com
//                    mensagem humana, nada de aceitar em silêncio).
const PROBLEM_ITEM_FIELDS = new Set(['id', 'kind', 'label', 'notes']);
const PROCEDURE_ITEM_FIELDS = new Set(['id', 'name', 'notes']);

function normalizeProblemList(value: unknown): ClinicalProblemItem[] {
  if (!Array.isArray(value)) return [];
  const out: ClinicalProblemItem[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const item = recordOf(raw);
    if (!item) continue;
    const id = typeof item.id === 'string' ? item.id.slice(0, CLINICAL_ITEM_ID_MAX) : '';
    if (!id || !CLINICAL_ITEM_ID_PATTERN.test(id) || seen.has(id)) continue;
    const kind = (CLINICAL_PROBLEM_KINDS as readonly string[]).includes(String(item.kind))
      ? (item.kind as ClinicalProblemKind)
      : null;
    const label = cleanText(item.label, CLINICAL_LIST_LIMITS.problems.label);
    if (!kind || !label.trim()) continue;
    seen.add(id);
    out.push({ id, kind, label, notes: cleanText(item.notes, CLINICAL_LIST_LIMITS.problems.notes) });
    if (out.length >= CLINICAL_LIST_LIMITS.problems.maxItems) break;
  }
  return out;
}

function normalizeProcedureList(value: unknown): ClinicalProcedureItem[] {
  if (!Array.isArray(value)) return [];
  const out: ClinicalProcedureItem[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const item = recordOf(raw);
    if (!item) continue;
    const id = typeof item.id === 'string' ? item.id.slice(0, CLINICAL_ITEM_ID_MAX) : '';
    if (!id || !CLINICAL_ITEM_ID_PATTERN.test(id) || seen.has(id)) continue;
    const name = cleanText(item.name, CLINICAL_LIST_LIMITS.procedures.name);
    if (!name.trim()) continue;
    seen.add(id);
    out.push({ id, name, notes: cleanText(item.notes, CLINICAL_LIST_LIMITS.procedures.notes) });
    if (out.length >= CLINICAL_LIST_LIMITS.procedures.maxItems) break;
  }
  return out;
}

type ListParseResult<T> = { ok: true; items: T[] } | { ok: false; error: string };

/** Escrita: valida a lista inteira (identidade, tipo, textos, duplicidade, teto). */
export function parseClinicalProblems(value: unknown): ListParseResult<ClinicalProblemItem> {
  if (!Array.isArray(value)) return { ok: false, error: 'A lista de problemas enviada é inválida.' };
  const { maxItems, label: labelMax, notes: notesMax } = CLINICAL_LIST_LIMITS.problems;
  if (value.length > maxItems) return { ok: false, error: `Registre até ${maxItems} problemas por atendimento.` };
  const items: ClinicalProblemItem[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const item = recordOf(raw);
    if (!item) return { ok: false, error: 'Cada problema precisa de tipo e descrição.' };
    const keys = Object.keys(item);
    if (!keys.length || keys.some((key) => !PROBLEM_ITEM_FIELDS.has(key))) {
      return { ok: false, error: 'Há campos não reconhecidos na lista de problemas.' };
    }
    const id = typeof item.id === 'string' ? item.id : '';
    if (!CLINICAL_ITEM_ID_PATTERN.test(id)) return { ok: false, error: 'Identificador de problema inválido.' };
    if (seen.has(id)) return { ok: false, error: 'Há itens duplicados na lista de problemas.' };
    if (!(CLINICAL_PROBLEM_KINDS as readonly string[]).includes(String(item.kind))) {
      return { ok: false, error: 'Selecione um tipo válido: problema, hipótese ou diagnóstico.' };
    }
    if (typeof item.label !== 'string') return { ok: false, error: 'Informe a descrição do problema.' };
    const label = cleanText(item.label, labelMax);
    if (!label.trim()) return { ok: false, error: 'Informe a descrição do problema.' };
    if (item.notes !== undefined && typeof item.notes !== 'string') {
      return { ok: false, error: 'A observação do problema precisa ser um texto.' };
    }
    seen.add(id);
    items.push({
      id,
      kind: item.kind as ClinicalProblemKind,
      label,
      notes: cleanText(item.notes, notesMax),
    });
  }
  return { ok: true, items };
}

/** Escrita: procedimentos realizados (sem vínculo obrigatório com catálogo). */
export function parseClinicalProcedures(value: unknown): ListParseResult<ClinicalProcedureItem> {
  if (!Array.isArray(value)) return { ok: false, error: 'A lista de procedimentos enviada é inválida.' };
  const { maxItems, name: nameMax, notes: notesMax } = CLINICAL_LIST_LIMITS.procedures;
  if (value.length > maxItems) return { ok: false, error: `Registre até ${maxItems} procedimentos por atendimento.` };
  const items: ClinicalProcedureItem[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const item = recordOf(raw);
    if (!item) return { ok: false, error: 'Cada procedimento precisa de identificação e nome.' };
    const keys = Object.keys(item);
    if (!keys.length || keys.some((key) => !PROCEDURE_ITEM_FIELDS.has(key))) {
      return { ok: false, error: 'Há campos não reconhecidos na lista de procedimentos.' };
    }
    const id = typeof item.id === 'string' ? item.id : '';
    if (!CLINICAL_ITEM_ID_PATTERN.test(id)) return { ok: false, error: 'Identificador de procedimento inválido.' };
    if (seen.has(id)) return { ok: false, error: 'Há itens duplicados na lista de procedimentos.' };
    if (typeof item.name !== 'string') return { ok: false, error: 'Informe o nome do procedimento.' };
    const name = cleanText(item.name, nameMax);
    if (!name.trim()) return { ok: false, error: 'Informe o nome do procedimento.' };
    if (item.notes !== undefined && typeof item.notes !== 'string') {
      return { ok: false, error: 'A observação do procedimento precisa ser um texto.' };
    }
    seen.add(id);
    items.push({ id, name, notes: cleanText(item.notes, notesMax) });
  }
  return { ok: true, items };
}

/** Additive legacy normalization: absent visit data becomes blank, never Pet data. */
export function normalizeEncounterClinical(value: unknown): EncounterClinicalData {
  const raw = recordOf(value) || {};
  const rawAssessment = recordOf(raw.assessment) || {};
  return {
    ...raw,
    anamnesis: normalizeAnamnesis(raw.anamnesis),
    assessment: {
      ...rawAssessment,
      veterinary: normalizeVeterinaryAssessment(rawAssessment.veterinary),
    },
    // F1B2 — aditivo e idempotente: documento anterior ao F1B2 ganha as listas
    // VAZIAS e a conduta em branco. Nada é derivado de texto antigo (evolução
    // não vira diagnóstico) e nada é inventado.
    problems: normalizeProblemList(raw.problems),
    plan: {
      conduct: cleanText(recordOf(raw.plan)?.conduct, CLINICAL_PLAN_LIMITS.conduct),
    },
    procedures: normalizeProcedureList(raw.procedures),
  } as EncounterClinicalData;
}

export type ClinicalPatchResult =
  | { ok: true; clinical: EncounterClinicalData; changedFields: string[] }
  | { ok: false; error: string; field?: string };

/**
 * Ramos de `clinical` aceitos no payload (chave desconhecida = 400: nada de
 * ligar superfície futura em silêncio).
 */
export const CLINICAL_PATCH_BRANCHES = ['anamnesis', 'assessment', 'problems', 'plan', 'procedures'] as const;

/**
 * Validates a partial clinical payload and merges it into the same Encounter.
 * Unknown clinical keys are rejected rather than silently turning on future
 * F1B/F1C surfaces. Omitted values remain untouched.
 */
export function applyEncounterClinicalPatch(
  currentValue: unknown,
  patchValue: unknown,
): ClinicalPatchResult {
  const current = normalizeEncounterClinical(currentValue);
  const patch = recordOf(patchValue);
  if (!patch) return { ok: false, error: 'Os dados clínicos enviados são inválidos.' };
  const patchKeys = Object.keys(patch);
  if (!patchKeys.length || patchKeys.some((key) => !(CLINICAL_PATCH_BRANCHES as readonly string[]).includes(key))) {
    return { ok: false, error: 'A seção clínica enviada não é compatível.' };
  }

  const next: EncounterClinicalData = {
    ...current,
    anamnesis: { ...current.anamnesis },
    assessment: { ...current.assessment, veterinary: { ...current.assessment.veterinary } },
    problems: current.problems.map((item) => ({ ...item })),
    plan: { ...current.plan },
    procedures: current.procedures.map((item) => ({ ...item })),
  };
  const changedFields: string[] = [];

  if (patch.anamnesis !== undefined) {
    const incoming = recordOf(patch.anamnesis);
    if (!incoming || !Object.keys(incoming).length || Object.keys(incoming).some((key) => !ANAMNESIS_FIELDS.has(key as keyof EncounterVisitAnamnesis))) {
      return { ok: false, error: 'Os campos da anamnese da visita são inválidos.' };
    }
    for (const [key, value] of Object.entries(incoming)) {
      const field = key as keyof EncounterVisitAnamnesis;
      let cleaned: string | VisitChangeStatus | VisitYesNoStatus;
      if (field in ENCOUNTER_ANAMNESIS_TEXT_LIMITS) {
        if (typeof value !== 'string') return { ok: false, error: 'Informe um texto válido.', field: key };
        cleaned = cleanText(value, ENCOUNTER_ANAMNESIS_TEXT_LIMITS[field as keyof typeof ENCOUNTER_ANAMNESIS_TEXT_LIMITS]);
      } else if (field === 'appetite' || field === 'waterIntake' || field === 'urine' || field === 'stool') {
        if (typeof value !== 'string' || !CHANGE_STATUSES.has(value as VisitChangeStatus)) {
          return { ok: false, error: 'Selecione uma opção válida.', field: key };
        }
        cleaned = value as VisitChangeStatus;
      } else {
        if (typeof value !== 'string' || !YES_NO_STATUSES.has(value as VisitYesNoStatus)) {
          return { ok: false, error: 'Selecione uma opção válida.', field: key };
        }
        cleaned = value as VisitYesNoStatus;
      }
      if (JSON.stringify(next.anamnesis[field]) !== JSON.stringify(cleaned)) {
        next.anamnesis[field] = cleaned as never;
        changedFields.push(`clinical.anamnesis.${key}`);
      }
    }
  }

  if (patch.assessment !== undefined) {
    const assessmentPatch = recordOf(patch.assessment);
    if (!assessmentPatch || Object.keys(assessmentPatch).length !== 1 || !('veterinary' in assessmentPatch)) {
      return { ok: false, error: 'Os campos de avaliação veterinária são inválidos.' };
    }
    const incoming = recordOf(assessmentPatch.veterinary);
    if (!incoming || !Object.keys(incoming).length || Object.keys(incoming).some((key) => !ASSESSMENT_FIELDS.has(key as keyof VeterinaryAssessment))) {
      return { ok: false, error: 'Os campos de avaliação veterinária são inválidos.' };
    }
    for (const [key, value] of Object.entries(incoming)) {
      const field = key as keyof VeterinaryAssessment;
      let cleaned: string | number | null;
      if (field in VETERINARY_ASSESSMENT_TEXT_LIMITS) {
        if (typeof value !== 'string') return { ok: false, error: 'Informe um texto válido.', field: key };
        cleaned = cleanText(value, VETERINARY_ASSESSMENT_TEXT_LIMITS[field as keyof typeof VETERINARY_ASSESSMENT_TEXT_LIMITS]);
      } else {
        const limits = VETERINARY_ASSESSMENT_NUMBER_LIMITS[field as keyof typeof VETERINARY_ASSESSMENT_NUMBER_LIMITS];
        if (value === null || value === '') cleaned = null;
        else if (typeof value !== 'number' || !Number.isFinite(value)) {
          return { ok: false, error: 'Informe um número finito ou deixe o campo em branco.', field: key };
        } else if (value < limits.min || value > limits.max) {
          return { ok: false, error: `Use um valor entre ${limits.min} e ${limits.max}.`, field: key };
        } else cleaned = value;
      }
      if (JSON.stringify(next.assessment.veterinary[field]) !== JSON.stringify(cleaned)) {
        next.assessment.veterinary[field] = cleaned as never;
        changedFields.push(`clinical.assessment.veterinary.${key}`);
      }
    }
  }

  // ── F1B2 · PROBLEMAS / HIPÓTESES / DIAGNÓSTICOS ─────────────────────────
  // A lista é substituída como um todo (a UI manda a lista atual); a identidade
  // de cada item é o `id` estável, NUNCA a posição no array — reordenar ou
  // editar não troca a identidade de nada.
  if (patch.problems !== undefined) {
    const parsed = parseClinicalProblems(patch.problems);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (JSON.stringify(next.problems) !== JSON.stringify(parsed.items)) {
      next.problems = parsed.items;
      changedFields.push('clinical.problems');
    }
  }

  // ── F1B2 · CONDUTA (o que o profissional decidiu fazer) ─────────────────
  // Campo próprio: NÃO é `evolution` (o que aconteceu) e NÃO duplica
  // `guidance`/`followUp` (orientações ao tutor e retorno continuam no núcleo).
  if (patch.plan !== undefined) {
    const planPatch = recordOf(patch.plan);
    if (!planPatch || Object.keys(planPatch).some((key) => key !== 'conduct')) {
      return { ok: false, error: 'Os campos de conduta são inválidos.' };
    }
    if (planPatch.conduct !== undefined) {
      if (typeof planPatch.conduct !== 'string') {
        return { ok: false, error: 'O plano/conduta precisa ser um texto.' };
      }
      const conduct = cleanText(planPatch.conduct, CLINICAL_PLAN_LIMITS.conduct);
      if (conduct !== next.plan.conduct) {
        next.plan = { ...next.plan, conduct };
        changedFields.push('clinical.plan.conduct');
      }
    }
  }

  // ── F1B2 · PROCEDIMENTOS REALIZADOS ─────────────────────────────────────
  // Só o fato clínico: sem preço, cobrança, estoque, comissão ou pedido.
  if (patch.procedures !== undefined) {
    const parsed = parseClinicalProcedures(patch.procedures);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    if (JSON.stringify(next.procedures) !== JSON.stringify(parsed.items)) {
      next.procedures = parsed.items;
      changedFields.push('clinical.procedures');
    }
  }

  return { ok: true, clinical: next, changedFields };
}

/**
 * Server authorization for clinical Encounter writes. Administrative role is
 * necessary but not sufficient: Owner/Admin must also be the linked responsible
 * Professional. A missing Pet only blocks veterinary sections; an invalid
 * explicit Pet relationship blocks every clinical write.
 */
export function encounterClinicalAccess(
  db: Pick<DB, 'professionals' | 'pets' | 'businesses'>,
  encounter: Pick<Encounter, 'businessId' | 'professionalId' | 'petId' | 'status'>,
  actorId: string,
  role: string,
): EncounterClinicalAccess {
  // MÓDULOS da vertical vêm do SERVIDOR (Business.clinicType normalizado) —
  // nunca do cliente, nunca inferidos de nome/serviço/Pet. Clínica não
  // veterinária simplesmente NÃO tem as capacidades vet (e não é uma regra
  // de Pet: é a vertical desligando o módulo).
  const business = db.businesses.find((item) => item.id === encounter.businessId);
  const modules = encounterModulesForClinic(normalizeClinicType(business?.clinicType));
  const vetEnabled = modules.includes('vet');
  const denied = (reason: ClinicalWriteReason): EncounterClinicalAccess => ({
    canEditCore: false, canEditVisitAnamnesis: false, canEditVeterinaryAssessment: false,
    canEditClinicalProblems: false, canEditCarePlan: false, canEditClinicalProcedures: false,
    modules, reason,
  });

  if (encounter.status !== 'draft') return denied('finalized');
  if (role !== 'OWNER' && role !== 'ADMIN' && role !== 'PROFISSIONAL') return denied('professional_required');

  const linked = db.professionals.filter((professional) =>
    professional.businessId === encounter.businessId
    && professional.userId === actorId
    && professional.active !== false,
  );
  if (linked.length !== 1 || linked[0].id !== encounter.professionalId) {
    return denied('professional_required');
  }

  const responsible = db.professionals.find((professional) =>
    professional.id === encounter.professionalId
    && professional.businessId === encounter.businessId
    && professional.active !== false,
  );
  if (!responsible) return denied('responsible_unavailable');

  const hasPetId = Boolean(encounter.petId);
  const petValid = hasPetId && db.pets.some((pet) =>
    pet.id === encounter.petId && pet.businessId === encounter.businessId,
  );
  // Vínculo explícito com Pet de FORA do tenant continua bloqueando tudo.
  if (hasPetId && !petValid) return denied('pet_invalid');

  const clinicalOk = vetEnabled && petValid;
  return {
    canEditCore: true,
    canEditVisitAnamnesis: clinicalOk,
    canEditVeterinaryAssessment: clinicalOk,
    // F1B2 — raciocínio clínico, conduta e procedimentos são dado clínico do
    // PACIENTE desta visita: mesma régua da anamnese/avaliação (módulo ligado
    // na vertical + paciente válido + profissional responsável).
    canEditClinicalProblems: clinicalOk,
    canEditCarePlan: clinicalOk,
    canEditClinicalProcedures: clinicalOk,
    modules,
    // A razão diz a VERDADE: módulo desligado na vertical ≠ falta de Pet.
    reason: clinicalOk ? 'editable' : vetEnabled ? 'pet_required' : 'module_unavailable',
  };
}

/**
 * F1B2 — ramo de `clinical` → capacidade que o autoriza. A rota usa esta
 * tabela (um laço só) em vez de espalhar `if (branch === ...)` por ramo: ramo
 * novo entra aqui e já nasce coberto pelo gate de autoria.
 */
export const CLINICAL_BRANCH_CAPABILITIES: Record<string, ClinicalCapabilityKey> = {
  anamnesis: 'canEditVisitAnamnesis',
  assessment: 'canEditVeterinaryAssessment',
  problems: 'canEditClinicalProblems',
  plan: 'canEditCarePlan',
  procedures: 'canEditClinicalProcedures',
};

/** Chaves de capacidade clínica (o que a tabela acima pode referenciar). */
export type ClinicalCapabilityKey =
  | 'canEditVisitAnamnesis'
  | 'canEditVeterinaryAssessment'
  | 'canEditClinicalProblems'
  | 'canEditCarePlan'
  | 'canEditClinicalProcedures';

export function clinicalWriteError(access: EncounterClinicalAccess, section: 'core' | 'clinical' = 'core'): {
  status: number;
  message: string;
} {
  if (access.reason === 'finalized') {
    return { status: 409, message: 'Registro finalizado: alterações clínicas bloqueadas.' };
  }
  if (access.reason === 'pet_invalid') {
    return { status: 409, message: 'O Pet deste atendimento não pôde ser validado nesta unidade.' };
  }
  if (access.reason === 'professional_required' || access.reason === 'responsible_unavailable') {
    return { status: 403, message: 'Somente o profissional responsável vinculado pode editar o conteúdo clínico.' };
  }
  if (section === 'clinical' && access.reason === 'pet_required') {
    return { status: 409, message: 'Vincule o Pet ao atendimento antes de gravar a anamnese e a avaliação.' };
  }
  if (section === 'clinical' && access.reason === 'module_unavailable') {
    return { status: 400, message: 'Esta seção clínica não está disponível nesta unidade.' };
  }
  return { status: 403, message: 'Este atendimento não está disponível para edição clínica.' };
}
