# GODOUTOR · PRODUCT/UX REVOLUTION 2.0 — relatório final

Branch de trabalho desta janela: `arena/01a0d8b2-instalink` (sessão).
Branch de destino oficial: `arena/01a0ce4e-instalink` (PR #37, stacked sobre #36).
`main` intocado · Production intocada · nenhum merge realizado.

O trabalho da 2.0 está publicado em **oito commits** a partir de `f67a335`:

| commit | o que entrega |
| --- | --- |
| `c95c390` | estado completo da missão (IA, design system, shell, agenda, conversas, papéis) |
| `293969c` | lacunas visuais achadas na verificação em navegador |
| `79d67e4` | "Recursos" deixa de ser conceito principal do usuário |
| `660b12d` | cliente responsivo, saudação com tratamento, copy do compositor |
| `09a8913` | breadcrumb deixa de inventar o degrau "Mais" |
| `d0dcd88` | §i Postgres: garantia da tabela uma vez por instância |
| `237da2d` | uma linguagem só — "funil"/"lead" saem da interface |
| `be70045` | Visão geral do profissional só com o que é DELE |
| `9ff6378` | §i leitura de contexto uma vez por navegação + marca única da plataforma |

---

## 1. Medição — §i Supabase/Postgres e rede (antes/depois)

Método: build de produção, **mesmo seed**, mesma máquina, harness de rede sobre as
**28 navegações** do painel (`/dashboard`, `/agenda` ×5 visões, `/conversas`,
`/clientes`, `/estrutura`, `/pagina`, `/automacoes`, `/resultados`, `/financeiro`,
`/configuracoes`, `/canais`, `/perfil`, `/funil`, `/tarefas`, `/execucoes`,
`/recursos`, `/equipe`, `/servicos`, `/profissionais`, `/disponibilidade`,
`/followup`, `/campanhas`, `/agente`, `/organizacao`).

| métrica | antes (`f67a335`) | depois | ganho |
| --- | --- | --- | --- |
| chamadas `/api/*` | 148 | **110** | −25,7% |
| chamadas duplicadas | 40 | **2** | −95,0% |
| `/api/overview` por rota | 2 | **1** | −50% |
| `/api/auth/me` por rota | 2 | **1** | −50% |
| média de chamadas/navegação | 5,29 | **3,93** | −1,36 |
| DDL `CREATE TABLE IF NOT EXISTS` | 1 por requisição | **1 por instância** | −1 round-trip/req |

Correções aplicadas (todas cobertas por teste):

1. **`src/lib/overview.ts`** — coalescência em voo do endpoint mais caro do painel
   (agenda + financeiro + funil + checklist). Visão geral, mini-card da sidebar e
   sino pediam o MESMO payload em paralelo; agora dividem UMA requisição.
   Nada é cacheado depois que a resposta chega: nenhum painel mostra número velho.
2. **`src/lib/session-me.ts`** — `/api/auth/me` era buscado por TRÊS consumidores do
   shell, cada um por conta própria (DashboardShell, `useBusinessId`,
   `usePanelPermissions`). Agora há um loader só, com TTL de 5s — exatamente a régua
   de revalidação que o shell já usava (`lastContextAt > 5000`) — e `fresh: true`
   para o sinal explícito de "mudou agora" (toggle de módulo/equipe, Tentar novamente).
   **401 nunca é cacheado**; 403/500 mantêm a sessão (regra de produto intacta).
3. **`src/lib/db.ts`** (commit `d0dcd88`) — a garantia da tabela passou de 1 DDL por
   requisição para 1 por instância; falha continua propagando e limpa o cache.

Alvo seguinte (medido, não corrigido nesta janela): as 2 duplicatas restantes são
`/pagina` e `/configuracoes`, que pedem o overview para finalidade própria —
reuso do payload, não chamada redundante.

Limite de honestidade: **não há `DATABASE_URL` neste ambiente**, então as medições
são de rede local + instrumentação de Pool. Números de Postgres gerenciado
(Supabase/Neon) exigem a Preview com banco real — a metodologia está registrada em
`src/lib/__tests__/db-pg-init.test.ts` e `overview-loader.test.ts` para reprodução.

---

## 2. Arquitetura de informação (a que o usuário lê)

```
OPERAÇÃO          Visão geral · Agenda · Conversas · Clientes          (links diretos)
CLÍNICA           Clínica (grupo) · Página                             (portas)
ADMINISTRAÇÃO     Automação (grupo) · Gestão (grupo) · Configurações (grupo)
```

- **Cinco destinos do dia a dia na primeira coluna**; exatamente **quatro grupos**
  abrem a segunda coluna contextual (`Clínica`, `Automação`, `Gestão`, `Configurações`).
- O menu **não** é decidido por papel e sim pelas **permissões efetivas**: sem
  `catalogo`/`equipe`/`config`, o grupo simplesmente não existe para aquele usuário.
- Fora da LINHA do menu, porém declarados e alcançáveis por atalho contextual
  (`sidebar: false` ≠ escondido): `/tarefas` (Pendências), `/funil` (Oportunidades),
  `/recursos` (capacidades dentro de Configurações), `/execucoes` (diagnóstico dentro
  de Automações) e `/perfil` (menu da conta, para **todo** usuário autenticado).
- `/organizacao` só aparece com multiunidade real.
- Larguras medidas no navegador: sidebar **224px** expandida / **68px** recolhida;
  segunda coluna **220px**; rótulo acessível por `data-tip` quando recolhida.
- `aria-current="page"` presente, ESC fecha popovers e o submenu móvel é UM diálogo
  com passo de voltar (nunca duas colunas na tela).

## 3. Matriz de papéis (medida no navegador, com o seed)

| papel | menu lateral | "Visão geral" | dinheiro na tela | Meu perfil |
| --- | --- | --- | --- | --- |
| **OWNER/PROPRIETÁRIO** | Visão geral · Agenda · Conversas · Clientes · Página + 4 grupos | "Boa noite, Demo!" + Período · resumo + Ver resultados | sim | sim |
| **ATENDENTE** (`VENDEDOR`, agenda desligada) | Visão geral · Conversas · Clientes + grupo Automação | "Boa noite, Vitor!" + O que resolver agora | não | sim |
| **SECRETARIA** | Visão geral · Agenda · Conversas · Clientes (nenhum grupo) | "Boa noite, Sofia!" + O que resolver agora | não | sim |
| **PROFISSIONAL** (escopo `own`) | Visão geral · Agenda · Conversas · Clientes | **"Meu dia, Orlando"** + aviso "Você vê somente a sua agenda" | não | sim |

`PROFISSIONAL` **sem vínculo** com um profissional continua caindo em escopo
seguro (`NO_PROFESSIONAL_SCOPE`): agenda vazia por padrão, nunca a de todos.
O seletor de unidade vive no **menu da conta** ("Clínica atual"), não mais na topbar.

## 4. Design system (GoDoutor 2.0)

- Azul da marca `#2563EB` (`--brand-600`), sem roxo de identidade; acento de contexto
  restrito a **marca** (dia a dia) e **neutro** (ajuste raro).
- Geist Sans como fonte da interface (`geist` é a única dependência nova).
- Superfícies claras, raio e sombra contidos, `tabular-nums` em números.
- **Acessibilidade verificada por teste computado** (`design-360-tokens.test.ts`):
  contraste WCAG AA sRGB calculado sobre os tokens reais. A paleta antiga
  (`--text-faint: #94a3b8` sobre `--surface-hover`, `--warning: #d97706`,
  `--success: #16a34a`, `--info: #0284c7`, `--border-strong: #cbd5e1`) reprovava;
  os valores atuais passam em todos os pares exigidos, mantendo a mesma direção
  visual. Foco visível confirmado no navegador (`outline: 2px solid`).
- Marca **clinic-first/co-branded**: nome + logo da CLÍNICA no topo da sidebar
  (224px/68px), assinatura discreta "powered by GoDoutor" no rodapé — sem white-label.
- **Uma marca só na plataforma**: 32 arquivos ainda exibiam "InstaLink" em texto
  visível (título da aba, wordmark do onboarding, e-mails, telas do Master, catálogo
  de integrações). Agora é GoDoutor na interface, preservando o que **não** se
  renomeia por passe de UX: o domínio real `instalink.app` e identificadores de
  integração (`User-Agent` do webhook). O onboarding ganhou a assinatura do login:
  "GoDoutor / clínicas".

## 5. §f Conversas — a prova do flicker

O defeito: a tela mostrava "Nenhuma conversa ainda" **enquanto** os dados chegavam.

Prova automatizada (`qa/flicker.mjs`, fora do repo): as duas APIs que decidem o
estado (`/api/whatsapp`, `/api/conversations`) são **atrasadas 4s** e a tela é
amostrada durante a espera, com o instante de cada resposta registrado.

```
respostas atrasadas chegaram em (ms): whatsapp 4169 · conversations 4176
amostra 1203ms → vazio:false · esqueleto:15
amostra 3238ms → vazio:false · esqueleto:15
amostra 4925ms → vazio:true  · esqueleto:0    (780ms DEPOIS das respostas)
VEREDITO: PASS — nenhuma amostra antes da resolução mostrou estado vazio
```

Além disso: histórico continua visível com canal desconectado e o compositor fica
desabilitado com "Conecte um canal para responder por aqui.".

## 6. Gates desta janela

- `npm run typecheck` (`tsc --noEmit`): **0 erros**.
- `npm test` (vitest): **2099 passed / 5 failed / 2104**.
  As 5 falhas são **pré-existentes** e provadas como tal: as MESMAS falhas nos
  MESMOS arquivos reproduzem em `f67a335` (árvore limpa, worktree separado):
  `a34-instagram.test.ts` (3), `automation-audit-p4.test.ts` (1),
  `pipeline.test.ts` (1). **Zero falha nova.**
- `npm run build`: **sucesso** (compiled successfully).
- Novos testes: `overview-loader.test.ts` (6), `session-me.test.ts` (9),
  `db-pg-init.test.ts` (4, da janela anterior).

## 7. O que segue BLOCKED e por quê

1. **Smoke no Preview real**: o sandbox tem egress bloqueado para `vercel.app`
   (GitHub responde 200; `vercel.com`, o Preview e domínios externos respondem 000,
   sem saída de rede). O deployment do commit foi disparado e concluiu
   (`success`), e toda a verificação visual/funcional desta janela foi feita
   contra o build de produção rodando localmente, com o mesmo seed.
2. **Medição de Postgres gerenciado (Supabase) com números de produção**: exige
   `DATABASE_URL`, que não existe neste ambiente e não é exposto por segurança.
3. **Conversas com histórico real**: o seed tem 0 conversas, então o *estado
   populado* da tela não é reproduzível localmente — o que foi provado é o
   comportamento de carregamento (o defeito relatado) com atraso instrumentado.

## 8. Confirmações

- `main` **intocado** (`96ece32`, sem commits novos).
- **Production não deployada** — apenas Preview.
- **Nenhum merge**; PR #37 permanece OPEN.
- **Nenhum force-push**; nenhuma migração de banco; nenhuma rota/backend apagado;
  nenhum dado de tenant real criado; nenhuma alteração em WhatsApp/WABA/Meta.
