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
Clinical Architecture Closure · PR #46 — P0 Blockers Fixes + **Equipe UX Closure + Contrato de Agenda/Serviço**
Branch de trabalho: `arena/01a0f3d3-instalink` · PR #46 — validar estado real no Git (`git log --oneline -5`, `gh pr view 46`)

**Status #46:**
`P0 ESTRUTURAL CONCLUÍDO / EQUIPE UX CLOSURE + HOMOLOGAÇÃO EM ANDAMENTO / NÃO MERGEAR`

**O que já está em código (B3 + Modelo Operacional + P0.1/P0.2/P0.3 + Equipe UX Closure — PR #46):**
- **P0.1 (Slots & Elegibilidade):** todos os chamadores de `slotEligibleProfessionalIds` passam a equipe completa do tenant, sem pre-filtrar `active !== false`. O helper encapsula a autoridade e distingue `undefined` (legado solo), `[]` (zero elegíveis) e `[ids]`.
- **P0.2 (Privilege Escalation em `person.save`):** validação server-side e atômica das permissões efetivas do alvo (`permissionsFor(role, overrides)`) contra as do ator; 403 sem escrita parcial.
- **P0.3 (`deriveIsTargetOwner`):** validação estrita por IDs/vínculos reais, sem heurística por e-mail e sem vínculo cross-tenant.
- **Equipe UX Closure (esta etapa):**
  - **Papéis como presets.** O fluxo padrão mostra Administrador, **Recepção** (enum interno `SECRETARIA`) e Profissional; Proprietário aparece só como resumo `Proprietário · acesso total` (sem editor, não rebaixável). `ATENDENTE`/`VENDEDOR`/`VIEWER` ficam em “Outros papéis / avançado” (enums e dados preservados).
  - **Recepção** = Agenda, Clientes, Oportunidades, WhatsApp/Conversas. NÃO recebe por padrão: Visão geral, Pedidos, Catálogo, Página, Assistente, Campanhas, Equipe, Configuração, Financeiro, Admin, Atendimento clínico.
  - **Profissional** = Visão geral (escopo próprio), agenda própria, Clientes, Atendimento; sem configuração/estrutura/página/pedidos/agente/admin. O preset NÃO foi ampliado; o escopo de dados do CRM segue pendente (ver Workflow + Permissões abaixo).
  - **Overrides.** Trocar de papel aplica preset limpo (confirma se houver personalização real); override igual ao preset não é personalização; abrir um Member legado deriva overrides mínimos contra `permissionsFor(role)` (`src/lib/equipe-access.ts`). Chips `ajuste` só para diferença real. Segurança server-side intacta.
  - **Personalizar acesso** recolhido por padrão; com `GODOUTOR_LEGACY_PAGES` OFF, Página/Pedidos saem do editor (IDs/APIs mantidos); Assistente/Admin/Configuração só em “Capacidades avançadas” dentro do modo de personalização.
  - **Disponibilidade.** `Seguir horário da clínica` = `followBusinessHours=true`; `Usar horário próprio` = `false`. Alternar para seguir NUNCA apaga regras próprias; voltar a `próprio` restaura as regras antigas. `dispMode` vale também na criação: novo Professional com `Usar horário próprio` nasce com `followBusinessHours=false` e zero regras (sem slots próprios até configurar). Horário próprio sem regra mostra `Horário próprio ainda não configurado` + CTA `Configurar horários` → `/disponibilidade?b=<businessId>&professionalId=<professionalId>`; na tela o editor abre já com `Começar copiando o horário da clínica` (nada é gravado antes de salvar).
  - **Erros do drawer.** Toda validação/erro de API aparece em bloco `role=alert` dentro do drawer, com scrollIntoView + foco no bloco (ou no 1º campo inválido); mensagens sem Member/User/Professional nem IDs (`humanizePersonError`).
  - **Serviços que realiza.** Service pertence à clínica; o Profissional só declara o que realiza. Sugestão da biblioteca ainda inexistente abre confirmação rápida (Nome, Grupo, Duração, Preço opcional) com `Duração sugerida · N min` editável; serviço manual exige duração (campo vazio por padrão). Busca com tolerância a flexão (`cardiologista` → `Consulta cardiológica`). Duração nunca é apresentada como regra clínica/CFMV.
- **Serviços & Estrutura:** Categoria→Grupo, Ativo vs Pode ser agendado, `ServiceForm` com biblioteca vet (duração padrão editável).
- **Validação (etapa Equipe UX Closure + fix `dispMode` na criação):** `git diff --check` 0, `npm run build` OK, `npm run typecheck` 0 erros (após build), `npx vitest run` **2754 passed / 4 failed** (2758 testes; 199/201 arquivos) — as 4 falhas são a baseline pré-existente e intocada (3× `a34-instagram` + 1× `automation-audit-p4`). Homologação real em **Chromium headless** (login real, servidor `next start` com banco descartável): fluxo completo 47/47 em 1366 e 47/47 em 1024; sanity em 1440 e 390. Screenshots em `docs/homologacao-pr46-screenshots/`.
- Produtos: fora da navegação Clinical OS quando `GODOUTOR_LEGACY_PAGES` OFF (guard em `WorkspaceNavigation.visible`, rota/API/dados preservados).
- Disponibilidade preservada como domínio separado QUEM × QUANDO.
- Configurações com DTO seguro `GET /api/businesses/[id]` (`BUSINESS_CONFIG_DTO_FIELDS`, nunca segredos).

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

**Após #46, a próxima missão de código é Workflow + Permissões → Agenda Temporal 2.0 → Clinical Encounter F1 → Cobertura/Modalidade → Prescrição + Exames + Document Engine → Estoque/Farmácia → Cirurgia/Internação → Conta + Financeiro → Fiscal → Agentes/Jev/LLM.** Nenhuma delas começa antes da homologação/merge autorizado de #46.

**Notas de referência (não implementar nesta PR):**
- **Agenda Temporal 2.0 — referências para decisão futura:** Google Calendar como referência **VISUAL/INTERACIONAL** (interação de grade, drag-selection, bloqueios). Para análise arquitetural comparar agenda própria vs bibliotecas: `fullcalendar/fullcalendar`, `schedule-x/schedule-x`, `bigcalendar/react-big-calendar` (GitHub). Decisão futura: evoluir implementação própria vs adotar biblioteca vs reutilizar padrões/algoritmos — sem instalar agora.
- **Clinical Encounter F1 — biblioteca de anamnese:** evolução do motor atual de fichas (`AnamneseManager`) para biblioteca de modelos por especialidade, após pesquisa veterinária séria e revisão humana. Nesta PR o motor permanece como está; apenas copy/hub ajustados.


### 2.1 Workflow + Permissões — requisito de ESCOPO DE DADOS (registrado, não implementado)

O Profissional hoje tem escopo de dados por `professionalScope` (`access-core.ts`) em: Agenda/bookings, Visão geral (`/api/overview`), fila (`/api/queue`), busca (`/api/search`), Atendimento/encounters e leitura de catálogo. **Não** têm escopo por profissional: `Clientes`/contatos (`/api/contacts*` — a exportação completa só filtra os encontros clínicos por escopo; lista, exportação simples e importação não filtram por profissional), Pet/People 360, Oportunidades/tarefas e Conversas — quem tem a capability `clientes` enxerga o CRM inteiro do tenant. Por isso o preset do Profissional NÃO foi ampliado nesta etapa.

Workflow + Permissões deve definir e aplicar no servidor:
- **Profissional → própria agenda** (já parcial) e pacientes/tutores “sob cuidado” (vínculo por agendamento/atendimento);
- **Visão geral, Clientes e Atendimento** com escopo por profissional (ou política por clínica);
- exportação/importação de contatos como capability separada (hoje atrelada a `clientes`);
- matriz papel × capability × escopo (tenant, clínica, profissional) com testes por papel real.

### 2.2 Contrato de duração do Serviço (Agenda Temporal 2.0 — apenas documentação)

- `Service.durationMin` é a duração **PADRÃO para novos agendamentos**. Não é a duração histórica de um Booking já criado.
- Agenda 2.0 torna cada Booking estável com `startAt`/`endAt` próprios; editar `Service.durationMin` **não altera** Bookings existentes.
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

### 2.5 Referências externas para Agenda 2.0 (pesquisa — sem copiar, sem instalar)

| Referência | Uso | Observação |
| --- | --- | --- |
| ezyVet | ARQUITETURAL/VISUAL | Appointment Types com Default Length, Planning Guides, Provider Availability, salas/recursos |
| Vetstoria | ARQUITETURAL | duração por tipo de consulta, override por clínico |
| Cal.com | ARQUITETURAL | Event Types, availability schedules, intervalo de slot separado da duração |
| FullCalendar | IMPLEMENTAÇÃO (a validar) | núcleo MIT (Standard); **Resource views são Premium** |
| react-big-calendar | IMPLEMENTAÇÃO (spike) | MIT; recursos e drag-and-drop no núcleo; candidato ao spike |
| Schedule-X | IMPLEMENTAÇÃO (a validar) | recursos Premium |

**Agenda Temporal 2.0 começa por spike/ADR:** grade própria × `react-big-calendar` × FullCalendar, validando licença, manutenção, bundle, Design System, multi-tenant e acessibilidade **antes** de reutilizar qualquer código. Nada é instalado por esta PR.

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
- **Clinical Convergence / Architecture Closure (#46)** — `P0 ESTRUTURAL CONCLUÍDO / EQUIPE UX CLOSURE + HOMOLOGAÇÃO EM ANDAMENTO / NÃO MERGEAR`. Unificação Equipe×Profissionais, Serviços clínico sem vitrine, Configurações cadastro centralizado, DTO seguro, porta única Equipe, Disponibilidade clínica, Estrutura hub, Agenda classificada, P0.1–P0.3, papéis como presets (Recepção), horário próprio preservado, serviço sugerido com duração editável.

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
