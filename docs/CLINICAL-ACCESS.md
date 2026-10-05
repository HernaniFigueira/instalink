# Clinical Access — continuidade assistencial e histórico longitudinal

> **STATUS: implementado e auto-verificado no working tree da branch de sessão
> `arena/01a10c9e-instalink` (base `main` @ `714e3277`, merge da PR #60).
> PR aberta; MERGE NÃO autorizado nesta sessão.** QA de browser automatizado
> NÃO executado neste sandbox (`BLOCKED_BROWSER_ENV`); a evidência de runtime é
> o smoke HTTP local em base descartável (`scripts/smoke-clinical-access.mjs`,
> 32/32) e a suíte automatizada com as rotas reais. Produção não foi usada.

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
- APIs: `contacts` (GET clínico, PATCH/observação presos ao vínculo), `pets`
  (GET clínico, escrita presa ao vínculo), `people360` (read model clínico com
  projeção que remove CRM/conta), `search` (pessoas/pets clínicos; agenda e
  conversas operacionais), `encounters` (leitura clínica por id e por
  `petId|contactId|customerId|phone`; escrita inalterada), `bookings`
  (`mode=patient` escopado ao paciente), `overview` (bloco `whatsapp` só com a
  permissão).
- UI: `clientes/page.tsx` (rótulo "Pacientes", busca/contagem/empty-state,
  ações de CRM ocultas), `ClientProfileDrawer` (abas Conversas/Oportunidades e
  observações administrativas só com permissão/fora do recorte clínico; edição
  cadastral e nota administrativas fora do recorte; "Iniciar atendimento" só
  no agendamento do próprio profissional), `Pet360Sheet` (agenda do paciente
  via `mode=patient&petId=`), `dashboard` (card sem métricas de conversa para
  quem não tem a permissão), `atendimento/[encounterId]` (comentário do
  contrato).
- `EncounterWorkspace`/seções: nenhuma mudança de escrita; o read-only alheio
  já era desenhado por `access` (F1) — agora o servidor entrega a leitura com
  `canEditCore=false` e o motivo visível.

## 6. Preparação para IA (sem IA nesta fase)

O histórico longitudinal é lido como lista estruturada de Encounters (data,
autor, seções `clinical` normalizadas: anamnese, avaliação, problemas, conduta,
procedimentos), o que permite no futuro um resumo assistido **revisado pelo
profissional** citando os Encounters-fonte. Nenhum LLM/JEV/OAAS foi
implementado; nada aqui torna o prontuário assinado por máquina.

## 7. Evidência

- Suíte nova `src/lib/__tests__/clinical-access.test.ts` — **22 testes** com as
  rotas reais e banco descartável, cobrindo A–M do contrato (§17), o adversarial
  entre dois tenants e o caso do **Owner com vínculo Professional legítimo**
  (identidade clínica vem do vínculo, nunca do papel administrativo: escreve no
  próprio Encounter e continua barrado no Encounter alheio).
- Suítes existentes alinhadas ao novo contrato (sem afrouxar expectativas):
  `workflow-permissoes`, `f1a-encounter-start-resume`, `fase2-patient360`,
  `homologacao-vet-pet360`.
- Smoke HTTP local (`scripts/seed-clinical-access-qa.mjs` +
  `scripts/smoke-clinical-access.mjs`) — **32 PASS / 0 FAIL** contra servidor
  local real com DB descartável (logins reais dos 5 perfis).
- Gates desta fase: `git diff --check`, `npm run typecheck`, `npm run build`,
  `npx vitest run` (4 falhas baseline conhecidas, sem regressão nova).
- **Browser QA: BLOCKED_BROWSER_ENV** — o sandbox não instala Chromium
  (`npx playwright install chromium` → download failure; cache
  `~/.cache/ms-playwright` vazio). Nenhum QA visual foi inventado.

## 8. Fora do escopo (não implementado)

Agenda UX, date picker, Design System, Coverage/Modalidade, Prescription,
SNCR, Financeiro, IA clínica/JEV/OAAS. Nada disso foi antecipado.
