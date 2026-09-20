# P6.1 — infraestrutura e homologação física

**Resultado: `BLOCKED_EXTERNAL_VPS`**

**Bloqueio adicional confirmado: `BLOCKED_EXTERNAL_PUBLIC_PREVIEW`.**

Auditoria em 19/09/2026 BRT (consultas de infraestrutura em 20/09/2026 UTC).
PR: [#31](https://github.com/HernaniFigueira/instalink/pull/31).
Branch: `arena/01a0bc51-instalink`. **Nenhum merge realizado.**

Este relatório não converte os testes mockados anteriores em prova física.
**Não houve QR real escaneado, conversa por telefone, Booking de homologação nem
sessão real reiniciada nesta tarefa.** Nenhuma instância foi criada manualmente.

## 1. Auditoria inicial, antes de alterações

- Executado `git fetch origin`.
- HEAD local: `7787d4cd8567c21acc8fc48821402009983401ab`.
- Mesmo HEAD confirmado no `headRefOid` da PR e por
  `git ls-remote origin refs/heads/arena/01a0bc51-instalink` (o fetch refspec local
  não materializou esse nome em `refs/remotes/origin`, por isso a segunda checagem).
- PR **OPEN**, não draft, **MERGEABLE**, `mergeStateStatus=CLEAN` na auditoria.
- Checks Vercel e Vercel Preview Comments: **SUCCESS** para esse commit. Isso
  comprova deployment da aplicação, não acesso público ao webhook nem Evolution.
- Lidos `RELATORIO-P6.1.md`, `.env.example`, `ARQUITETURA.md`; revisados client,
  lifecycle, send, rotas de gestão/webhook Evolution e inbound compartilhado.
- Contrato confirmado: Evolution **2.3.7**, header `apikey` na API; callback com
  header próprio derivado por instância; rotas `/instance/*`, `/webhook/set/*`,
  `/message/sendText/*`. Sessão externa, nunca no Next/Vercel.

## 2. Acesso autorizado e infraestrutura

| Item | Situação efetiva |
| --- | --- |
| GitHub do repositório | Acesso configurado; usado apenas para fonte, PR e esta branch |
| VPS Linux autorizada | **Nenhum host/usuário/porta/autorização de administração fornecido** |
| Ambiente da sessão | Sandbox Debian GNU/Linux 12, não servidor de sessões WhatsApp autorizado |
| Docker/Compose local | CLI Docker/Compose ausente; `/var/run/docker.sock` indisponível |
| Vercel administrativo | Nenhum acesso administrativo explicitamente disponibilizado; nenhuma configuração alterada |
| Domínio Evolution/DNS | Nenhum subdomínio/controle de DNS autorizado fornecido |
| Evolution real | Não instalada/não executada |
| PostgreSQL Evolution | Não provisionado; pacote prevê Postgres 15 próprio |
| Redis Evolution | Não provisionado; pacote prevê Redis 7 autenticado e privado |
| HTTPS Evolution | Não emitido; pacote prevê proxy e certificado ACME em 443 |
| Neon InstaLink | **Não acessado, alterado, copiado nem utilizado para Evolution** |
| Telefones A/B | Não disponibilizados nesta sessão |

Não foram comprados serviços, criadas contas pagas nem utilizados meios de
pagamento. Não se pesquisaram chaves SSH, arquivos privados de autenticação ou
credenciais de infraestrutura descobertas por acaso. Nenhuma conexão SSH a host
não autorizado, alteração de firewall remoto ou mudança de produção.

## 3. Pacote de deployment entregue

Diretório [`infra/evolution/`](infra/evolution/README.md):

| Arquivo | Função |
| --- | --- |
| `docker-compose.yml` | Evolution 2.3.7 + PostgreSQL 15 + Redis 7; restart, healthchecks, volumes e redes |
| `compose.caddy.yml` | Reverse proxy opcional para novo host autorizado, somente porta pública 443 |
| `Caddyfile` | HTTPS ACME TLS-ALPN-01, admin desligado, allowlist de endpoints, manager bloqueado |
| `.env.example` | Placeholders sem segredos e documentação das envs reais da versão |
| `.gitignore` | Exclui runtime env, transferência privada Vercel, backups e evidências privadas |
| `README.md` | Preparação/autorizações, geração de segredos no host, firewall/SSH/TLS, deploy, verificações, Vercel, testes reais, restart e backup |

### Decisões de segurança

- Imagem obrigatória **`evoapicloud/evolution-api:v2.3.7`**, também fixada pelo
digest de índice multiarch `sha256:1bd8afc4a6cf48822e6cf02469aeae7bd35a12a6b616eacd1291926307f4d339`.
Sem `latest`; imagens de PostgreSQL, Redis e Caddy também fixadas por digest.
- Apenas Caddy publica **443/TCP**. Evolution publica **127.0.0.1:8080** para
permitir proxy já instalado no host, nunca HTTP público. Postgres/Redis **sem
ports**, somente rede Docker `internal: true`. Evolution tem rede adicional
para saída HTTPS a WhatsApp/webhook.
- Senhas de PostgreSQL/Redis e API key obrigatórias em Compose (`:?`, sem fallback).
Geração criptográfica documentada para execução **no servidor autorizado**:
quatro valores independentes, incluindo segredo webhook InstaLink; arquivos 0600,
sem imprimir valores. **Nenhum segredo de deployment foi gerado nesta sessão**.
- Postgres próprio fixo em `postgres:5432/evolution`, Redis em `redis:6379/0`;
nenhuma variável da Evolution aponta para Neon.
- `SERVER_DISABLE_MANAGER=true` e bloqueio no proxy; segredo de instância não
exposto por fetchInstances. Integrações extras/telemetria/global webhook desligados.
- Sessão/instances, Postgres, Redis AOF e certificados em volumes nomeados.
Restart `unless-stopped`, dependências healthy, `no-new-privileges`.
- Logging Evolution **driver none**: upstream pode imprimir QR/headers em erros;
não reter stdout bruto. Diagnóstico por health/status/eventos sanitizados do
InstaLink. Não alegamos inspeção de logs Evolution que não foram gerados/retidos.
Logs DB/Redis/proxy rotacionados, sem log de corpo/header de requests.
- Firewall e SSH dependem do administrador autorizado. Há procedimento com
restrição do SSH a origem administrativa, 443 público, cuidado com IPv6/Docker
vs UFW e manutenção de acesso de recuperação; nada disso foi executado remotamente.

### Conferência da versão upstream

Fonte `EvolutionAPI/evolution-api`, tag `2.3.7`, commit
`cd800f2976e1e5b682fbf86a01ee4d85ae61f370`. Conferidos via GitHub API:
`src/config/env.config.ts`, `.env.example`, `Dockerfile`,
`src/api/routes/index.router.ts`, `src/api/guards/auth.guard.ts`, `package.json`.

Achados relevantes de infraestrutura (não bugs novos do produto):

1. `DATABASE_ENABLED` não é lido pela 2.3.7. Não foi inventado esse toggle:
   Compose define `DATABASE_PROVIDER`, `DATABASE_CONNECTION_URI` e client name.
2. Root `GET /` é público e informativo; teste de auth usa
   **`/instance/fetchInstances`**, que deve recusar chamada sem key.
3. `SERVER_DISABLE_MANAGER` existe no código, embora não apareça em todos os
   exemplos. Foi habilitado, além da allowlist do proxy.
4. Dockerfile upstream tem label antigo; `package.json` da tag informa **2.3.7**.
   O gate runtime exige `/` com `version=2.3.7`, não confia só no label da imagem.
5. Docker Hub confirmou a tag/manifesto obrigatório, com linux/amd64 e linux/arm64.
   **Não equivale a ter feito pull nem iniciado container**.

Links de fonte e manifestos/digests completos constam no README do pacote.

## 4. Reachability — observações reais

### Evolution

**Não testada**: não existe URL/servidor autorizado fornecido. Nenhum status HTTP,
certificado TLS, conexão Postgres/Redis ou teste de autenticação foi inventado.
Comandos de teste real estão prontos no README e não criam instância.

### InstaLink / PR #31

Endpoint consultado, obtido do comentário de deployment Vercel da própria PR:

```text
https://instalink-git-arena-01a0bc51-b56499-hernanicross-3509s-projects.vercel.app/api/whatsapp/providers/evolution/webhook
```

- Consulta **externa sem sessão** pela ferramenta de leitura web: redirecionada
  para Vercel, título **“Protected Deployment – Vercel”**, conteúdo **“Log in to
  Vercel”**. Não incluir nonce/cookies/URL completa de SSO como evidência.
- Duas tentativas **POST**, sem chave e com header inválido, pelo runtime do
  sandbox: falha de transporte (`URLError`), **sem status HTTP observado**. Não
  foram chamadas bem-sucedidas ao app; não contam como teste do guard do webhook.
- Não foi observado 403 JSON `Webhook inválido.` emitido pelo InstaLink nesta
  tarefa. Não foi comprovado alcance POST anônimo ao app.
- **Conclusão: `BLOCKED_EXTERNAL_PUBLIC_PREVIEW`.** O caminho consultado impõe
  autenticação de deployment antes do produto. É necessário staging público
  autorizado ou ajuste restrito de Deployment Protection pelo administrador.
- Nenhum bypass, segredo em query/header de SSO, alteração de produto, merge ou
  exposição global do painel foi usado para contornar o bloqueio.

Após configuração, o gate é externo: POST sem credencial válida deve chegar ao
app e obter **403 JSON**, não 404/redirect/HTML/login. Antes das envs, 503 JSON
`Provider indisponível.` apenas prova reachability; não libera teste do QR.

## 5. Validação local do pacote (sem mocks de canal)

Executado:

- Parse YAML com chaves únicas e validação do **schema oficial Compose** nos dois
  arquivos e modelo estrutural combinado.
- **16 verificações estáticas aprovadas**: versões/digests, portas, isolamento de
  redes, restart/no-new-privileges, volumes, healthchecks/dependências, segredos
  obrigatórios, URI interna própria, integrações desativadas, manager/telemetria,
  logging, placeholders e correspondência das envs com o código real 2.3.7.
- **12 blocos shell do README** aprovados por `bash -n`; trechos Python embutidos
  aprovados por `ast.parse`, **sem execução/geração de secrets**.
- `git check-ignore` confirmou exclusão de `.env`, `.instalink.env` e dump de
  backup; `.env.example` permanece versionável.
- `git diff --check` sem problemas. Nenhum arquivo de aplicativo/lockfile alterado.

Ferramentas de análise isoladas em `/tmp`, sem dependências novas no projeto:
`yaml@2.8.1`, `ajv@8.17.1` (JSON Schema 2020-12). Schema upstream
`compose-spec/compose-spec` commit `914ec15d1fa498969c0df5c1d672306db3256089`,
`schema/compose-spec.json`. Modelo combinado validado estruturalmente, **não**
interpolado/executado pelo CLI Compose.

Não executado:

- `docker compose config`, `pull`, `up`, `ps`, healthchecks ou restart reais
  (Docker/daemon ausentes). A tentativa de obter somente o binário público
  standalone Compose também falhou no download de release; não foi executado.
- `caddy validate` no runtime Caddy, emissão de certificado ou validação TLS da
  Evolution. Há comandos prontos para o host autorizado.
- Testes mockados do canal — **não foram usados nesta etapa**.
- `npm test`, typecheck, build e smokes do aplicativo — **não repetidos** porque
  esta entrega altera exclusivamente infraestrutura declarativa/documentação;
  os resultados anteriores permanecem em `RELATORIO-P6.1.md`, não são reatribuídos
  a esta homologação. Se houver bug/correção de aplicativo, todos os gates daquele
  relatório voltam a ser obrigatórios.

Validação estática não prova permissões de volume, funcionamento da imagem,
conectividade externa, HTTPS, reconexão de sessão ou capacidade da VPS. Todos
continuam gates operacionais pendentes; não chamar pacote de servidor homologado.

## 6. Matriz física — não executada sem infraestrutura

| Área | Evidência exigida | Resultado nesta sessão |
| --- | --- | --- |
| QR | QR real gerado/regenerado pelo lifecycle, sem persistir no DB | **Não executado** |
| Pareamento | Telefone A escaneia; connected; número reconhecido | **Não executado** |
| Inbound | Telefone B manda `Oi`; Message inbound real | **Não executado** |
| Outbound | Resposta recebida fisicamente no B | **Não executado** |
| CRM | Contact, Lead e Conversation da unidade, source/channel WhatsApp | **Não executado** |
| Conhecimento | Serviços reais, isolamento e preço público | **Não executado** |
| Agenda | Serviço/dia/horário/confirmação/`sim` → Booking na Agenda existente | **Não executado** |
| Conflito | Slot ocupado entre oferta e confirmação, sem double-booking | **Não executado** |
| Handoff | Uma resposta; mode=human; próxima mensagem sem bot | **Não executado** |
| Resposta humana | Inbox → mensagem no B; retomada explícita | **Não executado** |
| Reentrega | Replay seguro de evento real com mesmo externalId, sem duplicação | **Não executado** |
| Persistência | Mesmo volume/instância/dados após restart, nova mensagem física | **Não executado** |
| Observabilidade | Vercel/eventos/status reais e registros sanitizados | **Não executado** |

O README traz a sequência operacional e liga ao roteiro de produto do relatório
P6.1. Não há dados comerciais fabricados para preencher esta tabela.

## 7. Bugs encontrados

**Nenhum bug do aplicativo comprovado por teste físico**, pois o ambiente externo
não foi disponibilizado. Nenhuma alteração em `src/`, nenhum novo mock, motor,
flag, CRM, Agenda ou rota. As diferenças são só pacote de deployment e relatório.
Se a execução real revelar erro, corrigir nesta mesma branch com teste que
reproduza a falha e commit específico; não abrir outra PR.

## 8. Próximo acesso humano necessário — exatamente

Para sair dos bloqueios, o responsável precisa:

1. **Disponibilizar Linux/VPS persistente já autorizado**, com endereço, usuário,
   porta SSH, fingerprint verificável e permissão explícita de instalar/operar
   Docker, firewall e proxy. Conceder acesso por mecanismo seguro da plataforma
   ou executar pessoalmente o README. **Não enviar senha/chave privada/token em chat.**
2. **Autorizar DNS/subdomínio** da Evolution e confirmar quem administra HTTPS,
   firewall e backups. Host dedicado ou integração aprovada com proxy existente.
3. **Disponibilizar administração do staging Vercel**, vinculada à branch da
   PR #31: endpoint público de webhook sem SSO, quatro envs em scope Preview,
   redeploy e ambiente Neon autorizado/isolado para testes. Um administrador deve
   decidir a exposição; nada de merge para contornar Deployment Protection.
4. **Disponibilizar unidade demo e dois telefones**, com operador para escanear
   QR, enviar mensagens e conferir Agenda/CRM/handoff/restart. Autorizar apenas
   os dados e números de demonstração, com acesso de aplicação adequado.

Segredos serão gerados **na VPS autorizada**, independentes, transferidos para
Vercel/cofre por canal seguro. Até esses acessos existirem, não é possível provar
inbound/outbound/Booking reais nem declarar `PARTIALLY_HOMOLOGATED` (não há infra
real nossa no ar), muito menos `HOMOLOGATED`.

## 9. Resultado final e PR

**`BLOCKED_EXTERNAL_VPS`**, com **`BLOCKED_EXTERNAL_PUBLIC_PREVIEW`** adicional.
Pacote de infraestrutura/documentação pronto para o operador executar e validar.
PR #31 recebe este checkpoint e comentário de bloqueios; permanece aberta para
revisão. **Nenhum merge para `main`.**
