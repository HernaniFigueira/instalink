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

export interface EncounterClinicalData {
  anamnesis: EncounterVisitAnamnesis;
  assessment: {
    veterinary: VeterinaryAssessment;
    [key: string]: unknown;
  };
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
};

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
  } as EncounterClinicalData;
}

export type ClinicalPatchResult =
  | { ok: true; clinical: EncounterClinicalData; changedFields: string[] }
  | { ok: false; error: string; field?: string };

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
  if (!patchKeys.length || patchKeys.some((key) => key !== 'anamnesis' && key !== 'assessment')) {
    return { ok: false, error: 'A seção clínica enviada não é compatível.' };
  }

  const next: EncounterClinicalData = {
    ...current,
    anamnesis: { ...current.anamnesis },
    assessment: { ...current.assessment, veterinary: { ...current.assessment.veterinary } },
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
    canEditCore: false, canEditVisitAnamnesis: false, canEditVeterinaryAssessment: false, modules, reason,
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
    modules,
    // A razão diz a VERDADE: módulo desligado na vertical ≠ falta de Pet.
    reason: clinicalOk ? 'editable' : vetEnabled ? 'pet_required' : 'module_unavailable',
  };
}

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
