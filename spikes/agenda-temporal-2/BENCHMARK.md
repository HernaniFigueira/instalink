# Agenda Temporal 2.0 — evidências do spike

**Data:** 2026-10-01 · **decisão:** `NENHUM CANDIDATO APROVADO` · **escopo:** comparação em app isolado; sem migração nem alteração da agenda GoDoutor.

## Ambiente e cenário

- App local do spike via Vite, quatro adapters: Grade própria isolada, React Big Calendar 1.20.0, FullCalendar Standard 7.1.0 e Schedule-X Community 4.9.1. A Grade é referência funcional, não cópia pixel-a-pixel da rota de produção.
- Browser: `HeadlessChrome/153.0.8010.0`; `puppeteer-core@25.12.0` + `@sparticuz/chromium@153.0.0`, instalados em `/tmp/qa`, nunca no `package.json` do GoDoutor nem no repositório.
- Viewports reais: 1366×900 e 1024×900 (Dia/Semana); 390×844 (Dia/Lista, com touch). Não forçamos Week ilegível no mobile. Screenshot + dimensões/resultados: [`qa/viewport-matrix.json`](./qa/viewport-matrix.json), [`qa/screenshots/`](./qa/screenshots/) (28 arquivos; quatro capturas scrolled adicionais em 390 px).
- Fixtures: 7 eventos visuais, mais cargas determinísticas de 200 e 1000 eventos para cinco profissionais e uma semana. O destino 11:15 fica livre no demo de 200 e conflita com outro booking no demo de 1000. Resetamos a demonstração entre move e resize.
- Contrato: IANA passado explicitamente por chamada, sem zona global; instantes UTC, duração congelada, fim exclusivo. Casos Node cobrem `America/Sao_Paulo`, `America/New_York`, `America/Los_Angeles` e DST gap/fold. Isso é contrato separado do benchmark DOM.

## Matriz real de interação/render

Em cada adapter, no preview Vite, foram exercitados Day/Week, troca de candidato, seleção rápida 10:00–10:40, move 10:00→11:15, resize 40→55, scroll e conflito. A API observada é somente o **mock de demonstração**, que aguarda aproximadamente 90 ms e devolve ACK, conflito 409 ou rejeição; não é serviço de Booking nem validação de produção.

| candidato | seleção 10:00–10:40 | move 10:00→11:15 / duração | resize | conflito/rollback |
| --- | --- | --- | --- | --- |
| Grade própria | gesto real, 7 eventos | 200; 40 min, 11:15–11:55 | 200; 10:00–10:55 | em 1000, 409 esperado; restaura 10:00–10:40 |
| React Big Calendar | gesto real, 7 eventos | 200; 40 min, 11:15–11:55 | 200; 10:00–10:55 | em 1000, 409 esperado; restaura 10:00–10:40 |
| FullCalendar Standard | seleção real, 7 eventos | 200; 40 min, 11:15–11:55 | 200; 10:00–10:55 | em 1000, 409 esperado; restaura 10:00–10:40 |
| Schedule-X Community | clique/tap sugere 40 min | não suportado na edição Community | não suportado na edição Community | nenhum gesto Premium simulado |

A criação/seleção de Schedule-X Community é uma sugestão do domínio por clique, **não** drag-select. No FullCalendar usamos somente Standard/MIT; nenhum plugin Resource/Premium foi instalado. RBC e Schedule-X Community não têm os mesmos recursos de profissionais/gestos sem ressalvas descritas no ADR. Payloads e mensagens observados: [`qa/interaction-matrix.json`](./qa/interaction-matrix.json).

### Mobile e overflow

Em 390×844 com `isMobile`/`hasTouch`, os quatro adapters abriram detalhe por toque, fecharam com Escape, aceitaram criação rápida de **05 out. 2026, 10:00–10:40, Dra. Bianca**, e avançaram um dia. O método é adapter-specific: Grade por toque na grade; RBC por seleção touch; FullCalendar Standard por toque na célula; Schedule-X por toque em horário e normalização do contrato para 40 min. Screenshot Dia adicional após scroll até o calendário: [`grid`](./qa/screenshots/390x844-day-grid-scrolled.png), [`RBC`](./qa/screenshots/390x844-day-rbc-scrolled.png), [`FullCalendar`](./qa/screenshots/390x844-day-fullcalendar-scrolled.png), [`Schedule-X`](./qa/screenshots/390x844-day-schedule-x-scrolled.png).

Não houve overflow horizontal **global**: `documentScrollWidth` permaneceu 390 px nas quatro capturas adicionais. Grade e RBC têm scroll horizontal interno para colunas de profissionais; nem todas ficam visíveis simultaneamente. Week não foi forçada em 390 px. A largura sem overflow não implica que toda informação cabe sem rolar.

### Acessibilidade observada

Axe-core em Chromium (WCAG 2 A/AA, 2.1 AA e best practices) reportou **0 violações** para cada candidato no cenário desktop de Dia. O resultado tem itens `incomplete` — inclusive texto sobreposto/ícones decorativos — e requer revisão manual; não é selo de conformidade. Verificação de teclado encontrou Tab até eventos, Shift+Tab para o anterior, Enter/Space abre detalhe, Escape fecha detalhe e rascunho, nome/texto de evento e foco visível. Estado tem texto além da cor.

Contraste manual de texto nos cartões: mínimo 7,66:1 (pending) e máximo 9,76:1 (confirmed); eixo de hora Schedule-X, após override do spike, 7,20:1. RBC mostrou outline de foco azul de 5 px; nos outros três casos o foco observado foi outline padrão de 1 px. A auditoria não incluiu leitor de tela nem navegador adicional. Dados brutos: [`qa/accessibility-matrix.json`](./qa/accessibility-matrix.json).

## Performance observada no browser

Valores são **uma rodada diagnóstica**, em ordem Grade → RBC → FullCalendar → Schedule-X, Vite **dev**, Chromium headless local, viewport 1366×900, sem CPU throttling. Sem warm/cold pareado, repetição, mediana/p95 ou build de produção; não são SLO. `paint` é métrica interna adapter→dois `requestAnimationFrame`s; geração Node da fixture foi medida separadamente. `wall` de gesto inclui movimentação de ponteiro e atualização/rollback da UI; o mock artificial acrescenta cerca de 90 ms.

| candidato | eventos | geração fixture (ms) | paint adapter (ms) | troca Dia→Semana (ms) | Semana→Dia (ms) | scroll wall (ms / Δpx) | move wall / HTTP | resize wall / HTTP | long task máxima nesta sessão |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | ---: |
| Grade | 200 | 49,9 | 233,9 | 1.595 | 124 | 46 / 120 | 380 / 200 | 408 / 200 | 2.335 ms |
| Grade | 1000 | 273,2 | 667,1 | 4.267 | 575 | 44 / 120 | 522 / 409* | 613 / 200 | 2.335 ms |
| RBC | 200 | 28,9 | 637,2 | 3.445 | 1.223 | 50 / 120 | 907 / 200 | 1.133 / 200 | 5.320 ms |
| RBC | 1000 | 235,5 | 1.988,1 | 11.698 | 2.287 | 38 / 120 | 2.411 / 409* | 2.381 / 200 | 5.320 ms |
| FullCalendar Standard | 200 | 46,9 | 208,1 | 558 | 160 | 46 / 113 | 441 / 200 | 477 / 200 | 1.151 ms |
| FullCalendar Standard | 1000 | 173,8 | 359,7 | 3.000 | 584 | 76 / 113 | 825 / 409* | 555 / 200 | 1.151 ms |
| Schedule-X Community | 200 | 121,8 | 111,1 | 2.213 | 165 | 86 / 120 | n/s | n/s | 703 ms |
| Schedule-X Community | 1000 | 182,4 | 215,3 | 2.188 | 657 | 48 / 120 | n/s | n/s | 703 ms |

`*` O 409 é a colisão intencional no fixture de 1000, não falha do browser: horário original 10:00–10:40 permaneceu. Resize começou após reset e foi validado para 10:00–10:55. O status `409` do move refere-se à rejeição mock; a tabela não atribui ao calendário autoridade de conflito.

Primeira tela utilizável, uma observação por aba sem normalização de cache: Grade 252 ms; RBC 1.678 ms (inclui carregamento dinâmico, troca de adapter 1.477 ms); FullCalendar 606 ms (troca 444 ms); Schedule-X 423 ms (troca 297 ms). Máximas de long task ao longo da sessão foram 2,335 s / 5,320 s / 1,151 s / 703 ms, respectivamente. Contagem de nós renderizados varia por adapter/viewport e não é contagem dos 1000 eventos na semana.

**Leitura do resultado:** RBC é funcional no cenário mock e cumpre IANA por instância, mas em carga de 1000 a troca Dia→Semana observada durou 11,7 s, a maior long task 5,32 s e move/resize levaram cerca de 2,4 s. Esse perfil não sustenta aprovação para piloto neste momento. FullCalendar mostrou transições mais rápidas, mas falta Resource TimeGrid no Standard; Schedule-X Community não fornece os gestos/recursos exigidos sem Premium; a Grade mantém custo de implementação próprio. Portanto, `NENHUM CANDIDATO APROVADO`.

## Bundle do build isolado

`npm run spike:agenda:build` após instalação isolada: Vite 8.3.2; 563 módulos transformados. Tamanhos do build, em kB, exatamente como reportados pelo Vite:

| chunk | JS bruto | JS gzip | CSS bruto | CSS gzip |
| --- | ---: | ---: | ---: | ---: |
| Base comum (app/React/contrato) | 224,66 | 73,98 | 25,60 | 5,79 |
| Grade — adapter sob demanda | 8,28 | 3,27 | incluído na base | incluído na base |
| React Big Calendar — adapter + dependências | 314,41 | 91,19 | 12,07 | 2,65 |
| FullCalendar Standard — adapter + dependências | 275,71 | 75,36 | 16,61 | 3,75 |
| Schedule-X Community — adapter + dependências | 239,20 | 71,20 | 27,92 | 5,12 |
| Evento customizado compartilhado | 1,03 | 0,49 | — | — |

Os candidatos são imports dinâmicos e o chunk não selecionado não entra no carregamento inicial. Bundle do Vite não é tamanho final da rota Next de produção. Schedule-X mantém `schedule-x/package.json` e lock separados por conflito de peer do `temporal-polyfill` 0.3.2 vs 1.0.1; nenhum pacote Premium foi instalado.

## Isolamento e validação do root

A sequência exigida foi executada **antes** de reinstalar o spike:

1. removidos `node_modules`/`.next` da raiz e todos os `spikes/**/node_modules` preexistentes; confirmado que não havia dependência do spike;
2. `npm ci` na raiz: sucesso, 283 pacotes adicionados;
3. `npm run build` (Next.js 14.2.35): sucesso;
4. `npm run typecheck`: sucesso;
5. `npx vitest run`: 205 arquivos, **2831 testes; 2827 passaram e somente quatro falhas de baseline permitidas** — 3× `a34-instagram.test.ts`, 1× `automation-audit-p4.test.ts`. Nenhum teste do spike foi coletado pelo root;
6. somente então `npm ci --prefix spikes/agenda-temporal-2` (146 pacotes) e `npm ci --prefix spikes/agenda-temporal-2/schedule-x` (15 pacotes); build e typecheck do spike passaram, Vitest isolado passou **18/18**.

O `tsconfig.json` root agora exclui `spikes/**`, os aliases para dependências em `spikes/**/node_modules` e `allowImportingTsExtensions` do spike foram removidos; Vitest root inclui só `src/**/*.test.{ts,tsx}`; dependências exclusivas da comparação saíram do root. Os scripts root de conveniência apenas delegam via `npm --prefix`. Essa validação demonstra que o build do GoDoutor não requer instalar as dependências do spike.

## Vercel

O deployment de preview anterior para o SHA `667d927` falhou. A antiga configuração TypeScript da raiz incluía os fontes do spike e apontava aliases para `spikes/agenda-temporal-2/schedule-x/node_modules`, que o install root do Vercel não instala. O sandbox não tinha credenciais Vercel para recuperar o log detalhado (`vercel inspect` retornou “No existing credentials”); o clean-room root build reproduzível agora passa sem nenhum `spikes/**/node_modules`, e o isolamento foi corrigido. **Antes de concluir esta tarefa, registrar aqui e no ADR o resultado do novo deployment Vercel do commit final; o status final precisa ser `SUCCESS`.**

## Artefatos e limites

- Screenshots/matriz: [`qa/screenshots/`](./qa/screenshots/) e [`qa/viewport-matrix.json`](./qa/viewport-matrix.json).
- Interações (HTTP mock, coordenadas e payloads): [`qa/interaction-matrix.json`](./qa/interaction-matrix.json).
- Axe, teclado, foco e revisão manual: [`qa/accessibility-matrix.json`](./qa/accessibility-matrix.json).
- Paint, transições, scroll, gestos, long tasks e erros de browser: [`qa/performance-matrix.json`](./qa/performance-matrix.json).
- Node/Vitest mede geração e contrato; não se mistura com paint. O teste usa uma sessão Chromium, não outro engine, e não mede produção/SSR real. `dist/` é descartável.
