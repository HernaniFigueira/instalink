// ═══════════════════════════════════════════════════════════════
// PILHA DE OVERLAYS — quem está no TOPO responde a Escape/Tab
// ═══════════════════════════════════════════════════════════════
// Todo overlay modal do produto (Dialog central, DetailPanel, WorkspaceSheet)
// entra nesta pilha ao abrir e sai ao fechar. A regra é uma só:
//
//   • Escape fecha APENAS o overlay do topo;
//   • Tab cicla APENAS dentro do overlay do topo;
//   • o overlay de baixo continua aberto — nunca dois fecham de uma vez.
//
// Por que isto existe: overlays que escutam `keydown` no `window` em fase de
// CAPTURA (o Dialog do DS) recebem o evento ANTES do `<dialog>` de cima. Sem a
// pilha, um Escape com o cadastro de paciente aberto por cima do agendamento
// fechava OS DOIS. A pilha é a fonte única dessa hierarquia — nenhuma tela
// reimplementa contagem de camadas.
//
// O `<dialog>` nativo continua fazendo a parte dele (focus trap e a
// "close request" do Escape vão para o diálogo de cima); esta pilha é o que
// alinha os handlers de JS entre ABAS/versões de navegador e camadas do DS.

const STACK: object[] = [];

/** Entra na pilha (chamar no efeito de abertura do overlay). */
export function pushOverlay(token: object): void {
  STACK.push(token);
}

/** Sai da pilha (idempotente; chamar no cleanup do mesmo efeito). */
export function popOverlay(token: object): void {
  const index = STACK.indexOf(token);
  if (index >= 0) STACK.splice(index, 1);
}

/** true = este overlay é o do TOPO (por isso responde a Escape/Tab). */
export function isTopOverlay(token: object): boolean {
  return STACK[STACK.length - 1] === token;
}

/** Profundidade atual (diagnóstico/testes; nunca decide layout). */
export function overlayDepth(): number {
  return STACK.length;
}
