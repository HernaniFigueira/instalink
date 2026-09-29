# Auditoria de UI GoDoutor v2 — matriz por rota

> **Objetivo:** registrar a revisão do contrato existente, rota a rota, sem declarar inspeção visual que não aconteceu. Esta matriz separa evidência de fonte/teste de evidência de browser. As colunas de viewport permanecem **PENDENTES** até capturas reais em 1440, 1366 e 390 px.
>
> **Escopo autenticado:** catálogo de `src/lib/panel.ts`, rota de detalhe `/clientes/[id]` e destino contextual `/atendimento`. A página pública, renderer e booking público continuam fora do redesign.

## Resultado resumido e evidência disponível

- [x] Contrato atualizado em `GODOUTOR-UI-CONTRACT.md`.
- [x] Default da preferência pessoal aponta ao preset existente `azul-profundo`; os 21 presets permanecem; preferência válida `godoutor.nav-accent` não é sobrescrita pelo default.
- [x] Guardas de fonte/token/contraste e regressão adicionadas em `src/lib/__tests__/godoutor-ui-contract-v2.test.ts`; a cobertura inclui todos os 21 presets, persistência simulada, invariantes do shell/primitivas, escopo do bridge semântico e sincronização da matriz com o catálogo de rotas.
- [x] Testes visuais legados que exigiam fundo gradiente, topbar colorida, default neutro, cards creme ou CTA violeta foram atualizados para o contrato aprovado. Comportamento/negócio não foi alvo dessas alterações.
- [x] Acentos históricos de pet/paciente, anotação administrativa, métrica, “hoje” e setup foram neutralizados ou ligados ao accent; contextos antes lilás convergem para info ou accent. Estados da agenda foram levados a tokens semânticos.
- [x] Proteção de descarte compartilhada, rota clínica full-page e refinamentos estáticos de hierarquia/cores/superfícies concluídos; APIs e domínio clínico permaneceram no contrato existente.
- [x] **Page Architecture:** `pageType` obrigatório por rota autenticada, `PageFrame` e tokens de width/gutter; Perfil, AccountMenu e copy de Produtos atualizados sem redesign. Matrizes estrutural e de exceções adicionadas abaixo.
- [x] Validação anterior à ampliação do workspace `/conversas`: **101/101 testes focais** (10 arquivos), incluindo regressões clínicas e overlays.
- [x] Validação completa anterior à ampliação do workspace: **2.505 aprovados / 6 falhas / 2.511 testes**. As seis falhas atuais continuam descritas na seção de validação do workspace abaixo.
- [x] `npm run typecheck` aprovado; `npm run build` aprovado, com 132/132 páginas geradas.
- [ ] Browser/render/capturas de todas as rotas em desktop e mobile: **não realizado nesta etapa**. Nenhuma rota abaixo está marcada como visualmente homologada. Playwright não encontrou Chromium instalado; `npx playwright install chromium` falhou com `ECONNRESET` ao baixar de `cdn.playwright.dev`. Portanto não há screenshots e nenhuma rota foi declarada visualmente aprovada.
- [ ] Homologação visual pós-implementação pelo usuário: temas verde/neutro/vinho, reload F5 e viewports críticos; nenhuma evidência de browser foi declarada.

## Matriz de rotas autenticadas

“Inspeção estática” indica uma revisão de fontes/classes/tokens e não substitui a tela renderizada. “Browser” permanece pendente em todas as linhas até existir evidência visual registrada.

| Rota | Área / arquivo principal | Superfícies e comportamento a reauditar | Inspeção estática | 1440 | 1366 | 390 | Temas Deep Blue / verde / neutro / vinho |
|---|---|---|---|---|---|---|---|
| `/dashboard` | Visão geral — `app/(dashboard)/dashboard/page.tsx` | Header de identidade do workspace, 6 métricas em superfície neutra, listas/gráficos, quick actions | Parcial: métricas deixaram creme; chips contextuais preservados | Pendente | Pendente | Pendente | Pendente |
| `/estrutura` | Estrutura — `app/(dashboard)/estrutura/page.tsx` | Hub de serviços, profissionais, horários e acessos; cards/atalhos | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/agenda` | Agenda — `app/(dashboard)/agenda/page.tsx` | Toolbar densa, grade, status semânticos, fila lateral, drawers e quick-create | Parcial: fundo externo neutro; `BOOKING_BLOCK`/pontos usam tokens semânticos | Pendente | Pendente | Pendente | Pendente |
| `/atendimento` | Atendimento clínico contextual — `app/(dashboard)/atendimento/page.tsx` + `EncounterSheet.tsx` | Página completa desktop/mobile; autosave, versão/conflitos, finalização/reabertura, impressão, retorno, tarefas e pagamento opcional | Parcial: shell de página e navegação integrados; APIs/permissão existente preservadas por inspeção de fonte e testes focados; layout ainda sem homologação browser | Pendente | Pendente | Pendente | Pendente |
| `/profissionais` | Profissionais — `app/(dashboard)/profissionais/page.tsx` | Lista, ficha, permissões/atalhos e catálogo | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/disponibilidade` | Disponibilidade — `app/(dashboard)/disponibilidade/page.tsx` | Regras semanais, exceções, forms e seletor de profissional | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/conversas` | Conversas — `app/(dashboard)/conversas/page.tsx` + `ConversationsView.tsx` | Workspace operacional full-height: inbox independente, timeline/composer, contexto administrativo recolhível e responsivo, filtros e deep-link | Parcial: contrato do workspace e preservação de fluxos revisados em fonte/testes; visual segue pendente | Pendente | Pendente | Pendente | Pendente |
| `/agente` | Assistente — `app/(dashboard)/agente/page.tsx` | Preferências de tom/objetivo, formulários, prévia e estados | Parcial: apresentação migrou para tokens/option chips; comportamento e configuração preservados | Pendente | Pendente | Pendente | Pendente |
| `/tarefas` | Pendências — `app/(dashboard)/tarefas/page.tsx` + `TaskPanel.tsx` | Resumo de fila, atrasos reais, itens/ações, empty/error state | Parcial: “para hoje” não usa cor de warning | Pendente | Pendente | Pendente | Pendente |
| `/pedidos` | Pedidos — `app/(dashboard)/pedidos/page.tsx` | Tabela/lista e ciclo de status, filtros e detalhe | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/clientes` | Clientes — `app/(dashboard)/clientes/page.tsx` | Lista, filtros, paginação, seleção, consentimento e cadastro | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/clientes/[id]` | Detalhe 360 — `app/(dashboard)/clientes/[id]/page.tsx` + `ClientProfileDrawer.tsx` | Identidade, anotações administrativas neutras, ficha/pets, toolbar e retorno à lista | Parcial: retorno contextual com fallback real e ações seguem a hierarquia; browser pendente | Pendente | Pendente | Pendente | Pendente |
| `/funil` | Oportunidades — `app/(dashboard)/funil/page.tsx` + `EsteiraView.tsx` | Kanban, badges e transições de etapa | Parcial: status agora usa info/warning/success/danger; rever estados em browser | Pendente | Pendente | Pendente | Pendente |
| `/servicos` | Serviços — `app/(dashboard)/servicos/page.tsx` + `catalog-panels.tsx` | Catálogo, formulários, seleção, exclusão e mensagens | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/produtos` | Produtos — `app/(dashboard)/produtos/page.tsx` | Cadastro legado de catálogo, estado e formulários; não é estoque | Copy sem vitrine quando flag OFF; renderer público fica fora do redesign | Pendente | Pendente | Pendente | Pendente |
| `/campanhas` | Campanhas — `app/(dashboard)/campanhas/page.tsx` | Consentimento, estados de envio, métricas e comunicação | Parcial: explicação antes lilás agora accent suave; cartões de consentimento permanecem semânticos | Pendente | Pendente | Pendente | Pendente |
| `/automacoes` | Automações — `app/(dashboard)/automacoes/page.tsx` + `AutomationsView.tsx` | Receitas, status de execução, filtros e histórico | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/followup` | Follow-up — `app/(dashboard)/followup/page.tsx` | Receita de retorno, elegibilidade e estados do canal | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/canais` | Canais & Integrações — `app/(dashboard)/canais/page.tsx` | Conectividade, configurações, exemplos de código e tokens de canal | Pendente; identidade de canal limitada ao identificador | Pendente | Pendente | Pendente | Pendente |
| `/resultados` | Resultados — `app/(dashboard)/resultados/page.tsx` + `results-view.tsx` | Gráficos, legendas, filtros, comparações e empty states | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/financeiro` | Financeiro — `app/(dashboard)/financeiro/page.tsx` | Entradas/saídas, estados de pagamento, gráficos e forms | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/organizacao` | Organização — `app/(dashboard)/organizacao/page.tsx` | Unidades, troca/criação de unidade, agregados | Parcial: componente usa superfície neutra e acento comum; validar identificação visual em browser | Pendente | Pendente | Pendente | Pendente |
| `/execucoes` | Execuções — `app/(dashboard)/execucoes/page.tsx` | Histórico, detalhes de execução, success/failure e mensagens | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/pagina` | Editor da página — `app/(dashboard)/pagina/page.tsx` | Shell autenticado, editor e prévia | **Exceção**: editor/page-builder legado não é redesenhado; apenas não pode sofrer regressão de seletor global | Pendente | Pendente | Pendente | Fora do redesign; não regredir |
| `/perfil` | Meu perfil — `app/(dashboard)/perfil/page.tsx` | Dados pessoais, badge role oficial, identidade profissional separada, vínculo User → Professional e Segurança | PageFrame `form`; testes de contrato adicionados | Pendente | Pendente | Pendente | Pendente |
| `/equipe` | Equipe — `app/(dashboard)/equipe/page.tsx` | Tabela/lista, papéis, convite, permissões e confirmação | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/recursos` | Recursos — `app/(dashboard)/recursos/page.tsx` | Disponibilidade de módulos, switch, descrições e restrições | Parcial: containers do dashboard neutralizados | Pendente | Pendente | Pendente | Pendente |
| `/configuracoes` | Configurações — `app/(dashboard)/configuracoes/page.tsx` | Abas, aparência, preview/persistência, forms e preferências | Parcial: default e preferência cobertos por testes; preview precisa conferência visual e F5 | Pendente | Pendente | Pendente | Pendente |

## Matriz Page Architecture — rotas autenticadas

Esta matriz é o contrato estrutural pedido para `rota | arquétipo | largura | header | toolbar/actionbar | observação/exceção`. A topbar do `DashboardShell` permanece global nas rotas do workspace (exceto focus mode já existente). Larguras: `workspace` = sem max-width; `record` = 1280px; `detail` = 1440px; `form` = 960px; `hub` = 1280px. Base da classificação: `PANEL_ROUTES.pageType` + resolver explícito de `/clientes/[id]` e `AUTHENTICATED_AUXILIARY_ROUTES` para rotas autenticadas standalone, Master e aliases de redirect. Header especial/toolbar específico permanece somente onde já há composição operacional homologada; novos módulos devem usar os componentes compartilhados.

| Rota | Arquétipo | Largura | Header | Toolbar / ActionBar | Observação / exceção |
|---|---|---:|---|---|---|
| `/dashboard` | workspace | full | Cabeçalho próprio de visão geral | atalhos globais e ações nos módulos | Dados/resumo operacional |
| `/estrutura` | hub | 1280px | PageHeader | atalhos/seções estruturais | Serviços, profissionais, disponibilidade e acessos não se fundem |
| `/agenda` | workspace | full | PageHeader operacional | Toolbar de filtros e ações da grade | flush intencional; gutter próprio, não estreitar |
| `/atendimento` | record | 1280px | Cabeçalho clínico próprio | ActionBar clínico existente | Preservar layout/ações e regras clínicas; sem mudança de workflow |
| `/profissionais` | hub | 1280px | PageHeader | ações do catálogo/ficha | Professional continua entidade distinta de User |
| `/disponibilidade` | hub | 1280px | PageHeader | controles de agenda semanal | Administração estrutural, largura ampla |
| `/conversas` | workspace | full | Cabeçalho próprio do inbox | filtros e controles da inbox/composer | flush/full-height intencional; gutter próprio |
| `/agente` | form | 960px | PageHeader | abas de configuração + ação salvar | Conteúdo centralizado; copy operacional sem Página quando flag OFF |
| `/tarefas` | workspace | full | Cabeçalho operacional próprio | filtros/ações contextuais | Não alterar regras de workflow |
| `/pedidos` | workspace | full | PageHeader | filtros e ações por pedido | Sem estreitamento de tabela/estado |
| `/clientes` | workspace | full | PageHeader | busca, filtros e cadastro | Diretório denso |
| `/clientes/[id]` | detail | 1440px | PageBackAction + identidade da ficha | ações da ficha/abas | Herdado de Clientes; classe detail explícita |
| `/funil` | workspace | full | PageHeader | filtros e ações do kanban | Kanban preservado |
| `/servicos` | hub | 1280px | PageHeader | toolbar/ações do catálogo | Mesmo arquétipo structural de catálogo |
| `/produtos` | hub | 1280px | PageHeader | categoria/produto + status | Flag OFF remove copy de vitrine; cadastro preservado e não é estoque/Farmácia |
| `/campanhas` | workspace | full | PageHeader | público, filtro e ações de envio | Tabela/estados de operação mantidos |
| `/automacoes` | hub | 1280px | Cabeçalho composto existente | controles de receitas e histórico | Expansível/configurável; não reduzido a formulário estreito |
| `/followup` | workspace | full | PageHeader | filtros/ações de receitas existentes | Estrutura não altera workflow nem regra temporal |
| `/canais` | hub | 1280px | PageHeader | abas/controles de integração | Grupos extensíveis de canais e integrações |
| `/resultados` | workspace | full | PageHeader | período/filtros | Gráficos/tabelas preservam largura operacional |
| `/financeiro` | workspace | full | PageHeader | período/filtros + lançamentos | Tabelas/gráficos; dialogs seguem intenção de ação |
| `/organizacao` | hub | 1280px | Cabeçalho próprio do workspace | troca/criação permitida de unidade | Organização/unidades; não criar organização nova |
| `/execucoes` | workspace | full | Cabeçalho próprio da lista | filtros/detalhe de execução | Destino contextual fora do menu continua por deep link |
| `/pagina` | workspace | full | Editor/header próprio | savebar do editor | Exceção legacy: editor/page-builder não redesenhado; full-width preservado |
| `/perfil` | form | 960px | PageHeader | ActionBar com Primary salvar; Secondary em segurança | Uma edição de foto; role ≠ cargo; `/alterar-senha` existente |
| `/equipe` | hub | 1280px | PageHeader | convite, busca e ações de membros | Papel de acesso oficial, sem confundir com cargo |
| `/recursos` | hub | 1280px | PageHeader | switches por módulo | Dados preservados; grupos expansíveis |
| `/configuracoes` | form | 960px | PageHeader | abas Clínica, Agenda e Aparência + salvar | Logo, nome, email, WhatsApp/telefone, redes, site externo, endereço/mapa, Agenda e Aparência preservados; sem copy de Página quando OFF |

Rotas autenticadas fora de `DashboardShell` (outras arquiteturas/exceções nomeadas; continuam classificadas):

| Rota | Arquétipo | Largura | Header | Toolbar / ActionBar | Observação / exceção |
|---|---|---:|---|---|---|
| `/alterar-senha` | form | max 512px (tela independente) | Cabeçalho de segurança próprio | ação de alteração de senha existente | Mesma autenticação; destino também do AccountMenu |
| `/setup-master` | form | max 512px (tela independente) | Cabeçalho de bootstrap | ações de setup existentes | Fluxo autenticado condicionado a bootstrap; não faz parte do shell clínico |
| `/master` | hub | max 1280px (`max-w-7xl`) | Header Master próprio | navegação Master | Console isolado do cliente; guarda `requireMaster` |
| `/master/atividade` | workspace | max 1280px (`max-w-7xl`) | Header Master + heading de atividade | filtro/busca de log | Console da plataforma, não `PANEL_ROUTES` |
| `/master/masters` | hub | max 1280px (`max-w-7xl`) | Header Master + heading | gestão de masters | Guarda Master |
| `/master/organizacoes` | hub | max 1280px (`max-w-7xl`) | Header Master + heading | busca/lista | Administração da plataforma |
| `/master/organizacoes/[id]` | detail | max 1280px (`max-w-7xl`) | Header Master + heading da organização | ações da ficha | Mantém shell Master próprio |
| `/master/suporte` | workspace | max 1280px (`max-w-7xl`) | Header Master + heading | ações de suporte | Acesso/impersonation existente, fora do redesign |
| `/master/unidades` | hub | max 1280px (`max-w-7xl`) | Header Master + heading | busca/lista | Administração da plataforma |
| `/master/unidades/[id]` | detail | max 1280px (`max-w-7xl`) | Header Master + heading da unidade | ações da ficha | Mantém shell Master próprio |
| `/master/usuarios` | hub | max 1280px (`max-w-7xl`) | Header Master + heading | busca/lista | Administração da plataforma |
| `/admin` → `/master` | hub | destino: max 1280px | redirect, sem header próprio | redirect | Alias legado, sem tela persistente |
| `/admin/auditoria` → `/master/atividade` | workspace | destino: max 1280px | redirect, sem header próprio | redirect | Alias legado, sem tela persistente |
| `/admin/empresas/[id]` → `/master/unidades/[id]` | detail | destino: max 1280px | redirect, sem header próprio | redirect | Alias legado, sem tela persistente |

`/login`, páginas públicas `/{slug}` e `/agendar` não são rotas autenticadas e permanecem fora desta classificação estrutural do workspace. Não há rota autenticada catalogada sem arquétipo; exceções têm destino, shell e razão explícitos.

### Alterações desta missão (Page Architecture)

- `PanelRouteDef.width?` foi substituído por `pageType` obrigatório (`workspace | record | detail | form | hub`) em todas as entradas; o shell resolve a ficha filha `/clientes/[id]` como `detail` e monta `PageFrame` com max-width/gutters tokens.
- Criados os primitivos `PageFrame`, `FormSection` e `ActionBar`; `PageHeader`, `Toolbar` e `SectionHeader` continuam fonte compartilhada. Agenda e Conversas mantêm full-width/gutters específicos; Atendimento usa `record` sem redesign.
- Perfil foi reorganizado nas seções Dados pessoais, Identidade profissional e Segurança; foto editável única, badge de role oficial, cargo como identidade profissional, vínculo User → Professional e link para `/alterar-senha` preservados.
- AccountMenu esconde “Ver página pública” somente com a flag legacy OFF; mantém o legado com flag ON, nome/role acessíveis, perfil, visão/troca de unidade, nova unidade permitida, configurações, ajuda, senha e saída. Email deixa de competir no cabeçalho do menu.
- Produtos permanece Produtos/rota/dados: descrição e formulário deixam de anunciar vitrine/página pública com flag OFF e informam claramente a ausência de estoque/vendas/Farmácia. A utilidade operacional segue decisão futura; nenhum módulo de estoque foi inventado. Copy de Configurações permanece condicional em Clínica/Agenda/Aparência e conserva campos.
- Testes de contrato cobrem arquétipos válidos por rota, workspace não estreito, form centralizado, record Atendimento, AccountMenu legacy OFF/ON, Perfil sem preview duplicado, Alterar senha e separação role/cargo.

### Validação desta missão — Page Architecture

- `npm run typecheck`: aprovado.
- Testes focais: **8 arquivos / 147 aprovados** (arquitetura, catálogo, Perfil, menu, flag Produtos/Configurações e regressões de navegação).
- `npm run build`: aprovado; compilação de produção e **132/132 páginas** geradas.
- `npm test -- --reporter=dot`: **2.564 aprovados / 5 falhas / 2.569 testes**. As falhas permanecem nas mesmas suítes fora desta missão: `a34-instagram.test.ts` (3), `automation-audit-p4.test.ts` (1) e `pipeline.test.ts` (1; fixture tenta agendar no passado). Nenhuma foi mascarada ou alterada.
- `git diff --check`: aprovado após a implementação.
- Conferência visual/browser em 1440/1366/390: **pendente**; nenhuma homologação visual é declarada por esta rodada.

## Trilhas de auditoria que faltam fechar

### Segunda varredura estática

A segunda passagem de fonte foi executada nos componentes/rotas do dashboard autenticado (76 arquivos `.tsx`, sem redesign de renderer/editor público e dos componentes de preview/encounter explicitamente excluídos). Resultado quantitativo:

- **Cores:** 1.469 usos de classes Tailwind com cor semântica em **77 variantes distintas**. Elas foram classificadas em warning/success/danger/info e ligadas a tokens por 28 regras de compatibilidade limitadas a `.il-platform.workspace-shell`; teste assegura que nenhum seletor vaze para a página pública.
- **Radii:** 40 ocorrências de `rounded-xl/2xl/3xl` são normalizadas para `--radius-md` no workspace; radius grande continua apenas onde tem significado (pills/avatars/controles circulares). Valores radius soltos dentro das regras estruturais encontradas foram substituídos por tokens; os valores globais `:root` permanecem separados para preservar superfícies públicas legadas.
- **Sombras:** 41 usos legados de `shadow-brand` foram encontrados; o token no workspace é `none`. `shadow-xs/sm` também é `none` no conteúdo normal e sombras maiores ficam reservadas a overlays/menus flutuantes.
- **Inline styles:** a varredura atual linha a linha encontrou **84 atributos** nas rotas/componentes autenticados de `(dashboard)` e `components/dashboard`; cada ocorrência está classificada em [`GODOUTOR-UI-AUDIT-V2-INLINE-INVENTORY.md`](./GODOUTOR-UI-AUDIT-V2-INLINE-INVENTORY.md). Predominam geometria calculada de agenda/gráficos, preview de tema existente, tokens semânticos, coordenadas de tooltip/rail e estilos de impressão. Um tamanho fixo de ícone em `AutomationsView` foi convertido para utilitários CSS. A inspeção visual dos casos permanece pendente.
- **Hexes:** 7 correspondências de regex incluíram um fragmento de comentário de erro React; as declarações visuais restantes pertencem a preview/editor público ou tratamento de impressão e não foram redesenhadas neste escopo. A lista de exceções precisa ser anexada por arquivo na rodada final.
- **Ações globais:** não foi encontrado FAB global concorrente de Conversas. O atalho de Conversas permanece integrado à topbar; posição fixa encontrada é tooltip, aviso/toast e preview/editor legado. O teste v2 trava a ausência da shortcut fixa.

A classificação estática individual das 84 ocorrências está concluída e vinculada ao inventário acima. Ainda falta verificar em tela real os efeitos dos casos dinâmicos e reabrir as rotas; a compatibilidade por token e o inventário não substituem a reauditoria visual.

- [x] Segunda busca de classes de cor + normalização semântica com escopo e guarda de regressão.
- [x] Busca de radius/shadow/FAB e substituição das declarações estruturais avulsas encontradas nos seletores do workspace.
- [x] Classificar as 84 ocorrências inline da varredura atual uma a uma no inventário vinculado; separar geometria/dados, tokens semânticos, previews legados, tether e impressão. Uma dimensão estática saiu do inline.
- [ ] Revisar em browser os casos dinâmicos (gráficos, agenda, tema) e verificar os previews/impressão sem alterar renderer/page-builder legado.
- [ ] Conferir em browser que tokens escopados não afetam renderer/editor/booking público nem login homologado.
- [ ] Reexecutar e arquivar a busca final depois da auditoria inline e visual.

### Regressão e browser

- [x] Baseline antes da ampliação `/conversas`: `npm run typecheck` passou; `npm test` executou 2.511 testes (2.505 aprovados, 6 falhas). O resultado atualizado pós-workspace está documentado na seção final.
- [x] Contraste AA automatizado dos tokens para os 21 presets (`--accent-fg × --accent-soft`, `--accent-contrast × --accent` e pares de sidebar/ativo). Isso não é renderização dos componentes em browser.
- [ ] Carregar e renderizar todas as rotas da matriz a 1440, 1366 e 390 px; capturar screenshot por viewport/rota e anotar overflow, recorte, contraste e interação.
- [ ] Em `/dashboard`, `/agenda`, `/conversas`, `/clientes`, `/funil` e `/configuracoes`, repetir em `azul-profundo`, verde, neutro e vinho; fazer F5 em cada preferência salva válida.
- [ ] Reabrir as seis rotas críticas após a segunda varredura. Registrar links/arquivos das capturas antes de declarar homologação.
- [x] `npm run build` concluído com sucesso; o build de produção compilou e gerou 132 páginas.

## Testes/evidências atuais

- Fonte: `src/lib/__tests__/godoutor-ui-contract-v2.test.ts` — default, 21 presets, contraste de nav/ativo/acento/texto sobre superfície suave, ausência de tema paralelo, controles e shell.
- Suítes visuais existentes atualizadas de forma seletiva: `m8-contrato-cor`, `missao6-shell`, `missao7-visual`, `m10-identidade-persistente`, `m11-preview-sidebar`, `premium-refine`, `godoutor-visual`, `visual-convergence` e `status`.
- Execução focada anterior: 13 arquivos, 218 testes aprovados. Na validação imediatamente anterior ao workspace, 10 arquivos / **101 testes aprovados**, mais typecheck e build aprovados.
- Execução full imediatamente anterior ao workspace: **2.505/2.511 aprovados**. Falhas: `a34-instagram` ×3, `automation-audit-p4`, `pipeline` e um caso de `whatsapp-robustness.test.ts`. A execução atual está registrada ao final. Os testes de Encounter, Pet 360 e deep-link impactados por helpers passaram naquela etapa.
- Browser e screenshots continuam pendentes. A tentativa de instalar Chromium via Playwright falhou por `ECONNRESET` em `cdn.playwright.dev`, sem navegador de sistema disponível; nenhum render, F5 ou viewport foi inspecionado visualmente.

## Fechamento complementar: overlays, anamnese e itens diferidos

### Segunda varredura de superfícies editáveis

Foi feita leitura estática dos usos de `Drawer`, `WorkspaceSheet` e equivalentes no dashboard, incluindo caminhos de fechamento por botão X, Cancelar, Escape, backdrop e navegação. `Drawer` e `WorkspaceSheet` encaminham dismissals para a primitiva compartilhada `OverlayDismissGuard`: estados pristine fecham sem confirmação; estado saving bloqueia o descarte; alterações dirty pedem decisão e mantêm o formulário ao escolher continuar editando. Confirmação fica reservada às ações pequenas de descarte, não às superfícies informativas.

- **Protegidos com estado sujo/salvando:** Novo pet (`PetsSection`), Novo Agendamento e criação de cliente aninhada (`NewBookingSheet`/`NewClientSheet`), edição de cliente (`ClientProfileDrawer`), acesso de membro, quick-register, importação, formulários de catálogo, etapas do funil, pagamento, automações, editor de anamnese e reagendamento de booking. `EncounterSheet` mantém o autosave e a concorrência otimista existentes, com proteção de navegação/fechamento quando há edição não persistida ou erro.
- **Anamnese:** continua sheet contextual. Campos booleanos distinguem “Não informado”, “Sim” e “Não”; respostas persistidas antigas `true/false` são formatadas como “Sim”/“Não”. Após salvar, a resposta é enviada ao estado pai antes do fechamento; o histórico abre com labels humanos e é somente leitura.
- **Check-in:** a ação atualiza o booking no detalhe e não fecha `BookingDetailSheet`; o estado “Chegou” e a possibilidade existente de desfazer permanecem associados à lógica atual, sem refazer papéis/estados.
- **Superfícies sem formulário sujo:** sheets informativas/de leitura, seletores sem dados digitados e detalhes sem edição permanecem livres de confirmação. Isso evita modal de descarte em uso pristine/informativo.
- **Novo Agendamento:** preservado como sheet lateral à direita; a mudança de primitiva não o converte em modal central. Anamnese permanece contextual; confirmação central é apenas confirmação.
- **Cobertura nesta rodada:** `manual-homologation-overlays.test.tsx` exercita Novo pet e Anamnese em dirty + backdrop/Escape/X, Novo pet pristine + backdrop, booleano não informado, callback/ordem do save e histórico legado `false`. `WorkspaceSheet.test.tsx`, `overlay-dismiss-guard.test.tsx`, `fase2-ws-sheet-close.test.ts` e `post-homologation-ui.test.ts` cobrem normalização/contrato comum e invariantes adicionais. A cobertura de alguns componentes foi estática/compartilhada; não declarar como execução browser.
- **Contraste e linguagem de anexos:** controles secundários, histórico, slots e disabled usam superfície/borda/texto sem tornar todos os controles primários. Quando upload não está configurado, a interface deve comunicar indisponibilidade de anexos em linguagem de produto; token, env var, stack e provider não são conteúdo para usuário. Nenhuma arquitetura de Storage foi criada.
- **Limite da verificação:** análise foi de fonte e testes automatizados executados abaixo; não houve inspeção visual própria nem browser nesta rodada.

### Diferimentos clínico-operacionais A–M (somente registro)

Todos os itens clínico-operacionais A–M da solicitação permanecem explicitamente fora desta PR de Design System 2.0. Eles não foram implementados, nem usados para alterar domínio, APIs, banco, autenticação, autorização ou regras clínicas. Para manter o limite de escopo rastreável, ficam registrados como trilhas futuras: **A)** F1 / evolução do modelo de atendimento clínico; **B)** matriz de acesso por papel e vínculo profissional; **C)** estados operacionais detalhados de agenda, fila e atendimento; **D)** triagem/priorização clínica; **E)** prontuário especializado e histórico longitudinal; **F)** diagnósticos e codificação clínica; **G)** prescrição/receituário; **H)** vacinas e medicina preventiva; **I)** odontograma e fluxos por especialidade; **J)** internação, cirurgia e procedimentos; **K)** assinatura/documentos clínicos e requisitos regulatórios; **L)** convênios/faturamento clínico; **M)** arquitetura própria de armazenamento/fluxo de anexos. A lista é registro de diferimento, não aprovação de desenho, requisito clínico validado ou autorização para iniciar esses trabalhos. Check-in e ajustes de apresentação pedidos para esta PR são as exceções expressas já limitadas acima; não redesenham máquina de estados nem matriz de permissões.

### Inventário inline — classificação concluída, validação visual pendente

A segunda busca documenta **84 ocorrências atuais**, uma por linha, em `GODOUTOR-UI-AUDIT-V2-INLINE-INVENTORY.md`: geometria/layout calculado; dimensões ou cores semânticas derivadas de dados; previews/temas já existentes; posicionamento de tooltip/rail; impressão; estilos isolados do editor/renderer legado. Um valor fixo de ícone em `AutomationsView` foi removido em favor de utilitários CSS. A classificação por finalidade está feita; não se promete equivalência visual dos casos dinâmicos até a conferência browser. Isso substitui a nota antiga que dizia simultaneamente que faltava classificar as 84 ocorrências.

### Validação complementar desta rodada

- Testes focais: **10 arquivos / 101 testes aprovados**, incluindo 11 testes interativos de Novo pet/Anamnese.
- `npm run typecheck`: aprovado após as últimas alterações de código.
- `npm run build`: aprovado; 132/132 páginas estáticas geradas.
- `npm test`: 2.505/2.511 aprovados; apenas as cinco falhas da baseline conhecida e a falha WhatsApp previamente reproduzida ficaram vermelhas.
- PR #43 segue OPEN/DRAFT; não houve merge. Browser/render/capturas permanecem pendentes e não foram alegados.

## Continuação — `/conversas` como workspace de atendimento

### Contrato implementado (fonte e testes; não é homologação visual)

- **Desktop:** o shell da rota ocupa o espaço abaixo da topbar até o fim da viewport; rodapé e max-width editorial não competem com o workspace. A grade prevê inbox de ~280–340 px, conversa central flexível e contexto de ~280–310 px. A timeline usa o espaço vertical restante sem max-height artificial; o composer permanece no rodapé da coluna. O contexto administrativo pode ser recolhido, liberando a largura para a conversa.
- **Tablet:** inbox e conversa permanecem lado a lado; o contexto usa sheet sob demanda, sem terceira coluna estreita.
- **Mobile:** CSS alterna inbox e conversa full-screen com `data-active`; o botão Voltar retorna à lista, o composer respeita safe-area inferior e o contexto é um `WorkspaceSheet`. Os atalhos de contexto não são duplicados entre toolbar e cabeçalho do chat em telas compactas.
- **Contexto:** mostra tutor, pets e paciente corrente quando veterinária, além de agendamento/responsável/oportunidade e atalhos administrativos. Não inclui prontuário. Agendar, tarefa, paciente, CRM e oportunidade/agenda continuam acessíveis sem duplicar a mesma ação na mesma região.
- **Comportamentos mantidos:** WhatsApp/Instagram, busca e filtros de canal/unread/aguardando/falhas, seleção, `?c=`, `?q=` e `?canal=`, drafts por conversa, timeline/status/retry, composer e restrições de canal, IA↔humano/handoff, cadastro/vínculo de contato e `QuickRegisterSheet`, estado de desconexão e incompatibilidade de conta. Nenhuma API, backend, webhook, autenticação ou política de canal foi alterada.
- **Baixo risco:** modo foco e nova janela foram mantidos como ações reversíveis; a URL completa (unidade, conversa e filtros) é copiada para a nova janela. A sidebar permanece em seu modo normal para evitar impacto transversal sem benefício seguro nesta missão.
- **Cobertura da missão:** `src/components/__tests__/ConversationsWorkspace.test.tsx` cobre estado vazio sem seleção, filtros, seleção/status IA-humano, contexto veterinário, timeline/composer/envio, draft por conversa, deep-link/URL e comportamento mobile/sheet. `src/lib/__tests__/ui-refinement-v2.test.ts` também verifica o contrato responsivo e a timeline sem limite artificial.
- **Limite:** os itens acima foram revisados por fonte e testes automatizados. A inspeção de layout/overflow/interação em browser, capturas e temas é responsabilidade da homologação visual no Preview; 1440/1366/390 e temas seguem pendentes.
- **Validação após o workspace:** typecheck passou; os testes focais passaram (**6 arquivos / 78 testes**); `npm run build` passou com **132/132** páginas; `git diff --check` passou.
- **Suíte completa:** `npm test -- --reporter=dot` resultou em **2.513 aprovados / 6 falhas / 2.519 testes**. As falhas observadas são as três existentes em `a34-instagram`, `automation-audit-p4`, `pipeline` (datas de agendamento passadas) e `whatsapp-robustness`; a baseline desta PR já registrava as mesmas seis falhas, sem relação com o workspace.

## Aditivo de homologação global — PR #43 (contrato de apresentação; browser pendente)

Este aditivo registra as correções estáticas feitas para a rodada de contraste/seleção sem declarar homologação visual. O catálogo de rotas continua autoridade da largura; comportamento de domínio, APIs, agente, clínica e canais não foi redesenhado.

### Alterações e limites

- **Foreground de soft/icons:** no workspace, `--brand-fg` agora referencia `--accent-fg`, foreground validado contra `--accent-soft` e superfícies claras. Preenchimentos sólidos continuam usando o contrato próprio de CTA (`--accent-contrast`); mensagens success/warning/danger com texto branco sobre fundos semânticos fortes permanecem exceções válidas. Deep Blue, Verde, Neutro e Vinho ganharam asserts de contraste.
- **Sidebar:** hover de links, ícones de colapso, cabeçalho de grupo e submenu usam `--il-nav-hover`/`--il-nav-fg` sem inverter o foreground normal. A rota ativa preserva o par independente `--il-nav-active`/`--il-nav-active-fg`; accordion aberto, rail recolhido e focus-visible mantêm contratos próprios.
- **Page Architecture:** a largura agora deriva de `pageType` e `PageFrame` com tokens: workspace sem limite, record/hub 1280px, detail 1440px e form 960px. Agenda e Conversas mantêm flush/gutter próprios; não estreitar essas telas, kanban ou workspaces operacionais. Ver a matriz completa acima.
- **Controles selecionáveis:** foi criado `il-option-choice` (surface neutra, contorno accent, `--accent-fg`, hover discreto e focus ring oficial). Aplicação restrita a opções/seleções — Assistente, modos de retorno, histórico multiselect, períodos, papéis, dias e horários selecionáveis. Tabs, badges, sidebar, estados de canal e CTAs não são convertidos por conveniência. Atendimento/anamnese mantêm estrutura, autosave, histórico, read-only e vínculos; aqui muda apenas apresentação.
- **Cliente 360:** a variante page recebe o destino da lista. `clientListReturnHref(search, fallbackBusinessId)` preserva `b`, `q`, `filter`, `page` e `tab` suportada e usa o business resolvido como fallback de deep-link sem estado; o retorno é um link real, não `history.back()`.
- **Toolbar Cliente 360:** a ação WhatsApp usa a primitiva visual `secondary` (surface/borda neutras, foreground constante e hover oficial), sem cor de CTA em hover. Reserva de ação primária para agendamento permanece.
- **Página `/agente`:** apresentação migrou para panels, fields, tokens e option chips. Contratos de fetch/save e conteúdo/configuração foram mantidos; não houve mudança de IA, APIs, canais ou comportamento.
- **Ações rápidas:** ícones têm contêiner neutro com foreground `--accent-fg`; hover do conjunto é neutro/discreto, sem semântica success/warning ornamental.
- **Back action:** Atendimento full-page e Cliente 360 usam `PageBackAction` compartilhada. A ação clínica continua passando pelo guard de fechamento existente.

### Classificação da varredura de paleta/utilitários

A busca conjunta por `text-white`, `text-zinc-*`, `bg-white`, `bg-zinc-*`, `opacity-*`, `border-2`, `accent-soft`, `brand-soft`, `hover:text-*` e `hover:bg-*` produziu 873 linhas de correspondência (algumas linhas têm mais de uma classe; não é uma contagem de defeitos).

1. **Válidos — manter:** texto branco em CTAs sobre fills de contraste, feedback semântico, blocos/status de agenda, bolhas/elementos de canal; dimensões/contornos de spinner, overlays e ícones decorativos; `border-2` em focos/handles/pontos que têm propósito geométrico.
2. **Migráveis — corrigidos nesta rodada:** alias de foreground soft; hover sidebar; estilos legado-zinc e campos/panels da apresentação `/agente`; quick actions; seleções de período, modo de retorno, histórico, papéis, dias e horários; hover WhatsApp; destino de retorno do Cliente 360.
3. **Exceções semânticas/de canal:** sucesso, aviso, erro, status de conectado e ações primárias continuam com cores semânticas/foreground próprio; a identidade do WhatsApp/Instagram fica restrita à identificação do canal, nunca ao foreground genérico de hover. Não aplicar option-chip a tabs/badges.
4. **Fora do redesign desta PR:** renderer público, page-builder/editor e previews que precisam conservar identidade própria, estilos dinâmicos gerados por dados e superfícies de impressão existentes. `text-white`/`bg-white` em artefatos de exportação ou apresentação são avaliados pelo contexto, não removidos globalmente.

### Diferimentos explícitos

- Nenhum documento/PDF, assinatura, compartilhamento, envio de documento por WhatsApp ou melhoria de impressão foi implementado. Esses itens permanecem **deferred** para outra iniciativa; a busca encontrou superfícies/ações de impressão já existentes, que ficam fora de alteração nesta PR.
- Workflow Clínico/F1 permanece fora de escopo; APIs/backend/webhooks e política de canal não foram alterados.
- A leitura de fonte e testes não substitui inspeção de browser. Capturas/checagem visual em 1440, 1366 e 390 px e inspeção final do usuário continuam **pendentes**; PR #43 permanece aberta/em draft, sem merge.

### Validação executada nesta rodada

- `npm run typecheck`: aprovado.
- Testes focais: **8 arquivos / 133 testes aprovados**, incluindo retorno Cliente 360, catálogo de width, foreground nos temas, seleção, sidebar, Atendimento/Anamnese e toolbar.
- `npm run build`: aprovado; **132/132** páginas estáticas geradas.
- `npm test -- --reporter=dot`: **2.524 aprovados / 6 falhas / 2.530 testes**. Falhas reproduzidas fora deste escopo: três em `a34-instagram.test.ts`, uma em `automation-audit-p4.test.ts`, uma em `pipeline.test.ts` (agendamento no passado) e uma em `whatsapp-robustness.test.ts`. A falha de contrato antigo do submenu provocada pelo uso correto de `--il-nav-*` foi atualizada; não há falha focal pendente desta rodada.
- `git diff --check`: aprovado. Preview de desenvolvimento disponível em `:3001`; nenhuma inspeção/captura de browser foi realizada pelo agente nesta etapa.

## Aditivo — correções reproduzidas V01–V10 e superfícies da Página legada

Este aditivo registra a correção estática dos dez itens da auditoria e a limpeza de copy/indicadores atrás da flag existente. Não é redesign nem homologação visual. Os testes desta rodada validam regras de apresentação e condições de renderização; a checagem final em Preview continua pendente.

| ID | Superfície | Correção aplicada / evidência automatizada | Estado visual |
|---|---|---|---|
| V01 | Visão geral · Intelligence | Grid 2×2 por padrão; `@container` só passa a quatro colunas quando o próprio card mede 560px ou mais. Rótulos quebram naturalmente e valores não são truncados. Coberto por `ui-audit-v01-v10.test.ts`. | Preview pendente |
| V02 | Próximos atendimentos | Nome ocupa a primeira linha sem truncamento; data/hora, serviço e status fluem na linha de detalhes sem competir com a identificação do cliente. Teste de contrato estático incluído. | Preview pendente |
| V03 | Cliente 360 · mobile | Identificação vira grade própria (avatar + coluna de nome), badge desce para uma linha separada; dados passam a uma coluna e valores deixam de ser truncados no mobile. As regras novas ficam limitadas até 767px; desktop mantém o layout original. | Preview pendente |
| V04 | Pendências · mobile | Corpo textual fica acima da região de ações, que pode quebrar linha; Editar/Cancelar mantêm alvo mínimo de 44px em telas estreitas. Badge de automação permanece visível. | Preview pendente |
| V05 | Agente | “Salvar agente” saiu do sticky sobreposto e está no fluxo normal após os campos da configuração. Nenhuma lógica ou payload de agente foi alterado. | Preview pendente |
| V06 | Sidebar | Chevron fechado usa `--il-nav-fg`; estados ativo/expandido continuam herdando o foreground do respectivo token. Testes checam contraste AA em Branco, Azul profundo, Verde sálvia e Ônix. | Preview pendente |
| V07 | Financeiro · WorkspaceSheet | Formulário de Nova/Editar movimentação usa padding `p-4` no body, acompanhando os 16px do footer do contrato compartilhado. Domínio financeiro não foi alterado. | Preview pendente |
| V08 | Agenda · Dia mobile | Eventos Dia recebem apresentação compacta: hora e nome permanecem, nome pode ocupar até duas linhas e somente serviço/profissional são ocultados em viewport estreita; estado continua no ícone/label acessível e os detalhes seguem no evento acionável. Dia/Lista e o scroller existente permanecem. | Preview pendente |
| V09 | Atendimento mobile | A confirmação de autosave “Salvo agora” fica em um único lugar na página full-page; ações secundárias foram agrupadas e mantêm alvo de toque, com “Finalizar atendimento” como ação destacada. Safe-area e fluxo clínico continuam existentes. | Preview pendente |
| V10 | Datas | `formatDateTimeBR` compartilhado padroniza `DD/MM/AAAA` e, quando há hora, `DD/MM/AAAA HH:mm` em Pendências, Anamnese, conversas/contexto e superfícies diretamente relacionadas. Apenas apresentação mudou; persistência e APIs não. | Preview pendente |

### Flag da Página legada

- Com `GODOUTOR_LEGACY_PAGES` desligada, o card Presença online e a série/métricas de Página no Dashboard deixam de renderizar; Resultados não solicita nem apresenta analytics, funis ou vitrine exclusivos da Página; Agente e Configurações usam copy operacional neutra e escondem instruções/controles exclusivos do editor; Novo Agendamento deixa de dizer que o cliente tem conta “na sua página”.
- Com a flag ligada, os caminhos e conteúdo legados suportados continuam condicionados ao mesmo contrato `isLegacyPagesEnabled()`. Nenhum dado, endpoint, `/pagina`, `/{slug}`, agendamento público, deep link, canal ou nome do domínio Produtos foi removido/renomeado. O estado salvo de canal não é alterado ao esconder o controle de Site com a flag OFF.
- Cobertura: `src/lib/__tests__/ui-audit-v01-v10.test.ts` verifica os dez contratos, formato de data e estados da flag OFF/ON; `legacy-page-operational-surfaces.test.ts` continua cobrindo as rotas/entradas preservadas.

### Validação desta rodada

- `npm run typecheck`: aprovado.
- Testes focais: **7 arquivos / 107 testes aprovados** (UI audit, flag legada, timezone, conversas, atendimento e regressões relacionadas).
- `npm run build`: aprovado; **132/132** páginas estáticas geradas.
- `npm test -- --reporter=dot`: **2.547 aprovados / 5 falhas / 2.552 testes**. Falhas atuais fora do escopo: três em `a34-instagram.test.ts`, uma em `automation-audit-p4.test.ts` e uma em `pipeline.test.ts` (fixture agenda no passado). A sexta falha baseline documentada em `whatsapp-robustness.test.ts` não se reproduziu nesta execução; não foi alterada nem mascarada.
- `git diff --check`: aprovado. Inspeção de browser/capturas e confirmação nos viewports 1440/1366/390 **não foram realizadas**; os dez itens continuam pendentes de conferência visual no Preview e nenhum foi chamado de homologado visualmente.

## Aditivo — convergência final reportada após HEAD `ff9b2db`

O usuário informou que no HEAD `ff9b2db` aprovou manualmente Dashboard, Agenda, Conversas, Cliente 360 desktop, Pendências desktop/tablet, centralização e chevrons. Este aditivo registra somente os pontos restantes da rodada de fechamento; aprovação reportada não equivale à inspeção visual deste novo HEAD.

- **Topbar/popovers:** `ViewportPopover` compartilhado posiciona “+”, sino, busca e perfil com margem segura, limite pela viewport, alinhamento/clamp horizontal e inversão vertical. A pesquisa de Busca usa largura do campo. A primitiva reavalia scroll/resize/ResizeObserver e mantém tokens do workspace ao escapar dos containers de clipping. Help abre WorkspaceSheet, não usa popover.
- **Novo agendamento + cadastro:** presets semânticos compartilhados de WorkspaceSheet substituem larguras ad hoc; cadastro lateral tem 512px máximos e não encolhe. A partir de 1360px há dois painéis; abaixo disso o cadastro ocupa a faixa quando a largura útil não comporta ambos, sem modal central/compressão.
- **Acesso do cliente:** investigação de `/api/contacts` confirmou que `createAccount` cria/vincula identidade Customer genérica, também consumida por autenticação e pelos endpoints de consultas/pedidos do portal do cliente. Preservada a funcionalidade e identidade; rótulo passou a “Criar acesso do cliente”, sem referência à Página.
- **Jitter da sidebar:** causa identificada no `.workspace-primary`: scrollbar vertical clássica alterava a largura útil do nav rolável, deslocando alguns pixels os ícones centralizados no rail recolhido. `scrollbar-gutter: stable` mantém a geometria. O rail/sidebar têm largura fixa/flex-shrink zero; o `ResizeObserver` do shell só publica `--sheet-left` para sheets, sem medir ou redimensionar ícones.
- **Configurações:** convergência apenas de “Informações do negócio” para “Dados da clínica”; campos de contato, redes/site externo, endereço/mapa, Agenda e Aparência foram preservados.
- **Escopo encaminhado para #44 Workflow + Permissões (não iniciado nesta PR):** lógica temporal de Pendências; criação prematura de “Preparar atendimento”; regras recepção x veterinário; conclusão clínica; retorno/follow-up; novas permissões.
- **Validação visual pendente deste novo HEAD:** conferir primeiro 1440, 1366 e 1024; 390 como sanity check. Não declarar homologação visual até essa conferência.

### Validação — fechamento final da convergência

- `npm run typecheck`: aprovado.
- Testes focais: **8 arquivos / 103 testes aprovados**, incluindo geometria/clamping do popover, cadastro Customer, presets do sheet e regressões do fluxo de agendamento.
- `npm run build`: aprovado; **132/132** páginas estáticas geradas.
- `npm test -- --reporter=dot`: **2.556 aprovados / 5 falhas / 2.561 testes** (177 arquivos aprovados, 3 com falha). Restaram as três falhas de `a34-instagram.test.ts`, uma de `automation-audit-p4.test.ts` e uma de `pipeline.test.ts`; a fixture de pipeline agenda no passado. As duas expectativas antigas do painel de agendamento foram atualizadas para os novos presets e passaram focadas. `whatsapp-robustness.test.ts` não falhou nesta execução. Nenhuma falha foi mascarada nem alterada fora do escopo.
- `git diff --check`: aprovado. Conferência visual deste novo HEAD ainda pendente; usar Preview priorizando 1440, 1366 e 1024, com 390 como sanity check.

## Missão final de polimento da PR #43 — classificação e evidências

A classificação abaixo distingue homologação reportada anteriormente pelo usuário de correção estática desta missão. As mudanças de código desta missão não foram consideradas visualmente homologadas: é necessário abrir as rotas reais nos viewports indicados.

### HOMOLOGADO (reportado anteriormente pelo usuário)

- Agenda desktop, Conversas, Cliente 360 desktop, Dashboard, Atendimento desktop, além das telas desktop aprovadas enumeradas no escopo da PR. A aprovação reportada é referência para não regressão; não implica revalidação deste HEAD.

### CORRIGIDO nesta missão (implementação em fonte; homologação visual pendente)

- **Atendimento:** header sticky mantém estado normal com Voltar/contexto e troca para compacto após o marcador cruzar a topbar; no compacto mantém paciente/tutor, data/hora, profissional e status. A ActionBar continua sticky e os fluxos clínicos não foram alterados.
- **Cliente 360 estreito:** identidade/badges/ações reorganizados sem depender de compressão; cards de pets usam a largura disponível; tabs mantêm uma linha com rolagem horizontal, indicador de continuidade, suporte a teclado e `scrollIntoView` para revelar a tab focada. Desktop não recebeu regra de layout nova.
- **Busca global:** `ViewportPopover` continua sendo a solução compartilhada; em viewport estreita o resultado ganha largura preferencial (clampado às margens da viewport), sem herdar a largura reduzida do trigger.
- **ConfirmDialog:** composição centralizada/compacta, com ações centradas e distinção secondary/outline para continuar editando e destructive para descartar.
- **Cadastro de paciente dentro do novo agendamento:** preserva o painel aninhado, usa presets compartilhados de largura e recebe subtítulo no cabeçalho do painel. O estado de cadastro substitui a área do booking quando não há largura para composição lado a lado; o retorno e seleção do paciente recém-criado permanecem no fluxo existente.
- **Agenda:** clique em célula vazia com horário determinável transforma somente data, hora e profissional em seed inicial de `NewBookingSheet`; a ausência de profissional continua vazia. Não cria reserva nem altera validações. Adicionado teste focal de mapeamento/wiring.

### DEFERIDO (fora da implementação da #43)

- **Seleção de duração por arraste estilo Google Calendar:** nenhum drag-selection novo foi implementado nesta PR. Componentes atuais relevantes: `GridColumn` e o handler `onEmptyPress` em `src/app/(dashboard)/agenda/page.tsx`; movimento de reserva existente passa por `onPressStart`/`onPressMove`/`onPressEnd` e pelos helpers de `src/lib/agenda-drag.ts`. Riscos: confundir seleção de horário vazio com arraste de reserva/drop; disparar clique/criação após um gesto; diferenças de pointer capture/toque e acessibilidade por teclado; cobrir status de indisponibilidade sem sugerir confirmação válida. Evolução sugerida: selecionar somente em célula vazia, mostrar overlay provisório durante o gesto, cancelar sem seed/reserva em Escape/cancelamento ou em conflito com interação de bloco, e abrir `NewBookingSheet` com data/hora (e duração sugerida) ao soltar; disponibilidade e validação continuam pertencendo ao fluxo de booking existente. **Propriedade:** o snap deve ser controlado pela geometria/configuração da grade (reutilizando `minuteFromOffsetY`/passo da Agenda, sem criar um segundo passo); a duração sugerida deve ser controlada pela interação de seleção da Agenda (intervalo inicial/final quantizado pelo mesmo snap), enquanto serviço, disponibilidade e aceitação final permanecem sob `NewBookingSheet`/validações existentes. Refinar limiares, touch/teclado e confirmação em missão própria antes de codificar.
- Homologação em browser destas correções: pendente, com prioridade 1366 e 1024; sanity check em 1440 e 390. Sem browser disponível, registrar fonte/testes e manter o estado visual pendente.

### Validação da missão final de polimento

- `npm ci`: dependências instaladas sem alterar manifests/lockfile; o npm reportou 2 vulnerabilidades na árvore de dependências (1 alta, 1 crítica), não corrigidas nesta missão.
- `npm run typecheck`: aprovado.
- Testes focais: **4 arquivos / 31 testes aprovados** (`ui.test.tsx`, `a34-agenda.test.ts`, `agenda-cell-prefill.test.ts`, `viewport-popover.test.ts`). O teste do clique de célula também confere o wiring do seed para as props iniciais de data/hora de `NewBookingSheet`.
- `npm run build`: aprovado; **132/132** páginas estáticas geradas.
- `npm test -- --reporter=dot`: **2.567 aprovados / 5 falhas / 2.572 testes** (179 arquivos aprovados, 3 com falhas). Falhas atuais: três em `a34-instagram.test.ts`, uma em `automation-audit-p4.test.ts` e uma em `pipeline.test.ts` (fixture tenta agendar no passado). Coincidem com o conjunto de falhas preexistentes registrado no fechamento anterior; nenhuma foi ocultada ou alterada nesta missão.
- `git diff --check`: aprovado.
- **Browser/homologação visual:** não realizada; não havia Chromium/browser instalado no ambiente (`~/.cache/ms-playwright` sem executáveis e nenhum Chromium/Chrome no PATH). Não afirmar aprovação visual para estas correções. Conferir Atendimento, Cliente 360, Busca, Novo agendamento e ConfirmDialog em 1366 e 1024 primeiro; sanity check em 1440 e 390.
