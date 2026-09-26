# INTELLIGENCE_DATA_RETENTION (F3-I)

Política de retenção das coleções **técnicas** da Fase 3 (documento único).
**NÃO podar dados clínicos/comerciais.**

| Coleção | Limite / regra | Onde |
|---|---|---|
| `automationRuns` finalizados | **200/unidade** (prune oportunístico em `updateDB`) | `db.ts` `MAX_FINISHED_RUNS_PER_BUSINESS` |
| Histórico de passos do run | **80** (máx. 320 hard-cap) | `executor.ts` `MAX_RUN_HISTORY_DEFAULT` |
| Runs enfileirados vivos | **400/unidade** — emit para de criar acima disso | `events.ts` `MAX_QUEUED_RUNS_PER_BUSINESS` |
| Runs por eventKey | **1 lógico** (dedupe) | `deriveEventKey` |
| Runs por evento automação | **25** | `MAX_RUNS_PER_EVENT` |
| Reentrada de evento | profundidade **5** | `MAX_REENTRY_DEPTH` |
| Entregas webhook outbox | janela por status (`duplicate` curta) | `db.ts` `prune` |
| Sessões expiradas | prune em `updateDB` | `db.ts` `prune` |
| `followUpOutreach` | 1 registro por chave lógica; status terminal não reabre | F3-H |
| Mensagens conversa | sem poda automática nesta fase (janela Meta 24h + UI) | — |
| Audit | sem poda (append-only p/ auditoria) | — |

## Proibido podar

`contacts`, `pets`, `bookings`, `encounters`, prontuário/anamnese, financeiro,
clientes, leads convertidos, histórico de agendamentos.

## Crescimento observável

- Metrics e health **derivam** do documento (não mantêm contadores paralelos).
- Se o documento crescer além dos tetos acima, o prune já corta runs finalizados
  e outbox antigos em `updateDB`.

Ver também: `docs/retencao.md` (LGPD dados de negócio).
