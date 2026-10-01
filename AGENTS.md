# AGENTS.md — GoDoutor

Este repositório contém o GoDoutor, atualmente direcionado como Clinical OS para clínicas veterinárias.

## Leitura obrigatória antes de trabalhar

Antes de propor ou implementar mudanças relevantes, leia:

1. docs/GODOUTOR-MASTER-PLAN.md — **autoridade de Estado atual e Fila de execução** (sempre validar contra Git)
2. docs/GODOUTOR-CLINICAL-OS-V1.md — especificação de arquitetura clínica (roadmap operacional vigente está no Master Plan)
3. docs/GODOUTOR-UI-CONTRACT.md
4. docs/GODOUTOR-UI-AUDIT-V2.md quando a missão envolver UI/homologação
5. docs/GODOUTOR-HISTORY.md e docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md para contexto histórico

## Regras de continuidade

- GODOUTOR-MASTER-PLAN.md é a direção atual de produto e roadmap — seção **Estado atual / Fila de execução** é a autoridade.
- NUNCA confiar em "próxima missão" de documentação histórica. Validar no Master Plan e no Git (`git log --oneline -5`, `gh pr view 46`) antes de agir.
- Não recomece o produto nem proponha novo repositório sem requisito técnico comprovado.
- Não trate o antigo InstaLink/link-na-bio/page-builder como direção principal.
- Página Pública é legado preservado por compatibilidade (`GODOUTOR_LEGACY_PAGES`); não deve contaminar o Clinical OS.
- Preserve o Design System e os arquétipos de página definidos no contrato de UI.
- Audite antes de criar: reutilize domínios, serviços e fluxos existentes.
- Não faça migração big-bang de instalink_doc.
- Novos domínios clínicos importantes devem nascer normalizados e multi-tenant.
- Permissão precisa ser aplicada no servidor, não apenas na interface.
- IA nunca acessa SQL cru, nunca ganha permissão pelo prompt e nunca assina decisão clínica autonomamente.
- Não faça merge de PR sem autorização explícita do responsável pelo projeto.
- Não declare homologação visual se não houve renderização/validação real.
- Quando a missão permitir execução local, não limitar validação a typecheck + testes + leitura estática. Antes de concluir uma feature relevante, executar auto-homologação funcional local sempre que tecnicamente possível: subir aplicação local, criar/reutilizar tenant descartável, criar contas/personas de teste, fazer login real, navegar pelos fluxos alterados, testar happy path + erros previsíveis, observar console/network quando necessário, usar browser/render real quando disponível, nunca declarar homologação visual sem renderização real, nunca usar produção ou dados reais para testes destrutivos. Para missões envolvendo permissões: testar com múltiplos papéis reais. Para missões envolvendo UX: validar desktop/tablet prioritários. Não substituir testes automatizados; complementar.
- Ao concluir uma fase relevante, atualize GODOUTOR-MASTER-PLAN.md para manter CONCLUÍDO / EM ANDAMENTO / PRÓXIMO / DEFERIDO coerentes e mova detalhes para GODOUTOR-HISTORY.md.

## Estado atual (2026-10-01)

**Workflow + Permissões — `CONCLUÍDO EM CÓDIGO / HOMOLOGADO / MERGED / PRODUÇÃO`** (PR #46 mergeado; `main`/`origin/main` auditados em `6064bb29333ee0cd4de69cc6e554eb4a3289f793`). Etapa canônica derivada (`scheduled|arrived|in_care|finalized|cancelled|no_show`, sem campo persistido), escopo de dados do Profissional por relação real (`src/lib/data-scope.ts`), capacidades `clientes_exportar`/`clientes_importar`. Testes registrados na homologação: 2801 PASS / 4 baseline conhecidas. Matriz, rotas e histórico da homologação: `docs/AUTO-HOMOLOGACAO-WORKFLOW-PERMISSOES.md`.

**PR #46 — `MERGED / PRODUÇÃO / CONCLUÍDA`** (merge confirmado via GitHub; o `main` auditado agora aponta para `6064bb2`). Homologação: `docs/AUTO-HOMOLOGACAO-PR46-MODELO-OPERACIONAL.md`.

**Agenda Temporal 2.0 — `EM ANDAMENTO · FUNDAÇÃO TEMPORAL B1 CONCLUÍDA EM CÓDIGO / HOMOLOGADA / AGUARDANDO MERGE`**. A Etapa A entregou auditoria, contrato temporal, comparação executável e testes focados em `spikes/agenda-temporal-2/` e `docs/ADR-AGENDA-TEMPORAL-2.md`; a grade/API de produção não foram substituídas. A **Etapa B1** implementou a fundação temporal no domínio: `Booking.startAt/endAt/durationMin/timeZone/temporalSource` (aditivos), escrita atômica única com `date/time` mantidos como projeção compatível, duração resolvida no servidor e congelada na criação, ocupação/slots por janela do próprio Booking, congelamento da inferência legada na escrita (sem backfill destrutivo) e reagendamento como janela nova. Homologação real: `docs/AUTO-HOMOLOGACAO-AGENDA-TEMPORAL-B1.md`. **A Agenda 2.0 continua EM ANDAMENTO — a próxima etapa é B2** (recursos, buffers before/after, separação definitiva de snap/slotMin). Não iniciar Clinical Encounter F1.

- **P0.1 (Slots & Elegibilidade):** todos os chamadores de `slotEligibleProfessionalIds` passam a equipe completa do tenant; o helper decide elegibilidade (`undefined` legado solo / `[]` / `[ids]`).
- **P0.2 (Privilege Escalation):** `person.save` valida server-side e atomicamente as permissões efetivas do alvo contra as do ator (403 sem mutação parcial).
- **P0.3 (`deriveIsTargetOwner`):** só vínculos reais por ID e tenant; sem heurística por e-mail.
- **Equipe UX Closure:** papéis como presets (Administrador · **Recepção**=`SECRETARIA` · Profissional; legados `ATENDENTE`/`VENDEDOR`/`VIEWER` em “Outros papéis / avançado”); Proprietário não editável/rebaixável; overrides mínimos (`src/lib/equipe-access.ts`), troca de papel limpa; Personalizar acesso recolhido e sem Página/Pedidos com `GODOUTOR_LEGACY_PAGES` OFF.
- **Regras que não devem regredir:** (1) seguir a clínica NUNCA apaga regras de horário próprias; (2) horário próprio sem regra não finge estar configurado; (3) erros do drawer de pessoa são humanos (sem Member/User/Professional/IDs) e recebem foco/scroll; (4) `Service.durationMin` é duração PADRÃO para novos agendamentos — a biblioteca apenas SUGERE, a clínica decide, e nunca é apresentada como regra clínica/CFMV.
- **Regras do Workflow que não devem regredir:** o servidor é a autoridade (botão escondido não substitui guard); Recepção não acessa a área clínica nem exporta/importa; Profissional só vê o que tem vínculo por Agendamento/Atendimento/Fila (nunca por nome/e-mail); não criar 4ª máquina de estados nem novo sistema de tarefas (Pendências = `tasks`).
- **Agenda Temporal 2.0 (B1 implementada):** contrato e Spike/ADR em `docs/ADR-AGENDA-TEMPORAL-2.md`; a **Fundação Temporal B1** está em código e homologada (`docs/AUTO-HOMOLOGACAO-AGENDA-TEMPORAL-B1.md`). Regras que não devem regredir: (1) `startAt+endAt` é a autoridade temporal do Booking; (2) `Service.durationMin` é default de NOVO agendamento e nunca move Booking existente; (3) duração vinda do navegador não é autoridade; (4) o fuso é o IANA da clínica (`businessTimezone`), nunca o do navegador; (5) leitura de legado não grava — a inferência só é congelada na escrita; (6) `date/time` continuam existindo como projeção compatível na mesma escrita atômica. A Agenda 2.0 continua **EM ANDAMENTO**; a próxima etapa é **B2** (recursos, buffers before/after, snap × `slotMin`).

## Próximas missões de código

**Fila oficial — autoridade no Master Plan §2:**

1. **Agenda Temporal 2.0** — Etapa A `SPIKE/ADR CONCLUÍDO` · Etapa **B1 "Fundação Temporal" CONCLUÍDA EM CÓDIGO/HOMOLOGADA** (aguardando merge); **próxima etapa: B2** (recursos, buffers before/after, separação snap × `slotMin`)
2. Clinical Encounter F1
3. Cobertura / Modalidade do Atendimento
4. Prescrição + Exames + Document Engine
5. Estoque/Farmácia
6. Cirurgia + Internação
7. Conta do Atendimento + Financeiro avançado
8. Fiscal / integrações
9. Agentes + Jev + LLM + OAAS sobre os domínios estabilizados

Workflow + Permissões já foi mergeado e está em produção. Agenda Temporal 2.0 segue em andamento: a **B1 (Fundação Temporal)** está concluída em código e homologada, aguardando merge; a continuidade é a **B2** (recursos/salas/equipamento, buffers before/after, separação snap × `slotMin`), sem trocar a grade e sem biblioteca de calendário. Clinical Encounter F1 permanece depois da Agenda; não antecipar.

**Registrado, sem implementar (não bloqueia a fila):** Cadastro/Onboarding — contrato de identidade (Master Plan §2.6): conta/login = PESSOA; primeiro usuário nasce Proprietário; clínica é entidade separada da conta; onboarding futuro aceita clínica/titular PF (CPF) ou PJ (CNPJ); e-mail de login ≠ e-mail institucional da clínica (podem ser iguais); não misturar Owner com Business/Clínica; Organização/Clínica/Unidade/Equipe são entidades/vínculos distintos.

## Referências externas / repositórios

Quando uma feature importante puder se beneficiar de implementação madura existente, pesquisar/analisar referências concretas antes de reinventar.

O agente pode receber:
- URL de produto
- documentação
- repositório GitHub
- implementação open source
- screenshot/mockup

Classificar a referência como:

**VISUAL** — estudar layout/interação, sem copiar domínio. Inspiração de UX, não de regra clínica.

**ARQUITETURAL** — estudar estado, componentes, fluxos e separação de responsabilidades. Adaptar padrão à arquitetura GoDoutor, não transplantar.

**IMPLEMENTAÇÃO** — reutilização/adaptação técnica permitida quando licença e compatibilidade permitirem. Validar licença (MIT/Apache etc), manutenção, bundle size, segurança, compatibilidade com Design System e multi-tenant.

Nunca copiar cegamente.

Antes de reutilizar, validar compatibilidade com:
- domínio clínico GoDoutor (veterinária, Tutor/Pet, Profissional/Equipe)
- multi-tenant (`businessId` obrigatório, tenant isolation)
- permissões (RBAC + capabilities, guard no servidor)
- segurança (sem segredo no frontend, payload redigido, audit/EventLog)
- Design System (workspace/record/detail/form/hub, hierarquia PRIMARY/SECONDARY/GHOST/DESTRUCTIVE, temas, viewports)
- arquitetura atual (instalink_doc legado vs tabelas normalizadas, `godoutor_internal`, migrations como única autoridade DDL, fluxo Auditar→Entender→Decidir→Modelar→Implementar)
