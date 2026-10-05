# Clinical Encounter F1C — finalização, imutabilidade e histórico

## Auditoria prévia

O Encounter existente já tinha `status`, `version`, `finalizedAt`, `finalizedBy`, `signedBy`, `PATCH action=finalize/reopen`, `DELETE` e auditoria administrativa. O `EventLog`/workflow carregava IDs, estados e metadados, mas não before/after nem conteúdo clínico. Portanto, não era possível reconstruir com segurança o documento finalizado: EventLog sozinho não era suficiente. A reabertura anterior também voltava o mesmo objeto a `draft`, sem preservar snapshot.

O workspace canônico é `/atendimento/[encounterId]`; a rota legada `/registro` permanece compatibilidade. `useEncounterAuthority` continua sendo a autoridade única de versão e `useClinicalSection` continua responsável pelo flush das seções.

## Modelo de revisão

O DB ganhou, de forma aditiva e sem DDL:

- `encounterFinalizationRevisions[]`: `id`, `businessId`, `encounterId`, `revisionNumber`, `encounterVersion`, `finalizedAt`, `finalizedByUserId`, `finalizedByProfessionalId`, snapshot profundo e fingerprint SHA-256.
- `encounterAddenda[]`: `id`, `businessId`, `encounterId`, `revisionId`, autoria profissional, texto e `createdAt`.
- `Encounter.finalizationRevisionId` aponta para a revisão atual sem transformar revisão em uma segunda entidade de atendimento.

O snapshot é uma cópia profunda dos campos de identidade, paciente/tutor, serviço, profissional, datas, conteúdo do núcleo, retorno, tags/files, `clinical` F1B1/F1B2, versão e metadados de finalização. Não inclui segredos. A revisão anterior nunca é sobrescrita nem removida.

## Contratos

### Finalização

- Só o Professional ativo vinculado por `Professional.userId` ao usuário responsável pode executar a finalização clínica. Owner/Admin sem vínculo clínico, Recepção, outro Professional e cross-tenant são recusados pelo servidor.
- A UI usa **Revisar e finalizar**: mostra paciente, profissional, data e os blocos preenchidos/vazios. O botão primário só envia a transição depois de `flushAll()` confirmado.
- A transição exige `expectedVersion`; stale finalize retorna 409. A transição não aceita conteúdo clínico junto: payload de `action=finalize` não é um PATCH de conteúdo.
- `idempotencyKey` reutilizada após commit devolve o mesmo Encounter sem criar nova revisão ou novo audit event.
- Cada finalização cria snapshot, incrementa versão e registra `encounter.finalized` com revisão, versão, ator e chave de idempotência.
- Campos clínicos obrigatórios artificialmente não foram adicionados; a validação técnica existente de conteúdo mínimo permanece documentada.

### Read-only e adversarial API

O servidor recusa qualquer PATCH de conteúdo quando `status=finalized`, incluindo `clinical`, tags, files, retorno e textos. `finalize` e `reopen` processam exclusivamente sua transição e ignoram campos clínicos piggyback. DELETE de Encounter finalizado também é bloqueado: o documento é histórico.

### Nota complementar

`action=addendum` exige atendimento finalizado, versão esperada e o Professional responsável. Cria nova entrada append-only vinculada à revisão atual, incrementa a versão e audita `encounter.addendum_added`. Não edita nem apaga texto anterior; não há endpoint de edição/remoção. Owner/Admin sem Professional, Recepção, outro Professional e cross-tenant não ganham autoria clínica.

### Reabertura

A regra administrativa existente é preservada: Owner/Admin/Master podem executar a transição administrativa, sem ganhar escrita clínica. O motivo textual é obrigatório, com limite técnico; a operação exige versão e registra `encounter.reopened`, incluindo motivo e revisão anterior. Reabrir não altera o snapshot nem o conteúdo. Depois, somente o Professional responsável volta a editar conforme B1/B2. A nova finalização recebe novo `revisionNumber`.

## Histórico / prontuário

A leitura por ID devolve o mesmo Encounter e também `finalizationRevisions`, `addenda` e reaberturas. A lista de histórico existente de Cliente/Pet 360 continua apontando pelo mesmo `encounterId`; drafts seguem como registros em andamento e finalizados podem ser abertos na rota canônica, onde ficam READ-ONLY. Não foi criada uma segunda página ou entidade de prontuário.

## Matriz de permissões

| Ator | Ler no escopo | Editar draft | Finalizar | Addendum | Reabrir |
|---|---:|---:|---:|---:|---:|
| Professional responsável | sim | sim | sim | sim | não pela regra atual |
| Owner/Admin sem vínculo Professional | sim | não | não | não | sim, administrativo, com motivo |
| Recepção | conforme permissão de atendimento | não | não | não | não |
| Outro Professional | conforme escopo | não | não | não | não |
| Cross-tenant | não | não | não | não | não |

## Decisões adiadas / fora do escopo

Prescrição, exames estruturados, receita, Document Engine, assinatura digital, anexos, financeiro, estoque, cirurgia, internação, odontograma, estética, IA/Jev e telemedicina não entraram. O histórico longitudinal não foi redesenhado; apenas reutiliza a superfície existente e a rota canônica.

## Revisão pós-implementação

A finalização não usa a versão do render: depois do `flushAll()` confirmado, lê `authority.version()`. A resposta de finalize, addendum e reopen é publicada por `authority.publish(serverRow)`, mantendo rowRef, estado da UI, seções e cabeçalho na mesma fonte de verdade. O teste jsdom `f1c-finalization-panel.test.tsx` simula dirty v10 → flush v11 → finalize e prova que o request usa v11.

A timeline é uma projeção única ordenada por timestamp, combinando revisão, addendum e reabertura. O Pet 360 já filtrava por `petId`, mas o clique de histórico apontava para a superfície legada; F1C corrigiu o menor ponto necessário para apontar para `/atendimento/[encounterId]`.

## Gates e QA

Testes de domínio/API devem cobrir autoria, tenant, flush, 409, read-only, snapshot, retry idempotente, addendum append-only, reabertura preservada e timeline. QA local deve usar banco descartável, logins reais e Chromium nos viewports 1440/1280/1024/390. A validação final desta entrega é registrada no PR após executar os gates do repositório; browser/produção não são presumidos a partir de testes estáticos.

## Post-review correction 2026-10-05 — idempotência, tenant e capacidades

- `PATCH /api/encounters` agora retorna resultado transacional explícito para a
  finalização; `publishWorkflowEvent` só é chamado quando a transição ocorreu
  nessa transação. Retry com a mesma idempotency key preserva revision, audit,
  automation run e version.
- `currentRevision`, revisions e addenda exigem simultaneamente `businessId` e
  `encounterId`; foi adicionada regressão com registro artificial de outro tenant.
- A view server-derived agora expõe `canAddendum`; a UI não apresenta editor de
  addendum sem essa capacidade e só apresenta o motivo/botão de reopen quando
  `canReopen` é verdadeiro.
- A reprodução pré-correção confirmou duas chamadas de `publishWorkflowEvent`
  para o primeiro finalize + retry idempotente; a regressão pós-correção confirma
  uma chamada.

## Post-review correction 2026-10-05 — finalized addendum capability

`canAddendum` now uses the canonical server-side `isResponsibleProfessional`
authority and additionally requires `status === 'finalized'`. It is independent
from `canEditCore`, so finalized clinical content remains immutable while the
responsible active Professional can add append-only notes. API and UI regressions
cover the positive responsible-Professional path and negative administrative,
reception, other-Professional, and cross-tenant paths.

## Post-review correction 2026-10-05 — canonical response history

Storage was correct: finalize/addendum/reopen persisted revisions, addenda and
reopen audit entries. The browser defect was the response shape: history was
returned beside `encounter`, while the authority publishes `data.encounter`.
The response helper now enriches the Encounter itself, so GET and PATCH return
`encounter.finalizationRevisions`, `encounter.addenda` and
`encounter.reopenEvents` with tenant filtering intact.

The review modal now labels the booking date/time as `Agendado para` and moves
initial focus to its heading; existing dialog keyboard handling remains in use.
