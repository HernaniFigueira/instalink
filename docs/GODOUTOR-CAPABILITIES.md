# GoDoutor — capacidades (Fase 3 final)

Data: 2026-09-23 · PR #37 · **"Sim" = capacidade de código/teste; não = produção com credenciais Meta/LLM.**

## O que a plataforma FAZ neste PR

| Área | Capacidade | Condição de produção |
|---|---|---|
| Agenda | Slots, reserva, regras, recorrência, disponibilidade | Funciona local; confirmação via canal depende WhatsApp real |
| Pet 360 / CRM | Fichas; tutor ≠ paciente em vet (`clinicType`) | Dado multi-tenant no DB da app |
| Página pública | Editor, blocos, templates, publicação | Independente da Meta |
| Automações | Event layer, receitas, composer determinístico, runner cron+CAS | Sem Workflow SDK: fila por cron (`PARTIAL_INFRA`) |
| Agente / tools | 21 tools; guards tenant/permissão/injeção/confirm/idempotência/audit | Sem AIProvider real → modo básico determinístico |
| Inbox / handoff | `waiting_team`, `human_active`, takeover; sem CoT | Simulador com badge; sem saída Meta não envia de verdade |
| Follow-up / reativação | Escaneio due, opt-out, frequência, canal pronto | **Não** envia se canal bloqueado |
| WhatsApp Cloud | Webhook HMA, assinatura, normalização, janela 24h | **BLOCKED_META_CREDENTIAL** sem App Secret/token |
| Métricas / health | Dashboard, Automações e Config honestos | Sem dado ⇒ `—`/omitir; blocked ≠ error |
| Segurança / PII | Tenant isolation, `redactSensitive`, retenção documentada | Audit de denegações |

## O que NÃO é (não vender como pronto)

- NÃO é envio WhatsApp real sem credencial Meta (Simulator ≠ entregue).
- NÃO é LLM clínico / diagnóstico / decisão médica.
- NÃO é AIProvider completo (F3-C determinístico; F3-A sem Workflow SDK).
- NÃO é billing, Control Center, segunda engine de mensagem, módulo de campanhas novo, novo banco.
- NÃO inventa preço, horário nem % de entrega sem webhook de status real.

## Requisitos externos p/ produção completa

1. Meta Cloud API: App Secret, Permanent Token, Phone Number ID (+ homologação).
2. AIProvider: chave/modelo autorizados (quando liberado em sessão).
3. Vercel Workflow SDK (ou equivalente durável) para substituir o fallback do runner.
