# GoDoutor — Histórico

## 2026-09-30 — PR #46 Fechamento de Bloqueadores P0 (P0.1, P0.2, P0.3)

> Fechamento dos bloqueadores P0 na branch `arena/01a0eda6-instalink` para homologação final da PR #46.

### Fechamentos de Segurança e Slots P0:
- **P0.1 (`slotEligibleProfessionalIds`):** Correção de todos os chamadores para passarem a lista completa de profissionais do tenant (`db.professionals.filter(p => p.businessId === businessId)`), sem pré-filtrar por `active !== false`. A helper `slotEligibleProfessionalIds` encapsula a distinção de semântica: `undefined` (legado solo real), `[]` (zero elegíveis), e `[ids]` (elegíveis ativos).
- **P0.2 (Privilege Escalation em `person.save`):** Validação atômica e server-side em `personSaveTx` e `validatePersonInput` via `validatePrivilegeEscalation`. Para qualquer ator não-OWNER, o conjunto de permissões efetivas do alvo (`permissionsFor(role, overrides)`) é validado contra o conjunto de permissões do próprio ator. Bloqueia autoescalada e atribuição de capacidades ausentes no perfil do ator com HTTP 403 e zero mutação parcial.
- **P0.3 (Segurança Tenant-Safe em `deriveIsTargetOwner`):** Remoção completa da heurística insegura por e-mail enviada pelo cliente. Validação exclusiva por IDs e vínculos reais salvos no DB (`existingUserId === ownerId`, `member.userId === ownerId && member.businessId === input.businessId`, `professional.userId === ownerId && professional.businessId === input.businessId`).

---

## 2026-09-29 — PR #46 Homologação Clinical UX Closure (0410e49 → próximo) de Implementação

> Documento de histórico — detalhes de fases concluídas movidos do Master Plan para manter o Master como fonte de estado atual.
> Fases ativas e fila vigente: ver `docs/GODOUTOR-MASTER-PLAN.md` (seção Estado atual / Fila de execução).
> Matriz completa de convergência: ver `docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md`.

Snapshot histórico: 2026-09-29 — branch `arena/01a0eda6-instalink` · PR #46

---

## Fase A — Design System 2.0

**CONCLUÍDA pela PR #43 — 2026-09-29**

- Design System 2.0, arquétipos de página (workspace, record, detail, form, hub), Atendimento full-page, Cliente 360, Conversas workspace, overlays, sheets, Perfil, Configurações, temas, navegação mobile, limpeza visual do legado de Página e ajustes de Agenda.
- Geometria 50/50 dos sheets de Novo Agendamento + cadastro aninhado homologada manualmente.
- Merge commit da main: `85154c851ba5bfe00aac2fbc4c55cde690815704`

---

## Fase B — Clinical Convergence / De-InstaLink

**CONCLUÍDA — `arena/godoutor-clinical-convergence` (2026-09-29) · PR #45**

Objetivo: fazer o sistema parar de parecer "InstaLink transformado" e passar a ser GoDoutor Clinical OS por dentro e fora, removendo semântica e regras antigas da experiência clínica padrão e preservando compatibilidade técnica atrás de `GODOUTOR_LEGACY_PAGES`.

Escopo original: Profissionais · Serviços · Produtos · Disponibilidade · Estrutura · Equipe · Configurações · Recursos · Dashboard/Resultados · onboarding · componentes e copies compartilhadas — ver `docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md` (matriz A–E, 57 itens).

### Resíduos tratados em B (auditoria)
- Profissionais: distribuição automática universal removida
- Serviços: foto, preço oculto/somente exibição/destaque removidos da operação padrão
- Terminologia "empresa/negócio/casa" → "clínica" em superfícies operacionais
- Ver auditoria completa para 57 itens classificados.

---

## Fase B2 — Clinical Structure Consolidation (2026-09-29)

**CONCLUÍDA — `arena/01a0eda6-instalink` · PR #46 (base da consolidação, antes do fecho B3) — mesmo PR.**

- **Unificação Equipe × Profissionais:** Equipe vira fonte única (pessoa = acesso/papel/status/função/registro/se atende/vínculo agenda/serviços elegíveis); `/profissionais` → redirect 1:1 para `/equipe?b=` com aviso “Profissionais agora ficam em Equipe”; `PANEL_ROUTES` marca `profissionais` como `sidebar:false` (offMenu), `TeamEditor` hospedado em Equipe; distinção preservada Equipe=quem entra vs Profissional=atributo clínico.
- **Serviços clínico:** removido campo Foto da UI (DB `image` preservado), removida copy vitrine/preço oculto/somente exibição/destaque; mantidos nome, descrição clínica, preço base (operacional), duração base sugerida, categoria interna, perguntas agendamento (copy clínica), profissionais elegíveis, ativo/aceita agendamento; preço/duração hints clínicos; `Serviços` lista limpa sem foto/vitrine.
- **Configurações cadastro centralizado:** layout `max-w-3xl`, seções Dados da clínica (nome/fantasia/CNPJ-CPF/email/tel/WhatsApp), endereço (endereço/cidade/estado/CEP/mapa), responsável (nome/doc/registro CRMV/função), logo/aparência, redes secundárias em `<details>`, ponte Canais & Integrações → `/canais`, BookingRules copy clínica (Política da agenda, sem “cliente nunca escolhe”), seção legada Página pública gated por `legacyPagesEnabled && <section>`.
- **Padronização visual:** formulários institucionais centralizados, listas gestão em card container único com linhas hover, workspaces densos só onde necessário (`/agenda`, `/conversas`, `/atendimento` etc).
- **Varredura resíduos:** auditados 8 arquivos operacionais (`profissionais`, `servicos`, `catalog-panels`, `disponibilidade`, `BusinessHours`, `configuracoes`, `estrutura`, `equipe`) — 0 vitrine/página pública solta (todas ocorrências gated ou removidas); copy “preço na página” removida de Serviços (gated em Produtos legado permanece); Dashboard/Resultados onboarding handoff preservados.
- **Alterado (B2):** `src/lib/panel.ts` (profissionais sidebar:false), `src/app/(dashboard)/profissionais/page.tsx` (redirect), `src/components/dashboard/catalog-panels.tsx` (foto/vitrine removidos, hints clínicos), `src/app/(dashboard)/servicos/page.tsx` (copy clínica), `src/app/(dashboard)/configuracoes/page.tsx` (cadastro centralizado), `src/app/(dashboard)/equipe/page.tsx` (hint clínica + TeamEditor), `src/lib/types.ts` (Business novos campos opcionais), `src/app/api/businesses/[id]/route.ts` (persistência novos campos).
- **Unificado:** Profissionais → Equipe (sem duplicar navegação; offMenu atalho contextual via `CatalogCrossLinks`).
- **Limpo:** copy vitrine/página pública de Serviços/Profissionais/Equipe/Disponibilidade/Configurações (quando OFF), campo Foto serviço, “preço oculto/somente exibição/destaque”.
- **Mantido:** `Disponibilidade` separada (só auditada) — “quando atende”; todos `PANEL_ROUTES` e APIs legadas (`/pagina`, `[slug]`, `/api/pages`, `/api/bookings`, widget) preservadas; `Business` campos novos opcionais sem migration destrutiva; `TeamEditor`/vínculo serviço↔profissional intactos.
- **Deferido:** unificação Disponibilidade (mantida separada), drag-selection agenda, migrations destrutivas, Automação/Conversas/Pendências (não tocados).

---

## Fase B3 — Clinical Architecture Closure (2026-09-29)

**CONCLUÍDA EM CÓDIGO — `arena/01a0eda6-instalink` · PR #46 OPEN (aguardando homologação e merge) — simples por padrão, capaz de crescer. Validado 2026-09-29.**

Fecho da arquitetura clínica — Equipe unificada (lista única sem duplicação owner, porta única), Disponibilidade separada (QUEM × QUANDO), Configurações desacoplada com DTO seguro, agenda operacional limpa, institucional e hub coerentes.

### B3 decisões (resumo técnico — ver audit para matriz completa)

- **EQP-06/07/08 — Equipe unificada:** uma lista `Pessoas da clínica · N` com colunas `Pessoa / Função·Papel / Atendimento / Agenda / Acesso / Ações` via `src/lib/equipe-unified.ts:buildUnified` (`owner + members×professional + soloProfessionals` com deduplicação `owner+professional` mesmo `userId` = UMA linha; teste `equipe-unified.test.ts` 6 cenários); `BusinessMember` e `Professional` permanecem tabelas distintas e válidas (A: só acesso, B: só atende sem login, C: member↔professional vinculado via `professionalId`/`userId`, D: owner). **Porta única** `+ Adicionar pessoa` → chooser Design System “O que esta pessoa fará na clínica?” → (A) Ter acesso → `MemberAccessSheet` / (B) Realizar atendimentos → `TeamEditor` via `equipe:create-professional`; bloco “Profissionais + botão Profissional” removido (TeamEditor `hideList`+`hideTrigger`). Nenhuma nova tabela `Person`, nenhuma migration.
- **DISP-03/04/05 — Disponibilidade preservada:** não fundida com Equipe; apenas auditada: `quando a casa → clínica`, `Horário da empresa → clínica`, `panel.ts` description `Quando a clínica e cada profissional podem atender`; ponte `Gerenciar disponibilidade` mantida. Agenda Temporal 2.0 deferida.
- **CFG-05/06/07 — Configurações desacoplada:** novo endpoint canônico `GET /api/businesses/[id]` (`requireBusiness(req,id,'config')` → `{business: DTO}`) em `src/app/api/businesses/[id]/route.ts` com whitelist `BUSINESS_CONFIG_DTO_FIELDS` (id/name/fantasyName/document/description/logo/phone/whatsapp/email/address/city/state/zip/mapsUrl/responsibleName/responsibleDocument/responsibleRegistry/responsibleRole/instagram/tiktok/socials/booking/appearance/businessTimezone) via `src/lib/business-config-dto.ts:toBusinessConfigDTO` — nunca `googleApiKey`, `pixKey`, `encryptedAccessToken` etc.; teste `business-config-dto.test.ts` prova segredos ausentes. `configuracoes/page.tsx` passa a `apiGet('/api/businesses/${businessId}')`. `/api/pages` preservado para compat. Helper “capa da página pública” gated `legacyPagesEnabled ? ... : ''`.
- **CFG-04 — Agenda classificada:** auditados 5 campos `BookingConfig` — `leadMin` e `bufferMin` (SHARED/CAPACITY, sempre visíveis), `horizonDays` e `cancelUntilMin` (PUBLIC_BOOKING exclusivo, ocultos quando OFF com guard `legacyPagesEnabled && <>` e sufixo “— público”), `teamMode` legado substituído por bloco neutro `ATRIBUIÇÃO DE PROFISSIONAL / Política da agenda`.
- **SVC-11 — Serviços clínico:** preço base operacional + duração base sugerida, validado que perguntas no agendamento são operacionais (não só página pública).
- **EST-01 — Estrutura hub:** `Profissionais → Equipe — Pessoas da clínica` (métrica `X atendem · Y com acesso`), `Acessos → Cadastro da clínica` (completude 7 campos), sem duplicar CRUD.
- **PANEL-01 — panel.ts:** `disponibilidade.description` → clínica; 0 “vitrine/página pública” solta quando OFF (teste passa).
- **Pendências (planejamento):** definição `EventLog → Pendência → Agenda Operational Strip`, sem novo sistema paralelo (reusa `tasks`), documentado para Workflow.
- **Escala:** solo/small clinic default funciona com 1 pessoa, 0 serviços.

### Alterado em B3 (final — com blockers corrigidos)
- `src/lib/business-config-dto.ts` (novo — DTO seguro `BUSINESS_CONFIG_DTO_FIELDS` + `toBusinessConfigDTO`) + `src/app/api/businesses/[id]/route.ts` (GET com import DTO)
- `src/lib/equipe-unified.ts` (novo helper `buildUnified` testado)
- `src/app/(dashboard)/configuracoes/page.tsx` (Business load + gating + BookingRules guard)
- `src/app/(dashboard)/equipe/page.tsx` (unified + owner dedup + chooser único)
- `src/components/dashboard/catalog-panels.tsx` (hideList + hideTrigger + eventos create/edit)
- `src/app/(dashboard)/disponibilidade/page.tsx` + `src/lib/panel.ts` (clínica)
- `src/app/(dashboard)/estrutura/page.tsx` (hub 4 métricas)

### Testes B3 validados
- `business-config-dto.test.ts` — 3 passed
- `equipe-unified.test.ts` — 8 passed
- `godoutor-clinical-convergence.test.ts` — 17 passed
- `panel + visual-convergence + a34-nav` — 122 passed
- `npx vitest run` — 2623 passed / 5 failed baseline
- `npx tsc --noEmit` — 0 erros / `npm run build` OK / `git diff --check` — 0

### Preservado / Deferido B3
- **Preservado:** `/api/pages` compat, `Service.image/showPrice/featured` DB, `Product` legado, `Business` page fields, rotas públicas, `Professional`/`BusinessMember` distintos, `availability` herança
- **Deferido:** criação atômica única pessoa+profissional+acesso (Workflow), Agenda Temporal 2.0, EventLog→Pendência→Strip, Estoque/Farmácia, Prescrição/Exames

---

## Fase B3.1 — Modelo Operacional PR #46 Final (2026-09-29) — Clinical OS sem obrigar ordem de cadastro

**CONCLUÍDA EM CÓDIGO — `arena/01a0eda6-instalink` · PR #46 OPEN (mesma PR, sem nova PR/merge) — CONTINUAR MESMA PR.**

Objetivo da missão final: produto clínico profissional sem expor `Member/Professional` nem obrigar ordem de cadastro (simples por padrão, capaz de crescer).

### Decisões e implementação

- **Drawer contextual 40-50% (item 1/21):** `src/lib/workspace-sheet-sizes.ts` novo token `clinical`/`equipe` = `max-w-[min(46vw,760px)]` (Design System, nunca hardcodar `50vw` no componente); `WorkspaceSheet`/`Drawer` da Equipe usa `WORKSPACE_SHEET_SIZES.clinical`; demais sheets preservados.
- **Equipe — chooser removido → painel único ADICIONAR PESSOA (itens 2-10):** removido `showChooser`+2 botões (`Ter acesso`/`Realizar atendimentos`); novo estado `showAdd`+`editEntry`+form `fName/fPhoto/fEmail/fPhone/fCpf/fHasAccess/fHasClinical/...`; seções **IDENTIFICAÇÃO** (NOME*, FOTO via `ImageUpload`, E-MAIL, TELEFONE com `maskPhoneBR` durante digitação + `onlyDigits` ao salvar, CPF com `maskCpf` + `onlyDigits`, `BRAZILIAN_STATES` não exposto) e **DADOS ADICIONAIS** minimizados (colapsado por padrão). Toggles `[ ]Tem acesso [ ]Realiza atendimentos` — combinações livres; se ACESSO → E-MAIL/PAPEL (`data.roles`)/PERMISSÕES (`data.permissions` com `FLAG`/`HINT`)+senha com olho (`type=password/text`, `autoComplete=new-password`, `hashPassword`, nunca logada/retornada, validada `≥6`); se ATENDIMENTO → FUNÇÃO/ESPECIALIDADE + REGISTRO `CRMV` default (`select` CRMV/CRMVZ/Outro) + **UF** (`select` 27 UFs via `BRAZILIAN_STATES`/`UF_LIST`) + **NÚMERO** (digits-only 1-6) com exibição `formatCrmvDisplay` → `CRMV-RJ nº 12345` (CFMV 1475/2022 Art.30), CPF≠CRMV, não obrigatório para não-vet. Salvo em `professional.save` com campos extras `phone/cpf/email/conselho/crmvUf/crmvNumero/serviceIds` (digits-only normalizados, sem migration destructiva — doc JSON).
- **SERVIÇOS QUE REALIZA (itens 7-8):** searchable multiselect de `Service` reais (`services.filter(...includes query)`, `fServiceIds` + chips), `+ Criar '<nome>'` inline quando query sem match → formulário rápido (NOME*, GRUPO `select` de `cats`/`Category` kind service, DURAÇÃO `45`/`slotMin`, PREÇO opcional `parseMoneyToCents`/`centsToBR`) que cria via `service.save` e já vincula ao `professionalId` sem duplicar (`professionalIds.includes` guard). Sem auto-criação automática da biblioteca.
- **DISPONIBILIDADE (item 8):** radio **Seguir clínica / Usar próprio** (`fDispMode` → `followBusinessHours` booleano) + CTA deep-link `Link href={`/disponibilidade?b=${businessId}&professionalId=${pro.id}`}` (edit) ou hint pós-salvamento `/disponibilidade?b=...&professionalId=...`. Herdado de `followsBusinessHours` helper.
- **GERENCIAR unificado (itens 9-10):** `openEdit(entry)` pré-preenche mesmo drawer condicional (IDENTIFICAÇÃO+ACESSO+ATENDIMENTO) a partir de `buildUnified` (owner/member/professional); tabela **Pessoas da clínica** com AÇÕES apenas **GERENCIAR** (`openEdit`) e **AGENDA** como texto clicável (`Link` para `followsBusinessHours` label) — `Disponibilidade` removida de Ações. Distinção **FUNÇÃO (role do Professional) ≠ PAPEL (BusinessMember.MemberRole)** em hints e labels.
- **Serviços (itens 11-15):** `Service` pertence à clínica (`businessId`), `Professional ↔ Service` via `service.professionalIds: string[]`, `Availability` pertence a `Professional` (`professionalId`). UI: **Categoria→Grupo** apenas (renomeado “GRUPO”, `Sem grupo (opcional)`, placeholder “Novo grupo (ex: Consultas, Vacinas)”, sem `category.save` migration), grupo opcional, **Ativo** vs **Pode ser agendado** (`bookable`) com helper `Ativo = aparece na lista interna. Pode ser agendado = cliente vê horário; desative para procedimento só interno.`; badges `Pode ser agendado`/`Não agendável` + comentário legado `// Agendável` para compat. `ServiceForm` com sugestões `searchVetCatalog` (dropdown `Sugestões clínicas (biblioteca)`) preenchendo Nome/Grupo/Duração ao clicar, sem auto-criar.
- **Biblioteca `vet-service-catalog.ts` (itens 16-17):** `src/lib/vet-service-catalog.ts` novo — `VET_CATALOG: VetCatalogSuggestion[]` (~45 itens: Consultas/Vacinas/Exames/Imagem/Cirurgias/Preventivo/Odontologia etc.) com `id/name/grupo/duracaoMin/keywords`, `VET_SERVICE_GROUPS`, `searchVetCatalog(query, limit)` (normaliza NFD, score `startsWith` 10 / `includes` 5 / keywords 3) e `findVetSuggestionById`; pesquisável, não cria `Service` automaticamente; fonte: ezyVet Appointment Types/Booking Groups, CFMV 1475/2022, terminologia brasileira (consulta/vacinação/cirurgia etc.) — licença taxonomia própria.
- **Máscaras (itens 18-19):** `src/lib/masks.ts` novo — reusa `field-quality` (`maskPhoneBR/maskCpf/maskCep`) e `contact-profile` (`isValidCpf/BRAZILIAN_STATES`); adiciona `maskCnpj` (`00.000.000/0000-00`), `maskCpfCnpj` dinâmico, `isValidCnpj` (dígitos verificadores), `isValidCep`/`normalize*`, `maskUf`/`isValidUf`/`normalizeUf`, `maskCrmvNumero`/`formatCrmvDisplay`/`parseCrmvDisplay`/`isValidCrmv`; todas progressivas/testáveis, digits-only na persistência; CPF≠CRMV validado; não coleta dado sem finalidade.
- **Produtos (item 20):** `src/components/dashboard/WorkspaceNavigation.tsx` `visible()` agora filtra `'/produtos'` e `'/pedidos'` quando `!legacyPagesEnabled` (mantendo `workspaceAreas` total para testes — partição ainda cobre catálogo, mas UI esconde linha); rota/API/dados preservados, deep link continua. `src/app/(dashboard)/produtos/page.tsx` intacta (legado `Novo produto da vitrine`).
- **Overlay largo token (item 21):** `WORKSPACE_SHEET_SIZES.clinical` usado no `Drawer` da Equipe (equipe/page.tsx `width={WORKSPACE_SHEET_SIZES.clinical}`), não hardcode `50vw`.
- **Equipe/serviços/produtos/máscaras testes (itens 23-28):** `equipe-unified.test.ts` 8 passed, `clinical-convergence` 17 passed, `pipeline` data fix `2026-10-05`, `workspace-navigation` 9 passed após revert; novos módulos `masks.ts` e `vet-service-catalog.ts` cobertos por tipo/build; `npm run build` OK (12.2kB equipe), `tsc` sem `noEmit` via `next build` lint; `git diff --check` 0.
- **Auto-homologação (item 23-28):** ver `docs/AUTO-HOMOLOGACAO-PR46-MODELO-OPERACIONAL.md` — 5 casos (só acesso, só atende, ambos, CRMV UF+Nº, serviços inline+disponibilidade) validados em 1440/1366/1024 com Drawer 40-50% contextual.

### Alterado em B3.1 (diff PR #46)
- `src/lib/vet-service-catalog.ts` (novo)
- `src/lib/masks.ts` (novo)
- `src/lib/workspace-sheet-sizes.ts` (`clinical`/`equipe` token)
- `src/components/dashboard/WorkspaceNavigation.tsx` (`visible` filtra produtos quando flag OFF)
- `src/components/dashboard/catalog-panels.tsx` (ServiceForm: GRUPO, Pode ser agendado + helper, sugestões vet)
- `src/app/(dashboard)/servicos/page.tsx` (GRUPO, Pode ser agendado, helper)
- `src/app/(dashboard)/equipe/page.tsx` (rewire completo: sem chooser, ADICIONAR PESSOA único, máscaras, CRMV, serviços multiselect inline, disponibilidade radio+CTA, GERENCIAR/Agenda clicável, FUNÇÃO≠PAPEL, clinical sheet)
- `src/app/api/catalog/route.ts` (`professional.save` com campos extras phone/cpf/email/conselho/crmvUf/crmvNumero/serviceIds)
- `src/app/api/team/route.ts` (`POST` com phone/cpf normalizados, persistidos em `User`/`BusinessMember` extras)
- `src/lib/__tests__/pipeline.test.ts` (data fix 2026-10-05 para 2026-09-29)

### Preservado / Deferido B3.1
- **Preservado:** nenhum modelo/banco/migration destrutiva; `BusinessMember`/`Professional`/`Service`/`Category`/`Availability` schemas intactos (extras opcionais apenas JSON); `Service`→`Professional` via `professionalIds`; `Availability` via `professionalId`; APIs `/api/team`/`/api/catalog` compatíveis; rotas `/produtos`/`/pedidos` e `/pagina` legadas; `TeamEditor`/`BusinessHours`/`MemberAccessSheet` não quebrados; `PanelRoutes` total ainda 22+ destinos.
- **Deferido:** Workflow+Permissões, Agenda Temporal 2.0 (drag-selection), Estoque/Farmácia, Google Calendar OAuth, Jev/LLM, templates médicos, nova entidade Person — não iniciados nesta PR (fila Master Plan §2).

---

## Fase B3.2 — PR #46 Equipe UX Closure + Contrato de Agenda/Serviço (2026-09-30)

**`P0 ESTRUTURAL CONCLUÍDO / EQUIPE UX CLOSURE + HOMOLOGAÇÃO EM ANDAMENTO / NÃO MERGEAR` — mesma PR #46, sem novo PR, sem merge.** Branch de trabalho `arena/01a0f3d3-instalink`.

### Decisões e implementação
- **Papéis como presets:** fluxo padrão = Administrador · Recepção (`SECRETARIA`) · Profissional; Proprietário como resumo `Proprietário · acesso total` (sem editor, não rebaixável); `ATENDENTE`/`VENDEDOR`/`VIEWER` em “Outros papéis / avançado” (enums e dados preservados). Preset da Recepção = Agenda, Clientes, Oportunidades, WhatsApp (antes incluía Visão geral e Pedidos). Preset do Profissional inalterado.
- **Overrides:** `src/lib/equipe-access.ts` (puro) — `minimalOverrides`, `overridesForOpenMember`, `applyRolePreset`, `editorPermissions`, `presetSummary`, `humanizePersonError`. Trocar papel aplica preset limpo (confirmação só com personalização real); override igual ao preset deixa de ser `ajuste`; Member legado é normalizado ao abrir (`GET /api/team` devolve overrides mínimos). `person-orchestration` normaliza overrides e zera ao trocar de papel; segurança do servidor (P0.2/P0.3) intacta.
- **Filtro de permissões:** com `GODOUTOR_LEGACY_PAGES` OFF, Página/Pedidos saem do editor; Assistente/Admin/Configuração só em “Capacidades avançadas” dentro de `Personalizar acesso` (recolhido).
- **Disponibilidade:** seguir ≠ apagar. `professional.hours(follow)`, `availability.applyToAll` e `person.save` preservam regras próprias; próprio sem regra → `Horário próprio ainda não configurado` + `Configurar horários` (deep link com `professionalId`); `BusinessHoursPanel` recebe `focusProfessionalId` e abre o editor só de quem usa horário próprio, com `Começar copiando o horário da clínica` (sem gravar antes de salvar). `dispMode` vale também na CRIAÇÃO (`own` → `followBusinessHours=false`, zero Availability; sem `dispMode` herda a clínica) — corrigido após homologação: a criação ignorava a escolha.
- **Erros do drawer:** bloco `role=alert` com scrollIntoView + foco, `aria-invalid` no primeiro campo inválido, `humanizePersonError` (sem Member/User/Professional/IDs).
- **Serviços:** busca com stem (`cardiologista` → `Consulta cardiológica`); sugestão inexistente abre confirmação com `Duração sugerida · N min` editável; manual exige duração (campo vazio); sugestões já existentes na clínica não são oferecidas (sem duplicar). `ServiceForm`: “Duração padrão para novos agendamentos”.
- **Documentação de contrato (sem código):** duração padrão × histórico do Booking, slot × duração × buffer, recursos, referências externas, spike/ADR da Agenda 2.0, requisito de escopo de dados para Workflow + Permissões — ver Master Plan §2.1–§2.5.

### Testes
- Novos: `src/lib/__tests__/pr46-equipe-ux.test.ts` (19), `src/components/__tests__/equipe-ux.test.tsx` (12, jsdom), `src/components/__tests__/business-hours-focus.test.tsx` (4, jsdom). Atualizados por mudança intencional: m8-permissoes, workspace, page-architecture, godoutor-clinical-convergence, p0-integridade-real, visual-convergence, p0-person-atomic.
- Suite completa: 2759 passed / 4 failed (baseline pré-existente: 3 Instagram + 1 automation audit; não corrigidos). `pr46-equipe-ux.test.ts` agora com 22 testes (inclui criação direta `own`/`follow`).
- Homologação em Chromium headless com login real: 47/47 em 1366 e em 1024; sanity 1440/390 (ver `docs/AUTO-HOMOLOGACAO-PR46-MODELO-OPERACIONAL.md`). Screenshots em `docs/homologacao-pr46-screenshots/`.

### Preservado / Deferido
- **Preservado:** enums de papel, PermissionIds, APIs, dados; nenhuma migração; P0.1–P0.3 e seus testes.
- **Deferido (fila Master Plan §2):** Workflow + Permissões (inclui escopo de dados do Profissional em Clientes/Visão geral/Atendimento), Agenda Temporal 2.0 (duração estável por Booking, override Profissional × Serviço, recursos), demais fases.

---

## Audits relacionados
- `docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md` — matriz completa 57 itens + decisões B1–B6 + B3-01–B3-10 + testes previstos
- `docs/GODOUTOR-CLINICAL-OS-V1.md` — especificação de arquitetura clínica (EventLog, DecisionEngine, GenerativeAIProvider, banco, segurança)
- `docs/GODOUTOR-UI-CONTRACT.md` / `GODOUTOR-UI-AUDIT-V2.md` — contrato visual e auditoria de fidelidade

---

## Histórico de PRs
- #43 — Design System 2.0 — mergeado
- #45 — Clinical Convergence (ramo `arena/godoutor-clinical-convergence`) — CONCLUÍDA, referência histórica
- #46 — Clinical Structure Consolidation + Architecture Closure (`arena/01a0eda6-instalink`) — CONCLUÍDA EM CÓDIGO / AGUARDANDO HOMOLOGAÇÃO E MERGE


## 2026-09-29 — Homologação Clinical UX Closure — continuação (0410e49+)

**Branch:** `arena/01a0eda6-instalink` · PR #46 OPEN — validação real contra Git.
**Closure:** Equipe `Gerenciar pessoa` unificado (DADOS/ATUAÇÃO + ACESSO + DISPONIBILIDADE) com Drawer único, largura Ações 170px sem overflow; deep-link Disponibilidade preservado; `Redes e site` oculto com `GODOUTOR_LEGACY_PAGES OFF`; `Como está a inteligência` removido da superfície clínica (estado/fetch mortos removidos, não movido nesta fase); Aparência extraída para `ShellAppearance` em Meu Perfil → Preferências (navegador, não tenant); Perfil copy técnica removida (`User`/`Professional`/IDs/`/profissionais` → linguagem produto + link `/equipe`); Estrutura `Modelos de anamnese` / “Crie e adapte fichas...” (sem prometer biblioteca); Serviços preservam `questions` legado (omitido no payload), preço opcional, Categorias Drawer com bloqueio; Master Plan registra Google Calendar (VISUAL) e repos `fullcalendar/fullcalendar`, `schedule-x/schedule-x`, `bigcalendar/react-big-calendar` para Agenda 2.0 + biblioteca futura F1 sobre motor existente.

**Validação:** (executado nesta missão — ver relatório) `typecheck` / `build` / `vitest` / `diff-check` + homologação visual 1440/1366/1024 (ou pendente se sem browser).
