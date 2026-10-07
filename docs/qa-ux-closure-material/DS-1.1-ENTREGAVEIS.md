# GoDoutor · Design System 1.1 — Entregáveis da missão (PR #64)

> Mesma PR #64 (`arena/40573dbd-instalink`), **sem merge**: o material abaixo é a
> prestação de contas para homologação manual. Nada aqui foi presumido: cada
> número sai de `measurements.json` desta pasta (Chromium real, 4 larguras) ou de
> gate executado no mesmo ambiente do repositório.

---

## A. REQUISITO → ALTERAÇÃO → PRIMITIVE/TOKEN → EVIDÊNCIA

| Requisito | Alteração feita | Primitive/token | Evidência |
| --- | --- | --- | --- |
| §3 Barlow, 400/500/600 (700 onde hierarquia justifica), escala central | Família trocada no `body`/`.font-display` e escala `--gd-type-*` central | `--gd-font-sans`, `--gd-type-{body,label,helper,section,metadata}`, `--gd-weight-*` | `fonte-1440.family` deixa de ser `Times New Roman`; `barlowCarregada: true`, `pesosDisponiveis: ["400","500","600","700"]`, `requisicoesAoGoogle: 0` |
| §4 Campos M3 Outlined com rótulo flutuante real | `Field` passa a reconhecer `<Input>/<Textarea>/<Select>` (não só tags nativas) e injeta a sonda `placeholder=" "` só em campo de texto; select/data sempre flutuam | `FieldShell` (`ui.tsx`), `.gd-field__box/__label`, 3 estados | `campo-1440.vazio = { labelDentro: true, alturaCaixa: 40 }`, `.comFoco/.preenchido = { labelDentro: false, borda rgb(37,99,235) }`, `temPlaceholderComoRotulo: false` |
| §4/§10 Seta do `Select` é desenho do DS, não artefato | Regra do shell devolve à seta `no-repeat`/`14px`/`right 12px center` (o `background: transparent` do grupo apagava repeat/size/position e a seta tilhava) | `.gd-field__box > select.il-field-control` | `campo-*` → `setaRepete: "no-repeat"`, `setaTamanho: "14px auto"`, `setaPosicao: calc(100% - 12px) 50%`; PNG `form-select-*` |
| §5 Topbar com logo real, nome completo, sem tile | Logo solta e proporcional; ≤479px a identidade ganha da busca (nome em 2 linhas, logo no token) | `--gd-topbar-h`, `.ws-clinic__logo/mark`, `.ws-clinic__name` | `topbar-1440/390 = { altura: 60, logoAltura: 36, nomeCortado: false, identidadeRepetidaNoRail: false, logoTemTile: { border 0, radius 0, background transparente } }` |
| §6 Rail sem chevron falso; grupo abre por hover/foco, mantém, troca e recolhe | Chevron removido do gatilho (fica `aria-expanded`); painel contextual com gap 0, sem sombra pesada; abre em 7ms e retrai com atraso curto | `.workspace-link__chevron { display: none }`, `NavigationRail`, `NavigationGroupPanel` | `rail-* = { altura: 60, chevrons: 0, abriuEmMs: 7, gapPainel: 0, trocouSemFechar: true, ficouRailParaPainel: true, retraiuAo Sair: true, escape: true, focoVolta: true }` |
| §7 Hover da Agenda ≠ clique | Card compacto 8–12px, prefere direita com flip, sem `title` nativo, CTA "Ver detalhes"; toque não simula hover | `HoverCard` (180/140ms) em `agenda/page.tsx` | `hover-* = { abriuPrevia: true, abriuDetalheComHover: false, distancia: 10, ctaVerDetalhes: 1, titulosNativos: 0, foraDaViewport: false }` |
| §8 Detalhe = side sheet modal preso à direita, altura cheia | `DetailSideModal`: 100dvh, sem margem/raio/sombra, backdrop próprio, foco preso, Escape devolve o foco ao evento | `DetailSideModal`, `::backdrop` do `dialog.gd-detail` | `detalhe-1440 = { x: 980, largura: 460, right: 0, raio: 0, sombra: none }`, `backdropCor: rgba(13,18,32,0.52)`, `focoContido/Escape/focoVolta: true` |
| §9 Criação central, disclosure progressivo, rodapé previsível | Fluxo completo em `.il-drawer--dialog` 672px, opções avançadas com `Disclosure` canônico (nasce fechado, conteúdo só entra no DOM quando abre) | `Disclosure`, `Dialog`, `--il-dialog-w` | PNG `form-central-*`; teste `agenda-cell-prefill-flow` atualizado para o novo contrato (`aria-expanded` + painel) |
| §10 Menus ancorados corretos e largura previsível | Menus de AÇÃO com piso de 190px; menus ancorados a CAMPO herdam a largura **da caixa do campo** (`fieldBoxOf`), não do host interno com padding | `useAnchoredLayer`/`anchorRectOf`, `Combobox.anchorW`, `.gd-menu` | `combobox-1440 = { listaAberta: true, larguraCampo: 540, larguraLista: 540, listaAlinhaComCampo: true, selecionadaExplicita: 1, dentroDaViewport: true }` |
| §11 Prontuário em leitura é DOCUMENTO (superfície viva também) | As seis seções do workspace (`/atendimento/<id>`) ganharam ramo `data-readonly` com bloco + valores em texto; nota interna sob `Disclosure`; motivo da leitura dito uma vez | `ClinicalRecordSection` (novo), `ReadOnlyField`, `Disclosure`, `.gd-ro-section/.gd-ro-grid` | `atendimento-leitura-*`; `ds-1-1-leitura-e-alertas` (contrato de fonte) e `f1b1-clinical-sections` (contrato re-apontado: `input/textarea/select = 0` na leitura) |
| §12 Alerta proporcional ao impacto | Erro de campo fica NO CAMPO (contorno + texto); `Notice` para contexto local, toast para confirmação transitória; vermelho cheio só no destrutivo | `Field` + `.gd-field__error`, `Notice`, `useToasts`, `Alert` | `erro-1440 = { campoInvalido: true, mensagem: "Campo obrigatório.", contorno: rgb(220,38,38), camposInvalidos: 1 }` + `bannersDeErroNaTela` listados por papel/texto |
| §13 Copy sem voz de landing, sem subtítulo que repete título, sem ajuda permanente | 9 telas limpas (Dashboard, Configurações, Canais, Estrutura, Pedidos, Equipe, Disponibilidade, Campanhas, Follow-up) + subtítulo do detalhe do agendamento | `hint` das telas, `BookingDetailSheet` | `git diff` das páginas; testes `godoutor-clinical-convergence` (contrato de copy re-apontado) e `a34-human-test-fixes` |
| §14 Primitives antes de páginas | `FieldShell`, `DetailSideModal`, `Disclosure`, `Combobox`, `ClinicalRecordSection`, `ReadOnlyField` evoluídos; zero px/raio/sombra arbitrário nas telas tocadas | `godoutor-design-system.css` (fonte única de tokens) | `git diff --check` limpo; `--gd-*` presentes; nenhuma família de fonte por tela |

### A.1 Contratos de teste re-apontados (o padrão antigo foi substituído de propósito)

| Teste | O que mudou | Por quê |
| --- | --- | --- |
| `agenda-cell-prefill-flow.test.tsx` | passou a abrir a divulgação canônica e medir `aria-expanded` (não mais `details.open`) | §9/§14: o disclosure canônico nasce fechado e **não monta** o conteúdo fechado |
| `f1b1-clinical-sections.test.tsx` | leitura bloqueada não é mais "campos desabilitados", e sim documento (`0` controles) | §11: leitura = documento |
| `ui-audit-v01-v10` + `a34-human-test-fixes` | rótulo inline de "salvo" passa a considerar `editable` | §11: leitura não anuncia estado de gravação |
| `godoutor-clinical-convergence` | copy de Disponibilidade encurtada, mantendo clínica≠casa/empresa (agora com asserção negativa para `casa`/`empresa`) | §13: limpeza de copy |

---

## B. REFERÊNCIA OFICIAL → PRINCÍPIO → COMO FOI ADAPTADO

| Fonte oficial | Princípio que vale para nós | Adaptação no GoDoutor |
| --- | --- | --- |
| `m3.material.io/components/text-fields` (overview + accessibility) | Outlined é o campo de ênfase mais baixa, para formulários longos; o estado (foco/erro/disabled) é visível de relance; contorno ≥3:1; o nome acessível é o rótulo visível | `FieldShell` único para Input/Textarea/Select/Combobox/Date: rótulo dentro → sobe no foco (notch) → permanece com valor; erro integrado; `disabled` e `readonly` com superfícies distintas; placeholder nunca é rótulo (a sonda `placeholder=" "` só existe para o CSS detectar vazio) |
| `material-web` · `docs/components/text-field.md` | `error`/`error-text` no próprio campo; texto de apoio separado do valor | `Field` monta `aria-describedby` com ajuda + erro; a ajuda permanece no DOM sob erro (`.gd-field__hint--off`) para o id não ficar pendurado |
| `material-web` · `docs/components/menu.md` | Menu ancorado ao gatilho, navegação por setas/Enter/Escape e busca em listas longas | `useAnchoredLayer` (âncora = **caixa do campo** quando o gatilho é um campo), `Combobox` com busca/teclado, `DropdownMenu` para ações |
| `m3.material.io/components/dialog` + `material-web` · `dialog.md` | Diálogo com seções opcionais, `alert` para confirmação destrutiva, foco preso, fechar resolve depois da animação | `Dialog` (criação central 672px), `DetailSideModal` para leitura, confirmação de remoção com `role="status"` no contexto |
| `m3.material.io/components/side-sheets` | Existe *standard* e *modal*; no compacto o modal prende na borda | Detalhe do agendamento = side sheet **modal** preso à direita, 100dvh, sem margem/raio (o conteúdo é de trabalho, não um card solto) |
| `m3.material.io/components/navigation-rail` | Rail para janelas médias+, 3–7 destinos, lugar fixo — não acordeão | Rail de 60px sem chevron; o grupo abre por hover/foco com painel **conectado** (gap 0), troca A→B sem fechar e retrai com atraso curto; Enter/Space abre, Escape fecha e devolve o foco |
| `m3.material.io/styles/motion` (standard vs expressive) | Transições curtas, previsíveis; expressivo não é o caso de um produto operacional | 120–200ms ease-out, sem bounce; reduced-motion respeitado em overlays, hover card e disclosure |
| `fonts.google.com/specimen/Barlow` | Barlow: 100–900 (400/500/600/700 no nosso caso), subset latin, OFL — sem impeditivo de licença | Barlow entra por `next/font/local` (woff2 vendorizado) com `display: swap`; 700 só onde a hierarquia justifica |
| `nextjs.org/docs/app/api-reference/components/font` | `next/font` self-hospeda no build, sem requisição em runtime | Vale para o nosso `localFont`: `requisicoesAoGoogle: 0` na medição. O `next/font/google` **não** é possível neste ambiente (TLS bloqueado) — impeditivo declarado, não escolha estética |

### B.1 Onde o Material NÃO foi seguido (registro honesto)

Está em `docs/GODOUTOR-DESIGN-SYSTEM.md` §9.10 (paleta/marca/ícones não copiados,
raio grande em side sheet, menu de ação com piso de 190px × menu de campo com a
largura do campo, select nativo para listas curtas, sem mola com bounce, snackbar
para tudo, busca do topbar sem "Material search", etc.).

---

## C. ANTES → DEPOIS (medido, não impressão)

| O que | Antes (medido na QA) | Depois (medido na QA final) | Como foi medido |
| --- | --- | --- | --- |
| Fonte global | `Times New Roman` (a declaração `var(--font-geist-sans)` não existia e era descartada) | Barlow em uso, pesos 400/500/600/700 | `fonte-1440` (`family`, `barlowCarregada`, `pesosDisponiveis`, `requisicoesAoGoogle: 0`) |
| Campo vazio (§4) | rótulo FORA da caixa (`labelDentro: false`, `labelTop: -8`) | rótulo **dentro**; sobe no foco e permanece com valor | `campo-*` nos 4 estados |
| Seta do `Select` | desenho tilhando pela largura do campo (`background-repeat: repeat`) | uma seta, à direita, com a métrica do DS | `campo-*.select` (`setaRepete/setaTamanho/setaPosicao`) + PNG `form-select-*` |
| Lista ancorada a campo (§10) | 514px sob um campo de 540px (âncora no host interno com padding) | 540px = largura da caixa do campo | `combobox-*` (`larguraCampo`, `larguraLista`, `listaAlinhaComCampo`) |
| Prontuário em leitura — superfície viva | `disabled={!editable}` em cada controle | documento: bloco com título + valores em texto; `0` controles | `atendimento-leitura-*` + contrato `f1b1-clinical-sections` (re-apontado) |
| Prontuário finalizado (rota `/registro`) | rodapé anunciava "Salvo agora" num documento só-leitura | estado de gravação só em rascunho | `EncounterSheet.tsx` (guardado por `isDraft`) + PNG `atendimento-leitura-*` |
| Ficha de anamnese (criação) | subtítulo repetia a primeira frase do corpo | subtítulo removido; a regra do episódio atual fica no corpo | `erro-campo-real-*` |
| Hover da Agenda (§7) | `title` nativo do navegador | card compacto 8–12px, CTA "Ver detalhes", `0` títulos nativos | `hover-*` + GIF `appointment-hover-vs-click.gif` |
| Detalhe (§8) | painel insetado (raio/sombra/margem) | side sheet preso à direita, 100dvh, sem raio/sombra, backdrop próprio | `detalhe-*` (`x/largura/raio/sombra`, `::backdrop`) |
| Topbar (§5) | monograma/logo dentro de tile com borda | logo solta (36px), sem tile/borda/fundo, nome completo | `topbar-*` (`logoTemTile`, `nomeCortado`, `altura`) |
| Rail (§6) | chevron no gatilho (seta de acordeão que não existe) | `0` chevrons; painel conectado (gap 0), troca sem fechar, Escape devolve o foco | `rail-*` + GIF `rail-hover-swap-retract.gif` |
| Alertas (§12) | avisos de permissão/erro com cor de página (`amber`/`zinc`) | erro no próprio campo; `Notice`/toast canônicos; vermelho cheio só no destrutivo | `erro-*` (contorno + mensagem no campo) e `avisosAmbarNaTela: 0` na Agenda |

> Observação de honestidade: os valores "antes" vêm das medições desta mesma
> sessão de QA (e dos PNGs da fase anterior, quando o número não era coletado).
> Nada foi inferido de memória.


## D. GATES — main × PR HEAD (mesmo ambiente, mesma máquina)

Executados um depois do outro, no mesmo sandbox, com `origin/main` num worktree
limpo (`/tmp/base-main`, `9f423ef`) e o HEAD do PR = árvore de trabalho desta PR
(branch `arena/40573dbd-instalink`, base `daf94ed`).

| Gate | `origin/main` (`9f423ef`) | PR #64 (esta árvore) | Veredito |
| --- | --- | --- | --- |
| `npm run build` | **rc=0** · `✓ Compiled successfully` | **rc=0** · `✓ Compiled successfully` | sem regressão |
| `tsc --noEmit` | **3 erros** — `src/lib/__tests__/production-db-routing.test.ts` (TS2352 ×3) | **3 erros** — exatamente os mesmos | sem regressão (pré-existentes, fora do escopo) |
| Suíte completa (`vitest run`) | **235 arquivos** · 3253 passed · **6 failed / 4 arquivos** | **238 arquivos** · 3314 passed · **6 failed / 4 arquivos** | mesmo conjunto de falhas; +3 arquivos e +67 testes que passam |
| Falhas | `a34-instagram` · `automation-audit-p4` · `convergence-wave2` · `pipeline` | idem, **as mesmas 6 asserções** | pré-existentes, herdadas — não são regressão desta PR |

Contratos DIRECTOS do DS 1.1 (todos verdes nesta árvore):

| Arquivo | Resultado |
| --- | --- |
| `src/lib/__tests__/ds-1-1-leitura-e-alertas.test.tsx` | 23/23 |
| `src/components/__tests__/f1b1-clinical-sections.test.tsx` | 29 testes do arquivo, verdes (contrato de leitura re-apontado) |
| `src/components/__tests__/agenda-ux-closure.test.tsx` · `agenda-protagonista` · `agenda-cell-prefill-flow` | verdes (contrato do disclosure e do prefill re-apontados) |
| `src/components/__tests__/ui.test.tsx` · `m10-identidade-persistente` | verdes |
| `git diff --check` (tracked + novos) | limpo |

**Nenhuma infraestrutura fora do escopo foi tocada para "passar" um gate.** As 6
falhas pré-existentes foram deixadas como estão (documentadas em E).

## E. DIVERGÊNCIAS RESTANTES (honestas)

1. **6 falhas de teste herdadas de `main`** (mesmas antes e depois do PR):
   `a34-instagram` (3), `automation-audit-p4` (1), `convergence-wave2` (1),
   `pipeline` (1). Não pertencem ao DS 1.1 (WhatsApp/Instagram, automação,
   roteamento de banco, pipeline) e resolver correções de domínio/infra aqui
   violaria o §16 da missão. Ficam registradas como dívida da base.
2. **`next/font/google` continua impossível neste ambiente** (`fonts.googleapis.com`
   com TLS bloqueado). A missão pedia "integração local pelo mecanismo padrão do
   Next.js": usamos `next/font/local` com os woff2 OFL vendorizados — declarado
   como impedimento técnico, não como escolha estética.
3. **Combobox/Autocomplete do DS ainda não tem superfície de produção** (nenhuma
   tela do produto o usa). A evidência dele é o catálogo de desenvolvimento
   (`/dev/design-system`), o mesmo Chromium e o mesmo CSS. Quando a primeira tela
   real usar o primitive, ele deve ser re-medido ali.
4. **`Select` nativo para listas curtas** é uma não-adoção consciente (§9.10):
   listas longas usam `Combobox`. Não é divergência do DS, é decisão registrada.
5. **Geist permanece no projeto como fonte mono** (`--font-geist-mono`), usada em
   código/atalhos — não como fonte de UI. O contrato de uma-família na UI está
   travado por teste (`ds-1-1`).

## F. SEGUNDA PASSADA VISUAL (o que ELA encontrou e o que mudou)

Passada feita lendo os PNGs/GIFs desta pasta depois de todos os gates — não por
"achar que está bom". Cada achado abaixo virou correção ou registro.

| Achado (2ª passada) | Onde vi | Correção |
| --- | --- | --- |
| "Salvo agora" ainda aparecia num atendimento **finalizado** (superfície viva do workspace) | `atendimento-workspace-1440.png` | `EncounterWorkspaceBody` passou a renderizar o rodapé de persistência **só em rascunho** |
| A linha de ações do detalhe do agendamento tinha **4 cores competindo** (azul primário + âmbar + azul outline + vermelho) | `agenda-detalhe-1440.png` | `BookingDetailSheet` ganhou `primaria` (primeira ação de fluxo permitida): uma primária por etapa, transições **neutras**, só o destrutivo tintado |
| Rótulo "Duração deste atendimento (min)" parecia não flutuar | `form-erro-1440.png` (olho) → conferido em zoom 2× | **Não era defeito**: campo vazio com rótulo dentro é o contrato outlined; no foco/preenchido ele sobe (`campo-1440` + `/tmp/zoom-duracao-*`) |
| Setas do `Select` apareciam repetidas dentro do campo canônico | `combobox-aberto-1440.png` + catálogo | Regra do shell repõe `no-repeat`/tamanho/posição da seta (especificidade `.gd-select.il-field-control`) |
| Ficha de anamnese repetia "episódio atual do paciente" no subtítulo e no corpo | `erro-campo-real-1440.png` | Subtítulo do `AnamneseFiller` removido; a regra continua no corpo |
| Nota interna não aparecia na leitura do workspace vivo | `atendimento-workspace-1440.png` | Lá ela está sob `Disclosure` (recolhida) — comportamento correto; a sonda `notaRecolhida` passou a medir isso |
| Rodapé de gravação em página (rota legada `/registro`) com registro finalizado | `atendimento-leitura-1440.png` | `EncounterSheet` também guarda o rodapé por `isDraft` |

Nada foi declarado "comprovado" sem número ou imagem: hover, swap/retract do rail,
rótulo flutuante e ação de ícone têm **GIF** (`*.gif` nesta pasta) e os gates têm
a tabela D acima.
