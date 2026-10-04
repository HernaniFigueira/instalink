# GoDoutor — Histórico

## 2026-10-04 — Clinical Encounter F1B1 (anamnese da visita + avaliação veterinária + autoridade única)

> Branch de sessão `arena/01a10740-instalink`, nova a partir de `main` em `e2e2b6379ea2188524c6db8c5d050dab1cc9e5e0` (merge da PR #54/F1A, Vercel SUCCESS). PR [#55](https://github.com/HernaniFigueira/instalink/pull/55) aberta (`MERGEABLE`; Vercel SUCCESS no HEAD do PR). **Patch de isolamento por vertical aplicado na revisão (2026-10-04, mesma PR/sessão): QA de browser 29/29, HTTP 18/18, suíte 3131 PASS / 4 FAIL baseline. Merge NÃO executado.** Produção não usada para QA. Recorte autorizado: **F1B1** — nada de F1B2/F1C, prescrição, exames, anexos, procedimentos, financeiro, estoque, IA ou construtor de formulários.

- **Auditoria (§1):** `encounters` já é a entidade adequada (multi-tenant, 1:1 por Booking/fila, vínculos Pet/Tutor/Professional/Service, `version` otimista, autosave e trava de saída do F1A) → **REUTILIZAR**. Queixa/evolução/orientações/retorno/nota existiam como campos físicos → só a **copy** mudou. O motor `AnamneseTemplate/AnamneseResponse` existe, é **LEGADO preservado** e **não** virou o núcleo da visita (fichas administrativas, sem versionamento otimista, com vínculo por contato). **Não existia** conceito de avaliação/exame clínico/sinais vitais no atendimento → **CRIAR** dentro do Encounter. Nenhuma duplicata, nenhuma segunda entidade, nenhuma cópia de `Pet`.
- **Modelo aditivo, zero DDL:** `Encounter.clinical = { anamnesis, assessment.veterinary }`. `normalizeDB` preenche a estrutura vazia em registros legados (idempotente, sem derivar nada do Pet). Merge **parcial** validado no servidor (`applyEncounterClinicalPatch`): chaves desconhecidas = 400, opções em lista fechada, números **finitos** com limite **técnico** (não clínico), vazio = `null`, `changedFields` para a auditoria (`encounter.updated`).
- **Permanente × visita:** espécie/raça/sexo/nascimento/peso do cadastro continuam em `Pet` e aparecem como CONTEXTO de leitura; peso medido hoje/temperatura/FC/FR/TPC/exame vivem no Encounter e **não** sobrescrevem o cadastro (teste + QA).
- **Seções reais (§4):** Atendimento · **Anamnese** · **Avaliação** (`available: true`), com navegação interna (`aria-current`), cabeçalho sticky com o Pet protagonista. **Problemas/Conduta/Procedimentos/Anexos continuam `available: false` e não renderizam** — nada de aba morta.
- **Copy clínica (§6) sem renomear campo físico:** Queixa principal · Evolução clínica · Orientações ao tutor · Retorno · Nota interna (rotas/API/storage intactos; a via impressa e o `EncounterSheet` legado mantêm o texto antigo onde era contrato).
- **Autoridade única de persistência (§12):** `useEncounterAuthority` (linha + versão + status + conflito) + `useClinicalSection` (autosave das seções clínicas). A seção **nunca** guarda a própria versão: pergunta `authority.version()` e **publica** a linha confirmada — Anamnese salva → Avaliação já usa a versão nova (sem 409 interno). Um indicador (`Salvando… · Salvo agora · Erro ao salvar`) e um bloco de conflito para o atendimento inteiro. O `EncounterCoreSection` mantém o contrato do F1A quando isolado (sem `authority`).
- **Troca de seção e saída (§13):** trocar de seção **grava antes**; falha → permanece com o texto e o erro; 409 → permanece, com "Continuar editando" / "Recarregar versão atual". Voltar/menu/Back/F5 usam o mesmo caminho (flush → só navega com persistência confirmada ou descarte explícito).
- **Escrita clínica (§14):** servidor impõe que só o **profissional responsável vinculado** (`Professional.userId === ator` **e** `Professional.id === Encounter.professionalId`) escreva conteúdo clínico; Owner/Admin sem vínculo = **403** (papel ≠ identidade clínica); Recepção = 403; outro profissional da unidade = fora do escopo; outra unidade = 404; **Encounter sem Pet válido no tenant não grava dado clínico** (409, anamnese inclusive) e o vínculo é revalidado na escrita; `finalized` = leitura. A leitura devolve `access { canEditCore, canEditClinical, reason }` para a UI refletir o servidor sem mentir.
- **Unidades (§10):** peso kg · temperatura °C · FC bpm · FR rpm · TPC s — valores **numéricos** (vírgula ou ponto na digitação), unidade no rótulo, `inputMode="decimal"`, erro associado ao campo. Texto não numérico **não é gravado** (gate local + validação no servidor) e o texto digitado permanece. **Nenhuma** faixa clínica, alerta ou diagnóstico automático.
- **Testes:** novo `f1b1-clinical-visit.test.ts` (**26**: A–M do §26 + validação + finalizado + legado) e `f1b1-clinical-sections.test.tsx` (**19**, jsdom sobre os componentes reais: rótulos/unidades, payload numérico por fatia, versão da autoridade, 409 preservando texto, texto inválido não gravado, **troca de seção grava antes / falha não troca / 409 mantém as saídas**, indicador honesto com pendência, **vírgula e ponto = MESMA mudança, sem PATCH extra**, **erro de validação não fica latched sobre valor válido**, **"Sair sem salvar" + Descartar cumpre a saída**). Contratos legados ajustados com o produto como autoridade (declarado): `a34-encounter` (escrita pela profissional responsável; ADMIN reabre mas não escreve conteúdo), `a34-encounter-integrity` (clínica solo: Owner é o profissional responsável), `encounter-core-save-guard` (rótulo `Evolução clínica`), `f1a-encounter-start-resume` (três seções reais), `encounter-core-section` (cerca estrutural também no corpo). **Nenhuma expectativa enfraquecida.**
- **QA local:** `scripts/seed-f1b1-qa.mjs` (base descartável `.cache/f1b1/qa.json`, dois tenants, Owner/Michelle/Maria/outra unidade, recusa `DATABASE_URL`) + `tests/f1b1/http-qa.mjs` contra `next start` local com **login real**: **18/18 PASS** (16 do recorte + 2 do isolamento por vertical), incluindo iniciar → queixa → anamnese (versão sobe uma vez) → avaliação com a versão nova (sem 409 interno) → sair → retomar (mesmo `encounterId`) com todos os dados → peso do Pet intacto → 409 real sem sobrescrita → retry preservando o texto → Owner 403 → Recepção 403 → cross-tenant 404 → validações 400 → rota legada viva. **0 5xx inesperado** (4 respostas 403/404/400 provocadas pela própria QA, documentadas).
- **QA de browser EXECUTADA (`tests/f1b1/qa.mjs`, 29/29 PASS pós-patch):** Chromium **real** 153.0.8010.0 (Playwright 1.63) contra `next start` + base descartável. Prova: workspace canônico com o Pet protagonista · 3 seções reais · troca de seção grava antes · **uma digitação = UMA gravação** · **F5 com texto pendente: prompt nativo, recusar mantém o texto e o autosave conclui** (§13) · **menu lateral grava antes de navegar** (§13) · sair → F5 → retomar com TODOS os valores no MESMO `encounterId` · 500 induzido não troca de seção e preserva o texto (retry grava o preso) · 409 real sem sobrescrita e com saída explícita · Owner lê/não edita · Recepção bloqueada · cross-tenant 404 · **1440/1280/1024/390 sem rolagem horizontal** · console 0 erro inesperado, rede 0 resposta inesperada (as 3 falhas de recurso são 500/409/404 provocados e contabilizados). Ambiente: CDNs de browser bloqueados no sandbox → Chromium obtido do pacote npm `@sparticuz/chromium` (binário + libs no tarball) via `QA_EXECUTABLE_PATH`. **Achados reais da rodada, corrigidos:** (1) digitar `9,1` gerava **dois** PATCH (o número canônico `9.1` do servidor voltava a parecer mudança nova) → `canonicalNumber()` na chave do rascunho + regressão em jsdom + verificação no browser; (2) o erro de validação de um valor inválido ficava **latched** e reaparecia como "Erro ao salvar" sobre rascunho já válido → `status(state, error, owner)` + `clearStatus(owner)` (uma seção só limpa o erro que é dela); (3) com a gravação falhando, "Sair sem salvar" → "Descartar" era reinterceptado pelo guard e **não saía** → `allowNavigation()` autoriza exatamente a próxima navegação decidida pelo humano. A rodada também passou a cobrir §29 (aria-current, unidade no nome acessível, erro associado, Tab) e a saída sem salvar (§13).
- **PATCH DE ISOLAMENTO POR VERTICAL (revisão do PR, mesma sessão):** o revisor apontou que a resolução global de seções vazava o módulo **vet** para clínicas não veterinárias e que `canEditClinical` era uma flag ambígua. Correções: (a) **autoridade única de módulos** em `encounter-sections.ts` (`CLINIC_MODULES` + `normalizeClinicType` + `encounterModulesForClinic` + `clinicalBranchesForClinic`) — `veterinaria` = `core+vet` (Atendimento · Anamnese · Avaliação), `odontologica`/`estetica` = `core+odontology|aesthetics`, `medica`/`geral`/ausente/inválido = **`core` somente** (fallback conservador). Nenhum `if (clinicType === 'veterinaria')` em workspace/nav/seções e **nenhuma inferência** por nome/serviço/niche/slug/Pet (fixture provocativa: Pet legado na clínica odontológica); (b) **capacidades separadas** `{ canEditCore, canEditVisitAnamnesis, canEditVeterinaryAssessment, modules, reason }` — CORE universal (sem regra falsa de Pet), seções vet exigem módulo + Pet + responsável, `reason` distingue `module_unavailable` de `pet_required`; (c) **gate no servidor**: ramo de `clinical` fora da vertical = **400** "Esta seção clínica não está disponível nesta unidade." e o CORE segue editável pelo responsável — a UI esconder nunca é a segurança; (d) **ocultar ≠ apagar**: o Encounter não mudou de forma (`clinical.anamnesis` / `assessment.veterinary`) e trocar `clinicType` só muda o que renderiza/aceita — o dado gravado permanece (teste + adversarial no browser com a vertical trocada em tempo real). Seed de QA ganhou **dois tenants novos** (odontológico e de estética) com atendimento próprio, e a QA HTTP/browser prova o **workspace REAL** nesses tenants (zero abas de especialidade, CORE gravando, escrita vet recusada). **Achado real da 2ª passagem, corrigido:** o sucesso do CORE não publicava o estado "salvo" na autoridade, então o rodapé ficava **"Salvando…" para sempre** numa vertical cuja única superfície é o Atendimento (odonto/estética/geral) — `authority.status('saved', '', 'atendimento')` no caminho de sucesso, com o `dirty` de texto mais novo prevalecendo (nunca "Salvo agora" com pendência) + regressão em jsdom.
- **Gates (pós-patch):** `git diff --check` limpo · `npm run typecheck` 0 · `npm run build` OK · `npx vitest run` **3131 PASS / 4 FAIL (3135)** com as **4 falhas baseline intocadas** (3× `a34-instagram`, 1× `automation-audit-p4`) · QA HTTP **18/18** · QA de browser **29/29** (EXIT=0, console 0 erro inesperado, rede 0 resposta inesperada). Contrato completo: `docs/CLINICAL-ENCOUNTER-F1B1.md`.

## 2026-10-04 — Clinical Encounter F1A (domínio, iniciar/retomar e workspace clínico)

> Branch `arena/01a104e4-instalink`, nova a partir de `main` em `2e225c15b06f7b0f16d5a164c59f3d639b320416` (SHA homologado; `main` verificada igual ao SHA de partida). PR [#54](https://github.com/HernaniFigueira/instalink/pull/54) aberta contra `main` (`MERGEABLE`); **merge NÃO executado**. Produção não usada para QA. Recorte autorizado: **F1A** — nada de F1B/F1C, prontuário completo, prescrição, exames, estoque, financeiro, IA, odontograma ou construtor de formulários.

- **Auditoria first (§1):** `encounters` é a entidade adequada (já multi-tenant, com vínculos a Booking, Pet, Tutor/Contact, Professional e Service, e fonte do histórico 360). Decisão: **reusar e evoluir** — sem segunda entidade, sem rename de tabela, sem migração big-bang e **sem DDL** (`Encounter.startedAt` é opcional e derivado de `createdAt` para registros anteriores, em `normalizeDB`).
- **Operação canônica (§4):** `startOrResumeEncounter(d, args)` em `src/lib/encounter-start.ts`, **pura** e executada dentro de `updateDB` — checagem de duplicidade e criação são indivisíveis (testadas com duas chamadas simultâneas). Saída canônica `outcome: 'created' | 'resumed' | 'reused_finalized'`. O `POST /api/encounters` legado e o novo `POST /api/encounters/start` chamam a **mesma** função: não existe caminho de criação paralelo.
- **Estados (§2, §6):** "não iniciado" = ausência de Encounter; "em atendimento" = registro existente não finalizado (nasce `draft` + `startedAt`); "finalizado" = `finalized` + `finalizedAt`. Finalizado **não** volta a `in_progress` por start/resume e F1A **não** implementa reabertura. A etapa operacional continua derivada de Booking/Fila (workflow `arrived → in_care`): nada de quarta máquina de estados.
- **Invariantes (§3):** 1:1 por Booking e por entrada de fila (busca por vínculo + tenant, nunca "primeiro item"); todo vínculo re-resolvido no tenant autenticado (409 para pet/profissional/serviço/responsável de fora); IDs do cliente não concedem acesso; nenhum DELETE novo para "consertar".
- **Ação contextual (§5):** o detalhe do agendamento é a **única** porta — `Iniciar atendimento` (`start_care`), `Retomar atendimento` (`open_care`) e `Ver atendimento` (`view_care`), rótulos vindos de `wf.allowed` (servidor) com o `Button` oficial. Nenhum atalho paralelo espalhado na grade da Agenda; Fila e Cliente 360 usam o mesmo construtor de rota (`encounterWorkspaceHref`).
- **Rotas (§7, §10):** `/atendimento` virou **resolvedor** de origem (`?bookingId=`/`?queueId=`/`?id=`) e `/atendimento/[encounterId]` é a **rota canônica** — filha de `/atendimento` em `PANEL_ROUTES` (herda `pageType: 'record'`, permissão `atendimento` e área, sem duplicar entrada de navegação). É ela que sobrevive a sair → F5 → colar a URL → voltar → Retomar.
- **Workspace clínico (§7–§9, §20):** `src/components/dashboard/EncounterWorkspace.tsx` — área de trabalho com cabeçalho contextual **sticky** (Paciente/Pet protagonista: nome, espécie/raça/idade; `Tutor:` secundário; serviço, profissional, data/hora e estado clínico **em texto**) e corpo = a seção real (`EncounterSheet layout="section"`). Sem card-wall, gradiente ou glow (asserido no QA por `getComputedStyle`). Seções futuras ficam em `src/lib/encounter-sections.ts` como contrato (`available: false` = **não renderizado**): zero aba morta, zero placeholder, zero campo decorativo.
- **Permissões (§12–§14):** permissão `atendimento` exigida no servidor (`requireBusiness`; `API_GUARDS` com `/api/encounters/start`). Proprietário/Administrador leem e iniciam **sem** virar profissional; Profissional só o que é dele; **Recepção (`SECRETARIA`) não lê nem inicia** — enxerga a Agenda sem ganhar escrita clínica (403 com `AccessDenied`, inclusive por URL direta). Identidade profissional = `Professional` do tenant (vínculo real), nunca e-mail. Paciente (Pet) é o protagonista; Tutor é contexto.
- **Fora de escopo:** finalização/reabertura, anexos, prescrição, exames, estoque, financeiro/documentos no start, IA clínica e botões "IA" decorativos, odontograma/Fitzpatrick/estética, formulário universal.
- **Testes (§19, §23):** novos `src/lib/__tests__/f1a-encounter-start-resume.test.ts` (22 casos: tenant A não lê B · booking de A não cria em B · pet/profissional cross-tenant rejeitados · ID do cliente não cria vínculo · start repetido não duplica · concorrência não duplica · URL direta e ID manipulado rejeitados · finalizado não volta a em-atendimento · Recepção bloqueada · profissional alheio recusado). Focados 74/74 (`a34-encounter` 30, `a34-encounter-integrity` 18, `encounter-workspace` 4). Suíte completa **3059 PASS / 4 FAIL (3063)** — baseline pré-existente e intocada (3× `a34-instagram`, 1× `automation-audit-p4`); sem `skip`/`only`/`todo` e sem enfraquecer expectativa. `npm run typecheck` 0 · `npm run build` OK · `git diff --check` limpo.
- **QA local com Chromium real (§21, §24):** `scripts/seed-f1a-qa.mjs` cria base descartável em `.cache/f1a/qa.json` (dois tenants falsos, Owner/Recepção/Profissional e login de outra unidade, senha local) e recusa rodar com `DATABASE_URL`. `tests/f1a/qa.mjs` roda contra `next start` local com **login real** e 17 verificações: seed → Agenda → Registrar chegada → Iniciar atendimento → rota canônica com `encounterId` → header Pet/Tutor/serviço/profissional/data → UI (sticky, sem gradiente/glow, sem aba morta) → sair → F5 → **Retomar atendimento (mesmo id)** → start repetido (`created:false`) → concorrência (um só) → GET por id → 1440 → 390 (sem overflow) → Profissional autorizado → **Recepção 403** → **outra unidade 404** → console 0 erro · 0 rede ≥400 inesperada · 0 5xx.
- **Ajustes colaterais honestos:** três suítes legadas apontavam para o corpo antigo do POST e foram **reapontadas** para a nova casa do código (`fase2-pets`, `fase3-event-layer`, `homologacao-vet-pet360`) mantendo a expectativa; `src/app/globals.css` trocou o sublinhado das abas pela superfície/pílula do Design System (a aba morta saiu de cena — o CSS continua pronto para quando houver mais de uma seção real).

## 2026-10-04 — Clinical Encounter F1A · review patch (dois achados arquiteturais)

> Mesma branch `arena/01a104e4-instalink` e mesma PR [#54](https://github.com/HernaniFigueira/instalink/pull/54); HEAD anterior `a50cadf`. **Merge NÃO executado.** Produção não usada. **F1B/F1C não iniciados.**

A revisão independente apontou dois pontos a fechar antes de aceitar o F1A. Ambos foram corrigidos e reprovados.

- **1 · Profissional responsável é obrigatório.** A checagem de elegibilidade (`serviceRequiresProfessional` × `professionalServesService`) só rodava quando já existia `professionalId`, o que permitia um Encounter com profissional vazio. `startOrResumeEncounter` agora resolve o responsável nesta ordem — **(A)** profissional da origem (agendamento/fila), **(B)** escopo real do ator, **(C)** indicação explícita validada no tenant — e, **(D)** sem profissional resolvível, **não cria**: `409` com `ENCOUNTER_PROFESSIONAL_REQUIRED_ERROR` (*"Defina o profissional responsável antes de iniciar o atendimento."*), sem nenhuma escrita (a exceção aborta a transação antes do `push`). A elegibilidade do serviço passou a ser **sempre** revalidada. Nada é fabricado: sem `professionals[0]`, sem User, sem BusinessMember, sem e-mail. Owner/Admin continua executando a ação sem virar profissional, e registros existentes (inclusive anteriores ao F1A) continuam sendo retomados — F1A não reescreve histórico.
- **2 · Workspace isolado do `EncounterSheet` legado.** O corpo do workspace montava o componente legado, que carrega anamnese, anexos, pagamento, pós-atendimento e reabertura — tudo de fases futuras. Sem `if (layout === 'section')` espalhado: criado o **`EncounterCoreSection`**, que declara as **capacidades** que suporta (`complaint · evolution · guidance · followUp · internalNote · tags`, em `ENCOUNTER_CORE_CAPABILITIES`) e filtra os campos por elas; os módulos diferidos ficam nomeados em `ENCOUNTER_DEFERRED_MODULES` e **não renderizam**. O que o núcleo não exibe também não é apagado: o PATCH envia só os campos do núcleo, preservando retorno estruturado e arquivos já persistidos.
- **Legado preservado (nada apagado, nada quebrado):** `src/components/dashboard/EncounterSheet.tsx` voltou a ser byte-idêntico ao de `main` e passou a ser montado na rota **`/atendimento/[encounterId]/registro`** — é para onde o **histórico** (Cliente 360 / Pet 360) aponta, como já apontava antes do F1A. Finalização, reabertura, anamnese, anexos e "Agendar retorno" continuam existindo e funcionando. A rota antiga `/atendimento?id=` segue válida (cai no resolvedor).
- **Testes:** +8 no `f1a-encounter-start-resume.test.ts` (30 total: Owner com/sem profissional · Professional próprio resolvido pelo escopo · inelegível · cross-tenant · recusa não cria nada · nenhum caminho fabrica profissional, com travas contra `professionals[0]` e `actor.email`) e +9 em `src/components/__tests__/encounter-core-section.test.ts` (capacidades, cerca estrutural contra `<EncounterSheet>`, render do núcleo sem módulos diferidos, legado intacto). Suíte completa **3076 PASS / 4 FAIL (3080)** — baseline intocada (3× `a34-instagram`, 1× `automation-audit-p4`).
- **Contratos reescritos com o produto como autoridade (declarado):** `a34-human-test-fixes` (o teste que fixava "registro sem profissional" agora fixa a invariante: sem responsável não nasce; com ele, abre) · `a34-encounter` (entrada de fila do teste de 1:1 nasce com o profissional que a fila atribui) · `f1a-encounter-start-resume` (precedência canônica: o profissional do agendamento é autoritativo). **Nenhuma expectativa afrouxada.**
- **QA Chromium (23/23):** além do ciclo já provado (Agenda → chegada → Iniciar → rota canônica → F5 → Retomar → mesmo id → repetido `created:false` → concorrência → 1440 → 390 → Profissional → Recepção 403 → outra unidade 404), entrou: **workspace sem "Preencher anamnese"/"Arquivos"/"Registrar pagamento"/"Reabrir para editar"/"Agendar retorno"** e com os 6 campos do núcleo; **tela conferida** (4 textareas + 2 inputs, área real, indicador de salvamento); **Owner + agendamento sem profissional → recusa humana e zero atendimento criado**; **registro completo (legado) vivo em `/atendimento/<id>/registro`** (inclusive pelo caminho antigo: histórico do Cliente 360 → registro completo); **Recepção bloqueada também na rota legada**. Console 0 erro · 0 rede ≥400 inesperada · 0 5xx.

## 2026-10-04 — Clinical Encounter F1A · final safety patch (P1: sair exige gravação confirmada)

A revisão independente achou **um P1 de perda de registro clínico**: o `beforeNavigate` do núcleo do workspace chamava `proceed()` em `finally`, então falha de rede, 500 ou 409 navegavam assim mesmo e o texto clínico sumia em silêncio. Corrigido no produto:

- **Regra canônica de saída:** (A) tenta gravar → (B) gravou ⇒ navega → (C) falhou ⇒ **não navega**, fica no atendimento, mostra erro humano e preserva integralmente o texto digitado. `proceed()` só existe depois de persistência confirmada ou de descarte **explicitamente** confirmado no `ConfirmDialog` central — nunca em `finally`.
- **Um contrato só:** `useUnsavedChangesGuard` recebe `beforeNavigate` apontando para o `registerLeave` do núcleo; Voltar, link do menu lateral, Back do navegador e saída programática caem no MESMO caminho. `beforeunload` nativo instalado enquanto há conteúdo pendente.
- **Conflito 409:** "Este atendimento foi alterado em outra tela. Suas alterações ainda não foram salvas." com **[Continuar editando]** e **[Recarregar versão atual]**. Nada é sobrescrito em silêncio; nenhum texto local é apagado sem confirmação. Merge de conteúdo **não** entrou nesta etapa.
- **Testes:** `encounter-core-save-guard.test.tsx` (10 — falha não chama `proceed`, 409 não chama `proceed`, flush com sucesso chama uma vez, texto permanece, retry limpa o pendente, proteção some após persistência real, descarte só por escolha, autosave preservado). Suíte: **3086 PASS / 4 FAIL (3090)** = baseline exata (3× `a34-instagram`, 1× `automation-audit-p4`).
- **QA Chromium (30/30):** entraram **sair com sucesso grava no ato (antes do autosave)**, **falha de rede não sai por Voltar/Back/menu com texto preservado e retry que grava**, **F5 com pendente: `beforeunload` nativo**, **409 REAL (outra tela gravou antes) sem sobrescrever e com as 2 saídas explícitas**, **save lento com sucesso espera gravar** e **save lento com 500 induzido não sai**. Console 0 erro · 0 rede ≥400 inesperada · 0 5xx (as 5 falhas provocadas pela própria QA são identificadas como esperadas).
- **F1B não iniciado. Merge não realizado.**

## 2026-10-03 — Clinical UX Closure, antes de Clinical Encounter F1

Closure UX stacked sobre PR #52 (`0c426be`), branch fixa `arena/01a101fb-instalink`, sem merge. Range autoritativo e persistente, clique direto, block mode, timezone canônico e snap manual 15; serviços clínicos progressivos; aparência em Configurações; remoção de acesso/marketing da UI Cliente 360 preservando storage; ações suaves/sticky e encaixe laranja sem alterar status. Next production local + seed veterinário descartável + logins Owner/Recepção/Profissional + Chromium real; 2989 testes PASS / 4 baseline, 365 focados PASS, build/typecheck/diff-check OK. F1 não iniciado; produção não usada. Evidências e reprodução: [AUTO-HOMOLOGACAO-CLINICAL-UX-CLOSURE.md](AUTO-HOMOLOGACAO-CLINICAL-UX-CLOSURE.md).


## 2026-10-02 — Clinical Convergence · onda 2 (cleanup de resíduo InstaLink)

> Branch de sessão `arena/01a0fede-instalink`, base `main` em `dbf7d680c51a39b289c856fdba1f0216fe3e5834` (merge da PR #50). PR aberta contra `main`; **merge NÃO executado** (aguarda autorização explícita). Produção não usada para QA; Clinical Encounter F1 não iniciado.

- **Sessão/ambiente:** cookie canônico `godoutor_session` com fallback de leitura `il_session` (dual-read não-destrutivo; login purga o legado, logout limpa os dois); header de ação perigosa `x-godoutor-action` aceita o legado; banco local `GODOUTOR_DB_FILE` com alias `INSTALINK_DB_FILE` e preservação do arquivo legado; tabela `instalink_doc` confinada a `LEGACY_DOC_TABLE` com plano P1 de renome (sem migração destrutiva, sem big-bang).
- **Produto clínico por padrão:** onboarding/API de criação perguntam só o essencial da clínica; `niche`/`modes`/`NEW_BUSINESS_DEFAULTS`/`defaultPresetId(niche)` reclassificados como payload de COMPATIBILIDADE (ramo comercial vivo só com `GODOUTOR_LEGACY_PAGES=1`); preset inicial OFF `clinica-geral`; rascunho `gd-biz-draft`. Busca do shell e overview filtram `/pagina|/produtos|/pedidos` com a flag OFF; catálogo de temas divide `commerce` (presets comerciais não somem dos dados — ficam irrepresentáveis na UI padrão e resolvíveis por id).
- **Branding/voz:** copy pública e de canais converte "negócio/lojista/Instalink" para "clínica/GoDoutor" no caminho ativo (uploads `godoutor/`, User-Agent `GoDoutor-Webhook/1.0`, payload de teste de webhook clínico). Protocolos externos congelados com justificativa in situ: `X-Instalink-*`, `#instalink-booking`/`data-instalink-*`/`instalink:height`, `RESERVED_SLUGS`, `il_cust_session`/`il_support` (ondas próprias). Eventos internos do SPA renomeados (`godoutor:session-expired|forbidden`), atores de auditoria para `@godoutor.app`, tag de formato do export `godoutor.customers.full` (o import não lê o campo — verificado; pin a34 movido junto).
- **Seed/harness:** demos = Vet Vida (veterinária), Odonto Feliz (odonto, equipe auto), Clínica Vitta (geral); `products`/`orders` viram LEGACY STORAGE vazio documentado; `e2e-merchant.mjs` → `e2e-legacy.mjs` (jornada de compatibilidade com payload legado explícito). Stale asserts encontrados pela auto-homologação foram corrigidos com o produto como autoridade (vínculo de equipe ocupado em main; conclusão sem registro só após o horário — regra da Agenda Temporal 2; "voltar a herdar" é comportamental, linhas próprias ficam em stash; sábado da próxima semana por fuso; template nasce desligado "nada dispara sem revisão").
- **Testes:** novos pins de contrato em `clinical-convergence-wave2.test.ts` (13 casos: precedência de cookie, purge/logout, alias de env, preservação do legado, `instalink_doc` confinado, cópias/preset da API, catálogo clínico gated, seed sem varejo). Nenhum teste deletado; um pin de superfície legada estendido de propósito (filtro triplo da busca).
- **Gates:** typecheck 0; build de produção OK; suíte completa **2930 PASS / 4 baseline intocadas** (3× `a34-instagram`, 1× `automation-audit-p4`); harness HTTP local com seed descartável: smoke 67/0 · smoke-ux 84/0 · smoke-agendar 25/0 · smoke-p3 15 fluxos · smoke-p4 18/18 · e2e-legacy 28/0. Personas login real: Owner/Maria(Recepção)/Orlando(Prof.)/Master com papéis e escopos corretos (403 amigável da Recepção na Visão geral = preset da PR #46, por design). `git diff --check` limpo. **Sem Chromium no sandbox — homologação visual NÃO executada (limitação declarada, não contornada com claims).**
- **Portão de varredura:** produto ativo → 0 ocorrências conceituais (link na bio, negócio-como-metáfora, demos comerciais, vitrine no caminho padrão); o resto em `src/` é C (compat justificado com comentário no local) ou D (docs/testes históricos intocados). Matriz completa e vereditos por id técnico: `docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md` (seção onda 2) e `docs/AUTO-HOMOLOGACAO-CLINICAL-CONVERGENCE.md`.

- **Reexecução reconstruída (2026-10-02, pós-reset do sandbox que apagou os
  commits originais não-pushados):** onda reaplicada do zero sobre `dbf7d68`
  com push a cada bloco. Números do ciclo reconstruído: vitest completo
  **2939 PASS** / 4 baseline reconfirmadas em worktree exato da base ·
  `convergence-wave2.test.ts` 22/22 · harness 67/0, smoke-ux **88/0** (1
  check a mais: criação da unidade de varejo efêmera pelo próprio smoke),
  agendar 25/0, p3 15 fluxos, p4 18/18, e2e 28/0 · personas 4/4 (16/16
  verificações com dual-read + purga + pós-logout 401 nos dois cookies) ·
  typecheck/build limpos · rename do pacote (`godoutor`) e README clínico
  incluídos. Duas correções extras encontradas no caminho: `master.mjs`
  escrevia coluna errada no UPDATE Postgres do doc (`doc`→`data`, bug
  pré-existente da base) e o `db.ts` tinha SQL cru do `instalink_doc` no
  bootstrap (~800) que entrou de vez sob `LEGACY_DOC_TABLE`. Homologação
  visual segue NÃO executada (sem Chromium) — declarada pendente.

## 2026-10-02 — P0 Infra · single-read authenticated guard

> Branch `arena/01a0feb4-instalink`, base `main` em `02389c44b6eeaf1bd164ce54834d6442da62c515`; PR #50 (https://github.com/HernaniFigueira/instalink/pull/50) aberta, aguardando revisão. Produção não usada para QA; Clinical Encounter F1 não iniciado.

- Criados resolvers DB-puros (`getUserBySessionFromDB`, `userFromRequestFromDB`, `supportFromDB`/`supportFromRequestFromDB`) e mantidos os wrappers públicos. `requireBusiness`, `requireMaster`, `currentAccess` e consumidores de suporte compartilham um único snapshot por operação; sem credencial, os caminhos cobertos retornam sem `readDB`.
- Cookie continua prioritário; Bearer segue como fallback após cookie inválido/expirado no mesmo snapshot. Expiração de sessão, binding Master/suporte, tenant/membership, permissões, professionalScope e suporte somente leitura preservados. Sem cache global ou módulo; `updateDB()` e leituras de domínio/pós-mutação justificadas foram mantidos e classificados.
- Teste novo: 14/14. Suíte focada incluindo o novo teste: 136/136 em 10 arquivos (122 regressões existentes + 14 P0). `npm run typecheck` e `npm run build` OK. Full Vitest: 2917 passou / 4 falhas, exatamente a baseline conhecida (3× `a34-instagram`, 1× `automation-audit-p4`). `git diff --check` verificado após a revisão final.
- QA HTTP em build local e arquivo DB descartável, `DATABASE_URL` ausente: Owner, Maria/Recepção e Orlando/Profissional autenticaram pela rota real de login (3/3); `/api/auth/me` e Agenda retornaram papéis corretos; `professionalScope` de Orlando foi aplicado. A rodada visual Chromium ficou pendente: browser não instalado e downloads Playwright/Debian bloqueados por falha de rede. Detalhes e limitações em `docs/AUTO-HOMOLOGACAO-P0-SINGLE-READ-GUARD.md`.

## 2026-10-02 — Agenda Temporal 2.0 · B3 e encerramento técnico local

> PR #49 · branch `arena/01a0f827-instalink` · **mergeada em `main` às 22:01 UTC de 2026-10-02**. O QA descrito abaixo foi local, sem produção.


- Entidade `ScheduleBlock` separada de Booking e `AvailabilityException`, escopo clínica/profissional/recurso, CRUD autorizado, hard conflict inclusive encaixe. `ScheduleResource` multi-tenant sala/equipamento, alternativa única por requisito e atribuição estável, com snapshot no Booking.
- Buffers efetivos Service→clínica→0, `bufferMin` legado depois; snapshots before/after e congelamento de dados sem snapshot antes de editar política. Move/resize revalidam capacidade e devolvem recurso final sem GET global. UI Agenda/Configurações/Serviços e detalhe responsive preservam Day/Week/List e clique B2; drag-select pode escolher Booking ou Block.
- QA Chromium LOCAL (fixture descartável Owner/Maria/Orlando) 1366/1024/390; Week 1 GET batch, pointermove 0, move/resize 1 PATCH/0 GET, criar/excluir block 1 POST/0 GET; 200 e 500 cartões sem erro. Testes B1 38/38, B2 11/11, B2.1 7/7, B3 15/15, geral 2897 PASS/4 baseline conhecidas; build/typecheck/diff-check OK. Detalhes, limites e ressalva do stash: `docs/AUTO-HOMOLOGACAO-AGENDA-TEMPORAL-B3.md`.
- P0 Infra single-read authenticated guard não fazia parte da #49; foi entregue separadamente no registro acima, antes de Clinical Encounter F1.

## 2026-10-01 — Agenda Temporal 2.0 · Etapa B2 — Interações temporais na grade atual

> PR #49 · branch `arena/01a0f827-instalink` · **sem merge**; Agenda 2.0 segue EM ANDAMENTO.

- Grade própria Dia/Semana/Lista preservada. Drag-select e clique abrem o mesmo `NewBookingSheet` em modo compacto com duração escolhida no gesto (servidor valida override exclusivo da equipe; público não escolhe duração). Move preserva o snapshot do Booking, resize da borda inferior altera apenas `endAt/durationMin` do Booking; alternativa via detalhe no desktop/mobile. Snap interno 5 min separado de `slotMin` público.
- `PATCH /api/bookings` revalida disponibilidade, conflito, buffer, elegibilidade, tenant, papel e escopo na escrita serializada. Conflito 409 conserva o cartão na origem com mensagem humana. Drag terminal bloqueado; reagendamento terminal explícito continua recriando Booking. Preview do drag faz 1 GET por dia visível somente após o limiar; não existe fetch por pixel nem polling novo.
- Homologação LOCAL real (`next build/start`, banco fake descartável, `/login` Owner/Maria/Orlando, Chromium, 1366/1024/390): seleção/criação 10:00–10:40, move sem mudar duração, resize 11:15–12:10/55 min com F5, corrida simulada → 409/rollback, Maria move/resize/cria, Orlando 403 para Booking alheio. 0 respostas 5xx, 0 exceções JS. Em 200 eventos: 205 cartões; 1000: cap existente de 500 cartões, sem erro. Doc e screenshots: `docs/AUTO-HOMOLOGACAO-AGENDA-TEMPORAL-B2.md` e `docs/evidence/agenda-temporal-b2/`.
- Testes B2 focados 11/11; suíte geral 2876 passed / 4 baseline conhecidas. Build, typecheck e diff-check OK. B3 (bloqueios, buffers before/after, Sala/Equipamento, fechamento) é etapa futura, **não implementada** aqui.


## 2026-10-01 — Agenda Temporal 2.0 · Etapa B1 — Fundação Temporal do Booking

> Branch `arena/01a0f827-instalink` (base `main` em `cfc6263`) — **sem merge**.
> Nome do registro: **"Agenda Temporal 2.0 — Fundação Temporal B1"** (não é a Agenda 2.0 inteira).

- **Domínio:** `Booking` ganhou `startAt`, `endAt`, `durationMin`, `timeZone` (IANA) e `temporalSource` (`native` | `legacy_inferred`), de forma **aditiva**. A autoridade temporal é `startAt + endAt`; `date`/`time` continuam existindo como **projeção compatível** do mesmo `businessTimezone`, gravadas na **mesma escrita atômica** — sem conversão por rota.
- **Novo módulo puro** `src/lib/booking-temporal.ts` (Intl, zero dependência): janela canônica, conversão instante ↔ projeção local por IANA, recusa explícita de DST gap/fold com erro tipado, congelamento determinístico da inferência legada e resolução da duração.
- **Todas as criações congelam a janela** no caminho único `createBookingTx` (agenda interna, página pública, cliente, agente, lead→booking, API externa, séries). O **servidor** resolve a duração; payload do navegador nunca é autoridade. Fuso vem do `businessTimezone` da clínica (nunca do navegador, nunca de `process.env.TZ`).
- **Editar `Service.durationMin` não move histórico:** `normalizeDB` passou a impor invariantes de coerência temporal (determinístico, sem dependência de fuso do servidor, sem inferência na leitura) e as escritas que mudam duração/estado congelam a inferência legada **antes** da mudança.
- **Ocupação/slots** usam a janela/snapshot do próprio Booking; a duração atual do serviço só entra no **fallback legado explícito**. `slotMin` continua sendo cadência de início (não duração) e o buffer permanece **fora** da duração do atendimento.
- **Reagendamento** reescreve a janela atomicamente (move) ou cria um novo Booking com janela nova quando o estado é terminal, preservando a janela do registro antigo. Série: cada ocorrência com janela própria, mantendo `seriesId`/idempotência.
- **Sem** biblioteca de calendário, **sem** troca da grade, **sem** redesenho visual, **sem** backfill remoto. Nenhum novo estado de workflow; APIs permanecem compatíveis.
- **Validação:** `npm run build` OK · `npm run typecheck` 0 · `npx vitest run` **2862 passed / 4 failed** (baseline pré-existente e intocada: 3× `a34-instagram` + 1× `automation-audit-p4`) · suíte focada B1 35/35.
- **Homologação real** (build de produção, banco descartável, `/login` real, Chromium real): **34/34 fluxos**, 0 falhas, 0 5xx, 0 erros de console — incluindo a prova-mãe **40 → 60 sem mover o histórico** e o **novo booking com 60**, persistência após recarga, cancelamento, reagendamento, série, legado congelado, slots reais (cadência, buffer e cancelado) e personas Proprietário/Recepção/Profissional em 1366/1024/390. Doc: `docs/AUTO-HOMOLOGACAO-AGENDA-TEMPORAL-B1.md`; screenshots: `docs/evidence/agenda-temporal-b1/`.
- **Estado:** Agenda Temporal 2.0 permanece **EM ANDAMENTO**; **próxima etapa é B2** (recursos Sala/Equipamento, buffers before/after, separação definitiva snap × `slotMin`).

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

## 2026-09-30 — Workflow + Permissões (CONCLUÍDO EM CÓDIGO / HOMOLOGADO / AGUARDANDO MERGE)

Base `main` `4c51584` (#46 mergeada, em produção). Branch de sessão `arena/01a0f3d3-instalink`, commit de código `5327e0e`.

- **Workflow:** etapa canônica derivada de Booking + Fila + Atendimento (`appointment-workflow.ts`), transição única transacional (`appointment-workflow-tx.ts`), eventos de domínio best-effort após o commit, auditoria `booking.status_changed`; sem nova máquina persistida; `Booking.workflow` é leitura derivada.
- **Permissões:** matriz Proprietário/Administrador/Recepção/Profissional aplicada no servidor; capacidades `clientes_exportar`/`clientes_importar`.
- **Escopo de dados do Profissional (P0):** `data-scope.ts` por relação real; aplicado a contatos, export/import, People 360, pets, busca, oportunidades, pendências, conversas, visão geral, fila e atendimento.
- **UI:** detalhe do agendamento guiado por `booking.workflow.allowed` (Recepção nunca vê botão clínico), Clientes sem importar/exportar/novo cliente fora do escopo, drawer só inicia atendimento após a chegada.
- **Pendência:** faltou abre uma tarefa `Reagendar falta de …` (reaproveita `tasks`), fechada ao reabrir/reagendar.
- **Testes:** `workflow-permissoes.test.ts` (42). Suíte 2801 PASS / 4 baseline conhecidas. Homologação real em `docs/AUTO-HOMOLOGACAO-WORKFLOW-PERMISSOES.md`.
- **Deferido:** Agenda Temporal 2.0 (PRÓXIMA PR), Clinical Encounter F1, Cadastro/Onboarding PF/PJ (§2.6).

---

## 2026-09-30 — PR #46 concluída e homologada (fechamento documental)

**`CONCLUÍDA E HOMOLOGADA / PRONTA PARA MERGE` — merge NÃO realizado.** HEAD de código homologado `f7df12a` (branch `arena/01a0f3d3-instalink`). Vercel SUCCESS; `npx vitest run` 2759 passed / 4 failed (baseline conhecida e intocada: 3× `a34-instagram`, 1× `automation-audit-p4`); build, typecheck e diff-check OK. Homologação real (build de produção, banco descartável, login real, Chromium headless): 1366 23/23, 1024 23/23, 390 (drawer de pessoa) 17/17, console limpo; fechamento incluiu label `Proprietário` via `roleLabel` e Drawer utilizável em 390px. Detalhes: `docs/AUTO-HOMOLOGACAO-PR46-MODELO-OPERACIONAL.md`.

Registrado sem implementação: **Cadastro/Onboarding — contrato de identidade** (Master Plan §2.6). Fila oficial confirmada: 1 Workflow + Permissões · 2 Agenda Temporal 2.0 · 3 Clinical Encounter F1 · 4 Cobertura/Modalidade · 5 Prescrição + Exames + Document Engine · 6 Estoque/Farmácia · 7 Cirurgia + Internação · 8 Conta do Atendimento + Financeiro avançado · 9 Fiscal/integrações · 10 Agentes + Jev + LLM.

---

## Fase B3.2 — PR #46 Equipe UX Closure + Contrato de Agenda/Serviço (2026-09-30)

**`CONCLUÍDA E HOMOLOGADA / PRONTA PARA MERGE` — mesma PR #46, sem novo PR, sem merge.** Branch de trabalho `arena/01a0f3d3-instalink`.

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
- #46 — Clinical Structure Consolidation + Architecture Closure — `MERGED / PRODUÇÃO / CONCLUÍDA` (`main` `4c51584`)
- Workflow + Permissões (`arena/01a0f3d3-instalink`) — CONCLUÍDO EM CÓDIGO / HOMOLOGADO / AGUARDANDO MERGE


## 2026-09-29 — Homologação Clinical UX Closure — continuação (0410e49+)

**Branch:** `arena/01a0eda6-instalink` · PR #46 OPEN — validação real contra Git.
**Closure:** Equipe `Gerenciar pessoa` unificado (DADOS/ATUAÇÃO + ACESSO + DISPONIBILIDADE) com Drawer único, largura Ações 170px sem overflow; deep-link Disponibilidade preservado; `Redes e site` oculto com `GODOUTOR_LEGACY_PAGES OFF`; `Como está a inteligência` removido da superfície clínica (estado/fetch mortos removidos, não movido nesta fase); Aparência extraída para `ShellAppearance` em Meu Perfil → Preferências (navegador, não tenant); Perfil copy técnica removida (`User`/`Professional`/IDs/`/profissionais` → linguagem produto + link `/equipe`); Estrutura `Modelos de anamnese` / “Crie e adapte fichas...” (sem prometer biblioteca); Serviços preservam `questions` legado (omitido no payload), preço opcional, Categorias Drawer com bloqueio; Master Plan registra Google Calendar (VISUAL) e repos `fullcalendar/fullcalendar`, `schedule-x/schedule-x`, `bigcalendar/react-big-calendar` para Agenda 2.0 + biblioteca futura F1 sobre motor existente.

**Validação:** (executado nesta missão — ver relatório) `typecheck` / `build` / `vitest` / `diff-check` + homologação visual 1440/1366/1024 (ou pendente se sem browser).

## Adendum — Correção final da PR #51 (2026-10-03, mesma branch)

Bloco de fechamento do produto ativo 100% clínico: onboarding OFF sem
pergunta comercial nem `modes` (base canônica server-side), Products/Orders
fora do catálogo ativável e das telas operacionais no OFF (estado legado,
410 no PATCH), checklist sem itens de Página, branding de `package.json`/
`.env.example`, e renome **com migração dual-read** de todos os identificadores
ativos `il-*` (localStorage `il_token/il_cust/il-side-v2/il-cart-/il-setup-hidden-/il-biz-draft`,
eventos internos `il:*` → `godoutor:*` com produtor+ouvinte juntos, flags
`__il_*` → `__godoutor_*`). CSS `il-*` classificado (sem big-bang) e regra
permanente no AGENTS.md: nenhum `il-*` novo. Testes novos 29/29
(`convergence-final.test.ts`); suítes completas reexecutadas verdes (67/88/25/15/18/28 + personas 11/11 + vitest 2965/4-baseline). Corrige também bug latente do `scripts/master.mjs` (helper `resolveLocalDbFile` ausente desde a onda C2). Bloqueio final pós-correção (commit `afb6d8b`): **projeção operacional** do Dashboard/Overview — `dashboardModules/dashboardContext(business, legacyPagesEnabled)` mascaram products/orders/quote no OFF mesmo em unidade legada com os modes ativos; `/api/overview` deriva módulos/receita/painéis/totais/atividade/resultados/checklist da máscara (payload `modules` via `operationalEnabledFeatureIds`; `revenue` sem fallback de pedido); cliente sem relabel 'Revise dados legados' e atividade gated. Storage, `isFeatureEnabled` global e rota ON intactos. Testes: `legacy-commerce-off-overview.test.ts` 7/7 (fixture OFF+ON na rota real), vitest 2975/4-baseline, smoke-ux reescrito 96/0, smoke 67/0, agendar 25/0, e2e 28/0. Produção: **NÃO**. Merge: **NÃO** — PR #51 segue aberta para revisão humana; Clinical Encounter F1 continua bloqueado até autorização explícita.


## 2026-10-03 — PR53, fechamento final pré-F1 ainda aberto

Correções incrementais e reprodução real do fechamento da biblioteca durante scrollbar nativa. Motor de slots respeita15, intenção não é apagada, Semana projeta bloqueios profissionais, Equipe recebe guard/seleção explícita, Recepção perde leads no preset (override preservado), secondary central tem borda temática. Full3010+4baseline; Chromium parcial e 18 capturas. **NÃO ESTÁ PRONTO**: matriz, limites da evidência e pendências em [PRE-F1-FINAL-STATUS.md](PRE-F1-FINAL-STATUS.md). Sem produção, migração, merge ou F1.

### PR53 — fechamento dos últimos gates (2026-10-03)

Correções restritas à faixa visível com drawer, navegação dirty, copy ativa e secondary locais. Chromium cobre profissional vazio, vínculo canônico bidirecional, bloqueios de clínica/recurso e Azul/Verde. Matriz e auditoria: `PRE-F1-FINAL-STATUS.md` / `PRE-F1-CLOSING-AUDIT.md`. Liberação exige logs pós-commit e Vercel SUCCESS no SHA final; evidência pré-commit não basta. Produção, F1 e merge: não.

### PR53 — último polimento pré-F1

Range simplificado com duração humana, copy de bloqueios/regras/recursos, dias especiais derivados, secondary outline no normal e soft no hover, confirmação limpa, escala Geist e cinco temas ativos mantendo21 presets históricos. Dashboard limitado a4 tarefas com “Ver todas”; revisão encontrou/corrigiu flag de link ausente e projeção de exceção fora da rotina. `PRE-F1-POLISH.md` registra decisão do usuário, revisão separada, backlog e protocolo de homologação. Sem produção, merge ou F1.
