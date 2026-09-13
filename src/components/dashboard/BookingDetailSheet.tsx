'use client';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { BOOKING_STATUS, toneCls } from '@/lib/status';
import { todayISO, formatDateBR, humanDay } from '@/lib/tz';
import { waLink } from '@/lib/utils';
import type { Booking, BookingStatus } from '@/lib/types';

interface ServiceRef { id: string; name: string; durationMin: number; questions?: string[] }
interface ProRef { id: string; name: string }

// Detalhe do agendamento (painel): dados completos + ações de status,
// WhatsApp e remarcação (validação atômica no servidor).
export function BookingDetailSheet({ booking, service, pro, businessId, onClose, onChanged }: {
  booking: Booking;
  service: ServiceRef | undefined;
  pro: ProRef | undefined;
  businessId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [acting, setActing] = useState('');
  const [error, setError] = useState('');
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState(booking.date);
  const [slots, setSlots] = useState<string[]>([]);
  const [time, setTime] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);

  const def = BOOKING_STATUS[booking.status];
  const dur = service?.durationMin || 30;
  const endTime = (() => {
    const [h, m] = booking.time.split(':').map(Number);
    const e = h * 60 + m + dur;
    return `${String(Math.floor(e / 60) % 24).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`;
  })();

  useEffect(() => {
    if (!rescheduling) return;
    setLoadingSlots(true);
    setTime('');
    fetch(`/api/bookings?businessId=${businessId}&serviceId=${booking.serviceId}&date=${date}`)
      .then((r) => r.json())
      .then((d) => setSlots(d.slots || []))
      .catch(() => setSlots([]))
      .finally(() => setLoadingSlots(false));
  }, [rescheduling, date, businessId, booking.serviceId]);

  async function act(status: string, extra: Record<string, any> = {}) {
    setError('');
    setActing(status);
    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, id: booking.id, status, ...extra }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e.message);
      setActing('');
    }
  }

  async function reschedule() {
    if (!date || !time) return;
    setError('');
    setActing('reschedule');
    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, id: booking.id, date, time }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onChanged();
      onClose();
    } catch (e: any) {
      setError(e.message);
      setActing('');
    }
  }

  const actions: Array<{ status: BookingStatus; label: string; cls: string }> = [];
  if (booking.status === 'pending') {
    actions.push({ status: 'confirmed', label: 'Confirmar', cls: 'bg-emerald-600 text-white' });
    actions.push({ status: 'cancelled', label: 'Cancelar', cls: 'bg-zinc-100 text-zinc-700' });
  } else if (booking.status === 'confirmed') {
    actions.push({ status: 'completed', label: 'Concluir', cls: 'bg-blue-600 text-white' });
    actions.push({ status: 'no_show', label: 'Marcar falta', cls: 'bg-zinc-100 text-zinc-700' });
    actions.push({ status: 'cancelled', label: 'Cancelar', cls: 'bg-zinc-100 text-zinc-700' });
  } else if (booking.status === 'cancelled' || booking.status === 'no_show') {
    actions.push({ status: 'confirmed', label: 'Reativar', cls: 'bg-zinc-100 text-zinc-700' });
  }

  const today = todayISO();
  const waMsg = `Olá, ${(booking.customerName || '').split(' ')[0]}! Sobre seu agendamento de ${service?.name || 'atendimento'} (${formatDateBR(booking.date)} às ${booking.time}):`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Detalhe do agendamento">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white/95 backdrop-blur px-5 py-4 flex items-center justify-between border-b border-zinc-100">
          <div className="flex items-center gap-2.5">
            <span className="w-10 h-10 rounded-xl bg-zinc-900 text-white flex items-center justify-center font-extrabold text-sm">{booking.time}</span>
            <div>
              <p className="font-bold text-sm leading-tight">{service?.name || 'Serviço'}</p>
              <p className="text-xs text-zinc-500">{humanDay(booking.date, today)}, {formatDateBR(booking.date)} · {booking.time}–{endTime}</p>
            </div>
          </div>
          <button onClick={onClose} className="font-bold text-zinc-400 p-2 inline-flex" aria-label="Fechar"><Icon n="x" size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${toneCls(def.tone)}`}>{def.panel}</span>
            <span className="text-xs text-zinc-400 font-semibold">{dur} min</span>
          </div>

          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500 font-semibold shrink-0">Cliente</dt>
              <dd className="text-right">
                <span className="font-bold">{booking.customerName}</span>
                {booking.customerPhone && <span className="block text-xs text-zinc-500">{booking.customerPhone}</span>}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-zinc-500 font-semibold shrink-0">Profissional</dt>
              <dd className="font-bold text-right">{pro?.name || 'Automático'}</dd>
            </div>
            {booking.note && (
              <div className="flex justify-between gap-3">
                <dt className="text-zinc-500 font-semibold shrink-0">Observação</dt>
                <dd className="text-right text-zinc-700">“{booking.note}”</dd>
              </div>
            )}
            {(booking.answers || []).some(Boolean) && (
              <div>
                <dt className="text-zinc-500 font-semibold mb-1">Respostas</dt>
                {(booking.answers || []).map((a, i) => a && (
                  <dd key={i} className="text-zinc-700 mb-1">
                    <span className="text-zinc-400 text-xs font-semibold">{(service?.questions || [])[i] || `Pergunta ${i + 1}`}: </span>{a}
                  </dd>
                ))}
              </div>
            )}
          </dl>

          {(booking.history || []).length > 0 && (
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-400 mb-1">Histórico</p>
              <div className="space-y-1">
                {[...booking.history].reverse().map((h, i) => (
                  <p key={i} className="text-xs text-zinc-500">
                    {formatDateBR((h.at || '').slice(0, 10))} {(h.at || '').slice(11, 16)} · {h.from || 'criado'} → {h.to} · {h.by === 'customer' ? 'cliente' : h.by === 'owner' ? 'você' : 'sistema'}
                  </p>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}

          {rescheduling ? (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 space-y-3">
              <p className="font-bold text-sm">Reagendar</p>
              <label className="block">
                <span className="text-xs font-bold text-zinc-500">NOVA DATA</span>
                <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className="block w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm mt-1" />
              </label>
              {loadingSlots ? (
                <p className="text-xs text-zinc-500">Buscando horários…</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {slots.length === 0 && <p className="text-xs text-zinc-500">Sem horários livres nesta data.</p>}
                  {slots.map((t) => (
                    <button key={t} onClick={() => setTime(t)}
                      className={`text-xs font-bold px-3 py-2 rounded-lg border ${time === t ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button onClick={reschedule} disabled={!date || !time || acting === 'reschedule'}
                  className="flex-1 text-sm font-bold bg-zinc-900 text-white py-2.5 rounded-xl disabled:opacity-50">
                  {acting === 'reschedule' ? 'Salvando…' : 'Confirmar novo horário'}
                </button>
                <button onClick={() => { setRescheduling(false); setError(''); }} className="text-sm font-bold bg-zinc-100 px-4 py-2.5 rounded-xl">Voltar</button>
              </div>
            </div>
          ) : (
            <>
              {actions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {actions.map((a) => (
                    <button key={a.status} onClick={() => act(a.status)} disabled={!!acting}
                      className={`text-xs font-bold px-3.5 py-2 rounded-lg disabled:opacity-50 ${a.cls}`}>
                      {acting === a.status ? 'Aguarde…' : a.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setRescheduling(true); setError(''); }}
                  className="text-xs font-bold bg-zinc-900 text-white px-3.5 py-2 rounded-lg">Reagendar</button>
                {booking.customerPhone && (
                  <a href={waLink(booking.customerPhone, waMsg)} target="_blank" rel="noreferrer"
                    className="text-xs font-bold bg-[#22c55e]/10 text-green-700 px-3.5 py-2 rounded-lg">WhatsApp</a>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
