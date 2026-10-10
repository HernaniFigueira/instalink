# Entrega 1 · Resultados finais (build do SHA da entrega)

Chromium real, `next start` sobre banco descartável (`.cache/f1b1/qa.json`, reset por `/tmp/reset-qa.sh`), login owner/Michelle conforme o cenário.

| Verificação | Script | Resultado |
|---|---|---|
| A4 · tutora com 2 pets: sem pré-seleção, lista só da tutora, recusa sem pet, POST leva petId, servidor recusa pet de outro tutor / inexistente / sem pet, nada criado indevidamente, people360 ordenado | `a4-multiplos-pets-browser.mjs` | 10/10 PASS |
| Drawer lateral (DS): foco, Tab preso, Escape + foco, clique no fundo, scroll travado/liberado, entrada animada | `drawers-a11y-browser.mjs` | PASS |
| Dialog (DS): mesmos critérios | `drawers-a11y-browser.mjs` | PASS |
| gd-detail (Agenda): foco, Tab preso, Escape + foco no cartão, scroll, entrada `gd-detail-in` | `drawers-a11y-browser.mjs` | PASS |
| prefers-reduced-motion: drawer e gd-detail sem animação, fechamento imediato (22–32 ms) | `drawers-a11y-browser.mjs` | PASS |
| Regressão E1 (A1–A3, B0–B4 SelectMenu, C1–C4b, C4a truncamento) | `entrega1-browser.mjs` | 19/19 PASS |
| Quick Create com Pet | `quick-create-pet-browser.mjs` | 6/6 PASS |
| Autosave (aprovado antes; sem mudança de código no fluxo) | `autosave-browser.mjs` | 7/7 PASS (build anterior) |

Testes unitários: `npx vitest run` → 3418 pass, 6 fail. As 6 falhas são o baseline documentado (a34-instagram ×3, automation-audit-p4, convergence-wave2, pipeline). Nenhuma falha nova.
`tsc --noEmit` → 3 erros, todos em `src/lib/__tests__/production-db-routing.test.ts` (arquivo não alterado; baseline).
`npm run build` → exit 0.
`git diff --check` → limpo.

Mudanças desta rodada:
- `src/app/api/bookings/route.ts`: `petId` precisa existir na unidade e pertencer ao tutor do agendamento; senão 400 com motivo (antes era descartado em silêncio). Não-owner que envia `petId` → 403.
- `src/app/api/people360/route.ts`: conversas do cliente ordenadas por atividade (`at` = `lastMessageAt`, que todo escritor de prévia atualiza, inclusive automação e webhook), mais recente primeiro.
- `src/components/dashboard/ClientProfileDrawer.tsx`: UF do endereço migrado para `SelectMenu` (último `<Select>` no escopo da E1).
- Seed: fixture `conv-qa-antiga` inserido antes da recente, para provar a ordenação.
