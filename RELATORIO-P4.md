# P4 — Motor de Automações (relatório da entrega)

Ramo: `arena/01a0aaa4-instalink` · base: `main` em `972938b` (merge do P3).
Commits (5): fundação do motor → ações/tarefas/templates/API/painel/suítes → docs+smoke+integração → polimento → comentários.
Nenhum merge foi feito; PR exclusiva do P4 (ver §14).

---

## 1. Arquitetura escolhida

O P4 entrou como **camada de orquestração** sobre os serviços que já existiam — nunca
como um segundo sistema:

```text
eventos que o sistema já produz (pipeline · booking-create · booking-status)
        ↓  emitAutomationEvent (lib/automation/events.ts)
db.automationRuns  →  status 'queued' | 'waiting'
        ↓  executor (claim/lease + CAS, um nó por transação)
ações (lib/automation/actions.ts) → movem dados pelas FUNÇÕES OFICIAIS:
   moveLeadStage · assignLead · addLeadNote · updateLeadFields
   upsertContact/addContactNote · createTaskTx · bookLead → createBookingTx
   applyBookingStatusTx · dispatchWebhook
```

Decisões estruturais:

- **Persistência no mesmo documento** do banco (`db.automations`, `db.automationRuns`,
  `db.tasks`). Nenhuma tabela/DB/fila externa; sem Redis, BullMQ ou Kafka. O banco é o
  árbitro da concorrência (`updateDBWithCas` do P3, reaproveitado).
- **O gatilho nasce no serviço, não na rota**: `ingestLead` (página, API externa,
  assistente, widget), `moveLeadStage`, `assignLead`, `createBookingTx` (todas as
  reservas) e `applyBookingStatusTx` (painel e cliente) emitem o evento dentro da
  MESMA transação da mutação. Uma rota não pode “esquecer” de disparar.
- **Modelo canônico = grafo; a interface = projeção linear** (“Quando/Se/Então/Depois/
  Senão”), com `linearToGraph`/`graphToLinear` reversíveis. Um editor visual futuro e o
  agente do P5 escrevem a mesma estrutura.
- **Motor separado das mensagens do P3**: `lib/automations.ts` (confirmação/lembrete/
  avaliação na fila do WhatsApp) continua intocado e passa a ser acionado pela MESMA
  função de transição (`applyBookingStatusTx`) — a extração não reescreveu regra nenhuma.
- Módulos novos em `src/lib/automation/`: `model` (catálogo+validação+grafo),
  `conditions`, `events`, `actions`, `executor`, `tasks`, `capabilities`, `templates`,
  `serialize`, `ui` (fachada pura para o cliente).

## 2. Modelo de dados

```ts
Automation { id, businessId, name, description, active,
             trigger: { event, condition? },
             nodes[]  (trigger | condition | branch | action | wait | end),
             edges[]  (from, to, branch?  ·  'yes' | 'no' | id do ramo),
             settings { maxSteps?, maxWaitMinutes?, allowReentry?, stopOnActionError?, dedupeField? },
             templateId?, version, createdAt, updatedAt }

AutomationRun { id, businessId, automationId, automationName,
                status (queued|running|waiting|completed|failed|cancelled),
                currentNodeId, context, waitingUntil,
                startedAt, updatedAt, finishedAt, error, history[],
                eventKey, emittedByRunId, steps, resumes,
                claimToken?, claimExpiresAt? }

Task { id, businessId, title, note, status (open|done|cancelled), dueAt,
       assignedUserId, createdBy, automationId?, automationRunId?, automationNodeId?,
       leadId?, bookingId?, customerId?, source, createdAt, updatedAt, doneAt }
```

- Isolamento por tenant: `businessId` em toda entidade, revalidado em cada passo.
- Execução persistida + retomada: `waitingUntil` + `currentNodeId` = **próximo** nó.
- Histórico por passo (`AutomationRunStep`: at, nodeId, nodeType, outcome, label, detail).
- `Task` foi criado porque a automação precisava de uma fila real de tarefas; é a única
  estrutura de tarefa do produto (espe­lha `Lead.nextAction` quando há lead, nunca o
  contrário). Ações da automação e da equipe escrevem no mesmo lugar.
- **Migração**: aditiva. `emptyDB` ganha os arrays; `normalizeDB` preenche defaults,
  normaliza nós/arestas/histórico e descarta (só na leitura) registros ilegíveis;
  `prune` limita execuções **terminais** (200/unidade, 30 dias) e tarefas encerradas
  (180 dias) — `queued/running/waiting` nunca são podados. Nada é reescrito nem apagado.

## 3. Gatilhos

`lead.created` · `lead.updated` · `lead.stage_changed` · `lead.assigned` ·
`customer.created` · `customer.updated` · `booking.created` · `booking.confirmed` ·
`booking.cancelled` · `booking.completed` — exatamente a base pedida, e todos produzidos
por código que já existia.

Preparação para o futuro sem implementar canal: novo evento = uma linha em
`AUTOMATION_EVENT_DEFS` + um `emitAutomationEvent` no serviço que o produz. WhatsApp,
Instagram, Facebook, IA, pagamentos e e-mail externo **não** foram tocados.

## 4. Condições

Operadores fixos: `equals · not_equals · contains · not_contains · exists · not_exists ·
greater_than · less_than`, com `AND · OR · NOT` (grupos aninháveis, 200 nós/6 níveis).

- Semântica determinística: números numericamente, datas ISO por texto (ordem =
  cronológica), texto `trim` + case-insensitive, `''`/`null`/`[]` = não existe.
- Só lê o **catálogo de campos** (`AUTOMATION_FIELDS`): `event.*`, `lead.*`, `customer.*`,
  `booking.*`, `service.*`, `business.*`, com campos filtrados por gatilho. Não há acesso
  arbitrário ao banco nem leitura de segredo (bloqueado também para `__proto__`/
  `constructor`/`prototype`).
- Nenhuma linguagem própria, nenhum `eval`: `{{lead.name}}` é substituição literal.

## 5. Ações

| Ação | Delega para |
| --- | --- |
| `change_lead_stage` | `pipeline.ts · moveLeadStage` |
| `assign_lead` | `pipeline.ts · assignLead` (+ `validateAssignedUser`) · rodízio menos carregado · remover responsável |
| `add_lead_note` | `pipeline.ts · addLeadNote` (replica no contato) |
| `update_lead` | `pipeline.ts · updateLeadFields` (nova função oficial; `/api/leads` PATCH passou a usá-la) |
| `update_customer` | `contacts.ts · upsertContact` / `addContactNote` |
| `create_task` | `automation/tasks.ts · createTaskTx` |
| `create_booking` | `pipeline.ts · bookLead` → `booking-create.ts · createBookingTx` |
| `cancel_booking` | `booking-status.ts · applyBookingStatusTx` |
| `dispatch_webhook` | `webhooks.ts · dispatchWebhook` |

Respeitam `businessId`/organização/permissões/regras de agenda e pipeline **porque
chamam a mesma função do painel**: slot revalidado (409 vira erro legível da execução),
profissional resolvido pela política interna, etapa inexistente recusada, responsável de
outra unidade recusado, append-only preservado. Idempotência por execução+nó (nota/tarefa
não se repetem na retomada; etapa/responsável já aplicados são pulados). Consentimento de
marketing nunca é ligado por automação (apenas removido).

## 6. Executor

Inicia → carrega contexto → processa o nó → avalia condição → executa ação → avança →
persiste → pausa em espera → retoma → finaliza → registra erro. Cada nó é **uma**
transação (`updateDB`): ação e estado gravados juntos, sem “meio passo”.

Proteções: posse com lease (`claimToken`/`claimExpiresAt`, 30s) reivindicada por CAS — a
mesma execução jamais é processada por duas instâncias, e passo com posse perdida para em
`not_mine`; teto de passos (`settings.maxSteps` ∩ capacidade), 2 visitas por nó (ciclo
acidental ⇒ `failed: ciclo detectado`), idade máxima da execução, orçamento de tempo por
varredura, teto de nós/automação, teto de fila por empresa, revalidação de capacidade por
ação, `active=false` ⇒ execução em andamento é cancelada com motivo no histórico.

## 7. Delays

`wait_for_duration` (minutos; presets 10 min … 7 dias) e `wait_until`
(`AAAA-MM-DD HH:MM`, aceita “amanhã às 09:00”/“hoje 18:00”). Ao encontrar espera:
`status='waiting'`, `waitingUntil`, `currentNodeId` = nó seguinte, posse liberada e
**nenhuma requisição fica aberta**. Retomada por `GET /api/cron/automations`
(`CRON_SECRET`, fail-closed 503), pelo botão “Processar fila” do painel ou pelo gancho
inline do `updateDB`. `wait_for_event` existe como estrutura (`mode: 'event'`) — hoje o
nó registra “ainda não disponível” e segue, em vez de travar para sempre.

## 8. Interface

`/automacoes` (menu Gestão, permissão `config`), com `AutomationsView`:
lista com liga/desliga por clique, resumo em linguagem natural, estatísticas (execuções,
aguardando, com erro, última + motivo) e avisos de revisão; galeria de modelos;
editor linear (Quando → Se com E/OU/NÃO → Então/Depois com ações e esperas reordenáveis →
Senão → avançado); aba de execuções com o passo a passo e ações “Processar agora” /
“Encerrar execução”; aba de tarefas (concluir, origem, prazo). Criar, editar, duplicar
(cópia nasce **desligada**), excluir com confirmação explícita. Sem canvas de nós —
o grafo fica na API para o editor visual futuro.

API: `GET/POST/PATCH/DELETE /api/automations`, `GET/POST /api/automations/[id]`,
`GET/POST/PATCH /api/tasks`, `GET /api/cron/automations` — todas com `requireBusiness`
(id do corpo nunca troca de tenant) e erros de validação em português (`422 { errors }`).

## 9. Integração com P3 (e P0–P2)

- Gatilho emitido dentro dos serviços oficiais (`pipeline.ts`, `booking-create.ts`,
  `booking-status.ts`), com origem da execução (`origin.runId`) para anti-loop.
- `updateLeadFields` (novo, `pipeline.ts`): passou a ser o atualizador de campos livres
  do lead, usado pelo painel **e** pela automação (antes a rota escrevia direto).
- `applyBookingStatusTx` (novo módulo `booking-status.ts`): a transição de status que
  vivia dentro de `/api/bookings` (máquina de estados + histórico + mensagens do P3) foi
  extraída e é usada por painel, cliente e automação. `booking-ops.ts` continua PURO para
  os Client Components (a build quebrou quando a função ficou lá — corrigido assim).
- `dispatchWebhook`, `claim/lease`, `Idempotency-Key`, `pushAudit`, `pushIntegrationLog`,
  `normalizeFeatures`, `resolveAccess`, `scopeBookings`, motor de slots: todos
  reutilizados, nenhum duplicado.
- Auditoria ganhou `automation.*` e `task.*`.

## 10. Proteção multi-tenant

`businessId` sempre do contexto autenticado; `automationsOf/automationsForEvent` filtram
por unidade; snapshot do assunto exige `businessId` igual; ações buscam lead/booking/
contato **com o businessId da execução** (id alheio no payload não resolve); a esteira
validada é a da unidade; testes HTTP provam que B não lista, não lê, não cria e não
conclui tarefa de A (403/404) e que o gatilho em B não gerou nada em A.

## 11. Arquivos alterados

**Novos (17):** `src/lib/automation/{model,conditions,events,actions,executor,tasks,capabilities,templates,serialize,ui}.ts`,
`src/lib/booking-status.ts`, `src/app/api/automations/route.ts`,
`src/app/api/automations/[id]/route.ts`, `src/app/api/tasks/route.ts`,
`src/app/api/cron/automations/route.ts`, `src/app/(dashboard)/automacoes/page.tsx`,
`src/components/dashboard/AutomationsView.tsx`, `scripts/smoke-p4.mjs`,
`docs/automations-p4.md`, testes/suítes (`automation-{model,engine,integration-p4}.test.ts`,
`helpers/automation-fixtures.ts`).

**Modificados (11):** `types.ts` (modelo + `capabilityFlags` + `AuditAction`), `db.ts`
(normalização, prune, gancho inline), `pipeline.ts`, `booking-create.ts`, `booking-ops.ts`,
`panel.ts`, `http.ts`, `DashboardShell.tsx`, `icons.tsx`, `api/leads/route.ts`,
`api/bookings/route.ts`, `api/customer/bookings/route.ts`, `package.json`,
`.env.example`, `README.md`, `ARQUITETURA.md`, `panel.test.ts`, `tsconfig.tsbuildinfo`.

Tabela arquivo → motivo → impacto → teste de regressão: §14 de `docs/automations-p4.md`.

## 12. Testes

`npm test` → **684 testes, 46 arquivos, 0 falhas** (594 do P3 + 90 do P4: 33 de modelo, 40 de motor, 16 de integração e 1 de navegação).

- `automation-model.test.ts` (33): criação/validação, campos por gatilho, parâmetros
  descartados, etapa contra a esteira real, serviço real, tetos, ciclo sem/comp espera,
  espera (durações, limites, “amanhã às 09:00”), projeção linear ⇄ grafo, capacidades,
  templates, migração defensiva, **E2E 1** (lead.created → condição → etapa → espera →
  tarefa → fim), **E2E 2** (condição falsa → ramificação alternativa), **E2E 3**
  (execução interrompida em `waiting` e retomada com o estado relido do documento).
- `automation-engine.test.ts` (40): gatilho certo/errado/inativo, ações via serviços
  oficiais (esteira, atribuição, webhook), isolamento, 8 operadores, AND/OR/NOT,
  múltiplos nós, ramificação, delay, retomada, expiração, loop, teto de passos,
  duplicidade (chave de conteúdo + posse entre instâncias + dedupe por nó), erro de
  execução, falha segura, histórico sem segredo, ativar/desativar.
- `automation-integration-p4.test.ts` (16): persistência real (arquivo temporário),
  retomada por varredura, gancho inline desligável, contrato do P3 preservado (mensagens
  na fila do WhatsApp, histórico, máquina de estados), API por HTTP com sessão Bearer
  (criar/recusar/editar/excluir, 401/403, tenants), cron fail-closed, anti-loop e
  reentrada, capacidade desligada.
- Cobertura item a item dos 21 pontos exigidos: §15 de `docs/automations-p4.md`.

## 13. Regressões encontradas e corrigidas

1. **`npm run build` quebrou** ao colocar `applyBookingStatusTx` em `booking-ops.ts`:
   Client Components importam esse módulo e o `node:crypto` (via `automations.ts`/
   `events.ts`) vazou para o bundle do navegador. Corrigido criando `booking-status.ts`
   (módulo server) e mantendo `booking-ops.ts` puro — a mesma lógica de `access-core`×
   `access`.
2. **Posse perdida ao processar com “agora” injetado**: o normalizador descartava
   `claimToken/claimExpiresAt` vencidos em relação ao relógio real, o que devolvia
   `not_mine` para a própria varredura e parava a fila. Corrigido: posse preservada
   verbatim; a validade é decisão do motor com o `now` da varredura
   (`isAutomationRunClaimLive`) — hoje coberto por teste.
3. **Condição inválida era silenciada** na forma linear (virava “sem condição”).
   Corrigido: erros de `sanitizeCondition` do gatilho entram na resposta e a gravação é
   recusada.
4. **Histórico duplicava** “gatilho” e “fim” (registro do disparo + registro do nó).
   Corrigido: o nó de gatilho não re-registra; o de fim usa o registro único do `finish`.
5. **Regressão de navegação** no teste do eixo do produto (`panel.test.ts`) ao entrar
   `/automacoes` no menu: expectativa atualizada + teste novo travando a rota (seção,
   permissão, 403 amigável, deep links do P3 continuam `hidden`).
6. **Validação de etapa** só aceitava id; o editor mostra nomes. Passou a aceitar
   id **ou** nome da esteira real e a gravar o id canônico.
7. **Custo do gancho inline**: uma leitura extra por escrita no banco. Passou a agendar
   somente quando a própria escrita deixou execução `queued` (sem leitura extra, sem
   recursão, sem efeito no caminho do próprio motor).
8. **Smoke P4** revelou e forçou corrigir dois pontos de verdade de produto: execução
   com condição falsa existe e conclui sem efeito (o teste foi reescrito para afirmar
   isso, com o “não” no histórico), e ações idempotentes marcam `skipped` quando outra
   automação já fez o mesmo trabalho — o smoke agora aceita ambos e limpa o resíduo da
   própria execução (webhook receptor + automações “Smoke P4”).

Nenhuma regra existente de P0–P3 foi alterada silenciosamente: as duas extrações
(`updateLeadFields`, `applyBookingStatusTx`) mantêm contratos, mensagens (`422 Não é
possível mudar de "x" para "y".`), histórico e side effects do P3 — ver testes de
regressão citados.

## 14. Situação final da PR

- Branch `arena/01a0aaa4-instalink` com 5 commits locais, **pronto para push**; PR exclusiva
  do P4, base `main`, **sem merge** (nenhuma PR antiga foi reaberta ou alterada).
- ⚠️ No momento deste relatório, o sandbox não conseguiu autenticar no GitHub
  (`gh`: “The github.com token in GH_TOKEN is no longer valid”; `git push`: 401). Nada foi
  publicado. Basta reconectar o GitHub na Arena e rodar:
  `git push origin arena/01a0aaa4-instalink` e
  `gh pr create --base main --head arena/01a0aaa4-instalink --title "feat(p4): motor de automações completo" --body-file RELATORIO-P4.md`
- Portões na última verificação: `npx tsc --noEmit` limpo · `npm test` 684/684 ·
  `npm run build` ok · `npm run smoke` 67/67 · `npm run smoke:ux` 87/87 ·
  `npm run smoke:p3` 15 fluxos + consumidor de retry · `npm run smoke:p4` 18 verificações.
- Fora do escopo (deliberadamente): P5, P6, `wait_for_event` por canal, editor visual,
  cobrança/planos (só a camada de capacidades) e UI do override por empresa.
