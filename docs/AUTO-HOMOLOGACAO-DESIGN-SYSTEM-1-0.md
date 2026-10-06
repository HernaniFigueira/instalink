# GoDoutor Design System 1.0 — App Shell e Agenda UX (relatório de fase)

## Base e limites

- 2026-10-05. Branch de sessão `arena/01a10c9e-instalink`, **empilhada** sobre o topo da
  PR #61 (`5cc1a88`, `OPEN`) por autorização explícita do responsável — sem merge, sem PR
  paralela, sem tocar `main`.
- Regra de negócio, autoridade, tenant, permissões, Clinical Access, Encounter F1,
  booking authority, finalização/revisão/addendum/reabertura: **intocados**. O que mudou é
  apresentação (tokens, componentes canônicos, shell, navegação e as superfícies abaixo).
- Nenhum merge. Nenhum acesso a produção, banco remoto, dados reais ou exclusão de dados.

## Entrega

**1 · Fonte única de verdade visual.** `src/styles/godoutor-design-system.css` concentra os
tokens `--gd-*` (cor, tipografia `--gd-font-size-*`, spacing, raio, sombra plana, motion
140–180ms, z-index, overlay). Token é semântico — nenhum token de página. Ajuste desta
entrega: a faixa do `Dialog` virou token local (`--gd-dialog-w`, default 520px) porque o
`max-width` do próprio `.gd-dialog` vencia a classe utilitária — a revisão clínica abre em
672px sem criar classe por tela.

**2 · App Shell.** Topbar com 100% da largura no topo (x=0, acima da sidebar); sidebar
**branca** abaixo da topbar; rail recolhida 56–64px; hover/focus de grupo abre painel
lateral sem reflow; pin “Expandir navegação” empurra o conteúdo e é lembrado localmente;
motion com `prefers-reduced-motion`; sem breadcrumb global. Medido em 1440/1366/1024/390.

**3 · Agenda (primeira superfície convertida).** Toolbar `Hoje ‹ data ›` + Segmented
`Dia | Semana | Lista` com o `DatePicker` canônico (zero `<input type="date">`); quick
create ancorado no ponto do gesto abrindo **sem** POST; “Mais opções” → fluxo completo com
o preenchimento preservado; HoverCard ~180ms com foco equivalente; clique → Drawer de
detalhe; Lista como superfície contínua com fios de 1px (não pilha de cards); mobile
390 rende a Lista (não a grade) com detalhe em painel de 371px.

**4 · Limpezas globais desta rodada** (detalhe e mapa em `docs/GODOUTOR-DESIGN-SYSTEM.md`
§7.1):

- **Fechamento clínico** (`EncounterFinalizationPanel`): `ActionSection` (texto à esquerda,
  ação à direita), `StatusBadge`, `Notice`, histórico com `--gd-warning`/`--gd-info`,
  addendum e reabertura em `ActionSection`/`PageActionBar` + `Field`; o modal artesanal
  virou `Dialog` canônico com **Danger SOLID só na fronteira clínica**. A autoridade
  continua a do servidor (`canFinalize`, `expectedVersion`, idempotência, `flush`).
- **Cadastro do cliente** (`ClientProfileDrawer`): removida a copy “Conta de acesso
  separada … Equipe/Acesso” do formulário de cadastro; cadastro ≠ conta de acesso segue
  verdadeiro **por construção** (nenhum campo `account*` no form).
- **Oportunidades** (`EsteiraView`): 11 `<select>` crus → `Select` canônico; barra de
  filtros em `SearchField` + `Select` lado a lado (o defeito visível era cada select
  ocupar a linha inteira); 3 modais artesanais → `Dialog`; ações de card em `buttonCls`
  (secondary / warning soft) para não repetir primary de acento por cartão.
- **Disponibilidade** (`BusinessHours`): confirmação “Seguir a clínica” em `Dialog`
  canônico com rodapé sem Danger e Escape que não altera horário.
- **Integrações/Canais**: 4 modais artesanais (chave de API, webhook, conectar provedor,
  credenciais) → `Dialog` com `Field`/`Input`/`Select`/`Checkbox`.
- **Campanhas**: bottom-sheet artesanal → `Dialog` canônico.
- **Overlays**: o painel do produto ficou com **zero** camadas `fixed inset-0` fora do
  sistema; só permanecem o `Sheet`/`Dialog` de `src/components/ui.tsx`, o widget público
  (`components/public/*`, superfície do cliente final) e um comentário.

**5 · Segunda rodada de limpezas (varredura até o fim da fila).**

- **`<select>` cru: zero no produto.** Os 15 restantes em 8 arquivos (`pagina` 4,
  `master/suporte` 2, `IntegracoesView` 2, `QueuePanel` 2, `catalog-panels` 2,
  `configuracoes` 1, `organizacao` 1, `BusinessHours` 1) foram migrados para o `Select`
  canônico, cada um com o rótulo certo (`Field`/`aria-label`) e sem estourar a linha em
  que vive o controle.
- **Responsive virou teste, não memória.** `tests/design-system/responsive-qa.mjs`
  mede as seis superfícies principais em **1440/1366/1024/390**: rolagem horizontal do
  documento e largura útil da coluna principal (**48/48**). O caso do Dashboard em
  1024px — que era exceção documentada — está **limpo em todas as larguras medidas**
  (a correção anterior da coluna do shell o resolveu) e agora é verificado a cada rodada.
- **Achado novo corrigido no mobile:** em Oportunidades, aos 390px, a barra de ações não
  quebrava e o CTA primário “Nova oportunidade” ficava **cortado** (medido: `right=439`
  numa viewport de 390). A barra passou a ocupar a própria linha e a quebrar abaixo de
  `sm`; o gate de responsive cobre o caso.

**6 · Catálogo vivo.** `/dev/design-system` (fora da navegação final, gateado em produção)
com os estados de repouso, hover, focus, disabled, loading, erro, vazio e selecionado.

## Contratos re-apontados (não enfraquecidos)

| Teste | Contrato antigo | Contrato DS 1.0 |
| --- | --- | --- |
| `business-hours-focus.test.tsx` | `role=dialog` nomeado por `aria-label` próprio | nome acessível vem do **título** do `Dialog` |
| `f1c-finalization-panel.test.tsx` | foco no heading do modal artesanal | foco **contido** no `Dialog` canônico (o diálogo foca o primeiro acionável) |
| `f1c-finalization-panel.test.tsx` | botão “Adicionar nota complementar” | `ActionSection`: título “Adicionar nota complementar” + ação “Adicionar nota” |
| `agenda-cell-prefill.test.ts` | clique no slot → sheet completo | clique/arraste → quick create + `onMore` preservando a intenção |

Nenhum limiar AA foi baixado; nenhum `skip/only/todo` foi usado; as expectativas de
autoridade (400/403/409, `expectedVersion`, idempotência) continuam medidas.

## Ambiente reproduzível

```sh
npm ci
# DATABASE_URL deve estar AUSENTE; o seed recusa ambiente remoto e arquivo existente.
env -u DATABASE_URL node scripts/seed-design-system-qa.mjs
env -u DATABASE_URL npm run build
env -u DATABASE_URL GODOUTOR_DB_FILE="$PWD/.cache/design-system/qa.json" npm start -- -p 3020
# Outra janela (Chromium headless; libs empacotadas via @sparticuz/chromium):
LD_LIBRARY_PATH=/tmp/al2023/lib node tests/design-system/shell-qa.mjs
LD_LIBRARY_PATH=/tmp/al2023/lib node tests/design-system/agenda-qa.mjs
LD_LIBRARY_PATH=/tmp/al2023/lib node tests/design-system/surfaces-qa.mjs
```

Fixture descartável (`.cache/design-system/qa.json`, ignorada no Git) — clínica
`andrioni-vet-qa`, Andrioni Veterinária QA; profissionais Orlando/Michelle/Hernani (Michele
com horário **personalizado**, para exercitar a confirmação “seguir a clínica”); 1 tutora
Ana Tutora QA + pet Thor QA; 3 agendamentos em 05/10/2026; **1 atendimento em andamento
(draft do profissional responsável) e 1 finalizado**; 4 oportunidades (uma por etapa);
serviços consulta/vacinação/cirurgia; expediente 09–18. Usuários fictícios
(`owner.qa@godoutor.local`, `recepcao.qa@godoutor.local`, `orlando.qa@godoutor.local`),
sem senha ou dado de produção.

## Validação real (browser, build de produção local)

Next **production** (`next start`) + Chromium 153 headless. Screenshots em
`docs/qa-design-system/`.

| Suíte | Escopo | Resultado |
| --- | --- | --- |
| `shell-qa.mjs` | topbar full-width, sidebar branca, rail, painel de grupo sem reflow, pin, 390 | **22/22** |
| `agenda-qa.mjs` | toolbar canônica (sem `input[type=date]`), quick create ancorado sem POST, Escape, “Mais opções”, hover card, drawer, Lista no mobile | **23/23** |
| `surfaces-qa.mjs` | fechamento clínico (ActionSection, Dialog canônico, Danger solid, sem PATCH ao abrir/fechar), estado finalizado, Oportunidades (0 `<select>` cru, filtros em uma linha, 1 primary, 3 Dialogs), Disponibilidade (Dialog, Escape) | **40/40** |
| `responsive-qa.mjs` | 6 superfícies × 4 larguras (1440/1366/1024/390): sem rolagem horizontal, coluna principal na largura útil (390 → `x=0 w=390`) | **48/48** |
| `audit-2-probe.mjs` | AUDIT #2 — `/configuracoes`, `/canais` (abas e sub-abas) e `/campanhas`: carregam sem erro de runtime, **zero** camada artesanal, os 5 Dialogs migrados (3× conectar, gerar chave, adicionar webhook) + campanha abrem com foco CONTIDO, fecham com Escape e o CloseButton não é vermelho; **todo `<select>` renderizado** (inclusive o de “Tipo do recurso”, atrás da aba Agenda) é o componente canônico; console sem erro inesperado | **25/25** |

Medições citadas: dialog da revisão **672px**; detalhe da oportunidade **720px**; filtros
na mesma linha com `barHeight=74`; `artesanalOverlays() === 0` nas três superfícies;
390 → `col.x=0 w=390`, `docOverflow=0`.

## Gates de código

- `git diff --check` — limpo.
- `npx tsc --noEmit` — **0** erros.
- `npm run build` — **compiled successfully** (136 páginas).
- Contrato de source: `ds-sem-controle-artesanal.test.ts` — **4/4** (zero `<select>` cru,
  zero camada artesanal, `CloseButton` neutro, zero gradiente decorativo).
- Suíte completa: **5 falhas / 3250 passou (3255)**, todas baseline de domínio
  (`a34-instagram` 2, `automation-audit-p4` 1, `whatsapp-robustness` 1, `pipeline` 1) —
  `pipeline` é dependente de data/hora real (“Este horário já passou”). **Nenhuma
  regressão nova**; as 2 falhas de contrato do fechamento clínico foram re-apontadas para o
  `Dialog` canônico.
- Focados: `esteira`/`pipeline`/`lead`/`integra`/`campanha`/`canal` (75), encounters F1C
  (3), business-hours/equipe (20), `agenda-cell-prefill` (10), `WorkspaceNavigation`,
  shell/visual/tokens.

## AUDIT (as duas passagens)

**AUDIT #1 — varredura adversarial do que foi entregue, com FIX no mesmo passo:**

1. Gradiente decorativo no avatar-placeholder (`globals.css`, `linear-gradient(140deg,#4d86f5,#7a5cd0)`)
   → **corrigido**: acento suave tokenizado (`--gd-accent-soft`/`--gd-accent-fg`), zero gradiente.
2. Banner de status do Funil pintado de acento sólido (`bg-[var(--brand)] text-white`)
   → **corrigido**: `Notice tone="success"`.
3. Título “Bloqueios operacionais · não são atendimentos” em caixa alta/bold
   → **corrigido**: escala do sistema (semibold) + hint em voz de ajuda.
4. Varredura confirmou: sem spacing arbitrário nos arquivos tocados, uma única família
   tipográfica, `CloseButton` neutro em todos os overlays, sombras planas (a única sombra
   forte é a do próprio `Drawer`, que é elevação de overlay — não decoração).

**AUDIT #2 — segunda passagem, agora exercitando em browser real as telas que ainda não
tinham QA (Canais & Integrações, Campanhas), com FIX:**

1. 9 botões artesanais (`bg-[var(--brand)]` + `shadow-brand`) e 1 em Canais
   → **corrigidos**: `Button`/`buttonCls` canônicos; “Revogar chave” deixou de ser um
   botão vermelho em repouso (é `ghost`; a confirmação destrutiva continua explícita).
2. Rótulos herdados (“+ Gerar Nova Chave”, “+ Adicionar Webhook”) → texto sem o “+” decorativo
   e com `size="sm"` na densidade da barra de seção; a dica de vazio acompanha o novo rótulo.
3. Probe provou os 5 Dialogs migrados abrindo/fechando com foco contido e **zero** overlay
   artesanal — inclusive a sub-aba Webhooks, que só aparece depois de um segundo clique.

## Pendências declaradas (não silenciadas)

1. **Nenhuma camada artesanal no painel** e **nenhum `<select>` cru no produto** —
   ambas as filas foram fechadas nesta rodada. O que resta fora do sistema é só a
   **superfície pública** (`components/public/*`), que não carrega a biblioteca do painel
   por desenho (widget do cliente final, sem sessão).
2. `lib/appearance.ts` (tokens de nav legados) sai quando o campo legado sair do payload.
3. **Fora do escopo declarado desta PR** (não silenciado): o board de Oportunidades e os
   `catalog-panels` continuam com cartões próprios — o domínio e o fluxo estão intactos e
   a conversão visual deles é trabalho da fila seguinte, não desta fase.

## Veredito

`IMPLEMENTADO / HOMOLOGADO EM BROWSER REAL / SEM MERGE` (duas rodadas de limpeza: os
`<select>` crus e o overflow do Dashboard saíram da lista de exceções; o painel não tem
camada artesanal nem controle fora do sistema). A PR entrega o Design System 1.0
com App Shell e Agenda como primeira superfície, propaga os primitives canônicos para as
superfícies tocadas nesta rodada e **documenta** o que ainda está na fila — sem ampliar
autoridade, sem tocar domínio e sem declarar homologação que não tenha sido renderizada.

---

## Recuperação sobre a main pós-PR#61 (2026-10-06)

A PR #61 (Clinical Access) foi **mergeada** em `main` (`b4462d0`). O trabalho desta fase,
preservado em `backup/pr61-ds-head-edb0613` (`edb0613`) e empilhado sobre o antigo topo da
PR #61 (`5cc1a88`), foi **re-aplicado sobre a main pós-merge**. Não houve cherry-pick cego:
os únicos quatro arquivos sobrepostos (`ClientProfileDrawer.tsx`,
`clinical-ux-closure.test.ts`, `GODOUTOR-HISTORY.md`, `GODOUTOR-MASTER-PLAN.md`) foram
verificados como **união exata de três vias** (as mudanças do DS preservadas *e* as mudanças
da PR #61 preservadas, em ambas as direções). O fechamento de privacidade da PR #61
(allow-lists em `/api/contacts`, `people360`, `search`, `pets`, `encounters`) está **intacto e
idêntico à main**.

Revalidação nesta sessão (Chromium real 153 headless contra build de produção local, banco
descartável, login pelo formulário real):

| Suíte | Resultado |
| --- | --- |
| `tsc --noEmit` | 0 erros |
| `npm run build` | ✓ |
| `npx vitest run` | 3251 PASS / 5 FAIL (baseline de domínio: 3× `a34-instagram`, 1× `automation-audit-p4`, 1× `pipeline` — mesmas 5 no base `b4462d0`, zero regressão) |
| `shell-qa.mjs` | 22/22 |
| `agenda-qa.mjs` | 23/23 (com o fixture re-datado para hoje) |
| `surfaces-qa.mjs` | 40/40 |
| `responsive-qa.mjs` | 48/48 |
| `audit-2-probe.mjs` | 25/25 |
| Erros de console/página | nenhum |

**Finding real corrigido nesta recuperação:** `scripts/seed-design-system-qa.mjs` fixava os
atendimentos em `2026-10-05`, então a Agenda QA degradava em silêncio a partir do dia
seguinte (23/23 → 17/19, com 4 checagens de detalhe/hovercard/Lista puladas). O seed agora
data os atendimentos em **hoje** (fuso da clínica, `America/Sao_Paulo`), tornando o gate
re-executável em qualquer dia. Evidência nova em `docs/qa-recovery/`.
