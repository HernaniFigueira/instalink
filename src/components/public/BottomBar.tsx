'use client';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import { openSheet } from './sheet-bus';
import { trackEvent } from './widgets';
import { waLink } from '@/lib/utils';
import type { PublicBusiness } from '@/lib/types';
import { useCustomer, PublicMenuSheet, type NavActionItem } from './menu';

// Barra de navegação flutuante (bottom) da página pública.
// Substitui o antigo header flutuante: [Usuário · WhatsApp · Agendar · Menu].
// Tema-compatível (usa as variáveis il-*) e com safe-area para mobile.
export function BottomBar({ business, navItems, canBook }: {
  business: PublicBusiness;
  navItems: NavActionItem[];
  canBook: boolean;
}) {
  const { customer } = useCustomer();
  const [menuOpen, setMenuOpen] = useState(false);
  const first = customer ? (customer.name.trim().split(' ')[0] || 'Conta') : '';

  function wa() {
    trackEvent(business.id, 'whatsapp_click', { from: 'bottombar' });
    window.open(waLink(business.whatsapp, `Olá! Vim pelo site da ${business.name}.`), '_blank', 'noopener,noreferrer');
  }

  const btn = 'flex flex-col items-center justify-center gap-0.5 px-2 py-1 min-w-[54px] transition-transform active:scale-95';
  const chip = 'w-9 h-9 rounded-full flex items-center justify-center shrink-0';
  const lbl = 'text-[10px] font-bold truncate max-w-[62px] leading-tight';

  return (
    <>
      <nav className="fixed bottom-0 inset-x-0 z-40 flex justify-center pointer-events-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} aria-label="Navegação">
        <div className="pointer-events-auto w-full max-w-md mx-3 mb-3 rounded-2xl flex items-stretch justify-around gap-1 px-2 py-1.5 shadow-2xl"
          style={{
            background: 'color-mix(in srgb, var(--il-surface) 86%, transparent)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid color-mix(in srgb, var(--il-muted) 22%, transparent)',
          }}>
          {/* Usuário */}
          <button type="button" className={btn} onClick={() => openSheet(customer ? 'account' : 'auth', {})}
            aria-label={customer ? 'Minha conta' : 'Entrar'}>
            <span className={chip} style={customer
              ? { background: 'var(--il-primary)', color: 'var(--il-btn-text, #fff)' }
              : { background: 'color-mix(in srgb, var(--il-muted) 14%, transparent)', color: 'var(--il-text)' }}>
              {customer ? (
                <span className="text-sm font-extrabold">{first.slice(0, 1).toUpperCase()}</span>
              ) : (
                <Icon n="userCircle" size={20} />
              )}
            </span>
            <span className={lbl} style={{ color: 'var(--il-text)' }}>{customer ? first : 'Entrar'}</span>
          </button>

          {/* WhatsApp */}
          {business.whatsapp && (
            <button type="button" className={btn} onClick={wa} aria-label="WhatsApp">
              <span className={chip} style={{ background: 'rgba(34,197,94,0.14)', color: '#16a34a' }}>
                <Icon n="whatsapp" size={20} />
              </span>
              <span className={lbl} style={{ color: 'var(--il-text)' }}>WhatsApp</span>
            </button>
          )}

          {/* Agendar */}
          {canBook && (
            <button type="button" className={btn} onClick={() => openSheet('booking', {})} aria-label="Agendar">
              <span className={chip} style={{ background: 'var(--il-primary)', color: 'var(--il-btn-text, #fff)' }}>
                <Icon n="calendar" size={20} />
              </span>
              <span className={lbl} style={{ color: 'var(--il-text)' }}>Agendar</span>
            </button>
          )}

          {/* Menu */}
          <button type="button" className={btn} onClick={() => setMenuOpen(true)} aria-label="Menu" aria-expanded={menuOpen}>
            <span className={chip} style={{ background: 'color-mix(in srgb, var(--il-muted) 14%, transparent)', color: 'var(--il-text)' }}>
              <Icon n="menu" size={20} />
            </span>
            <span className={lbl} style={{ color: 'var(--il-text)' }}>Menu</span>
          </button>
        </div>
      </nav>

      {menuOpen && <PublicMenuSheet items={navItems} onClose={() => setMenuOpen(false)} />}
    </>
  );
}
