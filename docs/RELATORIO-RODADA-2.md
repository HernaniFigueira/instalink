# GoDoutor · UX/UI Refinement Round 2 — relatório final

**Escopo:** refinamento cirúrgico pós-Product Revolution 2.0. Nada de redesenho, nada de recriar
arquitetura, nada de reverter decisões anteriores. Só polimento, consistência e hierarquia.

---

## 1. HEAD inicial, HEAD final, commits, arquivos

| | |
|---|---|
| HEAD inicial desta rodada | `1ce1371e91d21f99802a6627373f6435b66cf4c0` |
| HEAD final | `05fbcae` |
| Branch | `arena/01a0ce4e-instalink` (**único** destino; `arena/01a0d8b2-instalink` mantido no mesmo commit) |
| Commits | `5738ee8` refactor(ui) · `686c6ff` test(ui) · `05fbcae` fix(tokens) |
| PR | #37 (aberto, **não** mergeado — proibido) |
| `main` / Production | intocados. Sem merge, sem force-push |

**Arquivos alterados nesta rodada (32):** `src/app/globals.css`, `tailwind.config.js`,
`src/components/ui.tsx`, `src/components/dashboard/AccountMenu.tsx`,
`src/components/dashboard/ClientProfileDrawer.tsx`, `src/app/(dashboard)/agenda/page.tsx`,
`src/components/public/widgets2.tsx`, `src/app/api/people360/route.ts`,
**novo** `src/app/(dashboard)/clientes/[id]/page.tsx`, `src/components/__tests__/ui.test.tsx`
e 22 arquivos com convergência mecânica de raio (`rounded-2xl/3xl → rounded-xl`).

---

## 2. TOPBAR

- **Busca global:** altura 40px, raio `--radius-sm` (8–10px), borda `--border-strong` (#CBD5E1),
  superfície branca, lupa à esquerda, placeholder **“Buscar no sistema…”**, `Ctrl K` à direita.
  Foco = borda `--brand` + anel **muito** claro (14% de marca) — o **duplo oval** (pílula + anel
  circular interno) foi eliminado, e o campo não “salta” de tamanho ao focar.
- **Sino:** badge `--danger` (#DC2626 puro). O marrom/vinho (`--warning-strong`) saiu de lá — o
  badge de atenção do produto é vermelho limpo, âmbar só onde é estado técnico.
- **Avatar:** a topbar desktop mostra **só** foto/iniciais (30px, 40×40 de alvo). Nome e
  “Proprietário” **não** ficam mais permanentes ao lado — só existem dentro do menu aberto.
  Padrão final: `[busca] … [sino] [?] [avatar]`.
- `User.photo` tem prioridade; sem foto, iniciais.

## 3. SIDEBAR

- Identidade preservada: logo da clínica no topo, largura 216–224px expandida / 64–72px
  recolhida. **Não** virou cartão.
- **Item ativo:** descoberto um conflito real — o override do scope plataforma
  (`.il-platform [data-nav-item][aria-current='page']`, com `!important`) ainda pintava
  `--il-nav-active` (azul suave `#EFF6FF`). Agora o item ativo é **marca em cheio**
  (`--brand` #2563EB) com **texto e ícone brancos** e sombra discreta; hover escurece para
  `--brand-strong`. Nenhum outro item fica saturado. Contraste AA **provado pelo teste
  computado** (`design-360-tokens`: `--il-nav-active-fg` × `--il-nav-active` ≥ 4.5).
- Submenus: chevron gira 90° (200ms, `cubic-bezier(0.2,0.8,0.2,1)`), coluna contextual com
  `ws-rail-in` (slide-in), itens indentados, nada de “cartão dentro do menu”, sem trilho
  vertical no item ativo (`data-nav-rail` segue no DOM para acessibilidade/testes).

## 4. AGENDA

- **Cabeçalho:** só “Agenda”. O subtítulo “Gerencie os atendimentos da sua clínica.” foi
  removido — a grade ensina o que a tela faz.
- **Hierarquia de ações:** `Filtros` (secundário) → `Fila` (secundário) → `+ Novo agendamento`
  (primário, único). `Legenda` deixou de ser botão de texto na tríade: virou **“?” só ícone**,
  discreto, com popover — mesmo affordance de ajuda do topbar.
- **Linha “Um dia · clique para escolher a data” removida.** O rótulo de visão já diz o que é;
  a instrução de clique competia com a ação primária. A data agora é **uma linha só**, com
  ícone de calendário, altura de botão (36px) e `aria-label` que diz o alcance
  (“Escolher data (7 dias)”) — informação preservada para leitor de tela, ruído removido da tela.
- **Fila:** o gatilho é navegação, não alarme. Badge com contagem (`Fila · 3`) em **neutro**
  (`--surface-3` + `--border`) em vez de âmbar; o alerta real de espera continua na
  `AttentionStrip` (fila longa). Abre no painel/rail no desktop e como overlay em tela pequena
  (comportamento existente preservado).
- **Dia/Semana/Mês/Lista → SEGMENTED CONTROL** (`<Segmented>`, novo em `ui.tsx`):
  um controlo só, `role="tablist"`, indicador **único** que desliza (transform medido do botão
  real, `ResizeObserver`), 200ms com a curva do sistema, seleção em marca + texto branco.
  Sem sublinhado de aba, sem pílula. Acessibilidade mantida e **testada**: roving tabindex,
  setas ←/→, Home/End, opção desabilitada ignorada, um único tab stop. Em ≤640px os ícones
  saem e só o rótulo fica (as quatro opções cabem sem rolar a faixa).
- Respiro: navegação `[←][Hoje][→]` de altura única e raio único, data no meio, seletor de visão
  ancorado à direita (`sm:ml-auto`), `gap-x-4`.
- **Fotos:** `Professional.photo` tem prioridade absoluta (filtro de profissional e cabeçalho de
  coluna); iniciais só como fallback do `Avatar`.
- Preservados: Dia/Semana/Mês/Lista, drag-and-drop com preview de slot, now-line, encaixe,
  check-in, filtros, escopo por profissional.

## 5. AGENDAMENTO PÚBLICO

- **Resumo duplicado removido.** Havia **dois** blocos dizendo serviço+data+horário: o card
  “Resumo” logo após a escolha do horário e “Confira seu atendimento” antes do CTA. Ficou
  **só o último**, que agora também carrega o **preço** que vivia no card excluído — nenhuma
  informação perdida, nenhuma releitura.
- Fluxo final: **horário → paciente → observação → opt-in WhatsApp → resumo final → Confirmar**.
- **Hero:** capa full-width + logo/avatar **circular atravessando exatamente metade** da
  transição (108px com -54px no mobile; 132px com -66px em ≥640px), conteúdo branco subindo com
  cantos superiores arredondados. **Logo não se repete abaixo** — o único lugar com a marca é o
  hero (comentário no `page.tsx` documenta essa regra).
- Mobile-first; preço/duração seguem a regra de `lib/pricing`.

## 6. CLIENTES — quick preview

A gaveta deixou de ser “a ficha inteira em 860px de largura” e virou **prévia de passagem**
(560px): foto, nome, telefone/e-mail, idade, desde quando é cliente, acesso ativo/inativo,
etiquetas, **próximo atendimento**, **últimos 3 atendimentos** e última conversa.
Ela **não** carrega mais atendimentos nem financeiro (menos chamadas para quem só quer
confirmar “é essa pessoa?”). Ação primária: **“Ver perfil completo”** → a rota.
O cabeçalho do sheet também ganhou o link de página completa.

## 7. PERFIL 360 — agora é PÁGINA

- **Nova rota `clientes/[id]`** (`src/app/(dashboard)/clientes/[id]/page.tsx`). O corpo da ficha
  é **o mesmo componente de sempre** (`ClientProfileDrawer`), agora com duas cascas:
  `preview` (sheet) e `page` (área principal). Zero reescrita do conteúdo, zero duplicação de regra.
- Topo: **“← Voltar para clientes”** à esquerda; à direita `WhatsApp`, `Registrar nota`,
  `Iniciar atendimento` (quando aplicável), `Editar dados` e **`+ Novo agendamento`** (primário).
  Abaixo, a carteirinha: avatar/foto, nome, idade, etiquetas, status de acesso e a grade de dados.
- **Sidebar e topbar continuam no lugar** — não é gaveta estreita, é a área principal da página.
- Dados: **nenhum endpoint paralelo**. `/api/people360` passou a aceitar `?key=` (mesmo guard de
  permissão `clientes`, mesmo payload) para carregar **uma** pessoa por identidade estável em vez
  de varrer a lista paginada. Sem `key` o comportamento é exatamente o de antes.
- Tutor ≠ Pet preservado: veterinária continua com tutor (contato/responsável) e PET como
  paciente, com ficha própria do animal. Nenhum módulo regulatório novo foi criado.
- Estados próprios: esqueleto de carregamento, `AccessDenied` (403), `AreaLoadError` com
  “Tentar novamente”, unidade ausente e “pessoa não está na base desta unidade”.

## 8. TIPOGRAFIA

- **Achado real:** `tailwind.config.js` declarava `fontFamily.sans: ["Inter", …]` e o Inter **não
  é carregado em lugar nenhum** — qualquer utilitário `font-sans` caía no `system-ui`, ou seja, a
  tela podia trocar de letra sem ninguém perceber. Agora `sans` aponta para
  `var(--font-geist-sans)` (Geist Sans) e a cadeia termina em `system-ui`.
- Removido o `var(--font-inter)` morto das duas regras de `globals.css` (body e `.font-display`).
- **Nada** de `font-family` alternativo em componentes (`grep` em `src`: zero ocorrências).
- Página pública intocada: ela segue o `--il-font` do tema da clínica (`globals.css:462`), que é
  decisão de produto — o refinamento vale para o painel interno.
- Escala observada nas telas revisadas: H1 22–24px/600, H2 16–18px/600, UI 13–14px/400–500,
  rótulos 11–12px/500–600; números com `tabular-nums` onde importa.

## 9. CARDS, RAIO E MOVIMENTO

- Cartão padrão do painel (`ws-panel`): `#FFFFFF`, borda `--border` (#E2E8F0), **raio 12px**
  (`--radius-lg`), sombra mínima. Cabeçalhos de seção podem viver **fora** do cartão; informação
  solta continua solta.
- **Convergência de raio:** `rounded-2xl` (16px) e `rounded-3xl` (24px) → `rounded-xl` (12px) em
  22 arquivos do painel/admin/master/legal — o “arredondado demais” deixou de existir como
  exceção. Página pública mantém o raio do tema (`--il-radius`).
- **Movimento:** uma linguagem só — `--motion-fast/base/slow` (180/200/220ms) e
  `--ease-standard: cubic-bezier(0.2,0.8,0.2,1)` em menus, accordions, segmented, popovers,
  hover, sheets e dropdowns. Sem bounce, sem spring. `prefers-reduced-motion` continua zerando
  animações e transições no scope plataforma.
- **Fundo do painel:** `--bg-gradient` estava **declarado e nunca usado** — o fundo era o
  `#f3f5fb` chapado. Agora o workspace usa o degradê 135°
  `#F8FBFF → #F7F9FC 60% → #FFF9F7` (frio → levemente quente, nunca rosa visível).

## 10. NOTIFICAÇÕES E CORES

Paleta DS 2.0 mantida. Perigo `#DC2626`; sucesso verde já aprovado; atenção âmbar limpo
(`#92400E` sobre `#FFFBEB`). **Nenhum estado técnico** usa marrom, vinho ou roxo —
a família `violet/lilac/teal` já estava neutralizada em cinzas e continua assim.
Nada de gradiente em botão, neon, glow ou roxo como cor principal.

## 11. VISÃO GERAL (§13)

Diferenciação por papel **preservada como estava**: Owner/Admin veem financeiro; Secretaria não
vê receita; Profissional não vê dinheiro nem escopo global. Refino só visual: cor concentrada em
**ícones de KPI, estados, gráficos e ação primária** (chips `--brand-soft`, `--success-bg`,
`--warning-bg`, `--danger-bg`), nenhum “cartão arco-íris”, nenhuma superfície grande saturada.

## 12. RESPONSIVIDADE (§19)

- Breakpoints trabalhados: 1440 / 1280 / 1024 / 768 / 390. Sem rolagem horizontal acidental
  (o segmented encolhe: ícones somem ≤640px; a toolbar da Agenda quebra linha com `flex-wrap`).
- **FAB de Conversas preservado**: `.conversation-shortcut` segue `position: fixed` canto
  inferior direito, 44px de altura mínima, `z-index: 34` — nada foi alterado nele nem no seu
  empilhamento a ≤1024px.
- Verificação de servidor: `/agenda`, `/clientes`, `/clientes/[id]`, `/dashboard`, `/conversas`,
  `/funil`, `/tarefas`, `/perfil`, `/configuracoes`, `/master` e a página pública `/{slug}`
  respondem **200** sem nenhum erro no log do dev server.

## 13. ACESSIBILIDADE

- Foco visível global (`:focus-visible` com `--focus-outline`), alvos de 40px (`--control-h`),
  anéis “brand + 14%” nos campos, nada de estado dependente só de cor (item ativo usa
  `aria-current`, seleção usa `aria-selected` e o indicador posicionado).
- Segmented: `tablist` + um tab stop + setas/Home/End + ESC onde há popover; sheets mantêm
  lock de scroll, devolução de foco e diálogo modal.
- Contraste **provado por teste computado** (WCAG sRGB) em `design-360-tokens`: 32 asserções,
  incluindo o novo estado selecionado da navegação (≥ 4.5:1) e bordas de foco/inputs (≥ 3:1).

## 14. TESTES

| Gate | Resultado |
|---|---|
| `npx tsc --noEmit` | **0 erros** |
| `npm run build` | **sucesso** (129/129 páginas; rota `/clientes/[id]` gerada) |
| `npm test` | **2102 passed / 5 failed / 2107** |

Os 5 fails são **pré-existentes e provados**: `a34-instagram` ×3, `automation-audit-p4` ×1,
`pipeline` ×1 (mesmos nomes, mesmos arquivos, já documentados na rodada anterior).
**Nenhum teste foi alterado para passar.** Duas regressões minhas foram corrigidas na origem:
1. `fase2-patient360` acusa a fonte por conter “Paciente 360” — a cópia visível foi restaurada
   (“Paciente 360 — perfil, agenda…”), em vez de mexer na asserção;
2. `design-360-tokens` exige token em hex de 6 dígitos — `#fff` virou `#ffffff` e as 32
   asserções de contraste voltaram a passar.
Adicionei 3 testes novos para o controle que substituiu as abas (tablist, roving tabindex,
setas, opção desabilitada): +3 testes vs. a baseline (2099 → 2102).

## 15. O QUE **NÃO** FOI TOCADO

WhatsApp/Meta/WABA, onboarding, parser corrigido, endpoints Meta, schema Supabase, arquitetura
de banco, regras financeiras, regras de agendamento, autenticação/sessão, enforcement de
permissão no backend, `capabilityFlags`, `professionalScope` (a MESMA implementação), Master +
SupportSession, multi-tenant, `/perfil` (exposição), `/tarefas`, backend de `/funil`
(re-apresentado como Clientes → Oportunidades). Nada de migração de banco, nada de dado
fictício em tenant real, nada de rota/backend removida.

---

## 16. ⚠️ VERIFICAÇÃO VISUAL — O QUE NÃO CONSEGUI FAZER

**Não capturei as 8 screenshots obrigatórias.** Motivo objetivo, não desculpa:

- o sandbox foi **re-provisionado** e perdeu o Chromium do Playwright; `npx playwright install
  chromium` falha (download de `cdn.playwright.dev` bloqueado — a egress deste ambiente só
  alcança `github.com`), não há `chromium`/`chrome` de sistema, `apt-get` não resolve pacote e
  não há CDN acessível. Sem navegador, não há screenshot.

O que fiz **em substituição**, para não parar a rodada:

1. **Build de produção** conferido artefato por artefato: o bundle CSS final contém
   `.il-segmented__thumb`, os tokens `--motion-*`, `--ease-standard`, o override
   `nav-active-bg`, `pub-hero__sheet--overlap`, `var(--font-geist-sans)` e o degradê `#f8fbff`
   — ou seja, **o que foi escrito é o que a Vercel vai servir**.
2. **Dev server rodando de verdade** (`0.0.0.0:3000`) — é o **live preview** aberto no seu
   navegador — com 200 em todas as 11 rotas internas testadas + página pública
   (`/clinicavitta`), **sem nenhum erro** no log.
3. **Testes de comportamento em jsdom** para o controle novo (a troca de acessibilidade mais
   arriscada da rodada) e o guardrail computado de contraste.
4. Leitura linha a linha dos arquivos alterados, com os números de contraste/geometria
   calculados (ex.: overlap do hero = exatamente 50% em ambos os breakpoints).

**Consequência honesta:** a conferência *“abrir → olhar → comparar com o mockup → corrigir”*
por pixel continua **sua**, no preview. Se algo estiver desalinhado, me diga a tela e o ponto —
corrijo no próximo giro. As 8 capturas que faltam: Agenda, Agenda com submenu/filtros, Topbar,
Menu de conta aberto, Sidebar com submenu aberto, Perfil 360, Agendamento público mobile e
Visão geral.

## 17. PREVIEW

- Branch publicada: `arena/01a0ce4e-instalink` @ `05fbcae` (Vercel gera o Preview do PR #37).
- Alias: `https://godoutor-git-arena-01a0ce4e-88a586-hernanicross-3509s-projects.vercel.app`
- Live preview do ambiente: dev server em `:3000` (login `demo@instalink.app / demo1234`).
