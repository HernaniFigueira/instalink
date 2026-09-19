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

---

## BLOCO 2 — PROFISSIONAIS × EQUIPE: UMA PESSOA, DOIS CONCEITOS

**Commit:** `A3.4 profissionais/equipe + formulários cliente` (junto dos
formulários do Bloco 6, quando aplicável)

### O que foi reutilizado (nada de segunda entidade)

- `Professional.userId` (vínculo User → Professional), `professionalForUser()`,
  `professionalScope` em `lib/access-core.ts` — o recorte "vê só a própria
  agenda" continua sendo do SERVIDOR.
- `/api/team` POST/PATCH já tinham todas as guardas: 1 vínculo por profissional,
  1 profissional por login na unidade, auditoria `member.professional_linked`.

### O que foi criado/alterado

| Onde | Mudança |
|---|---|
| `/api/catalog` `professional.save` | devolve `{ ok, professionalId }` — a tela usa o id para oferecer o acesso JÁ VINCULADO (sem recriar pessoa). |
| `/api/team` GET | `professionals[]` ganha `photo`; `members[]` ganha `professionalPhoto`. |
| `components/dashboard/MemberAccessSheet.tsx` | **novo** componente compartilhado de criação de acesso (nome, e-mail, senha, papel, papel PROFISSIONAL → "Vincular profissional existente" listando SÓ quem não tem login, observação e concessão explícita de acesso ao registro de atendimento). Usado por Equipe e por Profissionais. |
| `/profissionais` | Card do profissional mostra `Sem acesso ao sistema` / `Acesso ativo` com CTA `Criar acesso` / `Gerenciar acesso`; após salvar um profissional novo, painel "Profissional criado — [Criar acesso agora] [Fazer depois]". |
| `/equipe` | Duas populações na mesma tela: **PESSOAS COM ACESSO** e **PROFISSIONAIS SEM ACESSO** (avatar com foto REAL do Professional, função e `[Criar acesso]`); avatar dos acessos vinculados usa a foto do profissional; deep-links estáveis `?member=<id>` (abre o membro) e `?professionalId=<id>` (sem login → abre o acesso pré-vinculado; com login → abre o membro). |

### Decisão de compatibilidade

O POST de `/api/team` continua aceitando `role: 'PROFISSIONAL'` sem
`professionalId` (fluxos existentes e scripts não quebram). A exigência de
escolher o profissional existe na INTERFACE — onde a pessoa decide — e o
servidor segue recusando o que é inválido (profissional de outra unidade,
profissional já vinculado). Quem ficar com papel PROFISSIONAL sem vínculo vê o
aviso honesto já existente no shell ("acesso de atendimento ainda não vinculado
— agenda vazia por segurança").

### Testes

`src/lib/__tests__/a34-team.test.ts` (10 casos, rotas reais com banco temporário):
criar profissional não cria login e devolve id; editar mantém id; criar acesso
grava `Professional.userId`; segundo login recusado (400); um login não aponta
para dois profissionais; GET devolve foto nos dois lados; lista "sem acesso"
derivável; secretária independente; vínculo com profissional de outra unidade
recusado (404/403/401) sem gravar nada.

```
npx vitest run src/lib/__tests__/a34-team.test.ts src/lib/__tests__/professional-access.test.ts → 23 ok
npx vitest run → 76 arquivos · 1278 testes ok
npx tsc --noEmit → 0 erros
```

## BLOCO 3 — DISPONIBILIDADE · AGENDA · NOVO AGENDAMENTO

### O diagnóstico

A Disponibilidade resumia a semana numa **frase corrida** — "Seg 08:00 — 20:00 ·
Ter 08:00 — 20:00 · Qua 08:00 — 20:00 · …" — impossível de conferir de relance,
e o horário de cada profissional aparecia como outra frase, no mesmo formato.
Na Agenda, o botão **Hoje** existia só quando você NÃO estava em hoje: o
elemento mais procurado era justamente o que sumia do lugar. E a grade não
tinha como criar por clique: quem olhava "14:00 de quinta está vago" tinha de
abrir o formulário e redigitar dia, hora e profissional.

### O que mudou

| Onde | Mudança |
|---|---|
| `lib/hours-chips.ts` | **novo** — decide o que mostrar em cada dia (ordem da semana começando na SEGUNDA, dia fechado, turno duplo). Nenhum horário nasce aqui: a entrada vem de `businessHoursTable` / `professionalHoursTable`. |
| `components/ui.tsx` · `<HoursChips/>` | **novo** componente do design system: `[ SEG 08:00 → 20:00 ]`, `[ DOM Fechado ]`. Chip fechado é neutro (não é erro); chip aberto é branco com borda forte; a seta usa a cor da marca. |
| `dashboard/BusinessHours.tsx` | passa a mostrar **chips** no horário da empresa E no horário efetivo de cada profissional (mesma linguagem para comparar). Card do profissional ganha **avatar com a foto real**. Toda a tela saiu do `zinc/emerald/blue` cru para os tokens do design system; avisos usam o `Notice` compartilhado. |
| `/disponibilidade` | fuso horário e "Regras de reserva" em `Panel` + `Select` do design system (zero classe fora do sistema). |
| `agenda/page.tsx` · toolbar | `[◀] Hoje [▶]` num grupo único, com "Hoje" **sempre** no mesmo lugar (quando já é hoje, ele fica marcado como selecionado em vez de desaparecer). Setas e tela cheia em `IconButton`/`Button`. |
| `agenda/page.tsx` · grade | **clicar num horário vago abre o Novo agendamento já naquele dia, hora e profissional**. O clique é convertido por `minuteFromOffsetY` (snap de 5 min, sempre dentro da grade) e NUNCA dispara depois de um arraste (`lastGridPressAt` + `el.closest('button')`). A legenda passa a ensinar as duas interações: "clique num horário vago para agendar · arraste um cartão para remarcar". |
| `NewBookingSheet.tsx` | migrado ao design system (`Button`, `Field`, `Input`, `Select`, `Checkbox`, `Notice`, `Badge`, `Avatar`, `IconButton`): cabeçalho com passo a passo, cliente selecionado em chip verde com botão "Trocar", resultados de busca com avatar, horários em grade de botões com o escolhido em azul cheio. Aceita pré-preenchimento (`date`, `time`, `professionalId`, `serviceId`) e **só mantém o horário sugerido se a grade real do servidor oferecer aquele horário**. |

### O que NÃO foi tocado (trava de motor)

`computeSlots`, `createBookingTx`, recorrência/série, `moveLeadStage`,
`ingestLead`, outbox, webhook e isolamento de tenant seguem intocados. O novo
agendamento continua perguntando a disponibilidade ao servidor
(`mode=slots-admin` via `lib/agenda-drag`) e salvando por `POST /api/bookings` —
a tela não calcula slot nenhum.

### Higiene de repositório

`tsconfig.tsbuildinfo` (artefato de build do `tsc`) estava versionado desde
antes desta entrega e mudava em TODO commit. Foi removido do índice e entrou no
`.gitignore` — nenhum build futuro entra no histórico por acidente.

### Testes

`src/lib/__tests__/a34-agenda.test.ts` (14 casos): ordem dos chips (SEG → DOM),
dia sem regra = "Fechado" (nenhum `00:00` inventado), turno duplo com todas as
janelas, horário do profissional saindo da MESMA tabela do motor
(follow × personalizado), Disponibilidade usando `<HoursChips/>`, grupo
`[◀] Hoje [▶]` na ordem e sem render condicional, clique-na-grade abrindo o
sheet com dia/hora/profissional, snap/limites de `minuteFromOffsetY`, e o
contrato do sheet (design system + slots no servidor + pré-preenchimento).

```
npx vitest run src/lib/__tests__/a34-agenda.test.ts → 14 ok
npx vitest run → 77 arquivos · 1292 testes ok
npx tsc --noEmit → 0 erros
npm run build → ok
```

## BLOCO 4 — ATENÇÃO · ENCAIXE · CHECK-IN · FILA DE ESPERA

### O diagnóstico

A Agenda sabia o que estava MARCADO, mas não o que estava ACONTECENDO: não
havia como registrar que o cliente chegou, não havia como encaixar alguém fora
da grade sem mentir sobre disponibilidade, e quem chegava sem horário não tinha
onde existir (ou virava um agendamento falso, ou virava um papel na recepção).
A "atenção" existia só como lista de pendências de fechamento — correta, porém
cega para o balcão.

### O que foi criado

| Onde | Mudança |
|---|---|
| `lib/types.ts` | **aditivo**: `Booking.bookingKind` (`'standard'`/`'fit_in'`), `Booking.checkedInAt` / `checkedInBy` / `checkedInByName`, a entidade **`QueueEntry`** (+ `QueueStatus`) e o array `DB.queue`. `AuditAction` ganha `booking.checkin`, `booking.checkin_undo`, `queue.created/updated/removed`. |
| `lib/db.ts` | `emptyDB()` cria `queue: []` e a migração defensiva garante o array em documento antigo (idempotente, reversível). |
| `lib/queue.ts` | **novo** — regras puras da fila: `QUEUE_STATUS`, `QUEUE_TRANSITIONS` (máquina de estados), ordem por chegada, posição, `waitMinutes` (congela quando o atendimento começa), `waitLabel`, `queueSummary` e o limite de espera longa. |
| `lib/fit-in.ts` | **novo** — conflito do encaixe: quem se sobrepõe, de quem é o horário e a frase única que servidor e tela usam (`fitInWarning`). `fitInConflictsFromDB` resolve a duração de cada agendamento pelo serviço dele. |
| `lib/booking-create.ts` | `createBookingTx` aceita `bookingKind:'fit_in'` (+ `fitInConfirmed`). O encaixe muda **uma** regra (o horário não precisa estar na grade) e mantém todas as outras (tenant, serviço, data, horizonte, passado, profissional elegível). Sem confirmação, o conflito é devolvido com 409 e **nada é gravado**. O agendamento nasce com `bookingKind:'fit_in'`, nota no histórico e evento `booking_created` com `meta.kind='fit_in'`. Encaixe só é aceito com `actor === 'owner'` (equipe) — nunca do fluxo público. |
| `/api/bookings` POST | valida o encaixe (403 sem equipe, 400 com série) e faz a pré-checagem de conflito (`code: 'fit_in_conflict'` + lista) antes de escrever. |
| `/api/bookings` PATCH | ações `check-in` e `check-in-undo`: gravam chegada + auditoria **sem mudar status** (chegar não é concluir), respeitam o escopo do profissional e recusam atendimento já encerrado. |
| `/api/queue` | **novo** — GET (fila do dia + vivas + resumo + opções), POST (entrada com nome ou WhatsApp, alimenta o CRM via `upsertContact`), PATCH (transição válida da máquina, marca `calledAt`/`startedAt`/`endedAt`, auditoria) e DELETE. Tudo escopado por unidade e por profissional. |
| `components/dashboard/QueuePanel.tsx` | **novo** — fila do balcão: posição, espera ao vivo (30s), selo de espera longa, UMA ação principal por linha (Chamar → Iniciar → Concluir), ações secundárias só quando a máquina permite, e "Adicionar à fila" para quem chegou sem horário. |
| `components/dashboard/BookingDetailSheet.tsx` | selos `Encaixe` e `Chegou` no cabeçalho e botões **Registrar chegada** / **Chegou às HH:MM** (reversível), com a frase que explica que o status não mudou. |
| `components/dashboard/NewBookingSheet.tsx` | bloco **Encaixar**: horário fora da grade → o servidor responde com o conflito (nome + horário + profissional), a tela mostra "Nada foi agendado ainda" e só então oferece "Encaixar mesmo assim". A tela de sucesso marca o Encaixe. |
| `app/(dashboard)/agenda/page.tsx` | cartões mostram `ENCAIXE` e ✓ de chegada; painel **Fila de hoje** abaixo da toolbar com badges de aguardando/chamado/em atendimento e faixa de atenção quando a espera passa do confortável. |
| `lib/dashboard.ts` + `/api/overview` | a região de atenção do Início ganha `esperando na fila` e `chegaram sem check-in` — mesma leitura da Agenda, nenhum alerta paralelo. |

### Decisões

- **Fila é entidade própria.** Um cliente sem horário marcado NUNCA vira
  Booking: isso ocuparia a grade, mentiria sobre disponibilidade e poluiria os
  relatórios. A entrada de fila pode apontar para um agendamento (quando veio
  de horário marcado) ou existir sozinha.
- **`needsClosure` continua derivado.** Nada foi adicionado a `BookingStatus`:
  check-in e encaixe são campos operacionais, e o fechamento continua sendo a
  máquina de estados existente (`applyBookingStatusTx`).
- **Encaixe não é caminho paralelo.** Ele passa pelo MESMO `createBookingTx`;
  o que muda é uma condição declarativa, com confirmação explícita e registro
  no histórico — auditável e reversível de entender.

### Testes

`src/lib/__tests__/a34-queue.test.ts` (14 casos puros: ordem, posição, espera
congelada, resumo, máquina de estados, rótulos; conflito de encaixe encostado,
por profissional, por equipe, terminal ignorado, duração por serviço).
`src/lib/__tests__/a34-operative-routes.test.ts` (15 casos com as ROTAS REAIS e
banco temporário: encaixe não grava sem confirmação e grava marcado com ela,
cliente público nunca encaixa, série + encaixe recusada, check-in sem mudar
status + auditoria + reversível + recusa em encerrado + isolamento de unidade,
fila alimentando o CRM sem criar Booking, GET escopado, transições válidas e
inválidas, espera congelada, entrada vazia recusada).

```
npx vitest run src/lib/__tests__/a34-queue.test.ts → 14 ok
npx vitest run src/lib/__tests__/a34-operative-routes.test.ts → 15 ok
npx vitest run → 79 arquivos · 1321 testes ok
npx tsc --noEmit → 0 erros
npm run build → ok
```

## BLOCO 5 — ATENDIMENTO (REGISTRO) · HISTÓRICO · IMPRESSÃO

### O diagnóstico

O sistema sabia que o atendimento EXISTIU (agendamento, status, check-in), mas
não guardava o que ACONTECEU nele. O único lugar possível era `Booking.note` —
texto solto, sem dono, sem estado, sem histórico e visível para qualquer pessoa
com acesso à agenda. Nada disso servia para a clínica, o consultório ou o
salão: não havia documento do que foi feito, nem o que orientar no retorno.

### O que foi criado

| Onde | Mudança |
|---|---|
| `lib/types.ts` | **aditivo**: permissão `atendimento`, entidade **`Encounter`** (+ `EncounterStatus`), `DB.encounters` e audit `encounter.created/updated/finalized/reopened/removed`. |
| `lib/permissions.ts` | `atendimento` com rótulo e explicação próprios. **Não vem com "clientes"**: `SECRETARIA`/`ATENDENTE`/`VENDEDOR` não recebem por padrão (concedível por override); `PROFISSIONAL`/`ADMIN`/`OWNER` têm. |
| `lib/db.ts` | `encounters: []` no banco vazio + normalização idempotente de documentos antigos. |
| `lib/encounters.ts` | **novo** — regras puras: limites e higiene por campo (`cleanText`), etiquetas (`cleanTags`), `canFinalize` (documento vazio não vira via do cliente), `canEditEncounter`, `encounterInScope`, `encounterForBooking`, `encountersForCustomer` (por **identidade**, nunca por nome), `encounterPrintBlocks` e `encounterSignature`. |
| `/api/encounters` | **novo** — GET (por agendamento, por cliente ou por período), POST (1:1 com o agendamento: pedir de novo devolve o existente com `reused:true`), PATCH (conteúdo + `finalize`/`reopen`) e DELETE. Guardas: permissão `atendimento`, escopo do profissional, reabertura só de quem administra, edição de finalizado recusada, auditoria em todas as transições. |
| `globals.css` | bloco `@media print`: `body.il-printing` esconde a interface e mostra só `.il-print-area` — a via do cliente é o MESMO registro, não um segundo conteúdo. |
| `components/dashboard/EncounterSheet.tsx` | **novo** — painel do atendimento (rascunho → finalizar e assinar → reabrir), com a via impressa em `.il-print-area`. A anotação interna existe na tela e **não entra** na impressão. |
| `BookingDetailSheet` | botão **Atendimento** (só com a permissão própria) que abre/cria o registro já vinculado ao agendamento. |
| `ClientProfileDrawer` | nova aba **Atendimentos** (contagem + lista + abertura do registro completo). Sem a permissão, a aba não aparece e a rota não é chamada. |
| `icons.tsx` | `fileText` e `printer`. |

### Decisões

- **Registro é documento, não anotação.** Nasce rascunho, é assinado na
  finalização (nome do profissional que atendeu) e, depois disso, só muda com
  reabertura explícita — que fica na auditoria. O texto que o cliente levou para
  casa não muda em silêncio.
- **Dado sensível com porta própria.** Ler o conteúdo do atendimento não é o
  mesmo que operar o balcão: por isso a permissão é `atendimento`, e não
  `clientes` (que a secretária já tem).
- **Impressão sem rota nova.** Nada de `/imprimir` com HTML paralelo: a tela
  marca o documento e o CSS esconde o resto — o que sai no papel é exatamente o
  que está no registro (menos a anotação interna).

### Testes

`src/lib/__tests__/a34-encounter.test.ts` (17 casos): permissão própria (e a
prova de que secretária/atendente/vendedor NÃO a têm), higiene e limites,
etiquetas, `canFinalize`, rascunho × finalizado, escopo do profissional, via
impressa sem anotação interna, 1:1 por unidade — e, nas ROTAS REAIS com banco
temporário: criação herdando cliente/serviço/profissional sem tocar no
agendamento, não duplicação, `null` honesto, fluxo salvar → finalizar →
editar → reabrir com auditoria na ordem, 400 sem conteúdo, profissional
finalizando o próprio e recusado no do colega, finalizado que só o
administrador apaga, isolamento entre unidades e lista por identidade.

```
npx vitest run src/lib/__tests__/a34-encounter.test.ts → 17 ok
npx vitest run → 80 arquivos · 1338 testes ok
npx tsc --noEmit → 0 erros
npm run build → ok (107 páginas)
```
