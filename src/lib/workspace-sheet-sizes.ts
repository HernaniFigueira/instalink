/** Shared width presets for WorkspaceSheet and nested workspace panels. */
export const WORKSPACE_SHEET_SIZES = {
  compact: 'max-w-md',
  /** Largura operacional padrão de um formulário em sheet (nem estreito, nem esticado). */
  standard: 'max-w-2xl',
  wide: 'max-w-4xl',
  /**
   * Faixa do overlay quando um painel auxiliar é ANINHADO (§19–25): um só
   * dialog que expande e se divide em duas metades exatas.
   */
  expanded: 'max-w-[1280px]',
  nestedForm: 'max-w-lg',
} as const;

/**
 * §19–25 — preset compartilhado da composição aninhada: os DOIS painéis usam
 * ESTA classe, portanto têm exatamente a mesma largura (metade da faixa
 * expandida). Mesma altura, headers alinhados e uma única linha divisória vêm
 * do grid de `.il-drawer__panels` (globals.css) — sem "sheet dentro de sheet".
 */
export const WORKSPACE_NESTED_PANEL = 'w-1/2 min-w-0';
