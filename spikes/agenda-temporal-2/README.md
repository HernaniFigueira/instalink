# Agenda Temporal 2.0 — spike isolado

Este diretório contém uma comparação executável, sem integração à agenda de produção. O adapter “Grade atual” isola o padrão de grade/gestos e reutiliza helpers puros de `src/lib/agenda-drag.ts`; ele não embute nem pretende ser uma cópia pixel-a-pixel da página de produção (`src/app/(dashboard)/agenda/page.tsx`). Usa nomes e horários fictícios; o servidor Vite expõe apenas endpoints de demonstração com estado em memória e não consulta nem grava `instalink_doc`.

## Executar

Na raiz do repositório:

```bash
npm run spike:agenda
```

O Vite atende em `0.0.0.0:3101` para o preview da Arena. Build isolado: `npm run spike:agenda:build`. Testes focados (contrato, shell React, localizer IANA e geração da carga): `npm run spike:agenda:test`; eles também são descobertos por `npx vitest run`.

**Limite atual:** a homologação manual em Chromium/browser não ocorreu porque o browser não pôde ser instalado (CDN e repositórios de sistema indisponíveis). HTTP 200, jsdom e build não equivalem a screenshot/validação visual; veja o estado e os comandos tentados em [`docs/ADR-AGENDA-TEMPORAL-2.md`](../../docs/ADR-AGENDA-TEMPORAL-2.md).

## Roteiro manual

1. Compare **Grade atual**, **React Big Calendar**, **FullCalendar Standard** e **Schedule-X Community**. A barra de navegação, seletor de vista, filtro, detalhe e mensagens são do shell do spike, não da biblioteca.
2. Use Dia, Semana e Lista. Orlando, Ana e Carlos aparecem como recursos na vista Dia do RBC; a fixture inclui um procedimento de 90 min e estados semânticos. Na Semana, filtre um profissional para reduzir colunas; as cargas 200/1000 mantêm cinco profissionais. FullCalendar Standard e Schedule-X Community não incluem Resource View; a alternativa Premium está descrita no ADR. Em viewport de 390 px, a preferência inicial é Lista; valide visualmente que não há overflow horizontal.
3. Na Grade atual, RBC e FullCalendar, arraste uma área para selecionar **10:00–10:40**. O painel leve permite alterar Serviço e duração sugerida; no Schedule-X Community o clique apenas propõe 40 minutos — não representa drag-select.
4. Com `booking-orlando-1000`, mova **10:00 → 11:15** e confirme que os 40 minutos permanecem. Redimensione pela borda inferior para **55 minutos**, em passos de 5. RBC e FullCalendar Standard expõem esses gestos; a Grade atual implementa seus próprios. Schedule-X Community bloqueia move/resize porque os plugins reais são Premium.
5. Tente sobrepor o evento de teste das 12:30 do Orlando. A API efêmera deve rejeitar, mostrar mensagem humana e restaurar o horário anterior. `completed`, `cancelled` e `no_show` são somente leitura. O servidor real é a autoridade em produção; nenhuma decisão de conflito fica no calendário.
6. Escolha 200 e depois 1000 eventos (5 profissionais, uma semana). Use o indicador local adapter+eventos apenas como tempo aproximado de carga/montagem e o request/ack como fluxo fictício; meça separadamente paint, scroll, seleção, drag, resize, rerender e erros conforme [`BENCHMARK.md`](./BENCHMARK.md). Não use tempos deste servidor de demonstração como SLO.

## Isolamento e dependências

- `src/domain/temporal-contract.ts` é independente de biblioteca: instantes UTC, fim exclusivo, duração congelada e timezone IANA exigido como argumento (sem fallback silencioso). Os quatro adapters recebem o fuso do negócio explicitamente e convertem entre esse contrato e o tipo esperado pela biblioteca.
- O adapter RBC usa `createIanaLuxonLocalizer(timeZone)`: uma fachada Luxon por instância, sem escrever em `Settings.defaultZone`. Dois fusos simultâneos passam em testes Node; isso ainda requer confirmação visual real no browser.
- `src/domain/server-mock.ts` valida conflitos e versões obsoletas em memória. Não substitui persistência, autorização, concorrência distribuída ou regras de produção.
- Os adapters são carregados dinamicamente: o HTML inicial não baixa as três bibliotecas não selecionadas. Os tamanhos observados e suas limitações estão em `BENCHMARK.md`.
- `schedule-x/` tem package/lockfile próprios porque `@schedule-x/calendar@4.9.1` exige `temporal-polyfill@0.3.2`, enquanto o domínio e FullCalendar 7.1.0 usam `temporal-polyfill@1.0.1`. O conflito de peer é isolado; nenhum pacote Premium foi instalado ou simulado.
- FullCalendar usa somente Standard/MIT: nenhum pacote Scheduler/Premium. RBC 1.20.0 e Schedule-X Community 4.9.1 são MIT; recursos comerciais do Schedule-X permanecem fora do spike.
- `dist/` é saída descartável do Vite e não integra o patch.
