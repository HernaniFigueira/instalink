// ═══════════════════════════════════════════════════════════════
// FASE 2 · P5 — PRESETS DE TIPO DE CLÍNICA
// ═══════════════════════════════════════════════════════════════
// UM produto, presets diferentes. Este módulo é PURO (sem I/O, sem React):
// define terminologia, módulos sugeridos no onboarding e os TEMPLATES INICIAIS
// de anamnese por tipo. NUNCA cria dashboards, rotas nem cópias de componentes
// — o preset só altera CONFIGURAÇÃO/aparência sobre o mesmo motor.
//
// Os textos de anamnese são ADMINISTRATIVOS e editáveis — NÃO são diagnóstico
// médico. A clínica pode usar o preset, editar, adicionar/remover campos ou
// criar outro template do zero.
import type { AnamneseField, AnamneseTemplate, ClinicType } from './types';

export interface ClinicTerms {
  /** Como a UI chama a pessoa atendida. */
  customer: string;
  customerPlural: string;
  /** Como a UI chama quem realiza. */
  professional: string;
  /** Como a UI chama o que é oferecido. */
  service: string;
  servicePlural: string;
  /** Como a UI chama o compromisso na agenda. */
  appointment: string;
}

export interface ClinicPreset {
  type: ClinicType;
  label: string;
  terms: ClinicTerms;
  /** Modos comerciais sugeridos no onboarding (o usuário pode mudar depois). */
  suggestedModes: Array<'services' | 'bookings'>;
  /** Sugestão de modelo de página pública (P9) — todos usam os MESMOS blocos. */
  pagePresetId: string;
  /** Dica curta de onboarding específica do tipo. */
  onboardingHint: string;
  /** Rótulo do paciente na agenda veterinária (pet) vs. contato (tutor). */
  vetMode: boolean;
}

export const CLINIC_PRESETS: Record<ClinicType, ClinicPreset> = {
  medica: {
    type: 'medica', label: 'Médica', vetMode: false, pagePresetId: 'clinica-medica',
    suggestedModes: ['services', 'bookings'],
    onboardingHint: 'Cadastre as consultas e exames, os médicos e os horários de atendimento.',
    terms: {
      customer: 'Paciente', customerPlural: 'Pacientes',
      professional: 'Profissional', service: 'Consulta', servicePlural: 'Consultas',
      appointment: 'Agendamento',
    },
  },
  odontologica: {
    type: 'odontologica', label: 'Odontológica', vetMode: false, pagePresetId: 'clinica-odontologica',
    suggestedModes: ['services', 'bookings'],
    onboardingHint: 'Cadastre os procedimentos, os dentistas e os horários do consultório.',
    terms: {
      customer: 'Paciente', customerPlural: 'Pacientes',
      professional: 'Dentista', service: 'Procedimento', servicePlural: 'Procedimentos',
      appointment: 'Agendamento',
    },
  },
  veterinaria: {
    type: 'veterinaria', label: 'Veterinária', vetMode: true, pagePresetId: 'clinica-veterinaria',
    suggestedModes: ['services', 'bookings'],
    onboardingHint: 'Cadastre os tutores, os pets, os serviços e os horários de atendimento.',
    terms: {
      customer: 'Tutor', customerPlural: 'Tutores',
      professional: 'Veterinário', service: 'Atendimento', servicePlural: 'Atendimentos',
      appointment: 'Agendamento',
    },
  },
  estetica: {
    type: 'estetica', label: 'Estética', vetMode: false, pagePresetId: 'clinica-estetica',
    suggestedModes: ['services', 'bookings'],
    onboardingHint: 'Cadastre os procedimentos estéticos, os profissionais e os horários.',
    terms: {
      customer: 'Cliente', customerPlural: 'Clientes',
      professional: 'Profissional', service: 'Procedimento', servicePlural: 'Procedimentos',
      appointment: 'Agendamento',
    },
  },
  geral: {
    type: 'geral', label: 'Clínica', vetMode: false, pagePresetId: 'clinica-geral',
    suggestedModes: ['services', 'bookings'],
    onboardingHint: 'Cadastre os serviços, os profissionais e os horários de atendimento.',
    terms: {
      customer: 'Cliente', customerPlural: 'Clientes',
      professional: 'Profissional', service: 'Serviço', servicePlural: 'Serviços',
      appointment: 'Agendamento',
    },
  },
};

export function clinicPreset(type: ClinicType | undefined | null): ClinicPreset {
  return (type && CLINIC_PRESETS[type]) || CLINIC_PRESETS.geral;
}

/** Terminologia efetiva para o tipo (fallback 'geral'). */
export function clinicTerms(type: ClinicType | undefined | null): ClinicTerms {
  return clinicPreset(type).terms;
}

/** A clínica opera no modo veterinário (tutor ≠ pet)? */
export function isVetClinic(type: ClinicType | undefined | null): boolean {
  return clinicPreset(type).vetMode;
}

// ── Templates iniciais de anamnese (P4) ──────────────────────
// ids ESTÁVEIS (slug) para o preset ser reconhecível e deduplicável. Campos
// novos criados pela clínica usam uid() na criação (ver API de anamnese).
interface FieldSeed {
  id: string; label: string; type: AnamneseField['type'];
  required?: boolean; help?: string; options?: string[];
  scaleMin?: number; scaleMax?: number; scaleMinLabel?: string; scaleMaxLabel?: string;
}

function seedFields(seeds: FieldSeed[]): AnamneseField[] {
  return seeds.map((s) => ({
    id: s.id, label: s.label, type: s.type, required: !!s.required,
    ...(s.help ? { help: s.help } : {}),
    ...(s.options ? { options: s.options } : {}),
    ...(typeof s.scaleMin === 'number' ? { scaleMin: s.scaleMin } : {}),
    ...(typeof s.scaleMax === 'number' ? { scaleMax: s.scaleMax } : {}),
    ...(s.scaleMinLabel ? { scaleMinLabel: s.scaleMinLabel } : {}),
    ...(s.scaleMaxLabel ? { scaleMaxLabel: s.scaleMaxLabel } : {}),
  }));
}

export interface AnamnesePreset {
  preset: ClinicType;
  name: string;
  description: string;
  fields: AnamneseField[];
}

export const ANAMNESE_PRESETS: Record<ClinicType, AnamnesePreset> = {
  medica: {
    preset: 'medica', name: 'Anamnese médica', description: 'Ficha administrativa inicial para clínica médica.',
    fields: seedFields([
      { id: 'queixa_principal', label: 'Queixa principal', type: 'textarea', required: true },
      { id: 'alergias', label: 'Alergias', type: 'textarea' },
      { id: 'medicamentos', label: 'Medicamentos em uso', type: 'textarea' },
      { id: 'doencas_anteriores', label: 'Doenças anteriores', type: 'textarea' },
      { id: 'cirurgias', label: 'Cirurgias anteriores', type: 'textarea' },
      { id: 'historico_familiar', label: 'Histórico familiar', type: 'textarea' },
    ]),
  },
  odontologica: {
    preset: 'odontologica', name: 'Anamnese odontológica', description: 'Ficha administrativa inicial para clínica odontológica.',
    fields: seedFields([
      { id: 'alergias', label: 'Alergias', type: 'textarea' },
      { id: 'medicamentos', label: 'Medicamentos em uso', type: 'textarea' },
      { id: 'condicoes_sistemicas', label: 'Condições sistêmicas', type: 'textarea' },
      { id: 'sangramento', label: 'Problema de sangramento?', type: 'boolean' },
      { id: 'tratamentos_anteriores', label: 'Tratamentos anteriores', type: 'textarea' },
      { id: 'habitos', label: 'Hábitos relevantes', type: 'textarea' },
    ]),
  },
  veterinaria: {
    preset: 'veterinaria', name: 'Anamnese veterinária',
    description: 'Episódio atual do pet. Dados permanentes (espécie, raça, peso…) entram como contexto no preenchimento.',
    fields: seedFields([
      // ── Episódio atual — tipos clínicos (nada tudo-em-textarea) ──
      { id: 'motivo', label: 'Motivo da consulta', type: 'textarea', required: true },
      { id: 'quando_comecou', label: 'Quando começou', type: 'select', options: ['Hoje', '2–3 dias', '1 semana', '2–4 semanas', 'Mais de 1 mês', 'Não sei'] },
      { id: 'apetite', label: 'Apetite', type: 'select', options: ['Normal', 'Reduzido', 'Ausente', 'Aumentado'] },
      { id: 'agua', label: 'Consumo de água', type: 'select', options: ['Normal', 'Mais que o habitual', 'Menos que o habitual', 'Recusa'] },
      { id: 'urina', label: 'Urinação', type: 'select', options: ['Normal', 'Aumentada', 'Reduzida', 'Dificuldade', 'Sem dados'] },
      { id: 'fezes', label: 'Fezes', type: 'select', options: ['Normais', 'Diarreia', 'Constipadas', 'Com sangue', 'Vómitos associados'] },
      { id: 'vomitos', label: 'Vômitos', type: 'boolean' },
      { id: 'comportamento', label: 'Comportamento', type: 'select', options: ['Normal', 'Apatia', 'Agitação', 'Dor', 'Isolamento'] },
      { id: 'alimentacao', label: 'Alimentação atual', type: 'text' },
      { id: 'medicacao_recente', label: 'Medicação recente', type: 'text' },
      { id: 'vacinacao_em_dia', label: 'Vacinação em dia', type: 'boolean' },
      { id: 'observacoes', label: 'Observações do episódio', type: 'textarea' },
    ]),
  },
  estetica: {
    preset: 'estetica', name: 'Anamnese estética', description: 'Ficha administrativa inicial para clínica de estética.',
    fields: seedFields([
      { id: 'objetivo', label: 'Objetivo do tratamento', type: 'textarea', required: true },
      { id: 'procedimentos_anteriores', label: 'Procedimentos anteriores', type: 'textarea' },
      { id: 'alergias', label: 'Alergias', type: 'textarea' },
      { id: 'medicamentos', label: 'Medicamentos em uso', type: 'textarea' },
      { id: 'contraindicacoes', label: 'Contraindicações', type: 'textarea' },
      { id: 'gestacao', label: 'Gestante?', type: 'boolean' },
      { id: 'cuidados_atuais', label: 'Cuidados atuais', type: 'textarea' },
    ]),
  },
  geral: {
    preset: 'geral', name: 'Anamnese geral', description: 'Ficha administrativa inicial (genérica).',
    fields: seedFields([
      { id: 'queixa_principal', label: 'Queixa principal', type: 'textarea', required: true },
      { id: 'alergias', label: 'Alergias', type: 'textarea' },
      { id: 'medicamentos', label: 'Medicamentos em uso', type: 'textarea' },
      { id: 'observacoes', label: 'Observações', type: 'textarea' },
    ]),
  },
};

/** Preset de anamnese para o tipo (fallback 'geral'). */
export function anamnesePresetFor(type: ClinicType | undefined | null): AnamnesePreset {
  return ANAMNESE_PRESETS[(type && ANAMNESE_PRESETS[type]) ? type : 'geral'];
}

/**
 * Cria um template de anamnese a partir do preset do tipo. `makeId` injeta a
 * geração de id (uid do app) para manter o módulo puro — o preset em si usa
 * ids estáveis (slug) nos campos.
 */
export function templateFromPreset(
  type: ClinicType | undefined | null,
  makeId: () => string,
  now: string,
): AnamneseTemplate {
  const p = anamnesePresetFor(type);
  return {
    id: makeId(),
    businessId: '', // preenchido pelo chamador (escopo de tenant)
    name: p.name,
    description: p.description,
    preset: p.preset,
    fields: p.fields.map((f) => ({ ...f })),
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}


/**
 * Upgrade SEGURO de template antigo a partir do preset atual.
 * Regras (item 7 do fechamento):
 *   • NUNCA sobrescreve campo customizado (mesmo id → mantém o do usuário);
 *   • NUNCA remove campos do usuário (só adiciona os que faltam do preset);
 *   • preserva name/description/active/id/businessId/createdAt;
 *   • `updatedAt` avança para sinalizar a mudança.
 * Retorna o MESMO objeto mutado (ou shallow copy) + lista de ids adicionados.
 */
export function upgradeTemplate(
  existing: AnamneseTemplate,
  type: ClinicType | undefined | null,
  now: string,
): { template: AnamneseTemplate; addedIds: string[] } {
  const preset = anamnesePresetFor(type);
  const have = new Set(existing.fields.map((f) => f.id));
  const added: string[] = [];
  const fields = existing.fields.map((f) => ({ ...f }));
  for (const seed of preset.fields) {
    if (have.has(seed.id)) continue; // customizado/definido — não toca
    const next = templateFromPreset(type, () => seed.id, now)
      .fields.find((x) => x.id === seed.id);
    if (next) {
      fields.push({ ...next });
      added.push(seed.id);
    }
  }
  return {
    template: {
      ...existing,
      // preset passa a refletir a origem atual (mantém 'custom' se era custom)
      preset: existing.preset === 'custom' ? 'custom' : (preset.preset || existing.preset),
      fields,
      updatedAt: added.length ? now : existing.updatedAt,
    },
    addedIds: added,
  };
}
