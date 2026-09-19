# A3.4 — Consolidação operacional do produto

**Repositório:** HernaniFigueira/instalink · **base:** `main` @ `19433984916793f665aa28fdedcc186692ee45c1`
**Branch desta entrega:** `arena/01a0ba19-instalink` · **PR:** #30 — https://github.com/HernaniFigueira/instalink/pull/30 (um só, **sem merge** — aguarda revisão independente)
**Status parcial:** Blocos 0 a 8 commitados; Blocos 9 a 11 em andamento no mesmo branch/PR.

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

## BLOCO 6 — QUALIDADE DOS CAMPOS (TELEFONE BR · E-MAIL · CPF · CEP)

### O diagnóstico

Telefone era validado por tamanho (10 a 15 dígitos, qualquer coisa),
aceitando `09912345678` e recusando só o óbvio — e a mensagem de recusa era
sempre a mesma ("informe um WhatsApp válido"), sem dizer o que estava errado.
E-mail tinha **duas** réguas diferentes (uma no cadastro de contato, outra na
conta do cliente): dava para o mesmo endereço ser válido numa tela e inválido
na outra. CEP não era validado em lugar nenhum. E o campo não ajudava enquanto
se digitava: `11 9...` era o que a pessoa via.

### O que foi criado

| Onde | Mudança |
|---|---|
| `lib/field-quality.ts` | **novo, puro** — máscaras progressivas e a régua brasileira: telefone (10/11 dígitos com DDD plausível; `+55` reconhecido), e-mail, CPF e CEP, com **mensagem específica** por erro e `contactFieldErrors` para o conjunto do contato. |
| `lib/customer-account.ts` | `isValidCustomerEmail` passa a delegar para `isValidEmail` — **uma régua só** para o contato e para a conta. |
| `lib/contact-identity.ts` | a troca de telefone na ficha usa a mesma régua (antes aceitava 10–15 dígitos genéricos). |
| `/api/contacts` | POST recusa telefone/e-mail/CEP tortos com **400 antes de escrever**, cada um com a mensagem do seu problema. |
| `ClientProfileDrawer` | máscara ao digitar em CPF, telefone, CEP e nos dados do responsável; erro inline embaixo do campo; o "Salvar" avisa em vez de enviar cadastro torto (o servidor continua sendo a autoridade). |
| `NewClientSheet` | máscara de WhatsApp e as mensagens específicas ("Faltam dígitos…", "Falta o @…"). |
| `QueuePanel`, `NewBookingSheet`, `EsteiraView` | WhatsApp com máscara — quem chega sem horário, o agendamento novo e o cadastro rápido do lead. |

### Decisões

- **A máscara não mente sobre o tipo.** Até 5 dígitos do assinante nada de
  traço: em `(11) 91234` ainda não se sabe se é celular (9) ou fixo (8), e
  inserir/mover o traço no meio fazia o cursor pular. O traço aparece quando a
  dúvida acaba.
- **Fixo também é cliente.** A régua aceita DDD + 8 dígitos (2–5); exigir
  nono dígito transformaria o fixo do consultório em cadastro inválido.
- **Erro que ensina.** "Faltam dígitos no WhatsApp — informe DDD + número" e
  "O e-mail tem mais de um @' dizem o que consertar; a mensagem genérica
  antiga obrigava a pessoa a adivinhar.
- **Diagnóstico mais forte no que não faz sentido.** Gravação segue os dígitos
  como vieram (o `+55` não vira `55` duplicado nem some o formato que o
  WhatsApp usa); a normalização do código do país acontece na **validação**.

### Testes

`src/lib/__tests__/a34-field-quality.test.ts` (11 casos): máscaras
progressivas (inclusive a comparação com `formatPhoneBR`/`formatCpf`/
`formatCep` antigos, para garantir que o resultado final não mudou), celular
× fixo × DDD inexistente, mensagem por tipo de erro, e-mail com a prova de
que a régua antiga (`isValidCustomerEmail`) agora usa a nova, CEP incompleto —
e, nas ROTAS REAIS com banco temporário: recusas com 400 e **nada gravado**,
celular com máscara que vira dígitos, CEP pela metade barrando o cadastro e o
PATCH de identidade usando exatamente a mesma régua.

```
npx vitest run src/lib/__tests__/a34-field-quality.test.ts → 11 ok
npx vitest run → 81 arquivos · 1349 testes ok
npx tsc --noEmit → 0 erros
npm run build → ok (107 páginas)
```

---

## CORREÇÃO INTERMEDIÁRIA (revisão independente dos Blocos 0–6)

Revisão pedida antes de abrir o Bloco 7. Os seis pontos, um por um.

### 1. Registro finalizado NÃO é editado direto — nem pelo dono

**O que estava errado.** A rota deixava a edição de conteúdo passar para quem
tem capacidade de reabrir (`if (target.status === 'finalized' && !reopen)`). Na
prática, OWNER e ADMIN alteravam um documento assinado **sem** reabrir e sem
deixar a reabertura na auditoria: o registro dizia “finalizado” enquanto o
texto mudava por baixo.

**Como está agora.** Qualquer PATCH de conteúdo em registro `finalized`
devolve **409** com a instrução certa — “Use *Reabrir para editar*” —, para
QUALQUER papel. A única porta é `action:'reopen'` (que assina a auditoria) e
só então o rascunho volta a aceitar texto. A ordem das checagens foi escolhida
de propósito: primeiro a instrução que destrava o usuário (reabrir), depois a
trava de concorrência — quem está numa versão velha **e** num registro fechado
precisa ouvir “reabra”, não “recarregue”.

Provas (rotas reais, banco temporário):
`OWNER não edita direto` · `ADMIN da unidade também não` ·
`PROFISSIONAL não edita nem o próprio` · depois de `reopen`, a edição funciona e
a auditoria fica **na ordem**: `created → finalized → reopened → updated`.

### 2. `version` — concorrência otimista

Campo **aditivo** `Encounter.version` (número; documento antigo vale **1** via
`normalizeDB`, para a primeira trava não dar 409 falso). Toda alteração real
grava `version + 1`; salvar sem mudança **não** cria versão nova (o autosave
bate aqui o tempo todo). O PATCH aceita `expectedVersion` — quando não bate:
**409** com “Este atendimento foi atualizado em outra aba. Recarregue antes de
salvar.” Finalizar e reabrir respeitam o mesmo campo. **Não** usamos
`updatedAt` como lock.

Provas: duas abas (A salva com a versão 1 → vira 2; B insiste na 1 → 409 e o
texto de A continua intacto; B recarrega com a 2 → grava) e a prova de que
finalizar/reabrir com versão velha também são recusados.

### 3. Autosave real no registro

Debounce de **1 s** (`ENCOUNTER_AUTOSAVE_MS`) só quando é rascunho, há mudança
**real** (assinatura de conteúdo, não tecla) e não há request em andamento
(`inflight`). Indicador discreto: **Salvando… · Salvo agora · Erro ao salvar**.
O botão **Salvar** continua como caminho manual. Ao **fechar com alteração
pendente**, a tela tenta o flush; se não conseguir, **avisa** (“fechar mesmo
assim e perder o que foi digitado?”) em vez de descartar em silêncio. Conflito
de versão desliga o automatismo e mostra o aviso com “Recarregar registro”.

### 4. Observações administrativas

A aba virou **“Observações administrativas”** (mesmo array de `notes`, sem
migrar dado), o campo agora é “Observação administrativa”, o placeholder virou
exemplo puramente operacional — “Prefere horário da manhã, confirmar por
telefone, convênio...” — e o vazio diz explicitamente que **o que aconteceu no
atendimento fica em Atendimentos**, com registro assinado: esta lista não
substitui nem copia aquele conteúdo.

### 5. Fila → atendimento (inclusive SEM agendamento)

“Iniciar atendimento” passou a fazer o handoff: move a entrada para
`in_service` **e** abre o registro com os dados da chegada (contato, nome,
serviço, profissional, dia e **horário real de início/chegada**). Sem
agendamento, `bookingId` fica **vazio** — o sistema **não fabrica um Booking**
(a agenda continua dizendo a verdade; há teste garantindo que nenhum
agendamento nasce desse caminho). Com `bookingId`, o vínculo é o do horário
marcado.

A alça de permissão é a que a revisão pediu: quem **não** tem `atendimento`
continua operando a fila inteira (chamar, iniciar, concluir, remover) **sem**
abrir o conteúdo profissional. Ações secundárias na linha: **Abrir cliente**
(quando há contato no CRM), **Encaixar na agenda** (abre o agendamento
pré-preenchido — nada é criado automaticamente) e **Ver horário** (quando a
entrada veio de um horário marcado).

### 6. +55 visual fixo nos campos de telefone

Componente único `PhoneBRInput`: `[ +55 ] [ (21) 99999-9999 ]`. O prefixo é
**texto fixo** (não é campo, não é editável, `aria-hidden` porque o número já
leva DDD), **não duplica** ao colar `+55 …` (a máscara remove o código do
país) e **não** muda o contrato de persistência: o `onChange` entrega dígitos,
como o resto do sistema sempre gravou. Aplicado em **NewClientSheet,
ClientProfileDrawer (cliente e responsável), NewBookingSheet, QueuePanel e
EsteiraView** — as cinco telas usam o mesmo componente e nenhuma delas voltou a
chamar a máscara na mão (há teste que falha se voltarem).

### 7. `tsconfig.tsbuildinfo`

Artefato gerado. Estado conferido e confirmado:

```
git ls-tree origin/main  → tsconfig.tsbuildinfo  (estava versionado na base)
git ls-tree HEAD         → (ausente: removido do índice nesta branch, em 24ffd84)
.gitignore               → tsconfig.tsbuildinfo  (linha 11)
git check-ignore -v      → .gitignore:11:tsconfig.tsbuildinfo
tsconfig.json            → intacto (nenhuma configuração real do TypeScript foi tocada)
```

A remoção aparece no PR como **deleção** do artefato (0 adições), o arquivo
continua existindo no disco como cache local de build e **não volta** a ser
versionado — há teste novo travando o `.gitignore` e a integridade do
`tsconfig.json`.

### Testes e portões desta correção

```
npx vitest run src/lib/__tests__/a34-encounter.test.ts     → 27 ok
npx vitest run src/lib/__tests__/a34-review-fix.test.ts    → 20 ok  (novo)
npx vitest run src/lib/__tests__/a34-field-quality.test.ts → 11 ok
npx vitest run src/lib/__tests__/a34-queue.test.ts         → ok
npx vitest run src/lib/__tests__/a34-operative-routes.test.ts → 15 ok
npx vitest run  → 82 arquivos · 1379 testes ok
npx tsc --noEmit → 0 erros
npm run build    → ok (107 páginas)
```

Suíte nova (`a34-review-fix.test.ts`) foca no que não é servidor: debounce e
guardas do autosave, `expectedVersion` no payload, flush no fechamento,
handoff da fila, as cinco telas usando o `PhoneBRInput` sem duplicar máscara, a
fronteira das observações administrativas e o artefato fora do versionamento.

### O que esta correção NÃO toca

Blocos 7 a 11 seguem **não iniciados**: import/export, onboarding do WhatsApp,
Instagram, Graph API, canais e storage ficaram intocados.

---

## SEGUNDO FECHAMENTO DOS BLOCOS 5/6 (revisão do Atendimento)

### 1. O autosave lia formulário velho — CORRIGIDO

`latest.current.form` só era escrito em `apply()` (quando a resposta chegava).
Enquanto a pessoa digitava, o ref continuava com o último texto do servidor: o
autosave podia achar que “nada mudou” e não salvar o que estava na tela.

Agora existe **um único caminho de escrita**: todo `onChange` passa por
`updateForm(next)`, que grava o ref e o estado juntos (`updateRow` faz o mesmo
para o registro). `save()` lê `latest.current.form` **no momento do envio**, e
há regressão de fonte que falha se alguém voltar a chamar `setForm` direto
(exatamente o blocker da revisão).

### 2. Digitação durante o request não é apagada — CORRIGIDO

O save captura `sentForm`, `sentKey` e a revisão; ao responder, decide pela
regra pura `applySaveResult`:

```
draft A → request envia A → usuário muda para B antes da resposta
→ servidor confirma A/version 2
→ adoptServerForm = false  (B continua na tela, intocado)
→ lastSavedKey = A         (o que foi gravado é A)
→ baseVersion = 2          (o próximo ciclo salva B com a versão nova)
```

Se ninguém digitou durante o envio, o formulário do servidor é adotado
(normalização de tags/limites continua valendo).

### 3. `finalized` é READ ONLY na UI

`canEditEncounter()` devolvia `opts.canReopen` para registro finalizado: OWNER
e ADMIN digitavam à vontade e só descobriam o 409 ao salvar. Agora
`finalized` → **false para qualquer papel**; `canReopen` só decide se o botão
**Reabrir para editar** aparece (`canReopenEncounter(role)`, a mesma régua do
servidor: OWNER/ADMIN/MASTER). Depois de `reopen` o status vira `draft` e os
campos voltam a aceitar texto.

### 4. `expectedVersion` também no finalizar/reabrir (com versão fresca)

`transition(action)` lê `latest.current.row.version` **no clique** — depois de
um save pré-finalização essa é a versão que o servidor acabou de devolver, não
a do render. `finalize()` salva o que está na tela **antes** de assinar e só
então chama a transição.

### 5. Escrita sem trava não passa

`versionConflict` deixou de tratar ausência como “sem conflito”: a API do
Encounter é **nova**, não existe chamador legado a preservar, então não há
caminho inseguro. PATCH (conteúdo, `finalize` ou `reopen`) sem
`expectedVersion` válido → **400** com
`ENCOUNTER_VERSION_REQUIRED_ERROR`. Todos os chamadores internos foram
atualizados (a tela já mandava; os testes passaram a mandar).

### 6. `QueueEntry` agora é 1:1 com `Encounter`

Campo aditivo `Encounter.queueId` (documento antigo normaliza para `''`),
`encounterForQueue()` como regra pura, POST devolvendo o existente com
`reused: true` **e** revalidação dentro da transação (corrida de duplo clique).
Prova: walk-in cria **um** registro; abrir de novo devolve o **mesmo id**;
outra unidade não alcança a entrada nem o registro; o 1:1 do agendamento segue
independente.

### 7. Porta de volta na fila

Quem está `in_service` e tem a permissão ganhou **Abrir atendimento**: abre (ou
reutiliza) o registro pelo `queueId`, **sem** mexer no status da fila. Sem a
permissão `atendimento`, a linha continua só operacional — nada de conteúdo
profissional para quem faz balcão.

### 8. Recarregar conflito não cria registro novo

Nova leitura estável `GET /api/encounters?businessId=…&id=…` (escopada por
unidade **e** por profissional). O botão “Recarregar registro” usa **id** e
nunca POST — abrir pelo Cliente 360 (onde `bookingId` é `''`) não corre mais o
risco de gerar um segundo documento. Prova: após o conflito, recarregar mantém
a contagem em **1**.

### 9. Pós-atendimento: “como fica o acompanhamento?”

Depois de finalizar, aparece o painel discreto:

**Atendimento finalizado. Próximo passo:** `[ Encerrar ]` `[ Agendar retorno ]`
`[ Pedir à recepção ]`

- **Encerrar** — dispensa o painel e fecha o atendimento normalmente.
- **Agendar retorno** — abre o `NewBookingSheet` **pré-preenchido** (cliente,
  serviço, profissional). **Nada é marcado automaticamente**; a confirmação é
  humana.
- **Pedir à recepção** — cria uma **Task** de verdade (o sistema de pendência
  que já existe), com `title` “Agendar retorno de {cliente}”, nota = retorno
  anotado + instrução curta (campo aparece quando o `followUp` está vazio),
  `contactId`, `bookingId` quando houver e o novo **`encounterId`** — o vínculo
  aparece na auditoria (`task.created`). Nenhum sistema paralelo foi criado.

### 10. Reabertura no fluxo da fila

O `EncounterSheet` da fila recebia `canReopen={false}` chumbado. Agora usa o
papel real do painel: **OWNER/ADMIN** podem reabrir; **PROFISSIONAL** não; e
ter a permissão `atendimento` **não** dá poder de reabrir (mesma regra da API).

### Arquivos desta rodada

`lib/types.ts` (queueId, Task.encounterId) · `lib/db.ts` (normalização) ·
`lib/encounters.ts` (canEditEncounter, canReopenEncounter, versionConflict
obrigatório, applySaveResult, encounterForQueue, títulos da tarefa) ·
`lib/automation/tasks.ts` + `api/tasks/route.ts` (vínculo com o atendimento) ·
`api/encounters/route.ts` (GET por id/fila, POST 1:1 pela fila, PATCH com
trava obrigatória) · `EncounterSheet.tsx` (refs síncronas, preservação do
draft, pós-atendimento) · `QueuePanel.tsx` (Abrir atendimento) ·
`BookingDetailSheet.tsx` · `ClientProfileDrawer.tsx` · `agenda/page.tsx`
(reabertura por papel, retorno pré-preenchido) · testes.

### Testes desta rodada

```
npx vitest run src/lib/__tests__/a34-encounter.test.ts           → 30 ok
npx vitest run src/lib/__tests__/a34-encounter-integrity.test.ts → 13 ok  (novo)
npx vitest run src/lib/__tests__/a34-review-fix.test.ts          → 20 ok
npx vitest run src/lib/__tests__/a34-queue.test.ts               → ok
npx vitest run  → 83 arquivos · 1395 testes ok
npx tsc --noEmit → 0 erros
npm run build    → ok (107 páginas)
```

Provas exigidas, em uma linha cada:

- **autosave concorrente** — `applySaveResult`: A enviado, B digitado durante o
  voo → `adoptServerForm=false`, `lastSavedKey=A`, `baseVersion=2`; e o
  formulário da tela segue B.
- **fila 1:1** — walk-in: 1 registro; segunda abertura devolve o mesmo id;
  contagem na base continua 1; outra unidade → 404/null.
- **reload sem duplicação** — conflito de versão + “Recarregar registro” por
  `id`: `encounters` continua com 1 documento.
- **pós-atendimento** — `task.created` com `encounterId`, título
  “Agendar retorno de Seu Zé”, status `open`; “Agendar retorno” não cria
  agendamento (a base segue com zero `bookings` até alguém confirmar).

Blocos 7 a 11 continuam intocados.

### Fechamento final do B5 (3 gaps da revisão)

1. **A tarefa do retorno fica vinculada à PESSOA.** A tela já mandava
   `contactId` no “Pedir à recepção”, mas o POST de tarefas ignorava o campo —
   o walk-in (sem agendamento) virava tarefa órfã na ficha. Agora `POST
   /api/tasks` aceita `contactId` e **projeta** para `Task.customerId`, que é o
   vínculo que a ficha 360 e o resto do CRM já usam (e que valida por
   `c.id || c.customerId` dentro da unidade): **nenhuma identidade nova** foi
   criada na entidade. A view da tarefa devolve `contactId`/`contactName` e a
   auditoria registra o vínculo. Prova ponta a ponta: walk-in → registro →
   “Pedir à recepção” → `GET /api/people360` mostra a tarefa na pessoa do
   contato; e um contato de OUTRA unidade é recusado (422).
2. **“Agendar retorno” abre o cliente completo.** A `view` do registro passou a
   resolver `customerPhone` na ordem segura — **contato do CRM → agendamento de
   origem → entrada da fila** — sem persistir snapshot (o telefone muda, o
   documento do atendimento não deve carregar dado velho; há teste conferindo
   que o campo não está no banco). O `FollowUpSeed` leva `customerPhone` e a
   Agenda abre o formulário com **contato, nome, telefone, serviço e
   profissional** — a recepção não redigita o cliente nem refaz busca. Nada é
   agendado automaticamente.
3. **Sem eco no texto do retorno.** A tela semeava o campo da recepção com o
   próprio `followUp` e a nota juntava os dois (“retorno em 30 dias · retorno
   em 30 dias”). Agora o campo começa **vazio**, o retorno anotado aparece como
   **contexto (placeholder)** e `followUpTaskNote` só acrescenta a instrução
   quando ela é realmente diferente (comparação normalizada): dedupe testado.

```
npx vitest run src/lib/__tests__/a34-encounter-integrity.test.ts → 18 ok
npx vitest run  → 83 arquivos · 1400 testes ok
npx tsc --noEmit → 0 erros
npm run build    → ok (107 páginas)
```

---

## BLOCO 7 — IMPORTAR E EXPORTAR A BASE DE CLIENTES

### O diagnóstico

Quem chega de outro sistema tem a base num arquivo e **nenhuma porta** para
trazê-la: só restava cadastrar pessoa por pessoa — ou pedir ao suporte. E a
base que já está aqui também não saía em lugar nenhum (nem para backup, nem
para uma campanha externa, nem para conferência).

O bloco foi entregue em duas voltas. A primeira (`af53f81`) trouxe o fluxo
funcionando; a segunda reescreveu o contrato onde ele era **perigoso**:
atualizar cadastro existente por padrão, erro de CPF/nascimento passando,
célula de planilha executável e saída sem histórico. O contrato que vale é o
descrito abaixo.

### O que foi criado

| Onde | Mudança |
|---|---|
| `lib/client-import.ts` | **novo, puro** — leitura de CSV como o arquivo VEM (`;`, `,`, TAB, BOM, aspas, aspas escapadas, quebra de linha dentro da célula), cabeçalho em português ou inglês com acento e variações, **mapeamento escolhido pelo usuário**, normalização dos valores (telefone BR, data e CPF de verdade, sim/não) e o **planejador** da importação (`buildImportPlan`) — o mesmo para CSV e XLSX. |
| `lib/xlsx-lite.ts` | **novo, só no servidor** — leitor mínimo de `.xlsx` (ZIP + XML, primeira aba, texto compartilhado, data serial) usando só `node:zlib`. Nenhuma dependência nova: o pacote `xlsx` do npm está parado numa versão com CVE conhecida (prototype pollution) e o SheetJS saiu do npm. |
| `lib/client-export.ts` | **novo, puro** — quais contatos da unidade entram no arquivo (busca por nome/telefone/e-mail/CPF, filtro de consentimento, teto de 5.000 linhas) e ordem estável (nome, depois id) para duas exportações serem comparáveis. |
| `POST /api/contacts/import` | prévia (`mode:'preview'`) e gravação (`mode:'commit'`), com `existingMode` e `mapping` validados **no servidor**. A prévia **não escreve nada**; a gravação **recalcula o plano dentro da transação** (a base pode ter mudado entre conferir e confirmar). |
| `GET /api/contacts/export` | CSV da unidade, reimportável nos campos que a importação entende. Exportar dado pessoal fica **auditado** (`contact.exported`). |
| `GET /api/contacts/export-full` | **novo** — o histórico completo em JSON (cadastro, perfil, endereço, responsável, etiquetas, observações administrativas, agendamentos, leads, tarefas, conversas e mensagens). |
| `ImportClientsSheet` | as etapas do produto: **arquivo → prévia → mapeamento → validar → importar → resultado**, com o modo de quem já existe, o **relatório de erros** para baixar e o modelo da planilha. |
| Clientes (página) | botões **Importar**, **Exportar CSV** e **Exportar tudo (JSON)** no cabeçalho, ao lado de "Novo cliente". |
| `icons.tsx` | ícone `download`. |

### Decisões

- **A importação NUNCA sobrescreve.** O padrão é *Manter cadastros existentes*:
  quem já está na base sai do arquivo com a mensagem “Já existe — não será
  alterado.” — nome, telefone, e-mail, perfil e consentimento ficam exatamente
  como estavam. Quem quiser aproveitar o arquivo liga, de propósito,
  *Preencher somente dados que estiverem vazios*: o campo só recebe valor se
  **estiver vazio mesmo** (mesma regra para perfil, endereço, responsável e
  etiquetas). Não existe “sobrescrever tudo” nesta etapa — é o comportamento
  que perde dado sem aviso.
- **A identidade é a do CRM.** Telefone em dígitos, e-mail em minúsculas —
  **nunca o nome**. Duplicidade dentro do arquivo conta uma vez (a segunda linha
  vira “repetido”, apontando em qual linha o primeiro apareceu).
- **Cadastros diferentes não se misturam.** Telefone que pertence a um contato e
  e-mail que pertence a outro → **erro**, nunca fusão automática: “Telefone e
  e-mail pertencem a cadastros diferentes. Revise esta linha.” A mesma colisão
  **entre duas linhas do arquivo** também é erro (a tabela de identidade dos
  registros planejados considera todas as chaves).
- **Consentimento não se presume nem se desfaz.** A coluna de marketing só
  **liga** o opt-in quando o arquivo diz explicitamente “sim”; vazio não
  presume, e “não” nunca desliga o que já estava aceito.
- **CPF e data são conferidos de verdade.** O CPF passa por dígito verificador
  (`isValidCpf`) — 11 dígitos com DV errado é erro, não campo preenchido. A data
  de nascimento passa pelo calendário real: 31/02 é erro (29/02/1992 não é).
- **A observação do arquivo NÃO é descartada.** Ela é observação
  **administrativa**: quando o campo canônico está vazio, vai para lá; quando já
  havia uma, entra no **histórico** com autor e auditoria (`contact.note_added`,
  origem `importacao`) — nunca sobrepõe e nunca desaparece. Nada disso vira
  registro de atendimento.
- **Etiquetas ida e volta.** Tags/Etiquetas são reconhecidas, normalizadas
  (sem repetição, dentro dos limites do perfil) e sobrevivem ao ciclo
  exportar → importar — há teste para isso.
- **Coluna desconhecida continua desconhecida.** Aliases curtos (`numero`, `uf`,
  `rua`) casam só por igualdade: “Número da sorte” é reportada como não
  reconhecida em vez de virar o número do endereço. E o CSV exportado **diz o
  que é só saída**: `Origem`, `Criado em` e `Última interação` são reconhecidas
  e **deliberadamente ignoradas** na volta (reimportar não recria histórico) —
  o produto não promete “ida e volta completa” para o que não volta.
- **Célula não é código.** Todo valor que sai (CSV e relatório de erros) passa
  por `spreadsheetSafeCell`: aspas não bastam contra fórmula — uma célula que
  começa com `=`, `+`, `-` ou `@` é neutralizada, e a leitura desfaz a proteção
  para o dado voltar íntegro.
- **Mapeamento é do usuário, mas quem decide é o servidor.** A tela sugere o que
  detectou e, para o que não reconheceu, oferece um dropdown por coluna
  (Ignorar/Nome/Telefone/E-mail/CPF/Nascimento/CEP/Rua/Número/Complemento/
  Bairro/Cidade/UF/Tags/Observação/Marketing), recalculando a prévia. O
  servidor **valida** o mapeamento: índice que não existe no arquivo ou a mesma
  coluna apontando para dois campos devolve 400 com explicação.
- **Excel de verdade, sem dependência insegura.** `.xlsx` é aceito (primeira
  aba, mesmos limites, matriz montada no servidor) e entra no **mesmo
  planejador** do CSV; o parser `xlsx-lite.ts` é *server-only* e não vai para o
  bundle do navegador.
- **A saída completa é de quem responde pela unidade.** `export-full` exige
  OWNER/ADMIN/MASTER — a permissão genérica de Clientes **não** despeja a base.
  Cada seção é escrita campo a campo (nunca um objeto do banco): **não saem**
  senhas/hashes, sessões, chaves de API, segredos de webhook, tokens da Meta
  (`encryptedAccessToken`) nem dados de outra unidade, e o arquivo **declara**
  o que ficou de fora. Registro de atendimento é dado clínico: só vai para quem
  tem a permissão `atendimento`. Toda saída é auditada (ator, formato,
  quantidade, data).
- **Erro tem relatório.** Linhas que não entram podem ser baixadas em CSV
  (linha original, nome, telefone, e-mail, motivo) — também à prova de fórmula —
  para corrigir a planilha e tentar de novo.

### Testes

`src/lib/__tests__/a34-client-import.test.ts` (17 casos): separadores e
cabeçalhos, aspas e multilinha, normalização de data/sim-não, identidade (nunca
por nome), plano separando novo/complementa/repetido/erro, colunas
desconhecidas, modelo e exportação relidos pela importação — e, nas rotas reais
com banco temporário: prévia que **não grava**, commit que cria sem tocar em
quem já existe, `fill_empty` completando só o vazio, e **reimportação
idempotente**.

`src/lib/__tests__/a34-client-import-integrity.test.ts` (25 casos — a segunda
volta): SKIP padrão não altera nada, `fill_empty` não substitui campo
preenchido, consentimento (só “sim” liga, vazio não presume, existente não cai),
conflito telefone×e-mail entre cadastros e entre linhas, CPF com DV errado,
31/02, CPF do responsável, observação persistida (campo canônico e histórico com
autor), etiquetas ida e volta, `=HYPERLINK(...)`/`+cmd...`/`@foo` neutralizados,
mapeamento customizado e mapeamento inválido recusado, `.xlsx` real (ZIP
gerado no teste) importado pelas rotas, leitor de `.xlsx` recusando arquivo que
não é planilha, saída completa negada a quem não administra, negada entre
unidades, sem atendimento quando falta a permissão e **sem nenhum segredo** no
arquivo, CSV reimportável com as colunas de histórico declaradas — e o fluxo da
tela conferido no código-fonte (etapas, dropdowns, relatório de erros, botão da
saída completa).

```
npx vitest run src/lib/__tests__/a34-client-import-integrity.test.ts → 25 ok
npx vitest run src/lib/__tests__/a34-client-import.test.ts           → 17 ok
npx vitest run  → 85 arquivos · 1442 testes ok
npx tsc --noEmit → 0 erros
npm run build    → ok (Compiled successfully; /api/contacts/export-full criada)
```

---

## BLOCO 8 — ONBOARDING REAL DO WHATSAPP

### O diagnóstico

O que existia era um **botão que não conectava**: a clínica digitava o número,
o servidor respondia *“peça ao suporte Master”* (409) e alguém cadastrava token
na mão. E a tela misturava dois mundos diferentes no mesmo aviso — “faltando:
WHATSAPP_API_TOKEN…”, que é problema da **plataforma**, com “número não
informado”, que é problema da **unidade**. A clínica lia um erro que não era
dela; o suporte, um erro que não era dele.

Três coisas mais:

1. a versão da Graph API no código era **v21.0**, e a Meta já publicou v26.0 —
   ninguém era avisado quando a versão fixada saía de linha;
2. não havia como a unidade autorizar a **própria** conta: o fluxo oficial da
   Meta para isso (Embedded Signup) não estava implementado;
3. o “conectar” marcava **connected** antes de o webhook estar assinado — a
   unidade podia aparecer conectada sem receber nada.

### O que foi criado

| Onde | Mudança |
|---|---|
| `lib/whatsapp-onboarding.ts` | **novo, puro** (seguro para os dois lados) — o plano de onboarding em **duas camadas** (plataforma × unidade), item por item com “por que isso importa”, o semáforo da versão da Graph API com as datas de vigência publicadas pela Meta, a leitura tolerante da mensagem do popup (`WA_EMBEDDED_SIGNUP`, aceitando número ausente), as URLs da troca de código e o link `wa.me` marcado como **teste**. |
| `lib/whatsapp-onboarding-server.ts` | **novo, só no servidor** (`node:crypto`) — estado assinado do popup (anti-CSRF da troca do código, 30 min) e `appsecret_proof` (HMAC com o segredo do app). Fica separado porque o painel importa o módulo puro e `node:crypto` não pode entrar no bundle do navegador. |
| `GET /api/whatsapp/onboarding` | o plano das duas camadas + o estado assinado do popup. **Zero segredo**: só diz se cada variável existe. |
| `POST /api/whatsapp/onboarding` | `action:'exchange'` — o trabalho que a unidade não pode fazer sozinha, todo no servidor: **(1)** troca o código pelo token (`/oauth/access_token`, com o app secret), **(2)** descobre o que o popup não mandou (`debug_token` → `granular_scopes`; `/{WABA}/phone_numbers`), **(3)** **assina o webhook** na WABA (`/{WABA}/subscribed_apps`), **(4)** registra o número quando o PIN de duas etapas vem junto, **(5)** criptografa o token (AES-256-GCM) e grava na unidade, **(6)** audita. O token não volta em nenhuma resposta. |
| `WhatsappChannelPanel` | a tela de conexão foi reescrita: mostra as **duas camadas** (com quem resolve cada uma), abre o **popup oficial** (“Conectar com a Meta”), aceita o PIN de duas etapas, e põe o `wa.me` no lugar certo — **teste**, com aviso explícito de que por ali nada entra no sistema. O técnico continua num “Diagnóstico” recolhido. |
| `lib/whatsapp-cloud-api.ts` | versão padrão da Graph API: **v21.0 → v26.0** (última conferida na doc, liberada em **29/07/2026**); `META_GRAPH_VERSION` continua mandando. |
| `/api/master/units/[id]/whatsapp` | marca a conexão com **origem `master`** (o painel mostra por onde a conta entrou). |
| `AuditAction` + atividade do Master | ações próprias: `whatsapp.connected`, `whatsapp.disconnected`, `whatsapp.onboarding_blocked`, `whatsapp.onboarding_failed` — com rótulos legíveis no console. |
| `docs/WHATSAPP-FIRST-CLIENT.md` | o passo a passo agora começa pelo caminho normal (popup, uma vez configurado o app) e deixa o cadastro pelo Master como **caminho assistido**. |

### Decisões

- **Bloqueio de plataforma não é pendência da unidade.** Sem `META_APP_ID`,
  `META_CONFIG_ID`, `META_APP_SECRET`, `WHATSAPP_CREDENTIALS_KEY` e
  `WHATSAPP_VERIFY_TOKEN`, a resposta da troca é **503 com
  `code:'platform_not_configured'` e `external:'BLOCKED_EXTERNAL'`**, o plano
  mostra a camada “Plataforma (equipe do Instalink)” e **nada é gravado** — nem
  token, nem número, nem status. Nada de “conectado” de mentira, e a clínica
  não é culpada por um erro de instalação.
- **O código do popup é de uso único e vive 30 segundos.** Por isso a troca é
  imediata, sem retry, e uma falha da Meta diz **“recomece a conexão”** em vez
  de tentar de novo com um código morto.
- **Só fica conectado quem pode receber.** A assinatura do webhook é conferida
  **antes** de marcar `connected`: se a Meta recusar, o token é guardado (ele é
  válido) mas a unidade fica **pendente** com o motivo escrito. O `connected`
  deixou de ser otimista.
- **O token não passa pelo navegador.** A troca usa o segredo do app (que nunca
  sai do servidor), o estado do popup é assinado (HMAC) e nenhuma resposta da
  API contém token, segredo ou PIN.
- **`appsecret_proof` em todas as chamadas com token.** A própria Meta
  recomenda: um token vazado deixa de ser suficiente sozinho. (O outbox de envio
  segue como estava — mexer nele é fora do escopo deste bloco.)
- **PIN de duas etapas não é guardado.** Ele passa pelo servidor só para
  registrar o número e não é persistido; sem PIN, o registro fica para quando
  alguém tiver o número nas mãos.
- **`wa.me` é teste, e agora diz isso.** O link externo continua ali para não
  travar o atendimento, com o aviso de que por esse caminho a mensagem **não
  entra nem sai pelo sistema** (sem histórico, sem automação, sem CRM).
- **A versão da Graph API tem prazo de validade — e a tela avisa.** A tabela
  conferida na doc oficial: v20.0 até 24/09/2026, v21.0 até 21/01/2027, v22.0
  até 20/05/2027, v25.0 liberada em 18/02/2026, v26.0 em **29/07/2026** (padrão
  novo). Se `META_GRAPH_VERSION` apontar para versão vencida, o painel mostra o
  aviso em vez de deixar a integração quebrar sozinha.

### O que NÃO foi possível provar aqui (`BLOCKED_EXTERNAL`)

A troca de código exige um **app da Meta de verdade** (App ID, App Secret,
Config ID do Login for Business e o domínio do painel entre os permitidos) — e
este ambiente **não tem essas credenciais**. Portanto:

- o **popup real não foi aberto contra a Meta** nesta entrega;
- o que foi provado: o fluxo completo da rota, ponta a ponta, com a Graph API
  **simulada** (respostas reais de formato), criptografia AES-256-GCM de
  verdade, gravação de verdade no banco, auditoria de verdade e as recusas
  certas (503 sem plataforma, 400 sem estado válido, 400 com código recusado,
  400 com webhook recusado);
- quando as credenciais existirem, falta só: (1) preencher as cinco variáveis,
  (2) liberar o domínio do painel em **Allowed domains**/**Valid OAuth redirect
  URIs** do app, (3) clicar em “Conectar com a Meta” e conferir a chegada do
  primeiro webhook.

### Testes

`src/lib/__tests__/a34-whatsapp-onboarding.test.ts` (20 casos): camada da
plataforma listando exatamente o que falta (sem expor valor), plano
`BLOCKED_EXTERNAL` quando não há app, plano pronto entregando só config pública,
“conectado mas sem evento”, camada da unidade cobrando número/WABA/token,
semáforo de versão (v20 vencida, v26 atual, v30 desconhecida — e a versão padrão
do cliente **batendo** com a última conferida), estado assinado (expirado, outra
chave, adulterado), mensagem do popup sem número e `wa.me` rotulado como teste,
`appsecret_proof` — e, contra as rotas reais com a **Meta simulada**: 503 sem
plataforma **sem gravar nada**, troca completa (token cifrado, `source`,
`appsecret_proof` na assinatura, `display_phone_number` da Meta, auditoria),
descoberta de WABA/número pelo servidor, código recusado sem gravar token,
estado inválido sem tocar na rede, webhook recusado deixando **pendente**, PIN
de 6 dígitos registrando o número (e PIN torto recusado) e isolamento entre
unidades. Mais a prova no código-fonte do painel (popup, origem da mensagem,
troca no servidor, duas camadas, aviso do teste).

```
npx vitest run src/lib/__tests__/a34-whatsapp-onboarding.test.ts → 20 ok
npx vitest run  → 86 arquivos · 1462 testes ok
npx tsc --noEmit → 0 erros
npm run build    → ok (Compiled successfully; /api/whatsapp/onboarding criada)
```

---

## RODADA 5 — FECHAMENTO DOS BLOCOS 7 E 8 (antes do Instagram)

Revisão independente apontou duas famílias de problema: a importação/exportação
podia **mentir sobre o tamanho** do que leu/escreveu, e o onboarding do WhatsApp
podia dizer **“conectado”** quando ainda faltava a etapa obrigatória (registrar
o número). Nada disso veio de reclamação de usuário: veio de leitura do código.
Os 11 itens foram tratados aqui, no **mesmo PR #30**, sem tocar em Instagram.

### 7.1 — Importação: um limite só, e ele nunca trunca em silêncio

| Antes | Agora |
|---|---|
| o arquivo era lido e as linhas excedentes **desapareciam** sem aviso | `IMPORT_MAX_ROWS = 5_000` é o **único** limite, para CSV e .xlsx, prévia e gravação |
| mensagem genérica | **“Esta planilha tem 6.320 linhas. O limite por importação é 5.000. Divida o arquivo em partes.”** — com o número **real** do arquivo (no .xlsx, contado no XML, não no que coube na memória) |
| — | resposta `400 { code:'row_limit_exceeded', totalRows, limit }` e **zero escrita** (nem contato, nem auditoria) |
| a prévia não dizia quantas linhas leu | a prévia devolve `rowsRead` e `limit`, e a tela mostra **“N linhas lidas (limite N por importação)”** |

O mesmo vale para a planilha: o leitor conta as linhas do `sheetData` e o teto de
leitura do .xlsx passou a ser derivado do limite do produto (`XLSX_MAX_PARSED_ROWS
= IMPORT_MAX_ROWS + 1`) — não existe mais um número solto no leitor.

### 7.2 — Saída completa: paginada, e cada arquivo DIZ se está completo

A saída JSON da base era cortada em 5.000 contatos: quem levava o arquivo não
tinha como saber que faltava gente. Agora a rota pagina de verdade:

- `partSize` (1..5.000, padrão 1.000) e `cursor` (offset explícito); `cursor`
  inválido → `400 invalid_cursor`; `partSize` fora da faixa → `400 invalid_part_size`;
- cada arquivo traz `complete` (booleano) + `pagination`
  (`part`, `partSize`, `cursor`, `totalContacts`, `exportedContacts`,
  `exportedFrom`, `exportedTo`, `hasMore`, `nextCursor`);
- o nome do arquivo diz a parte: `base-completa-<slug>-<data>-parte-2-de-3.json`
  (arquivo único continua sem sufixo);
- **só o arquivo único é `complete: true`** — uma parte nunca se apresenta como
  “a base inteira”;
- a tela (**Clientes → Exportar tudo (JSON)**) baixa **todas** as partes,
  seguindo `nextCursor`, e recusa-se a salvar resposta sem `complete`/`pagination`
  (“nenhum arquivo parcial foi salvo como se fosse a base inteira”), com aviso
  verde de conclusão (`Base completa: N contato(s) em M arquivo(s)`).

### 7.3 — .xlsx contra ZIP bomb (fail-closed)

O leitor próprio (`lib/xlsx-lite.ts`, sem dependência — o pacote `xlsx` do npm
está descartado por CVE) ganhou tetos explícitos e mensagem única:

| Teto | Valor | O que recusa |
|---|---|---|
| arquivo comprimido | 4 MB | planilha grande demais (antes de abrir) |
| entradas no ZIP | 200 | diretório inchado / contador mentiroso |
| descompressão por entrada | 8 MB | `maxOutputLength` do `inflate` + conferência do declarado |
| soma do XML descomprimido | 24 MB | várias entradas “médias” somando bomba |
| linhas lidas | `IMPORT_MAX_ROWS + 1` | teto do produto (quem recusa é a regra de negócio) |

Tudo com `throw new Error('Planilha compactada excede o limite seguro.')`,
offsets/índices conferidos contra o arquivo e **nenhuma leitura** quando o
arquivo mente sobre o próprio tamanho. De quebra, serial de data fora do
calendário (0, negativo, ano de 6 dígitos) deixou de virar “data” inventada.

### 7.4 — “Ignorar” no mapeamento é decisão de verdade

O mapeamento agora é **campo → coluna OU campo → `ignore`**, validado no
servidor (`A coluna 9 de "Telefone" não existe no arquivo.`, campo desconhecido,
coluna usada em dois campos). `phone:'ignore'` **vence a autodetecção**: a
coluna “Telefone” reconhecida pelo cabeçalho não entra no plano nem no cadastro
(`row.phone` vazio), e a tela mostra “Ignoradas por você: Telefone — nada dessas
colunas será importado”. Cada coluna tem seu dropdown (todas elas, não só as
reconhecidas), então a autodetecção errada é corrigível na própria tela.

### 8 — WhatsApp: “conectado” só depois de registrar o número

Estados que faltavam ser distinguidos (e agora são, na lib e no painel):

```
autorizado → webhook assinado → número resolvido → REGISTRADO → conectado → 1ª mensagem
```

- **Registro é etapa obrigatória.** Sem `POST /{PHONE_NUMBER_ID}/register`
  confirmado, a unidade fica `pending` com
  `reason:'phone_registration_required'`, `registrationRequired:true`,
  `registeredAt` vazio, auditoria `whatsapp.registration_pending` (nunca
  `whatsapp.connected`) — e o token é guardado para a unidade concluir depois
  pelo painel, com o PIN de duas etapas na mão. Sem PIN, **não há tentativa**.
- **Registro recusado pela Meta** (PIN errado) → continua `pending`, com o
  motivo escrito em `lastError` (“Registro do número: …”).
- **O servidor é a autoridade**, não o navegador. Depois do `code`, sempre:
  `debug_token` (válido? **do nosso app**? tem `whatsapp_business_management` e
  `whatsapp_business_messaging`?) → WABA **autorizada de fato** (por
  `granular_scopes.target_ids`) → `GET /{WABA}/phone_numbers` → o número tem de
  **pertencer àquela WABA** (se o popup não manda número, o servidor escolhe um
  da lista) → `subscribed_apps` → registro. Qualquer inconsistência é `400` e
  **nada é gravado**.
- **Coexistence só quando a Meta diz.** `onboardingType` é derivado do evento do
  popup (`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` ⇒ `coexistence`), nunca
  presumido.
- **Estado do popup ligado à unidade E ao usuário**: `HMAC(businessId.userId.
  timestamp.nonce)` — state de outra unidade, de outro usuário, expirado ou
  adulterado é `400 signup_state_invalid` **antes de qualquer chamada à Meta**.
- **Data da Graph API corrigida**: v26.0 foi liberada em **29/07/2026** (a doc do
  produto dizia 21/07, que é data de SDK/beta, não do card de release). A tabela
  segue com v20 até 24/09/2026, v21 até 21/01/2027, v22 até 20/05/2027 — e o
  painel avisa quando `META_GRAPH_VERSION` aponta para versão vencida.
- **Painel honesto**: seis estados visíveis (Conta autorizada · Número
  encontrado · Webhook assinado · **Registro pendente** · Aguardando 1ª mensagem ·
  Conectado), com a lista de etapas (✓ feita / → agora / • falta) e o campo de
  PIN aparecendo só quando é a etapa da vez. “WhatsApp conectado” nunca aparece
  com etapa obrigatória faltando. O `wa.me` continua com o aviso de que é
  **teste humano** — por ali nada entra nem sai pelo sistema.

### Testes desta rodada

| Suíte | Casos | O que prova |
|---|---|---|
| `a34-client-import-limits.test.ts` | **18** | 6.320 linhas em CSV e em .xlsx ⇒ mesmo `row_limit_exceeded` com o número real e **zero escrita**; prévia obedece ao limite; 5.000 passa; `ignore` derruba a autodetecção (inclusive no commit); mapeamento inválido recusado no servidor; 2.500 contatos em 3 partes numeradas sem repetir nem pular ninguém; `cursor`/`partSize` inválidos; a tela seguindo `nextCursor` e recusando arquivo sem `complete` |
| `a34-xlsx-lite.test.ts` | **22** | ZIP bomb (9 MB compactado a poucos KB) barrado por entrada e por soma; declaração absurda, contador mentiroso, offset inválido, método desconhecido, entradas demais, arquivo > 4 MB; **planilha grande porém legítima continua abrindo**; datas absurdas não viram data |
| `a34-whatsapp-onboarding.test.ts` | **32** (+12) | state ligado a unidade/usuário (troca cruzada ⇒ 400 sem tocar na rede); token inválido, de outro app, sem permissão; WABA não autorizada; número fora da WABA (nem assina o webhook); sem PIN ⇒ `pending` + auditoria de pendência; `register` com token guardado ⇒ `connected`; registro recusado ⇒ `pending` com motivo; webhook recusado ⇒ sem registro |
| `a34-client-import-integrity.test.ts` | **25** | (ajustado) a tela de mapeamento agora é provada pelos elementos reais — todas as colunas, “Ignorar”, `ignoredColumns` e “linhas lidas (limite …)” |

```
npx vitest run   → 88 arquivos · 1.514 testes ok
npx tsc --noEmit → 0 erros
npm run build    → ok
```

### O que continua dependendo da Meta (`BLOCKED_EXTERNAL`)

Sem app da Meta (App ID, App Secret, Config ID, domínio liberado) e sem um
número real de teste, **não foi possível** — e nada aqui finge o contrário:

- abrir o popup real e trocar um `code` de verdade (`/oauth/access_token`);
- assinar o webhook numa WABA real e ver a primeira mensagem chegar;
- registrar de verdade um número com PIN de duas etapas.

O que está provado é o desenho inteiro contra a Graph API **simulada** (com o
formato real das respostas), incluindo criptografia AES-256-GCM de verdade,
gravação de verdade e as recusas honestas. Falta só credencial — e o painel diz
exatamente isso (camada “Plataforma (equipe do Instalink)” com a lista do que
falta, sem nunca mostrar valor de segredo).

---

## BLOCO 9 — INSTAGRAM DIRECT NO INBOX UNIFICADO

Commit deste bloco: **`A3.4 B9 — Instagram Direct no inbox unificado`**, 15º do
PR #30 (hash exato no comentário de entrega; o relatório final do Bloco 11 lista
os HEADs).
O Instagram não ganhou um inbox paralelo: ele virou **um canal da caixa
Conversas que já existia**. WhatsApp e Instagram desembocam nas MESMAS entidades
— `Conversation`, `Message`, `Contact`, `Lead`, automações — e o que muda é a
identidade do participante e o conector que entrega a mensagem.

### 0. Reconhecimento antes de alterar (o que já existia × o que foi adicionado)

| Peça | Situação antes do B9 | Decisão |
|---|---|---|
| `Conversation` / `Message` | já tinham `channel`, `channelUserId`, `channelAccountId?` (WhatsApp) | **reutilizados** — Instagram é só mais um valor de `channel` |
| `ConversationChannel` | `'whatsapp' \| 'agent'` | **aditivo**: `'instagram'` (nenhum valor removido/renomeado) |
| `Integration` (genérica) | credencial em `Integration` com `tokenHash`/`config` | **NÃO usada** para IG: mensagens exigem token do dono da conta; a credencial vive no `Business` (mesmo desenho do `WhatsappIntegration`) |
| `BusinessCustomer` | dedupe por customerId → telefone → e-mail → nome | ganhou `channelIdentities` (aditivo) e o dedupe por nome **parou de valer** para contato com identidade de canal |
| `ingestLead` (pipeline) | exige nome OU telefone OU e-mail; já aceitava `instagram`/`source`/`origin` | **reutilizado como motor oficial** — sem inventar telefone para quem não tem |
| `send_channel_message` (P4) | phone-centric, criava conversa `channel:'whatsapp'` | ganhou o campo `channel` (padrão `whatsapp`); **nó novo NÃO existe** |
| `ChannelConnector` (P6) | conector por provedor, `registerChannelConnector` | **reutilizado** — `instagramChannelConnector` registrado com `available: true` |
| state HMAC do onboarding | `issueSignupState`/`verifySignupState` (formato B8: businessId+userId+timestamp+nonce+HMAC) | **reutilizado com segredo derivado do canal** (`HMAC(appSecret,'instagram-onboarding-state')`) |
| AES-256-GCM das credenciais | `encryptSecret`/`decryptSecret` + `WHATSAPP_CREDENTIALS_KEY` | **reutilizado** (nenhum cofre novo, nada em localStorage) |
| webhook WhatsApp | modelo de assinatura, tenant, dedupe e auditoria | **copiado no desenho**, endpoint próprio para o Instagram |

Campos **adicionados** (todos opcionais, nada migrado): `Business.instagramIntegration`
(`status`, `igUserId`, `username`, `displayName`, `encryptedAccessToken`,
`keyFingerprint`, `authorizedAt`, `webhookSubscribedAt`, `tokenIssuedAt`,
`tokenExpiresAt`, `connectedAt`, `lastWebhookAt`, `lastInboundAt`,
`lastOutboundAt`, `requestedAt`, `lastError`, `source`),
`Conversation.channelAccountId/channelUsername`, `BusinessCustomer.channelIdentities[]`
(`provider`, `accountId`, `participantId`, `username`, `displayName`),
`Message.channel/channelUserId` (já existiam) e as ações de auditoria
`instagram.*`.

### 1. Fonte oficial (conferida em 19/09/2026)

Nada aqui veio de tutorial antigo, API não oficial ou sessão de navegador
automatizada. Fontes: `developers.facebook.com/docs/instagram-platform`
(Instagram API with Instagram Login, Business Login, Messaging API, Webhooks e
Webhooks Examples) — páginas revisadas pela Meta em 16/09/2026 (webhooks) e
13/03/2026 (business login) — e `developers.facebook.com/docs/graph-api`.

Escolha: **Instagram API with Instagram Login** (`graph.instagram.com`), que não
exige Página do Facebook; escopos `instagram_business_basic` +
`instagram_business_manage_messages`; token long-lived de **60 dias** renovável
(`ig_exchange_token`/`ig_refresh_token`). O caminho antigo via Página
(`instagram_manage_messages`) ficou de fora por exigir um vínculo que a maioria
das unidades não tem. Graph API: **v26.0**, liberada em 29/07/2026; o host
`graph.instagram.com` aceita a mesma versão.

- autorização: `https://www.instagram.com/oauth/authorize` (App ID do Instagram,
  `redirect_uri` cadastrada, `state`);
- troca do `code` (uso único, ~1 h): `POST https://api.instagram.com/oauth/access_token`;
- long-lived: `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token`;
  renovação: `.../refresh_access_token?grant_type=ig_refresh_token`;
- perfil público do participante: `GET https://graph.instagram.com/{ver}/{igsid}?fields=name,username,profile_pic`
  (neste caminho o campo é `profile_pic`, **não** `profile_picture_url`);
- assinatura: `POST https://graph.instagram.com/{ver}/{ig-user-id}/subscribed_apps?subscribed_fields=messages`;
- envio: `POST https://graph.instagram.com/{ver}/{ig-user-id}/messages` com
  `{recipient:{id}, message:{text}}` → `message_id` (texto ≤ 1000 bytes UTF-8);
- política: resposta livre só por **24 h** desde a última mensagem da pessoa;
  fora disso a Meta oferece a tag `HUMAN_AGENT` (até 7 dias, uso humano). Sem
  cold DM.

### 2. Como o canal funciona

```
webhook (object:"instagram") → assinatura → CONTA conectada (tenant)
   → Conversation (channel:'instagram' + IGSID) → Message (inbound)
   → Contact/Lead (ingestLead quando cabe) → automações

composer do inbox / automação → Conversation → Message (pending)
   → connector oficial → POST /{ig-user-id}/messages → message_id → sent
```

- **Identidade nunca é nome, @ ou telefone**: a chave é
  `businessId + channel + igUserId (conta) + IGSID (participante)`. `username` e
  `displayName` são rótulos — e o dedupe por nome foi explicitamente **desligado**
  para contato com identidade de canal (duas “Ana Souza” continuam duas pessoas).
- **Pessoa mínima sem inventar cadastro**: a primeira mensagem cria o contato com
  `channelIdentities` e **telefone/e-mail vazios**. O lead só nasce quando há
  rótulo público (nome/@) para o motor `ingestLead` aceitar — sem isso, a conversa
  existe e fica esperando vínculo (nada de “identidade fantasma”).
- **Mídia não quebra o webhook**: imagem/áudio/etc. entram como
  “Imagem recebida”/“Áudio recebida” + metadado do tipo; conteúdo não suportado é
  rotulado como tal. Echo das nossas mensagens, apagadas e self são ignorados.
- **Idempotência**: dedupe por `mid` **conferido dentro da transação**, além do
  índice por `externalId`; reentrega da Meta não cria segunda `Message`, segundo
  `Lead` nem roda automação duas vezes.
- **Envio provado**: `2xx` sem `message_id` **não** é sucesso (erro explícito e
  não-retryable); erro da Meta é sanitizado (sem token) e legível.
- **Fora da política, a tela não mente**: fora da janela o compositor é trocado
  por um aviso com o motivo; a API responde `409 outside_window` (e
  `409 not_connected` quando a conta ainda não está pronta).
- **Multi-tenant**: o webhook roteia pela CONTA (`igUserId`) da unidade; conta não
  conectada é ignorada (`unmappedAccounts`) sem criar nada; o mesmo IGSID em duas
  contas são duas pessoas (a chave inclui a conta).

### 3. Endpoints

| Rota | Método | O que faz |
|---|---|---|
| `/api/instagram/onboarding` | GET | plano em camadas + `authorizeUrl` + `state` + estado do inbox; nunca devolve segredo |
| `/api/instagram/onboarding` | POST | `disconnect` / `retry_subscribe` / `refresh` (auditados) |
| `/api/instagram/onboarding/callback` | GET | troca o `code` (com o `redirect_uri` idêntico), criptografa o token, assina o webhook e volta para `/canais?instagram=ok\|pending\|denied\|error&detalhe=…` |
| `/api/instagram/webhook` | GET/POST | handshake + eventos `object:"instagram"` (HMAC fail-closed) |
| `/api/cron/instagram` | GET/POST | reentrega de mensagens pendentes (mesmo padrão do cron do WhatsApp) |
| `/api/conversations` | GET/POST | canal por conversa: filtro `?channel=`, contadores `channels.*`, envio pelo canal DA conversa |

### 4. Onboarding em camadas e estados honestos

O painel (Canais & Integrações → Canais → Instagram) mostra duas camadas, como no
WhatsApp: **Plataforma (equipe do Instalink)** — app, segredo, cofre, URL de
retorno e webhook cadastrados — e **Unidade** — autorizar a conta, assinar o
webhook, receber a 1ª mensagem. Estados possíveis:

```
not_connected → authorization_pending → webhook_pending
              → waiting_first_event → connected        (erro = error)
```

`connected` **só** aparece quando o webhook está assinado **e** já chegou um
evento real: OAuth concluído não é conexão. Quando a plataforma não está
configurada, o plano é `platform_blocked` + `BLOCKED_EXTERNAL` com a lista do que
falta (nomes de variável, nunca valores). O `state` segue o modelo do B8
(`businessId + userId + timestamp + nonce + HMAC`), com segredo derivado do canal
— state de outra unidade, de outro usuário, expirado ou do WhatsApp não é aceito.

### 5. Automações

`send_channel_message` ganhou **o campo** `channel` (`whatsapp` padrão ·
`instagram`). Não existe nó `send_instagram_message`. No caminho Instagram a
identidade vem do **vínculo oficial do contato** (`channelIdentities`) ou de um
IGSID explícito; sem integração pronta, sem vínculo ou fora da janela a ação
falha com erro legível e **nada é enfileirado**.

### 6. Testes deste bloco

| Suíte | Casos | O que prova |
|---|---|---|
| `a34-instagram.test.ts` | **56** | CATALOG (conectável, sem “em breve”, sem nó novo); IDENTIDADE (echo/apagada/suporte/mídia, corte de 1000 bytes, chave conta+IGSID); WEBHOOK (handshake, 503 sem segredo, 403 assinatura, tenant por conta, duplicata, conta órfã, isolamento A/B); CRM (contato sem telefone, lead `origin/channel=instagram`, nada duplicado, nomes iguais não fundem, mesmo IGSID em contas diferentes não cruza); OUTBOUND (2xx sem id ≠ sucesso, host oficial, perfil oficial, `subscribed_apps`, janela 24h/HUMAN_AGENT, credencial criptografada); AUTOMAÇÃO (desconectado, sem vínculo, janela, envio real, WhatsApp intacto); ONBOARDING (BLOCKED_EXTERNAL, 4 estados, state ligado a unidade/usuário, separado do WhatsApp, callback ok/pendente/negado, cron fail-closed); UX (filtro por canal, badge, compositor por canal, painel em camadas) |

```
npx vitest run src/lib/__tests__/a34-instagram.test.ts → 56 ok
npx vitest run  → 89 arquivos · 1.570 testes ok
npx tsc --noEmit → 0 erros
npm run build    → ok (/api/instagram/onboarding[/callback], /api/instagram/webhook e /api/cron/instagram compiladas)
```

### 7. O que está implementado × o que depende da Meta

**IMPLEMENTADO (verificado por teste):** canal Instagram aditivo no inbox
unificado; catálogo com `canConnect:true` e conector registrado; onboarding em
camadas com state anti-CSRF e token AES-256-GCM por unidade; webhook oficial com
assinatura HMAC e fail-closed; roteamento por conta conectada; inbound ponta a
ponta (texto, mídia rotulada, duplicata idempotente); contato sem telefone
inventado + lead `origin/channel=instagram` pelo motor oficial; outbound no mesmo
inbox com `message_id` obrigatório; automação por `send_channel_message
channel=instagram`; filtro/badge/compositor por canal; multi-tenant por conta.

**MOCK META:** as chamadas ao Graph API são feitas contra um stub com o **formato
oficial** das respostas (auth, `subscribed_apps`, `messages`, perfil) — a rede
real não foi tocada por falta de credencial.

**META REAL:** nada foi executado contra o Instagram real (nenhuma conta
profissional, nenhum app aprovado).

**BLOCKED_EXTERNAL (o que falta para o fim a fim real):**

- `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` (ou um `META_APP_SECRET`
  compartilhado), `INSTAGRAM_VERIFY_TOKEN` e a chave do cofre
  `WHATSAPP_CREDENTIALS_KEY` no ambiente;
- app da Meta com o produto Instagram configurado, **App Review** para
  `instagram_business_basic` + `instagram_business_manage_messages`;
- **conta profissional** do Instagram para conectar (o fluxo não funciona com
  conta pessoal);
- URL de retorno (`/api/instagram/onboarding/callback`) e webhook
  (`/api/instagram/webhook`) cadastrados no app, com o domínio de produção
  liberado;
- `CRON_SECRET` para a reentrega de pendências.

Até isso existir, a tela diz exatamente o que falta — e não promete Messenger,
comentários, Direct de conta pessoal nem qualquer coisa fora do escopo do bloco.

### 8. Preview

`https://instalink-git-arena-01a0ba19-ff4fd6-hernanicross-3509s-projects.vercel.app`
— branch `arena/01a0ba19-instalink` (o alias aponta para o commit mais novo).
Caminho de verificação: **Canais & Integrações → Canais → Instagram** (estado e
camadas) e **Conversas** (chips Todos / WhatsApp / Instagram, badge por conversa e
compositor do canal).

---

## BLOCO 9 — CORREÇÃO ANTES DOS GATES FINAIS (janela por participante, tempo do webhook e isolamento de conta)

Revisão independente do B9 confirmou a arquitetura (Instagram como canal do inbox
unificado) e apontou **9 blockers de política/isolamento** + atualização de testes.
Todos foram tratados aqui, **no mesmo PR #30**, sem tocar em WhatsApp, agenda,
importação ou qualquer motor existente (Blocos 10/11 continuam NÃO iniciados).

### 1. A janela do Instagram é do PARTICIPANTE, não da unidade

Antes, o envio olhava `business.instagramIntegration.lastInboundAt` — uma
mensagem do cliente A abria a janela para o cliente B. Agora:

- `Conversation.lastInboundAt` (aditivo) guarda a última mensagem RECEBIDA
  **desta conversa**; cada entrada faz `max(campo, horário real da mensagem)` —
  webhook atrasado/fora de ordem **nunca retrocede** a janela;
- helper canônico `instagramConversationLastInboundAt(db, conversation)`: se o
  campo existe, ele manda; se a conversa é antiga (sem o campo), deriva da
  mensagem de entrada mais recente **daquela** conversa (nunca da unidade);
- **a mesma fonte** alimenta: `GET /api/conversations` (estado do compositor),
  `POST /api/conversations` (envio manual), `send_channel_message` do Instagram,
  o **conector** do P6, `deliverInstagramMessage` e os retries do cron;
- **revalidação no momento do envio**: a política é conferida de novo na hora de
  sair — mensagem enfileirada às 10:59 não sai no retry das 11:03 se a janela
  fechou (o retry marca `failed` com o motivo, sem chamar a Meta);
- `InstagramIntegration.lastInboundAt` continua existindo como **telemetria
  global da unidade** (só avança), explicitamente **sem autorizar envio**.

Provas: A escreveu agora / B há 2 dias → A pode, B não (fase `human_agent`);
mensagem de outro participante não renova a conversa de B; retry pós-fechamento
não sai (`messagesSent: 0`, zero chamadas ao Graph).

### 2. Timestamp do webhook: segundos OU milissegundos

`instagramEventTimestamp(value)` substitui o antigo `ts * 1000` cego:

```
valor >= 1e12  → já está em MILISSEGUNDOS
valor <  1e12  → está em SEGUNDOS
```

Faixa confiável: a partir de 2010 e no máximo 5 min à frente do relógio local.
Valor inválido/absurdo **não** é usado: a mensagem grava `receivedAt` (instante
de recebimento) e a janela NÃO é aberta no futuro. `1_758_000_000` e
`1_758_000_000_000` produzem exatamente `2025-09-16T05:20:00.000Z`; um valor de
16 dígitos cai no recebimento.

### 3. Instagram NÃO inicia DM por IGSID arbitrário

A automação não aceita mais um `to` “que parece IGSID”. O vínculo do contato
(`channelIdentities`) **localiza** a pessoa, mas a prova é uma **conversa real
desta conta com ela, com mensagem de ENTRADA**. Sem isso: zero conversa criada,
zero mensagem, zero chamada à Meta e o erro
**“Este usuário ainda não iniciou uma conversa com a conta do Instagram.”**
O conector oficial segue a mesma regra.

### 4. Trocar de conta não envia pela conta nova

`instagramAccountMismatch(business, conversation)` compara
`conv.channelAccountId` com `business.instagramIntegration.igUserId`. Se
diferente: código estável **`channel_account_mismatch`** e a mensagem
“Esta conversa pertence a uma conta do Instagram conectada anteriormente.” — na
rota (`409`), na entrega (mensagem vira `failed`, sem chamada à Meta) e no
conector. O histórico antigo **continua visível** (lista e detalhe trazem
`accountMismatch`/`accountMismatchMessage`) e a tela troca o compositor por esse
aviso.

### 5. Uma conta do Instagram pertence a UMA unidade

- `applyInstagramAuthorization` recusa gravar um `igUserId` que já é de outra
  unidade (nada é persistido) com auditoria
  `instagram.onboarding_failed` / `reason: account_already_linked`; o callback
  volta para o painel com “Esta conta do Instagram já está conectada a outra
  unidade.”;
- `resolveBusinessForInstagramAccountId` **fail-closed**: com mais de uma
  unidade dona da mesma conta devolve `undefined` (função nova
  `instagramAccountOwners` expõe o caso); o webhook ambíguo responde 200 com
  `created: 0` e **não grava** Message/Lead/Contact em nenhuma unidade.

### 6. Texto enviado = texto salvo (nunca cortar em silêncio)

Nada de `clip` no envio: `instagramTextBytes`/`instagramTextFits` medem o limite
oficial (1000 bytes UTF-8) e quem excede é **recusado antes de existir
mensagem** — rota (`400 message_too_long` com bytes e limite), automação (erro
explícito) e `sendInstagramMessage` (fail-closed, inclusive chamado direto).
No limite exato (250 emoji de 4 bytes) passa, e o corpo salvo é **exatamente** o
enviado. A tela mostra um contador discreto a partir de 800 bytes.

### 7. Diagnóstico e servidor decidem igual (fallbacks)

A leitura do ambiente virou fonte única (`instagramEnvAppId/AppSecret/VerifyToken/VaultKey`),
usada pelo painel E pelo servidor:

| Variável | Aceita |
|---|---|
| App Secret | `INSTAGRAM_APP_SECRET` **ou** `META_APP_SECRET` |
| Verify token | `INSTAGRAM_VERIFY_TOKEN` **ou** `WHATSAPP_VERIFY_TOKEN` |

Sem combinações artificiais: `META_APP_SECRET` + `WHATSAPP_VERIFY_TOKEN` deixam
a plataforma **pronta** no painel e no servidor; sem nenhuma, os dois apontam a
mesma lista de nomes faltantes.

### 8. Ciclo de vida da credencial (cron)

O cron do Instagram agora faz **manutenção preventiva** além do retry:

- renova tokens a **7 dias** do vencimento (`INSTAGRAM_TOKEN_REFRESH_MARGIN_MS`) —
  token válido é pré-requisito da renovação oficial e a folga cobre falha de rede
  sem renovar em toda execução;
- chamada à Meta **fora de transação**, unidade por unidade (nunca cruza tenants);
- gravação **CAS**: se a credencial mudou no meio (reconexão), o trabalho de
  ninguém é sobrescrito;
- sucesso → token novo criptografado (AES-256-GCM), `tokenIssuedAt`/
  `tokenExpiresAt` atualizados, auditoria `instagram.token_refreshed`;
- falha → **o token atual NÃO é apagado**; `lastError` explicado e auditoria
  `instagram.token_refresh_failed`.

O painel mostra a data de emissão/vencimento (nunca o token) para o estado da
manutenção ser visível.

### 9. Conversa fechada + mensagem nova = nova demanda

Mensagem real de Instagram em conversa `closed` **reabre** a conversa:
`status = 'open'`, `unread` incrementado, **mesmo `Conversation.id`** e histórico
inteiro preservado.

### 10. Testes desta correção

| Grupo | Casos | O que prova |
|---|---|---|
| TEMPO DO EVENTO | 7 | segundos/milissegundos dão a MESMA data; inválido/zero/negativo/antigo/16 dígitos ⇒ não confiável, cai no recebimento; `Message.at` correto no webhook de 13 dígitos; atrasado não retrocede |
| JANELA POR CONVERSA | 4 | A pode / B não; mensagem de outro participante não renova; conversa legada deriva da mensagem; retry pós-fechamento não sai (0 chamadas à Meta) |
| ISOLAMENTO DE CONTA | 6 | conversa da conta antiga não envia (409 `channel_account_mismatch`, entrega `failed`, conector explica); histórico segue legível; conta duplicada recusada com auditoria; webhook ambíguo não grava; dono único resolve |
| LIMITE DE TEXTO | 3 | emoji acima do limite ⇒ 400 e nada salvo; no limite exato passa e o corpo é idêntico; `sendInstagramMessage` fail-closed direto |
| AMBIENTE | 2 | fallbacks `META_APP_SECRET`/`WHATSAPP_VERIFY_TOKEN` bastam; sem nada, painel e servidor listam os MESMOS nomes |
| CREDENCIAL | 3 | só renova quem está na margem (outra unidade intacta, token criptografado, auditoria); falha não apaga o token; CAS não sobrescreve reconexão |
| CONVERSA FECHADA | 1 | `closed → inbound → open`, unread +1, mesmo id, histórico preservado |
| CONTA TROCADA (todos os caminhos) | 2 | conector e automação devolvem o motivo estável, sem chamar a Meta |

```
npx vitest run src/lib/__tests__/a34-instagram.test.ts → 86 ok
npx vitest run  → 89 arquivos · 1.600 testes ok
npx tsc --noEmit → 0 erros
npm run build    → ok
```

Arquivos alterados nesta correção: `src/lib/types.ts`, `src/lib/instagram.ts`,
`src/lib/instagram-api.ts`, `src/lib/automation/actions.ts`,
`src/app/api/conversations/route.ts`, `src/app/api/instagram/onboarding/route.ts`,
`src/app/api/instagram/onboarding/callback/route.ts`,
`src/app/api/cron/instagram/route.ts`,
`src/components/dashboard/InstagramChannelPanel.tsx`,
`src/app/(dashboard)/conversas/page.tsx` e
`src/lib/__tests__/a34-instagram.test.ts`.

Segue valendo: nada foi executado contra o Instagram real (**BLOCKED_EXTERNAL**
para app aprovado, conta profissional e credenciais); o Graph API foi exercitado
contra mock com o formato oficial; Blocos 10 e 11 **não** foram iniciados.
