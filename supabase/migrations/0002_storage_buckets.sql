-- ═══════════════════════════════════════════════════════════════════════
-- GoDoutor · Migração 0002 — Supabase Storage (uploads)
-- ═══════════════════════════════════════════════════════════════════════
-- Dois buckets, regras distintas (handoff §7):
--   • clinic-media  → PÚBLICO: fotos da clínica (logo, capa, catálogo, página).
--                     Servidas por /object/public/... (sem assinatura).
--   • patient-files → PRIVADO: arquivos de pacientes. Leitura SOMENTE por URL
--                     temporária (assinada pelo servidor, com autorização da
--                     unidade). Nenhuma política para anon/authenticated.
-- Escrita: somente o SERVIDOR (service_role via API Storage). Nada é escrito
-- direto pelo browser — validação de tipo/tamanho/autorização fica na rota.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clinic-media', 'clinic-media', true,
  5242880, -- 5 MB
  array['image/jpeg','image/png','image/webp','image/gif','image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'patient-files', 'patient-files', false,
  15728640, -- 15 MB
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Privacidade do bucket privado: nenhuma leitura anônima mesmo que alguém
-- crie um objeto por engano fora da rota (sem política = negado para anon).
insert into app.schema_migrations (version) values ('0002_storage_buckets')
on conflict (version) do nothing;
