# Redesign 360 — entrega de implementação

**Fechamento: 21/09/2026.** Continuação de D0/D1a com autorização para a experiência completa. PR [#33](https://github.com/HernaniFigueira/instalink/pull/33), aberta, sem merge ou publicação em produção. Branch `arena/01a0bfbf-instalink`.

Base remota preservada: `6f594293c0243dd74ac68873a12a96c386b96f43`. Código e testes desta entrega: `273cb90`, `1db2efe`, `a9c367e`; o commit seguinte registra este relatório e as evidências. Nenhum uso da PR #31. Os documentos AUDIT, PLAN e D1A continuam históricos e não foram reescritos.

## O que foi implementado

| Área | Entrega |
| --- | --- |
| Sistema visual | Superfícies claras, grafite, azul moderado e estados semânticos no escopo da plataforma. Controles, tabelas, filtros, cabeçalhos, mensagens e diálogos compatíveis com os componentes existentes. Foco visível, movimento reduzido e alvos de toque nos componentes compartilhados. Cores públicas continuam independentes. |
| Navegação | Sete áreas autorizadas, navegação contextual, 248px no total e recolhimento para 68px. Um único menu modal no celular. Busca projetada das rotas permitidas. Logo `object-contain`, sem moldura imposta, identidade/unidade integradas. Troca de unidade transporta somente contexto seguro, nunca IDs de paciente/agendamento/profissional ou busca. |
| Início | Operação diária para recepção; agenda e atendimento para profissional; operação/indicadores autorizados para gestão. Sem conceder permissões novas ou transformar falha de rede em zero financeiro. |
| Agenda e atendimento | Lista móvel, estado de data/view/filtros na URL e histórico, manutenção de grade, encaixe, recorrência e ações existentes. Busca/reuso de paciente, seleção de serviço/profissional elegível e revisão antes de salvar. Cadastro, detalhes, Cliente360 e atendimento em diálogos compartilhados. |
| Operação e gestão | Revisão de clientes, conversas, tarefas, funil, equipe, profissionais, serviços, disponibilidade, organização, resultados, configurações, automações, execuções e assistente. Estados de carregamento, vazio, indisponibilidade e erro com tentativa novamente nos caminhos revistos. Equipe, etapas do funil, editor/histórico de automação e confirmação de remarcação também usam o Drawer compartilhado. |
| Editor | Conteúdo/blocos, navegação/ações, aparência e publicação. Lista resumida, edição focada, ordenação por teclado, estado salvo/alterado e proteção de saída. Prévia local desktop/celular do conteúdo ainda não salvo, usando o renderer público em iframe isolado, sem executar ações. Aviso explícito: **salvar uma página publicada atualiza o público imediatamente**. Não há rascunho persistido ou autosave fictício. |
| Clínica pública | Identidade, descrição, ação principal e conteúdo efetivamente preenchido, respeitando ordem, URLs, módulos e personalização. Renderer compartilhado com a prévia. Nomes longos de profissionais quebram linha, sem sobreposição. DTO público mantém a mesma allowlist anterior. |
| Agendamento/paciente | Serviço e escolhas preservados durante login, resumo antes de confirmar, tratamento de indisponibilidade/rede e conflito, confirmação baseada no ID persistido no servidor. Atualização da conta após reserva, contexto da remarcação e cancelamento conforme regras existentes. |
| Acesso e landing | Login/cadastro/recuperação com formulário prioritário e distinção equipe/paciente. Landing editorial para clínicas, percursos por papel, produto, início e FAQ. Demonstração explicitamente ilustrativa; sem preço, depoimento, certificação ou integração homologada inventados. |

### Correções reproduzidas durante a revisão

- **Impressão:** o documento dentro do diálogo era recortado pelo contêiner. A via do cliente agora é um portal de impressão fora desse recorte. Seções longas podem quebrar entre páginas, com título acompanhado do conteúdo. O formulário de atendimento existente já nasce com seus dados, evitando o primeiro quadro vazio antes dos efeitos. Sem alteração do conteúdo permitido, assinatura, revisão otimista ou persistência clínica.
- **Cadastro:** salvar um cliente abria automaticamente o perfil atrás/sobre a confirmação, competindo pelo Escape. O perfil agora só abre pela ação explícita “Ver Cliente360”.
- **Legibilidade móvel:** nomes da equipe pública não se sobrepõem; identificação de paciente vinculado quebra linha em vez de desaparecer entre os controles.
- **Diálogos:** reset de margem impede `space-y-*` do contêiner de deslocar um modal nativo para fora do topo da tela. Cabeçalhos longos quebram linha.
- **Automações:** falha ao carregar histórico não é mais apresentada como “Ainda não houve execução”. Há mensagem e retry; ações de execução recarregam o histórico.

## Limites de domínio e segurança

Nenhuma rota de API foi alterada. Não houve mudança de banco, autenticação, autorização, transações, conflitos/slots, vínculo serviço-profissional, fila, regras clínicas ou execução de automações. A extração de `toPublicBusiness` para módulo puro preserva os campos permitidos anteriormente. Não houve ampliação de acesso para fazer interface/teste funcionar.

**A revisão S de D0 continua aberta, não “corrigida” pelo frontend:** acesso da secretária a pages/full-business; `predictedRevenue` de organizations sem financeiro; leitura intratenant de compromissos de outro profissional via Cliente360. Consulte `DESIGN-360-AUDIT.md`. Navegação e novos resumos não concedem acesso adicional; filtragem de interface não substitui autorização de servidor. Esta entrega não é homologação de segurança para produção.

WhatsApp, Meta e Instagram permanecem fora da entrega. Recursos/canais existentes não foram removidos. A tela de conversas pode orientar conexão/configuração, mas a landing não promete integração operacional/homologada.

## Validação executada

Ambiente isolado com JSON local, sem `DATABASE_URL` ou credenciais de produção; Next em **modo compilado (`next start`)**, Node 22 e Chromium 153 com sandbox habilitado.

| Verificação | Resultado |
| --- | --- |
| TypeScript (`npm run typecheck`) | PASS |
| Build (`npm run build`, banco vazio separado) | PASS |
| Jornadas completas Chromium | **21/21 PASS**, 39,8s na rodada final |
| Harness D1a: modalidade, foco, abas, escopo visual, movimento reduzido e layouts | **7/7 PASS** |
| Vitest completo de fechamento | **1699 PASS / 3 FAIL**, 1702 testes, 96/97 arquivos passando |
| Regressões direcionadas de UI/navegação/atendimento | 199/199 PASS; atendimento/integridade/primeiro render 49/49 PASS |
| Modelo/motor/integração/auditoria/deduplicação de automações | 122/122 PASS |
| PDF real do atendimento | **2 páginas**, ambas com texto (60 e 25 itens), marcador público presente e nota interna ausente |
| `git diff --check` | PASS |

As rodadas direcionadas têm sobreposição; seus números não devem ser somados como testes distintos. A suíte completa foi executada no fechamento; correções subsequentes exclusivamente de margem do modal receberam novo build/typecheck e as duas suítes Chromium, não outra repetição cosmética da suíte inteira.

### Três falhas preexistentes, separadas da entrega

`src/lib/__tests__/a34-instagram.test.ts`: casos nas linhas 724, 1099 e 1427. Um veredito esperado `ok` não corresponde; dois replies retornam 409 onde o teste espera 200. Os mesmos três casos foram reproduzidos na base não modificada `ebc7130805057135eae36c71c07313cc0e5710e3` (84 testes passaram naquele arquivo). A causa temporal/janela de mensagens é hipótese, não conclusão comprovada. Nenhum teste foi pulado ou regra de Instagram alterada. **Não se declara a suíte integral verde.**

Contratos antigos que inspecionavam classes/texto da navegação substituída foram atualizados; a navegação nova tem dez testes interativos React e jornadas reais de browser. As asserções de domínio não foram relaxadas.

### Cobertura das 21 jornadas

- Landing e formulários de acesso em 1366/390px.
- Navegação em dois níveis, logo, troca de unidade sem transportar IDs, menu móvel.
- Secretária, profissional, administrador e viewer; negativa financeira preservada, agenda do profissional sem outro profissional.
- Detalhes da agenda, reuso de paciente, cadastro novo, resumo e agendamento realmente persistido.
- URL/filtros/histórico da agenda; fila, contato existente e início de atendimento.
- Cliente360, diálogo aninhado, Escape/foco e PDF multipágina sem nota interna.
- Editor: prévia antes de salvar, 503 com retenção de edição, persistência pública após salvar, abas, saída/voltar e reordenação por teclado.
- Clínica → serviço → dia/hora → login → revisão → confirmação → conta; remarcação e cancelamento existentes.
- Visitante, identidade preservada após 409, confirmação somente com reserva persistida; 503 de disponibilidade distinto de agenda cheia.
- 14 telas operacionais em desktop/celular após carregamento; falhas/retry sem perder sessão.
- Layouts 320px e contenção de nomes longos da equipe pública.
- Etapas/equipe/automações com foco e Escape; histórico real de automação **desativada**, 503 controlado e retry sem falso vazio.

Todas as jornadas verificam ausência de exceções JavaScript não tratadas. 409/503 são injeções controladas para testar apresentação; isso não é alegação de teste E2E de toda corrida transacional. O teste do PDF substitui somente o diálogo do sistema operacional; clica a ação real e gera um PDF Chromium com a mídia de impressão.

## Evidência e inspeção visual

[Índice de capturas e resultados](evidence/360/README.md): **59 PNGs autênticos e um PDF**, sem montar telas fictícias. 57 capturas vieram das jornadas finais; duas capturas públicas adicionais mostram a mesma fixture com títulos e ordem de demonstração restaurados, após os testes de edição. Não há remoção de registros/contas para fabricar resultados.

Foram abertas capturas de início, landing, login, editor, clínica, agendamento, histórico de erro e um contato visual das 14 telas operacionais móveis. Essa inspeção motivou correções de nome longo, cadastro e margem dos diálogos. As capturas operacionais aguardam o desaparecimento de skeleton/carregamento; evidências anteriores de loading foram substituídas. Não se declara aprovação visual de todos os subfluxos, temas ou estados possíveis.

### Limitações concretas da validação

- Chromium apenas: sem homologação Firefox/WebKit, leitor de tela ou certificação WCAG de todo o produto. Contraste/teclado/foco dos componentes base foram verificados; cores arbitrárias configuradas por clínicas não são certificadas.
- Proteção de voltar com edição usa Navigation API onde disponível; navegadores mais antigos mantêm proteções de links/ações/reload, sem equivalência garantida para todo histórico SPA.
- Backend público atual distribui profissionais automaticamente. Não foi inventada seleção pública de profissional sem contrato. A equipe continua escolhendo profissionais elegíveis no formulário interno.
- SMTP/recovery real, entrega de notificações, impressora física, canais externos e credenciais de provedores não foram homologados. As telas não prometem que esses serviços foram executados.
- Não houve cobertura browser de todo gesto drag-and-drop, todas as combinações de recorrência/encaixe ou cada subformulário administrativo. Implementações/regras foram preservadas e a suíte de domínio existente continua coberta.
- Os resultados financeiros são previsão de atendimentos, não recebimento de pagamento. Dados desta revisão são exclusivamente sintéticos.

## Reprodução segura

Não executar a preparação contra implantação ou banco real. O setup recusa host remoto, `DATABASE_URL` e arquivo de fixture já existente. Reutilize a fixture; testes acumulam reservas/contatos sintéticos. Para uma campanha independente use **novos caminhos** de banco e fixture, sem apagar bases existentes.

```sh
npm ci
npm run typecheck
# Processo isolado, sem variáveis de banco/segredos herdados:
env -i PATH="$PATH" HOME="$HOME" NEXT_TELEMETRY_DISABLED=1 \
  INSTALINK_DB_FILE=/home/user/.cache/360/build-empty.db.json npm run build
# Em outro processo/terminal, mantido aberto:
env -i PATH="$PATH" HOME="$HOME" NEXT_TELEMETRY_DISABLED=1 \
  INSTALINK_DB_FILE=/home/user/.cache/360/review.db.json npm run start
# Somente se a fixture ainda não existir:
env -i PATH="$PATH" HOME="$HOME" npm run test:360:setup
# Chromium instalado no ambiente:
env -i PATH="$PATH" HOME="$HOME" npm run test:360:browser
# Harness de componentes em processo separado:
npm run test:d1a:serve
npm run test:d1a:browser
# Suíte de domínio; as três falhas acima permanecem conhecidas:
env -i PATH="$PATH" HOME="$HOME" npm test
```

Aqui, o download padrão de Chromium não estava disponível. Foi usado um Chromium externo restaurado via pacote, com TLS normal e sandbox habilitado: `D1A_BROWSER_EXECUTABLE=/tmp/chromium LD_LIBRARY_PATH=/tmp/al2023/lib`. Não faz parte do repositório. A fixture com credenciais aleatórias está fora do Git (`/home/user/.cache/360/fixture.json`, modo 0600). O browser reutiliza em memória sessões obtidas pelo login real, respeitando o limite **inalterado** de 15 logins/minuto; não há bypass de autenticação ou rate limit.

O preview da sessão é temporário e usa esse banco isolado. Landing `/`; clínica sintética `/auroramub3f4og`. Não é publicação de produção.
