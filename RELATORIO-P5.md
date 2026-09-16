# P5 — Camada de IA / Agent (relatório da entrega)

Ramo: `arena/01a0ac7b-instalink` · base: `main` em `e1b3534` (merge do P4, PR #18).
O P4 **não** foi refeito. O P5 entra **por cima**: interpreta intenção, devolve
o contrato canônico do P4, o humano aprova, o executor do P4 executa. P6
(WhatsApp/Instagram/canais externos) **não** foi implementado.

---

## 1. Arquitetura escolhida

```text
USUÁRIO
  ↓
P5 — AI / Agent                 src/lib/ai/
  ↓  plano estruturado (evento, condição, passos)
  ↓  validação determinística
  ↓  Automation Graph do P4 (nodes + edges)
  ↓  aprovação humana
P4 Executor                     src/lib/automation/executor.ts
  ↓
serviços oficiais               pipeline · booking · tasks · webhooks
```

Decisões:

- **Não há segundo motor.** Sem executor paralelo, sem formato paralelo de
  workflow, sem publicação automática. Compilação = `linearToGraph` +
  `validateAutomationDraft` (o mesmo gate de `/api/automations`).
- **Planner determinístico** (como o concierge): vocabulário fechado em
  português, sem LLM, sem `eval`, sem SQL, sem ferramenta arbitrária. Texto
  livre nunca vira código. Confiança e “assumi / não resolvi” são diagnóstico
  — nunca decidem publicação.
- **Proposta ≠ automação.** Gerar grava `db.aiProposals` em `draft`. Só
  `publish` (depois de `approve`) insere em `db.automations`, **desligada**
  salvo o humano marcar `activate: true`.
- **Multi-tenant:** toda leitura/escrita recortada por `businessId`. Id de
  responsável, serviço ou profissional de outra unidade é recusado como
  “referência de outro negócio”. A API usa `requireBusiness(..., 'config')` —
  o id no corpo não troca de tenant.
- **Observação (P5.6) sem autonomia:** lê execuções da própria unidade,
  explica erros e sugere prompts. Não executa, não republica, não olha outro
  tenant.

## 2. Contrato P5 ↔ P4 (P5.0)

O plano da IA **é** o contrato já existente do P4:

| Peça | Origem |
| --- | --- |
| gatilho | `AutomationEventId` (`AUTOMATION_EVENT_DEFS`) |
| condição | operadores fixos + AND/OR/NOT |
| ações | catálogo (`change_lead_stage`, `assign_lead`, `create_task`, …) |
| espera / ramificação / settings | `LinearStep` + `AutomationSettings` |
| grafo | `nodes[]` + `edges[]` via `linearToGraph` |
| recorte do tenant | etapas, serviços, equipe **desta** unidade |

Não existe `action.type = 'ai'`. A IA não é uma ação do motor.

## 3. Modelo de dados

```ts
AiProposal {
  id, businessId,
  status: draft | approved | published | cancelled,
  prompt, plan: AiPlan,
  nodes[], edges[],                          // grafo compilado (diagnóstico)
  validation: { ok, errors, warnings },
  automationId?, publishedAt?,
  createdByUserId, createdAt, updatedAt
}

AiPlan {
  name, description, prompt, event, condition,
  steps[], elseSteps[], settings,
  confidence, assumptions[], unresolved[]
}
```

Migração aditiva: `emptyDB` ganha `aiProposals: []`; `normalizeDB` preenche
defaults e descarta (só na leitura) linha sem `id`/`businessId`. `prune` mantém
rascunhos/aprovadas; publicadas/canceladas saem depois de 180 dias, teto 80/unidade.

## 4. Ciclo de vida (P5.4)

```text
gerar / gerar novamente / editar  →  draft     (não cria Automation)
draft                             →  approve   →  approved
approved                          →  editar    →  draft   (reedição exige nova aprovação)
approved                          →  publish   →  published  (grava Automation, active só se pedido)
*                                 →  cancel    →  cancelled
```

A IA **nunca** liga uma automação operacional sozinha. `approve-publish` ainda
é um clique humano.

## 5. API e interface (P5.5)

| Rota | Guarda | Faz |
| --- | --- | --- |
| `GET /api/ai/automations?businessId=` | `config` | propostas + observação + exemplos + catálogo do tenant |
| `POST` `generate\|regenerate\|approve\|publish\|cancel\|approve-publish` | `config` | ciclo de vida |
| `PATCH` | `config` | editar plano (volta para rascunho) |

A API **nunca** chama o executor. Publicar grava a definição; o P4 dispara no
próximo evento real.

Interface: `/automacoes` → aba **Criar com IA** (não é um chat isolado). A
proposta aparece como QUANDO / SE / ENTÃO / DEPOIS / PRAZO, com revisar,
editar, cancelar, gerar novamente, salvar rascunho e publicar só depois do ok.
Empty state da lista aponta para a mesma aba.

## 6. Arquivos

**Novos:** `src/lib/ai/{contract,planner,compile,present,proposals,observe,index}.ts`,
`src/app/api/ai/automations/route.ts`, `src/components/dashboard/AiAutomations.tsx`,
`src/lib/__tests__/ai-planner.test.ts`, `src/lib/__tests__/ai-p5.test.ts`,
`docs/ai-p5.md`, `RELATORIO-P5.md`.

**Modificados (mínimo):** `types.ts` (`AiPlan`/`AiProposal` + `AuditAction` +
`DB.aiProposals`), `db.ts` (array, normalização, prune), `capabilities.ts`
(`automation.ai` `available: true` `default: true`), `panel.ts` (`API_GUARDS`),
`AutomationsView.tsx` (aba + CTA), `automation-model.test.ts` (capacidade),
`ARQUITETURA.md`, `README.md`, `docs/automations-p4.md`, `.env.example`.

Nenhum arquivo do executor, das ações ou dos gatilhos do P4 foi reescrito.

## 7. Testes

`npm test` → **746 testes, 50 arquivos, 0 falhas** (717/48 do P4 + 29 do P5).

Casos exigidos (1–15) e extras:

| # | O que prova |
| --- | --- |
| 1 | “Instagram + limpeza dental…” → `lead.created` + origem/interesse + 3 ações |
| 2 | plano → grafo do P4 (`linearToGraph`) e round-trip `graphToLinear` |
| 3 | grafo válido passa pelo mesmo `validateAutomationDraft` da API |
| 4 | plano sem ação/espera é recusado |
| 5 | ação inexistente recusada (texto não executa) |
| 6 | gatilho inexistente recusado (`whatsapp.message`) |
| 7 | responsável/serviço de outro tenant recusado |
| 8 | gerar cria rascunho e **não** grava `Automation` |
| 9 | publicar sem aprovar recusado; depois de aprovar cria a Automation |
| 10 | editar volta para rascunho e exige nova aprovação |
| 11 | cancelar impede publicação |
| 12 | automação gerada **é executada pelo P4** (etapa + atribuição + tarefa) |
| 13 | falha do P4 (etapa fantasma) marca a execução `failed` |
| 14 | espera gerada pela IA retoma no P4 sem repetir efeito |
| 15 | proposta de A invisível para B; B não aprova/publica em A (403/404) |

Extras: eval/SQL não vira ação; pedido vago não inventa operação; condição
falsa conclui sem efeito; HTTP 401/403; `approve-publish` nasce **desligada**;
observação não cria automação e não lê outro tenant.

`npx tsc --noEmit` limpo. `npm run build` ok (`/api/ai/automations` na tabela
de rotas). P0–P4 sem regressão.

## 8. Limitações (honestas)

- O planner é **determinístico**, não um LLM. Frases fora do vocabulário
  (gatilhos/ações do P4, português corrente dos exemplos) caem em
  `unresolved` e não publicam. Evolução prevista: LLM com o **mesmo** contrato.
- Não há editor visual de grafo: a UI é a projeção QUANDO/SE/ENTÃO; o grafo
  continua no P4.
- Observação (P5.6) é fundação: sugere e explica, **não** age sozinha.
- Publicar ainda exige o clique humano. Não existe “IA ligou a automação”.
- Sem `eval`, sem SQL gerado, sem tool-calling arbitrário — de propósito.

## 9. Fora do P5 (deliberadamente)

**P6 não foi implementado:** `channel.whatsapp` e `channel.instagram`
continuam `available: false`. Nenhum evento de canal externo, nenhum disparo
direto de mensagem, nenhum `wait_for_event` por WhatsApp/Instagram.

Também de fora: autonomia irrestrita, LLM em produção, cobrança/planos (só a
camada de capacidades), UI do override `capabilityFlags` por empresa.

## 10. Situação

Branch `arena/01a0ac7b-instalink`. Portões: `npx tsc --noEmit` · `npm test`
**746/746** (50 arquivos) · `npm run build` ok. `npm run master` não é gate
(alteraria dados). P4 permanece a infraestrutura estável; o P5 só planeja.
