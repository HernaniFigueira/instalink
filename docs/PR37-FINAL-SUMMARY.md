# PR #37 — resumo final (F3-A → F3-I)

Branch: `arena/01a0ce4e-instalink` · Estado: OPEN · **Merge: NÃO nesta sessão** · Base F3-I: `cfe16bc`

## Escopo

Fase 3 inteira em PR de revisão contínua: event layer, receitas, composer, tools/agent, assistente, inbox/handoff, WhatsApp Cloud + webhook, follow-up/reativação e fechamento F3-I (observabilidade, hardening, matriz final).

## Entregáveis F3-I (nesta janela)

1. `src/lib/intelligence-metrics.ts` — métricas por `businessId`, cards, `automationHealthSummary`, `intelligenceHealth` (ok|degraded|blocked|error).
2. Dashboard: bloco "GoDoutor Intelligence" honesto (sem dado ⇒ `—`).
3. Automações: resumo de saúde sem jargão técnico.
4. Inbox: pendências `waiting_team`/`human_active` na lista (sem coluna nova).
5. Config: faixa "Como está a inteligência" em PT simples.
6. `src/lib/redact.ts` — `redactSensitive` + `safeErrorMessage`.
7. `docs/INTELLIGENCE_DATA_RETENTION.md` — limites + proibição de podar clínico/financeiro.
8. Guard: injeção PT-BR (padrões sem `\b` após acento — JS `\b` é ASCII-only).
9. Suíte `fase3-i-hardening.test.ts` — 19 testes (métricas, health, idempotência, tenant, injection, jornadas, estados impossíveis, permissions, PII).
10. Docs: `docs/evidence/FASE3-FINAL-MATRIX.md`, `docs/GODOUTOR-CAPABILITIES.md`, este resumo, `docs/RELATORIO-FASE3-FINAL.md`.

## Gates F3-I

- tsc: **0**
- Vitest F3-I: **19/19**
- Regressão F3/F2/visual: **260/260** (16 files)
- Suíte completa: **2035 passed / 6 failed** = baseline pre-existing (a34×3, audit-p4, pipeline, p61) — **zero falha nova**
- next build: **0**

## O que NÃO está no PR

Merge; force-push/rebase; main; Meta real; AIProvider real; Control Center; novo visual; novo banco; módulo de campanhas; otimização extrema; poda de dado clínico.
