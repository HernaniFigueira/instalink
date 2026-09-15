'use client';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import { openSheet } from './sheet-bus';
import { trackEvent } from './widgets';
import { waLink } from '@/lib/utils';
import type { PublicBusiness } from '@/lib/types';
import { useCustomer, PublicMenuSheet, type NavActionItem } from './menu';
import { whatsappVisible } from '@/lib/features';
import { bottomBarItems } from '@/lib/bottombar';

// ═══════════════════════════════════════════════════════════════
// MENU INFERIOR DA PÁGINA PÚBLICA — barra fixa, colada nas bordas
// ═══════════════════════════════════════════════════════════════
// Diretrizes do produto: NADA de cápsula flutuando sobre o conteúdo e
// NADA de cantos arredondados externos. A barra ocupa a largura total da
// viewport, encosta na borda inferior, respeita a safe-area dos celulares
// e é o acesso PERSISTENTE à conversão (Agendar).
//
// Cada item é ÍCONE EM CIMA + TEXTO EMBAIXO (padrão mobile premium), com
// toque confortável. A estrutura dos itens (Conta · WhatsApp · Menu ·
// Agendar) vem de lib/bottombar.ts — Agendar é a ação principal
// (preenchida); WhatsApp continua secundário.
export function BottomBar({ business, navItems, canBook }: {
  business: PublicBusiness;
  navItems: NavActionItem[];
  canBook: boolean;
}) {
  const { customer } = useCustomer();
  const [menuOpen, setMenuOpen] = useState(false);

  function wa() {
    trackEvent(business.id, 'whatsapp_click', { from: 'bottombar' });
    window.open(waLink(business.whatsapp, `Olá! Vim pelo site da ${business.name}.`), '_blank', 'noopener,noreferrer');
  }

  const items = bottomBarItems({
    canBook,
    whatsapp: whatsappVisible(business),
    customerName: customer?.name || '',
  });

  // Ícone em cima, texto embaixo — em qualquer item da barra.
  const item = 'flex h-[60px] min-w-0 flex-1 flex-col items-center justify-center gap-[3px] px-1 text-[10.5px] font-bold leading-none transition-transform active:scale-[0.97]';
  const itemLabel = 'truncate leading-none max-w-full';

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
          {items.map((it) => {
            if (it.id === 'conta') {
              return (
                <button key={it.id} type="button" className={item} onClick={() => openSheet(customer ? 'account' : 'auth', {})}
                  aria-label={customer ? 'Minha conta' : 'Entrar'} style={{ color: 'var(--il-text)' }}>
                  <Icon n={it.icon} size={20} strokeWidth={1.9} />
                  <span className={itemLabel}>{it.label}</span>
                </button>
              );
            }
            if (it.id === 'whatsapp') {
              return (
                <button key={it.id} type="button" className={item} onClick={wa} aria-label="Abrir conversa no WhatsApp"
                  style={{ color: '#16a34a' }}>
                  <Icon n={it.icon} size={19} />
                  <span className={itemLabel}>{it.label}</span>
                </button>
              );
            }
            if (it.id === 'menu') {
              return (
                <button key={it.id} type="button" className={item} onClick={() => setMenuOpen(true)} aria-label="Menu" aria-expanded={menuOpen}
                  style={{ color: 'var(--il-text)' }}>
                  <Icon n={it.icon} size={20} strokeWidth={1.9} />
                  <span className={itemLabel}>{it.label}</span>
                </button>
              );
            }
            // AGENDAR — a conversão persistente da barra (ação principal,
            // único item preenchido, sem cantos arredondados externos).
            return (
              <button key={it.id} type="button" className={`${item} il-btn !rounded-none !shadow-none`} onClick={() => openSheet('booking', {})}
                aria-label="Agendar atendimento">
                <Icon n={it.icon} size={20} strokeWidth={1.9} />
                <span className={itemLabel}>{it.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {menuOpen && <PublicMenuSheet items={navItems} onClose={() => setMenuOpen(false)} />}
    </>
  );
}
