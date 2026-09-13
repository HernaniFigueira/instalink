'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { LeadStatus } from '@/lib/types';
import { money, waLink } from '@/lib/utils';
import { humanDay } from '@/lib/tz';
import { BOOKING_STATUS, LEAD_STATUS, toneCls, type StatusDef } from '@/lib/status';
import { ListSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';

interface Person {
  key: string; customerId: string; name: string; phone: string; email: string;
  registered: boolean; customerSince: string; source: string;
  orders: number; spent: number; lastOrderAt: string;
  bookings: Array<{ id: string; customerName: string; date: string; time: string; status: string; service: string }>;
  leads: Array<{ id: string; origin: string; status: string; interest: string; action: string; createdAt: string }>;
  lastSeen: string;
}

const NEXT_LEAD: Record<string, LeadStatus | ''> = { new: 'contacted', contacted: 'qualified', qualified: 'converted' };
const NEXT_LEAD_LABEL: Record<string, string> = { new: 'Marcar contato', contacted: 'Qualificar', qualified: 'Marcar conversão' };
const ORIGIN_LABEL: Record<string, string> = {
  chat_ai: 'chat', quote: 'orçamento', booking_cta: 'reserva', whatsapp_click: 'WhatsApp',
  share: 'indicação', cart_abandoned: 'carrinho', manual: 'manual',
};

export default function ClientesPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [people, setPeople] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/people360?businessId=${businessId}&q=${encodeURIComponent(search)}&page=${page}`)
      .then((r) => r.json())
      .then((d) => { setPeople(d.people || []); setTotal(d.total || 0); setPages(d.pages || 1); setLoaded(true); });
  }, [businessId, search, page]);

  useEffect(() => { load(); }, [load]);

  // Busca com debounce simples.
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setSearch(q); }, 400);
    return () => clearTimeout(t);
  }, [q]);

  async function setLead(id: string, status: string) {
    setError('');
    const res = await fetch('/api/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, id, status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Não foi possível atualizar.'); return; }
    load();
  }

  const bookDef = (s: string): StatusDef => (BOOKING_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' };
  const leadDef = (s: string): StatusDef => (LEAD_STATUS as Record<string, StatusDef>)[s] || { panel: s, tone: 'zinc' };

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Clientes</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">Sua base de contatos — quem cria conta ou interage com a página aparece aqui, com pedidos, agendamentos e conversas.</p>
      {error && <p className="mb-4 text-sm font-medium bg-red-600 text-white rounded-xl px-4 py-3">{error}</p>}

      <div className="relative mb-4">
        <Icon n="search" size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou telefone…"
          aria-label="Buscar cliente"
          className="w-full bg-white border border-zinc-200 rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium outline-none focus:border-zinc-400" />
      </div>

      {!loaded ? <ListSkeleton rows={4} /> : people.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-2xl text-center py-14 px-6">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="users" size={24} /></div>
          <h3 className="font-bold mt-3">{search ? 'Ninguém encontrado' : 'Nenhum cliente ainda'}</h3>
          <p className="text-sm text-zinc-500 mt-1">{search ? 'Tente outro nome ou telefone.' : 'Pedidos, agendamentos e conversas criam o perfil automaticamente.'}</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs text-zinc-500 font-bold">{total} pessoa(s)</p>
          {people.map((p) => (
            <div key={p.key} className="bg-white border border-zinc-200 rounded-2xl p-4">
              <button onClick={() => setOpen(open === p.key ? null : p.key)} className="w-full text-left">
                <span className="flex items-center gap-3 justify-between">
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="w-10 h-10 rounded-full bg-zinc-900 text-white flex items-center justify-center font-black shrink-0">
                      {(p.name || '?').slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5">
                        <span className="block font-bold truncate">{p.name || 'Sem nome'}</span>
                        {p.registered && (
                          <span className="shrink-0 text-[9px] font-extrabold bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full">CADASTRADO</span>
                        )}
                      </span>
                      <span className="block text-xs text-zinc-500">
                        {p.phone || 'sem telefone'}
                        {p.registered && p.customerSince && ` · cliente desde ${humanDay(p.customerSince.slice(0, 10))}`}
                      </span>
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    {p.orders > 0 && <span className="block font-extrabold text-sm">{money(p.spent)}</span>}
                    <span className="block text-[11px] text-zinc-400">
                      {[p.orders > 0 && `${p.orders} pedido(s)`, p.bookings.length > 0 && `${p.bookings.length} agend.`, p.leads.length > 0 && `${p.leads.length} conversa(s)`].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                </span>
              </button>
              {open === p.key && (
                <span className="block mt-3 pt-3 border-t border-zinc-100 space-y-3">
                  {p.bookings.length > 0 && (
                    <span className="block">
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Agendamentos</span>
                      {p.bookings.map((b) => {
                        const d = bookDef(b.status);
                        return (
                          <span key={b.id} className="flex items-center justify-between gap-2 text-sm py-1">
                            <span>{b.service} · {humanDay(b.date)} {b.time}</span>
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${toneCls(d.tone)}`}>{d.panel}</span>
                          </span>
                        );
                      })}
                    </span>
                  )}
                  {p.leads.length > 0 && (
                    <span className="block">
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-zinc-400 mb-1.5">Conversas</span>
                      {p.leads.map((l) => {
                        const d = leadDef(l.status);
                        return (
                          <span key={l.id} className="block text-sm py-1.5 border-b border-zinc-50 last:border-0">
                            <span className="flex items-center justify-between gap-2">
                              <span>via {ORIGIN_LABEL[l.origin] || l.origin} · {humanDay(l.createdAt.slice(0, 10))}</span>
                              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${toneCls(d.tone)}`}>{d.panel}</span>
                            </span>
                            {(l.interest || l.action) && <span className="block text-xs text-zinc-500 mt-0.5">“{[l.interest, l.action].filter(Boolean).join(" · ")}”</span>}
                            <span className="flex gap-2 mt-1.5">
                              {NEXT_LEAD[l.status] && (
                                <button onClick={() => setLead(l.id, NEXT_LEAD[l.status])}
                                  className="text-[11px] font-bold bg-zinc-900 text-white px-2.5 py-1.5 rounded-lg">{NEXT_LEAD_LABEL[l.status]}</button>
                              )}
                              {l.status !== 'lost' && l.status !== 'converted' && (
                                <button onClick={() => setLead(l.id, 'lost')}
                                  className="text-[11px] font-bold bg-zinc-100 px-2.5 py-1.5 rounded-lg">Perdido</button>
                              )}
                            </span>
                          </span>
                        );
                      })}
                    </span>
                  )}
                  {p.phone && (
                    <span className="flex gap-2">
                      <a href={waLink(p.phone, `Olá, ${(p.name || '').split(' ')[0]}!`)} target="_blank" rel="noreferrer"
                        className="text-xs font-bold bg-[#22c55e]/10 text-green-700 px-3.5 py-2 rounded-lg">Conversar no WhatsApp</a>
                    </span>
                  )}
                </span>
              )}
            </div>
          ))}
          {pages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-3">
              <button onClick={() => setPage((x) => Math.max(1, x - 1))} disabled={page <= 1}
                className="text-xs font-bold bg-white border border-zinc-200 px-4 py-2 rounded-xl disabled:opacity-40">Anterior</button>
              <span className="text-xs text-zinc-500 font-bold">{page} de {pages}</span>
              <button onClick={() => setPage((x) => Math.min(pages, x + 1))} disabled={page >= pages}
                className="text-xs font-bold bg-white border border-zinc-200 px-4 py-2 rounded-xl disabled:opacity-40">Próxima</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
