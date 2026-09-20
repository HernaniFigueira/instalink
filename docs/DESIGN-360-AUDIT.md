# D0 — Auditoria 360 de produto, código e experiência

**Data:** 20/09/2026 (UTC) · **Status:** entregue para revisão; redesign não iniciado.

## 1. Base, instruções e limites

| Verificação | Evidência desta sessão |
|---|---|
| Repositório | `HernaniFigueira/instalink`, checkout `/home/user/instalink` |
| Branch exclusiva | `arena/01a0bfbf-instalink` |
| HEAD auditado | `ebc7130805057135eae36c71c07313cc0e5710e3` |
| `main` remota | `git ls-remote origin refs/heads/main`: mesmo SHA, na consulta desta sessão |
| PR #32 Meta | `gh pr view 32`: MERGED, `2026-09-20T05:12:02Z`, merge commit igual ao HEAD |
| PR #31 Evolution | `gh pr view 31`: OPEN, branch `arena/01a0bc51-instalink`; somente consulta de metadados, sem checkout, reaproveitamento ou alteração |
| Estado inicial | `git status --short` vazio |
| Instruções locais | Nenhum `AGENTS.md` encontrado na árvore de `/home/user`. Lidos README, arquitetura, documentação de auditorias e contratos/comentários do código relevante. Código atual prevalece sobre relatos históricos |
| Escopo de escrita entregável | Apenas este documento e [DESIGN-360-PLAN.md](DESIGN-360-PLAN.md) |

**Restrições mantidas:** nenhuma alteração de código de produto, produção, banco real, segredo, papel/permissão real, integração ou cadastro real. Nenhuma demo/recurso existente foi removido. Sem merge, push ou alteração das PRs. WhatsApp permanece pausado como frente de trabalho: nenhum onboarding de canal, mensagem, campanha, webhook, cron ou credencial externa foi acionado. Nome InstaLink mantido provisoriamente.

### Legenda de evidência

- **C — Código:** comportamento deduzido de implementação, não comprovação visual.
- **H — HTTP local:** requisição real contra Next local com fixture sintética; não comprova interação, layout nem acessibilidade no navegador.
- **T — Teste direcionado:** teste automatizado existente; parte da cobertura é inspeção de fonte/regra pura, não E2E visual.
- **V — Visual:** screenshot/renderização efetivamente inspecionada. **Não há evidência V nesta sessão.**
- **P — Proposta/hipótese:** solução a validar, nunca descrita como capacidade atual.

Não havia Chromium/Chrome instalado. Uma invocação do instalador do Playwright tentou baixar Chromium (incluindo retries internos) e falhou com `ECONNRESET`, antes da conexão TLS com `cdn.playwright.dev`. Não houve navegador funcional. **Não há screenshots, aprovação visual, teste de toque, leitor de tela, foco real ou responsividade aprovado.** Também não foram usados screenshots de auditorias antigas como se fossem desta base.

## 2. Conclusão executiva

Há uma base operacional substancial: agenda com recorrência/fechamento, fila avulsa, registro de atendimento, CRM 360, tarefas, organização/unidades, editor e reserva pública. Não é necessário reinventar o produto para começar o redesign.

Os maiores problemas identificados são:

1. **Hierarquia:** oito seções e até 21 destinos visíveis num único menu; operação, configuração e crescimento competem no mesmo nível. Há 22 destinos declarados, incluindo Execuções fora da sidebar.
2. **Identidade e consistência:** logo cortado em quadrado/círculo, duplicado no dashboard; painel claro azulado, login escuro/verde e landing escura/lima; cor decorativa por seção e gradiente em cabeçalhos.
3. **Contrato editorial:** não existe uma versão publicada separada do rascunho. Salvar conteúdo de página publicada já altera o público. Prometer autosave de rascunho seria incorreto e arriscado.
4. **Papéis:** agenda própria não equivale a CRM privado. `PROFISSIONAL` vê sua agenda, mas o 360 inclui agendamentos de outros profissionais da mesma unidade. Secretaria padrão opera fila, mas não possui `atendimento`. `VIEWER` não tem sequer dashboard por padrão.
5. **Divergências de autorização a revisar separadamente:** GET de páginas aceita membro sem `pagina`; GET de organizações devolve previsão financeira sem `financeiro`. Não são evidências de vazamento entre tenants; são divergências intratenant entre guard, rótulo e expectativa do produto. Não corrigidas nesta rodada.
6. **Conversão:** a página pública abre um sheet autenticado, enquanto `/agendar` aceita visitante sem conta. Serviço já é transportado nos caminhos existentes; profissional não é selecionável nos dois fluxos lidos, apesar de props/parâmetros e README sugerirem mais.
7. **Acessibilidade:** há primitives, labels, estados e foco centralizado, mas não há tratamento global de reduced-motion; Drawer compartilhado não implementa gestão de foco/Escape e Tabs não completa o padrão de foco. Há tokens de texto abaixo de AA.

**Recomendação:** D1 estritamente visual/navegação/identidade, preservando contratos; decisões de acesso e de publicação ficam explícitas como gates, não entram camufladas em CSS. Plano completo no documento complementar.

## 3. Arquitetura e fundamentos que precisam sobreviver

| Fundação | Fonte | Consequência para redesign |
|---|---|---|
| Next 14 App Router, React 18, TS, Tailwind | `package.json`, `src/app` | Manter rotas e navegação SPA; não introduzir segundo router |
| Catálogo central do painel | `src/lib/panel.ts` | Fonte de destinos, gates, largura, unidade obrigatória, redirects; novos menus devem ser projeções dele |
| Autorização efetiva | `permissions.ts`, `access-core.ts`, `access.ts` | Menu oculto não é segurança. Overrides e vínculos por unidade prevalecem sobre personas |
| Contexto de unidade | `business-context.ts`, `useBusinessId.ts`, `DashboardShell.tsx` | `?b=` validado contra negócios acessíveis; valor inválido não amplia acesso |
| Sessão híbrida | `AuthBootstrap.tsx`, `client-auth.ts`, `auth.ts` | Cookie + Bearer, navegação SPA; não trocar por reload integral nem quebrar iframe com cookies bloqueados |
| Banco duplo | `src/lib/db.ts` | `DATABASE_URL` escolhe Postgres; sem ela, JSON; `INSTALINK_DB_FILE` permite isolamento local |
| Transações e agenda | `db-transaction.ts`, `booking-create.ts`, `booking-ops.ts`, `booking-series.ts`, `slots.ts` | Não recalcular horários/status na camada visual; preservar 409, fuso, elegibilidade e recorrência |
| Módulos comerciais | `features.ts` | Desativar oculta, não apaga; produtos/pedidos legados continuam preservados |
| Público separado | `public.ts`, `ThemeStyle.tsx`, `themes.ts` | DTO público explícito e tema da clínica distinto da identidade da plataforma |
| Registro de atendimento | `encounters.ts`, API de encounters | Rascunho/finalizado, versão otimista, reabertura restrita, impressão sem nota interna; não é prova de prontuário regulatório homologado |

README e `ARQUITETURA.md` têm trechos históricos: onboarding já inclui modelo de atendimento/produtos, Postgres já existe, painel não tem apenas nove telas. README menciona escolha de profissional no fluxo público, não encontrada na UI atual lida. Tratar relatos antigos como contexto, não aceite.

## 4. Inventário completo de telas e superfícies

Contagem por arquivos: **41 `page.tsx`**, dos quais **22 no painel**, **9 Master**, **3 legados admin**, **7 de entrada/público**. Há **92 `route.ts` em `src/app/api`** e o endpoint de widget fora de `/api`. Fila, atendimento e ficha 360 são superfícies internas, não rotas próprias.

Nas tabelas, `D/<rota>` significa `src/app/(dashboard)/<rota>/page.tsx`; `CD/` significa `src/components/dashboard/`. Os destinos de todas as rotas na navegação proposta estão no plano (§3).

### 4.1 Operação, relacionamento e oferta

| Rota/superfície | Componentes/fontes | Capacidades verificadas em código | Gate atual / ressalva |
|---|---|---|---|
| `/dashboard` | `D/dashboard`, `lib/dashboard.ts`, `/api/overview` | Hoje, próximos, atenção/pendências, clientes, receita condicionada, atividade, checklist real e ocultável, atalhos | `dashboard`; agenda filtrada pelo vínculo; não é dashboard inteiramente distinto por persona |
| `/agenda` | `D/agenda`, `NewBookingSheet`, `BookingDetailSheet`, `BookingRecurrence`, `agenda-drag.ts` | Dia/semana/mês, filtros de status/especialidade/profissional, tela cheia, agendar/remarcar, recorrência, check-in e fechamento | `agenda` + modo `bookings`; própria agenda quando há escopo; `?data=` existente |
| Fila, dentro de `/agenda` | `QueuePanel`, `/api/queue`, `lib/queue.ts` | Chegada com/sem reserva, buscar cadastro, aguardando/chamado/em atendimento/atendido/desistiu, encaixe | `agenda`; não há `/fila`. Filtra entradas próprias **e sem profissional**, mas resumo e lista de profissionais são da unidade |
| Atendimento, sheets da agenda/360 | `EncounterSheet`, `/api/encounters`, `encounters.ts` | Registrar o procurado/feito, orientação, retorno sugerido, nota interna; autosave do registro, versão, finalizar, imprimir, reabrir por papel administrativo | `atendimento`; não confundir com permissão `agenda`; ausência de vínculo merece revisão dos caminhos de criação |
| `/profissionais` | `D/profissionais`, `catalog-panels.tsx` (`TeamEditor`), `MemberAccessSheet` | Quem atende, especialidade textual (`role`), serviços, ativo, vínculo opcional com login | `catalogo` + services/bookings; não é sinônimo de Equipe; criação de login continua sob `equipe` |
| `/disponibilidade` | `D/disponibilidade`, `BusinessHours`, `ExceptionsManager` | Janela da casa, herança/horários por profissional, exceções/dias especiais, fuso | `catalogo` + services/bookings; regra de reserva fica em Configurações |
| `/clientes` + ficha 360 | `D/clientes`, `ClientProfileDrawer`, `NewClientSheet`, `ImportClientsSheet`, `/api/people360`, `/api/contacts` | Busca, cadastro, filtros, identidade/contato, responsável, histórico, notas, tarefas, agendamentos, conversas e oportunidades; importação e exportação com gates próprios | `clientes`; 360 não se reduz à agenda própria. Exportação completa tem restrições adicionais; não tratar todo export como livre |
| `/funil` | `D/funil`, `EsteiraView`, `PipelineStagesPanel`, `/api/leads`, `/api/pipeline` | Oportunidades por etapa, responsável/prioridade/notas/histórico e conversão em agendamento | `leads`; etapa não é estado clínico nem status de agenda |
| `/conversas` | `D/conversas`, `/api/conversations` | Inbox, seleção de conversa, busca `q`, filtro `canal`, histórico, ações de atendimento e composição conforme canal/estado | `whatsapp` inclusive para inbox Instagram; conexão pertence a Canais; sem teste de transporte externo |
| `/tarefas` | `TasksView`, `TaskPanel`, `/api/tasks` | Criar tarefa manual/retorno, responsável/prazo, concluir e histórico; tarefas também vêm de automações | Qualquer uma: `clientes`, `agenda`, `leads`, `config`; escopo é unidade, não somente tarefas próprias |
| `/servicos` | `D/servicos`, `ServiceForm`, `CatalogCrossLinks` | Serviço, categoria, duração/preço, profissionais elegíveis, disponibilidade de reserva e questões | `catalogo` + services/bookings; não conceder edição à secretaria só porque ela agenda |
| `/produtos` | `D/produtos`, `ImageUpload`, `showcase.ts` | Vitrine opcional; foto/preço/ativo; interesse via contato, não checkout de novos negócios | `catalogo` + products/orders conforme catálogo/gate; preservar supressão explícita `productsOff` |
| `/pedidos` | `D/pedidos`, `/api/orders` | Histórico e atualização de pedidos legados | `pedidos` + modo `orders`; não remover nem promover na nova comunicação para clínicas |

### 4.2 Automação, gestão, configuração e editor

| Rota | Componentes/fontes | Capacidades verificadas | Gate / limite |
|---|---|---|---|
| `/agente` | `D/agente`, `lib/agent.ts`, `agent-flow.ts`, `/api/agent`, `/api/concierge` | Identidade, tom, objetivo, regras, conhecimento adicional, canais e prévia de saudação | `agente`; secretaria/atendente têm por padrão. Não é assistente clínico diagnóstico nem IA irrestrita |
| `/automacoes` | `AutomationsView`, `AiAutomations`, `lib/automation/*`, `lib/ai/*` | Lista, modelos, editor de regra/grafo, condições, espera, ações e proposta por linguagem natural/revisão | `config`; planner atual determinístico; aprovação/publicação humanas. Não anunciar LLM/integradores homologados por inferência |
| `/execucoes` | `RunsView`, `RunsPanel` | Histórico de execuções, estados/erros e inspeção | `config`; `sidebar:false`, acesso contextual; não deixar sem porta no novo menu |
| `/campanhas` | `D/campanhas`, `lib/campaigns.ts`, `/api/campaigns` | Público opt-in, segmento, rascunho/pronta/envio/histórico, contadores e falhas | `campanhas`; enviar depende de `whatsapp.canSend`. Não foi enviado nada; retomada WhatsApp fora do plano |
| `/resultados` | `D/resultados`, `results-view`, `lib/insights.ts`, `revenue.ts` | Período/comparação, previsto/realizado segundo regras existentes, serviço/profissional/origem e funil público | `financeiro`; não é ERP, DRE ou pagamento conciliado |
| `/organizacao` | `D/organizacao`, `lib/organization.ts`, `/api/organizations`, `/api/results` | Unidades, seletor, consolidado, criação/duplicação conforme acesso | Catálogo exige `config`, dispensa `b`; `organization`, `period`, `from`, `to`, `add`. API de resultados filtra unidades com `financeiro`; API de organizações tem regra diferente (§6) |
| `/equipe` | `D/equipe`, `MemberAccessSheet`, `/api/team` | Login, papel, overrides, ativo, vínculo com profissional, associação a usuário existente | `equipe`; não promove a Master; `member` e `professionalId` em deep links |
| `/recursos` | `D/recursos`, `useBusinessId`, `/api/businesses/[id]/features` | Ativar/ocultar módulos, estados de unidade/rede/403/404, atualização do shell | `config`; não destrói dados ao desligar |
| `/configuracoes` | `D/configuracoes`, `ImageUpload` | Abas `negocio` e `agenda`: dados/identidade e regras de reserva | `config`; tabs antigas de canais redirecionam; aparência do painel não é mais customização ativa apesar de descrição residual no catálogo |
| `/canais` | `D/canais`, `WhatsappChannelPanel`, `InstagramChannelPanel`, `CanaisIntegracoesView`, `IntegracoesView` | Abas canais/fontes/integrações, status/configuração e ferramentas técnicas | `config`; inbox tem outro gate. Preservar PR #32; presença de código não prova homologação/configuração externa |
| `/pagina` | `D/pagina`, `BLOCK_DEFS`, `ThemeEditor`, `PagePreview`, editores de blocos | Estrutura, Navegação, Visual, Publicar; blocos, módulos, conteúdo, avaliações/Google opcional, tema, slug, QR | `pagina` na navegação/PUT. GET só exige acesso à unidade. Contrato de persistência detalhado no §7 |

### 4.3 Entrada, público e plataforma

| Rota/superfície | Fonte | O que existe / papel |
|---|---|---|
| `/` | `src/app/page.tsx` | Landing com features, modelos, FAQ e CTAs login/cadastro/demos. Texto amplo, barbearia e promessas comerciais; sem comprovação de pricing/homologação nesta auditoria |
| `/login` | `(auth)/layout.tsx`, `(auth)/login/page.tsx` | E-mail/senha, recuperação, sessão expirada; valida `/me`, Master vai a `/master`. Sessão expirada promete continuar, mas não preserva `returnTo` no código lido |
| `/register` | `(auth)/register/page.tsx` | Nome/e-mail/senha, sessão, redireciona a onboarding. Sem verificação visual nem envio de e-mail real |
| `/recuperar` | `src/app/recuperar/page.tsx` | `kind=user|customer`, token opcional, pedir link/redefinir; distingue serviço de e-mail indisponível. Não solicitar/resetar conta real |
| `/onboarding` | `onboarding/page.tsx`, `lib/onboarding.ts` | Nome, WhatsApp opcional e modelo agenda/produtos/ambos, rascunho local; cria negócio e direciona ao painel. Não configurar canal é diferente de informar telefone |
| `/[slug]` | `[slug]/page.tsx`, `public.ts`, `ThemeStyle`, `public/menu.tsx`, `BottomBar` | Apresentação, serviços, equipe, galeria, destaques, avaliações, FAQ, mapa e blocos adicionais, ocultando diversos vazios. Tema da clínica. Conta/autenticação/booking em sheets, não rotas próprias |
| Conta pública (sheet) | `public/customer.tsx`, `public/menu.tsx`, `customer-account.ts` | Login/cadastro e próprios agendamentos, remarcar/cancelar; pedidos somente no legado. Identidade de consumidor distinta de usuário da clínica |
| `/agendar` | `agendar/page.tsx`, `AgendarFlow.tsx`, `lib/agendar.ts` | Fluxo autônomo guest ou sessão de consumidor. `businessId|b|slug`, `serviceId|s`, `date`, `leadId`, `embed`; profissional é declarado como query mas não encaminhado à UI |
| `/widget/booking.js` | `src/app/widget/booking.js/route.ts` | Script que incorpora `/agendar`; endpoint, não tela nem item de menu |
| `/master` | `master/page.tsx`, `master/layout.tsx` | Visão da plataforma, navegação independente, exige identidade Master |
| `/master/organizacoes`, `/master/organizacoes/[id]` | `master/organizacoes/**/page.tsx` | Lista e detalhe da organização na plataforma |
| `/master/unidades`, `/master/unidades/[id]` | `master/unidades/**/page.tsx` | Lista/detalhe da unidade; ferramentas de suporte/canais existentes, não operadas nesta sessão |
| `/master/usuarios`, `/master/masters` | respectivos `master/*/page.tsx` | Usuários e identidades privilegiadas da plataforma, não Equipe de clínica |
| `/master/atividade`, `/master/suporte` | respectivos `master/*/page.tsx` | Auditoria e suporte com sessão/motivo/modo/expiração; suporte view bloqueia escrita no guard |
| `/admin`, `/admin/auditoria`, `/admin/empresas/[id]` | `admin/layout.tsx` e três páginas | Layout legado redireciona no cliente a `/master`, `/master/atividade`, `/master/unidades/[id]`. Não é administração da clínica |

### 4.4 Famílias de APIs que sustentam as telas

Mapa funcional (não auditoria exaustiva de cada handler): auth (`/api/auth/*`) e customer (`/api/customer/*`); contexto (`businesses`, `organizations`, `team`, `catalog/get`); operação (`bookings`, `queue`, `encounters`, `contacts`, `people360`, `leads`, `pipeline`, `tasks`, `conversations`); presença (`pages`, `reviews`, `upload`, `qr`, `events`); indicadores (`overview`, `analytics`, `results`); automação (`agent`, `concierge`, `automations`, `ai/automations`, `campaigns`); legado (`orders`, `checkout-info`); plataforma (`master/*`, `admin/*`); integrações (`external/*`, `integrations/*`, `whatsapp/*`, `instagram/*`, `cron/*`). Estas últimas foram inventariadas, não conectadas nem exercitadas externamente.

## 5. Matriz real de papéis

### 5.1 Padrões da unidade (antes de overrides)

`S` = concede a permissão base; `—` = não concede. Modos/recursos e readOnly ainda se aplicam. Esta tabela **não cria novos papéis** nem autoriza mudanças.

| Permissão | OWNER | ADMIN | SECRETARIA | ATENDENTE | VENDEDOR | PROFISSIONAL | VIEWER |
|---|---|---|---|---|---|---|---|
| dashboard | S | S | S | S | S | S | — |
| agenda | S | S | S | S | — | S | — |
| clientes | S | S | S | S | S | S | — |
| leads | S | S | S | — | S | — | — |
| pedidos | S | S | S | — | — | — | — |
| catalogo | S | S | — | — | — | — | — |
| pagina | S | S | — | — | — | — | — |
| agente | S | S | S | S | — | — | — |
| whatsapp (inbox) | S | S | S | S | S | — | — |
| campanhas | S | S | — | — | S | — | — |
| equipe | S | S | — | — | — | — | — |
| config | S | S | — | — | — | — | — |
| financeiro | S | S | — | — | — | — | — |
| admin | S | — | — | — | — | — | — |
| atendimento | S | S | — | — | — | S | — |

Fontes: `src/lib/permissions.ts:18–128`, `access-core.ts` e `access.ts`. `admin` não concede Master e não é usado como atalho para a área de plataforma.

### 5.2 Consequências por jornada e exceções importantes

- **Secretaria:** agenda/fila, clientes, funil, conversas, tarefas, assistente e pedidos se o legado existir. Não edita serviços/horários/equipe/página/regras nem escreve registro de atendimento por padrão. O plano não concede estas permissões para facilitar a UI.
- **Profissional:** própria agenda quando `Professional.userId` ativo está vinculado à unidade; sem vínculo a agenda vem vazia com sentinela `__nenhum__`. Pode registrar/finalizar atendimento no escopo existente; só OWNER/ADMIN/MASTER reabrem finalizado. **Clientes/360 é da unidade**, inclusive histórico de reservas de outros profissionais (H). Tarefas não são privadas por vínculo.
- **Vínculo não é exclusivo do papel PROFISSIONAL:** secretaria/atendente/vendedor com vínculo também recebem recorte de agenda; OWNER/ADMIN/MASTER não são reduzidos (`BROAD_ACCESS_ROLES`).
- **Fila não é igual à agenda:** `queue.canAccess` admite entradas sem profissional; lista de profissionais e resumo da resposta não são filtrados pelo mesmo recorte. Não prometer “só meus dados” em todo o produto.
- **Admin da unidade ≠ admin da organização:** o primeiro não ganha unidades irmãs automaticamente. Admin/owner de organização recebe o alcance estabelecido em `organizationRoleIn`; consolidado de resultados inclui apenas unidades acessíveis com `financeiro`. H confirmou admin local limitado a uma das duas unidades.
- **VIEWER:** zero permissões padrão, apesar do hint “Somente leitura do resumo”. Overrides podem abrir leitura; `requireBusiness` bloqueia métodos de escrita para `readOnly`. Não implementar “resumo liberado” por conta do nome.
- **Overrides:** `permissionsFor` aplica booleanos individuais; OWNER mantém todos. Renderizar ações usando payload efetivo de `/api/auth/me`, não comparações simplificadas de nome do papel.
- **Master:** identidade de plataforma, sem acesso tenant automático; exige sessão válida de suporte para unidade, com modo view/admin. Não misturar menu Master com Gestão da clínica.
- **Consumidor/visitante:** somente catálogo publicado/dados públicos e conta própria; guest pode reservar em `/agendar`; registro interno não equivale a conta pública. Responsável/tutor é campo cadastral, não cadastro de pet.

### 5.3 Descompassos de acesso: decidir antes de ampliar interfaces

1. `/api/pages GET` usa `requireBusiness(req, businessId)` sem `pagina`; retorna `business` e `page` integrais. Secretaria recebeu 200 na fixture. O PUT exige `pagina`. **P1 de revisão de segurança/DTO**, potencial de dados administrativos além da necessidade. Nenhum segredo real foi carregado para verificar isso.
2. `/api/organizations GET` usa `requireUser` + unidades acessíveis, mas agrega `predictedRevenue` sem `financeiro`. Secretaria recebeu número; `/api/results` para a mesma secretaria retornou 403. **P1 confirmado intratenant**, não corrigir mudando menu ou concedendo financeiro.
3. `/api/people360` exige `clientes`, agrega reservas/conversas/oportunidades/tarefas da unidade; não há filtro `professionalScope` no agregado. **Contrato amplo confirmado**, requer validação do proprietário para contexto clínico/LGPD antes de prometer privacidade entre profissionais. Não tratar automaticamente como bug nem reduzir acesso nesta rodada.
4. Criação de fila/registro quando profissional está sem vínculo trata a sentinela como `''` em alguns caminhos. A agenda sem vínculo foi testada; **os caminhos de criação não foram testados de forma adversarial**. Revisão focada futura, sem afirmar que a sentinela protege todo endpoint.

## 6. Problemas priorizados e evidências

Prioridades: **P0** bloqueia implementação/lançamento por risco crítico demonstrado; **P1** alto impacto ou contrato a resolver; **P2** melhoria importante; **P3** refinamento. Não há P0 de incidente em produção demonstrado nesta auditoria. Gates do plano impedem transformar lacunas conhecidas em promessas.

| ID / prioridade | Evidência C/H/T (sem screenshot) | Problema e impacto | Encaminhamento |
|---|---|---|---|
| A01 · P1 | `panel.ts` (`PANEL_SECTIONS`, `PANEL_ROUTES`), `DashboardShell.tsx:577–595` | Lista única extensa, oito grupos, operação/configuração concorrentes. Carga cognitiva é hipótese a medir, estrutura é fato | D1: dois níveis derivados do catálogo, sem perder portas |
| A02 · P1 | `DashboardShell.tsx:513–531,660–667`, dashboard `page.tsx:228–248` | Logo 48×48/84px público, `object-cover`, borda/raio/sombra; identidade repetida no dashboard | D1: logo livre/object-contain; nome uma vez no shell; D3 público |
| A03 · P1 | `DashboardShell.tsx:396–402` | `switchBiz` reconstrói somente `pathname?b=id`, descartando tab/data/period/q. Deep links perdem contexto | D1: política explícita de query + invalidação de IDs dependentes, teste |
| A04 · P1 | `globals.css:29–200`, `panel.ts:132–148`, `ui.tsx:326–337` | Neutros frios, acentos teal/lilás/âmbar por seção; PageHeader com gradiente azul/lilás e sombra | D1: neutro quente + azul moderado, sem cor decorativa por área |
| A05 · P1 | `globals.css:48–53,192–200`; cálculo sRGB nesta sessão | `text-faint #9099b3`/branco **2,84:1**, nav-muted `#79829c` **3,83:1**, text-soft `#7680a0` **3,91:1**: insuficientes para texto normal AA. Ocorrência real depende do fundo/tamanho renderizado | D1 tokens; verificação browser ainda obrigatória |
| A06 · P1 | `ui.tsx:356–395,489–514`; busca de `prefers-reduced-motion` em src sem resultado | Tabs muda seleção sem mover foco/roving tabIndex; Drawer tem aria-modal mas não trap/retorno/Escape; smooth scroll e animações sem redução global | D1 navegação/primitives; migração de sheets restantes em D2/D3 |
| A07 · P2 | `ui.tsx:82–95`, editor `pagina/page.tsx:233–241`, textos 10–11px | IconButton 32/36px; setas de reordenação muito pequenas pelo CSS. Legibilidade/toque podem falhar | D1 alvo 44px em controles primários; D3 reordenação acessível |
| A08 · P1 | dashboard `page.tsx:245–250`, `TasksView.tsx:61–65`, `agente/page.tsx:193` | Atalhos Editar página/Automações/Canais aparecem sem gate equivalente ao destino; secretaria pode chegar a 403 legítimo | D1 header do dashboard; D2 demais atalhos por permissão, sem ampliar papel |
| A09 · P1 | `pagina/page.tsx:65–99`, `/api/pages:63–161`, `lib/public.ts`; H salvar/publicar | Sem snapshot publicado separado. Salvar altera o ar; “Rascunho” descreve `published=false`, não uma revisão paralela | D3 gate editorial; proibir autosave indiscriminado |
| A10 · P1 | `pagina/page.tsx:220–333,1090–1122` | Estrutura edita inline; preview real somente em Visual, manualmente atualizado. Preview usa cookie do owner; Bearer não segue sozinho no iframe | D3 preview lateral/focal com contrato autenticado explícito; testar cookies bloqueados |
| A11 · P2 | `pagina/page.tsx:233–241,277`, `updateBlocks`, `save` | Reordena por botões (mouse/teclado básico), não drag; várias ações salvam imediatamente; sem revisão otimista de Page. Respostas fora de ordem são risco não reproduzido | D3 serializar saves/versionamento só em PR contratual aprovada; anunciar status honesto |
| A12 · P1 | `public/widgets2.tsx:150–169`, `AgendarFlow.tsx`, `agendar/page.tsx`; H guest | Página usa auth sheet; autônomo usa guest. Duas experiências e risco de pedir identidade novamente ao alternar fluxo | D3 explicitar e harmonizar sem duplicar motor; preservar serviço e identidade |
| A13 · P2 | `agendar/page.tsx` SearchParams/render, `AgendarFlow`, `widgets2.tsx` | `professionalId/p` declarados, profissionais recebidos mas sem escolha ativa na UI lida. README promete seleção | D3 não anunciar escolha; decisão funcional separada se requerida |
| A14 · P2 | `[slug]/page.tsx:130,288–295,619–621`, `BottomBar.tsx` | Público limitado a `max-w-md` no desktop; logo circular cortado. Localização exige `mapsUrl`, mesmo tendo endereço. Barra inferior já centraliza CTA e há padding/safe-area | D3 expandir desktop e logo; conservar solução de CTA único; sobreposição não constatada visualmente |
| A15 · P1 | `src/app/page.tsx:31–41,98–118,198–234` | Posicionamento genérico/barbearia, “grátis”, condições especiais e “leva um minuto”; benefício operacional de clínica pouco priorizado | D4 texto clínico e demo sintética; oferta só após confirmação, não inventar preço/integração |
| A16 · P1 | `(auth)/layout.tsx`, login/register, `recuperar/page.tsx` | Identidade escura/verde divergente do painel. Login sem breve contexto do produto; recuperação replica estilos | D4 formulário prioritário, claro e consistente; preservar auth |
| A17 · P1 | páginas/organizações/360 APIs; §5.3; H | Gates/dados não correspondem inteiramente às expectativas dos papéis | Revisão de acesso separada, bloqueia promessas de privacidade, não D1 visual |
| A18 · P2 | `campanhas/page.tsx:63–91`, `disponibilidade/page.tsx:55–59` | Campanhas ignora estado `failed` no render inicial e pode ficar em skeleton em erro não-403; disponibilidade marca carregado após falha sem exibir causa | D2 estados erro/retry; só leitura, sem fault injection em browser |
| A19 · P2 | `types.ts:823–851`, `encounters.ts:49–58` | Perfil humano/responsável e registro genérico, sem entidade pet/espécie/tutor multivínculo ou prontuário veterinário | D2 linguagem cuidadosa; descoberta pet fora de D1–D4 funcional |
| A20 · P2 | `permissions.ts` VIEWER, `panel.ts` config description, README/arquitetura | Rótulos/docs prometem capacidades diferentes do código | Atualizar microcopy por etapa; não alterar autorização para “fazer caber” descrição |
| A21 · P3 | Log do Next local ao compilar `/`, `/[slug]` e `/agendar`; export de metadata | Aviso de `themeColor` em metadata, que Next orienta mover para export de viewport | Revisar no recorte público/landing; não corrigido nem tratado como falha funcional |

**Pontos positivos a preservar:** catálogo central; autorização de API; serviço pré-selecionado no sheet; identidade de consumidor reutilizada; múltiplas seções vazias já ocultadas; CTA persistente centralizado; fila avulsa não fabrica booking; reabertura/versionamento de registro; cliente deduplicado por identidade; opt-in nas campanhas; estados de Recursos e 401×403 separados; atualização do shell sem F5.

## 7. Editor: persistência e publicação auditadas

Fluxo real:

```text
Estado React local (bloco/tema/menu)
  ├─ salvar bloco/visual/menu → PUT /api/pages
  ├─ reordenar/ativar certos blocos → PUT imediato
  └─ publicar/despublicar → altera Business.published
                         ↓
               mesma Page + mesmo Business
                         ↓
        /[slug] lê os dados atuais em getPublicData
```

- `Page` possui blocos/tema/preset/updatedAt; **não foi encontrada estrutura PageDraft/PagePublished**.
- PUT pode fazer escritas separadas de slug, published, nav/about e theme/blocks. Resposta relê o banco e confirma estado canônico (bom); isso não é snapshot editorial nem detecção de versão concorrente.
- Features de conteúdo podem ser ativadas junto ao bloco (`featuresForActivatedBlocks`); preview não pode chamar PUT só para “ver como fica”.
- Conteúdo de blocos, catálogo de serviços/profissionais, dados da empresa e reviews têm fontes diferentes. Um futuro “publicar tudo” teria que definir cada domínio; versionar apenas Page não congelaria preços/logo/reviews.
- Página não publicada: preview atual reconhece **owner por cookie**, não qualquer pessoa com `pagina`, nem somente Bearer. `PagePreview` carrega `/${slug}` em iframe. Este é risco de experiência, não autorização para tornar o rascunho público.
- H confirmou: publicar → salvar bloco de texto sem enviar `published` → marcador já aparece no HTML público anônimo. **Autosave do editor público não será proposto como rascunho isolado.** Autosave de `EncounterSheet` é outro contrato e deve continuar separado.

Decisão recomendada para primeiro D3: manter salvamento explícito, avisar “Esta página está publicada. Salvar atualiza o site.”, prévia de alterações locais sem gravar; revisão publicada separada somente em PR de contrato expressamente aprovada.

## 8. Jornadas: situação, oportunidades e cobertura

| Jornada | Caminho real | Evidência obtida | Oportunidade / verificação pendente |
|---|---|---|---|
| Secretaria encontra cliente e prepara agendamento | Clientes → busca/360 → Novo agendamento → catálogo/slots → POST asOwner | C + H: encontrou pessoa sintética e criou reserva pela API como SECRETARIA | Priorizar busca/novo agendamento, identidade já preenchida, resumo de serviço/data/profissional. Interação do drawer e número de cliques ainda não medidos |
| Chegada/fila até atendimento | Agenda → fila → buscar/adicionar → chamar → iniciar → EncounterSheet → finalizar/encerrar fila | C + H: fila avulsa percorreu estados; secretaria recebeu 403 no registro; profissional finalizou e encerrou fila | Separar balcão e documentação, próximo passo claro. **Check-in de booking até fila e impressão não foram exercitados** |
| Profissional localiza próxima ação | Início/agenda própria → próximo → atendimento → orientação/retorno | C + H: agenda filtrada, sem vínculo vazia, finalização autorizada | “Meu dia”, próximo e pendências existentes; não expor gestão por atalho. 360 mais amplo deve ser explicado e revisado, não silenciosamente reduzido |
| Administrador acompanha unidades | Organização → período/consolidado → unidade → Resultados | C + H: owner vê duas unidades; admin de uma unidade recebe resultados de apenas uma | Distinguir escopo organização/unidade, previsão x realizado, período sempre visível; desktop/mobile pendentes |
| Dono edita e publica página | Página → Estrutura/Visual/Navegação → salvar → publicar → público | C + H: página fechada para visitante antes de publicar; salvar após publicar tem efeito imediato | Edição focal, prévia de alteração local, estado de salvamento/publicação sem ambiguidade; cookie/Bearer/iframe pendentes |
| Visitante escolhe serviço e agenda | Público → BookingIsland com serviço; alternativo `/agendar?slug=&serviceId=` | C + H: guest reserva; SSR de `/agendar` contém catálogo correto. Não houve clique real no serviço | Manter escolha até confirmação, identidade conhecida, erro 409 recuperável; harmonização auth/guest exige decisão e teste real |

### Clínica médica, odontológica, estética e veterinária

As três primeiras compartilham agenda, clientes, fila, orientação e retorno; isso não comprova prontuário especializado, assinatura digital, receituário, convênios/faturamento ou odontograma. Veterinária pode usar contato do tutor e informação administrativa existente, mas **não há modelo de pet implementado identificado**. Não reutilizar CPF/nascimento humano como se fossem dados do animal. Rótulos específicos e relação tutor/pet necessitam descoberta e contrato próprios; fora do redesign puramente visual.

## 9. Verificações executadas e limites

### 9.1 Segurança do ambiente local

- `npm ci --ignore-scripts --no-audit --no-fund` instalado para execução local; lockfile não alterado.
- Nenhum `.env` real estava presente; somente `.env.example`. Valores de credenciais não foram lidos/exibidos.
- Servidor executado com ambiente limpo, sem herdar `DATABASE_URL`, `POSTGRES_URL`, tokens GitHub, SMTP, Blob, Meta ou Google:

```bash
env -i PATH="$PATH" HOME="$HOME" NODE_ENV=development \
  NEXT_TELEMETRY_DISABLED=1 \
  INSTALINK_DB_FILE=/home/user/instalink/.cache/d0/audit.db.json \
  AUTOMATION_INLINE=0 npm run dev
```

- Bind `0.0.0.0:3000`; cliente de teste server-side usa loopback local. Nenhum frontend foi modificado para chamar localhost.
- Banco nasceu vazio. Fixture criada pelas APIs: duas unidades de uma organização; terceira unidade de outro dono; secretaria, admin local, dois perfis profissionais (um sem vínculo), viewer; dois profissionais de catálogo, um serviço, contatos/reservas/fila/registro/texto sintéticos. E-mails em `audit.invalid`; telefones somente sintéticos, sem envio ou canal conectado.
- **Não foi usado `npm run seed`**: o seed tem caminho padrão de arquivo e modo Postgres; não era necessário nem adequado reutilizar demos nesta auditoria.
- Scripts e banco de teste são temporários, não entregáveis/versionados; servidor interrompido após as verificações. Nenhum cadastro real tocado.

### 9.2 Testes direcionados — uma execução

```bash
env -i PATH="$PATH" HOME="$HOME" \
  INSTALINK_DB_FILE=/home/user/instalink/.cache/d0/unit.db.json AUTOMATION_INLINE=0 \
  npm test -- \
  src/lib/__tests__/panel.test.ts \
  src/lib/__tests__/permissions.test.ts \
  src/lib/__tests__/professional-access.test.ts \
  src/lib/__tests__/tenant-isolation.test.ts \
  src/lib/__tests__/editor-sync.test.ts \
  src/lib/__tests__/a2-b2-agendar-guest.test.ts \
  src/lib/__tests__/a34-queue.test.ts \
  src/lib/__tests__/a34-encounter.test.ts \
  src/lib/__tests__/business-context.test.ts
```

Resultado: **9 arquivos, 203 testes passaram** (73+9+13+23+19+14+14+30+8), duração reportada 2,66s. Aviso não bloqueante de configuração ESM/CommonJS do Vite. Não rodados suíte inteira, build, typecheck ou smokes gerais: não havia alteração de código a validar e a seleção bastava para os contratos examinados. Sucesso desta seleção não certifica segurança global.

### 9.3 Sondagem HTTP — 20 verificações correspondem ao comportamento observado

**“Observação confirmada” não significa que o comportamento seja desejável.**

| # | Verificação | Resultado |
|---|---|---|
| 1 | Secretaria busca pessoa em people360 | Encontrada |
| 2 | Secretaria cria booking asOwner em slot disponível | bookingId retornado |
| 3 | Fila avulsa waiting → called → in_service | Transições aceitas |
| 4 | Secretaria padrão tenta criar encounter | 403 |
| 5 | Profissional cria e finaliza encounter versionado | finalized; fila depois encerrada |
| 6 | Profissional lê agenda com dois profissionais no tenant | Só uma reserva, a própria |
| 7 | Profissional sem vínculo lê agenda | Array vazio |
| 8 | Profissional lê 360 | Inclui reserva do segundo profissional da unidade; observação confirmada |
| 9 | Dono lê organizations | Duas unidades próprias |
| 10 | Admin local pede results por organização | Só unidade autorizada |
| 11 | Dono estrangeiro tenta people360 do outro tenant | 403 |
| 12 | Secretaria pede results da unidade | 403 |
| 13 | Viewer padrão pede agenda | 403 |
| 14 | Visitante abre página ainda não publicada | Mensagem de não publicada |
| 15 | Dono salva texto em página publicada sem republicar | Texto já aparece no HTML anônimo |
| 16 | Secretaria pede GET pages sem permissão pagina | 200; observação confirmada |
| 17 | Secretaria pede organizations sem financeiro | Campo numérico predictedRevenue; observação confirmada |
| 18 | Visitante POST booking com nome/telefone, sem conta | Reserva criada |
| 19 | GET `/agendar?slug=...&serviceId=...` | Catálogo correto no SSR, sem nome do tenant estrangeiro; não teste de seleção visual |
| 20 | GET `/horarios?b=...&tab=exemplo` | 308 preserva parâmetros |

Receita para reproduzir a sondagem: ambiente acima → POST auth/register para dois donos → POST businesses (duas unidades com organizationId comum e uma externa) → POST catalog (dois profissionais, serviço elegível, janela 08–18 nos sete dias) → POST team com os papéis da tabela → login por papel → POST contacts pela secretaria → GET slots-admin e duas reservas em horários futuros para profissionais diferentes → fila avulsa, transições e encounter com `expectedVersion` → leituras negativas/positivas da tabela → PUT pages/público anônimo → guest em slot restante → redirect legado. Sempre começar em **outro arquivo JSON vazio**, nunca apontar a banco existente. Datas de booking: dia seguinte no ensaio; fila: dia corrente. Não colocar sessões ou senhas nos logs.

### 9.4 O que continua sem validação

Layout/overflow em 320–1920px; zoom 200%; navegação com teclado/leitor de tela; contraste de composições renderizadas; ordenação real por mouse; experiência de erro/retry/offline em browser; PDF/impressão; comportamento de cookies em iframe; agenda densa; HTTP de todas as APIs; toda matriz adversarial de autorização; banco Postgres/concorrência multi-instância; integrações externas e recuperação por e-mail. Estes limites são itens de aceite das próximas PRs, não testes aprovados por ausência de falha.

## 10. Decisões propostas para revisão do proprietário

1. Aprovar os sete grupos, com **Serviços/Profissionais/Disponibilidade em Gestão** e atalhos autorizados em Atendimento, para não confundir operação com edição de catálogo.
2. Aprovar D1 mantendo largura lateral total de 248px, inclusive com dois níveis; mobile com um único cabeçalho e menu em drawer.
3. Aprovar “Salvar atualiza o site publicado”, sem novo draft/autosave na primeira D3; versionamento editorial fica separado.
4. Validar a intenção de privacidade intratenant do 360/organizações/páginas com responsáveis clínicos. Correção de acesso exige PR própria aprovada; nenhuma decisão implícita neste documento.
5. Confirmar oferta comercial antes de publicar “grátis”/preço/condições. Até lá, CTAs neutros e somente capacidades reais, sem prometer WhatsApp ativo.
6. Veterinária entra como público-alvo operacional; entidade pet/prontuário não entra como feature já existente.

**Parada D0:** nenhum D1 iniciado. Próximo passo é revisar [o plano executável e a especificação visual](DESIGN-360-PLAN.md).
