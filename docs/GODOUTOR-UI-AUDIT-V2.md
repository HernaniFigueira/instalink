# Auditoria de UI GoDoutor v2 — matriz por rota

> **Objetivo:** registrar a revisão do contrato existente, rota a rota, sem declarar inspeção visual que não aconteceu. Esta matriz separa evidência de fonte/teste de evidência de browser. As colunas de viewport permanecem **PENDENTES** até capturas reais em 1440, 1366 e 390 px.
>
> **Escopo autenticado:** catálogo de `src/lib/panel.ts` mais a rota de detalhe `/clientes/[id]`. A página pública, renderer e booking público continuam fora do redesign.

## Resultado resumido e evidência disponível

- [x] Contrato atualizado em `GODOUTOR-UI-CONTRACT.md`.
- [x] Default da preferência pessoal aponta ao preset existente `azul-profundo`; os 21 presets permanecem; preferência válida `godoutor.nav-accent` não é sobrescrita pelo default.
- [x] Guardas de fonte/token/contraste e regressão adicionadas em `src/lib/__tests__/godoutor-ui-contract-v2.test.ts`; a cobertura inclui todos os 21 presets, persistência simulada, invariantes do shell/primitivas, escopo do bridge semântico e sincronização da matriz com o catálogo de rotas.
- [x] Testes visuais legados que exigiam fundo gradiente, topbar colorida, default neutro, cards creme ou CTA violeta foram atualizados para o contrato aprovado. Comportamento/negócio não foi alvo dessas alterações.
- [x] Acentos históricos de pet/paciente, anotação administrativa, métrica, “hoje” e setup foram neutralizados ou ligados ao accent; contextos antes lilás convergem para info ou accent. Estados da agenda foram levados a tokens semânticos.
- [x] Suíte focada visual + novo contrato + status: **181/181 testes aprovados**.
- [x] Suíte completa: **2.463 aprovados / 6 falhas / 2.469 testes**. Cinco falhas coincidem com a baseline conhecida (`a34-instagram` ×3, `automation-audit-p4`, `pipeline`). Uma sexta falha apareceu em `whatsapp-robustness.test.ts` (fluxo de agendamento) e foi reproduzida isoladamente; esse teste e as rotas/serviços WhatsApp não foram alterados neste patch. Não a rotulo como preexistente sem evidência de baseline; fica registrada como divergência não visual, a investigar separadamente. O delta de onze testes é o contrato v2.
- [x] Suíte focada visual/contrato/status: **181/181 aprovados**.
- [x] `npm run typecheck` aprovado depois das últimas edições; `npm run build` (Next.js production) também aprovado.
- [ ] Browser/render/capturas de todas as rotas em desktop e mobile: **não realizado nesta etapa**. Nenhuma rota abaixo está marcada como visualmente homologada. Playwright não encontrou Chromium instalado; `npx playwright install chromium` falhou com `ECONNRESET` ao baixar de `cdn.playwright.dev`. Portanto não há screenshots e nenhuma rota foi declarada visualmente aprovada.
- [ ] Temas críticos verde/neutro/vinho, reload F5 e segunda varredura: pendentes.

## Matriz de rotas autenticadas

“Inspeção estática” indica uma revisão de fontes/classes/tokens e não substitui a tela renderizada. “Browser” permanece pendente em todas as linhas até existir evidência visual registrada.

| Rota | Área / arquivo principal | Superfícies e comportamento a reauditar | Inspeção estática | 1440 | 1366 | 390 | Temas Deep Blue / verde / neutro / vinho |
|---|---|---|---|---|---|---|---|
| `/dashboard` | Visão geral — `app/(dashboard)/dashboard/page.tsx` | Header de identidade do workspace, 6 métricas em superfície neutra, listas/gráficos, quick actions | Parcial: métricas deixaram creme; chips contextuais preservados | Pendente | Pendente | Pendente | Pendente |
| `/estrutura` | Estrutura — `app/(dashboard)/estrutura/page.tsx` | Hub de serviços, profissionais, horários e acessos; cards/atalhos | Pendente | Pendente | Pendente | Pendente | Pendente |
| `/agenda` | Agenda — `app/(dashboard)/agenda/page.tsx` | Toolbar densa, grade, status semânticos, fila lateral, drawers e quick-create | Parcial: fundo externo neutro; `BOOKING_BLOCK`/pontos usam tokens semânticos | Pendente | Pendente | Pendente | Pendente |
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
- **Inline styles:** 91 atributos `style={...}` foram encontrados. A maior parte é largura/altura/posição derivada de dados (agenda/gráficos/rail) ou cores via tokens; restam itens para classificação manual, em especial preview do preset e casos dinâmicos de gráficos.
- **Hexes:** 7 correspondências de regex incluíram um fragmento de comentário de erro React; as declarações visuais restantes pertencem a preview/editor público ou tratamento de impressão e não foram redesenhadas neste escopo. A lista de exceções precisa ser anexada por arquivo na rodada final.
- **Ações globais:** não foi encontrado FAB global concorrente de Conversas. O atalho de Conversas permanece integrado à topbar; posição fixa encontrada é tooltip, aviso/toast e preview/editor legado. O teste v2 trava a ausência da shortcut fixa.

Ainda falta fechar/classificar integralmente cada ocorrência inline e verificar os efeitos em tela real. A compatibilidade por token não substitui a reauditoria visual.

- [x] Segunda busca de classes de cor + normalização semântica com escopo e guarda de regressão.
- [x] Busca de radius/shadow/FAB e substituição das declarações estruturais avulsas encontradas nos seletores do workspace.
- [ ] Classificar as 91 ocorrências inline uma a uma e publicar exceções por arquivo; conferir gráficos, editor e estados variáveis.
- [ ] Conferir em browser que tokens escopados não afetam renderer/editor/booking público nem login homologado.
- [ ] Reexecutar e arquivar a busca final depois da auditoria inline e visual.

### Regressão e browser

- [x] `npm run typecheck` passou; `npm test` executou 2.469 testes (2.463 aprovados, 6 falhas: as cinco da baseline informada + uma falha WhatsApp fora dos arquivos alterados, reproduzida isoladamente; sem atribuí-la como preexistente).
- [x] Contraste AA automatizado dos tokens para os 21 presets (`--accent-fg × --accent-soft`, `--accent-contrast × --accent` e pares de sidebar/ativo). Isso não é renderização dos componentes em browser.
- [ ] Carregar e renderizar todas as rotas da matriz a 1440, 1366 e 390 px; capturar screenshot por viewport/rota e anotar overflow, recorte, contraste e interação.
- [ ] Em `/dashboard`, `/agenda`, `/conversas`, `/clientes`, `/funil` e `/configuracoes`, repetir em `azul-profundo`, verde, neutro e vinho; fazer F5 em cada preferência salva válida.
- [ ] Reabrir as seis rotas críticas após a segunda varredura. Registrar links/arquivos das capturas antes de declarar homologação.
- [x] `npm run build` concluído com sucesso; o build de produção compilou e gerou 131 páginas estáticas.

## Testes/evidências atuais

- Fonte: `src/lib/__tests__/godoutor-ui-contract-v2.test.ts` — default, 21 presets, contraste de nav/ativo/acento/texto sobre superfície suave, ausência de tema paralelo, controles e shell.
- Suítes visuais existentes atualizadas de forma seletiva: `m8-contrato-cor`, `missao6-shell`, `missao7-visual`, `m10-identidade-persistente`, `m11-preview-sidebar`, `premium-refine`, `godoutor-visual`, `visual-convergence` e `status`.
- Execução focada final: 11 arquivos, **181 testes aprovados**. `npm run typecheck` e `npm run build` aprovados.
- Execução full final: **2.463/2.469 aprovados**. Falhas: `a34-instagram` ×3, `automation-audit-p4`, `pipeline` (baseline documentada) e o caso de agendamento em `whatsapp-robustness.test.ts` (falha reproduzida isoladamente, não atribuída como baseline nem como efeito visual deste patch).
- Browser e screenshots continuam pendentes. A tentativa de instalar Chromium via Playwright falhou por `ECONNRESET` em `cdn.playwright.dev`, sem navegador de sistema disponível; nenhum render, F5 ou viewport foi inspecionado visualmente.
