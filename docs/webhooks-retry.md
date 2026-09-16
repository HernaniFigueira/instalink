# Retry de webhooks — consumidor automático (cron)

Como a fila de retry deixou de depender de chamada manual:

```text
Vercel Cron (a cada minuto — `crons` em vercel.json)
      ↓  GET /api/cron/webhooks   (Authorization: Bearer $CRON_SECRET)
endpoint interno protegido (src/app/api/cron/webhooks/route.ts)
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

## Autenticação

| Situação | Resposta |
|---|---|
| `CRON_SECRET` ausente no ambiente | **503** — consumidor desativado (falha fechada) |
| Header ausente, vazio ou segredo divergente | **401** |
| `Authorization: Bearer <CRON_SECRET>` correto | **200** com contadores |

O segredo é comparado em tempo constante e nunca aparece em resposta, log ou
mensagem de erro. Defina-o no projeto (Vercel → Settings → Environment
Variables) — a Vercel envia esse header automaticamente em cada disparo.

## Concorrência (a mesma tentativa nunca sai duas vezes)

A Vercel pode executar o cron sobreposto e mais de uma instância da função. Para
evitar duas requisições externas da MESMA entrega:

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

## Frequência do cron

`vercel.json` agenda `* * * * *` (a cada minuto, plano Pro). O backoff do P3
(30s/120s) é atendido com margem de até ~1 minuto:

- plano Hobby limita cron a 1x/dia — nesse caso use um agendador externo
  (ex.: GitHub Action, cron do servidor) chamando o MESMO endpoint protegido:
  `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://SEU-DOMINIO/api/cron/webhooks`
- a rota é idempotente e à prova de sobreposição, então pode ser chamada com
  mais frequência sem risco de entrega duplicada.

## Operação

- Ajustes opcionais: `WEBHOOK_RETRY_LEASE_MS` (45000),
  `WEBHOOK_RETRY_BATCH_SIZE` (20), `WEBHOOK_RETRY_BUDGET_MS` (8000).
- Entrega vencida que passa do orçamento do ciclo volta no próximo minuto.
- O painel (`GET /api/integrations/webhooks`) lista as entregas sem os campos
  internos de posse e nunca devolve o segredo do webhook.
