// ═══════════════════════════════════════════════════════════════
// FOCO GUIADO + HIGHLIGHT SUTIL (§17–18)
// ═══════════════════════════════════════════════════════════════
// "Registrar nota" e "Editar dados" (e afins) levam o usuário ao campo:
//   1. scroll suave até o campo (block: 'center');
//   2. foco real do campo (para digitar em seguida);
//   3. highlight sutil de 1–2s na região (classe CSS il-field-highlight).
//
// Nada de modal novo: o campo já existe na página — a ação apenas conduz
// até ele. `prefers-reduced-motion` troca o scroll suave por instantâneo e
// mantém só um contorno estático de destaque.
//
// DOM pontual (focus/scroll/classList): coberto por teste jsdom
// (m8-cliente360.test.ts).

export const FIELD_HIGHLIGHT_CLASS = 'il-field-highlight';
export const FIELD_HIGHLIGHT_MS = 1800;

/** O usuário pediu menos animação? */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Leva o usuário até o campo: scroll suave + foco + highlight temporário.
 * Aceita um elemento ou um `id`. Silencioso quando o alvo não existe.
 */
export function focusField(target: HTMLElement | string | null): void {
  if (typeof document === 'undefined') return;
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  el.focus({ preventScroll: true });
  // O highlight envolve o campo (pode estar dentro de um bloco): marcar o
  // próprio elemento é suficiente para o contorno sutil do CSS.
  el.classList.add(FIELD_HIGHLIGHT_CLASS);
  window.setTimeout(() => el.classList.remove(FIELD_HIGHLIGHT_CLASS), FIELD_HIGHLIGHT_MS);
}

/**
 * Versão para ações que MUDAM a aba/estado antes de o campo existir no DOM
 * (ex.: "Registrar nota" troca a aba e só então o textarea aparece).
 * Tenta por alguns frames; desiste em silêncio se o alvo nunca surgir.
 */
export function focusFieldSoon(target: string, attempts = 12, intervalMs = 40): void {
  let tries = 0;
  const tick = () => {
    const el = document.getElementById(target);
    if (el) { focusField(el); return; }
    if (++tries < attempts) window.setTimeout(tick, intervalMs);
  };
  window.setTimeout(tick, 0);
}
