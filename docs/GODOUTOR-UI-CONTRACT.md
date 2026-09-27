# Contrato Universal de UI — GoDoutor

> Congelado após a última missão de consolidação (PR #39).
> Próxima fase: WhatsApp + automações — **fora** deste contrato visual.
> Qualquer tela nova (painel ou mobile) DEVE seguir este documento.

---

## 1 · Categorias de cor (as 4 travas do sistema)

| Categoria | O que é | Regra |
|---|---|---|
| **A · TEXTO** | Títulos, corpo, labels | Sempre near-black (`--text` = `#18181b`). **O tema NUNCA muda texto.** |
| **B · TEMA** | Cor da clínica (Aparência) | Controla: sidebar, topbar suave, ícone+acento do page header, item ativo e **CTAs principais**. Tokens: `--accent` / `--accent-hover` / `--accent-soft` / `--accent-border` / `--accent-contrast`. |
| **C · SEMÂNTICAS** | Estado de saúde do sistema | Verde = sucesso, Vermelho = erro/destrutivo, Âmbar = atenção. **Nunca tingidas pelo tema** (`--success` / `--danger` / `--warning` fixos). |
| **D · FUNDO** | Área de trabalho | Neutro universal `#F4F6F8 → #F8F9FB` (`--bg-top`/`--bg-bottom`). **Não acompanha o tema.** Nenhuma tela do painel pode impor fundo próprio (a Agenda mantém apenas o tom da *grade* interna; o shell externo é o gradiente). |

**Proibições:** misturar `--brand`, `--il-nav` e `--text` em CTA; usar cor de tema em texto; usar semântica como cor de marca; aplicar o tema na página pública.

### Paletas do tema (21 presets, por famílias)

`Neutro` branco · `Azul` clínico/amigável/profundo · `Verde` sálvia/equilibrado/profundo · `Teal` claro/médio/profundo · `Violeta` suave/atual/profundo · `Amarelo` suave/âmbar/dourado · `Rosé`/rosa queimado/vinho/bordô · `Ônix` (preto).

- Contraste **AA ≥ 4.5:1** validado por teste (`m8-contrato-cor`, `missao7-visual`) para nav-fg×nav e accent-contrast×accent em **todos** os presets.
- Ids legados `violeta`/`teal` = aliases de `violeta-atual`/`teal-medio` (preservam a escolha salva).
- Ícone/acento do page header: semântico por domínio (estrutura `--accent`, agenda `--info`, clínico `--success`, comercial `--warning`, comunicação `--accent`).

## 2 · Título de tela (page header)

`[icon-container accent] Título PRETO [Ações (CTA tema + neutros)]` — em TODAS as telas.

## 3 · CTAs

| Tipo | Cores |
|---|---|
| **Principal** | `--accent` bg / `--accent-hover` / `--accent-contrast` texto (segue o TEMA) |
| **Secondary / outline / ghost** | Neutros (cinza) |
| **Destrutivo** | `--danger` |
| **Sucesso** | `--success` |

## 4 · Sidebar

- **Padrão (Poppins)**: só no dashboard (`WorkspaceNavigation`). Demais telas usam Inter (TopBar/NavBar) — decisão travada da missão 6.
- **Recolhida (rail 76px)**:
  - rota direta → **só tooltip**;
  - **grupo expansível** (Clínica/Automação/Gestão/Configurações) → **hover-peek** temporário (§7).
- **Hover-peek (§7)**: abre na hora com animação **200ms ease-out**; fecha **275ms** após o mouse sair; grupo↔peek sem flicker; **nunca altera o estado recolhido persistido**; o único toggle persistente é o botão Recolher/Expandir; `Escape` fecha; foco abre/blur fecha (teclado); `prefers-reduced-motion` desliga a animação. API: `useSidebarPeek(collapsed)` em `src/lib/sidebar-peek.ts`.
- **Topbar suave**: `color-mix(in srgb, var(--il-nav) ~12%, #fff)` — acompanha só o nav; sem cor de botão embutida.

## 5 · Aparência (Configurações)

- Seletor por **famílias** com **preview ao vivo** (sidebar + topo suave + CTA tema + texto near-black) e selo de contraste AA.
- Preferência **pessoal/local** (`godoutor.nav-accent`); evento `godoutor:nav-accent`; não mexe na página pública; identidade da clínica = logo + nome.
- Testids travados: `shell-appearance`, `nav-accent-preview`, `aria-label="Cor da navegação"`, `nav-accent-<id>`.

## 6 · Permissões (matrizes preservadas)

| Papel | Permissões |
|---|---|
| **OWNER** | todas |
| **SECRETARIA** | dashboard, agenda, clientes, leads, pedidos, whatsapp |
| **ATENDENTE** | dashboard, agenda, clientes, whatsapp |
| **PROFISSIONAL** | dashboard, agenda, clientes, **atendimento** (evolução clínica) |

- **NUNCA** conceder `atendimento` à Secretária.
- Menu = **projeção** das permissões efetivas (`panelNavigation`/`visiblePanelRoutes`) — nada de menu decorativo.
- Ações visíveis respeitam a permissão: **esconder** ou `disabled` + tooltip explicando (§10).
- Área permitida NUNCA mostra "você não tem permissão" (§8–9): request 403 secundária vira feature indisponível (`report`/`reportFeature` em `lib/client-auth`), nunca negação da área.

## 7 · Overlays (dialog × sheet)

| Padrão | Uso |
|---|---|
| **Dialog** (Card central, ~520–680px) | ação focal curta (Pedido comprovante, Editar equipe…) |
| **Sheet** (Drawer lateral) | edição extensa (Novo cliente, Novo agendamento…) |

- **UM `dialog` = UM backdrop** (nunca empilhados).
- **Novo agendamento + cadastro rápido = MESMO overlay que expande** (base 680–760px → 1000–1120px; lado recuado atenuado `--recessed`, × fecha o lado). Mobile: passos num overlay só.
- Após salvar o cadastro rápido: volta ao painel com o **paciente selecionado** e os dados do agendamento preservados.
- Animações: entrada 180–220ms / saída 150–200ms + `prefers-reduced-motion`.
- Sem `EditSection` genérico nos 3 lugares-critérios — editores customizados mantidos.

## 8 · Identidade de conversa (Conversas ↔ Clientes)

- Canônico em `lib/conversation-identity.ts`: `contactId ↔ customerId ↔ telefone normalizado ↔ BusinessCustomer` (função única — nunca paralela).
- Pessoa desconhecida/spam **nunca** vira cliente automaticamente: badge **"Contato novo"** + CTA **"Cadastrar cliente"** (ou "Enviar para oportunidades").
- Reconciliação legada (`reconcileConversations` + `POST /api/conversations/reconcile`) é idempotente e roda no servidor; **nunca há escrita em leitura** no cliente.
- "Voltar para clientes" preserva busca/filtro/página (`lib/client-return.ts`).
- "Registrar nota"/"Editar dados" = `scrollIntoView` + foco + highlight ~1.8s (`lib/focus-highlight.ts`).

## 9 · Foco, hover, press, ativo, carregando, vazio, erro, sucesso

Sempre os tokens acima; estados de loading nunca dependem só de cor; erros de request nunca são silenciosos nem transformados em permissão negada.

## 10 · Mobile

- Ações em overflow "Mais opções"; peek e popovers desativados ≤768px (tooltip simples).
- Sheets em página própria ou overlay único; sem backdrops empilhados.

---

### Testes que travam o contrato

`m8-contrato-cor` (9 travas + 6 paletas) · `m8-permissoes` (matrizes + projeção do menu) · `m8-sidebar-peek` (7 cenários + 2 bônus) · `m8-falso-403` (20) · `m8-identidade` (10) · `m8-cliente360` (3) · `m8-agendamento` (4) · `missao7-visual` / `missao6-shell` (tema/acento).
