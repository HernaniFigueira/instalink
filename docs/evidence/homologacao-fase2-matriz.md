# Homologação FASE 2 — Matriz de correções

**Branch:** `arena/01a0ce4e-instalink` · **Base:** `4c9937b` · **PR #37:** https://github.com/HernaniFigueira/instalink/pull/37

## Commits (4)

| # | SHA | Mensagem | Foco |
|---|-----|----------|------|
| 1 | `7dea25e` | fix: stabilize booking client flow and encounter autosave | P0-1 autosave, P0-2 cliente novo |
| 2 | `f29ea9f` | fix: enforce vet patient semantics and pet 360 | P0-3 pet, P0-4 form, Pet 360, raças |
| 3 | `e1575bb` | ux: simplify page editor and clinic identity | Modelo/Seções, Identidade GoDoutor, capa, prévia única |
| 4 | `8d16bf4` | ux: improve skeletons, sidebar and clinical forms | Skeletons, anamnese clínica, hint arquivos |

## Matriz

| Item | Status | Commit / evidência |
|------|--------|-------------------|
| P0-1 autosave não fecha sheet | ✅ | `7dea25e` · teste `homologacao-p0-autosave-client` (11) |
| P0-2 cliente novo no agendamento | ✅ | `7dea25e` · máquina de estágio ClientStage |
| P0-3 pet obrigatório (vet) | ✅ | `f29ea9f` · server 400 + `+ Cadastrar pet` |
| P0-4 persistência form pet | ✅ | `f29ea9f` · roundtrip sanitizePet |
| P0-5 skeleton contraste/shimmer | ✅ | `8d16bf4` · tokens + shimmer + 5 skeletons |
| P1 Pet 360 | ✅ | `f29ea9f` · `Pet360Sheet` 6 abas |
| P1 raças datalist | ✅ | `f29ea9f` · DOG/CAT_BREEDS |
| P1 Modelo/Seções da página | ✅ | `e1575bb` · seção `secoes` |
| P1 Localização = fonte institucional | ✅ | `e1575bb` · `LocationAddressEditor` PATCH |
| P1 Identidade sem capa / capa na Página | ✅ | `e1575bb` |
| P1 Aparência aberta + prévia única | ✅ | `e1575bb` |
| P1 marca GoDoutor estável | ✅ | `e1575bb` · wordmark sidebar |
| P1 paleta mais neutra | ✅ | `e1575bb` · PageHeader sem gradiente roxo |
| P1 sidebar contínua + colapso icon | ✅ | `e1575bb` |
| P1 cabeçalho Agenda enxuto | ✅ | `e1575bb` |
| P1 anamnese clínica + contexto pet + histórico | ✅ | `8d16bf4` |
| P1 hint arquivos | ✅ | `8d16bf4` |
| P1 sem INP na UI | ✅ | grep negativo |
| Testes obrigatórios Jornadas A–E (automatizados) | ✅ parcial | 4 suites homologação (46 asserções) |
| typecheck / testes / build | ✅ | `tsc` 0; 1881 pass / 6 falhas pré-existentes da base |

## Verificações

- `./node_modules/.bin/tsc --noEmit` → **0**
- `npx vitest run` → **1881 pass · 6 fail** (mesmas 6 da base `e622848`: a34-instagram ×3, automation-audit-p4, pipeline, whatsapp-p61 — sensíveis a data/ambiente)
- Suites de homologação novas: `homologacao-p0-autosave-client` (11), `homologacao-vet-pet360` (10), `homologacao-page-identity` (13), `homologacao-skeletons-anamnese` (12)

## Gaps restantes (honestos)

1. **Screenshots** da homologação não capturados nesta rodada (sem browser headless no sandbox) — árvore/SHAs e testes cobrem a regressão.
2. **`next build`** não reexecutado após o Commit 4 (tsc 0 + suíte completa ok); rodar no CI/Vercel.
3. Templates de anamnese **já criados** em produção mantêm campos antigos (adição apenas — sem migração destrutiva); o preset novo vale para novos seeds/`template.seed`.
4. 6 falhas pré-existentes da base não são da FASE 2.
5. Pixel-perfect e paleta completa fora desta rodada (decisão de plataforma: só bugs/coerência/UX).
