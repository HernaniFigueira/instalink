// ═══════════════════════════════════════════════════════════════
// GODOUTOR CLINICAL OS · F0 — AiUsageStore (porta de persistência)
// ═══════════════════════════════════════════════════════════════
// O domínio depende DESTA porta — nunca de SQL nem de instalink_doc.
//
//   • PostgresAiUsageStore (./usage-pg-store) → produção (DATABASE_URL):
//     tabela normalizada `godoutor_internal.ai_usage` (migration 0002 — única autoridade de DDL).
//   • MemoryAiUsageStore (aqui)             → testes/dev local (sem rede).
//
// REGRA (F0/J): telemetria de IA NÃO é armazenada em instalink_doc.
// PRIVACIDADE: só números/identificadores — nunca prompt/transcrição.
import { buildAiUsageRecord } from './usage';
import type { AiUsageRecord, AiUsageTotals, RecordAiUsageInput } from './usage';

/** Porta única de persistência da telemetria de IA (async). */
export interface AiUsageStore {
  /** Persiste o consumo. Fail-open: telemetria nunca derruba fluxo clínico. */
  record(input: RecordAiUsageInput): Promise<AiUsageRecord>;
  /** Leitura SEMPRE escopada por tenant. */
  list(businessId: string, opts?: { agentId?: string; since?: string; limit?: number }): Promise<AiUsageRecord[]>;
  /** Agregado de custo por clínica. */
  totals(businessId: string, opts?: { since?: string }): Promise<AiUsageTotals>;
}

/** Adapter de memória — testes e dev local (sem banco, sem rede). */
export class MemoryAiUsageStore implements AiUsageStore {
  private readonly rows: AiUsageRecord[] = [];

  async record(input: RecordAiUsageInput): Promise<AiUsageRecord> {
    const record = buildAiUsageRecord(input);
    this.rows.push(record);
    return record;
  }

  async list(businessId: string, opts: { agentId?: string; since?: string; limit?: number } = {}): Promise<AiUsageRecord[]> {
    const limit = Math.max(1, Math.min(1000, opts.limit || 200));
    return this.rows
      .filter((r) => r.businessId === businessId)
      .filter((r) => (!opts.agentId || r.agentId === opts.agentId))
      .filter((r) => (!opts.since || r.createdAt >= opts.since))
      .slice(-limit)
      .reverse();
  }

  async totals(businessId: string, opts: { since?: string } = {}): Promise<AiUsageTotals> {
    return this.rows
      .filter((r) => r.businessId === businessId && (!opts.since || r.createdAt >= opts.since))
      .reduce((acc, r) => ({
        calls: acc.calls + 1,
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
        estimatedCost: acc.estimatedCost + r.estimatedCost,
      }), { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 });
  }
}

/** Factory: COM DATABASE_URL → Postgres normalizado; sem → memória (dev). */
export async function getAiUsageStore(): Promise<AiUsageStore> {
  const { isPgConfigured } = await import('../pg');
  if (isPgConfigured()) {
    const { PostgresAiUsageStore } = await import('./usage-pg-store');
    return new PostgresAiUsageStore();
  }
  return new MemoryAiUsageStore();
}
