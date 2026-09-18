// ═══════════════════════════════════════════════════════════════
// ETAPAS DO PIPELINE — resolução e normalização (módulo PURO)
// ═══════════════════════════════════════════════════════════════
// A1.2 · Bloco 2: a lógica de resolução/normalização de etapas é
// compartilhada pelo servidor E pela UI do funil. Por isso vive num módulo
// sem I/O e sem imports de Node (o `lib/pipeline.ts` usa `node:crypto` e não
// pode ser empacotado em componente de cliente). Nenhum import de runtime
// aqui além de TIPOS — continua testável e reutilizável.
//
// REGRAS (F1/F3 do Bloco 2):
//   • PipelineStage é a ÚNICA máquina de estados oficial; LeadStatus legado é
//     convertido explicitamente (stageForLegacyStatus) — nunca escrito cru;
//   • leitura com etapa ausente/inválida/inexistente é normalizada com
//     fallback EXPLÍCITO (primeira etapa da esteira) — sem etapa inventada.
import type { BusinessPipeline, Lead, LeadStatus, PipelineStage } from './types';

export const STAGE_ALIASES: Record<string, string> = {
  novo: 'new',
  new: 'new',
  em_atendimento: 'in_progress',
  in_progress: 'in_progress',
  qualificando: 'qualifying',
  qualifying: 'qualifying',
  qualificado: 'qualified',
  qualified: 'qualified',
  aguardando_secretaria: 'waiting_secretary',
  waiting_secretary: 'waiting_secretary',
  agendado: 'scheduled',
  scheduled: 'scheduled',
  concluido: 'converted',
  converted: 'converted',
  perdido: 'lost',
  lost: 'lost',
};

export const LEGACY_LEAD_STATUSES: LeadStatus[] = ['new', 'contacted', 'qualified', 'converted', 'lost'];

/** O valor é um LeadStatus legado conhecido? */
export function isLegacyLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === 'string' && (LEGACY_LEAD_STATUSES as string[]).includes(value);
}

/** Etapas do negócio na ordem declarada (order crescente). */
export function stagesInOrder(pipeline: BusinessPipeline): PipelineStage[] {
  return [...(pipeline.stages || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
}

/**
 * Etapa OFICIAL do negócio correspondente a um LeadStatus legado.
 * Regra explícita: (1) etapa com o MESMO id do status; (2) senão, a primeira
 * etapa (em ordem) cujo `mappedStatus` seja o status. '' quando não há
 * correspondência — o chamador decide o erro (nunca inventamos etapa).
 */
export function stageForLegacyStatus(pipeline: BusinessPipeline, status: LeadStatus): string {
  const stages = stagesInOrder(pipeline);
  const byId = stages.find((s) => s.id === status);
  if (byId) return byId.id;
  const byMapped = stages.find((s) => s.mappedStatus === status);
  return byMapped ? byMapped.id : '';
}

export interface ResolvedStage {
  /** Etapa VÁLIDA na esteira do negócio (nunca id inventado). */
  stageId: string;
  /** true = a entrada não era uma etapa válida e houve conversão/fallback. */
  normalized: boolean;
}

/**
 * Resolve QUALQUER entrada (etapa, alias pt/br ou LeadStatus legado) para uma
 * etapa VÁLIDA da esteira do negócio — F1/F3. Fallback explícito: primeira
 * etapa da esteira (em ordem). Nunca lança e nunca inventa etapa.
 */
export function resolveStageId(pipeline: BusinessPipeline, candidate?: string | null): ResolvedStage {
  const stages = stagesInOrder(pipeline);
  const first = stages[0]?.id || 'new';
  const raw = String(candidate ?? '').trim();
  if (!raw) return { stageId: first, normalized: true };
  const aliased = STAGE_ALIASES[raw] || raw;
  if (stages.some((s) => s.id === aliased)) return { stageId: aliased, normalized: aliased !== raw };
  if (isLegacyLeadStatus(raw)) {
    const mapped = stageForLegacyStatus(pipeline, raw);
    if (mapped) return { stageId: mapped, normalized: true };
  }
  return { stageId: first, normalized: true };
}

/**
 * Leitura normalizada do estado do lead (F3): resolve `stageId` (ou o
 * `status` legado quando o estágio não foi gravado) para uma etapa VÁLIDA da
 * esteira do negócio. Nunca devolve etapa inexistente.
 */
export function normalizeLeadStageId(
  pipeline: BusinessPipeline,
  lead: Pick<Lead, 'stageId' | 'status'>,
): string {
  return resolveStageId(pipeline, lead?.stageId || lead?.status || '').stageId;
}
