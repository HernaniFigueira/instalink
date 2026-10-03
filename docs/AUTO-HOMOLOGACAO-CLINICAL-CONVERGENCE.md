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
