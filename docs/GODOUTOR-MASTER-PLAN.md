# GoDoutor — Master Plan, Roadmap e Handoff

> Snapshot: 2026-09-29
> Repositório: HernaniFigueira/instalink
> Produto: GoDoutor / Clinical OS
> Vertical inicial: clínica veterinária
> Status: documento vivo e fonte de direção do produto

## 0. Regra de leitura

Este documento é o mapa mestre de produto, arquitetura e execução do GoDoutor.

Antes de iniciar qualquer missão relevante, leia também:

- docs/GODOUTOR-CLINICAL-OS-V1.md
- docs/GODOUTOR-UI-CONTRACT.md
- docs/GODOUTOR-UI-AUDIT-V2.md

Quando uma decisão histórica do antigo InstaLink conflitar com este documento, a direção atual do GoDoutor prevalece, salvo se uma decisão técnica posterior documentada no repositório a substituir explicitamente.

Não recomeçar o produto do zero. Não criar novo repositório por impulso. Não ressuscitar o InstaLink como proposta principal.

## 1. Estado atual

A PR #43 foi mergeada em 2026-09-29.

Merge commit da main:

    85154c851ba5bfe00aac2fbc4c55cde690815704

A #43 consolidou o Design System 2.0, arquétipos de página, Atendimento full-page, Cliente 360, Conversas workspace, overlays, sheets, Perfil, Configurações, temas, navegação mobile, limpeza visual do legado de Página e vários ajustes de Agenda.

A geometria 50/50 dos sheets de Novo Agendamento + cadastro aninhado foi homologada manualmente.

Detalhes finos de interação da Agenda não devem bloquear o avanço. Eles ficam para Agenda Temporal 2.0.

## 2. Visão do produto

GoDoutor = sistema operacional da clínica.

Fluxo-alvo:

    Entrada
    → Tutor/Cliente
    → Pet/Paciente
    → Agenda
    → Check-in/Fila
    → Atendimento
    → Prontuário
    → Prescrição/Exames/Procedimentos
    → Documentos
    → Estoque/Farmácia
    → Conta do atendimento
    → Pagamento
    → Financeiro
    → Retorno/Follow-up
    → Inteligência/Automação

O produto antigo de Página Pública é legado preservado, não o centro do Clinical OS.

## 3. Vertical inicial

Primeira vertical: clínica veterinária.

Vocabulário:

- Tutor = cliente/responsável humano
- Pet = paciente
- Profissional = quem presta atendimento clínico
- Equipe = quem possui acesso ao sistema

Não construir medicina humana, odontologia e veterinária em paralelo. A arquitetura pode ser extensível, mas a UX e as regras devem ser coerentes com veterinária primeiro.

## 4. O que o GoDoutor não deve voltar a ser

Não voltar a parecer:

- Linktree/link na bio
- site builder
- catálogo de vitrine como núcleo
- página pública com CRM acoplado
- plataforma de presença online como proposta central

A linguagem do produto deve ser clínica e operacional: tutor, paciente, serviço, profissional, disponibilidade, agenda, atendimento, prontuário, retorno, documento, cobrança, estoque, cirurgia e internação.

## 5. Legado InstaLink

A Página Pública permanece preservada por compatibilidade por meio da flag GODOUTOR_LEGACY_PAGES.

Com a flag desligada:

- Página não integra a navegação operacional padrão
- AccountMenu não deve exibir atalhos de página pública
- Dashboard/Resultados não devem se comportar como analytics de site
- Configurações e módulos estruturais não devem falar como site builder
- APIs e dados legados podem permanecer intactos

Compatibilidade técnica não deve virar linguagem de produto.

## 6. Próxima prioridade: Clinical Convergence / De-InstaLink

Esta é a próxima missão de produto após o fechamento do Design System.

Objetivo:

Fazer o sistema parar de parecer “InstaLink transformado” e passar a ser GoDoutor por dentro e por fora.

Varredura obrigatória em:

- Estrutura
- Profissionais
- Disponibilidade
- Serviços
- Produtos
- Equipe
- Configurações
- Recursos
- Dashboard
- onboarding
- componentes e copies compartilhadas

Cada ocorrência deve ser classificada como:

A. conceito válido do Clinical OS → manter
B. compatibilidade técnica do legado → preservar escondida
C. copy/UX do InstaLink → remover ou reescrever
D. regra de negócio antiga → redesenhar
E. módulo legado sem utilidade clínica → ocultar ou deferir

### Resíduos já confirmados

Profissionais ainda contém linguagem como:

- distribuição dos agendamentos é automática
- cliente nunca escolhe profissional

Isso não pode ser regra universal.

Serviços ainda carrega semântica como:

- preço oculto na página
- somente exibição
- mostrar preço na página pública
- distribuição automática obrigatória
- destaque

Profissional ainda pode carregar copy como “aparece na agenda e na página”.

Produtos ainda possui herança de catálogo/vitrine.

Regra: não renomear Produtos para Estoque. Estoque/Farmácia é domínio próprio.

## 7. Design System congelado

A partir da #43, novas features devem seguir o contrato existente.

Não criar por módulo:

- nova paleta
- radius diferente
- botão paralelo
- shadow paralela
- container arbitrário
- modal próprio
- layout incompatível

Arquétipos oficiais:

### workspace

Operação ampla/densa.

Exemplos: Agenda, Conversas, Clientes, Pendências, Financeiro, Resultados, Funil.

### record

Registro/documento clínico.

Referência: Atendimento.

Futuro: prontuário, prescrição, pedido de exame, alta, documentos, cirurgia e internação.

### detail

Entidade 360.

Exemplos: Cliente 360 e Pet 360.

### form

Configuração administrativa.

Exemplos: Perfil, Configurações, Agente.

### hub

Gestão estrutural.

Exemplos: Estrutura, Profissionais, Disponibilidade, Serviços, Produtos, Equipe, Organização e Recursos.

## 8. Hierarquia de ações

- PRIMARY: uma ação principal por contexto
- SECONDARY: ação operacional importante
- GHOST: manutenção/edição auxiliar
- DESTRUCTIVE: somente ação realmente destrutiva

Padronização não significa pintar todos os botões do mesmo jeito.

## 9. Temas

Default de referência: azul-profundo.

Temas podem alterar identidade/accent/sidebar/CTA principal.

Temas não podem alterar:

- sucesso
- warning
- perigo
- radius
- spacing
- shadows
- anatomia
- hierarquia

## 10. Viewports prioritários

Ordem de homologação:

1. 1440 desktop
2. 1366 desktop
3. 1024 tablet/desktop compacto
4. 390 mobile como sanity check

GoDoutor é sistema de operação clínica. Desktop/tablet têm prioridade.

## 11. Fluxo operacional principal

    Tutor/Contato
    → Pet
    → Agendamento
    → Confirmação
    → Chegada
    → Fila
    → Atendimento
    → Finalização clínica
    → Orientações
    → Retorno
    → Pendência operacional quando necessário
    → Pagamento
    → Follow-up

## 12. Papéis e operação

### Recepção/Secretaria

Pode:

- cadastrar tutor e pet
- criar/reagendar/cancelar agendamento
- marcar chegada
- registrar falta
- operar fila
- receber tarefas
- marcar retorno
- acessar dados administrativos

Não deve:

- concluir atendimento clínico
- editar evolução médica
- assinar prontuário
- prescrever

### Profissional

Pode:

- ver agenda
- abrir atendimento
- consultar histórico necessário
- preencher anamnese
- registrar evolução
- orientar
- solicitar retorno
- futuramente prescrever, solicitar exames e emitir documentos

Capacidades como reagendar, bloquear horário e cancelar devem ser configuráveis por clínica/role, não pressupostas universalmente.

### Owner/Admin

Administra estrutura, equipe, profissionais, permissões, agenda, financeiro, automações, relatórios e configurações.

## 13. Workflow + Permissões

Depois da Clinical Convergence, fazer missão própria.

Não resolver tudo com role fixa.

Modelo desejado:

    papel padrão
    +
    capabilities
    +
    overrides controlados por clínica quando necessário

Princípio: permissão deve ser aplicada no servidor, não apenas escondendo botões.

Máquina de estados de agendamento deve distinguir transições legais:

    scheduled/pending/confirmed
    → arrived/check-in
    → in care
    → finalized

cancelamento, falta e reagendamento só podem ocorrer em estados coerentes.

“Concluir” operacional não pode substituir a finalização clínica do Atendimento.

## 14. Pendências

Pendência = ação humana que exige atenção agora ou dentro de janela operacional próxima.

Não transformar Pendências em depósito de tarefas futuras.

Exemplo errado:

“Preparar atendimento” de consulta daqui a 30 dias aparecendo hoje.

Tarefas futuras podem existir no banco, mas só devem emergir quando realmente acionáveis.

Concluídas saem da fila principal e permanecem em histórico com filtro/paginação.

## 15. Atendimento

A tela atual de Atendimento é referência do arquétipo record.

Preservar:

- full-page
- header normal → compacto sticky
- action bar
- autosave
- rascunho
- finalização
- histórico
- anamnese
- orientações
- retorno
- nota interna
- vínculo booking/queue
- profissional responsável
- read-only após finalização
- reabertura auditada

Não reimplementar do zero.

## 16. F1 — Clinical Encounter estruturado

Evoluir o Atendimento existente com estrutura clínica:

- queixa principal
- anamnese
- sinais vitais
- problemas/hipóteses/diagnósticos
- achados
- evolução
- plano/conduta
- procedimentos
- orientações
- retorno
- nota interna
- profissional
- assinatura/finalização
- versionamento/histórico

Regras:

- rascunho editável
- autosave
- finalização bloqueia edição comum
- reabertura somente por permissão e auditoria
- histórico preservado
- concorrência otimista
- IA nunca assina autonomamente

## 17. Anamnese

Estado atual já possui sheet contextual e histórico.

Futuro:

- templates por consulta
- templates por espécie
- voz/transcrição
- estrutura inteligente
- comparação longitudinal
- destaque de alterações relevantes

## 18. Voz clínica

Fluxo desejado:

    microfone
    → STT
    → texto estruturado
    → sugestão de preenchimento
    → revisão humana
    → confirmação
    → prontuário

Nunca:

    voz → assinatura automática

Precisará de consentimento, indicador de gravação, segurança, auditoria e política de retenção.

## 19. F2 — Prescrição, Exames e Document Engine

Prescrição futura:

- medicamento
- apresentação
- dose
- via
- frequência
- duração
- quantidade
- orientação
- profissional
- assinatura

Exames:

- solicitado
- coletado
- processando
- resultado disponível
- revisado

Document Engine comum para:

- receita
- atestado
- relatório
- encaminhamento
- pedido de exame
- alta
- consentimento
- anestesia
- cirurgia
- procedimento
- eutanásia
- óbito
- vacinação

Modelo de documentos:

- template
- versão
- instância
- signatário
- auditoria
- anexos

## 20. PDF, impressão e compartilhamento

Futuro documento clínico deve suportar:

- logo
- cabeçalho
- paciente/tutor
- profissional/conselho quando aplicável
- rodapé sem sobreposição
- paginação
- PDF
- imprimir
- baixar
- compartilhar
- WhatsApp

Não misturar isso com Design System.

## 21. Agenda Temporal 2.0

Missão própria, posterior à Clinical Convergence/Workflow.

Unidade temporal correta:

- startAt
- endAt
- duration

Tipos:

### Atendimento

Paciente/tutor + serviço.

### Procedimento

Paciente, duração potencialmente longa.

### Bloqueio

Sem paciente: almoço, reunião, indisponibilidade, treinamento, sala reservada.

## 22. Agenda estilo Google Calendar

Direção futura:

- hover em célula vazia com affordance clara
- cursor/ícone de criação
- clique contextual
- seleção por arraste
- preview de intervalo
- bloqueios
- procedimentos longos
- snap
- buffers
- recursos

Exemplo de drag:

    08:00
    → 15:00
    = 7h

Ao soltar, abrir Novo Agendamento com data/início/fim/duração.

Snap interno sugerido: 5 minutos.

Agenda interna e booking público são políticas diferentes.

## 23. Serviço como inteligência da Agenda

Cada serviço deverá evoluir para suportar:

- nome
- duração padrão
- público sim/não
- intervalo público
- buffer antes/depois
- profissionais elegíveis
- duração editável internamente
- categoria
- recursos necessários

Não usar nome/cargo/especialidade textual para inferir vínculo.

O vínculo real serviço ↔ profissional é a autoridade.

## 24. Recursos da Agenda

Arquitetura futura deve permitir:

- profissional
- sala
- equipamento
- assistente/equipe

Exemplo cirurgia:

    cirurgião
    + anestesista
    + sala cirúrgica
    + equipamento

Não implementar tudo agora; apenas não bloquear essa evolução.

## 25. Estoque / Farmácia

É domínio próprio.

Modelo futuro:

- item
- medicamento
- lote
- validade
- fornecedor
- custo
- estoque mínimo
- entrada
- saída
- perda
- vencimento
- ajuste
- transferência
- administração
- venda

Integração clínica desejada:

    prescrição
    → administração
    → baixa de estoque
    → lançamento na conta do atendimento

Evitar redigitação.

## 26. Cirurgia

Fluxo futuro:

    indicação
    → orçamento
    → consentimento
    → pré-operatório
    → exames
    → checklist
    → anestesia
    → cirurgia
    → recuperação
    → internação ou alta
    → pós-operatório
    → retorno

Agenda Temporal 2.0 deve existir antes ou em paralelo às primeiras features de cirurgia.

## 27. Internação

Domínio próprio:

- admissão
- leito
- responsável
- diagnóstico
- tratamento
- medicações programadas
- administrações
- fluidoterapia
- alimentação
- sinais vitais
- ocorrências
- exames
- evolução
- handoff
- alta

Não improvisar internação dentro de Atendimento normal.

## 28. Financeiro

Hoje é básico e operacional.

Futuro:

    Conta do atendimento
    → serviços realizados
    → procedimentos
    → medicamentos
    → materiais
    → descontos
    → parcelas
    → pagamento
    → reembolso
    → contas a receber
    → fechamento

O financeiro deve nascer do que ocorreu na operação.

Evitar cadastrar novamente aquilo que já foi executado no atendimento.

## 29. Resultados x Financeiro

Financeiro = operação financeira.

Resultados = BI/gestão.

Resultados poderá consolidar agenda, produção, receita, retenção, faltas, conversão, ocupação e desempenho.

## 30. Fiscal e contabilidade

GoDoutor não deve virar software contábil completo.

Futuro:

- NFS-e
- exportações
- fechamento mensal
- relatórios
- conciliação
- integração com contador

## 31. Conversas

Preservar o workspace atual:

- inbox
- timeline
- composer
- tutor
- pets
- próximo agendamento
- responsável
- IA ↔ humano
- drafts
- retry
- filtros

Sem canal conectado, o sistema deve ser honesto. Nunca simular envio real.

## 32. WhatsApp oficial

Existe implementação relevante de Meta Cloud API. Não recomeçar.

Já há trabalho em:

- credenciais
- webhook
- envio
- retry
- status
- Embedded Signup
- Standard
- Coexistence
- WABA
- phone number
- subscription
- register
- inbound
- dedupe
- CRM/conversation
- automação
- handoff

Antes de produção, revisar documentação oficial Meta atual.

Nunca testar primeiro no número histórico principal de uma clínica. Usar linha/chip de teste e homologar o ciclo completo.

## 33. Inteligência

Arquitetura conceitual:

    CRM = memória
    Automation = motor
    Jev = decisão
    LLM = linguagem
    Canais = comunicação
    Agenda = capacidade
    GoDoutor = execução, regra e dados
    Humano = supervisão e exceção

## 34. Jev / TypeSafe

Jev não é chatbot.

Uso:

- classificação
- score
- escolha
- roteamento
- priorização
- decisão estruturada

Contrato F0:

- Choice
- Noul
- Score
- confidence

Antes de integração real, validar endpoint/header/créditos atuais com documentação oficial e testar com dados fictícios.

Segredo nunca vai ao frontend.

## 35. LLM generativa

LLM escreve:

- resposta
- resumo
- relatório
- documento
- estrutura → linguagem

Princípio:

Jev decide.
LLM verbaliza.
GoDoutor executa.

## 36. Agentes

### Recepção/Bia

Responder, informar, agendar, reagendar, confirmar e coletar dados.

Não diagnostica, prescreve nem altera prontuário clínico.

### Clínico

Resume histórico, estrutura consulta, sugere preenchimento, prepara documentos e auxilia prescrição/exames sob revisão humana.

### Financeiro

Cobrança e pendências financeiras sem acesso clínico desnecessário.

### Operacional

Estoque, exames, internação, tarefas e alertas.

### Relacionamento

Retorno, vacinação, no-show, reativação e follow-up.

### Gestão

Indicadores, alertas e resumo operacional.

## 37. ToolRegistry

Agentes não acessam banco cru.

Fluxo:

    IA
    → ToolRegistry
    → tenant guard
    → permission check
    → confirmação
    → domain service
    → persistence
    → audit
    → EventLog
    → AI telemetry

Nunca confiar em businessId vindo do prompt.

Mensagem do paciente nunca concede autorização.

## 38. EventLog / Outcome-as-a-Service

F0 já criou a fundação de eventos de domínio.

Exemplos:

- appointment.created
- appointment.confirmed
- patient.checked_in
- encounter.started
- encounter.finalized
- prescription.created
- exam.ordered
- exam.resulted
- inventory.low
- invoice.created
- payment.received
- followup.due

Automação futura deve consumir esse EventLog, não criar trilha paralela.

## 39. Banco

Legado ainda possui godoutor_app.instalink_doc em JSONB.

Não repetir migração big-bang.

Novos domínios importantes nascem normalizados.

Ordem recomendada de corte:

1. EventLog / AI usage — fundação existente
2. Clinical Encounter
3. Prescription / Orders
4. Finance / Invoice / Payment
5. Inventory
6. Hospitalization

Cada corte deve possuir migration própria, adapter, teste de paridade, validação e flip controlado.

## 40. Segurança de banco

- migration é autoridade DDL
- runtime não cria tabela
- SQL novo qualificado
- tenant explícito
- menor privilégio
- tabelas internas não expostas à Data API sem decisão consciente
- logs sem segredo
- erros internos não vazam detalhes

## 41. Roadmap recomendado

### Fase A — Design System 2.0

CONCLUÍDA pela PR #43.

### Fase B — Clinical Convergence / De-InstaLink

PRÓXIMA PRIORIDADE.

Limpar semântica e regras herdadas em módulos estruturais.

### Fase C — Workflow + Permissões

Papéis, capabilities, máquina de estados, check-in, falta, cancelamento, reagendamento, finalização e Pendências.

### Fase D — Agenda Temporal 2.0

Start/end, duração, drag-selection, bloqueios, procedimento longo, snap, buffers, recursos e política interna x pública.

### F1 — Clinical Encounter

Evoluir Atendimento em prontuário estruturado.

### F2 — Prescrição + Exames + Document Engine

Núcleo documental clínico.

### F3 — Estoque/Farmácia

Movimentação real conectada ao atendimento.

### F4 — Cirurgia + Internação

Operação clínica avançada.

### F5 — Conta do Atendimento + Financeiro avançado

Cobrança conectada ao que foi executado.

### F6 — Fiscal / fechamento / integrações

NFS-e e exportações.

### F7 — Agentes clínicos e operacionais

Usar domínios já estáveis.

### F8 — Automação visual + OAAS

Event-driven + Jev + LLM + workflows.

## 42. O que não fazer

Não:

- criar repositório novo agora
- reescrever tudo
- apagar instalink_doc em big-bang
- chamar Produtos de Estoque sem domínio real
- transformar tudo em full-width
- transformar tudo em sheet
- misturar role de acesso com cargo profissional
- usar cor como único status
- permitir IA assinar prontuário
- testar número principal do cliente sem homologação
- criar fork por cliente Enterprise
- criar ferramentas paralelas ao ToolRegistry

## 43. Critério obrigatório antes de novas features

Perguntar:

- qual é o caso simples?
- qual é o caso real?
- qual é o caso extremo?
- qual é o caso multiusuário?
- qual é o caso de erro?
- qual é o caso de permissão?
- qual é o impacto em tenant?
- qual é o impacto em auditoria?
- qual é o impacto em automação?
- qual é a consequência futura?

Exemplo Agenda:

- consulta 30 min
- retorno 15 min
- cirurgia 7h
- bloqueio
- encaixe
- médico ocupado
- sala ocupada
- recepção interna
- booking público

## 44. Processo de implementação

Preferir:

    auditar
    → entender
    → decidir
    → modelar
    → implementar
    → testar
    → homologar

Evitar:

    inventar
    → codificar
    → descobrir depois que o domínio estava errado

## 45. Estratégia Enterprise

Enterprise não significa fork.

Usar:

- feature flags
- configuração
- papéis
- módulos
- limites
- integrações

Pode haver taxa de implementação/customização sem entregar propriedade do código.

## 46. Design partners

Validar com clínicas reais.

Ideal: 2–3 clínicas piloto para evitar overfit.

Clínica Veterinária Andrioni é uma referência potencial de operação real, especialmente para agenda, cirurgia, recepção e WhatsApp.

## 47. Métricas futuras

- ocupação da agenda
- faltas
- reagendamentos
- tempo de espera
- tempo de atendimento
- retornos marcados/recuperados
- conversas resolvidas por IA
- handoffs
- receita realizada
- receita recebida
- ticket
- inadimplência
- estoque crítico
- adesão a follow-up
- custo de IA por clínica

## 48. Regra para novos chats/agentes

Ao iniciar nova sessão:

1. leia AGENTS.md
2. leia este arquivo
3. leia os documentos técnicos apontados no topo
4. valide o estado atual do Git antes de agir
5. não trate decisões históricas do InstaLink como direção atual
6. não faça merge sem autorização explícita
7. não altere domínio apenas para melhorar uma tela
8. preserve Design System e contratos já homologados

## 49. Próximo passo imediato

Próxima missão recomendada:

    GODOUTOR CLINICAL CONVERGENCE

Objetivo:

Fazer o produto deixar definitivamente de carregar a semântica do InstaLink nas áreas estruturais, preservando apenas compatibilidade técnica necessária.

Depois:

    Workflow + Permissões
    → Agenda Temporal 2.0
    → F1 Clinical Encounter

## 50. Definição final

GoDoutor é o sistema operacional da clínica.

Ele organiza pessoas, pacientes, agenda, atendimento, prontuário, comunicação, execução, estoque, dinheiro e automação em uma única operação.

IA reduz trabalho repetitivo, classifica, organiza, comunica e auxilia decisões; não substitui responsabilidade clínica humana.

Dados clínicos e decisões finais permanecem sob controle humano, permissionado e auditável.
