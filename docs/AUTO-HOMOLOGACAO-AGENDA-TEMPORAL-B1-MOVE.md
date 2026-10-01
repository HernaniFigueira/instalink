# Agenda Temporal B1 — correção do blocker: move preserva duração

> PR #49 · 2026-10-01 · **sem merge**. Complemento à homologação inicial de B1; não é B2.

## Regra corrigida

`PATCH /api/bookings` resolve a duração do Booking dentro da transação antes de validar o slot e montar a janela destino. Em `move`, usa `bookingDurationOf(target, freshService)` (janela/snapshot antes do serviço); em `recreate` terminal usa `freshService.durationMin`, pois nasce um Booking novo. Legado ainda não congelado é congelado antes de trocar sua janela; legado congelado mantém seu snapshot. O mesmo valor de duração é usado na validação do destino e no `buildBookingWindow`.

## Regressões automatizadas

- Canônico 40 → serviço 60 → move 11:00–11:40 (mesmo ID); segundo move 13:15–13:55 (40, mesmo ID).
- Legado 40 congelado antes de serviço 60 → move 11:00–11:40.
- Terminal 40 cancelado após serviço 60 → antigo 40 inalterado, novo 11:00–12:00 (60, `previousId`).
- Slots após segundo move: 13:50 ocupado; 13:55 livre, mesmo com serviço em 60.
- Suíte focada 38/38; suíte geral 2865 passed / 4 failed (2869), só a baseline conhecida (3× `a34-instagram`, 1× `automation-audit-p4`). `git diff --check` OK; `npm run build` OK; `npm run typecheck` OK.

## Homologação real pós-correção

- Build de produção (`next build`/`next start`), banco JSON **descartável** `/tmp/b1qa/qa.db.json` via `INSTALINK_DB_FILE`, seed de desenvolvimento ajustado **somente nesse banco**. Tenant Clínica Vitta (`biz-clinicavitta`), timezone `America/Sao_Paulo`, profissional Orlando, serviço Consulta, disponibilidade 08:00–18:00 com `slotMin: 30`; sexta **2026-10-09**. Nenhum dado de produção utilizado.
- Browser Chromium headless real (`puppeteer-core`/`@sparticuz/chromium`). Login real `/login` como Owner `demo@instalink.app`/`demo1234` e Maria/Recepção `maria@godoutor.test`/`demo1234` (papel `SECRETARIA`). Uso da página de Agenda com cards reais, abertura do detalhe e **reagendamento pela UI**, com confirmação explícita. Criação/edição do serviço e cancelamento/recreate exercitaram APIs reais na sessão autenticada do browser.
- Serviço 40 → criação `10:00–10:40` → edição 60 → histórico ainda `10:00–10:40` → detalhe `40 min` → reagendar via UI para **11:00** → **recarregar a Agenda**: card **11:00–11:40**. Persistência no banco: mesmo ID, `startAt: 2026-10-09T14:00:00.000Z`, `endAt: 2026-10-09T14:40:00.000Z`, `durationMin: 40`, `date: 2026-10-09`, `time: 11:00`.
- Novo Booking após a edição, às 12:00, nasce **12:00–13:00 (60)**. Cancelar o Booking movido e reagendá-lo recria um novo Booking (60), com `previousId`, mantendo o antigo cancelado com janela 11:00–11:40. Login de Maria/Recepção lê os cartões após recarga. Rede: **0 respostas 5xx**; console: **0 erros JS**.
- Screenshot da agenda pós-move (1366 px): `docs/evidence/agenda-temporal-b1/14-move-preserva-40-apos-servico-60.png`.

Nota: a sessão de homologação inicial, anterior à correção, havia reportado um move 09:00–10:00 após mudança do serviço para 60; era precisamente este blocker. O registro inicial foi corrigido para não reivindicar aquele comportamento como desejado.
