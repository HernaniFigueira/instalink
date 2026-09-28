# Contrato de UI GoDoutor — revisão definitiva v2

> **Escopo:** workspace autenticado GoDoutor. Esta revisão consolida o contrato visual existente; não é um redesign do zero. Ela preserva navegação, permissões, fluxos, dados e comportamento já homologados.
>
> **Fora de escopo:** login homologado no PR #42; banco, migrações, sessão/cookies, isolamento de tenant, permissões e regras de negócio; F1 Clinical Encounter; renderizador, booking público e tema publicado do page-builder. Essas áreas não podem regredir por efeito colateral.
>
> **Estado da homologação nesta revisão:** contrato e guardas de código estão em atualização. Uma verificação de fonte ou teste de tokens não equivale a inspeção visual no browser. Consulte `GODOUTOR-UI-AUDIT-V2.md` para evidências e itens ainda pendentes.

## 1. Princípios e fronteiras do tema

O workspace tem uma única linguagem visual compartilhada. Tema é identidade — nunca uma licença para trocar a semântica, a hierarquia ou a anatomia de componentes.

| Camada | Tokens/uso | Invariante |
|---|---|---|
| **Identidade / acento** | `--accent`, `--accent-hover`, `--accent-soft`, `--accent-border`, `--accent-contrast`, `--accent-fg`; `--il-nav-*` | Pode variar pelo preset pessoal salvo. Não altera status, texto estrutural, fundo, geometria ou layout. |
| **Texto** | `--text`, `--text-strong`, `--text-muted`, `--text-faint`, `--text-soft` | Não acompanha o preset. Texto normal deve permanecer legível; rótulos de estado continuam textuais. |
| **Estrutura** | `--bg`, `--workspace-bg`, `--surface*`, `--border*` | Neutros fixos e iguais em todas as rotas autenticadas. Fundo externo sem gradiente e sem cor de seção. |
| **Semântica** | `--success*`, `--warning*`, `--danger*`, `--info*`; neutros para estado neutro | Verde = sucesso; âmbar = atenção/aviso; vermelho = perigo/erro/destrutivo; azul = informação. Nunca são sobrescritos pelo preset. |
| **Geometria e percepção** | `--radius-*`, `--space-*`, `--control-h*`, `--shadow-*`, tipografia e motion | Únicos no workspace. Tema não pode alterá-los. Elevação é reservada a camadas que realmente flutuam. |

### Presets e persistência

- Os **21 presets existentes** continuam sendo a paleta pessoal em `src/lib/nav-accent.ts`; não criar ids duplicados nem um segundo sistema de tema.
- Default de instalação/fallback: preset existente **`azul-profundo`**. Não há migração de banco.
- Uma preferência válida em `localStorage` sob `godoutor.nav-accent` tem precedência sobre o default e **não pode ser regravada/sobrescrita** pela troca do default. Uma chave antiga desconhecida usa o fallback atual; ids legados continuam resolvidos pelos aliases já existentes.
- O shell aplica somente os tokens permitidos de navegação/acento. `src/lib/appearance.ts` permanece compatibilidade legada; `Business.appearance.navColor` não é uma fonte ativa de tema.
- O tema não controla `--text*`, superfícies/fundo, status, radius, spacing, shadows, tipografia, anatomia ou largura/posição de componentes.
- Os pares de contraste do menu, ícone inativo, item ativo, CTA e texto em `--accent-soft` precisam alcançar **WCAG AA 4.5:1** em cada preset. Ícone não substitui rótulo, estado nem indicador de foco.

## 2. Cores semânticas e estrutura

- Sucesso/confirmado/concluído usa a família verde; aviso/atenção/pendência que requer decisão usa âmbar; perigo/cancelamento/erro/destrutivo usa vermelho; informação usa azul; estados sem significado semântico adicional ficam neutros.
- Aliases históricos como `purple`, `lilac`, `cyan`, `teal` e `sun` devem convergir para uma categoria semântica ou para neutro no workspace. Não podem recriar uma cor por módulo.
- Identidade de serviços externos (por exemplo, o logotipo de um canal) é uma exceção restrita ao próprio símbolo/identificador, não à superfície, status ou CTA do módulo.
- O fundo de workspace é sólido e neutro (`--workspace-bg: var(--bg)`). Painéis usam superfície e borda neutras; não há gradiente ou painel creme/lilás por decoração.
- Os estados da agenda, do funil, de pedidos, de execução, de pendência e os feedbacks de formulário consomem os tokens semânticos. Estado deve ter rótulo e nunca depender exclusivamente da cor.

## 3. Anatomia dos componentes

### PageHeader

Título, descrição contextual opcional, ícone em chip neutro/acento e área de ações. Títulos usam a escala fixa de texto; ação principal segue o preset; ações secundárias são neutras; ações destrutivas e feedbacks usam seus tokens semânticos. Exceções estruturais homologadas (agenda densa, inbox dividido, dashboard/organização com identidade do workspace e editor da página) devem manter hierarquia equivalente, sem duplicar heading nem inventar paleta.

### Botões e controles

- Todos os botões mantêm anatomia compartilhada por `buttonCls`/`Button`: altura por tamanho, alinhamento, padding, radius compacto, foco visível e estados disabled/loading coerentes.
- Variações de intenção: primário temático; secundário contornado neutro; ghost; destrutivo; link. `success` e `warning` legados, quando necessários, mantêm tokens semânticos fixos; aliases históricos não devem criar uma segunda implementação.
- Sem CTA primário preto, gradiente, halo de marca ou sombra decorativa. A exceção de cores é a ação semântica, não uma tela/módulo.
- Inputs/selects/textareas compartilham altura, fundo, borda e radius; foco tem um único indicador acessível, sem contorno duplicado. Labels e mensagens de validação permanecem associados ao campo.

### Superfícies, listas e dados

- Card/painel: superfície neutra + borda leve + radius compacto; cartões comuns sem sombra. Evitar “card dentro de card” sem necessidade estrutural.
- Tabela/lista mantém cabeçalho legível, divisórias discretas, hover neutro, densidade consistente e ações alinhadas. Chips de filtro não se confundem com badges de status.
- Badges de status usam `StatusBadge`/`toneCls` ou os tokens semânticos equivalentes. Métrica não é alerta; metadado não é status; dados de paciente/cliente não recebem amarelo como decoração.
- Avatares usam o componente compartilhado; não redesenhar fallback por rota.

### Overlays, sidebar e topbar

- Dialog, sheet, menu e tooltip compartilham overlay/foco/fechamento já homologados. Sombras ficam nas camadas flutuantes; a sidebar não projeta sombra sobre o conteúdo.
- Sidebar/topbar são estrutura. O default de sidebar é Deep Blue; presets podem alterar somente identidade/acento permitidos. Item ativo e grupo aberto mantêm semântica acessível (`aria-current`, `aria-expanded`) e contraste AA.
- Topbar tem superfície neutra sólida independente do preset e continua sendo o espaço de ações globais já existentes (busca, criar, notificações, ajuda e conta). O atalho global de Conversas conserva sua sheet e comportamento em múltiplas rotas; não introduzir FAB concorrente.
- Breadcrumb, navegação contextual, catálogos e permissões existentes não devem ser removidos como simplificação estética.

## 4. Geometria, tipografia, motion e responsividade

- Dentro de `.il-platform`, usar os tokens de radius e espaçamento do workspace; regras globais legadas ficam fora do escopo para não alterar páginas públicas.
- Tipografia do workspace permanece fixa (Geist Sans e escala já carregada pelo produto); preset não muda fonte, peso ou escala. Evitar tamanho/cor avulsa sem função de hierarquia.
- Motion curto e calmo, sem bounce; `prefers-reduced-motion` reduz/anula movimento. Hover/press/focus precisam de estado equivalente em teclado.
- Desktop de referência: **1440 px e 1366 px**. Mobile de referência: **390 px** (e conferir breakpoint menor quando houver overflow relevante). Conteúdo denso pode usar largura full do catálogo; formulários e listas de leitura única preservam a largura contida definida pelo catálogo.
- Em mobile: sidebar vira o diálogo/drawer já existente, ações não podem ser cortadas, tabelas devem ter estratégia de overflow/colunas, sheets não podem ultrapassar viewport e o conteúdo não pode gerar rolagem horizontal global.
- Contraste, foco visível, teclado, `aria-current`, `aria-expanded`, rótulos acessíveis e `prefers-reduced-motion` são requisitos de aceitação, não polimento opcional.

## 5. Arquitetura e fronteira de migração

- Fonte ativa de presets: `src/lib/nav-accent.ts`. Compatibilidade antiga: `src/lib/appearance.ts`. Não ressuscitar `Business.appearance.navColor` nem criar um terceiro tema.
- Primitivas compartilhadas existentes vivem em `src/components/ui.tsx`; devem ser reutilizadas, não recriadas por página.
- Tokens do workspace e correções de compatibilidade devem ser escopados em `.il-platform` sempre que necessário. Não mudar `:root` para reestilizar sem querer a página pública ou o editor legado.
- Preservar funcionalidade homologada, requisições, ações, dados, regras, rotas e permissões. Uma migração visual não muda fluxo nem remove controles.
- Página pública, booking e renderer/page-builder legado ficam fora do redesign. Testes devem assegurar que não foram afetados por seletores globais.

## 6. Critério de conclusão

A revisão só pode ser declarada concluída depois de: (1) auditoria de fonte por rota e segunda varredura; (2) testes de tokens, contraste e persistência para os 21 presets; (3) inspeção real em browser/render de cada rota autenticada em 1440/1366/390; (4) rotas críticas em Deep Blue, verde, neutro e vinho, com reload F5 confirmando persistência; (5) reabertura das telas críticas e registro de capturas; (6) execução da suíte completa com separação explícita do baseline conhecido de cinco falhas preexistentes. Teste de JSX/CSS não substitui inspeção visual.

O estado, a matriz de rotas, os artefatos e as pendências ficam em [`GODOUTOR-UI-AUDIT-V2.md`](./GODOUTOR-UI-AUDIT-V2.md). As auditorias históricas DESIGN-360 não são reescritas por esta revisão.
