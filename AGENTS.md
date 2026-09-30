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

## Estado atual (2026-09-30)

**PR #46 — `P0 ESTRUTURAL CONCLUÍDO / EQUIPE UX CLOSURE + HOMOLOGAÇÃO EM ANDAMENTO / NÃO MERGEAR`** (branch de trabalho `arena/01a0f3d3-instalink`). Não mergear sem autorização explícita e sem homologação visual real (não feita: sem browser no ambiente).

- **P0.1 (Slots & Elegibilidade):** todos os chamadores de `slotEligibleProfessionalIds` passam a equipe completa do tenant; o helper decide elegibilidade (`undefined` legado solo / `[]` / `[ids]`).
- **P0.2 (Privilege Escalation):** `person.save` valida server-side e atomicamente as permissões efetivas do alvo contra as do ator (403 sem mutação parcial).
- **P0.3 (`deriveIsTargetOwner`):** só vínculos reais por ID e tenant; sem heurística por e-mail.
- **Equipe UX Closure:** papéis como presets (Administrador · **Recepção**=`SECRETARIA` · Profissional; legados `ATENDENTE`/`VENDEDOR`/`VIEWER` em “Outros papéis / avançado”); Proprietário não editável/rebaixável; overrides mínimos (`src/lib/equipe-access.ts`), troca de papel limpa; Personalizar acesso recolhido e sem Página/Pedidos com `GODOUTOR_LEGACY_PAGES` OFF.
- **Regras que não devem regredir:** (1) seguir a clínica NUNCA apaga regras de horário próprias; (2) horário próprio sem regra não finge estar configurado; (3) erros do drawer de pessoa são humanos (sem Member/User/Professional/IDs) e recebem foco/scroll; (4) `Service.durationMin` é duração PADRÃO para novos agendamentos — a biblioteca apenas SUGERE, a clínica decide, e nunca é apresentada como regra clínica/CFMV.
- **Pendente (não implementar sem missão):** escopo de DADOS do Profissional em Clientes/Visão geral/Atendimento (Workflow + Permissões) e contrato de Agenda 2.0 (Master Plan §2.1–§2.5).

## Próximas missões de código após #46

**Fila oficial — autoridade no Master Plan §2:**

1. **Workflow + Permissões** — próxima missão de código após merge de #46 (inclui escopo de dados do Profissional)
2. Agenda Temporal 2.0 (começa por spike/ADR: grade própria × react-big-calendar × FullCalendar)
3. Clinical Encounter F1
4. Cobertura / Modalidade do Atendimento
5. Prescrição + Exames + Document Engine
6. Estoque/Farmácia
7. Cirurgia + Internação
8. Conta do Atendimento + Financeiro avançado
9. Fiscal / integrações
10. Agentes + Jev + LLM + OAAS sobre os domínios estabilizados

Não iniciar nova fase sem homologação/merge de #46 e sem atualizar Estado atual no Master Plan.

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
