# Agenda Temporal 2.0 — spike isolado

**Estado em 2026-10-01: `NENHUM CANDIDATO APROVADO`.** Este diretório compara quatro apresentações da agenda e não integra nem substitui a página de produção, o booking público, as APIs, o modelo de `Booking` ou o banco. `domain-first` continua sendo a decisão; RBC permanece apenas candidato condicional a um futuro piloto interno, nunca uma adoção definitiva.

## Executar

Da raiz do repositório:

```bash
npm ci --prefix spikes/agenda-temporal-2
npm ci --prefix spikes/agenda-temporal-2/schedule-x
npm run spike:agenda
```

Em outros terminais, build/typecheck/testes isolados:

```bash
npm run spike:agenda:build
npm run spike:agenda:typecheck
npm run spike:agenda:test
```

Remova a linha de instalação `schedule-x/` se não for trabalhar nesse adapter. O root do GoDoutor não precisa dela nem de qualquer `spikes/**/node_modules`: instalação, TypeScript, Vitest e build da raiz são independentes. Os scripts `spike:agenda*` do root delegam com `npm --prefix`. Configuração própria do spike: `package.json`/lock, `tsconfig.json`, `vitest.config.ts` e `vite.config.ts`; Schedule-X Community também mantém package/lock isolados. O Vite atende em `0.0.0.0:3101` para o preview da Arena.

## Escopo funcional e contrato

- Candidatos: **Grade atual** (adapter de comparação, não cópia pixel-a-pixel da produção), React Big Calendar 1.20.0/MIT, FullCalendar Standard 7.1.0/MIT e Schedule-X Community 4.9.1/MIT. A UI usa nomes fictícios e um servidor de demonstração efêmero em memória; não acessa `instalink_doc`.
- `src/domain/temporal-contract.ts` guarda janelas como instantes UTC, fim exclusivo, duração congelada e timezone IANA obrigatório, sem estado/fallback global. `Service.durationMin` é sugestão para novos bookings; `Availability.slotMin` é cadência de início; snap visual é 5 min; buffers são separados. Conflito/concorrência reais continuam responsabilidade do servidor de produto, não do calendário.
- Testes do contrato cobrem São Paulo, Nova York e Los Angeles, DST gap/fold, slots, seleção 10:00–10:40, move preservando 40 min, resize 40→55, snap e rollback mock. `createIanaLuxonLocalizer(timeZone)` cria a fachada Luxon por instância sem alterar `Settings.defaultZone`.
- FullCalendar usa somente Standard/MIT; Resource TimeGrid/Vertical Resource é Premium. No Schedule-X Community, Resource Scheduler, drag-select, move e resize são Premium e não são simulados. RBC/grade expõem os gestos no spike.

## Evidências reais de browser

Chromium headless real foi iniciado por `puppeteer-core@25.12.0` + `@sparticuz/chromium@153.0.0`, **instalados somente em `/tmp/qa`** (fora do repositório); versão reportada: `HeadlessChrome/153.0.8010.0`. Testes realizados contra o preview local Vite em `3101`, em 1366×900 e 1024×900 (Dia/Semana), e 390×844 (Dia/Lista, touch). Week não foi forçada no mobile.

- Há **28 screenshots** em [`qa/screenshots/`](./qa/screenshots/): 24 da matriz inicial e quatro capturas adicionais de Dia mobile após rolar a página até o calendário: [Grade](./qa/screenshots/390x844-day-grid-scrolled.png), [RBC](./qa/screenshots/390x844-day-rbc-scrolled.png), [FullCalendar](./qa/screenshots/390x844-day-fullcalendar-scrolled.png), [Schedule-X](./qa/screenshots/390x844-day-schedule-x-scrolled.png). A largura documental ficou em 390 px; Grade e RBC têm scroll horizontal **interno** para as colunas de profissionais, sem overflow horizontal global. Algumas colunas ficam parcialmente fora da área visível. Os resultados completos estão em [`qa/viewport-matrix.json`](./qa/viewport-matrix.json).
- Em browser, Grade/RBC/FullCalendar selecionaram 10:00–10:40, moveram 10:00→11:15 mantendo 40 min e redimensionaram para 55 min; a validação mock devolveu 200. Ao repetir com a carga de 1000, o destino 11:15 conflitou com outro evento e o mock devolveu 409, mantendo/restaurando 10:00–10:40. Schedule-X Community só propõe 40 min por toque/clique; seus gestos Premium não foram executados. Detalhes em [`qa/interaction-matrix.json`](./qa/interaction-matrix.json) e [`qa/performance-matrix.json`](./qa/performance-matrix.json).
- Em 390 px, toque abriu detalhe, `Escape` fechou, criação rápida produziu `10:00–10:40 · Dra. Bianca`, e navegação avançou um dia nos quatro adapters. O método de criação difere por candidato e está anotado no JSON; são interações do spike, não booking persistido.
- Axe-core reportou **zero violações** em cada candidato no cenário desktop testado. Verificação manual confirmou Tab/Shift+Tab, Enter/Space, foco visível e Escape nos overlays; texto de status acompanha a cor. Contraste manual do texto de evento: 7,66:1–9,76:1; rótulo de hora Schedule-X: 7,20:1. Axe retornou itens `incomplete` (requerem revisão manual); isto não é certificação WCAG nem teste com leitor de tela. Matriz em [`qa/accessibility-matrix.json`](./qa/accessibility-matrix.json).

## Performance observada e decisão

Medições feitas em **uma rodada diagnóstica** por candidato/carga, sem CPU throttling, no Vite **dev** local; geração da fixture e paint de adapter foram separados. Não são SLOs nem resultado de build de produção, e não há mediana/p95. Resumo de `paintMs` / troca Dia→Semana (ms):

| Candidato | 200 eventos | 1000 eventos |
| --- | ---: | ---: |
| Grade própria | 234 / 1.595 | 667 / 4.267 |
| React Big Calendar | 637 / 3.445 | 1.988 / 11.698 |
| FullCalendar Standard | 208 / 558 | 360 / 3.000 |
| Schedule-X Community | 111 / 2.213 | 215 / 2.188 |

RBC, em 1000 eventos, também teve long task máxima de 5,32 s e troca Semana→Dia de 2,29 s; a interação real de move/resize observou wall time de 2,41/2,38 s. FullCalendar teve long task máxima de 1,15 s. Schedule-X é rápido no paint observado, mas Community não fornece os gestos/recursos exigidos sem Premium; FullCalendar Standard não tem Resource TimeGrid; a grade é implementação própria e ainda precisa justificar manutenção. Os tempos e long tasks variam por ambiente e carregamento.

**Conclusão:** nenhum candidato atende todos os gates para piloto. RBC passou pelos gestos no mock, localizer IANA por instância e verificações básicas de teclado, mas a resposta em carga 1000 — especialmente 11,7 s de troca para Semana — impede aprová-lo agora. Isso não significa “Agenda Temporal 2.0 concluída”; não houve alteração na agenda GoDoutor.

## Configuração/validação isoladas

Antes de instalar qualquer dependência do spike, foi feita uma limpeza de `node_modules`, `.next` e de `node_modules` sob `spikes/`. Em seguida, na raiz limpa do produto: `npm ci` passou (283 pacotes), `npm run build` passou, `npm run typecheck` passou e `npx vitest run` executou **2831 testes: 2827 passaram; falharam somente as quatro baselines permitidas** — 3× `a34-instagram.test.ts` e 1× `automation-audit-p4.test.ts`. Só depois foram instalados os 146 pacotes do spike e os 15 pacotes isolados de Schedule-X: build, typecheck e **18/18 testes** do spike passaram. Resultado detalhado também está registrado em [`../../docs/ADR-AGENDA-TEMPORAL-2.md`](../../docs/ADR-AGENDA-TEMPORAL-2.md).
