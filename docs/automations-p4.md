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

### Dedupe, reentrância e teto de fila

O escopo efetivo do dedupe é **(unidade, automação, chave)**. Isso é o que garante
as três coisas que parecem iguais mas não são:

| Caso | O que acontece |
| --- | --- |
| Duas automações escutando o mesmo evento | cada uma cria a **sua** execução (uma não “queima” a chave da outra) |
| Unidade B recebe o mesmo conteúdo que a unidade A | chave igual, tenants diferentes ⇒ as duas criam execução (o dedupe de A não consome o de B) |
| Reenvio do mesmo evento na mesma unidade+automação | bloqueado, com `skipped: 'execução já existe para este evento (<status>)'` |

Como a chave é derivada (`deriveEventKey`):

1. **`eventKey` explícito** do chamador vence — é a única forma de dedupar um
   reenvio que chega em outro instante (chave de idempotência do P3, id do
   sistema externo). `POST /api/automations` também aceita `Idempotency-Key`
   para a *criação* da definição.
2. **`settings.dedupeField`** (ex.: `lead.id`) ⇒ `evento:field:<valor>`: uma
   execução por lead para aquela automação+evento, seja lá quando for — o
   “não repetir nunca” que se espera de um follow-up. O campo é validado contra
   a lista de campos do evento; inválido ⇒ ignorado **com aviso** na resposta
   (criar e editar devolvem `warnings`).
3. **padrão**: `evento:assunto:sha256(fotografia+dados)[:16]` — fotografia do
   assunto sem campos voláteis de tempo do evento. Deduplica a MESMA mutação
   reaplicada (o mesmo `at`/mesma transação). Como a fotografia inclui
   `lastInteraction`/etapa, um evento legítimo seguinte tem chave nova e dispara.
   Não é “uma vez por sempre”: para isso existe `dedupeField`/`eventKey`.

A janela do dedupe são as execuções retidas no documento (30 dias, até 200
terminais por unidade — `prune` em `db.ts`): não há índice nem tabela paralela.

**Anti-loop.** Evento produzido POR uma execução (`fromRunId`/`origin.runId`,
gravado em `emittedByRunId`) não reabre automação nenhuma, a menos que a
automação declare `settings.allowReentry: true`. E, quando reentra, a corrente
tem fundo: `MAX_REENTRY_DEPTH = 5` saltos de linhagem (`reentryDepth`), depois
disso o gatilho registra `skipped: 'cadeia de reentrada atingiu o limite…'`.
O teto de fila (`MAX_QUEUED_RUNS_PER_BUSINESS = 400` execuções vivas por
unidade) continua sendo a última barreira contra crescimento do documento.

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

Nada segura HTTP aberto. A varredura acontece em três lugares, com o MESMO código:

1. **gancho inline** do `updateDB` (`src/lib/db.ts`): se a escrita deixou
   **trabalho pronto agora** — `queued`, `waiting` vencido ou `running` com posse
   morta — o motor roda em seguida, sem ler o banco quando não há nada pronto.
   Desligável por `AUTOMATION_INLINE=0`; não reentrante. É o que faz a espera
   retomar sozinho num ambiente SEM agendador configurado (ver abaixo).
2. **agendador** (`GET /api/cron/automations`, `Authorization: Bearer $CRON_SECRET`):
   Vercel Cron, cron da VPS, GitHub Actions, `npm run` avulso ou o botão
   “Processar fila” do painel (o botão drena SÓ a unidade do usuário).
   `wait_for_event` fica reservado para quando houver canal externo (P6): um nó
   com `mode: 'event'` registra o “ainda não disponível” e **segue o fluxo**
   (nunca trava a execução para sempre).
3. **qualquer escrita do sistema** (mesma do item 1): a fila é sempre
   retomada pelo estado gravado no banco, nunca por memória/instância.

### Situação REAL do agendamento em produção

O projeto roda na **Vercel Hobby**, onde o cron nativo é limitado a 1x/dia — por
isso o repositório **não tem `vercel.json` com `crons`** (mesma decisão documentada
do retry de webhooks no P3; `README.md` §“Retry de webhooks no Hobby”). Consequências
medidas, não presumidas:

| Cenário | Comportamento |
| --- | --- |
| Nenhum agendador configurado | o passo imediato acontece (gancho inline); uma espera retoma na **próxima escrita** do sistema (outro lead, outro agendamento, uma edição no painel) ou no botão do painel. Não há perda: o estado é o banco |
| `CRON_SECRET` ausente | `GET /api/cron/automations` responde **503** e NÃO processa fila nenhuma (fail-closed; nada roda por rota aberta) |
| Segredo errado/ausente na chamada | **401**, fila intocada |
| Agendador a cada minuto | esperas retomam no minuto seguinte ao vencimento (`waitingUntil` é comparado no motor, e uma chamada antecipada não adianta nada) |

Para colchão de verdade (negócio parado fora do horário, espera longa), o
deploy precisa de UM destes: `CRON_SECRET` + Vercel Cron (plano Pro), ou o
`curl` no cron da VPS/GitHub Actions documentado no `README.md`, ou `AUTOMATION_INLINE`
ligado (padrão) aceitando o gancho inline. O motor não cria dependência nova
nenhuma em nenhum dos três casos.

## 8. Executor (P4.7) — determinístico e seguro contra corrida

- Reivindica execuções devidas com **CAS** (`updateDBWithCas`): `queued`,
  `waiting` vencido, ou `running` com posse morta (função interrompida).
- Cada nó é processado dentro de **um** `updateDB`: a ação e o novo estado da
  execução são gravados juntos — não existe “meio passo” nem estado perdido.
- A posse (`claimToken` + `claimExpiresAt`, `AUTOMATION_LEASE_MS`) impede que duas
  instâncias processem a mesma execução; o passo revalida a posse e, se ela não é
  mais sua, para (`not_mine`) em vez de duplicar efeito.
- **Por que o passo não é CAS** (e a reivindicação é): a ação pode ter I/O
  (`dispatch_webhook` tenta a entrega na hora), e CAS reexecutaria o callback a
  cada conflito — o destinatário veria o mesmo webhook duas vezes. A segurança
  vem de outro lugar: **idempotência por execução+nó** (nota, tarefa, etapa,
  agendamento reconhecem o que já foi aplicado e pulam). Se a gravação do passo
  for perdida numa corrida, o nó é re*visita*do, não re*fectido*.
- `drainAutomations({ businessId })` reivindica **só** as execuções daquela
  unidade — o botão “Processar fila” do painel não drena (nem escreve) na
  unidade vizinha, e não consome o lote/orçamento de outra empresa.
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
frases em português (o que a UI mostra sem interpretar nada). `warnings` da
validação saem tanto na criação quanto na edição (configuração ignorada é dita).

O que a auditoria da PR #18 travou como contrato (cada um com teste em
`automation-audit-p4.test.ts`):

- **nada de posse interna na resposta**: `claimToken`/`claimExpiresAt` são
  removidos por `sanitizeAutomationRunForDisplay` na lista E no detalhe;
- `GET /api/automations/[id]`, `PATCH`, `POST action`, `DELETE` e `cancel-run`
  filtram por `businessId` da sessão: id de outra unidade ⇒ `404` (e chamar a
  rota com o `businessId` alheio ⇒ `403` antes de qualquer dado);
- automação desativada/excluída ⇒ execuções vivas viram `cancelled` na hora e o
  próximo evento não cria execução nova;
- `/api/tasks`: `leadId`/`bookingId`/`customerId` de outra unidade são recusados
  (`422`) e as leituras de apoio são escopadas pela unidade da tarefa — um id
  roubado não devolve nome de cliente alheio; o `assignedUserId` passa pela
  MESMA validação de equipe que a automação usa (`validateAssignedUser`).

## 12. Preparado para IA (P4.12) — o P5 já usa este contrato

A definição é JSON fechado e validável. O P5 (`src/lib/ai/`, `docs/ai-p5.md`)
gera exatamente a forma linear (`event`, `condition`, `steps`, `elseSteps`) e
compila com `linearToGraph` + `validateAutomationDraft`. Sem saber que existe
`Lead`, `stageHistory` ou uma tabela. O servidor valida (catálogo de gatilhos,
campos, ações, esteira real da unidade, limites de capacidade) e o usuário
aprova. Não existe `action.type = 'ai'`: a IA não é uma ação do motor.

## 13. Capacidades (P4.13)

`hasCapability(business, id)` é a **única** decisão; nenhum `if plan === ...` no
código. Precedência: override da unidade (`Business.capabilityFlags`) → ambiente
(`AUTOMATION_CAPS`) → padrão do produto. `limitsFor(business)` deriva os tetos.
Ações que exigem `automation.advanced` são recusadas **na validação** e
revalidadas **na execução** (a definição pode ter nascido antes de o recurso ser
desligado). `channel.whatsapp` e `channel.instagram` existem como bandeiras com
`available: false` (P6). `automation.ai` passou a `available: true` no P5 — a
IA gera o plano; publicar continua sendo ato humano e a execução continua no P4.

## 14. O que foi alterado em P0–P3 (e por quê)

| Arquivo | Motivo | Impacto | Teste de regressão |
| --- | --- | --- | --- |
| `src/lib/types.ts` | modelo do P4 | **aditivo**: `automations`, `automationRuns`, `tasks`, `Business.capabilityFlags`, novos `AuditAction` | `db-migration.test.ts`, `automation-model.test.ts` (migração defensiva) |
| `src/lib/db.ts` | persistência/normalização/prune + gancho inline | novos arrays + defaults; normalização conserta e não descarta definição com dono; prune nunca toca em `queued`/`running`/`waiting`; gancho dispara quando há **trabalho pronto** (fila, espera vencida, posse morta) | `automation-integration-p4.test.ts` (persistência, retomada, gancho desligável), `automation-dedupe-p4.test.ts` (normalização/poda), `automation-audit-p4.test.ts` (falha de leitura não sobrescreve; gancho retoma espera sem cron) |
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
npm test -- --run src/lib/__tests__/automation-model.test.ts        # 33 (definição, grafo, esperas, projeção, capacidades, templates, migração, E2E)
npm test -- --run src/lib/__tests__/automation-engine.test.ts       # 40 (condições, ações, executor, proteções, histórico)
npm test -- --run src/lib/__tests__/automation-integration-p4.test.ts  # 16 (persistência, P3, HTTP/tenants, cron)
npm test -- --run src/lib/__tests__/automation-dedupe-p4.test.ts    # 12 (auditoria: dedupe A–E, reentrância, normalização/poda)
npm test -- --run src/lib/__tests__/automation-audit-p4.test.ts     # 21 (auditoria: cron/retomada, tenants negativos, E2E, vazamentos)
npm run smoke:p4                                                     # 18 verificações de ponta a ponta
```

Suíte completa: `npx tsc --noEmit` limpo, `npm test` (717 testes, 48 arquivos),
`npm run build`, `npm run smoke` (67), `npm run smoke:ux` (87), `npm run smoke:p3` (15 fluxos
+ consumidor de retry real com `CRON_SECRET`).

Cada correção da auditoria tem teste que **falha no código anterior à correção** (foi assim
que se validou que os testes não são decorativos): gancho inline, fila por unidade, posse na
API, referências de tarefa e fundo da reentrância.

## 16. Fora do P4 (deliberadamente)

P6 (canais: WhatsApp/Instagram/pagamentos/e-mail), `wait_for_event`
disparado por evento externo, editor visual de grafo, cobrança/planos (só a camada de
capacidade), UI do `capabilityFlags` por empresa (definível por ambiente/override), e
qualquer reestruturação cosmética de P0–P3.
