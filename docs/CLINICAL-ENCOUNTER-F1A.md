# Clinical Encounter F1A — domínio, iniciar/retomar e workspace clínico

**Estado (2026-10-04): IMPLEMENTADO · TESTADO · HOMOLOGADO LOCALMENTE (Chromium real) · PR EM REVISÃO · MERGE NÃO EXECUTADO.**
Branch: `arena/01a104e4-instalink` (nova a partir de `main` em `2e225c15`, SHA homologado). Base `main` intacta e igual ao SHA de partida — nada foi mergeado, nada foi para produção.

F1A fecha **um** ciclo: **Booking → Iniciar atendimento → Encounter em andamento → sair → voltar → Retomar atendimento → mesmo `encounterId`**, com domínio único, persistência real e workspace clínico. F1B/F1C (prontuário completo, prescrição, exames, estoque, financeiro, IA, odontograma, construtor de formulários) **não** estão nesta entrega.

---

## 1. Auditoria do domínio `encounters` (§1)

| Pergunta | Resposta encontrada no código |
| --- | --- |
| Onde vive | `Encounter` em `src/lib/types.ts`; persistido em `DB.encounters`; normalizado em `src/lib/db.ts` |
| Campos | `id, businessId, bookingId, queueId, serviceId, professionalId, customerId, contactId, customerName, date, time, complaint, evolution, guidance, followUp, internalNote, tags, status, version, startedAt, createdAt, updatedAt, createdBy, updatedBy, finalizedAt, finalizedBy, signedBy, petId` |
| Vínculos | Booking (`bookingId`) · fila/walk-in (`queueId`) · Pet/Paciente (`petId`) · Tutor (`contactId`/`customerId`) · Professional (`professionalId`) · Service (`serviceId`) |
| Chaves de 1:1 | `encounterForBooking()` e `encounterForQueue()` — busca por **vínculo + tenant**, nunca por ordem de array |
| APIs | `GET/PATCH/DELETE /api/encounters` e `POST /api/encounters` (legado); **novo** `POST /api/encounters/start` |
| Usos ativos | Registro clínico, etapa derivada do workflow (`in_care`), People 360/histórico, automações (`encounter.completed`), fila do balcão |
| Representação do tenant | `Encounter.businessId`, conferido em **toda** leitura e escrita |
| Migração necessária | **Nenhuma DDL.** `startedAt` é opcional e derivado (`createdAt`) para registros anteriores ao F1A |

**Decisão (regra "reusar e evoluir"):** a entidade `encounters` é adequada — já é multi-tenant, já tem vínculo com Booking/Pet/Tutor/Professional e já é a fonte do histórico clínico. **Não** foi criada segunda entidade (`ClinicalEncounter`/`Visit`), **não** houve rename físico de tabela e **não** houve migração big-bang.

## 2. Contrato canônico e estados (§2, §6)

Contrato: `id · businessId · bookingId · queueId · petId · customerId/contactId · professionalId · serviceId · status · startedAt · finalizedAt? · createdAt · updatedAt · createdBy · updatedBy · version`.

| Estado canônico | Na prática hoje | UX |
| --- | --- | --- |
| `draft` | registro **não iniciado** = **ausência de Encounter** (o Booking é a verdade até alguém iniciar) | *Não iniciado* |
| `in_progress` | existe registro não finalizado (nasce com `status: 'draft'` + `startedAt`) | *Em atendimento* |
| `finalized` | `status: 'finalized'` + `finalizedAt` | *Finalizado* |
| `cancelled` | suportado pelo domínio, **não** introduzido por F1A | — |

F1A **não** cria uma quarta máquina de estados: a etapa **operacional** continua sendo derivada de Booking/Fila/Atendimento (`appointment-workflow`), e o estado **clínico** é o do Encounter. Iniciar o atendimento usa o estado existente equivalente (`arrived → in_care`); fila operacional e estado clínico não se misturam.

## 3. Invariantes (§3)

| # | Invariante | Onde está garantida |
| --- | --- | --- |
| A | Nunca dois Encounters ativos por Booking | `encounterForBooking/encounterForQueue` dentro de `updateDB` |
| B | Start com ativo **retoma** o existente | `startOrResumeEncounter` → `outcome: 'resumed'` |
| C | Tenant validado no servidor em todo acesso por ID | `requireBusiness` + `businessId` em todas as buscas |
| D | ID do cliente não concede acesso | todo vínculo é re-resolvido no tenant autenticado |
| E | Professional/Patient/Booking/Service/Contact do mesmo tenant | checagens explícitas (409) antes de criar |
| F | Finalizado não volta a `in_progress` por start/resume | `outcome: 'reused_finalized'`, sem mutação |
| G | F1A não implementa reabertura | sem transição de volta; só leitura |
| H | Nunca apagar Encounter para "consertar" | nenhum DELETE novo; DELETE legado intocado |
| I | Nada depende de ordem de array/primeiro item | busca por vínculo exato + tenant |

## 4. Operação canônica (§4)

`startOrResumeEncounter(d, args)` — `src/lib/encounter-start.ts`, **pura** em relação a I/O e executada **dentro de `updateDB`** (a escrita do documento é serializada, inclusive entre instâncias no Postgres): logo, checagem + criação são indivisíveis.

- Entrada: `businessId` autenticado + `bookingId` **ou** `queueId` + ator + agora + fuso + escopo profissional.
- Saída: `{ encounter, outcome: 'created' | 'resumed' | 'reused_finalized', created, reused }`.
- Sem registro → cria (1:1). Com registro em curso → **retoma o mesmo id**. Com finalizado → devolve para leitura; novo atendimento exige novo agendamento.
- `POST /api/encounters` (legado) e `POST /api/encounters/start` chamam **a mesma função** — não existe caminho paralelo de criação.

## 5. Ação contextual e rotas (§5, §7)

| Superfície | Ação | Rótulo |
| --- | --- | --- |
| Detalhe do agendamento (Agenda) | `start_care` | **Iniciar atendimento** |
| Detalhe do agendamento | `open_care` | **Retomar atendimento** |
| Detalhe do agendamento | `view_care` | **Ver atendimento** |
| Fila do balcão / Cliente 360 | mesma operação canônica | Abrir/Ver atendimento |

Os rótulos saem de `wf.allowed` (servidor decide) e usam o `Button` oficial. **Nenhum** atalho paralelo foi espalhado na grade da Agenda: o cartão abre o detalhe, e o detalhe é a única porta.

**Rotas**

- `/atendimento` — **resolvedor** de entrada operacional (`?bookingId=`/`?queueId=`/`?id=`): chama `/api/encounters/start` e assume a rota canônica.
- `/atendimento/[encounterId]` — **rota canônica** do workspace. É filha de `/atendimento` em `PANEL_ROUTES` (herda `pageType: 'record'`, permissão `atendimento` e área) e é a que sobrevive a F5, URL colada e "voltar".

## 6. Workspace clínico (§7–§10, §20)

`src/components/dashboard/EncounterWorkspace.tsx` — **área de trabalho**, não card de dashboard:

- **Cabeçalho contextual persistente** (`position: sticky`): paciente (Pet) como protagonista — nome, espécie/raça/idade —, tutor como contexto (`Tutor: …`), serviço, profissional, data/hora e estado clínico **em texto** (`StatusBadge`), nunca só por cor.
- **Corpo**: a seção real (registro do atendimento) via `EncounterSheet layout="section"`.
- **Nada de card-wall, gradiente ou glow**: verificado por asserção de DOM no QA (`backgroundImage` sem `gradient`, `box-shadow` sem glow, cabeçalho `sticky`).
- **Mobile 390**: sem rolagem horizontal; tipografia e gutters do Pré-F1.
- **Loading local** com `Skeleton` + `aria-busy`; erro humano ("Atendimento não encontrado", "Não foi possível abrir…") sem ecoar ID ou detalhe técnico.
- **Persistência**: abrir, sair, F5, colar a URL, voltar e retomar caem no **mesmo `encounterId`** (provado em Chromium).

## 7. Navegação interna (§9)

`src/lib/encounter-sections.ts` declara o contrato de seções (`atendimento · anamnese · avaliação · problemas · conduta · procedimentos · anexos`) com `module` (`core | vet | odontology | aesthetics`) e `available`. **Somente `atendimento` é `available: true`.** Seção indisponível **não** é renderizada: não há aba morta, botão desabilitado, campo decorativo nem placeholder. Quando uma seção virar real (F1B/F1C), ela passa a `available: true` **na mesma entrega que implementa a persistência**.

## 8. Permissões e identidade (§12, §13, §14)

| Papel | LER atendimento | INICIAR/RETOMAR |
| --- | --- | --- |
| Proprietário / Administrador (com permissão `atendimento`) | ✅ | ✅ (escopo amplo; **não** vira profissional) |
| Profissional (permissão `atendimento`) | ✅ **somente o que é dele** | ✅ **somente o que é dele** |
| Recepção (`SECRETARIA`) | ❌ | ❌ |

- Permissão `atendimento` exigida no **servidor** (`requireBusiness`, `API_GUARDS` inclui `/api/encounters/start`). Recepção enxerga a Agenda **sem** ganhar escrita clínica: bloqueio 403 com `AccessDenied` (acesso por URL direta também).
- **Identidade profissional = `Professional` do tenant** (vínculo real), nunca e-mail, nunca `BusinessMember` presumido.
- **Vet-first**: o **Paciente (Pet)** é o protagonista clínico; o Tutor/Customer é responsável/contexto — nunca invertido.

## 9. Fora do escopo de F1A (§15–§18)

Finalização/reabertura · prontuário completo · prescrição · exames · anexos clínicos · estoque · financeiro/documentos acoplados ao start · IA clínica e qualquer botão "IA" decorativo · odontograma · Fitzpatrick · estética · construtor universal de formulários · campos de especialidade.

## 10. Testes e QA (§19, §21, §24)

- **Focados:** `src/lib/__tests__/f1a-encounter-start-resume.test.ts` (22) cobre todos os casos obrigatórios: tenant A não lê B · booking de A não cria em B · paciente/profissional cross-tenant rejeitados · start repetido não duplica · concorrência não duplica · URL direta não autorizada · ID manipulado rejeitado · finalizado não volta a `in_progress`. Somam-se `a34-encounter` (30), `a34-encounter-integrity` (18), `encounter-workspace` (4).
- **Suíte completa:** 3059 PASS / 4 FAIL (3063) — as 4 falhas são a baseline pré-existente e intocada (3× `a34-instagram`, 1× `automation-audit-p4`). Sem `skip`/`only`/`todo` e sem enfraquecer expectativa.
- **Gates:** `git diff --check` limpo · `npm run typecheck` 0 · `npm run build` OK.
- **Chromium real (§21):** `scripts/seed-f1a-qa.mjs` (tenant falso, base descartável em `.cache/f1a/qa.json`, senha local) + `next start` local + `tests/f1a/qa.mjs` com login real e 17 verificações: seed → Agenda → **Registrar chegada** → **Iniciar atendimento** → rota canônica com `encounterId` → header do Pet/Tutor → sair → F5 na URL direta → **Retomar atendimento** (mesmo id) → start repetido (`created:false`) → concorrência (um só) → GET por id → desktop 1440 → mobile 390 → Profissional autorizado → **Recepção bloqueada (403)** → **outra unidade bloqueada (404)** → console 0 erro, 0 rede ≥400 inesperada, 0 5xx.
- **Produção nunca foi usada para QA.**

## 11. Revisão independente (§22)

| Risco | Veredito | Evidência |
| --- | --- | --- |
| Encounter duplicável | **Não reproduzido** | start repetido e concorrência devolvem o mesmo id (teste + Chromium) |
| Vazamento entre unidades | **Não reproduzido** | 404 cross-tenant na API e na URL direta; header nunca mostra dado de outro tenant |
| Profissional/Booking/Paciente trocados | **Não reproduzido** | todo vínculo re-resolvido no tenant; escopo do profissional impede registro alheio |
| Start/resume inconsistente | **Não reproduzido** | `outcome` canônico (`created`/`resumed`/`reused_finalized`) |
| Rota direta vulnerável | **Não reproduzida** | permissão + tenant + escopo no servidor; Recepção 403, outra unidade 404 |
| Botão que leva a tela falsa | **Não reproduzido** | navegação real para `/atendimento/[encounterId]`, sem mock |
| Estado que não persiste após F5 | **Não reproduzido** | F5 e URL direta reabrem o mesmo atendimento |
| UI com dado mockado | **Não reproduzido** | header vem do `encounterView` do servidor (Pet/Tutor/Serviço/Profissional do banco) |
