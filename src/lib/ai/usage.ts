// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — TELEMETRIA DE IA (contrato)
// ═══════════════════════════════════════════════════════════════
// Registra o CONSUMO de IA (decisões Jev + LLM generativa) para calcular
// custo por clínica. Campos do contrato da fundação:
//   businessId · agentId · feature · provider · model ·
//   inputTokens · outputTokens · audioSeconds · estimatedCost ·
//   latencyMs · decisionType · confidence · createdAt
//
// PRIVACIDADE: NUNCA armazena prompts clínicos completos — só números e
// identificadores. Dado sensível continua no prontuário/audit trail.
//
// PERSISTÊNCIA (F0/J): este é o SEGUNDO domínio que já nasce NORMALIZADO
// (tabela `ai_usage` — migration 0002). Nada de aiUsage dentro de
// instalink_doc. A porta de persistência é AiUsageStore (./usage-store).
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

export interface AiUsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
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
export function usageId(now: string): string {
  seq = (seq + 1) % 1_000_000;
  return `aiu-${now.slice(0, 10)}-${seq.toString(36).padStart(4, '0')}`;
}

/** Normaliza o input em um registro completo (PURO — sem I/O). */
export function buildAiUsageRecord(input: RecordAiUsageInput): AiUsageRecord {
  const now = input.now || new Date().toISOString();
  return {
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
}
