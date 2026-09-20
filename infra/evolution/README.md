# Evolution 2.3.7 — deployment de homologação P6.1

**Pacote pronto para validação no host autorizado, não uma instalação já homologada.**
Resultado desta sessão: [`RELATORIO-P6.1-HOMOLOGACAO.md`](../../RELATORIO-P6.1-HOMOLOGACAO.md).
Não executar contra produção, comprar infraestrutura ou fazer merge da PR #31.
Não criar instâncias manualmente: **o lifecycle do InstaLink é o proprietário do vínculo**.

## 1. Topologia e arquivos

```text
Internet → TCP 443 / TLS → Caddy (opcional) → Evolution 2.3.7
                                             ├→ Postgres 15 (backend privado)
                                             ├→ Redis 7 (backend privado, senha)
                                             └→ volume evolution_instances
Evolution → HTTPS → InstaLink Preview/Staging da PR #31 → Neon do InstaLink
```

- `docker-compose.yml`: Evolution, PostgreSQL **próprio**, Redis e três volumes.
- `compose.caddy.yml` + `Caddyfile`: proxy opcional para host sem proxy existente.
- `.env.example`: nomes/documentação, segredos vazios (Compose falha sem eles).
- `.gitignore`: credenciais, backups, sessão e evidências privadas excluídos.

Evolution é **`evoapicloud/evolution-api:v2.3.7`**, fixada também pelo digest de
índice multiarch. PostgreSQL 15, Redis 7 e Caddy 2.10.2 igualmente fixados por
digest. Não substituir por `latest`. Mudança de digest é uma atualização
consciente, com revisão de segurança e nova validação; pin não dispensa updates.
Imagens confirmadas no catálogo público Docker Hub em 20/09/2026 UTC (19/09 BRT):

| Imagem | SHA-256 do índice |
| --- | --- |
| `evoapicloud/evolution-api:v2.3.7` | `1bd8afc4a6cf48822e6cf02469aeae7bd35a12a6b616eacd1291926307f4d339` |
| `postgres:15-alpine` | `a46e076249ce434e41203b8c1dadfaa025b9726331d72390df038385d6dc29cd` |
| `redis:7-alpine` | `520775a41a63e77e06c73e35d2fd9cc15921a609516818796b4ecbb813078bc7` |
| `caddy:2.10.2-alpine` | `4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d` |

Referências públicas de manifestos: [Evolution](https://hub.docker.com/v2/repositories/evoapicloud/evolution-api/tags/v2.3.7),
[Postgres](https://hub.docker.com/v2/repositories/library/postgres/tags/15-alpine),
[Redis](https://hub.docker.com/v2/repositories/library/redis/tags/7-alpine),
[Caddy](https://hub.docker.com/v2/repositories/library/caddy/tags/2.10.2-alpine).
Isso comprova existência das imagens, **não execução/pull/homologação**.

## 2. Contrato real da versão

Tag upstream `2.3.7`, commit `cd800f2976e1e5b682fbf86a01ee4d85ae61f370`:
[env](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/config/env.config.ts),
[exemplo upstream](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/.env.example),
[Dockerfile](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/Dockerfile),
[rotas](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/routes/index.router.ts),
[auth](https://github.com/EvolutionAPI/evolution-api/blob/2.3.7/src/api/guards/auth.guard.ts).

- `DATABASE_ENABLED` **não é lido por 2.3.7**. Usamos os campos efetivos:
  `DATABASE_PROVIDER=postgresql`, `DATABASE_CONNECTION_URI` e
  `DATABASE_CONNECTION_CLIENT_NAME=instalink_evolution`.
- `CACHE_REDIS_ENABLED=true`, URI autenticada, prefixo `instalink_evolution`,
  `CACHE_LOCAL_ENABLED=false`. Redis usa AOF e volume; estado de instância usa
  Postgres/volume. Não é Redis aberto/publicado.
- URIs de DB/Redis são construídas no Compose com hosts internos fixos
  `postgres:5432` / `redis:6379`. **Nunca usar o Neon do InstaLink para Evolution.**
- `AUTHENTICATION_API_KEY` é obrigatória, aleatória; não se usa fallback upstream.
  `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false` e `SERVER_DISABLE_MANAGER=true`.
- `GET /` é informativo/público e fornece `version`; testar autenticação em
  `/instance/fetchInstances`, não exigir 401 no `/`. O Dockerfile upstream tem
  label antigo de versão: conferir **resposta runtime 2.3.7**, não esse label.
- Header para Evolution: `apikey`. Webhook para InstaLink: header
  `x-instalink-webhook-secret` derivado por instância pelo app. **Não colar a
  API key no webhook nem definir webhook global**. Não alterar seu formato.
- Session `WHATSAPP-BAILEYS`, QR e webhook por instância configurados pela UI.
- Chatwoot/OpenAI/Typebot/n8n/RabbitMQ/S3/SQS/Kafka/Pusher/WebSocket/outros bots e
  telemetria desativados. Não habilitar para tentar corrigir um problema básico.

## 3. Pré-requisitos e autorização

Um operador deve disponibilizar:

1. Linux persistente (Debian 12/Ubuntu suportado), arquitetura linux/amd64 ou
   linux/arm64; dimensionar RAM/disco conforme carga, reservar espaço para imagens,
   banco e backups. Sandbox efêmero/Next/Vercel não são VPS de sessão WhatsApp.
2. Acesso SSH **explicitamente autorizado**, com usuário, host, porta e fingerprint
   verificado fora de banda. Não buscar chaves/token em máquinas ou pastas alheias.
3. Docker Engine mantido e Compose plugin v2 (com `up --wait`). Instalar pelo
   repositório oficial da distribuição/Docker, revisar comandos antes de sudo:
   https://docs.docker.com/engine/install/ . Acesso ao grupo Docker equivale a root.
4. DNS autorizado para Evolution e staging autorizado para a PR #31. Portas em
   uso devem ser verificadas antes de iniciar proxy. Não substituir proxy existente.
5. Permissão Vercel para configurar **Preview desta branch** e oferecer endpoint
   público. Não expor produção nem alterar Deployment Protection global por conta própria.
6. Unidade demo e dois telefones reais sob controle dos participantes.

Checagens no host, sem despejar ambiente:

```bash
cat /etc/os-release
docker version
docker compose version
sudo ss -lntp  # revisar localmente, não copiar inventário privado para PR
```

Copiar este diretório (arquivos versionados, **sem credenciais**) ao host autorizado,
por exemplo `/opt/instalink-evolution`. Todo comando a seguir parte desse diretório.
Manter o project name `instalink-evolution` estável para não trocar volumes por engano.

## 4. Firewall, SSH e TLS antes de subir

- Firewall da VPS **e do provedor**: somente 443/TCP público para aplicação;
  SSH restrito a IP/CIDR do operador, na porta real do servidor. Bloquear
  8080/5432/6379 tanto IPv4 quanto IPv6. Saída necessária: DNS e HTTPS para
  WhatsApp, InstaLink, registry e ACME; TLS-ALPN-01 exige entrada direta em 443.
- Docker pode contornar regras UFW ao publicar portas. Aqui só Evolution em
  **127.0.0.1:8080** e Caddy em **443** são publicados. Conferir também DOCKER-USER/
  nftables e firewall externo; não confiar apenas em `ufw deny 5432`.
- Não desativar verificação de host SSH nem autenticação por chave. Não habilitar
  senha/root remoto por conveniência. Preservar acesso administrativo e console
  de recuperação; nunca mudar firewall/sshd cegamente numa sessão remota.

**Exemplo apenas para VPS nova dedicada**, com UFW, autorização e console de
recuperação; substitua os placeholders, libere/teste SSH ANTES de ativar regras:

```bash
# NÃO executar com placeholders ou sobre firewall de servidor compartilhado.
sudo ufw allow from IP_OU_CIDR_DO_OPERADOR to any port PORTA_SSH proto tcp
sudo ufw allow 443/tcp
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw enable
sudo ufw status verbose
# Abrir segunda sessão SSH e confirmar; revisar regras equivalentes IPv6/provedor.
```

### Opção A: Caddy deste pacote (novo host)

DNS A (e AAAA só se IPv6 funcionar) aponta diretamente ao host. Não colocar proxy
CDN na frente do desafio TLS-ALPN sem tratar TLS explicitamente. `Caddyfile` usa
ACME em **443**, sem listener público HTTP/80 e sem redirect HTTP. Não precisa de
DNS API token. Caddy tem volumes próprios de certificado/configuração e admin
API desligada. Manager/assets/docs/metrics são bloqueados por allowlist de rotas.

### Opção B: proxy já existente no host

Não iniciar `compose.caddy.yml`. Usar **somente** o Compose base, cujo backend é
`http://127.0.0.1:8080`. Integrar um vhost no proxy existente com certificado válido,
mesma allowlist e sem access log de headers/corpo. No exemplo Caddy, trocar
`evolution:8080` por `127.0.0.1:8080`; não substituir o global config do host.
Nunca publicar 8080 em `0.0.0.0`, nem 5432/6379. Validar/recarregar configuração
pelo procedimento do administrador (por exemplo `caddy validate` / `nginx -t`).

## 5. Gerar segredos SOMENTE no servidor autorizado

Não usar `set -x`, não gravar sessão de terminal e não copiar valores para chat/PR.
O trecho abaixo pede **apenas hosts/e-mail públicos**, gera quatro segredos
independentes de 32 bytes com gerador criptográfico e escreve arquivos **0600**.
Recusa sobrescrever uma instalação. Não rotacionar passwords recriando `.env`
quando já existem volumes: PostgreSQL não troca a senha só com alteração de env.

```bash
umask 077
python3 - <<'PY'
import os, re, secrets
from pathlib import Path
from urllib.parse import urlsplit
paths = [Path('.env'), Path('.instalink.env')]
if any(p.exists() for p in paths):
    raise SystemExit('Arquivos já existem; pare e revise a instalação/rotação.')
host = input('Hostname Evolution autorizado (sem https://): ').strip().lower()
staging = input('Origin HTTPS do staging autorizado da PR #31: ').strip().rstrip('/')
email = input('E-mail do operador do certificado: ').strip()
u = urlsplit(staging)
if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', host) or '.' not in host or host.endswith('.invalid'):
    raise SystemExit('Hostname inválido/placeholder.')
if u.scheme != 'https' or not u.hostname or u.username or u.password or u.path or u.query or u.fragment:
    raise SystemExit('Staging precisa ser origin HTTPS, sem caminho/segredo.')
if u.hostname.endswith('.invalid') or not re.fullmatch(r'[A-Za-z0-9._+%-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', email):
    raise SystemExit('Preencha valores públicos reais e autorizados.')
api, pg, redis, webhook = (secrets.token_hex(32) for _ in range(4))
infra = f'EVOLUTION_HOST={host}\nSERVER_URL=https://{host}\nACME_EMAIL={email}\nAUTHENTICATION_API_KEY={api}\nPOSTGRES_PASSWORD={pg}\nREDIS_PASSWORD={redis}\n'
app = f'EVOLUTION_API_URL=https://{host}\nEVOLUTION_API_KEY={api}\nEVOLUTION_WEBHOOK_SECRET={webhook}\nEVOLUTION_WEBHOOK_URL={staging}/api/whatsapp/providers/evolution/webhook\n'
for path, data in zip(paths, [infra, app]):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f: f.write(data)
print('Arquivos privados .env e .instalink.env gerados (valores não exibidos).')
PY
```

`.instalink.env` é transferência privada para Vercel, **não** entra no container
Evolution. `.env` só tem o necessário para a infra. DB/Redis usam password em URI
interna porque esse é o contrato do driver; **nenhum segredo em URL pública,
query de webhook, comando curl/argv ou evidência**. Usuários root/Docker ainda
podem ler env de containers: restrinja esse acesso. Backups também contêm segredos
(token de instância/configuração autenticada do webhook); criptografar e restringir.

## 6. Validar configuração e iniciar

Opção A, com Caddy:

```bash
# Função local; usar os MESMOS arquivos em TODOS os comandos de lifecycle.
dc() { docker compose --env-file .env -f docker-compose.yml -f compose.caddy.yml "$@"; }
dc config --quiet
# Nunca usar `config` sem --quiet: a configuração resolvida contém passwords.
dc pull
dc run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
dc up -d --wait --wait-timeout 240
dc ps
```

Opção B: definir `dc() { docker compose --env-file .env -f docker-compose.yml "$@"; }`
e omitir o comando `run ... caddy`. TLS é validado no proxy do host. Não iniciar
HTTP público como solução temporária. Migrations iniciais são do entrypoint da
Evolution, no PostgreSQL próprio; não rodar migrations contra Neon.

Checagens não destrutivas:

```bash
# Status/portas somente; nunca imprimir .Config.Env ou docker inspect inteiro.
for svc in evolution postgres redis; do
  id=$(dc ps -q "$svc")
  test -n "$id" || exit 1
  docker inspect --format '{{.Name}} status={{.State.Status}} health={{.State.Health.Status}} restart={{.HostConfig.RestartPolicy.Name}} ports={{json .HostConfig.PortBindings}}' "$id"
  docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} -> {{.Destination}}{{println}}{{end}}{{end}}' "$id"
done
# SQL de leitura, só versões e contagem; sem SELECT de tokens/webhook/payload.
dc exec -T postgres psql -U evolution -d evolution -Atc 'SHOW server_version;'
dc exec -T postgres psql -U evolution -d evolution -Atc 'SELECT count(*) FROM "Instance";'
dc exec -T redis sh -ec 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'
dc exec -T redis sh -ec 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli INFO server | grep "^redis_version:"'
dc exec -T redis sh -ec 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli INFO persistence | grep -E "^(aof_enabled|aof_last_write_status):"'
```

Healthchecks não são prova de sessão conectada: Postgres usa `pg_isready`, Redis
PING autenticado, Evolution consulta API autenticada read-only (Node, disponível
na imagem final). Restart policy não reinicia container só por ficar unhealthy;
operação deve monitorar health e investigar antes de recriar.

## 7. Validar HTTPS/API sem criar instância

Executar no servidor autorizado; o script lê apenas `.env`, não imprime chave
nem a lista de instâncias (que pode conter campos sensíveis). Usa TLS verificado,
sem redirects e sem desativar certificados. Não usar `curl -v`/`--trace`/`-k`.

```bash
python3 - <<'PY'
import json, urllib.request, urllib.error
from pathlib import Path
from urllib.parse import urlsplit
env = dict(line.split('=', 1) for line in Path('.env').read_text().splitlines() if line and not line.startswith('#'))
origin = env['SERVER_URL']
assert urlsplit(origin).scheme == 'https'
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args): return None
client = urllib.request.build_opener(NoRedirect)
def probe(path, auth=False):
    headers = {'apikey': env['AUTHENTICATION_API_KEY']} if auth else {}
    try: r = client.open(urllib.request.Request(origin+path, headers=headers), timeout=30)
    except urllib.error.HTTPError as e: r = e
    except Exception as e: raise SystemExit('Falha de transporte/TLS: '+type(e).__name__)
    raw = r.read(2_000_000)
    try: data = json.loads(raw)
    except ValueError: data = None
    return r.status, data
status, data = probe('/')
version = data.get('version') if isinstance(data, dict) else None
print('Evolution host=', urlsplit(origin).hostname, 'status=', status, 'version=', version)
assert status == 200 and version == '2.3.7', 'Versão/runtime incorretos; não prossiga'
status, _ = probe('/instance/fetchInstances')
print('Sem chave:', status)
assert status in (401, 403), 'Gestão não rejeitou request anônimo'
status, data = probe('/instance/fetchInstances', True)
print('Com chave:', status)
assert status == 200 and isinstance(data, list), 'Autenticação/DB/API não confirmados'
status, _ = probe('/manager')
print('Manager público:', status)
assert status == 404, 'Manager deve estar bloqueado'
PY
```

De **outra rede**, testar DNS/TLS e anonimato, sem segredos:

```bash
# Substituir apenas HOST público autorizado; não incluir API key.
curl --silent --show-error --output /dev/null --write-out 'root HTTP=%{http_code}\n' https://HOST/
curl --silent --show-error --output /dev/null --write-out 'anonymous HTTP=%{http_code}\n' https://HOST/instance/fetchInstances
```

Esperados: raiz 200 e endpoint de gestão 401/403. Checar externamente que TCP
8080/5432/6379 estão fechados usando ferramenta aprovada pelo operador, **somente
contra o host autorizado**, sem varredura de terceiros.

## 8. Vercel Preview/Staging e Neon do InstaLink

**Não fazer merge para escapar de Deployment Protection.** O preview da PR #31
estava protegido por login Vercel nesta auditoria. É preciso um administrador
oferecer staging público autorizado, com dados de teste, ou autorizar ajuste
restrito de proteção. Não inserir bypass de SSO no código/URL/headers do vendor.
Confirmar que `DATABASE_URL` do staging usa ambiente Neon apropriado e autorizado
(isolado da produção para estes testes). Não copiar nem alterar o Neon de produção
nesta tarefa. Não desproteger superfícies sensíveis indiscriminadamente.

Quatro envs do InstaLink, **Preview + branch `arena/01a0bc51-instalink` somente**:

| Nome | Valor/fonte |
| --- | --- |
| `EVOLUTION_API_URL` | Origin HTTPS validado da Evolution |
| `EVOLUTION_API_KEY` | Mesma `AUTHENTICATION_API_KEY` global da Evolution |
| `EVOLUTION_WEBHOOK_SECRET` | Quarto segredo independente, pelo menos 32 caracteres |
| `EVOLUTION_WEBHOOK_URL` | URL pública de staging + `/api/whatsapp/providers/evolution/webhook` exatamente |

Importar por canal seguro no painel Vercel autorizado, sem colar em chat. Alternativa
CLI, **apenas após login/link no projeto correto e autorização do administrador**:
transferir `.instalink.env` via SSH verificado para diretório privado da máquina
administrativa, manter 0600 e executar ali (nunca no Git). O comando captura a saída
da CLI para não despejar valores/erros potencialmente sensíveis:

```bash
python3 - <<'PY'
import subprocess
from pathlib import Path
values = dict(line.split('=', 1) for line in Path('.instalink.env').read_text().splitlines() if line)
expected = {'EVOLUTION_API_URL','EVOLUTION_API_KEY','EVOLUTION_WEBHOOK_SECRET','EVOLUTION_WEBHOOK_URL'}
assert set(values) == expected
for name, value in values.items():
    r = subprocess.run(['vercel', 'env', 'add', name, 'preview', 'arena/01a0bc51-instalink'], input=value+'\n', text=True, capture_output=True)
    print(name, 'importada' if r.returncode == 0 else 'FALHA: revisar escopo/valor existente no painel autorizado')
    if r.returncode: raise SystemExit(1)
PY
```

Se variável já existe, parar e revisar; não apagar/substituir indiscriminadamente.
Fazer **redeploy do preview da branch**, nunca `vercel --prod`. Conferir commit,
quatro variáveis e scope. Após importação conferida, remover apenas o arquivo de
transferência `.instalink.env` das máquinas; conservar segredos no cofre autorizado.
Não rotacionar segredo webhook de sessão ativa sem reconfigurar pelo lifecycle.

### Prova externa de reachability + rejeição (antes do QR)

Sem cookie/login e sem chave válida, de outra rede:

```bash
curl --silent --show-error --max-time 30 --output /dev/null \
  --write-out 'webhook invalid-auth HTTP=%{http_code} type=%{content_type}\n' \
  --request POST --header 'Content-Type: application/json' \
  --header 'x-instalink-webhook-secret: invalid-reachability-probe' \
  --data '{"instance":"il_00000000000000000000000000000000","event":"connection.update"}' \
  https://STAGING/api/whatsapp/providers/evolution/webhook
```

Não usar `-L` (não esconder redirect para login). Esperado **403 JSON do InstaLink**
`Webhook inválido.`, não HTML/SSO. Antes das envs, 503 JSON `Provider indisponível.`
prova só chegada à aplicação; **não** prova autenticação configurada. 404 falha.
Login Vercel/redirect/HTML 401 significa `BLOCKED_EXTERNAL_PUBLIC_PREVIEW`.
Nenhum evento inválido deve ser aceito nem gravado. Repetir sem header. Confirmar
origem do erro em inspeção local, sem publicar páginas/cookies/nonce de login.

## 9. Teste físico e evidência mínima

Criar registros exclusivamente de teste consentido. Roteiro detalhado de produto:
[`RELATORIO-P6.1.md §13`](../../RELATORIO-P6.1.md#13-roteiro-manual-obrigatório-gate-comercial).
Não habilitar campanhas/automações extras que confundam contagem de respostas.

1. Unidade demo, serviço público, profissional elegível, duração/buffer,
   disponibilidade, exceções, antecedência e timezone reais. Recurso Agente,
   agente.enabled e canal WhatsApp ativos.
2. Canais → QR Experimental → Conectar. **Não chamar /instance/create à mão**.
   Conferir QR vindo do provider, regeneração e estado. QR não vai para evidência,
   banco, screenshots públicos, logs ou Git.
3. Telefone A lê o QR por Aparelhos conectados. Conferir connected e número na UI.
4. Telefone B manda `Oi`: inbound/outbound reais em Conversas e telefone B; Contact,
   Lead reutilizado/criado, origem/canal WhatsApp. Número do teste só mascarado no relatório.
5. `Quais serviços vocês têm?`: catálogo desta unidade, sem preços privados.
6. `Quero agendar` → serviço → dia disponível → horário → confirmação → `sim`.
   Conferir Booking na **Agenda existente**, serviceId/unidade/profissional/fuso/
   status inicial, lead scheduled, contexto/histórico e resposta no telefone.
7. Conflito controlado: após oferecer horário, ocupá-lo por outro fluxo de teste;
   confirmar via WhatsApp → pedir outro horário, sem dois bookings conflitantes.
8. `Quero falar com um atendente`: uma resposta de handoff, UI Humano, próxima
   mensagem sem bot. Resposta manual chega no B. Reativação só por ação explícita.
9. Dedupe **só se existir captura autorizada do evento real e canal seguro**:
   reentregar ID original sem trocar corpo/ID/instância, comparar contagens antes/
   depois. Não forjar evento válido para substituir teste de telefone. Não ligar
   logging bruto de webhooks para capturar tokens. Se não houver meio seguro,
   registrar caso não executado (a suíte automatizada anterior não é prova física).
10. Fazer teste de restart abaixo; depois B manda outra mensagem, confirmar ida/volta.

Registrar hora UTC, commit/deployment, host, versão e status HTTP; IDs comerciais
apenas se não sensíveis; comparar igualdade de serviceId/businessId/profissional,
contagens e resultado. Não anexar `.env`, QR/base64, payload completo, telefone
inteiro, mensagens pessoais ou resposta bruta de fetchInstances. `HOMOLOGATED`
só depois de **QR real + dois telefones + Booking real + handoff**.

## 10. Persistência, restart, backup e recuperação

`restart: unless-stopped`, Postgres/Redis/instances em volumes nomeados; Caddy tem
volumes de certificado. Registrar os nomes/contagens antes e depois, sem conteúdo.

```bash
dc ps
dc exec -T postgres psql -U evolution -d evolution -Atc 'SELECT count(*) FROM "Instance";'
# Restart apenas da API; não precisa parar DB/cache a cada reconexão.
dc restart evolution
dc up -d --wait --wait-timeout 240
dc ps
dc exec -T postgres psql -U evolution -d evolution -Atc 'SELECT count(*) FROM "Instance";'
# Repetir consultas sanitizadas HTTPS/API; atualizar estado pelo InstaLink.
# Com sessão conectada, confirmar mensagem física antes/depois do restart.
```

Somente em janela autorizada, sem requests em andamento, testar separadamente
`dc restart redis postgres` e repetir `dc up -d --wait --wait-timeout 240`. Mesmo
nome de instância deve permanecer. WhatsApp pode exigir novo pareamento: registrar
a ocorrência em vez de anunciar reconexão automática que não aconteceu.

**Nunca executar remoção de volumes, prune de volumes nem `down -v`.** Não mudar
project name, apagar instância ou clicar Remover para testar restart. `dc stop`
para manutenção mantém dados; `dc up -d` retoma. Antes de update/recriação, backup
coerente do banco + instances + Redis e restauração ensaiada em ambiente isolado.
Exemplo de backup local privado com aplicação parada, sem exibir conteúdo:

```bash
umask 077
mkdir -p backups
chmod 700 backups
dc stop evolution
# Dump binário contém segredos/PII: criptografar para cofre autorizado, não anexar.
dc exec -T postgres pg_dump -U evolution -d evolution -Fc > backups/evolution.dump
# Capturar também volumes de instances/Redis pelo mecanismo de snapshot/backup
# autorizado do host, com Redis parado para snapshot consistente do AOF.
dc stop redis
# AQUI o operador faz snapshot dos volumes identificados por docker inspect.
# Não considerar backup completo enquanto faltar esse snapshot.
dc up -d --wait --wait-timeout 240
```

Sem backup anterior/ensaio de restore não fazer upgrade de schema/major. Para
rollback, parar API e restaurar o conjunto compatível em ambiente autorizado;
não fazer downgrade de imagem cegamente sobre banco migrado.

## 11. Observabilidade segura

- Evolution vem com `LOG_LEVEL=ERROR,WARN`, Baileys silent e **logging driver none**.
  Upstream pode imprimir headers, QR ou erros sensíveis apesar do nível escolhido;
  portanto stdout **não é retido pelo Docker**. Não usar `docker attach`/`logs -f`
  para obter QR ou diagnosticar. Não adicionar coletor bruto de stdout na VPS.
- É um trade-off explícito: diagnóstico aqui por health, status API, número de
  instâncias, volumes, eventos sanitizados do InstaLink e últimos inbound/outbound.
  Não afirmar que logs Evolution foram analisados quando nenhum está retido.
- Logs DB/Redis/Caddy têm rotação. Não habilitar Caddy access/debug nem SQL query
  logging de mensagens/credenciais. No relatório só resultados sanitizados.
- Na Vercel, revisar logs autorizados da branch e datas/erros em Canais, sem dump
  de env/request/payload. Scheduler/retry do InstaLink continua o existente.
- Se precisar diagnóstico upstream profundo, parar homologação e desenhar coleta
  com redação **antes** de persistir logs. Não enfraquecer segredo/TLS/firewall.

## 12. Validação local do pacote e gates de liberação

Sem Docker/host autorizado não executar nem simular containers. A auditoria desta
sessão fez parse YAML, schema oficial Compose e invariantes estáticas; isso **não**
é `docker compose up`. Na VPS continuam obrigatórios `config --quiet`, validação
Caddy, pull dos digests, boot, auth, HTTPS, persistência e teste com telefones.

Para reproduzir a validação de schema em máquina de desenvolvimento com Node/npm
(e GitHub CLI autorizado para leitura pública), sem Docker e **sem carregar `.env`**:

```bash
CHECK_DIR=$(mktemp -d)
npm install --prefix "$CHECK_DIR" --no-package-lock --ignore-scripts yaml@2.8.1 ajv@8.17.1
gh api repos/compose-spec/compose-spec/contents/schema/compose-spec.json?ref=914ec15d1fa498969c0df5c1d672306db3256089 --jq .content | base64 -d > "$CHECK_DIR/schema.json"
NODE_PATH="$CHECK_DIR/node_modules" COMPOSE_SCHEMA="$CHECK_DIR/schema.json" node <<'JS'
const fs = require('fs'), YAML = require('yaml'), Ajv = require('ajv/dist/2020');
const assert = require('assert/strict');
const validate = new Ajv({ strict: false, validateFormats: false }).compile(JSON.parse(fs.readFileSync(process.env.COMPOSE_SCHEMA, 'utf8')));
const read = file => {
  const d = YAML.parseDocument(fs.readFileSync(file, 'utf8'), { uniqueKeys: true });
  assert.equal(d.errors.length, 0);
  const o = d.toJS(); assert(validate(o), JSON.stringify(validate.errors)); return o;
};
const b = read('docker-compose.yml'), p = read('compose.caddy.yml');
assert(validate({ ...b, services: { ...b.services, ...p.services }, volumes: { ...b.volumes, ...p.volumes } }));
assert.equal(b.networks.backend.internal, true);
for (const key of ['postgres', 'redis']) {
  assert.equal(b.services[key].ports, undefined);
  assert.deepEqual(b.services[key].networks, ['backend']);
}
assert.deepEqual(b.services.evolution.ports, ['127.0.0.1:8080:8080']);
assert.deepEqual(p.services.caddy.ports, ['443:443']);
console.log('Schema + isolamento estático OK. Não é validação runtime.');
JS
```

Sem mudança de `src/`/dependências, não há necessidade de repetir mocks do produto.
Qualquer bug revelado por homologação deve ter reprodução real, teste que falha,
correção na **mesma branch**, gates de `RELATORIO-P6.1.md` e commit separado.
Não marcar `HOMOLOGATED` por config válida, healthcheck, teste unitário ou sucesso
do deployment Vercel. Não fazer merge da PR #31.
