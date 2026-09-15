# Camada Master do InstaLink

A conta **Master** pertence ao próprio InstaLink. Ela **não** é Owner/Admin de
Organization nem de unidade. Fica acima de toda a plataforma:

```
MASTER INSTA LINK
 ↓
todas as Organizations
 ↓
todas as unidades
 ↓
todos os usuários dessas organizações
```

## Autenticação

Mesmo sistema do InstaLink:

- e-mail + senha
- hash scrypt
- sessão cookie/Bearer existente
- expiração existente

**Não existe** senha Master universal, credencial fixa no código, nem segundo
sistema de login.

Depois do login:

| Papel | Destino |
|---|---|
| usuário normal / Owner / Admin / membro | `/dashboard` |
| `role === 'master'` (ou e-mail em `MASTER_EMAILS`) | `/master` |

O servidor decide o papel (`requireMaster`). O frontend só navega.

## Como o primeiro Master é provisionado

### Opção recomendada — bootstrap com suas credenciais

```bash
MASTER_BOOTSTRAP_EMAIL=voce@seudominio.com \
MASTER_BOOTSTRAP_PASSWORD='sua-senha-forte' \
MASTER_BOOTSTRAP_NAME='Seu Nome' \
npm run master -- --bootstrap
```

Isso:

1. cria o usuário se não existir (ou atualiza a senha se já existir);
2. grava **somente** o hash scrypt da senha;
3. define `role = 'master'`;
4. registra auditoria `master.created` / `master.promoted`.

Em seguida: `/login` com o e-mail e a senha que **você** definiu → `/master`.

### Opção B — promover usuário já cadastrado

1. Cadastre-se em `/register` com seu e-mail e senha.
2. Rode:

```bash
npm run master -- voce@seudominio.com
```

### Opção C — `MASTER_EMAILS` (env)

Lista de e-mails autorizados sem alterar o banco. O usuário ainda precisa
existir e autenticar com a própria senha.

### Remover privilégio

```bash
npm run master -- voce@seudominio.com --revoke
```

Bloqueado se for o último Master (`role=master`) da plataforma.

### Listar

```bash
npm run master -- --list
```

## Área `/master`

Menu próprio (não usa o menu do cliente):

- Visão geral
- Organizações
- Unidades
- Usuários
- Atividade
- Suporte
- Masters

APIs sob `/api/master/*`, todas com `requireMaster`.

`/admin` redireciona para `/master` (legado).

## Suporte (SupportSession)

Master **não** acessa dados operacionais de unidade sem sessão de suporte:

1. escolhe Organization → unidade;
2. inicia `view` ou `admin`;
3. sessão de 60 min, auditada, cookie `il_support`;
4. escopo **somente** à unidade autorizada;
5. view = somente leitura; admin = escrita só na unidade;
6. sessão de outro Master ou expirada = rejeitada.

## Segurança

- Usuário normal / Owner / Admin / membro **não** acessam `/master` nem listam orgs/usuários globais.
- Ninguém se auto-promove a Master via register/equipe.
- Só Master autenticado cria/adiciona outro Master (com `confirm: true`).
- Último Master não pode ser removido; remoção invalida sessões na hora.
- Senha/hash/tokens **nunca** vão ao frontend.
- Receita do InstaLink ≠ receita operacional das Organizations. Sem billing real = R$ 0,00 explícito.

## Testes

```bash
npm test -- --run src/lib/__tests__/master.test.ts
npm test -- --run
npm run typecheck
```
