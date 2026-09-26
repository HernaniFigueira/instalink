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
| Master (`role=master` **ou** e-mail em `MASTER_EMAILS`) | `/master` |

O servidor decide o papel (`requireMaster` / `isMasterUser`). O frontend só navega.

## Fonte de verdade vs fallback

| Mecanismo | O que faz | Gestão `/master/masters` | Conta no “último Master” |
|---|---|---|---|
| **`User.role = 'master'`** | Fonte **persistente** e principal | Sim (lista e revoga) | **Sim** |
| **`MASTER_EMAILS`** | Fallback de bootstrap/emergência | Aparece em `envOnlyMasters` (diagnóstico); **não** revoga role | **Não** |

### Cenário: usuário no banco + e-mail em `MASTER_EMAILS` + `role ≠ master`

1. **Autentica** com a senha normal → ok  
2. **`isMasterUser` = true** → tratado como Master (login → `/master`, `requireMaster` ok)  
3. **Não** entra em `masters` da gestão (só em `envOnlyMasters`)  
4. **Não** entra em `countMasters()` / proteção do último Master  
5. **Pode** iniciar SupportSession (é Master efetivo)  
6. **Não** acessa unidades por ownership/membership antigo — só via SupportSession  
7. Para torná-lo Master “oficial”: promover (grava `role=master`) ou, para tirar o acesso env, remover o e-mail de `MASTER_EMAILS`

`MASTER_EMAILS` **não** contorna a proteção do último `role=master`.

## Precedência de autorização

```
MASTER > Organization OWNER/ADMIN > Business OWNER/ADMIN/MEMBER
```

Quando o usuário é Master (`role` **ou** env):

1. **É Master?**  
   - Sim → somente contexto Master (`/master`, `/api/master/*`) **ou** SupportSession válida da unidade.  
   - Vínculos de tenant (owner/admin/member) **são ignorados**.  
2. Não é Master → Organization OWNER/ADMIN  
3. Não → Business owner / member  
4. Não → negar

Objetivo: conta privilegiada da plataforma **não** contorna o modelo de suporte só porque ainda tem vínculo operacional antigo.

## Como o primeiro Master é provisionado

### Opção recomendada — bootstrap com suas credenciais

```bash
MASTER_BOOTSTRAP_EMAIL=voce@seudominio.com \
MASTER_BOOTSTRAP_PASSWORD='sua-senha-forte' \
MASTER_BOOTSTRAP_NAME='Seu Nome' \
npm run master -- --bootstrap
```

Isso grava hash scrypt + `role = 'master'` (fonte persistente).

### Opção B — promover usuário já cadastrado

```bash
npm run master -- voce@seudominio.com
```

### Opção C — `MASTER_EMAILS` (env, fallback)

O usuário precisa existir e autenticar. Acesso Master imediato, mas **sem** role no banco até promoção explícita. Preferir bootstrap/promoção para operação normal.

### Remover privilégio

```bash
npm run master -- voce@seudominio.com --revoke
```

Bloqueado se for o último Master com `role=master`.

## Área `/master`

Menu próprio (não usa o menu do cliente): Visão geral · Organizações · Unidades · Usuários · Atividade · Suporte · Masters.

APIs `/api/master/*` com `requireMaster`. `/admin` → `/master`.

## Suporte (SupportSession)

Obrigatório para dados operacionais de unidade. 60 min, auditada, escopo único, view=leitura / admin=escrita na unidade.

## Segurança

- Normal / Owner / Admin / membro **não** acessam `/master`
- Master **não** entra no Dashboard operacional só por vínculo tenant
- Ninguém se auto-promove a Master via register/equipe
- Último `role=master` não pode ser removido
- Senha/hash/tokens nunca no frontend
- Receita InstaLink ≠ receita operacional (sem billing = R$ 0)

## Testes

```bash
npm test -- --run src/lib/__tests__/master.test.ts
npm test -- --run
npm run typecheck
```


## Fundação do platform admin (fechamento Fase 2 · item 14)

**Nunca senha master compartilhada.** Não existe "senha mestra" global, credencial
fixa no código, segundo fator universal nem backdoor de suporte. O acesso Master
nasce de:

1. **`User.role = 'master'`** — fonte persistente, gerenciada em `/master/masters`;
2. **`MASTER_EMAILS`** — fallback de bootstrap/emergência (só promove na leitura;
   não contorna a proteção do último `role=master`);
3. **`npm run master -- --bootstrap`** — grava hash scrypt na conta do operador
   (a senha é a DO usuário, nunca uma senha da plataforma).

### Modelo/guard de `platform role`

O papel de plataforma é **`UserRole = 'owner' | 'admin' | 'master'`** em
`src/lib/types.ts`. O guard é **server-only**:

| Camada | Mecanismo |
|--------|-----------|
| Sessão | cookie `il_session` httpOnly + scrypt (`lib/auth.ts`) |
| Área `/master` | `requireMaster` nas rotas + `isMasterUser` no cliente |
| APIs `/api/master/*` | `requireMaster` (403 amigável, nunca logout) |
| Suporte | `SupportSession` com expiração; modo view = escrita bloqueada |

**Sem UI de gestão de platform role nesta fase** — promoção/revogação é por
script CLI e `/master/masters` (já existe). Uma UI dedicada de "papéis de
plataforma" ficaria rasa sem o fluxo de aprovação; fica **documentada como
pendência**, não implementada de propósito.

### Futuro: Control Center

Listado como evolução (NÃO escopo da Fase 2):

- Console unificado de unidades, masters e suporte (além de `/master`);
- Fila de aprovação para promoção a master;
- Trilha de auditoria de platform actions com retenção própria;
- Feature flags de plataforma (rollout por percentual/tenant);
- SSO/SCIM enterprise (quando houver demanda real).

Enquanto isso, `/master` + CLI + `MASTER_EMAILS` cobrem a operação com as
mesmas garantias de "nunca senha compartilhada".
