# GODOUTOR CLINICAL CONVERGENCE — Auditoria Completa

> Data: 2026-09-29
> Branch: arena/01a0eda6-instalink (partindo de d20ed48)
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

