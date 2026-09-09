# InstaLink.app — Arquitetura (MVD 1.0)

## Decisões técnicas

| Tema | Decisão MVD | Evolução prevista |
|---|---|---|
| Framework | Next.js 14 + App Router + TypeScript | — |
| Estilo | Tailwind + tokens de tema por negócio (CSS vars) | — |
| Banco | `JsonAdapter` (`src/lib/db.ts` + `data/instalink.db.json`) | Postgres via Supabase (mapeamento abaixo) |
| Auth | Híbrida: cookie httpOnly + Bearer token (`src/lib/auth.ts`, `src/lib/client-auth.ts`) | Supabase Auth (trocar só este módulo) |
| Multi-tenancy | `src/lib/tenant.ts` — toda query escopada por `businessId` + dono | RLS no Supabase |
| Agenda | Motor universal `src/lib/slots.ts` | — |
| IA | Concierge por regras sobre dados reais (`src/lib/concierge.ts`) | LLM com grounding nos mesmos dados |
| QR | `qrcode` server-side (`/api/qr`) | — |

## Por que JSON no MVD?

O ambiente do MVD não possui Postgres/Supabase provisionado. Para entregar
**fluxos reais funcionando** (não mocks), a persistência é um adapter com
interface mínima (`readDB`/`updateDB`). Nenhuma rota ou tela conhece detalhes
de armazenamento — a migração é mecânica.

## Migração para Postgres/Supabase (quando provisionar)

1. Criar tabelas com os mesmos nomes/campos de `src/lib/types.ts`
   (`users` → `auth.users` do Supabase; demais 1:1).
2. Reimplementar `src/lib/db.ts` com `@supabase/supabase-js` (server) mantendo
   as assinaturas `readDB/updateDB` ou introduzir repositórios por agregado.
3. Trocar `src/lib/auth.ts` por Supabase Auth (a sessão continua lida via
   `currentUser()` / `getUserBySession()` nas rotas).
4. Ativar RLS: `business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid())`.
5. `data/*.json` já está no `.gitignore` — nada de dados locais vaza.

## Estrutura

```
src/
  lib/         tipos, db, auth, tenant, templates, slots, concierge, utils, public
  components/  ui.tsx (design system painel), ThemeStyle, public/widgets*.tsx
  app/
    page.tsx            landing
    (auth)/             login, register
    onboarding/         3 passos → cria business + page do template
    (dashboard)/        layout (menu dinâmico por modos) + 9 telas
    [slug]/             página pública (mobile-first, blocos)
    api/                auth, businesses, pages, catalog(+get), orders,
                        bookings, leads, events, concierge, qr, analytics
```

## Autenticação híbrida (decisão central)

O app funciona **com ou sem cookies**, sem mudar uma linha nas telas:

1. Login/cadastro devolvem `{ ok, token }` e gravam cookie httpOnly (`SameSite=None; Secure; Partitioned`).
2. O cliente salva o token em `localStorage` (`src/lib/client-auth.ts`).
3. O `<AuthBootstrap/>` injeta `Authorization: Bearer` em todo `fetch` same-origin para `/api/*`.
4. O servidor aceita **cookie OU Bearer** (`userFromRequest`) em todas as rotas autenticadas.
5. O painel valida a sessão no cliente (`DashboardShell` → `/api/auth/me`), nunca no servidor.

Com isso, o painel abre em iframe cross-origin, com third-party cookies bloqueados e em qualquer navegador moderno.

Camadas de persistência do token (ordem de tentativa): **memória da aba → localStorage → cookie httpOnly**.
A memória cobre até o caso extremo (iframe com storage 100% bloqueado);
por isso a navegação pós-login/cadastro é SPA (`router.push`), que preserva
a memória — reload integral (F5) nesse cenário extremo volta ao login.

> Nota de ambiente: o proxy do preview exige o header interno
> `e2b-traffic-access-token`, então a URL pública NÃO abre em aba externa
> comum (403). O acesso oficial é pelo preview embutido — e é por isso que
> a autenticação foi projetada para funcionar sem depender de cookies.

## Segurança (MVD)

- Senhas: scrypt + salt; sessão httpOnly + Bearer de mesma força (id de sessão aleatório, revogável no logout, expiração de 30 dias).
- Mutações exigem sessão + posse do `businessId` (verificado no servidor).
- Pedidos: preços **recalculados no servidor**; checkout nunca confia no cliente.
- Agendamentos: slot revalidado no servidor (409 se ocupado).
- Slugs validados + palavras reservadas; settings de blocos sanitizados por tipo.
- Segredos só no servidor (não há `NEXT_PUBLIC_*`).

## O que NÃO foi construído (evolução futura)

Billing/planos, domínio próprio, WhatsApp API, pagamentos online, delivery com
roteirização, estoque, fidelidade, CRM avançado, PWA instalável, app nativo.
Todos têm ponto de extensão documentado no código (`Order` separado de
pagamento, `modes` por negócio, eventos para analytics).
