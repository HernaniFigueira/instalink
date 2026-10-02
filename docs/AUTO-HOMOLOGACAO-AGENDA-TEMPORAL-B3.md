# Agenda Temporal 2.0 — B3 · homologação local

> PR #49 · branch `arena/01a0f827-instalink` · **sem merge**. QA exclusivamente em build de produção executado **localmente**, banco descartável `/home/user/b3qa/qa.db.json`, `DATABASE_URL` ausente. Não houve QA em produção. Vercel serve apenas como check de deploy após push.

## Domínio e contratos

- `ScheduleBlock` é entidade própria, tenant-scoped: intervalo UTC operacional por clínica, profissional ou recurso. **Nunca** entra em Booking/CRM/paciente/Encounter. `AvailabilityException` continua para fechamento/dia especial. Bloqueios são conflito rígido em slots públicos/internos, criação, move, resize e fit-in; a mutação revalida em `updateDB`.
- `ScheduleResource`: `room` ou `equipment`; ativos elegíveis, inativos legíveis historicamente, exclusão bloqueada se utilizados por Booking, Service ou ScheduleBlock. `Service.resourceRequirements` é uma lista de grupos de alternativas, **uma unidade por grupo**; quantidade >1 por grupo não é anunciada nem aceita como configuração separada. IDs são validados contra o tenant na gravação. O motor seleciona deterministicamente por ID, com preferência pela atribuição anterior em move e backtracking se grupos se sobrepõem. Bookings gravam `resourceIds` e buffers antes/depois como snapshots.
- Ordem de buffer novo: override do Service → BookingConfig → 0; `bufferMin` legado é **depois**, jamais antes. Na edição dos buffers da clínica ou serviço, Bookings sem snapshots são congelados com a política **anterior** antes da alteração, sem mutação na leitura. Move/resize preservam snapshot existente; recriação terminal recebe defaults novos. Cartão/duração históricos mostram somente atendimento, não a ocupação efetiva.
- `computeSlots` inclui ocupação que atravessa meia-noite, blocos e recursos e retorna apenas profissionais/horas com capacidade completa. GET público, customer, external, agent, series e create usam o motor; PATCH revalida transacionalmente e ecoa `resourceIds`/snapshots para atualização local.

## Banco e usuários inteiramente falsos

Seed de desenvolvimento copiada e reduzida a **uma clínica sintética** `biz-clinicavitta` (nome Clínica Fake B3), todos os dados e credenciais trocados em uma cópia **fora do repositório**, sem banco real. Owner `owner@local.test`, Maria/Recepção `maria@local.test`, Orlando/Profissional `orlando@local.test`, senha local fictícia `local1234`; login real pela UI `/login` no Chromium. Profissionais Orlando, Ana e Carlos; recursos Sala 1, Sala Cirúrgica, Ultrassom 01 e 02. Serviços: Consulta 40 (before 0/after 10), Vacina 20, Ultrassom 40 (before 5/after 10, 01 OU 02), Cirurgia 90 (before 30/after 45, Sala Cirúrgica). Disponibilidade fake diária 08–19. Dias usados: 09, 12, 13 e 15/10/2026.

## Chromium local (produção local Next start)

- Owner: login real, Agenda e detalhe em 1366/1024/390 sem overflow horizontal; Block operacional criado, editado e removido (200 em cada mutação), persistiu após F5; a faixa e o cartão tracejado o distinguem de atendimento. Em 390, botão **Bloquear horário** é explícito; formulário/edit/delete e Booking detail funcionaram sem drag. Detalhe exibiu **Equipamento: Ultrassom 01** sem expandir cartão para buffers. Evidências em `docs/evidence/agenda-temporal-b3/`.
- Owner criou Ultrassom 10:00 para Orlando → `us-01`; Maria criou o mesmo horário para Ana → `us-02`; terceira tentativa Carlos → **409**. Move em data isolada preservou `us-01` quando livre; com `us-01` ocupado no destino, realocou para `us-02`. Cirurgia com Sala Cirúrgica: resize tentando invadir ocupação seguinte → **409**, sem persistir o novo fim. Uma tentativa intermediária de resize entre bookings de recursos *diferentes* foi corretamente aceita; ela não prova colisão, por isso o caso da Sala Cirúrgica foi executado separadamente.
- Maria entrou via UI, viu agenda completa, moveu Booking 11→12 (PATCH 200) e criou o segundo ultrassom. Criou/excluiu bloqueio próprio via API autenticada do Chromium (200). Orlando entrou via UI, viu **somente** o cartão do seu profissional; tentativa de bloquear Ana ou a clínica → **403**, tentativa de mover Booking de Carlos → **403**. ID de recurso estrangeiro recusado; block estrangeiro não é acessível. Testes de rota complementam isolamento.
- Chromium: 0 respostas 5xx inesperadas, 0 exceções JS nas execuções registradas. Rejeições 403/404/409 são esperadas e verificadas; não contam como erro JS. Após F5 Booking movido e atribuições permanecem no banco local.
- Escala em cópias descartáveis separadas do fixture: **200 cartões** em 2336 ms e **500 cartões** em 2797 ms (navegação + `networkidle2`); sem exceções/5xx. 500 é o teto existente da API manage, não uma alegação de renderizar mais de 500.

## Tráfego observado no Chromium

| Interação | Requests durante gesto |
| --- | --- |
| Week drag de cartão, sete datas | **1 GET batch** `/api/bookings?mode=slots-admin&dates=...` |
| Pointermove adicional durante drag | **0** |
| Confirmar move | **1 PATCH** `/api/bookings`, **0 GET** |
| Resize visual antes de confirmar | **0** |
| Confirmar resize | **1 PATCH** `/api/bookings`, **0 GET** |
| Criar block pela UI 390 | **1 POST** `/api/schedule-operations`, **0 GET** |
| Excluir block pela UI 390 | **1 POST** `/api/schedule-operations`, **0 GET** |
| Polling novo / GET por cartão ou recurso | **0** |

Medição feita após trocar `apiSend` por `apiRequest` apenas no CRUD de blocos: a rodada anterior registrara também 1 GET de overview por mutação; a rodada final registrou apenas o POST. Mutação mantém estado local e não dispara reload global. A leitura inicial de catálogo leva blocos e recursos na resposta existente da Agenda. A exceção B2.1 da fila (`queueChanged`) continua podendo fazer **um GET targeted**; a autenticação/guard ainda lê `instalink_doc` duas vezes por request autenticado, não sete por batch.

## Gates e limites

- B1 **38/38** · B2 **11/11** · B2.1 **7/7** · B3 focada **15/15** (7 motor + 8 rotas; mais regressões cruzadas/UI). `npx vitest run`: **2897 passaram / 4 falharam (2899)**, só a baseline previamente conhecida (3× `a34-instagram`, 1× `automation-audit-p4`). `npm run build`, `npm run typecheck` e `git diff --check`: OK. Rodada intermediária de full suite teve 14 falhas de prefill após alterar clique simples; fluxo B2 foi restaurado (clique simples abre Booking, drag-select oferece escolha Booking/Block), testes de UI reexecutados e rodada final voltou às quatro baselines.
- Não se alega deploy homologado ou QA em produção. `P0 Infra — single-read authenticated guard / reduzir leitura duplicada do instalink_doc` fica **registrado pós-Agenda**, não implementado nesta PR.
- **Ressalva de sessão/stash:** na retomada deste turno, o checkout apareceu de novo em `cfc6263` com B1/B2 + B3 na working tree e `git stash list` **vazio**. O stash citado pela sessão anterior não estava presente nesta fotografia do Git. Inspecionei a duplicidade contra `origin/fb34e45`, fiz backups não destrutivos em `/home/user/b3-recovery/`, avancei por fast-forward e reapliquei só a diferença B3; nenhum `stash apply/pop/drop` foi executado. Sem objeto `refs/stash`, não é possível afirmar que `stash@{0}` está preservado neste checkout nem executar `git stash show`. Revisão externa do histórico de snapshots pode recuperar esse objeto se necessário.
