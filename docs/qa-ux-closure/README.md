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
| Toolbar linha 1 | 34 / 40 / 34 / 40 | **40** em todas; 44 no toque (390) |
| Bloqueio | caixa âmbar grande (ver `before/agenda-day-1440.png`) | indicador **42px**, 1 hachura na grade, `bigAmberBox false` |
| Erros de página | nenhum | **nenhum** |

## 3. Evidências

`before/` e `after/` (1440 · 1366 · 1024 · 390): `shell-*-rail-closed`, `shell-*-group-open`, `shell-*-group-cursor-inside`, `shell-*-group-swap`, `shell-*-drawer`, `agenda-day-*`, `agenda-week-*`, `agenda-list-*`, `agenda-day-hover-*`, `agenda-detail-*`, `agenda-new-booking-*`, `dashboard-390`, `measurements.json`.

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
| Suíte completa | **3283 passaram / 6 falharam** (237 arquivos: 233 ok, 4 falhando) |

Falhas **baseline**, mantidas separadas (nenhuma é regressão desta missão):

1. `a34-instagram` ×3 (B9 — limite de texto, canal do inbox, outbound);
2. `automation-audit-p4` (poda de histórico);
3. `convergence-wave2` (`LEGACY_DOC_TABLE`);
4. `pipeline` (P3 — esteira → agendamento, “não é possível agendar no passado”).

Contratos **superseded** por esta missão foram atualizados com a razão declarada no próprio teste (não “consertados de volta”): `fase2-ws-sheet-close`, `homologacao-p0-autosave-client`, `godoutor-visual`, `pre-f1-last-gates`, `godoutor-ui-contract-v2` (união canônica do DS ganhou `destructive-soft`). Novos contratos: `agenda-ux-closure.test.tsx` (19 testes), `WorkspaceTopbar.test.tsx`.

## 5. O que ainda está visualmente diferente da referência e por quê

1. **Cor e marca.** A referência é roxa; aqui é verde/neutra do GoDoutor e o logo é o da clínica. É decisão da missão (item 7) — nada de paleta, logo, ícones ou ilustrações da referência.
2. **Segunda navegação como arquitetura.** A referência usa uma coluna dupla permanente. Aqui o rail é fino e o painel só existe enquanto o ponteiro está no grupo (ou por foco/teclado). Foi mantido o **comportamento** (agrupamento, conexão física, swap sem fechar, densidade), não a arquitetura de duas colunas fixas.
3. **Densidade do cartão de evento.** O cartão mostra horário + pet + serviço (o tutor é contexto). A referência mostra mais linhas por padrão; a decisão preserva a leitura de grade e não esconde informação — tudo está no resumo de hover e no detalhe.
4. **Blocos operacionais.** Ficou hachura + etiqueta em vez de faixa colorida cheia. O texto longo (motivo/escopo) vive no formulário do bloqueio, que já existia; a grade não repete texto que não cabe.
5. **Modal de detalhe em 390px.** Ocupa 96% da tela (por design): em telas estreitas um painel lateral de 460px não teria como existir; a largura continua vindo do mesmo token, apenas limitada pela viewport.
6. **Proporções exatas de espaçamento/tipografia da referência** não foram copiadas: os valores são os tokens do DS (`--gd-control-h`, `--gd-space-*`, `--gd-radius-*`), então a “régua” é a nossa — o que se iguala é o *critério* (uma métrica por função, um sistema de overlay, uma identidade por tela).
7. **Grupos “Página” (legado) e “Meu perfil”** continuam fora da coluna quando `GODOUTOR_LEGACY_PAGES` está desligada — é decisão de **produto**, não de menu; a rota permanece viva por URL/deep link e o painel do grupo dono apresenta os destinos autorizados.
