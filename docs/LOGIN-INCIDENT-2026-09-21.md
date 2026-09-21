# Login — investigação de 21/09/2026

## Comprovado

- A mensagem relatada, “Não foi possível entrar. Tente novamente.”, era produzida exclusivamente pelo `catch` de `src/app/api/auth/login/route.ts`, com HTTP 500. Ela cobre falhas na leitura do banco, criação da sessão e gravação de último acesso/auditoria. Não prova senha incorreta.
- Credencial inválida retorna 401; limite existente de 15 tentativas/minuto por origem retorna 429. Sessão ausente/expirada retorna 401 em `/api/auth/me`.
- Comparação `ebc7130..353d31a`: autenticação, login API, cookies, cliente de sessão e `/api/auth/me` não foram alterados na rodada anterior. A persistência recebeu somente inicialização/normalização aditiva de `deletionAuthorizations`. Não há middleware de autenticação no checkout.
- Metadados autorizados do GitHub: último deployment Production registrado em 20/09/2026, SHA `ebc7130`, status success; Preview do PR #33 em 21/09/2026, SHA `353d31a`, status success. Isso **não comprova a saúde do runtime/banco nem qual alias o usuário acessou**.
- Não há conexão/autorização Vercel runtime disponível neste ambiente. Nenhuma variável, credencial, cookie ou banco de produção foi consultado ou modificado.

## Bloqueio para determinar a causa no ambiente afetado

Faltam: URL/hostname do ambiente usado, horário aproximado e fuso da ocorrência, status HTTP de `POST /api/auth/login` e (se disparado) `GET /api/auth/me`, identificador da requisição/deployment, e logs de runtime correspondentes **com dados sensíveis removidos**. Não enviar senha, cookie, Authorization, corpo da requisição, conexão do banco, variáveis ou dados de pacientes. O acesso aos logs deve ser concedido pela conexão da plataforma, não por compartilhamento de tokens no chat.

Não se atribui a causa a senha, cookie, rede ou banco sem esses dados. Não se declara o problema de produção resolvido.

## Correções locais verificáveis

- Payload inválido recebe 400, sem ser confundido com indisponibilidade.
- Falhas de persistência/consulta de sessão recebem 503, `AUTH_UNAVAILABLE`, `Retry-After` e ID de correlação aleatório. O log contém somente evento, etapa e ID; não serializa erro, request, usuário ou ambiente.
- Cliente distingue 401, 429, 5xx (inclusive HTML/não JSON) e falha de rede. Uma falha 5xx ao confirmar `/me` não é descrita como senha incorreta ou cookie bloqueado.
- Não foram alterados scrypt, prazo/validação das sessões, fallback existente, cookies Secure/HttpOnly/SameSite/Partitioned, regras de autorização ou fail-closed do banco.
- Nenhuma senha foi alterada; nenhum banco foi recriado; nenhum seed de produção foi executado.

## Teste isolado

`npm test -- src/lib/__tests__/login-priority.test.ts`: **10/10 aprovados**. Login real com hash, persistência de sessão em requisições independentes, atributos de cookie, 401, expiração, 400, 429, falhas injetadas de leitura/sessão/auditoria e `/me`, ausência de cookie emitido em falha e ausência de dados-canário nos logs/respostas. `npm run typecheck`: aprovado.

Esses testes comprovam o tratamento local de falhas, não o diagnóstico ou recuperação da produção.
