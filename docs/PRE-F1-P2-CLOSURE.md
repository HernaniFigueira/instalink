# PR53 — dois P2 da homologação

Base: aab9ede60ce641a50b4f2dfd6050debb418c10d1. Sem F1, merge, produção ou alteração de engine.

## Correções restritas
- NewBookingSheet desabilita confirmação para intervalo inválido, erro de consulta ou consulta pendente. Reutiliza o resultado canônico de slots (disponibilidade, conflitos, ScheduleBlock, exceções e recursos), sem novo validador paralelo. Encaixe mantém seu fluxo próprio; servidor não foi alterado.
- Um único aviso para intervalo inválido; não copia aviso preventivo para erro de submit; remove erro de tentativa anterior ao trocar intervalo. Dia inteiro sem slots não acumula aviso genérico. Erro de consulta em range com seletor aberto também não aparece duas vezes.
- Serviços usa eligibleProfessionalIds para status efetivo. Cadastro ativo/bookable e vínculos são preservados. Sem elegíveis: “Sem profissional habilitado”, não “Pode ser agendado”. Sem reinterpretar o modo canônico all/selected ou compatibilidade legada.
- No booking, mantém serviço visível com indicação; explica “Nenhum profissional está habilitado para este serviço.”, impede confirmação e não o confunde com dia fechado.

## Segunda passagem de revisão (sem subagente disponível)
Revisão separada do diff e da execução Chromium antes do commit:
1. Disabled antes do clique? Sim: propriedade DOM e clique nativo no botão disabled sem POST.
2. Uma mensagem? Sim: contagem exata, antes/depois do clique; removida duplicação do estado vazio. Revisão encontrou também dois locais possíveis para slotsError em range editável; corrigido.
3. Horário válido reabilita? Sim: 13:30 bloqueado em 07/10/2026 → 09:00, aviso some, habilita, salva, F5/reabre.
4. Sem elegível deixou de parecer agendável? Sim: Consulta Simples continua Ativo, mas badge e opção identificam ausência de habilitação. Último vínculo retirado pela Equipe usando contrato existente.
5. Não aparece Fechado neste dia? Sim: assert negativo nesse cenário e screenshot.
6. Serviço com profissional segue normal? Sim: troca para Consulta clínica, range 195 min, save/F5. Helpers canônicos e API sem alterações.

## QA reexecutável
`tests/pre-f1-p2/qa.mjs`: somente P2 e gates faltantes pedidos (não executa novamente suítes browser antigas completas). Dados descartáveis, login real da identidade QA local, next build/start sem DATABASE_URL.
- 13:30 no bloqueio profissional 13–18 em 07/10; salvar 09:00 e reabrir.
- Serviço ativo sem elegível após remover último vínculo pela Equipe; serviço elegível; range e 390px.
- Novo profissional sem procedimentos criado pela Equipe e reaberto.
- Bloqueios novos profissional, clínica e recurso; persistência.
- Normal/hover Azul/Verde nas sete superfícies.
- Dia especial criado do zero; cem tarefas sintéticas; configurações salvas/F5.
- Report JSON grava método/URL/status de TODAS as respostas, incluindo login, slots, salvamentos e configurações. >=400 deve ser zero; nenhuma validação HTTP negativa induzida: tentativa já conhecida inválida é barrada antes do POST. Sem alegar que isso substitui validação server-side.

Falha inicial de harness: esperava POST no salvamento de configurações, mas o endpoint canônico é PATCH e respondeu 200. Assert corrigido para PATCH, reteste passou. Nenhuma alteração de produto por esse falso negativo.

Gates finais devem rodar depois do último commit: diff-check, typecheck, build, full Vitest, focused e este Chromium com fixture nova. Resultados e screenshots finais ficam fora de Git, em /home/user/pr53-p2-<SHA>/, e no comentário final da PR; não usar capturas da primeira rodada como evidência final.
