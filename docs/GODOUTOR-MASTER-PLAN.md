# GoDoutor — Master Plan, Roadmap e Handoff

> Snapshot: 2026-10-02
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

**Clinical Encounter F1A (2026-10-04): IMPLEMENTADO / HOMOLOGADO LOCALMENTE / PR EM REVISÃO; MERGE NÃO EXECUTADO.** Autorizado como recorte F1A na branch `arena/01a104e4-instalink`, nova a partir de `main` em `2e225c15` (SHA homologado; `main` intacta e igual ao SHA de partida). Fecha o ciclo **Booking → Iniciar atendimento → Encounter em andamento → sair → voltar → Retomar atendimento → mesmo `encounterId`**: operação canônica `startOrResumeEncounter` (`src/lib/encounter-start.ts`, atômica dentro de `updateDB`, idempotente), endpoint `POST /api/encounters/start`, rota canônica `/atendimento/[encounterId]` (filha de `/atendimento` no catálogo) e workspace clínico com o Pet como protagonista. **Nenhuma migração/DDL, nenhuma segunda entidade de atendimento, nenhum rename de tabela.** Gates: suíte completa 3059 PASS / 4 baseline intocadas (3× `a34-instagram`, 1× `automation-audit-p4`), focados 74/74, typecheck e build OK, Chromium real 17/17 com console 0 erro e 0 5xx (base descartável, produção não usada). Contrato, invariantes, matriz de permissões e revisão: [docs/CLINICAL-ENCOUNTER-F1A.md](CLINICAL-ENCOUNTER-F1A.md). **F1B/F1C não iniciados; merge não autorizado/executado.**

**Fechamento final pré-F1, PR #53 (2026-10-03): EM ANDAMENTO / NÃO ESTÁ PRONTO.** Correções adicionais de snap, intenção, bloqueios Dia/Semana, scrollbar nativa, Equipe e Recepção implementadas; 3010 PASS + 4 baseline e Chromium local parcial. A homologação anterior abaixo NÃO encerra os novos gates. [Matriz e pendências](PRE-F1-FINAL-STATUS.md). F1 e merge continuam não autorizados.

**Clinical UX Closure — pré-F1 (2026-10-03): IMPLEMENTADO / HOMOLOGADO LOCALMENTE / REVISÃO PENDENTE.** Stacked sobre PR #52 (`fix/active-clinic-context@0c426be`), na branch fixa de sessão `arena/01a101fb-instalink`. Agenda/range/bloqueio/snap manual 15, serviços clínicos com avançado recolhido, perfil/configurações, Cliente 360 e hierarquia de ações. Next production + DB descartável + Chromium + três logins reais; 2989 PASS / 4 baseline, build/typecheck OK. [Relatório](AUTO-HOMOLOGACAO-CLINICAL-UX-CLOSURE.md). **Esta closure e a revisão da base precedem Clinical Encounter F1; F1 não iniciado, merge não autorizado/executado.**

**Fase consolidada:**
Workflow + Permissões — `CONCLUÍDO EM CÓDIGO / HOMOLOGADO / MERGED / PRODUÇÃO` (PR #46; merge confirmado no GitHub em 2026-10-01 UTC). `main` e `origin/main` foram auditados em `6064bb29333ee0cd4de69cc6e554eb4a3289f793`; conferir o Git novamente antes de outra missão.

**Estado real:** etapa canônica do atendimento derivada de Booking + Fila + Atendimento (sem campo persistido), transições auditadas e idempotentes, matriz Proprietário/Administrador/Recepção/Profissional no servidor, escopo de DADOS do Profissional por relação real em Clientes, Pets, People 360, busca, Oportunidades, Pendências, Conversas, Visão geral e export/import (capacidades `clientes_exportar`/`clientes_importar`) · homologação real (login real, fluxo completo com recarga, 1366/1024/390) · testes registrados: 2801 PASS / 4 baseline conhecidas (3× `a34-instagram`, 1× `automation-audit-p4`, intocadas). Detalhes: `docs/AUTO-HOMOLOGACAO-WORKFLOW-PERMISSOES.md`.

**Agenda Temporal 2.0 — `MERGED EM MAIN` (PR #49, merge em 2026-10-02 22:01 UTC).** As etapas A/ADR, B1, B2, B2.1 e B3 permanecem na grade Day/Week/List. B3 entregou `ScheduleBlock` distinto de Booking/AvailabilityException, snapshots before/after e freeze legado, salas/equipamentos e alternativas de quantidade 1. A homologação registrada foi local, com tenant descartável Owner/Maria/Orlando, Chromium 390/1024/1366, 200/500 cartões, request budget e conflitos 409; **produção não foi usada para QA**. Evidências: `docs/AUTO-HOMOLOGACAO-AGENDA-TEMPORAL-B3.md` e `docs/AGENDA-TEMPORAL-2-FINAL.md`.

**P0 Infra — Single-read authenticated guard (fila ativa, antes de Clinical Encounter F1).** Implementação no branch `arena/01a0feb4-instalink`: autenticação, suporte, tenant, membership, escopo profissional e permissões compartilham snapshot local por operação, sem cache global. Typecheck, build e testes focados passaram; a suíte completa mantém as quatro falhas baseline conhecidas (3× `a34-instagram`, 1× `automation-audit-p4`). Smoke HTTP local em banco descartável e logins reais Owner/Maria/Orlando passou. A validação por Chromium/UI está pendente porque não foi possível baixar/instalar browser neste sandbox; produção não foi usada. Relatório: `docs/AUTO-HOMOLOGACAO-P0-SINGLE-READ-GUARD.md`. PR #50 foi **merged** em produção (merge commit `dbf7d68`, 2026-10-02) — P0 single-read encerrado.

**Clinical Convergence — estado da onda 2 (2026-10-02):** varredura global convertida em PR própria (branch `arena/01a0fede-instalink`): sessão canônica `godoutor_session` com dual-read de drenagem, env `GODOUTOR_DB_FILE` com alias e preservação do arquivo legado, `instalink_doc` confinado a `LEGACY_DOC_TABLE` com plano P1, preset inicial/navigator/catálogo de temas filtrados por `GODOUTOR_LEGACY_PAGES` (nada apagado — ramo de compatibilidade), branding de eventos/atores/exports/widget/R2 e seed tri-clínico. Matrix A/B/C/D e evidências (2939+4-baseline, suítes 67/88/25/15/18/28, personas 4/4; visual NÃO executado — sem Chromium no sandbox): `docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md` §Varredura global onda 2 e `docs/AUTO-HOMOLOGACAO-CLINICAL-CONVERGENCE.md`. **Clinical Encounter F1 continua bloqueado** até revisão/merge deste PR de convergência e autorização explícita.

**Registro histórico da B1:** Etapa A concluiu auditoria, contrato, comparação isolada, testes e cenário de benchmark (ADR: `docs/ADR-AGENDA-TEMPORAL-2.md`; spike: `spikes/agenda-temporal-2/`). A B1 implementou `Booking.startAt/endAt/durationMin/timeZone/temporalSource`, preservou `date/time` como projeção compatível na mesma escrita atômica, congelou duração e inferência legada na escrita e manteve slots/ocupação pela janela do Booking — sem biblioteca de calendário, troca da grade ou backfill remoto. A B1, B2, B2.1 e B3 foram concluídas antes do merge da PR #49; o histórico técnico de cada etapa está em `docs/GODOUTOR-HISTORY.md` e nos relatórios de homologação.

**Entregue na #46 (mergeada em produção) — B3 + Modelo Operacional + P0.1/P0.2/P0.3 + Equipe UX Closure:**
- **P0.1 (Slots & Elegibilidade):** todos os chamadores de `slotEligibleProfessionalIds` passam a equipe completa do tenant, sem pre-filtrar `active !== false`. O helper encapsula a autoridade e distingue `undefined` (legado solo), `[]` (zero elegíveis) e `[ids]`.
- **P0.2 (Privilege Escalation em `person.save`):** validação server-side e atômica das permissões efetivas do alvo (`permissionsFor(role, overrides)`) contra as do ator; 403 sem escrita parcial.
- **P0.3 (`deriveIsTargetOwner`):** validação estrita por IDs/vínculos reais, sem heurística por e-mail e sem vínculo cross-tenant.
- **Equipe UX Closure (esta etapa):**
  - **Papéis como presets.** O fluxo padrão mostra Administrador, **Recepção** (enum interno `SECRETARIA`) e Profissional; Proprietário aparece só como resumo `Proprietário · acesso total` (sem editor, não rebaixável). `ATENDENTE`/`VENDEDOR`/`VIEWER` ficam em “Outros papéis / avançado” (enums e dados preservados).
  - **Recepção** = Agenda, Clientes, Oportunidades, WhatsApp/Conversas. NÃO recebe por padrão: Visão geral, Pedidos, Catálogo, Página, Assistente, Campanhas, Equipe, Configuração, Financeiro, Admin, Atendimento clínico.
  - **Profissional** = Visão geral (escopo próprio), agenda própria, Clientes, Atendimento; sem configuração/estrutura/página/pedidos/agente/admin. O preset NÃO foi ampliado; o escopo de dados do CRM foi implementado na etapa Workflow + Permissões (§2.1).
  - **Overrides.** Trocar de papel aplica preset limpo (confirma se houver personalização real); override igual ao preset não é personalização; abrir um Member legado deriva overrides mínimos contra `permissionsFor(role)` (`src/lib/equipe-access.ts`). Chips `ajuste` só para diferença real. Segurança server-side intacta.
  - **Personalizar acesso** recolhido por padrão; com `GODOUTOR_LEGACY_PAGES` OFF, Página/Pedidos saem do editor (IDs/APIs mantidos); Assistente/Admin/Configuração só em “Capacidades avançadas” dentro do modo de personalização.
  - **Disponibilidade.** `Seguir horário da clínica` = `followBusinessHours=true`; `Usar horário próprio` = `false`. Alternar para seguir NUNCA apaga regras próprias; voltar a `próprio` restaura as regras antigas. `dispMode` vale também na criação: novo Professional com `Usar horário próprio` nasce com `followBusinessHours=false` e zero regras (sem slots próprios até configurar). Horário próprio sem regra mostra `Horário próprio ainda não configurado` + CTA `Configurar horários` → `/disponibilidade?b=<businessId>&professionalId=<professionalId>`; na tela o editor abre já com `Começar copiando o horário da clínica` (nada é gravado antes de salvar).
  - **Erros do drawer.** Toda validação/erro de API aparece em bloco `role=alert` dentro do drawer, com scrollIntoView + foco no bloco (ou no 1º campo inválido); mensagens sem Member/User/Professional nem IDs (`humanizePersonError`).
  - **Serviços que realiza.** Service pertence à clínica; o Profissional só declara o que realiza. Sugestão da biblioteca ainda inexistente abre confirmação rápida (Nome, Grupo, Duração, Preço opcional) com `Duração sugerida · N min` editável; serviço manual exige duração (campo vazio por padrão). Busca com tolerância a flexão (`cardiologista` → `Consulta cardiológica`). Duração nunca é apresentada como regra clínica/CFMV.
- **Serviços & Estrutura:** Categoria→Grupo, Ativo vs Pode ser agendado, `ServiceForm` com biblioteca vet (duração padrão editável).
- **Validação (etapa Equipe UX Closure + fix `dispMode` na criação):** `git diff --check` 0, `npm run build` OK, `npm run typecheck` 0 erros (após build), `npx vitest run` **2759 passed / 4 failed** (2763 testes; 200/202 arquivos) — as 4 falhas são a baseline pré-existente e intocada (3× `a34-instagram` + 1× `automation-audit-p4`). Homologação real em **Chromium headless** (login real, servidor `next start` com banco descartável): fluxo completo 47/47 em 1366 e 47/47 em 1024 (rodada anterior), mais a rodada de fechamento 23/23 em 1366, 23/23 em 1024 e 17/17 em 390 (Proprietário na lista, drawer mobile, persistência). Screenshots em `docs/homologacao-pr46-screenshots/`.
- Produtos: fora da navegação Clinical OS quando `GODOUTOR_LEGACY_PAGES` OFF (guard em `WorkspaceNavigation.visible`, rota/API/dados preservados).
- Disponibilidade preservada como domínio separado QUEM × QUANDO.
- Configurações com DTO seguro `GET /api/businesses/[id]` (`BUSINESS_CONFIG_DTO_FIELDS`, nunca segredos).

**Detalhes históricos completos:** ver `docs/GODOUTOR-HISTORY.md` e `docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md`.

---

## 2. Fila de execução

**Precedência atual (2026-10-04):** revisar o PR do **Clinical Encounter F1A** (branch `arena/01a104e4-instalink`) → somente depois, com autorização explícita, F1B/F1C. Nenhuma PR mergeada por esta sessão.

**Fila oficial — única fonte vigente.** Não duplicar esta sequência em outras partes do documento. Quando uma fase terminar: remover da fila ativa, atualizar Estado atual, registrar conclusão resumida no histórico/audit, próxima fase sobe para posição 1.

1. **Revisar PR da Clinical Convergence (onda 2)** — branch `arena/01a0fede-instalink`; contrato de compatibilidade (dual-read de cookie, alias de env, `LEGACY_DOC_TABLE`, ramos `GODOUTOR_LEGACY_PAGES`), travas em `convergence-wave2.test.ts` e evidências no audit §onda 2. Merge só com revisão humana (sem auto-merge).
2. **Clinical Encounter F1** — prontuário estruturado sobre Atendimento (queixa, anamnese, sinais, problemas/hipóteses/diagnósticos, achados, evolução, plano, procedimentos, retorno, assinatura, versionamento; autosave, rascunho, finalização bloqueia edição, reabertura auditada). **Recorte F1A (domínio, iniciar/retomar e workspace clínico) implementado e em revisão no PR desta branch; aguarda revisão/merge.** **F1B/F1C (prontuário completo, prescrição, exames, anexos, finalização/reabertura) seguem não iniciados e dependem de autorização explícita.**
3. **Cobertura / Modalidade do Atendimento** — Particular vs Convênio/Plano (futuro): cadastro de operadora/convênio e plano, vínculo Tutor/Pet, identificação do beneficiário, cobertura por serviço, elegibilidade/autorização, coparticipação, registro da modalidade no atendimento, pagador (tutor/convênio/ambos), preparação para repasse/faturamento/glosa — veterinária primeiro, sem SUS/TISS/medicina humana antecipada — posicionado após F1 e antes de fechar Conta/Financeiro
4. **Prescrição + Exames + Document Engine** — medicamento/apresentação/dose/via/frequência, ordens/solicitações, template/versão/instância de documentos
5. **Estoque / Farmácia** — item/lote/validade/fornecedor/custo/movimento, integração prescrição→administração→baixa→conta
6. **Cirurgia + Internação** — indicação→orçamento→consentimento→checklist→cirurgia→recuperação→alta, leito/evolução/handoff
7. **Conta do Atendimento + Financeiro avançado** — serviços/procedimentos/medicamentos/materiais → conta → pagamento/parcelas → contas a receber
8. **Fiscal / integrações** — NFS-e, exportações, fechamento mensal, conciliação
9. **Agentes + Jev + LLM + OAAS sobre os domínios estabilizados** — consolidação EventLog em OAAS, agentes clínicos/operacionais consumindo domínios estáveis (não antes)

**Próximo passo:** revisão humana do PR do **Clinical Encounter F1A** — sem merge automático, sem merge executado por esta sessão. **F1B/F1C seguem bloqueados até esse merge e autorização explícita.** P0 single-read já está em produção (PR #50 → `dbf7d68`); Agenda Temporal 2.0 mergeada via PR #49 (2026-10-02 UTC).

**Notas de referência (não implementar nesta PR):**
- **Agenda Temporal 2.0 — Etapa A / evidência revisada:** Google Calendar segue referência **VISUAL/INTERACIONAL**; grade própria, `react-big-calendar`, FullCalendar Standard e Schedule-X Community foram comparados em spike isolado, incluindo Chromium real. Decisão: `NENHUM CANDIDATO APROVADO`; RBC continua condicional, mas a troca Dia→Semana a 1000 eventos levou 11,7 s em Vite dev. Sem dependência de runtime, sem troca da agenda de produção. Detalhes: `docs/ADR-AGENDA-TEMPORAL-2.md` e `spikes/agenda-temporal-2/BENCHMARK.md`.
- **Clinical Encounter F1 — biblioteca de anamnese:** evolução do motor atual de fichas (`AnamneseManager`) para biblioteca de modelos por especialidade, após pesquisa veterinária séria e revisão humana. Nesta PR o motor permanece como está; apenas copy/hub ajustados.


### 2.1 Workflow + Permissões — escopo de DADOS do Profissional (IMPLEMENTADO)

Implementado e homologado: o Profissional recortado enxerga apenas pacientes/tutores com vínculo real (Agendamento, Atendimento ou Fila próprios — nunca por nome/e-mail, sempre com tenant primeiro) em Agenda, Fila, Atendimento, Clientes, People 360, Pets, busca, Oportunidades, Pendências, Conversas e Visão geral; objeto alheio devolve 404/403 seguro. Exportar/importar a base são capacidades próprias (`clientes_exportar`, `clientes_importar`; Proprietário/Administrador por padrão) e exigem contexto sem recorte. A Recepção opera Clientes/Pets/Agenda/chegada/falta/cancelar/reagendar/Oportunidades/Conversas/Pendências, sem área clínica e sem exportar/importar. Matriz por rota: `docs/AUTO-HOMOLOGACAO-WORKFLOW-PERMISSOES.md`.

### 2.2 Contrato de duração do Serviço (Agenda Temporal 2.0 — B1 IMPLEMENTADA em produção)

- `Service.durationMin` é a duração **PADRÃO para novos agendamentos**. Não é a duração histórica de um Booking já criado.
- Agenda 2.0 torna cada Booking estável com `startAt`/`endAt` próprios; editar `Service.durationMin` **não altera** Bookings existentes. **Implementado na B1**: todo Booking novo nasce com janela congelada e `durationMin` próprio; ao editar o serviço, os Bookings legados daquele serviço são congelados **antes** da mudança, com `temporalSource: 'legacy_inferred'` (o valor original antigo é irrecuperável e nunca é falsificado).
- Override opcional futuro **Profissional × Serviço** (ex.: Consulta cardiológica 40 min; Dr. Orlando 50 min). **Não existe tabela/join para isso agora** e nada é criado nesta PR.
- A biblioteca de serviços (`vet-service-catalog`) apenas **sugere** duração (`Duração sugerida · N min`); a clínica decide. Não é regra clínica nem CFMV.

### 2.3 Intervalo de slot ≠ duração (Agenda Temporal 2.0)

| Conceito | Campo atual | Significado |
| --- | --- | --- |
| Duração padrão | `Service.durationMin` | quanto dura o atendimento ao agendar |
| Intervalo de início (snap) | `Availability.slotMin` | de quanto em quanto tempo um horário pode começar |
| Folga atual | `BookingConfig.bufferMin` | intervalo entre atendimentos (hoje único, por clínica) |

Agenda 2.0 deve avaliar **buffer antes/depois por serviço/profissional** sem confundir intervalo de início com duração.

### 2.4 Recursos (roadmap, sem implementação)

Um horário só é válido quando **todos** os recursos exigidos estão livres: **Profissional**, **Sala** e **Equipamento**. Hoje só o Profissional participa da disponibilidade; Sala/Equipamento entram em Agenda 2.0 (modelo normalizado, `business_id` obrigatório).

### 2.5 Referências externas para Agenda 2.0 (Etapa A — pesquisa e spike isolado; sem dependência de runtime)

| Referência | Uso | Observação |
| --- | --- | --- |
| ezyVet | ARQUITETURAL/VISUAL | Appointment Types com Default Length, Planning Guides, Provider Availability, salas/recursos |
| Vetstoria | ARQUITETURAL | duração por tipo de consulta, override por clínico |
| Cal.com | ARQUITETURAL | Event Types, availability schedules, intervalo de slot separado da duração |
| FullCalendar Standard | IMPLEMENTAÇÃO (comparado no spike) | `@fullcalendar/react` 7.1.0 Standard/MIT; Day/Week/List e interação no Standard; Resource TimeGrid/Vertical Resource exige Scheduler Premium |
| react-big-calendar | IMPLEMENTAÇÃO (candidato condicional; **não aprovado para piloto**) | `react-big-calendar` 1.20.0/MIT; recursos Profissional e DnD/resize no pacote livre; IANA por instância testado; 1000 eventos: Dia→Semana 11,7 s/long task 5,32 s em Vite dev — otimizar e medir novamente antes de piloto |
| Schedule-X Community | IMPLEMENTAÇÃO (comparado no spike) | Community MIT; drag/drop, resize, drag-to-create e Resource Scheduler são Premium; DnD/resize não oferecem snap de 5 min |

**Agenda Temporal 2.0 — spike comparativo isolado:** comparação da grade atual × React Big Calendar × FullCalendar Standard × Schedule-X Community, contrato, testes e evidências reais de Chromium estão em `spikes/agenda-temporal-2/` e `docs/ADR-AGENDA-TEMPORAL-2.md`. Estado de saída: `NENHUM CANDIDATO APROVADO`; performance de Vite dev foi medida, mas não representa build/SLO de produção e mostrou gargalo de RBC em 1000 eventos. Pacotes ficam fora do root de produção, Schedule-X tem package/lock próprios. Nenhuma biblioteca ou módulo substituiu agenda/API de produção.

### 2.6 Cadastro/Onboarding — contrato de identidade (registrado, sem implementação)

**Cadastro/Onboarding — contrato de identidade (REGISTRADO, NÃO implementado; não bloqueia Workflow + Permissões):**
- Conta/login representa uma **PESSOA**. O primeiro usuário da clínica nasce como **Proprietário**.
- **Clínica é entidade separada da conta.** Não misturar Owner (pessoa/papel) com Business/Clínica.
- Onboarding futuro deve aceitar clínica/titular como **PF ou PJ**: PF → **CPF**; PJ → **CNPJ**.
- **E-mail de login** e **e-mail institucional da clínica** são campos distintos e podem ser iguais.
- Organização / Clínica / Unidade / Equipe permanecem **entidades/vínculos distintos**.
- Nenhuma implementação nesta missão; entra na fila só por missão explícita.

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
- **Atendimento (F1A · início canônico):** existe UMA ÚNICA porta de entrada no atendimento — `startOrResumeEncounter` (`src/lib/encounter-start.ts`), executada dentro de `updateDB` (checagem de duplicidade e criação indivisíveis). Ela cria quando não há registro, **retoma o mesmo `encounterId`** quando há e devolve o finalizado para leitura sem recriar nem reabrir. A rota canônica é `/atendimento/[encounterId]` (filha de `/atendimento` no catálogo); `/atendimento` é apenas o resolvedor de origem. ID vindo do cliente NÃO concede acesso: todo vínculo é re-resolvido no tenant autenticado.
- **Encounter é a única entidade de atendimento clínico:** proibido criar `ClinicalEncounter`/`Visit` paralelo, renomear a tabela físico ou fazer migração big-bang sem prova documentada de inadequação. Evoluir o domínio existente; especialidades futuras entram por SEÇÕES (`src/lib/encounter-sections.ts`), nunca por nova entidade.
- **Estratégia Enterprise:** sem fork — feature flags, configuração, papéis, módulos, limites, integrações.

---

## 5. Histórico resumido

Fases concluídas viraram resumo curto. Detalhes de implementação movidos para histórico.

- **Design System 2.0 — CONCLUÍDO (#43)** — mergeado 2026-09-29 (`85154c8`). Detalhes: arquétipos, Atendimento full-page, Cliente 360, temas, navegação.
- **Workflow + Permissões (#46)** — `MERGED / PRODUÇÃO / CONCLUÍDO`. Etapa canônica derivada, transições auditadas, matriz de papéis no servidor, escopo de dados do Profissional, capacidades de exportar/importar, Pendência de falta reaproveitando `tasks`.
- **Clinical Convergence / Architecture Closure (#46)** — `MERGED / PRODUÇÃO / CONCLUÍDA`. Unificação Equipe×Profissionais, Serviços clínico sem vitrine, Configurações cadastro centralizado, DTO seguro, porta única Equipe, Disponibilidade clínica, Estrutura hub, Agenda classificada, P0.1–P0.3, papéis como presets (Recepção), horário próprio preservado, serviço sugerido com duração editável.
- **Agenda Temporal 2.0 (#49)** — `MERGED EM MAIN` em 2026-10-02 UTC; QA registrado exclusivamente em ambiente local descartável.
- **P0 Infra — single-read authenticated guard** — em implementação/revisão nesta branch; QA automatizado e HTTP local documentados em `docs/AUTO-HOMOLOGACAO-P0-SINGLE-READ-GUARD.md`; Chromium pendente por bloqueio de download; aguarda PR/revisão antes de Clinical Encounter F1.

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

### PR53 — fechamento dos últimos gates (2026-10-03)

Correções restritas à faixa visível com drawer, navegação dirty, copy ativa e secondary locais. Chromium cobre profissional vazio, vínculo canônico bidirecional, bloqueios de clínica/recurso e Azul/Verde. Matriz e auditoria: `PRE-F1-FINAL-STATUS.md` / `PRE-F1-CLOSING-AUDIT.md`. Liberação exige logs pós-commit e Vercel SUCCESS no SHA final; evidência pré-commit não basta. Produção, F1 e merge: não.

### PR53 — último polimento e decisões antes do F1

Contrato/evidências: `PRE-F1-POLISH.md`. Range com horário já escolhido, duração humana, secondary outline→soft hover, temas curados e dias especiais derivados sem alterar engine/storage. Salas/equipamentos continuam no editor atual; convergir depois para Estrutura sem duplicação. Pendência futura exige ação, não todo agendamento futuro; preservar automações agora. Conversas: agendamento/tarefa contextuais ficam no backlog pós-F1. Anamnese provisória: visita/dados permanentes/evolução/prontuário/especialidades serão definidos no F1, ainda não iniciado. A homologação anterior não substitui os gates pós-commit desta missão.
