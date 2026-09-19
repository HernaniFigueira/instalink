# A3.4 — Consolidação operacional do produto

**Repositório:** HernaniFigueira/instalink · **base:** `main` @ `19433984916793f665aa28fdedcc186692ee45c1`
**Branch desta entrega:** `arena/01a0ba19-instalink` · **PR:** um só, sem merge (aguarda revisão independente)

Este relatório é escrito em blocos, na mesma ordem da execução. Cada bloco tem
commit próprio, testes direcionados e `tsc --noEmit` antes do seguinte.

---

## BLOCO 0 — AUDITORIA ANTES DE ALTERAR

Levantamento do estado REAL do código no HEAD de referência. Nada abaixo é
suposição: cada linha cita arquivo/rota existente.

| # | Item pedido | O que JÁ existe (reutilizar) | O que precisa ser CRIADO/ALTERADO |
|---|---|---|---|
| 1 | `src/lib/panel.ts` | Catálogo ÚNICO de destinos (22 portas), seções, `SECTION_ACCENT`, `panelNavigation()`, `panelAccess()`, `API_GUARDS`, `LEGACY_ROUTES`. Sidebar, busca, largura e guarda de rota são PROJEÇÕES dele. | Rótulo "Início"; seção `inicio`; mover Profissionais/Disponibilidade para Operação; Pedidos no menu com gate de módulo; `SECTION_THEME` (accent + activeBg + activeFg). |
| 2 | `DashboardShell` | Menu com seções colapsáveis, busca (`NavSearch`), pills mobile, rodapé de usuário, banner de suporte, guarda 403 amigável, largura por catálogo. | Item ativo passa a usar a cor da seção; remover o grupo "Outros destinos" (desktop e mobile). |
| 3 | Profissionais | `Professional` (nome, role, photo, active, userId), `/api/catalog` `professional.save/delete`, `TeamEditor` em `catalog-panels.tsx`, `followsBusinessHours`. | Card com estado de acesso ("Sem acesso ao sistema"/"Acesso ativo") + CTA "Criar acesso"/"Gerenciar acesso"; pergunta "Criar acesso agora? / Fazer depois" após salvar. |
| 4 | Equipe + `/api/team` | Rota completa (GET/POST/PATCH/DELETE) com papéis, permissões por override, vínculo `professionalId` (1:1 por unidade), auditoria, proteção de OWNER. Tela com lista, drawer, permissões. | Bloco "Profissionais sem acesso" (com foto real), deep-link `?member=`/`?professionalId=`, papel PROFISSIONAL pré-preenchido a partir de um profissional, guarda de 1:1 já server-side (reforço de UI). |
| 5 | `Professional.userId` | Campo no tipo e no store; `professionalForUser()`; aplicação do escopo em `lib/access-core.ts` (`professionalScope` — profissional vê só a própria agenda). | Nada de domínio: só UI/UX (sem segunda entidade). |
| 6 | Agenda | Grade dia/semana/mês, drag-and-drop com `lib/agenda-drag.ts`, `BookingDetailSheet`, filtros, tela cheia, faixa de pendências, `needsClosure`. | Botão "Hoje" fixo ENTRE as setas; clique em área vazia → novo agendamento pré-preenchido; visual âmbar do bloco pendente; badge "Encaixe"; painel "Fila de hoje"; ação de check-in. |
| 7 | `NewBookingSheet` | Fluxo cliente → serviço → data → hora com `computeSlots` via `/api/bookings?mode=slots-admin`, recorrência (`BookingRecurrence`), criação por `createBookingTx`. | Props `initialDate/initialProfessionalId/preferredTime`; migração visual para `Drawer/Button/Input/Select/Notice/SubCard/Switch`; encaixe (fit-in) com confirmação de conflito; sucesso "soft". |
| 8 | BusinessHours / Disponibilidade | `BusinessHoursPanel` + `DayHoursList` (edição por dia), `lib/schedule.ts` (herança, impacto, aplicar a todos), exceções, fuso do negócio. | `HoursChips` compartilhado (chips por dia, inclusive "Fechado") substituindo a linha corrida de texto; botões antigos → `Button`. |
| 9 | Cliente 360 / `ClientProfileDrawer` | Drawer com abas (dados, histórico, notas, consentimento, agendamentos), print/compartilhar, `AddressFields` com CEP automático. | Renomear "Observações" → "Observações administrativas"; nova aba "Atendimentos"; campos compartilhados (e-mail/telefone/CPF). |
| 10 | contacts APIs | `/api/contacts` (busca, upsert, PII, dedupe por `phoneKey`/e-mail normalizado), `/api/people360`, `upsertContact`, `lib/contact-profile.ts` (validação de e-mail/CPF). | Import/export: `/api/contacts/import`, `/api/contacts/export` + parser CSV/XLSX puro. |
| 11 | WhatsApp Cloud API | `lib/whatsapp-cloud-api.ts` (client, envio, `DEFAULT_META_GRAPH_VERSION = 'v21.0'`, `getMetaGraphVersion()` por env), `lib/whatsapp-credentials` (AES-256-GCM por Business), webhook com assinatura HMAC, outbox/retries, inbox, campanhas. | Separar diagnóstico PLATAFORMA × UNIDADE; conferir versão da Graph API na doc oficial; Embedded Signup interno; QR só como teste (`wa.me`). |
| 12 | `/api/master/units/[id]/whatsapp` | Rota Master que grava credenciais da unidade (onboarding assistido), painel em `/master`. | Reusar como fallback do onboarding; separar o que é plataforma do que é unidade no diagnóstico. |
| 13 | Canais & Integrações | `CanaisIntegracoesView` (abas Canais/Fontes/Integrações), `IntegracoesView`, `WhatsappChannelPanel`, catálogo de provedores, conexões por unidade, eventos, chaves. | Nível de superfície: WhatsApp/Instagram no topo com "conectado/conectar"; técnico vai para "Diagnóstico"; Instagram deixa de ser `canConnect:false`. |
| 14 | integration provider catalog | `lib/integrations/catalog.ts` (`PROVIDERS`, `canConnect`, `unavailableReason`), `connections.ts` (valida + audita), `connectors.ts` (adapters de entrada + conectores de canal), `inbound.ts` (ingestão), webhooks/eventos. | `instagram.canConnect = true` com conector real; `ConversationChannel` aditivo; webhook próprio com assinatura/dedupe/tenant routing. |
| 15 | import/export existente | **Não existe** import/export de clientes. O que existe e será REUSADO: `upsertContact`, `phoneKey`, validação de PII (`lib/contact-profile.ts`), `pushAudit`, parser de CSV **não** existe (só `reviews/import` com payload JSON). | Todo o Bloco 7: CSV (parse/serialize + proteção de fórmula), leitor XLSX mínimo server-only, prévia/mapeamento/dedupe/relatório, export CSV + JSON completo. |

### Achados que mudam o plano (e por quê)

1. **`needsClosure` é derivado, não status.** `lib/booking-ops.ts` calcula a
   pendência a partir de data/hora/status. O pedido ("fundo âmbar no bloco") é
   APRESENTAÇÃO: nada aqui toca `BookingStatus`, e a conclusão segue o fluxo
   normal (`applyBookingStatusTx`).
2. **`createBookingTx` é o caminho único de criação** (página, painel,
   assistente, API externa, automação). O encaixe NÃO cria um segundo caminho:
   é um parâmetro declarativo (`bookingKind: 'fit_in'`) com confirmação
   explícita, e continua revalidando tenant, serviço, profissional, data,
   horizonte e passado.
3. **Já existe vínculo User→Professional** com todas as guardas (1:1 por
   unidade, login não aponta para dois profissionais, secretária independente).
   O Bloco 2 é UX + superfície, não domínio novo.
4. **`Professional` já tem foto** e o `Avatar` compartilhado aceita `src`:
   Equipe passa a usar a foto real do profissional vinculado (hoje só lista
   nome/e-mail).

### Decisões de arquitetura tomadas na auditoria

- **Permissão nova `atendimento`** (registro clínico/do atendimento) em vez de
  reusar `clientes`: conteúdo de atendimento é dado sensível e a Secretaria não
  o recebe por padrão. `PROFISSIONAL`, `ADMIN` e `OWNER` têm por padrão;
  `SECRETARIA`/`ATENDENTE`/`VENDEDOR` não — concedível por override explícito.
- **`Encounter` é entidade própria** (nada de texto clínico em `Booking.note`).
- **`QueueEntry` é entidade própria** (fila não é agenda: walk-in sem booking
  não pode virar Booking falso).
- **Sem dependência nova para XLSX:** leitor `.xlsx` mínimo em TypeScript puro
  (ZIP + XML via `node:zlib`), server-only, testável. Evita pacote pesado no
  bundle do cliente e dependência sem manutenção.

---

## BLOCO 1 — NAVEGAÇÃO E COERÊNCIA VISUAL

**Commit:** `A3.4 nav + coerência visual`

### 1.1 Dashboard → Início (linguagem, não arquitetura)

- `PANEL_ROUTES['/dashboard'].label = 'Início'` — a **rota** continua
  `/dashboard` e a **permissão** continua `dashboard`. Renomear rota/API/schema
  por rótulo quebraria link salvo, permissão gravada por unidade e integração
  sem entregar nada a quem opera.
- Rótulo atualizado em TODA a linguagem visível: menu, busca de navegação,
  descrições, catálogo de Permissões (Equipe), `AREA_LABELS` (mensagens de 403),
  tela `/dashboard` e atalho de retorno em `/pagina`.
- Regressão: `a34-nav.test.ts` confere que nenhum texto VISÍVEL (comentários
  fora) ainda diz "Dashboard".

### 1.2 Menu reorganizado

```
INÍCIO        Início
OPERAÇÃO      Agenda · Profissionais · Disponibilidade · Conversas · Assistente · Tarefas · Pedidos*
PESSOAS       Clientes · Funil
OFERTA        Serviços · Produtos
CRESCIMENTO   Campanhas · Automações · Canais & Integrações
RESULTADOS    Resultados · Organização
PRESENÇA      Página
ADMINISTRAÇÃO Equipe · Recursos · Configurações
```
`*` Pedidos aparece **somente** quando o módulo `orders` está ativo
(`modes: ['orders']`) — módulo desligado = porta inexistente para o usuário.

- **Execuções** continua `sidebar: false`, rota válida, e passa a ser alcançável
  apenas pelo atalho contextual dentro de Automações ("Ver histórico de
  execuções"), que já existia no componente de Automações.
- **"Outros destinos" foi removido** da sidebar desktop e do painel "Mais" no
  mobile (A3.4): dois comportamentos na mesma barra confundiam mais do que
  ajudavam. `nav.more` continua existindo como declaração (destino acessível),
  mas não é mais renderizado.

### 1.3 Cor do item ativo = cor DA SEÇÃO

`SECTION_THEME` em `lib/panel.ts` é a fonte única:

| Seção | accent (ícone + rail) | activeBg | activeFg |
|---|---|---|---|
| Início / Operação / Presença | `--brand` | `--brand-soft` | `--brand-fg` |
| Pessoas | `--teal` | `--teal-bg` | `--teal-fg` |
| Oferta | `--lilac` | `--lilac-bg` | `--lilac-fg` |
| Crescimento | `--warning` | `--warning-bg` | `--warning-fg` |
| Resultados | `--success` | `--success-bg` | `--success-fg` |
| Administração | `--text-muted` | `--surface-3` | `--text` |

- Item ativo: **ícone mantém a cor da seção**, o fundo recebe a versão soft da
  seção e o texto usa a variante legível da mesma família. Não existe mais
  `bg-[var(--il-nav-active)]` + `--il-nav-active-fg` pintando tudo de azul.
- Rail: 3px, `rounded-pill` (extremidades arredondadas), cor da seção, altura 6
  (24px) — pequena aba sobre a superfície, sem borda grossa em volta do item.
- A cor nunca é o único indicador: o rail e o `aria-current="page"` continuam.
- Regressão: `a34-nav.test.ts` e `visual-convergence.test.ts` falham se alguém
  voltar a forçar `--il-nav-active-fg` em todas as seções.

### Testes do bloco

```
npx vitest run src/lib/__tests__/a34-nav.test.ts   src/lib/__tests__/panel.test.ts src/lib/__tests__/visual-convergence.test.ts   src/lib/__tests__/product-positioning.test.ts src/lib/__tests__/http.test.ts   → 13 + 73 + … ok
npx vitest run        → 75 arquivos · 1268 testes · 100% ok
npx tsc --noEmit      → 0 erros
```

Testes de entregas anteriores atualizados **de propósito** (a spec de navegação
é justamente o que este bloco muda): `panel.test.ts` (8 seções, ordem da
sidebar, Pedidos com gate de módulo, Execuções único destino fora do menu),
`visual-convergence.test.ts` (tema por seção em vez de brand fixo),
`product-positioning.test.ts` (Pedidos deixou de ser `sidebar:false`),
`http.test.ts` (`AREA_LABELS.dashboard = 'Início'`).
