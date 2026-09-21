# GoDoutor: marca e próxima migração

## Estado comprovado em 21/09/2026

- Marca comercial: **GoDoutor**. A alteração de marca não muda as regras de negócio.
- Supabase: projeto **GoDoutor**, ref `sefwhobqafkretljjlqx`, organização **CRM Growth**, região `sa-east-1` (São Paulo). Criação retornou custo mensal zero e estado `ACTIVE_HEALTHY`.
- O projeto antigo permanece preservado. Nenhum dado foi importado para o novo projeto nesta entrega.
- A PR #33 foi mergeada na main, commit `96ece322b38bf7b1ac14872af7dc95ee4ce4b556`.
- Os domínios godoutor.com e godoutor.com.br foram informados como disponíveis pelo proprietário. Registro, DNS e vínculo na Vercel NÃO estão comprovados. Não substituir URLs funcionais por domínios ainda não configurados.

## Compatibilidade da marca

As telas, metadados e mensagens usam GoDoutor. Preservar os nomes técnicos legados até existir uma migração explícita: tabela `instalink_doc`, arquivo local e variável `INSTALINK_DB_FILE`, IDs/eventos do widget, cabeçalhos de assinatura, formatos de exportação e identidades de auditoria. Substituição global desses identificadores pode interromper banco, embeds e integrações existentes. O nome do repositório GitHub pode permanecer `instalink` sem aparecer como marca do produto.

## Implementação solicitada ao Arena

Trabalhar em nova branch a partir da main atual, incorporando antes a PR de marca se ainda não mergeada. Inspecionar AGENTS.md e regras locais. Não sobrescrever PRs anteriores. Separar persistência, uploads e configuração em commits revisáveis.

1. Auditar todos os consumidores de `readDB`, `updateDB`, transações e CAS em `src/lib/db.ts`. Hoje o PostgreSQL guarda o documento inteiro em `instalink_doc`, e filtros/paginação de várias rotas ocorrem em memória. Mapear TODAS as coleções antes de definir as tabelas; não descartar módulos ou registros legados.
2. Modelar tabelas relacionais para organizações, unidades, usuários, vínculos, sessões, clientes/pacientes, serviços, profissionais, disponibilidade, agendamentos, fila, atendimentos, páginas, conversas, mensagens, automações e demais coleções existentes. Preservar IDs, hashes de senha e relacionamentos. O cadastro de clínica cria registros e permissões, não um banco novo para cada funcionalidade.
3. Adaptar consultas para selecionar somente colunas e registros necessários, com organização/unidade, período, índices e paginação SQL. Não implementar um adaptador que recarrega todas as tabelas para reconstruir o documento inteiro. Manter isolamento entre organizações, autorização por filial, visão consolidada autorizada e escopo do paciente.
4. Preservar autenticação atual nesta migração; não converter simultaneamente para Supabase Auth. Manter tabelas internas fora dos schemas expostos pela Data API, com grants mínimos. Qualquer tabela exposta deve ter RLS e políticas compatíveis com a autenticação real; não presumir que cookies atuais fornecem `auth.uid()`.
5. Preservar transações, idempotência e prevenção de conflitos de horário sob concorrência. Não substituir o bloqueio global por verificações soltas de leitura e escrita. Demonstrar duas tentativas simultâneas e recusa de acesso cruzado entre clínicas e pacientes.
6. Criar migração versionada, importador repetível, validação de contagens/vínculos, exportação de segurança e procedimento de retorno. A origem Neon estava bloqueada por quota; sem exportação ou backup íntegro, validar com dados sintéticos e declarar importação real bloqueada. Nunca preencher produção com seed nem tratar falha de leitura como banco vazio.
7. Adaptar `src/app/api/upload/route.ts`, atualmente dependente de `@vercel/blob` e `BLOB_READ_WRITE_TOKEN`, para Supabase Storage. Preservar o contrato `{ ok, url }` dos consumidores quando compatível. Fotos públicas da clínica em bucket próprio; arquivos privados de pacientes em bucket privado com autorização e URLs temporárias. Validar tamanho e conteúdo do arquivo, autorização por unidade, nomes únicos e rejeição de formatos executáveis. Preservar URLs existentes; oferecer seleção, prévia, progresso, erro e substituição no editor.
8. Documentar as variáveis realmente consumidas pela implementação e manter credenciais apenas no servidor/ambiente seguro. Configurar primeiro um preview isolado, sem banco de produção. Escolher conexão PostgreSQL/pooler conforme ambiente Vercel e documentação atual; não inventar URLs de conexão. Nunca publicar senha, connection string, chave secreta ou service_role em PR, logs ou frontend.
9. Validar login da equipe, login do paciente, página pública, disponibilidade, criação/cancelamento de reserva, agenda, fila, histórico autorizado, editor, uploads e permissões. Registrar testes executados, falhas anteriores e bloqueios; não declarar produção migrada com base em mocks.
10. Abrir PR e preview com instruções de corte. A troca de produção deve ocorrer somente depois de backup, importação reconciliada e validação, em janela que impeça divergência de novas gravações. Não renomear repositório, domínio ou projeto Vercel automaticamente.

## Limites desta entrega

O novo Supabase foi provisionado. A alteração visual de marca é independente da migração. Conexão da aplicação, novo esquema, uploads via Supabase, importação real e DNS ainda são trabalho de implementação/homologação. Trocar apenas DATABASE_URL manteria o documento monolítico e não resolve a arquitetura.
