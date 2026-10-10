# Homologação final — evidências (2026-10-08)

QA real em Chromium (@sparticuz/chromium headless, dev server `next dev` + banco
`GODOUTOR_DB_FILE`), fixture determinística (`/tmp/qa-tools/setup-fixture.mjs` +
`reset-fixture.mjs`), 2026-10-10, Clínica Veterinária, 2 profissionais.

## Resultados

- `results-desktop.json` — **41/41 PASS** (1440×900, `qa-desktop.mjs`, 41 checks)
- `results-responsive.json` — **21/21 PASS** (390×844 / 1024×768 / 1366×768,
  `qa-responsive.mjs`)

## Evidência → requisito (prioridade da missão)

| # | Requisito | Evidências |
|---|-----------|-----------|
| 1 | Labels externos/DS | `03-editar-modal.png`, `13-duplicar-prefill.png`, `r04-mobile-editar.png` |
| 2 | Hover enriquecido | `01-hover-enriquecido.png`, `r06-1366-hover.png` |
| 3 | Editar (modal central, salvar persiste) | `03-editar-modal.png`, `04-editar-persistido.png`, `r04-mobile-editar.png` |
| 4 | Detalhe lateral full-height | `02-detalhe-lateral.png`, `r02-mobile-detalhe.png` |
| 5 | Context menu (+teclado, grupos) | `11-ctx-menu-pendente.png`, `12-ctx-menu-concluido.png` |
| 6 | Duplicar prefill pet/observação | `13-duplicar-prefill.png` |
| 7 | Cancelar (dismiss-guard + persiste) | `14-cancelar-persistido.png` |
| 8 | Drag (persistência, intenção, drop inválido, Escape) | `05-drag-persistido.png`, `08-drag-intencao-carregando.png`, `06-drop-invalido.png`, `07-drag-escape.png` |
| 9 | Resize (confirmar/Escape restaura) | `10-resize-persistido.png`, `09-resize-escape-restaura.png` |
| 10 | Rail expandido/recolhido | `r07-rail-desktop.png`, `r08-rail-recolhido.png` |
| 11 | Mobile 390 (agenda/setas/período/touch/modal/WhatsApp/preview/hit areas) | `r01-mobile-agenda.png` … `r04-mobile-editar.png` |
| — | 1024/1366 | `r05-1024-agenda.png`, `r06-1366-hover.png` |

## Correções desta rodada (commit de fix)

1. **"Registrar chegada" no context menu** — antes só existia no detalhe. Item
   entra no grupo de operações quando `workflow.allowed` inclui `check_in`
   (regra do servidor), com o MESMO `PATCH {action:'check-in'}` do detalhe.
2. **Duplicar: prefill do pet** — (a) o efeito de pets zerava o `petId` semeado;
   (b) bookings da agenda interna não trazem `customerId` e o tutor caía em
   "sem vínculo CRM", sem renderizar o pet. O `NewBookingSheet` agora recupera
   o vínculo real do tutor via `pet.tutorId` (GET `/api/pets` existente) e
   restaura o pet semeado após o load. A observação já era semeada no estado
   (visível em "Opções avançadas") — validada com valor em tela.
