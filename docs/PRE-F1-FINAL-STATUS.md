# PR53 — fechamento final pré-F1 (2026-10-03)

**STATUS: NÃO ESTÁ PRONTO.** Implementação e QA parcial não equivalem ao fechamento integral solicitado.
Branch `arena/01a101fb-instalink`; base `fix/active-clinic-context`; PR https://github.com/HernaniFigueira/instalink/pull/53.
Não houve merge, início de F1, QA em produção, migração nem limpeza de dados reais.

## Implementação

- `computeSlots` respeita snap administrativo 5/15; público mantém cadência anterior. GET administrativo considera duração escolhida, só depois do guard; teste de rota comprova público ignorando parâmetros e admin sem autenticação retornando 401.
- Drawer conserva horário/profissional e duração; disponibilidade não apaga intenção. Avisos de passado/incompatibilidade/indisponibilidade impedem submit. Respostas assíncronas são sequenciadas e a chave conferida inclui a duração.
- Bloqueios projetados em Dia/Semana com horário, motivo e escopo, usando fuso civil. Resumo superior preservado.
- Disclosure avançado único; confirmação com rótulo/valor vertical, divisórias e Fechar primário.
- Biblioteca sem timer de blur. **Bug adicional encontrado no Chromium:** arrastar scrollbar muda foco para `<dialog>`. A correção ignora esse foco apenas durante gesto iniciado dentro da biblioteca, sem bloquear scroll nativo. Teste novo falhou antes e passou depois.
- Grupo sugerido criado no save, opção sem grupo explícita, erros de criação não são ignorados. Descrição/buffers/recursos preservados.
- Novo profissional começa sem serviços; payload `serviceSelectionExplicit:true` usa a relação canônica existente. Guard do drawer + cancelamento protege rascunho.
- Recepção sem Oportunidades por padrão; override explícito funciona, inclusive no servidor. ATENDENTE permanece armazenado/legível, sem duplicar preset em novo cadastro.
- Secondary central com fundo suave, borda temática visível e hover transparente. WhatsApp conserva verde semântico.

## Testes registrados antes do commit

- Full: **3010 PASS / 4 baseline** (3014 testes, 218 arquivos). Baseline estritamente 3 `a34-instagram` + 1 `automation-audit-p4`; nenhuma nova falha aceita.
- Typecheck e diff-check: PASS. Build de produção: PASS na rodada de correção da scrollbar; build pós-commit deve ser reexecutado.
- Testes antigos alterados somente onde contrariavam o novo contrato explícito (Recepção com leads por padrão / reset silencioso de profissional / CSS antigo). Autorização negada e override explícito continuam testados.
- Não há novos skip/only/todo nem remoção de testes.

## Chromium real (banco local descartável)

`tests/pre-f1-final/qa.mjs` usa Next production, sessões reais Owner/Recepção/Profissional, eventos reais de mouse/teclado, checagem UTC via API. Última rodada completa antes do commit: **12 checkpoints PASS, zero falhas, console 0, HTTP >=400 0, 5xx 0**. O teste foi posteriormente ampliado para ativar acesso e conferir Recepção no rascunho de Ana; exige repetição.

- Hernani 09:15–12:45, serviço30, duração210 persistida em Booking e UTC.
- Bloqueio Hernani 13:00–17:30, Cirurgia, Dia/Semana/edit.
- Scrollbar + wheel real; dermatologia R$90, duração30, Michelle, grupo criado, serviço reaberto, vínculo visível na Equipe.
- Ana: nome/e-mail/telefone preservados em Continuar editando; Escape e descarte explícito.
- Azul profundo e Verde equilibrado persistindo após F5; WhatsApp verde em ambos.
- Logins reais de Recepção e Profissional, 3 e 1 colunas respectivamente.

18 screenshots e relatório: `docs/evidence-pre-f1-final/`. **São evidências da rodada anterior ao commit**, não prova automática do HEAD posterior. O relatório pós-commit deve ser comparado e registrado separadamente, sem alterar o HEAD para fabricar equivalência.

## Matriz operacional — 46 verificações

PASS identifica a evidência indicada; FAIL/BLOCKED significa gate ainda não fechado, não baseline aceita. Esta decomposição não substitui a conferência literal de todos os itens do pedido original.

| # | Critério | Resultado / evidência |
|---|---|---|
|1|Snap administrativo15|PASS motor e rota|
|2|Snap5 e cadência pública|PASS motor e rota|
|3|Janela UTC e duração própria|PASS Chromium/API|
|4|Range Hernani210|PASS Chromium|
|5|Faixa selecionada VISÍVEL com drawer|FAIL visual: nó persiste, mas última coluna fica coberta pelo drawer em 1440px|
|6|Início/fim/duração no resumo|PASS screenshot01|
|7|Passado, copy exata|PASS unitário; reteste browser pendente|
|8|Slots não apagam intenção|PASS regressão|
|9|Troca entre serviços elegíveis conserva Michelle|PASS regressão|
|10|Incompatibilidade não troca profissional|PASS regressão|
|11|Escolha explícita para resolver incompatibilidade|PASS regressão; browser pendente|
|12|Serviços elegíveis priorizados|PASS implementação; inspeção visual pendente|
|13|Clique abre agendamento direto|PASS harness clinical-ux nesta rodada|
|14|Drag abre agendamento direto|PASS Chromium|
|15|Modo bloquear+drag|PASS Chromium|
|16|Bloqueio em Dia|PASS screenshot04|
|17|Bloqueio em Semana|PASS screenshot05|
|18|Clique no bloqueio edita intervalo exato|PASS screenshot06|
|19|Bloqueios de recurso/clínica na grade|FAIL gate visual: apenas teste unitário|
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
|34|Novo profissional vazio: warning e save permitido|FAIL gate: criação real ainda não executada|
|35|Vínculo bidirecional canônico|FAIL gate: Serviço→Equipe passou; alteração Equipe→Serviço ainda não repetida no browser|
|36|Ana dirty/continue/discard|PASS Chromium; variante acesso Recepção ampliada após captura|
|37|Dirty X/Escape/backdrop/navegação|FAIL gate: três primeiros cobertos em unitário, navegação real pendente|
|38|Personalizar/Capacidades como secondary|PASS código; auditoria visual detalhada pendente|
|39|Recepção sem leads por padrão|PASS menu/matriz/rota e browser|
|40|ATENDENTE compatível sem duplicar preset|PASS regressão|
|41|Varredura de copy legado ativo|FAIL gate: hint corrigido; varredura integral não concluída|
|42|Secondary em todas as telas/hover|FAIL gate: central corrigido; auditoria completa de variantes locais pendente|
|43|WhatsApp verde em ambos os temas|PASS Chromium|
|44|Aparência em Config e F5|PASS Chromium (espera hidratação, sem falso negativo)|
|45|PR52/Cliente360/sticky/storage/escopo|PASS suíte e smoke desta rodada; não substituir auditoria integral|
|46|Revisão documental/base…HEAD e gates pós-commit|FAIL gate: revisão integral e fechamento de todas as pendências ainda não concluídos|

## Reexecutar com segurança

1. `env -u DATABASE_URL node scripts/seed-clinical-ux-qa.mjs .cache/clinical-ux/final-retest.json` (recusa sobrescrita e qualquer path fora da pasta descartável).
2. Build e `next start`, com `DATABASE_URL` ausente e `GODOUTOR_DB_FILE` apontando exclusivamente para esse arquivo.
3. `QA_CHROMIUM_MODULE=<module @sparticuz/chromium> LD_LIBRARY_PATH=/tmp/al2023/lib QA_DATE=2026-11-09 node tests/pre-f1-final/qa.mjs`.
4. Saídas em `.cache/pre-f1-final/`; não usar esse harness em produção/Vercel. Nenhum cookie/auth foi enfraquecido.

## Pendências que impedem PRONTO

- Visibilidade efetiva da faixa na coluna encoberta pelo drawer; não confundir DOM persistido com visibilidade.
- QA faltante identificado na matriz (bidirecionalidade, profissional vazio, navegação dirty, recurso/clínica, hover/auditoria completa).
- Revisão integral dos documentos obrigatórios e de todos os arquivos alterados no diff acumulado base…HEAD; conferência literal da matriz do pedido.
- Revalidar pós-commit e confirmar deployment Vercel SUCCESS associado ao SHA final; confirmação deve constar da entrega, nunca inferida do deployment anterior.
