-- ═══════════════════════════════════════════════════════════════
-- 0002 · godoutor_internal.ai_usage — telemetria de IA normalizada (Clinical OS F0)
-- ═══════════════════════════════════════════════════════════════
-- Custo de IA por clínica: SÓ números e identificadores. NUNCA prompt
-- clínico completo, transcrição, prontuário ou resposta sensível.
-- Mesma política de 0001: ÚNICA fonte de verdade do DDL (o runtime não faz
-- DDL); schema interno `godoutor_internal`; naming snake_case; SQL sempre
-- QUALIFICADO (nada de search_path); NÃO aplicar em produção aqui.
--
-- DINHEIRO EM NUMERIC, NÃO EM FLOAT: `estimated_cost NUMERIC(18,8)` — custo
-- estimado é valor monetário-ish e precisa de decimal exato com 8 casas
-- (preços por token são frações minúsculas; DOUBLE PRECISION introduziria
-- erro binário em somas de relatório).

CREATE SCHEMA IF NOT EXISTS godoutor_internal;

CREATE TABLE IF NOT EXISTS godoutor_internal.ai_usage (
  id              TEXT           PRIMARY KEY,      -- UUID v4 (crypto.randomUUID no app)
  business_id     TEXT           NOT NULL,         -- tenant isolation (raiz)
  agent_id        TEXT           NOT NULL,
  feature         TEXT           NOT NULL,
  provider        TEXT           NOT NULL,
  model           TEXT           NOT NULL,
  input_tokens    INTEGER        NOT NULL DEFAULT 0,
  output_tokens   INTEGER        NOT NULL DEFAULT 0,
  audio_seconds   DOUBLE PRECISION NULL,          -- gravação/transcrição futura
  estimated_cost  NUMERIC(18,8)  NOT NULL DEFAULT 0,
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
  ON godoutor_internal.ai_usage (business_id, created_at DESC);

-- Custo por agente/feature dentro do tenant.
CREATE INDEX IF NOT EXISTS ai_usage_business_agent_created_idx
  ON godoutor_internal.ai_usage (business_id, agent_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- NASCE FECHADA — mesmo contrato de 0001: tabelas de telemetria/auditoria
-- NÃO são API pública. Acesso legítimo = backend (owner da DATABASE_URL).
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON godoutor_internal.ai_usage FROM PUBLIC;

DO $$
DECLARE
  rol text;
BEGIN
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF to_regrole(rol) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON godoutor_internal.ai_usage FROM %I', rol);
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  rol text;
BEGIN
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF to_regrole(rol) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON SCHEMA godoutor_internal FROM %I', rol);
    END IF;
  END LOOP;
END
$$;
