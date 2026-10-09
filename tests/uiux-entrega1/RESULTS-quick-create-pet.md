# Entrega 1 · Quick Create veterinário — paciente (pet)

Chromium real, next start, banco descartável (.cache/f1b1/qa.json), login owner.f1b1 (sem escopo profissional), data = amanhã em America/Sao_Paulo.

```
PASS criação rápida abre a partir de um slot vazio da agenda
PASS com tutora escolhida, "Pet (paciente)" aparece no primeiro plano (antes do serviço)
PASS 2 pets: criar sem escolher o pet é recusado com "Escolha o pet (paciente) deste agendamento."
PASS com o pet escolhido, a criação rápida fecha (agendamento criado)
PASS servidor confirma o agendamento com petId=pet-thor (persistido)
PASS nenhum erro de página (pageerror)
QUICK CREATE PET QA: 6 verificações PASS. data=2026-10-10
```

Cobertura unitária (sem browser): src/lib/__tests__/booking-quick-create-pet.test.ts — 1 pet automático, 2+ exige escolha, pet inativo ignorado, petId no payload.

Observação de produto (não alterada): usuário com escopo profissional só vê pets ligados a ele por agendamento/atendimento (data-scope.ts). Por isso o QA usa a conta de owner.
