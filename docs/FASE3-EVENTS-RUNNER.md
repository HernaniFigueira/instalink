# Fase 3 · Event Layer + Execução Durável

## Event Layer (F3-A)

Catálogo em `AUTOMATION_EVENTS` (`src/lib/types.ts`) + defs em
`src/lib/automation/model.ts` (`AUTOMATION_EVENT_DEFS`).

| Evento | Origem da emissão |
|--------|-------------------|
| lead.* / customer.* | `lib/pipeline.ts`, `integrations/inbound.ts` (P4 existente) |
| booking.created | `lib/booking-create.ts` |
| booking.confirmed / cancelled / completed / **no_show** | `lib/booking-status.ts` · `bookingStatusEvent` |
| **booking.rescheduled** | `app/api/bookings` PATCH (move + recreate) |
| **encounter.started** | `app/api/encounters` POST |
| **encounter.completed** | `app/api/encounters` finalize |
| **conversation.started** | `app/api/whatsapp/webhook` (conversa nova) |
| **conversation.handoff** | `app/api/conversations` switch_mode → human |
| **message.received** | `app/api/whatsapp/webhook` (inbound) |
| **message.sent** | ações de envio (P4 + fila WhatsApp) |
| **followup.due** / **patient.inactive** | `lib/follow-up.ts` (avaliação; disparo em F3-H) |

Cada evento: `eventId` (uuid no contexto), `businessId`, `entityId` no payload,
`timestamp`, payload mínimo (whitelist de snapshots — nunca o documento inteiro).

Idempotência do gatilho: `eventKey` + escopo (business, automation) — inalterado.

## Execução durável (avaliação)

**Decisão: MANTER o runner atual** (`waitingUntil` persistido + claim CAS +
lease + `/api/cron/automations` + gancho inline no `updateDB`).

Por quê:

1. Sobrevive a deploy/restart/fim de função — o estado está no Postgres
   (`instalink_doc`), não em memória.
2. Nenhum `setTimeout` de horas; nenhum processo esperando 24h.
3. Retries com dedupe (`automationId+runId+stepId` via histórico/ação).
4. Revalidação antes de ação atrasada (executor recarrega o run/subject).

**Vercel Workflow SDK**: não instalado; sem `vercel.json` de workflows no
projeto atual. Adicionar o SDK exige mudança de infra/plano e não desbloqueia
jornada — o contrato `AutomationRunner` (emit → queue → drain) já está
desacoplado. Se no futuro o SDK for habilitado, o drain passa a ser um
workflow sem mudar o modelo de dados.

Bloco registrado como **FEITO com runner atual**; SDK Workflows = **PENDENTE
de infra** (não de código de domínio).

## Cancelamento / reagendamento

Antes de enviar (ação no executor), o contexto é relido do documento:
booking cancelado/reagendado ⇒ ação pula ou o gatilho `booking.rescheduled`
gera run novo. Lembrete antigo em `waiting` de booking cancelado: ao retomar,
revalidação do subject ⇒ `skipped` sem envio (testes de motor).

## Idempotência

- Gatilho: `eventKey` dedupe.
- Ações externas: chave lógica no histórico do run + outbox WhatsApp com
  claim próprio (P3) — retry não duplica mensagem.
