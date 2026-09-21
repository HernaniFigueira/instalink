/** Supplement native dialog inertness: don't let Tab escape to browser chrome. */
export function wrapDialogFocus(event: { key: string; shiftKey: boolean; defaultPrevented: boolean; preventDefault(): void }, dialog: HTMLDialogElement, heading: HTMLElement | null) {
  if (event.key !== 'Tab' || event.defaultPrevented) return;
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex], [contenteditable="true"]'))
    .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && !el.closest('[hidden], [inert]') && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden' && el.closest('dialog') === dialog);
  const first = controls[0], last = controls[controls.length - 1];
  if (!first) { event.preventDefault(); heading?.focus(); }
  else if (event.shiftKey && (document.activeElement === first || document.activeElement === heading)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
