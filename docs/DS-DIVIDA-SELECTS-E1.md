# Dívida de Design System — selects restantes (Entrega 1)

Status: registrado, **não refatorado** nesta entrega (regra: não migrar os ~82 usos do sistema).

## Critério (fechado pelo usuário)
- Lista simples e conhecida (status, sexo, apetite, UF, opções clínicas curtas): **`SelectMenu`** (popup não-nativo do GoDoutor).
- Busca agrega (cliente, pet, serviço, profissional, lista grande): **`Combobox`**.
- Escopo da E1: Agenda, Quick Create, Atendimento, Anamnese, Avaliação, Problemas/Conduta/Procedimentos, Pet 360 e componentes compartilhados dessas telas.

## Estado do inventário
- `<Select` (wrapper) e `<select>` cru em `src/**/*.tsx` (sem testes): **69 ocorrências** em 26 arquivos.
- `SelectMenu`/`Combobox` já em uso: 69 ocorrências (inclui os consumidores migrados na E1).
- Dentro do escopo da E1 restavam apenas: `ClientProfileDrawer.tsx` (UF do endereço) — **migrado nesta entrega** para `SelectMenu`.
- O próprio `Select` em `src/components/ui.tsx` é um `<select>` nativo (wrapper). Enquanto existir, qualquer novo uso dele é dívida.

## Inventário por arquivo
| Arquivo | Ocorrências | Classificação |
|---|---|---|
| `src/components/dashboard/AutomationsView.tsx` | 14 | DÍVIDA DS (fora do escopo E1) |
| `src/components/dashboard/EsteiraView.tsx` | 11 | DÍVIDA DS (fora do escopo E1) |
| `src/app/(dashboard)/financeiro/page.tsx` | 8 | DÍVIDA DS (fora do escopo E1) |
| `src/app/(dashboard)/pagina/page.tsx` | 4 | DÍVIDA DS (fora do escopo E1) |
| `src/components/dashboard/NewClientSheet.tsx` | 3 | DÍVIDA DS (fora do escopo E1) |
| `src/app/(dashboard)/configuracoes/page.tsx` | 2 | DÍVIDA DS (fora do escopo E1) |
| `src/app/(dashboard)/equipe/page.tsx` | 2 | DÍVIDA DS (fora do escopo E1) |
| `src/app/master/suporte/page.tsx` | 2 | DÍVIDA DS (fora do escopo E1) |
| `src/components/dashboard/IntegracoesView.tsx` | 2 | DÍVIDA DS (fora do escopo E1) |
| `src/components/dashboard/MemberAccessSheet.tsx` | 2 | DÍVIDA DS (fora do escopo E1) |
| `src/components/dashboard/TaskPanel.tsx` | 2 | DÍVIDA DS (fora do escopo E1) |
| `src/components/dashboard/catalog-panels.tsx` | 2 | DÍVIDA DS (fora do escopo E1) |
| `src/components/ui.tsx` | 2 | DEFINIÇÃO do wrapper `Select` (`<select>` nativo) — dívida |
| `src/app/(dashboard)/agenda/page.tsx` | 1 | COMENTÁRIO (texto, sem controle) |
| `src/app/(dashboard)/disponibilidade/page.tsx` | 1 | DÍVIDA DS (fora do escopo E1) |
| `src/app/(dashboard)/followup/page.tsx` | 1 | DÍVIDA DS (fora do escopo E1) |
| `src/app/(dashboard)/organizacao/page.tsx` | 1 | DÍVIDA DS (fora do escopo E1) |
| `src/app/(dashboard)/produtos/page.tsx` | 1 | DÍVIDA DS (fora do escopo E1) |
| `src/app/dev/design-system/catalog.tsx` | 1 | DÍVIDA DS (fora do escopo E1) |
| `src/components/dashboard/AnamneseManager.tsx` | 1 | DÍVIDA DS (fora do escopo E1) |
| `src/components/dashboard/BusinessHours.tsx` | 1 | DÍVIDA DS (fora do escopo E1) |
| `src/components/dashboard/CanaisIntegracoesView.tsx` | 1 | DÍVIDA DS (fora do escopo E1) |
| `src/components/dashboard/ImportClientsSheet.tsx` | 1 | DÍVIDA DS (fora do escopo E1) |
| `src/components/dashboard/NewBookingSheet.tsx` | 1 | COMENTÁRIO (sem controle) |
| `src/components/dashboard/QuickRegisterSheet.tsx` | 1 | DÍVIDA DS (fora do escopo E1) |
| `src/components/dashboard/RegisterPaymentSheet.tsx` | 1 | DÍVIDA DS (fora do escopo E1) |

## Dívidas explícitas (registrar, não resolver aqui)
- **Agenda Dia/Semana/Mês/Lista**: não é `<select>` — são botões permanentes na barra (`agenda/page.tsx`). Substituir por popover único de visão é escopo da **Entrega 3**. Dívida de DS registrada.
- `AnamneseManager.tsx` (Estrutura › Anamnese, tipo de campo): configuração, **fora** do escopo da E1 (registrado).
- `AutomationsView`, `EsteiraView`, `financeiro`, `pagina`, `equipe`, `configuracoes`, `produtos`, `followup`, `disponibilidade`, `organizacao`, `master/suporte`, `IntegracoesView`, `CanaisIntegracoesView`, `catalog-panels`, `TaskPanel`, `MemberAccessSheet`, `ImportClientsSheet`, `QuickRegisterSheet`, `RegisterPaymentSheet`, `NewClientSheet`, `BusinessHours`: fora do escopo (Configurações, Campanhas, Integrações, Financeiro etc.).
- `src/app/dev/design-system/catalog.tsx`: vitrine interna; usa controles cru de propósito como exemplo.

## Próxima ação sugerida
Trocar `Select` → `SelectMenu` por arquivo, em lotes por área, com teste de teclado (↑/↓, Enter, Escape) e captura visual, e remover o `<select>` do wrapper `ui.tsx` quando zerar os consumidores.
