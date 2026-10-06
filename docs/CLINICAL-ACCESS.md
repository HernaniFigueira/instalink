# Clinical Access — continuidade assistencial e histórico longitudinal

> **STATUS: projeções clínicas implementadas neste worktree local**, branch da sessão
> `arena/bceef42d-instalink`, baseado em `main` @ `714e3277`. O snapshot integral
> local foi preservado no checkpoint `387a222` e enviado somente à branch de
> sessão, não à branch da PR. A PR [#61](https://github.com/HernaniFigueira/instalink/pull/61)
> continua aberta contra `main`, mas o head remoto é `arena/01a10c9e-instalink` @
> `5cc1a885` — diferente do checkout desta sessão. Portanto, estas alterações e
> evidências **ainda não correspondem ao head da PR**. Não foi criada outra PR,
> não houve edição da PR nem merge; a divergência de branches precisa ser
> resolvida antes de associar esta validação à PR.
> Evidência local, em build de produção (`next start`) e fixtures descartáveis:
> **smoke HTTP 33/33** e **browser QA 20/20 em Chromium real**. Dados reais de
> produção não foram usados.

## 1. Decisão de domínio

**Paciente da clínica não é carteira particular do profissional.**

Dentro do mesmo `businessId`, um Professional ATIVO vinculado deve conseguir
dar continuidade assistencial: localizar os pacientes clínicos da unidade,
abrir a ficha, ler o histórico longitudinal completo (inclusive registros
produzidos por outros profissionais da mesma clínica), ver quem realizou cada
atendimento e abrir o Encounter alheio em **read-only**.

A decisão NÃO amplia módulos comerciais, não cria identidade clínica por papel
administrativo e não altera o contrato de escrita do Clinical Encounter (F1).

## 2. As duas noções (autoridade única: `src/lib/data-scope.ts`)

| | **Escopo OPERACIONAL** | **Acesso CLÍNICO ao paciente** |
|---|---|---|
| Pergunta | "o que é o MEU trabalho" | "quais pacientes da minha clínica eu consulto" |
| Função | `operationalScope()` (alias `clinicalLinks`) | `patientAccess()` / `canReadClinicalRecords()` / `clinicalPatientBase()` |
| Alcance | agenda, fila, atendimentos, Pendências, Oportunidades, Conversas e CRM do profissional vinculado (vínculo real) | todos os pacientes clínicos do mesmo tenant |
| Usado por | `/api/bookings?mode=manage`, `/api/queue`, `/api/encounters` (origem/relatório), `/api/leads`, `/api/conversations`, `/api/tasks`, `/api/overview` (`scopedDbView`) | `/api/contacts` (leitura), `/api/pets` (leitura), `/api/people360`, `/api/search` (pessoas/pets), `/api/encounters` (histórico do paciente e leitura por id), `/api/bookings?mode=patient` |

- Papel de atendimento **SEM vínculo** (`NO_PROFESSIONAL_SCOPE`) continua
  fechando por padrão: `patientAccess().level = 'none'`.
- Owner/Admin/Recepção seguem com escopo de unidade (`level: 'unit'`) — como
  antes — e **não** ganham identidade clínica por papel.
- `professionalBelongsToTenant()` impede que um `professionalScope` de outro
  tenant libere leitura clínica por engano de chamador.

### Paciente clínico (o que entra na base)

Pessoa com **pegada clínica** no tenant: pet, agendamento, Encounter ou
anamnese — mais os aliases da mesma identidade (conta/telefone). Contato que só
existe como lead/conversa/campanha **não** é paciente e continua fora da lista
de quem atende. Pets: todos os ativos da unidade.

## 3. Auditoria (comportamento anterior → causa → arquivos)

O recorte antigo tratava **uma coisa só**: `clinicalLinks` (vínculo
operacional) governava também a leitura clínica. Consequências comprovadas com
cenário controlado (Pet Isabelle: Encounter do Orlando; Michele na mesma
unidade):

| Superfície | Comportamento anterior | Arquivo responsável |
|---|---|---|
| Pets / Clientes / Busca | `scopePets`/`scopeContacts` filtravam por vínculo → Isabelle invisível para a Michele | `src/lib/data-scope.ts` |
| People 360 | payload montado sobre `scopedDbView` → paciente de outro profissional ausente | `src/app/api/people360/route.ts` |
| Encounter por id | `encounterInScope` → **403** para outro profissional do mesmo tenant | `src/app/api/encounters/route.ts`, `src/lib/encounters.ts` |
| Histórico do paciente | só `bookingId`/fila, sem `petId`, e sobre a lista já recortada | `src/lib/encounters.ts` |
| Pet 360 (aba Agenda) | buscava a **agenda da unidade** (`mode=manage`) e filtrava o pet no cliente | `src/components/dashboard/Pet360Sheet.tsx` |
| Dashboard | "Conversas e tarefas" mostrava métricas de conversa sem a permissão do módulo | `src/app/(dashboard)/dashboard/page.tsx`, `src/app/api/overview/route.ts` |
| Clientes (UI) | rótulo e ações de CRM indistintos para quem atende | `src/app/(dashboard)/clientes/page.tsx`, `ClientProfileDrawer.tsx` |

Sem segunda tela: a rota `/clientes` continua a mesma (URL/schema intactos) e
passa a projetar a leitura clínica do servidor com rótulo contextual
("Pacientes" para quem atende).

## 4. Matriz de acesso

| Superfície | Professional vinculado | Recepção | Owner/Admin sem vínculo | Professional sem vínculo | Outro tenant |
|---|---|---|---|---|---|
| Pacientes da unidade (Clientes/Pets/Busca) | lê | lê (CRM, como antes) | lê | **fechado** | **fechado** |
| Tutor (dados de cuidado) | lê (nome/telefone/agenda do paciente; sem CRM) | lê | lê | fechado | fechado |
| Histórico longitudinal de Encounters | lê (todos os profissionais) | **403** | lê (regra administrativa F1C) | fechado | 404 |
| Encounter alheio (draft/finalizado) | **read-only** | — | read-only | — | — |
| Escrita de conteúdo/finalize/nota | só o responsável (F1) | 403 | 403 (reabertura administrativa preservada) | 403 | 404 |
| Agenda (gestão) | **só a própria** | unidade | unidade | vazia | 403 |
| Fila | própria + sem dono (como antes) | unidade | unidade | vazia | 403 |
| Conversas/WhatsApp | só com permissão **e** vínculo | permissão | permissão | 403 | 403 |
| Oportunidades/leads | só com vínculo/permissão | permissão | permissão | 403 | 403 |
| Financeiro / export completo | 403 | 403 (export) | permissão | 403 | 403 |
| Pendências | próprias (atribuídas/criadas/ligadas ao trabalho) | administrativas | unidade | vazia | 403 |

## 5. Implementação

- `src/lib/data-scope.ts`: `operationalScope` × `patientAccess`; leitura
  clínica (`canReadContact/canReadPet/canReadPerson/scopeReadable*`) e escrita
  de CRM (`isLinkedContact/isLinkedPet`) separadas; guarda de tenant.
- APIs e projeções: `contacts` GET clínico permite só `id/name/phone`;
  `people360` permite só `key/contactId/name/phone/bookings` e usa chave
  clínica opaca; `search` projeta nome/telefone para tutor e nome do pet, sem
  procurar pelo e-mail; `pets` GET e update POST clínicos usam allow-list e
  preservam `tutorId`. A resposta administrativa de Owner/Recepção continua
  integral nessas rotas. O Encounter clínico remove `customerId` tanto do
  registro corrente quanto dos snapshots de finalização; a resposta
  administrativa é preservada. Estas correções são na projeção/resposta e não
  mudam a autorização canônica do servidor nem o domínio de Encounter. `PATCH`
  de cadastro/observação de contatos e escrita de pets seguem presos ao vínculo;
  `bookings` (`mode=patient`) segue limitado ao paciente, sem alterar o escopo de
  gestão da Agenda; `overview` inclui `whatsapp` somente com permissão. `search`
  clínico aceita apenas nome/telefone para pessoas.
- UI: `clientes/page.tsx` rotula a lista como "Pacientes" e limita a busca
  visível a nome/telefone; não oferece cadastro ou filtros de CRM ao
  Professional. `ClientProfileDrawer` não apresenta e-mail, perfil cadastral,
  tags nem notas administrativas na projeção clínica. `Pet360Sheet` usa a
  agenda do paciente via `mode=patient&petId=`; `dashboard` só mostra métricas
  de conversa com a permissão.
- `EncounterWorkspace`/seções: nenhuma mudança de escrita; o read-only alheio
  já era desenhado por `access` (F1) — agora o servidor entrega a leitura com
  `canEditCore=false` e o motivo visível.
- O ajuste de privacidade desta etapa fica na fronteira de serialização: não
  altera `scopeReadableContacts`, o domínio/escrita de Encounter ou o escopo da
  Agenda de gestão. Owner/Recepção mantêm as respostas administrativas.

## 6. Preparação para IA (sem IA nesta fase)

O histórico longitudinal é lido como lista estruturada de Encounters (data,
autor, seções `clinical` normalizadas: anamnese, avaliação, problemas, conduta,
procedimentos), o que permite no futuro um resumo assistido **revisado pelo
profissional** citando os Encounters-fonte. Nenhum LLM/JEV/OAAS foi
implementado; nada aqui torna o prontuário assinado por máquina.

## 7. Evidência local (worktree `arena/bceef42d-instalink`)

- `src/lib/__tests__/clinical-access.test.ts` — **23 testes** com rotas reais e
  banco descartável, cobrindo A–M, isolamento entre tenants, ausência de chaves
  sensíveis, busca clínica só por nome/telefone e preservação do DTO
  administrativo para Owner/Recepção.
- Testes focados após os últimos ajustes: **4 arquivos, 89/89** (`clinical-access`,
  `contacts`, `workflow-permissoes`, `clinical-ux-closure`).
- `npm run typecheck` — passou. `npm run build` — passou.
- Smoke HTTP local (`scripts/seed-clinical-access-qa.mjs` +
  `scripts/smoke-clinical-access.mjs`) — **33 PASS / 0 FAIL**, em build de
  produção local e fixture própria descartável (`next start`, porta 3021).
- Browser QA (`tests/clinical-access/qa.mjs`) — **20 PASS / 0 FAIL** em
  Chromium real, usando outra fixture descartável (`next start`, porta 3020).
  Cobriu projeções exatas de Contacts/People360/Pets, a busca clínica limitada
  a nome/telefone, ausência de CRM no drawer, continuidade longitudinal,
  Encounter alheio read-only, preservação do administrativo de Owner/Recepção,
  agenda individual, sem overflow em 390px, console sem erro inesperado e rede
  sem resposta inesperada. Evidência: `.cache/clinical-access/browser-qa.json`
  (descartável, não versionada).
- Suíte completa Vitest no worktree local: **232 arquivos, 3.245 testes; 3.240
  passaram e 5 falharam** em arquivos não relacionados a esta projeção:
  3 em `a34-instagram.test.ts`, 1 em `automation-audit-p4.test.ts` e 1 em
  `pipeline.test.ts`. As fixtures usam datas fixas de setembro/início de outubro
  de 2026 e estão vencidas em 2026-10-06; não alterei esses domínios/testes.
  Isso é resultado do worktree local, não do head remoto da PR #61.
- `git diff --check` — passou.

Reprodução de cada runtime QA: criar **fixture nova** com
`node scripts/seed-clinical-access-qa.mjs .cache/clinical-access/<nome-novo>.json`,
subir `next start` com `GODOUTOR_DB_FILE` apontando para ela e rodar o smoke ou
browser QA. Não reutilizar fixture executada: o smoke pode alterar Encounter.

## 8. Fora do escopo (não implementado)

Agenda UX, date picker, Design System, Coverage/Modalidade, Prescription,
SNCR, Financeiro, IA clínica/JEV/OAAS. Nada disso foi antecipado.
