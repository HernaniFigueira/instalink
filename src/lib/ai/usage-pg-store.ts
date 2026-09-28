// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — PostgresAiUsageStore (produção)
// ═══════════════════════════════════════════════════════════════
// Persistência NORMALIZADA da telemetria de IA: tabela `ai_usage`
// (fonte de verdade do DDL: db/migrations/0002_ai_usage.sql).
//
//   • NUNCA escreve em instalink_doc;
//   • tenant isolation: toda query passa por business_id;
//   • nunca guarda prompt clínico/transcrição — só números.
import { buildAiUsageRecord } from './usage';
import type { AiUsageRecord, AiUsageTotals, RecordAiUsageInput } from './usage';
import type { AiUsageStore } from './usage-store';
import { getPgPool } from '../pg';

/** Mesmo DDL de db/migrations/0002_ai_usage.sql (idempotente). */
const DDL = `
CREATE TABLE IF NOT EXISTS ai_usage (
  id              TEXT           PRIMARY KEY,
  business_id     TEXT           NOT NULL,
  agent_id        TEXT           NOT NULL,
  feature         TEXT           NOT NULL,
  provider        TEXT           NOT NULL,
  model           TEXT           NOT NULL,
  input_tokens    INTEGER        NOT NULL DEFAULT 0,
  output_tokens   INTEGER        NOT NULL DEFAULT 0,
  audio_seconds   DOUBLE PRECISION NULL,
  estimated_cost  DOUBLE PRECISION NOT NULL DEFAULT 0,
  latency_ms      INTEGER        NOT NULL DEFAULT 0,
  decision_type   TEXT           NULL,
  confidence      DOUBLE PRECISION NULL,
  created_at      TIMESTAMPTZ    NOT NULL,
  CONSTRAINT ai_usage_tokens_ck   CHECK (input_tokens >= 0 AND output_tokens >= 0),
  CONSTRAINT ai_usage_latency_ck  CHECK (latency_ms >= 0),
  CONSTRAINT ai_usage_confidence_ck CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);
CREATE INDEX IF NOT EXISTS ai_usage_business_created_idx
  ON ai_usage (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_business_agent_created_idx
  ON ai_usage (business_id, agent_id, created_at DESC);
`;

let ready: Promise<void> | null = null;

export function __resetAiUsageInitForTests(): void {
  ready = null;
}

async function ensureSchema(): Promise<void> {
  if (!ready) {
    ready = getPgPool().query(DDL).then(() => undefined).catch((err) => {
      ready = null;
      throw err;
    });
  }
  return ready;
}

interface Row {
  id: string;
  business_id: string;
  agent_id: string;
  feature: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  audio_seconds: number | null;
  estimated_cost: number | string;
  latency_ms: number;
  decision_type: string | null;
  confidence: number | null;
  created_at: Date | string;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function rowToRecord(row: Row): AiUsageRecord {
  return {
    id: row.id,
    businessId: row.business_id,
    agentId: row.agent_id,
    feature: row.feature,
    provider: row.provider,
    model: row.model,
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    ...(row.audio_seconds != null ? { audioSeconds: Number(row.audio_seconds) } : {}),
    estimatedCost: Number(row.estimated_cost),
    latencyMs: Number(row.latency_ms),
    ...(row.decision_type ? { decisionType: row.decision_type as AiUsageRecord['decisionType'] } : {}),
    ...(row.confidence != null ? { confidence: Number(row.confidence) } : {}),
    createdAt: iso(row.created_at),
  };
}

export class PostgresAiUsageStore implements AiUsageStore {
  async record(input: RecordAiUsageInput): Promise<AiUsageRecord> {
    const record = buildAiUsageRecord(input);
    await ensureSchema();
    await getPgPool().query(
      `INSERT INTO ai_usage (
         id, business_id, agent_id, feature, provider, model,
         input_tokens, output_tokens, audio_seconds, estimated_cost,
         latency_ms, decision_type, confidence, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        record.id, record.businessId, record.agentId, record.feature, record.provider, record.model,
        record.inputTokens, record.outputTokens, record.audioSeconds ?? null, record.estimatedCost,
        record.latencyMs, record.decisionType ?? null, record.confidence ?? null, record.createdAt,
      ],
    );
    return record;
  }

  async list(businessId: string, opts: { agentId?: string; since?: string; limit?: number } = {}): Promise<AiUsageRecord[]> {
    if (!businessId) throw new Error('businessId é obrigatório para listar ai_usage.');
    await ensureSchema();
    const limit = Math.max(1, Math.min(1000, opts.limit || 200));
    const where: string[] = ['business_id = $1'];
    const params: unknown[] = [businessId];
    if (opts.agentId) { params.push(opts.agentId); where.push(`agent_id = $${params.length}`); }
    if (opts.since) { params.push(opts.since); where.push(`created_at >= $${params.length}`); }
    params.push(limit);
    const res = await getPgPool().query(
      `SELECT * FROM ai_usage WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return (res.rows as Row[]).map(rowToRecord);
  }

  async totals(businessId: string, opts: { since?: string } = {}): Promise<AiUsageTotals> {
    if (!businessId) throw new Error('businessId é obrigatório para agregar ai_usage.');
    await ensureSchema();
    const params: unknown[] = [businessId];
    let sinceClause = '';
    if (opts.since) { params.push(opts.since); sinceClause = `AND created_at >= $${params.length}`; }
    const res = await getPgPool().query(
      `SELECT COUNT(*)::int AS calls,
              COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
              COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
              COALESCE(SUM(estimated_cost), 0)::float AS estimated_cost
       FROM ai_usage WHERE business_id = $1 ${sinceClause}`,
      params,
    );
    const row = res.rows[0] || {};
    return {
      calls: Number(row.calls || 0),
      inputTokens: Number(row.input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0),
      estimatedCost: Number(row.estimated_cost || 0),
    };
  }
}
