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
