-- ═══════════════════════════════════════════════════════════════
-- 0001 · godoutor_internal.domain_event — EventLog normalizado (Clinical OS F0)
-- ═══════════════════════════════════════════════════════════════
-- PRIMEIRO domínio novo que já nasce NORMALIZADO (fora de instalink_doc).
-- Este arquivo é a ÚNICA FONTE DE VERDADE do DDL: o runtime NÃO executa
-- CREATE TABLE/INDEX nem ALTER TABLE — apenas SELECT/INSERT escopados pelo
-- domínio (src/lib/domain-events/pg-store.ts). Migration ausente ⇒ a query
-- falha de forma explícita (código 42P01) com mensagem que aponta este
-- arquivo; nunca há DDL silencioso de boot.
--
-- POLÍTICA: cada migração = 1 arquivo numerado neste diretório; nunca editar
-- migração já aplicada — criar nova. NÃO aplicar em produção por engano:
-- esta missão só versiona o DDL.
--
-- ESCOLHA DE SCHEMA: `godoutor_internal` — schema INTERNO, dedicado ao
-- backend. Não é API pública: as novas tabelas nascem com o mínimo privilégio
-- (REVOKE no fim deste arquivo), para que o client-side (anon/authenticated
-- via Data API/PostgREST) não as alcance mesmo se o schema for exposto por
-- engano. Naming: snake_case. Todo SQL do app é QUALIFICADO
-- (`godoutor_internal.domain_event`) — nunca depende de `search_path`.

CREATE SCHEMA IF NOT EXISTS godoutor_internal;

CREATE TABLE IF NOT EXISTS godoutor_internal.domain_event (
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
  ON godoutor_internal.domain_event (business_id, occurred_at DESC);

-- Consulta por tipo de evento dentro do tenant.
CREATE INDEX IF NOT EXISTS domain_event_business_type_occurred_idx
  ON godoutor_internal.domain_event (business_id, type, occurred_at DESC);

-- Consulta por entidade (timeline de uma entidade).
CREATE INDEX IF NOT EXISTS domain_event_business_entity_occurred_idx
  ON godoutor_internal.domain_event (business_id, entity_type, entity_id, occurred_at DESC);

-- Idempotência: (business_id + idempotency_key) único quando a key existe.
CREATE UNIQUE INDEX IF NOT EXISTS domain_event_business_idem_uq
  ON godoutor_internal.domain_event (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- NASCE FECHADA — proteção contra acesso direto client-side.
-- O acesso legítimo é server-side, pelo papel dono da conexão
-- (DATABASE_URL) — que é o owner da tabela e mantém TODO o acesso.
-- Os papéis do gateway público (Data API/PostgREST) perdem o que o
-- autoprovisionamento do Supabase porventura tenha concedido.
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON godoutor_internal.domain_event FROM PUBLIC;

DO $$
DECLARE
  rol text;
BEGIN
  -- Os papéis anon/authenticated/service_role existem no Supabase; em
  -- Postgres sem eles, o bloco é no-op (a migração continua portável).
  FOREACH rol IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF to_regrole(rol) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON godoutor_internal.domain_event FROM %I', rol);
    END IF;
  END LOOP;
END
$$;

-- O schema interno também não é atravessável por quem não o conhece:
-- sem USAGE, as revogações de tabela nem precisam ser tentadas pelo gateway.
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
