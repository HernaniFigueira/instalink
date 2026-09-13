'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import type { LeadStatus } from '@/lib/types';
import { money, waLink } from '@/lib/utils';
import { humanDay } from '@/lib/tz';
import { BOOKING_STATUS, LEAD_STATUS, toneCls, type StatusDef } from '@/lib/status';
import { ListSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';
import { NewBookingSheet } from '@/components/dashboard/NewBookingSheet';

interface Person {
  key: string; contactId: string; note: string; customerId: string; name: string; phone: string; email: string;
  registered: boolean; customerSince: string; source: string; marketingOptIn: boolean;
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
  const [noteDraft, setNoteDraft] = useState<Record<string, string>>({});
  const [bookingFor, setBookingFor] = useState<Person | null>(null);
  const [services, setServices] = useState<any[]>([]);
  const [pros, setPros] = useState<any[]>([]);

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/people360?businessId=${businessId}&q=${encodeURIComponent(search)}&page=${page}`)
      .then((r) => r.json())
      .then((d) => { setPeople(d.people || []); setTotal(d.total || 0); setPages(d.pages || 1); setLoaded(true); });
  }, [businessId, search, page]);

  useEffect(() => { load(); }, [load]);

  function openBooking(p: Person) {
    setBookingFor(p);
    fetch(`/api/catalog/get?businessId=${businessId}`)
      .then((r) => r.json())
      .then((d) => { setServices(d.services || []); setPros(d.professionals || []); })
      .catch(() => {});
  }

  async function setConsent(p: Person, value: boolean) {
    if (!p.contactId) { setError('Este contato ainda não tem cadastro no CRM.'); return; }
    setError('');
    const res = await fetch('/api/contacts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, id: p.contactId, marketingOptIn: value }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Não foi possível atualizar.'); return; }
    load();
  }

  async function saveNote(p: Person) {
    if (!p.contactId) return;
    setError('');
    const note = noteDraft[p.contactId] ?? p.note;
    const res = await fetch('/api/contacts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, id: p.contactId, note }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Não foi possível salvar.'); return; }
    load();
  }

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setSearch(q); }, 350);
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
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Clientes</h1>
          <p className="text-sm text-zinc-500 mt-0.5">Base única — pedidos, agendamentos e conversas no mesmo perfil.</p>
        </div>
        <span className="text-xs font-medium text-zinc-500 bg-white border border-zinc-200 rounded-md px-2.5 py-1 hidden sm:inline">{total} contatos</span>
      </div>
      {error && <p className="mb-3 text-sm font-medium bg-red-600 text-white rounded-md px-3 py-2">{error}</p>}

      {/* Toolbar workspace — filtros + busca em linha, não card */}
      <div className="bg-white border border-zinc-200 flex items-center gap-2 px-3 py-2 mb-3">
        <div className="relative flex-1">
          <Icon n="search" size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou WhatsApp…"
            className="w-full bg-zinc-50 border border-zinc-200 rounded-md pl-8 pr-3 py-2 text-sm focus:outline-none focus:border-zinc-300 focus:bg-white" />
        </div>
        <span className="text-xs text-zinc-500 hidden sm:inline">{total} · pág {page}/{pages}</span>
      </div>

      {!loaded ? <ListSkeleton rows={4} /> : people.length === 0 ? (
        <div className="bg-white border border-zinc-200 text-center py-12 px-6">
          <div className="mx-auto w-10 h-10 rounded-md bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="users" size={20} /></div>
          <h3 className="font-semibold text-sm mt-3">{search ? 'Ninguém encontrado' : 'Nenhum cliente ainda'}</h3>
          <p className="text-sm text-zinc-500 mt-1">{search ? 'Tente outro termo.' : 'Pedidos, agendamentos e conversas criam o perfil automaticamente.'}</p>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200">
          {/* Header da tabela — denso, divisórias */}
          <div className="hidden sm:grid grid-cols-[1fr_140px_120px_80px] gap-3 px-4 py-2 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold tracking-wide uppercase text-zinc-500">
            <span>Nome</span><span>WhatsApp</span><span>Último contato</span><span className="text-right">Ações</span>
          </div>
          <div className="divide-y divide-zinc-100">
            {people.map((p) => (
              <div key={p.key} className="bg-white">
                <button onClick={() => setOpen(open === p.key ? null : p.key)} className="w-full text-left hover:bg-zinc-50">
                  <div className="flex sm:grid sm:grid-cols-[1fr_140px_120px_80px] items-center gap-3 px-4 py-3">
                    <span className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center text-xs font-bold shrink-0">
                        {(p.name || '?').slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="text-sm font-medium truncate">{p.name || 'Sem nome'}</span>
                          {p.registered && <span className="text-[10px] font-semibold bg-zinc-900 text-white px-1.5 py-0.5 rounded">CAD</span>}
                        </span>
                        <span className="block text-xs text-zinc-500 truncate sm:hidden">{p.phone || '—'} · {p.lastSeen ? humanDay(p.lastSeen.slice(0, 10)) : '—'}</span>
                      </span>
                    </span>
                    <span className="hidden sm:block text-sm text-zinc-700 truncate">{p.phone || '—'}</span>
                    <span className="hidden sm:block text-xs text-zinc-500">{p.lastSeen ? humanDay(p.lastSeen.slice(0, 10)) : '—'}</span>
                    <span className="hidden sm:flex justify-end items-center gap-1.5 text-xs text-zinc-500 shrink-0">
                      {p.orders > 0 && <span className="font-medium text-zinc-900">{money(p.spent)}</span>}
                      <Icon n={open === p.key ? 'chevU' : 'chevD'} size={14} className="text-zinc-400" />
                    </span>
                    <span className="sm:hidden text-zinc-400"><Icon n={open === p.key ? 'chevU' : 'chevD'} size={14} /></span>
                  </div>
                  <div className="sm:hidden px-4 pb-1 -mt-1 flex gap-2 text-xs text-zinc-500">
                    {p.orders > 0 && <span>{p.orders} ped.</span>}
                    {p.bookings.length > 0 && <span>{p.bookings.length} agend.</span>}
                    {p.marketingOptIn && <span className="text-emerald-700">consentido</span>}
                  </div>
                </button>
                {open === p.key && (
                  <div className="border-t border-zinc-200 bg-zinc-50/50 px-4 py-4 space-y-4">
                    {/* Linha do tempo real, não coleção de cards */}
                    {p.bookings.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Agendamentos</p>
                        <div className="border-l-2 border-zinc-200 ml-1 pl-4 space-y-2">
                          {p.bookings.map((b) => {
                            const d = bookDef(b.status);
                            return (
                              <div key={b.id} className="relative flex items-center justify-between gap-2 text-sm">
                                <span className="absolute -left-[18px] w-2 h-2 rounded-full bg-zinc-400" />
                                <span>{b.service} · {humanDay(b.date)} {b.time}</span>
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${toneCls(d.tone)}`}>{d.panel}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {p.leads.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Conversas</p>
                        <div className="space-y-2">
                          {p.leads.map((l) => {
                            const d = leadDef(l.status);
                            return (
                              <div key={l.id} className="bg-white border border-zinc-200 px-3 py-2">
                                <div className="flex items-center justify-between gap-2 text-sm">
                                  <span className="text-zinc-600">via {ORIGIN_LABEL[l.origin] || l.origin} · {humanDay(l.createdAt.slice(0, 10))}</span>
                                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${toneCls(d.tone)}`}>{d.panel}</span>
                                </div>
                                {(l.interest || l.action) && <p className="text-xs text-zinc-500 mt-1">“{[l.interest, l.action].filter(Boolean).join(' · ')}”</p>}
                                <div className="flex gap-1.5 mt-2">
                                  {NEXT_LEAD[l.status] && (
                                    <button onClick={() => setLead(l.id, NEXT_LEAD[l.status])} className="text-xs font-medium bg-zinc-900 text-white px-2.5 py-1 rounded-md">{NEXT_LEAD_LABEL[l.status]}</button>
                                  )}
                                  {l.status !== 'lost' && l.status !== 'converted' && (
                                    <button onClick={() => setLead(l.id, 'lost')} className="text-xs font-medium bg-white border border-zinc-200 px-2.5 py-1 rounded-md">Perdido</button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3 bg-white border border-zinc-200 px-3 py-2.5">
                      <div>
                        <p className="text-xs font-semibold">Autoriza receber promoções</p>
                        <p className="text-xs text-zinc-500">Sem isso não entra em campanha.</p>
                      </div>
                      <button onClick={() => setConsent(p, !p.marketingOptIn)} role="switch" aria-checked={p.marketingOptIn} className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${p.marketingOptIn ? 'bg-zinc-900' : 'bg-zinc-300'}`}>
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow ${p.marketingOptIn ? 'left-4.5' : 'left-0.5'}`} style={{ left: p.marketingOptIn ? '18px' : '2px' }} />
                      </button>
                    </div>
                    {p.contactId && (
                      <div>
                        <p className="text-xs font-semibold tracking-wide uppercase text-zinc-500 mb-2">Observações da equipe</p>
                        <div className="flex gap-2">
                          <input defaultValue={p.note} onChange={(e) => setNoteDraft((d) => ({ ...d, [p.contactId]: e.target.value }))} placeholder="Ex: prefere manhã, alergia a X…" className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" />
                          <button onClick={() => saveNote(p)} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md">Salvar</button>
                        </div>
                      </div>
                    )}
                    {p.phone && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button onClick={() => openBooking(p)} className="text-xs font-semibold bg-zinc-900 text-white px-3 py-2 rounded-md inline-flex items-center gap-1.5"><Icon n="calendarPlus" size={14} /> Novo agendamento</button>
                        <a href={waLink(p.phone, `Olá, ${(p.name || '').split(' ')[0]}!`)} target="_blank" rel="noreferrer" className="text-xs font-semibold bg-white border border-zinc-200 px-3 py-2 rounded-md inline-flex items-center gap-1.5"><Icon n="whatsapp" size={14} /> WhatsApp</a>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          {pages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-200 bg-zinc-50 text-xs">
              <button onClick={() => setPage((x) => Math.max(1, x - 1))} disabled={page <= 1} className="font-medium bg-white border border-zinc-200 px-3 py-1.5 rounded-md disabled:opacity-40">Anterior</button>
              <span className="text-zinc-500 font-medium">{page} de {pages} · {total} contatos</span>
              <button onClick={() => setPage((x) => Math.min(pages, x + 1))} disabled={page >= pages} className="font-medium bg-white border border-zinc-200 px-3 py-1.5 rounded-md disabled:opacity-40">Próxima</button>
            </div>
          )}
        </div>
      )}

      {bookingFor && (
        <NewBookingSheet
          businessId={businessId}
          services={services}
          pros={pros}
          horizonDays={60}
          initial={{ contactId: bookingFor.contactId, name: bookingFor.name, phone: bookingFor.phone, email: bookingFor.email }}
          onClose={() => setBookingFor(null)}
          onCreated={load}
        />
      )}
    </>
  );
}
