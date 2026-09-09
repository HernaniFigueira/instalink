'use client';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { onAuthOk, openSheet } from './sheet-bus';

export type MenuTab = 'home' | 'products' | 'services' | 'booking' | 'quote';
export interface MenuItem {
  id: MenuTab;
  label: string;
}

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

// Conta do consumidor dentro do menu: só ícone quando deslogado,
// avatar + primeiro nome quando logado.
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

// Menu em pílula (fixo no topo ao rolar): abas conforme o que o
// negócio tem — loja, serviços, agenda, orçamento — mais a conta.
export function PageMenu({ items }: { items: MenuItem[] }) {
  const [active, setActive] = useState<MenuTab>('home');

  function go(id: MenuTab) {
    setActive(id);
    if (id === 'home') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (id === 'services') {
      document.querySelector('#servicos')?.scrollIntoView({ behavior: 'smooth' });
    } else {
      openSheet(id, {});
    }
  }

  return (
    <nav aria-label="Menu da página"
      className="no-scrollbar mx-auto flex w-fit max-w-full items-center gap-1 overflow-x-auto p-1.5 shadow-xl"
      style={{
        background: 'color-mix(in srgb, var(--il-surface) 88%, transparent)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRadius: 999,
        border: '1px solid color-mix(in srgb, var(--il-muted) 22%, transparent)',
      }}>
      {items.map((item) => {
        const on = active === item.id;
        return (
          <button key={item.id} onClick={() => go(item.id)} aria-current={on ? 'true' : undefined}
            className="rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap shrink-0 transition-all"
            style={on
              ? { background: 'var(--il-primary)', color: 'var(--il-btn-text, #fff)' }
              : { color: 'var(--il-muted)' }}>
            {item.label}
          </button>
        );
      })}
      <span aria-hidden="true" className="w-px self-stretch my-1.5 shrink-0"
        style={{ background: 'color-mix(in srgb, var(--il-muted) 25%, transparent)' }} />
      <AccountButton />
    </nav>
  );
}
