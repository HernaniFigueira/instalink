# AUTO-HOMOLOGAÇÃO — Clinical Convergence (onda 2)

- **Branch:** `arena/01a0fede-instalink` · base `dbf7d68` (PR #50/P0 merged)
- **Data:** 2026-10-02 · ambiente: sandbox local (Next `next start`, banco em
  arquivo descartável; produção NÃO usada; nada foi semeado em banco real)
- **Escopo:** conversão de linguagem e superfícies "universais" ao GO DOUTOR
  Clinical OS SEM quebrar compatibilidade (cookie/env/tabela/embeds/legado de
  seed). Matriz completa: `GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md`
  §Varredura global — onda 2.

## Como foi validado (método)

1. **Travas estáticas** — `src/lib/__tests__/convergence-wave2.test.ts` (22):
   precedência `godoutor_session` > `il_session`, purga no login, limpeza
   dupla no logout, ponto único de leitura nos 5 consumidores + API routes,
   alias de env com preservação do arquivo legado, `LEGACY_DOC_TABLE`
   (nenhum SQL cru com o identificador — inclusive o bootstrap que a onda
   encontrou e corrigiu), preset clínico default OFF, catálogo de temas sem
   `commerce` com resolução preservada, filtro `/pagina` no menu-busca,
   `x-godoutor-action`/export `godoutor.customers.full`/atores
   `@godoutor.app`, seed tri-clínico.
2. **Suítes de runtime** contra o build atual + seed clínico (re-seed antes
   de cada suíte; servidor reiniciado quando o rate-limit por IP do smoke
   esgotava — bucket em memória por design):
   | Suíte | Resultado |
   | --- | --- |
   | `smoke.mjs` | **67 ✓ / 0 ✗** |
   | `smoke-ux.mjs` | **88 ✓ / 0 ✗** |
   | `smoke-agendar.mjs` | **25 ✓ / 0 ✗** |
   | `smoke-p3.mjs` | **15 fluxos ✓** |
   | `smoke-p4.mjs` | **18/18 ✓** |
   | `e2e-merchant.mjs` | **28 ✓ / 0 ✗** |
3. **Persona probe local** (HTTP real, flag OFF): 4/4 personas —
   Owner (units=3, overview 200) · Maria/secretária (units=1, overview
   **403 por design**: preset SECRETARIA não inclui dashboard) · Profissional
   (units=1, 200) · Master (units=0, 403); em todas: `godoutor_session`
   gravado, `il_session` purgado (Max-Age=0) no login, **dual-read**: chamada
   com só o cookie legado responde 200; logout derruba os dois (401/401).
4. **Gates do repo:** `npm run typecheck` 0 erros · `npm run build` OK ·
   vitest completo **2939 passed / 4 failed** — os 4 reconfirmados
   **exatamente iguais** num worktree da base `dbf7d68` (3× `a34-instagram`,
   1× `automation-audit-p4`): falha pré-existente, não desta onda.

## Descobertas que viraram correção durante a homologação

- `scripts/master.mjs` escrevia `update instalink_doc set doc = …` — coluna
  errada (`data` é a real) **na base**; só se manifestaria no caminho
  Postgres do bootstrap master. Corrigido junto com o confinamento do nome.
- `db.ts` guardava um segundo bloco de SQL cru do doc no caminho de
  bootstrap/repair (linhas ~800) que a varredura inicial não tinha coberto —
  agora 100% via `LEGACY_DOC_TABLE` (pino impede regressão).
- Widget: a casca SSR de `/automacoes` não carrega heading no HTML (é
  client-rendered); o smoke lida o título de marca do `<title>` — mantido.
- Fechamento de atendimento "concluir sem registro" é corretamente 409 antes
  do horário; o smoke-ux passou a exercitar o **caminho clínico real**
  (chegada na fila → registro → finalizar → agendamento concluído pelo
  serviço oficial, com histórico/automação/lead conversion).

## Pendências honestas (não alegar como aprovadas)

- **Visual/browser (Chromium): NÃO executado** — o sandbox não permitiu
  baixar o browser. Fluxos visuais afetados pela onda (rótulos de tema,
  onboarding, `/automacoes`) foram validados por fonte+HTTP, não por pixel.
  Pendente para quem revisar com browser.
- Drenagem dos fallbacks (cookie/env/`x-instalink-action`/id do embed) fica
  para onda própria quando as sessões/ambientes antigos expirarem — é
  removível por design, não por urgência.

---

## Reexecução — CORREÇÃO FINAL da PR #51 (mesma branch)

Método idêntico (build de produção, seed clínico tri-tenant, harness HTTP
contra `localhost:3000` com a flag OFF, re-seed antes de cada suíte).

| Suíte | Resultado |
| --- | --- |
| Vitest completo | 2965+ pass · 4 fail = baseline provada em worktree de `dbf7d68` (a34-instagram×3, automation-audit-p4×1) |
| `convergence-final.test.ts` (novo, blocos A–D) | **29/29** |
| `smoke.mjs` | **67 ok / 0** |
| `smoke-ux.mjs` | **88 ok / 0** |
| `smoke-agendar.mjs` | **25 ✓ / 0 ✗** |
| `smoke-p3.mjs` | **15 fluxos** ok (+ consumidor de retry) |
| `smoke-p4.mjs` | **18/18** |
| `e2e-merchant.mjs` | **28 ok / 0** |
| Sonda de personas (flag OFF) | **11/11** — Owner units=3 · Maria 403 por design · Profissional 200 · Master units=0; `godoutor_session` canônico, `il_session` purgado no login, dual-read 200, 401 pós-logout nos dois |
| `tsc --noEmit` / `next build` / `git diff --check` | limpos |

Evidências comportamentais da correção (unidade nova criada pela API **sem**
payload comercial, flag OFF): checklist `Dados → serviço → profissional →
horários → (opcional) WhatsApp`, **sem** Página e **sem** vitrine;
`/api/businesses/[id]/features` oferece `bookings, services, reviews, faq,
gallery, location, about, agent, whatsapp` (products/orders/quote **fora**);
`PATCH {feature:'products'}` → **410** com explicação de legado preservado;
`PATCH {feature:'reviews'}` → 200.

Achado corrigido no caminho (honestidade de registro): `scripts/master.mjs`
chamava `resolveLocalDbFile` sem o helper no arquivo (introduzido na onda C2;
só disparava sem `DATABASE_URL`) — helper adicionado com a mesma regra de
seed.mjs/db.ts e suíte revalidada; fallback de nome do bootstrap virou
'Master GoDoutor'.

Pendências assumidas (não bloqueiam): visual/browser **NÃO executado** (sem
Chromium no sandbox); cookies de protocolo `il_session/il_cust_session/il_support`,
tabela `instalink_doc`, alias `INSTALINK_DB_FILE` e namespace CSS `il-*`
permanecem como LEGACY_COMPAT/LEGACY_STORAGE/CSS_NAMESPACE_LEGACY com plano
próprio — ver matriz em `GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md`.

---

## Bloqueio final da PR #51 — projeção operacional do Overview (commit `afb6d8b`)

Contexto: unidade LEGADA com `modes [services, bookings, products, orders, quote]`,
produto e pedido gravados. Com a flag OFF, a Dashboard/Overview não pode absorver
o comércio; com a flag ON, a compatibilidade continua visível.

| Verificação | Resultado |
| --- | --- |
| `legacy-commerce-off-overview.test.ts` (fixture OFF + ON, rota real) | **7/7** |
| Focado (convergence-final · wave2 · legacy-page · product-positioning · clinical-convergence · overview-access) | **119/119** |
| Vitest completo | **2975 pass · 4 fail = baseline exata** (a34-instagram×3, automation-audit-p4×1) |
| `tsc --noEmit` (npm run typecheck) · `next build` · `git diff --check` | limpos |
| Smoke-UX (reescrito p/ novo contrato varejista: máscara na Dashboard + dados vivos na API) | **96 ok / 0** |
| Smoke · Agendar · E2E-legacy (consomem overview/rotas) | **67/0 · 25/0 · 28/0** |
| p3/p4 | não reexecutados — alteração restrita a dashboard/overview/helpers (permitido pelo bloqueio) |

Provas do teste novo (flag OFF): `context.modules.{products,orders,quote}=false` ·
`recent.orders=[]` · `ordersPanel/productsPanel=null` · `totals.{orders,newOrders}=0` ·
`revenueDetail.orders=null` e `sources` sem `orders` · `revenue` oculto/zero (sem
fallback) · `hasOrdersModule/hasProductsModule=false` · payload `modules` sem
products/orders/quote · checklist sem `Produtos/Pedidos/Vitrine` e sem
`/produtos`,`/pedidos` · **storage intacto** (modes, produto e pedido continuam no DB).
Flag ON: painéis, totais, atividade, `vitrine` no checklist e `sources` com `orders`
todos de volta. Smoke-UX ancora o mesmo comportamento em HTTP contra o build real.
