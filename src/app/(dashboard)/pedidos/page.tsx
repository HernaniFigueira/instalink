'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { Order, OrderStatus } from '@/lib/types';
import { money, waLink } from '@/lib/utils';
import { humanDay } from '@/lib/tz';
import { ORDER_STATUS, toneCls } from '@/lib/status';
import { ListSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';

const STATUS_IDS: OrderStatus[] = ['new', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'];
const NEXT: Record<string, string> = { new: 'accepted', accepted: 'preparing', preparing: 'ready', ready: 'completed' };
const NEXT_LABEL: Record<string, string> = { new: 'Aceitar', accepted: 'Começar preparo', preparing: 'Marcar pronto', ready: 'Concluir' };
const LIMIT = 50;

export default function PedidosPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [orders, setOrders] = useState<Order[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [armCancel, setArmCancel] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/orders?businessId=${businessId}&page=${page}&limit=${LIMIT}`)
      .then((r) => r.json()).then((d) => { setOrders(d.orders || []); setTotal(d.total || 0); setLoaded(true); });
  }, [businessId, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [filter]);

  async function setStatus(id: string, status: string) {
    setError('');
    setArmCancel('');
    const res = await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, id, status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Não foi possível atualizar.'); return; }
    load();
  }

  const list = filter ? orders.filter((o) => o.status === filter) : orders;
  const payLabels: Record<string, string> = { pix: 'PIX', card: 'Cartão', cash: 'Dinheiro', on_delivery: 'Na entrega' };
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Pedidos</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">Acompanhe e atualize o status de cada pedido.</p>
      {error && <p className="mb-4 text-sm font-medium bg-red-600 text-white rounded-xl px-4 py-3">{error}</p>}

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button onClick={() => setFilter('')} className={`shrink-0 text-xs font-bold px-3.5 py-2 rounded-full ${filter === '' ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200'}`}>Todos ({total})</button>
        {STATUS_IDS.map((s) => (
          <button key={s} onClick={() => setFilter(s)} className={`shrink-0 text-xs font-bold px-3.5 py-2 rounded-full ${filter === s ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200'}`}>{ORDER_STATUS[s].panel}</button>
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
          {list.map((o) => {
            const def = ORDER_STATUS[o.status];
            return (
              <div key={o.id} className="bg-white border border-zinc-200 rounded-2xl p-4">
                <button onClick={() => setOpen(open === o.id ? null : o.id)} className="w-full text-left">
                  <span className="flex flex-wrap items-center gap-2 justify-between">
                    <span>
                      <span className="font-extrabold">{o.code}</span>{' '}
                      <span className="font-bold text-sm">{o.customerName}</span>{' '}
                      <span className="text-xs text-zinc-500 inline-flex items-center gap-1"><Icon n={o.type === 'delivery' ? 'truck' : 'bag'} size={13} /> {o.type === 'delivery' ? 'Entrega' : 'Retirada'} · {payLabels[o.payment] || o.payment}</span>
                      <span className="block text-[11px] text-zinc-400 mt-0.5">{humanDay(o.createdAt.slice(0, 10))} às {o.createdAt.slice(11, 16)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-extrabold text-sm">{money(o.total)}</span>
                      <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${toneCls(def.tone)}`}>
                        {def.panel}
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
                        <button
                          onClick={() => { if (armCancel === o.id) setStatus(o.id, 'cancelled'); else { setArmCancel(o.id); setTimeout(() => setArmCancel((c) => (c === o.id ? '' : c)), 4000); } }}
                          className="text-xs font-bold bg-zinc-100 px-3.5 py-2 rounded-lg">
                          {armCancel === o.id ? 'Toque para confirmar' : 'Cancelar'}
                        </button>
                      )}
                      <a href={waLink(o.customerPhone, `Olá, ${o.customerName.split(' ')[0]}! Sobre seu pedido ${o.code}:`)} target="_blank" rel="noreferrer"
                        className="text-xs font-bold bg-[#22c55e]/10 text-green-700 px-3.5 py-2 rounded-lg">WhatsApp</a>
                    </span>
                  </span>
                )}
              </div>
            );
          })}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-3">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="text-xs font-bold bg-white border border-zinc-200 px-4 py-2 rounded-xl disabled:opacity-40">Anterior</button>
              <span className="text-xs text-zinc-500 font-bold">{page} de {pages}</span>
              <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}
                className="text-xs font-bold bg-white border border-zinc-200 px-4 py-2 rounded-xl disabled:opacity-40">Próxima</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
