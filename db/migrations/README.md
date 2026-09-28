# Migrations — domínios normalizados do GoDoutor

## Política

- **1 migração = 1 arquivo numerado** (`NNNN_nome_da_tabela.sql`). Ordene pelo
  prefixo; nunca edite uma migração já aplicada — crie uma nova.
- Cada arquivo é a **fonte de verdade auditável** do DDL. O runtime aplica o
  MESMO DDL de forma **idempotente** (`CREATE … IF NOT EXISTS`) uma única vez
  por processo — padrão já usado pelo projeto em `instalink_doc`
  (`src/lib/db.ts` → `pgInit`).
- **Nenhuma migração é aplicada em produção por esta ferramenta.** Aplicação em
  produção acontece fora do runtime, com revisão humana. Zero escrita remota
  em missões de fundação.
- `instalink_doc` (JSONB monolítico) **não é apagado nem migrado em massa**:
  ele continua servindo os domínios legados até cada corte por domínio (F1+).

## Escolha de schema (por quê)

| Decisão | Escolha | Motivo |
|---|---|---|
| Schema | `public` | Padrão do projeto: `instalink_doc` já vive em `public`; inventar schema novo criaria um segundo padrão sem ganho. |
| Naming | `snake_case` | Consistente com `instalink_doc`/`tenant_current`. |
| IDs | `TEXT` | Os IDs do domínio são strings (UUIDs/opacos); `TEXT` evita conversões e segue o ledger atual. |
| Timestamps | `TIMESTAMPTZ` | Sempre UTC ISO no app; `TIMESTAMPTZ` preserva o instante sem ambiguidade de fuso. |
| Tenant | `business_id TEXT NOT NULL` | Isolamento multi-tenant na raiz: toda leitura/escrita passa por `business_id`. |
| Idempotência | índice ÚNICO parcial `(business_id, idempotency_key)` | Repetir efeito externo é NO-OP dentro do tenant; chaves nulas não colidem. |

## Mapa de domínios

| Migração | Tabela | Domínio | Estado |
|---|---|---|---|
| `0001` | `domain_event` | EventLog (OAAS) | F0 — normalizado desde o nascimento |
| `0002` | `ai_usage` | Telemetria de IA | F0 — normalizado desde o nascimento |
| futuro | `clinical_encounter` | F1 | nasce normalizado |
| futuro | `prescription` / `clinical_document` | F2 | nasce normalizado |
| futuro | `clinical_order` / `lab_result` | F3 | nasce normalizado |
| futuro | `inventory_item` / `inventory_lot` / `inventory_movement` | F4 | nasce normalizado |
| futuro | `invoice` / `invoice_item` / `payment` | F5 | nasce normalizado |

Os domínios legados (agenda, clientes, pets, conversas, financeiro, …)
continuam em `instalink_doc` até seus cortes próprios — migração **por
domínio**, nunca big-bang.
