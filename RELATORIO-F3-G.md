# Relatório F3-G — WhatsApp Cloud Provider + Webhook + Messaging Service

**Status: FEITO. PARAR antes de F3-H (não iniciar follow-up/reativação).**

## Commits

| Bloco | SHA |
|---|---|
| Base F2–F3-F | `e3ab058` … `f40ff31` / docs `43c1229` |
| **F3-G** | `3aa4e38` (impl) + `b1298f0` docs + `d37f2e3` test fix + `de7d7a9` docs |

## Arquitetura entregue

```
Automation / Agent / Inbox Humano
        ↓
MessagingService.sendConversationMessage()
        ↓
MessagingProvider (contrato)
  ├── WhatsAppCloudProvider  → Graph /{Phone-Number-ID}/messages
  └── SimulatorProvider      → sem rede, badge SIMULADOR
```

Inbound: Meta Webhook → assinatura → normalização → dedupe → `receiveInbound()` (F3-F) → Event Layer → Inbox/Agent/Handoff.

## Componentes

| Item | Caminho |
|---|---|
| Contrato | `src/lib/messaging/types.ts` |
| Política 24h | `src/lib/messaging/policy.ts` (`canSendFreeform`, `requiresTemplate`, `evaluateWindow`) |
| Status progressão | `src/lib/messaging/status.ts` (`shouldAdvanceStatus`, `advanceStatus`) |
| Simulator | `src/lib/messaging/simulator.ts` |
| Cloud provider | `src/lib/messaging/whatsapp-cloud.ts` |
| Service | `src/lib/messaging/service.ts` |
| Normalização | `src/lib/messaging/normalize.ts` |
| Webhook | `src/app/api/whatsapp/webhook/route.ts` (GET challenge + POST assinatura) |

## Checklist do briefing

- **Provider**: `sendText` / `sendTemplate` / `sendInteractive` / `getConnectionStatus`; resultado normalizado `{ok, provider, providerMessageId, status, errorCode?, errorMessage?}` — sem payload Meta bruto na UI.
- **Versão Graph**: centralizada em `getMetaGraphVersion()` (`META_GRAPH_VERSION` ou `DEFAULT_META_GRAPH_VERSION='v26.0'`).
- **Webhook**: GET hub.challenge (verify token fail-closed); POST X-Hub-Signature-256 fail-closed; resposta rápida; processa por batch tenant.
- **Multi-tenancy**: `resolveTenantForChange(phoneNumberId|wabaId)` — **nunca** `businessId` do payload do paciente; desconhecido → ignora sem processar.
- **Idempotência**: `provider + providerMessageId` via `receiveInbound` → duplicata `already_processed`, sem 2ª resposta/booking/conversa.
- **Inbound**: text · interactive (button_reply/list_reply com **id**) · unsupported_media (metadata).
- **Outbound**: text · template · interactive buttons; aceito ≠ delivered (status `pending` + webhook).
- **Status**: progressão monotônica `pending→sent→delivered→read`; `failed` próprio; **sem regressão** read→delivered.
- **Templates**: `sendTemplate`; sem config → `template_not_configured`; fora de janela → `template_required`.
- **Política janela**: centralizada (24h CSW Meta atual); não espalhada.
- **Consentimento**: marketing exige `marketingOptIn`; operacional não bloqueado por flag de marketing.
- **Quiet hours**: decisão antes do provider (camada de automação existente) — provider não reimplementa.
- **Handoff**: F3-F (`conversation.handoff`) — Meta só transporta.
- **Secrets**: `Business.whatsappIntegration.encryptedAccessToken` (AES-GCM) **ou** env `WHATSAPP_API_TOKEN` mono-tenant **`PILOT_ONLY_SINGLE_CREDENTIAL`**; campo aditivo `credentialRef` p/ cofre futuro; **nunca** token em UI/audit/logs/result.
- **Simulador**: `SimulatorProvider` sem fetch; badge SIMULADOR.
- **realSend**: WhatsAppCloudProvider real via `sendMetaGraphMessage` (fetch injetável p/ testes).
- **Meta credential**: **`BLOCKED_META_CREDENTIAL`** sem env real nesta sessão — envio real desativado até credencial autorizada; **não inventamos resposta da Meta**.
- **Não feito (proibido)**: Evolution/VPS/Baileys/QR web; React→Graph; token no client; migração destrutiva; refazer Inbox/Agenda/Página.

## Testes (20 obrigatórios + extras) — 21/21

`src/lib/__tests__/fase3-g-messaging.test.ts`

1. inbound texto → ConversationMessage  
2. duplicado → 1x  
3. quick reply normalizado + intent  
4. business por phoneNumberId  
5. phoneNumberId desconhecido → rejeitado  
6. `human_active` → IA não  
7. `waiting_team` → IA não  
8. humano → MessagingProvider  
9. IA → MessagingProvider  
10. automação → MessagingProvider  
11. simulator sem rede  
12. desconectado → `awaiting_channel`  
13. sent→delivered→read  
14. atrasado não regride  
15. failed preserva erro  
16. segredo fora do resultado  
17. marketing sem consentimento → blocked  
18. `template_required` fora da janela  
19. vet flow intacto  
20. Tool Registry guards intactos  

## Gates

| Gate | Resultado |
|---|---|
| tsc | **0** |
| F3-G | **21/21** |
| F3-F | **14/14** |
| F3-E | **16/16** |
| F3-D | **13/13** |
| Suíte completa | **1996/6** — mesmas 6 pré-existentes (instagram×3, audit poda, pipeline/p61 agendamento passado); event-layer corrigido no gate |
| build | **0** |
| Vercel | (poll após push) |
| merge | **NÃO** |

## Gaps / próximos (F3-H em diante)

- Credencial Meta real de teste controlado (não base de clientes).
- Embedded Signup UX completa (hoje: configuração assistida existente).
- Cofre multi-tenant real para `credentialRef` (hoje AES-GCM + env pilot).
- Pipeline de mídia (hoje `unsupported_media` honesto).
- Migrar envio da Inbox/campanhas legados para o MessagingService (conector registrado já usa Graph encapsulado).
- F3-H: followup/reativação — **não iniciar automaticamente**.

**PARANDO ANTES DE F3-H.**
