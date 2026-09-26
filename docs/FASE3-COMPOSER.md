# F3-C — Composer NL / home `/automacao`

## Decisões
1. **Home `/automacao`** = redirect 308 → `/automacoes` em `next.config.js` (alias de URL, **sem** rota nova no catálogo — `PANEL_ROUTES` e o teste de portas órfãs permanecem estáveis). A tela é o mesmo `AutomationsView` (Composer IA + receitas + lista); o menu continua em `/automacoes`.
2. **Simulação `Testar` = dry-run puro** (`simulatePlan`): caminha o plano, descreve o que o motor faria, `realSend=false` sempre. Não grava `AutomationRun`, não envia, não cria tarefa. Mensagem aparece como **Enfileiraria…**; canal desconectado → nota “aguardando conexão”.
3. **Edição conversacional pontual** (`refinePlan`, sem LLM): instrução curta sobre o rascunho atual (espera, etapa, tarefa, mensagem, nome/descrição). Instrução incompreensível ou de injeção **não altera** o plano. Trocar o gatilho = `Gerar novamente` (fluxo existente).
4. **Ações da API** `POST /api/ai/automations`: `simulate` e `refine` (guarda `config`, auditoria `ai.proposal_updated` com `refine:true`).
5. **Fluxo não regredido do P5:** gerar → editar → simular → aprovar → publicar (nunca auto-ativa; checkbox “Ligar ao publicar” opcional).

## Arquivos
- `src/lib/ai/simulate.ts`, `src/lib/ai/refine.ts`
- `src/app/api/ai/automations/route.ts` (+simulate/refine)
- `src/components/dashboard/AiAutomations.tsx` (botão Testar, campo de frase, painel dry-run)
- `src/app/(dashboard)/automacao/page.tsx`
- `src/lib/__tests__/fase3-composer.test.ts`

## Pendências ligadas
- Simular com **entidade real** (lead/booking de exemplo) vs passos abstratos — ver F3-H (preview de evento).
- Edição conversacional de automação **já publicada** (hoje só proposta/rascunho) — F3-D.
