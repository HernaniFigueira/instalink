# GoDoutor — Manual de Implementação (persistência relacional + Storage)

Manual operacional da troca de persistência documental → relacional (Postgres) com
uploads no Supabase Storage. Este documento é citado pelo código
(`src/lib/relational/config.ts`, `supabase/README.md`) e descreve o que está
implementado nesta branch, como ativar em um ambiente, como validar e como
reverter. **Nenhuma etapa deste manual foi executada contra o Supabase-alvo ou
produção** — tudo aqui é para o operador do ambiente.

---

## 1. Modelo de ativação (sem troca monolítica)

A ativação é por **variáveis de ambiente**, nunca por troca de código:

```
GODOUTOR_PERSISTENCE=relational      # liga o modo relacional
SUPABASE_DB_URL=postgres://...       # Postgres (schema app.*)
SUPABASE_URL=https://<projeto>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<somente servidor>
SUPABASE_BUCKET_PUBLIC=clinic-media  # bucket público (padrão)
SUPABASE_BUCKET_PRIVATE=patient-files # bucket privado (padrão)
```

`relationalActive()` (src/lib/relational/config.ts) só fica `true` quando
`GODOUTOR_PERSISTENCE=relational` **e** `SUPABASE_DB_URL` estão presentes. Sem
elas, o sistema segue 100% no motor legado (`instalink_doc` / `INSTALINK_DB_FILE`)
— que continua sendo o caminho de rollback. Não há estado intermediário: cada
rota decide uma única vez, no início do request, qual motor usa (nunca grava nos
dois — **sem escrita mista**).

## 2. Migrações (versionadas, em ordem)

Aplicar via `psql "$SUPABASE_DB_URL" -f <arquivo>`, na ordem:

| Arquivo | Conteúdo |
|---|---|
| `supabase/migrations/0001_init.sql` | schemas + 59 tabelas + índices + grants mínimos + RLS on nas tabelas expostas + revoke público (com `DO $$` condicional para vanilla PG) |
| `supabase/migrations/0002_storage.sql` | buckets `clinic-media` (público) e `patient-files` (privado) + policies de Storage |
| `supabase/migrations/0003_patient_files.sql` | `app.patient_files` (referência permanente dos uploads privados; FKs para contatos/usuários; `unique(bucket,path)`; RLS on; revokes) |

Notas:
- Em **Postgres puro** (sem o storage-engine do Supabase) a 0002 depende dos
  objetos `storage.buckets`/`storage.objects`; o harness de jornadas cria um
  stub antes de aplicá-la. No Supabase real elas existem nativamente.
- As tabelas ficam fora dos schemas expostos pela Data API; grants mínimos só
  para o papel do serviço. RLS nas tabelas expostas **sem** assumir `auth.uid()`
  (o app autentica com sessão própria, cookies `il_session`/suporte/paciente).
- Migração é **idempotente por versão**: se o arquivo já foi aplicado (controle
  do operador), não reaplicar; os DDL usam `IF NOT EXISTS` quando seguro.

## 3. Importação reconciliada (documento → SQL)

`src/lib/relational/import/` contém o importador **repetível**:

```bash
# 1. Exportar o documento atual com segurança (snapshot)
# 2. Importar com reconciliação (upsert por id; não apaga o que já existe no SQL)
npx tsx scripts/godoutor/import-doc.mts --from <arquivo-doc> --to "$SUPABASE_DB_URL"
```

- O transform (`import/transform.ts`) é a referência doc→linha (59 tabelas,
  ordem de inserção com FKs). Os mappers de leitura/escrita do modo relacional
  (`slice.ts`, `agenda.ts`, `business-row.ts`) espelham esse transform.
- Repetir a importação **não duplica** (upsert por chave primária/identificador
  legado). Durante a janela de transição, rodar o importador novamente sincroniza
  o que mudou no documento enquanto o modo relacional estava desligado.
- A validação pós-importação compara contagens por tabela e órfãos; o importador
  é **fail-closed**: qualquer divergência bloqueia a ativação.
- A exportação de segurança pré-importação é obrigatória (snapshot do documento
  + `pg_dump` se já houver dados no SQL).

## 4. Regras preservadas (o que NÃO mudou)

- **Auth**: mesmos cookies (`il_session`, sessão de suporte, sessão do cliente),
  senhas com `scrypt:salt:hash`, `resolveAccess` intocado, sessões persistidas
  em `app.sessions` / `app.customer_sessions` / `app.support_sessions`.
- **Agenda**: transações + `pg_advisory_xact_lock(hashtext('godoutor:unit:<id>'))`
  por unidade; prevenção de sobreposição por índice GiST parcial
  (`pending|confirmed && kind <> 'fit_in'`); série recorrente com idempotência
  por `series_request_id`; check-in/remarcação/cancelamento com as mesmas
  mensagens e contratos de resposta; encaixe (fit-in) com conflitos devolvidos.
- **Permissões**: dono/admin/profissional/atendente com os mesmos escopos —
  inclusive escopo `own` do profissional na lista de gestão (testado por HTTP).
- **Identificadores legados preservados**: `instalink_doc`, `INSTALINK_DB_FILE`,
  IDs/widgets/eventos do widget, headers de assinatura, formatos de exportação,
  identidades de auditoria.

## 5. Uploads (Supabase Storage)

- **Contratos preservados**: upload público devolve `{ ok, url }` (bucket
  público `clinic-media`); upload privado devolve `{ ok, url, fileId, path,
  expiresAt }` com URL assinada temporária (bucket privado `patient-files`).
- **Validação no servidor ANTES de receber/enviar bytes**: sessão obrigatória,
  contato existe, contato pertence à unidade (`404` se de outra unidade),
  escopo do operador (profissional só acessa pacientes com atendimento vinculado
  — `403` caso contrário), magic-byte sniff por tipo, sem executáveis, nomes
  únicos (uuid), tamanho limitado.
- **Referência permanente**: todo upload privado é registrado em
  `app.patient_files` (0003) — a leitura autorizada
  (`GET /api/files/[id]`, exigindo permissão de atendimento + revalidação de
  escopo) **re-assina** a URL mesmo depois da anterior expirar (302).
- URLs existentes em documentos/registros nunca são reescritas.

## 6. Jobs e automações

- `POST /api/cron/automations` com header `x-cron-secret` (= `CRON_SECRET`):
  drena a fila P4 direto no SQL (`drainRelationalAutomations`, lote com CAS de
  claim e expiração). Sem segredo configurado o consumidor fica **desligado**
  (503); segredo divergente = 401 (fail-closed nos dois casos).
- Entregas HTTP de webhook/WhatsApp em modo relacional ficam registradas como
  `pending` (a saída HTTP real é passo de integração externa, fora do escopo
  desta fase) — o restante do ciclo de automação roda no SQL.

## 7. Validação (obrigatória antes de ativar)

```bash
# Suítes de integração relacional (Embedded Postgres real)
npx vitest run src/lib/__tests__/godoutor-relational.test.ts \
               src/lib/__tests__/godoutor-storage.test.ts   # 36/36

# Jornadas HTTP ponta a ponta: Next real + Postgres real + Storage HTTP fake +
# ORIGEM LEGADO INDISPONÍVEL (prova de independência do documento)
node scripts/godoutor/http-journeys.mjs   # 40/40 — ver detalhes no cabeçalho
```

As jornadas cobrem: login equipe/paciente, `me` (cookie e Bearer), escopo do
atendente, grade/mapa/gestão paginada, reserva pública e por painel, conflito de
horário (2º profissional assume; 3º = 409), remarcação, check-in, cancelamento
idempotente, série + replay, registro/login de paciente, uploads público e
privado (com 404 de outra unidade e 403 de escopo), re-assinatura após expirar,
lead na esteira e cron — tudo lendo/escrevendo **somente** no Postgres.

## 8. Rollback

1. Desligar `GODOUTOR_PERSISTENCE` (ou remover `SUPABASE_DB_URL`) e reiniciar —
   o app volta ao motor legado com o documento intacto.
2. Se houver dados criados no período relacional que precisem voltar ao
   documento: usar o exportador/importador reverso do ambiente de staging —
   **nunca** apagar dados; a reversão é por chaveamento, não por destruição.
3. O documento nunca é descartado na janela de transição; só depois da
   validação em produção é que o operador pode arquivá-lo (decisão do dono do
   ambiente, fora do escopo deste repositório).

## 9. Cobertura por fluxo (matriz) e entregas externas

- **Matriz completa migrado/bloqueado/pendente + inventário de
  `readDB`/`updateDB`**: `docs/GODOUTOR-MATRIZ-MIGRACAO.md`. Prova da rodada 4
  (`scripts/godoutor/http-journeys.mjs`): **118/118 verificações** com origem
  legado MORTA (porta sem listener). No SQL, além dos fluxos das rodadas
  anteriores (agenda completa, sessões equipe/suporte/paciente, esteira, cron,
  uploads, página pública/cadastro/config/publicação, fila, atendimento,
  histórico 360): **área do paciente completa (minha conta, minhas reservas,
  remarcar/cancelar visíveis para a equipe, recuperação de senha com token de
  uso único), CRM de contatos (+importação/exportações/360), equipe e
  permissões (com vínculo de agenda), catálogo, pedidos (com esteira),
  organizações/filiais (+duplicação), Dashboard/Analytics/Resultados, tarefas,
  quadro da esteira, inbox (leitura/envio para o outbox), avaliações, eventos,
  leads com PAGINAÇÃO SQL (fim do corte de 500)**.
- **Bloqueio explícito**: módulos não migrados respondem **503
  `module_not_migrated`** com header `x-godoutor-blocked`
  (`src/lib/relational/blocked.ts`) — integrações/canais, UI de automações,
  agente/concierge/campanhas, master/admin, API externa e crons de despacho.
  Nenhum fluxo relacional lê ou grava no documento legado.
- **Entregas externas no modo relacional** (não declarar paridade): mensagens
  de WhatsApp/automação/inbox e entregas de webhook ficam `pending` no outbox
  SQL (`app.messages`, `app.webhook_deliveries`) — o despachante HTTP é rodada
  própria; webhooks de ENTRADA de canais estão bloqueados (503). Detalhes na
  §3 da matriz.

## 10. Pendências honestas (não declarar "completo" além do que existe)

- Despachante HTTP do outbox (mensagens/webhooks) no modo relacional — §3.
- Módulos bloqueados (503) na §1c da matriz: integrações/canais (inclusive
  inbound WhatsApp/Instagram), UI de automações, agente/concierge/campanhas,
  master/admin, API externa por chave — proteção TEMPORÁRIA, não conclusão.
- Paginação SQL completa nas demais listas longas (hoje: leads com
  count+LIMIT/OFFSET; orders/pedidos com janela por página; conversas com
  filtro SQL — demais telas carregam a unidade por coleção, sem reconstruir
  documento).
- O importador foi validado com documento sintético (a exportação do Neon-alvo
  ficou bloqueada por cota); validar com o documento real antes de ativar.
- Nenhuma etapa foi executada contra o Supabase-alvo (`sefwhobqafkretljjlqx`)
  nem contra produção — por decisão explícita do escopo desta fase.
