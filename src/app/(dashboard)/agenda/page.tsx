'use client';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { formatDate } from '@/lib/utils';
import type { Booking } from '@/lib/types';
import { ListSkeleton } from '@/components/ui';
import { Icon } from '@/components/icons';

const STATUS: Array<{ id: Booking['status']; label: string; cls: string }> = [
  { id: 'pending', label: 'Pendente', cls: 'bg-amber-100 text-amber-800' },
  { id: 'confirmed', label: 'Confirmado', cls: 'bg-emerald-100 text-emerald-800' },
  { id: 'completed', label: 'Concluído', cls: 'bg-blue-100 text-blue-800' },
  { id: 'cancelled', label: 'Cancelado', cls: 'bg-zinc-100 text-zinc-500' },
  { id: 'no_show', label: 'Faltou', cls: 'bg-red-100 text-red-700' },
];

export default function AgendaPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Array<{ id: string; name: string }>>([]);
  const [pros, setPros] = useState<Array<{ id: string; name: string }>>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/bookings?businessId=${businessId}&mode=manage`)
      .then((r) => r.json()).then((d) => { setBookings(d.bookings || []); setLoaded(true); });
    fetch(`/api/catalog/get?businessId=${businessId}`)
      .then((r) => r.json()).then((d) => { setServices(d.services || []); setPros(d.professionals || []); });
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id: string, status: string) {
    await fetch('/api/bookings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ businessId, id, status }),
    });
    load();
  }

  const list = filter ? bookings.filter((b) => b.status === filter) : bookings;

  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight">Agenda</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-5">Agendamentos recebidos pela sua página.</p>

      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button onClick={() => setFilter('')} className={`shrink-0 text-xs font-bold px-3.5 py-2 rounded-full ${filter === '' ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200'}`}>Todos</button>
        {STATUS.map((s) => (
          <button key={s.id} onClick={() => setFilter(s.id)} className={`shrink-0 text-xs font-bold px-3.5 py-2 rounded-full ${filter === s.id ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200'}`}>{s.label}</button>
        ))}
      </div>

      {!loaded ? <ListSkeleton rows={4} /> : list.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-2xl text-center py-14 px-6">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-zinc-100 flex items-center justify-center text-zinc-400"><Icon n="calendar" size={24} /></div>
          <h3 className="font-bold mt-3">Nenhum agendamento {filter ? 'neste status' : 'ainda'}</h3>
          <p className="text-sm text-zinc-500 mt-1">Quando um cliente reservar um horário, ele aparece aqui.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {list.map((b) => (
            <div key={b.id} className="bg-white border border-zinc-200 rounded-2xl p-4">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div>
                  <p className="font-bold text-sm">{b.customerName} <span className="font-normal text-zinc-500">· {b.customerPhone}</span></p>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {services.find((s) => s.id === b.serviceId)?.name || 'Serviço'}
                    {b.professionalId && ` · ${pros.find((p) => p.id === b.professionalId)?.name || ''}`}
                    {' '}· {formatDate(b.date)} às {b.time}
                  </p>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${STATUS.find((s) => s.id === b.status)?.cls}`}>
                  {STATUS.find((s) => s.id === b.status)?.label}
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
                <a href={`https://wa.me/${b.customerPhone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
                  className="text-xs font-bold bg-[#22c55e]/10 text-green-700 px-3.5 py-2 rounded-lg">WhatsApp</a>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
