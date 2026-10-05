# Clinical Encounter F1B2 — problemas, conduta e procedimentos

**Data:** 2026-10-05 · **Recorte:** F1B2 (empilhado sobre o F1B1) · **F1B1:** congelado em `11021c2521aabd456f6531ca3b714fe7b5b1e1e9` (PR [#55](https://github.com/HernaniFigueira/instalink/pull/55) OPEN, Vercel SUCCESS, **merge NÃO executado**)

Este documento descreve o que o F1B2 acrescenta ao registro clínico da visita. Ele **não altera** `docs/CLINICAL-ENCOUNTER-F1B1.md`: o que estava congelado continua descrito lá, e os pontos em que o F1B2 **atualiza um contrato declarado pela B1** estão listados na seção [Contratos da B1 atualizados](#contratos-da-b1-atualizados-declarado).

---

## 1. Escopo

### Entrou (o recorte autorizado)

O registro do atendimento passa a cobrir o raciocínio e a ação clínica, no **mesmo `Encounter`**, na mesma versão, com a mesma autoridade e as mesmas permissões da B1:

1. **Problemas / hipóteses / diagnósticos** — `Encounter.clinical.problems`
2. **Conduta (plano clínico)** — `Encounter.clinical.plan.conduct`
3. **Procedimentos realizados neste atendimento** — `Encounter.clinical.procedures`

Fluxo completo na vertical veterinária: **Atendimento → Anamnese → Avaliação → Problemas → Conduta → Procedimentos** (seis seções reais).

### NÃO entrou (e não entrou escondido)

Finalização, revisão, imutabilidade, nota complementar, prontuário final, prescrição, receita, pedido de exame estruturado, atestado, assinatura digital, Document Engine, financeiro, comanda, estoque, comissão, IA clínica, cirurgia, internação, odontograma, estética, **Anexos** (segue `available: false`) e **F1C**.

Prescrição e pedidos de exame continuam **texto livre** dentro da conduta — não existe campo estruturado, e a própria UI diz isso ao profissional.

---

## 2. Auditoria prévia (antes de criar)

Nenhuma entidade nova foi criada sem procurar o que já existia:

| Conceito | Achado | Decisão |
|---|---|---|
| Problema / hipótese / diagnóstico | **Não existe.** `Encounter.tags` é etiqueta livre; `AnamneseTemplate/Response` é o motor legado de fichas; não há campo de diagnóstico em `types.ts` | **CRIAR** `clinical.problems` |
| Conduta / plano | `evolution` (o que aconteceu), `guidance` (orientações ao tutor), `followUp`/`followUpMode`/`followUpDate`/`followUpDays` (retorno) e `internalNote` são núcleo F1A/F1B1 | **REUTILIZAR** como estão + **CRIAR** `clinical.plan.conduct` (não existia campo de plano) |
| Procedimento realizado | `Service` (`src/lib/types.ts:533`) e o grupo "Procedimentos" de `src/lib/vet-service-catalog.ts` são **catálogo/agenda**, não procedimento realizado | **CRIAR** `clinical.procedures`, sem vínculo obrigatório com catálogo |
| Serviço → procedimento | Conversão automática não existe e **não foi criada** | **NÃO CONVERTER** |

Nenhum Service virou Procedure; nenhum Procedure exige Service.

---

## 3. Modelo de dados

Aditivo, zero DDL, zero migração, dentro de `Encounter.clinical` (a estrutura da B1):

```ts
type ClinicalProblemKind = 'problem' | 'hypothesis' | 'diagnosis';

interface ClinicalProblemItem {
  id: string;          // identidade estável: /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
  kind: ClinicalProblemKind;
  label: string;       // 1..200
  notes: string;       // 0..1000
}

interface ClinicalCarePlan { conduct: string }        // 0..4000

interface ClinicalProcedureItem {
  id: string;          // mesmo contrato de id
  name: string;        // 1..200
  notes: string;       // 0..1000
}

interface EncounterClinicalData {
  anamnesis: …;         // B1
  assessment: …;        // B1
  problems: ClinicalProblemItem[];       // F1B2
  plan: ClinicalCarePlan;                // F1B2
  procedures: ClinicalProcedureItem[];   // F1B2
}
```

### Regras impostas pelo servidor

| Regra | Comportamento |
|---|---|
| Tipo de problema | apenas `problem` / `hypothesis` / `diagnosis` — **fora da lista = 400** |
| Identidade | `id` obrigatório, formato fixo, **duplicado = 400**; o índice do array nunca é identidade |
| Textos | `label`/`name` vazios = 400; acima do limite são **truncados** (sanitização declarada) |
| Teto de itens | `problems` 30 · `procedures` 40 — **exceder = 400** (nunca truncar em silêncio) |
| Chave desconhecida | **400** (`cid10`, `price`, `prescription`, `attachments`…) — nada de seção futura ligada em silêncio |
| Payload parcial | preserva as outras seções (merge por ramo, como na B1) |
| Legado | documento sem os campos novos normaliza **vazio** — nenhum diagnóstico derivado de texto antigo |
| Vocabulário | **sem** CID/CIAP/SNOMED, **sem** IA, **sem** classificação automática: o tipo é escolha do profissional |

Dois caminhos, propositalmente diferentes:

- `normalizeProblemList` / `normalizeProcedureList` — **totais e idempotentes** (leitura de legado nunca quebra; item inválido é descartado);
- `parseClinicalProblems` / `parseClinicalProcedures` — **estritos** (escrita: item inválido = 400 com mensagem).

`EMPTY_ENCOUNTER_CLINICAL` inclui `problems: []`, `plan: { conduct: '' }`, `procedures: []`.

### Decisões adiadas (documentadas, não esquecidas)

- **`status` do problema** (ativo/resolvido) — não entrou: exige contrato de ciclo de vida e UI própria.
- **`performedAt` do procedimento** — não entrou: exige decisão de fuso/horário por tenant (a Agenda Temporal já tem esse contrato; copiar pela metade seria pior).
- **Vínculo opcional com o catálogo** — hoje é *autocomplete* de nome (texto livre continua valendo); um vínculo por `id` de catálogo fica para quando houver motivo clínico/operacional.

---

## 4. Seções e vertical

`src/lib/encounter-sections.ts` continua sendo a **autoridade única** de módulos por `Business.clinicType` normalizado — nenhum `if (clinicType === …)` foi espalhado (nem nos componentes novos).

| Seção | Módulo | Ordem | Disponível |
|---|---|---|---|
| Atendimento | `core` | 10 | sim (universal) |
| Anamnese | `vet` | 20 | sim |
| Avaliação | `vet` | 30 | sim |
| **Problemas** | `vet` | 40 | **sim (F1B2)** |
| **Conduta** | `vet` | 50 | **sim (F1B2)** |
| **Procedimentos** | `vet` | 60 | **sim (F1B2)** |
| Anexos | `core` | 70 | não (fase própria) |

**Decisão explícita:** as três seções novas ficam **apenas em `veterinaria`** nesta fase. Segurança antes de abstração prematura — odonto/estética/médica não têm contrato de paciente/procedimento próprio fechado, e ligar o pacote nelas por inferência seria exatamente o erro que a vertical proíbe. Quando a abstração de paciente da especialidade for fechada, o caminho é parametrizar o módulo (não duplicar `if`).

`CLINICAL_BRANCH_MODULES` mapeia os cinco ramos de `clinical` (`anamnesis`, `assessment`, `problems`, `plan`, `procedures`) → `vet`, e a rota impõe isso no servidor.

---

## 5. Permissões

**A mesma regra da B1, sem segunda definição:** escrita de conteúdo clínico exige o **profissional responsável vinculado** ao atendimento. `ENCOUNTER_CONTENT_FIELDS` / `writesEncounterContent` **não foram tocados** — `clinical` já estava no gate, então os três ramos novos nascem cobertos.

Três capacidades novas, resolvidas **no servidor** e devolvidas na leitura (`access`):

- `canEditClinicalProblems`
- `canEditCarePlan`
- `canEditClinicalProcedures`

Cada uma = módulo `vet` ativo na vertical **e** Pet válido no tenant **e** usuário = profissional responsável. `CLINICAL_BRANCH_CAPABILITIES` liga ramo → capacidade, e a rota recusa em laço (não há `if` por campo).

| Quem | Leitura | Escrita B2 |
|---|---|---|
| Profissional responsável | 200 | **200** |
| Owner/Admin sem vínculo Professional | 200 (vê as 6 seções) | **403** |
| Recepção (`SECRETARIA`) | 403 | **403** |
| Outro profissional da mesma unidade | 200 | **403** |
| Outro tenant | 404 | **404** |
| Encounter finalizado | leitura | recusa (mesmo contrato da B1) |

Request recusado não toca dado, versão nem auditoria (provado byte a byte no QA).

---

## 6. Versionamento, flush e concorrência

- **Uma versão por Encounter** (`useEncounterAuthority`, inalterada). B1 → B2 é sequencial: v8 → v9 → v10…, **sem 409 interno** (provado no domínio, no HTTP e no browser).
- **Flush na troca de seção** (`useClinicalSection`, inalterado): gravar antes de navegar; falha **não** navega e o texto permanece.
- **409 real** entre duas telas: aviso no workspace, texto local preservado, **sem merge automático** e sem sobrescrita; "Continuar editando" mantém o texto, "Recarregar versão atual" adota o servidor.
- Autosave com debounce compartilhado (`ENCOUNTER_AUTOSAVE_MS`): **uma digitação = uma gravação** (nenhum evento por tecla).

---

## 7. Auditoria

`encounter.updated.meta.fields` continua granular e sem duplicata:

- `clinical.problems`
- `clinical.plan.conduct`
- `clinical.procedures`

O rótulo coarse `clinical` nunca aparece. Payload misto produz, por exemplo, `['evolution', 'clinical.anamnesis.appetite', 'clinical.problems', 'clinical.plan.conduct']`. Reenvio idêntico não sobe versão nem cria auditoria.

---

## 8. UX

**Problemas** — lista compacta (não cards): tipo (Problema/Hipótese/Diagnóstico) + descrição + observação opcional, um botão "Adicionar problema". Linha ainda sem descrição **não é gravada** (não vira item vazio no servidor).

**Remoção em dois passos na própria linha** — sem `window.confirm` (o diálogo nativo some do fluxo de teclado): o botão passa a mostrar "Remover “X”?" com **Confirmar remoção** / **Cancelar**. Item vazio sai direto.

**Conduta** — campo único "Plano / conduta clínica" (`clinical.plan.conduct`). Orientações ao tutor e Retorno aparecem **em leitura** como contexto (`plan-context`, sem nenhum input) com a origem declarada: são editados na seção Atendimento. **UM lugar por conceito** — não existe segunda "Orientações ao tutor" editável, e nenhuma realocação de campo físico foi feita.

**Procedimentos** — lista compacta (nome + observação opcional), adicionar rápido, sem modal. `<datalist>` com o catálogo veterinário (grupos Procedimentos/Exames) como **sugestão opcional**; texto livre continua sendo o caso normal.

**Acessibilidade** — rótulos reais (`Tipo do problema 1`, `Descrição do problema 1`, `Observação do problema 1`, `Nome do procedimento 1`…), botão de remover com nome acessível que diz o que some (`Remover Diagnóstico: Otite externa direita`), `aria-current="page"` na seção ativa, escrita bloqueada com motivo visível e campos desabilitados.

---

## 9. Efeitos colaterais

Registro de procedimento **não** gera: pedido, cobrança, conta a receber, lançamento financeiro, tarefa, baixa de estoque, comissão, produto, alteração de Booking ou de Service. Provado por snapshot antes/depois de `orders`, `financeEntries`, `tasks`, `bookings` e `services` (domínio + HTTP + browser).

---

## 10. Testes e QA

| Gate | Resultado |
|---|---|
| `git diff --check` | limpo |
| `npm run typecheck` | 0 erros |
| `npm run build` | ✓ `Compiled successfully` · 135/135 páginas |
| `npx vitest run` | **3191 PASS / 4 FAIL (3195)** — as 4 falhas são exatamente o baseline intocado (3× `a34-instagram`, 1× `automation-audit-p4`) |
| Recorte focado (7 arquivos) | 144/144 |
| QA HTTP F1B2 (`tests/f1b2/http-qa.mjs`) | **16/16**, 0 5xx inesperado, 26 respostas provocadas documentadas |
| QA HTTP F1B1 (regressão) | **21/21**, 0 5xx inesperado |
| QA browser F1B2 (`tests/f1b2/qa.mjs`) | **21/21**, console 0 erro inesperado, rede 0 resposta ≥400 inesperada e 0 5xx |
| QA browser F1B1 (regressão) | **29/29**, console 0, rede 0 inesperada |

Novas suítes: `src/lib/__tests__/f1b2-clinical-record.test.ts` (29) e `src/components/__tests__/f1b2-clinical-sections.test.tsx` (16). Sem `skip`/`only`/`todo`, sem expectativa enfraquecida.

Browser QA em **Chromium real 153.0.8010.0** (Playwright 1.63), 1440/1280/1024/390, contra `next start` + banco descartável.

### Como reproduzir

```bash
npm ci
npm i -D @sparticuz/chromium@153.0.0        # CDNs de browser são bloqueadas no sandbox
node .cache/browser/provision-chromium.mjs  # extrai binário+libs do pacote (descartável)
node scripts/seed-f1b1-qa.mjs && node scripts/seed-f1b2-qa.mjs
GODOUTOR_DB_FILE=.cache/f1b1/qa.json npm run start -- -p 3111 -H 0.0.0.0

QA_BASE_URL=http://127.0.0.1:3111 node tests/f1b2/http-qa.mjs
LD_LIBRARY_PATH=.cache/browser/root/lib FONTCONFIG_PATH=.cache/browser/root \
TMPDIR=.cache/browser/tmp QA_EXECUTABLE_PATH=.cache/browser/root/chromium \
QA_BASE_URL=http://127.0.0.1:3111 node tests/f1b2/qa.mjs
```

`scripts/seed-f1b2-qa.mjs` é **aditivo** ao fixture do F1B1: dá login ao profissional `pro-outro-a` (Orlando) para provar, com sessão real, que **outro profissional da mesma unidade** não escreve no atendimento alheio. `@sparticuz/chromium` é ferramenta de QA local e **não** entrou no `package.json` versionado.

Cada rodada de QA parte de fixture limpa (os scripts exigem isso em vez de afrouxar afirmação).

---

## 11. Revisão independente — 13 hipóteses

Cada hipótese foi atacada de novo, do zero, com evidência verificável:

| # | Hipótese | Veredito | Evidência |
|---|---|---|---|
| H1 | B2 alterou decisão congelada da B1 | **FALSA** | `git diff 11021c2 -- src/app/api/encounters/route.ts \| grep ENCOUNTER_CONTENT_FIELDS\|writesEncounterContent` → vazio; `useClinicalSection.ts`, `useEncounterAuthority.ts`, `EncounterSectionChrome.tsx` → diff vazio |
| H2 | Diagnóstico some ao trocar de seção | **FALSA** | domínio "payload parcial preserva as outras seções"; browser QA §33 (sair → F5 → retomar, 6 seções conferidas campo a campo) |
| H3 | Procedimento grava com versão antiga | **FALSA** | `versionOf()` vem de `authority.version()`; QA HTTP "6 seções… v+1 a cada uma"; browser QA usa a autoridade real |
| H4 | Owner escreve conteúdo B2 | **FALSA** | domínio (Owner/Recepção/Caio/cross-tenant); QA HTTP "permissão imposta no servidor"; browser QA adversarial 3× 403 + dado intacto |
| H5 | Procedimento cria cobrança/estoque/comissão | **FALSA** | `sideEffects()` idêntico antes/depois (`orders`, `financeEntries`, `tasks`, `bookings`, `services`) no domínio e no QA HTTP |
| H6 | Service do agendamento virou Procedure | **FALSA** | nenhum `serviceId`/`booking` nos três componentes; QA HTTP confere que nenhum nome de Service aparece em `procedures` e que o catálogo não muda |
| H7 | Índice do array virou identidade | **FALSA** | `key={item.id}`, `map`/`filter` por `id`, `newClinicalItemId('prb'\|'proc')`; domínio "reordenar preserva id"; browser QA confere o id remanescente após remoção |
| H8 | Odonto/estética recebe o pacote B2 | **FALSA** | `CLINICAL_BRANCH_MODULES` só `vet`; QA HTTP (400 nos 3 ramos, CORE editável); browser QA (0 abas, 0 `[data-section]`) |
| H9 | Ocultar a vertical apaga o dado | **FALSA** | domínio "esconder a vertical NÃO apaga dado B2 já gravado" (volta a `veterinaria` com tudo no lugar); QA browser B1 §13 adversarial |
| H10 | Orientações ao tutor duplicada | **FALSA** | `ENCOUNTER_LABELS.guidance` é a única fonte; `plan-context` tem **0** `input/textarea/select`; browser QA: exatamente 1 campo rotulado no Atendimento |
| H11 | 409 sobrescreve o servidor | **FALSA** | domínio + QA HTTP + browser QA: 409 com aviso, texto local preservado, servidor mantém o valor da outra tela, retry com a versão atual grava |
| H12 | F1C entrou escondido | **FALSA** | nenhum `finalize`/`prescription`/`document`/`signature`/`invoice` nos arquivos novos; Anexos segue `available: false`; `resolveEncounterSection('anexos','veterinaria')` cai em `atendimento` |
| H13 | Segunda engine de versão / evento por tecla | **FALSA** | `useClinicalSection`/`useEncounterAuthority` inalterados; debounce único (`ENCOUNTER_AUTOSAVE_MS`); QA browser B1 "uma digitação = UMA gravação"; QA F1B2: 18 PATCH no fluxo inteiro |

---

## 12. Contratos da B1 atualizados (declarado)

O pacote veterinário passou de 3 para 6 seções reais. Quatro afirmações que fixavam "exatamente três" foram **atualizadas para a nova realidade, sem afrouxar** (continuam listas exatas):

- `src/lib/__tests__/f1b1-clinical-visit.test.ts` — seções disponíveis e `clinicalBranchesForClinic('veterinaria')`
- `src/lib/__tests__/f1a-encounter-start-resume.test.ts` — seções reais; o exemplo de "seção indisponível" passou de `problemas` para `anexos`
- `src/components/__tests__/f1b1-clinical-sections.test.tsx` — navegação do workspace
- `tests/f1b1/qa.mjs` e `tests/f1b1/http-qa.mjs` — navegação (6), `aria-current` (1 ativa / 5 não) e o caso de "ramo fora do contrato" (que usava `problems`, agora real → passou a usar `attachments`)

Nenhum comportamento da B1 foi alterado; nenhuma expectativa foi removida.

---

## 13. Legado

`/atendimento/[encounterId]/registro`, `/api/anamnese`, `AnamneseTemplate`/`AnamneseResponse` e o histórico continuam intactos — sem migração em massa, sem big-bang, sem campo físico renomeado por copy, sem identificador `il-*` novo. Documento antigo sem os campos novos simplesmente normaliza vazio.
