# Agenda Temporal 2.0 — cenário e medições do spike

**Data do levantamento:** 2026-10-01 · **estado:** cargas e bundle reproduzíveis; interação/render/scroll em browser ainda pendentes. Este artefato é Etapa A, não homologação visual nem SLO de produção.

## 1. Cenário reproduzível

- **Base:** 5 profissionais, uma semana fixa, fuso `America/Sao_Paulo`, serviços de 20/30/40/55 minutos e estados pendente, confirmado, concluído, não compareceu e cancelado.
- **Carga normal:** 7 eventos realistas; **benchmark principal:** 200; **stress:** 1000.
- Os eventos gerados ficam em slots determinísticos sem sobreposição ativa por profissional. A âncora `booking-orlando-1000` (10:00–10:40) e o conflito de teste das 12:30 permanecem fixos em todas as cargas.
- **Bibliotecas comparadas:** Grade atual, React Big Calendar 1.20.0, FullCalendar Standard 7.1.0 e Schedule-X Community `@schedule-x/calendar` 4.9.1 / React 4.1.0. Cada adapter é lazy-loaded; o início não pré-carrega as outras três bibliotecas.
- **Gestos-alvo:** drag-select 10:00–10:40; mover o evento de 10:00 para 11:15 preservando 40 min; resize até 55 min, passo de 5; provocar conflito e conferir rollback com mensagem legível. No Schedule-X Community, drag-select/move/resize não são oferecidos pelo pacote livre e não são falsificados.

O comparator **Grade atual** é uma implementação isolada do padrão atual de grade/gestos, que reutiliza helpers puros de `src/lib/agenda-drag.ts`; não embute a rota real `src/app/(dashboard)/agenda/page.tsx` e não serve como comparação pixel-a-pixel com a produção. Os números de bundle e a interação observada descrevem o spike.

### Roteiro manual — a executar em browser suportado

1. Carregar uma vez cada candidato em viewport desktop; limpar cache entre a medida fria e a repetição aquecida. Registrar também o tempo de troca de adapter.
2. Em 7 eventos, verificar Dia/Semana/Lista, evento customizado e toolbar externa. No RBC, medir recursos Profissional em Dia; na Semana filtrar um Profissional para não produzir 35 colunas. Marcar explicitamente as vistas não disponíveis em cada edição/licença.
3. Em 200 eventos, repetir seleção, scroll vertical, move, resize e rerender após uma atualização. Fazer cinco repetições por candidato e registrar mediana e p95; não comparar um candidato frio com outro já aquecido.
4. Em 1000 eventos, repetir scroll/rerender e os gestos-alvo. Usar o mesmo viewport, máquina, filtro, data e ordem; reiniciar a fixture antes de cada sequência.
5. A 390 px, abrir cada candidato, confirmar Lista como vista inicial, toolbar utilizável e `document.documentElement.scrollWidth <= window.innerWidth`. Anotar qualquer rolagem horizontal local do calendário como decisão explícita, não como overflow global.
6. Em cada teste de move/resize, provocar conflito no profissional correto; registrar gesto → resposta do servidor → render do rollback. O servidor de demonstração adiciona 90 ms artificiais para tornar `pending` perceptível; esse tempo não representa a API real.

| candidato | carga | viewport | vista | cold/warm | paint | scroll | select | move | resize | rerender | conflito/rollback | overflow global | observações |
| --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| Grade atual | 7 / 200 / 1000 | 1366 × 900 | Dia/Semana/Lista | — | pendente | pendente | pendente | pendente | pendente | pendente | pendente | pendente | — |
| React Big Calendar | 7 / 200 / 1000 | 1366 × 900 | Dia/Semana/Agenda | — | pendente | pendente | pendente | pendente | pendente | pendente | pendente | pendente | recurso Profissional no Dia |
| FullCalendar Standard | 7 / 200 / 1000 | 1366 × 900 | TimeGrid Day/Week + List | — | pendente | pendente | pendente | pendente | pendente | pendente | pendente | pendente | sem Resource View Standard |
| Schedule-X Community | 7 / 200 / 1000 | 1366 × 900 | Day/Week/List | — | pendente | pendente | não suportado* | não suportado* | não suportado* | pendente | bloqueado* | pendente | `*` exige Premium |
| Todos | 7 / 200 / 1000 | 390 × 844 | Lista inicial | — | pendente | pendente | conforme edição | conforme edição | conforme edição | pendente | conforme edição | pendente | browser real obrigatório |

## 2. O que foi medido neste checkout

### Build isolado

Comando: `npm run spike:agenda:build` (`vite build --config spikes/agenda-temporal-2/vite.config.ts`). Ambiente observado: Linux x86_64, Node 22.22.3, Vite 8.3.0; gzip conforme o relatório do Vite. São bytes dos chunks do spike (adapter + dependências transpiladas), não uma medição isolada de cada pacote upstream nem uma comparação do build Next de produção.

| saída do build | JS bruto | JS gzip | CSS bruto | CSS gzip |
| --- | ---: | ---: | ---: | ---: |
| Base comum (aplicação/React/contrato) | 224.13 kB | 73.83 kB | 23.99 kB | 5.52 kB |
| Grade atual — adapter sob demanda | 7.90 kB | 3.14 kB | incluído na base | incluído na base |
| React Big Calendar — adapter + dependências | 313.17 kB | 90.68 kB | 12.07 kB | 2.65 kB |
| FullCalendar Standard — adapter + dependências | 274.87 kB | 75.00 kB | 16.61 kB | 3.75 kB |
| Schedule-X Community — adapter + dependências | 238.44 kB | 70.87 kB | 27.92 kB | 5.12 kB |
| Evento customizado compartilhado | 1.03 kB | 0.48 kB | — | — |

O `index.html` gerado contém só o JS/CSS base; os chunks e estilos dos candidatos aparecem como imports dinâmicos do adapter selecionado. Portanto, a carga inicial do spike não soma os três calendários. A tabela continua dependente de árvore de imports/versões e não prevê o chunk final de produção.

### Geração das fixtures (não é render de calendário)

`npm run spike:agenda:test` mede `benchmarkEvents()` em Node/Vitest e valida quantidade de eventos e cinco profissionais. Execução isolada registrada às 12:16:42: **200 eventos: 79.07 ms; 1000 eventos: 261.69 ms**. É apenas uma amostra da geração determinística no processo de testes; não inclui DOM, layout, paint, scroll ou interação e varia com a máquina.

### Testes de contrato/UI

No momento do registro, os testes focados cobrem mapeamento Dia/Semana/Lista, seleção 10:00–10:40, movimento preservando 40 min, resize 40→55, snap de 5 min, timezone IANA/DST ambíguo ou inexistente, leitura de `date/time` legado, status acessível, vista Lista até 600 px, shell React em 390 px, painel de seleção e rejeição/rollback pelo servidor de demonstração. Testes jsdom não comprovam dimensões de layout nem gestures reais do navegador.

## 3. Medições ainda não obtidas

Não há resultados reais de render, scroll, drag/resize, jank, recálculo de layout, responsividade visual ou tempos de resposta em browser. Playwright não encontrou um browser instalado; o download do Chromium falhou por reset TLS e o Chromium temporário não inicializou por ausência de bibliotecas NSS/NSPR do sistema. Assim:

- os campos `pendente` acima **não** devem receber estimativa a partir de Vitest, Vite ou bundle;
- o indicador local `adapter + N eventos` só deve ser usado em browser para uma observação de handler até dois `requestAnimationFrame`s após o adapter resolver/montar; não é profiler nem métrica de frame contínuo;
- “API mock · request/ack” inclui o atraso artificial de 90 ms e só valida o caminho visual de confirmação/reversão;
- a verificação de 390 px ainda requer browser para provar ausência de overflow horizontal real.

Antes de usar performance como argumento para adoção, completar este roteiro em Chromium e ao menos um motor de browser adicional, com medidas repetidas e gravação do ambiente/versão. A decisão arquitetural do ADR se apoia em domínio, recursos, timezone, licença, capacidade funcional e custo de bundle — não em benchmark de render inexistente.
