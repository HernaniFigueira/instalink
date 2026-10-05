'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { wrapDialogFocus } from '@/lib/dialog-focus';

export type DismissReason = 'backdrop' | 'escape' | 'close-button' | 'navigation' | 'programmatic';
export type DismissContext = 'new-booking' | 'new-client' | 'edit' | 'combined' | 'generic';

export interface DismissGuardState {
  dirty?: boolean;
  saving?: boolean;
  error?: string;
  context?: DismissContext;
  title?: string;
  description?: string;
}

export interface PendingRequest {
  reason: DismissReason;
  state: DismissGuardState;
  proceed: () => void;
  discard?: () => void;
}

const COPY: Record<DismissContext, { title: string; description: string }> = {
  'new-booking': { title: 'Descartar novo agendamento?', description: 'As informações preenchidas ainda não foram salvas.' },
  'new-client': { title: 'Descartar cadastro?', description: 'Os dados preenchidos serão perdidos.' },
  edit: { title: 'Descartar alterações não salvas?', description: 'Você perderá as alterações feitas nesta tela.' },
  combined: { title: 'Descartar alterações não salvas?', description: 'Há informações não salvas no agendamento e no cadastro rápido.' },
  generic: { title: 'Descartar alterações não salvas?', description: 'Você perderá as alterações feitas nesta tela.' },
};

/**
 * Accessible, shared confirmation UI for guarded overlays. It renders inside
 * the existing native modal; it adds no second native dialog or page backdrop.
 */
export function ConfirmDialog({ pending, onContinue, onDiscard }: {
  pending: PendingRequest | null;
  onContinue: () => void;
  onDiscard: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const saving = !!pending?.state.saving;
  const context = pending?.state.context || 'generic';
  const copy = COPY[context];

  useEffect(() => {
    if (!pending) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const id = requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[data-safe-action]')?.focus());
    return () => {
      cancelAnimationFrame(id);
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    };
  }, [pending]);

  if (!pending) return null;
  const title = saving ? 'Salvando informações' : pending.state.title || copy.title;
  const description = saving
    ? 'A gravação ainda está em andamento. Aguarde terminar antes de sair.'
    : pending.state.description || copy.description;
  return (
    <div className="overlay-confirm-layer" data-dismiss-reason={pending.reason}>
      <div ref={dialogRef} className="overlay-confirm" role="alertdialog" aria-modal="true"
        aria-labelledby="overlay-confirm-title" aria-describedby="overlay-confirm-description" tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation();
          wrapDialogFocus(event, event.currentTarget, null);
          if (event.key === 'Escape') { event.preventDefault(); onContinue(); }
        }}>
        <div className="overlay-confirm__copy">
          <h2 id="overlay-confirm-title">{title}</h2>
          <p id="overlay-confirm-description">
            {description}{!saving && pending.state.error ? ` Último salvamento: ${pending.state.error}` : ''}
          </p>
        </div>
        <div className="overlay-confirm__actions">
          <button type="button" data-safe-action className="il-control il-control--secondary overlay-confirm__action" onClick={onContinue}>
            {saving ? 'Continuar salvando' : 'Continuar editando'}
          </button>
          {!saving && <button type="button" className="il-control il-control--destructive overlay-confirm__action" onClick={onDiscard}>Descartar</button>}
        </div>
      </div>
    </div>
  );
}

/**
 * Central requestClose(reason) contract shared by Drawer and WorkspaceSheet.
 * Pristine surfaces close directly; saves block dismissal; dirty surfaces ask.
 */
export function useOverlayDismissGuard() {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const requestClose = useCallback((
    reason: DismissReason,
    state: DismissGuardState | undefined,
    proceed: () => void,
    discard?: () => void,
  ) => {
    if (state?.saving) {
      setPending({ reason, state, proceed, discard });
      return;
    }
    if (state?.dirty) {
      setPending({ reason, state, proceed, discard });
      return;
    }
    proceed();
  }, []);
  const continueEditing = useCallback(() => setPending(null), []);
  const discardAndClose = useCallback(() => {
    if (!pending) return;
    const request = pending;
    setPending(null);
    request.discard?.();
    request.proceed();
  }, [pending]);
  const dialog = <ConfirmDialog pending={pending} onContinue={continueEditing} onDiscard={discardAndClose} />;
  return { requestClose, dialog, pending };
}

/** Status contract useful for route-level editors with autosave. */
export type PersistenceState = 'pristine' | 'dirty' | 'saving' | 'saved' | 'error';

export function persistenceState({ dirty, saving, error, hasPersisted = false }: { dirty: boolean; saving: boolean; error?: string; hasPersisted?: boolean }): PersistenceState {
  if (saving) return 'saving';
  if (error && dirty) return 'error';
  if (dirty) return 'dirty';
  return hasPersisted ? 'saved' : 'pristine';
}

/**
 * Route/browser navigation protection for page-level editors. Navigation is
 * paused first; if an autosave owner is provided it can flush, then resume.
 * beforeunload is installed only while content is genuinely unsaved.
 */
export function useUnsavedChangesGuard(
  state: DismissGuardState,
  options: { beforeNavigate?: (reason: DismissReason, proceed: () => void) => void } = {},
) {
  const confirmation = useOverlayDismissGuard();
  /** Próxima navegação já autorizada por uma escolha HUMANA (ex.: "Descartar"). */
  const bypassNext = useRef(false);
  const stateRef = useRef(state);
  const beforeNavigateRef = useRef(options.beforeNavigate);
  const bypassLink = useRef(false);
  const bypassPop = useRef(false);
  const leaving = useRef(false);
  const restoringPop = useRef(false);
  stateRef.current = state;
  beforeNavigateRef.current = options.beforeNavigate;

  useEffect(() => {
    const current = stateRef.current;
    if (!current.dirty && !current.saving) return;
    const ask = (reason: DismissReason, proceed: () => void) => {
      const before = beforeNavigateRef.current;
      if (before) before(reason, proceed);
      else confirmation.requestClose(reason, stateRef.current, proceed);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!stateRef.current.dirty || leaving.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      if (bypassLink.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download') || anchor.getAttribute('href')?.startsWith('#')) return;
      if (anchor.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      ask('navigation', () => {
        leaving.current = true;
        bypassLink.current = true;
        anchor.click();
        window.setTimeout(() => { bypassLink.current = false; }, 0);
      });
    };
    const navigation = (window as Window & { navigation?: EventTarget & { traverseTo?: (key: string) => unknown; navigate?: (url: string) => unknown } }).navigation;
    const onNavigate = (event: Event) => {
      const navEvent = event as Event & { cancelable: boolean; navigationType?: string; destination?: { url?: string; key?: string; sameDocument?: boolean } };
      if (bypassNext.current) { bypassNext.current = false; return; }   // autorizada explicitamente
      if (leaving.current || bypassLink.current || !navEvent.cancelable || event.defaultPrevented) return;
      const targetUrl = navEvent.destination?.url;
      if (!targetUrl || targetUrl === window.location.href) return;
      event.preventDefault();
      const destination = navEvent.destination;
      ask('navigation', () => {
        leaving.current = true;
        if (navEvent.navigationType === 'traverse' && destination?.key && navigation?.traverseTo) navigation.traverseTo(destination.key);
        else navigation?.navigate?.(targetUrl);
      });
    };
    let popRestoreTimer = 0;
    const onPopState = () => {
      if (bypassPop.current) { bypassPop.current = false; return; }
      // Fallback for browsers without the Navigation API: restore the page
      // entry immediately, ask/flush, then replay Back only after approval.
      if (restoringPop.current) {
        restoringPop.current = false;
        ask('navigation', () => { bypassPop.current = true; window.history.back(); });
        return;
      }
      if (!stateRef.current.dirty && !stateRef.current.saving) return;
      restoringPop.current = true;
      window.history.forward();
      popRestoreTimer = window.setTimeout(() => {
        if (!restoringPop.current) return;
        restoringPop.current = false;
        ask('navigation', () => { bypassPop.current = true; window.history.back(); });
      }, 120);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', onClick, true);
    navigation?.addEventListener('navigate', onNavigate);
    if (!navigation) window.addEventListener('popstate', onPopState, true);
    return () => {
      window.clearTimeout(popRestoreTimer);
      restoringPop.current = false;
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', onClick, true);
      navigation?.removeEventListener('navigate', onNavigate);
      if (!navigation) window.removeEventListener('popstate', onPopState, true);
    };
  }, [state.dirty, state.saving, state.error, state.context, state.title, state.description, confirmation.requestClose]);

  /**
   * Autoriza EXATAMENTE a próxima navegação programática. É o que permite a uma
   * escolha explícita do humano ("Sair sem salvar" → "Descartar") ser cumprida:
   * sem isto, o guard re-perguntaria a decisão já tomada e a saída viraria um
   * laço de diálogos. Consumida no próximo evento de navegação (e expirada em
   * seguida, para não liberar uma navegação futura sem querer).
   */
  const allowNavigation = useCallback(() => {
    bypassNext.current = true;
    window.setTimeout(() => { bypassNext.current = false; }, 250);
  }, []);

  return { dialog: confirmation.dialog, requestClose: confirmation.requestClose, allowNavigation };
}
