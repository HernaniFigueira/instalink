'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { ConversationsView } from './ConversationsView';
import { wrapDialogFocus } from '@/lib/dialog-focus';
export function ConversationsDock({businessId}:{businessId:string}) {
  const [open,setOpen]=useState(false), [visited,setVisited]=useState(false), [closing,setClosing]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null), heading=useRef<HTMLHeadingElement>(null), timer=useRef<ReturnType<typeof setTimeout>>();
  const path=usePathname();
  useEffect(()=>{setOpen(false);},[path]);
  useEffect(()=>{
    if(!open || !dialog.current) return;
    const d=dialog.current, previous=document.activeElement as HTMLElement|null, overflow=document.body.style.overflow;
    document.body.style.overflow='hidden'; d.showModal(); heading.current?.focus();
    // Async inbox content can replace the focused control. Native inertness alone
    // does not recover focus when React removes that control from the DOM.
    const contain=()=>{if(d.open && !d.contains(document.activeElement))heading.current?.focus({preventScroll:true});};
    const observer=new MutationObserver(contain);observer.observe(d,{childList:true,subtree:true});
    document.addEventListener('focusin',contain);
    return()=>{observer.disconnect();document.removeEventListener('focusin',contain);clearTimeout(timer.current);d.close();document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[open]);
  function close(){if(closing)return;setClosing(true);timer.current=setTimeout(()=>{setOpen(false);setClosing(false);},matchMedia('(prefers-reduced-motion: reduce)').matches?0:180);}
  return <>
    <button type="button" className="conversation-shortcut" aria-label="Abrir painel de Conversas" onClick={()=>{
      if(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]'))return;
      setVisited(true);setClosing(false);setOpen(true);
    }}><Icon n="inbox" size={20}/><span>Conversas</span></button>
    <dialog ref={dialog} className="conversations-dock" data-closing={closing} aria-modal="true" aria-labelledby="conversation-dock-title"
      onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}
      onKeyDown={e=>{wrapDialogFocus(e,e.currentTarget,heading.current);if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}}}>
      <div className="conversation-dock-inner" onClickCapture={e=>{if((e.target as HTMLElement).closest('a[href^="/"]'))close();}}>
        <header className="flex items-center gap-3 p-4 border-b border-[var(--border)]"><h2 ref={heading} tabIndex={-1} id="conversation-dock-title" className="font-semibold">Conversas</h2>
          <Link className="ml-auto text-sm underline" href={`/conversas?b=${businessId}`}>Abrir página completa</Link>
          <button type="button" className="workspace-icon-button" aria-label="Fechar painel de Conversas" onClick={close}><Icon n="x" size={20}/></button>
        </header>
        <div className="p-4 overflow-y-auto flex-1 min-h-0">{visited && <ConversationsView unitId={businessId} panel/>}</div>
      </div>
    </dialog>
  </>;
}
