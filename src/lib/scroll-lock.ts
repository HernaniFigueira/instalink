// ═══════════════════════════════════════════════════════════════
// SCROLL LOCK compartilhado (reference-counted)
// ═══════════════════════════════════════════════════════════════
// Vários overlays (WorkspaceSheet empilhados, Drawer legado) precisam
// travar a rolagem do body. Cada um guardar o "overflow anterior" por conta
// própria quebra com teardown fora de ordem: o `hidden` final fica preso.
//
// Regra: o PRIMEIRO lock salva o overflow original e esconde; os seguintes
// só incrementam; SOMENTE quando o conjunto fica vazio o overflow original
// é restaurado. Tokens são identidade de objeto — o mesmo token só conta 1×.

const locks = new Set<unknown>();
let savedOverflow: string | null = null;

/** Trava a rolagem do document/body. Idempotente por token. */
export function lockBodyScroll(token: unknown): void {
  if (typeof document === 'undefined') return;
  if (locks.has(token)) return;
  if (locks.size === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  locks.add(token);
}

/** Solta o lock do token. Restaura o overflow original só no último. */
export function unlockBodyScroll(token: unknown): void {
  if (typeof document === 'undefined') return;
  if (!locks.delete(token)) return;
  if (locks.size === 0 && savedOverflow !== null) {
    document.body.style.overflow = savedOverflow;
    savedOverflow = null;
  }
}

/** Diagnóstico/testes: quantos overlays seguram o lock agora. */
export function activeBodyScrollLocks(): number {
  return locks.size;
}
