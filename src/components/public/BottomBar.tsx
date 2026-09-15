'use client';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import { openSheet } from './sheet-bus';
import { trackEvent } from './widgets';
import { waLink } from '@/lib/utils';
import type { PublicBusiness } from '@/lib/types';
import { useCustomer, PublicMenuSheet, type NavActionItem } from './menu';
import { whatsappVisible } from '@/lib/features';

// ═══════════════════════════════════════════════════════════════
// MENU INFERIOR DA PÁGINA PÚBLICA — barra fixa, colada nas bordas
// ═══════════════════════════════════════════════════════════════
// Diretrizes do produto: NADA de cápsula flutuando sobre o conteúdo.
// A barra ocupa a largura total da viewport, encosta na borda inferior,
// tem altura confortável (≥ 56px por item), respeita a safe-area dos
// celulares e é o acesso PERSISTENTE à conversão (Agendar) — por isso o
// resto da página não precisa repetir o mesmo CTA em várias seções.
// Agendar é o item de ação (preenchido); WhatsApp continua complementar.
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

  const item = 'flex h-14 min-w-0 flex-1 items-center justify-center gap-2 px-2 text-[13px] font-bold transition-transform active:scale-[0.98]';
  const itemLabel = 'truncate leading-none';

  return (
    <>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 border-t"
        style={{
          background: 'color-mix(in srgb, var(--il-surface) 96%, transparent)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          borderColor: 'color-mix(in srgb, var(--il-muted) 24%, transparent)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        aria-label="Navegação"
      >
        <div className="mx-auto flex w-full max-w-2xl items-stretch">
          {/* Conta do visitante */}
          <button type="button" className={item} onClick={() => openSheet(customer ? 'account' : 'auth', {})}
            aria-label={customer ? 'Minha conta' : 'Entrar'} style={{ color: 'var(--il-text)' }}>
            <Icon n={customer ? 'userCircle' : 'user'} size={19} />
            <span className={itemLabel}>{customer ? first : 'Entrar'}</span>
          </button>

          {/* WhatsApp — ação complementar (módulo manda; não só o número) */}
          {whatsappVisible(business) && (
            <button type="button" className={item} onClick={wa} aria-label="Abrir conversa no WhatsApp"
              style={{ color: '#16a34a' }}>
              <Icon n="whatsapp" size={19} />
              <span className={itemLabel}>WhatsApp</span>
            </button>
          )}

          {/* Menu — navegação configurada pelo lojista */}
          <button type="button" className={item} onClick={() => setMenuOpen(true)} aria-label="Menu" aria-expanded={menuOpen}
            style={{ color: 'var(--il-text)' }}>
            <Icon n="menu" size={19} />
            <span className={itemLabel}>Menu</span>
          </button>

          {/* AGENDAR — a conversão persistente da barra (ação principal) */}
          {canBook && (
            <button type="button" className={`${item} il-btn !rounded-none !shadow-none`} onClick={() => openSheet('booking', {})}
              aria-label="Agendar atendimento">
              <Icon n="calendar" size={19} />
              <span className={itemLabel}>Agendar</span>
            </button>
          )}
        </div>
      </nav>

      {menuOpen && <PublicMenuSheet items={navItems} onClose={() => setMenuOpen(false)} />}
    </>
  );
}
