# Fase 3 — Matriz final (F3-I)

Data: 2026-09-23 · Branch `arena/01a0ce4e-instalink` · PR #37 (não mergear nesta sessão).

Legenda: **FEITO** = entregue e coberto por testes neste PR · **PARCIAL** = entregue com gap documentado · **BLOCKED** = dependência externa.

| Bloco | Escopo | Status | Notas / gap |
|---|---|---|---|
| Base/docs | `FASE3-BASE.md` | **FEITO** | `6605b3b` |
| **F3-A** Event Layer + runner | eventos, CAS, waitingUntil, cron | **PARCIAL** | Vercel Workflow SDK pendente; runner = fallback funcional documentado. Não substituir por timer em memória. |
| **F3-B** Receitas | waits relativos, draft/active, revalidação | **FEITO** | `9835909` |
| **F3-C** Composer | simulatePlan + refinePlan | **PARCIAL** | `refinePlan` = fallback determinístico aprovado. **Não** é NL livre → AIProvider completo. Não vender parser como IA. |
| **F3-D** Tool Registry + safety | tenant, permissão, injeção, confirm, idempotência, audit | **FEITO** | `8292f85` + hardening F3-I (injeção PT; sem `\b` após acento em JS) |
| **F3-E** Assistente | agendamento; pet via `clinicType` em vet | **FEITO** | `13fd245` + `e872688` |
| **F3-F** Inbox handoff takeover | estados, sem CoT, simulador | **FEITO** | `f40ff31` |
| **F3-G** WhatsApp Cloud + webhook | MessagingProvider, 24h, idempotência, credentialRef | **FEITO** (código) / **BLOCKED** (Meta) | Saída real = `BLOCKED_META_CREDENTIAL`. Simulator ≠ "WhatsApp enviado". |
| **F3-H** Follow-up / reactivation | outreach idem, sem faking | **FEITO** | `019104d` + `cfe16bc` |
| **F3-I** Observabilidade / hardening | métricas, health, PII, retenção, testes, docs | **FEITO** | metrics + health + redact + retenção + suíte 19/19 + docs finais |
| AIProvider (LLM real) | interface + mock/test double | **BLOCKED_AI_PROVIDER_CREDENTIAL** | Sem chave/modelo autorizado. Fallback determinístico ≠ IA completa. Não bloqueia D/E. |

## SHAs imutáveis (não reescrever)

`e3ab058` `6605b3b` `55dbac0` `9835909` `7087b01` `8292f85` `13fd245` `e872688` `f40ff31` `43c1229` `3aa4e38` `b1298f0` `d37f2e3` `de7d7a9` `4fd30a9` `019104d` `cfe16bc`

## Gaps externos (não são defeitos do app)

1. **Meta WhatsApp** — App Secret / token / phone_number_id → `BLOCKED_META_CREDENTIAL`.
2. **AIProvider** — chave LLM autorizada → `BLOCKED_AI_PROVIDER_CREDENTIAL`.
3. **Vercel Workflow SDK** — infra alvo do runner → F3-A permanece PARCIAL (`PARTIAL_INFRA`).
4. **Screenshots E2E** — playwright sem browser neste ambiente → gap permanente de evidência visual.
