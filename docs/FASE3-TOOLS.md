# F3-D — Tool Registry + Agent Safety

## Cadeia

```text
Conversation Agent
        ↓
    Tool Registry          (catálogo fechado — só nomes registrados)
        ↓
Tenant / Permission Guard  (businessId da sessão; msg do paciente = untrusted)
        ↓
Domain Services            (booking-create, pipeline, contacts, pets, tasks…)
        ↓
GoDoutor
```

Nenhuma tool acessa SQL/documento cru.

## ToolDef

| Campo | Significado |
|---|---|
| name / description | identidade para o modelo |
| domain | clinic \| agenda \| people \| vet \| crm |
| sideEffect | read \| write \| destructive |
| requiresPermission | PermissionId da sessão (null = leitura de tenant) |
| requiresConfirm | true para ação importante (criar/remarcar/cancelar booking) |
| inputSchema / outputSchema | validação determinística |
| handler | domínio oficial — recebe `ctx.businessId` já validado |

## Tools iniciais

- **Clínica:** getClinicInfo, getOpeningHours, getLocation, listServices, getServiceInfo, listProfessionals
- **Agenda:** findAvailableSlots, getBooking, createBooking, rescheduleBooking, cancelBooking
- **Pessoas:** findClient, createClient, getClientBasics
- **Veterinária:** listTutorPets, createPet, getPetBasics
- **CRM:** createLead, updateLeadStage, createTask, addAdministrativeNote

Fora do registry (negado com `denied_clinical`): getAnamnese, getMedicalRecord, getPatientChart, listClinicalNotes, getProntuario…

## Prompt injection

Mensagem do paciente = **DADO NÃO CONFIÁVEL**. Nunca concede permissões, troca businessId, escolhe tool não autorizada, acessa outro tenant, executa SQL ou edita documento cru. Guards revalidam no servidor (`authorizeToolCall`). Input com `businessId` ≠ sessão → `tenant_mismatch`.

## Confirmação

- leitura → direto (se permitido);
- escrita simples → fluxo normal;
- **criar / remarcar / cancelar booking** → `requiresConfirm`; sem `confirmed:true` → `needs_confirm` e nada é gravado.

## Idempotência

Tools write/destructive usam `ctx.idempotencyKey` → coleção `idempotencyKeys` (`endpoint=agent-tool:<name>`) — retry não duplica.

## Auditoria

`agent.tool_called` · `agent.tool_denied` · `agent.tool_failed` (+ `booking.rescheduled` ao remarcar via tool).

Meta curta: tool, domain, sideEffect, ok/code, callId — **sem chain-of-thought**, sem prompt do paciente, sem stacktrace para o usuário.

## AIProvider (Composer real — prep)

`src/lib/ai/provider.ts`: interface `AIProvider`, `blockedAIProvider()`, const `BLOCKED_AI_PROVIDER_CREDENTIAL`.

Fluxo alvo: NL → AIProvider → AutomationProposal → schema validation → policy/permission → preview humano → testar → aprovar/ativar. IA **nunca** grava/ativa direto.

Fallback: `refinePlan` para ajuste simples inequívoco; se não compreender → **não altera o plano** → provider (ou blocked honesto).

## Testes

`src/lib/__tests__/fase3-tools.test.ts` — 8 cenários obrigatórios + catálogo + guards.
