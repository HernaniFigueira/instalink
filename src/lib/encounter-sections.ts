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
import type { Encounter } from './types';

export type EncounterModuleId = 'core' | 'vet' | 'odontology' | 'aesthetics';

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
  // ── Estrutura planejada (F1B/F1C) — NÃO renderizada enquanto indisponível ──
  { id: 'anamnese', label: 'Anamnese', module: 'core', order: 20, available: false },
  { id: 'avaliacao', label: 'Avaliação', module: 'core', order: 30, available: false },
  { id: 'problemas', label: 'Problemas', module: 'core', order: 40, available: false },
  { id: 'conduta', label: 'Conduta', module: 'core', order: 50, available: false },
  { id: 'procedimentos', label: 'Procedimentos', module: 'vet', order: 60, available: false },
  { id: 'anexos', label: 'Anexos', module: 'core', order: 70, available: false },
];

/** Seções REAIS de um atendimento, na ordem canônica. */
export function availableEncounterSections(): EncounterSectionDef[] {
  return ENCOUNTER_SECTIONS.filter((s) => s.available).sort((a, b) => a.order - b.order);
}

/** Seção inicial do workspace (nunca depende de ordem de array de dados). */
export function firstEncounterSectionId(): string {
  return availableEncounterSections()[0]?.id || 'atendimento';
}

/** Resolve a seção ativa: id existe e está disponível, senão a inicial. */
export function resolveEncounterSection(id: string | null | undefined): EncounterSectionDef {
  const found = ENCOUNTER_SECTIONS.find((s) => s.id === id && s.available);
  return found || availableEncounterSections()[0] || ENCOUNTER_SECTIONS[0];
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
export function isModuleAvailable(module: EncounterModuleId, _encounter?: Pick<Encounter, 'id'>): boolean {
  if (module === 'core') return true;
  return ENCOUNTER_SECTIONS.some((s) => s.module === module && s.available);
}
