# GODOUTOR CLINICAL CONVERGENCE — Auditoria Completa

> Data: 2026-09-29
> Branch: arena/godoutor-clinical-convergence (partindo de d20ed48)
> Flag: GODOUTOR_LEGACY_PAGES (OFF = Clinical OS padrão, ON = compatibilidade)
> Objetivo: transformar a experiência autenticada em Clinical OS veterinário e remover resíduos InstaLink/link-na-bio/site-builder que contaminam UI/copy/regras/defaults.

## Método

Varredura textual + semântica + comportamental em todo `src/` autenticado (rotas `(dashboard)/`, `components/dashboard`, `lib/`, `app/onboarding`, `app/api` relevante). Cada ocorrência classificada em A–E.

- **A. CLINICAL_OS** — conceito válido atual, manter
- **B. LEGACY_COMPATIBILITY** — necessário tecnicamente (dados/API/página/widget/deeplink/booking), mas não aparece no fluxo normal com flag OFF
- **C. LEGACY_UX** — copy/interface herdada que deve sair da experiência padrão
- **D. LEGACY_RULE** — regra comportamental antiga que restringe incorretamente o GoDoutor
- **E. DEFERRED_DOMAIN** — domínio futuro próprio, não improvisar nesta missão (Estoque/Farmácia, Internação, etc.)

> Rotas públicas (`/pagina`, `/[slug]`, `/agendar`, `/api/publico`, widget) são **B** por definição — preservadas fora da navegação operacional quando flag OFF.

---

## Matriz completa

| # | Arquivo | Ocorrência (antes) | Class. | Decisão | Impacto |
|---|---------|---------------------|--------|---------|---------|
| 1 | `src/app/(dashboard)/profissionais/page.tsx` — `PageHeader hint` | `"Quem atende no seu negócio. Cada pessoa pode ter agenda própria."` | **C** | Reescrever para clínica: `"Quem realiza os atendimentos da clínica. Cada profissional pode ter agenda própria."` | Copy clínica, remove "negócio" genérico |
| 2 | `src/app/(dashboard)/profissionais/page.tsx` — comentário `// distribuição dos agendamentos é automática` | Comentário afirmando distribuição automática universal | **D** | Remover comentário rígido; manter model operacional sem afirmação universal | Remove regra universal falsa |
| 3 | `src/app/(dashboard)/profissionais/page.tsx` — `SubCard` | `"<strong>A distribuição dos agendamentos é automática:</strong> o cliente nunca escolhe profissional..."` | **D + C** | **REMOVER** bloco rígido. Substituir por neutro: `"Os atendimentos são vinculados a profissionais conforme disponibilidade, vínculos com serviços e regras da agenda. A política de escolha por canal será definida no Workflow futuro."` + remarcar como informação operacional, sem prometer balanceamento automático | Fim da afirmação universal; gap explicitado |
| 4 | `src/app/(dashboard)/profissionais/page.tsx` — explicação curta | `"Profissionais são quem atende — a maioria não precisa de login."` | **A** | Manter (distinção Profissional≠Equipe correta) | Nenhum |
| 5 | `src/app/(dashboard)/servicos/page.tsx` — `PageHeader hint` | `"O que o seu negócio oferece — nomes, preços e detalhes."` | **C** | `"O que a clínica realiza e agenda — procedimentos, serviços e atendimentos com preço, duração e profissionais elegíveis."` | Clínica vs negócio genérico |
| 6 | `src/app/(dashboard)/servicos/page.tsx` — `EmptyState hint` | `"Cadastre o primeiro para exibir na página e receber agendamentos."` | **C** | `"Cadastre o primeiro para organizar a agenda e o atendimento. Serviços são o que a clínica realiza e pode registrar, agendar e cobrar."` | Remove "exibir na página" |
| 7 | `src/app/(dashboard)/servicos/page.tsx` — lista: `pricePublic` | `· preço oculto na página` exibido sempre | **C** (`showPrice` é **B** no banco) | Guardar com `legacyPagesEnabled && !pricePublic` | UX clínica não fala de página quando flag OFF; dado preservado |
| 8 | `src/app/(dashboard)/servicos/page.tsx` — lista: `bookable` | `'agendável' : 'somente exibição'` sempre | **C** (`bookable` é **A** operacional, mas rótulo `"somente exibição"` é **C**) | Guardar: `bookable ? 'agendável' : (legacyPagesEnabled ? 'somente exibição' : 'não agendável')` ou ocultar rótulo legível e manter badge clínico | Remove vitrine da operação |
| 9 | `src/app/(dashboard)/servicos/page.tsx` — lista: `featured` star | `sv.featured && <Icon star>` sempre | **C** (`featured` é **B**) | `legacyPagesEnabled && sv.featured` | Destaque é conceito de vitrine quando flag OFF |
| 10 | `src/components/dashboard/catalog-panels.tsx` — `ServiceForm` showPrice field | Já guardado com `legacyPagesEnabled &&` | **B→A** | **Manter** guard; adicionar nota operacional interna que preço sempre visível internamente | OK |
| 11 | `src/components/dashboard/catalog-panels.tsx` — `ServiceForm` pro selector hint | `"Sem seleção = todos os profissionais elegíveis. O cliente não escolhe — a distribuição é automática."` | **D** | `"Sem seleção = todos os profissionais elegíveis. O vínculo serviço↔profissional define quem pode realizar este serviço."` | Remove escolha rígida |
| 12 | `src/components/dashboard/catalog-panels.tsx` — `ServiceForm` checkboxes | `Ativo / Destaque / Aceita agendamento` — `Destaque` sempre visível | **C** (Destaque=vitrine) | Guardar `Destaque` com `legacyPagesEnabled`; `Ativo` renomear para `"Ativo na clínica"`; `Aceita agendamento` manter (operacional) | Clínica vs vitrine |
| 13 | `src/components/dashboard/catalog-panels.tsx` — `TeamEditor` checkbox | `Ativo (aparece na agenda e na página)` | **C** | `"Ativo (disponível para agenda)"` | Remove página |
| 14 | `src/components/dashboard/catalog-panels.tsx` — `TeamEditor` follow hint | `"Horário personalizado: edite em Disponibilidade."` | **A** | Manter (operacional) | — |
| 15 | `src/components/dashboard/catalog-panels.tsx` — `TeamEditor` label | Uses `followsBusinessHours` logic | **A** | Manter vínculo operacional | — |
| 16 | `src/lib/types.ts` — `Service.showPrice` | comentário `Visibilidade pública do preço...` | **B** | **Preservar** tipo/campo; documentar como legado | Dados não apagados |
| 17 | `src/lib/types.ts` — `Service.featured` | boolean sem guard documentado | **B** | **Preservar** campo; documentar como legado vitrine | Compatibilidade |
| 18 | `src/lib/types.ts` — `Service.bookable` | campo operacional | **A** | Manter, mas rótulo público é legado | Operacional válido |
| 19 | `src/lib/booking.ts` — header | `// O cliente NUNCA escolhe; o servidor resolve... "equilibrar equipe"` | **D** | Reescrever comentário: `"Atribuição de profissional é política interna, atualmente por menor carga no dia; cliente não escolhe via payload público — modos futuros plugam aqui."` Remove universal | Comentário não promete escolha automática universal |
| 20 | `src/lib/booking.ts` — `resolveProfessional` | `requested` ignorado para customer (ok), mas regra "menor carga" é **D** se apresentada como única verdade | **A/D** | Manter técnica (segurança: cliente não escolhe via payload), mas documentar como política atual, não regra universal; não expor como copy rígida | Preserva segurança sem prometer UX |
| 21 | `src/app/(dashboard)/configuracoes/page.tsx` — `BookingRules` distribuição block | `"O cliente nunca escolhe o profissional — a regra é interna do negócio..."` | **D + C** | Neutralizar: `"A atribuição de profissional é resolvida pela agenda conforme profissionais ativos, vínculos serviço→profissional, horários e buffers. Políticas por canal serão configuráveis no Workflow futuro."` Remove "negócio" e rigidez | Gap explicitado |
| 22 | `src/app/(dashboard)/configuracoes/page.tsx` — `BookingRules` título | `"Distribuição dos agendamentos — automática (fixa)"` + lock icon | **D** | `"Atribuição de profissional — política da agenda"` sem lock; remover ar de imutável | Não promete rigidez |
| 23 | `src/app/(dashboard)/configuracoes/page.tsx` — horizon label | `isLegacyPagesEnabled() ? 'Autoagendamento público (dias)' : 'Janela...'` | **C→B** | Manter ternário (já legado-aware) | OK |
| 24 | `src/app/(dashboard)/configuracoes/page.tsx` — header hint | já ternário: página vs clínica | **C→A** | Manter | OK |
| 25 | `src/app/(dashboard)/configuracoes/page.tsx` — `Dados da clínica` section | já ternário | **A** | Manter | OK |
| 26 | `src/app/(dashboard)/configuracoes/page.tsx` — `Editar página pública` button | `legacyPagesEnabled && <Link>` | **B** | **Manter** | Compatibilidade |
| 27 | `src/app/(dashboard)/disponibilidade/page.tsx` — header hint | `"Quando a casa e cada profissional podem atender — a base de tudo..."` | **C** ("casa" informal) | `"Quando a clínica e cada profissional podem atender — base da agenda. Profissionais podem seguir o horário da clínica ou ter agenda própria."` | Clínica terminology |
| 28 | `src/components/dashboard/BusinessHours.tsx` — títulos | `"Horário da empresa"` ×6 ocorrências | **C** | `"Horário da clínica"` em todo componente | Clínica vs empresa genérica |
| 29 | `src/components/dashboard/BusinessHours.tsx` — descrições | `"quem segue o horário da empresa"` ×N | **C** | `"quem segue o horário da clínica"` | Idem |
| 30 | `src/components/dashboard/BusinessHours.tsx` — badges | `"Segue a empresa" / "Personalizado"` | **C** | `"Segue a clínica" / "Horário próprio"` (usar `schedule.ts` constants) | Consistência |
| 31 | `src/lib/schedule.ts` — constants | `FOLLOW_BUSINESS_HOURS_LABEL = 'Seguir horário da clínica'` (já clínico) | **A** | Manter | Bom |
| 32 | `src/lib/schedule.ts` — comments | `"Horário da clínica" × "Horário da empresa"` mistos | **C** | Unificar comentários para clínica | Terminologia |
| 33 | `src/lib/schedule.ts` — `BUSINESS_SCOPE = ''` | constante técnica | **A/B** | Manter (interna) | — |
| 34 | `src/app/(dashboard)/estrutura/page.tsx` | `hint="O que a clínica oferece..."` | **A** | Manter | Bom hub |
| 35 | `src/app/(dashboard)/equipe/page.tsx` | distinção Profissional×Equipe | **A** | Manter | — |
| 36 | `src/app/(dashboard)/recursos/page.tsx` | já operacional quando flag OFF | **A** | Manter; já guarda `hint` via `resourceCopy` | OK |
| 37 | `src/app/(dashboard)/produtos/page.tsx` | vitrine copy já guardada por `legacyPagesEnabled` | **B/C→A** | Manter guards; header comment vitrine é documentação interna, não UX | OK |
| 38 | `src/app/(dashboard)/dashboard/page.tsx` — `"Presença online"` + `MiniTrendChart` + `pageStats` | `legacyPagesEnabled &&` guards já presentes | **B** (analytics legado) | **Manter** guards; quando OFF, zero KPI depende de visitas | OK, mas falta audit de `OperationalSetupPct` products label |
| 39 | `src/app/(dashboard)/dashboard/page.tsx` — `operationalChecklist` | mapeia `item.id === 'products' ? 'Revise dados legados de produtos'` quando OFF | **B→A** | Manter | OK |
| 40 | `src/app/(dashboard)/resultados/page.tsx` — Camada 2 página pública | `legacyPagesEnabled && pageTotals` guards | **B** | **Manter** | Analytics legado preservado mas separado |
| 41 | `src/app/(dashboard)/agente/page.tsx` — hint + msg | já ternário | **A** | Manter | OK |
| 42 | `src/app/onboarding/page.tsx` — `"Crie o seu negócio"` + `"Nome do negócio"` + `"Como sua empresa atende?"` | **C** (negócio/empresa genérico) | Quando flag OFF, usar clínica: `"Crie sua clínica"`, `"Nome da clínica"`, `"Como sua clínica atende?"`, hints sem vitrine (já parcial) | Vertical veterinária |
| 43 | `src/lib/onboarding.ts` — `SERVICE_MODEL_OPTIONS` hints | `"Vitrine de produtos com CTA..."`, `"na mesma página"` | **C** (page-builder) | Quando flag OFF, onboarding já sobrepõe hints operacionais (ok), mas `SERVICE_MODEL_OPTIONS` puro ainda carrega vitrine. Manter base legado, mas garantir UI consome override (já faz) | B preservado |
| 44 | `src/components/dashboard/HelpCenter.tsx` — `PATHS` inclui `/pagina` | Filter `legacyPagesEnabled \|\| p.href !== '/pagina'` já existe | **B** | Manter | OK |
| 45 | `src/components/dashboard/AccountMenu.tsx` — `"Ver página pública"` | `legacyPagesEnabled &&` guard já existe | **B** | Manter | OK |
| 46 | `src/components/dashboard/WorkspaceNavigation.tsx` — nav areas | `legacyPages: true` projection | **B** | Manter | OK |
| 47 | `src/app/(dashboard)/canais/page.tsx` — description | mention fontes/landing | **B/C** | Verificar não promete página como centro; já é operacional | — |
| 48 | `src/app/(dashboard)/tarefas` etc | sem resíduos vitrine | **A** | Manter | — |
| 49 | `src/lib/features.ts` — `disabledHint: 'A vitrine de serviços sai da página'` | **B** (usado em Recursos) mas sobrescrito por `operationalCopy` quando OFF | **B** | **Preservar** definição legada, mas UX usa `resourceCopy` | OK |
| 50 | `src/lib/dashboard.ts` — `productsPanel: 'Monte sua vitrine...'` | usado só via `operationalChecklist` mapping quando OFF | **B** | **Preservar** origem, mas consumo já mapeado | OK |
| 51 | `src/app/(dashboard)/configuracoes/page.tsx` — BookingRules "Antecedência mínima" etc | Campos operacionais | **A** | Manter | São regras reais da agenda |
| 52 | `src/lib/panel.ts` — `section oferta: 'Clínica'` labels | Já clínico | **A** | Manter | OK |
| 53 | `src/app/(dashboard)/agenda/page.tsx` — grade, frase "destaque de arraste" | "destaque" aqui é técnico (drag highlight) não vitrine | **A** | Manter | Falso positivo |
| 54 | `src/components/public/*` — showcase, sheet-bus, customer, widgets | **B** | **Preservar** integral, não tocar | Legado público |
| 55 | `src/app/[slug]/page.tsx`, `src/app/agendar/page.tsx`, `src/app/widget/*`, `src/app/api/bookings`, `src/app/api/catalog` | **B** | **Preservar** | Booking público |
| 56 | `src/lib/clinic-presets.ts` — `pageSuggestion` | **B** (sugestão de blocos de página) | **Preservar** como legado, mas não é UX operacional | Compatibilidade |
| 57 | `src/lib/product.ts` — flag definition | **A** | Manter | Fronteira |

## Resíduos semânticos que permanecem como compatibilidade (flag ON)

- Editor `/pagina` (`src/app/(dashboard)/pagina/page.tsx`) inteiro: hero, blocos, navegação pública, Sobre, publicação — **B**, fora do redesign, preservado atrás da flag.
- Página pública `/[slug]` + renderer: **B**.
- APIs públicas `/api/pages`, `/api/bookings` (customer flow), widget `interna.js`, analytics `/api/analytics`: **B**.
- Campos `Business.nav`, `navItems`, `about`, `published`, `theme`: **B** (persistidos, UI operacional não depende).
- `Service.showPrice`, `featured`, `bookable` no banco: **B** (UI operacional ignora quando OFF).
- `Product` + `Category` legado: **B** (dados preservados, UI remove semântica vitrine quando OFF).
- `Business.socials` / page navItems: **B**.

## Dívida deferida (E) — não improvisada nesta missão

- **Estoque/Farmácia**: Produtos não é estoque; lote/validade/movimento/fornecedor/saldo/stock mínimo não implementados. Documentado em Produtos flag OFF.
- **Internação/Cirurgia/Procedimentos longos**: Agenda Temporal 2.0 (drag-selection, start/end, recursos sala/equipamento) — deferido, não implementado.
- **Prescrição/Exames/Document Engine**: F2, deferido.
- **Matriz completa de permissões/Workflow**: capability matrix, máquina de estados agendamento (scheduled→arrived→in_care→finalized), check-in/falta/cancelamento — próxima missão própria.
- **Recursos de agenda** (sala, equipamento): deferido até Agenda 2.0.

## Regras corrigidas nesta missão (D→A)

1. **Profissional distribuição automática universal REMOVIDA** — não afirmar que cliente nunca escolhe nem que agenda sempre equilibra.
2. **Serviço "preço oculto na página"/"somente exibição"/"destaque" REMOVIDOS** da operação padrão (flag OFF).
3. **"Ativo (aparece na agenda e na página)" REMOVIDO** → "Ativo (disponível para agenda)".
4. **"O cliente não escolhe — distribuição automática" REMOVIDO** do selector de vínculo.
5. **Configurações → BookingRules lock rígido REMOVIDO** → política neutra + gap Workflow.
6. **Terminologia "empresa/negócio/casa" → "clínica"** em Profissionais, Serviços, Disponibilidade, BusinessHours, Onboarding (quando aplicável).

## Testes de regressão planejados

1. Flag OFF: nenhum texto visível padrão contém "página pública"/"vitrine"/"preço oculto na página"/"somente exibição"/"aparece na página" nos módulos auditados (profissionais, servicos, configuracoes, disponibilidade, estrutura, equipe, recursos, dashboard operacional).
2. Profissionais não afirma distribuição obrigatoriamente automática.
3. Serviço não mostra opções públicas/legadas quando flag OFF (showPrice/featured/Destaque guard).
4. Flag ON: compatibilidade antiga renderizável (editor, página pública, showcase) continua.
5. Equipe≠Profissional distinção preservada.
6. Serviço↔Profissional vínculo por IDs reais (eligibleProfessionalIds).
7. Tenant isolation não regrediu.
8. Booking/agenda não regrediu.
9. Nenhuma migration destrutiva; dados preservados.
10. Rotas públicas compilam (`/pagina`, `/[slug]`, `/agendar`, `/api/bookings`, `/api/pages`).

---

# Decisão de migração

- Nenhuma migration destrutiva.
- Campos legados permanecem no JSONB `instalink_doc` via `db.ts`.
- `Product`/`Service.showPrice/featured/bookable`: preservados.
- `Business` page fields: preservados.


---

# CLINICAL STRUCTURE CONSOLIDATION — 2026-09-29

> Branch: `arena/01a0eda6-instalink` → consolidação (PR #46)
> Missão: convergir estrutura para SaaS de clínica coerente, centralizado, sem duplicidade — Equipe/Profissionais, Serviços clínico, Configurações como cadastro institucional.
> Decisão transversal: em dúvida, privilegiar **sistema operacional de clínica**, nunca página pública/vitrine.

## Método desta consolidação

Varredura focada em `src/app/(dashboard)/{equipe,profissionais,servicos,produtos,disponibilidade,estrutura,configuracoes,dashboard}` + `src/components/dashboard/catalog-panels.tsx` + `src/lib/panel.ts` + `src/lib/types.ts` + `src/app/(dashboard)/produtos` etc. Cada ocorrência classificada A-E como antes, com decisões B1-B6 abaixo.

## Decisões de Arquitetura (B1-B6)

### B1) UNIFICAÇÃO EQUIPE × PROFISSIONAIS

| Item | Antes | Class. | Decisão | Consequência |
|------|-------|--------|---------|--------------|
| EQP-01 | `/equipe` (admin, quem tem login) e `/profissionais` (quem realiza atendimento) como telas de mesmo peso no menu, com listas e ações duplicadas | **C/D** (duplicidade conceitual expõe incoerência) | **Equipe como fonte única de gestão de pessoas.** `/profissionais` deixa de ser rota autônoma de peso: passa a **redirect 307 + wrapper compatível** para `/equipe?b=...#profissionais` (mantém link antigo válido). Todo CRUD de Professional migra para **Equipe** via `TeamEditor` integrado. | Navegação 1 porta, 1 verdade. Link antigo não quebra (redirect). Teste de guard: `/profissionais` continua resolvendo mas sem ocupar menu. |
| EQP-02 | `panel.ts: /profissionais` → `sidebar:true, section: operacao` | **C** | `sidebar:false`, `description: "Redireciona para Equipe — gestão unificada de pessoas. Compatibilidade com links antigos."` + mantém `permission: catalogo` para guard não regredir | Menu mostra só **Equipe**. Atalho `/profissionais` continua acessível por URL e redireciona. |
| EQP-03 | `equipe/page.tsx` só lista Members + "Profissionais sem acesso" como card secundário (sem editar foto/role/agenda própria) | **C** | Equipe passa a **carregar catálogo completo** (`/api/catalog/get` para professionals/availability) e renderizar **TeamEditor completo** inline: criar/editar nome, função/cargo, foto, ativo, seguir horário da clínica vs horário próprio, vínculo agenda, exclusão/desativar, gerenciar/criar acesso. Profissional é atributo clínico de uma pessoa (pode ou não ter login). | Pessoa cadastrada em 1 lugar: dados acesso + papel + status + função + identificação + se atende + vínculo agenda + serviços elegíveis (via Serviços). Zero manutenção dupla. |
| EQP-04 | `profissionais/page.tsx` com copy dedicada e gestão isolada | **C** | Transformado em **Client Redirect Wrapper**: `useEffect(() => router.replace('/equipe?b=...'))` + fallback `<Link>`; mantém `DeleteSheet/MemberAccessSheet` removidos daqui (vivem em Equipe agora). Preserva `area: profissionais` para audit, mas UI não é mais duplicada. | Remove duplicidade, preserva dados/fluxos (Professional types, /api/catalog não muda). |
| EQP-05 | Conceitos Team vs Professional confundidos em help texts | **A** | Manter distinção documentada em Equipe: **Equipe = quem entra no sistema** (contas/papéis) vs **Profissional = atributo clínico de quem realiza atendimento** (pode existir sem login). UI explica em 1 linha + badges "Acesso ativo/Sem acesso". | Clareza sem duplicidade. |

### B2) DISPONIBILIDADE — manter separada, auditar copy

| Item | Antes | Class. | Decisão | Consequência |
|------|-------|--------|---------|--------------|
| DISP-01 | hint "Quando a casa e cada profissional..." (já migrado para clínica na fase anterior) | **A** (já clínico) | **Manter como tela separada** nesta missão. Apenas confirmar copy clínica e ponte contextual para Regras de reserva em Configurações. Nenhum unificação com Equipe agora (deferido). | Disponibilidade segue hub separado, sem retrabalho Agenda Temporal 2.0. |
| DISP-02 | Comentário "fuso do negócio" (interno, não UI) | **A** (interno) | Manter terminologia interna técnica; UI já "Fuso horário da agenda" clínica. | Sem mudança visível. |

### B3) SERVIÇOS → modelo clínico operacional

| Item | Antes | Class. | Decisão | Consequência |
|------|-------|--------|---------|--------------|
| SVC-01 | `Service.image` + `<ImageUpload label="FOTO DO SERVIÇO">` + `<img>` na lista | **C** (vitrine/página) | **REMOVER da UI completamente.** Campo `image` preservado no tipo/banco (B), mas **nunca renderizado nem editado** em Serviços. Lista usa avatar inicial (1 letra) `bg-[var(--surface-2)]`. | Fim de "foto de serviço" como vitrine. Dados legados não apagados, mas não poluem UI clínica. |
| SVC-02 | `showPrice` checkbox "Mostrar preço na página pública" + helper texto | **C** | **REMOVER.** Preço é operacional/administrativo sempre visível internamente. | UI clínica não fala de página. `showPrice` permanece no DB compatível, ignorado. |
| SVC-03 | `featured` star + checkbox "Destaque" | **C** | **REMOVER.** Destaque é conceito de vitrine. | Estratégia de vitrine sai do clinical OS. Campo permanece DB. |
| SVC-04 | Lista: `pricePublic` ("· preço oculto na página") + ternário `bookable ? 'agendável' : 'somente exibição'` + star | **C** | **REMOVER variação pública.** Linha passa a: `R$ 990,00 · 45 min · Realizado por: ...` + badges operacionais `Ativo/Inativo` + `Agendável/Não agendável` (sem "somente exibição"). | Léxico operacional puro. `bookable` operacional mantido, `featured`/`showPrice` ignorados visualmente. |
| SVC-05 | Form: categoria + perguntas na reserva com copy pública | **C** | Categoria placeholder já clínico `Ex: Consulta, Vacina, Exame` (manter). `PERGUNTAS NA RESERVA` → `Perguntas no agendamento (opcional, até 3)` + placeholders clínicos `Ex: Pet em jejum? Alergias? Convênio?` + helper "Respostas aparecem no agendamento e no atendimento." | Categoria interna/clínica, perguntas em contexto agendamento, não "página". |
| SVC-06 | Duração hint genérica | **A→A** | Reforçar `DURAÇÃO (MIN)` com subtexto `Base da agenda — duração sugerida, não trava encaixe/ordem de chegada/cirurgia longa.` | Explicita que duração não é trava rígida (regra produto). |
| SVC-07 | Preço base hint ausente | **A** | Adicionar helper `Valor operacional — referência para financeiro/relatórios e futura comissão/repasse.` | Preço ancorado como admin, não vitrine. |
| SVC-08 | Visual: cards isolados `space-y-2.5` + `rounded-lg p-4` individuais | **C** (fora do padrão Equipe/Produtos) | **Converger para padrão lista: card container único `bg-white border` + header `bg-zinc-50` + `divide-y divide-zinc-100` + `hover:bg-zinc-50`**. Mesma anatomia de Equipe/Produtos. | Coerência visual do módulo clínica: listas em container único, linhas internas. |
| SVC-09 | Empty/hint vitrine textual | **C** | Já tratado na convergência anterior (`isLegacyPagesEnabled` branch), agora unificado para clínica puro: `Nenhum serviço ainda — Cadastre o primeiro para organizar a agenda e o atendimento.` + sem menção a página. | Remove "exibir na página". |
| SVC-10 | `Category` kind `service` legado com menção vitrine em `features.ts` | **B** | Manter tipo/categoria, mas disabledHint em Recursos já sobreposto por `resourceCopy` clínico. Nada destrutivo. | Compatível. |

### B4) CONFIGURAÇÕES → cadastro institucional da clínica

| Item | Antes | Class. | Decisão | Consequência |
|------|-------|--------|---------|--------------|
| CFG-01 | Aba "Clínica" (ex "Negócio") com `Dados da clínica` → Nome, email, descrição, logo + `Contato e redes` → WhatsApp/telefone/Instagram/TikTok/Facebook etc + `Endereço` → address + mapsUrl + `Página pública` pointer (quando flag ON) | **C** (semântica link-na-bio, redes como protagonistas, sem dados institucionais formais) | **Reescrever como formulário institucional centralizado (max-w-3xl mx-auto).** Nova estrutura em **seções visuais únicas, não tabs adicionais**: **(1) Dados da clínica** (nome clínica, nome fantasia opcional, CNPJ/CPF opcional, email principal, telefone/WhatsApp, endereço, cidade/estado/CEP, link mapa), **(2) Responsável** (nome responsável, documento, registro profissional CRMV/CRM etc, função/cargo), **(3) Operação/Agenda** (aponta para aba Agenda existente — regras mantidas — sem duplicar), **(4) Identidade visual** (logo + aparência), **(5) Canais e integrações** (ponte secundária para `/canais`, não protagonista). Redes sociais (`socials`) movidas para secundário com helper reduzido. | Semântica clínica institucional. Campos novos `fantasyName/document/city/state/zip/responsible*` são **aditivos opcionais** em `Business` (tipo + API whitelist) — nada destrutivo, `undefined` ⇒ não grava. Endpoints antigos continuam aceitando `name/email/...`. |
| CFG-02 | Redes sociais como protagonistas no fluxo central | **C** | Rebaixar para **seção secundária colapsada por padrão** (`<details>` ou card discreto) com título "Redes e site (opcional — secundário)" + placeholders reduzidos, sem mencionar página pública como centro. | Agenda/institucional volta ao protagonismo. Dados sociais preservados, mas não poluem. |
| CFG-03 | Hint "As informações do seu negócio..." quando flag ON | **C** | Unificado para `"Cadastro institucional e operacional da clínica."` independente de flag; flag ON mantém compat externa mas não muda semântica institucional. Header centralized `max-w-3xl mx-auto` para anatomia institucional. | Coerência clínica. |
| CFG-04 | Tabs mantidos `negocio/agenda/aparencia` | **A** | Manter tabs existentes (não criar novas abas desnecessárias), mas **conteúdo da aba Clínica centralizado** e visual institucional. Agenda tab preservada (BookingRules). Aparência preservada (preferência pessoal). | Menos tabs, mais clareza. |

### B5) PADRONIZAÇÃO VISUAL

| Item | Decisão |
|------|---------|
| Visão | **Formulários institucionais centralizados** (`mx-auto max-w-3xl`, card branco, espaçamento consistente). **Listas de gestão em container único + linhas** (Equipe já referência). **Workspaces amplos apenas onde necessário** (Agenda, Atendimento). |
| Equipe | Mantida como referência positiva (container único, header, divide-y, hover). Agora também contém **Profissionais unificados** no mesmo padrão. |
| Profissionais | Converge para Equipe (redirect) — mesmo padrão por herança. Não mais card isolado. |
| Serviços | Migra de `space-y-2.5` cards isolados para container único + header + divide-y (mesmo de Equipe/Produtos). Remove foto, destaque, preço oculto. |
| Configurações | Centralizada (`mx-auto max-w-3xl`), anatomia de formulário institucional (seções empilhadas, labels uppercase, `input` consistente, helper 11px). |
| Estrutura | Revisar para coerência: já usa `Card` grid 2 col; manter, apenas alinhar copy "quem realiza" já clínica. |
| Disponibilidade | Manter, mas garantir copy clínica já feita; sem rework visual maior. |
| Produtos | Manter coerência com operação clínica enquanto existir (container único já correto; copy já guardada). |

### B6) VARREDURA RESÍDUOS INSTALINK/PÁGINA PÚBLICA

| Símbolo | Onde estava | Decisão |
|---------|-------------|---------|
| "vitrine"/"Vitrine de produtos" | Serviços (foto, preço oculto, destaque), Produtos title/hint quando flag OFF já guardado, mas Serviços ainda exibia foto/star/preço oculto | **Removido de Serviços completamente**; Produtos mantém guard mas já clínico quando OFF. Nenhum "vitrine" deve aparecer em fluxos clínicos padrão. |
| "página pública" | Serviços hint, ServiceForm checkbox, BookingRules hint, Config header, etc. | **Removido de fluxos clínicos**; quando necessário técnico (compat), atrás de `isLegacyPagesEnabled()` ou removido. Serviços/Equipe/Configurações institucionais não mencionam página. |
| "negócio" quando deveria ser clínica | Disponibilidade fuso comment interno ok, mas copy institucional já migrada; varredura confirma nenhum "negócio" em PageHeader/hints clínicos restantes. | **Migrado para "clínica"** em todas as surfaces tocadas; `Business` interno permanece termo técnico (não UI). |
| "preço na página"/"preço oculto na página" | Serviços lista + ServiceForm | **Removido** (SVC-04/02). |
| "cliente escolhe profissional"/"distribuição automática universal" | Profissionais hint já neutralizado na fase anterior; `api/bookings` comment ajustado; `widgets2` interno preservado como regra técnica atual, mas não exposto como promessa universal na UI clínica | **Mantido técnico interno**, removido como promessa de UI. |
| "link na bio" | Não encontrado nas routes clínicas (apenas docs/marketing) | Confirmado ausente. |

## Itens preservados por decisão de produto (B)

- Rotas públicas `/pagina`, `/[slug]`, `/agendar`, `/api/pages`, `/api/bookings`, widget, showcase, `Business` page fields, `Service.image/showPrice/featured` no DB, `Product` legado, `socials/nav` — preservados para compatibilidade atrás de flag, não expostos no fluxo clínico padrão.
- `Disponibilidade` permanece separada (não unificada com Equipe) por escopo.
- `Produtos` mantido coerente operacionalmente enquanto existir, sem transformar em Estoque/Farmácia (deferido).

## Deferido para próxima fase (E) — não improvisado

- Estoque/Farmácia (lote, validade, movimento, fornecedor, saldo): Produtos continua não sendo estoque.
- Agenda Temporal 2.0 (drag-selection, start/end, bloqueios, cirurgia longa, recursos sala): deferido.
- Workflow + Permissões matrix completa / máquina de estados agendamento: próxima fase (Papéis, capabilities, check-in/falta/cancelamento).
- Atendimento → Prontuário estruturado completo / Prescrição/Exames.
- Recursos sala/equipamento.

## Testes & validação previstos

- Unificação: `/profissionais` redireciona para `/equipe`; `/equipe` contém gestão completa de profissionais; menu mostra só Equipe; catálogo guarda `catalogo` para `/profissionais` continua (redirect) sem quebrar guard.
- Serviços: sem `ImageUpload` de foto, sem `showPrice/featured` na UI, preço + duração com helpers clínicos, perguntas com copy clínica, lista em container único com header, sem "vitrine"/"página pública"/"preço oculto"/"somente exibição".
- Configurações: formulário institucional centralizado (`max-w-3xl mx-auto`), seções Dados da clínica / Responsável / Endereço+Contato secundário, sem protagonismo de redes/página pública.
- Typecheck / build / focal tests (`godoutor-clinical-convergence`, `godoutor-structure-consolidation`, `a12-block3`, `legacy-page-operational-surfaces`) / `git diff --check` / suite baseline (5 fails conhecidos preservados).


---

# CLINICAL ARCHITECTURE CLOSURE — B3 — 2026-09-29 — **CONCLUÍDA**

> Branch: `arena/01a0eda6-instalink` (PR #46 · não mergear — simples por padrão, capaz de crescer. Validado 2026-09-29)
> Missão: fecho da arquitetura clínica — Equipe unificada (lista única sem duplicação owner, porta única), Disponibilidade separada (QUEM × QUANDO), Configurações desacoplada com DTO seguro, agenda operacional limpa, institucional e hub coerentes.

## Método B3

Varredura focada em `src/app/(dashboard)/{equipe,configuracoes,disponibilidade,estrutura,servicos,produtos}` + `src/components/dashboard/{catalog-panels,BusinessHours}` + `src/lib/{types,panel,schedule,booking-ops}` + `src/app/api/businesses/[id]/route.ts`. Cada ocorrência re-classificada A-E, decisões B3-01..B3-10 abaixo. Nenhuma migration destrutiva; nenhum novo modelo Person.

## Decisões B3

### B3-01) EQUIPE — experiência unificada (Member × Professional continuam tabelas distintas)

| Item | Antes | Class. | Decisão B3 | Consequência |
|------|-------|--------|------------|--------------|
| EQP-06 | `equipe/page.tsx` ainda listava 3 blocos: `Pessoas com acesso` (tabela Member) + `Profissionais sem acesso · N` (cards duplicados) + `TeamEditor` abaixo com *sua própria* lista Profissionais (grid Profissional/Agenda/Acesso). Visitante via 2 listas + header duplicado. | **C** (duplicidade) | **Uma lista-unificada** `Pessoas da clínica · N` — grid `Pessoa / Função·Papel / Atendimento / Agenda / Acesso / Ações` em `divide-y` via `src/lib/equipe-unified.ts:buildUnified`. Cada pessoa aparece 1×: `owner + members×professional + soloProfessionals` com **deduplicação owner+professional mesmo `userId` = UMA linha** (owner veterinário mostra `Proprietário + Atende + Agenda` na mesma linha; teste `equipe-unified.test.ts` cobre 6 cenários). Member (BusinessMember=acesso) e Professional (atende) continuam tabelas separadas; combos válidos A-D preservados. **Porta única de criação** `+ Adicionar pessoa` → chooser Design System “O que esta pessoa fará na clínica?” → (A) Ter acesso → `MemberAccessSheet` / (B) Realizar atendimentos → `TeamEditor` via `equipe:create-professional`; bloco “Profissionais + botão Profissional” removido da superfície (`TeamEditor` agora `hideList`+`hideTrigger` + listeners `edit/create`). Edição: `Gerenciar` (member) vs `Criar acesso`+`Editar` (solo). | Uma verdade para equipe; sem Person nova, sem migration; vínculo `Member↔Professional` preservado; `+ Adicionar pessoa` é primário. Deferido para Workflow: criação atômica única quando multiplicidade crescer. |
| EQP-07 | Botão header `Adicionar membro` | **C** (jargão de permissão, não pessoa) | Renomeado para **`+ Adicionar pessoa`** (primário) e transformado em **chooser único** (Drawer) com 2 cartões: acesso vs atendimento — reutiliza `MemberAccessSheet` e `TeamEditor` sem segunda porta visual. | Linguagem clínica simples por padrão, capaz de crescer. |
| EQP-08 | `catalog-panels:TeamEditor` com lista interna obrigatória + botão sempre visível | **C** | Adicionado props `hideList` + `hideTrigger` — quando `true` (uso em Equipe unificada) não renderiza lista nem botão “Profissional”; criação/edição via eventos `equipe:create-professional`/`equipe:edit-professional` (`useEffect` listeners) disparados pelo chooser/linha. | Permite Equipe hospedar lista única e porta única sem duplicar. |

### B3-02) DISPONIBILIDADE — QUEM vs QUANDO (mantida separada)

| Item | Antes | Class. | Decisão |
|------|-------|--------|---------|
| DISP-03 | `disponibilidade/page.tsx:15` comentário `quando a casa e cada profissional podem atender` | **C** ("casa" informal) | `quando a clínica e cada profissional podem atender` |
| DISP-04 | `disponibilidade/page.tsx:109` comentário `Horário da empresa` | **C** | `Horário da clínica` |
| DISP-05 | `panel.ts:/disponibilidade` description `Quando a casa e cada profissional...` + comment | **C** | `Quando a clínica e cada profissional...` (description + comment) |
| DISP-06 | `BusinessHours.tsx` já clínico | **A** | Confirmado: `Horário da clínica`, `Segue a clínica` — mantido. Disponibilidade continua hub separado (não fundida com Equipe). Deep-link contextual `Gerenciar disponibilidade` mantido em `BookingRules` (Configurações→Agenda) e `CatalogCrossLinks`. | Agenda Temporal 2.0 deferida — QUEM (Equipe) × QUANDO (Disponibilidade) permanecem domínios separados, com ponte apenas. |

### B3-03) CONFIGURAÇÕES — desacoplar cadastro institucional do domínio Página

| Item | Antes | Class. | Decisão |
|------|-------|--------|---------|
| CFG-05 | `configuracoes/page.tsx:load` via `apiGet('/api/pages?businessId=')` com `requireBusiness(...,'pagina','config')` — Configurações dependia do domínio Page para CRUD business. | **D** (acoplamento indevido) | **Novo endpoint canônico** `GET /api/businesses/[id]` (tenant-safe `requireBusiness(req,id,'config')` → `{business: DTO}`) em `src/app/api/businesses/[id]/route.ts` (DTO em `src/lib/business-config-dto.ts` com **whitelist explícita** `BUSINESS_CONFIG_DTO_FIELDS` e helper `toBusinessConfigDTO` — retorna SOMENTE id/name/fantasyName/document/description/logo/phone/whatsapp/email/address/city/state/zip/mapsUrl/responsibleName/responsibleDocument/responsibleRegistry/responsibleRole/instagram/tiktok/socials/booking/appearance/businessTimezone; **nunca** `googleApiKey`, `pixKey`, `whatsappIntegration.encryptedAccessToken` etc. Teste `business-config-dto.test.ts` prova segredos ausentes. `configuracoes/page.tsx` passa a `apiGet('/api/businesses/${businessId}')` — domínio Business direto. `/api/pages` preservado (GET requer `['pagina','config']`) para compat Página. |
| CFG-06 | Helper logo `A capa da página pública, quando usada, é editada em Página → Perfil.` visível mesmo com flag OFF | **C** | Gating: `{legacyPagesEnabled ? ' A capa...' : ''}` — só quando `GODOUTOR_LEGACY_PAGES=1`. Mesma ponte `Canais & Integrações → /canais` e `Página pública → /pagina` já `legacyPagesEnabled && <section>` |
| CFG-07 | ` fantasyName/document/city/state/zip/responsible* ` já adicionados em B2 | **A** | Mantidos; redes sociais já secundárias `<details>` "Redes e site (opcional — secundário)". Sem nova tabela. |

### B3-04) CONFIGURAÇÕES → Agenda — classificar BookingConfig por consumo real

| Campo | Consumo real auditado | Class. B3 | Exposição com flag OFF | Exposição com flag ON |
|-------|-----------------------|-----------|------------------------|-----------------------|
| `leadMin` | `grade`,`slots` (disponibilidade), `booking-ops`, `agendar` (grade) — vale para agenda interna **e** pública | **SHARED_CAPACITY (grade)** | Visível — header `ANTECEDÊNCIA MÍNIMA` helper "Vale para agenda interna e pública (grade)." | Idem |
| `bufferMin` | `bufferMin` em `booking-ops/slots` — intervalo físico/temporal capacity | **SHARED_CAPACITY** | Visível — `INTERVALO ENTRE ATENDIMENTOS — Buffer físico/temporal — vale para ambos` | Idem |
| `horizonDays` | `src/lib/booking-ops.ts:33` comentário `horizonDays é exclusivamente a janela pública` + `src/lib/agendar.ts:53 publicHorizonDays` | **PUBLIC_BOOKING (exclusivo)** | **Ocultado** (só `{legacyPagesEnabled && <> cancelUntilMin + horizonDays </>}`) + nota "Regras exclusivas de autoagendamento público ficam preservadas e aparecem apenas quando GODOUTOR_LEGACY_PAGES ligado" | Visível com sufixo "— público", helper "Janela máxima que o cliente vê no autoagendamento. Equipe pode agendar até 5 anos." |
| `cancelUntilMin` | `src/app/api/customer/bookings/route.ts:80` (customer cancel) — só cliente self-cancel | **PUBLIC_BOOKING** | Ocultado (mesmo guard) — helper "Limite de cancelamento pelo cliente no autoagendamento. Equipe cancela sem limite interno." | Visível com sufixo "— público" |
| `teamMode` | legado `solo/choosable/auto` (vitrine) | **LEGACY** | Nunca exposto como input; substituído por bloco `ATRIBUIÇÃO DE PROFISSIONAL / Política da agenda` neutra (texto Workflow futuro) | Idem |

Header `Regras de reserva` mantido (teste `panel.test.ts:596`), descrição tornada clínica com ternário: OFF → "Como a agenda funciona: antecedência e intervalos da operação interna. Quando a clínica e cada profissional atendem se configura em Disponibilidade." + nota legacy; ON → "Como o cliente pode reservar: prazos e limites do autoagendamento público. Para operação interna, antecedência e intervalo valem para todos; equipe pode agendar até 5 anos." `hasTeam` block já neutro (`Política da agenda`).

### B3-05) CADASTRO INSTITUCIONAL

| Item | Decisão |
|------|---------|
| INST-01 | Verificar `fantasyName/document/city/state/zip/responsible*` já em `Business` (B2) — mantidos. Copy "capa da página pública" gated (CFG-06). Redes secundárias mantidas `<details> Redes e site (opcional — secundário)`. Sem novos campos. |

### B3-06) SERVIÇOS — preço base operacional + duração base sugerida

| Item | Decisão |
|------|---------|
| SVC-11 | `price` permanece **operacional** (base financeiro/relatório/futura comissão) — helper "Valor operacional — referência para financeiro..." (B2). `durationMin` = **duração base sugerida — não trava encaixe/cirurgia longa** (helper B2). `bookable/perguntas` permanecem operacionais. Perguntas no agendamento mantidas (copy clínica `Sugestão da agenda`, `PERGUNTAS NO AGENDAMENTO` em `catalog-panels.tsx:questions`) — consumidor `Service.questions` e `ServiceForm` é operacional (aparece no agendamento/atendimento), não só página pública, logo **não ocultada**; vitrine/photo/showPrice/featured já removidos. Validado que `produtos/page.tsx` mantém vitrine só quando flag ON, serviços nunca. |

### B3-07) ESTRUTURA como hub (sem duplicar CRUD)

| Item | Antes | Decisão B3 |
|------|-------|------------|
| EST-01 | Grid 4 cards: `Serviços / Profissionais (→/profissionais) / Horários / Acessos` + `Fichas de anamnese` | `Profissionais` → **`Equipe — Pessoas da clínica`** com métrica unificada `X atendem · Y com acesso` + hint `N pessoas no total · M membros ativos` e links `→/equipe` (antes `/profissionais`). `Acessos` → **`Cadastro da clínica`** (completude `filled/total campos` dos 7 institucionais + tone success/brand/warning → `/configuracoes`). Serviços mantém `servicesActive de N`. Horários mantém `clinicWeekdays + customProCount`. Fichas permanece. Hub mostra **Equipe X persons Y atendem, Serviços N ativos, Disponibilidade status, Cadastro completeness** — sem inline CRUD, só links. |

### B3-08) panel.ts METADATA cleanup

| Item | Antes | Decisão |
|------|-------|---------|
| PANEL-01 | `disponibilidade.description` + comment continham "Quando a casa..." | `Quando a clínica e cada profissional podem atender...` |
| PANEL-02 | Outras descrições auditadas: nenhum "cliente nunca escolhe", "distribuição automática", "o que ofereço" solto em operationalFile quando OFF — já clínicos | Confirmado; nenhuma ocorrência solta (teste `Flag OFF: nenhum texto...` passa). |

### B3-09) PENDÊNCIAS — definição

`Pendência` = ação humana acionável agora/janela curta (ex: retorno vencido, chegada sem atendimento, tarefa próxima). `EventLog` (DomainEventStore) → `Pendência` (projeção operacional) → `Agenda Operational Strip`. Tarefas futuras (ex: "Preparar atendimento daqui 30 dias") existem no banco como `tasks` com `dueAt` futuro, mas **não emergem** na strip/fila principal até janela acionável. Concluídas saem da fila e vão para histórico filtrado. Planejamento: sem novo modelo; `EventLog` já exige `businessId` (tenant isolation). Não implementado nesta PR — documentado para Workflow.

### B3-10) ESCALA & PRODUTOS

- **Solo/small clinic default:** Equipe funciona com 1 pessoa (owner) — lista unificada mostra `1 pessoas · 0 atendem` sem exigir membros/profissionais; Serviços funciona com 0-1 serviço; Disponibilidade com 0 dias mostra "Não configurado".
- **Produtos ≠ Estoque:** `src/app/(dashboard)/produtos/page.tsx` já declara explicitamente `Este módulo não movimenta estoque, registra vendas ou controla dispensação` (flag OFF), e mantém vitrine só quando ON — deferido domínio Estoque/Farmácia (lote, validade, saldo).

## Alterado em B3 (final — com blockers corrigidos)

- `src/lib/business-config-dto.ts` — novo **DTO seguro** (`BUSINESS_CONFIG_DTO_FIELDS` + `toBusinessConfigDTO`) + `src/app/api/businesses/[id]/route.ts` — `GET` com `requireBusiness` → `{business: DTO}` (importa DTO, nunca retorna bruto)
- `src/app/(dashboard)/configuracoes/page.tsx` — `load` para `GET /api/businesses/[id]`, gating helper capa + página pública section, audit BookingRules (shared vs public guard, helper clínicos, nota legacy, `Política da agenda` preservado, `legacyPagesEnabled` importado)
- `src/app/(dashboard)/equipe/page.tsx` — projeção `unified` via `src/lib/equipe-unified.ts:buildUnified` (owner+professional dedup), grid 6 cols `Pessoa/Função·Papel/Atendimento/Agenda/Acesso/Ações`, **chooser único** `Adicionar pessoa` (Drawer “O que esta pessoa fará?”), `followsBusinessHours` importado, sem duplicação, sem segunda porta Profissionais
- `src/lib/equipe-unified.ts` — novo helper central `buildUnified`/`atende`/`agendaLabel` testado (`equipe-unified.test.ts` 6 cenários)
- `src/components/dashboard/catalog-panels.tsx` — `TeamEditor` props `hideList` + `hideTrigger` + `useEffect` listeners `edit/create`, `ServiceForm` já clínico (Sugestão da agenda, Seguir horário da clínica), sem vitrine
- `src/app/(dashboard)/disponibilidade/page.tsx` + `src/lib/panel.ts` — "casa/empresa" → "clínica" (description, comments, hints)
- `src/app/(dashboard)/estrutura/page.tsx` — hub `Equipe — Pessoas da clínica` (→/equipe) + `Cadastro da clínica` (completude 7 campos) em vez de Acessos
- `src/components/dashboard/BusinessHours.tsx` — já clínico, mantido
- `src/app/(dashboard)/servicos/page.tsx` + `src/app/(dashboard)/produtos/page.tsx` — já clínicos após B2, auditados (sem foto/vitrine em serviços)

## Preservado / Deferido B3

- **Preservado:** `/api/pages` compat, `Service.image/showPrice/featured` DB, `Product` legado, `Business` page fields, rotas públicas, `Professional`/`BusinessMember` distintos, `availability` herança
- **Deferido:** criação atômica única pessoa+profissional+acesso (Workflow), Agenda Temporal 2.0 (drag, start/end, bloqueios, recursos sala), EventLog→Pendência→Strip (planejado), Estoque/Farmácia, Prescrição/Exames

## Fechamento de Bloqueadores P0 (PR #46 Fixes — 2026-09-30)

- **P0.1 (`slotEligibleProfessionalIds`):** Unificação da passagem da equipe inteira do tenant (`db.professionals.filter(p => p.businessId === businessId)`) em todos os 11 pontos de chamada do sistema. A helper `slotEligibleProfessionalIds` assume autoridade total de elegibilidade sem pré-filtragem por `active !== false`.
- **P0.2 (Privilege Escalation Protection):** `validatePrivilegeEscalation` integrado no pipeline de pré-validação (`validatePersonInput`) e transacional (`personSaveTx`). Garante que nenhum ator não-OWNER possa atribuir papéis ou overrides com permissões efetivas superiores ao seu próprio perfil, retornando 403 sem mutações parciais.
- **P0.3 (`deriveIsTargetOwner` Tenant Safety):** Remoção de heurística de e-mail e validação por IDs reais no banco de dados (`existingUserId === ownerId`, `member.userId === ownerId && member.businessId === input.businessId`, `professional.userId === ownerId && professional.businessId === input.businessId`).

## Testes PR #46 P0 (validados em d629009)

- `src/lib/__tests__/pr46-p0-fixes.test.ts` — 13 passed (unit + integration cobrindo P0.1, P0.2 e P0.3)
- Suite completa em `d629009`: 2716 passed / 4 failed (baseline pré-existente: 3 Instagram + 1 automation audit)
- `npx tsc --noEmit` — 0 erros · `npm run build` — OK · `git diff --check` — 0

---

## Equipe UX Closure (PR #46 — 2026-09-30)

Itens da auditoria tratados nesta etapa (mesma PR; sem merge):

| Item | Decisão | Estado |
| --- | --- | --- |
| Papéis como lista de permissões confusa | Papéis como presets (Administrador · Recepção · Profissional); Proprietário resumo fixo; legados em “Outros papéis / avançado” | ✅ código + testes |
| Recepção herdava Visão geral/Pedidos | Preset = Agenda, Clientes, Oportunidades, WhatsApp | ✅ |
| Overrides legados virando `ajuste` | Overrides mínimos vs `permissionsFor(role)`; troca de papel limpa; confirmação só com personalização real | ✅ |
| Permissões sem sentido clínico (Página/Pedidos) | Ocultas do editor com `GODOUTOR_LEGACY_PAGES` OFF; avançadas só em modo personalizar | ✅ |
| Seguir clínica apagava horário próprio | Preservação em `professional.hours`, `applyToAll`, `person.save`; aviso + CTA + deep link | ✅ |
| Criação de Professional ignorava `dispMode` (sempre follow) | `followBusinessHours = dispMode==='own' ? false : true` na criação; zero regras automáticas | ✅ corrigido + teste direto + browser |
| `Membro não encontrado` / erros fora da vista | Mensagens humanas no drawer com scroll/foco | ✅ |
| Serviço da biblioteca com duração fixa | `Duração sugerida · N min` editável; manual exige duração; sem duplicar | ✅ |
| Escopo de dados do Profissional | **NÃO resolvido**: Clientes/Oportunidades/Conversas sem escopo por profissional → registrado para Workflow + Permissões (Master Plan §2.1) | ⏳ deferido |
| Contrato de duração / slot / recursos / Agenda 2.0 | Documentado (Master Plan §2.2–§2.5); sem tabela/join/instalação | ⏳ deferido |

### Testes desta etapa
- `pr46-equipe-ux.test.ts` (22), `equipe-ux.test.tsx` (12), `business-hours-focus.test.tsx` (4).
- Suite completa: 2759 passed / 4 failed (baseline: 3 Instagram + 1 automation audit; intocados). `tsc` 0 · `build` OK · `git diff --check` 0.
- Browser real (Chromium headless, login real): 47/47 em 1366 e em 1024; sanity 1440/390.

### Observações da renderização real — CORRIGIDAS
- Lista da Equipe: o Proprietário aparecia como enum cru `OWNER`; agora `roleLabel` (`role-labels.ts`) → `Proprietário`.
- 390px: o drawer ficava estreito (faixa de 46vw ≈ 180px); regra mobile em `globals.css` (<768px) — título, footer e botão Salvar íntegros, zero overflow. Teste: `pr46-drawer-mobile.test.ts`; browser 17/17 em 390, 23/23 em 1024 e 1366.
