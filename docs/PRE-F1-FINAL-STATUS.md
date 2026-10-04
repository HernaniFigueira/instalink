# PR53 — fechamento dos últimos gates (2026-10-03)

> Rodada histórica encerrada no HEAD5703735. O novo polimento solicitado depois dessa homologação é regido por [PRE-F1-POLISH.md](PRE-F1-POLISH.md), inclusive a inversão normal/hover de secondary. A liberação anterior não aprova automaticamente as mudanças novas.

Branch `arena/01a101fb-instalink`; base `fix/active-clinic-context`; PR https://github.com/HernaniFigueira/instalink/pull/53.
HEAD anterior: `b86d59a0c2e92d946d594aa4d74ba33c8c695068`.

**Matriz operacional: PASS. A liberação final é condicionada à confirmação pós-commit abaixo, não às capturas anteriores.** O HEAD final exato é o `head` do relatório pós-commit e do comentário final da PR; o commit que contém este documento não pode conter seu próprio hash.

## Evidência e revisão

- Auditoria de copy, controles locais, compatibilidade e diff acumulado: [PRE-F1-CLOSING-AUDIT.md](PRE-F1-CLOSING-AUDIT.md), com inventário por ocorrência.
- Scripts reais: `tests/pre-f1-final/qa.mjs` e `last-gates.mjs`. Banco local novo, Next production, DATABASE_URL ausente, três logins QA. Nunca executar contra produção/Vercel ou dados reais.
- Pré-commit: full 3014 PASS / somente 4 baseline (3 a34-instagram + 1 automation-audit-p4); build/typecheck/diff-check aprovados. Não substituem repetição pós-commit.
- Evidências antigas em `docs/evidence-pre-f1-final/` são históricas. Evidência de fechamento fica fora do Git em `/home/user/pre-f1-closing-<SHA>/`, evitando um commit posterior que invalide a rodada.

## Matriz operacional — 46 verificações

PASS identifica a evidência indicada. Itens já aprovados e não afetados conservam sua evidência original; alterações de layout, serviços, equipe, botões, copy e dismiss foram revalidadas.

| # | Critério | Resultado / evidência |
|---|---|---|
|1|Snap administrativo15|PASS motor e rota|
|2|Snap5 e cadência pública|PASS motor e rota|
|3|Janela UTC e duração própria|PASS Chromium/API|
|4|Range Hernani210|PASS Chromium|
|5|Faixa selecionada VISÍVEL com drawer|PASS Chromium: 3 colunas × 1440/1280/1024; faixa 09:15–12:45 fora do drawer, sem overflow; resumo móvel|
|6|Início/fim/duração no resumo|PASS screenshot01|
|7|Passado, copy exata|PASS unitário|
|8|Slots não apagam intenção|PASS regressão|
|9|Troca entre serviços elegíveis conserva Michelle|PASS regressão|
|10|Incompatibilidade não troca profissional|PASS regressão|
|11|Escolha explícita para resolver incompatibilidade|PASS regressão|
|12|Serviços elegíveis priorizados|PASS implementação|
|13|Clique abre agendamento direto|PASS harness clinical-ux nesta rodada|
|14|Drag abre agendamento direto|PASS Chromium|
|15|Modo bloquear+drag|PASS Chromium|
|16|Bloqueio em Dia|PASS screenshot04|
|17|Bloqueio em Semana|PASS screenshot05|
|18|Clique no bloqueio edita intervalo exato|PASS screenshot06|
|19|Bloqueios de recurso/clínica na grade|PASS Chromium: Clínica 14:00–15:30 Reunião da equipe; Sala Cirúrgica QA 10:00–12:00 Manutenção; Dia/Semana|
|20|Resumo superior de bloqueios preservado|PASS Chromium e código|
|21|Avançado fechado por padrão|PASS screenshot01|
|22|Duração/encaixe/recorrência/nota dentro|PASS código; fluxo completo de recorrência não repetido|
|23|Hierarquia do formulário|PASS screenshot01/02|
|24|Sucesso vertical, divisórias, data BR|PASS screenshot03|
|25|Fechar primário/outros secundários|PASS screenshot03|
|26|Scroll nativo da biblioteca|PASS reprodução Chromium + regressão red/green|
|27|Popup: seleção/Escape/fora|PASS unitário; scroll/seleção também Chromium|
|28|Sugestão mantém nome/grupo/duração|PASS Chromium|
|29|Grupo opcional/auto-criação|PASS Chromium; duplicação case-insensitive sem novo ensaio visual|
|30|Novo serviço ativo/agendável|PASS código/formulário|
|31|Descrição interna preservada|PASS teste de formulário|
|32|Avançado recursos/buffers preservado|PASS teste de formulário + fechado no Chromium|
|33|Acesso e atuação independentes|PASS regressões existentes|
|34|Novo profissional vazio: warning e save permitido|PASS Chromium: warning antes de salvar; save+F5+reabrir vazio; agendamento incompatível impedido|
|35|Vínculo bidirecional canônico|PASS Chromium: Serviço→Equipe e Equipe→Serviço, adicionar/remover+save+F5+reabrir; catálogo canônico conferido|
|36|Ana dirty/continue/discard|PASS Chromium: nome/e-mail/telefone, acesso Recepção, continuar/descartar|
|37|Dirty X/Escape/backdrop/navegação|PASS Chromium: backdrop/Continue/Escape/Discard; sidebar real e browser Back com preservação de nome/e-mail/telefone/papel|
|38|Personalizar/Capacidades como secondary|PASS componente secundário canônico; guard e ações Equipe revalidados no Chromium|
|39|Recepção sem leads por padrão|PASS menu/matriz/rota e browser|
|40|ATENDENTE compatível sem duplicar preset|PASS regressão|
|41|Varredura de copy legado ativo|PASS auditoria AST classificada + copy runtime; ver PRE-F1-CLOSING-AUDIT.md|
|42|Secondary em todas as telas/hover|PASS Chromium: sete superfícies × Azul/Verde, normal/hover; inventário de controles locais e migração das ações secundárias|
|43|WhatsApp verde em ambos os temas|PASS Chromium|
|44|Aparência em Config e F5|PASS Chromium (espera hidratação, sem falso negativo)|
|45|PR52/Cliente360/sticky/storage/escopo|PASS suíte e smoke desta rodada; não substituir auditoria integral|
|46|Revisão documental/base…HEAD e gates pós-commit|PASS revisão acumulada base…HEAD e auditoria documentada; validade final exige relatório pós-commit e deployment do mesmo SHA conforme protocolo abaixo|

## Protocolo de liberação do HEAD final

Após o último commit, executar novamente diff-check, typecheck, build, full (somente quatro baseline), focused e ambos os harnesses Chromium em banco descartável recém-semeado. Relatórios devem registrar console 0, HTTP >=400 inesperado 0 e 5xx 0. Inspecionar screenshots 1440/1280/1024, bloqueios, vínculos e Azul/Verde. Push somente desta branch; consultar Vercel até SUCCESS no SHA exato. Registrar SHA/resultados/deployment no comentário final da PR e na entrega. Se qualquer verificação falhar ou não for concluída, o status final é **NÃO ESTÁ PRONTO**, independentemente da matriz operacional.

Produção: NÃO. F1: NÃO. Merge: NÃO. Sem migração, limpeza de dados reais ou alteração de credenciais/auth.
