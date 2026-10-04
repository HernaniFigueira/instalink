// ═══════════════════════════════════════════════════════════════
// F1A · SEÇÕES DO WORKSPACE CLÍNICO (estrutura preparada, sem módulo falso)
// ═══════════════════════════════════════════════════════════════
// O workspace do atendimento é o CASCO: ele não muda por especialidade. O que
// muda é o conjunto de SEÇÕES clínicas que cada vertical liga em cima do mesmo
// Encounter (CORE). Hoje existe uma só seção real (o registro do atendimento);
// as demais estão DECLARADAS — e não renderizadas — para o F1B não precisar
// inventar navegação nem redesenhar o cabeçalho.
//
// REGRAS DESTA MISSÃO:
//   • `available: false` NÃO é renderizado. Seção indisponível não vira aba
//     morta, botão desabilitado nem placeholder decorativo;
//   • nenhuma seção futura ganha campo, formulário ou texto agora (isso é
//     F1B/F1C); o que existe é o CONTRATO de identificação (id, rótulo,
//     módulo e ordem);
//   • `module` separa o CORE clínico das especialidades (vet hoje; odontologia
//     e estética depois) sem criar uma segunda entidade de atendimento.
import { isClinicType, type ClinicType, type Encounter } from './types';

/**
 * MÓDULOS do Clinical Encounter. O CORE é o mesmo para todo mundo; cada
 * VERTICAL liga o SEU módulo em cima do mesmo Encounter (nunca uma entidade
 * por especialidade). Módulos sem seção `available` não renderizam nada.
 */
export type EncounterModuleId = 'core' | 'vet' | 'odontology' | 'aesthetics' | 'medical';

/**
 * AUTORIDADE ÚNICA de módulos por vertical (§ isolamento por vertical).
 *
 *   veterinaria → CORE + VET
 *   odontologica → CORE + ODONTOLOGY (nenhuma seção odontológica implementada)
 *   estetica    → CORE + AESTHETICS  (idem)
 *   medica      → CORE               (contrato médico ainda não existe)
 *   geral/ausente → CORE             (fallback conservador)
 *
 * NUNCA inferir por nome, serviço, existência de Pet, nicho ou slug: só
 * `Business.clinicType` (normalizado) decide. Um Pet cadastrado NÃO liga o
 * módulo veterinário; uma clínica odontológica com Pet continua só com o CORE.
 */
const CLINIC_MODULES: Record<ClinicType, EncounterModuleId[]> = {
  veterinaria: ['core', 'vet'],
  odontologica: ['core', 'odontology'],
  estetica: ['core', 'aesthetics'],
  medica: ['core'],
  geral: ['core'],
};

/** Normaliza a vertical da unidade (ausente/inválido = 'geral', nada de adivinhar). */
export function normalizeClinicType(value: unknown): ClinicType {
  return isClinicType(value) ? value : 'geral';
}

/** Módulos que ESTA vertical liga, na ordem canônica. */
export function encounterModulesForClinic(clinicType: unknown): EncounterModuleId[] {
  return [...CLINIC_MODULES[normalizeClinicType(clinicType)]];
}

/** O módulo está ligado nesta vertical? (só o clinicType decide) */
export function isEncounterModuleEnabled(module: EncounterModuleId, clinicType: unknown): boolean {
  return encounterModulesForClinic(clinicType).includes(module);
}

export interface EncounterSectionDef {
  id: string;
  label: string;
  /** Módulo dono da seção (o CORE nunca depende de especialidade). */
  module: EncounterModuleId;
  /** Ordem de exibição (estável: a navegação não reordena por dados). */
  order: number;
  /**
   * false = planejada, ainda NÃO implementada. A UI mostra só o que é true.
   * Quando uma seção virar real, ela passa a true NA MESMA entrega que
   * implementa a persistência — nunca antes.
   */
  available: boolean;
  /** Rótulo curto para o cabeçalho/seção. */
  hint?: string;
}

export const ENCOUNTER_SECTIONS: EncounterSectionDef[] = [
  {
    id: 'atendimento', label: 'Atendimento', module: 'core', order: 10, available: true,
    hint: 'Registro clínico do atendimento: o que foi feito, orientações e retorno.',
  },
  // ── F1B1 — SEÇÕES REAIS (UI + persistência + leitura + autosave + testes) ──
  // Só vira `available: true` quem tem TODAS as cinco coisas na mesma entrega.
  // F1B1 · VET-FIRST (revisão de isolamento por vertical): a anamnese desta
  // entrega é a da VISITA VETERINÁRIA (apetite/água/urina/fezes/vômito/diarreia)
  // e depende do paciente do Encounter (Pet). A abstração de paciente humano/
  // odontológico ainda NÃO foi fechada no novo Clinical Encounter — então ela
  // pertence ao módulo VET nesta etapa, e não vaza para outras verticais.
  // Quando a abstração de paciente humano for fechada, esta seção é
  // parametrizada por módulo (não duplicada).
  {
    id: 'anamnese', label: 'Anamnese', module: 'vet', order: 20, available: true,
    hint: 'Histórico e contexto relatados NESTA visita (não é cadastro permanente do paciente).',
  },
  {
    id: 'avaliacao', label: 'Avaliação', module: 'vet', order: 30, available: true,
    hint: 'Exame clínico de hoje: medidas e achados do profissional.',
  },
  // ── Estrutura planejada (F1B2/F1C) — NÃO renderizada enquanto indisponível ──
  { id: 'problemas', label: 'Problemas', module: 'core', order: 40, available: false },
  { id: 'conduta', label: 'Conduta', module: 'core', order: 50, available: false },
  { id: 'procedimentos', label: 'Procedimentos', module: 'vet', order: 60, available: false },
  { id: 'anexos', label: 'Anexos', module: 'core', order: 70, available: false },
];

/**
 * Ramos de `Encounter.clinical` → módulo dono. É esta tabela que o SERVIDOR usa
 * para recusar escrita de módulo desligado na vertical (defesa em profundidade:
 * a UI esconder não é o gate). O dado NUNCA é apagado por isto (§ não apagar).
 */
export const CLINICAL_BRANCH_MODULES: Record<string, EncounterModuleId> = {
  anamnesis: 'vet',
  assessment: 'vet',
};

/** Ramos de `clinical` que ESTA vertical aceita escrever. */
export function clinicalBranchesForClinic(clinicType: unknown): string[] {
  const modules = new Set(encounterModulesForClinic(clinicType));
  return Object.keys(CLINICAL_BRANCH_MODULES).filter((branch) => modules.has(CLINICAL_BRANCH_MODULES[branch]));
}

/**
 * Seções REAIS desta vertical, na ordem canônica. Sem `clinicType` o fallback é
 * CONSERVADOR (só o CORE) — nada de módulo de especialidade por omissão.
 */
export function availableEncounterSections(clinicType?: unknown): EncounterSectionDef[] {
  const modules = new Set(encounterModulesForClinic(clinicType));
  return ENCOUNTER_SECTIONS
    .filter((s) => s.available && modules.has(s.module))
    .sort((a, b) => a.order - b.order);
}

/** Seção inicial do workspace (nunca depende de ordem de array de dados). */
export function firstEncounterSectionId(clinicType?: unknown): string {
  return availableEncounterSections(clinicType)[0]?.id || 'atendimento';
}

/** A seção está ligada nesta vertical E implementada? */
export function isEncounterSectionEnabled(id: string, clinicType?: unknown): boolean {
  return availableEncounterSections(clinicType).some((s) => s.id === id);
}

/** Resolve a seção ativa: id ligado nesta vertical, senão a inicial. */
export function resolveEncounterSection(id: string | null | undefined, clinicType?: unknown): EncounterSectionDef {
  const available = availableEncounterSections(clinicType);
  const found = available.find((s) => s.id === id);
  return found || available[0] || ENCOUNTER_SECTIONS[0];
}

// ── F1A · CAPACIDADES DO NÚCLEO CLÍNICO ───────────────────────────────────
// O workspace DECLARA o que suporta e o núcleo (`EncounterCoreSection`)
// renderiza SÓ o que está aqui. É o oposto de espalhar
// `if (layout === 'section')` pelo componente legado: a separação é de
// CAPACIDADE, não de layout.
//
// O que é de F1B/F1C fica em `ENCOUNTER_DEFERRED_MODULES`: nomeado e
// documentado para ninguém "esquecer" — e, principalmente, para ninguém
// reaproveitar o componente legado inteiro como núcleo do Clinical OS.
export const ENCOUNTER_CORE_CAPABILITIES = [
  'complaint', 'evolution', 'guidance', 'followUp', 'internalNote', 'tags',
] as const;

export type EncounterCoreCapability = typeof ENCOUNTER_CORE_CAPABILITIES[number];

/** Capacidades que o núcleo clínico suporta (F1A). */
export function encounterCoreCapabilities(): readonly EncounterCoreCapability[] {
  return ENCOUNTER_CORE_CAPABILITIES;
}

/** Uma capacidade é do núcleo? (a tela pergunta, nunca presume). */
export function supportsEncounterCapability(id: string): boolean {
  return (ENCOUNTER_CORE_CAPABILITIES as readonly string[]).includes(id);
}

/**
 * Módulos que EXISTEM no sistema legado e NÃO entram no workspace F1A.
 * Nada aqui é apagado: o EncounterSheet (legado) continua com eles, onde já
 * funcionava. Esta lista é a cerca do núcleo — é o que impede o vazamento.
 */
export const ENCOUNTER_DEFERRED_MODULES = [
  'anamnese',       // F1B — fichas/modelos de anamnese
  'arquivos',       // fase apropriada — anexos do atendimento
  'pagamento',      // conta/financeiro do atendimento
  'reabertura',     // reabrir registro finalizado (auditoria)
  'pos_atendimento',// "como fica o acompanhamento" — tarefa/retorno estruturado
  'especialidade',  // odontograma, estética e afins
] as const;

export type EncounterDeferredModule = typeof ENCOUNTER_DEFERRED_MODULES[number];

/** F1A: TODO módulo diferido está fora do núcleo (a cerca é total). */
export function isEncounterModuleDeferred(id: string): boolean {
  return (ENCOUNTER_DEFERRED_MODULES as readonly string[]).includes(id);
}

/**
 * F1A — o workspace NÃO é um card genérico: o cabeçalho precisa do paciente.
 * Este helper diz se há paciente identificado para protagonizar a tela; quando
 * não há, o workspace cai para o responsável (humano) sem inventar espécie.
 */
export function encounterSectionTitleFor(sectionId: string): string {
  return resolveEncounterSection(sectionId).label;
}

/**
 * Especialidades futuras (§15): o CORE do Encounter NÃO muda por vertical — o
 * que muda é quais seções entram. Nada aqui implementa odontologia/estética:
 * é só o ponto de extensão, sem odontograma, Fitzpatrick ou formulário
 * universal.
 */
export function isModuleAvailable(
  module: EncounterModuleId,
  clinicType?: unknown,
  _encounter?: Pick<Encounter, 'id'>,
): boolean {
  if (!isEncounterModuleEnabled(module, clinicType)) return false;
  if (module === 'core') return true;
  return ENCOUNTER_SECTIONS.some((s) => s.module === module && s.available);
}
