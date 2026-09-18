# Relatório Final — A2: Agenda completa, booking guest, pipeline e timezone por negócio

Branch única: **`arena/01a0b46c-instalink`** · PR aberto contra `main` (base `6a77ef13ec2c967acb2a2a237747fc9b8367a768`) · **NÃO mergeado**.

---

## 1. HEADs e branch
- Branch: `arena/01a0b46c-instalink` (única, conforme sessão). Base: `main` @ `6a77ef13ec2c967acb2a2a237747fc9b8367a768`. PR: **#24** (OPEN, MERGEABLE, sem merge).
- Commits do PR: `9ca81c5` (A2 completo — B1..B5) · `3f74022` (último hardcode 60 do payload público) · `4ed4436` (relatório final) · `1ab2d67` (**revisão cirúrgica final** — ver seção 23).
- **Nota de histórico:** retomadas da sessão restauraram o `.git` local ao base com os ARQUIVOS intactos; o estado remoto (que é o head real do PR) sempre preservou a cadeia completa. Diferencial final contra o base: 36 arquivos, +3.525/−738.

## 2. Arquivos alterados (35)
Novos: `src/lib/agendar.ts`, `src/components/public/AgendarFlow.tsx`, `src/app/widget/booking.js/route.ts` (reescrito), `scripts/smoke-agendar.mjs`, 5 suítes de teste (`a2-b1-booking-pipeline`, `a2-b2-agendar-guest`, `a2-b3-availability-horizon-f7`, `a2-b4-manage-limit`, `a2-b5-timezone-openstatus`).
Editados: `api/bookings/route.ts`, `api/customer/bookings/route.ts`, `api/external/availability/route.ts`, `api/businesses/[id]/route.ts`, `api/catalog/route.ts`, `app/agendar/page.tsx`, `app/[slug]/page.tsx`, `(dashboard)/agenda/page.tsx`, `(dashboard)/clientes/page.tsx`, `(dashboard)/disponibilidade/page.tsx`, `components/public/widgets2.tsx`, `components/dashboard/NewBookingSheet.tsx`, `lib/{slots,booking-create,booking-ops,booking-status,pipeline,hours,tz,types,public,agent,agent-flow,concierge}.ts`, `package.json` (script `smoke:agendar`).

## 3. B1 (F2) — Agenda → Pipeline oficial
- `markLeadScheduled` (helper oficial em `lib/pipeline.ts`): localiza lead no tenant (leadId > customerId > telefone), reusa `moveLeadStage` (único emissor de `lead.stage_changed`), garante destino estrutural `scheduled` (`ensureScheduledStage` reinsere o estágio de sistema preservando pipeline customizado — DECISÃO 2), reabre lead terminal (nunca termina em `scheduled` com status lost), idempotente (já scheduled ⇒ `moved:false`, sem evento).
- `createBookingTx` não escreve `stageId` direto: lead existente (mesmo lost) → reabre/move; novo não-owner → `ingestLead` + `markLeadScheduled`; owner sem leadId não cria lead. Retorno inclui `status` real (customer=pending, owner=confirmed).
- 16 testes de regressão (booking normal, lead existente, terminal, cancelamento, reschedule, repetido, pipeline custom, lead sem estágio esperado, histórico, evento de automação).

## 4. B2 (F1) — `/agendar` guest sem login + widget
- `POST /api/bookings`: sessão consumer OPCIONAL; `resolveBookingIdentity` (owner: digitação vence; session: conta vence e campos ausentes são complementados; guest: nome+telefone≥10 dígitos, senão 401 `login_required` / 400 `phone_required`). Rate limit mantido.
- Página `/agendar` reescrita como Server Component (`data-agendar-page` = ok/error/closed/off), resolve slug **ou** id, feature flag respeitada; `AgendarFlow` (cliente): serviço→dia→slot→identidade→confirmação; 409 recarrega a grade (`slotRetry`); embed via postMessage com checagem de origem e clamp 560–4000px.
- Servidor continua validando TUDO (tenant, serviço, slot, horizonte, leadMin); reuso total de `computeSlots`/`createBookingTx` — sem segundo fluxo.
- `smoke:agendar` novo: 25 verificações HTTP reais (guest e2e, autenticado, 401/400/409, cross-tenant de serviço e leadId, negócio inexistente, data passada).

## 5. B3 — F4 + F5 + F7
- **F4:** `computeSlots` retorna `closedReason` (`exception`/`no_windows`/`ended`/`no_fit`/`none`); `dayAvailability()` deriva estado honesto (past/closed/full/open) do RESULTADO do motor único; API de dias e de dia único expõe `state/full/reason`; BookingIsland, NewBookingSheet e AgendarFlow mostram a causa ("lotado" clicável, "fechado" desabilitado, auto-select prefere dia com vaga).
- **F5:** `effectiveHorizonDays` (1–365, default 60) aplicado em `booking-create`, GET/POST/PATCH de bookings, `customer/bookings`, `external/availability`, agenda, clientes, widgets2 (teto 90 eliminado), agent-flow (recorte 14 mantido), payload do `/agendar`. Agenda do painel lê a config real do negócio. Zero `|| 60` restante.
- **F7:** (1) transição igual→igual é no-op idempotente (sem histórico, sem `updatedAt`, sem re-disparo de mensagem); (2) `noteLeadReschedule` ligado nos 3 caminhos de remarcação (dono move/recreate e cliente), mantendo a cadeia de leads coerente; (3) email do guest é usado (contato+lead recebem — validado em teste e smoke); (4) exceções passadas recusadas com mensagem; (5) `exception.save` só grava exceção com efeito real (janela válida e intersectando regra do dia; fechado vale sempre).

## 6. B4 (F6) — GET manage limpo
- Uma única leitura (`guard.db`); a dupla leitura foi eliminada.
- `enqueueDueReminders` saiu do GET e migrou para a ESCRITA (`createBookingTx` e PATCH de status) — mesma transação, idempotente por chave; GET sem efeito colateral (P4 intacto: mensagens continuam na fila do WhatsApp e o executor inline/drenagem é o mesmo).
- Limite efetivo explícito: `effectiveManageLimit` (pediu 1000 → 500) e a resposta declara `limitCapped`/`requestedLimit`; painel passou a pedir 500 honestamente.
- Compatibilidade: consumidores existentes (smoke/ux/e2e) seguem passando sem alteração de contrato além dos campos novos.

## 7. B5 — F3 + F9
- **F3:** `getBusinessOpenStatus(business, rules, exceptions)` em `lib/hours.ts` usa a MESMA fonte da Agenda (Availability + exceptions) no fuso do negócio; `Business.hours` virou fallback de exibição documentado (só quando não há NENHUMA regra). Consumidores migrados: `[slug]` (status calculado no servidor via `getPublicData.openNow`), conhecimento do agente e resposta de "horário" do concierge (`scheduleSummary`). `openStatus` legado mantido só para o fallback e testes.
- **F9:** `Business.businessTimezone` (IANA, validada no PATCH com 400 claro; inválida/ausente ⇒ `America/Sao_Paulo` via `effectiveTimezone` — sem migração). Todos os pontos de regra usam o fuso do negócio: disponibilidade, "hoje/agora" (GET/POST/PATCH bookings, customer bookings, external availability), `createBookingTx`, lembretes, exceções, `agent-flow` (TZ inline eliminada). Lista de dias do cliente (BookingIsland) construída com `todayISO`/`addDaysISO` no fuso do negócio — drift de 24h e fuso do navegador eliminados. Seletor de fuso na tela Disponibilidade (lista curada IANA).

## 8. Integração P3/P4
- P3 (mensagens) e P4 (automação) intactos: `applyBookingStatusTx` continua único emissor; no-op não re-dispara confirmação (testado); lembretes idempotentes por chave `auto:booking_reminder:{id}`; eventos `lead.stage_changed`/`booking.created` inalterados; `smoke:p4` 18/18.

## 9. Tenant isolation
- Mantida e testada: serviço de outro tenant recusado no booking; `leadId` cross-tenant não movido; GET manage sempre via `requireBusiness`; slug público resolve só negócio publicado; `dueReminderBookings` isola por businessId (testes B4/B5).

## 10. Permissões
- Nenhuma permissão ampliada. GET manage exige `agenda` (escopo de profissional preservado); guest só cria booking pelo POST público com validação server-side; catálogo/exceções continuam atrás do guard existente.

## 11. Regressões
- Baseline A1.2 = 894 testes. Nenhuma quebra não-intencional: suítes antigas todas verdes (2 ajustes defensivos: `db.availability || []` em agent/concierge para DBs parciais de teste).

## 12–16. Validação executada no ESTADO FINAL (HEAD `1ab2d67`, re-executada após as correções da revisão)
- `npm test`: **977 passando** (58 arquivos; baseline 894 → +83 novos). 0 falhas.
- `tsc --noEmit`: **limpo**.
- `next build`: **limpo** (produção, sem erros).
- Smokes (re-seed antes de cada): `smoke:agendar` **25/25** · `smoke` **67/67** · `smoke:ux` **87/87** · `smoke:p3` **15/15** · `smoke:p4` **18/18** · `e2e-merchant` **28/28**.

## 17. Falhas conhecidas
- Nenhuma falha residual de teste/smoke/build no ambiente.

## 18. Riscos / observações
- A UI de exceções agora RECUSA exceções sem efeito real (antes salvava em silêncio): comportamento novo intencional (F7.5) — lojistas que "salvavam" exceções inócuas verão erro de validação pela primeira vez.
- GET manage responde `limitCapped` apenas quando o cliente pede > 500 (compatível com consumidores antigos).
- `tsconfig.tsbuildinfo` já era rastreado no repo; seguiu o padrão existente.

## 19. Itens não implementados (fora do escopo, por instrução)
- F8 (teamMode/distribuição), F10 (recorrência), F11 (reestruturação de armazenamento), novos schedulers, novos provedores externos.

## 20. Confirmações explícitas
- **P3–P6 NÃO foram reestruturados** — apenas chamadas pontuais (ex.: lembretes movidos do GET para a escrita; F7.1/F7.2 dentro das funções oficiais).
- **Não há segundo motor de agenda** — `computeSlots` segue único; `dayAvailability` deriva do resultado dele.
- **Não há segundo fluxo de booking** — `/agendar`, widget, painel, chat e API usam `createBookingTx`.
- **Não há state machine paralela de pipeline** — `markLeadScheduled` reusa `moveLeadStage`.
- **Sem hardcode 60** e **sem timezone fixa onde deve ser por negócio** (verificados por grep no HEAD final).

## 21. Não validado neste ambiente
- Comportamento em produção com fuso de negócio diferente do padrão em dados reais (só testado via suítes determinísticas com fake timers e seeds locais).
- Render real do widget em navegadores antigos (sem suporte a `ResizeObserver`) — segue com fallback de altura inicial.

## 22. URL do PR
- Abrido via `gh` contra `main`; sem merge, sem auto-merge, sem fechamento. (Ver descrição do PR.)

---

## 23. Revisão cirúrgica final (pré-merge do PR #24)

Escopo: conferência ponto a ponto dos Blocos 1–11 do roteiro de finalização. **Nenhuma regressão encontrada; 3 correções mínimas aplicadas** (abaixo). O que já estava correto NÃO foi tocado.

### Correções desta revisão (commit `1ab2d67`)
1. **Testes de cancelamento × lead** (`a2-b1`): 3 regressões novas provando que cancelar agendamento NUNCA toca o lead — lead em `scheduled` permanece idêntico e sem `lead.stage_changed`; lead terminal (`lost`) NÃO é reaberto pelo cancelamento (reabre só com NOVO agendamento, que por sua vez reabre via `markLeadScheduled` sem duplicar lead). Código já era assim; agora está provado.
2. **"Hoje/agora" do painel no fuso do negócio** (`agenda/page.tsx`, `clientes/page.tsx`): `needsClosure` local, linha do agora e destaque de hoje passam a usar `businessTimezone` (mesma referência do servidor), não o default/navegador. Botão "Hoje" usa a mesma referência.
3. **Listas de dias do agendamento no fuso do negócio**: `/agendar` (Server Component) passa `today` no fuso do alvo (`PublicBookingTarget.timezone`); `NewBookingSheet` aceita `timezone` opcional (agenda e clientes passam o do negócio).

### Pontos verificados e JÁ corretos (sem alteração)
- **B1 — scheduled estrutural:** `ensureScheduledStage` é idempotente, preserva esteiras customizadas (sem renomear/duplicar/reordenar), reinsere como `isSystem` com `order=max+1`; `markLeadScheduled` usa EXCLUSIVAMENTE `moveLeadStage` (único emissor de `lead.stage_changed`), é idempotente quando já está em `scheduled` (sem histórico, sem evento — testado), recalcula status projetado (`scheduled` ⇒ `converted`; proibido `scheduled+lost`). Único `stageId=` direto fora da máquina é reparo legado do A1.2 (`api/leads/route.ts`, fora do diff do A2).
- **B2 — lead terminal/lost + novo booking:** DECISÃO 1 consistente em todos os caminhos (público guest, autenticado, painel, assistente, API externa): reabre o MESMO lead, nunca duplica, nunca `scheduled+lost` (testes B1 + smoke).
- **B3 — Agenda→CRM→Automação:** `booking.created` emitido 1× em `createBookingTx`; `lead.stage_changed` só em `moveLeadStage`; no-op de status retorna ANTES de histórico/mensagem P3/evento (testado: sem re-confirmação); cancelamento não reabre; remarcação não cria lead.
- **B4 — P3/P4:** GET manage sem efeito colateral (sem `updateDB`); lembretes nascem em `createBookingTx`/PATCH de status (idempotentes por chave — testado); `smoke:p3` 15/15 e `smoke:p4` 18/18 no estado final.
- **B5 — timezone:** todos os 10 itens do Bloco 4 conformes; suíte `a2-b5` (19 testes) prova SP + LA/NY + Sydney: "hoje" por fuso, open/closed por fuso, `createBookingTx` com corte de passado por fuso (mesma data: futuro em LA, passado em SP), exceções com `today` do chamado, DST sem drift (`addDaysISO`).
- **B6 — guest:** fluxo serviço→dia→horário→nome→telefone→confirmação sem conta; autenticado reusa os dados; servidor valida tudo; 409 → grade recarregada (`slotRetry`); smoke:agendar 25/25.
- **B7 — tenant:** dupla porta no PATCH (`requireBusiness` + `booking.businessId`), serviço/leadId cross-tenant recusados (testes + smoke), `dueReminderBookings` isola por tenant.
- **B9 — qualidade:** zero `|| 60`; zero TZ hardcoded fora de `tz.ts` (exceção: lista curada do seletor de fuso na UI); `computeSlots` definido 1×; `createBookingTx` é o único caminho de criação; drift de 24h eliminado; permissões intactas.
- **B11 — diff:** somente escopo A2 + relatório; `tsconfig.tsbuildinfo` já era rastreado no `main` (padrão do repo, não é lixo novo); working tree limpa.

### Veredito
**A2 pronto para merge.** Sem problemas funcionais conhecidos abertos.
