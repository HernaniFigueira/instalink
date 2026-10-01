# Auto-homologação — Agenda Temporal 2.0 · Fundação Temporal B1

> Data: 2026-10-01 · Branch `arena/01a0f827-instalink` (sem merge)
> Escopo: **Fundação Temporal B1** — janela canônica do Booking, duração congelada,
> inferência legada, slots/ocupação por snapshot, séries, reagendamento e leitura por fuso IANA.
> **Não** é a Agenda 2.0 completa (sem drag/resize/blocos/recursos/buffers before-after/troca de grade).

## Ambiente (real, descartável)

| Item | Valor |
| --- | --- |
| Build | `next build` + `next start` (produção) em `0.0.0.0:3000` |
| Banco | arquivo JSON descartável `/tmp/homolog/b1.db.json` (`INSTALINK_DB_FILE`), gerado por `/tmp/homolog/seed-b1.mjs` |
| Tenant | `b-homolog-b1` · Clínica B1 Homolog · fuso `America/Sao_Paulo` |
| Serviço | `svc-consulta` — "Consulta" (inicia em 40 min) |
| Profissional | `pro-orlando` — Orlando (Clínico) · disponibilidade 08:00–18:00 · `slotMin` 30 |
| Browser | Chromium real (headless) via `puppeteer-core` + `@sparticuz/chromium`, viewports 1366/1024/390 |
| Data de teste | `2026-10-03` (sábado) |
| Personas | `dono@godoutor.test` (Proprietário) · `maria@godoutor.test` (Recepção/`SECRETARIA`) · `orlando@godoutor.test` (Profissional) — senha `homolog1234`, **login real em `/login`** |
| Nenhum dado de produção | todo o fluxo destrutivo ocorreu só no banco descartável |

Resultado do run final: **34/34 fluxos OK · 0 falhas · 0 respostas 5xx · 0 erros de console/403**.

## 1. §3 — Duração do serviço NÃO move o histórico (prova-mãe)

Fluxo executado inteiramente pela UI real (Serviços → Editar serviço) e pela grade real:

| Passo | Serviço | Ação | Resultado observado |
| --- | --- | --- | --- |
| 1 | 40 min | Novo agendamento · Maria Homolog · Orlando · `2026-10-03 10:00` | cartão **10:00–10:40** |
| 2 | 40 → **60** | Editar Serviço e salvar | — |
| 3 | 60 | Reabrir a agenda | cartão **continua 10:00–10:40** (não vira 10:00–11:00) |
| 4 | 60 | Novo agendamento · `11:00` | cartão **11:00–12:00** |
| 5 | 60 | F5 (recarga real) | as duas janelas persistem |

Prova no nível de dados (`GET /api/bookings?mode=manage`), **com o Serviço já em 60**:

```json
{ "date": "2026-10-03", "time": "10:00", "durationMin": 40,
  "startAt": "2026-10-03T13:00:00.000Z", "endAt": "2026-10-03T13:40:00.000Z",
  "timeZone": "America/Sao_Paulo", "temporalSource": "native" }

{ "date": "2026-10-03", "time": "11:00", "durationMin": 60,
  "startAt": "2026-10-03T14:00:00.000Z", "endAt": "2026-10-03T15:00:00.000Z" }
```

## 2. §7 — Legado: inferência congelada, leitura sem escrita

1. Booking legado inserido **direto no banco** apenas com `date: 2026-10-03`, `time: 14:00` (sem `startAt/endAt/durationMin`).
2. A grade lê o legado como **14:00–15:00** (duração vigente do serviço = 60) — e a **leitura não grava**: o registro continuou sem janela canônica no banco.
3. Editar o Serviço 60 → **45** dispara o congelamento **antes** da mudança. Resultado persistido:

```json
{ "id": "bk-legacy-homolog", "date": "2026-10-03", "time": "14:00",
  "startAt": "2026-10-03T17:00:00.000Z", "endAt": "2026-10-03T18:00:00.000Z",
  "durationMin": 60, "timeZone": "America/Sao_Paulo", "temporalSource": "legacy_inferred" }
```

4. Depois do Serviço virar 45, o legado **continua 14:00–15:00** (não 14:00–14:45).
5. Um agendamento novo no mesmo dia nasce com a duração vigente: `15:00–15:45` (`durationMin: 45`).

> A duração original de um atendimento antigo é irrecuperável; o sistema grava a
> duração resolvida como **inferência declarada** (`legacy_inferred`) e nunca
> finge precisão histórica.

## 3. §9/§10 — Slots por janela, não por duração atual do serviço

`GET /api/bookings?mode=slots-admin&date=2026-10-03&professionalId=pro-orlando` (Serviço = 45):

```json
["08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","16:00","16:30","17:00"]
```

- **Ocupados pela ocupação real**: `13:30/14:00/14:30/15:00/15:30` — o legado congelado ocupa 14:00–15:00 e o novo ocupa 15:00–15:45; nenhum slot novo cabe antes das 16:00.
- **Cancelado libera**: o agendamento de 11:00 cancelado devolveu `10:00–10:40` e `11:00` ao público de horários.
- **Cadência ≠ duração**: os inícios ocorrem de 30 em 30 min (`slotMin`), enquanto as durações são 40/45/60 — a cadência de início não foi confundida com duração.
- **Buffer fora da duração**: `bufferMin` é somado à ocupação, mas o cartão e `durationMin` continuam mostrando só o atendimento.

## 4. §12/§13 — Séries e reagendamento

- Série criada pela API real do navegador (3 ocorrências, `16:00`, dias +7/+14/+21): `http 200`, `count 3`; cada ocorrência nasceu com **janela própria** (`durationMin: 60`, `seriesIndex 1..3`, mesmo `seriesId`), e a grade mostra `16:00–17:00`.
- **Reagendamento (move)** pela UI real: `10:00` do dia 03 → `09:00` do dia 04; a origem não mantém compromisso ativo e o destino aparece como **09:00–10:00** (janela nova, duração vigente).
- **Cancelamento** pela UI real no detalhe do agendamento: status `cancelled` persistido e a **janela canônica preservada** no registro.

## 5. §15/§16 — Compatibilidade e isolamento

- Todos os registros (inclusive o legado congelado) continuam devolvendo `date`/`time` legíveis, agora acompanhados de `startAt/endAt/durationMin/timeZone/temporalSource`.
- Personas reais validaram o mesmo estado: **Maria (Recepção)** e **Orlando (Profissional)** fizeram login real e viram a agenda do escopo deles, sem erro de permissão nem 403 espúrio.
- **Tenant isolation**: todas as chamadas usaram `businessId=b-homolog-b1`; nada vazou para outro negócio.
- **Zero 5xx** em toda a execução; **zero erros de console**.

## 6. Viewports (renderização real, conteúdo real)

| Viewport | Resultado | Evidência |
| --- | --- | --- |
| 1366 | grade do dia com 3 cartões (cancelado 11:00–12:00, legado 14:00–15:00, novo 15:00–15:45), sem overflow horizontal | `10-agenda-1366.png` |
| 1024 | mesma grade, sem overflow | `10-agenda-1024.png` |
| 390 | visão compacta (Lista) com os 3 atendimentos, sem overflow | `10-agenda-390.png` |

Screenshots em `docs/evidence/agenda-temporal-b1/` (14 arquivos), cobrindo criação,
histórico intacto após o serviço virar 60, cancelamento, reagendamento, série, legado
congelado, detalhe do legado e as três personas.

## 7. Validação automatizada (§23)

| Comando | Resultado |
| --- | --- |
| `git diff --check` | 0 |
| `npm run build` | OK |
| `npm run typecheck` | 0 erros |
| `npx vitest run` | **2862 passed / 4 failed** (2866 testes; 204/206 arquivos) — as 4 falhas são a baseline pré-existente e intocada (3× `a34-instagram` + 1× `automation-audit-p4`) |
| `npx vitest run src/lib/__tests__/agenda-temporal-b1.test.ts` | 35/35 |

## 8. Limites assumidos (fora desta etapa)

- Nenhuma biblioteca de calendário foi instalada; a grade continua a própria.
- Sem drag/resize/blocos/salas/equipamento/novo toolbar/novo drawer — isso é B2+.
- Sem backfill remoto: o congelamento do legado acontece **na escrita** (edição de serviço, status, reagendamento), nunca em massa.
- `bufferMin` continua único por clínica; `bufferBefore/bufferAfter` é etapa futura.
- A Agenda Temporal 2.0 continua **EM ANDAMENTO** — esta etapa registra apenas a
  **Fundação Temporal B1**; a próxima etapa é **B2**.
