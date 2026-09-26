# FASE 3-B — Receitas prontas + status da automação

**Commit F3-B:** (preenchido no commit)

## O que entrou

### 1. Espera relativa ao agendamento (`booking_offset`)
- Novo modo de wait: `{ mode: 'booking_offset', offsetMinutes: -1440 }` (negativo = antes do início do booking).
- Limites: offset entre −30 dias e +7 dias; alvo sempre recalculado do **booking vivente** no contexto.
- Executor: `refreshRunSubjectContext` antes de espera e de cada ação — cancelamento/remarcação mudam o alvo ou encerram o run (`cancelled` se booking saiu de cena).
- `send_channel_message` revalida no envio: `cancelled` ⇒ não envia (exceto `forceSendOnCancelled`); `no_show` ⇒ não envia lembrete (exceto `forceSendOnNoShow` na receita de recuperação).

### 2. Modelo `status` + `source` (compat aditiva)
- `Automation.status?: 'draft' | 'active' | 'paused' | 'archived'` — ausente em docs antigos ⇒ `automationStatusOf` deriva de `active` (`true→active`, `false→paused`).
- `Automation.source?: 'manual' | 'template' | 'ai'`.
- Receita/modelo e IA **nascem `draft`** (`active: false`); ativação explícita via toggle/`active: true`.
- Toggle: `active` e `status` sincronizados; `archived` não volta por toggle.
- UI: badge rascunho/ativa/pausada + selo receita/IA + aviso “Pronta — revise e ative”.

### 3. Catálogo (~12 receitas novas + base P4)
| id | Gatilho | O que faz |
|----|---------|-----------|
| booking_confirm_24h | booking.created | espera 24 h antes → WhatsApp confirmação |
| booking_reminder_2h | booking.created | espera 2 h antes → WhatsApp lembrete |
| booking_created_msg | booking.created | dados do horário no WhatsApp |
| booking_rescheduled_msg | booking.rescheduled | avisa novo horário |
| booking_no_show_recovery | booking.no_show | tarefa de reagendamento + toque |
| booking_completed_thanks | booking.completed | espera 2 h → agradecimento (sem orientação clínica) |
| booking_review_request | booking.completed | espera 1 dia → pede opinião do atendimento |
| followup_return_msg | followup.due | tarefa + aviso de retorno |
| patient_inactive_reengage | patient.inactive | só com `marketingOptIn` → tarefa + reativação |
| lead_created_welcome | lead.created | boas-vindas no WhatsApp |
| booking_cancelled_msg | booking.cancelled | confirma cancelamento |
| lead_followup_no_booking (base) | lead.created | já existia |

**Aniversário:** sem evento `birthday` no Event Layer ⇒ receita **não criada** (honesto; documentado no teste).

### 4. UI `/automacoes`
- Aba “Receitas prontas” (antes “modelos”); CTA “Usar receita” cria **rascunho**.
- Editor de espera: modo “Relativo ao agendamento” com presets 24 h / 2 h / 1 h / 30 min antes.

## Não feito / pendente (matriz)
- Emissão `followup.due` / `patient.inactive` (evaluate puro) — **F3-H**.
- `message.sent` Instagram path de actions.ts.
- Canal: receitas com `send_channel_message` enfileiram no canal; sem WhatsApp conectado = fila honesta (não finge envio).
- Teste de integração ponta-a-ponta com booking cancelado entre espera e envio — coberto por unidade em `fase3-recipes` + revalidação no executor/actions.

## Verificação
- `tsc --noEmit` 0
- `fase3-recipes` 9/9; suíte automações/ai/fase3: 141 pass (única falha conhecida pré-existente = `automation-audit-p4`, reproduzida também no tree F3-A com stash)
