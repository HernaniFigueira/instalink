'use client';
import { useEffect } from 'react';

/** Local edits are not a server draft. Guard reload, links, history and unit switches. Editor tabs retain state. */
export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    let approved = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const confirmLeave = () => {
      if (approved) return true;
      approved = window.confirm('Há alterações não salvas. Sair sem salvar?');
      if (approved) expiry = setTimeout(() => { approved = false; }, 1500);
      return approved;
    };
    const unload = (event: BeforeUnloadEvent) => { if (!approved) { event.preventDefault(); event.returnValue = ''; } };
    const navigation = (event: Event) => {
      if (!event.defaultPrevented && !confirmLeave()) event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      const a = (event.target as Element)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey || a.hasAttribute('download') || a.getAttribute('href')?.startsWith('#')) return;
      if (a.href !== window.location.href && !confirmLeave()) { event.preventDefault(); event.stopPropagation(); }
    };
    // Same-document browser history: unlike popstate, NavigateEvent can be
    // cancelled before Next.js unmounts the editor, without rewriting history.
    const historyNavigation = (event: Event) => {
      const e = event as Event & { navigationType?: string; destination?: { sameDocument?: boolean } };
      if (e.navigationType === 'traverse' && e.destination?.sameDocument && e.cancelable) navigation(e);
    };
    const browserNavigation = (window as Window & { navigation?: EventTarget }).navigation;
    browserNavigation?.addEventListener('navigate', historyNavigation);
    window.addEventListener('beforeunload', unload);
    window.addEventListener('il:before-navigation', navigation);
    document.addEventListener('click', click, true);
    return () => { clearTimeout(expiry); browserNavigation?.removeEventListener('navigate', historyNavigation); window.removeEventListener('beforeunload', unload); window.removeEventListener('il:before-navigation', navigation); document.removeEventListener('click', click, true); };
  }, [dirty]);
}
export function mayLeaveEditor() { return window.dispatchEvent(new Event('il:before-navigation', { cancelable: true })); }
