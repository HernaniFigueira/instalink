'use client';
// Lista de empresas da plataforma — busca, números e entrada em modo suporte.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { ListSkeleton } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Row {
  id: string; name: string; slug: string; niche: string; published: boolean;
  status: string; createdAt: string; updatedAt: string;
  owner: { id: string; name: string; email: string; lastLoginAt: string } | null;
  contacts: number; customers: number; leads: number; bookings: number; upcomingBookings: number;
  orders: number; reviews: number; professionals: number; staff: number;
  modules: string[]; whatsapp: string; conversations: number; campaigns: number; subscription: string;
}
interface Data {
  total: number;
  totals: { businesses: number; published: number; users: number; contacts: number; bookings: number };
  businesses: Row[];
}

const FEATURE_LABEL: Record<string, string> = {
  bookings: 'Agenda', services: 'Serviços', quote: 'Orçamento', products: 'Produtos', orders: 'Pedidos',
  reviews: 'Avaliações', faq: 'FAQ', gallery: 'Galeria', location: 'Local', about: 'Sobre',
  agent: 'Assistente', whatsapp: 'WhatsApp',
};

export default function AdminPage() {
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = useCallback((term = '') => {
    fetch(`/api/admin/businesses?q=${encodeURIComponent(term)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setData(d); else setError('Não foi possível carregar as empresas.'); })
      .catch(() => setError('Não foi possível carregar as empresas.'));
  }, []);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => load(q), 350);
    return () => clearTimeout(t);
  }, [q, load]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Empresas</h1>
          <p className="text-sm text-zinc-500 mt-1">Visão de plataforma: quem está usando, o que está ativo e como está o WhatsApp.</p>
        </div>
        {data && (
          <div className="flex flex-wrap gap-2 text-xs font-bold">
            <span className="bg-white border border-zinc-200 rounded-full px-3 py-1.5">{data.totals.businesses} empresas</span>
            <span className="bg-white border border-zinc-200 rounded-full px-3 py-1.5">{data.totals.published} publicadas</span>
            <span className="bg-white border border-zinc-200 rounded-full px-3 py-1.5">{data.totals.users} usuários</span>
            <span className="bg-white border border-zinc-200 rounded-full px-3 py-1.5">{data.totals.contacts} contatos</span>
            <span className="bg-white border border-zinc-200 rounded-full px-3 py-1.5">{data.totals.bookings} agendamentos</span>
          </div>
        )}
      </div>

      <div className="relative mb-4 max-w-md">
        <Icon n="search" size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por empresa, slug ou e-mail do proprietário…"
          aria-label="Buscar empresa"
          className="w-full bg-white border border-zinc-200 rounded-xl pl-10 pr-4 py-2.5 text-sm outline-none focus:border-zinc-400" />
      </div>

      {error && <p className="mb-4 text-sm font-semibold bg-red-600 text-white rounded-xl px-4 py-3">{error}</p>}

      {!data ? <ListSkeleton rows={4} /> : data.businesses.length === 0 ? (
        <p className="bg-white border border-zinc-200 rounded-2xl text-center py-12 text-sm text-zinc-500">Nenhuma empresa encontrada.</p>
      ) : (
        <div className="space-y-3">
          {data.businesses.map((b) => (
            <div key={b.id} className="bg-white border border-zinc-200 rounded-2xl p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-extrabold flex items-center gap-2 flex-wrap">
                    {b.name}
                    <span className={cn('text-[10px] font-extrabold px-2 py-0.5 rounded-full',
                      b.published ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800')}>
                      {b.published ? 'PUBLICADA' : 'RASCUNHO'}
                    </span>
                    <span className="text-[10px] font-extrabold bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full">{b.niche}</span>
                    {b.whatsapp === 'connected' && (
                      <span className="text-[10px] font-extrabold bg-emerald-600 text-white px-2 py-0.5 rounded-full">WHATSAPP CONECTADO</span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">
                    /{b.slug} · criada em {(b.createdAt || '').slice(0, 10)} · proprietário <strong>{b.owner?.name || '—'}</strong> ({b.owner?.email || 'sem e-mail'})
                    {b.owner?.lastLoginAt ? ` · último acesso ${b.owner.lastLoginAt.slice(0, 10)}` : ' · nunca acessou'}
                  </p>
                  <div className="flex flex-wrap gap-3 mt-2 text-[11px] font-bold text-zinc-600">
                    <span>{b.contacts} contatos</span>
                    <span>{b.customers} clientes</span>
                    <span>{b.leads} leads</span>
                    <span>{b.bookings} agendamentos ({b.upcomingBookings} futuros)</span>
                    <span>{b.orders} pedidos</span>
                    <span>{b.professionals} prof.</span>
                    <span>{b.reviews} avaliações</span>
                    <span>{b.conversations} conversas</span>
                    <span>{b.campaigns} campanhas</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {b.modules.map((m) => (
                      <span key={m} className="text-[10px] font-bold bg-zinc-50 border border-zinc-200 text-zinc-600 px-2 py-0.5 rounded-full">
                        {FEATURE_LABEL[m] || m}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <Link href={`/admin/empresas/${b.id}`} className="text-xs font-bold bg-zinc-900 text-white px-3.5 py-2 rounded-lg text-center">Ver empresa</Link>
                  <a href={`/${b.slug}`} target="_blank" rel="noreferrer"
                    className="text-xs font-bold bg-zinc-100 px-3.5 py-2 rounded-lg text-center inline-flex items-center justify-center gap-1.5">
                    Página pública <Icon n="external" size={12} />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
