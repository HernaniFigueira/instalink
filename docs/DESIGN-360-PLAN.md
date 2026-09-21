# D0 — Plano executável e especificação visual do redesign

**Data:** 20/09/2026 · **Base:** `ebc7130805057135eae36c71c07313cc0e5710e3` · **Branch:** `arena/01a0bfbf-instalink`

**Status: proposta para revisão. Nenhuma implementação D1 autorizada/iniciada automaticamente.**

Leia primeiro [DESIGN-360-AUDIT.md](DESIGN-360-AUDIT.md), com inventário, matriz real de papéis, evidências e limites. Não houve browser funcional nem screenshot nesta sessão. As especificações abaixo são **propostas**, não telas implementadas nem aprovadas visualmente.

## 1. Objetivo e princípios não negociáveis

> **Sua clínica organizada, do primeiro contato ao próximo atendimento.**

- Recepção encontra pessoa, agenda, registra chegada, acompanha fila, conversas e pendências.
- Profissional identifica o próximo atendimento e o que precisa concluir dentro do alcance real da sua conta.
- Gestor entende unidade/organização, equipe e resultados com período e significado dos números explícitos.
- Dono organiza presença pública sem perder conteúdo nem confundir “salvar” e “publicar”.
- Visitante encontra serviço e disponibilidade, sem recomeçar escolhas nem redigitar identidade conhecida.
- Médica, odontológica, estética e veterinária: linguagem acolhedora, sem fingir prontuário especializado ou entidade pet existente.

### Restrições de entrega

1. Não renomear rotas para resolver rótulos. Não trocar framework, motor de agenda, sessão, schema, permissões ou integrações no D1.
2. Nenhuma remoção de demos, produtos, pedidos, orçamento legado, temas ou conteúdo. Reorganizar acesso não é desligar módulo.
3. WhatsApp pausado: não mexer em provider, onboarding, tokens, webhook ou capacidade de envio. Não prometer canal homologado só por existir código. A PR #32 é preservada; #31 não será reutilizada.
4. Tokens/temas públicos de clínicas não serão sobrescritos pela identidade da plataforma.
5. Menu usa permissões efetivas/módulos; esconder UI nunca substitui guard. Nenhuma persona cria novas concessões.
6. Tests visuais futuros precisam de browser real e dados sintéticos isolados. HTML 200, testes de fonte ou mockup não valem como aprovação visual.
7. Sessão permanece na branch acima. PRs pequenas são etapas de revisão/commits nesta mesma branch; não abrir outra branch nesta sessão. Havendo PR sequencial da branch após merge autorizado no futuro, atualizar a base antes do próximo recorte; **nenhum merge faz parte de D0**.

## 2. Modelo de informação e linguagem

| Conceito | Rótulo proposto | Não confundir com |
|---|---|---|
| Unidade ativa | Nome da unidade no seletor da identidade lateral | Organização inteira, usuário logado ou nome da plataforma |
| Dashboard | Visão geral | Painel Master |
| Operação diária | Atendimento | Registro de atendimento (documento com permissão própria) |
| Agenda | Agenda da unidade / Minha agenda segundo escopo real | Disponibilidade (configuração da oferta) |
| Fila | Fila de chegada | Funil comercial; não criar booking fictício para avulso |
| Histórico clínico/genérico existente | Registro do atendimento | Prontuário homologado ou acesso da secretaria |
| Quem realiza serviço | Profissionais | Equipe (login, papel e permissão) |
| Pessoa/contato | Clientes; contexto pode dizer paciente em microcopy futura validada | Conta pública obrigatória ou pet |
| Oportunidade | Funil | Situação da consulta/registro |
| Regra automática | Automação | Tarefa manual ou ação executada por IA sem revisão |
| Presença pública | Página da clínica | Site comercial InstaLink |
| Dinheiro | Receita prevista / realizado conforme contrato atual | Saldo bancário, recebimento confirmado, lucro ou DRE |

“Secretaria”, “profissional” e “gestor” são personas de jornada. A fonte técnica continua OWNER/ADMIN/SECRETARIA/ATENDENTE/VENDEDOR/PROFISSIONAL/VIEWER + overrides + vínculo, conforme auditoria §5.

## 3. Navegação atual → proposta, sem rotas órfãs

### 3.1 Organização atual

```text
Início          /dashboard
Operação        /agenda /profissionais /disponibilidade /conversas /agente /tarefas /pedidos*
Pessoas         /clientes /funil
Oferta          /servicos /produtos*
Crescimento     /campanhas /automacoes /canais
Resultados      /resultados /organizacao   (+ /execucoes, contextual)
Presença        /pagina
Administração   /equipe /recursos /configuracoes
```

`*` Dependente de módulo. Todos os itens também dependem de permissões.

### 3.2 Proposta: sete áreas, segundo nível contextual

```text
Visão geral        Resumo
Atendimento        Agenda · [Fila, a partir de D2] · Conversas · Tarefas · Pedidos*
Clientes           Cadastro e histórico · Funil
Página da clínica  Editor da página
Automação          Automações · Assistente · Campanhas · Execuções
Gestão             Resultados · Organização e unidades · Profissionais · Disponibilidade · Serviços · Produtos* · Equipe
Configurações      Dados e regras · Recursos · Canais e integrações
```

**Justificativas:** disponibilidade/profissionais/serviços são administração de capacidade/oferta, não gates de quem agenda. Permanecem acessíveis por atalhos autorizados a partir da agenda. Assistente configura comportamento e fica em Automação, sem retirar seu acesso atual da secretaria. Campanhas/Execuções entram junto ao que prepara e acompanha ações automáticas. “Gestão” tem segundo menu próprio, portanto não ocupa sete linhas adicionais no menu principal. Sugestão a validar com recepção e administrador, sem copiar marca/cores de CRM externo.

### 3.3 Mapa de todos os 22 destinos do painel

Permissões e requisitos de unidade/largura/módulo **continuam os do catálogo atual**. Reorganização não torna a rota acessível a novo papel.

| URL preservada | Área atual → nova | Segundo nível | Permissão/módulo relevante | Observação de destino |
|---|---|---|---|---|
| `/dashboard` | Início → Visão geral | Resumo | dashboard | Landing padrão só se permitida |
| `/agenda` | Operação → Atendimento | Agenda | agenda + bookings | Largura total, `data` preservado |
| `/conversas` | Operação → Atendimento | Conversas | whatsapp | Preservar `q`, `canal` e deep links existentes |
| `/tarefas` | Operação → Atendimento | Tarefas | clientes OU agenda OU leads OU config | Não requer config exclusivamente |
| `/pedidos` | Operação → Atendimento | Pedidos (legado) | pedidos + orders | Mostrar só quando autorizado/ativo, sem remover |
| `/clientes` | Pessoas → Clientes | Cadastro e histórico | clientes | Busca/360/importação/exportação preservados |
| `/funil` | Pessoas → Clientes | Funil | leads | Preservar fragmento de lead nos links existentes |
| `/pagina` | Presença → Página da clínica | Editor da página | pagina | Abas do editor ficam dentro da tela, não duplicadas em D1 |
| `/automacoes` | Crescimento → Automação | Automações | config | Modelos/propostas continuam internos |
| `/agente` | Operação → Automação | Assistente | agente | Permissão da secretaria mantida, sem obrigar config |
| `/campanhas` | Crescimento → Automação | Campanhas | campanhas | Não habilitar envio/canal |
| `/execucoes` | Resultados/contextual → Automação | Execuções | config | Explicitar segundo nível sem mudar guard; preservar acesso contextual anterior |
| `/resultados` | Resultados → Gestão | Resultados | financeiro | Preservar period/from/to |
| `/organizacao` | Resultados → Gestão | Organização e unidades | config no catálogo | `requiresBusiness:false`; preservar organization/add/período; não injetar b à força |
| `/profissionais` | Operação → Gestão | Profissionais | catalogo + services/bookings | Atalho da agenda somente autorizado |
| `/disponibilidade` | Operação → Gestão | Disponibilidade | catalogo + services/bookings | Horário da casa/profissional, não regras de reserva |
| `/servicos` | Oferta → Gestão | Serviços | catalogo + services/bookings | Preservar cadastro/IDs/categorias |
| `/produtos` | Oferta → Gestão | Produtos | catalogo + products/orders | Respeitar productsOff e gate real, não só legenda |
| `/equipe` | Administração → Gestão | Equipe | equipe | Preservar member/professionalId |
| `/recursos` | Administração → Configurações | Recursos | config | Toggle e evento il:business-refresh intactos |
| `/configuracoes` | Administração → Configurações | Dados e regras | config | tabs negocio/agenda; dados reais intactos |
| `/canais` | Crescimento → Configurações | Canais e integrações | config | tabs canais/fontes/integracoes; não mudar implementação de canais |

**Fila e registro:** D1 não inventa `/fila` ou link para query sem handler. Em D2, propor `/agenda?b=…&view=fila` como estado aditivo que abre a fila existente. `view=agenda|fila` será validado; URL antiga continua igual. Registro e 360 permanecem sheets/drawers contextuais; não adicionar rota de prontuário. Voltar/avançar e restaurar seleção precisam de testes antes da adoção desse novo estado.

### 3.4 Todas as rotas fora do painel

| URL | Destino proposto / preservação |
|---|---|
| `/` | Landing comercial, externa aos dois menus; CTA entrar/criar conta |
| `/login`, `/register`, `/recuperar` | Fluxos públicos de identidade da plataforma, fora do menu de clínica; `session`, `kind`, `token` preservados. Tokens de recuperação nunca em analytics/log/screenshot |
| `/onboarding` | Criação inicial de unidade/negócio, fora do workspace; manter redirect, rascunho local e dados existentes |
| `/[slug]` | Página pública da clínica; link “Ver página” no menu da conta/ação de editor, não cabeçalho repetido |
| `/agendar` | Agendamento público/embutido; manter businessId/b/slug, serviceId/s, date, leadId, embed; não anunciar professionalId/p como funcionando sem implementar o contrato |
| `/widget/booking.js` | Endpoint de embed preservado, sem item no menu |
| `/master` | Menu exclusivo da plataforma, sem entrada de Gestão para usuários comuns |
| `/master/organizacoes`, `/master/organizacoes/[id]` | Organização de plataforma: lista/detalhe, intactos |
| `/master/unidades`, `/master/unidades/[id]` | Unidades de plataforma: lista/detalhe, intactos |
| `/master/usuarios`, `/master/masters` | Administração de identidades da plataforma, intacta |
| `/master/atividade`, `/master/suporte` | Auditoria/suporte de plataforma, intactos; banners do suporte no painel não somem |
| `/admin` | Redirecionamento legado para `/master`, não reutilizar |
| `/admin/auditoria` | Redirecionamento legado para `/master/atividade` |
| `/admin/empresas/[id]` | Redirecionamento legado para `/master/unidades/[id]` |

### 3.5 Compatibilidade de links legados e estado

| Entrada existente | Destino mantido |
|---|---|
| `/horarios` | 308 `/disponibilidade` com query |
| `/whatsapp` | 308 `/conversas` com query, apesar da frente WhatsApp pausada |
| `/esteira` | 308 `/funil` com query |
| `/integracoes` | 308 `/canais?tab=integracoes`, mantendo demais parâmetros |
| `/clientes?view=esteira` | Compatibilidade client-side para Funil existente |
| `/configuracoes?tab=canais` / `?tab=integracoes` | Compatibilidade client-side para aba correspondente em `/canais` |

**Política de URL/estado para D1:**

- O menu não cria URLs limpas que apagam `b`. Construção central de href; rotas independentes de unidade respeitam `requiresBusiness:false`.
- Trocar apenas unidade na mesma tela parte de `URLSearchParams` atual: preserva `tab`, `data`, `period`, `from`, `to`, `canal`, `q` e demais parâmetros não dependentes de entidade. Refetch obrigatório, limpar dados antigos antes de apresentar nova unidade.
- IDs de entidade (`member`, `professionalId`, lead/booking em fragmentos ou queries) não são reutilizados cegamente em outra unidade. Revalidar no tenant destino; descartar se inválidos e informar “Seleção não disponível nesta unidade”. Isto é invalidação segura, não perda arbitrária de filtros.
- Filtros de agenda hoje em estado React (status/especialidade/profissional/view) **não são todos deep links existentes**. Não prometer persistência histórica que não existe. D1 não remonta a página ao expandir menus; profissional selecionado deve ser revalidado quando troca unidade. Serialização de novos filtros é D2, com contrato explícito.
- Navegar entre áreas não transfere `tab` sem significado para a nova rota; voltar pelo histórico restaura URL de origem. Preservar links existentes inclusive seus fragmentos; não inventar nova identidade de cliente.
- Área ativa deriva de `activePanelRoute`/ancestralidade. A rota negada mantém aviso 403/sessão, não redireciona para login; só 401 inicia login.
- Grupo aparece somente se houver destino autorizado. Clique inicial vai ao primeiro destino autorizado em ordem declarada; pode reaproveitar último destino da área **só após revalidar**. Não gravar conteúdo de pacientes em preferências de menu.
- Se não houver destino autorizado (VIEWER padrão, por exemplo), estado de acesso orientado; não conceder dashboard implicitamente.
- Busca continua **de navegação**, não de pacientes; `NavSearch` deriva do mesmo catálogo e inclui destinos contextuais permitidos.

## 4. Especificação visual da plataforma

### 4.1 Direção

Clara, sóbria e acolhedora. Branco quente, cinza levemente quente, grafite e azul moderado. Azul representa ação/seleção; verde, âmbar e vermelho representam estado real. Ícones neutros no menu; sem paleta por área. Bordas e espaçamento organizam informação; sombra só para elevação real. Não introduzir gradientes decorativos, glassmorphism, grandes cards vazios ou arco-íris em KPIs.

**Escopo CSS:** D1 introduz `.il-platform` no workspace e tokens sob esse escopo. Manter `:root` e a escala global `zinc` legada para superfícies ainda não migradas. Não alterar globalmente cores usadas por login/landing/público/Master e chamar isso de regressão aceitável. D4 aplica explicitamente o novo escopo à identidade pública da plataforma. `.il-page` e variáveis `--il-*` do tema da clínica continuam independentes. Overlays renderizados em portal no futuro devem receber o mesmo escopo explicitamente.

### 4.2 Tokens normativos propostos

Manter nomes semânticos consumidos pelo código, usando aliases quando necessário. Valores abaixo são ponto inicial especificado para D1; ajustes só com contraste e revisão visual registrados.

| Token | Valor proposto | Uso |
|---|---|---|
| `--bg` | `#F7F7F4` | Canvas quente, sem azul/lilás residual |
| `--surface` | `#FFFEFA` | Superfície principal |
| `--surface-2` | `#FFFFFF` | Inputs/menus/contraste pontual |
| `--surface-3` | `#F0F1EE` | Cabeçalho de tabela/inset |
| `--surface-hover` | `#ECEFED` | Hover neutro |
| `--text` / `--text-strong` | `#252A31` / `#191E25` | Conteúdo/hierarquia |
| `--text-muted` | `#5C626B` | Descrição, metadado |
| `--text-faint` / `--text-soft` | `#69717B` | Texto secundário ainda legível, não desabilitado |
| `--border` / `--border-soft` | `#DDE0DD` / `#E8EAE6` | Separadores decorativos, não única indicação de controle |
| `--border-strong` / `--border-2` | `#7C858F` / `#C4C9C8` | Limite de input necessário à identificação / separador intermediário |
| `--brand` | `#2459A6` | CTA primário, foco |
| `--brand-strong` | `#1C4786` | Hover/pressed |
| `--brand-soft` / `--brand-fg` | `#EDF3FB` / `#204D8B` | Seleção e badges informativos |
| `--action-contrast` | `#FFFFFF` | Texto do CTA |
| `--success-bg` / `--success-fg` | `#EAF5EE` / `#146344` | Concluído/confirmado quando semântica real |
| `--warning-bg` / `--warning-fg` | `#FFF4DD` / `#835000` | Aguardando, pendência |
| `--danger-bg` / `--danger-fg` | `#FCEEF0` / `#A62D38` | Falha/destrutivo |
| `--info-bg` / `--info-fg` | `#EDF3FB` / `#204D8B` | Informação, em curso |
| `--overlay` | `rgba(25,30,37,.36)` | Fundo de modal, nunca sobreposta duas vezes |
| `--focus-outline` | `2px solid #2459A6` + offset 2px | Foco inequívoco; não só brilho translúcido |

Cálculo de luminância sRGB efetuado em D0 (não teste visual): azul `#2459A6`/branco **6,87:1**; muted/surface **6,09:1**; faint/surface **4,90:1**; pares success **6,49:1**, warning **6,18:1**, danger **6,10:1**. Verificar todas as combinações usadas, inclusive hover/foco/seleção e temas públicos; não aprovar uma tela apenas por estes seis pares.

`--il-nav*` deve apontar para esses tokens dentro de `.il-platform`. Lilás/teal existentes ficam como compatibilidade para componentes ainda migrando, **não** como tema de navegação. Cores de status de agenda/funil preservam significado/rótulo, com migração central em `status.ts`/`booking-status.ts` somente quando necessária e sem mudar enum.

| Dimensão | Especificação |
|---|---|
| Tipografia | Inter já disponível; sem baixar nova fonte no D1. Título de tela 24/32 semibold, seção 18/26, corpo 14/22 (16/24 em formulários mobile), tabela densa 13/20, metadados mínimos 12/18. Não usar caixa alta em parágrafos |
| Espaçamento | 4, 8, 12, 16, 20, 24, 32, 40, 48px; layout com gap 16/24; evitar valores avulsos por tela |
| Raio | xs 4, sm 6, md 8, lg 12, xl 16; pill só badge/filtro quando útil; logo sem raio imposto |
| Borda | 1px; separador suave. Controle não identificável só por borda <3:1 exige token de limite apropriado |
| Sombra | Cards comuns sem sombra; menu/drawer `0 8px 24px rgba(25,30,37,.10)`; eliminar shadow-brand nos headers |
| Altura interativa | Botão/input padrão 44px; compacto desktop 36px apenas em toolbar densa com espaçamento adequado; mobile/coarse pointer ≥44×44px. Ícone visível 18–20px dentro do alvo |
| Movimento | Feedback 120–160ms, apenas opacity/transform discreto; sem scale de toda tela. `prefers-reduced-motion: reduce`: sem smooth scroll, pulse infinito ou transições decorativas |
| Camadas | conteúdo 0; header 20; dropdown 30; drawer/modal 50; toast 60. Sheets aninhados coordenados, não uma pilha de overlays |
| Formatos | Data/hora/fuso pelo contrato atual; preço/unidade monetária pelas funções existentes, sem formatação inventada no JSX |

### 4.3 Shell desktop e mobile — largura protegida

**Desktop ≥1024px: lateral total de 248px, não 248+200px.** Cabeçalho de identidade ocupa a largura útil da lateral; abaixo, dois níveis lado a lado (80px de áreas + 168px de contexto). Rótulos curtos em até duas linhas na coluna de áreas, tooltip e nome acessível completos. Se o teste real mostrar truncamento, ajustar proporção **dentro dos 248px**, não roubar largura da agenda.

```text
┌──────────── lateral 248 ────────────┬────────────────────────────────────┐
│       logo da clínica, contain     │ Agenda                + Agendamento│
│       nome / seletor único         │ data · visualização · filtros      │
│       buscar área       recolher   │                                    │
├── áreas 80 ──┬── contexto 168 ──────┤ grade / lista        fila opcional │
│ Visão geral  │ Agenda              │                                    │
│ Atendimento ●│ Conversas           │ SEM segundo header de logo/nome    │
│ Clientes     │ Tarefas             │                                    │
│ Página       │ Pedidos*            │                                    │
│ Automação    │                     │                                    │
│ Gestão       │                     │                                    │
│ Configurações│                     │                                    │
├──────────────┴─────────────────────┤                                    │
│ conta · papel · ações              │                                    │
└────────────────────────────────────┴────────────────────────────────────┘
```

- Estado recolhido 72px total; contexto abre em painel sobreposto com botão/nome, não só hover. Sem cortar o logo para “caber”: versão reduzida contain ou identidade textual acessível no seletor.
- Altura lateral: cabeçalho/conta estáveis, navegação com rolagem própria. Não esconder Equipe/Configurações fora do alcance em 1280×720.
- Conteúdo denso usa `width:'full'`; formulários seguem até 960px. Agenda mantém padding atual 8/12/16 e `min-width:0` no workspace.
- **Orçamento verificável:** em viewport 1366px, conteúdo de agenda pelo menos `1366−248−32 = 1086px` antes de fila; não inferior à base. Em 1280px: 1000px. Fila mantém contrato responsivo existente; segundo menu não vira terceira coluna da agenda. Tela cheia continua cobrindo navegação e Escape restaura.
- 768–1023px: modo compacto com menu em drawer, não duas laterais fixas. Conteúdo prioritário.
- <768px: único cabeçalho de até aproximadamente 56–64px, botão menu 44px e contexto da unidade. Segundo nível aparece **dentro do mesmo drawer**, com navegação hierárquica/voltar. Sem duas barras fixas empilhadas ou duas fileiras permanentes comprimindo calendário.
- Conteúdo mobile 16px de margem (agenda pode manter 8px); tabelas/grade rolam em seu container, não a página inteira. Safe-area respeitada. Botão principal não cobre campos.
- Foco ao abrir menu entra no drawer; Escape fecha; retorno ao acionador; ativo usa `aria-current`, texto/peso e indicador geométrico além de cor.

### 4.4 Identidade da clínica

Novo componente dedicado, **não reutilizar Avatar para marca**:

- Expanded header: caixa disponível de **216px de largura**, altura natural com limite inicial 64–80px; `width:100%; height:100%; object-fit:contain; object-position:left center` conforme caixa. Sem `overflow-hidden` que corte arte, círculo, moldura, fundo azul ou sombra.
- Área com `min-height` estável para evitar salto, mas não ampliar raster pequeno acima de qualidade razoável; testar logo horizontal 5:1, quadrado, vertical, transparente, branco, sem imagem e texto longo.
- Nome abaixo **uma vez**. Em múltiplas unidades, o próprio nome é o botão seletor; menu mostra organização/unidades acessíveis. Não repetir imediatamente nome em label+valor+H1.
- Contexto adjacente diz “Visão geral”, “Agenda”, “Clientes”… não repete marca/unidade como título de tela. Nome da unidade continua disponível em seletor acessível e contexto de exportação/ação sensível.
- Sem logo: nome em texto e placeholder neutro opcional, nunca inicial gigantesca em cartão colorido obrigatório.
- Logo branco/transparente sobre branco: não recolorir nem editar imagem real. Diagnosticar contraste e oferecer orientação para o proprietário fornecer variante; qualquer fundo de contraste opcional requer escolha explícita posterior.
- Borda/margem desenhada **dentro do arquivo original** permanece. Documentar essa limitação; não crop, retocar ou substituir arte de clínica sem autorização.
- Foto de pessoa ainda pode usar Avatar/crop; não aplicar a regra de marca indiscriminadamente a fotos clínicas/profissionais.

## 5. Componentes e estados de interação

| Componente | Contrato visual/funcional | Entrega |
|---|---|---|
| `ClinicIdentity` (novo) | Logo contain, nome/seletor integrado, sem duplicação, estados vazio/quebrado/carregando | D1 |
| `PanelNavigation` (novo) | Projeção do catálogo, áreas/contexto, ativo, recolhido, busca; permissões efetivas | D1 |
| `MobilePanelNavigation` (novo) | Um drawer hierárquico, foco/retorno/Escape/scroll lock; sem duas barras | D1 |
| `PageHeader` | Título, descrição curta, uma ação principal; sem ícone com gradiente; contexto não repete clínica | D1 base; adoção D2 |
| Button / IconButton | Primário azul; secundário outline; terciário texto; destrutivo semântico; disabled e loading sem trocar largura; nome acessível obrigatório | D1 |
| Input / Field / Select | Label persistente e associado ao input, ajuda/erro `aria-describedby`, obrigatório em texto/semântica; não apenas placeholder | D1 base; formulários por etapa |
| Tabs | `tablist`/`tab`/`tabpanel`, IDs/aria-controls, roving tabIndex, setas + Home/End e foco coerente | D1 primitive, adoção/verificação D2/D3 |
| Drawer/Dialog | Título acessível, foco inicial/trap/retorno, Escape, inert/background ou solução equivalente testada; confirmação ao sair com alterações | D1 primitive; sheets especializados D2/D3 |
| StatusBadge | Ícone opcional + rótulo + tom; não mudar significado/enums nem usar cor sozinha | D1 base |
| Table/List/Toolbar | Busca explícita, filtros com estado, resultados/paginação, ações secundárias no menu da linha | D2 |
| AgendaCard / QueueRow | Hora, cliente, serviço/profissional, status e uma próxima ação; ações técnicas fora da hierarquia principal | D2 |
| ClientSummary | Identidade/contato/responsável, próximo/último contato e ações autorizadas; dado faltante como ausente, não fictício | D2 |
| SaveStatus (novo) | Sem alterações / alterações locais / salvando / salvo confirmado / erro persistente / conflito | D3 editor; não confundir com estado de publicação |
| BlockRow / FocusedBlockEditor | Resumo real do conteúdo, visibilidade, vazio/gate, edição focal e reordenação acessível | D3 |
| PublicSection / BookingSummary | Seções com dados reais e CTA contextual; resumo de escolha sempre disponível | D3 |

### Estados mínimos obrigatórios em cada superfície migrada

- **Carregando:** skeleton sem dado anterior de outro tenant; texto de status; reduced-motion.
- **Vazio verdadeiro:** explica ausência e oferece ação permitida; nunca onboarding de canal para quem não pode conectar.
- **Vazio filtrado:** mantém busca/filtros e oferece limpar, não “crie o primeiro”.
- **403:** acesso negado preserva sessão; pode voltar a destino permitido. **401:** sessão expirada com caminho seguro existente, sem ampliar escopo.
- **Erro de rede/5xx:** mensagem persistente, retry funcional, formulário preservado; nada de skeleton infinito.
- **Salvando:** bloquear duplicação de mutation sem bloquear navegação toda; sucesso só após resposta válida.
- **409:** manter contexto digitado e oferecer recarregar/reselecionar; não sobrescrever silenciosamente versão/slot.
- **Read-only:** sem CTAs de escrita; backend continua bloqueando. Suporte tem banner visível independente de recolhimento.
- **Sem vínculo profissional:** instrução para solicitar vínculo ao administrador, não agenda de terceiros nem “sem pacientes hoje”.
- **Módulo desligado:** explicar acesso/capacidade; não reativar recurso como efeito colateral de navegação.

## 6. Especificação por jornada e tela-alvo

### 6.1 Recepção (D2)

- Visão geral abre com **Hoje** e trabalho acionável: próximos, chegadas/fila, pendências de fechamento e tarefas vencidas. Só dados já disponíveis nos endpoints; não inventar “tempo médio”/SLA que não chega no payload.
- Uma ação primária “Novo agendamento”; secundária “Encontrar cliente”. Busca deve indicar nome/telefone sem mostrar dado de outra unidade. Criar contato preserva dedupe/identidade.
- Agenda: data/unidade, dia/semana/mês, filtros e grade com largura preservada. Fila abre lateralmente quando comportar ou como visão na mesma área em tablet/mobile. Não ocultar botão de voltar à agenda.
- Reserva e chegada são estados distintos. Avulso usa QueueEntry; encaixar abre booking pré-preenchido com contato/serviço, sem fabricar reserva antes da confirmação.
- Drawer do cliente: resumo cadastral + histórico; “Agendar” leva identidade conhecida. Ficha e registro só expõem ações autorizadas, sem conceder `atendimento` à secretaria.
- Conversas: lista/seleção/histórico, canal e disponibilidade de resposta honestos. Nenhum envio real nos testes. Tarefas: abertas/vencidas/minhas e concluir, sem exigir ir ao editor de automações.

### 6.2 Profissional (D2)

- Título **Meu dia** quando o backend informa `agendaScope:'own'`; scope `none` mostra pendência de vínculo; scope `all` não é rotulado como agenda privada.
- Próximo atendimento em destaque com hora, cliente e serviço, depois fila e pendências próprias quando o payload permite esse recorte. Não exibir contadores agregados da unidade com rótulo “meus”.
- “Iniciar/abrir registro” somente com `atendimento`; finalizar com confirmação e versão; ações de reabrir só pelos papéis atuais. Imprimir nunca inclui nota interna.
- Retorno usa tarefa/campos existentes; não criar prescrição/conduta automática nem prazo clínico inferido.
- CRM da unidade permanece com contrato atual até decisão explícita de privacidade. Uma nova UX não deve dizer que o profissional só enxerga seus pacientes quando isso não é verdade.

### 6.3 Administrador/dono (D2)

- Unidade ativa evidente; organização tem seletor e período, não números de âmbito misturado. Distinguir acesso administrativo local do organizacional.
- Resultados: previsão, realizado e conversão com descrição de origem/cálculo atual; não chamar de recebimento conciliado. Comparação só quando fornecida pelo contrato.
- Gestão distingue equipe de acesso, profissionais de atendimento, disponibilidade e serviços. Atalhos cruzados respeitam `catalogo`/`equipe` separadamente.
- Recursos conserva módulos/dados legados. Configurações não recebe terceiro lugar para editar navegação pública ou conectar canais.

### 6.4 Editor (D3)

**Quatro domínios separados, sem duplicar edições:**

1. **Estrutura e conteúdo:** lista de blocos com resumo preenchido, vazio/oculto/recurso desligado; selecionar bloco abre editor focal. Sobre continua seção fixa no contrato atual, não fingir que já é bloco reordenável.
2. **Aparência:** tema, tipografia, cor e formato da clínica; não muda o painel. Presets existentes preservados; não regravar todos os temas ao abrir.
3. **Navegação:** seções/âncoras e links externos separados, indisponíveis explicados; título/rótulo sem duplicidade com conteúdo.
4. **Publicação:** URL/slug, estado no ar/não publicado, link público/QR e aviso do efeito real do save. Mudança de slug informa impacto, não troca silenciosamente links.

Layout ≥1440px: lista 224px + editor min 360px + preview flexível min 320px, em workspace full-width. Em 1024–1439px: lista/edição focal compartilham painel à esquerda e preview à direita; não espremer três colunas. Mobile: alternar Editar/Prévia em uma tela, controles não fixos sobre teclado.

Preview desktop/mobile reflete mudanças locais **sem mutation** e com indicação “Prévia de alterações não salvas”. Ideal: renderer de apresentação compartilhado com público, DTO sem segredos e sem Track/eventos de produção, sem permitir reserva real dentro do preview. Alterações de catálogo são fontes distintas: indicar quando precisam ser salvas em Serviços/Profissionais. Implementação autenticada de preview é gate técnico do D3, não liberar rascunho público ou enviar bearer por URL/postMessage.

Reordenar: drag pelo handle no mouse; botões Mover acima/abaixo sempre disponíveis no teclado e touch; anúncio de posição em live region; foco permanece no bloco; disabled nos limites. Cancelar edição não altera publicado. Não descartar bloco desconhecido/legado ao serializar.

**Salvar/publicar (decisão recomendada):** primeira D3 mantém save explícito com fila de requests, mensagem permanente de falha, e “Salvar atualiza o site” quando já publicado. Sem badge “rascunho salvo” se não há revisão isolada. No não publicado, “Salvo, ainda não publicado”. Uma futura versão de rascunho/publicado necessita definir snapshot de Page/Business/catálogo/reviews, concorrência, revisão e rollback em PR separada antes de autosave. Não tratar isso como mudança cosmética de botão.

### 6.5 Página pública e agendamento (D3)

Ordem padrão para **novas composições**, não rearranjo destrutivo de clínicas existentes:

1. Apresentação: logo livre, nome, descrição real, localização/horário se configurados; CTA Agendar, contato secundário disponível.
2. Serviços com duração/preço conforme dado existente e Agendar contextual.
3. Equipe de profissionais ativos, apenas dados autorizados no DTO público.
4. Estrutura/galeria real, sem imagens fingindo instalação da clínica.
5. Avaliações reais publicadas/aprovadas; não criar depoimentos sintéticos com aparência de clientes reais.
6. FAQ preenchido; sem perguntas vazias.
7. Localização/endereço e meios de contato disponíveis; mapa apenas quando fonte válida; fallback textual precisa de aceite técnico.

Container desktop até 1120px com hierarquia/colunas adequadas; mobile coluna única. Themes personalizados mantidos. Seções vazias continuam ocultas, inclusive nav para âncoras inexistentes. Preservar barra única de CTA/safe-area; não somar FAB de chat + WhatsApp + agendar. Se assistente estiver habilitado, seu acesso entra no mesmo sistema de ações, com teste de não sobreposição, sem mudar provider.

**Contrato do booking:** usar o mesmo `/api/bookings` e validação de slot. Serviço selecionado via sheet/`serviceId|s` vai até resumo/POST. Sessão de consumidor completa evita formulário duplicado; parcial pede somente complementos necessários. Guest em `/agendar` já existe. Decisão de usar esse mesmo modo no sheet deve ser explícita, mantendo regras de consentimento/identidade e sem transformar login da equipe em `asOwner` por acidente.

Próximo D3 não promete seleção de profissional porque ela não está ativa nos componentes lidos. Se o proprietário exigir escolha, especificar elegibilidade, slot por profissional, payload e teste como pequeno incremento funcional separado. Em todo caminho: erro sem horário, lotado, fechado, serviço removido e 409 mantêm escolha anterior e oferecem correção. Pet não ganha cadastro clínico fictício; dados de tutor não são sobrescritos por nome do animal.

### 6.6 Landing e autenticação (D4)

**Landing comercial:**

- Hero com benefício central exato: “Sua clínica organizada, do primeiro contato ao próximo atendimento”. Subtítulo factual: “Agenda, fila, clientes e tarefas em um fluxo de trabalho para sua equipe.”
- CTA principal “Criar conta” (rota real `/register`); secundário “Conhecer o fluxo”, âncora para demonstração sintética. Só usar “Agendar demonstração” se existir destino/processo confirmado; não criar botão morto.
- Seções: visão do fluxo → recepção/profissional/gestor → agenda/fila/360/pendências → página pública/agendamento → como começar → FAQ factual → CTA final.
- Demonstrações rotuladas **“Ambiente demonstrativo — dados fictícios”**, sem dados de clínicas reais. Quando houver screenshots futuros, registrar SHA/data/viewport. Não reutilizar o seed de barbearia como demonstração principal; não apagar o seed nem suas URLs.
- Retirar de **textos futuros** foco delivery/barbearia/vender tempo. Vitrine e legado continuam implementados, sem dominar a comunicação clínica.
- Sem depoimentos inventados, logos de clientes não autorizados, métricas de ganhos, preço/“grátis para sempre”, “em um minuto”, selos de segurança/homologação ou integrações presumidas. Oferta atual precisa de confirmação do responsável comercial antes de qualquer afirmação de preço.
- Nome InstaLink provisório, discreto; não criar projeto de naming ou marca nova nesta fase.

**Login/cadastro/recuperação:**

- Formulário é a prioridade: título “Entrar no InstaLink”, e-mail, senha, Entrar, Esqueci minha senha e Criar conta. Labels/autoComplete/erros claros. Mostrar/ocultar senha com nome acessível, sem modificar políticas.
- Desktop: painel de produto curto (benefício + até três funções reais) e formulário até 400–440px; formulário primeiro no DOM/ordem mobile. Sem carrossel/depoimento fictício.
- Mobile: marca pequena, título, formulário; explicação breve abaixo, sem empurrar campos para segunda dobra.
- Cadastro segue mesma identidade; remover promessa comercial não confirmada, preservar criação de sessão/onboarding.
- Recuperação respeita `kind=user|customer`, token, sucesso genérico/serviço indisponível e fluxos atuais; não revelar existência de conta nem alterar e-mail/provider/senha.
- Retorno à rota original após sessão expirada: só adicionar como melhoria contratual separada, com sanitização same-origin e preservação de b; primeira D4 não promete comportamento que ainda não implementa.

## 7. Plano de execução em PRs pequenas

Dependências:

```text
Revisão D0
   └─ D1a primitives/tokens ─ D1b shell/navegação/logo
                                ├─ D2a recepção ─ D2b profissional/gestor ─ D2c secundárias
                                ├─ D3a contrato editorial/preview ─ D3b público/booking
                                └─ D4a auth ─ D4b landing/demo

Revisão S (acesso intratenant) → gate para novas promessas/consultas de D2/D3;
                                não altera permissões dentro de D1.
Rascunho/publicado versionado → opcional, fora de D3 básico; antes de autosave futuro.
```

D4 auth pode ocorrer logo após D1 se priorizado; landing com screenshots finais depende de D2/D3. Não atrasar login para inventar dependência técnica. D3 editor e público podem ser divididos ainda mais se renderer compartilhado gerar diff grande.

### D1a — Base visual e primitives acessíveis

**Objetivo:** padrão claro premium, isolado dos temas públicos. Sem refatorar todas as telas.

**Arquivos concretos existentes:**

- `src/app/globals.css`: tokens `.il-platform`, navegação neutra, focus-visible robusto, reduced-motion escopado; manter camada pública `--il-*`/legada.
- `src/components/ui.tsx`: classes semânticas em PageHeader/controle, botão/ícone/Field, Tabs e Drawer; preservar props usadas, adicionar props opcionais para IDs/error quando necessário, sem trocar API abruptamente.
- `src/components/DashboardShell.tsx`: somente aplicar escopo visual nesta subetapa.
- `tailwind.config.js`: **somente** aliases novos se necessários; não redefinir a escala `zinc` global neste recorte. Preferir aliases já existentes.
- `src/lib/__tests__/visual-convergence.test.ts`, `workspace.test.ts`: atualizar expectativas visuais substituídas, sem apagar testes de comportamento.
- Novo `src/lib/__tests__/design-360-tokens.test.ts`: pares de contraste e presença/escopo dos tokens (componente em browser continua obrigatório).

**Não tocar:** themes/templates/appearance persistidos, db, APIs, enum de status, permissões, canais, páginas de marketing/auth.

**Aceite D1a:**

- [ ] Sem gradiente decorativo no PageHeader migrado, sem arco-íris de navegação; CTA principal azul legível.
- [ ] AA: 4,5:1 texto normal/3:1 texto grande, limites interativos e foco identificáveis; não confundir borda decorativa com limite necessário.
- [ ] Labels/input IDs coerentes; teclado Tabs desloca foco corretamente; Drawer fecha/retorna foco e não permite tabulação atrás.
- [ ] Alvos coarse pointer ≥44px, foco visível e não encoberto; reduced-motion verificado com emulação real.
- [ ] Página pública com dois temas claros/escuros sintéticos, Master, auth/landing sem regressão involuntária por tokens globais.
- [ ] Evidência browser 390×844 e 1366×768, com captura antes/depois; se browser faltar, PR não declara validação visual aprovada.

**Riscos:** tokens herdados fora de escopo, Drawer/Tab compartilhado mudar teclado de fluxos antigos, CSS global de foco, perda de contraste em disabled/hover. **Rollback:** reverter commits D1a; nenhum dado migrado.

### D1b — Dois níveis de navegação + logo + contexto

**Objetivo:** entregar a arquitetura de navegação imediatamente revisável sem redesenhar a agenda.

**Arquivos concretos existentes:**

| Arquivo | Mudança delimitada |
|---|---|
| `src/lib/panel.ts` | Acrescentar metadado de grupo de navegação e projeção dos dois níveis. Preservar href, permission, modes/features, width, requiresBusiness, area de HTTP e redirects. Evitar segunda lista independente de rotas |
| `src/lib/nav-search.ts` | Agrupamento/rótulos conforme novo catálogo; busca e href de unidade continuam derivados da lista permitida |
| `src/lib/business-context.ts` | Helper puro de troca de unidade/query, se necessário, sem mudar resolução de acesso |
| `src/components/DashboardShell.tsx` | Compor identidade/menus, conservar boot `/me`, 401/403, revalidação, suporte, SPA e fallback permitido |
| `src/components/dashboard/NavSearch.tsx` | Aparência/encaixe na nova lateral, sem virar busca clínica |
| `src/app/(dashboard)/dashboard/page.tsx` | Remover logo/nome repetido do cabeçalho; título Visão geral; gate `pagina` no Editar página. Não reordenar blocos operacionais aqui |
| `src/app/globals.css` | Layout lateral total 248/72px, mobile único, sem comprimir grade |
| `src/lib/__tests__/panel.test.ts` | Uma área por rota; todos os destinos, gates/módulos/readOnly sem concessões novas, ancestralidade, Execuções alcançável |
| `src/lib/__tests__/a34-nav.test.ts`, `a33-nav-search.test.ts` | Atualizar organização visual conscientemente; preservar busca/links sem duplicação |
| `src/lib/__tests__/business-context.test.ts` | Queries preservadas e invalidação segura de entidade ao mudar b |
| Novo `src/lib/__tests__/design-360-navigation.test.ts` | Combinações de papéis/overrides, agrupamento vazio, modelo recolhido e destino inicial autorizado |

**Arquivos novos propostos:** `src/components/dashboard/ClinicIdentity.tsx`, `PanelNavigation.tsx`, `MobilePanelNavigation.tsx`. Extrair apenas apresentação; não duplicar lógica de autorização em cada componente.

**Detalhe de implementação:** usar campo novo `navigationGroup`/tipo `PanelGroupId`, não reaproveitar `area` (usada por mensagens HTTP) como agrupamento. Seções antigas podem continuar como compatibilidade de preferências; novas preferências têm chave versionada e fallback seguro. Nunca serializar permissões/nomes de pacientes em localStorage de menu. `sidebar:false` de Execuções pode ganhar apresentação contextual explícita sem alterar acesso.

**Fora do D1b:** arquivo da agenda (1691 linhas), fila/booking/encounter, editor (1277 linhas), APIs, tipos persistidos, migração de dados, publicação/autosave, paths novos ou alteração de canal. Só ampliar escopo mediante revisão se uma dependência real impedir preservar a agenda; não aproveitar o redesign para reescrevê-la.

**Aceite D1b:**

- [ ] Todas as 22 rotas do painel têm destino no mapa/projeção; sem rota duplicada/órfã. Visíveis apenas conforme acesso e módulos existentes.
- [ ] OWNER/ADMIN/SECRETARIA/ATENDENTE/VENDEDOR/PROFISSIONAL/VIEWER + override customizado exercitados. Nenhuma ação extra permitida por ser “persona”.
- [ ] Logo horizontal/quadrado/vertical/transparente sem corte/moldura/sombra; nome uma única vez no cabeçalho lateral e não repetido no dashboard. Seletor tem nome acessível.
- [ ] Duas unidades na mesma organização e outra organização; troca revalida, mantém filtros compatíveis/URL, não exibe dado anterior enquanto carrega.
- [ ] `?b=`, `?data=`, `?tab=`, `?q=`, `?canal=`, `period/from/to`, `organization/add`, `member/professionalId` e fragmentos de leads testados segundo política de escopo (§3.5).
- [ ] Quatro redirects 308 mantidos; deep links legados client-side e busca de navegação continuam funcionando.
- [ ] Agenda com largura ≥base em 1280/1366/1440; dia/semana/mês e tela cheia sem header novo invasivo. Recolher/expandir menu não reseta filtros locais.
- [ ] Mobile 320/390 e tablet 768: um cabeçalho, menu hierárquico acessível, sem duas barras fixas; página não ganha overflow horizontal por navegação.
- [ ] 403 preserva sessão; 401 mantém fluxo existente; suporte continua visível/readOnly; usuário sem destinos recebe explicação, não logout.

**Riscos:** origem duplicada de catálogo, filtros perdidos, links a ações sem autorização, loops de `/me`/onboarding, herança CSS, preferências antigas, largura de calendário. **Rollback:** reverter D1b, mantendo D1a se independente; sem migração ou dados a recuperar.

### Validação concreta de D1 (pronta para começar após revisão)

1. Confirmar SHA/diff/branch, reler `panel.ts`, preservar baseline de screenshots **antes** da mudança em browser disponível. Criar somente fixture local vazia isolada, nunca seed com URL de produção.
2. Cobertura direcionada por subetapa, **não suíte completa a cada ajuste**:

```bash
# Sempre ambiente limpo/JSON isolado conforme auditoria §9; executar ao fechar o recorte.
npm run typecheck
npm test -- \
  src/lib/__tests__/panel.test.ts \
  src/lib/__tests__/business-context.test.ts \
  src/lib/__tests__/permissions.test.ts \
  src/lib/__tests__/professional-access.test.ts \
  src/lib/__tests__/a34-nav.test.ts \
  src/lib/__tests__/a33-nav-search.test.ts \
  src/lib/__tests__/workspace.test.ts \
  src/lib/__tests__/visual-convergence.test.ts \
  src/lib/__tests__/agenda-workspace.test.ts \
  src/lib/__tests__/design-360-tokens.test.ts \
  src/lib/__tests__/design-360-navigation.test.ts
```

Os dois últimos arquivos são **novos a criar em D1**, não testes executados em D0. Acrescentar testes do componente/runner browser aprovado; não confundir o teste de fonte Vitest com foco real.

3. Browser: 320×740, 390×844, 768×1024, 1280×720, 1366×768 e 1920×1080; zoom 200%; teclado Tab/Shift-Tab/Enter/Escape/setas/Home/End; reduced-motion; leitura de nomes/estados via accessibility tree e revisão de leitor de tela quando disponível.
4. Sessões em contextos separados: owner com três unidades, secretaria, pro vinculado, pro sem vínculo, viewer, custom override. Multitenancy positivo/negativo via HTTP usando IDs sintéticos; não imprimir tokens.
5. Screenshots de shell expandido/recolhido, agenda com/sem fila, dashboard sem repetição, mobile menu, 403/vazio/loading. Gravar viewport/role/SHA; artefatos sintéticos de tamanho controlado.
6. Um build ao fechar D1, apenas com ambiente local isolado (build também pode executar leitura server-side); sem deploy. Registrar preexistências em vez de escondê-las. `git diff --check` e revisão de ausência de alterações de API/permissões/db/segredos.
7. Gate humano: proprietário revisa navegação e identidade; recepção executa busca → agendar sem treinamento. Sem browser, entregar diff para revisão técnica, mas manter aceite visual pendente.

### D2a — Operação de recepção

**Arquivos-alvo:** dashboard/agenda/clientes/conversas/tarefas `page.tsx`; `NewBookingSheet`, `BookingDetailSheet`, `QueuePanel`, `ClientProfileDrawer`, `NewClientSheet`, `TasksView`, `TaskPanel`, `usePanelPermissions`. Dividir agenda e CRM em dois recortes se o diff deixar de ser revisável.

**Mudanças:** priorização de hoje e ações, estado aditivo da fila na URL, uso de primitives, ações por permissões, erro/retry, resumo de identidade, preservação de filtros. Zero mudança em motor/provider.

**Aceite:** secretaria encontra pessoa, abre reserva já preenchida, escolhe serviço/horário permitido, recebe conflito sem perder formulário; chegada agendada e avulsa distintas; fila/encerrar sem acesso indevido ao registro; tarefas atribuíveis/concluíveis; conversa sem campo de conexão para quem não configura. Browser desktop/mobile e dados sintéticos.

**Testes-alvo:** `a34-agenda`, `agenda-drag`, `agenda-workspace`, `a34-queue`, `a34-queue-rail`, `a34-operative-routes`, `a31-client-ops`, `a33-contact-routes`, `a33-fechamento-routes` (arquivos `.test.ts` em `src/lib/__tests__`), mais teste browser da jornada. Não mudar horário/fuso/recorrência para acertar screenshot.

**Riscos:** regressão de drag/grade/fila, duas identidades de cliente, deep link perdendo contexto, filtros de unidade stale. **Rollback:** por superfície, reverter apresentação/estado aditivo sem desfazer reservas reais.

### D2b — Profissional e gestão

**Arquivos-alvo:** dashboard, profissionais, disponibilidade, equipe, organização e resultados `page.tsx`; `EncounterSheet`, `MemberAccessSheet`, `BusinessHours`, `catalog-panels`, `results-view`.

**Mudanças:** contexto próprio/sem vínculo, próxima ação, fechamento/retorno, distinção equipe/profissional, unidades/período. Revisão de acesso intratenant é dependência de qualquer **novo** dado/recorte; não alterar permissões no mesmo PR visual.

**Aceite:** pro vê agenda correta/sem vínculo honesto; registro com conflitos/finalização/reabertura conforme servidor; impressão sem nota interna; admin local não ganha unidade irmã; consolidado explica âmbito/período/previsão; equipe não cria Master. Sem prontuário especializado inventado.

**Testes-alvo:** `professional-access`, `a34-encounter`, `a34-encounter-integrity`, `a34-team`, `a33-client-profile`, `insights`, `revenue`, `periods`, `tenant-isolation` e jornadas HTTP/browser selecionadas. PostgreSQL só se futuramente houver instância descartável explicitamente provisionada, nunca produção.

**Riscos:** rótulo “meu” para agregado da unidade, vazamento intratenant novo, autosave de encounter sem versão, confusão receita/pagamento. **Rollback:** apresentação revertível; nunca desfazer registro finalizado via script de rollback visual.

### D2c — Áreas secundárias e coerência operacional

**Arquivos-alvo:** agente/campanhas/serviços/produtos/pedidos/recursos/configurações/funil; `AutomationsView`, `RunsView`, `EsteiraView`, `AiAutomations`; apenas chrome/apresentação de Canais.

**Mudanças:** aplicar tokens, estados erro/vazio/salvando, hierarquia, atalhos autorizados; deixar ligações e estados de integrações intactos. Manter legado disponível.

**Aceite:** regra existente cria/mostra tarefas em fixture sem efeitos externos; “simulação” e execução real diferenciadas; campanha sem canal configurado não promete envio; Falha 5xx de campanhas oferece retry; recursos desligados não apagam dados; pedido/produto legado permanece alcançável.

**Testes-alvo:** `features`, `pipeline`, `campaigns`, `automation-model`, `ai-p5`, `panel` + erro de carregamento em browser. Não acionar send/processar filas externas nem a suíte de WhatsApp para um recorte cosmético.

**Riscos:** ativação acidental de módulo, CTA de envio mais permissivo, labels “IA” exagerados. **Rollback:** estilos/componentes; sem atualização de definições persistidas.

### D3a — Editor focal e prévia honesta

**Arquivos-alvo:** `src/app/(dashboard)/pagina/page.tsx`, componentes novos em `src/components/dashboard/page-editor/`, `src/app/[slug]/page.tsx` apenas para extrair renderer compartilhado, `src/components/public/*` de apresentação, `lib/templates.ts`, `nav.ts`, `faq.ts` quando for necessário reutilizar as mesmas regras, sem mudar dados/templates existentes.

**Gate antes de codificar:** aprovar contrato explícito de salvar atualiza publicado. Se for exigida revisão isolada, escrever especificação de persistência/transação/concorrência e pedir autorização de PR separada; **não improvisar novo banco/API no PR visual**. Preview com usuário autorizado precisa funcionar sem depender exclusivamente do cookie do owner; nunca liberar slug de rascunho para todos.

**Aceite:** abas/domínios separados; bloco com resumo real, editor focal, prévia desktop/mobile; mouse+teclado na ordenação; conteúdo/IDs/ordem legada preservados; preview não grava nem dispara tracking/reservas; estado local/salvando/salvo/erro honesto; duas janelas não se sobrescrevem silenciosamente sem ao menos bloqueio/aviso conforme contrato aprovado. Nunca chamar autosave de rascunho sem versionamento.

**Testes-alvo:** `editor-sync`, `features`, `appearance`, `nav`, `faq`, `visual-convergence` + jornada browser publish→edit→save→público e contextos cookie/Bearer. Fixture contém blocos vazios, ocultos, desconhecidos/legados, presets customizados e falha de PUT.

**Riscos:** PUT parcial, features ativadas por edição, preview divergente, conteúdo descartado na serialização, last-write-wins. **Rollback:** revert renderer/editor preservando contrato de dados; comparação JSON antes/depois para provar que render não migrou conteúdo.

### D3b — Público e continuidade do booking

**Arquivos-alvo:** `[slug]/page.tsx`, `agendar/page.tsx`, `ThemeStyle.tsx` somente se precisar de escopo não destrutivo, `public/AgendarFlow`, `widgets2`, `menu`, `BottomBar`, `customer`, `use-customer-form`, `lib/cta.ts`, `bottombar.ts`, `agendar.ts` conforme reutilização.

**Aceite:** identidade sem crop; apresentação/serviços/equipe/estrutura/reviews/FAQ/localização quando existentes; desktop útil e mobile sem sobreposição; CTA leva serviço certo, identidade conhecida não é perdida, guest e sessão com regras claras; lotado/fechado/409/serviço inexistente recuperáveis; acesso ao próprio agendamento/remarcação/cancelamento preservado; widget em embed continua ajustando altura.

**Testes-alvo:** `a2-b2-agendar-guest`, `a2-b3-availability-horizon-f7`, `a2-b4-manage-limit`, `a2-b5-timezone-openstatus`, `booking`, `slots`, `slot-states`, `cta`, `bottombar`, `nav` e uma execução de smoke agendar em servidor descartável se o script for adaptado/confirmado seguro. Não copiar IDs de dados reais.

**Riscos:** divergência entre dois fluxos, autenticação obrigatória acidental, mudança do tema da clínica, múltiplos CTAs cobrindo teclado/safe-area, perda de respostas do serviço, seleção profissional falsa. **Rollback:** UI compatível com contrato anterior; nenhuma reserva removida.

### D4a — Entrada clara e consistente

**Arquivos-alvo:** `(auth)/layout.tsx`, `(auth)/login/page.tsx`, `(auth)/register/page.tsx`, `recuperar/page.tsx`; onboarding apenas apresentação/copy; novos componentes de formulário compartilhado se necessários.

**Aceite:** formulário prioritário, AA/foco/erro/loading, cadastro e recuperação coerentes; Master redirecionado corretamente; sessão híbrida mantida; `kind=customer` não vira user; nenhum e-mail real enviado nos testes. APIs/password policy/providers intocados.

**Validação:** testes de contrato auth/HTTP pertinentes existentes, `onboarding`, `http`, `product-positioning`; browser submit/erro/sessão expirada/recuperação com resposta sintética controlada e sem segredos no artefato.

**Riscos:** breaking de autoComplete/session/token, nova promessa returnTo, mudança involuntária de fluxo do consumidor. **Rollback:** somente apresentação, sem reset de contas.

### D4b — Landing clínica e demonstração sintética

**Arquivos-alvo:** `src/app/page.tsx`, metadata de `src/app/layout.tsx` somente se alinhada, componentes/ativos estáticos de marketing novos de tamanho controlado. **Não editar/excluir seed/demos atuais**. Nova demo interativa, se necessária, exige fixture isolada separada; primeira versão pode usar screenshots sintéticos rotulados/ilustração de interface sem banco público aberto.

**Aceite:** headline solicitada; jornadas por persona; funções existentes, sem promessas/pricing não aprovados; CTAs com destino real; demonstração sintética explícita; zero depoimento/logotipo/métrica fictícia; login facilmente encontrado; mobile/performance/alt texts verificados; nome provisório mantido.

**Validação:** `product-positioning`, links internos e browser 390/1366, tamanhos de imagem/lazy-loading e ausência de layout shift evidente. Métricas de performance só publicadas se efetivamente medidas; não inventar score Lighthouse.

**Riscos:** parecer que imagens sintéticas retratam clínica real, preço implícito, link para demo não provisionada, recursos de WhatsApp parecerem prontos para uso. **Rollback:** reverter landing, sem tocar operações/cadastros.

## 8. Revisão S — acessos e contratos sensíveis (separada, sem implementação D0)

Auditoria §5.3 identificou GET pages sem `pagina`, previsão em organizations sem `financeiro`, CRM amplo intratenant e caminhos sem vínculo a investigar. Abrir discussão com proprietário/responsável de segurança para:

1. Definir necessidade mínima do DTO de leitura de páginas por papel, sem quebrar consumidores legítimos.
2. Definir se resumo financeiro em organizações deve seguir `financeiro`, e seu impacto em dashboard/onboarding.
3. Definir se cliente/360 é compartilhado na clínica ou restrito por profissional; considerar acesso histórico, substituição e dados sensíveis. Não restringir só no frontend.
4. Reproduzir adversarialmente criação/assunção/registro por profissional sem vínculo e acessos a entidades de outro tenant; fix com testes negativos somente mediante autorização.

**Dependência real:** isto bloqueia ampliar/resumir dados sensíveis e anunciar privacidade clínica; não impede substituir logo/CSS/menu preservando os guards existentes. Se houver evidência crítica adicional, interromper a etapa funcional e pedir revisão específica, sem alterar produção.

## 9. Matriz de aceite transversal e prova de não regressão

| Dimensão | Casos obrigatórios |
|---|---|
| Tenant | Dois donos/organizações e duas unidades irmãs, unidade inexistente, ID externo, troca rápida, resposta lenta/stale, nenhuma mistura de resultados |
| Papéis | Todos os padrões + override que remove/acrescenta permissão, pro vinculado/sem vínculo/inativo, ADMIN local/organizacional, suporte view/admin |
| Módulos | services+bookings; products; ambos; legado orders/quote; recurso oculto sem apagar conteúdo |
| Navegação | direto/refresh/back/forward, busca, redirects, unidade ausente/inválida, área sem permissão, full/mini/mobile |
| Operação | dia/semana/mês, profissional/especialidade/status, 409, recorrência, fechamento, fila avulsa/agendada, registro/versionamento/impressão |
| Editor | salvo/local/erro/conflito, público/não publicado, catálogo vazio/tema personalizado/bloco legado, preview sem efeitos, cookie bloqueado |
| Público | logged/guest/sessão parcial, serviço prévio/inativo, nenhum horário, fuso, embed, conta própria/remarcação/cancelamento |
| Acessibilidade | AA por combinação, keyboard sem armadilha, labels/landmarks/heading, zoom 200%, reduced-motion, toque e safe-area |
| Comunicação | Sem recurso fictício/integração presumida, sem depoimentos/métricas, dado sintético rotulado, preço confirmado ou ausente |

Não executar esta matriz inteira em cada PR. Selecionar linhas afetadas e rodar regressão ampliada uma vez antes da entrega consolidada; reportar o que **não** foi exercitado. Uma suíte verde não substitui o roteiro humano da recepção/profissional/gestor.

## 10. Checklist para autorizar início de D1

- [ ] Proprietário revisou achados e aceitou ausência de evidência visual D0, com gate de browser em D1.
- [ ] Sete áreas e mapa de todos os destinos aprovados, incluindo legado e distinção equipe/profissionais.
- [ ] Lateral total 248px e menu mobile único aprovados.
- [ ] Logo contain sem moldura/corte e remoção de identidade duplicada aprovados; arte real não será editada.
- [ ] Escopo fechado D1a/D1b, sem APIs/permissões/canais/banco e sem refatorar agenda/editor.
- [ ] Plano de fixture local e screenshots sintéticos aprovado; nenhuma URL de produção nos comandos.
- [ ] Revisão S e contrato editorial reconhecidos como pendências próprias, não autorização tácita para mudanças.

**Próxima ação:** revisão dos dois documentos. Após aprovação explícita, começar apenas D1a, registrar baseline visual e seguir pelos gates. **Parar aqui nesta rodada.**
