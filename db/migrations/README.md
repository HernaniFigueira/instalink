# Migrations — domínios internos do GoDoutor (schema `godoutor_internal`)

## Política

- **1 migração = 1 arquivo numerado** (`NNNN_nome_da_tabela.sql`). Ordene pelo
  prefixo; **nunca edite uma migração já aplicada** — crie uma nova.
- Este diretório é a **ÚNICA autoridade estrutural (DDL)**. O runtime
  **não executa** `CREATE TABLE`, `CREATE INDEX` nem `ALTER TABLE`: os stores
  (`src/lib/domain-events/pg-store.ts`, `src/lib/ai/usage-pg-store.ts`) só
  fazem `SELECT`/`INSERT` nas tabelas qualificadas. **Migration ausente ⇒
  falha explícita** (erro Postgres `42P01`/`3F000` traduzido em mensagem que
  aponta o arquivo), nunca DDL de boot disfarçado de idempotência.
- **Nenhuma migração é aplicada em produção por esta ferramenta.** Aplicação em
  produção acontece fora do runtime, com revisão humana e validação
  prévia (grants/RLS audados no alvo antes de rodar). Zero escrita remota em
  missões de fundação.
- `instalink_doc` (JSONB monolítico) **não é apagado nem migrado em massa**:
  ele continua servindo os domínios legados até cada corte por domínio (F1+).

## Segurança das tabelas novas — “nascem fechadas”

Toda migração nova neste diretório **termina** com o bloco de fechamento:

1. `REVOKE ALL ON <tabela> FROM PUBLIC;`
2. `REVOKE ALL ON <tabela> FROM anon, authenticated, service_role` (via
   `DO $$ … to_regrole …$$` para continuar portável fora do Supabase);
3. `REVOKE ALL ON SCHEMA godoutor_internal FROM` esses papéis (sem USAGE, o
   gateway client-side nem enxerga as tabelas).

O `schema godoutor_internal` **não é API pública**: nada de expô-lo no
Data API/PostgREST. O acesso legítimo é **server-side**, pelo papel dono da
`DATABASE_URL` (owner das tabelas — nunca um papel do gateway público).
Isso é **defesa em profundidade**: enquanto a exposição via Data API de
`instalink_doc` não estiver auditada até a última linha, as tabelas novas já
nascem inacessíveis ao client-side.

## Escolha de schema (por quê)

| Decisão | Escolha | Motivo |
|---|---|---|
| Schema | `godoutor_internal` | Backend-only: separa os domínios novos do espaço público; `public`/`godoutor_app` carregam o legado exposto ao gateway — nada novo nasce lá. |
| Qualificação | sempre `godoutor_internal.<tabela>` | Pool serverless reaproveita conexões; depender de `search_path` é bug esperando para acontecer. |
| Naming | `snake_case` | Consistente com `instalink_doc`/`tenant_current`. |
| IDs | `TEXT` (UUID v4 gerado no app) | `crypto.randomUUID()` — sem contador global (colisor em instâncias concorrentes); fixtures podem fixar id. |
| Dinheiro | `NUMERIC(18,8)` | Custo estimado de IA tem casas decimais exatas; `DOUBLE PRECISION` é proibido para valor monetário-ish. |
| Timestamps | `TIMESTAMPTZ` | Sempre UTC ISO no app; `TIMESTAMPTZ` preserva o instante sem ambiguidade de fuso. |
| Tenant | `business_id TEXT NOT NULL` | Isolamento multi-tenant na raiz: toda leitura/escrita passa por `business_id`. |
| Idempotência | índice ÚNICO parcial `(business_id, idempotency_key)` | Repetir efeito externo é NO-OP dentro do tenant; chaves nulas não colidem. |

## Mapa de domínios

| Migração | Tabela | Domínio | Estado |
|---|---|---|---|
| `0001` | `godoutor_internal.domain_event` | EventLog (OAAS) | F0 — normalizado desde o nascimento |
| `0002` | `godoutor_internal.ai_usage` | Telemetria de IA | F0 — normalizado desde o nascimento |
| futuro | `clinical_encounter` | F1 | nasce normalizado e fechado |
| futuro | `prescription` / `clinical_document` | F2 | nasce normalizado e fechado |
| futuro | `clinical_order` / `lab_result` | F3 | nasce normalizado e fechado |
| futuro | `inventory_item` / `inventory_lot` / `inventory_movement` | F4 | nasce normalizado e fechado |
| futuro | `invoice` / `invoice_item` / `payment` | F5 | nasce normalizado e fechado |

Os domínios legados (agenda, clientes, pets, conversas, financeiro, …)
continuam em `instalink_doc` até seus cortes próprios — migração **por
domínio**, nunca big-bang.
