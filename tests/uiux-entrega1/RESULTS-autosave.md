# Entrega 1 · P0 autosave — prova de browser

Chromium real (@sparticuz/chromium 147 via QA_EXECUTABLE_PATH), next start, banco .cache/f1b1/qa.json descartável, latência de 2500 ms na RESPOSTA do PATCH.

## Código ANTERIOR (0bc1d78) — reproduz o bug
```
PASS abre atendimento real (Mel, 15:00) pelo fluxo da agenda
FAIL queixa perdeu caracteres
+ 'Coceira nas orelhas.começou depois do banho.'
```

## Código CORRIGIDO (27e8e74+) — passa
```
PASS abre atendimento real (Mel, 15:00) pelo fluxo da agenda
PASS cenário 1: digitação contínua durante save em voo (2 campos) — nenhum caractere some
PASS cenário 2: troca de seção com save em voo — orientações voltam intactas
PASS cenário 3: falha de rede no save — texto permanece e a gravação seguinte confirma
PASS cenário 4: F5 — texto da tela igual ao servidor (queixa, evolução, orientações, nota)
PASS cenário 5: sair e reabrir — texto persistido
PASS nenhum erro de página (pageerror)
AUTOSAVE BROWSER QA: 7 verificações PASS. PATCHes: 6. encounter=f61582c3-4162-4801-b9d9-657d96b586c9
```
