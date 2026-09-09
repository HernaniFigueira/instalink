'use client';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { onAuthOk, openSheet } from './sheet-bus';

// Navegação pública: [conta] + [☰ menu] no topo; drawer da direita com
// as áreas que REALMENTE existem (sem "Início" — a página já é o início).
// Agendar abre o MESMO sheet do CTA (destino único, sem fluxos paralelos).
export type MenuTab = 'products' | 'services' | 'booking' | 'quote' | 'reviews' | 'contact';
export interface MenuItem {
  id: MenuTab;
  label: string;
}

const TAB_ICON: Record<MenuTab, string> = {
  services: 'scissors',
  booking: 'calendar',
  products: 'bag',
  quote: 'chat',
  reviews: 'star',
  contact: 'pin',
};

export function useCustomer(): { customer: { name: string } | null; loading: boolean } {
  const [customer, setCustomer] = useState<{ name: string } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    fetch('/api/customer/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCustomer(d?.customer || null))
      .catch(() => setCustomer(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
    const off = onAuthOk(refresh);
    const changed = () => refresh();
    window.addEventListener('il:auth-changed', changed);
    return () => {
      off();
      window.removeEventListener('il:auth-changed', changed);
    };
  }, [refresh]);

  return { customer, loading };
}

// Conta do consumidor: só ícone quando deslogado, avatar + nome quando logado.
function AccountButton() {
  const { customer, loading } = useCustomer();

  if (loading) {
    return (
      <span className="w-9 h-9 rounded-full animate-pulse shrink-0" aria-hidden="true"
        style={{ background: 'color-mix(in srgb, var(--il-muted) 25%, transparent)' }} />
    );
  }
  if (!customer) {
    return (
      <button onClick={() => openSheet('auth', {})} aria-label="Entrar" title="Entrar"
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform active:scale-95"
        style={{ color: 'var(--il-muted)' }}>
        <Icon n="userCircle" size={24} />
      </button>
    );
  }
  const first = customer.name.split(' ')[0] || customer.name;
  return (
    <button onClick={() => openSheet('account', {})} aria-label={`Minha conta — ${first}`} title="Minha conta"
      className="flex items-center gap-1.5 rounded-full pl-1 pr-3 py-1 shrink-0 transition-transform active:scale-95"
      style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)' }}>
      <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold"
        style={{ background: 'var(--il-primary)', color: 'var(--il-btn-text, #fff)' }}>
        {first.slice(0, 1).toUpperCase()}
      </span>
      <span className="text-sm font-bold max-w-[76px] truncate">{first}</span>
    </button>
  );
}

export function PageMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open ]);

  function go(id: MenuTab) {
    setOpen(false);
    if (id === 'services') {
      document.querySelector('#servicos')?.scrollIntoView({ behavior: 'smooth' });
    } else if (id === 'reviews') {
      document.querySelector('#avaliacoes')?.scrollIntoView({ behavior: 'smooth' });
    } else if (id === 'contact') {
      document.querySelector('#contato')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      openSheet(id, {});
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <AccountButton />
        <button onClick={() => setOpen(true)} aria-label="Menu" aria-expanded={open} title="Menu"
          className="flex items-center gap-2 rounded-full pl-3 pr-4 py-2 text-sm font-bold shadow-xl transition-transform active:scale-95"
          style={{
            background: 'color-mix(in srgb, var(--il-surface) 88%, transparent)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid color-mix(in srgb, var(--il-muted) 22%, transparent)',
            color: 'var(--il-text)',
          }}>
          <Icon n="menu" size={18} /> Menu
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-label="Menu">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside
            className="absolute top-0 right-0 h-full w-72 max-w-[85vw] p-5 flex flex-col gap-1 overflow-y-auto"
            style={{ background: 'var(--il-surface)', borderLeft: '1px solid color-mix(in srgb, var(--il-muted) 18%, transparent)' }}>
            <div className="flex items-center justify-between mb-3">
              <p className="font-extrabold">Menu</p>
              <button onClick={() => setOpen(false)} aria-label="Fechar menu"
                className="w-9 h-9 rounded-full flex items-center justify-center transition-transform active:scale-95"
                style={{ background: 'color-mix(in srgb, var(--il-muted) 14%, transparent)', color: 'var(--il-text)' }}>
                <Icon n="x" size={18} />
              </button>
            </div>
            {items.map((item) => (
              <button key={item.id} onClick={() => go(item.id)}
                className="flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left font-bold transition-transform active:scale-[0.99]"
                style={{ color: 'var(--il-text)' }}>
                <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)', color: 'var(--il-primary)' }}>
                  <Icon n={TAB_ICON[item.id]} size={18} />
                </span>
                {item.label}
              </button>
            ))}
          </aside>
        </div>
      )}
    </>
  );
}
