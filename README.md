# GO DOUTOR — o sistema operacional da clínica

O **GoDoutor** é a plataforma de operação de clínicas e consultórios:
agendamento, fila de atendimento, paciente/cliente, prontuário de
consultas (anamnese + registro de atendimento), equipe com papéis e
canais (WhatsApp/Instagram) — num produto só. Eixo do produto:

> **Agendamento → Fila → Atendimento → Paciente/Cliente → Retorno**

Canais e automações entram POR CIMA desse eixo. Nada de vitrine, carrinho
ou pedido no caminho padrão: os módulos da fase "universal" antiga
(produtos/pedidos/orçamentos) continuam **resolúveis por dados e APIs de
compatibilidade** sob a flag `GODOUTOR_LEGACY_PAGES` — e só lá.

## Rodar

```bash
npm install
npm run seed     # demo@godoutor.app / demo1234 + 3 clínicas (veterinária, odonto, geral)
npm run dev      # http://localhost:3000
```

Logins do seed: `demo@` (dono das 3 unidades), `maria@` (secretária),
`vitor@` (recepção da VET), `pro-caio@` (veterinário com agenda própria),
`profissional@` (dentista) — senha `demo1234`; `master@godoutor.app` /
`master1234` (Master da plataforma). Páginas públicas de exemplo:
`/vidavet`, `/odontovitta`, `/clinicageral`.

## Master da plataforma (`/master`)

A conta Master pertence à plataforma (não a uma Organização). Login normal
(e-mail + senha com hash scrypt) — **sem senha universal**:

```bash
MASTER_BOOTSTRAP_EMAIL=voce@godoutor.app \
MASTER_BOOTSTRAP_PASSWORD='sua-senha-forte' \
npm run master -- --bootstrap
```

Documentação completa: [`docs/MASTER.md`](docs/MASTER.md).

## Flags de produto e ambiente

| Variável | Padrão | Para que |
| --- | --- | --- |
| `GODOUTOR_LEGACY_PAGES` | OFF | Ramo de compatibilidade da era "universal": página pública no menu-busca, vitrine/Produtos e Pedidos (telas + catálogo de Recursos), perguntas de nicho/modo de venda no cadastro, temas comerciais. No OFF nada disso é oferecido — mas nada é apagado: dados, APIs e deep links seguem válidos. O produto clínico funciona 100% com a flag OFF. |
| `GODOUTOR_DB_FILE` | `data/godoutor.db.json` | Banco local em arquivo. `INSTALINK_DB_FILE` segue lida como **alias legado**; se só existir `data/instalink.db.json`, ele é preservado como destino (renomeação sem perda). |
| `CRON_SECRET` | — | Protege os consumidores de fila/cron (automações P4, retenção). |
| `ALLOW_PRIVATE_OUTBOUND_URLS=1` | OFF | Escape hatch dev/QA para webhooks apontando para IPs privados (recusados por padrão — SSRF guard). |
| `MASTER_EMAILS` | — | Promove e-mails existentes a Master sem gravar nada no banco (fallback operacional). |

A sessão app usa o cookie canônico `godoutor_session`; `il_session` (era
InstaLink) continua **lido** como fallback de drenagem até expirar — o
login grava o canônico e purga o legado, o logout limpa os dois
(`src/lib/auth.ts` → `sessionCookieId`, ponto único de leitura).

## QA automatizada

```bash
npm run typecheck
npm test                # vitest (unit/integração em DB temporário isolado)
node scripts/smoke.mjs            # suíte de runtime (67 checagens)
node scripts/smoke-ux.mjs         # contexto/403/agenda/horários (88)
node scripts/smoke-agendar.mjs    # /agendar + widget + guest booking (25)
node scripts/smoke-p3.mjs         # 15 fluxos do P3 (pipeline/leads/webhooks/cron)
node scripts/smoke-p4.mjs         # motor de automações ponta a ponta (18)
node scripts/e2e-merchant.mjs     # jornada do dono no Clinical OS (28)
```

Para as suítes, o servidor precisa estar de pé com o banco do seed
(`GODOUTOR_DB_FILE=/tmp/qa.db.json npm run seed && GODOUTOR_DB_FILE=/tmp/qa.db.json ALLOW_PRIVATE_OUTBOUND_URLS=1 CRON_SECRET=smoke-cron-secret npm start`).
A homologação viva (roda por persona, com prints do estado real) está em
[`docs/AUTO-HOMOLOGACAO-CLINICAL-CONVERGENCE.md`](docs/AUTO-HOMOLOGACAO-CLINICAL-CONVERGENCE.md).

## Documentos do produto

- [`docs/GODOUTOR-MASTER-PLAN.md`](docs/GODOUTOR-MASTER-PLAN.md) — o plano
 -mestre e a fila de ondas (estado atual: P0 convergência merged; F1
  bloqueado por revisão do PR de convergência).
- [`docs/GODOUTOR-CLINICAL-OS-V1.md`](docs/GODOUTOR-CLINICAL-OS-V1.md) — a
  especificação do produto (encounter, fila, papéis; o que é motor único).
- [`docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md`](docs/GODOUTOR-CLINICAL-CONVERGENCE-AUDIT.md)
  — o inventário de superfícies "universal" remanescentes e a matriz A/B/C/D
  da onda 2 (o que virou Clinical OS, o que ficou ramo de compatibilidade e
  por quê).
- [`docs/GODOUTOR-HISTORY.md`](docs/GODOUTOR-HISTORY.md) — log de ondas com
  números de QA por entrega.

Regra de engenharia da casa: **um motor só** — nicho/tipo de clínica é
configuração inicial (preset), nunca aplicação paralela; renomeações nunca
deslogam nem apagam dados (fallback de leitura, purga no login, drenagem
por TTL).

## Camada visual — PR #69 (fechamento)

### Régua shadcn: consulta obrigatória ao `dashboard-01`

Fonte consultada: `shadcn-ui/ui` (clone raso, commit `c2a6784`), bloco
`apps/v4/registry/bases/base/blocks/dashboard-01/` (`page.tsx`, `components/`).
Copiamos **só composição, densidade, espaçamento, agrupamento, hierarquia de
ações e geometria de primitives**. Nenhum dado, branding ou texto do exemplo
entrou no produto.

**Padrões usados**

- Cabeçalho de página com título em peso médio, separador vertical e ações à
  direita (`SiteHeader`): o cabeçalho do Cliente 360 segue isso (título
  "Visão do cliente" × ações).
- Hierarquia de ações (`Button`): **uma** primária sólida por contexto
  (Novo agendamento no Cliente 360; Registrar chegada/Confirmar no drawer),
  secundárias com contorno, terciárias em `ghost`, perigo isolado (`destructive-soft`)
  depois de um separador.
- Agrupamento com divisor de 1px (`Separator`, novo em `src/components/ui.tsx`):
  separa zonas (principal × terciária × perigo) sem caixa extra.
- Tabs de linha (`variant="line"`): indicador inferior, ícone, contador em
  pill de 18px (`size-5 rounded-full` do bloco), e overflow com "Mais N"
  no mesmo sistema (`OverflowTabs`), no Cliente 360 e no Pet 360.
- Ações secundárias de cabeçalho em `DropdownMenu` ("Mais") em vez de barra
  cheia de botões.
- Densidade e espaçamento de grid: `gap` 4/6 entre blocos, `py-4 md:py-6`
  de respiro da página, mantidos pelos tokens do repositório.

**Padrões não usados, e por quê**

- `SidebarProvider`/`SidebarInset`/`AppSidebar`: a sidebar e a topbar são do
  shell do produto e estão fora desta onda ("não redesenhar sidebar/topbar").
- Grid de `Card` com `CardAction`/`CardFooter` (`SectionCards`): é o "card
  wall" que a homologação rejeitou para o Cliente 360. Mantivemos a Visão
  geral com 3 cards operacionais, sem empilhar cartões.
- `Select` no mobile no lugar das tabs: as tabs continuam visíveis em
  largura estreita via overflow "Mais N", que já é o contrato do produto.
- `DataTable` / gráficos / drag de linhas: não há tabela ou gráfico nesta
  rodada; a Agenda e as listas têm componentes próprios que não foram tocados.
- `Badge variant="outline"` e tokens `text-muted-foreground` do shadcn: não
  adotados. Usamos `Badge`/`StatusBadge` do repositório e os tokens atuais;
  trocar paleta, fonte ou raio é proibido nesta rodada.
- Dependências novas (`@radix-ui/*`, `components.json`): não adicionadas.
  O `Separator` foi implementado localmente, sem dependência.

### Decisões da rodada

- **Entity-rail**: `novas camadas de override adicionadas ao entity-rail: 0`.
  Nenhuma regra nova; o rail não foi tocado.
- **IconButton**: mantém `title` nativo (o E2E do cadeado depende dele) e
  `aria-label`. O foco visível vem do `:focus-visible` global (anel
  `--focus-ring`). A área clicável é o token `--gd-control-h` (`--gd-control-h-touch` em toque).
- **Motion do drawer**: inalterado (`gd-detail-in` / `gd-detail-out`). Medido no
  Chromium real (1440): entrada de `translateX(460px)` a `none`, saída de
  `none` a `translateX(100%)`. Com `prefers-reduced-motion`, a animação fica
  `none` desde o início.
- **Drawer do agendamento**: removido "Ver histórico" (o histórico já fica
  aberto logo abaixo). Atalhos mantidos: Cliente e WhatsApp. Rodapé em três
  zonas: principal (primária + secundárias), terciária (Reagendar,
  Chegou às) e perigo isolado (Cancelar) após `Separator`.
- **Alertas da Agenda**: o glyph `!` do marcador de atenção passou de
  `#92400e` sobre `#b45309` (contraste 1,41:1) para branco sobre `#b45309`
  (5,02:1). Só o alias `--attention-mark-fg` mudou; a cor semântica e a paleta
  continuam iguais. O mesmo alias pinta o ícone da faixa "precisa de fechamento".
- **Topbar**: o `?` duplicado saiu; Ajuda e suporte fica no rodapé da
  navegação (inclusive no menu mobile) e no menu da conta. Conversas usa o
  balão neutro `chat` da família `Icon`.
- **Clientes**: busca em linha única com o filtro `Segmented` (primitive
  canônico de filtro, não tabs de workspace) e a contagem; a busca ocupa a
  largura útil.
- **Pet 360**: título = nome do pet; subtítulo `Pet 360 · Espécie (Raça)`;
  identidade com idade, peso e sexo; abas em `OverflowTabs variant="line"`.
- **Profissional automático**: `automaticProfessionalDisplay` (testes em
  `src/lib/__tests__/automatic-professional-display.test.ts`, cobre serviço com
  profissional único).

### Baselines ausentes (não são pendência)

Os baselines "before" de 1024/768/390 e do Quick Create não existem neste
checkout. Não foram fabricados nem recriados; o registro desta ausência é a
própria nota acima e a da rodada anterior.

### Verificação

- Vitest: 6 falhas, todas do baseline conhecido (`a34-instagram` ×3,
  `automation-audit-p4`, `convergence-wave2`, `pipeline`). Testes focados desta
  rodada verdes.
- `tsc --noEmit`: só os 3 erros de baseline em `production-db-routing.test.ts`.
- `npm run build`: ok.
- E2E Entrega 3: 15/15, com o banco `e3/db.json` limpo antes e depois.
- `git diff --check`: limpo.
