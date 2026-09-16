# P5 — Camada de IA / Agent (por cima do P4)

> A IA interpreta intenção. O P4 executa.
> Texto livre nunca vira código, SQL ou ferramenta arbitrária.

```text
USUÁRIO
  ↓
P5 — AI / Agent          src/lib/ai/
  ↓  plano estruturado (evento, condição, passos)
  ↓  validação determinística
  ↓  Automation Graph do P4 (nodes + edges)
  ↓  aprovação humana
P4 Executor              src/lib/automation/executor.ts
  ↓
serviços oficiais        pipeline · booking · tasks · webhooks
```

O P5 **não** é um segundo motor de automações. Não há executor paralelo, não há
formato paralelo de workflow, não há publicação automática.

## Contrato (P5.0)

O plano da IA é o contrato já existente do P4:

- gatilho (`AutomationEventId`)
- condições (operadores fixos + AND/OR/NOT)
- ações do catálogo (`change_lead_stage`, `assign_lead`, `create_task`, …)
- esperas, ramificações, settings (reentry, dedupe)
- `nodes[]` + `edges[]` + ids de nó
- `businessId` e recorte do tenant (etapas, serviços, equipe)

Compilação: `linearToGraph` + `validateAutomationDraft` — o mesmo gate da API
`/api/automations`.

## Planner (P5.1)

`planFromPrompt(prompt, tenantContext)` é determinístico (como o concierge):
vocabulário fechado, português, sem LLM e sem `eval`. A saída é um `AiPlan`
validável. Confiança e “assumi / não resolvi” são diagnóstico — nunca decidem
publicação.

## Aprovação (P5.4)

Estados da proposta (`db.aiProposals`): `draft → approved → published`.

- gerar / gerar novamente / editar → `draft` (não cria `Automation`)
- aprovar → `approved` (ainda não executa)
- publicar → grava `Automation` no P4 (`templateId: 'ai'`), **desligada** salvo
  o humano pedir `activate: true`
- cancelar → `cancelled`

A IA nunca liga uma automação operacional sozinha.

## Multi-tenant

Toda leitura/escrita da IA é recortada por `businessId`. Id de responsável,
serviço ou profissional de outra unidade é recusado como “referência de outro
negócio”. A API usa `requireBusiness(..., 'config')` — o id no corpo não troca
de tenant.

## Observação (P5.6)

`observeBusiness` lê execuções **da própria unidade**, explica erros e sugere
novas automações. Não executa, não republica, não olha outro tenant.

## API

| Rota | Guarda | Faz |
| --- | --- | --- |
| `GET /api/ai/automations?businessId=` | `config` | propostas + observação + exemplos |
| `POST` `action=generate\|regenerate\|approve\|publish\|cancel\|approve-publish` | `config` | ciclo de vida |
| `PATCH` | `config` | editar plano (volta para rascunho) |

## Interface

`/automacoes` → aba **Criar com IA**. Não é um chat isolado: a proposta aparece
como QUANDO / SE / ENTÃO / DEPOIS / PRAZO, com revisar, editar, cancelar, gerar
novamente, salvar rascunho e publicar só depois do ok humano.
