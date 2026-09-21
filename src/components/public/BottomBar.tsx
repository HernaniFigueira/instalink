'use client';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import { openSheet } from './sheet-bus';
import { trackEvent } from './widgets';
import { waLink } from '@/lib/utils';
import type { PublicBusiness } from '@/lib/types';
import { useCustomer, PublicMenuSheet, type NavActionItem } from './menu';
import { whatsappVisible } from '@/lib/features';
import { bottomBarItems, type BottomBarItem } from '@/lib/bottombar';

/** Shared presentation only: the editor renders this without auth, tracking or booking effects. */
export function BottomBarView({ items, logged = false, menuOpen = false, onAction }: {
  items: BottomBarItem[]; logged?: boolean; menuOpen?: boolean;
  onAction?: (id: BottomBarItem['id']) => void;
}) {
  const item = 'flex h-[60px] min-w-0 flex-1 flex-col items-center justify-center gap-[3px] px-1 text-[10.5px] font-bold leading-none transition-transform active:scale-[0.97]';
  return <nav className="fixed inset-x-0 bottom-0 z-40 border-t" aria-label="Navegação"
    style={{background:'color-mix(in srgb, var(--il-surface) 96%, transparent)',backdropFilter:'blur(14px)',WebkitBackdropFilter:'blur(14px)',borderColor:'color-mix(in srgb, var(--il-muted) 24%, transparent)',paddingBottom:'env(safe-area-inset-bottom)'}}>
    <div className="mx-auto flex w-full max-w-2xl items-stretch">
      {items.map(it => <button key={it.id} type="button" onClick={() => onAction?.(it.id)}
        className={`${item}${it.primary ? ' il-btn !rounded-none !shadow-none' : ''}`}
        aria-label={it.id === 'conta' ? logged ? 'Minha conta' : 'Entrar' : it.id === 'whatsapp' ? 'Abrir conversa no WhatsApp' : it.id === 'agendar' ? 'Agendar atendimento' : 'Menu'}
        aria-expanded={it.id === 'menu' ? menuOpen : undefined}
        style={it.primary ? undefined : {color:it.id === 'whatsapp' ? '#15803d' : 'var(--il-text)'}}>
        <Icon n={it.icon} size={20} strokeWidth={1.9}/><span className="truncate leading-none max-w-full">{it.label}</span>
      </button>)}
    </div>
  </nav>;
}

export function BottomBar({ business, navItems, canBook }: {business: PublicBusiness; navItems: NavActionItem[]; canBook: boolean}) {
  const { customer } = useCustomer();
  const [menuOpen, setMenuOpen] = useState(false);
  const items = bottomBarItems({ canBook, whatsapp: whatsappVisible(business), customerName: customer?.name || '' });
  function action(id: BottomBarItem['id']) {
    if(id === 'conta') openSheet(customer ? 'account' : 'auth', {});
    if(id === 'menu') setMenuOpen(true);
    if(id === 'agendar') openSheet('booking', {});
    if(id === 'whatsapp') {
      trackEvent(business.id, 'whatsapp_click', { from: 'bottombar' });
      window.open(waLink(business.whatsapp, `Olá! Vim pelo site da ${business.name}.`), '_blank', 'noopener,noreferrer');
    }
  }
  return <><BottomBarView items={items} logged={!!customer} menuOpen={menuOpen} onAction={action}/>
    {menuOpen && <PublicMenuSheet items={navItems} onClose={() => setMenuOpen(false)}/>}
  </>;
}
