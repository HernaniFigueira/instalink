# Auto-homologação — Workflow + Permissões

Branch de sessão `arena/01a0f3d3-instalink` · base `main` `4c51584` (merge da #46, em produção) · commit de código `5327e0e`.
Estado: **CONCLUÍDO EM CÓDIGO / HOMOLOGADO / AGUARDANDO MERGE** (merge NÃO realizado).

## 1. Etapa canônica (sem 4ª máquina persistida)

`src/lib/appointment-workflow.ts` deriva a etapa de Booking + Fila + Atendimento (nenhum campo novo é gravado; `Booking.workflow` é só leitura, entregue pelo servidor):

`scheduled → arrived → in_care → finalized`, com `cancelled` e `no_show`; **Reagendado** é movimento (agendamento pendente/confirmado é movido; terminal é recriado com `previousId`, preservando a cadeia).

| Transição | Regra no servidor |
| --- | --- |
| Agendado → Chegou | `check-in` grava quem/quando (`checkedInAt/By`) e audita `booking.status_changed`; idempotente; recusado em cancelado/faltou/finalizado |
| Chegou → Em atendimento | `POST /api/encounters` só com chegada registrada (409 com instrução humana); profissional dono; 1 registro por agendamento (idempotente, `reused`) |
| Em atendimento → Finalizado | só `atendimento` (Proprietário/Administrador/Profissional dono); Recepção 403; finaliza pelo mesmo caminho oficial do agendamento; repetir = 409 |
| Faltou | só agendamento **confirmado** ainda não chegado; abre 1 Pendência (`Reagendar falta de …`, prazo = hoje no fuso da unidade); reabrir/reagendar fecha a Pendência |
| Cancelado | preserva o histórico; permitido a quem chegou; bloqueado em atendimento (409) |
| Reagendado | bloqueado em atendimento; mover limpa a chegada e libera a fila |
| Área pública do cliente | quem já chegou não cancela/remarca pela conta do cliente (409) |

Fechamento retroativo (concluir sem registro clínico) exige `atendimento` e agendamento vencido; futuro = 409.

## 2. Matriz papel × capacidade × escopo

| Papel | Operação | Escopo de dados |
| --- | --- | --- |
| Proprietário | toda a unidade; exportar/importar | unidade inteira |
| Administrador | operação ampla da clínica; exportar/importar; nunca plataforma | unidade inteira |
| Recepção (`SECRETARIA`) | Agenda, chegada, falta, cancelar/reagendar, Clientes, cadastro de Tutor/Pet, Oportunidades, Conversas, Pendências; **sem** evolução/finalização/atendimento e **sem** exportar/importar | unidade inteira |
| Profissional | própria agenda; inicia/finaliza o próprio atendimento; vê só tutores/pets com vínculo | **recortado por relação real** |

Capacidades novas: `clientes_exportar`, `clientes_importar` (Proprietário/Administrador por padrão; Equipe pode conceder). Exportar/importar a base inteira exige a capacidade **e** contexto sem recorte (Profissional recortado nunca, nem com override). `export-full` mantém o papel Owner/Admin/Master.

### Vínculo do Profissional (`src/lib/data-scope.ts`)
Derivado de Agendamento, Atendimento e Fila do próprio profissional (por `contactId`, conta e telefone) — nunca por nome/e-mail e sempre com tenant primeiro. Sem vínculo de profissional = conjunto vazio.

| Rota / domínio | Capacidade | Profissional recortado |
| --- | --- | --- |
| `/api/bookings`, `/api/queue`, `/api/encounters` | agenda / atendimento | só os próprios; fila vinculada a agendamento alheio = 403 |
| `/api/contacts` (GET/PATCH) | clientes | só vinculados; alheio = 404; cadastrar = 403 |
| `/api/contacts/export`, `export-full`, `import` | `clientes_exportar` / `clientes_importar` | 403 |
| `/api/people360`, `/clientes/[id]` | clientes | só vinculados; sem pedidos/oportunidades/conversas; alheio = 404 |
| `/api/pets` | clientes | só pets vinculados; criar/excluir = 403; editar alheio = 404 |
| `/api/search` | — | mesmo escopo das rotas |
| `/api/leads`, `leads/[id]/book`, `leads/manual` | leads / agenda | só vinculados; agenda só para si |
| `/api/tasks` | leads/agenda/clientes/config | só as ligadas ao próprio trabalho; vínculo validado na criação |
| `/api/conversations`, `reconcile` | whatsapp | só de contatos próprios (404); reconciliar = 403 |
| `/api/overview` | dashboard | agregados da visão recortada |

Registrado: entradas de fila sem profissional continuam visíveis/assumíveis por qualquer Profissional (fila compartilhada). `followup` (`config`) e `campaigns` (`campanhas`) não têm escopo próprio; o preset do Profissional não os inclui.

## 3. Testes
`src/lib/__tests__/workflow-permissoes.test.ts` (42): etapa e matriz puras; transições pelas rotas reais (idempotência, inválidas bloqueadas); papéis Proprietário/Administrador/Recepção/Profissional; Profissional próprio × alheio em contatos, 360, pets, busca, visão geral, oportunidades, pendências, conversas; exportar/importar; isolamento entre unidades; payload não é prova. Mutação (acesso sempre liberado) derruba 8 testes. Ajustados: `a32-booking-series`, `a34-encounter`, `a34-client-import-integrity` (Recepção só com `clientes` não exporta mais), `post-homologation-ui` (selo vem do rótulo do workflow).

Suíte completa: **2801 passed / 4 failed** — as 4 são a baseline conhecida e intocada (3× `a34-instagram`, 1× `automation-audit-p4`). `git diff --check`, `npm run build` e `npm run typecheck` (após o build) OK.

## 4. Homologação real
Build de produção, banco descartável (seed + personas), login real em `/login` por Chromium headless (contextos isolados). Personas: Proprietário (demo), Administrador, **Maria** (Recepção), **Dr. Orlando** (Profissional), segundo Profissional (Dr. João), tutores/pets Alfa (Rex, Orlando), Beta (Mia, João), Gama (sem vínculo).

- **A (Maria):** Agenda; Registrar chegada com persistência após recarregar (selo "Chegou", botão clínico ausente); Clientes com os 3 tutores sem Importar/Exportar; `GET/POST /api/encounters` 403; exportar 403; `/atendimento` mostra "não possui acesso".
- **B (Orlando):** Agenda só dele; contatos/pets/360 só os vinculados; busca "Beta"/"Mia" = nada; `/clientes/<Beta>` = bloqueio seguro; PATCH contato/pet de outro = 404; exportar/importar/oportunidades 403; check-in e início em agendamento alheio 403; Iniciar atendimento → Rascunho → recarrega → **Abrir atendimento** → finalizar → **Ver atendimento**.
- **Segundo profissional:** só Beta/Mia; busca "Rex" vazia; atendimento do Orlando 403.
- **C (Proprietário/Administrador):** as duas colunas da agenda, 3 tutores, Importar/Exportar visíveis, CSV e JSON 200.
- **D (navegador, com recarga entre etapas):** Agendado → Chegou → Em atendimento → Finalizado; Faltou (Reativar/Reagendar depois), Cancelado (Reabrir/Reagendar), Reagendado (move para 01/10 09:00, status Agendado). Pendência "Reagendar falta de Tutor Alfa" em Pendências de Maria e Orlando ("1 para hoje").
- **Viewports:** Agenda + detalhe a 1366 (fluxo completo), 1024 e 390 sem overflow horizontal.
- **Console/rede:** 4xx esperados (403/404 das provas de bloqueio); nenhum 5xx. O 403 de `/api/overview` da Recepção foi eliminado na correção do §7.

Capturas em `docs/homologacao-workflow-screenshots/`: `01-agenda-agendado`, `02-checkin`, `03-em-atendimento`, `04-finalizado`, `05-maria-agenda`, `06-orlando-agenda-propria`, `07-orlando-bloqueado-outro-paciente`, `12-pendencias-maria`, além de `vp-1024-*` e `vp-390-*`.

## 5. Correções colaterais
Carimbo do histórico do agendamento agora no fuso da unidade (antes mostrava UTC) e com rótulos de status em português.

## 6. Limites assumidos (fora do escopo)
Agenda Temporal 2.0 (`startAt/endAt`, arrastar, recursos, buffers) e Clinical Encounter F1 não foram tocados; a Faixa Operacional da Agenda não foi alterada (a Pendência aparece em Pendências). Cadastro/Onboarding PF/PJ (Master Plan §2.6) segue só registrado.

## 7. Correção: quem não tem Visão geral não chama `/api/overview`
Regra única em `src/lib/overview.ts` (`canLoadOverview`, `navAllowsOverview`): a decisão vem das permissões/navegação já calculadas e é tomada **antes** da requisição, só com permissões prontas. Aplicada nos quatro consumidores do payload — `DashboardPage` (sem chamada enquanto carrega ou sem `dashboard`; aviso amigável sem tocar no servidor), mini-card de setup da `WorkspaceNavigation`, sino (`useWorkspaceAlerts`, via `DashboardShell`) e `HelpCenter` — e na página Página (checklist). Rules of Hooks preservada (nenhum hook condicional; teste ready false→true). Preset da Recepção inalterado (sem `dashboard`).

Testes: `overview-access.test.tsx` (15; remover qualquer guard derruba o teste correspondente); fixture de `dashboard-hooks-regression` passou a refletir um perfil com `dashboard`. Homologação real (build de produção, login real): Maria — Agenda, Clientes, Pendências (criar), Conversas abrem com **0** requisições a `/api/overview`, sem 4xx/5xx e sem erro JS; Proprietário, Administrador e Orlando continuam carregando o Overview (Visão geral, sino, mini-card). Registro: `docs/homologacao-overview-screenshots/network.txt`.

Observação fora do escopo: o Profissional sem `leads` ainda recebe 403 de `/api/pipeline` ao abrir Clientes (chamada incondicional da lista).
