# Homologação FASE 2 — Matriz de correções

**Branch:** `arena/01a0ce4e-instalink` · **Base PR #37:** `arena/01a0cc3f-instalink` · **PR #37:** https://github.com/HernaniFigueira/instalink/pull/37
**Estado:** FECHAMENTO FASE 2 — última rodada; Fase 2 congela após esta entrega.

## Commits

### Rodada inicial (empilhados sobre base `4c9937b`)

| # | SHA | Mensagem | Foco |
|---|-----|----------|------|
| 1 | `7dea25e` | fix: stabilize booking client flow and encounter autosave | P0-1 autosave, P0-2 cliente novo |
| 2 | `f29ea9f` | fix: enforce vet patient semantics and pet 360 | P0-3 pet, P0-4 form, Pet 360, raças |
| 3 | `e1575bb` | ux: simplify page editor and clinic identity | Modelo/Seções, Identidade GoDoutor, capa, prévia única |
| 4 | `8d16bf4` | ux: improve skeletons, sidebar and clinical forms | Skeletons, anamnese clínica, hint arquivos |
| 5 | `79b526e` | docs: matriz de homologação FASE 2 | matriz anterior |

### Rodada de FECHAMENTO (itens 1–20 do briefing)

| # | SHA | Mensagem | Foco |
|---|-----|----------|------|
| A | `92c21be` | fix: real patient registration in booking flow (vet tutor+pet, minor guardian) | itens 1–3: cadastro real no agendamento, vet Tutor+pet, responsável legal <18 |
| B | `fea16b3` | ux: WorkspaceSheet close tab + migrate booking detail and encounter sheets | itens 4–5, 15: overlay padrão + linguinha de fechar |
| C | `b8bdecb` | ux: public page full-bleed cover, single-scroll editor, clean first-level headers | itens 8–11: capa full-bleed, scroll único editor, prévia enxuta, cabeçalhos 1º nível |
| D | `2264438` | feat: my profile, also-attends link, safe anamnese template upgrade, platform docs | itens 6–7, 12–14: `/perfil`, link Professional, upgrade de template, fundação platform admin |
| E | `d1a7770` | test: adapt nav/agenda contracts for /perfil route and clean agenda header | adaptações de contrato + dica de uso na Legenda |

## Matriz — rodada de fechamento

| Item | Status | Commit / evidência |
|------|--------|-------------------|
| 1 cadastro REAL paciente no agendamento (sem temporário) | ✅ | `92c21be` · NewClientSheet WorkspaceSheet → CRM → volta com seleção |
| 2 vet: Tutor + `+ Adicionar pet` completo; ≥1 pet; vetMode via clinicType | ✅ | `92c21be` · Greg+Bernardo; testes NewBookingSheet |
| 3 humano <18 → Responsável legal vinculado (adição, não novo paciente) | ✅ | `92c21be` · seção guardian no cadastro |
| 4 overlay padrão WorkspaceSheet (Detalhe, Atendimento, 360, Conversas, Anamnese) | ✅ | `fea16b3` + `2264438` · BookingDetail/Encounter migrados; Modal só confirmação |
| 5 linguinha de fechar WorkspaceSheet (aba externa, sem X no canto, herdada) | ✅ | `fea16b3` · tab 42px left:-22px · `fase2-ws-sheet-close` 6/6 |
| 6 anamnese = form clínico: contexto pet + episódio estruturado + histórico | ✅ | base + `8d16bf4`/`2264438` · upgrade seguro de template antigo |
| 7 upgrade seguro de templates (só apenda, nunca sobrescreve custom) | ✅ | `2264438` · `upgradeTemplate` + action `template.upgrade` auditada |
| 8 página pública mobile: capa full-bleed, logo cruza 50/50 | ✅ | `b8bdecb` · `.pub-hero__*` cover 320px radius 36px |
| 9 editor: única scrollbar = página; sticky coluna; phone sem overflow | ✅ | `b8bdecb` · `.pe-preview` sem max-height/overflow |
| 10 sem "Prévia das alterações"/"Conteúdo real em edição…" | ✅ | `b8bdecb` · header só Ver menu + Celular/Desktop |
| 11 cabeçalhos 1º nível só título (Agenda/Pacientes, sem `?`/breadcrumb) | ✅ | `b8bdecb` + `d1a7770` · ajuda vive na Legenda |
| 12 Meu perfil (foto/nome/telefone/e-mail/cargo/conselho) + topbar foto | ✅ | `2264438` · rota `/perfil` + PATCH `/api/account` · build 4.58 kB |
| 13 "Também atende" cria/vincula Professional ao User (sem unir entidades) | ✅ | `2264438` · POST `/api/account` `link_as_professional` idempotente |
| 14 platform admin: sem senha master; fundação documentada; guard simples | ✅ | `2264438` · `docs/MASTER.md` Control Center futuro |
| 15 detalhe do agendamento → WorkspaceSheet espaçoso | ✅ | `fea16b3` |
| 16 Pet 360 preservado (6 abas + responsável financeiro) | ✅ | preservado · `f29ea9f`+regressão |
| 17 skeletons aprovados — contraste não reduzido | ✅ | `8d16bf4` preservado |
| 18 não estragar (agenda, pet, tutor, 360, autosave, impressão, financeiro, página, DnD, Agora, estados, permissões, persistência) | ✅ | suíte completa 1902 pass |
| 19 testes humanos (vet tutor+pet, menor, scroll único, sheets + linguinha) | ✅ parcial | automatizados; manual no preview Vercel |
| 20 entrega: PR #37, commits separados, tsc/testes/build, SHAs, matriz, screenshots, gaps | ✅ | este documento · screenshots = gap |

## Verificações finais (fechamento)

- `./node_modules/.bin/tsc --noEmit` → **0**
- `npm run build` → **OK** (inclui `/perfil` 4.58 kB)
- `npx vitest run` → **1902 pass · 6 fail** — apenas as 6 pré-existentes da base `e622848`:
  `a34-instagram` ×3, `automation-audit-p4`, `pipeline`, `whatsapp-p61-e2e` (data/ambiente; não são da Fase 2)
- Suites novas do fechamento: `fase2-ws-sheet-close` (6), `fase2-close-ux` (6), `fase2-close-profile` (6)
- Contratos adaptados: `panel` 71/71 (26 rotas + `/perfil`), `a34-nav` 12/12, `a34-human` 29/29, `workspace-navigation` 8/8

## Gaps restantes (honestos)

1. **Screenshots** não capturados (playwright 1.63 sem browser; CDN de download bloqueada no sandbox) — não repetir tentativa; testes + SHAs cobrem regressão.
2. **Testes manuais** dos itens 1–3, 8–10, 19 dependem do preview Vercel / uso humano.
3. 6 falhas pré-existentes da base não são da Fase 2 e ficam como estão.
4. Templates de anamnese já criados em produção: upgrade é ação explícita no manager (botão "Atualizar do preset"), sem migração silenciosa.
5. Platform admin Control Center: fundação documentada em `docs/MASTER.md`; UI dedicada fica para fase futura (decisão: sem UI se simples).

---
*Fase 2 congela após push desta matriz. Próxima construção será planejada em separado.*
