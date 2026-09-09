'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { waLink } from '@/lib/utils';
import { todayISO, addDaysISO, humanDay } from '@/lib/tz';
import { BOOKING_STATUS, toneCls } from '@/lib/status';
import type { Booking, BookingStatus } from '@/lib/types';
import { ListSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';

type View = 'today' | 'tomorrow' | 'next' | 'past';

// Primeiro a DATA — a pergunta é sempre "quem tenho hoje?".
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'today', label: 'Hoje' },
  { id: 'tomorrow', label: 'Amanhã' },
  { id: 'next', label: 'Próximos' },
  { id: 'past', label: 'Passados' },
];

const STATUS_IDS: BookingStatus[] = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
const LIMIT = 50;

export default function AgendaPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Array<{ id: string; name: string }>>([]);
  const [pros, setPros] = useState<Array<{ id: string; name: string; active?: boolean }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>('today');
  const [statusFilter, setStatusFilter] = useState('');
  const [proFilter, setProFilter] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/bookings?businessId=${businessId}&mode=manage&page=${page}&limit=${LIMIT}`)
      .then((r) => r.json()).then((d) => {
        setBookings(d.bookings || []);
        setTotal(d.total || 0);
        setLoaded(true);
      });
    fetch(`/api/catalog/get?businessId=${businessId}`)
      .then((r) => r.json()).then((d) => { setServices(d.services || []); setPros(d.professionals || []); });
  }, [businessId, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [view, statusFilter, proFilter]);

  async function setStatus(id: string, status: string) {
    setError('');
    const res = await fetch('/api/bookings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, id, status }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setError(data.error || 'Não foi possível atualizar.'); return; }
    load();
  }

  const today = todayISO();
  const tomorrow = addDaysISO(today, 1);

  const inView = (b: Booking): boolean => {
    if (view === 'today') return b.date === today;
    if (view === 'tomorrow') return b.date === tomorrow;
    if (view === 'next') return b.date > today && b.status !== 'cancelled';
    return b.date < today;
  };

  const list = bookings
    .filter(inView)
    .filter((b) => !statusFilter || b.status === statusFilter)
    .filter((b) => !proFilter || b.professionalId === proFilter)
    .sort((a, b) => (view === 'past'
      ? (a.date + a.time < b.date + b.time ? 1 : -1)
      : (a.date + a.time < b.date + b.time ? -1 : 1)));

  // Filtro de equipe só com 2+ profissionais ATIVOS (inativo não opera).
  const activePros = pros.filter((p) => p.active !== false);
  const pages = Math.max(1, Math.ceil(total / LIMIT));
  let lastDay = '';

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Agenda</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">Quem vem, quando e com quem — ordenado pelo horário do atendimento.</p>

      {error && <p className="mb-4 text-sm font-medium bg-red-600 text-white rounded-xl px-4 py-3">{error}</p>}

      <div className="bg-white border border-zinc-200 rounded-2xl p-2 mb-4">
        <div className="grid grid-cols-4 gap-1" role="tablist" aria-label="Período">
          {VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}
              className={`text-xs font-bold px-2 py-2.5 rounded-xl ${view === v.id ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:bg-zinc-50'}`}>
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filtrar por status"
            className="text-xs font-bold bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
            <option value="">Todos os status</option>
            {STATUS_IDS.map((s) => <option key={s} value={s}>{BOOKING_STATUS[s].panel}</option>)}
          </select>
          {activePros.length > 1 && (
            <select value={proFilter} onChange={(e) => setProFilter(e.target.value)} aria-label="Filtrar por profissional"
              className="text-xs font-bold bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
              <option value="">Toda a equipe</option>
              {activePros.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
      </div>

      {!loaded ? <ListSkeleton rows={4} /> : list.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-2xl text-center py-14 px-6">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="calendar" size={24} /></div>
          <h3 className="font-bold mt-3">Nada por aqui</h3>
          <p className="text-sm text-zinc-500 mt-1">Nenhum agendamento nesta visão.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.map((b) => {
            const dayHeader = b.date !== lastDay ? b.date : '';
            lastDay = b.date;
            const def = BOOKING_STATUS[b.status];
            const svc = services.find((s) => s.id === b.serviceId)?.name || 'Serviço';
            const pro = b.professionalId ? pros.find((p) => p.id === b.professionalId)?.name || '' : '';
            return (
              <div key={b.id}>
                {dayHeader && (
                  <p className="text-xs font-extrabold uppercase tracking-wider text-zinc-400 pt-2 pb-1">
                    {humanDay(b.date, today)} · {b.date.split('-').reverse().slice(0, 2).join('/')}
                  </p>
                )}
                <div className="bg-white border border-zinc-200 rounded-2xl p-4">
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div>
                      <p className="font-bold text-sm">
                        <span className="inline-block bg-zinc-900 text-white text-xs font-extrabold px-2 py-0.5 rounded-lg mr-1.5">{b.time}</span>
                        {b.customerName} <span className="font-normal text-zinc-500">· {b.customerPhone}</span>
                      </p>
                      <p className="text-xs text-zinc-500 mt-1.5">
                        {svc}{pro && ` · com ${pro}`}
                      </p>
                      {b.note && <p className="text-xs text-zinc-500 mt-1">“{b.note}”</p>}
                      {(b.answers || []).map((a: string, i: number) => a && (
                        <p key={i} className="text-xs text-zinc-500 mt-0.5">
                          <span className="font-semibold">{((services.find((sv) => sv.id === b.serviceId) as any)?.questions || [])[i] || `Resposta ${i + 1}`}:</span> {a}
                        </p>
                      ))}
                    </div>
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${toneCls(def.tone)}`}>
                      {def.panel}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    {b.status === 'pending' && (
                      <>
                        <button onClick={() => setStatus(b.id, 'confirmed')} className="text-xs font-bold bg-emerald-600 text-white px-3.5 py-2 rounded-lg">Confirmar</button>
                        <button onClick={() => setStatus(b.id, 'cancelled')} className="text-xs font-bold bg-zinc-100 px-3.5 py-2 rounded-lg">Cancelar</button>
                      </>
                    )}
                    {b.status === 'confirmed' && (
                      <>
                        <button onClick={() => setStatus(b.id, 'completed')} className="text-xs font-bold bg-blue-600 text-white px-3.5 py-2 rounded-lg">Concluir</button>
                        <button onClick={() => setStatus(b.id, 'no_show')} className="text-xs font-bold bg-zinc-100 px-3.5 py-2 rounded-lg">Faltou</button>
                      </>
                    )}
                    <a href={waLink(b.customerPhone, `Olá, ${b.customerName.split(' ')[0]}! Sobre seu agendamento de ${svc} (${b.date.split('-').reverse().slice(0, 2).join('/')} às ${b.time}):`)} target="_blank" rel="noreferrer"
                      className="text-xs font-bold bg-[#22c55e]/10 text-green-700 px-3.5 py-2 rounded-lg">WhatsApp</a>
                  </div>
                </div>
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
