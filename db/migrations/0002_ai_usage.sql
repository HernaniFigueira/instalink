-- ═══════════════════════════════════════════════════════════════
-- 0002 · ai_usage — telemetria de IA normalizada (Clinical OS F0)
-- ═══════════════════════════════════════════════════════════════
-- Custo de IA por clínica: SÓ números e identificadores. NUNCA prompt
-- clínico completo, transcrição, prontuário ou resposta sensível.
-- Mesma política de 0001: fonte de verdade auditável; runtime idempotente;
-- schema `public`; naming snake_case; NÃO aplicar em produção aqui.

CREATE TABLE IF NOT EXISTS ai_usage (
  id              TEXT           PRIMARY KEY,
  business_id     TEXT           NOT NULL,         -- tenant isolation (raiz)
  agent_id        TEXT           NOT NULL,
  feature         TEXT           NOT NULL,
  provider        TEXT           NOT NULL,
  model           TEXT           NOT NULL,
  input_tokens    INTEGER        NOT NULL DEFAULT 0,
  output_tokens   INTEGER        NOT NULL DEFAULT 0,
  audio_seconds   DOUBLE PRECISION NULL,           -- gravação/transcrição futura
  estimated_cost  DOUBLE PRECISION NOT NULL DEFAULT 0,
  latency_ms      INTEGER        NOT NULL DEFAULT 0,
  decision_type   TEXT           NULL,             -- choice|noul|score|generative
  confidence      DOUBLE PRECISION NULL,
  created_at      TIMESTAMPTZ    NOT NULL,
  CONSTRAINT ai_usage_tokens_ck   CHECK (input_tokens >= 0 AND output_tokens >= 0),
  CONSTRAINT ai_usage_latency_ck  CHECK (latency_ms >= 0),
  CONSTRAINT ai_usage_confidence_ck CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

-- Relatório de custo por clínica (janela de tempo).
CREATE INDEX IF NOT EXISTS ai_usage_business_created_idx
  ON ai_usage (business_id, created_at DESC);

-- Custo por agente/feature dentro do tenant.
CREATE INDEX IF NOT EXISTS ai_usage_business_agent_created_idx
  ON ai_usage (business_id, agent_id, created_at DESC);
