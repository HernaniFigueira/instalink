# GoDoutor — Matriz de migração (documento legado → SQL) e inventário

Levantamento gerado por varredura de `readDB`/`updateDB`/`writeDB` em `src/`
(incluindo chamadas indiretas via libs), estado do HEAD desta PR (rodada 4).
Marca **RELATIVO** = arquivo com ramo `relationalActive()` (opera no SQL quando
o modo está ativo; documento intocado quando desligado). **LEGADO** = ainda só
no motor de documento — e no modo relacional responde **503 explícito**
(`module_not_migrated`, ver §1c), NUNCA volta silenciosamente ao Neon. Os
motores canônicos (booking-create, pipeline, automations, executor, audit,
webhooks…) recebem o "doc" como argumento e servem aos DOIS motores.

## 1. Inventário completo dos consumidores

### 1a. Rotas/lib com ramo relacional (operação no SQL)

| Arquivo | Fluxo |
|---|---|
| `src/app/api/auth/login|register|forgot|reset|me/route.ts` | sessão da EQUIPE (login, cadastro, recuperação, sessão) |
| `src/app/api/customer/login|register|forgot|reset|me/route.ts` | conta do PACIENTE (login, cadastro, recuperação com CAS de uso único, perfil) |
| `src/app/api/customer/bookings/route.ts` | agenda DO PACIENTE: lista SQL + remarcar/cancelar (regras de prazo no fuso da unidade) |
| `src/app/api/customer/orders/route.ts` | pedidos do consumidor (consulta pontual por conta/telefone) |
| `src/app/api/bookings/route.ts` | agenda: grade, mapa, gestão, reserva, série, PATCH (check-in/remarcação/status/cancelar série) |
| `src/app/api/leads/route.ts` | esteira: captura, edição, **lista com PAGINAÇÃO SQL** (count(*) + LIMIT/OFFSET — fim do corte 500) |
| `src/app/api/leads/manual/route.ts` | oportunidade manual pela porta oficial (ingestLead) |
| `src/app/api/leads/[id]/book/route.ts` | converter lead em agendamento (motores compartilhados) |
| `src/app/api/contacts/route.ts` | CRM: lista SQL com total, criação (dedupe de identidade), nota, identidade/perfil/consentimento |
| `src/app/api/contacts/export|export-full/route.ts` | exportação (CSV/JSON por partes) + auditoria da saída na fatia |
| `src/app/api/contacts/import/route.ts` | importação (preview/commit — plano refeito DENTRO da transação) |
| `src/app/api/people360/route.ts` | cliente 360 (agregação da unidade + contas globais referenciadas) |
| `src/app/api/conversations/route.ts` | inbox: lista/detalhe SQL, troca de modo, envio grava no OUTBOX (`status='pending'` — §3) |
| `src/app/api/pipeline/route.ts` | quadro da esteira: leitura + edição de etapas |
| `src/app/api/reviews/route.ts` | avaliações: gestão, "minhas", criar (elegibilidade revalidada sob lock), publicar/excluir |
| `src/app/api/tasks/route.ts` | tarefas internas: lista/resumo, criar, editar, concluir (mesma engine das automações) |
| `src/app/api/team/route.ts` | equipe: lista/criar (nunca duplica conta)/editar papéis/permissões/vínculo de agenda, remover (sessões caem) |
| `src/app/api/catalog/route.ts` + `catalog/get` | catálogo (dono): categorias/produtos/opções/valores + referências de agendamentos futuros |
| `src/app/api/orders/route.ts` | pedidos: criação com preços recalculados no servidor + entrada na esteira, lista paginada, máquina de status |
| `src/app/api/organizations/route.ts` | organizações/filiais: visão consolidada + criação |
| `src/app/api/overview/route.ts` | Dashboard (Início): agregação das coleções da unidade |
| `src/app/api/analytics/route.ts` | métricas agregadas do período |
| `src/app/api/results/route.ts` | Resultados (motor de insights), unidade e consolidado por organização |
| `src/app/api/events/route.ts` | ingestão pública de analytics (INSERT direto) |
| `src/app/api/checkout-info/route.ts` | chave PIX no checkout (leitura pública pontual) |
| `src/app/api/qr/route.ts` | QR Code (sem banco) |
| `src/app/api/cron/automations/route.ts` | dreno P4 da fila de automações |
| `src/app/api/admin/support/route.ts` | sessão de suporte (master) |
| `src/app/api/upload/route.ts` + `src/app/api/files/[id]/route.ts` | uploads (Storage + `app.patient_files`) |
| `src/app/api/businesses/route.ts` | cadastro de unidade (org + unidade + página + auditoria) |
| `src/app/api/businesses/[id]/route.ts` | configuração da unidade (perfil, agenda, aparência, módulos) |
| `src/app/api/businesses/[id]/features/route.ts` | liga/desliga módulos (reflete na página) |
| `src/app/api/businesses/[id]/duplicate/route.ts` | duplicação estrutural de unidade (whitelist) |
| `src/app/api/pages/route.ts` | editor da página: leitura, blocos/tema, sobre, navegação, slug, PUBLICAÇÃO |
| `src/app/api/queue/route.ts` | fila do balcão (A3.4 B4): CRUD + máquina de estados |
| `src/app/api/encounters/route.ts` | registro de atendimento (A3.4 B5): CRUD + versão + finalizar/reabrir + histórico 360 |
| `src/lib/public.ts` | página PÚBLICA renderizada (/[slug]) |
| `src/lib/access.ts` | guards (requireBusiness/requireMaster/suporte) |
| `src/lib/auth.ts`, `src/lib/customer-auth.ts` | sessões e senhas (equipe e cliente) |
| `src/lib/relational/overview-doc.ts` | doc mínimo multi-unidade (overview/resultados/organizations) |

### 1b. Motores compartilhados (sem banco próprio; usados pelos DOIS motores)

`booking-create.ts`, `booking-series.ts`, `booking-status.ts` (via booking-ops),
`pipeline.ts` (ingestLead/moveLeadStage/bookLead…), `automations.ts`,
`contacts.ts` (upsertContact/findContact/addContactNote), `audit.ts`
(pushAudit), `automation/executor.ts`, `automation/actions.ts`,
`automation/events.ts`, `automation/tasks.ts` (createTaskTx/setTaskStatusTx/
summarizeTasks), `webhooks.ts` (enqueueWebhookTx), `queue.ts` e `encounters.ts`
(regras puras), `slots.ts`, `fit-in.ts`, `agent.ts`, `hours.ts`, `features.ts`,
`templates.ts`, `insights.ts` (collectResults), `organization-overview.ts`,
`dashboard.ts`, `revenue.ts`, `analytics.ts`, `client-export.ts`,
`client-import.ts`, `contact-identity.ts`, `contact-profile.ts`, `pipeline.ts`
(status/etapas) — recebem a fatia/doc como argumento. Seu `readDB`/`updateDB`
interno só roda no modo LEGADO; no relacional quem abre transação é
`slice.ts`/`ops-store.ts`.

### 1c. LEGADO com BLOQUEIO EXPLÍCITO (503 `module_not_migrated`)

Proteção TEMPORÁRIA (`src/lib/relational/blocked.ts`): no modo relacional, um
módulo não migrado responde **503** com `x-godoutor-blocked: <módulo>` e
mensagem informando a indisponibilidade — nunca lê nem grava no documento
legado. Ao migrar um módulo, remova-o da lista abaixo. Hoje bloqueados:

- **Integrações/canais:** `whatsapp` (+onboarding, webhook), `instagram`
  (+onboarding/callback/webhook), `integrations` (+keys/webhooks/test/inbound/
  events). Motivo: dependem do conector legado e do recebimento por canal
  (ver §3).
- **Despacho HTTP:** `cron/whatsapp`, `cron/webhooks`, `cron/instagram`
  (o outbox SQL fica `pending` até o despachante próprio — §3).
- **Automações (UI de configuração):** `automations`, `automations/[id]`,
  `ai/automations` — a EXECUÇÃO (P4) já roda no SQL; falta a tela de edição.
- **Agente/concierge/campanhas:** `agent`, `concierge`, `campaigns`.
- **Plataforma:** `master/*`, `admin/businesses`, `admin/businesses/[id]`,
  `admin/audit`, `entity-deletion`, `auth/google` (+callback).
- **API externa por chave:** `external/*`.

Sempre LEGADO (funcionalidade só existe no modo antigo; sem bloqueio porque não
tocam o fluxo operacional): `reviews/import` (importação de avaliações) e rotas
auxiliares sem banco (`qr`, `entity-deletion` bloqueado acima). `customer/logout`
e `auth/logout` derrubam sessão (SQL no modo relacional).

**Regra operacional:** com o modo relacional ativo e a origem legada
indisponível, TODAS as jornadas das seções 1a funcionam ponta a ponta (prova
§2); os fluxos bloqueados retornam indisponibilidade explícita. Sem escrita
dupla em nenhum fluxo: cada escrita usa UM banco.

## 2. Matriz por funcionalidade (prova pela aplicação, legado INDISPONÍVEL)

Prova: `scripts/godoutor/http-journeys.mjs` — **118/118 verificações** contra
Next.js real + Postgres real + Storage HTTP + `DATABASE_URL` apontando para
porta morta (rodada 4).

| Funcionalidade | Estado | Evidência (jornada HTTP) |
|---|---|---|
| Login/sessão equipe (cookie + Bearer) | ✅ SQL | jornada 1 |
| Permissões/escopo profissional | ✅ SQL | jornada 2 |
| Grade/mapa/gestão de agenda | ✅ SQL | jornada 3 |
| Reserva pública + conflito de horário | ✅ SQL | jornada 4 (3º = 409) |
| Reserva pelo painel (dono) | ✅ SQL | jornada 5 |
| Check-in / remarcação / cancelamento idempotente | ✅ SQL | jornada 6 |
| Recorrência (série + replay + 403 público) | ✅ SQL | jornada 7 |
| Conta do paciente: cadastro/login/sessão | ✅ SQL | jornada 8 |
| Uploads público/privado + re-assinatura + 404/403 | ✅ SQL+Storage | jornada 9 |
| Esteira: captura de lead | ✅ SQL | jornada 10 |
| Cron P4 (fila de automações) | ✅ SQL | jornada 10 |
| **Página pública renderizada** | ✅ SQL | jornada 11 |
| **Cadastro de clínica** (org+unidade+página) | ✅ SQL | jornada 12 |
| **Configuração da unidade** (perfil/agenda/fuso) | ✅ SQL | jornada 12 |
| **Edição da página** (blocos/sobre/editor) | ✅ SQL | jornada 12 |
| **Publicação da página** (rascunho→público) | ✅ SQL | jornada 12 |
| **Fila do balcão** (chegada→chamada→atendimento→409) | ✅ SQL | jornada 13 |
| **Registro de atendimento** (1:1, versão, finalizar/reabrir) | ✅ SQL | jornada 14 |
| **Histórico 360 por telefone + escopo** | ✅ SQL | jornada 14 |
| **P1 · Minha conta: editar perfil + persistência** | ✅ SQL | jornada 15 (PATCH + releitura) |
| **P1 · Minhas reservas (lista SQL)** | ✅ SQL | jornada 15 |
| **P1 · Paciente remarca/cancela → EQUIPE vê a mesma alteração** | ✅ SQL | jornada 15 (manage lê do SQL) |
| **P1 · Isolamento: reserva alheia = 401** | ✅ SQL | jornada 15 |
| **P1 · Recuperação de senha (token uso único + login automático)** | ✅ SQL | jornada 16 (replay = 400) |
| **P1 · Pedidos do consumidor (consulta pontual)** | ✅ SQL | jornada 16 |
| **P2 · Contatos: lista paginada + criação + dedupe** | ✅ SQL | jornada 17 |
| **P2 · Contatos: observação + identidade + busca com total** | ✅ SQL | jornada 17 |
| **P2 · Equipe: lista/criar/duplicata=400/promover/remover/self=400** | ✅ SQL | jornada 18 |
| **P2 · Equipe sem permissão = 403** | ✅ SQL | jornada 18 |
| **P2 · Catálogo do dono (serviços+profissionais+horários)** | ✅ SQL | jornada 19 |
| **P2 · Dashboard (agregação + CRM)** | ✅ SQL | jornada 19 |
| **P2 · Analytics + Resultados (+403 sem permissão)** | ✅ SQL | jornada 19 |
| **P2 · Organizações: visão + criação + duplicação de filial** | ✅ SQL | jornada 20 |
| **P2 · Recursos da unidade (módulos)** | ✅ SQL | jornada 20 |
| **P2 · Tarefas: criar/concluir/listar (engine compartilhada)** | ✅ SQL | jornada 21 |
| **P2 · Esteira: PAGINAÇÃO SQL (total correto, página 2)** | ✅ SQL | jornada 21 |
| **P2 · Quadro da esteira (pipeline) com canEdit** | ✅ SQL | jornada 21 |
| **P2 · Inbox: lista SQL com totais honestos** | ✅ SQL | jornada 22 |
| **P2 · Avaliações (gestão/contagens)** | ✅ SQL | jornada 22 |
| **P2 · Eventos públicos de analytics** | ✅ SQL | jornada 22 |
| **P2 · Bloqueio explícito de módulos não migrados (503)** | ✅ SQL | jornada 22 (integrations + automações) |
| **P2 · Checkout-info público** | ✅ SQL | jornada 22 |
| Auditoria das operações | ✅ SQL | queries finais |
| Config de automações (UI), integrações/canais, master/admin, API externa, despacho HTTP de mensagens/webhooks | 🔒 503 explícito | §1c/§3 |

## 3. Integrações — o que deixa de funcionar no modo relacional (honesto)

No modo relacional a ENTREGA EXTERNA não é executada. O que fica em pé: a fila,
o ciclo de automação (claims CAS, passos, auditoria) e o OUTBOX persistido.

| Entrega | Estado no relacional | Onde fica |
|---|---|---|
| Mensagem de confirmação/lembrete/review (WhatsApp Cloud API) | linha criada com `status='pending'`; **HTTP não é disparado** | `app.messages` (outbox) |
| Mensagem humana do inbox (conversations POST) | gravada `pending` no outbox; **HTTP não é disparado** (entregador legado NUNCA é chamado no modo relacional) | `app.messages` |
| Mensagens de automação da esteira (nós de mensagem) | idem — `status='pending'` | `app.messages` |
| Webhooks de saída (`lead.created`, `lead.updated`, `lead.stage_changed`) | entrega registrada `status='pending'` com tentativas zeradas; **HTTP não é disparado** | `app.webhook_deliveries` |
| Instagram DM (envio) | gravado pendente; conector HTTP é rodada própria | `app.messages` |
| Inbound de canais (webhooks WhatsApp/Instagram) | **503 bloqueado** (rota não migrada) — sem gravação nem no legado | §1c |
| E-mail (recuperação de senha etc.) | fora de escopo nesta fase (era assim no legado também: gera token, sem SMTP) | `app.password_resets` |

**Não há paridade de entregas externas enquanto o outbox acima não tiver um
despachante HTTP no modo relacional** — declarado explicitamente como pendência
(rodada própria: worker de entrega consumindo `app.messages`/
`app.webhook_deliveries` com as mesmas políticas de retry do legado).

## 4. Desempenho: consultas por operação (sem reconstrução de documento)

Cada operação carrega SOMENTE o que lê — spec por operação em
`src/lib/relational/slice.ts` (`bookingOpSpec`, `leadWriteSpec`, `runStepSpec`,
specs de catálogo/contatos/equipe/reviews/orders/tasks/pipeline/features) e
`ops-store.ts`; leituras dirigidas via `runRelationalRead`:

- **Agenda**: catálogo da unidade (services/professionals/availability/
  exceptions — tabelas pequenas de configuração), agendamentos **da janela da
  operação**, identidades candidatas do cliente, pipeline (1 linha) e as chaves
  EXATAS de dedupe de mensagens. Auditoria/eventos: append-only, não carregados.
- **Paciente**: a própria reserva (janela de conflito) + serviço/unidade
  (regras de prazo no fuso); listas do consumidor por consulta pontual
  (conta OU telefone) — sem varredura de unidade.
- **Contatos/CRM**: página pedida com `count(*)` + `LIMIT/OFFSET` (mesmo filtro
  do total), candidatos de identidade, bookings/leads do contato (subconsulta
  por id) e a conta global referenciada.
- **Equipe**: membros + profissionais da unidade; usuários SOMENTE os
  referenciados (`id = ANY`); remoção decide sessões com 2 EXISTS pontuais.
- **Catálogo/pedidos**: coleções do catálogo da unidade; pedidos paginados
  (`created_at DESC` + janela); criação recalcula preço sob lock.
- **Dashboard/Resultados**: coleções agregadas da unidade; multi-unidade via
  `relationalOverviewDoc` (unidades acessíveis + janela do período, com folga
  de ±1 dia em created_at para borda de fuso).
- **Esteira (GET leads)**: pipeline/membros + **duas consultas** — `count(*)`
  do filtro e a página (`ORDER BY created_at DESC LIMIT/OFFSET`); filtro de
  etapa resolve o universo de valores que normalizam para a etapa alvo.
- **Inbox**: conversa única + mensagens dela + contato referenciado + usuários
  citados; lista com WHERE de status/canal.
- **Config/página**: 2 tabelas (businesses + pages da unidade).
- **Fila/atendimento**: a linha alvo + catálogo + contatos candidatos.

Conflitos de agenda preservados: advisory lock por unidade + `FOR UPDATE` +
revalidação com os motores canônicos + constraint de exclusão no banco
(dupla camada, testada por jornada: 2 tentativas simultâneas → 1 vence).
Escritas de usuários/membros respeitam FK (writeback ordena `users` antes de
`members`); unicidade global de slug continua garantida pela constraint do
banco (checagem de UI por consulta pontual).

<!-- marcador de redeploy: validação de preview da rodada 4 (2026-09-22) — sem alteração funcional -->
