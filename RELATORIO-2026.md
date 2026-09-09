# INSTA LINK 2026 — Relatório de implementação

**Base:** `AUDITORIA.md` (achados A–J + Stages 0–5). **Ordem:** construir o produto em 6 blocos,
preservando a base boa, evoluindo via migrações seguras, com build+testes por bloco.
**Status final:** 6/6 blocos implementados, `tsc` limpo, `npm run build` verde, 29/29 testes verdes.

Commits (main, após `54753fb`):

| Bloco | Commit | Conteúdo |
|---|---|---|
| 1 | `eadbf47` | fail-closed DB, timezone SP, slots com passado/lead/horizon, DTO público, OAuth state, rate limit, máquinas de estado, whitelist, concorrência atômica, dedupe normalizado, exceções API |
| 2 | `2170f6e` | teamMode + vínculo serviço–pro, agenda por data, exceções UI, políticas, remarcação atômica, menu enxuto, serviços carousel, seed atualizado |
| 3 | `fe10dad` | recuperação de senha (lojista+consumidor), onboarding de telefone Google, guest quote, identidade reutilizada |
| 4 | `d0c01fb` | dashboard com receita/upcoming, 401 global, switcher de negócios, pedidos com paginação, cliente 360 |
| 5 | `7b83657` | suíte vitest (29 testes), analytics com período/funis/receita, resultados redesenhado, retenção LGPD |
| 6 | `c9ba7d3` | next/font, OG/Twitter, assistente virtual, alts, a11y recuperar |

## O que foi implementado

**Bloco 1 — Segurança/integridade (fundação).** `lib/db.ts` fail-closed (erro de leitura
lança exceção; escrita recusada sobre leitura falha — elimina o risco de wipe do P0-1);
timezone oficial America/São_Paulo em `lib/tz.ts` (+ `parseISODate`/`isPastDate` no bloco 5);
slots com filtro de passado, antecedência mínima e horizonte; DTO público sem
`googleApiKey`/`pixKey`/`ownerId` (+ rota `checkout-info` entregando `pixKey` só no checkout);
OAuth Google com `state`; rate-limit por IP/rota; máquinas de estado em `lib/status.ts`
(fonte única de rótulos — painel e consumidor); whitelist de modos; códigos de pedido e
slots com proteção atômica contra corrida; dedupe de leads por telefone normalizado;
API de exceções de agenda (dias fechados).

**Bloco 2 — Agenda.** `teamMode` no agendamento público (escolher profissional ou qualquer um);
vínculo serviço↔profissional; agenda do lojista ordenada por data do atendimento (views
Hoje/Amanhã/Próximos/Passado/Todos, filtros, paginação, erros de transição visíveis);
exceções editáveis na UI; políticas de reserva/cancelamento; remarcação atômica
(valida o novo slot ignorando a própria reserva, 409 em corrida); menu público enxuto;
vitrine de serviços com cards + carousel; seed atualizado.

**Bloco 3 — Conversão.** Recuperação de senha para lojista e consumidor
(tokens uso único, 1h, só hash no banco, sem enumeração, auto-login no reset);
tela `/recuperar`; onboarding de telefone para quem entrou com Google (PhoneSheet);
orçamento guest (sem login obrigatório); identidade do consumidor reutilizada
(nome/telefone pré-preenchidos); PIX copia-e-cola no checkout; taxa de entrega e
pedido mínimo configuráveis.

**Bloco 4 — Painel.** Dashboard com receita (7/30 dias + comparativo), próximos
atendimentos, movimento e operação clicável; setup que some aos 100%; tratamento
global de 401 (redireciona ao login em vez de quebrar telas); validação do `?b=`;
switcher de negócios (desktop + mobile); pedidos com paginação, rótulos, WhatsApp com
DDI e cancelamento two-tap; **cliente 360** (`/api/people360`: pessoa unificada por
telefone com pedidos, agendamentos e conversas, busca e avanço de lead).

**Bloco 5 — Dados.** `lib/analytics.ts` puro + suíte vitest (29 testes);
`/api/analytics` com período, visitantes únicos, receita, funis separados
(pedidos/agendamentos) com taxas, série diária, produtos com receita, ranking de CTAs,
origens resolvidas; página Resultados redesenhada; retenção LGPD
(`scripts/retention.mjs` + `docs/retencao.md`: eventos 180 dias, orçamentos parados
24 meses, dry-run por padrão).

**Bloco 6 — Acabamento.** Fontes via `next/font` (sem CSS render-blocking);
Open Graph/Twitter no layout + OG dinâmico por negócio (com logo quando absoluto);
"Concierge IA" → "Assistente virtual" nos textos visíveis; `alt` em imagens de
produto/serviço/equipe/galeria; `role="alert"` nos erros da recuperação.

## Banco de dados (migrações seguras)

Doc JSON único (`instalink_doc`) com migração aditiva em leitura: `customerId`/
`updatedAt`/`history` em pedidos, agendamentos e leads; `deliveryFee`/`minOrder` e
configs de reserva no negócio; `professionalIds` nos serviços; `serviceId` na
disponibilidade; `passwordResets` (só hash); eventos com `meta.vid`. Nada existente é
apagado; seed com `SEED_MERGE=1` preserva produção.

## Segurança

Fail-closed no DB; rate-limit (auth 5–10/min, APIs sensíveis limitadas); sem vazamento
de segredos no DTO público; OAuth com `state`; reset sem enumeração; transições de
status validadas no servidor; `?b=` validado contra negócios do dono; escopo de
disponibilidade por negócio/serviço/profissional. Pendência conhecida: sem WAF/CAPTCHA
dedicado (rate-limit é a proteção atual).

## UX

Mobile-first preservado; nenhum `confirm()` nativo nos fluxos tocados (two-tap);
sheets com Esc/focus; datas humanas ("Hoje", "Amanhã"); rótulos vindos de `status.ts`
(nunca códigos crus); sessão expirada redireciona com mensagem em vez de telas
quebradas; erros de API exibidos inline (nunca silenciosos).

## Testes

`npm test` → **29/29 verdes** (analytics, utils/dinheiro/telefone/slug, timezone,
máquinas de estado + invariante "sem status na agenda"). `tsc --noEmit` limpo e
`npm run build` verde em todos os blocos. Sem testes e2e (navegador) — cobertura é
unitária sobre regras puras.

## Pendências (não bloqueiam o deploy)

1. **E-mail de recuperação em produção:** configurar `RESEND_API_KEY` + `MAIL_FROM`
   na Vercel (sem isso, o mailer registra em log e `sent=false`).
2. **Push:** commits locais à frente do `origin` — push precisa de token fresco.
3. **Senha do Neon:** rotação recomendada após uso do pooler (atualizar env Vercel + redeploy).
4. **Retenção:** agendar `node scripts/retention.mjs --apply` mensalmente.
5. Demos: rodar seed com `SEED_MERGE=1` se os slugs demo ainda não existirem em prod.

## Build & deploy

```sh
npm ci && npm test && npm run build   # tudo verde
git push origin main                  # deploy automático na Vercel
```

Sem variáveis novas obrigatórias; tudo funciona sem provedores externos
(e-mail vira log, mapas/embed por negócio). Rollback: reverter o commit do bloco.
