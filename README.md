# InstaLink.app — Seu negócio inteiro em um link 🚀

SaaS multi-tenant MVD 1.0: página pública por negócio + painel completo
(produtos, serviços, agenda, pedidos, leads, analytics, concierge IA).

## Rodar

```bash
npm install
npm run seed     # cria demo@instalink.app / demo1234 + 2 negócios de exemplo
npm run dev      # http://localhost:3000
```

## Fluxos de aceitação

- **Pedido:** `/burgerhouse` → CTA/Cardápio (sheet) → X-Bacon → carrinho →
  finalizar → **login do consumidor** (entra/cadastra, pedido continua
  sozinho) → aparece em Pedidos + Clientes + Resultados e em Minha conta.
- **Agendamento:** `/barbeariadojoao` → Agendar no serviço (sheet já com o
  serviço escolhido) → profissional → dia (só dias com vaga, próximo livre
  pré-selecionado) → horário por turno → resumo + confirmar → **login** →
  aparece na Agenda e em Minha conta (com Remarcar, Cancelar, Google Agenda).
- **Avaliações:** pedido pronto/atendimento concluído → convite automático
  (1×/sessão) na conta → cai em Minha página → Depoimentos para aprovar;
  Google opcional (link + importar últimas). Máx. 4 publicadas no ar.
- **Orçamento:** bloco/Pedir orçamento (sheet) → **login** → vira lead em Clientes.
- **Conta:** menu em pílula fixo no topo (Início + abas do negócio + conta);
  deslogado mostra só o ícone, logado mostra avatar + primeiro nome → conta
  com pedidos + agendamentos;
  sair volta a pedir login nas conversões. Opcional: login com Google
  (definir `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, redirect
  `{ORIGEM}/api/auth/google/callback`).
- **Sessão:** cookie httpOnly + token Bearer (memória/localStorage) em toda
  chamada /api/*; navegação do painel 100% SPA (sem reload que derrube a
  sessão); onboarding com rascunho automático; banco com backup `.bak`
  a cada escrita.
- **Painel:** sidebar recolhe para ícones (persiste), ícones SVG, skeletons
  em todas as telas com carregamento.
- **Visual:** Minha página → Visual → 8 modelos prontos (cores + fonte +
  formato + estilo de botão) com prévia ao vivo; depois de aplicar dá para
  ajustar qualquer cor (vira "Personalizado"). Novos negócios já nascem com
  o modelo do nicho.
- **Gestão:** `/login` (demo) → Minha página (blocos, tema, publicar, QR),
  Produtos (opções/adicionais), Serviços (equipe, horários), Resultados (funil).

## Criar negócio do zero

`/register` → `/onboarding` (tipo + forma de vender) → dashboard guiado.

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
