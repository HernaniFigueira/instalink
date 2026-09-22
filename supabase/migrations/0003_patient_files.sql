-- ═══════════════════════════════════════════════════════════════
-- 0003 — ARQUIVOS DE PACIENTES: referência PERMANENTE no banco.
-- ═══════════════════════════════════════════════════════════════
-- O bucket `patient-files` é PRIVADO (0002) e as URLs assinadas EXPIRAM.
-- A leitura depois da validade acontece pela APLICAÇÃO: esta tabela guarda o
-- caminho permanente no bucket e é ela que a rota /api/files/[id] consulta —
-- DEPOIS de reautorizar sessão + unidade + escopo do operador. O bucket nunca
-- vira fonte de verdade de permissão; o banco sim.
create table app.patient_files (
  id            text primary key,
  business_id   text not null references app.businesses(id) on delete cascade,
  contact_id    text not null references app.contacts(id) on delete cascade,
  bucket        text not null,
  path          text not null,
  content_type  text not null,
  size_bytes    integer not null,
  original_name text not null default '',
  uploaded_by   text not null default '',
  created_at    timestamptz not null default now()
);
create index patient_files_business_contact_idx on app.patient_files (business_id, contact_id, created_at desc);
create unique index patient_files_path_uniq on app.patient_files (bucket, path);

-- Isolamento igual às demais: RLS sem política para papéis da Data API.
alter table app.patient_files enable row level security;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on app.patient_files from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on app.patient_files from authenticated';
  end if;
end $$;

insert into app.schema_migrations (version, applied_at)
values ('0003_patient_files', now())
on conflict (version) do nothing;
