# GoDoutor Clinical OS v1 — Fundação

> Arquitetura e roadmap do GoDoutor como **sistema operacional da clínica**
> (vertical: clínica veterinária). Escopo deste documento: F0 — Fundação.
> Design System **aprovado e congelado** — este documento não muda telas nem
> identidade visual.

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

### 3.1 EventLog — eventos de domínio

Coleção `domainEvents` (aditiva; `normalizeDB` preenche `[]` — **zero migração
destrutiva, `instalink_doc` intocado**).

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

API: `emitDomainEvent` (puro/validado) · `recordDomainEvent` (persistência +
idempotência) · `listDomainEvents` (leitura sempre por `businessId`).
A Automação futura (F8) consome ESTE log — nunca um formato paralelo.

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
- Telemetria (`AiUsageRecord`, coleção `aiUsage`): `businessId · agentId ·
  feature · provider · model · inputTokens · outputTokens · audioSeconds ·
  estimatedCost · latencyMs · decisionType · confidence · createdAt`.
  **Nunca armazena prompts clínicos completos** — só números. Custo de IA
  por clínica nasce aqui (`aiUsageTotals`).

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

1. **Sem migração destrutiva, sem apagar `instalink_doc`.** Coleções novas
   (`domainEvents`, `aiUsage`) são **aditivas** com default `[]` em
   `normalizeDB` (reversível e idempotente).
2. **Plano de corte por domínio** (fases F1+): cada domínio que precisar de
   tabela normalizada migra com dual-read/dual-write **controlado**, na ordem:
   `domain_event` → `clinical_encounter` → `prescription/order` → `invoice/
   payment` → `inventory` — cada corte é um PR próprio, com paridade testada
   antes do flip. `instalink_doc` vira, gradualmente, o ledger legado lido
   até a última migração.
3. **Multi-tenant**: toda tabela/coleção nova carrega `business_id` (e
   `organization_id` quando a entidade pertence à organização). Índices por
   `(business_id, tipo, data)`. Leitura SEMPRE escopada por tenant (o
   `listDomainEvents` já exige `businessId`).
4. Relações nomeadas: `patient→tutor`, `encounter→appointment/queue_entry`,
   `prescription→encounter`, `order→encounter`, `invoice→encounter`,
   `payment→invoice`, `inventory_movement→lot`, `domain_event→entidade`.

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

## 7. Configurações (planejamento — sem UI nova neste estágio)

Clínica (identidade, unidades) · Fiscal · Documentos (templates) · Agenda
(regras/slots) · Financeiro (categorias, recebimentos) · Equipe e acesso
(papéis/permissões) · Canais (WhatsApp/API/webhooks) · Automação e IA
(Features × Limites × Custos — telemetria já existe) · Segurança e auditoria.
Aparência do painel (logo, tema) permanece como está.

## 8. Roadmap incremental

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

- Testes focais: `m12-clinical-os-foundation.test.ts` (EventLog contrato/
  idempotência/redigação; DecisionEngine Disabled/Mock/TypeSafe-blocked;
  GenerativeAIProvider; telemetria; flag da Página).
- `tsc --noEmit` + `build` + suíte completa (baseline 2403+).
- Validação local com fixtures/mocks — **nunca produção**; zero escrita
  remota para testar.
