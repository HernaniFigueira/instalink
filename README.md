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
