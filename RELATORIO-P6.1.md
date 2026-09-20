# P6.1 — WhatsApp demonstrável por QR Code

## Auditoria pré-implementação (20/09/2026)

`git pull origin main`: Already up to date. HEAD base:
`b3cb6cc68196b9e47e8a13ba8774c1396bf8ede6`.
Branch exclusiva desta sessão: `arena/01a0bc51-instalink` (fixada pelo ambiente).

Peças existentes que serão reutilizadas:
- Webhook Meta: HMAC fail-closed, resolução por phoneNumberId/WABA, transação
  com dedupe, Contact, Lead, Conversation e Message; agente e handoff já existem.
- `contacts`, `pipeline` (`findLead`/`ingestLead`): identidade e CRM únicos.
- `agentFor`/`agentActive`, `conciergeAnswer` → `agentFlowStep`: agente único,
  habilitado por `agent.channels.whatsapp`; contexto na conversa.
- `computeSlots` e `createBookingTx`: Agenda real, revalidação atômica, duração,
  buffer, antecedência, timezone, profissional, CRM e eventos P4.
- `deliverWhatsappMessage`: outbox persistida, CAS/lease, retry e cron existentes.
- `/conversas`: inbox unificado, Automação/Humano, takeover e resposta manual.
- `/canais`: `WhatsappChannelPanel`, Embedded Signup e diagnóstico Meta existentes.
- P4 orquestra os serviços oficiais; P5 só planeja automações. Não serão reescritos.

Achados a tratar: inbound está dentro da rota Meta; não há provider QR; respostas
que dependem de botões precisam de projeção textual; handoff precisa respeitar
agente desligado; mensagens precisam de namespace de provider na deduplicação;
claim WhatsApp não deve apanhar mensagens do Instagram; confirmação explícita
no chat WhatsApp deve usar o passo `confirm` já existente.

Contrato Evolution escolhido: **2.3.7**, tag upstream (commit
`cd800f2976e1e5b682fbf86a01ee4d85ae61f370`). Conferência direta do código oficial:
`src/api/routes/instance.router.ts`, `src/api/dto/instance.dto.ts` e
`src/api/integrations/event/webhook/webhook.controller.ts` (GitHub API).
A versão suporta headers personalizados por webhook. Usaremos segredo em header,
não query string, e nunca o `apikey` recebido no payload como autenticação.

## Implementação e validação

Em andamento. Resultados, inventário e roteiro serão preenchidos após os gates;
não há validação com sessão/telefone real neste ponto.
