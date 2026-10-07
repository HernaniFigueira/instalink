# GoDoutor Design System 1.0 → 1.1

> **DS 1.1 (evolução dirigida por Material 3):** ver §9 ao final — campos com
> rótulo flutuante, `DetailSideModal`, tipografia Barlow, rail sem chevrons,
> prontuário em leitura, alertas proporcionais e a tabela de pesquisa oficial.
> **Status DS 1.1:** PR #64 ABERTA / MERGE NÃO AUTORIZADO (2026-10-06).

> **Status (base, DS 1.0):** CONCLUÍDO / PR #62 ABERTA / MERGE NÃO AUTORIZADO (2026-10-06).
> **Fonte única de verdade visual:** `src/styles/godoutor-design-system.css` (tokens `--gd-*`).
> **Contrato:** este documento. `docs/GODOUTOR-UI-CONTRACT.md` (missões anteriores) fica
> como histórico: onde conflitar, **este documento vence**.

---

## 1. Princípio

Uma página **não tem design próprio**. Ela escolhe **componentes semânticos** e o
sistema decide como eles se parecem. Não existe “cor da tela X”, “botão da feature Y”,
“modal artesanal da tela Z”.

Consequências práticas, válidas para toda tela nova ou migrada:

1. **Nunca** repetir valor literal de cor, raio, espaçamento, sombra ou tamanho de
   controle: use token (`var(--gd-*)`).
2. **Nunca** criar um componente visual novo sem antes procurar o canônico (§4).
3. **Nunca** justificar uma escolha visual com “já estava funcionando” — regra de
   negócio/autoridade/permissão/dados/fluxo é intocável; aparência não é.
4. Um token é **semântico**, nunca específico de página (`--agenda-blue` é proibido).

## 2. Tokens

`src/styles/godoutor-design-system.css` declara `--gd-*` em `:root`. `src/app/globals.css`
**não declara mais cor/geometria**: ele só contém **aliases** (`--text: var(--gd-text)`),
para não quebrar as telas legadas durante a migração. Regra: **nenhum hex novo** nos
blocos de token do `globals.css`.

| Grupo | Tokens | Valores canônicos |
| --- | --- | --- |
| Fundo | `--gd-bg-app`, `--gd-bg-surface`, `--gd-bg-surface-2`, `--gd-bg-subtle`, `--gd-bg-inset`, `--gd-bg-hover` | `#f4f6f8`, `#ffffff`, `#fbfcff`, `#f1f4f9`, `#f4f6fc`, `#f2f5fc` |
| Texto (INK) | `--gd-text`, `-strong`, `-secondary`, `-muted`, `-soft`, `-faint`, `-disabled` | `#1c1815`, `#14100d`, `#3d3833`, `#524c46`, `#665f59`, `#6f6862`, `#a8a29c` |
| Borda | `--gd-border`, `-soft`, `-2`, `-strong` | `#e2e8f0`, `#eef2f6`, `#dbe3ec`, `#7d8ca3` |
| Acento | `--gd-accent`, `-hover`, `-soft`, `-fg`, `-border`, `-contrast` | `#2563eb`, `#1d4ed8`, `#eff6ff`, `#1d4ed8`, `#bfdbfe`, `#ffffff` |
| Semânticas | `--gd-success*`, `--gd-info*`, `--gd-warning*`, `--gd-danger*` (cor, `-strong`, `-fg`, `-bg`, `-bg-hover`, `-border`) | verde `#15803d`, azul `#2563eb`, âmbar `#b45309`, vermelho `#dc2626` — todos AA com texto branco |
| Status de agenda | `--gd-status-scheduled*`, `-waiting`, `-in-care`, `-done`, `-rescheduled`, `-no-show`, `-cancelled` | pares **soft** (fundo claro + fg AA); **nunca só cor** — sempre rótulo/ícone |
| Navegação (fixa) | `--gd-nav-bg`, `-fg`, `-muted`, `-icon`, `-hover`, `-active-bg`, `-active-fg`, `-border`, `-panel-bg`, `-cta` | **branco** `#ffffff`, texto `#1f2328`, hover `#f4f6f8`, ativo = acento soft |
| Tipografia | família `--gd-font-sans` (Geist Sans) · pesos `400/500/600` (+`700` só título) · tamanhos `20/15/13.5/12.5/12/11` (`--gd-font-size-*`) · `--gd-num-tabular` | uma família, sem segunda fonte para números |
| Espaçamento | `--gd-space-1..8` (`4/8/12/16/20/24/32/40`) · papéis `--gd-space-page`, `-section`, `-card`, `-drawer` | nada de `p-[17px]`; respiro por papel |
| Raio | `--gd-radius-xs..2xl` (`4/6/8/8/8/8`) · `--gd-radius-pill` | escala **plana** (“menos bolha”) |
| Elevação | `--gd-shadow-xs/sm/md/lg/xl/inset/overlay` — `xs`/`sm` = `none` | sombra só em **overlay real** (drawer/dialog/popover) |
| Controles | `--gd-control-h` (40), `-sm` (34), `-xs` (28), `-touch` (44), `-icon` | altura única por variante em todo o sistema |
| Layout | `--gd-topbar-h` (56), `--gd-rail-w` (60), `--gd-sidebar-w` (248), `--gd-nav-panel-w` (216) | topbar full-width acima da navegação |
| Motion | `--gd-motion-fast/base/slow` (140/160/180ms) + `--gd-ease` | `ease-out`, sem bounce; `prefers-reduced-motion` zera |
| Foco | `--gd-focus-ring`, `--gd-focus-outline` | um único anel, sempre visível no teclado |
| Camadas | `--gd-z-topbar` (45), `-nav-panel` (60), `-drawer` (80), `-modal` (90), `-popover` (100), `-tooltip` (110), `-toast` (120) | ordem fixa, sem `z-index` solto |

### Regras de aparência (proibições explícitas)

- Gradiente decorativo: **proibido**. Fundo é sólido (`--gd-bg-app`); `--bg-gradient: none`.
- Azul preenchendo estrutura por padrão: **proibido**. Azul = ação/acento pontual.
- Card em volta de tudo: **proibido**. Agrupe por hierarquia/whitespace; card só quando
  há conteúdo de verdade para delimitar.
- Sombra pesada: **proibida**. Elevação só em overlay que flutua de verdade.
- Borda em tudo: **proibida**. Borda quando é necessária para leitura/limite.
- Cor/componente por tela: **proibido**. Uma implementação oficial (§4).

## 3. App Shell (§12–§19)

```
┌───────────────────────────────────────────────┐
│                 TOP BAR (100%)                │  ← x=0, acima de tudo, 56px
├──────┬────────────────────────────────────────┤
│ RAIL │              CONTEÚDO                  │  ← navegação começa abaixo
│ 60px │                                        │
└──────┴────────────────────────────────────────┘
```

- **Topbar** é filha direta do shell (`flex: 0 0 100%; order: -1`), ocupa 100% da
  largura e começa em `x=0`. Nunca vive dentro da coluna de conteúdo.
- **Sidebar branca** (decisão fechada): superfície `--gd-nav-bg` = `#ffffff`, texto
  neutro, item ativo = acento **suave** (`--gd-nav-active-bg`) + texto do acento; hover
  neutro (`--gd-nav-hover`). Nenhum preset pinta a estrutura (§13): o tema escolhe o
  **acento** (item ativo, CTA principal, acentos de header).
- **Rail 60px recolhido por padrão**, persistido em `localStorage['godoutor-side-v2']`
  (`mini`/`full`; a chave antiga `il-side-v2` é lida como fallback). O botão
  “Expandir navegação” (pin) **empurra o conteúdo** — em nenhum modo a navegação
  sobrepõe o miolo.
- **Painel de grupo (§15/§18)**: não existe mais acordeão que empurra filhos. Grupo
  (hover/focus/clique) abre um **painel lateral** com `top: var(--gd-topbar-h)`, ancorado
  na borda da navegação (`--gd-rail-w` ou `--gd-sidebar-w`), fundo branco, borda 1px,
  sem sombra, altura útil (`max-height: calc(100dvh - var(--gd-topbar-h) - …)`) e
  **zero reflow** do conteúdo. Abre em 180ms `ease-out`, fecha 275ms após o mouseleave,
  no `Escape` e ao clicar num item. `prefers-reduced-motion` remove a animação.
- **Sem breadcrumb global** (§19): a tela se identifica pelo próprio header.
- Mobile (<1200px): a navegação lateral não ocupa a tela; o drawer mostra as portas
  diretas e os itens de cada grupo **direto** (toque não tem hover; sem disclosure).

## 4. Componentes canônicos

Uma implementação oficial por componente. Enquanto a migração acontece, a coluna
“LEGADO” registra o que ainda existe e o plano.

| Canônico | Estado | Arquivo | LEGADO / observação |
| --- | --- | --- | --- |
| Button (+ IconButton) | canônico | `src/components/ui.tsx` | variantes legadas (`soft`, `quiet`, `cta`, `danger`) seguem como **aliases** de `secondary`/`ghost`/`primary`/`destructive`; nenhuma nova variante fora da lista |
| Input · Textarea · FormField (`Field`) | canônico | `src/components/ui.tsx` | `Select` nativo ainda aparece em 12 arquivos (§6) |
| Select | canônico | `src/components/ui.tsx` | `<select>` cru proibido fora das exceções §6 |
| Checkbox · Switch | canônico | `src/components/ui.tsx` | — |
| Badge · StatusBadge | canônico | `src/components/ui.tsx` | status de agenda usa os pares soft |
| Tabs · SegmentedControl (`Segmented`) | canônico | `src/components/ui.tsx` | sem sublinhado decorativo |
| EmptyState · Notice · Skeletons | canônico | `src/components/ui.tsx` | — |
| Drawer · Sheet | canônico | `src/components/ui.tsx` + `WorkspaceSheet` | um **CloseButton** único e neutro; X vermelho proibido |
| IconButton | canônico | `src/components/ui.tsx` | usa `--gd-control-h-icon` |
| Tooltip · Popover · HoverCard · DropdownMenu · Dialog · Radio · SearchField · Table · Pagination · Toast · DatePicker/Calendar · Combobox/Autocomplete/MultiSelect · ActionSection/PageActionBar | canônico | `src/components/ui.tsx` + catálogo `/dev/design-system` | `Popover` aceita `anchorStyle` para ancorar num **ponto** (slot da Agenda); `HoverCard` não abre onde não existe hover (`@media (hover: hover)`) |
| Modal artesanal | eliminar | — | qualquer `div` com `position: fixed` + overlay próprio migra para `Dialog`/`Drawer` |

Catálogo vivo: **`/dev/design-system`** (fora da navegação final; em produção exige
`?dev=1`). Ele é a referência visual: estados de repouso, hover, focus, disabled,
loading, erro, vazio e selecionado, em tema claro.

## 5. Agenda (primeira superfície convertida)

O motor temporal/bookings/API/disponibilidade/permissões/tenant/bloqueios/fila **não
muda**: muda a experiência.

- Toolbar `Hoje ‹ data ›` + `Segmented` `Dia | Semana | Lista`; **fim** do input `date`
  nativo (entra o DatePicker canônico). “Hoje” é **ação** ancorada no `today` do
  **fuso do negócio** (`todayISO(new Date(), bizTz)`), com `aria-pressed` — nunca um
  estado que esconde a grade nem um botão de modo. As setas andam um passo do modo
  atual (`Dia`/`Semana`/`Mês`). Superseção registrada em §7.
- `EventCard` simples: status, paciente, serviço, horário. Profissional **só quando
  necessário** (visão de equipe/multi-profissional).
- `HoverCard` (150–250ms) com informação de apoio, com foco equivalente no teclado e
  sem hover no toque.
- Clique → `Drawer` canônico à direita: detalhe + ações (Registrar chegada = Primary,
  Não compareceu = Warning soft, Reagendar = Secondary, Cancelar = Danger soft) +
  Histórico + Iniciar atendimento.
- Criar por clique/drag em slot → `Popover` ancorado no **ponto do gesto**
  (`anchorStyle`), com os seis campos sempre visíveis (Paciente · Serviço ·
  Profissional · Data · Hora · Duração) + **“Mais opções”**. O horário nunca é
  inventado: a lista vem de `mode=slots-admin` (mesmo endpoint do fluxo completo) e o
  campo explica o estado (“escolha o serviço…”, “sem horários livres”). A gravação é
  `POST /api/bookings` pelo payload canônico (`lib/booking-quick-create.ts`), com o
  erro do servidor exibido como veio (409 = o horário deixou de estar livre).
  “Mais opções” leva ao **mesmo** fluxo completo (`NewBookingSheet`) com o
  preenchimento preservado. Nenhuma regra foi duplicada: paciente precisa existir no
  CRM, e o servidor revalida disponibilidade, conflito, bloqueio, fuso e tenant.
- O drag continua respeitando snap/disponibilidade/bloqueios/timezone — a
  apresentação mudou, o cálculo é o mesmo; `Bloquear horário` continua sendo o fluxo
  de bloqueio (não cria atendimento).
- Linha de “agora” discreta; status sempre com rótulo (nunca só cor).

## 6. Exceções documentadas

Toda exceção tem arquivo, motivo técnico e plano. “Estava funcionando” não é motivo.
Inventário **medido**, não estimado: `grep -rn '<select' src/ --include=*.tsx` e uma
varredura de `fixed inset-0` fora do `ui.tsx`.

| Exceção | Arquivo(s) | Motivo técnico | Plano |
| --- | --- | --- | --- |
| `lib/appearance.ts` mantém `navTokens/navTokenStyle` | `src/lib/appearance.ts` | formato legado de `business.appearance.navColor` (sanitização usada por `/api/businesses/[id]`); **nenhuma tela aplica esses tokens** (a sidebar é branca fixa) | remover o construtor visual quando o campo legado sair do payload |
| `src/components/public/*` (widget, menu e páginas do cliente) tem overlays próprios | `components/public/widgets.tsx`, `widgets2.tsx`, `menu.tsx`, `customer.tsx` | é a **superfície pública** (cliente final, sem sessão, CSS enxuto por payload) e propositalmente não carrega a biblioteca do painel | avaliar um pacote público enxuto com os mesmos tokens quando houver demanda de marca do cliente final |

**Fora da lista (prova de convergência, medida):**

- **Zero `<select>` cru no produto.** Os 15 que restavam (8 arquivos) foram migrados para
  o `Select` canônico, com o rótulo vindo do `Field`/`aria-label` de cada caso.
- **Zero camada artesanal no painel.** As únicas ocorrências de `fixed inset-0` no
  produto são o `Sheet`/`Dialog` canônicos (`src/components/ui.tsx`), a superfície
  pública e um comentário no `EsteiraView`.
- **Zero rolagem horizontal** nas quatro larguras exigidas, em seis superfícies —
  inclusive o caso histórico do Dashboard em 1024px (`.dsh-metric`), que agora é
  verificado por teste (`responsive-qa.mjs`), não por memória.

## 7. Contratos substituídos (histórico)

Sob o DS 1.0, contratos visuais anteriores deixaram de valer e os testes foram
**re-apontados** (não enfraquecidos — os limiares AA continuam medidos):

| Contrato antigo | Contrato DS 1.0 |
| --- | --- |
| Sidebar colorida pelo tema (navy/ônix/vinho) | Sidebar **branca fixa**; tema escolhe o **acento** |
| Acordeão que expande filhos na coluna | **Painel lateral** sem reflow |
| Canto arredondado decorativo na junção sidebar×conteúdo | Sem raio decorativo: divisa por borda 1px |
| `--bg-top`/`--bg-bottom` (par de gradiente) | remanescente removido; fundo sólido `--gd-bg-app` |
| Sombra no flyout | Borda 1px + contraste de superfície (sem sombra) |
| “Hoje” REMOVIDO da navegação de data (A3.4/correção cirúrgica) | **Toolbar canônica** `Hoje · ‹ data ›`: “Hoje” volta como ação de uma linha (com `aria-pressed`), e a data deixa de depender do seletor nativo do navegador |
| Clique em slot abre o fluxo completo direto (`NewBookingSheet`) | Clique/arraste abre o **quick create ancorado**; o fluxo completo fica em “Mais opções” (e no CTA “Novo agendamento”), com o preenchimento preservado |
| `title="… clique para escolher a data"` sobre um `<input type="date">` invisível | `DatePicker` canônico (Popover + Calendar) com `aria-label` de período (`Escolher data (…)`) |

## 7.1 Mapa de migração (LEGADO → CANÔNICO → ARQUIVOS → STATUS)

Ordem de trabalho da fase. `✅` = convertido nesta entrega; `⏳` = na fila, com o
arquivo identificado (nada “escondido” como exceção).

| LEGADO | CANÔNICO | ARQUIVOS | STATUS |
| --- | --- | --- | --- |
| Topbar dentro da coluna direita; sidebar navy; acordeão que empurra filhos | App Shell §12–§19 | `DashboardShell.tsx`, `WorkspaceTopbar.tsx`, `WorkspaceNavigation.tsx`, `globals.css`, `styles/godoutor-design-system.css` | ✅ |
| Toolbar de data com `<input type="date">` escondido | `DatePicker` + `Calendar` | `app/(dashboard)/agenda/page.tsx` | ✅ |
| Clique no slot → sheet completo | `Popover` (quick create) + `Drawer` (fluxo completo) | `agenda/page.tsx`, `dashboard/QuickBookingPopover.tsx`, `lib/booking-quick-create.ts` | ✅ |
| `<select>` cru do formulário de bloqueio | `Field`/`Input`/`Select` | `agenda/page.tsx` | ✅ |
| “X vermelho” do sheet (danger no ícone, fundo e borda) | `CloseButton` neutro | `dashboard/WorkspaceSheet.tsx`, `globals.css` | ✅ |
| Modal artesanal do fechamento clínico + cabeçalho com botão à direita | `Dialog` + `ActionSection` + `PageActionBar` + `Notice` | `dashboard/EncounterFinalizationPanel.tsx` | ✅ |
| Modal artesanal “seguir a clínica” | `Dialog` | `dashboard/BusinessHours.tsx` | ✅ |
| Barra de filtros com `<input>` solto + selects `w-auto` esticados | `SearchField` + `Select` + `Button`/`buttonCls` | `dashboard/EsteiraView.tsx` | ✅ |
| 3 modais artesanais das Oportunidades (detalhe do lead, novo lead, agendar do lead) | `Dialog` + `Field`/`Input`/`Select`/`Textarea` | `dashboard/EsteiraView.tsx` | ✅ |
| Ações de card com cor de acento em cada cartão | `buttonCls` (secondary/warning soft) | `dashboard/EsteiraView.tsx` | ✅ |
| 4 modais artesanais de Integrações/Canais (chave de API, webhook, conectar provedor, credenciais) | `Dialog` + `Button` | `dashboard/IntegracoesView.tsx`, `dashboard/CanaisIntegracoesView.tsx` | ✅ |
| Bottom-sheet artesanal de “Nova campanha” | `Dialog` | `app/(dashboard)/campanhas/page.tsx` | ✅ |
| `<select>` cru das Oportunidades (filtros, etapa, responsável, prioridade, tarefa, agendamento) | `Select` | `dashboard/EsteiraView.tsx` | ✅ |
| Copy “Conta de acesso separada … Equipe/Acesso” dentro da edição do cadastro | (sem componente) | `dashboard/ClientProfileDrawer.tsx` | ✅ |
| Lista de atendimentos como pilha de cards | lista com fios de 1px | `agenda/page.tsx`, `globals.css` (`.ag-list`) | ✅ |
| `<select>` cru restante (15 ocorrências em 8 arquivos) | `Select` + `Field`/`aria-label` | `pagina` (4), `master/suporte` (2), `IntegracoesView` (2), `QueuePanel` (2), `catalog-panels` (2), `configuracoes` (1), `organizacao` (1), `BusinessHours` (1) | ✅ (**zero** no produto) |
| Barra de ações do funil sem quebra no celular (CTA cortado aos 390px) | `flex-wrap` + largura própria abaixo de `sm` | `dashboard/EsteiraView.tsx` | ✅ (medido em browser real) |
| Ícones/cabeçalhos de página com chip próprio | `PageHeader`/`ActionSection` | dashboard, clientes, equipe, resultados, financeiro | ✅ (clientes/equipe/resultados/financeiro já usam `PageHeader`; o header da Visão geral foi alinhado aos tokens do chip canônico `surface-2`+`accent` na consolidação 2026-10-06) |
| `lib/appearance.ts` (tokens de nav legados) | — | `src/lib/appearance.ts` | ⏳ (remover quando o campo sair do payload) |
| Board de oportunidades / kanban com cartões próprios | `Table`/`Card` semântico | `dashboard/EsteiraView.tsx`, `catalog-panels.tsx` | ✅ tokens (consolidação 2026-10-06: prioridade “Urgente” saiu do Danger SOLID para o par soft `danger-bg/fg/border`; o listbox da biblioteca veterinária trocou `zinc-200`/`shadow-lg` por `--border`/`shadow-md`; pontos de etapa permanecem “cor+rótulo”). O drag-and-drop do kanban é **interação preservada**, não identidade visual — a conversão estrutural para `Table` fica como refactor não-visual opcional e não bloqueia o DS 1.0. |

## 8. Verificação

- `git diff --check`, `npm run typecheck`, `npm run build`.
- Testes focados: `WorkspaceNavigation`, `m8-sidebar-peek`, `missao6-shell`,
  `design-360-tokens`, `godoutor-ui-contract-v2`, `m8-contrato-cor`, `missao7-visual`,
  `visual-convergence`, `ui-audit-v01-v10`, `premium-refine`, `pre-f1-polish`,
  `m9/m10/m11` + primitives/agenda/permissions/clinical access.
- Suíte completa sem `skip/only/todo` (baseline preexistente separado de regressão nova).
- QA em browser real contra **build de produção local** (`next start`) com banco
  descartável e usuários fictícios: `tests/design-system/shell-qa.mjs` (shell §12–§19,
  **22/22**), `tests/design-system/agenda-qa.mjs` (toolbar, quick create ancorado,
  drawer, hover card — **23/23**) e `tests/design-system/surfaces-qa.mjs`
  (fechamento clínico, Oportunidades, Disponibilidade — **40/40**) — screenshots em
  `docs/qa-design-system/`, viewports 1440/1366/1024/390.
- `tests/design-system/responsive-qa.mjs` — **48/48**: as seis superfícies principais
  (Visão geral, Agenda, Oportunidades, Clientes, Canais, Configurações) sem rolagem
  horizontal e com a coluna principal na largura útil em **1440/1366/1024/390**,
  com screenshots por largura. Substitui a exceção do Dashboard em 1024px por medição.
- `src/lib/__tests__/ds-sem-controle-artesanal.test.ts` — contrato de SOURCE (**4/4**), que
  o fixture não substitui: zero `<select>` cru fora de `ui.tsx`, zero camada artesanal
  `fixed inset-0` no painel, `CloseButton` sem danger e zero gradiente decorativo
  (allow-list explícita, com motivo técnico, só para textura/preview de **dado**).
  É o gate que impede a fila de reabrir em silêncio numa tela que o fixture não abre.
- `tests/design-system/audit-2-probe.mjs` — segunda passagem de auditoria nas telas que
  ainda não tinham QA (Canais & Integrações e Campanhas): página carrega sem erro de
  runtime, **zero** camada artesanal, os 5 `Dialog` migrados abrem com **foco contido**,
  fecham com Escape e o `CloseButton` não é vermelho (**18/18**).
- Nenhuma camada artesanal sobrevive no produto: o QA mede `artesanalOverlays() === 0`
  em cada tela exercitada, e o inventário de `<select>` cru é conferido por `grep`.
- Testes de contrato do DS: `src/lib/__tests__/ds-agenda-quick-create.test.tsx`
  (popover ancorado, seis campos, sem POST antes da confirmação, erro do servidor
  preservado, handoff para “Mais opções”).

---

# 9. Design System 1.1 — evolução dirigida por Material 3

A missão não pediu um DS novo: pediu que o DS 1.0 ficasse **mais claro, mais
previsível e mais silencioso**, absorvendo do Material Design 3 o que é
*comportamento* (estado, movimento, hierarquia, acessibilidade, divulgação
progressiva) e **nada** de identidade (paleta, marca, ícones proprietários,
layouts exatos). O resultado continua GoDoutor; o que muda é a régua.

## 9.1 Princípio operacional (a régua de texto)

O sistema é um **aplicativo operacional**, não um site institucional. A ordem de
leitura de qualquer tela é:

> **ação → estado → conteúdo → contexto sob demanda**

Um texto só sobrevive se **muda uma decisão**, **evita um erro**, **explica uma
regra não óbvia** ou **comunica uma condição clínica/operacional importante**.
Tudo o mais sai, encolhe ou vira ajuda contextual. Consequência direta: **as
páginas não têm design próprio** — elas escolhem componentes semânticos.

## 9.2 Tipografia — uma família, uma escala

**Barlow** (Jeremy Tribby / The Barlow Project Authors, SIL OFL 1.1) é a fonte da
interface: 400/500/600 e 700 **só onde a hierarquia justifica** (nunca como
peso padrão de título).

| Papel | Tamanho/linha | Peso | Token |
| --- | --- | --- | --- |
| Título de página | 20/26 | 600 | `--gd-type-page-title-*` |
| Seção | 16/22 | 600 | `--gd-type-section-*` |
| Corpo | 14/20 | 400 | `--gd-type-body-*` |
| Rótulo (campo, item) | 13/20 | 500 | `--gd-type-label-*` |
| Metadado | 12/18 | 500 | `--gd-type-metadata-*` |
| Ajuda | 12/18 | 400 | `--gd-type-helper-*` |
| Botão | 14/20 | 500 | `--gd-type-button-*` |

`globals.css` **não** redefine tamanhos: os aliases históricos
(`.il-platform .il-type-*`) apontam para estes tokens. Números de Agenda/horário
seguem `tabular-nums` (alinhamento de coluna), e a densidade é elegante — não
inflada.

**Como a Barlow é servida (e o impedimento documentado).** O caminho preferido
era `next/font/google`, que baixa a fonte no *build* e a serve do próprio host,
sem requisição ao Google em runtime. No ambiente de homologação desta missão
**não há rota para `fonts.googleapis.com`** (TLS bloqueado; `curl` falha) e o
`next build` **morre** com `Failed to fetch \`Barlow\` from Google Fonts` — ou
seja, o gate de build e toda a evidência visual ficariam irreproduzíveis. Decisão
documentada: os `.woff2` OFL da própria Barlow (subset `latin`, pesos
400/500/600/700) foram **vendorizados** em `src/app/fonts/barlow/` (origem
`@fontsource/barlow@5.3.0`, licença em `OFL.txt`) e servidos por
`next/font/local` — mesmo resultado funcional (self-host, `preload`, `swap`,
fallback métrico) e agora também **buildável offline**. A QA mede o que importa:
`document.fonts.check('400 14px Barlow') === true` e
`performance.getEntriesByType('resource')` com **zero** requisição a
`fonts.googleapis.com`/`fonts.gstatic.com`.

## 9.3 Campos — `FieldShell` (Material 3 Outlined)

Um único componente (`Field` + `.gd-field*`) serve Input, Textarea, Select,
Combobox, Autocomplete e Date/Time:

- **vazio e sem foco:** o rótulo mora dentro da caixa (nunca vira placeholder);
- **foco:** o rótulo sobe e **notcha** o contorno (o `background` da superfície
  cria o corte, como no outline do Material);
- **preenchido:** o rótulo permanece acima;
- **erro:** contorno + rótulo + texto no par de danger (nunca só a cor);
- **ajuda:** abaixo do campo, e **substituída visualmente** pelo erro — mas o
  elemento continua no DOM (fora da tela) porque `aria-describedby` é montado
  com os dois ids e id pendurado não descreve nada;
- **desabilitado × somente-leitura:** superfícies diferentes (o segundo continua
  legível e selecionável);
- **alturas:** 40–44px, e 44px + 16px de fonte em ponteiro grosso/≤767px;
- **contorno:** `--gd-border-strong` contra branco ≥ 3:1 (critério do Material).

`Combobox` **adota** a caixa quando está dentro de um `Field`
(`gd-field__control--inline`): um só contorno, rótulo e ARIA vindos do shell.

## 9.4 Overlays — três papéis, nunca "um painel para tudo"

| Papel | Componente | Geometria/comportamento |
| --- | --- | --- |
| Decisão | `Dialog` | central, faixa por token (`--gd-dialog-w`), foco preso, Escape |
| Fluxo longo | `WorkspaceSheet` (`Drawer`/`Sheet`) | lateral de formulário, largura por preset |
| **Ler um registro** | **`DetailSideModal`** | **preso à borda direita**, `100dvh`, sem gap/margem no desktop, sem raio e sem sombra, largura `--gd-detail-w` (460px), backdrop `--gd-overlay-strong`, slide de fora da borda em ~190ms e volta em ~170ms, foco preso e devolvido ao gatilho |

`DetailPanel` continua existindo **apenas como alias depreciado** de
`DetailSideModal` (nada de dois padrões com o mesmo nome). A base comportamental
é a do **modal side sheet** do Material (bloqueia o resto do app); a geometria é
a do contrato GoDoutor (encostado na borda, não "card flutuante") — o painel
insetado de 16px do DS 1.0 lia como card solto, não como detalhe do registro.

## 9.5 Navegação — rail de destinos, não acordeão

O rail tem ~60px, fica sempre no mesmo lugar e o grupo abre um **painel
conectado** (gap 0, divisória de 1px, sem cara de card): hover/foco entra em
120–180ms, permanece enquanto o cursor vai do rail para o painel, troca de grupo
A→B sem fechar, e retrai com atraso curto ao sair. **Nenhum chevron em gatilho de
grupo** — sem acordeão não existe seta, e seta em gatilho que não abre nada é
interação falsa. Teclado: Tab/foco é equivalente ao hover, Enter/Space abre,
Escape fecha e devolve o foco ao gatilho. A identidade da clínica aparece **uma
vez** (topbar) e `projection` do rail nunca esconde rota autorizada.

## 9.6 Leitura — `ReadOnlyField` e `Disclosure`

Prontuário/Atendimento em leitura **não é formulário desabilitado**: é documento.

- `ReadOnlyField` — rótulo canônico + texto na escala de corpo, **sem caixa de
  input**, preservando parágrafos (`white-space: pre-wrap`); valor vazio é
  declarado e fraco (`Não informado`), nunca um branco ambíguo.
- `ClinicalRecordSection` — o BLOCO do documento: título na escala de seção, malha
  de leitura (2 colunas quando cabe, campo longo ocupando a linha) e valores em
  `ReadOnlyField`. É o que as **seis seções da superfície VIVA** do prontuário
  (`/atendimento/<id>`, a rota que a Agenda e o detalhe do agendamento abrem)
  renderizam quando `editable=false` — antes disso elas desenhavam `disabled` em
  cada controle (defeito real: `EncounterCoreSection`, anamnese, avaliação,
  problemas, conduta e procedimentos).
- `Disclosure` — bloco secundário que **abre**: `button[aria-expanded]` +
  região rotulada, fechado por padrão, movimento curto, `keepMounted` opcional
  (o padrão desmonta, para não vazar dado oculto em leitura de tela/impressão).
- Ações no rodapé da seção, alertas perto do contexto, histórico recolhível,
  autoria e privacidade preservadas. **Nenhuma regra clínica, autoria, permissão
  ou acesso foi alterado** — a mudança é de apresentação (o servidor continua a
  autoridade de escrita).

## 9.7 Alertas — proporcionais ao impacto

| Situação | Superfície |
| --- | --- |
| Contexto local (a ação foi negada **aqui**, a fila espera, o bloqueio existe) | `Notice`/`AttentionStrip` **no fluxo**, peso leve, dispensável |
| Condição importante (registro finalizado, conflito de versão) | `Notice` com título, no topo do conteúdo afetado |
| Confirmação transitória (qualquer 403 de ação) | **toast** canônico (`useToasts`/`ToastViewport`, `.gd-toast`) |
| Decisão realmente bloqueante | `Dialog` |

Vermelho cheio fica reservado para ação destrutiva de verdade. A barra âmbar de
bloqueios da Agenda virou indicador compacto (ícone + contagem + pílulas) porque
competia com a toolbar; o aviso de permissão e o toast de 403 saíram das cores de
página (`amber-*`/`zinc-*`) para os tokens do DS.

## 9.8 Tabela A — referência oficial → princípio → adaptação GoDoutor

| REFERÊNCIA OFICIAL | O QUE O MATERIAL RECOMENDA | PROBLEMA NO GODOUTOR | ADAPTAÇÃO (DS 1.1) |
| --- | --- | --- | --- |
| [Text fields — overview](https://m3.material.io/components/text-fields/overview) | Linha de base clara entre *filled* e *outlined*; o **outlined** é o de menor ênfase, para formulários longos; estado do campo visível de relance; rótulo e erro curtos | Cada tela tinha um jeito: rótulo acima, placeholder-como-rótulo, altura de controle variável | `FieldShell` outlined com rótulo flutuante como **único** campo do produto (§9.3) |
| [Text fields — accessibility](https://m3.material.io/components/text-fields/accessibility) | Contorno ≥ 3:1 contra o fundo; Tab percorre os campos; o **nome acessível é igual ao rótulo visível**; ícone final rotulado pela função | Contraste de borda e associação rótulo↔controle dependiam de cada tela | `--gd-border-strong` ≥ 3:1, `aria-labelledby` para o rótulo visível, ajuda/erro ligados por `aria-describedby` (§9.3) |
| [material-web — text-field](https://github.com/material-components/material-web/blob/main/docs/components/text-field.md) | `md-outlined-text-field` com `label` flutuante, `error`/`error-text`, ícones inicial/final, texto de apoio; rótulo externo exige `aria-label` | Sem contrato de shell; erro e ajuda competiam pelo mesmo espaço | `Field` (nosso análogo ao `md-outlined-text-field`) com ajuda/erro/ícones na mesma caixa e erro substituindo a ajuda **sem apagar o id** |
| [Side sheets](https://m3.material.io/components/side-sheets/overview) | *Standard* vs **modal** (bloqueia o resto; usado em telas compactas) | O detalhe era um painel flutuante insetado, lido como "card solto" | `DetailSideModal`: semântica modal + geometria presa à borda direita, altura cheia (§9.4) |
| [material-web — dialog](https://github.com/material-components/material-web/blob/main/docs/components/dialog.md) | Três seções opcionais (headline/conteúdo/ações), `type="alert"` para alerta, foco preso por padrão, `aria-label` sem headline, abrir/fechar resolvem após a animação | Criação/edição em painel lateral e "modais artesanais" | Criação/edição **central** (`Dialog`), alerta para decisão bloqueante, foco preso e fechamento só depois do movimento |
| [material-web — menu](https://github.com/material-components/material-web/blob/main/docs/components/menu.md) | Menu se **ancora** ao gatilho (`anchor`/`anchorElement`, mesmo pai `position:relative`); navegação por setas e typeahead; variante em top-layer quando há clipping | Menus com posição própria e sem teclado; selects diferentes por tela | Camadas ancoradas (`useAnchoredLayer`, flip dentro da viewport) + `DropdownMenu` com roving focus, setas, Enter/Espaço e Escape; `Select` nativo só para listas curtas, `Combobox` com busca para listas longas (§9.9) |
| [Navigation rail](https://m3.material.io/components/navigation-rail/overview) | Rail para janelas médias+, 3–7 destinos, **sempre no mesmo lugar**, indicador de ativo | Gatilho de grupo com chevron de "acordeão" e um botão flutuante de expandir/recolher que não existiam no comportamento | Rail fixo de destinos + painel conectado; **chevrons removidos** e nenhum controle flutuante (§9.5) |
| [Motion — how it works](https://m3.material.io/styles/motion/overview/how-it-works) | Esquemas *standard* (pouco bounce) e *expressive*; tokens espaciais vs de efeito; molas com fast/default/slow | Transições heterogêneas, algumas com deslocamento simbólico; nada declarado | GoDoutor = esquema **standard/utilitário**: 120–200ms, ease-out, sem bounce, overlay entra/sai por inteiro; `prefers-reduced-motion` zera movimento |
| [Barlow — Google Fonts](https://fonts.google.com/specimen/Barlow) | Família de 100–900, subset latino, OFL | Duas famílias e uma escala com tamanhos soltos por tela | Uma família e uma escala canônica por papel (§9.2) |
| [next/font (Next.js)](https://nextjs.org/docs/app/api-reference/components/font) | `next/font` **self-hospeda em build**, faz preload e **não** manda requisição do navegador ao Google | — | `next/font/local` com os OFL vendorizados (impedimento de rede documentado em §9.2); QA prova 0 requisições ao Google |

## 9.9 Contratos substituídos no DS 1.1 (histórico)

| Contrato antigo | Contrato DS 1.1 | Testes re-apontados |
| --- | --- | --- |
| `Field` com rótulo acima do controle | `FieldShell` outlined com rótulo flutuante (`:placeholder-shown` como detector de vazio) | `ui.test.tsx` (a associação ARIA foi **mantida**, inclusive a ajuda oculta sob erro) |
| Chevron no gatilho de grupo do rail (e `transform: rotate`) | Gatilho sem seta, mantendo `aria-expanded`/`aria-haspopup` | `ui-audit-v01-v10.test.ts` (V06), `agenda-ux-closure.test.tsx` |
| Monograma da clínica em **tile** com par accent/contrast | Logo **solta** e proporcional (`height` por token + `width:auto`); sem arquivo, monograma em **texto** (`--text-strong`) | `m10-identidade-persistente.test.ts` |
| `DetailPanel` (painel insetado, raio+sombra) | `DetailSideModal` (borda direita, altura cheia, sem raio/sombra) — `DetailPanel` fica como alias | `agenda-ux-closure.test.tsx`, `fase2-ws-sheet-close.test.ts`, `homologacao-p0-autosave-client.test.ts` |
| Subtítulo "Paciente → serviço → data e horário → confirmação" no cabeçalho do agendamento | Removido: a sequência é dita pelos rótulos numerados do próprio formulário | `agenda-protagonista.test.tsx` |
| Aviso de permissão e toast de 403 com `amber-*`/`zinc-*` de página | `Notice` + pilha de **toast** canônica, tokens do DS | `ds-1-1-leitura-e-alertas.test.tsx` |
| Prontuário finalizado com textareas `disabled` (rota legada `/registro`) | `ReadOnlyField` + `Disclosure` (leitura de documento) | `ds-1-1-leitura-e-alertas.test.tsx` |
| Seções da superfície VIVA do prontuário com `disabled={disabled}` | `ClinicalRecordSection` + `ReadOnlyField` nas seis seções (`data-readonly`) | `f1b1-clinical-sections.test.tsx` (contrato re-apontado), `ds-1-1-leitura-e-alertas.test.tsx` |
| Linha de ações do detalhe do agendamento com azul + verde + âmbar + vermelho (4 cores competindo) | Uma ação PRIMÁRIA por etapa (a primeira do fluxo permitida) e transições NEUTRAS; tintura só no destrutivo | `detalhe-*` em `measurements.json` (`acoes.primario`, `acoes.coloridos`) |
| Seta do `Select` dentro do `FieldShell` tilhando pela largura do campo | A seta é desenho do DS, declarada no CSS do shell (uma vez, à direita) | `campo-*` em `measurements.json` (`setaRepete: "no-repeat"`) |

## 9.10 Onde o Material NÃO é seguido (e por que é melhor para o GoDoutor)

1. **Paleta, marca, ícones e formas:** nada foi copiado. O Material entra como
   comportamento; a identidade (acento, superfícies, ícones do sistema) é nossa —
   absorver o visual do Material seria trocar de produto, não de qualidade.
2. **Cantos arredondados de 16dp no side sheet / raio grande em overlays:** o
   detalhe do GoDoutor é um painel de trabalho encostado na borda. Raio ali cria
   "card solto" e desalinha a leitura com a grade da Agenda (defeito medido,
   §9.4). Mantemos a borda reta e a divisória de 1px.
3. **Menus de AÇÃO com largura sempre igual à do gatilho:** o `DropdownMenu`
   (kebab de ações) tem piso de 190px e alinha pela borda do gatilho — igualar
   por igualar deixaria a lista de ações estreita demais para o rótulo em
   português. Já o menu **anexado a um campo** (Combobox/Autocomplete dentro do
   `FieldShell`) acompanha a largura do campo, que é exatamente o que o Material
   descreve para texto + lista. São dois casos, não uma regra única.
4. **Busca dentro do `Select`:** o select nativo (com o shell canônico) continua
   sendo o certo para listas curtas de clínica (2–8 opções) porque é o controle
   que o sistema operacional acessibiliza de graça; listas longas usam
   `Combobox`, que já tem busca e teclado. Instalar um select "Material-like"
   para tudo seria trocar um padrão do SO por um componente nosso sem ganho real.
5. **Molas (spring) com bounce do esquema *expressive*:** produto utilitário
   (§9.8) — a previsibilidade do ease-out de 120–200ms é melhor para quem
   opera a agenda o dia inteiro do que a expressividade do movimento.
6. **Snackbar para tudo:** confirmação local (bloqueio criado, agendamento
   salvo) fica **no fluxo** onde a ação aconteceu; toast é para o que acontece
   fora do contexto da tela (403 global). Material permite ambos; a escolha é
   pela distância entre a ação e o olhar de quem opera.
