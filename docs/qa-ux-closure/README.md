# Homologação — MISSÃO UX CLOSURE · App Shell + Agenda + Design System

Base: `main` em `9f423ef` (após PR #63). Branch: `arena/40573dbd-instalink` → **um PR, aberto, NÃO mergeado**.

Escopo: comportamento, hierarquia, densidade e interação. **Nada de marca, cor, ícone, texto ou pixel da referência** — a identidade segue verde/neutra do GoDoutor.
Intocados por contrato: conexão de banco, auth, tenant, Acesso Clínico, permissões, regras da Agenda, autoridade de agendamento e schema.

## 1. Mapa antes → depois (componentes)

| Superfície | Antes | Depois | Origem canônica |
|---|---|---|---|
| Topbar | faixa de conteúdo; sem nome da clínica | **full-width** acima de tudo, `[logo] Andrioni Veterinaria` à esquerda + busca global + ações | `WorkspaceTopbar.tsx`, `.ws-clinic*` |
| Sidebar | 216–232px colorida, com identidade repetida e botão flutuante de expandir/recolher | **rail branco de 60px**; sem identidade, sem controle de pin (existe em 1024–1440) | `--gd-rail-w`, `.workspace-sidebar` |
| Grupos | card flutuante, com vão morto de 4px | painel **fisicamente conectado** (left 60 = rail right 60), divisória fina, swap sem fechar, 140–180ms | `sidebar-peek.ts`, `WorkspaceNavigation.tsx` |
| Projeção de menu | `sidebar:false` sumia com destino autorizado (ex.: `/atendimento`) | **duas réguas explícitas**: coluna = frequência; **painel do grupo = todos os autorizados**; alias (`compatOnly`) fora | `workspace-navigation.ts` (`workspaceRailItems`/`workspacePanelItems`), `panel.ts` |
| Hover do evento | resumo acima do evento, `title` nativo do navegador | `HoverCard` a **10px à direita** (flip quando apertado), 150–200ms, com `Ver detalhes` e `Reagendar` quando a regra autoriza; **zero `title`** na grade | `ui.tsx` (`HoverCard`), `.ag-hover__card` |
| Ver detalhes | `WorkspaceSheet` de 620px / 95% da tela | **`DetailPanel`** lateral: 460px por token, 16px de margem, animação 170ms, foco entra no título e **volta para o evento** | `ui.tsx` (`DetailPanel`), `--gd-detail-w` |
| Novo/editar agendamento | sheet lateral de 1366px (95%) | **modal central** 672px, fluxo Paciente → Serviço → Profissional → Data/Horário → confirmação | `Dialog`/`Drawer variant="dialog"`, `--gd-booking-modal-w` |
| Bloqueios operacionais | caixa âmbar gigante de texto no topo da grade | **hachura no lugar + etiqueta compacta** (42px) e indicador de uma linha | `.ag-block*`, `.ag-blocks-bar*` |
| Toolbar | 34 / 40 / 28px misturados por página | **uma métrica**: linha 1 toda em `--gd-control-h` (40px; 44px no toque a 390) | `.gd-toolbar`, `il-control--*` |
| Ordem de camadas da grade | sombreamento de indisponível em `z-[5]`, **por cima** do atendimento | ordem única documentada: 0 indisponível · 1 atendimento · 10 bloqueio | `globals.css` §“ORDEM DE CAMADAS DA GRADE” |
| Botão destrutivo | vermelho cheio mesmo em repouso (fila de ações, gatilhos) | `destructive-soft` (repouso) e `destructive` só na **confirmação final** | `ui.tsx`, catálogo `/dev/design-system` |

### Defeitos reais encontrados na auditoria (não eram “estética”, eram bug)

1. **Atendimento invisível dentro de exceção de disponibilidade.** O sombreamento do dia especial tinha `z-[5]` e os cartões não tinham `z-index`: o intervalo inteiro de um agendamento ficava **pintado por baixo** do sombreamento e sobrava só uma faixa fina na borda. Corrigido na ordem de camadas (regra escrita em um só lugar).
2. **Painel de detalhe com a largura do conteúdo.** O `DetailPanel` recebia `width = 'var(--gd-detail-w)'` e injetava esse `var()` no próprio elemento que define a variável → `--gd-detail-w: var(--gd-detail-w)`, `width: min(var(--gd-detail-w), …)` não resolvia e a largura caía para *auto* (448–456px, variando com o texto). Agora o default é o token, com **fallback do mesmo valor** na regra.
3. **Foco não voltava para o evento.** O `Ver detalhes` vive no card de hover, que desmonta quando o ponteiro sai; ao fechar, o foco ficava órfão. O `DetailPanel` ganhou `returnFocus` e a Agenda passa o **botão do evento**.
4. **Preço de fixture em reais** (R$ 1,80 em vez de R$ 180,00): erro do gerador de dados de QA, não da interface — o catálogo trabalha em centavos.
5. **Identidade ilegível em 390px.** Com o nome completo na topbar, em 390 ele era cortado em “Andri…”. A prioridade da topbar passou a ser explícita: **identidade > busca > ações**; em ≤479px a busca recolhe para o ícone (40px, mesma métrica) e **volta à largura total quando recebe foco** (`:focus-within`), por cima dos vizinhos, sem mexer no rail nem no conteúdo. Os atalhos secundários (Conversas e Ajuda) saem primeiro porque existem também na navegação e no rodapé do menu — nenhuma função se perde. Medido: `clinicNameTruncated: false` em 1440/1366/1024/**390**.
6. **Capturas de Semana/Lista não eram Semana/Lista.** O script colava `&view=week` sobre uma URL que já trazia `view=day`; o navegador mandava `view=day&view=week` e a tela (que lê a primeira ocorrência) seguia em Dia. As duas capturas de “Semana” eram o Dia. Corrigido no `capture.mjs`, que agora **verifica o que capturou** (`views` na URL + chip selecionado do `Segmented`): `view-week-*` → `{views:['week'], pressed:['Semana']}`, `view-list-*` → `{views:['list'], pressed:['Lista']}`.

## 2. Medições (Chromium real, `measurements.json` em `before/` e `after/`)

| Métrica | Antes | Depois |
|---|---|---|
| Rail 1440 / 1366 / **1024** | 60px / 60px / **ausente** | 60px / 60px / **60px visível** |
| Identidade (1440) | topbar `["Ctrl K","AA"]`, sidebar `["AV"]` | topbar `["AV","Andrioni Veterinaria",…]`, `clinicLeftX 16`, sidebar **sem** o nome |
| Identidade (390) | nome cortado em “Andri…” (medido depois de virar defeito) | nome **completo e não truncado**, logo presente, busca recolhida a 40px que expande no foco, drawer **sem** o nome |
| Semana / Lista (1440–390) | capturas eram, na prática, o Dia (parâmetro `view` duplicado) | `view` única verificada + chip ativo: `{views, pressed}` em `measurements.json` |
| Painel de grupo (1440) | `panelLeft 64`, **gap 4**, width 216 | `panelLeft 60`, **gap 0**, width 232, swap Clínica→Automação sem fechar |
| Hover card (1440) | gapX **−634**, gapY −113 (card em cima do evento) | gapX **10**, gapY **0**, 278×180 dentro da viewport |
| `title` nativo na grade | **13** | **0** (em 1440/1366/1024/390) |
| Novo agendamento (1440) | 1366px (**95%**) | **672px (47%)**, centralizado |
| Detalhe (1440) | (sem métrica) | painel **460px**, rightGap 16, topGap 16, `escClosed true`, `focusBackOnEvent true` |
| Detalhe (390) | — | 374px (96%), margens 8px |
| Toolbar linha 1 | 34 / 40 / 34 / 40 | **40** em todas; 44 no toque (390). Medição por CONTROLE: `{hoje, anterior, proximo, data, dia, semana, lista, filtros, fila, bloquear, novo} = 40` e `identical: true` nos 4 viewports (as setas continuam **quadradas**) |
| Varredura GLOBAL de controles (item 6) | — | **12 páginas × 4 viewports = 0 violações** (`/dashboard /agenda /clientes /configuracoes /equipe /servicos /pagina /campanhas /produtos /pedidos /recursos /agente`) |
| Popover do slot → modal central (item 3C) | — | popover **338×486** ancorado no slot, com "Mais opções" → **modal central 672px** (`isCentralDialog: true`) em 1440/1366/1024 e 366px (94%) a 390 |
| Bloqueio | caixa âmbar grande (ver `before/agenda-day-1440.png`) | indicador **42px**, 1 hachura na grade, `bigAmberBox false` |
| Erros de página | nenhum | **nenhum de aplicação** (`consoleErrors: []`). O que sobra é ruído de roteador classificado à parte em `consoleRuidoConhecido` (prefetch RSC abortado pelo próprio roteador + `401` esperado de `/api/auth/me` no estado deslogado) |

## 3. Evidências

`before/` e `after/` (1440 · 1366 · 1024 · 390): `shell-*-rail-closed`, `shell-*-group-open`, `shell-*-group-cursor-inside`, `shell-*-group-swap`, `shell-*-drawer`, `agenda-day-*`, `agenda-week-*`, `agenda-list-*`, `agenda-day-hover-*`, `agenda-detail-*`, `agenda-new-booking-*`, `agenda-slot-popover-*`, `agenda-slot-more-modal-*`, `dashboard-390`, `measurements.json`.

Ampliação do rail (`after/shell-1440-rail-zoom.png`, capturada em 2×): prova que a seta do grupo fica **dentro** do rail — `vazam: []` na verificação de transbordo contra a borda interna (x = 59).

Animações (item 8: “se possível um pequeno vídeo/GIF”):
- `after/shell-nav-hover-swap-retract.gif` — rail → hover no grupo → painel conectado → troca Clínica↔Automação↔Gestão sem fechar → retração com cursor fora.
- `after/agenda-hover-summary-detail.gif` — evento → resumo colado → `Ver detalhes` → painel lateral → Escape devolvendo o foco ao evento.

Reprodutível: `node scripts/qa-ux-closure-fixture.mjs` (localhost, dados sintéticos, sem `DATABASE_URL`) → `node docs/qa-ux-closure/capture.mjs before|after` → `node docs/qa-ux-closure/record.mjs`.

## 4. Testes e gates

| Gate | Resultado |
|---|---|
| `git diff --check` | limpo |
| `tsc --noEmit` | sem erros em arquivos desta missão. Resta **1 erro de baseline** em `src/lib/__tests__/production-db-routing.test.ts` (`NODE_ENV` faltando em `as NodeJS.ProcessEnv`) — arquivo do PR #63, **não tocado aqui** (`git diff --name-only main -- <arquivo>` = 0). O `next build` não o inclui (não é rota) e passa. |
| `npm run build` | ✓ compilado, 136 páginas estáticas |
| Suíte completa | **3291 passaram / 6 falharam** (237 arquivos: 233 ok, 4 falhando) — os 6 são exatamente as falhas de baseline listadas abaixo |

Falhas **baseline**, mantidas separadas (nenhuma é regressão desta missão):

1. `a34-instagram` ×3 (B9 — limite de texto, canal do inbox, outbound);
2. `automation-audit-p4` (poda de histórico);
3. `convergence-wave2` (`LEGACY_DOC_TABLE`);
4. `pipeline` (P3 — esteira → agendamento, “não é possível agendar no passado”).

Contratos **superseded** por esta missão foram atualizados com a razão declarada no próprio teste (não “consertados de volta”): `fase2-ws-sheet-close`, `homologacao-p0-autosave-client`, `godoutor-visual`, `pre-f1-last-gates`, `godoutor-ui-contract-v2` (união canônica do DS ganhou `destructive-soft`). Novos contratos: `agenda-ux-closure.test.tsx` (**27 testes**, incluindo o bloco `3A · posicionamento do resumo` e o bloco `6 · métricas canônicas`), `WorkspaceTopbar.test.tsx`.

## 5. O que ainda está visualmente diferente da referência e por quê

1. **Cor e marca.** A referência é roxa; aqui é verde/neutra do GoDoutor e o logo é o da clínica. É decisão da missão (item 7) — nada de paleta, logo, ícones ou ilustrações da referência.
2. **Segunda navegação como arquitetura.** A referência usa uma coluna dupla permanente. Aqui o rail é fino e o painel só existe enquanto o ponteiro está no grupo (ou por foco/teclado). Foi mantido o **comportamento** (agrupamento, conexão física, swap sem fechar, densidade), não a arquitetura de duas colunas fixas.
3. **Densidade do cartão de evento.** O cartão mostra horário + pet + serviço (o tutor é contexto). A referência mostra mais linhas por padrão; a decisão preserva a leitura de grade e não esconde informação — tudo está no resumo de hover e no detalhe.
4. **Blocos operacionais.** Ficou hachura + etiqueta em vez de faixa colorida cheia. O texto longo (motivo/escopo) vive no formulário do bloqueio, que já existia; a grade não repete texto que não cabe.
5. **Modal de detalhe em 390px.** Ocupa 96% da tela (por design): em telas estreitas um painel lateral de 460px não teria como existir; a largura continua vindo do mesmo token, apenas limitada pela viewport.
6. **Proporções exatas de espaçamento/tipografia da referência** não foram copiadas: os valores são os tokens do DS (`--gd-control-h`, `--gd-space-*`, `--gd-radius-*`), então a “régua” é a nossa — o que se iguala é o *critério* (uma métrica por função, um sistema de overlay, uma identidade por tela).
7. **Seta do grupo no rail.** No rail de 60px a largura útil do item é ~37px: `ícone 24 + gap 10 + seta 15` empurrava a seta 14px para fora e ela era **cortada** pela divisa. Ela virou um sinalizador de 9px no canto do próprio item (mesma caixa do item direto, nada vaza). A referência resolve isso porque tem coluna larga com rótulo — foi adaptação de comportamento, não cópia de forma.
8. **Botões secundários escritos à mão em `/pagina`** (cinza, ex.: “Voltar ao automático”) continuam locais: estão na régua (40px) e não pertencem à família de marca, então não afetam a métrica unificada — é dívida cosmética de classe, registrada acima.
9. **Grupos “Página” (legado) e “Meu perfil”** continuam fora da coluna quando `GODOUTOR_LEGACY_PAGES` está desligada — é decisão de **produto**, não de menu; a rota permanece viva por URL/deep link e o painel do grupo dono apresenta os destinos autorizados.

## 6. REQUISITO → IMPLEMENTADO → EVIDÊNCIA → PENDÊNCIA

Régua: **PENDÊNCIA** abaixo é *o que falta*, não *o que é diferente*. Nenhum item do pedido original ficou sem implementação ou sem evidência visual.

| # | Requisito | Implementado | Evidência (arquivo ou medição real) | Pendência |
|---|---|---|---|---|
| 1 | Topbar full-width; logo + nome completo da clínica à esquerda | `WorkspaceTopbar` (`.ws-clinic*`) acima de tudo; identidade só na topbar | `identity-*`: `clinicName: "Andrioni Veterinaria"`, `clinicNameVisible: true`, `clinicNameTruncated: false` em 1440/1366/1024/390; `clinicLeftX 16`; `topbarWidth 1440`; `sidebarHasClinicName: false`; `shell-*-rail-closed.png` | — |
| 1 | Sidebar = rail branco estreito (56–60px); sem botão flutuante de expandir/recolher | `.workspace-sidebar` com `--gd-rail-w` = 60, `position: sticky` sob a topbar, 1px de divisa | `rail-1440/1366/1024 = {width: 60, visible: true}`; `railCollapseControls: 0`; `shell-1440-rail-closed.png` | — |
| 1 | Grupos (Clínica, Automação, Gestão, Configurações); links diretos seguem diretos | `workspaceRailItems` (coluna) × `workspacePanelItems` (painel) | `panel-*`: grupo `clinica`; troca `automacao` → `gestao` com `panelLeft 60`, `gap 0` | — |
| 1 | Painel de grupo conectado ao rail, slide 140–180ms, sem vão morto/card flutuante/sombra | `sidebar-peek.ts` + `.ws-peek` (left = largura do rail, `border-left: 0`, `box-shadow: none`, `--gd-motion-slow`) | `panel-1440`: `railRight 60`, `panelLeft 60`, **`gap 0`**; `shell-1440-group-open.png`; **fronteira medida: UMA linha vertical somente** (x = 59,5 — `border-right` do rail; a de 291,5 é a borda externa do próprio painel) | — |
| 1 | Aberto com ponteiro no ícone OU no painel; fecha só ao sair de rail+painel, com atraso | `onGroupEnter`/`onGroupLeave` com delay; painel não fecha no trânsito | `panel-*`: `openWithCursorInside: 1`; `closedAfterLeave: true`; GIF `shell-nav-hover-swap-retract.gif` | — |
| 1 | Swap Clínica→Automação→Gestão sem fechar; equivalente por teclado/foco | mesmas funções no rail e por `ArrowRight/ArrowDown/Enter/Space` + Escape | `panel-*`: `keyboard {openedByArrow, focusInPanel, closedByEscape, focusBackOnGroup} = true`; GIF de swap | — |
| 1 (P0) | Nenhuma rota autorizada pode desaparecer | duas réguas explícitas em `workspace-navigation.ts`/`panel.ts`; alias `compatOnly` fora do painel | `panel-*` lista os destinos do grupo; testes de projeção no `agenda-ux-closure.test.tsx` | — |
| 2 | Identidade na topbar, sem repetir na sidebar, com busca global + ações, sem breadcrumb | `.ws-clinic*` na topbar; sidebar sem bloco de identidade; busca + ações à direita | `identity-*`: `topbarText ['AV','Andrioni Veterinaria','Ctrl K','AA']`, `sidebarText` sem o nome; `drawerHasClinicName: false` a 390 | — |
| 3A | Resumo no hover do evento, 150–200ms, 8–12px do evento, preferir direita, flipar, nunca fora da tela, mantém aberto com cursor no card, conteúdo compacto, "Ver detalhes", ação secundária autorizada, sem `title` nativo | `HoverCard` + `useAnchoredLayer` (prefer → flip → stack) medindo o **elemento posicionado** (`positionRef`) | `hovercard-placement-{1440,1366,1024} = {sides: ['right','right','right','left','left','left'], gapsOk: true, allInsideViewport: true, noOverlap: true}`; `390 = ['stacked'×6]`; gaps 8–12 (`gapX 10`); `data-place` ex. `l785,t356,w278,h180` / `l492,t420,w278,h180`; `openWithCursorInside: true`; `native-title*: 0` em 1440/1366/1024/390; `agenda-hover-flip-1440.png` | — |
| 3B | "Ver detalhes" = modal LATERAL direito, 420–480px no desktop, 180–220ms, Escape, foco entra e volta, largura adequada no mobile | `DetailPanel` (`--gd-detail-w` 460px), `returnFocus` no botão do evento | `detail-1440/1366/1024`: `460px`, `rightGap 16`, `topGap 16`, `escClosed: true`, `focusBackOnEvent: true`; `detail-390`: `374px` (96%), margens 8; `agenda-detail-*.png` | — |
| 3C | Novo/editar = modal CENTRAL com o fluxo Paciente → Serviço → Profissional → Data/Horário → confirmação; popover curto no slot e "Mais opções" abrindo o central | `Dialog`/`Drawer variant="dialog"` 672px + `QuickBookingPopover onMore(seedIntent())` semeando o formulário completo | `new-booking-1440/1366/1024 = {672px, centered: true}` (47–49%), `390 = 366px` (94%); `slot-popover-* = {338×486, hasMoreOptions: true}` nos 4 viewports; `slot-more-modal-* = {672×792, isCentralDialog: true}`; `agenda-slot-popover-*.png`, `agenda-slot-more-modal-*.png`, `agenda-new-booking-*.png` | — |
| 4 | Grade: só apresentação — mais leve, cabeçalhos nítidos, linhas discretas, conteúdo mínimo, now-line discreta, seleção/hoje claros, indisponível/bloqueado semânticos | `globals.css` (ordem de camadas declarada em um lugar); cartão = horário + pet + serviço | `agenda-day-1440/1366/1024/390.png`; `blocks-*`: `{gridBlocks: 1, hatched: true, bigAmberBox: false, indicator.h 42}`; `view-week-*`/`view-list-*` com `pressed` correto | — |
| 5 | Uma métrica na toolbar (Hoje, setas, data, Dia/Semana/Lista, Filtros, Fila, Bloquear horário, Novo agendamento) | `.gd-toolbar` + `il-control--*` + `--gd-control-h`; no toque, `--gd-control-h-touch` | `toolbar-row1-heights-{1440,1366,1024} = {identical: true, distintos: [40], iconButtonsQuadrados: true}`; `390 = {identical: true, distintos: [44]}`; recorte interno do `Segmented` registrado à parte (`opcoesInternas` 32 dentro do trilho de 40/44) | — |
| 6 | Auditoria global do DS; migrar para os primitivos canônicos; nada de altura/raio/sombra por página | régua do controle no canônico: `.il-field-control` (40 fora do `.il-platform`), `.il-control--lg` (44), `.il-option-choice` (34), `.pe-nav__item` (34); páginas migradas (`configuracoes`, `clientes`, `pagina`, `campanhas`, `agente`); no toque, campo + Segmented sobem a 44 | **Varredura `controls-global-*`: 0 violações em 12 páginas × 4 viewports** (o que resta fora da escala é classificado e nomeado: *nested*, *link*, *row*, *switch*, *textarea*). Defeitos reais corrigidos nesta rodada: campo de 38px em `/configuracoes` e `/clientes`, CTA `lg` de 42px em `/agente`, chip de 36px, item de nav de 34,75px em `/pagina`, seta do grupo cortada no rail, campo/`Segmented` em 40 ao lado de botões de 44 a 390 | Os botões secundários cinza escritos à mão em `/pagina` (ex.: "Voltar ao automático") continuam locais: estão **na régua** (40px) e não são da família de marca; migração é cosmética de classe, sem efeito de métrica medido — fica registrada como dívida menor |
| 7 | Não copiar a referência (roxo, logo, ícones, textos, proporções, segunda navegação como arquitetura) | identidade verde/neutra do GoDoutor; rail + painel transitório | `shell-*-rail-closed.png`, `shell-1440-group-open.png` | — |
| 8 | QA obrigatória: gates + homologação real em 1440/1366/1024/390 + `docs/qa-ux-closure/` + GIF | `capture.mjs` (mede e verifica o que capturou) e `record.mjs` | `git diff --check` limpo · `tsc` só com o baseline · `npm run build` ✓ 136/136 · suíte **3291 ok / 6 baseline** · `consoleErrors: []`; 2 GIFs + PNGs nos 4 viewports | — |
| 9 | Um branch, um PR exclusivo, aberto, **sem merge** | `arena/40573dbd-instalink` → PR #64 | PR aberto e mergeável; **nenhum merge executado** | Merge é decisão do dono do produto — este PR permanece aberto para homologação |
