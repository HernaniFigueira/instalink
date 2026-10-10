# RODADA 4 — FECHAMENTO DA AUDITORIA UX

**Data:** 08/10/2026 (America/Sao_Paulo)
**Branch:** `arena/40573dbd-instalink`
**PR:** #64 — aberta, sem merge (verificação remota final no encerramento).
**Escopo:** somente fechar as lacunas remanescentes; não reinicia a auditoria geral nem repete os gates já concluídos.

## Limites e método desta rodada

A validação nova foi feita em Chromium real, viewport desktop de 1440×900, contra servidor local e dados sintéticos em arquivo JSON local, sem `DATABASE_URL`/Supabase. O atendimento de teste foi movido/redimensionado pela interface, recebeu respostas HTTP reais do servidor local e voltou ao estado original (**09:00–09:15**). Nenhuma mensagem, automação, chamada de cron ou comunicação externa foi enviada.

As verificações anteriores de campos, hover/foco, editor central, duplicação, cancelamento, menu contextual, identidade/navegação, fila e viewport 390px foram concluídas em rodadas anteriores. Seus arquivos continuam como referência histórica; **não são apresentados como capturas novas da Rodada 4**. A evidência nova desta rodada está isolada em `docs/qa-ux-closure-material/round4/`.

## Requisito → Implementado → Arquivos → Evidência → Pendência

### 1. Redimensionamento e cancelamento por Escape

**Requisito →** O preview de duração precisa ser visível; Escape deve restaurar a altura, apagar o hint e não abrir outra superfície ao soltar o ponteiro.
**Implementado →** A validação real encontrou um clique sintético residual: após Escape, liberar o pointer capture podia abrir o Quick Create na célula sob o ponteiro. A limpeza do resize agora atualiza `lastGridPressAt`, impedindo esse vazamento; foi acrescentado um contrato de regressão.
**Arquivos →** `src/app/(dashboard)/agenda/page.tsx`; `src/components/__tests__/agenda-ux-closure.test.tsx`.
**Evidência →** `resize-preview-30min.png` mostra 32→64px e o hint `09:00–09:30 · 30 min`; `resize-escape-clean.png` e `qa-results.json` registram retorno a 32px, hint vazio e zero diálogos. Nenhum PATCH ocorreu no gesto cancelado.
**Pendência →** Nenhuma.

### 2. Confirmação, persistência e restauração da duração

**Requisito →** Confirmar uma nova duração somente após o diálogo explícito; validar resposta real e persistência após recarregar.
**Implementado →** A confirmação persistiu 30 min (`09:00–09:30`, HTTP 200); após reload, altura de 64px. A mesma interface restaurou a duração original de 15 min (`09:00–09:15`, HTTP 200); após reload, altura de 32px.
**Arquivos →** `src/app/(dashboard)/agenda/page.tsx`; capturas em `docs/qa-ux-closure-material/round4/`.
**Evidência →** `resize-confirmation-30min.png`, `resize-persisted-30min.png`, `resize-restore-confirmation-15min.png` e `qa-results.json`. A fixture local encerrou em 09:00–09:15.
**Pendência →** Nenhuma.

### 3. Reagendamento válido e persistência

**Requisito →** Um drop válido deve pedir confirmação, persistir após uma resposta real e não alterar silenciosamente o registro.
**Implementado →** A disponibilidade respondeu HTTP 200; o modal mostrou a mudança para 11:00; o PATCH confirmado respondeu HTTP 200 e o reload exibiu 11:00–11:15. A fixture foi então devolvida pela interface a 09:00–09:15, também com confirmação, PATCH 200 e reload.
**Arquivos →** `src/app/(dashboard)/agenda/page.tsx`; capturas em `docs/qa-ux-closure-material/round4/`.
**Evidência →** `reschedule-drag-preview-11.png`, `reschedule-confirmation-11.png`, `reschedule-success-11.png`, `reschedule-restore-confirmation-09.png`, `fixture-restored-09.png` e `qa-results.json`.
**Pendência →** Nenhuma.

### 4. Drop inválido fora do eixo e cancelamento do drag

**Requisito →** Soltar à esquerda da grade não pode ser convertido na primeira coluna; mensagens e estado visual devem recuperar-se sem confirmação ou fantasma residual.
**Implementado →** `computeHover`/`planDropAt` preservam o X bruto do ponteiro. Um drop externo permaneceu inválido; Escape também encerrou integralmente o drag.
**Arquivos →** `src/app/(dashboard)/agenda/page.tsx`; teste de regressão em `src/components/__tests__/agenda-ux-closure.test.tsx`.
**Evidência →** `drop-outside-left-invalid-recovered.png` mostra a mensagem “Nenhum horário livre perto de onde você soltou”, zero diálogos/cartões arrastando e ghost oculto. `drag-escape-clean.png`/`qa-results.json` registram zero diálogo, ghost, seleção ou painel de detalhe após Escape.
**Pendência →** Nenhuma.

### 5. Demais critérios já homologados; sem repetição de gates

**Requisito →** Rótulos de campo; hover enriquecido e retorno de foco; modal central Editar; duplicação pré-preenchida; confirmação e sucesso de cancelamento após resposta; menu contextual; tipografia, botões, identidade, rail/nav; 390px e alvos de toque; Queue rail desktop e seu próprio modal compacto; investigação somente de leitura das mensagens automáticas.
**Implementado →** Mantidas as implementações já aprovadas nas rodadas anteriores. A investigação de automações foi apenas leitura: nenhuma automação/execução disponível no fixture, WhatsApp `not_connected`; sem envio ou acionamento.
**Arquivos →** Referências de implementação: `src/components/ui.tsx`, `src/components/dashboard/BookingEditDialog.tsx`, `src/components/dashboard/NewBookingSheet.tsx`, `src/components/dashboard/QueueDock.tsx`, `src/components/dashboard/QueuePanel.tsx`, `src/components/DashboardShell.tsx`, `src/components/dashboard/WorkspaceNavigation.tsx`, `src/components/dashboard/WorkspaceTopbar.tsx`, `src/styles/godoutor-design-system.css`. Registro histórico: `docs/qa-ux-closure/README.md` e `docs/qa-ux-closure-material/AUDITORIA-AGENDA-RODADA2.md`.
**Evidência →** Capturas/medições anteriores (não recapturadas nesta rodada): `docs/qa-ux-closure/after/measurements.json`, imagens `docs/qa-ux-closure/after/*390*.png`, `docs/qa-ux-closure-material/c-fila-*.png`, `floating-label.gif`, `a-ctxmenu-*.png` e `audit-measurements.json`. Essas referências **não são evidência nova da Rodada 4**.
**Pendência →** Nenhuma pendência visual/produto remanescente nesta lista; as telas compactas e verificações não abertas não foram reexecutadas, conforme a instrução de não repetir os gates já concluídos.

## Gates executados nesta conclusão

- `npx vitest run src/components/__tests__/agenda-ux-closure.test.tsx` — **37/37 testes passaram** após a regressão de Escape.
- Chromium real, fixture local: previews, Escape, confirmações, PATCHs 200, reloads, restaurações e drop inválido — **passaram**; detalhes em `docs/qa-ux-closure-material/round4/qa-results.json`.
- `git diff --check` e `git diff --cached --check` — **limpos** após sincronizar o branch e consolidar este relatório. A suíte completa/build e comparação main×PR não foram repetidos, pois já estavam concluídos e não eram necessários para esta correção focada.

## Encerramento

PR #64 permanece no branch `arena/40573dbd-instalink`; não foi criado PR novo e nenhum merge foi executado. Não foram alterados Supabase, Vercel, migrations, schema ou regras clínicas. A sincronização com o remoto foi precedida por cópia integral reversível do working tree, incluindo os arquivos untracked.
