# InstaLink.app — Página, agenda e clientes em um link

Plataforma de **página, agendamento e relacionamento** para negócios que
trabalham com atendimento marcado: salões, barbearias, clínicas (odonto,
médicas, estética), fisioterapia, psicologia, nutrição, veterinária,
autônomos que vendem tempo. Eixo do produto:

> **Página pública → Serviço → dia → horário → agendamento → cliente → agenda → histórico (+ WhatsApp)**

Opcionalmente, vitrine de produtos (CTA "Tenho interesse" → WhatsApp — sem
carrinho/checkout/pedido).

## Rodar

```bash
npm install
npm run seed     # cria demo@instalink.app / demo1234 + 2 negócios de exemplo
npm run dev      # http://localhost:3000
```

## Master da plataforma (`/master`)

A conta Master pertence ao InstaLink (não a uma Organization). Usa o login
normal (e-mail + senha com hash scrypt) — **sem senha universal**.

```bash
# Defina SEU e-mail e SUA senha (não há credencial fixa no código):
MASTER_BOOTSTRAP_EMAIL=voce@seudominio.com \
MASTER_BOOTSTRAP_PASSWORD='sua-senha-forte' \
npm run master -- --bootstrap

# Depois: /login → redireciona para /master
```

Documentação completa: [`docs/MASTER.md`](docs/MASTER.md).

## Fluxos de aceitação

- **Vitrine (opcional):** módulo Produtos ativo em Recursos → `/negocio`
  mostra a vitrine com foto, nome, preço e **Tenho interesse** → abre o
  WhatsApp do negócio com mensagem contextualizada (produto + preço).
  Nenhum pedido interno é criado. (O módulo de pedidos é LEGADO: dados e
  rotas antigas continuam preservados, mas pedidos não aparecem no cadastro,
  na navegação nem como conceito comercial.)
- **Agendamento:** `/barbeariadojoao` → Agendar no serviço (sheet já com o
  serviço escolhido) → profissional → dia (só dias com vaga, próximo livre
  pré-selecionado) → horário por turno → resumo + confirmar → **login** →
  aparece na Agenda e em Minha conta (com Remarcar, Cancelar, Google Agenda).
- **Avaliações:** atendimento concluído → convite automático
  (1×/sessão) na conta → cai em Minha página → Depoimentos para aprovar;
  Google opcional (link + importar últimas). Máx. 4 publicadas no ar.
- **Orçamento (legado):** onde o módulo antigo existe, o bloco continua
  funcional → **login** → vira lead em Clientes. Negócios novos não nascem
  com orçamento nem recebem esse caminho no cadastro.
- **Conta:** menu em pílula fixo no topo (Início + abas do negócio + conta);
  deslogado mostra só o ícone, logado mostra avatar + primeiro nome → conta
  com os próprios agendamentos (+ pedidos, só no módulo legado);
  sair volta a pedir login nas conversões. Opcional: login com Google
  (definir `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, redirect
  `{ORIGEM}/api/auth/google/callback`).
- **Sessão:** cookie httpOnly + token Bearer (memória/localStorage) em toda
  chamada /api/*; navegação do painel 100% SPA (sem reload que derrube a
  sessão); criação de negócio com rascunho de segurança; banco com backup
  `.bak` a cada escrita (e NUNCA sobrescrita por leitura falha).
- **Painel:** sidebar recolhe para ícones (persiste), ícones SVG, skeletons
  em todas as telas com carregamento.
- **Visual:** Página → Visual → 8 modelos prontos (cores + fonte + formato +
  estilo de botão) com prévia ao vivo; depois de aplicar dá para ajustar
  qualquer cor (vira "Personalizado"). A NAVEGAÇÃO da página e a seção "Sobre"
  são editadas no mesmo editor da Página (não em Configurações).
- **Gestão:** `/login` (demo) → Página (blocos, navegação, tema, publicar, QR),
  Serviços (equipe, horários), Agenda (day/week/month, drag p/ remarcar,
  fechamento), Clientes (histórico 360), Resultados (funil de agendamentos).
- **Comece por aqui:** no Dashboard, checklist leve e não bloqueante com
  progresso REAL (perfil, serviços, horários, profissionais, publicar) — some
  quando completo e pode ser ocultado.

## Criar negócio (sem wizard)

`/register` → `/onboarding` (**uma tela**: nome + WhatsApp) → Dashboard.
O negócio já nasce no padrão de atendimento: Serviços + Agenda ativos,
vitrine desligada, nada de pedidos. O nicho pode existir como dado interno
(templates de tema), mas NÃO define mais a arquitetura do sistema.

## Deploy na Vercel (link estável, grátis)

O banco é duplo: sem `DATABASE_URL` usa o JSON local (dev);
com `DATABASE_URL` usa Postgres (produção). Na Vercel o disco é
descartável, por isso a produção exige Postgres.

1. **Banco grátis:** crie em [neon.tech](https://neon.tech) (ou Vercel
   Storage → Postgres, ou Supabase) e copie a `DATABASE_URL`
   (connection string com `sslmode=require`).
2. **Suba o código para o GitHub** (repositório com esta pasta).
3. **Vercel:** [vercel.com](https://vercel.com) → Add New → Project →
   importe o repo (framework detectado: Next.js) → em Environment
   Variables adicione `DATABASE_URL` → Deploy.
4. **Seed (demos):** localmente, rode uma vez apontando p/ a produção:
   `DATABASE_URL="sua-string" npm run seed`
   (ou pule — cadastre-se e crie do zero em `/register`).
5. Pronto: `https://seu-projeto.vercel.app` — estável, com logins e dados
   persistindo de verdade.

Troubleshooting: `POSTGRES_URL` (nome da Vercel Storage) não é lida —
o app espera exatamente `DATABASE_URL`; copie o valor para essa chave.

### Retry de webhooks no Hobby (sem Vercel Cron por minuto)

O projeto está no **Vercel Hobby**, onde o cron nativo roda no máximo **1x por
dia** (cron por minuto é recurso de plano Pro). Por isso **não há `vercel.json`
com `crons`**: nenhuma configuração de deploy pressupõe Pro.

A fila de retry de webhooks é **persistida no banco** (`pending` +
`nextRetryAt`; tentativas 2 e 3 após ~30s e ~120s, teto de 3 tentativas) e o
agendador é **externo ao app** — basta chamar o endpoint protegido:

```bash
# cron do servidor (VPS) ou agendador externo — 1x por minuto
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://SEU-DOMINIO/api/cron/webhooks >/dev/null 2>&1
```

- Sem `CRON_SECRET` o endpoint responde **503** (falha fechada); com credencial
  errada/ausente, **401**; com o Bearer correto, **200** com contadores.
- Nenhuma linha do motor depende da Vercel: ao migrar para VPS, o mesmo `curl`
  no cron do servidor (ou um worker Node chamando o processador) resolve.
- Detalhes: [`docs/webhooks-retry.md`](docs/webhooks-retry.md).

## Automações (P4) — agendador do motor

O motor de automações usa exatamente o mesmo desenho: estado no banco, nada de
fila externa, e um endpoint protegido para retomar o que está em espera:

```bash
# cron do servidor (VPS) ou agendador externo — 1x por minuto
* * * * * curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://SEU-DOMINIO/api/cron/automations >/dev/null 2>&1
```

- Sem `CRON_SECRET`, `/api/cron/automations` responde **503** (falha fechada) e
  **nada da fila é processado**; com credencial errada, **401** (fila intacta).
- Uma automação em `waiting` NUNCA depende de requisição HTTP aberta: o estado é
  o banco, e a retomada acontece por qualquer um destes caminhos — agendador,
  botão "Processar fila" do painel, ou o gancho inline do `updateDB` (que acorda
  esperas **vencidas** na escrita seguinte do sistema, com `AUTOMATION_INLINE`
  ligado por padrão).
- Assim como no retry de webhooks, **não há `vercel.json` com `crons`** no
  repositório: no plano Hobby o cron da Vercel roda no máximo 1x/dia, e nenhuma
  configuração de deploy pressupõe plano Pro. Sem agendador, esperas retomam na
  próxima atividade do negócio; para um colchão pontual (função parada à noite,
  espera longa), configure o `curl` acima no cron da VPS/GitHub Actions ou o
  Vercel Cron (Pro) apontando para `/api/cron/automations`.
- O painel configura tudo em `/automacoes` (Quando → Se → Então → Depois → Senão).
- Detalhes: [`docs/automations-p4.md`](docs/automations-p4.md).

```bash
npm run smoke:p4   # motor de automações de ponta a ponta (servidor + npm run seed)
```
