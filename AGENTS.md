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
- Ao concluir uma fase relevante, atualize GODOUTOR-MASTER-PLAN.md para manter CONCLUÍDO / EM ANDAMENTO / PRÓXIMO / DEFERIDO coerentes e mova detalhes para GODOUTOR-HISTORY.md.

## Estado atual (2026-10-02)

**Workflow + Permissões — `CONCLUÍDO EM CÓDIGO / HOMOLOGADO / MERGED / PRODUÇÃO`** (PR #46 mergeado; `main`/`origin/main` auditados em `6064bb29333ee0cd4de69cc6e554eb4a3289f793`). Etapa canônica derivada (`scheduled|arrived|in_care|finalized|cancelled|no_show`, sem campo persistido), escopo de dados do Profissional por relação real (`src/lib/data-scope.ts`), capacidades `clientes_exportar`/`clientes_importar`. Testes registrados na homologação: 2801 PASS / 4 baseline conhecidas. Matriz, rotas e histórico da homologação: `docs/AUTO-HOMOLOGACAO-WORKFLOW-PERMISSOES.md`.

**PR #46 — `MERGED / PRODUÇÃO / CONCLUÍDA`** (merge confirmado via GitHub; o `main` auditado agora aponta para `6064bb2`). Homologação: `docs/AUTO-HOMOLOGACAO-PR46-MODELO-OPERACIONAL.md`.

**Agenda Temporal 2.0 — `MERGED EM MAIN` via PR #49 (2026-10-02 22:01 UTC).** Etapas A/ADR, B1, B2, B2.1 e B3 estão no mesmo grid Day/Week/List. B3 entregou `ScheduleBlock` próprio, buffers before/after com snapshots e freeze legado, salas/equipamentos multi-tenant e alocação determinística. QA anterior foi local em tenant descartável, Owner/Maria/Orlando, Chromium 1366/1024/390; **não usar isso como QA de produção**. Evidências: `docs/AUTO-HOMOLOGACAO-AGENDA-TEMPORAL-B3.md` e `docs/AGENDA-TEMPORAL-2-FINAL.md`.

**P0 Infra — Single-read authenticated guard — `MERGED` via PR #50 (merge `dbf7d68`, 2026-10-02 UTC).** Typecheck/build e testes automatizados passaram, com as quatro falhas baseline esperadas na suíte completa; smoke HTTP local em banco descartável e logins reais Owner/Maria/Orlando passou. Chromium/UI desta entrega ficou pendente porque o sandbox não conseguiu instalar o browser. Produção não usada. Relatório: `docs/AUTO-HOMOLOGACAO-P0-SINGLE-READ-GUARD.md`.

**Clinical Convergence onda 2 (cleanup de resíduo InstaLink) — `IMPLEMENTADO / AUTO-HOMOLOGADO LOCALMENTE / PR EM REVISÃO; MERGE NÃO EXECUTADO`** (branch de sessão `arena/01a0fede-instalink` sobre `dbf7d68`). Produto ativo 100% clínico: onboarding/API/navegação/temas/seed/copy falam só de clínica; varejo permanece apenas como compatibilidade atrás de `GODOUTOR_LEGACY_PAGES`. IDs técnicos legados mantidos com justificativa e plano (tabela `instalink_doc` → P1; `il_session` com dual-read concluído; headers `X-Instalink-*` e ids do embed congelados por contrato externo). Gates: 2930 testes PASS / 4 baseline intocadas; harness HTTP completo (smoke 67/0, smoke-ux 84/0, agendar 25/0, p3 15 fluxos, p4 18/18, e2e-legacy 28/0); sem Chromium no sandbox — homologação visual NÃO executada (declarado). Matriz: `docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md` (onda 2); relatório: `docs/AUTO-HOMOLOGACAO-CLINICAL-CONVERGENCE.md`. Clinical Encounter F1 não iniciado e continua bloqueado até revisão/merge desta PR e autorização explícita.

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

1. **Clinical Convergence onda 2 + CORREÇÃO FINAL — revisar PR #51** (`arena/01a0fede-instalink` → `main@dbf7d68`); merge só com autorização explícita. A correção final fecha o produto ativo 100% clínico (onboarding OFF sem pergunta comercial nem `modes`; Products/Orders fora do catálogo/telas no OFF; branding package/.env; renome com migração dos identificadores `il-*` ativos). Pendências drenáveis remanescentes: fallback `il_session`/`il_cust_session`/`il_support` (cookies = protocolo), alias `INSTALINK_DB_FILE`, renome P1 da tabela `instalink_doc`, namespace CSS `il-*` (batch cosmético opcional). (P0: PR #50 MERGEADA em `dbf7d68`.)
2. Clinical Encounter F1 — deferido até revisão/merge da PR de convergência e autorização explícita.
3. Cobertura / Modalidade do Atendimento
4. Prescrição + Exames + Document Engine
5. Estoque/Farmácia
6. Cirurgia + Internação
7. Conta do Atendimento + Financeiro avançado
8. Fiscal / integrações
9. Agentes + Jev + LLM + OAAS sobre os domínios estabilizados

Workflow + Permissões já está em produção. Agenda Temporal 2.0 foi mergeada via PR #49 e o P0 single-read guard via PR #50 (merge `dbf7d68`) em 2026-10-02; QA registrado é local, sem produção. A PR da Clinical Convergence onda 2 aguarda revisão; Clinical Encounter F1 permanece bloqueado até a revisão/merge dela e autorização explícita; não antecipar.

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
