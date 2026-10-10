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

---

## Rodada de PR e homologação (build final, banco QA descartável)

| Verificação | Script | Resultado |
|---|---|---|
| Matriz de permissões (POST /api/bookings, login real por papel) | `permissoes-agendamento-browser.mjs` | 14/14 PASS |
| A4 · 2+ pets: sem pré-seleção, lista só da tutora, recusa sem pet, POST leva petId, servidor recusa pet de outro tutor / inexistente / sem pet, people360 em ordem de atividade | `a4-multiplos-pets-browser.mjs` | 10/10 PASS |
| Drawers: foco, Tab preso, Escape + foco, backdrop, scroll travado, reduced motion (16 já aprovados) | `drawers-a11y-browser.mjs` | 16/16 PASS |
| Drawers com conteúdo longo: rolagem interna, roda só no overlay, fundo parado, último item por Tab e visível, foco devolvido | `drawers-conteudo-longo-browser.mjs` | 11/11 PASS |
| Regressão E1 (inclui C4a truncamento) | `entrega1-browser.mjs` | 19/19 PASS |
| Quick Create com Pet | `quick-create-pet-browser.mjs` | 6/6 PASS |
| Autosave (P0) | `autosave-browser.mjs` | 7/7 PASS |

### Matriz de permissões (esperado × obtido)

| Ator | Papel / permissão | Esperado | Obtido |
|---|---|---|---|
| owner.f1b1 | OWNER | cria | HTTP 200 |
| admin.f1b1 | ADMIN | cria | HTTP 200 |
| recepcao.f1b1 | SECRETARIA (padrão: agenda) | cria | HTTP 200 |
| michelle.f1b1 | PROFISSIONAL (própria agenda) | cria | HTTP 200 |
| visualizador.f1b1 | VIEWER (somente leitura) | 403 | 403 "Modo suporte (visualização): alterações bloqueadas." |
| vendedor.f1b1 | VENDEDOR (sem agenda) | 403 | 403 "Seu perfil não tem permissão para esta ação." |
| semagenda.f1b1 | SECRETARIA com `agenda:false` | 403 | 403 "Seu perfil não tem permissão para esta ação." |
| fora.f1b1 | owner de OUTRA unidade | 401/403 | 403 "Você não tem acesso a este negócio." |
| anônimo | com asOwner | 401 | 401 |
| público | sem asOwner, com petId | 403 | 403 "Escolha de pet exige permissão de Agenda." |
| Recepção | pet de outro tutor / outra unidade / 2 pets sem escolha | 400 | 400 (três motivos explícitos) |

## Mudanças nesta rodada
- `src/app/api/bookings/route.ts`: a checagem do pet só recusa (400/403) quando o ator não tem autorização de agenda ou o pet não pertence ao tutor/unidade. Owner e membros com agenda seguem criando. Mensagem nova para `petId` sem tutor: "Escolha o tutor antes do pet."
- Seed de QA: usuários ADMIN, VIEWER, VENDEDOR e Recepção com `agenda:false`, para a matriz negativa.
- Testes novos: `permissoes-agendamento-browser.mjs` e `drawers-conteudo-longo-browser.mjs`.
