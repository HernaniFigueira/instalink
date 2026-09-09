'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Order } from '@/lib/types';
import { ListSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';

function money(c: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(c / 100);
}

const STATUS: Array<{ id: Order['status']; label: string; cls: string }> = [
  { id: 'new', label: 'Novo', cls: 'bg-amber-100 text-amber-800' },
  { id: 'accepted', label: 'Aceito', cls: 'bg-blue-100 text-blue-800' },
  { id: 'preparing', label: 'Em preparo', cls: 'bg-purple-100 text-purple-800' },
  { id: 'ready', label: 'Pronto', cls: 'bg-emerald-100 text-emerald-800' },
  { id: 'completed', label: 'Entregue', cls: 'bg-zinc-100 text-zinc-600' },
  { id: 'cancelled', label: 'Cancelado', cls: 'bg-red-100 text-red-700' },
];

const NEXT: Record<string, string> = { new: 'accepted', accepted: 'preparing', preparing: 'ready', ready: 'completed' };
const NEXT_LABEL: Record<string, string> = { new: 'Aceitar', accepted: 'Começar preparo', preparing: 'Marcar pronto', ready: 'Concluir' };

export default function PedidosPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/orders?businessId=${businessId}`)
      .then((r) => r.json()).then((d) => { setOrders(d.orders || []); setLoaded(true); });
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id: string, status: string) {
    await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, id, status }),
    });
    load();
  }

  const list = filter ? orders.filter((o) => o.status === filter) : orders;
  const payLabels: Record<string, string> = { pix: 'PIX', card: 'Cartão', cash: 'Dinheiro', on_delivery: 'Na entrega' };

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Pedidos</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">Acompanhe e atualize o status de cada pedido.</p>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button onClick={() => setFilter('')} className={`shrink-0 text-xs font-bold px-3.5 py-2 rounded-full ${filter === '' ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200'}`}>Todos</button>
        {STATUS.map((s) => (
          <button key={s.id} onClick={() => setFilter(s.id)} className={`shrink-0 text-xs font-bold px-3.5 py-2 rounded-full ${filter === s.id ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200'}`}>{s.label}</button>
        ))}
      </div>

      {!loaded ? <ListSkeleton rows={4} /> : list.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-2xl text-center py-14 px-6">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="receipt" size={24} /></div>
          <h3 className="font-bold mt-3">Nenhum pedido {filter ? 'neste status' : 'ainda'}</h3>
          <p className="text-sm text-zinc-500 mt-1">Quando um cliente finalizar uma compra, ela aparece aqui.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.map((o) => (
            <div key={o.id} className="bg-white border border-zinc-200 rounded-2xl p-4">
              <button onClick={() => setOpen(open === o.id ? null : o.id)} className="w-full text-left">
                <span className="flex flex-wrap items-center gap-2 justify-between">
                  <span>
                    <span className="font-extrabold">{o.code}</span>{' '}
                    <span className="font-bold text-sm">{o.customerName}</span>{' '}
                    <span className="text-xs text-zinc-500 inline-flex items-center gap-1"><Icon n={o.type === 'delivery' ? 'truck' : 'bag'} size={13} /> {o.type === 'delivery' ? 'Entrega' : 'Retirada'} · {payLabels[o.payment] || o.payment}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-extrabold text-sm">{money(o.total)}</span>
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS.find((s) => s.id === o.status)?.cls}`}>
                      {STATUS.find((s) => s.id === o.status)?.label}
                    </span>
                  </span>
                </span>
              </button>
              {open === o.id && (
                <span className="block mt-3 pt-3 border-t border-zinc-100 space-y-1.5">
                  {o.items.map((it, i) => (
                    <span key={i} className="block text-sm">
                      <strong>{it.qty}×</strong> {it.name}
                      {it.optionsLabel && <span className="text-zinc-500"> ({it.optionsLabel})</span>}
                      <span className="float-right font-bold">{money(it.total)}</span>
                    </span>
                  ))}
                  <span className="block text-xs text-zinc-500 pt-1"><Icon n="phone" size={12} className="inline -mt-0.5" /> {o.customerPhone}{o.customerAddress && <> · <Icon n="pin" size={12} className="inline -mt-0.5" /> {o.customerAddress}</>}{o.note && ` · “${o.note}”`}</span>
                  <span className="flex flex-wrap gap-2 pt-2">
                    {NEXT[o.status] && (
                      <button onClick={() => setStatus(o.id, NEXT[o.status])} className="text-xs font-bold bg-zinc-900 text-white px-3.5 py-2 rounded-lg">{NEXT_LABEL[o.status]}</button>
                    )}
                    {o.status !== 'completed' && o.status !== 'cancelled' && (
                      <button onClick={() => { if (confirm('Cancelar este pedido?')) setStatus(o.id, 'cancelled'); }} className="text-xs font-bold bg-zinc-100 px-3.5 py-2 rounded-lg">Cancelar</button>
                    )}
                    <a href={`https://wa.me/${o.customerPhone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                      className="text-xs font-bold bg-[#22c55e]/10 text-green-700 px-3.5 py-2 rounded-lg">WhatsApp</a>
                  </span>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
