# GoDoutor Design System 1.0

> **Status:** em implementação (fase “GoDoutor Design System 1.0 — App Shell e Agenda UX”).
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
| Ícones/cabeçalhos de página com chip próprio | `PageHeader`/`ActionSection` | dashboard, clientes, equipe, resultados, financeiro | ⏳ |
| `lib/appearance.ts` (tokens de nav legados) | — | `src/lib/appearance.ts` | ⏳ (remover quando o campo sair do payload) |
| Board de oportunidades / kanban com cartões próprios | `Table`/`Card` semântico | `dashboard/EsteiraView.tsx`, `catalog-panels.tsx` | ⏳ (fora do escopo visual desta PR: domínio intacto) |

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
