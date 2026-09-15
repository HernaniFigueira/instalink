# Auditoria P0 — multi-tenancy, autenticação e Master

Data: 2026-09-15. Escopo auditado: modelos em `src/lib/types.ts`, persistência e migrações em `db.ts`, autenticação em `auth.ts`, autorização central em `access.ts`, resolução de contexto, todas as rotas em `src/app/api` e fluxo do `DashboardShell`.

## Arquitetura encontrada e preservada

- Monólito Next.js 14 com documento JSONB único em Postgres (arquivo JSON em desenvolvimento).
- Sessão de lojista por cookie httpOnly ou Bearer; consumidores têm identidade e sessão separadas.
- `requireBusiness` é o guard central: autentica, resolve ownership/membership, aplica permissão e bloqueia escrita em suporte read-only.
- Dados operacionais já possuem `businessId`; consultas administrativas estão escopadas por ele.
- Master já é papel de plataforma, promovido por configuração/script, sem senha universal. O acesso ao tenant é uma `SupportSession` temporária e auditada.
- `BusinessMember` já permite um usuário em várias unidades com permissão por unidade. Essa base foi reutilizada; não foi criado RBAC paralelo.

## Achados da revisão

1. O modelo suportava múltiplos Businesses por proprietário e troca via `?b=`, mas não havia entidade de organização nem visão consolidada.
2. A criação de Business sempre usava o usuário atual como proprietário, porém não validava vínculo organizacional porque esse conceito não existia.
3. O backend das rotas operacionais usa majoritariamente `requireBusiness`; IDs do frontend selecionam o recurso, mas não concedem acesso.
4. Rotas públicas (slots, criação pública de agendamento/pedido, página, eventos e avaliações do consumidor) aceitam `businessId` por desenho; mutações administrativas nos mesmos endpoints passam pelo guard.
5. A sessão de suporte era validada por expiração ao ser lida, mas `resolveAccess` não verificava novamente expiração nem vínculo da sessão ao Master atual. A defesa em profundidade foi adicionada.
6. O armazenamento documental continua sujeito a concorrência entre instâncias serverless (já documentado no projeto). A mudança deste ciclo é aditiva e não tenta substituir o adapter.

## Implementação P0

- `Organization` e `OrganizationMember` adicionados acima de `Business`; `Business.organizationId` é aditivo.
- Migração defensiva/idempotente agrupa Businesses legados por proprietário, sem apagar ou duplicar dados operacionais.
- Acesso à organização é derivado das unidades já acessíveis. Ser membro de uma unidade **não** concede acesso às unidades irmãs.
- Criação de unidade valida no servidor se o usuário gerencia a organização. Unidade nova recebe somente estrutura inicial própria.
- API consolidada retorna apenas unidades autorizadas e métricas reais mínimas: unidades, contatos, agendamentos e receita prevista.
- Contas com uma unidade permanecem no Dashboard sem seletor. Contas multiunidade recebem “Visão geral”, unidades e “Adicionar unidade”.
- Suporte agora exige sessão vigente, da unidade correta e vinculada ao próprio usuário Master.

## Matriz de isolamento revisada

- APIs de painel: guard central `requireBusiness` + permissão da área.
- Master global: `requireMaster`; dados operacionais somente com `SupportSession` explícita.
- Suporte view: GET/HEAD; escrita negada no guard.
- Suporte admin: escrita somente no `businessId` da sessão.
- Organização: não usa `organizationId` do cliente para ampliar acesso; intersecciona com `accessibleBusinesses`.
- Recursos operacionais relacionados (serviceId, booking id, contact id etc.) são buscados conjuntamente com `businessId` nas rotas auditadas.

## Limites / próximos passos

- O banco ainda é um documento JSONB, sem RLS física. O isolamento é aplicado na aplicação e coberto por testes; uma futura migração relacional deve adicionar FKs e RLS.
- `OrganizationMember` estabelece a base OWNER/ADMIN; não foi criada UI ampla de gestão organizacional/RBAC, conforme escopo.
- A visão consolidada usa receita **prevista** por preço de serviço e exclui cancelamento/no-show; não a apresenta como caixa recebido.
- P1–P5 não fazem parte desta entrega P0 inicial. A página pública não foi alterada.
