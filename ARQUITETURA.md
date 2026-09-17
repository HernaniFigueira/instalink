# InstaLink.app — Arquitetura (MVD 1.0)

## Decisões técnicas

| Tema | Decisão MVD | Evolução prevista |
|---|---|---|
| Framework | Next.js 14 + App Router + TypeScript | — |
| Estilo | Tailwind + tokens de tema por negócio (CSS vars) | — |
| Banco | `JsonAdapter` (`src/lib/db.ts` + `data/instalink.db.json`) | Postgres via Supabase (mapeamento abaixo) |
| Auth | Híbrida: cookie httpOnly + Bearer token (`src/lib/auth.ts`, `src/lib/client-auth.ts`) | Supabase Auth (trocar só este módulo) |
| Multi-tenancy | `src/lib/tenant.ts` — toda query escopada por `businessId` + dono | RLS no Supabase |
| Agenda | Motor universal `src/lib/slots.ts` | — |
| IA | Concierge por regras sobre dados reais (`src/lib/concierge.ts`) | LLM com grounding nos mesmos dados |
| Automações | Motor de grafo persistido no mesmo documento (`src/lib/automation/`) — orquestra os serviços oficiais | Editor visual de grafo, canais (P6) |
| IA | Camada P5 (`src/lib/ai/`) interpreta intenção → plano → grafo do P4; publicação só após aprovação humana | LLM com o mesmo contrato (hoje o planner é determinístico) |
| QR | `qrcode` server-side (`/api/qr`) | — |

## Por que JSON no MVD?

O ambiente do MVD não possui Postgres/Supabase provisionado. Para entregar
**fluxos reais funcionando** (não mocks), a persistência é um adapter com
interface mínima (`readDB`/`updateDB`). Nenhuma rota ou tela conhece detalhes
de armazenamento — a migração é mecânica.

## Migração para Postgres/Supabase (quando provisionar)

1. Criar tabelas com os mesmos nomes/campos de `src/lib/types.ts`
   (`users` → `auth.users` do Supabase; demais 1:1).
2. Reimplementar `src/lib/db.ts` com `@supabase/supabase-js` (server) mantendo
   as assinaturas `readDB/updateDB` ou introduzir repositórios por agregado.
3. Trocar `src/lib/auth.ts` por Supabase Auth (a sessão continua lida via
   `currentUser()` / `getUserBySession()` nas rotas).
4. Ativar RLS: `business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())`.
5. `data/*.json` já está no `.gitignore` — nada de dados locais vaza.

## Estrutura

```
src/
  lib/         tipos, db, auth, tenant, templates, slots, concierge, utils, public
  components/  ui.tsx (design system painel), ThemeStyle, public/widgets*.tsx
  app/
    page.tsx            landing
    (auth)/             login, register
    onboarding/         criar negócio: 1 tela → business + page no padrão
                        de atendimento (sem nicho/forma de venda)
    (dashboard)/        layout (menu dinâmico por modos) + 9 telas
    [slug]/             página pública (mobile-first, blocos)
    api/                auth, businesses, pages, catalog(+get), orders,
                        bookings, leads, events, concierge, qr, analytics
```

## Autenticação híbrida (decisão central)

O app funciona **com ou sem cookies**, sem mudar uma linha nas telas:

1. Login/cadastro devolvem `{ ok, token }` e gravam cookie httpOnly (`SameSite=None; Secure; Partitioned`).
2. O cliente salva o token em `localStorage` (`src/lib/client-auth.ts`).
3. O `<AuthBootstrap/>` injeta `Authorization: Bearer` em todo `fetch` same-origin para `/api/*`.
4. O servidor aceita **cookie OU Bearer** (`userFromRequest`) em todas as rotas autenticadas.
5. O painel valida a sessão no cliente (`DashboardShell` → `/api/auth/me`), nunca no servidor.

Com isso, o painel abre em iframe cross-origin, com third-party cookies bloqueados e em qualquer navegador moderno.

Camadas de persistência do token (ordem de tentativa): **memória da aba → localStorage → cookie httpOnly**.
A memória cobre até o caso extremo (iframe com storage 100% bloqueado);
por isso a navegação pós-login/cadastro é SPA (`router.push`), que preserva
a memória — reload integral (F5) nesse cenário extremo volta ao login.

> Nota de ambiente: o proxy do preview exige o header interno
> `e2b-traffic-access-token`, então a URL pública NÃO abre em aba externa
> comum (403). O acesso oficial é pelo preview embutido — e é por isso que
> a autenticação foi projetada para funcionar sem depender de cookies.

## Segurança (MVD)

- Senhas: scrypt + salt; sessão httpOnly + Bearer de mesma força (id de sessão aleatório, revogável no logout, expiração de 30 dias).
- Mutações exigem sessão + posse do `businessId` (verificado no servidor).
- Pedidos (módulo LEGADO, fora da experiência nova): preços **recalculados no
  servidor**; checkout nunca confia no cliente. A vitrine de produtos não cria
  pedidos — converte pelo WhatsApp do negócio.
- Agendamentos: slot revalidado no servidor (409 se ocupado).
- Slugs validados + palavras reservadas; settings de blocos sanitizados por tipo.
- Segredos só no servidor (não há `NEXT_PUBLIC_*`).

## Auditoria set/2026 — contexto da empresa, Produtos independente, refinamento visual

- **Contexto da empresa (raiz do "loop de Recursos"):** a API
  `/api/businesses/[id]/features` lê o id do **path** (`businessIdFromRoute`,
  `src/lib/business-context.ts`); `?businessId=`/`body.businessId` são só
  compatibilidade. No painel, `src/components/dashboard/useBusinessId.ts`
  resolve a empresa ativa pelo `/api/auth/me` quando `?b=` falta — `?b=`
  continua válido, mas nunca é fonte única. Estados de contexto distintos
  (sem empresa × rede × permissão × 404 real), nunca "Negócio não
  encontrado" para tudo.
- **Produtos é independente de Serviços** (regra central): os dois módulos
  coexistem e se ativam a qualquer momento em Recursos. Supressão explícita
  (`Business.productsOff`, gravada no toggle) faz "desligar Produtos ⇒
  vitrine some" **vencer o fallback legado de pedidos**; negócios legados
  que nunca gerenciaram Produtos continuam intactos.
- **Primeira configuração (conta nova):** uma pergunta — "Como sua empresa
  atende?" (`src/lib/onboarding.ts`): *Serviços e agendamento* →
  services+bookings; *Produtos* → products; *Serviços + produtos* → os
  três. É só a base: Recursos muda tudo depois.
- **Página pública (visual):** capa emoldurada (margem lateral + cantos
  arredondados ~radius+8, h-44) com avatar de 84px e anel duplo; menu
  inferior full-width fixo com **ícone em cima / texto embaixo** — itens
  de `src/lib/bottombar.ts` (Conta · WhatsApp · Menu · Agendar, Agendar é o
  único preenchido); redução de cards (serviços em lista com divisores,
  diferenciais/equipe leves, depoimentos em carrossel de fundo sutil, FAQ
  com divisores, Sobre/texto/vitrine editoriais); glifo do WhatsApp
  renderizado em **fill** (stroke deformava o ícone — `FILL_ICONS` em
  `src/components/icons.tsx`).

## Posicionamento (2026): plataforma de atendimento com agenda

O eixo do produto é **Serviços → Agenda → Cliente → Histórico → WhatsApp**.
Consequências arquiteturais:

- `src/lib/features.ts` continua a fonte única de módulos. `FEATURES` é o que
  o produto OFERECE (agenda, serviços, vitrine, conteúdo, canais);
  `LEGACY_FEATURES` (pedidos, orçamentos) ficou **fora da experiência**: não
  aparece no cadastro, no menu nem em Recursos — mas continua RESOLVÍVEL por
  `isFeatureEnabled` para não quebrar dados/páginas antigas. Nada foi apagado.
- Nicho (`Business.niche`) continua ARMAZENADO (temas/páginas antigas), mas não
  escolhe arquitetura comercial nem cria caminhos por tipo de negócio.
- Produto = VITRINE (`src/lib/showcase.ts`): cadastro mínimo (foto, nome,
  descrição, preço, categoria, ativo/oculto, destaque) e CTA "Tenho interesse"
  que abre o WhatsApp do negócio com mensagem contextualizada. Sem carrinho,
  checkout, adicionais ou pedido interno. Componentes antigos de catálogo
  (`CatalogIsland`, carrinho) permanecem apenas como legado isolado.
- Ativação de módulo reflete na página na hora, de forma ADITIVA
  (`withActivationBlock`): ligar garante o bloco de apresentação; desativar
  nunca remove nada (reativar restaura a configuração intacta).
- Configuração da PÁGINA (blocos, ordem, navegação, "Sobre", tema, publicar)
  vive só em `/pagina`; `Configurações` é administrativa (Negócio, Agenda, CRM,
  Canais) e apenas aponta para "Editar página pública".
- Cadastro de negócio novo nasce com padrão de atendimento
  (`NEW_BUSINESS_DEFAULTS` em `src/lib/templates.ts`): Serviços + Agenda
  ativos, vitrine DESLIGADA, nada de pedidos. O Dashboard traz o checklist
  "Comece por aqui" com progresso REAL (nunca inventado) — opcional e
  descartável, sem wizard bloqueante.

## P2 set/2026 — Resultados, Acesso do Profissional e Identidade do painel

Três frentes, um só desenho — nada de sistema paralelo (sem RBAC novo, sem
tabela nova de status, sem motor de indicadores duplicado).

### 1. Resultados (Bloco 1) — `src/lib/insights.ts` + `/api/results`

`buildResults()` é PURO (dado entra, indicador sai) e cobre indicadores,
comparação, funil, desempenho por serviço/profissional, origem de leads e
receita. `collectResults(db, unidades, janela, anterior)` é a única função de
coleta: a tela Resultados passa UMA unidade; Organização passa **apenas as
unidades que o usuário acessa**; a Dashboard usa o mesmo payload reduzido
(`resultsSummary`). Nenhum indicador é decorativo.

Semântica das datas (regra do produto, não misturar):

| Indicador | Data usada |
| --- | --- |
| Agendamentos / atendimentos / concluídos / cancelamentos / faltas | data do **atendimento** (`Booking.date`) |
| Receita prevista / ticket médio | data do **atendimento** do registro elegível |
| Novos clientes | data de **cadastro** do contato (`Contact.createdAt`) |
| Clientes (total) | base atual, fora do recorte de período |
| Leads / conversão / origem | data de **criação** do lead (`Lead.createdAt`) |
| Receita registrada | data do **registro financeiro** — só existe com módulo de pedidos; sem base confiável o indicador vem com `hasData: false` e explicação |

Funil: `Lead → Agendamento → Confirmado → Chegou → Concluído`. As etapas
saem dos estados REAIS (`pending/confirmed/cancelled/completed/no_show`); o
estágio “Chegou” não é registrado pelo modelo e aparece como **não
rastreado** (nunca um número inventado). Períodos: Hoje · 7 · 30 · Este mês ·
Personalizado (+90/12 meses/tudo e as URLs numéricas antigas), sempre com
comparação ao período imediatamente anterior de mesma duração.

### 2. Acesso do Profissional (Bloco 2) — `Professional.userId`

O vínculo **login ↔ profissional** é um campo por unidade (`Professional.userId`),
configurado em Equipe. A regra vive no BACKEND (`access-core.ts`):
`professionalScopeFor` define o escopo, `scopeBookings` recorta os dados e
`canAccessBooking` decide mutações — agenda, catálogo, painéis e PATCH passam
pela MESMA função. Consequências:

- vinculado ⇒ vê só a própria agenda (URL, `limit`, `from/to` e ids trocados
  não ampliam nada);
- papel de atendimento SEM vínculo ⇒ agenda vazia (`agendaScope: 'none'`) —
  fecha por padrão em vez de abrir a de todo mundo;
- Owner/Admin/Master nunca são reduzidos pelo vínculo;
- clientes, histórico e observações continuam no nível da UNIDADE
  (continuidade de atendimento) — observações são **append-only** com autor,
  data e contexto;
- a chegada/confirmação registrada pela recepção aparece ao voltar para a
  tela (`useRevalidateOnFocus`, sem polling e sem realtime novo).

### 3. Identidade visual do painel (Bloco 3) — `src/lib/appearance.ts`

Uma cor por `Business.appearance.navColor`, escolhida em Configurações →
Aparência com prévia. Vira tokens CSS (`--il-nav*`) aplicados no container do
painel: a sidebar usa `var(--il-nav*)` (nada hardcoded, nada de classes
combinatórias) e o contraste do texto é **derivado** da luminância da cor, então
não existe combinação ilegível. Trocar de unidade troca a identidade na hora
(`/api/auth/me` alimenta o shell). A identidade pública (`Page.theme` /
`ThemeStyle`) é outro sistema e não foi tocada.

## P4 set/2026 — Motor de Automações (orquestração, não segundo sistema)

Automação = grafo pequeno e validável (gatilho → condição → ação → espera →
ramificação → fim), gravado no **mesmo documento** do banco (`db.automations`,
`db.automationRuns`, `db.tasks`). Nada de Redis/BullMQ/Kafka e nenhuma segunda
implementação de leads/esteira/agenda/webhooks:

- **Gatilho no serviço oficial**, não na rota: `ingestLead`, `moveLeadStage`,
  `assignLead`, `createBookingTx`, `applyBookingStatusTx` emitem o evento dentro da
  MESMA transação — todo caminho (página, painel, widget, assistente, API externa)
  dispara as mesmas automações automaticamente.
- **Ação = delegação**: `change_lead_stage` chama `moveLeadStage`, `create_booking`
  chama `bookLead → createBookingTx` (slot revalidado, 409 vira erro legível da
  execução), `cancel_booking` chama a transição oficial, `dispatch_webhook` chama o
  canal assinado do P3. Para isso duas regras foram EXTRAÍDAS para funções
  (`updateLeadFields` em `pipeline.ts`; `applyBookingStatusTx` em
  `booking-status.ts`, novo módulo server — `booking-ops.ts` continua puro para os
  Client Components) e as rotas passaram a usá-las. Contratos e mensagens preservados.
- **Execução persistida e retomável**: espera grava `status:'waiting'` +
  `waitingUntil` + `currentNodeId` = próximo nó e libera a posse; nenhuma requisição
  fica aberta. O `updateDB` tem um gancho inline (só quando há fila) e
  `/api/cron/automations` (mesma política `CRON_SECRET` fail-closed do P3) retoma o
  que venceu. Concorrência entre instâncias = claim/lease com `updateDBWithCas`.
- **Condições são dados**: 8 operadores + AND/OR/NOT sobre um catálogo fechado de
  campos (`lead.*`, `customer.*`, `booking.*`, `event.*`, `service.*`), sem avaliar
  código — `{{lead.name}}` é substituição literal. É também o contrato que o P5 vai
  gerar: a definição é validada no servidor, o usuário aprova, o motor executa.
- **Proteções**: teto de passos por execução, 2 visitas por nó (ciclo acidental),
  ciclo sem espera é recusado na gravação, idade máxima da execução, fila limitada
  por empresa, orçamento de tempo por varredura, `businessId` da execução revalidado
  em cada passo (uma automação jamais toca outra empresa), falha registrada sem
  perder efeito já aplicado, ações idempotentes por execução+nó.
- **Planos**: nada de `if plan === ...`. `lib/automation/capabilities.ts` é a única
  fonte (`automation.basic|advanced|ai`, `channel.*`), com tetos derivados e
  override por unidade — a parte necessária para o P4, nada além.
- **Interface** (`/automacoes`, menu Gestão, permissão `config`): lista com
  liga/desliga, criar/editar/duplicar (cópia nasce desligada)/excluir com
  confirmação, galeria de modelos internos, histórico de execuções passo a passo e
  a fila de `Task` da unidade. O editor é LINEAR (“Quando/Se/Então/Depois/Senão”) e
  compila para o grafo — projeção reversível (`graphToLinear`); o grafo continua
  exposto na API para um editor visual futuro, sem virar clone de Zapier.

Detalhes, contratos e a tabela de alterações em P0–P3: [`docs/automations-p4.md`](docs/automations-p4.md).

## P6 set/2026 — Canais e integrações externas (conexão, não segundo motor)

Camada que liga o InstaLink ao mundo de fora sem duplicar P3/P4:

```text
EXTERNO → CONNECTOR → EVENTO NORMALIZADO → emitAutomationEvent() → P4
P4 (ação) → conector de saída → sistema externo (webhook assinado do P3)
```

- **Três categorias separadas** (`kind`): CANAL (whatsapp, instagram, messenger,
  telegram), FONTE DE LEAD (formulário, landing page, tráfego pago, QR, página
  pública) e INTEGRAÇÃO TÉCNICA (webhook de entrada, n8n, API externa) — um
  mesmo registro genérico (`db.integrations`), sem achatar os conceitos.
- **Honestidade**: `catalog.ts` é a fonte única do que existe e do que já
  funciona. Conector ausente = “Disponível em breve” na tela e **409** na API;
  canais devolvem `not_implemented` na saída — nunca “enviado”.
- **Entrada** (`/api/integrations/inbound/<id>`): token da integração
  (`ilk_live_…`, SHA-256 em repouso), assinatura HMAC opcional (mesma política do
  P3), payload limitado/sanitizado, idempotência `integração + externalId` e
  entrega ao serviço OFICIAL (`ingestLead`, `upsertContact` + P4) — o
  `businessId` do corpo é ignorado: a unidade vem da integração autenticada.
- **Saída**: `dispatchOutboundEvent` é o único caminho; a ação
  `dispatch_webhook` do P4 passou a chamá-lo e continua entregando pelo canal
  assinado do P3 (HMAC + fila + retry). **Nenhum segundo motor de retry.**
- **SSRF**: URL de saída passa por `lib/outbound-url.ts` (http(s), sem
  credenciais, host público; privado/loopback bloqueado em produção).
- **Interface**: Configurações → Canais (catálogo + conexões + log de eventos);
  webhooks de saída seguem na aba Integrações.

Detalhes e contrato do envelope: [`docs/integracoes-p6.md`](docs/integracoes-p6.md).

## O que NÃO foi construído (evolução futura)

Billing/planos, domínio próprio, WhatsApp API, pagamentos online, delivery com
roteirização, estoque, fidelidade, CRM avançado, PWA instalável, app nativo.
Ficam para o **P6.1/P6.2**: conector oficial de WhatsApp/Instagram
(Cloud API/Graph), Messenger, Telegram, conector nativo de Lead Ads,
`wait_for_event` por evento de canal, editor visual de grafo e a reserva atômica
(CAS) da idempotência entre instâncias simultâneas. O P5 (IA/agente) vive em
`src/lib/ai/` **por cima** do P4: a IA não executa, o motor de automações executa.
Todos têm ponto de extensão documentado no código (`Order` separado de
pagamento, `modes` por negócio, eventos para analytics,
`registerChannelConnector` para os canais, `AutomationWaitMode` para o evento).
