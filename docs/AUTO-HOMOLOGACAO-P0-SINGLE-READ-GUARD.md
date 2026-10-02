# P0 Infra — single-read authenticated guard · auto-homologação

> Data: 2026-10-02 (UTC) · branch `arena/01a0feb4-instalink` · base `main` (`02389c44b6eeaf1bd164ce54834d6442da62c515`).
> Estado: implementação e gates automatizados concluídos; smoke HTTP local multi-persona aprovado. A etapa de Chromium/UI **não foi executada** porque não há browser instalado e os downloads foram bloqueados pela rede. PR #50: https://github.com/HernaniFigueira/instalink/pull/50 (**aberta; não mergeada**). **Produção não foi usada para QA.**

## Escopo e limites

- Implementar o P0 single-read antes de Clinical Encounter F1: autenticação, sessão de suporte, tenant, membership, vínculo/professional scope e permissões usam o mesmo `DB` local à operação.
- Sem cache global, de módulo, singleton, TTL ou memoização entre requests. Snapshot existe somente na pilha da chamada/request e é passado explicitamente.
- Sem mudança de UI, DTO, regra clínica/comercial ou comportamento da Agenda 2.0. F1 não foi iniciado.
- Não substituir `updateDB()` por leitura ou mutação fora da transação. Manter leituras novas de domínio quando sua finalidade for consistência/pós-escrita e anotá-las separadamente de `readDB`.

## Implementação

### Resolvers e guards

- `src/lib/auth.ts`
  - `getUserBySessionFromDB(db, sessionId)` é síncrono/puro e resolve sessão + usuário do snapshot recebido.
  - `userFromRequestFromDB(req, db)` tenta primeiro o cookie `il_session`; se ausente, inválido ou expirado, usa o Bearer **no mesmo snapshot**. Um cookie válido continua prevalecendo sobre outro Bearer.
  - `hasRequestCredentials(req)` permite encerrar requests sem credenciais sem carregar `instalink_doc`.
  - As APIs standalone existentes (`getUserBySession`, `userFromRequest`, `currentUser`) foram mantidas. Os wrappers só leem quando precisam; `userFromRequest` sem credenciais retorna `null` sem I/O.
- `src/lib/access.ts`
  - `supportFromDB` e `supportFromRequestFromDB` resolvem suporte sem I/O. Sessão encerrada, expirada ou pertencente a outro Master continua inválida.
  - `requireBusiness` autentica e resolve suporte, negócio/tenant, membership, vínculo profissional, permissões e modo somente leitura no mesmo `DB`; devolve o snapshot como `guard.db`. Sem credenciais: `401` e zero leituras; `businessId` ausente: `400` antes de ler.
  - `requireMaster` autentica e autoriza Master em uma leitura e devolve esse mesmo snapshot.
  - `currentAccess` resolve sessão, suporte e `AccessContext` a partir da mesma leitura; sem cookie de sessão, retorna `null` sem ler.
  - Os wrappers standalone de suporte continuam disponíveis para callers que não tenham snapshot.

### Reuso nos consumidores

Foram removidas leituras redundantes de autenticação/acesso e/ou reutilizado o snapshot já carregado em:

- APIs `/api/auth/me`, `/api/admin/support`, `/api/master/support`, rotas Master e `/api/setup-master`.
- Agenda `/api/bookings`: os modos autenticados `manage` e `slots-admin` autorizam uma vez e consomem `guard.db`; o POST `asOwner` também lê a partir do guard. `professionalScope`, filtros e DTO existentes permanecem. Caminhos públicos de slots continuam usando a própria leitura de dados.
- Leituras gerenciadas de Reviews, Anamnese e Team; pré-validação `person.save` usa `guard.db` e a gravação autoritativa permanece em `updateDB()`.
- `/api/results` (negócio e organização), `/api/organizations`, `/api/account` (POST), `/api/businesses` (POST), GET de `/api/entity-deletion` e callback de onboarding do Instagram.
- `src/lib/public.ts`: a sessão do Owner é resolvida a partir do banco já carregado para a página pública. `src/lib/tenant.ts`: `myBusinesses()` resolve o cookie a partir do snapshot já carregado para listar negócios.

### Classificação das leituras restantes

| Classe | Tratamento |
| --- | --- |
| Snapshot de autenticação/autorização | Reutilizado: nenhuma segunda leitura para revalidar user/session/support/tenant/membership/professional/permissions na mesma operação. |
| `updateDB()` | Mantido como caminho de escrita/transação. O trabalho não substitui nem conta `updateDB()` como leitura. |
| Leitura de domínio antes de escrita | Mantida quando é uma verificação separada da guarda: Team POST legado consulta e-mail global e vínculo de Professional; Anamnese confere respostas vinculadas antes de excluir template e carrega o template corrente para validar respostas; Pets DELETE confere uso em Booking/Encounter antes de excluir/desativar. Não são resoluções adicionais de identidade/acesso. |
| Reler após mutação | Mantido quando a resposta depende do estado canônico ou de dados acabados de gravar: Pages (persistência canônica), Bookings/Queue/Tasks/Encounters (view/hidratação), Automations e propostas AI (view/histórico após write ou drain), Campaigns (entrega imediata) e `freshPlan` do onboarding WhatsApp após a operação externa. |
| Outros fluxos | Leituras próprias de rotas públicas/de cliente (p.ex. slots públicos, Reviews públicos, Leads/Orders) continuam separadas das rotas protegidas correspondentes; não se aplicou substituição mecânica por `guard.db`. |

A lista acima classifica as leituras encontradas no audit de rotas; não afirma redução em bytes/memória. Nenhuma medição de MB foi realizada.

## Contratos de segurança preservados

- Sem sessão: `401`; `businessId` vazio: `400`; tenant inexistente/sem vínculo e falta de permissão: `403`.
- Cookie válido tem precedência; cookie inválido/expirado pode cair para Bearer válido no mesmo snapshot. Sessões de usuário expiradas seguem recusadas.
- Master não recebe tenant por pertencer à plataforma: precisa da sessão de suporte válida para acessar um negócio. Suporte segue somente leitura (`GET`/`HEAD`); escrita continua `403`.
- Suporte expirado, encerrado ou vinculado a outro Master continua negado.
- Membership, permissões efetivas e escopo do Profissional continuam determinados no servidor. Profissional autenticado só recebe dados do Professional realmente vinculado; payloads/DTOs públicos não foram ampliados.

## Testes e validação

### Teste novo

`src/lib/__tests__/single-read-auth-guard.test.ts` — **14/14**. Inclui contagem de `readDB` para `requireBusiness` com cookie, cookie expirado + Bearer válido, Master + suporte, `requireMaster`, `currentAccess`, `userFromRequest` standalone e ausência de credenciais; identidade do snapshot; expiração/encerramento/vínculo de suporte; 401/400/403; precedência do cookie; permissions e `professionalScope`; payloads representativos de Agenda, Catálogo, Configurações, Team e MASTER.

### Gates

- `npm ci`: concluído.
- `npm run typecheck`: **OK** (`tsc --noEmit`).
- `npm run build`: **OK** (Next.js 14.2.35).
- Suíte focada de regressão incluindo o teste P0: **136/136** em 10 arquivos (122 testes existentes de Agenda, Team/person orchestration, permissões, MASTER/setup, DTO e rotas A3.4 + 14 testes novos P0).
- `npm test`: **2917 passaram / 4 falharam (2921 total, 211 arquivos)**. Divergência corresponde exatamente à baseline conhecida: 3× `a34-instagram` e 1× `automation-audit-p4`; não foi observada nova falha. Falhas registradas nos testes de envio/resposta/limite do Instagram e em poda de execução `waiting` do P4.
- `git diff --check`: OK na revisão do código; repetir após alterações de documentação antes da entrega.

### Banco descartável e login real local (HTTP)

- `next start` local na porta 3001, com `INSTALINK_DB_FILE=/home/user/.cache/p0-single-read-20261002/instalink.db.json` e `DATABASE_URL` explicitamente ausente. Nenhuma conexão a banco remoto.
- Tenant descartável `Clínica Fake P0` criado pela API local. Contas sintéticas criadas e autenticadas pela rota real `/api/auth/login` (senha local fictícia `local1234`): `owner@local.test`, `maria@local.test` (Recepção) e `orlando@local.test` (Profissional).
- Resultado: 3/3 logins HTTP `200`; `/api/auth/me` identificou `OWNER`, `SECRETARIA` e `PROFISSIONAL`; `/api/bookings?mode=manage` respondeu `200` às três personas, com escopo `all` para Owner/Recepção e `professionalId` vinculado para Orlando.
- Os arquivos do banco/fixture ficaram fora do repositório, em diretório de cache descartável. Não foram gravadas credenciais de QA no Git.

### Limitação de Chromium/UI

- `npx playwright install chromium` falhou porque o sandbox não conseguiu estabelecer conexão TLS com `cdn.playwright.dev` (`ECONNRESET`); não havia executável Chromium/Chrome pré-instalado.
- Tentativa de obter Chromium pelo índice Debian também falhou por conexão indisponível a `deb.debian.org`.
- Portanto: o smoke HTTP e os testes automatizados foram feitos, mas **não** houve login/navegação visual no Chromium. Não declarar QA de browser/visual como concluído; repetir quando houver browser disponível.

## Segurança operacional

- **Produção usada para QA: NÃO.**
- **Merge: NÃO.**
- Clinical Encounter F1: não iniciado.
- `npm ci` informou 2 advisories no lockfile (1 high, 1 critical); não foi executado `npm audit fix`, fora do escopo desta mudança.
