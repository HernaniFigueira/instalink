# GoDoutor Clinical OS v1 — Fundação

> Arquitetura e roadmap do GoDoutor como **sistema operacional da clínica**
> (vertical: clínica veterinária). Escopo deste documento: F0 — Fundação.
> Design System **aprovado e congelado** — este documento não muda telas nem
> identidade visual.

> **Especificação de arquitetura clínica — não é autoridade de roadmap.**
> O roadmap operacional vigente está em `docs/GODOUTOR-MASTER-PLAN.md` (seções Estado atual / Fila de execução). Este documento preserva a fundação técnica F0 e a visão de domínios.

---

## 1. Visão

O GoDoutor cresceu como plataforma de **página, agendamento e relacionamento**
(negócios de atendimento). O destino é maior: o **sistema operacional da clínica**
— o registro de autoridade de tudo que acontece na operação clínica:

```
Entrada → Tutor/Cliente → Pet/Paciente → Agenda → Check-in/Fila →
Atendimento → Prontuário → Prescrição/Exames/Procedimentos → Documentos →
Estoque/Farmácia → Conta do atendimento → Pagamento → Financeiro →
Fiscal/Contabilidade → Retorno/Follow-up
```

Princípio de produto: **o que já existe continua** (Agenda, Clientes, Pets,
Conversas, Automação, Financeiro, Resultados, Encounter) — o Clinical OS
adiciona o núcleo clínico/operacional e o tecido de eventos sem reimplementar
telas. A Página/site builder vira **legado preservado** (fora da navegação
operacional padrão, APIs intactas).

## 2. Matriz AS-IS (auditoria — commit de partida `b84f292`)

| Área | Estado | Decisão |
|---|---|---|
| Persistência (`db.ts` → `instalink_doc` JSONB + files) | EXISTE | **Preservado** — coleções novas são aditivas com default `[]` |
| Organization/Business/membros + PermissionId | EXISTE | **Preservado** (evoluir depois) |
| Customers / BusinessCustomer (tutor) | EXISTE | **Preservado** |
| Pet (paciente veterinário) | EXISTE | **Preservado** |
| Booking + slots + QueueEntry (`queue.ts`) | EXISTE | **Preservado** |
| Encounter (`encounters.ts`) + Anamnese + Pet360 | EXISTE | **Preservado** |
| FinanceEntry (`revenue.ts`) | EXISTE | Evoluir em F5 |
| Insights/tasks, Conversas, leads+pipeline | EXISTE | **Preservado** |
| Automation/webhooks/whatsapp/integrations | EXISTE | **Preservado** |
| ToolRegistry (`agent-tools/`) | EXISTE | **Preservado/Evoluído** (cadeia de segurança) |
| Audit (`audit.ts`) + capabilities (`features.ts`) | EXISTE | **Preservado** |
| AI (`ai/` provider p/ automações) | EXISTE | **Preservado**; `generative.ts`/`usage.ts` somam |
| AnalyticsEvent/WebhookEvent/IntegrationEvent/AuditEntry | EXISTE | **Preservados** (outra natureza) |
| **DomainEvent (EventLog OAAS)** | NÃO EXISTIA | **NOVO** (`lib/domain-events/`) |
| **DecisionEngine (Jev/TypeSafe)** | NÃO EXISTIA | **NOVO** (`lib/decision/`) |
| **GenerativeAIProvider + telemetria de IA** | NÃO EXISTIA | **NOVO** (`lib/ai/generative.ts`, `lib/ai/usage.ts`) |
| Página pública (site builder) | EXISTE | **LEGADO** — desativado na nav por flag; APIs preservadas |
| Internação/cirurgia/estoque/NFS-e/contabilidade | NÃO EXISTE | **Fora do escopo v1** (roadmap) |

## 3. F0 — o que esta fundação entrega

1. **EventLog (eventos de domínio / OAAS)** — `src/lib/domain-events/`
2. **DecisionEngine** (Choice/Noul/Score/confidence/routing) — `src/lib/decision/`
3. **GenerativeAIProvider** — `src/lib/ai/generative.ts`
4. **Telemetria de IA** (custo por clínica) — `src/lib/ai/usage.ts`
5. **Página como legado** — `src/lib/product.ts` + filtro na navegação
6. Este documento.

### 3.1 EventLog — eventos de domínio (NORMALIZADO desde o nascimento)

> **F0/J (correção estrutural):** EventLog **NÃO** é mais um array em
> `instalink_doc`. Versão anterior (superseded) gravava `domainEvents` no
> documento JSONB monolítico — decisão corrigida antes de F1: o EventLog já
> nasce **normalizado em Postgres**, na tabela `godoutor_internal.domain_event`
> (`db/migrations/0001_domain_event.sql`), acessado exclusivamente pela porta
> `DomainEventStore` (`lib/domain-events/store.ts`).

**Escolha de schema** (hardening F0): schema interno **`godoutor_internal`**
(tabelas `godoutor_internal.domain_event` e `godoutor_internal.ai_usage`),
naming `snake_case`, IDs `TEXT` (UUID v4), timestamps `TIMESTAMPTZ`. **As
migrations em `db/migrations/` são a ÚNICA autoridade de DDL**: os stores de
runtime executam apenas `SELECT`/`INSERT` e todo SQL é **totalmente
qualificado** — nada depende de `search_path` (pool serverless reaproveita
conexões; qualificar é o único jeito seguro). Migration ausente ⇒ falha
**explícita** (erro `42P01`/`3F000` traduzido para "aplique a migration
000N"), nunca DDL silencioso no boot. As tabelas novas **nascem fechadas**
contra acesso client-side (REVOKE de `PUBLIC`/`anon`/`authenticated`/
`service_role` na tabela e `USAGE` no schema — ver `db/migrations/README.md`).
**Status de aplicação no Supabase real (2026-09-28):** `0001` **aplicada** ·
`0002` **aplicada** (DDL manual, fora do runtime, como manda a política) ·
`0003` **pendente** (grants do papel do backend — ver §6.3). Nenhuma alteração
destrutiva foi ou será feita; `instalink_doc` (users/sessions) **não é
migrado**.

```ts
DomainEvent {
  id; businessId /* OBRIGATÓRIO */;
  type: DomainEventType;            // catálogo FECHADO (ver abaixo)
  entityType; entityId;
  actor: { kind: 'user'|'agent'|'system'|'patient'; id?; name? };
  origin: 'ui'|'api'|'automation'|'agent'|'webhook'|'import';
  occurredAt; recordedAt;
  payload;                          // JSON simples SEMPRE redigido (sem prontuário/prompt)
  idempotencyKey?;                  // (businessId + key) = NO-OP se repetir
}
```

Catálogo v1: `appointment.created|confirmed|cancelled|completed|no_show`,
`patient.checked_in`, `queue.called`, `encounter.started|finalized`,
`prescription.created`, `exam.ordered|resulted`, `procedure.performed`,
`document.generated`, `invoice.created`, `payment.received`,
`inventory.low|movement`, `followup.due|completed`.

Persistência (`godoutor_internal.domain_event`): `business_id NOT NULL`, catálogo em `type`,
`entity_type`/`entity_id`, `actor_kind|id|name`, `origin`, `occurred_at`/
`recorded_at`, `payload JSONB` sempre redigido, `idempotency_key` opcional.

Índices:
- `(business_id, occurred_at DESC)` — listagem principal por tenant;
- `(business_id, type, occurred_at DESC)` — consulta por tipo;
- `(business_id, entity_type, entity_id, occurred_at DESC)` — timeline de entidade;
- **UNIQUE parcial** `(business_id, idempotency_key) WHERE idempotency_key IS NOT NULL`
  — idempotência: repetir é NO-OP e devolve o primeiro evento.

API: `emitDomainEvent` (puro/validado/redigido) · `DomainEventStore.record`
(async; Postgres em produção, memória em testes/dev) · `DomainEventStore.list`
(leitura SEMPRE por `businessId`). A Automação futura (F8) consome ESTE log —
nunca um formato paralelo.

### 3.2 DecisionEngine (TypeSafe/Jev)

Contrato baseado na **skill oficial `typesafe-ai`** (instalada) e nas docs
live (`docs.typesafe.ai`: primitives/confidence/patterns):

```ts
DecisionQuestion = Choice{ instructions, criteria: Record<option, desc> }
                 | Noul{ instructions }            // P(“sim”)
                 | Score{ instructions, criteria: string[] } // níveis ordenados
DecisionAnswer   = { choice, probabilities, confidence }     // Choice
                 | { noul }                                  // Noul (sem confidence)
                 | { score, probabilities, confidence }      // Score
DecisionEngine   = { id; isAvailable(); decide(request): DecisionResult }
```

Implementações:

| Engine | Quando | Comportamento |
|---|---|---|
| `DisabledDecisionEngine` | **padrão** (sem `TYPESAFE_API_KEY`) | `ok:false` — nenhuma decisão automática, nada quebra |
| `MockDecisionEngine` | `GODOUTOR_DECISION_ENGINE=mock` (testes) | determinístico, sem rede |
| `TypeSafeDecisionEngine` | com `TYPESAFE_API_KEY` **no servidor** | `system_one(state, questions)` — estrutural; fail-closed sem chave |

Regras: **confidence é estatística da distribuição** (0..1 em Choice/Score),
não licença para agir; **routing por confiança** (auto-agir só acima do limiar
do domínio; abaixo → ação humana); perguntas independentes vão juntas
(fan-out); dependência real entre juízos = segunda chamada em código.
**Nenhuma chamada externa real acontece nesta fundação.**

⚠️ **Endpoint/header de rede são PROVISÓRIOS** (`POST /v1/system_one`,
`Authorization: Bearer`, `x-typesafe-business`) até validação contra as docs
live com a chave real — não são contrato estável; o que é contrato estável é a
porta `DecisionEngine` (Choice/Noul/Score/confidence), que não muda quando o
endpoint for ajustado.

### 3.3 GenerativeAIProvider + telemetria

Jev decide (System One); LLM generativa **escreve** (respostas, resumos,
relatórios, documentos, estruturado→linguagem). Interface única:

```ts
GenerativeAIProvider { id; isAvailable(); generate(req): GenerativeResult }
// tasks: reply_suggestion | summary | report | document_text | data_to_language
```

- `DisabledGenerativeProvider` (padrão) / `MockGenerativeProvider` (testes).
- Futuro: OpenAI / OpenRouter / Gemini / outro — **plugados aqui**, o domínio
  nunca importa fornecedor. **Sempre no servidor**; nada no frontend.
- Telemetria (`AiUsageRecord`, tabela normalizada
  `godoutor_internal.ai_usage` — `db/migrations/0002_ai_usage.sql`; **não**
  vive em `instalink_doc`):
  `businessId · agentId · feature · provider · model · inputTokens ·
  outputTokens · audioSeconds · estimatedCost · latencyMs · decisionType ·
  confidence · createdAt`. **`id` é UUID v4** (`crypto.randomUUID()` — sem
  contador global/em memória; `RecordAiUsageInput.id` aceita id explícito
  para fixtures/testes, e a unicidade é segura entre instâncias serverless).
  Índices `(business_id, created_at DESC)` e
  `(business_id, agent_id, created_at DESC)`; CHECKs de sanidade (tokens/
  latência/confidence 0..1); **`estimated_cost` é `NUMERIC(18,8)`** (decimal
  exato — nunca `DOUBLE PRECISION` para custo). **Nunca armazena prompts
  clínicos completos, transcrição ou prontuário** — só números. Custo de IA
  por clínica nasce aqui (`AiUsageStore.totals`).

### 3.4 Página pública → legado (desativação segura)

Flag `GODOUTOR_LEGACY_PAGES` (`src/lib/product.ts`):

| Flag | Navegação | Rotas/APIs | Widget/deep link |
|---|---|---|---|
| desligada (padrão) | "Página" **fora** do menu operacional e do onboarding | **intactas** | **funcionam** |
| `=1` | restaura | intactas | funcionam |

Nada é apagado: `/pagina`, `/api/publico/...`, `interna.js` (widget), webhooks
e deep links continuam; agendamento público não muda em nada. Reativar é
instantâneo (sem migração). Configurações futuras documentam os dados
herdados (Instagram/TikTok/galeria) como legado da Página.

## 4. Estratégia de banco (P0)

AS-IS: `instalink_doc` (JSONB, uma linha) + `tenant_current` + ficheiros de
arquivo; diversos domínios já têm módulos próprios (agenda/queue/encounters/
revenue/…). TO-BE (sem big-bang):

0. **Correção F0 (antes de qualquer integração):** EventLog
   (`godoutor_internal.domain_event`) e telemetria de IA
   (`godoutor_internal.ai_usage`) **nascem normalizados em Postgres** — nunca
   em `instalink_doc`. A primeira versão (arrays aditivos no documento) foi
   abandonada ainda em F0, exatamente para não alimentar o JSONB que queremos
   desligar como runtime. Portas de acesso: `DomainEventStore` / `AiUsageStore`
   (Postgres em produção; adapter de memória em testes/dev — sem rede).
1. **Sem migração destrutiva, sem apagar `instalink_doc`.** Os domínios
   legados permanecem no documento até seus cortes; nada de big-bang.
2. **Plano de corte por domínio** (fases F1+): cada domínio que precisar de
   tabela normalizada migra com dual-read/dual-write **controlado**, na ordem:
   ~~`godoutor_internal.domain_event`/`ai_usage`~~ (F0 — já normalizado) → `clinical_encounter` →
   `prescription/order` → `invoice/payment` → `inventory` — cada corte é um PR
   próprio, com paridade testada antes do flip. `instalink_doc` vira,
   gradualmente, o ledger legado lido até a última migração.
3. **Multi-tenant**: toda tabela/coleção nova carrega `business_id` (e
   `organization_id` quando a entidade pertence à organização). Índices por
   `(business_id, tipo, data)`. Leitura SEMPRE escopada por tenant (o
   `listDomainEvents` já exige `businessId`).
4. Relações nomeadas: `patient→tutor`, `encounter→appointment/queue_entry`,
   `prescription→encounter`, `order→encounter`, `invoice→encounter`,
   `payment→invoice`, `inventory_movement→lot`, `domain_event→entidade`.
5. **Versionamento de schema**: `db/migrations/NNNN_tabela.sql` (1 arquivo por
   migração) é a **ÚNICA autoridade de DDL** — o runtime não executa
   `CREATE TABLE`/`CREATE INDEX`/`ALTER TABLE` em hipótese alguma; migration
   ausente derruba a operação com erro explícito que aponta o arquivo.
   Aplicação em produção é manual, revisada e validada contra o alvo — a
   fundação apenas versiona o DDL. Status: `0001`/`0002` já aplicadas no
   Supabase real (manualmente, fora do runtime); `0003` pendente de aplicação.

## 5. Agent-ready (ToolRegistry — preservado)

A cadeia de segurança já existente **permanece a espinha dorsal** dos agentes:

```
IA (Jev/LLM) → ToolRegistry (registry.ts)
  → tenant guard (guard.ts: businessId do CONTEXTO, nunca do input)
  → permission check (permissions.ts, da SESSÃO)
  → confirmation (requiresConfirm p/ efeito sensível)
  → domain service (módulos de domínio)
  → persistence (db.ts)
  → audit (audit.ts) + EventLog (domain-events) + telemetria (ai/usage)
```

Regras invioláveis preservadas/estendidas: IA **nunca** acessa SQL cru,
documento completo de outro tenant, ou permissão do próprio input; toda
ferramenta declara `sideEffect` (`read|write|destructive`),
`requiresPermission`, `requiresConfirm`, `readOnly`, `idempotencyKey`;
`confirmed` só vem de humano. **Ações clínicas finais são sempre de
profissional humano — IA nunca assina prontuário/prescrição
autonomamente.**

## 6. Segurança e auditoria

- **RBAC** (PermissionId + MemberRole) — menor privilégio; `atendimento` não
  nasce para Secretária.
- **Tenant isolation** na raiz de toda leitura/escrita/evento.
- **Audit trail** (`audit.ts`) para atos administrativos; **EventLog** para
  fatos de domínio; os dois coexistem (naturezas diferentes).
- **Nenhuma API key no frontend**; TypeSafe/LLM só no servidor; **sem
  segredo commitado**; `TYPESAFE_API_KEY`/`GODOUTOR_*` são ambiente.
- Payload de evento sempre redigido (`redactSensitive`); telemetria de IA sem
  prompt clínico; prontuário só no Encounter (dado sensível, com dono).
- Ações importantes exigem confirmação humana (ToolRegistry `confirmed`).

### 6.1 Exposição do banco (Supabase) — constatação factual da auditoria

Estado medido **hoje**, reportado como fato, sem extrapolação:

- a tabela legado é `godoutor_app.instalink_doc` (schema `godoutor_app`,
  owner `postgres`);
- `godoutor_app.instalink_doc` está atualmente com **RLS desabilitado**;
- na auditoria atual, `anon` e `authenticated` **não apresentaram USAGE no
  schema** `godoutor_app` **nem grants explícitos** sobre `instalink_doc`
  (para `anon`, `authenticated` e `service_role`);
- `service_role` também não apresentou USAGE no schema `godoutor_app`.

**O que isso NÃO prova:** NÃO está comprovado que `instalink_doc` seja
exposto/alcançável por `anon`/`authenticated` via client-side — a RLS
desabilitada remove uma barreira, mas sem `USAGE` no schema nem grants na
tabela não há caminho demonstrado pela Data API. **A política de exposição
via Data API (schemas expostos), grants e RLS deve permanecer auditada antes
da expansão do banco clínico** — nenhum texto deste documento trata
exposição como fato enquanto essa auditoria não fechar.

**Plano de hardening (sequência, sem atalhos):**

1. **Menor privilégio** nos papéis do gateway (`anon`/`authenticated`/
   `service_role`) — nada de grants amplos em schemas com dados clínicos;
2. **Schema interno** (`godoutor_internal`) para todo domínio novo — fora de
   qualquer lista de schemas expostos na Data API;
3. **Tabelas novas nunca acessíveis diretamente por client-side** — cada
   migration nasce com `REVOKE` de `PUBLIC`/`anon`/`authenticated` e sem
   `USAGE` de schema para os papéis do gateway (defesa em profundidade já
   aplicada em `0001`/`0002`);
4. **RLS/grants apropriados** definidos por tabela e por papel, com revisão
   humana;
5. **Validação antes de qualquer alteração em produção** — auditoria no alvo,
   plano de rollback e verificação pós-aplicação. Foi esse o caminho das
   migrations estruturais: `0001`/`0002` **já aplicadas** no Supabase real,
   manual e fora do runtime; `0003` **pendente** de aplicação (grants do
   papel do backend, §6.3). Nenhuma alteração destrutiva; `instalink_doc`
   (users/sessions) permanece **sem migração** — o runtime segue lendo e
   escrevendo o documento exatamente como estava.

### 6.2 `instalink_doc` e search_path (P0-login — dependência explícita)

O ledger legado (`db.ts`) referencia `instalink_doc` **sem qualificação de
schema**, de propósito: o schema do documento é **por ambiente** — `public`
em Neon/Vercel Postgres, `godoutor_app` no Supabase atual. Quem resolve é o
`search_path` do papel da conexão (no Supabase: `ALTER ROLE … SET
search_path = godoutor_app, public`, ou `options=-csearch_path=…` na string
do pooler), **não** o código. Consequências registradas:

- **A garantia de tabela não pode ser especulativa (decisão arquitetural —
  não alegação sobre o estado do papel).** O antigo `pgInit` emitia
  `CREATE TABLE IF NOT EXISTS instalink_doc` antes da primeira leitura/
  escrita de cada instância. Auditoria direta ao Supabase REAL (2026-09-28)
  confirma que o papel do backend **possui** hoje `CREATE` no schema
  `godoutor_app` (`has_schema_privilege(...,'CREATE') = TRUE`; DML completo
  em `instalink_doc`; `rolconfig = NULL`, logo sem `search_path` fixado por
  role — a resolução vem do default `"$user", public` ou de `options=` na
  string de conexão do deploy). Ainda assim **o runtime NÃO DEVE depender de
  CREATE**: um DDL de boot é (a) round-trip extra por instância, (b) ponto
  único de falha que transforma indisponibilidade/erosão de grants em 500 de
  login para *qualquer* credencial, (c) violação da política "migration é a
  única autoridade DDL". **Corrigido por design:** a DDL só roda reativamente
  quando o Postgres responde `42P01` (tabela genuinamente ausente — primeiro
  boot em Neon/Vercel); papel sem `CREATE` + tabela existente = **zero DDL**;
  tabela ausente **e** sem `CREATE` = erro explícito apontando o
  provisionamento (nunca 500 silencioso). Ver
  `src/lib/__tests__/db-pg-init.test.ts`.
- **Diagnóstico sem máscara:** o `catch` de `/api/auth/login` passa o erro
  real (código Postgres + mensagem) para o log do runtime do servidor
  (`console.error('[auth/login] …')`); o cliente continua recebendo só a
  mensagem genérica. Um 500 de banco nunca mais é confundido com 401 de
  credencial. `lib/pg.ts` registra **uma sonda de boot** por processo
  (`[db/boot]`: `current_user` + `search_path` efetivo + fonte da URL de
  conexão, sem segredos) — o log de runtime de QUALQUER deploy passa a
  responder "quem somos nós no banco", que é exatamente o dado que faltou no
  incidente do login de 2026-09-28.
- **Regra para F1+:** tabelas novas usam `godoutor_internal.*` totalmente
  qualificado (§6.1/§4). A não-qualificação de `instalink_doc` é um artefato
  do legado que morre com o corte de cada domínio — não é precedente.

### 6.3 Grants do papel do backend nos stores internos (`0003`)

As migrações 0001/0002 criaram `godoutor_internal` **fechada** assumindo que
o papel dono da conexão do backend seria o próprio owner do schema. No
Supabase real não é: o backend conecta como papel dedicado (`godoutor_app`),
que **não recebeu** `USAGE` no schema nem `SELECT/INSERT` nas tabelas — e
todo uso futuro dos stores F0 (emissão de domínio, telemetria de IA) falharia
com `42501`. Isso foi corrigido por `db/migrations/0003_internal_backend_grants.sql`:

| Concessão a `godoutor_app` | Valor | Por quê |
|---|---|---|
| `USAGE ON SCHEMA godoutor_internal` | GRANT | sem atravessar o schema, a permissão de tabela não vale nada |
| `SELECT, INSERT` em `domain_event` / `ai_usage` | GRANT | é TODO o SQL dos stores: `SELECT`/`INSERT`/`ON CONFLICT DO NOTHING`/`COUNT`/`SUM` — verificado em `src/lib/domain-events/pg-store.ts` e `src/lib/ai/usage-pg-store.ts` |
| `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES` | **não concedido** | nenhum caminho de código os usa; append-only é contrato do ledger |
| `CREATE ON SCHEMA godoutor_internal` | **não concedido** | autoridade estrutural é a migração, nunca o runtime |
| `anon` / `authenticated` / `service_role` | **nada** | fechamento client-side de 0001/0002 permanece intacto; a 0003 não toca esses papéis |

Portabilidade: a 0003 é guardada por `to_regrole('godoutor_app')` — em
ambientes sem papel de backend dedicado (Neon puro, onde a conexão usa o
owner) é NO-OP; se o papel existe mas as tabelas não (aplicação fora de
ordem), falha explícita `42P01`. Grants **sempre** evoluem em migração nova;
0001/0002 nunca são editadas (já aplicadas).

## 7. Configurações (planejamento — sem UI nova neste estágio)

Clínica (identidade, unidades) · Fiscal · Documentos (templates) · Agenda
(regras/slots) · Financeiro (categorias, recebimentos) · Equipe e acesso
(papéis/permissões) · Canais (WhatsApp/API/webhooks) · Automação e IA
(Features × Limites × Custos — telemetria já existe) · Segurança e auditoria.
Aparência do painel (logo, tema) permanece como está.

## 8. Roadmap incremental — referência histórica F0

> **Nota:** este roadmap reflete a fundação F0. A fila de execução vigente e o estado atual estão em `docs/GODOUTOR-MASTER-PLAN.md`.

| Fase | Entrega | Observação |
|---|---|---|
| **F0 Fundação** | EventLog, DecisionEngine, GenerativeAIProvider, telemetria IA, Página legada, este documento | **esta PR** |
| F1 Clinical Encounter | ClinicalObservation/Problem/Diagnosis/Plan sobre o Encounter; eventos clínicos | evolui `encounters.ts` |
| F2 Prescrição + Documentos | Prescription(+Item), ClinicalDocument/Template/Version | eventos `prescription.*`/`document.*` |
| F3 Ordens/Exames | ClinicalOrder/LabOrder/LabResult | eventos `exam.*` |
| F4 Estoque/Farmácia | InventoryItem/Lot/Movement (mínimo operante) | evento `inventory.*` |
| F5 Billing/Financeiro 2.0 | Invoice/InvoiceItem/Payment ligados ao Encounter | eventos `invoice.*`/`payment.*` |
| F6 Internação/Cirurgia | modelo + agenda de procedimentos | fora do v1 |
| F7 Fiscal/Contabilidade | NFS-e, escrita fiscal | fora do v1 |
| F8 Jev/LLM/Agentes/OaaS | agentes completos, consolidação do EventLog em OAAS, gravação/transcrição | consome F0 |

Cada fase = PR pequena, segura e cumulativa; nada de reescrita.

## 9. Testes e qualidade

- Testes focais:
  - `m12-clinical-os-foundation.test.ts` — EventLog contrato/idempotência/
    redigação/tenant; DecisionEngine Disabled/Mock/TypeSafe-blocked;
    GenerativeAIProvider; telemetria sem prompt; flag da Página;
  - `m12-clinical-os-stores.test.ts` — stores NORMALIZADOS com Pool falso:
    INSERT em `godoutor_internal.domain_event`/`godoutor_internal.ai_usage`
    SEM qualquer DDL no runtime, ON CONFLICT de idempotência, tenant
    isolation em toda query, falha explícita quando a migration não existe
    (42P01 → "aplique a migration 000N"), adapters de memória com o mesmo
    contrato;
  - `m12-clinical-os-hardening.test.ts` — auditoria estática do hardening:
    `id` de `ai_usage` é UUID v4 gerado por `crypto.randomUUID()` (sem
    contador global; `id` explícito de fixture respeitado), stores e
    migrations só referenciam `godoutor_internal.*` com SQL qualificado,
    `estimated_cost` é `NUMERIC(18,8)`, migrations nascem fechadas (REVOKE
    `PUBLIC`/`anon`/`authenticated`/`service_role` + schema sem `USAGE`),
    nenhuma instrução DDL em `src/lib/` e DecisionEngine/Página legada
    intactos.
- `tsc --noEmit` + `build` + suíte completa (baseline 2403/5 pré-existentes).
- Validação local com fixtures/mocks — **nunca produção**; zero escrita
  remota para testar. As migrations `0001`/`0002` foram aplicadas ao
  Supabase real **fora das missões de código** (DDL manual pelo owner, com
  auditoria de grants no alvo — a auditoria de 2026-09-28 que abriu o gap da
  `godoutor_internal` é justamente a verificação pós-aplicação que motivou a
  `0003`, esta ainda **pendente**).
