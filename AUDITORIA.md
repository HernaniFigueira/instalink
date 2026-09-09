# InstaLink — Auditoria completa (set/2026)

Leitura 100% read-only de `src/` (8.169 linhas, 42 rotas), `scripts/seed.mjs` e produção.
Nenhum código foi alterado. Nenhuma operação destrutiva foi executada.

Regra desta auditoria: diagnosticar primeiro, implementar depois, em estágios.

---

## A — O que está funcionando (manter)

1. **Monolito Next.js coeso e íntegro.** TypeScript, build verde, 42 rotas com
   responsabilidades claras. Base sólida — não precisa de rewrite.
2. **Multi-tenancy consistente nas APIs de dono.** Todas as rotas de gestão
   (`orders`, `bookings`, `leads`, `reviews`, `catalog`, `pages`, `analytics`,
   `overview`, `businesses`) conferem sessão + `ownerId`. Nenhum vazamento
   entre negócios encontrado.
3. **Validação séria no servidor (pedidos).** `POST /api/orders` recalcula
   100% dos preços, valida opções min/max/obrigatórias e ignora o que o
   cliente enviou. Padrão correto.
4. **Agendamento com validação de slot + 409 honesto** ("acabou de ser
   ocupado"). Mensagem de conflito é premium.
5. **Avaliações com moderação real.** `pending → published/hidden`, vínculo com
   pedido/agendamento, anti-duplicado, regras de elegibilidade. Fluxo completo.
6. **Rascunho com preview de dono.** `getPublicData` retorna 404 para estranhos
   e preview para o dono. Privacidade correta.
7. **Sheets como destino único de conversão.** CTA, cardápio, agenda e orçamento
   abrem o mesmo bottom-sheet. Mobile-first, consistente.
8. **Auth resiliente.** scrypt, sessões 30 dias, cookie httpOnly/secure +
   Bearer + memória/localStorage. Funciona até com storage restrito.
9. **Detalhes de agenda bem pensados.** Mapa de dias com vagas, pré-seleção do
   próximo dia livre, slots agrupados Manhã/Tarde/Noite, link Google Agenda,
   CTA fixo com resumo.
10. **Seed com modo MERGE idempotente** e deploy Vercel + Neon documentado.

---

## B — Resposta direta aos 8 pontos levantados

### §1 Templates e prévia — OK, manter
8 presets + `ThemeEditor` + prévia ao vivo funcionam. Gaps menores: sem
alternador mobile/desktop na prévia (cap.C do editor), sem imagem OG por
negócio. Nada estrutural.

### §2 Agenda — ESCLARECIMENTO IMPORTANTE: "Na agenda" não existe como status
O pipeline real hoje (`src/lib/types.ts` + `agenda/page.tsx`) é:

```
pending → confirmed → completed
   ↓          ↓
cancelled   no_show / cancelled
```

A aba "Agenda" do menu público é só navegação — **não é um estado do
agendamento**. O que você chamou de "na agenda" é o `confirmed`.
Diagnóstico: o pipeline está correto e não precisa de estado novo.
O que precisa: (a) unificar rótulos — consumidor vê "Aguardando", lojista vê
"Pendente" para o MESMO estado (`customer.tsx` × `agenda/page.tsx`); (b) a
Agenda do painel ordena por **criação**, não por **data do atendimento**, e não
tem visão "hoje" — isso sim é P1 de usabilidade.

### §3 Profissional — gap confirmado, sem config no produto
Hoje: se existe ≥1 profissional, a etapa aparece para TODO serviço, sempre com
"Quem estiver livre". Não existe: vínculo serviço↔profissional, modo da equipe
(só eu / equipe escolhível / automático), regra de auto-atribuição.
Pior: o editor de Horários **destrói regras por profissional ao salvar**
(ver P0-3). Proposta de modelo na seção J.

### §4 Disponibilidade — o elo mais fraco do produto
- Regra é só (dia da semana, início, fim, slot) — sem vínculo com serviço.
- Sem UI para dias fechados/exceções (feriado, folga): `exceptions` só existe
  no banco e no seed. Lojista não consegue fechar um dia. P1.
- Sem intervalo de almoço (1 período/dia), sem buffers, sem antecedência
  mínima, sem limite de antecedência máxima.
- **Sem trava de passado**: é possível agendar ontem ou hoje num horário que
  já passou (ver P0-2).

### §5 Identidade — gap confirmado nos 3 fluxos
Logado ou não, `BookingIsland`, `CartDrawer` e `QuoteIsland` sempre pedem
nome + WhatsApp (só preenchem). Regra proposta: conta tem dado → usa o dado,
não pergunta. Exceção: usuários do Google sem telefone (ver P1-9) — pedir
**uma vez** e salvar na conta, nunca mais.

### §6 Painel Início — gaps confirmados
- Card "Configuração" nunca sai, nem a 100% (só o banner "Próxima ação" some).
- Atividade mostra **códigos crus** (`new`, `pending`) e **data ISO crua**.
- Botão "Ver página" abre o **editor**, não a página pública (rótulo errado;
  o link público real é o slug pequeno ao lado).
- Sem receita (dado existe em `orders.total`), sem próximos agendamentos, sem
  badges de pendência no menu.

### §7 Clientes — conceito fundido, sem 360
A tela "Clientes" lista **só leads**. A conta do consumidor (`Customer`) é
invisível no painel, `Lead` não tem `customerId`, e o match é por telefone
**sem normalizar** (gera duplicados, ver P1-5). Não há timeline por pessoa
(lead → pedidos → agendamentos → avaliações). Proposta na seção J.

### §8 Menu mobile — duplicação real, destino consistente
4 entradas abrem o booking: CTA + "Agendar" por serviço + bloco agenda + menu
"Agenda". O destino é o mesmo sheet (bom — não há fluxos paralelos), mas
visualmente é redundante. Proposta: CTA único contextual + menu enxuto
(Início, Cardápio/Serviços, Agendar, Avaliações, Contato).

---

## C — Achados críticos (P0 — corrigir antes de qualquer feature)

| # | Achado | Evidência | Impacto |
|---|--------|-----------|---------|
| P0-1 | `updateDB` com fail-open: `pgRead` retorna `emptyDB()` em QUALQUER erro e o write sobrescreve o documento inteiro | `src/lib/db.ts` (`pgRead` catch-all + `updateDB` read-modify-write; sem backup no Postgres) | Um erro transitório do Neon + qualquer escrita (até um `page_view`!) **apaga o banco de produção inteiro** |
| P0-2 | Agendamento no passado aceito: sem trava `data >= hoje` / `hora > agora` no POST nem filtro "now" no `computeSlots`; GET serve slots de datas passadas; sem teto futuro | `src/app/api/bookings/route.ts` (POST sem checagem de data), `src/lib/slots.ts` | Reserva para ontem / horário já passado; agenda mentirosa |
| P0-3 | Editor de Horários destrói regras: `availability.save` apaga TODAS as regras do negócio e o editor salva 1 intervalo/dia com `professionalId: ''` | `src/app/api/catalog/route.ts` (`availability.save`), `HoursEditor` em `servicos/page.tsx` | Salvar horários **deleta silenciosamente** regras por profissional; sem almoço, sem exceções |

Correções indicadas (sem código aqui, só direção):
- P0-1: `pgRead` deve **lançar** em erro (nunca retornar vazio em escrita);
  `updateDB` deve recusar write sobre leitura falha; ligar backup/PITR no Neon;
  expurgar sessões expiradas e limitar `events` (seção E).
- P0-2: guard no POST (`date >= hoje_local`, `time > agora + antecedência` em
  `America/Sao_Paulo`) + filtro no cálculo de slots + teto (ex.: 60 dias).
- P0-3: editor por profissional + UI de exceções (fechar dia) + múltiplos
  períodos/dia; `availability.save` com escopo (só o que foi editado).

---

## D — Achados importantes (P1 — quebram confiança, conversão ou dados)

**Segurança / integridade**
- P1-1. Vazamento de segredos no público: `getPublicData` devolve o `business`
  inteiro, incluindo `googleApiKey`, `pixKey` e `ownerId`, para todo visitante
  (`src/lib/public.ts`). Projetar DTO público.
- P1-2. Sem rate limiting em nada: login/register (força bruta/stuffing),
  `events` (qualquer um infla/destrói analytics de qualquer negócio com o
  `businessId` público), concierge. `events` ainda reescreve o doc inteiro por
  chamada — `page_view` em toda visita = write amplification.
- P1-3. OAuth Google sem `state`/nonce (callback ignora `state` — login CSRF)
  (`src/app/api/auth/google/*`).
- P1-4. Concorrência last-wins: dois POSTs simultâneos de booking podem
  furar a checagem de slot (check fora do `updateDB`); pedidos simultâneos
  podem duplicar `code` (`count+1`). Validar **dentro** do `updateDB` (throw).
- P1-5. Leads duplicados: match por `phone` cru em 3 rotas
  (`orders`, `bookings`, `leads`). Normalizar com `onlyDigits`.
- P1-6. `cents("45.00")` vira R$ 4.500 (`servicos/produtos/page.tsx`).
  Normalizar e validar faixa no servidor.
- P1-7. `option.save` regenera todos os `valueIds` a cada edição → carrinhos
  em aberto reprecificam silenciosamente. Manter ids estáveis.

**Conta e acesso**
- P1-8. Sem recuperação de senha (lojista E consumidor) e sem verificação de
  e-mail. Esqueceu a senha = conta perdida. Exige provedor de e-mail (decisão
  de produto).
- P1-9. Login Google cria conta com `phone: ''`, mas checkout/agendamento
  exigem telefone — e **não existe edição de perfil**. Usuário Google trava no
  pagamento da promessa. Pedir telefone 1 vez e salvar na conta.
- P1-10. Orçamento/lead exige login. Topo de funil com muro = conversão
  perdida. Proposta: orçamento guest (cria lead; oferece conta depois).

**Agenda e operação**
- P1-11. Agenda ordenada por criação, sem visão "hoje"/data/profissional.
- P1-12. Sem UI de exceções (fechar dia/feriado) — soma ao P0-3.
- P1-13. WhatsApp quebrado no painel: `wa.me/${digits}` sem DDI em
  `pedidos`, `agenda`, `clientes` (≠ `waLink`, que põe 55 + texto).
- P1-14. Rótulos divergentes consumidor × lojista ("Aguardando" × "Pendente"),
  códigos crus e ISO cru no Início. Um mapa único de rótulos.
- P1-15. Sem alternador de negócio (multi-negócio exige editar URL) e `?b=`
  inválido cai silenciosamente no primeiro negócio. Validar + alternador.
- P1-16. `resultados` quebra com sessão expirada (`setData({error})` → crash
  no destructure). Guard `r.ok` (auditar irmãs do padrão).
- P1-17. `pixKey` coletada e **nunca exibida** ao consumidor (grep: zero uso no
  público); pagamento é só etiqueta; sem taxa de entrega (`Business` não tem
  o campo), sem estoque, sem pedido mínimo. Fluxo de pagamento incompleto.
- P1-18. Sem transição válida de status (PATCH aceita `completed → pending`;
  `ok:true` até p/ id inexistente). Máquina de estados por entidade.
- P1-19. `modes`/`niche` sem whitelist no `POST /api/businesses` — lixo
  quebra menu/CTA silenciosamente. Validar + migração defensiva.
- P1-20. Excluir serviço/profissional orfã agendamentos futuros sem aviso.

---

## E — Banco de dados e escala

1. **Documento único JSONB**: toda leitura/escrita carrega e grava TUDO.
   Funciona no MVD, mas `events` (1 por page_view + 1 por mensagem do
   concierge) e `sessions` (nunca expurgadas) incham o doc sem teto.
   Caminho: tabela/retention para eventos, purge de sessões, paginação nos
   GETs de gestão (hoje retornam arrays integrais).
2. **Sem histórico**: bookings/orders sem `updatedAt`, sem log de mudança de
   status. Auditoria e "quem cancelou?" impossíveis.
3. **Fuso**: `new Date().toISOString().slice(0,10)` é UTC. Perto da meia-noite
   (UTC-3), elegibilidade de avaliação, cancelamento e séries do analytics
   erram o dia. Fixar `America/Sao_Paulo` nas comparações de data.
4. **Métricas com semântica frouxa**: "Visitantes" conta views (não únicos);
   `conversion` conta lead E pedido da mesma pessoa; taxa pode passar de 100%;
   "Cliques" só rastreia o concierge (CTA/sheets não emitem `button_click`).
   Funil "Ações/Interessados" é soma arbitrária. Redefinir antes de exibir.
5. **Sem DELETE de negócio** (`businesses/[id]` só tem PATCH) — lixo de teste
   acumula; e não há purge de conta (LGPD futura).
6. Integridade a verificar com SELECT read-only em produção (contagens,
   órfãos, duplicados de lead, reviews pendentes antigas). Pendente: rodar
   contra o Neon com URL atualizada (a do chat será rotacionada).

---

## F — Segurança (matriz)

| Área | Estado |
|---|---|
| Gestão multi-tenant (dono) | OK — sessão + `ownerId` em todas as rotas auditadas |
| Preços/opções | OK — recalculados no servidor |
| Reviews | OK — dono modera, consumidor só avalia o próprio elegível |
| Hash/sessão/cookie | OK — scrypt, 30 dias, httpOnly/secure |
| XSS armazenado | Baixo — React escapa; `href` com URL do lojista (self-XSS no pior caso) — validar `http(s)` (P2) |
| Brute force / stuffing | **Aberto** — sem throttle no auth (P1-2) |
| Vazamento de chave | **Aberto** — `googleApiKey` no público (P1-1) |
| OAuth CSRF | **Aberto** — `state` ignorado (P1-3) |
| Wipe por fail-open | **Aberto** — P0-1 |
| Recuperação de conta | **Inexistente** — P1-8 |

---

## G — Mobile, a11y, performance, SEO

- **Mobile**: público mobile-first de verdade; painel responsivo com topbar.
  OK. Faltam: alternador de negócio, paginação (listas longas pesam).
- **A11y**: botões-ícone com `aria-label` na maioria; diálogos sem Esc/focus
  trap; formulários (login, checkout, booking) usam **só placeholder, sem
  `<label>`** — corrigir (P2).
- **Performance**: gargalo é escrita por visita (`Track` → `page_view` →
  rewrite do doc). Depois: fontes bloqueantes via Google Fonts `<link>`
  (migrar p/ `next/font`), `<img>` cru sem otimização, sem paginação.
- **SEO**: título/descrição/OG básicos por negócio OK; faltam imagem OG,
  canonical, `public/` inteiro (**favicon, manifest, robots, sitemap** —
  `public/` está vazio), OG na landing. Rascunhos retornam 404 (correto).

---

## H — Duplicações e código morto (consolidação, não mais duplicação)

**Duplicações estruturais (fundir em 1):**
1. 4 modais: `SheetShell` × modal do Concierge × `ProductModal` × `CartDrawer`.
2. 2 sistemas de ícones: `Icon` (`icons.tsx`) × `Svg/PATHS` (`DashboardShell`
   — caminhos idênticos copiados: home, calendar, receipt, scissors, external).
3. Moeda: `utils.money` × `pedidos.money` × `cents/reais` em
   `produtos` + `servicos` (cópias byte-igauis).
4. Rótulos de status em 5 lugares (com DIVERGÊNCIA pt: Aguardando×Pendente).
5. `afterLogin` + efeito de prefill × 3 ilhas (extrair hook `useCustomerForm`).
6. Links WhatsApp: `waLink` (correto) × `wa.me` cru × 3 telas do painel.
7. `initials()` em `widgets.tsx` e `[slug]/page.tsx`.
8. `endTime` (BookingIsland) × cálculo interno do `gcalLink`.
9. Datas: `formatDate` (só agenda) × ISO cru × split manual (conta).

**Código morto / quase-morto:**
- Kit `ui.tsx`: `Button, A, Input, Textarea, Select, Field, EmptyState,
  PageHeader, Notice` com **zero uso** no painel — adotar ou remover.
- Ramos non-`bare` das ilhas (sempre renderizadas com `bare` via sheet).
- `Service.image` e `Professional.photo`: schema sem nenhuma UI.
- `booking.note`: API aceita, UI nunca envia.
- `void customer` (`leads`), `void onlyDigits` (callback Google).
- `title=""` passado às ilhas + `id="agendar"` duplicado (inofensivo).

---

## I — Ordem de execução (estágios, sem pular)

**Estágio 0 — Travar a base (P0).** Nada novo antes disso.
Fail-closed no `db.ts` + backup/PITR Neon; trava de passado + fuso SP;
disponibilidade com escopo + UI de exceções; DTO público sem segredos.

**Estágio 1 — Conversão e confiança (P1 de UX/conta).**
Orçamento guest; reusar dados da conta (nunca re-perguntar); completar
telefone Google 1 vez; agenda ordenada por data + visão hoje; rótulos únicos;
`waLink` em tudo; alternador de negócio; Início sem setup pós-100% + receita +
próximos; guards 401; decidir provedor de e-mail (recuperação de senha).

**Estágio 2 — Modelo de agenda (§3+§4).** Modos de equipe, vínculo
serviço↔profissional, regras por serviço, buffers/antecedências, política de
cancelamento, remarcar sem perder o slot original.

**Estágio 3 — Cliente 360 (§7).** `customerId` no lead, dedupe normalizado,
timeline por pessoa, edição de perfil, notificações v1 (lojista: novo
pedido/agendamento/cancelamento; consumidor: status).

**Estágio 4 — Dados e escala.** Eventos com retention/cap (+ rate limit),
purge de sessões, paginação, visitantes únicos, funil/receita redefinidos,
máquina de estados, whitelist de modes/nicho.

**Estágio 5 — Acabamento.** Upload de imagens (trocar URL crua), `public/`
(favicon/manifest/robots/sitemap/OG), `<label>`s + Esc/trap, fusão dos
modais/ícones/moeda, remoção do morto, `next/font`, validação `http(s)`.

---

## J — InstaLink-2026: arquitetura-alvo coerente

**Princípios (valem para todo estágio):**
1. Uma conta consumidor global; negócio nunca re-pergunta o que a conta tem.
2. Guest até o ponto de compromisso; conta na hora de acompanhar.
3. Motor universal: `Product/Service/Professional/Availability/Order/Booking/
   Lead` genéricos — nada de `if (niche === ...)` em regra de negócio.
4. Todo número exibido tem definição única; todo status tem rótulo único.
5. Toda destrutiva confirma em-sheet (nunca `confirm()` nativo) e é auditável.

**Modelo de agenda (fecha §2/§3/§4):**
- `Business.booking`: `{ teamMode: 'solo' | 'choosable' | 'auto', leadMin,
  cancelUntilMin, horizonDays, buffers }`.
- `Service.professionalIds[]` (vazio = todos); `Availability` com `serviceId?`
  opcional; `Exception` com UI (dia fechado / horário especial).
- Pipeline mantido: `pending → confirmed → completed` (+ `no_show`,
  `cancelled`). "Na agenda" = `confirmed` — esclarecer no produto, não criar
  estado.
- Auto-atribuição: menor carga no dia, desempate por ordem; sempre mostrar
  quem atende antes de confirmar.

**Modelo de pessoa (fecha §5/§7):**
- `Lead` ganha `customerId?`; pessoa = identidade normalizada (telefone
  dígitos + e-mail lower). Timeline única: origem → interações → pedidos →
  agendamentos → avaliações → status. Dedupe na escrita + fusão assistida.

**Início do lojista (fecha §6):** sem setup após 100% (vira link "Ver
checklist"); cartões: receita período, próximos agendamentos (hoje/amanhã),
pendências com link direto, atividade com rótulos humano
...[truncated 300 chars]