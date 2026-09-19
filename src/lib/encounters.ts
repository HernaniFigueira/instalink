// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 5 — REGISTRO DO ATENDIMENTO (regras puras)
// ═══════════════════════════════════════════════════════════════
// Um registro de atendimento é documento, não anotação solta:
//   • tem um DONO (quem atendeu) e pertence a UMA unidade;
//   • nasce rascunho e é FINALIZADO — depois disso, mudar é decisão explícita,
//     registrada e auditada (o texto que o cliente levou para casa não pode
//     mudar em silêncio);
//   • o que sai impresso é só o que é do cliente: anotação interna NUNCA é
//     impressa na via entregue.
//
// Sem I/O e sem relógio global: o servidor passa `now` e o autor.
import type { Encounter, EncounterStatus } from './types';

export interface EncounterStatusDef {
  id: EncounterStatus;
  label: string;
  hint: string;
  tone: 'amber' | 'green';
}

export const ENCOUNTER_STATUS: Record<EncounterStatus, EncounterStatusDef> = {
  draft: {
    id: 'draft', label: 'Rascunho', tone: 'amber',
    hint: 'Ainda pode ser editado livremente — o cliente não recebeu esta via.',
  },
  finalized: {
    id: 'finalized', label: 'Finalizado', tone: 'green',
    hint: 'Registro fechado e assinado. Alterações ficam registradas na auditoria.',
  },
};

/** Campos de texto do registro (na ordem em que aparecem na tela). */
export const ENCOUNTER_TEXT_FIELDS = ['complaint', 'evolution', 'guidance', 'followUp', 'internalNote'] as const;
export type EncounterTextField = typeof ENCOUNTER_TEXT_FIELDS[number];

export const ENCOUNTER_LIMITS: Record<EncounterTextField, number> = {
  complaint: 600,
  evolution: 4000,
  guidance: 2000,
  followUp: 200,
  internalNote: 2000,
};

export const ENCOUNTER_TAGS_MAX = 8;
export const ENCOUNTER_TAG_LEN = 40;

/** Rótulos humanos — usados na tela, na impressão e nos testes. */
export const ENCOUNTER_LABELS: Record<EncounterTextField, string> = {
  complaint: 'O que o cliente procurou',
  evolution: 'O que foi feito',
  guidance: 'Orientações para o cliente',
  followUp: 'Retorno sugerido',
  internalNote: 'Anotação interna (não sai na via do cliente)',
};

/** Higieniza o texto: espaços normalizados e teto por campo. */
export function cleanText(value: unknown, field: EncounterTextField): string {
  const raw = typeof value === 'string' ? value : '';
  return raw.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim().slice(0, ENCOUNTER_LIMITS[field]);
}

/** Etiquetas: sem repetição, sem vazio, com teto (mesma régua do CRM). */
export function cleanTags(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [];
  const out: string[] = [];
  for (const item of list) {
    const tag = String(item || '').trim().slice(0, ENCOUNTER_TAG_LEN);
    if (!tag) continue;
    if (out.some((x) => x.toLowerCase() === tag.toLowerCase())) continue;
    out.push(tag);
    if (out.length >= ENCOUNTER_TAGS_MAX) break;
  }
  return out;
}

/**
 * O registro tem conteúdo suficiente para ser finalizado? Rascunho vazio é
 * permitido (a pessoa começou a escrever), mas FINALIZAR sem dizer o que foi
 * feito produz um documento inútil — e é o documento que o cliente leva.
 */
export function canFinalize(e: Pick<Encounter, 'evolution' | 'complaint' | 'guidance'>): { ok: boolean; error: string } {
  const hasBody = [e.evolution, e.complaint, e.guidance].some((t) => (t || '').trim().length >= 3);
  return hasBody ? { ok: true, error: '' } : {
    ok: false,
    error: 'Escreva ao menos o que foi feito (ou o que o cliente procurou) antes de finalizar.',
  };
}

/** Já existe registro para este agendamento? (1:1 por booking) */
export function encounterForBooking(encounters: Encounter[], businessId: string, bookingId: string): Encounter | null {
  if (!bookingId) return null;
  return encounters.find((e) => e.businessId === businessId && e.bookingId === bookingId) || null;
}

/**
 * Registros de um cliente (mais recentes primeiro) — alimenta o 360.
 * O casamento é por IDENTIDADE (contato do CRM ou conta do cliente), nunca por
 * nome: "Ana" não é chave de nada. Quem só tem o telefone resolve o contato
 * antes (a rota faz isso com o `phoneKey` da base).
 */
export function encountersForCustomer(
  encounters: Encounter[], businessId: string, keys: { contactId?: string; customerId?: string },
): Encounter[] {
  const contactId = keys.contactId || '';
  const customerId = keys.customerId || '';
  if (!contactId && !customerId) return [];
  return encounters
    .filter((e) => e.businessId === businessId && (
      (!!contactId && e.contactId === contactId) || (!!customerId && e.customerId === customerId)
    ))
    .sort((a, b) => (a.date + a.time === b.date + b.time ? (a.createdAt < b.createdAt ? 1 : -1) : (a.date + a.time < b.date + b.time ? 1 : -1)));
}

/** Resumo de uma linha — usado em lista e no histórico do cliente. */
export function encounterSummary(e: Pick<Encounter, 'evolution' | 'complaint'>): string {
  const text = (e.evolution || e.complaint || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Sem descrição';
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

export interface EncounterPrintBlock {
  label: string;
  text: string;
}

/**
 * O que vai para a VIA DO CLIENTE, na ordem de leitura. Anotação interna fica
 * fora por decisão de produto (é registro de quem atende), e o rodapé leva o
 * nome de quem assinou.
 */
export function encounterPrintBlocks(e: Encounter): EncounterPrintBlock[] {
  const blocks: EncounterPrintBlock[] = [];
  const push = (label: string, value: string) => { if (value && value.trim()) blocks.push({ label, text: value.trim() }); };
  push('O que o cliente procurou', e.complaint);
  push('O que foi feito', e.evolution);
  push('Orientações', e.guidance);
  push('Retorno sugerido', e.followUp);
  return blocks;
}

/**
 * Assinatura do documento: "Fulano (Profissional)" quando o autor é um
 * profissional da unidade, senão o nome de quem registrou.
 */
export function encounterSignature(e: Pick<Encounter, 'signedBy' | 'finalizedBy'>, fallback = 'Equipe'): string {
  return (e.signedBy || e.finalizedBy || fallback).trim();
}

/**
 * Quem pode ALTERAR um registro: rascunho é livre para quem tem a permissão
 * (e está no escopo); finalizado só é alterado por quem pode reabrir.
 */
// ── Editor do registro (autosave) ──────────────────────────────────────────
/** Silêncio depois da última tecla antes do autosave (nem ansioso, nem perdido). */
export const ENCOUNTER_AUTOSAVE_MS = 1000;

/** Formulário da tela: os campos de texto + etiquetas como TEXTO (vírgula). */
export interface EncounterDraftForm {
  complaint: string;
  evolution: string;
  guidance: string;
  followUp: string;
  internalNote: string;
  tags: string;
}

export const ENCOUNTER_AUTOSAVE_LABELS = {
  saving: 'Salvando…',
  saved: 'Salvo agora',
  error: 'Erro ao salvar',
} as const;

/** Assinatura do conteúdo: o autosave reage a MUDANÇA REAL, não a tecla. */
export function encounterDraftKey(form: EncounterDraftForm): string {
  return JSON.stringify([
    form.complaint ?? '', form.evolution ?? '', form.guidance ?? '',
    form.followUp ?? '', form.internalNote ?? '', form.tags ?? '',
  ]);
}

/**
 * Corpo do PATCH de conteúdo. `expectedVersion` só entra quando a tela sabe a
 * revisão do registro — sem ele a trava não age (chamador legado).
 */
export function encounterContentPayload(
  businessId: string, id: string, form: EncounterDraftForm, expectedVersion?: number,
) {
  return {
    businessId, id,
    complaint: form.complaint, evolution: form.evolution, guidance: form.guidance,
    followUp: form.followUp, internalNote: form.internalNote,
    tags: String(form.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
  };
}

/**
 * A3.4 fix (revisão B5) — trava de concorrência otimista.
 *
 * O `expectedVersion` é OPCIONAL (chamador legado/script continua funcionando),
 * mas quando vem precisa bater com a revisão atual do servidor. Sem isso duas
 * abas sobrescrevem uma à outra sem ninguém perceber.
 */
export function versionConflict(
  current: { version?: number } | null | undefined,
  expected: unknown,
): { conflict: false } | { conflict: true; message: string } {
  if (expected === undefined || expected === null || expected === '') return { conflict: false };
  const want = Number(expected);
  if (!Number.isFinite(want)) return { conflict: false };
  return want === encounterVersion(current)
    ? { conflict: false }
    : { conflict: true, message: ENCOUNTER_VERSION_ERROR };
}

/** Revisão do registro; documento legado (sem campo) vale 1. */
export function encounterVersion(row: { version?: number } | null | undefined): number {
  const v = Number(row?.version);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export const ENCOUNTER_VERSION_ERROR =
  'Este atendimento foi atualizado em outra aba. Recarregue antes de salvar.';

export function canEditEncounter(e: Pick<Encounter, 'status'>, opts: { canReopen: boolean }): boolean {
  return e.status === 'draft' ? true : opts.canReopen;
}

/**
 * Escopo do profissional (mesma regra da agenda): um login vinculado a um
 * profissional só lê/escreve o PRÓPRIO registro. '' = sem restrição.
 */
export function encounterInScope(e: Pick<Encounter, 'professionalId'>, professionalScope: string): boolean {
  if (!professionalScope) return true;
  return e.professionalId === professionalScope;
}
