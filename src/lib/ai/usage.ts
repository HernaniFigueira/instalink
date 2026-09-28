// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — TELEMETRIA DE IA (custo por clínica)
// ═══════════════════════════════════════════════════════════════
// Registra o CONSUMO de IA (decisões Jev + LLM generativa) para calcular
// custo por clínica. Campos do contrato da fundação:
//   businessId · agentId · feature · provider · model ·
//   inputTokens · outputTokens · audioSeconds · estimatedCost ·
//   latencyMs · decisionType · confidence · createdAt
//
// PRIVACIDADE: NUNCA armazena prompts clínicos completos — só números e
// identificadores. Dado sensível continua no prontuário/audit trail.
import type { DB } from '../types';

export interface AiUsageRecord {
  id: string;
  businessId: string;
  agentId: string;
  feature: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Gravação/transcrição futura (F8) — segundos de áudio. */
  audioSeconds?: number;
  /** Custo estimado em USD (tabela configurável; 0 quando desconhecido). */
  estimatedCost: number;
  latencyMs: number;
  /** Tipo de decisão (Choice/Noul/Score/…) quando for o caso. */
  decisionType?: 'choice' | 'noul' | 'score' | 'generative';
  confidence?: number;
  createdAt: string;
}

export interface RecordAiUsageInput {
  businessId: string;
  agentId: string;
  feature: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  audioSeconds?: number;
  latencyMs: number;
  decisionType?: AiUsageRecord['decisionType'];
  confidence?: number;
  now?: string;
  id?: string;
}

/**
 * Tabela de preços (USD por 1M tokens) por (provider, model). Sem entrada
 * → custo 0 (não inventamos preço). Só servidor; nunca chave/segredo.
 */
export const AI_PRICE_TABLE: Record<string, { inputPerMillion: number; outputPerMillion: number }> = {
  'mock/mock-generative-v1': { inputPerMillion: 0, outputPerMillion: 0 },
};

export function estimateAiCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  const price = AI_PRICE_TABLE[`${provider}/${model}`];
  if (!price) return 0;
  return (inputTokens / 1_000_000) * price.inputPerMillion + (outputTokens / 1_000_000) * price.outputPerMillion;
}

let seq = 0;
function usageId(now: string): string {
  seq = (seq + 1) % 1_000_000;
  return `aiu-${now.slice(0, 10)}-${seq.toString(36).padStart(4, '0')}`;
}

/**
 * Persiste o registro de consumo (coleção aditiva `aiUsage`). Fail-open:
 * telemetria NUNCA derruba o fluxo clínico (se gravar falhar, a decisão já
 * foi tomada — só o número se perde e é logado).
 */
export function recordAiUsage(db: DB, input: RecordAiUsageInput): AiUsageRecord {
  const now = input.now || new Date().toISOString();
  const record: AiUsageRecord = {
    id: input.id || usageId(now),
    businessId: input.businessId,
    agentId: input.agentId,
    feature: input.feature,
    provider: input.provider,
    model: input.model,
    inputTokens: Math.max(0, Math.round(input.inputTokens)),
    outputTokens: Math.max(0, Math.round(input.outputTokens)),
    ...(input.audioSeconds != null ? { audioSeconds: input.audioSeconds } : {}),
    estimatedCost: estimateAiCost(input.provider, input.model, input.inputTokens, input.outputTokens),
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    ...(input.decisionType ? { decisionType: input.decisionType } : {}),
    ...(input.confidence != null ? { confidence: input.confidence } : {}),
    createdAt: now,
  };
  if (!Array.isArray(db.aiUsage)) db.aiUsage = [];
  db.aiUsage.push(record);
  return record;
}

/** Agregado de custo por clínica (para o Financeiro/Configurações futuro). */
export function aiUsageTotals(db: DB, businessId: string, opts?: { since?: string }): {
  calls: number; inputTokens: number; outputTokens: number; estimatedCost: number;
} {
  const rows = db.aiUsage.filter((r) => r.businessId === businessId && (!opts?.since || r.createdAt >= opts.since));
  return rows.reduce((acc, r) => ({
    calls: acc.calls + 1,
    inputTokens: acc.inputTokens + r.inputTokens,
    outputTokens: acc.outputTokens + r.outputTokens,
    estimatedCost: acc.estimatedCost + r.estimatedCost,
  }), { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 });
}
