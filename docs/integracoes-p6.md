# P6 — Canais e integrações externas

Camada que liga o InstaLink ao mundo de fora **sem duplicar** nada do que já
existe: aqui só mora conexão, normalização, autenticação de origem e log.

```text
EXTERNO → CONNECTOR → EVENTO NORMALIZADO → emitAutomationEvent() → P4 (automações)
                                                                    ↓
                                          lead, contato, esteira, tarefas, agenda
P4 (ação) → conector de saída → sistema externo (webhook assinado do P3; canais no P6.1+)
```

- **P3** continua dono de: chaves de API (`ik_live_`), webhooks de saída com HMAC,
  fila de retry com posse/lease e o endpoint `/api/cron/webhooks`.
- **P4** continua dono de: automações, execuções, esperas, tarefas e o barramento
  `emitAutomationEvent`. O P6 **não** cria segundo motor.
- **P5** segue em `src/lib/ai/` **por cima** do P4: a IA propõe, o P4 executa.
  O P6 só amplia os canais/eventos que podem entrar numa automação.

Três categorias que **não** se misturam (`kind` na conexão):

| categoria   | o que é                       | provedores do catálogo                                   |
| ----------- | ----------------------------- | -------------------------------------------------------- |
| `channel`   | por onde se conversa          | whatsapp, instagram, messenger, telegram                 |
| `source`    | de onde o lead veio           | form, landing_page, paid_traffic, qrcode, public_page     |
| `technical` | por onde os dados viajam      | inbound_webhook, n8n, external_api                        |

## Honestidade do catálogo

`src/lib/integrations/catalog.ts` é a **fonte única** do que existe e do que já
funciona. `canConnect: false` significa que o conector ainda não existe: a
interface mostra **“Disponível em breve”** com o motivo e a API **recusa** a
criação (HTTP 409). Nada de fingir WhatsApp/Instagram conectados. Os canais
seguem indisponíveis (`whatsapp`/`instagram` → P6.1, `messenger`/`telegram` →
P6.2) e a saída por canal devolve `not_implemented` em vez de “enviado”.

## Envelope canônico (entrada)

`POST /api/integrations/inbound/<integrationId>`

```http
Authorization: Bearer ilk_live_…            (ou X-Instalink-Token)
X-Instalink-Signature: t=1710000000,v1=…    (só quando a integração exige)
Idempotency-Key: …                          (opcional; usado se o payload não trouxer id)
Content-Type: application/json
```

```json
{
  "event": "lead.created",
  "externalId": "evt-123",
  "occurredAt": "2026-09-16T12:00:00.000Z",
  "source": "campanha-setembro",
  "channel": "instagram",
  "contact": { "name": "Maria Souza", "phone": "(11) 98888-7777", "email": "maria@exemplo.com", "instagram": "@maria" },
  "data": { "message": "Quero agendar", "interest": "Corte", "serviceId": "srv_1" },
  "metadata": { "utm_source": "facebook", "utm_campaign": "set" }
}
```

Regras do contrato (`src/lib/integrations/contract.ts`):

- `businessId` do corpo é **ignorado** (e anotado no log): a unidade vem da
  **integração autenticada** pelo token.
- Idempotência = `integrationId + externalId` (ou `Idempotency-Key`). Repetir o
  mesmo evento gera **uma** entrada efetiva; outro `externalId`, outra entrada.
- Payload é sanitizado: teto de corpo (64 KB), de eventos por entrega (25), de
  chaves (40) e de profundidade (3). Nada de guardar blob hostil no documento.
- `occurredAt` com mais de 1 ano de desvio é ignorado (usa “agora”).
- Referências internas (`stageId`, `serviceId`, `professionalId`) são validadas
  **dentro da unidade** antes de virarem efeito.

Payloads **crus** também entram quando a integração tem `defaultEvent` (é o caso
de formulário, landing page, tráfego pago e n8n): o adaptador do provedor
reconhece `nome`/`telefone`/`e-mail`/`mensagem` (PT-BR **e** inglês) e `utm_*`,
`gclid`, `fbclid`, `ttclid`. Integrações técnicas (`inbound_webhook`,
`external_api`) exigem o envelope — não se adivinha formato de API. Listas
(n8n/planilha) viram vários eventos, com teto de 25.

## Eventos

`EXTERNAL_EVENT_DEFS` (`src/lib/types.ts`) é o vocabulário mínimo:

| evento              | suportado hoje | destino no motor                                  |
| ------------------- | -------------- | ------------------------------------------------- |
| `lead.created`      | ✅              | `ingestLead` → lead + contato + gatilhos do P4     |
| `lead.updated`      | ✅              | `ingestLead` (atualiza o existente)                |
| `form.submitted`    | ✅              | igual a `lead.created`                             |
| `contact.created`   | ✅              | `upsertContact` + `customer.created` (P4)          |
| `contact.updated`   | ✅              | `upsertContact` + `customer.updated` (P4)          |
| `message.received`  | declarado (P6.1)| responde 422 com motivo — sem efeito falso         |
| `booking.requested` | declarado (P6.1)| responde 422 com motivo                            |

Evento declarado e ainda não entregue é **recusado com motivo claro** (422
`event_not_supported`) e registrado no log — não vira efeito pela metade.

## Saída (evento interno → sistema externo)

`dispatchOutboundEvent()` (`src/lib/integrations/outbound.ts`) é o único caminho.
A ação `dispatch_webhook` do P4 chama essa função — e **não** conhece provedor
nenhum:

- `targets: ['webhook']` (hoje) → `dispatchWebhook` do P3: HMAC `t=…,v1=…`,
  timeout de 5 s, histórico de tentativas e a **mesma** fila de retry
  (`/api/cron/webhooks`). Sem segundo motor de retry, sem Redis.
- `targets: ['channel']` (P6.1) → conector do canal via
  `registerChannelConnector()`. Hoje todos devolvem `not_implemented` e a
  tentativa é registrada como `failed` — nunca como entregue.

URLs de saída passam por `src/lib/outbound-url.ts` (SSRF): esquema http(s),
sem credenciais na URL, host público. Destino privado/loopback/metadados de
nuvem é recusado em produção; em dev/teste (ou com
`ALLOW_PRIVATE_OUTBOUND_URLS=1`, para on-prem) continua permitido. DNS
rebinding é risco residual documentado (P6.1).

## Isolamento (multi-tenant)

- Todo `Integration` pertence a **exatamente um** `businessId`.
- `businessId` **nunca** vem do payload — vem da integração autenticada.
- Rotas de administração usam `requireBusiness(req, businessId, 'config')`:
  dono de A não lista, cria, altera, rotaciona, pausa nem remove conexão de B
  (403); com o negócio de A, o id de uma conexão de B responde 404.
- Log de entregas é por unidade e some junto com a conexão removida.

## Endpoints

| método | rota                                   | quem usa            | permissão |
| ------ | -------------------------------------- | ------------------- | --------- |
| GET    | `/api/integrations?businessId=`         | painel (catálogo + conexões + log) | `config` |
| POST   | `/api/integrations`                     | criar conexão (token aparece **uma vez**) | `config` |
| PATCH  | `/api/integrations`                     | editar, pausar/reativar, rotacionar | `config` |
| DELETE | `/api/integrations`                     | remover conexão (+ log dela) | `config` |
| GET    | `/api/integrations/events?businessId=`  | log de entregas     | `config` |
| POST   | `/api/integrations/inbound/<id>`        | **sistema externo** (token da integração) | — |

Respostas **nunca** devolvem token, hash ou segredo: só máscara
(`ilk_live••••••••1234`). O valor cru do token/segredo existe apenas na
resposta da criação e da rotação.

## Interface

`Configurações → Canais`: três blocos (Canais / Fontes / Integrações), estado
honesto (“Disponível em breve” com motivo), conectar (endpoint + token
mostrados uma vez, com exemplo de `curl`), pausar/reativar, rotacionar token,
remover e o log de eventos recebidos. Webhooks de saída continuam na aba
**Integrações** (canal assinado do P3) — uma fonte de verdade só.

## Código

```text
src/lib/integrations/
  contract.ts     contrato do evento normalizado + sanitização + idempotência
  catalog.ts      catálogo (canal/fonte/integração) — fonte única da verdade
  connections.ts  CRUD da conexão, credenciais (hash), autenticação da origem
  connectors.ts   adaptadores de ENTRADA + conectores de SAÍDA (canais)
  inbound.ts      pipeline: autenticar → normalizar → idempotência → motor → log
  outbound.ts     evento interno → conector (webhook usa o P3; canais no P6.1)
  logs.ts         log de entregas (500/unidade; 90 dias; duplicata 7 dias)
src/lib/outbound-url.ts             guarda de destino (SSRF)
src/app/api/integrations/…          rotas (lista, criar, editar, remover, log, inbound)
src/components/dashboard/CanaisIntegracoesView.tsx   tela de configuração
```

## Limites conhecidos (próximas fases)

- **P6.1**: WhatsApp Cloud API, Instagram Graph API, reserva atômica (CAS) da
  idempotência entre instâncias simultâneas, verificação de IP na conexão (DNS
  rebinding), conector nativo de Lead Ads.
- **P6.2**: Messenger, Telegram, `wait_for_event` por evento de canal.
