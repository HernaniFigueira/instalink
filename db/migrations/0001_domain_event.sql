-- ═══════════════════════════════════════════════════════════════
-- 0001 · domain_event — EventLog normalizado (Clinical OS F0)
-- ═══════════════════════════════════════════════════════════════
-- PRIMEIRO domínio novo que já nasce NORMALIZADO (fora de instalink_doc).
-- Este arquivo é a FONTE DE VERDADE auditável do DDL; o runtime aplica o
-- MESMO DDL de forma idempotente (CREATE ... IF NOT EXISTS) no boot
-- (padrão do projeto — ver docs/GODOUTOR-CLINICAL-OS-V1.md §persistência).
--
-- POLÍTICA: cada migração = 1 arquivo numerado neste diretório.
-- NÃO aplicar em produção por engano: esta missão só versiona o DDL.
-- Escolha de schema: `public` (padrão do projeto — instalink_doc já vive
-- em public; nada de schema novo). Naming: snake_case.

CREATE TABLE IF NOT EXISTS domain_event (
  id               TEXT        PRIMARY KEY,
  business_id      TEXT        NOT NULL,          -- tenant isolation (raiz)
  organization_id  TEXT        NULL,              -- opcional (multiunidade futuro)
  type             TEXT        NOT NULL,          -- catálogo fechado (app valida)
  entity_type      TEXT        NOT NULL,
  entity_id        TEXT        NOT NULL,
  actor_kind       TEXT        NOT NULL,          -- user|agent|system|patient
  actor_id         TEXT        NULL,
  actor_name       TEXT        NULL,
  origin           TEXT        NOT NULL,          -- ui|api|automation|agent|webhook|import
  occurred_at      TIMESTAMPTZ NOT NULL,
  recorded_at      TIMESTAMPTZ NOT NULL,
  payload          JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- SEMPRE redigido
  idempotency_key  TEXT        NULL
);

-- Listagem principal por tenant, do mais recente ao mais antigo.
CREATE INDEX IF NOT EXISTS domain_event_business_occurred_idx
  ON domain_event (business_id, occurred_at DESC);

-- Consulta por tipo de evento dentro do tenant.
CREATE INDEX IF NOT EXISTS domain_event_business_type_occurred_idx
  ON domain_event (business_id, type, occurred_at DESC);

-- Consulta por entidade (timeline de uma entidade).
CREATE INDEX IF NOT EXISTS domain_event_business_entity_occurred_idx
  ON domain_event (business_id, entity_type, entity_id, occurred_at DESC);

-- Idempotência: (business_id + idempotency_key) único quando a key existe.
CREATE UNIQUE INDEX IF NOT EXISTS domain_event_business_idem_uq
  ON domain_event (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
