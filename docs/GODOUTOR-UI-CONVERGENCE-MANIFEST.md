# GoDoutor · Manifesto de convergência visual

Status: **gate visual canônico da PR #69 executado** (build `r10`). Lista o que foi
medido no browser nesta PR e o que ainda diverge do contrato em
`GODOUTOR-UI-CONTRACT.md` (seção "Gate visual canônico"). Não migra o sistema:
cada item tem severidade, risco e onda para execução posterior.

Colunas: problema · arquivo/tela · componente atual · canônico · severidade
(P0/P1/P2) · risco · onda · estado.

## Resumo de contagem

| Severidade | Abertos | Corrigidos nesta PR |
|---|---|---|
| P0 | 0 | 3 — P0.1 limiar de clique/arraste; P0.2 destino do drop, hover durante drag e resize sem confirmação; P0.3 Pet 360 pela agenda sem atributos do pet |
| P1 | 0 | 9 — P1.2 gatilho do SelectMenu; P1.3 Anamnese fora do workspace; P1.4 dialog de descarte; P1.5 profissional da agenda; P1.6 ações sem contorno; + Cliente 360 com abas escondidas em 1024; + duração limitada a 120 min; + erro sem foco/mensagem no Novo agendamento; + dialog central animado como drawer lateral |
| P2 | 3 | 2 — Pet 360 em 1024/768 (abas via `OverflowTabs`); padding direito do Novo agendamento |

P1.1 (drawer de detalhe) foi medido e já estava conforme (`translateX(100%)→0`,
190 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`): não alterado.

## Corrigidos e validados no browser

| Problema | Arquivo / tela | Componente | Canônico | Sev. | Risco | Onda | Evidência |
|---|---|---|---|---|---|---|---|
| Clique de 8px virava arraste (limiar 6px) | `src/lib/agenda-drag.ts`, Agenda | máquina de drag | `DRAG_THRESHOLD_PX = 8` | P0 | baixo | feita | mouse 0/3/8px abrem detalhe; 12px arrasta |
| Drop usava o ponteiro, não o topo do evento; hover durante drag | `agenda/page.tsx` | `planDropAt`, `computeHover` | `grabOffsetRef` + hover suprimido | P0 | médio | feita | drag +128px → 11:00; PATCH 200; persiste após reload |
| Resize sem confirmação de duração | `agenda/page.tsx` | diálogo de duração | "Confirmar" + PATCH | P0 | médio | feita | 12:00–12:45 → 13:00, PATCH 200, persistido |
| Pet 360 pela agenda sem espécie/raça/sexo/nascimento | `BookingDetailSheet.tsx` → `Pet360Sheet.tsx` | `Pet360Sheet` | `petId` canônico via `/api/pets` | P0 | baixo | feita | Cachorro, Golden Retriever, Macho, 02/03/2019, 31.4 kg |
| Gatilho do SelectMenu sem contorno em repouso | `globals.css` (toolbar da agenda) | `SelectMenu` trigger | `gd-select-trigger` com contorno | P1 | baixo | feita | "Dia" com borda `rgb(125,140,163)` |
| Anamnese abria sheet desconectado | `EncounterSheet.tsx` | sheet legado | seção Anamnese do workspace (`?secao=anamnese`) | P1 | médio | feita | Registro → "Preencher anamnese" abre a seção no workspace |
| Dialog de descarte parecia modal dentro de modal | `OverlayDismissGuard.tsx`, `globals.css` | confirmação de descarte | backdrop global + cartão centralizado, `aria-modal`; entrada/saída animadas | P1 | baixo | feita | medido: `gd-fade-in` 140 ms + `gd-dialog-in` 180 ms; reduced motion sem animação |
| "Novo agendamento" da agenda da Michele não mantinha Michele | `agenda/page.tsx` | `NewBookingSheet` | profissional do filtro pré-preenchido | P1 | baixo | feita | campo Profissional = Dra. Michele Martins |
| Ações com cara de texto | `ui.tsx` `BTN_VARIANT_CLS` | `Button` secondary/ghost | SECONDARY com contorno 1px; TERTIARY em `--accent-fg` | P1 | médio | feita (primitive) | medido na UI Lab: secundário `bw=1px bc=rgb(125,140,163)`; ghost sem contorno, texto `rgb(29,78,216)` |
| Cliente 360: 7 de 10 seções escondidas em 1024 ("Mais 7") | `ui.tsx` `OverflowTabs`, `ClientProfileDrawer.tsx` | `OverflowTabs` | modo `wrap` para o Cliente 360 | P1 | baixo | feita | 1024/1100/…/1920: 10 abas visíveis, sem "Mais"; 768: 10 abas em 2 linhas, sem corte; "Observações administrativas" visível |
| Duração limitada a 120 min por lista fixa | `QuickBookingPopover.tsx` `DURATIONS` | seletor de duração | sem teto de negócio no UI (servidor só exige > 0) | P1 | baixo | feita | opções até 720 min; duração fora da lista é preservada |
| Erro no Novo agendamento sem foco nem mensagem junto da causa; horário passado voltava em silêncio | `NewBookingSheet.tsx` `save()` | `fail(msg, campo)` | foco no campo + mensagem junto da causa | P1 | baixo | feita | serviço: foco no combobox, `data-invalid`, "Escolha o serviço deste atendimento."; horário: foco no bloco de horário, "Escolha o horário deste atendimento."; sem cobertura por outro elemento |
| Dialog central animado como drawer lateral (`translateX` da borda) | `src/styles/godoutor-design-system.css` | `.il-drawer__strip` | dialog = fade + translateY 8px / scale .985; drawer lateral = `translateX` | P1 | baixo | feita | medido no lab e na confirmação do resize: antes `gd-drawer-strip-in`; depois `gd-dialog-in` |
| Abas do Pet 360 em 1024/768 fora do `OverflowTabs` | `Pet360Sheet.tsx` | `OverflowTabs` `size="sm"` | `OverflowTabs` (mesma lógica de 1440) | P2 | médio | feita | 1440/1024/768: 3 visíveis + "Mais 3"; 390: 1 visível + "Mais 5"; nenhuma aba cortada |
| Padding direito apertado no Novo agendamento | `NewBookingSheet.tsx` `.ws-sheet__body` | corpo do formulário | escala de espaçamento | P2 | baixo | feita | corpo 670 px; gap mínimo 20 px à esquerda e 20 px à direita |

## Abertos (P2) — próximas ondas

| # | Problema | Arquivo / tela | Componente atual | Canônico | Risco | Onda |
|---|---|---|---|---|---|---|
| 1 | `Tabs` usa `overflow-x-auto` (rolagem lateral escondida), contrário ao contrato | `ui.tsx` `Tabs` | `Tabs` | sem rolagem escondida: `OverflowTabs` ou `wrap` | médio (todas as abas do produto) | 2 |
| 2 | Campo de data da toolbar da agenda sem contorno em repouso (não medido nesta rodada) | `agenda/page.tsx` toolbar | `Date` / `il-field-control` | campo com contorno em repouso | baixo | 1 |
| 3 | Animações customizadas duplicadas (sete sistemas de entrada de overlay, ver abaixo) | `globals.css`, `godoutor-design-system.css` | CSS avulso por componente | um sistema de motion por papel de overlay | médio | 3 |

### Sistemas de animação de overlay encontrados (item 3)

`gd-detail-in` (drawer de detalhe), `il-drawer-side-in` (drawer com painel lateral),
`ws-sheet-in` (sheet de workspace), `gd-drawer-strip-in` (faixa do drawer lateral),
`gd-dialog-in` (dialog central e confirmação), `gd-ovl-in` (overlay compacto),
`gd-layer-in` (popover e hover-card). Os papéis são os mesmos (popover, drawer, dialog);
a consolidação fica para a onda 3, sem migrar nesta PR.

## Não medido ou não aplicável (declarado)

- Vídeo de motion: não gravado. Evidência de motion = leitura de `document.getAnimations()` (nome, duração, keyframes, easing computado) em `motion/*.json`.
- Demais drawers/sheets de workspace (ex.: sheets legados fora das quatro superfícies ouro): fora do escopo; ficam para a onda 2/3.
- Resize: gesto de alça medido (abre a confirmação de duração); animação de resize do próprio evento não existe no contrato.
- Referências aprovadas (`screenshots/referencias`): não há arquivos de referência no workspace desta sessão; a pasta do Drive traz as capturas atuais como baseline.

## Homologação de overlays e motion (rodada da PR #69)

Escopo: todos os overlays autenticados (51 usos mapeados por `grep` em `src/`:
Drawer 24 — 21 incondicionais e 3 condicionais; Dialog 12; WorkspaceSheet 8;
DetailSideModal 5; ConfirmDialog 2). Inventário completo com arquivo, linha,
componente, montagem e variante no pacote de homologação do Drive (`01-inventario-overlays.tsv`).

### Contrato consolidado (fonte: `ui.tsx` e `godoutor-design-system.css`)

| Papel | Contexto | Modalidade | Motion |
|---|---|---|---|
| Popover / HoverCard | ancorado, pequeno | sem backdrop | `gd-layer-in` |
| Dialog / AlertDialog | central | modal, backdrop | fade + translateY curto (`gd-dialog-in`) |
| DetailSideModal | lateral direita, leitura de detalhe | modal | sai da borda direita, entra; sai pela direita (`gd-detail-in/out`), sem scale |
| Drawer / Sheet lateral | edição delimitada | modal (padrão de `Drawer`) | `translateX(100%)` ↔ `none` (`gd-drawer-strip-in/out`), sem scale |
| Nonmodal Drawer | exige motivo funcional documentado | nenhuma no código atual | — |
| Workspace / Page | trabalho clínico prolongado | permanece em workspace | — |

### Causas-raiz e correções

| # | Desvio | Sev. | Alcance | Causa | Correção nesta rodada |
|---|---|---|---|---|---|
| 1 | Equipe → Gerenciar/Adicionar pessoa sem backdrop, com fundo interativo e sem contenção de foco | P1 | 1 tela | `Drawer modal={false}` + `dialog.show()` | Modal (padrão). Decisão: GERENCIAR sobrescreve o formulário sem checar alterações; com nonmodal o rascunho se perdia em silêncio. Backdrop bloqueia a sidebar e a saída passa pelo guard |
| 2 | Equipe: painel desmonta na hora (sem saída) | P1 | 1 tela | `{showAdd && …}` desmontava o Drawer no mesmo render | Drawer sempre montado com `open={showAdd}`; saída animada; formulário limpo só em `onExited` (salvar normal não reseta no mesmo lote, senão apaga o formulário durante a saída) |
| 3 | Equipe: `gd-team-editor` com dimensionamento próprio fora do contrato | P2 | 1 tela | override de tamanho em `globals.css` | Regra e comentário "nonmodal" removidos; largura pelo `WORKSPACE_SHEET_SIZES.clinical` |
| 4 | DetailSideModal: com `open=false` retornava `null`; saída só pelo `closeNow()` interno, sem cobrir fechamento externo | P1 | primitive (`ui.tsx`), 5 usos | presença não controlada por `open` | Presença controlada por `open`, ref `exiting`, `onExited`; `showModal` depende de `present`. Consumidores por flag (`ConversationsView.tsx:685`, `ClientProfileDrawer.tsx:1313`) herdam a saída sem mudança de código |
| 5 | Drawer não expõe fim de saída | P1 | primitive (`ui.tsx`), 24 usos | ausência de `onExited` | `Drawer.onExited` adicionado (aditivo; sem efeito para quem não passa a prop) |
| 6 | Ajuste de teste legado | — | `tests/pre-f1-final/qa.mjs:42` | seletor de backdrop | Seletor atualizado; asserções intactas |

Teste novo: `src/components/__tests__/overlay-exit-presence.test.tsx` (6 testes).
Verificação negativa: com `ui.tsx` de `709bcd3`, 2 falham.

### Motion medido no Chromium real (build de produção, login real em tenant de QA descartável)

Método: `getAnimations()` ao vivo (nome, duração, keyframes), `Animation.setPlaybackRate(0.1)`
via CDP para quadros intermediários, e timestamps do DOM (`data-closing`, remoção do nó).

| Superfície | Entrada | Saída | Desmonte |
|---|---|---|---|
| Agenda · detalhe (1440) | `gd-detail-in` 190 ms, `tx` 460→0 monotônico; slowmo 0,1×: 1440→980 | `gd-detail-out` 170 ms, `tx` 0→460 | nó removido em `ct` ≈ 167–170 de 170 (≈ 173 ms após fechar) |
| Equipe · Adicionar/Gerenciar (1440) | `gd-drawer-strip-in` 190 ms; slowmo 0,1×: 1426→764 monotônico | `gd-drawer-strip-out` 170 ms | ~205 ms após `data-closing` (duas rodadas), depois do fim da animação |
| Agenda · detalhe (1024/768) | `tx` 460→0 (frames por rAF, cadência ruidosa) | `tx` 0→445, monotônico | medido por frames |
| Agenda · detalhe (390) | sheet de largura total: `tx` 390→0 | `tx` 0→~378 | medido por frames; sem regressão de direção |
| Equipe · 390 px | `strip-in` 190 ms + transição CSS de 140 ms no strip | — | **P2 residual, não corrigido** (ver exceções) |
| `prefers-reduced-motion: reduce` | sem animação (`getAnimations()` vazio) | sem animação | medido em 1440 |
| `no-preference` | com animação | com animação | não tratado como reduced |

Observação de método: `getBoundingClientRect().left` não acompanhou de forma confiável o
transform animado nesta cadência, então a posição é reportada por `tx` (matriz computada)
somado à posição de repouso. A matriz de frames por rAF (`frames-final-*.json`) tem cadência ruidosa e não
serve como prova isolada de posição; a prova de quadros é a do slowmo.

### Verificações

- Vitest focado (8 arquivos, incluindo overlays, motion e Equipe): 122/122.
- Vitest completo: 6 falhas idênticas à baseline (`a34-instagram` 3, `automation-audit-p4` 1, `convergence-wave2` 1, `pipeline` 1). Nenhuma falha nova.
- tsc: 3 erros idênticos à baseline (`production-db-routing.test.ts`). Nenhum novo.
- `git diff --check`: limpo.
- E2E Entrega 3 em banco limpo e re-semeado: 15/15.
- Equipe, editar membro (Maria Recepção QA, dados descartáveis): "Pessoa atualizada.", persistida na API, conteúdo mantido durante a saída.
- Equipe, pessoa nova sem acesso/clínico: "Pessoa adicionada.", formulário limpo ao reabrir. Não aparece em `/api/team` (regra do domínio).
- Guard de descarte: "Continuar editando" mantém o rascunho; Escape fecha pelo guard.
- Tab/Shift+Tab ficam dentro do dialog; foco volta ao botão de origem.
- Agenda: `body` com overflow hidden enquanto aberto; restaurado ao fechar.

### Exceções registradas

- Duração de saída de 170 ms (entrada de 190 ms). Contrato pede ~180–200 ms. Mantida: não alterar a duração aprovada sem necessidade.
- Desmonte por timer fixo (170 ms, `overlayMotionMs`) e não por `animationend`. Medido no 1440 com margem de ~30 ms. Em main thread ocupada, o desmonte pode ficar mais perto do fim da animação. P2 de robustez, para a próxima rodada.
- Equipe em 390 px: transição CSS de 140 ms no strip (inset 35→8 px) além do `strip-in`. P2, não corrigido.
- Trocas de overlay na Agenda (`setDetail(null)` durante a navegação entre detalhes) são substituição de overlay, não saída. Tratadas como fora do contrato de saída.

### Pendências (não feitas nesta rodada)

- Consumidores por flag (`ConversationsView.tsx:685`, `ClientProfileDrawer.tsx:1313`) e desmonte externo de `DetailSideModal`: sem medição em browser.
- `Pet360Sheet`, `BookingDetailSheet` e `ClientProfileDrawer`: leitura de código indica que nenhum consome `onClose` sem mudar `open` ou desmontar. Sem teste de browser.
- Papel Profissional em Agenda e Equipe: não testado nesta rodada. Recepção e Owner foram testados.
- Análise de conflitos entre os sete sistemas de animação: inventariada (ver lista acima), consolidação para a onda 3.
- Baselines "before" de 1024/768/390 não existem e não foram recriados. Before medido só para a Agenda (`709bcd3`). Before da Equipe é de leitura de código.
