# Clinical Encounter F1B1 — anamnese da visita, avaliação veterinária e modelo clínico estruturado

**Estado (2026-10-04): IMPLEMENTADO · AUTO-HOMOLOGADO LOCALMENTE (HTTP real) · QA de browser NÃO EXECUTADO (sem Chromium no sandbox — declarado) · PR [#55](https://github.com/HernaniFigueira/instalink/pull/55) ABERTA PARA REVISÃO (`MERGEABLE`, Vercel SUCCESS em `aba4047`) · MERGE NÃO EXECUTADO.**

Base `main` em `e2e2b6379ea2188524c6db8c5d050dab1cc9e5e0` (merge da PR #54, F1A, em produção com Vercel SUCCESS). Branch de sessão `arena/01a10740-instalink`. **Produção não foi usada para QA.**

F1B1 fecha o recorte autorizado: **Encounter em andamento → registrar Queixa → Anamnese DA VISITA → Avaliação clínica veterinária → autosave seguro → sair/retomar → os dados clínicos continuam no MESMO Encounter**. Não é formulário gigante, não é construtor universal, não é prontuário completo: **Problemas, Conduta, Procedimentos e Anexos continuam indisponíveis** (F1B2/fase própria) e **finalização/reabertura/prescrição/exames/documentos/IA/financeiro/estoque não entraram**.

---

## 1. Auditoria clínica existente (§1) — EXISTE · REUTILIZAR · LEGADO · CRIAR

| Conceito | Veredito | Evidência |
| --- | --- | --- |
| **Encounter** (`DB.encounters`, `instalink_doc`) | **EXISTE · REUTILIZAR** | multi-tenant (`businessId`), 1:1 por Booking/fila, vínculo Pet/Tutor/Professional/Service, `version` otimista, autosave e trava de saída do F1A |
| **Queixa / evolução / orientações / retorno / nota interna** | **EXISTE · REUTILIZAR** | campos físicos `complaint · evolution · guidance · followUp · internalNote · tags`; só a **copy** mudou (§6) |
| **AnamneseTemplate / AnamneseResponse** (motor P4) | **EXISTE · LEGADO PRESERVADO (não é o núcleo)** | `src/lib/anamnese.ts`, `src/app/api/anamnese/route.ts`, `AnamneseManager`, `AnamneseFiller`; continuam vivos na rota `/atendimento/[encounterId]/registro`, no Pet 360 e em Estrutura → Fichas |
| **Avaliação / exame clínico / sinais vitais / peso medido / diagnóstico / problema / procedimento** | **NÃO EXISTIA como dado do atendimento** | não havia campo clínico estruturado no Encounter; o único peso do sistema era `Pet.weightKg` (cadastro permanente) |
| **Seções do workspace** | **EXISTE (contrato do F1A) · REUTILIZAR** | `src/lib/encounter-sections.ts` já declara as seções e o `available` |
| **Dado do Pet (espécie, raça, sexo, nascimento, peso do cadastro)** | **EXISTE · REUTILIZAR como contexto de leitura** | `DB.pets`; o workspace mostra e **não copia** |

**Duplicatas evitadas:** não houve segunda entidade de atendimento, segundo motor de anamnese, segunda tabela/coleção clínica nem cópia de dado permanente do Pet para dentro do Encounter.

**Decisão sobre o motor antigo (§8):** a infraestrutura antiga de persistência **não** foi transformada no núcleo do Clinical Encounter. O F1B1 **não** reaproveita `AnamneseTemplate/Response` como modelo da visita (o modelo antigo é de *fichas administrativas configuráveis*, com pergunta-resposta livre e sem versionamento otimista); ele cria o dado da visita **no próprio Encounter** (`Encounter.clinical`) e mantém o legado intacto, sem bridge implícito. Documentado e testado: a nova seção **não grava** em `anamneseResponses` e o motor legado **não grava** em `Encounter.clinical`. Nenhuma ficha antiga foi migrada nesta PR.

---

## 2. Modelo de dados (§11) — ADITIVO, sem DDL

```
Encounter
  ├── (F1A) complaint · evolution · guidance · followUp · internalNote · tags
  └── (F1B1) clinical?: {
        anamnesis: {
          history, diet,
          appetite | waterIntake | urine | stool: 'not_reported' | 'usual' | 'changed',
          vomiting | diarrhea: 'not_reported' | 'yes' | 'no',
          medicationsReported, allergiesReported, observations,
        },
        assessment: {
          veterinary: {
            weightKg | temperatureC | heartRateBpm | respiratoryRateRpm
            | capillaryRefillSeconds: number | null,
            hydration, mucousMembranes, bodyCondition, physicalExam: string,
          },
        },
      }
```

- **Um único source of truth:** `Encounter` continua sendo a raiz. A anamnese da visita é `Encounter.clinical.anamnesis`; a avaliação é `Encounter.clinical.assessment.veterinary` (o objeto `assessment` já nasce **por módulo** — `vet` hoje, outras verticais depois, sem reabrir o modelo).
- **Tenant:** tudo dentro do Encounter (já `businessId`); nenhuma coleção nova, nenhuma rota nova.
- **Versão/auditoria:** a MESMA `version` otimista do Encounter; toda gravação entra em `pushAudit` como `encounter.updated` com `meta.fields` (ex.: `clinical.anamnesis.appetite`, `clinical.assessment.veterinary.temperatureC`). Sem evento por tecla — o autosave só audita mudança real (a rota já compara antes/depois e não cria versão quando nada mudou).
- **Professional responsável:** `Encounter.professionalId` (F1A). Não há segunda identidade clínica.
- **Sem `Pet` duplicado:** `clinical` nunca copia species/breed/sex/birthDate; o peso do cadastro continua em `Pet.weightKg`.
- **Normalização legada:** `normalizeDB` preenche a estrutura vazia para registros anteriores (aditivo, idempotente, sem derivar nada do Pet).

**Validação no servidor (`src/lib/encounter-clinical.ts`, puro):** merge PARCIAL (só a fatia enviada), chaves desconhecidas recusadas (400), opções em lista fechada, números **finitos** com limite **técnico** (não clínico), vazio → `null`. `applyEncounterClinicalPatch` devolve `changedFields` para a auditoria. Não existe faixa clínica, alerta automático, "temperatura alta" ou diagnóstico — **o GoDoutor registra o dado; o profissional interpreta** (§9, §10).

---

## 3. Permanente × visita (§3)

| Dado | Onde vive | Comportamento |
| --- | --- | --- |
| Espécie · raça · sexo · nascimento | `Pet` (cadastro) | mostrado no cabeçalho/contexto como **leitura** |
| Peso do cadastro | `Pet.weightKg` | mostrado na Avaliação como **contexto** ("Peso do cadastro do paciente: 9.4 kg") |
| Peso medido hoje · temperatura · FC · FR · TPC | `Encounter.clinical.assessment.veterinary` | gravado no atendimento; **não** sobrescreve o cadastro |
| Queixa · evolução · orientações · retorno · nota interna | `Encounter` (F1A) | inalterado |
| Alergias/medicações | `Encounter.clinical.anamnesis` ("o que foi relatado NESTA visita") | **não** escreve em `Pet.notes`; promoção a dado permanente é fluxo explícito futuro |

Prova em teste: `f1b1-clinical-visit.test.ts` (§"peso medido hoje...") e QA HTTP (passo 6).

---

## 4. Anamnese da visita (§7)

Campos mínimos aprovados, com controles claros:

- **História atual / evolução do problema** (texto, 4 linhas);
- **Alimentação** (texto);
- **Apetite · Ingestão de água · Urina · Fezes** → `Normal · Alterado · Não informado`;
- **Vômito · Diarreia** → `Sim · Não · Não informado`;
- **Medicações em uso (relatadas nesta visita)** e **Alergias (relatadas nesta visita)**;
- **Observações da anamnese**.

Não há 40 perguntas, não há inferência clínica, não há cópia automática de nada. A tela diz em texto o que esses campos significam.

---

## 5. Avaliação clínica — pacote veterinário (§9)

| Campo | Unidade | Tipo |
| --- | --- | --- |
| Peso | kg | número (vírgula ou ponto na digitação; **número** na persistência) |
| Temperatura | °C | número |
| Frequência cardíaca | bpm | número |
| Frequência respiratória | rpm | número |
| Tempo de preenchimento capilar | s | número |
| Hidratação · Mucosas · Condição corporal | — | texto curto (descrição do profissional) |
| Exame físico / achados gerais | — | texto |

Limites **técnicos** (anti-lixo/overflow): peso 0…100 000; temperatura −273,15…1 000; FC/FR/TPC 0…1 000 000. Eles **não** são faixas clínicas. Texto não numérico **não é gravado**: a seção mostra o erro associado ao campo e preserva o que foi digitado (gate de validação local + validação no servidor).

---

## 6. Seções do workspace (§4) e navegação (§5)

| Seção | Estado | Persistência |
| --- | --- | --- |
| **Atendimento** | `available: true` | `complaint · evolution · guidance · followUp · internalNote · tags` |
| **Anamnese** | `available: true` | `clinical.anamnesis` |
| **Avaliação** | `available: true` | `clinical.assessment.veterinary` |
| Problemas · Conduta · Procedimentos · Anexos | `available: false` — **não renderizadas** | F1B2/fase própria |

Navegação clínica contextual (`nav` do workspace, `aria-current="page"`, superfície neutra, teclado, mobile com rolagem horizontal contida). O cabeçalho continua **sticky**, com o **Pet protagonista** (nome, espécie, raça, idade) e o tutor como contexto (§17) — o header não virou ficha cadastral.

---

## 7. Autoridade única de persistência (§12) — o ponto arquitetural desta PR

O risco do briefing era real: cada seção com autosave "ingênuo" e a sua cópia da versão produz 409 **interno** (Atendimento abre v5 → Anamnese salva v6 → Avaliação ainda manda v5). A solução implementada:

```
EncounterWorkspace (linha + versão + status + conflito)
   └── EncounterWorkspaceBody  ← useEncounterAuthority
         ├── Atendimento  (EncounterCoreSection com `authority`)
         ├── Anamnese     (useClinicalSection → authority.version())
         └── Avaliação    (useClinicalSection → authority.version())
```

- `useEncounterAuthority` (`src/components/dashboard/useEncounterAuthority.ts`) guarda a **linha atual** (`rowRef`, referência síncrona) e a **versão**; qualquer seção pergunta `version()` no instante do save e **publica** a linha confirmada (`publish`), de modo que a versão nova vale imediatamente para todas.
- `useClinicalSection` (`src/components/dashboard/useClinicalSection.ts`) é o único autosave das seções clínicas: um request por vez, debounce, `applySaveResult` (texto novo nunca é sobrescrito pela resposta antiga), **409 → conflito do workspace**, `flush()` que só devolve `true` com persistência confirmada.
- **Um indicador de status** (`encounter-workspace-save-state`: "Salvando… · Salvo agora · Erro ao salvar") e **um bloco de conflito** para o atendimento inteiro; "Continuar editando" / "Recarregar versão atual".
- O `EncounterCoreSection` mantém o contrato do F1A quando usado isolado (testes e legado): sem `authority`, ele segue com a própria versão/indicador/guarda. **Nenhum segundo motor de save foi criado** — todos usam `PATCH /api/encounters`.
- Seções **não** guardam a própria versão: proibido por construção (a versão vem da autoridade).

---

## 8. Dirty state entre seções, saída e autosave (§13, §19)

- **Trocar de seção grava antes:** `goToSection` chama `flush()` da seção ativa; sucesso → troca; falha → **permanece** na seção, com o texto intacto e o erro visível; 409 → permanece e o conflito aparece com as duas saídas explícitas.
- **Sair (Voltar, link do menu, Back do navegador, `beforeunload`)** passa pelo mesmo caminho: `flush` de todas as seções pendentes → só navega com persistência confirmada; falha → não navega, texto preservado e "Sair sem salvar" como escolha explícita no diálogo central. A regra do F1A (P1) continua íntegra e agora vale para as três seções.
- Sem botão "Salvar" obrigatório em nenhuma seção; o status fica visível.

---

## 9. Permissões de escrita clínica (§14, §15, §16)

Regra implementada no **servidor** (`encounterClinicalAccess`, usada no `PATCH` e devolvida na leitura como capacidade para a UI não mentir):

| Quem | Conteúdo clínico (núcleo + anamnese + avaliação) |
| --- | --- |
| **Profissional responsável vinculado** (`Professional.userId === ator` **e** `Professional.id === Encounter.professionalId`) | **edita** enquanto `in_progress` |
| **Owner/Admin sem vínculo Professional** | **não edita** (403) — papel administrativo não é identidade clínica; continua lendo/iniciando |
| **Owner/Admin que É o profissional responsável** | edita como profissional (não como papel) |
| **Recepção (`SECRETARIA`)** | não lê nem escreve (403) |
| Outro profissional da mesma unidade | não vê (403) e não edita |
| Outra unidade | 404 (nada cruza a fronteira) |
| Registro `finalized` | leitura; edição depende da reabertura (F1C) |
| Encounter **sem Pet válido no tenant** | **não grava dado clínico** (409, inclusive anamnese) — vínculo revalidado no servidor |

Consequências documentadas (honestas): (a) um Encounter **legado sem `professionalId`** (anterior ao F1A) fica sem escrita clínica até ganhar responsável — leitura preservada; (b) o **Owner solo sem vínculo Professional** passa a precisar do vínculo para editar conteúdo clínico — é exatamente a regra pedida. **`disabled` de frontend nunca é a segurança**: o servidor impõe a regra e a UI apenas reflete a capacidade devolvida pela leitura.

F1B1 **não** implementa coautoria/reassinatura: um atendimento tem um profissional responsável; colaboração fica para depois.

---

## 10. O que NÃO entrou (§20–§25)

- Finalização/revisão/imutabilidade/nota complementar → **F1C** (nenhum botão novo de finalizar foi exposto; o workspace segue em andamento).
- Problemas/hipóteses/diagnósticos, Conduta estruturada, Procedimentos, Anexos → **F1B2/fase própria** (seções declaradas e não renderizadas).
- Prescrição, atestado, pedido de exame, assinatura, PDF clínico, financeiro, comanda, estoque, IA (nem botão) → fora.
- Legado preservado: `/atendimento/[encounterId]/registro` (EncounterSheet intacto), `/api/anamnese`, `AnamneseManager`/`AnamneseFiller`, Pet 360, histórico 360 — **nada apagado, nada migrado**.
- Sem DDL, sem migration, sem rename físico, sem big-bang.

---

## 11. Testes e QA (§26–§32)

- **Domínio (`src/lib/__tests__/f1b1-clinical-visit.test.ts`, 22 casos):** seções reais/copy clínica · legado normaliza vazio · peso do Pet intacto · **A** sem Pet válido não grava · **B** profissional diferente não edita · **C** Owner sem vínculo não edita · **D** Recepção não edita · **E** responsável edita · **F** cross-tenant 404 · **G/H** anamnese e avaliação no mesmo `encounterId` · **I/J** versão compartilhada (versão velha = 409; versão publicada = sem 409 interno) · **K** concorrência externa = 409 real · **L** retry preserva o texto · **M** legado sem campos novos normaliza · validação (texto-como-número, limite técnico, chave desconhecida, merge parcial) · finalizado fechado · legado vivo.
- **Componente (`src/components/__tests__/f1b1-clinical-sections.test.tsx`, 9 casos, jsdom sobre os componentes REAIS):** rótulos/unidades/opções · payload com **número** (8,9 → 8.9) e fatia por seção · versão vinda da autoridade · 409 não apaga o texto local · texto inválido **não** é gravado (erro associado) · bloqueio de escrita desabilita e explica · **troca de seção grava antes; falha não troca; 409 mantém as duas saídas e preserva o texto**.
- **QA HTTP real (`tests/f1b1/http-qa.mjs`, 16/16 PASS):** servidor `next start` local + banco descartável `.cache/f1b1/qa.json` + **login real** (Michelle/Profissional, Owner, Maria/Recepção, profissional de outra unidade) + seed `scripts/seed-f1b1-qa.mjs`. Cobre: iniciar → queixa → anamnese (versão sobe uma vez) → avaliação com a versão nova (sem 409 interno) → sair → retomar (mesmo id) com TODOS os dados → peso do Pet intacto → 409 real sem sobrescrita → retry → Owner 403 → Recepção 403 → cross-tenant 404 → validações 400 → rota legada viva. **0 5xx inesperado**; 403/404/400 provocados pela própria QA, documentados.
- **QA de browser (`tests/f1b1/qa.mjs`, NÃO EXECUTADO):** script pronto (Chromium real) para rodar onde há browser, cobrindo Agenda → iniciar/retomar → 3 seções → F5 → 1440/1280/1024/390 → console/rede. **O sandbox desta sessão não tinha Chromium instalável**: `npx playwright install chromium` falhou com `ECONNRESET` em `cdn.playwright.dev`, `@puppeteer/browsers` falhou em `googlechromelabs.github.io`, e os mirrors do Debian estão inacessíveis (`apt-get update` com falha de conexão) — **nenhuma homologação visual é declarada**, e os viewports/console/rede do browser seguem pendentes de execução real.
- **Gates desta PR:** `git diff --check` · `npm run typecheck` · `npm run build` · `npx vitest run` com as **4 falhas baseline intocadas** (3× `a34-instagram`, 1× `automation-audit-p4`), sem `skip`/`only`/`todo` e sem enfraquecer expectativa.

**Contratos legados ajustados com o produto como autoridade (declarado):** (a) `a34-encounter` — as provas de concorrência/versão e a edição após reabertura passam a escrever **como o profissional responsável** (Dra. Bia), e o caso do ADMIN ganhou a asserção nova: reabrir é administrativo, **escrever conteúdo clínico exige vínculo** (403) e o responsável edita; (b) `a34-encounter-integrity` — a clínica do cenário é solo, então o **Proprietário é o profissional responsável vinculado** (fixture explícita); (c) `encounter-core-save-guard` — o rótulo do campo é a copy clínica nova (`Evolução clínica`); (d) `f1a-encounter-start-resume` — as seções reais agora são três; (e) `encounter-core-section` — a cerca estrutural passa a valer também para o corpo do workspace. **Nenhuma expectativa enfraquecida.**

---

## 12. Revisão independente (§30)

| Risco a provar | Veredito | Evidência |
| --- | --- | --- |
| Dados desaparecem ao trocar de seção | **Encontrado na 2ª passagem · CORRIGIDO** | (1) a troca de seção consultava um registro PARALELO de seções e não a autoridade — a Anamnese podia ser trocada sem flush; (2) `unregisterSection` zerava o flag de "pendente", então o re-registro da seção apagava o sinal de quem estava digitando (o rodapé chegava a dizer "Salvo agora" com texto pendente). Correções: `authority.registeredSection(id)` é a única fonte da troca, o flag de pendente só é zerado no DESMONTE real, e a identidade de `onSaved` é estável. Coberto por testes nos DOIS sentidos (Atendimento→Anamnese e Anamnese→Avaliação, sucesso e falha) e pelo teste do indicador |
| Seção usa versão antiga | **Não reproduzido** | a versão vem de `authority.version()`; teste I/J + QA HTTP passo 4 |
| Owner escreve clínica sem ser Professional | **Não reproduzido** | 403 no servidor + teste C + QA HTTP passo 8 |
| Recepção escreve | **Não reproduzido** | 403 (permissão + papel) + teste D + QA HTTP |
| Profissional de outro Encounter escreve | **Não reproduzido** | escopo do profissional (403) + teste B |
| Tenant leak | **Não reproduzido** | 404 em leitura e escrita + teste F + QA HTTP |
| Campos permanentes do Pet duplicados | **Não reproduzido** | `clinical` só guarda o da visita; Pet intacto (teste + QA passo 6) |
| Duas fontes de anamnese divergentes | **Não reproduzido** | uma só raiz (`Encounter.clinical`); o motor legado fica na rota antiga e não é alimentado |
| Workspace voltou a carregar o legado | **Não reproduzido** | cerca estrutural em teste; `EncounterSheet` byte-idêntico na rota `/registro` |
| F1B2/F1C entrou escondido | **Não reproduzido** | seções indisponíveis não renderizam; `clinical` recusa chaves desconhecidas (problemas/diagnóstico = 400) |
| 409 sobrescreve texto | **Não reproduzido** | 409 não publica, não navega e não apaga o rascunho (teste + QA HTTP passo 7) |
| Autosave perde campo | **Não reproduzido** | merge parcial por fatia + `applySaveResult` (teste de merge + I/J) |

Limite declarado: a revisão foi **estática + automatizada + HTTP real**; **não houve inspeção visual em browser** nesta sessão.

---

## 13. Decisões adiadas para B2/C (explícitas)

- **F1B2:** Problemas/hipóteses/diagnósticos, Conduta estruturada (plano/medicações/procedimentos), Procedimentos, Serviço → Procedure (com auditoria de estoque/financeiro), Anexos.
- **F1C:** finalização, revisão, imutabilidade, nota complementar, reabertura, assinatura e via do cliente revisada; decidir se `canFinalize` passa a considerar o dado clínico novo.
- **Depois:** colaboração/reassinatura clínica, promoção explícita de dado da visita → cadastro permanente, integração do motor antigo de fichas com o Clinical OS (ou descontinuação planejada), especialidades (odontologia/estética) por SEÇÕES.
