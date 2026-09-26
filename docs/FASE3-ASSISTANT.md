# F3-E — Assistente de agendamento (passo-a-passo com confirmação)

## Cadeia

```text
Conversa (paciente/secretária)
        ↓
BookingAssistant          (máquina de estados — SEM SQL cru)
        ↓
callTool (Tool Registry)  (F3-D: guards, tenant, permissão, idempotência)
        ↓
Domain Services           (createBookingTx, computeSlots…)
        ↓
GoDoutor
```

Nenhum caminho do assistente toca SQL ou documento cru: só tools registradas.

## Fluxo (UX de secretária — sem JSON/trigger/webhook)

| Passo | O que pergunta | Detalhe |
|---|---|---|
| need_service | Qual serviço? | `listServices` da unidade; serviço único → pula |
| need_date | Qual data? | parse determinístico (ISO, `10/10`, "amanhã"); data passada → recusa |
| need_time | Qual horário? | `findAvailableSlots`; só slots livres servidos são aceitos |
| need_person | Nome + WhatsApp | tutor/contato |
| need_pet | Para qual pet? | só se `listTutorPets` achar pets; "sem pet" opcional |
| confirm | Resumo + sim/não | **createBooking SÓ após "sim"** |
| done / cancelled | — | bookingId ou nada |

## Regras

- **Confirmação:** `createBooking` roda com `confirmed: true` apenas após resposta positiva inequívoca. Ambiguidade → pede de novo; nada é gravado.
- **Vet = pet como paciente:** `petId` validado pela tool no tenant; tutor é o contato. Resumo mostra o nome do pet.
- **Guardrails clínicos:** pedido de diagnóstico/receita/remédio → recusa educada (`clinical_guardrail`); não sai do fluxo nem inventa orientação.
- **Conhecimento só da clínica:** serviços/horários/slots vêm das tools da unidade; nunca internet genérica.
- **Mensagem do paciente = dado não confiável:** `patientMessage` com injeção não troca tenant nem concede permissão (guards F3-D).
- **Fallback sem AIProvider:** parsing determinístico de data/horário/serviço óbvio; NL ambíguo → clarificação (não inventa). Quando `AIProvider` estiver credenciado, pode intermediar clarificações — sem alterar a máquina de estados nem pular a confirmação.
- **Sem chain-of-thought** em audit ou replies.

## API

```ts
import { newBookingSession, handleBookingMessage } from '@/lib/ai';

const session = newBookingSession();
const reply = handleBookingMessage(session, messageFromPatient, toolCallContext);
// reply: { ok, step, message, options?, draft?, bookingId?, needsConfirm?, error? }
```

## Testes

`src/lib/__tests__/fase3-booking-assistant.test.ts` — parsing, fluxo feliz, confirmação ambígua/negativa, guardrail, data passada, dia fechado, injeção/tenant, cancelar, pet (dois pets / sem pet / pet inválido).
