# AUDITORIA FUNCIONAL E VISUAL DA AGENDA — RODADA 2 (PR #64)

> Branch `arena/40573dbd-instalink` · base `main` = `9f423ef` · HEAD auditado desta rodada = `4cd669f` (o mesmo commit do deploy Ready que foi inspecionado) + as correções desta rodada.
> Ambiente: banco LOCAL (`data/godoutor.db.json`), fixture QA descartável, Chromium 153 headless real, `npm run dev`.
> Nenhum dado real foi tocado: toda mutação aconteceu na fixture QA e foi **revertida ao fim** (ver §6).

---

## 1 · MATRIZ A/B — Clínica Experts (referência) × GoDoutor (auditado)

Estado: **correto** · **defeito** · **ausente** · **não observável**.
A coluna "Evidência" aponta o artefato desta pasta (PNG/GIF/JSON) que prova o estado.

| # | Interação | Referência (Clínica Experts) | GoDoutor antes | GoDoutor agora | Estado | Evidência |
|---|---|---|---|---|---|---|
| 1 | Hover no evento | resumo compacto colado, sem painel lateral | resumo já colado, mas 252px, sombra de 60px e botões esticados | 244px, 10px de distância, sombra média, CTA "Ver detalhes" + "Reagendar" do tamanho do rótulo | **correto** | `a-hover-*.png`, `a-hover-resumo-detalhe.gif`, `audit-measurements.json → hover-*` |
| 2 | Atraso do hover | ~150–200 ms | 180 ms (constante) | 184–186 ms medidos (evento real → cartão) | **correto** | `hover-* → atrasoDeAberturaMs` |
| 3 | Inverter quando falta espaço | vira para a esquerda e fica na viewport | já invertia | a 390px o cartão abre à esquerda, `dentroDaViewport: true` | **correto** | `hover-390`, `a-hover-390.png` |
| 4 | Permanecer com o cursor no cartão | sim | sim | sim (`permaneceAoEntrarNoCartao: true`) | **correto** | `hover-*` |
| 5 | Tooltip nativo | não existe | `title` já removido | `tituloNativoNoEvento: null` em todas as larguras | **correto** | `hover-*` |
| 6 | Clique esquerdo no evento | abre o detalhe | abre o painel lateral preso à direita | idem, com foco no título e Escape devolvendo o foco ao evento | **correto** | `a-detalhe-*.png`, `detalhe-*` |
| 7 | **Botão direito no evento** | menu de contexto com ações de status | **mostrava o mesmo resumo do hover** (nenhum menu) | menu REAL: Ver detalhes · transições válidas · Reagendar · Duplicar · Cancelar | **corrigido nesta rodada** | `a-ctxmenu-*.png`, `a-menu-contexto-status.gif`, `ctxmenu-1440` |
| 8 | Teclado equivalente | Shift+F10/Menu | ausente | `Shift+F10` e tecla `Menu` abrem o mesmo menu, foco no 1º item, ↑↓/Home/End, Enter, Escape devolve o foco | **corrigido nesta rodada** | `a-ctxmenu-teclado-1440.png`, `ctxmenu-1440` |
| 9 | Transições inválidas | não aparecem | — (não havia menu) | menu derivado de `BOOKING_FLOW`: com `pending` só aparece "Confirmado" (nem Concluído, nem Faltou, nem "Reabrir") | **correto** | `transicao-1440 → invalidasAusentes` |
| 9b | Resumo do hover × menu abertos juntos | só um painel por alvo | — | com o menu aberto o resumo do hover se CALA (`resumoDoHoverSilenciado: true`) | **corrigido nesta rodada** | `ctxmenu-1440`, `a-ctxmenu-1440.png` |
| 10 | Autoridade do servidor | servidor recusa | servidor recusa | `no_show` saindo de `pending` ⇒ **422** "Não é possível mudar de…"; `completed` fora de hora ⇒ **409** | **correto** | `transicao-1440 → servidorRecusa*` |
| 11 | Mudança de status pelo menu | sim | — | `pending → confirmed` aplicado, histórico `{from,to,by:'owner'}` gravado e **revertido** | **correto** | `transicao-1440`, `a-menu-transicao-1440.png` |
| 12 | Duplicar atendimento | existe | — | "Duplicar atendimento" abre a criação **central** pré-preenchida (POST canônico; nenhuma rota nova) | **corrigido nesta rodada** | `ctxmenu-1440 → itens` |
| 13 | Excluir | exclusão existe | **ausente no produto** (o cancelamento é o caminho destrutivo; nada é apagado) | mantido ausente de propósito: "Cancelar atendimento" com confirmação canônica | **não observável / decisão de domínio** | `ctxmenu-1440 → itens`, §7 |
| 14 | Criar/editar completo | modal | central (DS 1.1) | central, confirmado por medição | **correto** | `a-modal-central-1440.png`, `a-toolbar-views.gif` |
| 15 | Confirmação de **edição** (duração/reagendar) | diálogo de decisão | **gaveta lateral** | modal **central** (460/520px) | **corrigido nesta rodada** | `a-resize.gif`, `rodada2-consistencia-visual.test.ts` |
| 16 | Arraste em horário vago | cria; cancelar limpa | seleção ficava presa | ESC / clique fora limpam a faixa na hora (2–5 ms), sem herdar estado | **corrigido nesta rodada** | `a-drag-esc.gif`, `drag-*` |
| 17 | Redimensionar duração | arraste + confirmação | arraste + confirmação | 15 → 30 min persistidos, cancelamento não grava, reversão 200, **etiqueta viva no cartão** (`11:00–11:35 · 35 min`) | **correto** | `a-resize.gif`, `a-resize-medicao.json`, `resize` |
| 18 | Toolbar (alturas) | uma família | 34/40/28px misturados | 12 controles equivalentes **todos com 40px** (variação 0) em 1440/1366/1024; 44px no toque a 390 | **correto** | `toolbar-* → variacaoDosEquivalentes` |
| 19 | Contorno ocioso nos controles | sem caixa em repouso | secundário com borda pesada | Hoje/setas/data/Filtros/Fila sem borda visível; único contorno visível é o CTA primário (por desenho) | **correto** | `toolbar-* → comBordaVisivel` |
| 20 | Ver Dia/Semana/Lista | segmentado | segmentado com contorno duplo | poço neutro de 40px com polegar suave (itens internos de 32px são o polegar, não controles equivalentes) | **correto** | `a-toolbar-views.gif`, `toolbar-* → grupoSegmentado` |
| 21 | Painel de detalhe | colado à direita, altura cheia | preso à direita, `100dvh` | 460px, `distânciaDireita 0`, altura = viewport, sem raio/sombra, foco e Escape | **correto** | `a-detalhe-*.png`, `detalhe-*` |
| 22 | Painel em tela compacta | folha cheia | **card flutuante com 8px de cada lado** (≤479px) | preso à borda, `100vw`, altura cheia | **corrigido nesta rodada** | `detalhe-390`, `a-perfil-390.png` |
| 23 | Prévias/fichas laterais | mesmo padrão | 4 superfícies já migradas (DS 1.1) | todas usam o MESMO `DetailSideModal`; nenhuma `.ws-sheet` nessas telas | **correto** | `a-perfil-*.png`, `rodada2-consistencia-visual.test.ts` |
| 24 | Perfil do paciente | resumo à esquerda, conteúdo à direita | coluna única empilhada | grade `168px + 343px` a partir de 640px de viewport; empilha a 390 | **corrigido nesta rodada** | `perfil-1440/1366/1024`, `a-perfil-1440.png` |
| 25 | Menu: rótulos de navegação | legível | 13,5px / 13px / 11px | 14px/20px no destino, no item do painel do rail e no título de grupo | **corrigido nesta rodada** | `menu-* → fonteDo*`, `a-sidebar-aberta-1440.png` |
| 26 | Recolher/expandir o menu | sim | restaurado (DS 1.1 + rodada 2) | controle no rodapé, `236px` expandido, preferência sobrevive ao reload, volta ao rail de 60px | **correto** | `largura-*`, `a-sidebar-rail.gif` |
| 27 | Rotas/produtos indevidos no menu | — | travado por `OFF_MENU_ROUTES` | nenhum rótulo indevido em rail, painéis e drawer móvel | **correto** | `menu-* → rotulosIndevidos` |
| 28 | Chevrons em itens/grupos | sem seta decorativa | removidos | `chevrons: 0` nas quatro larguras | **correto** | `menu-* → chevrons` |
| 29 | Ações rápidas (Dashboard) | — | cartão dentro de cartão | 5 alvos, borda 0, fundo transparente, ícone centrado (delta 0) nas 4 larguras | **correto** | `acoes-*`, `a-dashboard-1440.png` |
| 30 | Importar/Exportar (Clientes) | — | visível a todos | só OWNER/ADMIN veem; profissional **não vê** e o servidor responde **403** nos três endpoints | **correto** | `clientes-naoadmin-*`, `a-clientes-naoadmin-1440.png` |
| 31 | Fila/Aguardando/Em atendimento como status | — | — | **não existem como status de agendamento** (são estados de Fila); a máquina tem pendente/confirmado/concluído/faltou/cancelado | **não observável (fora do domínio)** | §7 |
| 32 | Hover/contexto/status na referência | — | — | não foi possível reproduzir na Clínica Experts: **sem consulta visível** na semana 04–10/10/2026 e no dia 07/10 (só um bloqueio), ambiente sem isolamento comprovado | **não observável** | inspeção do dono do projeto (relatada) |

**Resumo da matriz:** 26 itens **corretos** (8 dos quais foram corrigidos nesta rodada: 7, 8, 9b, 12, 15, 22, 24, 25), 2 **não observáveis por decisão de domínio** (13, 31) e 1 **não observável na referência** (32). Nenhum item permanece como defeito aberto.

---

## 2 · PROBLEMA → CAUSA → ARQUIVO → CORREÇÃO

| Problema observado | Causa | Arquivo | Correção |
|---|---|---|---|
| Botão direito no evento não abria menu (mostrava o resumo do hover) | não existia primitive de menu de contexto nem ligação `onContextMenu` na grade | `src/components/ui.tsx`, `src/app/(dashboard)/agenda/page.tsx` | `ContextMenu` canônico (portal + âncora no ponteiro, ponteiro E teclado) + itens derivados de `BOOKING_FLOW` |
| Depois de fechar o menu o foco não voltava ao evento | o menu é desmontado pelo pai, então o efeito de devolução nunca via `open === false` | `src/components/ui.tsx` | devolução de foco na **limpeza** do efeito, só quando o foco ainda está no menu (não rouba o foco de um Dialog aberto por um item) |
| Confirmação de duração/reagendamento em gaveta lateral | `Drawer` sem `variant` (padrão `side`) | `src/app/(dashboard)/agenda/page.tsx` | `variant="dialog"` (central) 460px/520px |
| Painel de detalhe virava card flutuante no celular | `@media (max-width: 479px)` insetava 8px nos quatro lados | `src/styles/godoutor-design-system.css` | compacto = preso à borda, `100vw`, altura cheia (folha lateral, não card) |
| Foco não voltava ao evento ao fechar o menu | o menu é desmontado pelo pai, então o efeito de devolução (`if (open) return`) nunca rodava | `src/components/ui.tsx` | devolução na LIMPEZA do efeito, só quando o foco ainda está no menu |
| `.gd-detail` não media o viewport dinâmico de forma explícita | `inset: 0` no contêiner fixo | idem | `height: 100vh; height: 100dvh` declarados |
| Prévia do cliente era uma coluna empilhada | composição em `flex` vertical | `src/components/dashboard/ClientProfileDrawer.tsx` | grade `resumo (168px) + conteúdo` a partir de 640px; empilha abaixo |
| Rótulos de navegação abaixo de 14px | 13,5px no destino, 13px no painel do rail, 11px no título de grupo | `src/app/globals.css` | 14px/20px nos três |
| Resumo do hover com cara de painel | 252px, `--gd-shadow-overlay` (60px de blur) e dois botões esticados | `src/app/globals.css` | 244px, `--gd-shadow-md`, CTA ocupando a linha e ação secundária do tamanho do rótulo |
| Resumo do hover continuava aceso atrás do menu aberto | `HoverCard` sem noção de camada irmã mais forte | `src/components/ui.tsx`, `src/app/(dashboard)/agenda/page.tsx` | prop canônica `suppress` (fecha na hora e ignora entrada do ponteiro) + `hoverSuppressed={ctxMenu !== null}` |
| `.overlay-confirm` só sabia dizer "Descartar" | rótulos fixos no componente | `src/components/dashboard/OverlayDismissGuard.tsx` | `confirmLabel`/`discardLabel` opcionais (padrão preservado) para confirmações destrutivas fora de formulário |

---

## 3 · COBERTURA E LIMITES

**Coberto por medição em Chromium real (1440 · 1366 · 1024 · 390):** hover (atraso, distância, permanência, inversão, conteúdo, ausência de tooltip nativo), clique → detalhe (geometria, `100dvh`, foco, Escape), menu de contexto (itens, teclado, foco, viewport), transição de status aplicada e revertida, recusa do servidor (409 temporal e 422 de máquina de estados), arraste com limpeza integral, resize com confirmação/persistência/cancelamento/reversão, toolbar (alturas e contornos), menu (rótulos, larguras, persistência, rotas indevidas, chevrons), prévia do cliente, ações rápidas, permissões admin × não-admin.

**Limites honestos:**
- **Clínica Experts não foi reproduzida com dados**: não havia consulta visível na semana 04–10/10/2026 nem no dia 07/10 e o ambiente não demonstra isolamento — nada foi criado ou alterado lá. A comparação da matriz usa a inspeção relatada pelo dono do projeto; onde não houve observação, o item está marcado **não observável**.
- O atraso do hover medido (184–186 ms) é o intervalo **evento real de entrada → cartão visível** e inclui um quadro de pintura; a constante do produto é 180 ms.
- Os itens de toolbar medidos incluem o CTA primário, cujo contorno de 1px na cor da marca é **intencional** (não é contorno ocioso).
- A fila tem estados próprios (aguardando/em atendimento) que **não** são status de agendamento; nenhum menu de contexto os oferece — a máquina de estados é `pending → confirmed → completed / no_show / cancelled`.
- Não existe exclusão de agendamento no produto (decisão de domínio: cancelar preserva o histórico). Nada foi inventado para satisfazer "excluir"; o caminho destrutivo é "Cancelar atendimento" com confirmação.

---

## 4 · O QUE AINDA ESTÁ VISUALMENTE DIFERENTE DA REFERÊNCIA E POR QUÊ

1. **Densidade da grade.** A referência usa cartões mais altos com mais texto por bloco; o GoDoutor mantém o bloco compacto e joga serviço/profissional para o resumo do hover — decisão do DS 1.1 (densidade da Semana sem "carnaval").
2. **Menu de contexto com cabeçalho de identificação.** A referência mostra só a lista de ações; aqui há uma linha com paciente · data · horário. É deliberado: reduz o erro de agir no evento errado quando a grade está cheia.
3. **Confirmações centralizadas.** A referência resolve algumas edições inline; aqui toda edição de registro passa por modal central (regra do DS 1.1: leitura = painel lateral, edição = modal central).
4. **Paleta e tipografia** são integralmente do GoDoutor (tokens Barlow/DS 1.1). Nada de cor, ícone ou identidade foi copiado da referência — só padrões funcionais (proximidade, progressão, economia de texto).
5. **Rail estreito como padrão.** A referência abre a navegação expandida por padrão; aqui o rail de 60px é o padrão e a coluna de 236px é preferência persistida — mantido da rodada anterior.


---

## 5 · GATES — MESMO AMBIENTE, `main` × BRANCH

| Gate | `main` @ `9f423ef` (base da PR) | Branch @ esta rodada | Leitura |
|---|---|---|---|
| `git diff --check` | — | **rc 0** | sem conflito de whitespace/marcadores |
| `npx tsc --noEmit` | **3 erros** (`production-db-routing.test.ts`, TS2352) | **3 erros** (os MESMOS) | idêntico à base; nada novo |
| `npm run build` | — | **rc 0** (Next 14.2.35, `.next` limpo antes) | build de produção OK |
| `npx vitest run` (suíte completa) | **235 arquivos · 4 falhas · 231 passam** | **239 arquivos · 4 falhas · 235 passam** | as MESMAS 4 falhas; a branch adiciona 4 arquivos de teste novos, todos verdes |
| Arquivos que falham | `a34-instagram` (3 testes), `automation-audit-p4`, `convergence-wave2`, `pipeline` | exatamente os mesmos | **zero regressão** |
| Áreas protegidas no diff | — | `supabase`, `migrations`, `/api`, `lib/db`, `whatsapp`, `auth`: **nenhuma alteração** | nenhuma mudança de infra/domínio |

Comando exato da comparação: `npx vitest run` e `npx tsc --noEmit` executados no mesmo sandbox, com `node_modules` compartilhado, em `origin/main` (worktree `/tmp/main-compare`) e na branch.

---

## 6 · FIXTURE E LIMPEZA

- Fixture: 6 agendamentos no dia 08/10/2026 do negócio QA (`63261c1d-…`), incluindo um **pendente** (Ana Prado, 12:30) e um **confirmado** de 15 min (Diego Rocha, 11:00), criados por `scripts/qa-ux-closure-fixture.mjs` (banco local, recusa `DATABASE_URL`, só host local).
- **Mutações feitas e revertidas na mesma execução:** `pending → confirmed` pelo menu de contexto (revertido para `pending`; histórico do agendamento guarda a passagem, como manda o append-only) e duração `15 → 30 min` pelo resize (revertida para `14:15Z`). Nenhum outro registro foi tocado; nenhuma mensagem foi enviada; nenhum status/horário de dado real foi alterado.

---

## 7 · PENDÊNCIAS HONESTAS

1. **"Aguardando" e "Em atendimento" como status de agendamento não existem no domínio.** A fila tem esses estados (Fila/QueueDock) e o menu de contexto não os oferece — oferecê-los exigiria mudar a máquina de estados e as automações. Fora do escopo desta rodada por decisão de domínio.
2. **Exclusão de agendamento não existe no produto.** O caminho destrutivo é "Cancelar atendimento" (histórico preservado, horário liberado). Criar um `DELETE` seria mudança de domínio/API — não foi feito, e a matriz registra o item como ausente por decisão.
3. **A referência (Clínica Experts) não pôde ser reproduzida com dados** nesta rodada (sem consulta visível nos períodos inspecionados e sem isolamento comprovado). Os itens 6 e 7 da matriz usam a inspeção relatada pelo dono do projeto; os demais foram medidos no GoDoutor.
4. **Zoom do navegador** (125%/150%) não foi medido — as larguras de evidência são as pedidas (1440/1366/1024/390) em `deviceScaleFactor: 1`.
5. **`feedbackDuranteOArraste` do resize** agora é medido no cartão do ALVO (`11:00–11:35 · 35 min` com cartão crescendo para 64px); a rodada anterior lia o primeiro `[data-resize-hint]` do documento — de outro evento, vazio — e por isso registrava `null`. Era falha do auditor, não do produto.

---

## 8 · ÍNDICE DE EVIDÊNCIAS

**Dados medidos**
- `audit-measurements.json` — 12 passos × 4 larguras + contexto/status/resize/clientes, com console e requisições.
- `a-resize-medicao.json` — minutos antes/depois e janela antes/depois do resize.
- `antes-medicoes.json` / `depois-medicoes.json` — o mesmo script nas duas bases vivas (antes = `4cd669f`).
- `complementares.json` — zoom 200%, contraste, ação destrutiva, negativa de import/export no servidor, rotas do menu.

**Antes × depois lado a lado**
`cmp-hover-1440.png` · `cmp-ctxmenu-1440.png` · `cmp-detalhe-390.png` · `cmp-perfil-1440.png` · `cmp-dashboard-1440.png` · `cmp-menu-1440.png` · `cmp-semana-1440.png`

**Geradores dos complementares**
`node docs/qa-ux-closure-material/antes-depois.mjs antes|depois` · `node docs/qa-ux-closure-material/verificacoes-complementares.mjs`

**GIFs (gestos)**
`a-hover-resumo-detalhe.gif` · `a-menu-contexto-status.gif` · `a-drag-esc.gif` · `a-resize.gif` · `a-sidebar-rail.gif` · `a-toolbar-views.gif`

**PNGs (estados, 1440/1366/1024/390)**
`a-shell-*` · `a-menu-grupo-*` · `a-menu-aberto-*` · `a-menu-mobile-390` · `a-toolbar-*` · `a-hover-*` · `a-hover-dentro-*` · `a-detalhe-*` · `a-ctxmenu-*` · `a-ctxmenu-teclado-*` · `a-ctxmenu-estado-fresco-*` · `a-transicao-1440` · `a-drag-aberto-*` · `a-drag-esc-*` · `a-drag-clique-fora-*` · `a-perfil-*` · `a-dashboard-*` · `a-clientes-admin-1440` · `a-clientes-naoadmin-*` · `a-resize-arrastando-1440` · `a-resize-depois-1440` · `a-menu-contexto-1440` · `a-menu-transicao-1440` · `a-modal-central-1440` · `a-sidebar-aberta-1440` · `a-drag-popover-1440` · `a-drag-esc-limpo-1440` · `a-drag-cancelar-1440`

**Geradores (reproduzem tudo)**
`node docs/qa-ux-closure-material/audit.mjs` · `node docs/qa-ux-closure-material/record-audit.mjs` · `node docs/qa-ux-closure-material/round2.mjs` · `node docs/qa-ux-closure-material/record2.mjs` (exigem `npm run dev` + as duas fixtures).


---

## 9 · ANTES × DEPOIS COM O MESMO SCRIPT, EM DOIS SERVIDORES

Para não depender de impressão, o MESMO script (`antes-depois.mjs`) rodou em duas bases vivas ao mesmo tempo, com o MESMO banco e a MESMA fixture:

- **antes** = `http://127.0.0.1:3001` — worktree do commit **`4cd669f`**, que é exatamente o commit do deploy Ready que foi inspecionado;
- **depois** = `http://127.0.0.1:3000` — HEAD desta rodada.

| Medida | ANTES (`4cd669f`, o que foi inspecionado) | DEPOIS (esta rodada) | Leitura |
|---|---|---|---|
| Botão direito no evento | `existe: false` — **nenhum menu**; o resumo do hover seguia aceso (`hoverAceso: true`) | `existe: true` com `[Ver detalhes, Confirmado, Reagendar, Duplicar atendimento, Cancelar atendimento]`; `hoverAceso: false` | reproduz a observação do dono do projeto e mostra a correção |
| Shift+F10 | `false` | `true` | teclado equivalente |
| Detalhe a 1440 | x 980 · 460 · 900 · preso | idêntico | sem regressão |
| Detalhe a 390 | x **8**, largura **374**, topo **8**, altura **828** (card flutuante) | x **0**, largura **390**, topo **0**, altura **844** (preso à borda) | defeito de crachá medido antes/depois |
| Rótulo de navegação | **13,5px / 17,55px** | **14px / 20px** | régua do DS 1.1 |
| Prévias: resumo × conteúdo | `temGrade: false`; resumo **à direita** do conteúdo | `temGrade: true`, colunas **168px 343px**, resumo à esquerda | duas colunas |
| Ações rápidas do Dashboard | borda **1px**, fundo branco (card dentro de card) | borda **0**, fundo transparente | sem card-em-card |
| Resumo do hover | 278×180 · 229 ms até aparecer | 270×173 · 244 ms | ambos brancos, com CTA e status |
| Alças de resize na Semana | 6 eventos / 6 alças | 6 / 6 | nada tocado, nada mutado |
| Controles da barra (amostra da 2ª faixa) | 3 controles de 40px, variação 0 | idem | régua mantida |

Artefatos: `antes-*.png`, `depois-*.png`, `antes-medicoes.json`, `depois-medicoes.json` e os pares lado a lado **`cmp-*.png`** (hover, menu de contexto, detalhe 390, perfil, dashboard, menu, semana).

> **Nota honrada sobre um falso alarme:** durante a montagem desta seção, um probe intermediário (`locator.click({button:'right'})` logo após o `goto`) não achou o menu. Investigado com `MutationObserver` em três tempos de espera (500/2500/6000 ms): o menu abre **sempre** (32–51 ms depois do clique) e permanece. A falha era do probe — o auto-scroll do Playwright trocava o elemento sob o ponteiro —, **não** do produto. Não há mudança de código associada a esse episódio.

---

## 10 · VERIFICAÇÕES COMPLEMENTARES (rodada 3)

Além do audit principal, um segundo script (`verificacoes-complementares.mjs` → `complementares.json`, `c-*.png`) mede o que costuma escapar:

| Verificação | Resultado |
|---|---|
| **Zoom 200%** (viewport 720×450 @2x) | `overflowX: 0` (nada vaza), 6 eventos visíveis, 12 controles funcionais na barra, menor alvo 36px, detalhe preso à direita com altura cheia (`x 260 · 460 · distância 0`) |
| **Contraste WCAG AA** | nav **15,8:1** · título da página **16,3:1** · nome do evento **6,5:1** · rótulo de status **6,5:1** — todos ≥ 4,5:1 |
| **Ação destrutiva** | "Cancelar atendimento" no menu abre confirmação com o que vai acontecer ("O horário volta a ficar livre e o registro fica como cancelado no histórico — nada é apagado"); Escape sai sem gravar (`statusPreservado`) |
| **Import/export (não-admin, no SERVIDOR)** | os três endpoints respondem **403** "Seu perfil não tem permissão para esta ação." — esconder o botão não é a defesa |
| **Menu: rotas legadas/contextuais** | nenhuma ("Recursos", "Execuções", "Payload", "Testes internos" ausentes) |
