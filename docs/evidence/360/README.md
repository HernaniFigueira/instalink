# Evidências reais — redesign 360

Capturadas em 21/09/2026, Chromium 153 com sandbox, aplicação Next compilada e banco sintético isolado. Não são mockups de produto nem aprovação visual universal. Dados, pessoas, clínica e contatos são demonstrativos; sequências numéricas nos títulos documentam edições/persistência dos testes.

**59 PNGs + 1 PDF.** As 57 capturas das jornadas foram renovadas após o carregamento real. `clinic-curated-*` são duas capturas adicionais feitas após restaurar apenas títulos e ordem dos blocos da mesma página sintética para apresentação. As capturas `clinic-*` originais preservam o estado editado/reordenado pelos testes.

## Percurso principal

| Tela | Desktop | Celular |
| --- | --- | --- |
| Landing | [1366](landing-1366.png) | [390](landing-390.png) |
| Login da equipe | [1366](login-1366.png) | [390](login-390.png) |
| Início / navegação | [Início](dashboard-1366.png) | [Menu unificado](navigation-390.png) |
| Editor / prévia real | [1366](editor-1366.png) | [390](editor-390.png) |
| Clínica — apresentação | [1366](clinic-curated-1366.png) | [390](clinic-curated-390.png) |
| Clínica — estado dos testes | [1366](clinic-1366.png) | [390](clinic-390.png) |
| Agenda / detalhes | [Detalhes](booking-detail-1366.png) | [Lista](agenda-390.png) |
| Agendamento interno | — | [Reuso do paciente](booking-form-390.png), [revisão](team-booking-review-390.png) |
| Agendamento público | — | [Revisão](booking-review-390.png), [visitante](standalone-review-390.png), [confirmação](standalone-confirmation-390.png) |
| Acompanhamento | — | [Conta do paciente](patient-account-390.png), [Cliente360](profile-390.png) |
| Atendimento | [Fila / registro](queue-encounter-1366.png) | [PDF real de duas páginas](encounter.pdf) |

Papéis: [Secretária](role-SECRETARIA.png), [Profissional](role-PROFISSIONAL.png), [Administrador](role-ADMIN.png). Viewer tem negativa de acesso verificada no teste, sem screenshot próprio.

## Operação e gestão carregadas

| Área | Desktop | Celular |
| --- | --- | --- |
| Clientes | [1366](clientes-1366.png) | [390](clientes-390.png) |
| Conversas | [1366](conversas-1366.png) | [390](conversas-390.png) |
| Tarefas | [1366](tarefas-1366.png) | [390](tarefas-390.png) |
| Funil | [1366](funil-1366.png) | [390](funil-390.png) |
| Equipe | [1366](equipe-1366.png) | [390](equipe-390.png) |
| Profissionais | [1366](profissionais-1366.png) | [390](profissionais-390.png) |
| Serviços | [1366](servicos-1366.png) | [390](servicos-390.png) |
| Disponibilidade | [1366](disponibilidade-1366.png) | [390](disponibilidade-390.png) |
| Organização | [1366](organizacao-1366.png) | [390](organizacao-390.png) |
| Resultados | [1366](resultados-1366.png) | [390](resultados-390.png) |
| Configurações | [1366](configuracoes-1366.png) | [390](configuracoes-390.png) |
| Automações | [1366](automacoes-1366.png) | [390](automacoes-390.png) |
| Execuções | [1366](execucoes-1366.png) | [390](execucoes-390.png) |
| Assistente | [1366](agente-1366.png) | [390](agente-390.png) |

[Permissões da equipe no celular](team-permissions-390.png).

## Erro não é vazio

Respostas 503 controladas, com sessão mantida e retry validado: [serviços](servicos-error.png), [equipe](equipe-error.png), [configurações](configuracoes-error.png), [resultados](resultados-error.png) e [histórico de automação](automation-history-error-390.png). A automação usada na última jornada está desativada; não dispara tarefas/canais.

## Resultados

- [21 jornadas — saída real](browser-results.txt)
- [7 testes Chromium dos componentes — saída real](component-browser-results.txt)
- Typecheck/build: PASS.
- Vitest completo: 1699 PASS / 3 falhas preexistentes em Instagram; 96/97 arquivos passando. Não houve skip nem correção de Instagram nesta entrega.
- PDF: duas páginas com texto, marcador público presente e `SEGREDO-INTERNO` ausente. Diálogo do SO substituído no harness; PDF gerado pelo Chromium real.
- [SHA-256 dos arquivos visuais](SHA256SUMS)
- [Relatório, reprodução segura e limites](../../DESIGN-360-IMPLEMENTATION.md)

Não há credenciais, fixture de autenticação ou banco nesta pasta. Logs de falhas intermediárias de login não foram publicados. O PDF contém somente dados sintéticos.
