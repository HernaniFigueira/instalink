# ADR — Agenda Temporal 2.0

- **Data:** 2026-10-01
- **Status:** **SPIKE/ADR IMPLEMENTADO · HOMOLOGAÇÃO REAL BLOQUEADA / SEM CANDIDATO APROVADO**
- **Escopo:** auditoria do domínio, contrato, comparação executável, testes focalizados e benchmark; **nenhuma substituição integrada na agenda de produção**.
- **Base auditada:** `main` e `origin/main` em `6064bb29333ee0cd4de69cc6e554eb4a3289f793`; sem drift no início desta etapa.

## Decisão

Adotar uma arquitetura **domain-first e independente da biblioteca**, mantendo a grade atual em produção. O **React Big Calendar 1.20.0 (MIT)** continua apenas candidato condicional a piloto: entrega Day/Week, seleção e drag/resize em passos de 5 minutos e recurso Profissional sem licença Premium. O spike agora cria um localizer Luxon por instância com timezone IANA explícito, sem alterar `Settings.defaultZone`; testes Node comprovam São Paulo e Los Angeles no mesmo processo e rejeitam ausência/fuso inválido. Isso ainda **não aprova** piloto: o browser real não pôde ser instalado neste ambiente, então 1366/1024/390, gestos, concorrência visual, acessibilidade e performance permanecem sem homologação. Revalidar tudo no roteiro em [`spikes/agenda-temporal-2/BENCHMARK.md`](../spikes/agenda-temporal-2/BENCHMARK.md).

Esta escolha define direção para uma próxima etapa, **não autoriza integração nesta**. O contrato e a autoridade de validação permanecem no domínio/API GoDoutor; cada biblioteca é somente uma camada de apresentação substituível. FullCalendar Standard continua alternativa caso suporte de fuso e qualidade do ecossistema pesem mais que recursos sem custo; sua Resource View é Premium e requer decisão comercial explícita. Não adquirir Schedule-X Premium nesta etapa.

## Contexto e auditoria do domínio existente

A auditoria precedeu as alterações do spike e percorreu agenda, reservas, serviços, profissionais, disponibilidade/horários, slots, recorrência, check-in, fila, workflow, encaixe/reagendamento, booking público/widget e APIs de agente/externas, fuso, permissões e escopo profissional. O código de produção não importa nenhum módulo do spike.

| Área | Estado observado antes da implementação | Consequência para Agenda 2.0 |
| --- | --- | --- |
| Booking (`src/lib/types.ts`) | Guarda `date: YYYY-MM-DD` e `time: HH:MM`; ainda não guarda `startAt`, `endAt` ou snapshot próprio de duração/fuso. | A leitura antiga é horário civil, não um instante inequívoco. A nova janela não pode ser deduzida indefinidamente da configuração atual do serviço. |
| Serviço | `Service.durationMin` participa da criação e do cálculo de ocupação; é o default do serviço, não snapshot imutável do agendamento. | Congelar duração em cada booking novo; editar Serviço não pode alongar/encurtar eventos históricos. |
| Grade e disponibilidade | `Availability.slotMin` define cadência de início da janela. `src/lib/slots.ts` ainda aplica mínimo de 10 min e recorre à duração do serviço quando o passo não está configurado. A grade própria tem helpers em `src/lib/agenda-drag.ts`. | Separar cadência de slots e granularidade visual de drag. Não reutilizar `slotMin` como duração nem como snap de move/resize; remover o acoplamento em etapa própria. |
| Buffer | `BookingConfig.bufferMin` é um único intervalo de clínica e o motor o soma após o evento para conflito. | Evoluir para `bufferBeforeMin` e `bufferAfterMin`, sem alterar a duração visível do atendimento. |
| Elegibilidade | `Service.professionalMode`/`professionalIds`, profissionais ativos, disponibilidade herdada ou própria, exceções e recursos Profissional são avaliados pelo motor de slots no servidor. | A biblioteca pode sugerir alvos; não pode substituir as regras de elegibilidade, a disponibilidade real ou a autoridade de conflito. |
| Recursos | Profissional participa do domínio; Sala e Equipamento ainda não são recursos de reserva com disponibilidade própria. | Modelar todos os recursos exigidos na validação do mesmo intervalo antes de declarar horário válido. |
| Encaixe e conflitos | `Booking.bookingKind = 'fit_in'` e o domínio de encaixe já existem; o encaixe reconhece explicitamente uma exceção/conflito. | Preservar um override interno intencional, autorizado e auditado; nunca transformar bloqueio em booking falso nem aplicar override no público. |
| Status/workflow | `BookingStatus` é `pending`, `confirmed`, `cancelled`, `completed` ou `no_show`. Check-in e cadeia de reagendamento já existem; etapa clínica é derivada e não deve ganhar uma quarta máquina persistida. | Move/resize editável apenas onde política permite. Eventos terminais são leitura; reagendamento terminal segue a cadeia existente. |
| Caminhos de escrita | `/api/bookings`, criação via lead/agente/assistente, série, widget/cliente e `/api/customer/bookings` convivem com `date/time`; APIs de disponibilidade externa/assistente chamam o motor de slots. A autoridade hoje é o servidor. | Centralizar normalização e escrita temporal; compatibilidade deve permanecer na borda da API enquanto consumidores migram. |
| Fuso | O negócio já usa fuso para horário local/dia operacional, mas `Booking.date/time` não o congela junto ao agendamento. | Gravar o fuso IANA de captura; nunca interpretar o horário de um evento no fuso do browser por conveniência da biblioteca. |
| Permissões e escopo | Agenda/booking respeita business/ator e escopo real do Profissional no servidor; o estado de workflow é calculado para quem lê. | A UI pode ocultar affordances, mas todo create/move/resize precisa revalidar papel, tenant, dono e serviço no servidor. |
| Persistência | `src/lib/db.ts` mantém o agregado JSONB em `instalink_doc` (ou arquivo local) e serializa writes; tabelas `godoutor_internal` são criadas por migrations. | Nenhuma migração ampla do documento durante a Etapa A. Um eventual store temporal normalizado requer decisão e plano próprios; não criar duas fontes mutáveis. |

Também foram revistos `booking-create.ts`, `booking-ops.ts`, `booking-series.ts`, `fit-in.ts`, `schedule.ts`, `slots.ts`, rotas de booking/customer/external, workflow/check-in/fila e as regras de escopo. A síntese acima registra lacunas de modelagem sem reimplementar esses domínios no spike.

## Contrato temporal canônico

A janela canônica de um booking é:

```ts
type BookingWindow = {
  startAt: string;       // instante ISO/RFC 3339 UTC, início inclusivo
  endAt: string;         // instante ISO/RFC 3339 UTC, fim exclusivo
  durationMin: number;   // snapshot inteiro; invariantemente endAt - startAt
  timeZone: string;      // fuso IANA em que a intenção local foi capturada
};
```

- `startAt` e `endAt` são a autoridade temporal. `endAt > startAt`; cada ocorrência de série tem sua própria janela. Datas civis não são somadas como strings.
- `durationMin` pertence ao **Booking** e é congelada na criação. `Service.durationMin` é somente sugestão/default para novos agendamentos; alterar Serviço nunca reescreve um booking já criado. Se a duração excepcionalmente for editada num booking, move preserva a duração atual e resize altera apenas o fim, sempre com validação.
- `timeZone` preserva o contexto de negócio da intenção. Converter uma data/hora civil para instante usa o fuso do negócio no momento de captura; mudança posterior de fuso da clínica não reinterpreta um instante persistido. Horário local ambíguo ou inexistente por DST exige escolha explícita em vez de ajuste silencioso.
- Intervalos seguem `[startAt, endAt)`: uma consulta que termina às 10:40 não conflita com outra que começa às 10:40, salvo buffers efetivos.
- **Snap visual = 5 min.** É granularidade para seleção/movimento/redimensionamento, não duração de consulta, não `Availability.slotMin`, e não garantia de que o horário é elegível. O servidor pode rejeitar um drop encaixado visualmente.
- `Availability.slotMin` continua significando cadência de inícios sugeridos na disponibilidade. A cadência de início público pode ser diferente do snap de 5 min da agenda interna.
- **Buffers** são ocupação/folga fora da janela do atendimento, sem esticar `durationMin` nem o cartão: `bufferBeforeMin` + `bufferAfterMin`. Precedência planejada: **Profissional × Serviço → Serviço → clínica**. O valor legado `BookingConfig.bufferMin` deve ter regra de compatibilidade documentada (equivalência temporária a buffer após o evento); não reinterpretar sem auditoria.
- Override futuro de duração pode ser **Profissional × Serviço → Serviço → default do produto**, editável e auditável. A resolução fica no serviço de domínio, não num callback de calendário.
- Reserva recorrente continua como ocorrências independentes, cada qual com `startAt/endAt`, identidade e histórico próprios.

### Compatibilidade com `date` / `time` sem big-bang

1. A borda de leitura reconhece um booking canônico quando `startAt/endAt` existem e são válidos. Enquanto faltarem, interpreta o par legado `date/time` no fuso efetivo do negócio e resolve uma duração **uma única vez**.
2. Se houver snapshot confiável de duração já gravado, usá-lo. Em registros sem snapshot, o default de Serviço disponível na migração é uma **inferência**, não prova histórica: gravar a duração resolvida e marcar/auditar origem legada para que não mude a cada edição futura de Serviço.
3. Durante a expansão, APIs antigas continuam recebendo `date/time` como projeção de `startAt` no fuso da clínica. Novas escritas passam pelo normalizador/repositório central e mantêm compatibilidade na mesma unidade atômica de gravação. Não permitir que cada tela grave duas autoridades diferentes.
4. Migrar dados em lotes idempotentes, por business, com contagem de divergências, órfãos, durações inferidas, conflitos e casos DST ambíguos. Pausar para revisão quando um registro não puder ser convertido com segurança; não corrigir silenciosamente nem regravar todo `instalink_doc` em uma operação.
5. Manter projeções legadas enquanto consumidores de agenda, fila, relatórios, recorrência, check-in, automação, assistente e canais externos dependerem delas. Só remover `date/time` por etapa posterior, depois de paridade e busca de referências.

**Persistência:** a Etapa A não muda schema. A primeira expansão deve caber no repositório de Booking existente e não fazer backfill global. Só depois de centralizar writes e preservar atomicidade cabe ADR próprio para normalização multi-tenant via migrations autorizadas; evitar um segundo registro temporal autoritativo em paralelo ao agregado atual.

## Política: interno, público e servidor

- **Agenda interna:** seleção/encaixe visual não grava. Um `create/move/resize` submete intervalo, alvo e versão/estado atual; servidor confere business/ator, escopo do Profissional, status editável, serviço elegível, horário/exceção, overlap, buffers e todos os recursos. Em conflito, retorna conflito legível e mantém/restaura o estado original. `fit_in` pode continuar como exceção **explícita**, com capacidade do papel, motivo e auditoria; não relaxa tenant nem elegibilidade.
- **Booking público/widget/assistente externo:** não recebe `fit_in`, `force`, seleção fora dos slots ou override confiado do browser. O servidor revalida elegibilidade, janela, antecedência/horizonte, disponibilidade e recursos no write, mesmo que o cliente tenha consultado slots há instantes.
- **Concorrência:** revalidar e persistir de forma atômica, rejeitar versão obsoleta/idempotência conflitante e devolver estado atual seguro. O mock local prova apenas a forma do fluxo, não lock distribuído.
- **Bloqueio:** férias/folga/bloqueio é disponibilidade ou exceção própria, não appointment falso. Eventos cancelados/concluídos/falta preservam seu significado histórico.
- **UX não é segurança.** Botão escondido, drag cancelado no browser ou calendário que não mostra um horário jamais substituem guard server-side.

## Comparação de candidatos — versões/licenças verificadas em 2026-10-01

O spike real está em [`spikes/agenda-temporal-2/`](../spikes/agenda-temporal-2/); cada candidato tem adapter, mesmos fixtures e contrato, toolbar/seleção/detalhe de produto fora da biblioteca e status com rótulo além de cor.

| Candidato | Versão e licença | Day/Week e gesto | Recursos/licença | Fuso e Design System | Resultado para esta decisão |
| --- | --- | --- | --- | --- | --- |
| Grade atual | Código interno, sem pacote novo | A página de produção é `src/app/(dashboard)/agenda/page.tsx`. O adapter isolado reproduz a geometria/seleção/drag e reutiliza helpers puros de `src/lib/agenda-drag.ts`; não é embed nem comparação pixel-a-pixel da página. Custo incremental menor. | O layout próprio pode ser moldado ao Profissional; Sala/Equipamento ainda dependem de domínio novo. | Controle total de CSS e experiência conhecida; cada affordance, acessibilidade e regressão continua sob manutenção nossa. | Referência/base de rollout. Não substituir sem provar que biblioteca reduz custo sem perder os fluxos atuais. |
| **React Big Calendar** | `react-big-calendar@1.20.0`, **MIT** | Day/Week/Agenda; adapter usa seleção, addon DnD, move e resize, `step=5`; toolbar externa e evento React customizado. | Recursos incluídos no core; spike exibe Orlando, Ana e Carlos no Dia sem licença Premium. Semana usa filtro profissional para evitar colunas excessivas; as fixtures de benchmark preservam 5 profissionais. Recursos combinados Sala/Equipamento ainda exigem validação do domínio. | `createIanaLuxonLocalizer(timeZone)` injeta uma fachada Luxon por instância; teste com São Paulo e Los Angeles em paralelo confirma horários e não altera `Settings.defaultZone`. É evidência Node, não prova de comportamento do RBC em browser/SSR. CSS deve permanecer escopado e ajustado ao Design System. | **Candidato condicional, não aprovado para piloto**: pendem browser real, keyboard/touch, 390 px, densidade e performance. |
| FullCalendar Standard | `@fullcalendar/react@7.1.0` + plugins **Standard/MIT** | TimeGrid Day/Week + List, interação de selecionar/arrastar/redimensionar e snap de 5 min no adapter Standard. Custom event e toolbar externa funcionam no spike. | **Não** tem Resource TimeGrid/Vertical Resource. Recurso como coluna exige Scheduler/Premium; a página consultada informa preço começando em US$ 480. Nenhum plugin Premium foi instalado. | API documenta zona nomeada e uso de Temporal; forte caminho para converter callbacks sem usar o fuso do browser. CSS próprio exige tokens/escopo. | Boa alternativa se timezone/manutenção superar recurso gratuito; adoção de Premium depende de custo/termos e decisão explícita, não entra por acidente. |
| Schedule-X Community | `@schedule-x/calendar@4.9.1`, React `4.1.0`, pacote MIT | Day/Week/List e Temporal nativo; evento React customizado. O clique de célula pode sugerir 40 min, mas Community não demonstra drag-select. | Resource Scheduler, drag-to-create, drag/drop e resize são **Premium**; DnD/resize Premium documentados em 15/30/60 min, sem o snap requerido de 5 min. A página consultada lista €479/ano + VAT (2–3 devs) ou €999 + VAT lifetime, por produto. | Boa composição visual com custom components; CSS Community acrescenta tema e exige adaptação ao Design System. O peer `temporal-polyfill@0.3.2` conflita com o 1.0.1 usado no restante do spike, por isso ficou isolado em package/lock próprios. | Rejeitado como editor interno gratuito para este contrato; pode ser considerado read-only ou mediante nova decisão/licença, não simular recursos pagos. |

A página de pricing do FullCalendar declara Standard gratuito/MIT e Premium a partir de US$ 480; o índice separa `/timegrid`, `/list` e `/interaction` Standard de `resource-timegrid`/Timeline Premium. No Schedule-X, a documentação e pricing confirmam que recurso, move/resize e drag-to-create são Premium. A comunidade RBC publicou v1.20.0 em 2026-06-01; `npm view` e o package registry indicaram MIT para RBC, FullCalendar Standard e Schedule-X Community na consulta.

### Bundle observado

Build isolado Vite, adapters dinâmicos e tamanhos por saída estão detalhados no benchmark. Rebuild pós-ajuste IANA: base JS 224.37 kB / 73.89 kB gzip; adapters + dependências sob demanda: RBC 313.44 / 90.80 kB, FullCalendar Standard 274.87 / 75.00 kB, Schedule-X Community 238.45 / 70.87 kB; grade própria 7.93 / 3.14 kB (chunk de evento customizado 1.03 / 0.48 kB compartilhado à parte). CSS segue em chunks por adapter. Isso corrige o primeiro build do spike, que pré-carregava todas as bibliotecas; estes tamanhos não medem render nem são critério isolado de adoção.

Não foi possível medir paint/scroll/drag em browser nesta etapa. A ausência desses números não é preenchida com estimativa de Vitest ou bundle.

## UX e integração ao Design System

- Interação de agenda simples, com referência visual Google Calendar: toolbar clara Dia/Semana/Lista, filtros úteis, status semântico, evento compacto legível. Não introduzir uma tela ERP nem modal para qualquer clique.
- Usar o painel/sheet de detalhe de booking existente na migração de produção. A seleção abre fluxo rápido de criação: horário, serviço e duração sugerida editável; o teste visual do spike mostra um painel leve, sem persistir.
- Cor é redundante a texto/status (`Aguardando confirmação`, `Confirmado`, `Cancelado`, `Concluído`, `Não compareceu`) e rótulo acessível. Bloqueio tem visual/conceito próprio.
- A 390 px, iniciar em Dia ou Lista (este spike escolhe Lista), esconder controles secundários, dar prioridade ao painel por sheet e não permitir overflow horizontal global. Swipe/drag mobile só se funcionar com touch e teclado/alternativa acessível; selecionar horário não pode depender somente de arrastar.
- Erros do servidor são humanos e por campo/ação. A interface pode mostrar o gesto como estado pendente/otimista; somente o ACK confirma a mudança. Falha ou conflito restaura o intervalo original e anuncia a mensagem legível.
- Preservar tokens, tipografia, superfícies, hierarquia de botões e escopo CSS do contrato de UI; não deixar CSS global da biblioteca redesenhar o resto do Clinical OS.

## Plano incremental de migração (futuro; não executado)

1. **Etapa A — concluída nesta entrega:** auditar o domínio; registrar este contrato/ADR; quatro adapters em `spikes/agenda-temporal-2`; fixtures sintéticas 7/200/1000; testes isolados; cenário e limites de benchmark. Sem troca de produção.
2. **Etapa B — modelagem/API, outra autorização:** decidir e codificar o normalizador de Booking e API/repositório central. Adicionar campos canônicos de forma expand/contract; manter `date/time` como projeção de compatibilidade na mesma escrita atômica; capturar `durationMin` e `timeZone` em novas reservas. Definir como conflitos/DST e duração inferida são auditados. Nenhum backfill amplo até ensaio reversível e contagens conferidas.
3. **Etapa C — serviço de disponibilidade e recursos:** separar `slotMin`, snap e duração; acrescentar antes/depois de buffers e precedência Profissional×Serviço → Serviço → clínica. Introduzir recursos Sala/Equipamento com `businessId` e capacidade/agenda própria, validar todos na mesma transação. Manter encaixe interno explícito e público estrito. Cobrir concorrência, escopo de profissional, recorrência, status, check-in e todas as rotas públicas/widget/externas.
4. **Etapa D — piloto UI interno com RBC atrás de flag:** começar read-only em uma clínica e Dia/Lista, com Professional filter e localizer IANA sem global. Comparar dados/horários com grade atual; testar teclado, 390/desktop, timezone/DST, serviço elegível e recursos. Só então ativar seleção e criação internas; depois move/resize via API, rollback/409 e logs. Falha no gate pausa a migração e reabre comparação com FullCalendar Standard/recursos Premium, sem troca silenciosa.
5. **Etapa E — cobertura gradual:** expandir Semana e grupos de profissional após teste de densidade; incluir salas/equipamentos no serviço de domínio antes da apresentação visual. Migrar fila, detalhes, métricas, relatórios, recorrência, agente e integrações como consumidores explícitos, preservando os DTOs legados temporariamente.
6. **Etapa F — fechar compatibilidade somente quando provado:** backfill idempotente por business, reconciliar contagens/paridade e duração inferida, observar conflitos/timezone, manter rollback. Remover `date/time` legado apenas depois de nenhuma referência de leitura/escrita e ADR próprio sobre eventual storage normalizado. O público permanece com slots estritos em cada fase.

## Riscos e gates de saída

- **Timezone/RBC:** o antigo `Settings.defaultZone` global foi removido do spike; a fachada IANA por instância passou em testes Node para dois fusos e mantém conversões no domínio. Gate ainda aberto: provar os callbacks e a geometria do RBC em Chromium/browser real, inclusive DST, tenant simultâneo e SSR.
- **Perda de histórico:** duração derivada hoje de `Service.durationMin` pode mudar retroativamente. Gate: snapshot confiável ou registro de inferência/revisão, nunca backfill cego.
- **Disponibilidade incompleta:** só Profissional está no domínio atual. Gate: servidor verifica Profissional + Sala + Equipamento e buffers na mesma reserva antes de expor promessa pública.
- **Race/oversubscription:** duas pessoas movem o mesmo evento ou ocupam o último intervalo. Gate: lock/version/idempotência server-side e testes concorrentes; UI isolada não basta.
- **Excesso de flexibilidade interna:** `fit_in` não pode vazar para público. Gate: casos de permissão real e 403/409 em API pública/widget/externa.
- **Biblioteca versus produto:** 5 profissionais x semana pode causar excesso de colunas; custom CSS, acessibilidade, import de CSS e chunk podem divergir no Next.js/SSR. Gate: browser real desktop/tablet/390, teclado, reload e bundle de produção.
- **Licença/custo/versão:** revalidar licença, versão e recursos Premium no momento da adoção. Não depender de README antigo nem de preço registrado neste ADR como cotação futura.
- **Benchmark inconclusivo:** render/scroll/gestos não têm dados até o browser estar disponível; não usar tamanho gzip como proxy de responsividade.

## Homologação real do spike — bloqueada por ambiente

**Status: não realizada em browser; nenhum candidato está aprovado para piloto.** Não há screenshots anexados, e nenhum resultado abaixo é tratado como visual pass.

- **Browser:** Playwright `1.63.0` está instalado, mas não havia Chromium/Chrome/Firefox no sistema nem browser na cache. `npx playwright install chromium` falhou repetidamente antes do handshake TLS (`ECONNRESET` para `cdn.playwright.dev`). Também tentei atualizar os pacotes Debian para instalar um browser do sistema; `deb.debian.org` não estava acessível. O preview Vite na porta `3101` respondeu HTTP 200, o que comprova apenas servidor/transformação, não renderização.
- **Viewports/screenshots:** 1366×900, 1024 px e 390 px não foram abertos em browser; não existem screenshots legítimos de Dia, Semana, seleção, move, resize, conflito ou mobile. Não foram fabricadas imagens de evidência.
- **Day/Week/interação:** as fixtures agora mostram Orlando, Ana e Carlos no Dia, incluindo serviço/procedimento de 90 min e rótulos de status; Week mantém overlaps visuais entre profissionais e fixtures de benchmark com 5 profissionais. Testes de domínio cobrem 10:00–10:40, move 10:00→11:15 preservando duração, resize 40→55 e snap 5. Um teste simula duas tentativas para o mesmo horário em ordem de ACK: a primeira é aceita pelo mock e a segunda é recusada por conflito. Isso não comprova concorrência transacional nem gesto/render real de qualquer adapter.
- **Timezone:** as funções de domínio agora exigem timezone IANA explícito e rejeitam ausência/valor inválido, sem `process.env.TZ`, fuso do browser como autoridade ou fallback silencioso. Testes confirmam `America/Sao_Paulo` (10:00→13:00Z) e `America/New_York` (10:00→15:00Z), start/end e rejeição de DST gap/fold em Nova York. O localizer RBC por instância foi exercitado com `America/Sao_Paulo` e `America/Los_Angeles` simultaneamente; `Settings.defaultZone` permaneceu `Asia/Tokyo`. Isso é prova de contrato/fábrica em Node, não homologação RBC no DOM/browser.
- **Mobile/acessibilidade:** o shell de teste escolhe Lista em viewport jsdom de 390 px, e o evento tem rótulo/estado textual; não foi possível verificar overflow global real, toque, resize touch, navegação de teclado, foco visível, contraste, Escape ou tab order. Permanecem gates abertos para todos os candidatos.
- **Performance real:** 200 e 1000 eventos não foram carregados/renderizados em browser; scroll, troca de vista, jank, rerender, drag e resize estão **pendentes**, sem extrapolação. A última geração de fixture no Node/Vitest (12:49) registrou 200: **93,36 ms** e 1000: **251,57 ms**; isso não é performance de calendário.
- **Limitações conhecidas, não substitutas de homologação:** Grade atual é adapter isolado, não a página de produção. FullCalendar Standard não tem Resource TimeGrid/Vertical Resource (Premium). Schedule-X Community não oferece drag-select/move/resize/Resource Scheduler sem Premium e o spike não os simula. RBC contém localizer IANA isolado e gestures no código, mas falta provar no browser fuso visual, keyboard/touch, CSS/overflow e estabilidade sob carga.

A decisão permanece **domain-first; RBC é somente candidato condicional**. Não registrar `RBC aprovado para PILOTO INTERNO` antes de executar e anexar screenshots e medições reais em Chromium (e motor adicional, se disponível), nos três viewports e gates de gesto, mobile e acessibilidade. Estado atual não é “Agenda Temporal 2.0 concluída” nem “SPIKE/ADR homologado”.

## Testes e resultado da Etapa A

- [`spikes/agenda-temporal-2/src/domain/temporal-contract.test.ts`](../spikes/agenda-temporal-2/src/domain/temporal-contract.test.ts): contrato independente, legado, fuso IANA/DST, snap, duração, views, status e autoridade do mock.
- [`spikes/agenda-temporal-2/src/App.test.tsx`](../spikes/agenda-temporal-2/src/App.test.tsx): toolbar Dia/Semana/Lista, Lista inicial em 390 px e painel rápido 10:00–10:40.
- [`spikes/agenda-temporal-2/src/domain/benchmark.test.ts`](../spikes/agenda-temporal-2/src/domain/benchmark.test.ts): fixtures 200/1000, cinco profissionais.
- [`spikes/agenda-temporal-2/src/adapters/rbcIanaLocalizer.test.ts`](../spikes/agenda-temporal-2/src/adapters/rbcIanaLocalizer.test.ts): dois localizers IANA ativos no mesmo processo sem mutação de zona global.
- Última execução focada: **18/18 aprovados** em quatro arquivos; isso não substitui gestos, layout ou acessibilidade em browser real.
- Validação global: `npm run build`, `npm run typecheck` e `npm run spike:agenda:build` passaram. `npx vitest run`: **2845 aprovados e 4 falhas baseline** (3× `a34-instagram.test.ts`, 1× `automation-audit-p4.test.ts`), sem editar esses testes.
- O servidor do spike aceita somente a demonstração em memória e rejeita conflito/estado obsoleto; o teste de dois moves usa ACK sequencial e não prova lock/concorrência transacional.
- Browser real permanece indisponível; detalhe, interações CSS, overflow, screenshots e performance de render não foram homologados.

## Referências consultadas (2026-10-01)

- [FullCalendar pricing/licença Standard MIT e Premium](https://fullcalendar.io/pricing), [índice de plugins Standard/Premium](https://fullcalendar.io/docs/plugin-index), [fuso nomeado/Temporal](https://fullcalendar.io/docs/timeZone), [seleção](https://fullcalendar.io/docs/selectable), [drag/resize](https://fullcalendar.io/docs/editable), [Vertical Resource Premium](https://fullcalendar.io/docs/vertical-resource-view).
- [React Big Calendar — repositório/documentação](https://github.com/bigcalendar/react-big-calendar), [pacote npm 1.20.0 / MIT](https://www.npmjs.com/package/react-big-calendar). Versões/licenças conferidas também pelo `npm view` e pelo `package-lock.json` do spike.
- [Schedule-X Premium e licenciamento](https://schedule-x.dev/premium), [Resource Scheduler Premium](https://schedule-x.dev/docs/calendar/resource-scheduler), [drag/drop Premium e intervalos 15/30/60](https://schedule-x.dev/docs/calendar/plugins/drag-and-drop), [resize Premium e intervalos 15/30/60](https://schedule-x.dev/docs/calendar/plugins/resize), [customização React](https://schedule-x.dev/docs/frameworks/react).
- Referências clínicas/operacionais e contrato de UI já existentes: [`docs/GODOUTOR-MASTER-PLAN.md` §§2.2–2.5](./GODOUTOR-MASTER-PLAN.md), [`docs/GODOUTOR-CLINICAL-OS-V1.md`](./GODOUTOR-CLINICAL-OS-V1.md), [`docs/GODOUTOR-UI-CONTRACT.md`](./GODOUTOR-UI-CONTRACT.md), [`docs/GODOUTOR-UI-AUDIT-V2.md`](./GODOUTOR-UI-AUDIT-V2.md) e [`docs/AUTO-HOMOLOGACAO-WORKFLOW-PERMISSOES.md`](./AUTO-HOMOLOGACAO-WORKFLOW-PERMISSOES.md).
