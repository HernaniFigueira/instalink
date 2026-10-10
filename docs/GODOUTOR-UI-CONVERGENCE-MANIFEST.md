# GoDoutor · Manifesto de convergência visual

Status: **parcial** (PR #69, gate visual canônico). Lista o que foi medido no
browser nesta PR e o que ainda diverge do contrato em `GODOUTOR-UI-CONTRACT.md`.
Não migra o sistema: cada item tem onda e risco para execução posterior.

Colunas: problema · arquivo/tela · componente atual · canônico · severidade
(P0/P1/P2) · risco · onda · estado nesta PR.

## Resumo de contagem

| Severidade | Abertos | Corrigidos nesta PR |
|---|---|---|
| P0 | 0 | 3 (P0.1 limiar de drag, P0.2 destino do drop/hover, P0.3 Pet 360 pela agenda) |
| P1 | 0 | 5 (P1.2 gatilho SelectMenu, P1.3 Anamnese, P1.4 dialog de descarte, P1.5 profissional da agenda, P1.6 ações sem contorno) |
| P2 | 7 | 0 |

P1.1 (drawer de detalhe) foi medido e já estava conforme (`translateX(460px)→0`,
~190ms, `gd-detail-in`): não alterado.

## Corrigidos e validados no browser (build `r4`, E2E 15/15)

| Problema | Arquivo / tela | Componente | Canônico | Sev. | Risco | Onda | Evidência |
|---|---|---|---|---|---|---|---|
| Clique de 8px virava arraste (limiar 6px) | `src/lib/agenda-drag.ts`, Agenda | máquina de drag | limiar 8px | P0 | baixo | feita | mouse 0/3/8px abrem detalhe; 12px arrasta |
| Drop usava o ponteiro, não o topo do evento; hover durante drag | `agenda/page.tsx` | `planDropAt`, `computeHover` | `grabOffsetRef` + hover suprimido | P0 | médio | feita | drag +128px → 11:00; PATCH 200 e persistência após reload |
| Resize sem validação | `agenda/page.tsx` | confirmação de duração | "Confirmar" do diálogo + PATCH | P0 | médio | feita | 12:00–12:45→13:00, PATCH 200, persistido |
| Pet 360 pela agenda sem espécie/raça/sexo/nascimento | `BookingDetailSheet.tsx` (stub) → `Pet360Sheet.tsx` | `Pet360Sheet` | `petId` canônico via `/api/pets` | P0 | baixo | feita | Cachorro, Golden Retriever, Macho, 02/03/2019, 31.4 kg |
| Gatilho do SelectMenu sem contorno em repouso | `globals.css` (`.ag-page .gd-toolbar .il-field-control`) | `SelectMenu` trigger | `gd-select-trigger` com contorno | P1 | baixo | feita | "Dia" com borda `rgb(125,140,163)` |
| Anamnese abria sheet desconectado | `EncounterSheet.tsx` | sheet legado | seção Anamnese do workspace (`?secao=anamnese`) | P1 | médio | feita | Registro → "Preencher anamnese" abre a seção no workspace |
| Dialog de descarte parecia modal dentro de modal | `OverlayDismissGuard.tsx`, `globals.css` | `ConfirmDialog` | backdrop global + cartão centralizado, `aria-modal` | P1 | baixo | feita | scrim cobre o formulário; cartão centralizado |
| "Novo agendamento" da agenda da Michele não mantinha Michele | `agenda/page.tsx` | `NewBookingSheet` | profissional do filtro pré-preenchido | P1 | baixo | feita | campo Profissional = Dra. Michele Martins |
| Ações com cara de texto (secundário sem contorno, ghost em muted) | `ui.tsx` `BTN_VARIANT_CLS` | `Button` secondary/ghost | SECONDARY com contorno; TERTIARY em `--accent-fg` | P1 | médio | feita (primitive) | Hoje, Filtros, Fila, Ver na agenda, WhatsApp com contorno |
| Abas do Cliente 360 escondiam 7 de 10 seções em 1024 (virava "Mais 7") | `ui.tsx` `OverflowTabs`, `ClientProfileDrawer.tsx` | `OverflowTabs` | modo `wrap` (nenhuma seção escondida) para o Cliente 360 | P1 | baixo | feita | 1024: 10 abas visíveis em 3 linhas, sem "Mais" |
| Duração limitada a 120 min por lista fixa de UI | `QuickBookingPopover.tsx` | `DURATIONS` | sem teto de negócio (servidor só exige >0) | P1 | baixo | feita | opções até 720 min; duração fora da lista preservada |

## Abertos (P2) — próximas ondas

| # | Problema | Arquivo / tela | Componente atual | Canônico | Risco | Onda |
|---|---|---|---|---|---|---|
| 1 | Abas do Pet 360 em 1024/768 não passam pelo `OverflowTabs`; não medidas | `Pet360Sheet.tsx` | abas próprias | `OverflowTabs` (ou `wrap`) | médio; conflita com o pedido anterior "não mexer em Pet 360 em 1024" | decisão do owner, depois medição |
| 2 | `Tabs` usa `overflow-x-auto` (rolagem lateral escondida), contrário ao contrato | `ui.tsx` `Tabs` | `Tabs` | sem rolagem escondida: `OverflowTabs`/`wrap` | médio (todas as abas) | 2 |
| 3 | Campo de data da toolbar da agenda sem contorno em repouso | `agenda/page.tsx` toolbar | `il-field-control` (Date) | campo com contorno em repouso | baixo | 1 |
| 4 | Padding direito apertado no formulário "Novo agendamento" não corrigido e não medido | `NewBookingSheet.tsx` | `Field`/`FieldLabel` | espaçamento da escala (16–24px) | baixo | 1 |
| 5 | Foco no primeiro campo com erro implementado, sem validação em browser | `NewBookingSheet.tsx` | `fail(msg, field)` + `data-field` | erro junto da causa + foco | baixo | 1 |
| 6 | Animações customizadas duplicadas (`overlay-confirm` com `animation` próprio) não auditadas | `globals.css` | CSS avulso | motion canônico | médio | 3 |
| 7 | Comparação de fontes (Barlow × Inter × Geist) e UI Lab não executadas nesta PR | — | tokens | UI Lab em rota dev/internal | — | 3 |

## Não medido nesta PR (declarado)

- Hover/resumo do agendamento (ouro 1) não remedido após as correções de P0.2.
- Demais drawers e surfaces (medição sistemática) — fora do escopo desta rodada.
- Motion QA com gravação de vídeo — não executado; só leitura de CSS e medições pontuais.
- Pasta do Drive `UIUX-CANONICAL-GATE-PR69` — não criada.
