# P4 — Motor de Automações

> “Quando acontecer X → se Y → faça Z.”
> O sistema pode ser poderoso por dentro; a interface continua de negócio.

```text
GATILHO → CONDIÇÃO → AÇÃO → ESPERA → RAMIFICAÇÃO → AÇÃO → FIM
```

## 1. Arquitetura (e por que não há segundo sistema)

O P4 é uma **camada de orquestração**, não um novo produto paralelo:

```text
        eventos do sistema (já existentes)
                     ↓
   lib/automation/events.ts     ← um gatilho = no máximo uma execução
                     ↓
   db.automationRuns (status queued / waiting)
                     ↓
   lib/automation/executor.ts    ← processa UM nó por vez, persiste, para na espera
                     ↓
   lib/automation/actions.ts     ← NENHUMA regra nova: chama os serviços oficiais
                     ↓
  pipeline.ts · booking-create.ts · booking-status.ts · contacts.ts · webhooks.ts · tasks.ts
```

Arquivos do motor (`src/lib/automation/`):

| Arquivo | Papel |
| --- | --- |
| `model.ts` | Catálogo (gatilhos, campos, ações, nós), validação/normalização da definição, análise do grafo, projeção linear ⇄ grafo, normalização defensiva de registros |
| `conditions.ts` | Avaliação das condições (8 operadores + AND/OR/NOT), resolução de caminho no contexto, templates `{{…}}` |
| `events.ts` | Ônibus de gatilhos: fotografia segura do assunto + criação de execuções (idempotente, anti-loop, teto de fila) |
| `actions.ts` | Execução das ações, delegando 100% às funções oficiais do sistema |
| `executor.ts` | Passo a passo do grafo: posse (claim/lease), limites, esperas, retomada, histórico |
| `tasks.ts` | `Task` — a fila de trabalho interna da unidade (criada por automação ou pela equipe) |
| `capabilities.ts` | Camada única de capacidades/flags (P4.13) e tetos operacionais |
| `templates.ts` | Modelos internos (P4.11) — compilados para o mesmo grafo |
| `serialize.ts` | Projeções de leitura para a interface (nunca expõe posse interna) |
| `ui.ts` | Fachada pura para o cliente (rótulos/catálogo), sem tocar no banco |

Persistência: **o mesmo documento** do banco (`db.automations`, `db.automationRuns`, `db.tasks`).
Nada de Redis, BullMQ, Kafka ou tabela paralela. `updateDB` serializa por instância;
`updateDBWithCas` dá a garantia entre instâncias (mecanismo do P3, reaproveitado).

## 2. Modelo de dados

```ts
Automation {
  id, businessId, name, description, active,
  trigger: { event, condition? },      // o “Quando” (+ “Se” de entrada)
  nodes:  [ { id, type, label?, config } ],   // trigger | condition | branch | action | wait | end
  edges:  [ { from, to, branch? } ],          // branch: 'yes' | 'no' | id do ramo
  settings: { maxSteps?, maxWaitMinutes?, allowReentry?, stopOnActionError?, dedupeField? },
  templateId?, version, createdAt, updatedAt
}

AutomationRun {
  id, businessId, automationId, automationName,     // nome congelado no disparo
  status: queued | running | waiting | completed | failed | cancelled,
  currentNodeId,          // onde CONTINUAR (após uma espera, é o próximo nó)
  context,                // fotografia do evento (whitelist, sem segredo)
  waitingUntil,           // retomada da espera
  history: [ { at, nodeId, nodeType, outcome, label, detail? } ],
  eventKey,               // idempotência do gatilho
  emittedByRunId,         // origem (anti-loop)
  steps, resumes, error, startedAt, updatedAt, finishedAt,
  claimToken?, claimExpiresAt?   // posse da varredura (NUNCA sai na API)
}

Task { id, businessId, title, note, status: open|done|cancelled, dueAt,
       assignedUserId, createdBy, automationId?, automationRunId?, automationNodeId?,
       leadId?, bookingId?, customerId?, source: automation|manual, createdAt, updatedAt, doneAt }
```

Migração: `normalizeDB` adiciona os três arrays (vazios em documentos antigos),
normaliza cada registro de forma **aditiva** (defaults) e descarta, só na leitura,
entradas ilegíveis — nunca sobrescreve o banco por falha de leitura e nunca apaga
nada. `prune` limita execuções **terminais** por empresa (200) e remove tarefas
encerradas com mais de 180 dias; `queued`/`running`/`waiting` **nunca** são podados.

## 3. Gatilhos (P4.2)

Só eventos que o sistema já produz, emitidos no **serviço oficial** (não na rota):

| Evento | Onde nasce |
| --- | --- |
| `lead.created` · `lead.updated` | `pipeline.ts · ingestLead` (página, API externa, assistente, widget) |
| `lead.stage_changed` | `pipeline.ts · moveLeadStage` |
| `lead.assigned` | `pipeline.ts · assignLead` |
| `customer.created` · `customer.updated` | `pipeline.ts · ingestLead` (entrada/atualização do contato no CRM) |
| `booking.created` | `booking-create.ts · createBookingTx` (único caminho de reserva) |
| `booking.confirmed` · `booking.cancelled` · `booking.completed` | `booking-status.ts · applyBookingStatusTx` (painel, cliente e automação) |

Estrutura preparada para o futuro sem canal externo implementado agora: um novo
evento é apenas uma linha em `AUTOMATION_EVENT_DEFS` + um `emitAutomationEvent`
no serviço que o produz. WhatsApp/Instagram/pagamentos/e-mail **não** foram
implementados (P6); `automation.ai` (P5) existe como capacidade, sem motor.

## 4. Condições (P4.3)

Operadores: `equals · not_equals · contains · not_contains · exists · not_exists · greater_than · less_than`,
compostos por `AND · OR · NOT` (grupo aninhável até 6 níveis, 200 nós).

- Comparação determinística: números numericamente (`"10" == 10`), ISO de data por
  texto (ordem lexicográfica = cronológica), texto com `trim` + case-insensitive;
  `''`, `null`, `undefined` e `[]` **não existem**; `contains` também resolve arrays.
- O único dado legível é o **catálogo de campos** (`AUTOMATION_FIELDS`): `lead.*`,
  `customer.*`, `booking.*`, `service.*`, `event.*`, `business.name/slug`. Nada de
  `passwordHash`, segredo de webhook, chave de API — o motor literalmente não sabe
  onde isso fica. Caminhos bloqueados: `__proto__`, `constructor`, `prototype`.
- Nada é compilado/executado: não existe linguagem de expressão no P4. O campo
  `{{caminho}}` em ações é substituição literal (`renderTemplate`), sem operadores.

## 5. Ramificações (P4.4)

- Nó `condition`: um caminho `yes` e um `no` (ausente ⇒ encerra, com o motivo no histórico).
- Nó `branch`: vários ramos rotulados, avaliados em ordem; sem correspondência, segue
  a aresta `else`/`no` ou encerra. Estrutura pronta para múltiplas condições futuras.
- Proteção do executor (limites vêm da capacidade da unidade, `CapabilityLimits`):
  teto de passos por execução (`settings.maxSteps` ∩ limite), **2 visitas por nó**
  (ciclo acidental ⇒ `failed: ciclo detectado`), idade máxima da execução
  (`maxRunAgeDays`), teto de nós por automação, teto de execuções na fila por
  empresa (`MAX_QUEUED_RUNS_PER_BUSINESS`), orçamento de tempo por varredura.
- Na gravação: ciclo **sem** espera é erro (recusado pela API); ciclo **com** espera
  é permitido com aviso e fica limitado pelos passos. Nó fora do caminho do gatilho
  ⇒ aviso. Aresta para nó inexistente ⇒ erro.

## 6. Ações (P4.5) — sempre delegando

| Ação | Chama (e por isso herda as regras) |
| --- | --- |
| `change_lead_stage` | `pipeline.ts · moveLeadStage` (etapa + status mapeado + `stageHistory`) |
| `assign_lead` | `pipeline.ts · assignLead` (com `validateAssignedUser`: só gente da unidade) · `target: 'auto'` = rodízio pelo menos carregado |
| `add_lead_note` | `pipeline.ts · addLeadNote` (replica no contato do CRM) |
| `update_lead` | `pipeline.ts · updateLeadFields` (nova função oficial, usada também pelo painel) |
| `update_customer` | `contacts.ts · upsertContact/addContactNote` (append-only) |
| `create_task` | `automation/tasks.ts · createTaskTx` (dedupe por execução+nó) |
| `create_booking` | `pipeline.ts · bookLead → booking-create.ts` (motor de agenda real: slot, conflito, profissional, lead→scheduled) |
| `cancel_booking` | `booking-status.ts · applyBookingStatusTx` (máquina de estados + histórico + mensagens do P3) |
| `dispatch_webhook` | `webhooks.ts · dispatchWebhook` (HMAC, tentativa 1, retry persistido) |

Regras válidas em toda ação: `businessId` da **execução** (o id vindo do payload
nunca é aceito cru), permissões/regras de agenda e pipeline preservadas porque é a
mesma função que o painel usa, e **idempotência**: ação já aplicada é pulada
(etapa já está lá; responsável já é a pessoa; nota/tarefa com a mesma marca da
execução). Consentimento de marketing **nunca é ligado** por automação — só
removido. `dispatch_webhook`, `create_booking` e `cancel_booking` exigem
`automation.advanced`.

## 7. Esperas (P4.6) e retomada (P4.7)

`wait_for_duration` (minutos) e `wait_until` (`AAAA-MM-DD HH:MM`, e também
“amanhã às 09:00” / “hoje 18:00” — dia relativo + hora no fuso do produto,
resolvidos de forma determinística, sem adivinhar entrada inválida):

```text
encontrou espera → status='waiting', waitingUntil=…, currentNodeId=PRÓXIMO nó
                   → libera a posse, encerra a transação, ACABA a requisição
varredura depois  → 'waiting' vencido é reivindicado e o fluxo continua dali
```

Nada segura HTTP aberto. A varredura acontece em dois lugares, com o mesmo código:

1. **gancho inline** do `updateDB` (`src/lib/db.ts`): se a escrita deixou execução
   `queued`, o motor processa na hora — sem latência para o usuário e sem ler o
   banco quando não há fila. Desligável por `AUTOMATION_INLINE=0`; não reentrante.
2. **agendador** (`GET /api/cron/automations`, `Authorization: Bearer $CRON_SECRET`):
   Vercel Cron, cron da VPS, GitHub Actions, `npm run` avulso ou o botão
   “Processar fila” do painel. `wait_for_event` fica reservado para quando houver
   canal externo (P6): um nó com `mode: 'event'` registra o “ainda não disponível”
   e **segue o fluxo** (nunca trava a execução para sempre).

## 8. Executor (P4.7) — determinístico e seguro contra corrida

- Reivindica execuções devidas com **CAS** (`updateDBWithCas`): `queued`,
  `waiting` vencido, ou `running` com posse morta (função interrompida).
- Cada nó é processado dentro de **um** `updateDB`: a ação e o novo estado da
  execução são gravados juntos — não existe “meio passo” nem estado perdido.
- A posse (`claimToken` + `claimExpiresAt`, `AUTOMATION_LEASE_MS`) impede que duas
  instâncias processam a mesma execução; o passo revalida a posse e, se ela não é
  mais sua, para (`not_mine`) em vez de duplicar efeito.
- Orçamento por varredura (`AUTOMATION_BUDGET_MS`, `AUTOMATION_BATCH_SIZE`): o que
  não coube volta para `queued` e é pego pelo próximo ciclo.
- Erro de ação ⇒ `failed` + mensagem curta no histórico (`stopOnActionError: false`
  permite seguir, registrando o erro). Infra quebrou no meio ⇒ a execução é marcada
  e o próximo ciclo decide; nada é perdido.

## 9. Histórico (P4.8)

Cada passo vira uma linha legível: `Gatilho lead.created`, `Condição → sim` (com
`lead.origin é "instagram" → instagram`), `Alterar etapa do lead → lead para a
etapa qualifying`, `Esperando 2 horas (retoma em …)`, `Execução concluída`.
`detail` é limitado a 300 caracteres, o histórico é limitado por execução, e nada
de segredo é gravado (o contexto é uma whitelist de campos operacionais).

## 10. Interface (P4.10)

`/automacoes` (menu Gestão, permissão `config`):

- **Minhas automações**: nome, resumo em texto (“Quando Lead criado · Se origem é
  instagram · Então: Alterar etapa …”), liga/desliga num clique, estatísticas
  (execuções, aguardando, com erro, última execução e motivo), avisos de revisão.
- **Criar modelo** (galeria) e **Nova automação** com o editor linear:
  `Quando` (seleção de evento) → `Se` (campo/operador/valor, E/OU, “NÃO é isso”)
  → `Então/Depois` (ações e esperas, reordenáveis) → `Senão` (ramificação).
  Campos de ação são renderizados pelo catálogo (`stage`, `service`, `member`,
  texto/número/booleano), com `{{lead.name}}` livre em textos.
- **Execuções**: estado, quem disparou, passo a passo com o vereditos das condições,
  “Processar agora” e “Encerrar execução”.
- **Tarefas**: a fila aberta/atrasadas do time, com origem (automação/pessoa), e
  concluir; a automação escreve exatamente na mesma lista.
- Duplicar (a cópia nasce **desligada**), excluir com confirmação explícita sobre o
  que acontece com o histórico.

Nada de canvas de arrastar-nós: o grafo é o modelo persistido (e está na API), a
UI é a projeção simples. Um editor visual futuro lê/escreve os mesmos `nodes`/`edges`.

## 11. API

| Rota | Guarda | Faz |
| --- | --- | --- |
| `GET /api/automations?businessId=` | `config` | lista + projeção linear + estatísticas + modelos + capacidades + opções do editor (etapas reais, serviços, equipe) |
| `POST /api/automations` | `config` | criar (linear ou grafo), `action: 'toggle'`, `action: 'duplicate'`, `templateId` |
| `PATCH /api/automations` | `config` | editar (validação completa; version++; reedição estrutural encerra execuções em espera) |
| `DELETE /api/automations` | `config` | excluir (execuções viram histórico) |
| `GET /api/automations/[id]?businessId=` | `config` | definição + execuções com histórico |
| `POST /api/automations/[id]` | `config` | `action: 'drain'` (empurra a fila agora) · `action: 'cancel-run'` |
| `GET/PATCH/POST /api/tasks` | `leads`/`agenda`/`clientes`/`config` | fila de tarefas da unidade |
| `GET /api/cron/automations` | `CRON_SECRET` | varredura do motor (retomada), só contadores na resposta |

`businessId` sempre do contexto autenticado (`requireBusiness`) — o id no corpo
nunca troca de tenant. `POST /api/automations` aceita `Idempotency-Key` (o mesmo
mecanismo do P3): reenvio com a mesma chave devolve a resposta original e não
cria automação gêmea. Erros de validação voltam como `422 { errors: [...] }` com
frases em português (o que a UI mostra sem interpretar nada).

## 12. Preparado para IA (P4.12) sem IA

A definição é JSON fechado e validável; um agente do P5 pode gerar exatamente a
forma linear (`event`, `condition`, `steps`, `elseSteps`) ou o grafo, sem saber que
existe `Lead`, `stageHistory` ou uma tabela. O servidor valida (catálogo de
gatilhos, campos, ações, esteira real da unidade, limites de capacidade) e o
usuário aprova. O tipo `action.type = 'ai'` não existe ainda — quando existir, é
uma entrada no catálogo com `requires: 'automation.ai'`, e nada mais.

## 13. Capacidades (P4.13)

`hasCapability(business, id)` é a **única** decisão; nenhum `if plan === ...` no
código. Precedência: override da unidade (`Business.capabilityFlags`) → ambiente
(`AUTOMATION_CAPS`) → padrão do produto. `limitsFor(business)` deriva os tetos.
Ações que exigem `automation.advanced` são recusadas **na validação** e
revalidadas **na execução** (a definição pode ter nascido antes de o recurso ser
desligado). `automation.ai`, `channel.whatsapp` e `channel.instagram` existem como
bandeiras com `available: false` — ligar não libera nada enquanto o motor não
existe (falha segura).

## 14. O que foi alterado em P0–P3 (e por quê)

| Arquivo | Motivo | Impacto | Teste de regressão |
| --- | --- | --- | --- |
| `src/lib/types.ts` | modelo do P4 | **aditivo**: `automations`, `automationRuns`, `tasks`, `Business.capabilityFlags`, novos `AuditAction` | `db-migration.test.ts`, `automation-model.test.ts` (migração defensiva) |
| `src/lib/db.ts` | persistência/normalização/prune + gancho inline | novos arrays + defaults; nenhuma reescrita destrutiva; gancho só quando há fila | `automation-integration-p4.test.ts` (persistência, retomada, gancho desligável) |
| `src/lib/pipeline.ts` | gatilhos no ponto oficial + `updateLeadFields` (função nova usada também pelo painel) | `ingestLead`/`moveLeadStage`/`assignLead` ganham parâmetros **opcionais** (`origin`, `note`) e emitem eventos; nenhuma mudança de contrato/retorno | `pipeline.test.ts` (27) + `automation-engine.test.ts`, `automation-integration-p4.test.ts` |
| `src/lib/booking-create.ts` | `booking.created` para todo caminho de reserva | `originRunId` opcional; evento emitido no fim da transação | `booking.test.ts`, `slot*/schedule/agenda-*`, `smoke`, `smoke:p3` |
| `src/lib/booking-ops.ts` + **`src/lib/booking-status.ts` (novo)** | a automação precisava transicionar status pela mesma porta ⇒ extração da regra que estava na rota | `booking-ops.ts` continua PURE (Client Components) — a transição mora em módulo server; mensagem de recusa, histórico, máquina de estados e mensagens do P3 preservados | `booking-ops.test.ts`, `smoke:p3` ( PATCH de status ), `automation-integration-p4.test.ts` (‘transição extraída continua idêntica’) |
| `src/app/api/bookings/route.ts` | usar a função oficial | mesma resposta/`status`/`422` com a mesma frase; bloco duplicado de automação de mensagem removido (vive na função) | `smoke`, `smoke:ux`, `smoke:p3` |
| `src/app/api/customer/bookings/route.ts` | cancelamento pela mesma função | cancelamento do cliente ganha histórico/idempotência idênticos ao painel + dispara `booking.cancelled` | `smoke` (fluxo do consumidor), `automation-integration-p4.test.ts` |
| `src/lib/panel.ts`, `src/lib/http.ts`, `src/components/DashboardShell.tsx`, `src/components/icons.tsx` | rota/menu/ícone/área | `/automacoes` entra na navegação (Gestão, `config`); label de área novo; glifo `bolt` | `panel.test.ts` (catálogo + API_GUARDS + navegação) |
| `package.json`, `.env.example`, `README.md`, `ARQUITETURA.md` | script `smoke:p4` e variáveis do motor | nenhum comportamento muda | `npm run smoke:p4` |

Nada do P3 foi reaberto/refatorado “por estética”: as duas extrações (`updateLeadFields`,
`applyBookingStatusTx`) existem porque a automação precisava chamar a regra oficial em
vez de reimplementá-la.

## 15. Testes

```bash
npm test -- --run src/lib/__tests__/automation-model.test.ts        # 32 (definição, grafo, esperas, projeção, capacidades, templates, migração, E2E)
npm test -- --run src/lib/__tests__/automation-engine.test.ts       # 37 (condições, ações, executor, proteções, histórico)
npm test -- --run src/lib/__tests__/automation-integration-p4.test.ts  # 16 (persistência, P3, HTTP/tenants, cron)
npm run smoke:p4                                                     # 18 verificações de ponta a ponta
```

Suíte completa: `npx tsc --noEmit` limpo, `npm test` (680 testes, 46 arquivos),
`npm run build`, `npm run smoke` (67), `npm run smoke:ux` (87), `npm run smoke:p3` (15 fluxos).

## 16. Fora do P4 (deliberadamente)

P5 (IA/agente) e P6 (canais: WhatsApp/Instagram/pagamentos/e-mail), `wait_for_event`
disparado por evento externo, editor visual de grafo, cobrança/planos (só a camada de
capacidade), UI do `capabilityFlags` por empresa (definível por ambiente/override), e
qualquer reestruturação cosmética de P0–P3.
