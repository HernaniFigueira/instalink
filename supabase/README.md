# GoDoutor · Supabase (projeto `sefwhobqafkretljjlqx`)

Migração **versionada** do documento monolítico para o esquema relacional.
Rode as migrações nesta ordem — elas são idempotentes e não tocam em dado
nenhum de produção até alguém executar o importador (ver
`docs/GODOUTOR-SUPABASE-IMPLEMENTACAO.md`).

## Aplicar

```bash
# Opção A — Supabase CLI (recomendado; pede login/link do projeto)
supabase link --project-ref sefwhobqafkretljjlqx
supabase db push

# Opção B — SQL Editor do painel (cole o conteúdo dos arquivos, 0001 → 0002)
```

Após aplicar:

1. Defina a senha da role da aplicação (NUNCA no repositório):
   `ALTER ROLE godoutor_app PASSWORD '<senha forte>';` — guarde no ambiente
   seguro; a connection string completa é a variável `SUPABASE_DB_URL` da app.
2. Confirme que a Data API (PostgREST) não expõe nada novo: o esquema `app`
   fica FORA de `db-schemas`; `public` continua vazio.

## Arquivos

- `migrations/0001_godoutor_relational.sql` — todas as coleções do produto em
  tabelas relacionais (organizações, unidades, equipe, clientes, serviços,
  profissionais, disponibilidade, agendamentos, fila, atendimentos, CRM,
  conversas, automações, integrações…), índices por unidade/período,
  constraint de exclusão que recusa dupla reserva NO BANCO, RLS e grants
  mínimos.
- `migrations/0002_storage_buckets.sql` — buckets de Storage: `clinic-media`
  (público — fotos da clínica) e `patient-files` (privado — arquivos de
  pacientes, leitura só por URL temporária).

## Regras de ouro

- **Nunca** mover tabelas do esquema `app` para `public` sem desenhar RLS
  compatível com a autenticação real (cookies atuais NÃO viram `auth.uid()`).
- **Nunca** colocar senha, connection string ou `service_role` em PR, log ou
  frontend.
- O documento legado (`instalink_doc` no Neon) permanece intocado até o corte;
  a origem só é lida pelo importador.
