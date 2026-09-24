# Relatório F3-H — Follow-up, Reativação e Anti-Duplo-Envio

**Branch:** `arena/01a0ce4e-instalink`  
**Commit:** `019104d` — `F3-H: follow-up, reactivation and idempotent outreach`  
**Base:** `4fd30a9` (F3-G) → PR **#37** (OPEN, sem merge)  
**Escopo:** encerrado — **PARAR antes de F3-I**

---

## 1. Objetivo entregue

Ciclo completo sem segunda engine, sem timer em memória e sem módulo de campanhas:

- **Atendimento → retorno → `followup.due` → Automação → MessagingService → resposta → Booking Assistant (F3-E) → Agenda**
- **Inativo → `patient.inactive` → elegibilidade (consentimento) → mensagem → resposta → agendamento**

Reuso (sem duplicar): Event Layer F3-A, receitas F3-B, Automation Engine, Tool Registry F3-D, Booking Assistant F3-E, Inbox/Handoff F3-F, MessagingService F3-G.

---

## 2. Anti-duplo-envio (4 camadas)

| Camada | Mecanismo |
|--------|-----------|
| **1 · Outreach** | Chave lógica `followup:${businessId}:${kind}:${ruleId}:${subjectId}:${dueDate}` — 1 registro por evento de negócio |
| **2 · Evento/run** | `eventKey` estável no `emitAutomationEvent` — mesma chave ⇒ 1 run lógico |
| **3 · Step/Message** | `meta.idempotencyKey` gravado na Message do passo de envio da automação |
| **4 · MessagingService** | `sendConversationMessage({ idempotencyKey })` — retry reusa a Message existente, não cria 2ª |

Sem `setTimeout` longo: o **cron** `/api/cron/automations` roda `scanAllOutreach` **antes** de `drainAutomations` (fallback F3-A).

---

## 3. Quiet hours

- Fuso do **negócio** (`Business.timezone` aditivo; default `America/Sao_Paulo` via `tz.ts`).
- Janela padrão **08:00–20:00**; se o dia tem `hours[weekday]`, usa `open`/`close`.
- Fora da janela: status `ignorado` + `nextAttemptAt` — **adiama, não falha**.
- Domingo sem regra ⇒ quiet.

---

## 4. Revalidações e skips

| Reason | Status humano |
|--------|----------------|
| `skipped_no_phone` | Sem telefone |
| `skipped_already_scheduled` | Já agendado |
| `skipped_superseded` | Superado |
| `cancelled_by_context` | Cancelado |
| `skipped_no_marketing_consent` | Sem consentimento |
| `skipped_declined` (resposta negativa) | Recusado |
| `awaiting_channel` (WhatsApp off) | Aguardando WhatsApp |
| quiet hours | Ignorado |

Canal off ⇒ **não emite evento de envio**; ao reconectar, revarredura revalida e emite.

---

## 5. Retorno (operacional) × Reativação (marketing)

- **Retorno:** campos `followUpMode`/`followUpDate`/`followUpDays`; copy operacional (sem motivo clínico); **NÃO** marketing.
- **Reativação:** 30/60/90/180 dias por último **atendimento CONCLUÍDO** (booking futuro ⇒ não inativo); exige `contact.marketingOptIn === true`.
- **Vet (`clinicType === 'veterinaria'`):** paciente = **PET**; destino da mensagem = **tutor**.

---

## 6. Resposta e fluxo F3-E

- Classificação: `positive` / `negative` / `human` / `other`.
- **`sim` ⇒ `paciente_respondeu`** — **não cria booking direto** (entra no Booking Assistant F3-E).
- Negativa ⇒ `recusado` terminal (sem insistir).
- Humano ⇒ registra resposta (handoff continua sendo F3-F).
- Booking criado a partir do fluxo ⇒ `markOutreachBooked` → `Agendamento realizado`.

Hook: `applyOutreachReply` no webhook WhatsApp após `receiveInbound` (não-duplicata).

---

## 7. UI (sem eventId/payload/webhook/runner)

- Status humanos: **Retorno previsto**, **Aguardando WhatsApp**, **Mensagem enviada**, **Ignorado**, **Recusado**, etc. (`FOLLOW_UP_OUTREACH_LABELS`).
- Inbox: badge **`Origem: Retorno|Reativação`** (lista de conversas).
- Pet 360: **`Retorno previsto: dd/mm`** no PET.
- Automação: receitas **«Lembrar retornos»** e **«Reativar pacientes»** (2 cards simples; sem segmentador/CSV/blast).
- GET `/api/followup` expõe `outreach` para a UI.

---

## 8. Observabilidade F3-I (preparado, sem dashboard)

- `AutomationRun.triggerSource?: 'return' | 'reactivation'` gravado no emit.
- Audit: `followup.outreach_evaluated` (sem token/payload/CoT).
- Cron responde `outreachEmitted` / `outreachSkipped`.

---

## 9. Arquivos principais

| Arquivo | Papel |
|---------|--------|
| `src/lib/follow-up-outreach.ts` | Núcleo: chave, quiet hours, revalidações, scan, reply, history |
| `src/lib/types.ts` | `FollowUpOutreach`, labels, `triggerSource`, `Business.timezone`, audit |
| `src/lib/db.ts` | `followUpOutreach` em emptyDB/normalize |
| `src/lib/automation/events.ts` | `EmitInput.source` → `triggerSource` |
| `src/lib/automation/actions.ts` | Stamp `idempotencyKey` + conversationId no envio |
| `src/lib/automation/templates.ts` | Copy das 2 receitas |
| `src/lib/messaging/service.ts` | Camada 4 idempotencyKey |
| `src/app/api/cron/automations/route.ts` | Scan + drain |
| `src/app/api/whatsapp/webhook/route.ts` | `applyOutreachReply` |
| `src/app/api/followup/route.ts` | Lista outreach |
| `src/app/api/conversations/route.ts` | `outreachOrigin` |
| `src/components/dashboard/ConversationsView.tsx` | Badge Origem |
| `src/components/dashboard/Pet360Sheet.tsx` | Retorno previsto no pet |
| `src/lib/__tests__/fase3-h-followup.test.ts` | **20 testes** (1–12 retorno, 13–20 reativação) |

---

## 10. Gates

| Gate | Resultado |
|------|-----------|
| `tsc --noEmit` | **0 erros** |
| F3-H (`fase3-h-followup`) | **20/20** |
| Regressão F3-G+F+F+E+D+event-layer+fase2-followup | **106/106** (7 arquivos) |
| Suíte completa | **2016 passed / 6 failed** (baseline pré-existente: a34×3, audit-p4 poda, pipeline, p61) |
| `npm run build` | **0** — 122 págs geradas |
| Push | `019104d` → `arena/01a0ce4e-instalink` |
| PR #37 | **OPEN / sem merge** |
| Vercel | deploy do push (verificar no dashboard) |

---

## 11. Fora de escopo respeitado

NÃO: segunda engine · timer/polling/worker · scheduler/sender/conversation/booking/consent/provider/retry novos · módulo de campanhas · envio real com canal bloqueado · follow-up como marketing · tutor como paciente · booking direto no `sim` · 2º assistente · motivo clínico · UI técnica · refazer Agenda/Página/Encounter/Pet360/Paciente360/Inbox/Config/Provider · migrar banco · merge · **iniciar F3-I**.

---

**Estado final:** F3-H **ENCERRADO**. Próxima fase (F3-I) **NÃO iniciada** por decisão do briefing.
