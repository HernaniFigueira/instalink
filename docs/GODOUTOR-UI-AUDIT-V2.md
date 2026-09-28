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
- [x] Suíte focada desta rodada: **101/101 testes aprovados** (10 arquivos), incluindo regressões clínicas e overlays.
- [x] Suíte completa nesta rodada: **2.505 aprovados / 6 falhas / 2.511 testes**. Cinco falhas são a baseline conhecida (`a34-instagram` ×3, `automation-audit-p4`, `pipeline`). A sexta, `whatsapp-robustness.test.ts` (fluxo de agendamento), também foi reproduzida na main e no HEAD anterior da PR, como registrado na comparação histórica abaixo; é independente deste escopo.
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
| `/conversas` | Conversas — `app/(dashboard)/conversas/page.tsx` + `ConversationsView.tsx` | Lista + conversa, badge de contato, composer, quick action global e sheet multilocal | Parcial: badge “contato novo” agora é info; atalho permanece na topbar | Pendente | Pendente | Pendente | Pendente |
| `/agente` | Assistente — `app/(dashboard)/agente/page.tsx` | Preferências de tom/objetivo, formulários, prévia e estados | Parcial: seleções usam accent-soft/accent-fg em vez de lilás decorativo | Pendente | Pendente | Pendente | Pendente |
| `/tarefas` | Pendências — `app/(dashboard)/tarefas/page.tsx` + `TaskPanel.tsx` | Resumo de fila, atrasos reais, itens/ações, empty/error state | Parcial: “para hoje” não usa cor de warning | Pendente | Pendente | Pendente | Pendente |
| `/pedidos` | Pedidos — `app/(dashboard)/pedidos/page.tsx` | Tabela/lista e ciclo de status, filtros e detalhe | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/clientes` | Clientes — `app/(dashboard)/clientes/page.tsx` | Lista, filtros, paginação, seleção, consentimento e cadastro | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/clientes/[id]` | Detalhe 360 — `app/(dashboard)/clientes/[id]/page.tsx` + `ClientProfileDrawer.tsx` | Identidade, anotações administrativas neutras, ficha/pets e sheets | Parcial: anotações saíram de amarelo sem semântica; preservados handlers de persistência | Pendente | Pendente | Pendente | Pendente |
| `/funil` | Oportunidades — `app/(dashboard)/funil/page.tsx` + `EsteiraView.tsx` | Kanban, badges e transições de etapa | Parcial: status agora usa info/warning/success/danger; rever estados em browser | Pendente | Pendente | Pendente | Pendente |
| `/servicos` | Serviços — `app/(dashboard)/servicos/page.tsx` + `catalog-panels.tsx` | Catálogo, formulários, seleção, exclusão e mensagens | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/produtos` | Produtos — `app/(dashboard)/produtos/page.tsx` | Catálogo público administrado, estoque, forms e status | Pendente; renderer público fora do redesign | Pendente | Pendente | Pendente | Pendente |
| `/campanhas` | Campanhas — `app/(dashboard)/campanhas/page.tsx` | Consentimento, estados de envio, métricas e comunicação | Parcial: explicação antes lilás agora accent suave; cartões de consentimento permanecem semânticos | Pendente | Pendente | Pendente | Pendente |
| `/automacoes` | Automações — `app/(dashboard)/automacoes/page.tsx` + `AutomationsView.tsx` | Receitas, status de execução, filtros e histórico | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/followup` | Follow-up — `app/(dashboard)/followup/page.tsx` | Receita de retorno, elegibilidade e estados do canal | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/canais` | Canais & Integrações — `app/(dashboard)/canais/page.tsx` | Conectividade, configurações, exemplos de código e tokens de canal | Pendente; identidade de canal limitada ao identificador | Pendente | Pendente | Pendente | Pendente |
| `/resultados` | Resultados — `app/(dashboard)/resultados/page.tsx` + `results-view.tsx` | Gráficos, legendas, filtros, comparações e empty states | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/financeiro` | Financeiro — `app/(dashboard)/financeiro/page.tsx` | Entradas/saídas, estados de pagamento, gráficos e forms | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/organizacao` | Organização — `app/(dashboard)/organizacao/page.tsx` | Unidades, troca/criação de unidade, agregados | Parcial: componente usa superfície neutra e acento comum; validar identificação visual em browser | Pendente | Pendente | Pendente | Pendente |
| `/execucoes` | Execuções — `app/(dashboard)/execucoes/page.tsx` | Histórico, detalhes de execução, success/failure e mensagens | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/pagina` | Editor da página — `app/(dashboard)/pagina/page.tsx` | Shell autenticado, editor e prévia | **Exceção**: editor/page-builder legado não é redesenhado; apenas não pode sofrer regressão de seletor global | Pendente | Pendente | Pendente | Fora do redesign; não regredir |
| `/perfil` | Meu perfil — `app/(dashboard)/perfil/page.tsx` | Form pessoal, avatar, foco e feedback | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/equipe` | Equipe — `app/(dashboard)/equipe/page.tsx` | Tabela/lista, papéis, convite, permissões e confirmação | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/recursos` | Recursos — `app/(dashboard)/recursos/page.tsx` | Disponibilidade de módulos, switch, descrições e restrições | Parcial: containers do dashboard neutralizados | Pendente | Pendente | Pendente | Pendente |
| `/configuracoes` | Configurações — `app/(dashboard)/configuracoes/page.tsx` | Abas, aparência, preview/persistência, forms e preferências | Parcial: default e preferência cobertos por testes; preview precisa conferência visual e F5 | Pendente | Pendente | Pendente | Pendente |

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

- [x] `npm run typecheck` passou; `npm test` executou 2.511 testes (2.505 aprovados, 6 falhas). As cinco falhas conhecidas de baseline continuam; a falha WhatsApp foi comparada e reproduzida tanto na main quanto no HEAD anterior da PR.
- [x] Contraste AA automatizado dos tokens para os 21 presets (`--accent-fg × --accent-soft`, `--accent-contrast × --accent` e pares de sidebar/ativo). Isso não é renderização dos componentes em browser.
- [ ] Carregar e renderizar todas as rotas da matriz a 1440, 1366 e 390 px; capturar screenshot por viewport/rota e anotar overflow, recorte, contraste e interação.
- [ ] Em `/dashboard`, `/agenda`, `/conversas`, `/clientes`, `/funil` e `/configuracoes`, repetir em `azul-profundo`, verde, neutro e vinho; fazer F5 em cada preferência salva válida.
- [ ] Reabrir as seis rotas críticas após a segunda varredura. Registrar links/arquivos das capturas antes de declarar homologação.
- [x] `npm run build` concluído com sucesso; o build de produção compilou e gerou 132 páginas.

## Testes/evidências atuais

- Fonte: `src/lib/__tests__/godoutor-ui-contract-v2.test.ts` — default, 21 presets, contraste de nav/ativo/acento/texto sobre superfície suave, ausência de tema paralelo, controles e shell.
- Suítes visuais existentes atualizadas de forma seletiva: `m8-contrato-cor`, `missao6-shell`, `missao7-visual`, `m10-identidade-persistente`, `m11-preview-sidebar`, `premium-refine`, `godoutor-visual`, `visual-convergence` e `status`.
- Execução focada anterior: 13 arquivos, 218 testes aprovados. Nesta rodada, execução focal de 10 arquivos / **101 testes aprovados**, mais typecheck e build aprovados.
- Execução full desta rodada: **2.505/2.511 aprovados**. Falhas: `a34-instagram` ×3, `automation-audit-p4`, `pipeline` (cinco falhas conhecidas da baseline) e um caso de `whatsapp-robustness.test.ts`, confirmado também na main e no HEAD anterior da PR. Os testes de Encounter, Pet 360 e deep-link impactados por helpers foram atualizados para o contrato atual e passaram.
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
