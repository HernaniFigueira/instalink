# Retry de webhooks — fila persistida + disparo por scheduler externo

Como a fila de retry deixou de depender de chamada manual **sem** depender de
uma plataforma específica:

```text
scheduler (qualquer um: cron de VPS, agendador externo, Vercel Cron, manual)
      ↓  GET /api/cron/webhooks   (Authorization: Bearer $CRON_SECRET)
endpoint de disparo (src/app/api/cron/webhooks/route.ts)
      ↓  autentica e delega (nenhuma regra de retry na rota)
processPendingWebhookDeliveries()            ← src/lib/webhooks.ts
      ↓  reivindica (claim CAS) as entregas com nextRetryAt vencido
tentativa de entrega (mesmo eventId / mesma assinatura HMAC)
      ↓
success  |  pending + próximo backoff  |  failed
```

Regras de retry **inalteradas** (aprovadas no P3): tentativa 1 imediata no
evento, tentativa 2 após ~30s, tentativa 3 após ~120s e, então, `failed`.
Nunca existe retry infinito.

## Ambiente atual: Vercel Hobby (Free)

O projeto está no **Vercel Hobby**, onde o cron nativo é limitado a **1
execução por dia** (o `* * * * *` do cron da Vercel é recurso de plano Pro).
Por isso **não existe agendamento por minuto em `vercel.json`** — nenhuma
configuração de deploy pressupõe Vercel Pro.

O retry persistido está implementado e **funciona no Hobby** assim que a fila é
drenada por algum gatilho: as entregas ficam `pending` com `nextRetryAt` no
banco e nada é perdido enquanto o agendador estiver parado. O que muda entre
ambientes é apenas **quem chama o endpoint** — o motor de retry é o mesmo.

> Enquanto o agendador não estiver configurado, as tentativas 2 e 3 acontecem
> na próxima execução do gatilho (e, em último caso, podem ser acionadas manualmente).

### Ativar hoje no Hobby, sem custo

| Opção | Como |
|---|---|
| Agendador externo | GitHub Actions (ou similar) com `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://SEU-DOMINIO/api/cron/webhooks` |
| Cron da Vercel (1x/dia) | cadastrar o path `/api/cron/webhooks` no painel do projeto (Hobby permite 1x/dia) como rede de segurança |
| Disparo manual (ops) | o mesmo `curl` acima |

Defina `CRON_SECRET` no ambiente do projeto (Vercel → Settings → Environment
Variables) e use o **mesmo valor** no agendador.

## Migração futura para VPS

Quando o projeto for para uma VPS, nenhuma linha do motor de retry muda: basta
apontar o cron do próprio servidor para o mesmo endpoint protegido.

```cron
# crontab do servidor (a cada minuto) — atende o backoff de 30s/120s
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://SEU-DOMINIO/api/cron/webhooks >/dev/null 2>&1
```

- Em VPS também é possível chamar o processador **em processo** (script/worker
  Node importando `processPendingWebhookDeliveries()`), sem passar por HTTP.
- O intervalo é escolha do ambiente: 1 minuto cobre os backoffs do P3 com
  margem; a rota é idempotente e à prova de sobreposição, então chamadas mais
  frequentes não geram entrega duplicada.

## Autenticação

| Situação | Resposta |
|---|---|
| `CRON_SECRET` ausente no ambiente | **503** — consumidor desativado (falha fechada) |
| Header ausente, vazio ou segredo divergente | **401** |
| `Authorization: Bearer <CRON_SECRET>` correto | **200** com contadores |

O segredo é comparado em tempo constante e nunca aparece em resposta, log ou
mensagem de erro. A Vercel, quando o cron nativo está configurado, envia esse
header automaticamente; agendadores externos/cron de VPS devem enviá-lo.

## Concorrência (a mesma tentativa nunca sai duas vezes)

O agendador pode sobrepor execuções e o ambiente pode rodar mais de uma
instância da função. Para evitar duas requisições externas da MESMA entrega:

1. a entrega vencida é **reivindicada** (`claimToken` + `claimExpiresAt`, lease
   curto) dentro de uma escrita condicional — CAS (`updateDBWithCas`), que usa
   `md5(data::text)` no Postgres para gravar só se ninguém escreveu no meio;
2. a tentativa HTTP acontece **fora** do lock do banco;
3. o resultado só é gravado enquanto a posse ainda for daquela execução — e a
   posse é liberada ao final do ciclo.

Se a função for interrompida no meio, o lease expira e a entrega volta no
próximo ciclo. Mesmo num reenvio, o receptor idempotente deduplica pelo MESMO
`eventId` (por isso o `eventId` é preservado em todas as tentativas).

Nada de Redis, BullMQ, Kafka ou serviço externo: o próprio banco atual
(documento JSONB em produção / arquivo local em dev) é o árbitro.

## Operação

- Ajustes opcionais: `WEBHOOK_RETRY_LEASE_MS` (45000),
  `WEBHOOK_RETRY_BATCH_SIZE` (20), `WEBHOOK_RETRY_BUDGET_MS` (8000).
- Entrega vencida que passa do orçamento de um ciclo volta no ciclo seguinte.
- O painel (`GET /api/integrations/webhooks`) lista as entregas sem os campos
  internos de posse e nunca devolve o segredo do webhook.
