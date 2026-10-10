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
