# Fase 3 — status oficial (correção)

Checkpoint imutável:

**FASE 2 FINAL = `e3ab0582b5178c9a1d05486728e96b2582577c5b`**

A partir desse SHA começa a Fase 3. Não reescrever histórico.
NÃO force-push/rebase que altere os SHAs abaixo.

| Bloco | Status | SHA | Notas |
|---|---|---|---|
| Base/docs F3 | FEITO | `6605b3b` | `docs/FASE3-BASE.md` |
| **F3-A** Event Layer + runner | **PARCIAL** | `55dbac0` | Event Layer e runner implementados. **Vercel Workflow SDK pendente** (documentado). Runner atual = fallback funcional — **não** substituir por timer em memória/polling. |
| **F3-B** Receitas prontas | **FEITO** | `9835909` | Waits relativos, status draft/active, revalidação — permanece como entregue. |
| **F3-C** Composer | **PARCIAL** | `7087b01` | `simulatePlan` aprovado. `refinePlan` = **fallback determinístico** aprovado. **Não é o AI Automation Composer final** — alvo: NL livre → `AIProvider` → AutomationProposal estruturada → schema/policy → preview → testar → aprovar/ativar. Não vender parser determinístico como IA completa. |
| **F3-D** Tool Registry + Agent Safety | **FEITO** | `8292f85` | 21 tools; guards tenant/permissão/injeção/confirm/idempotência/audit — ver `FASE3-TOOLS.md` |
| **F3-E** Assistente de agendamento | **FEITO** | `13fd245` | + hotfix vet `e872688` (PET obrigatório em veterinária via clinicType) — ver `FASE3-ASSISTANT.md` |
| **F3-F** Inbox + Handoff + Takeover | **FEITO** | `f40ff31` | Estados explícitos, handoff sem CoT, simulador, idempotência, 14 testes |
| **F3-G** WhatsApp Cloud provider + webhook + messaging service | **FEITO** | `3aa4e38` | MessagingProvider{sendText,sendTemplate,sendInteractive}; SimulatorProvider; política 24h; idempotência; credentialRef; **BLOCKED_META_CREDENTIAL** sem env real — ver `RELATORIO-F3-G.md` |
| AIProvider (LLM real) | **BLOCKED_AI_PROVIDER_CREDENTIAL** | — | sem chave/modelo autorizado nesta sessão; interface + mock/test double criados; **não bloqueia** F3-D/F3-E. |

Commits confirmados:

- FASE 2 FINAL: `e3ab0582b5178c9a1d05486728e96b2582577c5b`
- Base/docs: `6605b3b`
- F3-A: `55dbac0`
- F3-B: `9835909`
- F3-C: `7087b01`
- F3-D: `8292f85`
- F3-E: `13fd245`
- F3-E hotfix vet: `e872688`
- F3-F: `f40ff31`
- F3-E: `13fd245`
- F3-E hotfix vet: `e872688`
