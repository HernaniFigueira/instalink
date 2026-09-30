# GoDoutor — Master Plan, Roadmap e Handoff

> Snapshot: 2026-09-30
> Repositório: HernaniFigueira/instalink
> Produto: GoDoutor / Clinical OS
> Vertical inicial: clínica veterinária
> Status: documento vivo e fonte de direção do produto

## 0. Regra de leitura

Este documento é o mapa mestre de produto, arquitetura e execução do GoDoutor. É a **autoridade de estado atual e fila de execução** — sempre valide contra o Git antes de agir.

Antes de iniciar qualquer missão relevante, leia também:

- docs/GODOUTOR-CLINICAL-OS-V1.md — especificação de arquitetura clínica (roadmap operacional vigente está neste Master Plan)
- docs/GODOUTOR-UI-CONTRACT.md
- docs/GODOUTOR-UI-AUDIT-V2.md quando a missão envolver UI/homologação

Quando uma decisão histórica do antigo InstaLink conflitar com este documento, a direção atual do GoDoutor prevalece, salvo se uma decisão técnica posterior documentada no repositório a substituir explicitamente.

Não recomeçar o produto do zero. Não criar novo repositório por impulso. Não ressuscitar o InstaLink como proposta principal.

**Regra de autoridade:** nunca confiar em "próxima missão" de documentação histórica ou de `AGENTS.md` desatualizado. A autoridade é a seção **Estado atual / Fila de execução** deste Master Plan, validada contra Git.

---

## 1. Estado atual

**Implementação atual:**
Clinical Architecture Closure & PR #46 P0 Blockers Fixes
Branch: `arena/01a0eda6-instalink` · PR #46 — validar estado real no Git (`git log --oneline -5`, `gh pr view 46`)

**Status:**
CONCLUÍDA EM CÓDIGO / AGUARDANDO MERGE

**O que já está em código (B3 + Modelo Operacional + P0.1/P0.2/P0.3 Fixes — PR #46):**
- **P0.1 (Slots & Elegibilidade):** Todos os chamadores de `slotEligibleProfessionalIds` passam a equipe completa do tenant (`db.professionals.filter(p => p.businessId === businessId)`), sem pre-filtrar `active !== false`. A função helper encapsula a autoridade de elegibilidade e distingue corretamente `undefined` (legado solo real), `[]` (zero elegíveis), `[ids]` (elegíveis ativos).
- **P0.2 (Proteção contra Privilege Escalation em `person.save`):** Validação server-side e atômica do conjunto de permissões efetivas do alvo (`permissionsFor(role, overrides)`) contra as permissões do ator. Atores não-OWNER são impedidos de atribuir capabilities ausentes do seu perfil ou de promover a papéis superiores (retorna 403 com zero escrita parcial no banco).
- **P0.3 (Segurança Tenant-Safe em `deriveIsTargetOwner`):** Validação estrita por IDs e vínculos reais (`existingUserId === ownerId`, `member.userId === ownerId && member.businessId === input.businessId`, `professional.userId === ownerId && professional.businessId === input.businessId`). Heurística insegura por e-mail do cliente foi removida e vínculos cross-tenant são bloqueados.
- **Equipe:** painel único **ADICIONAR PESSOA** com toggles **Tem acesso / Realiza atendimentos** (combinações livres); quando ACESSO expande **E-MAIL/PAPEL/PERMISSÕES + senha**; quando ATENDIMENTO expande **FUNÇÃO/ESPECIALIDADE + REGISTRO CRMV + UF + NÚMERO**, **SERVIÇOS QUE REALIZA** com criação inline de serviço, **DISPONIBILIDADE** radio **Seguir clínica / Usar próprio** + CTA deep-link.
- **Serviços & Estrutura:** Categoria→Grupo, Ativo vs Pode ser agendado, `ServiceForm` com catálogo vet.
- **Validação:** `npm run typecheck` 0 erros, `npm run build` OK, `npx vitest run` 198/198 arquivos passando (2719 testes), `git diff --check` 0 erros.
- Produtos: fora da navegação Clinical OS quando `GODOUTOR_LEGACY_PAGES` OFF (guard em `WorkspaceNavigation.visible`, rota/API/dados preservados)
- Disponibilidade preservada como domínio separado QUEM × QUANDO (copy clínica)
- Configurações com DTO seguro `GET /api/businesses/[id]` (`BUSINESS_CONFIG_DTO_FIELDS`, nunca segredos)
- Validação: `tsc --noEmit` 0 erros, `next build` OK, `vitest` 2627 passed / 4 failed (baseline 5 → pipeline data fix), `git diff --check` 0

**Detalhes históricos completos:** ver `docs/GODOUTOR-HISTORY.md` e `docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md`.

---

## 2. Fila de execução

**Fila oficial — única fonte vigente.** Não duplicar esta sequência em outras partes do documento. Quando uma fase terminar: remover da fila ativa, atualizar Estado atual, registrar conclusão resumida no histórico/audit, próxima fase sobe para posição 1.

1. **Workflow + Permissões** — papéis, capabilities, máquina de estados do agendamento (scheduled→arrived→in_care→finalized), check-in/falta/cancelamento/reagendamento, finalização e Pendências (EventLog → Pendência → Agenda Operational Strip)
2. **Agenda Temporal 2.0** — start/end, duração, drag-selection, bloqueios, procedimento longo, snap 5min, buffers, recursos (sala/equipamento), política interna vs pública
3. **Clinical Encounter F1** — prontuário estruturado sobre Atendimento (queixa, anamnese, sinais, problemas/hipóteses/diagnósticos, achados, evolução, plano, procedimentos, retorno, assinatura, versionamento; autosave, rascunho, finalização bloqueia edição, reabertura auditada)
4. **Cobertura / Modalidade do Atendimento** — Particular vs Convênio/Plano (futuro): cadastro de operadora/convênio e plano, vínculo Tutor/Pet, identificação do beneficiário, cobertura por serviço, elegibilidade/autorização, coparticipação, registro da modalidade no atendimento, pagador (tutor/convênio/ambos), preparação para repasse/faturamento/glosa — veterinária primeiro, sem SUS/TISS/medicina humana antecipada — posicionado após F1 e antes de fechar Conta/Financeiro
5. **Prescrição + Exames + Document Engine** — medicamento/apresentação/dose/via/frequência, ordens/solicitações, template/versão/instância de documentos
6. **Estoque / Farmácia** — item/lote/validade/fornecedor/custo/movimento, integração prescrição→administração→baixa→conta
7. **Cirurgia + Internação** — indicação→orçamento→consentimento→checklist→cirurgia→recuperação→alta, leito/evolução/handoff
8. **Conta do Atendimento + Financeiro avançado** — serviços/procedimentos/medicamentos/materiais → conta → pagamento/parcelas → contas a receber
9. **Fiscal / integrações** — NFS-e, exportações, fechamento mensal, conciliação
10. **Agentes + Jev + LLM + OAAS sobre os domínios estabilizados** — consolidação EventLog em OAAS, agentes clínicos/operacionais consumindo domínios estáveis (não antes)

**Após #46, a próxima missão de código é Workflow + Permissões. Depois: Agenda Temporal 2.0 → Clinical Encounter F1.**

**Notas de referência (não implementar nesta PR):**
- **Agenda Temporal 2.0 — referências para decisão futura:** Google Calendar como referência **VISUAL/INTERACIONAL** (interação de grade, drag-selection, bloqueios). Para análise arquitetural comparar agenda própria vs bibliotecas: `fullcalendar/fullcalendar`, `schedule-x/schedule-x`, `bigcalendar/react-big-calendar` (GitHub). Decisão futura: evoluir implementação própria vs adotar biblioteca vs reutilizar padrões/algoritmos — sem instalar agora.
- **Clinical Encounter F1 — biblioteca de anamnese:** evolução do motor atual de fichas (`AnamneseManager`) para biblioteca de modelos por especialidade, após pesquisa veterinária séria e revisão humana. Nesta PR o motor permanece como está; apenas copy/hub ajustados.

---

## 3. O que é o GoDoutor

GoDoutor = sistema operacional da clínica.

Fluxo-alvo:

    Entrada
    → Tutor/Cliente
    → Pet/Paciente
    → Agenda
    → Check-in/Fila
    → Atendimento
    → Prontuário
    → Prescrição/Exames/Procedimentos
    → Documentos
    → Estoque/Farmácia
    → Conta do atendimento
    → Pagamento
    → Financeiro
    → Retorno/Follow-up
    → Inteligência/Automação

O produto antigo de Página Pública é legado preservado, não o centro do Clinical OS.

### Vertical inicial

Primeira vertical: clínica veterinária.

Vocabulário:

- Tutor = cliente/responsável humano
- Pet = paciente
- Profissional = pessoa que realiza atendimentos
- Equipe = pessoas da clínica
- Acesso = capacidade de entrar no sistema com papel/permissões

> `BusinessMember` e `Professional` continuam entidades internas distintas — Equipe é a experiência unificada de pessoas, não um sinônimo de acesso.

Não construir medicina humana, odontologia e veterinária em paralelo. A arquitetura pode ser extensível, mas a UX e as regras devem ser coerentes com veterinária primeiro.

### O que o GoDoutor não deve voltar a ser

Não voltar a parecer:

- Linktree/link na bio
- site builder
- catálogo de vitrine como núcleo
- página pública com CRM acoplado
- plataforma de presença online como proposta central

A linguagem do produto deve ser clínica e operacional: tutor, paciente, serviço, profissional, disponibilidade, agenda, atendimento, prontuário, retorno, documento, cobrança, estoque, cirurgia e internação.

### Legado InstaLink

A Página Pública permanece preservada por compatibilidade por meio da flag `GODOUTOR_LEGACY_PAGES`.

Com a flag desligada:

- Página não integra a navegação operacional padrão
- AccountMenu não deve exibir atalhos de página pública
- Dashboard/Resultados não devem se comportar como analytics de site
- Configurações e módulos estruturais não devem falar como site builder
- APIs e dados legados podem permanecer intactos

Compatibilidade técnica não deve virar linguagem de produto.

---

## 4. Decisões arquiteturais congeladas

Estas decisões não se discutem novamente sem PR própria e justificativa técnica comprovada:

- **Design System 2.0 congelado (#43):** não criar por módulo nova paleta, radius, botão paralelo, shadow, container arbitrário, modal próprio, layout incompatível. Arquétipos oficiais: `workspace` (Agenda, Conversas, Clientes), `record` (Atendimento), `detail` (Cliente 360/Pet 360), `form` (Perfil, Configurações, Agente), `hub` (Estrutura, Profissionais, Disponibilidade, Serviços, Produtos, Equipe).
- **Hierarquia de ações:** PRIMARY (1 por contexto), SECONDARY, GHOST, DESTRUCTIVE (só destrutiva).
- **Temas:** default azul-profundo; temas alteram identidade/accent/sidebar/CTA, nunca sucesso/warning/perigo/radius/spacing/shadows/anatomia.
- **Viewports prioritários:** 1440 → 1366 → 1024 → 390 sanity check. Desktop/tablet têm prioridade (sistema de operação clínica).
- **Banco:** `instalink_doc` JSONB é legado sem big-bang; novos domínios importantes nascem normalizados e multi-tenant com `business_id` obrigatório. Migration é única autoridade DDL, runtime nunca cria tabela. Ordem de corte: EventLog/AI usage (F0 já normalizado) → Clinical Encounter → Prescription/Orders → Finance → Inventory.
- **Segurança:** RBAC + tenant isolation na raiz de toda leitura/escrita/evento; audit trail + EventLog; nenhuma API key no frontend; payload redigido; confirmação humana para ações sensíveis; permissões aplicadas no servidor.
- **Exposição banco:** `godoutor_internal` fora da Data API, tabelas novas nascem REVOKE de `PUBLIC/anon/authenticated/service_role`, RLS/grants por tabela; `instalink_doc` referência sem qualificação depende de `search_path` do papel (Supabase: `godoutor_app, public`).
- **Fluxo operacional principal:** Tutor → Pet → Agendamento → Confirmação → Chegada → Fila → Atendimento → Finalização clínica → Orientações → Retorno → Pendência quando necessário → Pagamento → Follow-up.
- **Papéis e operação:** Recepção (cadastra tutor/pet, agenda, fila, retorno, sem concluir atendimento/editar evolução), Profissional (agenda, atendimento, anamnese, evolução, retorno; reagendar/bloquear/cancelar configurável por clínica), Owner/Admin (estrutura, equipe, permissões, agenda, financeiro).
- **Pendências:** ação humana acionável agora/janela curta; tarefas futuras com `dueAt` futuro não emergem na strip até janela acionável; concluídas vão para histórico filtrado.
- **Atendimento:** referência arquétipo `record` — full-page, header compacto sticky, action bar, autosave, rascunho, finalização, histórico, read-only após finalização, reabertura auditada. Não reimplementar do zero.
- **Estratégia Enterprise:** sem fork — feature flags, configuração, papéis, módulos, limites, integrações.

---

## 5. Histórico resumido

Fases concluídas viraram resumo curto. Detalhes de implementação movidos para histórico.

- **Design System 2.0 — CONCLUÍDO (#43)** — mergeado 2026-09-29 (`85154c8`). Detalhes: arquétipos, Atendimento full-page, Cliente 360, temas, navegação.
- **Clinical Convergence / Architecture Closure — CONCLUÍDO (#46)** — `arena/01a0eda6-instalink` · CONCLUÍDA EM CÓDIGO / AGUARDANDO HOMOLOGAÇÃO E MERGE. Unificação Equipe×Profissionais, Serviços clínico sem vitrine, Configurações cadastro centralizado, DTO seguro, porta única Equipe, Disponibilidade clínica, Estrutura hub, Agenda classificada. Validação: tsc 0, build OK, vitest 2623/5.

**Detalhes:** ver `docs/GODOUTOR-HISTORY.md` (B2/B3 completos com Alterado/Testes) e `docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md` (matriz 57 itens + decisões B1–B6, B3-01–B3-10).

---

## 6. Regras de operação

### O que não fazer

Não:

- criar repositório novo agora
- reescrever tudo
- apagar `instalink_doc` em big-bang
- chamar Produtos de Estoque sem domínio real
- transformar tudo em full-width ou sheet
- misturar role de acesso com cargo profissional
- usar cor como único status
- permitir IA assinar prontuário
- testar número principal do cliente sem homologação
- criar fork por cliente Enterprise
- criar ferramentas paralelas ao ToolRegistry

### Critério obrigatório antes de novas features

Perguntar:

- qual é o caso simples? / real? / extremo? / multiusuário? / erro? / permissão? / tenant? / auditoria? / automação? / consequência futura?

Exemplo Agenda: consulta 30min, retorno 15min, cirurgia 7h, bloqueio, encaixe, médico ocupado, sala ocupada, recepção interna, booking público.

### Processo de implementação

Preferir:

    auditar → entender → decidir → modelar → implementar → testar → homologar

Evitar:

    inventar → codificar → descobrir depois que o domínio estava errado

### Enterprise / Design partners / Métricas

- Enterprise sem fork — flags, papéis, módulos.
- Validar com 2–3 clínicas piloto (Andrioni referência para agenda/cirurgia/recepção/WhatsApp).
- Métricas futuras: ocupação, faltas, reagendamentos, tempo espera/atendimento, retornos, conversas IA, handoffs, receita, ticket, inadimplência, estoque crítico, custo IA por clínica.

---

## 7. Regra para novos chats/agentes

Ao iniciar nova sessão:

1. leia `AGENTS.md`
2. leia este arquivo (Master Plan — Estado atual / Fila)
3. leia os documentos técnicos apontados no topo
4. valide o estado atual do Git antes de agir (`git log --oneline -5`, `git status`, PR #46)
5. não trate decisões históricas do InstaLink como direção atual
6. não faça merge sem autorização explícita
7. não altere domínio apenas para melhorar uma tela
8. preserve Design System e contratos já homologados
9. roadmap operacional vigente está neste Master Plan — `GODOUTOR-CLINICAL-OS-V1.md` é especificação de arquitetura, não autoridade de fila

---

## 8. Definição final

GoDoutor é o sistema operacional da clínica.

Ele organiza pessoas, pacientes, agenda, atendimento, prontuário, comunicação, execução, estoque, dinheiro e automação em uma única operação.

IA reduz trabalho repetitivo, classifica, organiza, comunica e auxilia decisões; não substitui responsabilidade clínica humana.

Dados clínicos e decisões finais permanecem sob controle humano, permissionado e auditável.
