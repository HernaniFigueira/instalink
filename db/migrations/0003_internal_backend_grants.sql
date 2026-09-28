-- ═══════════════════════════════════════════════════════════════
-- 0003 · godoutor_internal — grants MÍNIMOS para o papel do backend
-- ═══════════════════════════════════════════════════════════════
-- POR QUE ESTA MIGRAÇÃO EXISTE (auditoria direta do Supabase real, 2026-09-28):
-- o papel da conexão do backend (`godoutor_app`) tinha
--   • USAGE no schema godoutor_internal → FALSE
--   • SELECT/INSERT em godoutor_internal.domain_event → FALSE
--   • SELECT/INSERT em godoutor_internal.ai_usage → FALSE
-- As migrações 0001/0002 assumiram que o papel dono da conexão era o próprio
-- owner do schema (quem aplica migration). Em produção não é: o backend
-- conecta como papel dedicado de menor privilégio. Consequência: TODO uso dos
-- stores normalizados da F0 (emissão de domínio, telemetria de IA) falharia
-- com 42501 "permission denied for schema" ao ser acionado.
--
-- NUNCA edite 0001/0002 (já aplicadas) — grants evoluem em migração nova.
--
-- MENOR PRIVILÉGIO (contrato real do código, verificado em
-- src/lib/domain-events/pg-store.ts e src/lib/ai/usage-pg-store.ts):
--   • GRANT USAGE ON SCHEMA godoutor_internal  — necessário para atravessar
--     o schema (sem isto, nem a permissão de tabela vale).
--   • GRANT SELECT, INSERT nas duas tabelas    — o runtime só lê e insere;
--     a idempotência do record() é SELECT + INSERT ... ON CONFLICT DO
--     NOTHING, e o resumo de uso é SELECT (COUNT/SUM). NÃO há UPDATE/DELETE
--     no código → NÃO se concede UPDATE, DELETE, TRUNCATE, REFERENCES nem
--     CREATE no schema godoutor_internal.
--   • Os papéis do gateway público (anon, authenticated, service_role)
--     continuam SEM acesso — este arquivo não concede nada a eles; o
--     fechamento de 0001/0002 permanece intacto.
--
-- PORTABILIDADE (não pode quebrar deploy fora do Supabase):
--   • papel `godoutor_app` ausente (ex.: Neon puro, onde a conexão usa o
--     próprio owner) → arquivo é NO-OP silencioso via guarda to_regrole;
--   • papel presente mas tabelas ausentes (aplicação fora de ordem) →
--     falha EXPLÍCITA apontando 0001/0002, nunca grant parcial silencioso.

DO $$
DECLARE
  backend_role text := 'godoutor_app';
BEGIN
  IF to_regrole(backend_role) IS NULL THEN
    RETURN; -- ambiente sem papel de backend dedicado: nada a conceder
  END IF;

  IF to_regclass('godoutor_internal.domain_event') IS NULL
     OR to_regclass('godoutor_internal.ai_usage') IS NULL THEN
    RAISE EXCEPTION
      '0003 exige 0001_domain_event.sql e 0002_ai_usage.sql aplicados (tabelas de godoutor_internal ausentes)'
      USING ERRCODE = '42P01';
  END IF;

  EXECUTE format('GRANT USAGE ON SCHEMA godoutor_internal TO %I', backend_role);
  EXECUTE format('GRANT SELECT, INSERT ON godoutor_internal.domain_event TO %I', backend_role);
  EXECUTE format('GRANT SELECT, INSERT ON godoutor_internal.ai_usage TO %I', backend_role);
END
$$;
