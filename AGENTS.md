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
- **Regra de arquitetura DB/auth:** nunca use cache DB global/de módulo/singleton/TTL. Resolva identidade, suporte, tenant, membership, escopo profissional e permissões com um snapshot `DB` request-local; passe-o aos helpers puros `*FromDB` e reutilize `guard.db`. Sem credenciais, evite `readDB`. Não substitua `updateDB()` nem remova leituras de domínio/pós-mutação justificadas; classifique-as e reporte `readDB` separadamente de `updateDB`.
- Novos domínios clínicos importantes devem nascer normalizados e multi-tenant.
- Permissão precisa ser aplicada no servidor, não apenas na interface.
- IA nunca acessa SQL cru, nunca ganha permissão pelo prompt e nunca assina decisão clínica autonomamente.
- Não faça merge de PR sem autorização explícita do responsável pelo projeto.
- Não declare homologação visual se não houve renderização/validação real.
- Quando a missão permitir execução local, não limitar validação a typecheck + testes + leitura estática. Antes de concluir uma feature relevante, executar auto-homologação funcional local sempre que tecnicamente possível: subir aplicação local, criar/reutilizar tenant descartável, criar contas/personas de teste, fazer login real, navegar pelos fluxos alterados, testar happy path + erros previsíveis, observar console/network quando necessário, usar browser/render real quando disponível, nunca declarar homologação visual sem renderização real, nunca usar produção ou dados reais para testes destrutivos. Para missões envolvendo permissões: testar com múltiplos papéis reais. Para missões envolvendo UX: validar desktop/tablet prioritários. Não substituir testes automatizados; complementar.
- **REGRA OPERACIONAL DE BRANCH/PR:**
  - Uma fase ativa deve usar uma única branch e uma única PR.
  - Correções, revisão, QA, homologação e patches da mesma fase continuam na mesma branch/PR até aprovação e merge.
  - Não abrir nova PR apenas porque foi encontrado bug durante revisão da mesma fase.
  - Nova branch/PR somente após merge da fase anterior ou quando o trabalho for comprovadamente independente.
  - Após merge da PR de uma sessão Arena, trabalho novo começa em nova sessão a partir da main atualizada.
  - Nunca fazer merge sem autorização explícita do responsável pelo projeto.
- Ao concluir uma fase relevante, atualize GODOUTOR-MASTER-PLAN.md para manter CONCLUÍDO / EM ANDAMENTO / PRÓXIMO / DEFERIDO coerentes e mova detalhes para GODOUTOR-HISTORY.md.

## Estado atual (2026-10-05)

**Clinical Encounter F1 — `CONCLUÍDO / MERGED / HOMOLOGADO` (2026-10-05).** F1A (PR #54, merge `e2e2b63`), F1B1 (PR #55, merge `1c5c6890160f64ae3c1789ce3a3ba6122765c987`), F1B2 (PR #56, merge `a6b1b84197b83fba2127761c91065d33777474a1`) e F1C (PR #58, merge `8e29d52e187e50755e13e4ea02e3475c91f91b84`, HEAD de `main`) estão em produção. Browser QA real da F1C aprovado — fluxo comprovado **Revisão 1 → Nota complementar → Reabertura → Revisão 2**, com persistência após reload/F5 e abertura pelo mesmo Encounter. **Próxima fase oficial: Cobertura / Modalidade do Atendimento.** Detalhes: `docs/GODOUTOR-MASTER-PLAN.md` §1–§2, `docs/CLINICAL-ENCOUNTER-F1C.md` e `docs/GODOUTOR-HISTORY.md`.

**Workflow + Permissões — `CONCLUÍDO EM CÓDIGO / HOMOLOGADO / MERGED / PRODUÇÃO`** (PR #46 mergeado; `main`/`origin/main` auditados em `6064bb29333ee0cd4de69cc6e554eb4a3289f793`). Etapa canônica derivada (`scheduled|arrived|in_care|finalized|cancelled|no_show`, sem campo persistido), escopo de dados do Profissional por relação real (`src/lib/data-scope.ts`), capacidades `clientes_exportar`/`clientes_importar`. Testes registrados na homologação: 2801 PASS / 4 baseline conhecidas. Matriz, rotas e histórico da homologação: `docs/AUTO-HOMOLOGACAO-WORKFLOW-PERMISSOES.md`.

**PR #46 — `MERGED / PRODUÇÃO / CONCLUÍDA`** (merge confirmado via GitHub; o `main` auditado agora aponta para `6064bb2`). Homologação: `docs/AUTO-HOMOLOGACAO-PR46-MODELO-OPERACIONAL.md`.

**Agenda Temporal 2.0 — `MERGED EM MAIN` via PR #49 (2026-10-02 22:01 UTC).** Etapas A/ADR, B1, B2, B2.1 e B3 estão no mesmo grid Day/Week/List. B3 entregou `ScheduleBlock` próprio, buffers before/after com snapshots e freeze legado, salas/equipamentos multi-tenant e alocação determinística. QA anterior foi local em tenant descartável, Owner/Maria/Orlando, Chromium 1366/1024/390; **não usar isso como QA de produção**. Evidências: `docs/AUTO-HOMOLOGACAO-AGENDA-TEMPORAL-B3.md` e `docs/AGENDA-TEMPORAL-2-FINAL.md`.

**P0 Infra — Single-read authenticated guard — `MERGED` via PR #50 (merge `dbf7d68`, 2026-10-02 UTC).** Typecheck/build e testes automatizados passaram, com as quatro falhas baseline esperadas na suíte completa; smoke HTTP local em banco descartável e logins reais Owner/Maria/Orlando passou. Chromium/UI desta entrega ficou pendente porque o sandbox não conseguiu instalar o browser. Produção não usada. Relatório: `docs/AUTO-HOMOLOGACAO-P0-SINGLE-READ-GUARD.md`.

**Clinical Convergence onda 2 (cleanup de resíduo InstaLink) — `MERGED / CONCLUÍDA` pela PR #51 (merge `337f39fe5a894bb40171931f5b9c5df3686e442b`, 2026-10-03).** Produto ativo 100% clínico: onboarding/API/navegação/temas/seed/copy falam só de clínica; varejo permanece apenas como compatibilidade atrás de `GODOUTOR_LEGACY_PAGES`. Pendências drenáveis remanescentes: fallback `il_session`/`il_cust_session`/`il_support` (cookies = protocolo), alias `INSTALINK_DB_FILE`, renome P1 da tabela `instalink_doc`, namespace CSS `il-*` (batch cosmético opcional). Matriz: `docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md` (onda 2); relatório: `docs/AUTO-HOMOLOGACAO-CLINICAL-CONVERGENCE.md`.

- **P0.1 (Slots & Elegibilidade):** todos os chamadores de `slotEligibleProfessionalIds` passam a equipe completa do tenant; o helper decide elegibilidade (`undefined` legado solo / `[]` / `[ids]`).
- **P0.2 (Privilege Escalation):** `person.save` valida server-side e atomicamente as permissões efetivas do alvo contra as do ator (403 sem mutação parcial).
- **P0.3 (`deriveIsTargetOwner`):** só vínculos reais por ID e tenant; sem heurística por e-mail.
- **Equipe UX Closure:** papéis como presets (Administrador · **Recepção**=`SECRETARIA` · Profissional; legados `ATENDENTE`/`VENDEDOR`/`VIEWER` em “Outros papéis / avançado”); Proprietário não editável/rebaixável; overrides mínimos (`src/lib/equipe-access.ts`), troca de papel limpa; Personalizar acesso recolhido e sem Página/Pedidos com `GODOUTOR_LEGACY_PAGES` OFF.
- **Regras que não devem regredir:** (1) seguir a clínica NUNCA apaga regras de horário próprias; (2) horário próprio sem regra não finge estar configurado; (3) erros do drawer de pessoa são humanos (sem Member/User/Professional/IDs) e recebem foco/scroll; (4) `Service.durationMin` é duração PADRÃO para novos agendamentos — a biblioteca apenas SUGERE, a clínica decide, e nunca é apresentada como regra clínica/CFMV.
- **Nomenclatura (não regredir):** NÃO introduzir novos identificadores `il-*` — chaves de localStorage, CustomEvents do SPA, flags de `window`, classes CSS. Usar o namespace GoDoutor (`godoutor_*`, `godoutor:*`, `gd-*`). Renome interno exige dual-read no cliente (canônico vence; legado vira fallback promovido na leitura e removido na escrita) e produtor + ouvinte renomeados na MESMA alteração. O namespace CSS `il-*` remanescente é exceção DOCUMENTADA (CSS_NAMESPACE_LEGACY em `docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md`) — renome futuro opcional em lote, nunca big-bang; não bloqueia missões clínicas.
- **Regras do Workflow que não devem regredir:** o servidor é a autoridade (botão escondido não substitui guard); Recepção não acessa a área clínica nem exporta/importa; Profissional só vê o que tem vínculo por Agendamento/Atendimento/Fila (nunca por nome/e-mail); não criar 4ª máquina de estados nem novo sistema de tarefas (Pendências = `tasks`).
- **Agenda Temporal 2.0:** autoridade Booking `startAt/endAt`, duração congelada, projeção `date/time`; `Service.durationMin` é default só de novos; fuso IANA da clínica. Buffer legado `bufferMin` = *after*, novos snapshots before/after só mudam em nova criação (legado congela antes de edição). `ScheduleBlock` não é Booking nem AvailabilityException; recurso é tenant-owned e não pode ser duplicado no mesmo intervalo. B1/B2/B2.1/B3 foram mergeadas via PR #49; QA registrado é exclusivamente local, não produção.

## Próximas missões de código

**Fila oficial — autoridade no Master Plan §2:**

1. **Cobertura / Modalidade do Atendimento** — Particular vs Convênio/Plano (próximo passo oficial).
2. **Prescrição + Exames + Document Engine** — SNCR/Anvisa e requisitos de assinatura eletrônica são pré-requisito antes de implementar (requisito registrado na PR #57).
3. **Estoque / Farmácia**
4. **Cirurgia + Internação**
5. **Conta do Atendimento + Financeiro avançado**
6. **Fiscal / integrações**
7. **Agentes + Jev + LLM + OAAS** sobre os domínios estabilizados

Detalhes, escopo e pré-requisitos de cada item continuam no `docs/GODOUTOR-MASTER-PLAN.md` §2 (única fonte da fila). Workflow + Permissões (PR #46), Agenda Temporal 2.0 (PR #49), P0 single-read (PR #50), Clinical Convergence onda 2 (PR #51) e Clinical Encounter F1 (PRs #54–#58) já estão mergeados/produção; o QA registrado é local, sem produção. Não antecipar fases sem autorização explícita.

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
