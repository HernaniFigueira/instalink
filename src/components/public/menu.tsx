'use client';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { onAuthOk } from './sheet-bus';

// ── Identidade do consumidor (compartilhada com a BottomBar) ──
export function useCustomer(): { customer: { name: string; avatar?: string } | null; loading: boolean } {
  const [customer, setCustomer] = useState<{ name: string; avatar?: string } | null>(null);
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

// ── Item de navegação resolvido (ação concreta de clique) ──
export interface NavActionItem {
  id: string;
  label: string;
  icon: string;
  action: { kind: 'scroll'; target: string } | { kind: 'link'; url: string };
}

const NAV_ICON: Record<string, string> = {
  about: 'store',
  services: 'scissors',
  reviews: 'star',
  faq: 'chat',
  directions: 'pin',
  contact: 'pin',
  instagram: 'instagram',
  tiktok: 'music',
};

// Menu público: bottom sheet elegante com os itens de navegação
// configuráveis da empresa (não é mais um simples hambúrguer).
export function PublicMenuSheet({ items, onClose }: { items: NavActionItem[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  function go(item: NavActionItem) {
    onClose();
    if (item.action.kind === 'scroll') {
      document.querySelector(item.action.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      window.open(item.action.url, '_blank', 'noopener,noreferrer');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-label="Navegação">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div className="il-page relative w-full sm:max-w-md max-h-[85vh] rounded-t-3xl sm:rounded-3xl overflow-hidden flex flex-col"
        style={{ background: 'var(--il-bg)' }}>
        <div className="pt-2.5 pb-1 flex justify-center shrink-0" aria-hidden="true">
          <span className="w-10 h-1.5 rounded-full" style={{ background: 'color-mix(in srgb, var(--il-muted) 35%, transparent)' }} />
        </div>
        <div className="flex items-center justify-between px-5 pb-2 shrink-0">
          <h3 className="text-lg font-extrabold">Navegação</h3>
          <button onClick={onClose} aria-label="Fechar menu"
            className="il-card w-9 h-9 font-bold shrink-0 flex items-center justify-center"><Icon n="x" size={16} /></button>
        </div>
        <div className="overflow-y-auto px-5 pb-8">
          {items.length === 0 ? (
            <p className="il-muted text-sm text-center py-8">Nada por aqui ainda. Configure o menu no painel.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {items.map((item) => (
                <button key={item.id} onClick={() => go(item)}
                  className="il-card p-4 flex flex-col items-center gap-2.5 text-center transition-transform active:scale-[0.97]"
                  style={{ borderRadius: 'var(--il-radius)' }}>
                  <span className="w-11 h-11 rounded-2xl flex items-center justify-center"
                    style={{ background: 'color-mix(in srgb, var(--il-primary) 12%, transparent)', color: 'var(--il-primary)' }}>
                    <Icon n={NAV_ICON[item.id] || 'pin'} size={20} />
                  </span>
                  <span className="text-sm font-bold leading-tight">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
