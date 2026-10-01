# ADR — Agenda Temporal 2.0

- **Data:** 2026-10-01
- **Status:** **SPIKE ISOLADO COM EVIDÊNCIA REAL DE CHROMIUM · NENHUM CANDIDATO APROVADO**
- **Escopo:** auditoria do domínio, contrato, comparação executável, testes focalizados e benchmark; **nenhuma substituição integrada na agenda de produção**.
- **Base auditada:** `main` e `origin/main` em `6064bb29333ee0cd4de69cc6e554eb4a3289f793`; sem drift no início desta etapa.

## Decisão

Manter uma arquitetura **domain-first e independente da biblioteca** e a grade atual em produção. Resultado de saída desta comparação: **`NENHUM CANDIDATO APROVADO`**. O React Big Calendar 1.20.0 (MIT) permanece apenas candidato condicional a um futuro piloto interno, não aprovado: em Chromium real executou seleção/move/resize e passou verificações básicas de teclado, mas com 1000 eventos a troca Dia→Semana levou 11,7 s, a maior long task foi 5,32 s e move/resize levaram ~2,4 s no Vite dev. Isso não é perfil aceitável para aprovar piloto sem nova otimização e repetição. FullCalendar Standard teve tempos menores em parte da rodada, mas não tem Resource TimeGrid; Schedule-X Community não oferece os gestos/recursos necessários sem Premium; a Grade própria mantém custo de manutenção. Screenshots e resultados brutos estão em [`spikes/agenda-temporal-2/qa/`](../spikes/agenda-temporal-2/qa/) e sintetizados no [`BENCHMARK`](../spikes/agenda-temporal-2/BENCHMARK.md).

A sessão real usou `HeadlessChrome/153.0.8010.0` via `puppeteer-core` + `@sparticuz/chromium`, isolados em `/tmp/qa`, sem dependência de browser no repositório. Foram exercitados 1366×900/1024×900 em Dia/Semana e 390×844 em Dia/Lista + touch. O localizer RBC por instância e o contrato IANA continuam sem estado global; Chromium é evidência real de um engine, mas as métricas são uma rodada em Vite dev, não build de produção nem homologação final.

A decisão é somente arquitetural: **não autoriza integração**. O contrato e a autoridade de validação permanecem no domínio/API GoDoutor; cada biblioteca é apenas uma camada de apresentação substituível. FullCalendar Standard continua alternativa caso suporte de fuso/manutenção pese mais, mas Resource View é Premium e requer decisão comercial explícita. Schedule-X Premium permanece fora do escopo. Nenhum candidato foi selecionado para piloto nesta etapa.

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
| **React Big Calendar** | `react-big-calendar@1.20.0`, **MIT** | Day/Week/Agenda; seleção, addon DnD, move e resize em `step=5`; toolbar externa e evento React customizado. Gestos foram executados em Chromium contra o mock. | Recursos incluídos no core; spike exibe recursos no Dia sem licença Premium. Semana usa filtro profissional; benchmark distribui 5 profissionais. Sala/Equipamento ainda exigem domínio. | `createIanaLuxonLocalizer(timeZone)` injeta uma fachada Luxon por instância sem alterar `Settings.defaultZone`. Chromium confirma geometria/interação na sessão testada; contrato IANA e localizer também passam testes Node. | **Não aprovado para piloto:** em 1000 eventos, Dia→Semana 11,7 s, long task máxima 5,32 s e gesto ~2,4 s no Vite dev. Requer otimização, build de produção, repetição e nova aprovação. |
| FullCalendar Standard | `@fullcalendar/react@7.1.0` + plugins **Standard/MIT** | TimeGrid Day/Week + List, interação de selecionar/arrastar/redimensionar e snap de 5 min no adapter Standard. Custom event e toolbar externa funcionam no spike. | **Não** tem Resource TimeGrid/Vertical Resource. Recurso como coluna exige Scheduler/Premium; a página consultada informa preço começando em US$ 480. Nenhum plugin Premium foi instalado. | API documenta zona nomeada e uso de Temporal; forte caminho para converter callbacks sem usar o fuso do browser. CSS próprio exige tokens/escopo. | Boa alternativa se timezone/manutenção superar recurso gratuito; adoção de Premium depende de custo/termos e decisão explícita, não entra por acidente. |
| Schedule-X Community | `@schedule-x/calendar@4.9.1`, React `4.1.0`, pacote MIT | Day/Week/List e Temporal nativo; evento React customizado. O clique de célula pode sugerir 40 min, mas Community não demonstra drag-select. | Resource Scheduler, drag-to-create, drag/drop e resize são **Premium**; DnD/resize Premium documentados em 15/30/60 min, sem o snap requerido de 5 min. A página consultada lista €479/ano + VAT (2–3 devs) ou €999 + VAT lifetime, por produto. | Boa composição visual com custom components; CSS Community acrescenta tema e exige adaptação ao Design System. O peer `temporal-polyfill@0.3.2` conflita com o 1.0.1 usado no restante do spike, por isso ficou isolado em package/lock próprios. | Rejeitado como editor interno gratuito para este contrato; pode ser considerado read-only ou mediante nova decisão/licença, não simular recursos pagos. |

A página de pricing do FullCalendar declara Standard gratuito/MIT e Premium a partir de US$ 480; o índice separa `/timegrid`, `/list` e `/interaction` Standard de `resource-timegrid`/Timeline Premium. No Schedule-X, a documentação e pricing confirmam que recurso, move/resize e drag-to-create são Premium. A comunidade RBC publicou v1.20.0 em 2026-06-01; `npm view` e o package registry indicaram MIT para RBC, FullCalendar Standard e Schedule-X Community na consulta.

### Bundle e performance observados

Build isolado Vite 8.3.2 (`563` módulos): base JS 224,66 kB / 73,98 kB gzip; adapters dinâmicos sob demanda: Grade 8,28 / 3,27 kB; RBC 314,41 / 91,19 kB; FullCalendar Standard 275,71 / 75,36 kB; Schedule-X Community 239,20 / 71,20 kB; evento customizado compartilhado 1,03 / 0,49 kB. CSS também é separado por adapter. Os chunks não selecionados não entram no carregamento inicial; estes números não são tamanho final do Next de produção.

Houve medição de browser real, não inferência de Vitest: uma rodada de Chromium headless contra Vite dev, sem CPU throttling. `paint` do adapter com 200/1000: Grade 234/667 ms, RBC 637/1.988 ms, FullCalendar 208/360 ms, Schedule-X 111/215 ms. Troca Dia→Semana: Grade 1,60/4,27 s; RBC 3,45/11,70 s; FullCalendar 0,56/3,00 s; Schedule-X 2,21/2,19 s. RBC a 1000 eventos registrou long task de até 5,32 s. Gestos mock de 200 tiveram HTTP 200; com 1000 o move a 11:15 recebeu 409 por conflito intencional, restaurou 10:00–10:40; resize reiniciado da fixture recebeu 200 e resultou em 10:00–10:55. A tabela completa, incluindo scroll, parede de gesto, request/ack, fixture generation e caveats de medição, está no [`BENCHMARK.md`](../spikes/agenda-temporal-2/BENCHMARK.md) e no [`performance-matrix.json`](../spikes/agenda-temporal-2/qa/performance-matrix.json).

Os tempos são uma única rodada diagnóstica em modo desenvolvimento, não mediana/p95, SLO, build de produção ou validação de dispositivo real. São úteis para identificar gargalos — especialmente RBC em Week/1000 —, não para extrapolar throughput de produção.

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

- **Timezone/RBC:** `Settings.defaultZone` não é alterado; contrato e localizer IANA por instância passaram em testes Node e callbacks/gestos foram exercitados em Chromium com São Paulo. Gate remanescente: DST visual, outro engine, tenant simultâneo no browser, SSR e build de produção.
- **Perda de histórico:** duração derivada hoje de `Service.durationMin` pode mudar retroativamente. Gate: snapshot confiável ou registro de inferência/revisão, nunca backfill cego.
- **Disponibilidade incompleta:** só Profissional está no domínio atual. Gate: servidor verifica Profissional + Sala + Equipamento e buffers na mesma reserva antes de expor promessa pública.
- **Race/oversubscription:** duas pessoas movem o mesmo evento ou ocupam o último intervalo. Gate: lock/version/idempotência server-side e testes concorrentes; UI isolada não basta.
- **Excesso de flexibilidade interna:** `fit_in` não pode vazar para público. Gate: casos de permissão real e 403/409 em API pública/widget/externa.
- **Biblioteca versus produto:** 5 profissionais × semana pode causar excesso de colunas; Grade/RBC têm scroll horizontal interno em mobile; custom CSS, import de CSS e chunk podem divergir no Next.js/SSR. Chromium cobre 1366/1024/390, teclado e touch apenas no spike Vite; ainda faltam build/SSR real do produto, outro engine e bundle final Next.
- **Licença/custo/versão:** revalidar licença, versão e recursos Premium no momento da adoção. Não depender de README antigo nem de preço registrado neste ADR como cotação futura.
- **Benchmark diagnóstico, ainda não gate de produção:** há medidas reais em Chromium, porém uma rodada Vite dev sem throttle nem p95; RBC em 1000 eventos mostrou troca Day→Week de 11,7 s e long task de 5,32 s. Não aprovar piloto sem otimizar e repetir em build de produção/condições controladas.

## Evidências reais do spike em browser

**Status:** sessão real de Chromium realizada e registrada; isso não é homologação da agenda de produção. Estado de decisão: **`NENHUM CANDIDATO APROVADO`**.

- **Método/browser:** preview local Vite na porta 3101, Chromium headless `153.0.8010.0` através de `puppeteer-core@25.12.0` + `@sparticuz/chromium@153.0.0`, instalados em `/tmp/qa` (fora do repo/root `package.json`). Somente um engine foi usado; não houve reader de tela.
- **Viewports/screenshots:** 1366×900 e 1024×900 em Dia/Semana; 390×844 em Dia/Lista + touch (Week não foi forçada no mobile). Existem 28 screenshots em [`spikes/agenda-temporal-2/qa/screenshots/`](../spikes/agenda-temporal-2/qa/screenshots/) e resultados em `qa/viewport-matrix.json`. Largura documental mobile continuou 390 px, sem overflow global; Grade e RBC exigem scroll horizontal **interno** para visualizar as colunas de profissional, algumas parcialmente fora da área visível.
- **Gestos:** Grade/RBC/FullCalendar executaram seleção real 10:00–10:40, move 10:00→11:15 preservando 40 min e resize 40→55, com HTTP 200 do mock. Na carga 1000, o alvo 11:15 já está ocupado e o mock devolveu 409; o evento voltou/permanecceu em 10:00–10:40. Resize foi repetido com estado resetado e terminou em 10:00–10:55. Schedule-X Community apenas sugere 40 min por clique/tap; nenhuma função Premium foi instalada/simulada. O mock não comprova validação/concorrência transacional de produção.
- **Mobile/touch:** toque abriu detalhe e Escape fechou; criação rápida produziu `05 out. 2026 · 10:00–10:40 · Dra. Bianca`; navegação Next avançou um dia nos quatro candidatos. O gesto específico varia por adapter e está no JSON. As capturas scrolled Day e geometria estão no `viewport-matrix.json`.
- **Acessibilidade:** Axe-core reportou 0 violações nos quatro cenários desktop Day; houve itens `incomplete` que exigem revisão manual, portanto não é certificação. Tab chegou ao evento, Shift+Tab retornou ao anterior, Enter/Space abriu detalhe e Escape fechou detalhe/rascunho. Texto acompanha as cores; contraste manual de texto foi 7,66:1–9,76:1 (eixo de hora Schedule-X: 7,20:1). RBC mostrou outline azul de 5 px; os demais tinham outline padrão de 1 px. Ver [`qa/accessibility-matrix.json`](../spikes/agenda-temporal-2/qa/accessibility-matrix.json).
- **Performance:** uma rodada real de Vite dev, 1366×900, sem throttle; fixture generation, adapter paint, troca Day/Week, scroll, wall time dos gestos e long tasks registrados separadamente. Com 1000 eventos, RBC Dia→Semana: 11,698 s; Semana→Dia: 2,287 s; long task máxima da sessão: 5,320 ms; move/resize: 2,411/2,381 ms incluindo UI/mock. FullCalendar teve Day→Week 3,000 s, long task máxima 1,151 ms. A tabela completa e limitações estatísticas estão no [`BENCHMARK.md`](../spikes/agenda-temporal-2/BENCHMARK.md) e em `qa/performance-matrix.json`; não são métricas de build de produção, SLO, mediana ou p95.
- **Limitações funcionais/licença:** Grade é adapter isolado; não é a tela atual do produto. FullCalendar Standard não tem Resource TimeGrid (Premium). Schedule-X Community não tem drag-select, move/resize nem Resource Scheduler (Premium). Nenhum pacote Premium foi instalado. RBC ainda precisaria otimização/repetição e aprovação posterior.

A decisão continua **domain-first**; RBC permanece apenas candidato condicional, sem aprovação de piloto. Screenshots/gestos e testes acima não tornam “Agenda Temporal 2.0 concluída”, não validam o fluxo de produção, e não autorizam integração ou migração.

## Isolamento, testes e Vercel

O isolamento foi provado na ordem exigida, antes de reinstalar qualquer pacote do spike:

1. removidos `node_modules`/`.next` root e todos os `spikes/**/node_modules`; confirmação de que não havia dependência aninhada;
2. root `npm ci`: sucesso, 283 pacotes; `npm run build` (Next.js 14.2.35): sucesso; `npm run typecheck`: sucesso;
3. `npx vitest run` do produto: 205 arquivos e 2831 testes; **2827 passaram, somente 4 falharam** — exatamente 3× `a34-instagram.test.ts` e 1× `automation-audit-p4.test.ts` (baselines permitidas). O Vitest root inclui somente `src/**/*.test.{ts,tsx}`;
4. somente após os gates root: `npm ci --prefix spikes/agenda-temporal-2` (146 pacotes) e `npm ci --prefix spikes/agenda-temporal-2/schedule-x` (15 pacotes); build, typecheck e **18/18 testes** do spike passaram.

`tsconfig.json` root exclui `spikes/**`; aliases para `spikes/**/node_modules` e `allowImportingTsExtensions` do spike foram removidos. Dependências exclusivas dos comparadores foram movidas ao package/lock do spike. Scripts de conveniência do root usam só `npm --prefix`. Assim, o build do GoDoutor passou após uma instalação root limpa e sem instalar o spike.

**Vercel:** os previews do estado anterior (SHA `667d927` e o predecessor da PR) estavam `FAILURE`. O sandbox não tinha credenciais Vercel (`npx vercel inspect … --logs` respondeu `No existing credentials`), portanto os logs detalhados não foram acessíveis. A causa reproduzível identificada no repositório era a configuração TS root incluir spike e resolver aliases em `spikes/agenda-temporal-2/schedule-x/node_modules`, não instalado pelo root do Vercel; a configuração foi isolada e o build limpo local passa. Após o push corretivo, registrar abaixo o novo deployment Vercel do SHA final e confirmar `SUCCESS` antes de concluir.

## Testes focados

- [`temporal-contract.test.ts`](../spikes/agenda-temporal-2/src/domain/temporal-contract.test.ts): legado, fuso IANA/DST, snap, duração, views, status e mock.
- [`App.test.tsx`](../spikes/agenda-temporal-2/src/App.test.tsx): Dia/Semana/Lista e painel de criação rápida.
- [`benchmark.test.ts`](../spikes/agenda-temporal-2/src/domain/benchmark.test.ts): fixtures de 200/1000 eventos para cinco profissionais.
- [`rbcIanaLocalizer.test.ts`](../spikes/agenda-temporal-2/src/adapters/rbcIanaLocalizer.test.ts): dois localizers em processo sem mutação de zona global.
- O mock continua apenas local/in-memory; ACK sequencial não prova lock nem concorrência transacional.
- Evidência Chromium, Axe, screenshots e performance estão em [`spikes/agenda-temporal-2/qa/`](../spikes/agenda-temporal-2/qa/); não homologam produção.

## Referências consultadas (2026-10-01)

- [FullCalendar pricing/licença Standard MIT e Premium](https://fullcalendar.io/pricing), [índice de plugins Standard/Premium](https://fullcalendar.io/docs/plugin-index), [fuso nomeado/Temporal](https://fullcalendar.io/docs/timeZone), [seleção](https://fullcalendar.io/docs/selectable), [drag/resize](https://fullcalendar.io/docs/editable), [Vertical Resource Premium](https://fullcalendar.io/docs/vertical-resource-view).
- [React Big Calendar — repositório/documentação](https://github.com/bigcalendar/react-big-calendar), [pacote npm 1.20.0 / MIT](https://www.npmjs.com/package/react-big-calendar). Versões/licenças conferidas também pelo `npm view` e pelo `package-lock.json` do spike.
- [Schedule-X Premium e licenciamento](https://schedule-x.dev/premium), [Resource Scheduler Premium](https://schedule-x.dev/docs/calendar/resource-scheduler), [drag/drop Premium e intervalos 15/30/60](https://schedule-x.dev/docs/calendar/plugins/drag-and-drop), [resize Premium e intervalos 15/30/60](https://schedule-x.dev/docs/calendar/plugins/resize), [customização React](https://schedule-x.dev/docs/frameworks/react).
- Referências clínicas/operacionais e contrato de UI já existentes: [`docs/GODOUTOR-MASTER-PLAN.md` §§2.2–2.5](./GODOUTOR-MASTER-PLAN.md), [`docs/GODOUTOR-CLINICAL-OS-V1.md`](./GODOUTOR-CLINICAL-OS-V1.md), [`docs/GODOUTOR-UI-CONTRACT.md`](./GODOUTOR-UI-CONTRACT.md), [`docs/GODOUTOR-UI-AUDIT-V2.md`](./GODOUTOR-UI-AUDIT-V2.md) e [`docs/AUTO-HOMOLOGACAO-WORKFLOW-PERMISSOES.md`](./AUTO-HOMOLOGACAO-WORKFLOW-PERMISSOES.md).
