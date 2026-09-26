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
import type { Encounter, EncounterFile, EncounterFollowUpMode, EncounterStatus } from './types';

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
    hint: 'Registro fechado no fim do atendimento. Alterações ficam registradas na auditoria.',
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
 * A3.4 (teste humano) — A VIA DO CLIENTE SAI DO QUE ESTÁ NA TELA AGORA.
 *
 * A impressão lia o `row` (último payload confirmado pelo servidor), enquanto
 * a pessoa digita no formulário e o autosave é assíncrono: quem digitava e
 * clicava em "Imprimir" levava papel em branco. A regra é simples e vale para
 * sempre: o que sai no papel é o que está VISÍVEL nos campos no instante do
 * clique — os metadados (cliente, data, profissional, situação) continuam
 * vindo do registro.
 *
 * A anotação interna continua FORA: não é via do cliente.
 */
export function encounterFormPrintBlocks(form: EncounterDraftForm): EncounterPrintBlock[] {
  const blocks: EncounterPrintBlock[] = [];
  const push = (label: string, value: string) => { if (value && value.trim()) blocks.push({ label, text: value.trim() }); };
  push('O que o cliente procurou', form.complaint);
  push('O que foi feito', form.evolution);
  push('Orientações', form.guidance);
  push('Retorno sugerido', form.followUp);
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

/** Formulário da tela: os campos de texto + etiquetas como TEXTO (vírgula).
 * FASE 2 · P3 — retorno estruturado é ADITIVO (opcional): formulários legados
 * (e testes) sem esses campos continuam válidos. */
export interface EncounterDraftForm {
  complaint: string;
  evolution: string;
  guidance: string;
  followUp: string;
  internalNote: string;
  tags: string;
  /** '' = nenhuma escolha ainda (payload omite e o servidor mantém o default). */
  followUpMode?: EncounterFollowUpMode | '';
  followUpDate?: string;
  followUpDays?: number;
}

// ── FASE 2 · P3 — retorno estruturado (sem retorno · data · intervalo) ──
export const FOLLOW_UP_MODES: EncounterFollowUpMode[] = ['none', 'date', 'interval', 'custom'];

export const FOLLOW_UP_MODE_LABELS: Record<EncounterFollowUpMode, string> = {
  none: 'Sem retorno', date: 'Data específica', interval: 'Intervalo', custom: 'Texto livre',
};

export function isFollowUpMode(v: unknown): v is EncounterFollowUpMode {
  return typeof v === 'string' && (FOLLOW_UP_MODES as string[]).includes(v);
}

/** Valida o trio (mode/date/days) com mensagem amigável. '' = ok. */
export function validateFollowUp(input: {
  followUpMode?: unknown; followUpDate?: unknown; followUpDays?: unknown;
}): string {
  const mode = input.followUpMode;
  if (mode === undefined || mode === null || mode === '') return '';
  if (!isFollowUpMode(mode)) return 'Forma de retorno inválida.';
  if (mode === 'date') {
    const d = String(input.followUpDate || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return 'Informe a data do retorno.';
    if (Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return 'Data do retorno inválida.';
  }
  if (mode === 'interval') {
    const n = Number(input.followUpDays);
    if (!Number.isFinite(n) || n < 1 || n > 730) return 'Informe o intervalo em dias (1 a 730).';
  }
  return '';
}

/**
 * Data-alvo do retorno (YYYY-MM-DD) para agendar/tarefa:
 *   date → a própria data; interval → data do atendimento + N dias; demais → ''.
 * Puro: sem relógio global — a data do atendimento vem do registro.
 */
export function followUpDueDate(row: Pick<Encounter, 'date' | 'followUpMode' | 'followUpDate' | 'followUpDays'>): string {
  if (row.followUpMode === 'date' && row.followUpDate) return row.followUpDate;
  if (row.followUpMode === 'interval' && row.date && Number(row.followUpDays) > 0) {
    const base = Date.parse(`${row.date}T00:00:00Z`);
    if (Number.isNaN(base)) return '';
    return new Date(base + Number(row.followUpDays) * 86400000).toISOString().slice(0, 10);
  }
  return '';
}

/** Higieniza os arquivos do atendimento (só referências; binário fica no Storage). */
export function cleanEncounterFiles(value: unknown): EncounterFile[] {
  const list = Array.isArray(value) ? value : [];
  const out: EncounterFile[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const f = raw as Partial<EncounterFile>;
    const id = String(f.id || '').slice(0, 64);
    const url = String(f.url || '');
    if (!id || !url || seen.has(id)) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    seen.add(id);
    out.push({
      id,
      name: String(f.name || 'arquivo').slice(0, 160),
      url: url.slice(0, 600),
      size: Number.isFinite(Number(f.size)) ? Math.max(0, Math.round(Number(f.size))) : 0,
      createdAt: String(f.createdAt || ''),
      by: String(f.by || ''),
    });
    if (out.length >= 12) break; // teto por registro
  }
  return out;
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
    // FASE 2 · P3 — retorno estruturado participa da assinatura (sem isso o
    // autosave ignoraria a troca de modo/data/intervalo).
    form.followUpMode ?? '', form.followUpDate ?? '', form.followUpDays ?? '',
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
    // FASE 2 · P3 — retorno estruturado (aditivo: só sai quando a tela tem).
    ...(form.followUpMode ? { followUpMode: form.followUpMode } : {}),
    ...(form.followUpMode === 'date' ? { followUpDate: form.followUpDate || '' } : {}),
    ...(form.followUpMode === 'interval' ? { followUpDays: Number(form.followUpDays) || 0 } : {}),
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
  if (!hasExpectedVersion(expected)) return { conflict: true, message: ENCOUNTER_VERSION_REQUIRED_ERROR };
  const want = Number(expected);
  return want === encounterVersion(current)
    ? { conflict: false }
    : { conflict: true, message: ENCOUNTER_VERSION_ERROR };
}

/**
 * `expectedVersion` só serve se vier de verdade. A API do Encounter é NOVA:
 * não existe chamador legado para proteger, então NÃO há caminho "sem trava" —
 * editar sem informar a revisão seria justamente o overwrite silencioso que a
 * revisão mandou fechar.
 */
export function hasExpectedVersion(expected: unknown): boolean {
  if (expected === undefined || expected === null || expected === '') return false;
  const want = Number(expected);
  return Number.isFinite(want) && want > 0;
}

/** Título da tarefa criada quando o retorno fica com a recepção. */
export function followUpTaskTitle(customerName: string): string {
  const who = String(customerName || '').trim() || 'cliente';
  return `Agendar retorno de ${who}`.slice(0, 140);
}

/**
 * Nota da tarefa de retorno: a instrução curta de quem atendeu + o retorno já
 * anotado no registro — SEM repetir o mesmo texto duas vezes.
 *
 * Antes, a tela semeava o campo com o próprio `followUp` e a nota juntava os
 * dois: saía "retorno em 30 dias · retorno em 30 dias". Agora a comparação é
 * normalizada (espaços/caixa) e o texto idêntico entra UMA vez.
 */
export function followUpTaskNote(followUp: string, instruction: string): string {
  const follow = String(followUp || '').trim();
  const extra = String(instruction || '').trim();
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const parts = extra && same(extra, follow) ? [follow] : [extra, follow];
  return parts.filter(Boolean).join(' · ').slice(0, 1000);
}

export const ENCOUNTER_VERSION_REQUIRED_ERROR =
  'Informe a revisão do atendimento (expectedVersion) para salvar — sem ela não é possível garantir que ninguém sobrescreveu este registro.';

/** Revisão do registro; documento legado (sem campo) vale 1. */
export function encounterVersion(row: { version?: number } | null | undefined): number {
  const v = Number(row?.version);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export const ENCOUNTER_VERSION_ERROR =
  'Este atendimento foi atualizado em outra aba. Recarregue antes de salvar.';

/**
 * A3.4 fix (2ª revisão) — REGISTRO FINALIZADO É **READ ONLY PARA TODOS**.
 *
 * Antes, quem tinha poder de reabrir (OWNER/ADMIN) podia editar os campos
 * enquanto o documento ainda estava `finalized`: a tela deixava digitar e o
 * erro só aparecia no salvar (409 do servidor). Isso é mentira de interface.
 *
 * `canReopen` agora controla SOMENTE a exibição do botão "Reabrir para
 * editar". Enquanto o status for `finalized`, os campos ficam desabilitados
 * para qualquer papel; depois de `action:'reopen'` o status vira `draft` e a
 * edição volta a valer.
 */
export function canEditEncounter(e: Pick<Encounter, 'status'>, _opts?: { canReopen?: boolean }): boolean {
  return e.status === 'draft';
}

/** Quem pode REABRIR (mesma régua do servidor: dono da unidade e administração). */
export function canReopenEncounter(role: unknown): boolean {
  const r = String(role || '').toUpperCase();
  return r === 'OWNER' || r === 'ADMIN' || r === 'MASTER';
}

/**
 * A3.4 fix (2ª revisão) — o que fazer com a resposta de um save.
 *
 * O profissional digita enquanto o request está em voo. Quando a resposta
 * chega, ela descreve o que foi GRAVADO (`sentKey`), não o que está na tela.
 * Regra: adota o texto do servidor SÓ se ninguém mexeu no formulário desde o
 * envio. Se mexeu, o texto novo fica onde está e o próximo ciclo salva o
 * restante já com a versão atualizada.
 */
export function applySaveResult(args: { sentKey: string; currentKey: string; serverVersion: number }): {
  /** true = pode adotar o formulário do servidor (ninguém digitou durante o envio). */
  adoptServerForm: boolean;
  /** O que foi efetivamente gravado — é a nova referência de "sem mudanças". */
  lastSavedKey: string;
  /** Revisão devolvida pelo servidor: base do PRÓXIMO save. */
  baseVersion: number;
} {
  return {
    adoptServerForm: args.currentKey === args.sentKey,
    lastSavedKey: args.sentKey,
    baseVersion: encounterVersion({ version: args.serverVersion }),
  };
}

/**
 * Registro do walk-in: 1 entrada da fila → no máximo 1 registro. Sem isso, um
 * cliente sem agendamento podia ganhar dois atendimentos por abrir a tela
 * duas vezes (o 1:1 do booking não cobre quem não tem booking).
 */
export function encounterForQueue(rows: Encounter[], businessId: string, queueId: string): Encounter | null {
  if (!queueId) return null;
  return (rows || []).find((e) => e.businessId === businessId && e.queueId === queueId) || null;
}

/**
 * Escopo do profissional (mesma regra da agenda): um login vinculado a um
 * profissional só lê/escreve o PRÓPRIO registro. '' = sem restrição.
 */
export function encounterInScope(e: Pick<Encounter, 'professionalId'>, professionalScope: string): boolean {
  if (!professionalScope) return true;
  return e.professionalId === professionalScope;
}
