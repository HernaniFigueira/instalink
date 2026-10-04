# PR53 — último polimento pré-F1

HEAD anterior: `57037353f09a8b13d3468d3cad66c5feeb0bbf3c`. Mesma branch/PR; sem produção, merge, migração ou F1. O SHA final e os resultados posteriores ao último commit ficam no relatório externo e no comentário da PR, para não invalidar a rodada com outro commit de evidências.

## Contrato e comparação literal

| Itens | Implementação / caminho de prova |
|---|---|
|1–3|Range é intenção: resumo Início/Fim/Duração, grade oculta até “Alterar horário”; duração em minutos e horas; edição em avançado. Clique conserva seletor. Split desktop e drawer móvel preservados. Chromium Michelle/dermatologia 10:45–14:00 (195 min · 3h15), clique 10:45–11:15, save/F5/reabrir e UTC.|
|4–6|Bloquear horário explica indisponibilidade temporária, exemplos e os três escopos. Disponibilidade explica rotina × exceção pontual × dia especial. **Decisão explícita do usuário:** manter AvailabilityException como funcionamento permitido ou fechamento integral. Projeção visual do complemento, limitada à rotina normal; nunca reinterpretar abertura como fechamento, criar ScheduleBlock ou alterar slots. Horário especial 13–18 com rotina09–18 → INDISPONÍVEL09–13/Reunião.|
|7–8|Antecedência com copy humana. Preparação antes/Tempo depois em Regras avançadas fechadas; compatibilidade preservada. Salas e equipamentos com descrição/exemplos claros. Cadastro permanece em Configurações → Agenda nesta PR; futura convergência para Clínica → Estrutura deve reutilizar o mesmo editor e permissões, sem duplicar fluxos.|
|9|Primitive secondary: transparente/outline normal; soft fill + mesma borda no hover. Primary sólido, WhatsApp semanticamente verde. Sete superfícies × Azul/Verde no Chromium. Guard mantém o mesmo contrato sem dependência circular.|
|10–11|Confirmação compartilhada do guard: central, sem ícone decorativo/glow; continuar, descartar e Escape. Não substituir drawers indiscriminadamente. Contrato: modal central para decisões/alertas/formulários curtos; workspace/split para trabalho longo/contextual. Tipografia, tokens de borda/raio, spacing, botões e backdrop da família existente.|
|12|Geist atual mantida. Escala escopada no workspace: página22/600; seção16/600; card14/600; corpo14/1.5; label13/500; ajuda13/1.55; tabela com cabeçalho sem uppercase/peso excessivo; números tabulares. Sem fonte nova nem redesign de Conversas.|
|13|Cinco escolhas: Azul clínico, Verde saúde, Teal, Vinho institucional e Neutro/Ônix. IDs/tokens dos21 presets históricos preservados. Contraste AA e escolha/F5/navegação cobertos.|
|14|Tarefas no dashboard limitadas a4; listas próximas já limitadas a5 e atividade recente a3/2. “Ver todas” usa permissão real e contador total. Simulação100 tarefas pela API local autenticada; sem reescrever entidade/automação.|
|18|Skeletons existentes preservados; loading localizado de slots, bloqueio, recursos e salvamento de dia especial. Sem spinner global. QA de recurso com latência real controlada, botão “Criando…” e bloqueio de repetição.|

## Decisões deliberadamente adiadas (15–17)

- **Pendências/F1:** uma pendência exige ação: documento pendente, confirmação necessária, tarefa manual, atendimento vencido sem fechamento, preparação dentro da janela operacional. Agendamento futuro por si só pertence à Agenda. Não remover automações atuais às cegas.
- **Conversas contextuais:** backlog de convergência operacional pós-F1: Agendar abre formulário contextual com cliente/paciente preenchido; Criar tarefa abre criação contextual, sem navegar para uma tela vazia. Conversas não foi redesenhada.
- **Anamnese/F1:** modelo atual provisório. F1 definirá anamnese da visita, dados permanentes, evolução, prontuário e especialidades. Nenhuma arquitetura nova cristalizada aqui.

## Segunda passagem de revisão (sem subagentes disponíveis)

Reprodução inicial separada da implementação; revisão posterior do diff acumulado desde `0c426be570e528569a27dc4f48e6f1afe59f3427` e comparação dos itens acima, seguida de Chromium. A revisão não usa helper verde como evidência visual.

Achados e correções após a primeira implementação:
1. “Ver todas” dependia de `links.tarefas`, ausente na resposta de overview. Corrigido para as mesmas permissões OR de `/tarefas` e `/api/tasks`; sem ampliar autorização.
2. Projeção inicial atribuía “Reunião” também ao trecho08–09, já fora da rotina. Limitada à interseção com horários normais; fechamento integral permanece dia todo. Sem gravação de blocos.
3. Labels curados divergiam do rodapé do preview. Centralizadas somente as labels de apresentação, mantendo IDs antigos.
4. Range/click, máscara dos horários e contratos de secondary antigos exigiram ajustes precisos nos testes. Asserções preservam intenção, UTC, duração, escopo e borda; nenhum skip/only/todo novo ou baseline ampliado.
5. Harness aguardava label de select sem seu texto de opções, hidratação ainda não concluída e Escape antes do foco programado. Corrigidos seletores/espera de foco real, sem forced click nem bypass de autenticação.

## Protocolo final

Depois do último commit: diff-check, typecheck, build, full (somente3 a34-instagram +1 automation-audit-p4), focused, Next production em banco novo sem DATABASE_URL e três scripts Chromium: `tests/pre-f1-final/qa.mjs`, `last-gates.mjs`, `tests/pre-f1-polish/qa.mjs`. Screenshots em1440/1280/1024/390; verificar normal/hover, persistência, console/rede. Push mesma branch e aguardar Vercel SUCCESS no SHA exato. **Sem esses resultados, NÃO ESTÁ PRONTO.**
