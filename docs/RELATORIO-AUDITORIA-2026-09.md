# Relatório — Auditoria + Implementação (set/2026)

Escopo executado: lógica dos módulos (Produtos/Recursos), contexto da empresa,
primeira configuração de conta nova e refinamento visual da página pública.
A arquitetura da Dashboard (sidebar, grupos e itens) foi **preservada** —
nada foi movido, renomeado ou reestruturado.

---

## 1. Causa raiz do problema de Recursos

`GET /api/businesses/[id]/features` lia o id da empresa **somente de
`?businessId=`** — o `[id]` do próprio path era ignorado (o handler nem
recebia `params`). A tela chama `/api/businesses/<id>/features` **sem query**,
então toda leitura caía em `requireBusiness('')` → **400 "Negócio não
informado."** → a UI exibia "Tentar de novo" → nova tentativa idêntica →
**loop infinito** ("Negócio não encontrado/informado").

Correção na CAUSA (não na mensagem):

- `businessIdFromRoute(params, req)` (`src/lib/business-context.ts`, puro e
  testado): o id vem do **path**; `?businessId=`/`body.businessId` ficam
  apenas como **fallback de compatibilidade** — aplicado em GET **e** PATCH.

## 2. Como o contexto da empresa foi corrigido

- Novo hook `useBusinessId` (`src/components/dashboard/useBusinessId.ts`):
  `?b=` continua valendo (contexto explícito), mas **não é mais fonte única** —
  sem `?b=`, a empresa ativa é resolvida pelo **`/api/auth/me`** (a mesma
  fonte do DashboardShell), via `resolveActiveBusinessId`.
- Estados de contexto **distintos** na tela de Recursos:
  - **sem empresa** → estado próprio com CTA "Criar meu negócio";
  - **erro de rede** → mensagem de conexão + tentativa que recomeça o ciclo
    inteiro (contexto → dados), nunca retry decorativo;
  - **permissão (403)** → `AccessDenied` (sessão preservada, regra 401×403);
  - **404 real** → único caso chamado "não encontrado".
  - Nunca mais "Negócio não encontrado" para tudo.

## 3. Como Produtos passou a ser ativado (a qualquer momento)

- Recursos funciona ponta a ponta: toggle → PATCH salva → **servidor relê**
  → `il:business-refresh` atualiza o shell (menu/áreas) → Produtos aparece
  em Atendimento e `/produtos` abre — **sem F5**.
- Em **Página → Estrutura → Vitrine de produtos**, além do link para
  Recursos há agora **"Ativar Produtos agora"** (ativa direto no bloco, com
  revalidação do contexto). O bloco deixa de acusar "módulo desligado".
- **Contradição auditada e corrigida (regra §4):** a vitrine era reativada
  pelo fallback legado de Pedidos (`orders`) mesmo com Produtos desligado
  — conta antiga com `orders` nunca escondia a vitrine. Solução mínima:
  supressão explícita **`Business.productsOff`** (gravada no toggle, nunca
  apaga dados), que vence o fallback; negócios legados que **nunca**
  gerenciaram Produtos continuam funcionando pelo fallback, intactos.
  Documentado em `src/lib/features.ts` (`ordersShowcaseFallback`) e no DTO
  público (`toPublicBusiness`).

## 4. Contas novas

Onboarding curto (sem wizard): nome + **"Como sua empresa atende?"**.

| Opção | Módulos iniciais |
|---|---|
| Serviços e agendamento | `services` + `bookings` |
| Produtos | `products` |
| Serviços + produtos | `services` + `bookings` + `products` |

Mapeamento puro em `src/lib/onboarding.ts` (testado). É só a base: depois da
criação, Recursos liga/desliga livremente — nada bloqueia o sistema.

## 5. Contas antigas / demo

- Dados 100% preservados: desativar nunca apaga (validado: 5 produtos da
  Burger House intactos com o módulo OFF; vitrine volta ao reativar).
- Ciclo validado na conta com legado `orders`: desativar → vitrine some →
  reativar → tudo volta, sem migração manual e sem recriar conta.

## 6. Serviços + Produtos coexistindo

Modelo validado nas três configurações (testes `features.test.ts`):

- Produtos ON sem Serviços: vitrine aparece, serviços fora (e vice-versa);
- Serviços + Agenda + Produtos: mesma conta/página (barbearia do seed);
- `blockVisible`/`visibleBlocks` garantem independência dos blocos.

## 7. Página / Estrutura / Navegação — organização mantida

- Abas **Estrutura · Navegação · Visual · Publicação** preservadas.
- **"Sobre a empresa"** passou a constar na Estrutura como **seção fixa
  abaixo do Perfil** (mesmo comportamento do render público): toggle
  Ativo/Oculto, chip "Falta preencher" e editor inline
  (`AboutSectionEditor`, compartilhado com a aba Navegação). Não foi criada
  nenhuma página administrativa "Sobre".
- Aba **Navegação** auditada: mesma lógica (auto/personalizado, ordem,
  indisponível), agora com cabeçalhos visuais **"Seções da página" ×
  "Links externos"** — âncoras e links nunca mais se misturam conceitualmente.

## 8. Refinamentos visuais (página pública)

- **Capa/Hero:** de banner retangular full-bleed para **capa emoldurada**:
  margem lateral do container, cantos bem arredondados (radius+8), h-44,
  borda/sombra sutis; **avatar de 84px com anel duplo** de acabamento.
  CTA principal único preservado.
- **Menu inferior público:** volta ao padrão **ícone em cima / texto
  embaixo**; full-width fixo, sem cápsula, sem cantos arredondados
  externos; estrutura de `src/lib/bottombar.ts` — **Conta · WhatsApp ·
  Menu · Agendar** (Agendar único preenchido).
- **Redução de cards:** Serviços virou **lista com divisores** (carrossel
  só quando ≥5 sem categoria — aí o card visual ajuda); Diferenciais e
  Equipe leves (ícone/retrato + tipografia); Avaliações em carrossel de
  fundo sutil; FAQ com divisores; "Sobre" e Texto editoriais; **Vitrine em
  grade fotográfica** (imagem aspect-square, sem caixa). Permanecem cards
  apenas onde ajudam: chips do hero, botões de link, CTA, mapa.
- **SVGs:** o WhatsApp era o glifo oficial **sólido renderizado com
  stroke** → contorno duplo ilegível. Agora `fill="currentColor"`
  (`FILL_ICONS` em `src/components/icons.tsx` e no DashboardShell). Conjunto
  revisado: demais ícones (Instagram, TikTok/música, Facebook, YouTube,
  LinkedIn, Menu, Conta, Agenda, Localização) já eram traço 1.7–1.8
  consistente — mantidos.
- Referência visual (arena.site): composição/proporções/hierarquia seguidas
  (capa emoldurada, avatar com anel, seções editoriais), sem cópia.

## 9. Testes executados (tudo verde)

| Suíte | Resultado |
|---|---|
| `npm run typecheck` | OK |
| `npm test` (vitest) | **416 passando** (+24 novos) |
| `scripts/smoke.mjs` | 38 ok |
| `scripts/smoke-ux.mjs` | 87 ok |
| `scripts/e2e-merchant.mjs` | 28 ok |
| Runtime manual (API) | login → conta nova → empresa ativa → Recursos GET/PATCH → vitrine on/off → dados preservados → página pública (`/produtos` na vitrine, cadastro/edição/exclusão) |

Novos testes: `business-context.test.ts`, `onboarding.test.ts`,
`bottombar.test.ts`, + blocos de independência Produtos×Serviços e da
supressão `productsOff` em `features.test.ts`.
Browser E2E (Playwright) indisponível no sandbox (rede bloqueia o download
do Chromium); validação visual feita por HTML/CSS renderizado + regras.

## 10. Arquivos alterados

**Lógica/contexto:** `src/lib/business-context.ts` (+teste),
`src/lib/onboarding.ts` (+teste), `src/lib/bottombar.ts` (+teste),
`src/components/dashboard/useBusinessId.ts`, `src/lib/features.ts`,
`src/lib/types.ts`, `src/lib/public.ts`,
`src/app/api/businesses/[id]/features/route.ts`.

**Telas do painel:** `recursos/page.tsx`, `onboarding/page.tsx`,
`(dashboard)/pagina/page.tsx` (vitrine ativável, Sobre na Estrutura,
cabeçalhos na Navegação).

**Página pública/visual:** `[slug]/page.tsx`, `public/BottomBar.tsx`,
`public/FaqAccordion.tsx`, `public/showcase.tsx`, `components/icons.tsx`,
`components/DashboardShell.tsx`.

**Docs/testes:** `ARQUITETURA.md`, `src/lib/__tests__/features.test.ts`,
este relatório.

---

### Contradição documentada (schema §21)

O fallback legado `orders → catálogo` (`blockVisible`/`productsVisible`)
contradizia a regra "desativar Produtos ⇒ vitrine some" para contas com
pedidos legados. Corrigido apenas o necessário: supressão explícita
(`productsOff`) gravada no toggle; o fallback segue ativo para quem nunca
gerenciou Produtos. Nenhuma reestruturação silenciosa.
