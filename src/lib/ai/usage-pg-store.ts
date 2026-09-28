// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — PostgresAiUsageStore (produção)
// ═══════════════════════════════════════════════════════════════
// Persistência NORMALIZADA da telemetria de IA: tabela
// `godoutor_internal.ai_usage`.
//
//   • NUNCA escreve em instalink_doc;
//   • tenant isolation: toda query passa por business_id;
//   • nunca guarda prompt clínico/transcrição — só números;
//   • SEM DDL AQUI. A única autoridade estrutural é
//     db/migrations/0002_ai_usage.sql; o runtime só SELECT/INSERT.
//     Migration ausente ⇒ falha EXPLÍCITA (42P01 traduzido).
//   • Todo SQL QUALIFICADO com `godoutor_internal.` — zero confiança em
//     search_path de conexão compartilhada.
//   • `estimated_cost` é NUMERIC(18,8) no banco: o driver devolve STRING
//     decimal — convertemos com Number() na leitura; nunca DOUBLE no DDL.
import { buildAiUsageRecord } from './usage';
import type { AiUsageRecord, AiUsageTotals, RecordAiUsageInput } from './usage';
import type { AiUsageStore } from './usage-store';
import { getPgPool } from '../pg';

/** Tabela SEMPRE qualificada — única forma de referenciá-la no runtime. */
export const AI_USAGE_TABLE = 'godoutor_internal.ai_usage';

/** Migration ausente ⇒ erro acionável que aponta o DDL canônico (0002). */
export function assertMigrationApplied(err: unknown): never {
  const code = (err as { code?: string } | null)?.code;
  if (code === '42P01' || code === '3F000') {
    throw new Error(
      `Migration ausente: ${AI_USAGE_TABLE} não existe. ` +
      'Aplique db/migrations/0002_ai_usage.sql (a única autoridade de DDL — o runtime não cria tabelas).',
    );
  }
  throw err;
}

async function runQuery(sql: string, params?: unknown[]): Promise<unknown[]> {
  try {
    const res = await getPgPool().query(sql, params);
    return res.rows as unknown[];
  } catch (err) {
    assertMigrationApplied(err);
  }
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
  /** NUMERIC(18,8) chega como string decimal do driver pg. */
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
    await runQuery(
      `INSERT INTO ${AI_USAGE_TABLE} (
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
    const limit = Math.max(1, Math.min(1000, opts.limit || 200));
    const where: string[] = ['business_id = $1'];
    const params: unknown[] = [businessId];
    if (opts.agentId) { params.push(opts.agentId); where.push(`agent_id = $${params.length}`); }
    if (opts.since) { params.push(opts.since); where.push(`created_at >= $${params.length}`); }
    params.push(limit);
    const res = (await runQuery(
      `SELECT * FROM ${AI_USAGE_TABLE} WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    )) as Row[];
    return res.map(rowToRecord);
  }

  async totals(businessId: string, opts: { since?: string } = {}): Promise<AiUsageTotals> {
    if (!businessId) throw new Error('businessId é obrigatório para agregar ai_usage.');
    const params: unknown[] = [businessId];
    let sinceClause = '';
    if (opts.since) { params.push(opts.since); sinceClause = `AND created_at >= $${params.length}`; }
    // SUM de NUMERIC devolve decimal EXATO como string — mantemos NUMERIC
    // (cast ::numeric), nunca ::float: precisão binária não entra em dinheiro.
    const res = (await runQuery(
      `SELECT COUNT(*)::int AS calls,
              COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
              COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
              COALESCE(SUM(estimated_cost), 0)::numeric AS estimated_cost
       FROM ${AI_USAGE_TABLE} WHERE business_id = $1 ${sinceClause}`,
      params,
    )) as Partial<Record<'calls' | 'input_tokens' | 'output_tokens' | 'estimated_cost', unknown>>[];
    const row = res[0] || {};
    return {
      calls: Number(row.calls || 0),
      inputTokens: Number(row.input_tokens || 0),
      outputTokens: Number(row.output_tokens || 0),
      estimatedCost: Number(row.estimated_cost || 0),
    };
  }
}
