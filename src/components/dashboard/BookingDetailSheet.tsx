'use client';
// Detalhe do agendamento (painel): status, histórico, ações de fechamento e
// remarcação. Regras de negócio vêm de lib/booking-ops (mesma verdade da API):
//  • atendimento passado e ainda aberto = PENDÊNCIA DE FECHAMENTO (o sistema
//    nunca conclui sozinho);
//  • reagendar um atendimento já concluído/faltou/cancelado cria um NOVO
//    agendamento — o registro antigo permanece no histórico;
//  • a remarcação sempre pede confirmação e é validada no servidor
//    (disponibilidade, conflito, duração, buffer, horizonte).
import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { BOOKING_STATUS, toneCls } from '@/lib/status';
import { todayISO, nowHM, formatDateBR, humanDay } from '@/lib/tz';
import { waLink } from '@/lib/utils';
import { bookingActions, bookingDuration, needsClosure, rescheduleDecision } from '@/lib/booking-ops';
import type { Booking, BookingStatus } from '@/lib/types';

interface ServiceRef { id: string; name: string; durationMin: number; questions?: string[] }
interface ProRef { id: string; name: string }

const TONE_BTN: Record<string, string> = {
  ok: 'bg-blue-600 text-white',
  warn: 'bg-red-600 text-white',
  danger: 'bg-zinc-100 text-zinc-700',
  neutral: 'bg-zinc-100 text-zinc-700',
};

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
  const [notice, setNotice] = useState('');
  const [rescheduling, setRescheduling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [date, setDate] = useState(booking.date);
  const [slots, setSlots] = useState<string[]>([]);
  const [time, setTime] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const def = BOOKING_STATUS[booking.status];
  const dur = bookingDuration(service as any);
  const today = todayISO();
  const late = needsClosure(booking, dur, today, nowHM());
  const decision = rescheduleDecision(booking.status);
  const actions = bookingActions(booking.status);
  const [h, m] = booking.time.split(':').map(Number);
  const end = h * 60 + m + dur;
  const endHM = `${String(Math.floor(end / 60) % 24).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;

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
    setError(''); setNotice('');
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
    setError(''); setNotice('');
    setActing('reschedule');
    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, id: booking.id, date, time }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConfirming(false);
      setRescheduling(false);
      if (data.created) {
        // Reagendar um atendimento já fechado gera um NOVO agendamento.
        setNotice(`Novo atendimento criado para ${formatDateBR(date)} às ${time} (aguardando confirmação). Este registro anterior continua no histórico do cliente.`);
        onChanged();
      } else {
        onChanged();
        onClose();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActing('');
    }
  }

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
              <p className="text-xs text-zinc-500">{humanDay(booking.date, today)}, {formatDateBR(booking.date)} · {booking.time}–{endHM}</p>
            </div>
          </div>
          <button onClick={onClose} className="font-bold text-zinc-400 p-2 inline-flex" aria-label="Fechar"><Icon n="x" size={16} /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${toneCls(def.tone)}`}>{def.panel}</span>
            <span className="text-xs text-zinc-400 font-semibold">{dur} min</span>
          </div>

          {/* ── Pendência: passado e ainda aberto ── */}
          {late && (
            <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
              <p className="text-sm font-extrabold text-amber-900 flex items-center gap-2">
                <Icon n="alert" size={16} /> Este atendimento precisa de fechamento
              </p>
              <p className="text-xs text-amber-900 mt-1">
                O horário já passou e o status continua “{def.panel}”. O InstaLink não conclui atendimento sozinho — escolha o que aconteceu:
              </p>
              <div className="grid grid-cols-2 gap-2 mt-3">
                {actions.map((a) => (
                  <button key={a.status} onClick={() => act(a.status)} disabled={!!acting}
                    className={`text-xs font-bold px-3 py-2.5 rounded-lg disabled:opacity-50 ${TONE_BTN[a.tone] || 'bg-zinc-100'}`}>
                    {acting === a.status ? 'Salvando…' : a.label}
                  </button>
                ))}
                <button onClick={() => { setRescheduling(true); setError(''); }} disabled={!!acting}
                  className="text-xs font-bold px-3 py-2.5 rounded-lg bg-white border-2 border-amber-300 text-amber-900 disabled:opacity-50">
                  Reagendar
                </button>
              </div>
            </div>
          )}

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
            {(booking.rescheduleCount || 0) > 0 && (
              <div className="flex justify-between gap-3">
                <dt className="text-zinc-500 font-semibold shrink-0">Reagendamentos</dt>
                <dd className="font-bold text-right">{booking.rescheduleCount}×</dd>
              </div>
            )}
            {(booking.answers || []).some(Boolean) && (
              <div>
                <dt className="text-zinc-500 font-semibold mb-1">Respostas do cliente</dt>
                {(booking.answers || []).map((a, i) => a && (
                  <dd key={i} className="text-zinc-700 mb-1">
                    <span className="text-zinc-400 text-xs font-semibold">{(service?.questions || [])[i] || `Pergunta ${i + 1}`}: </span>{a}
                  </dd>
                ))}
              </div>
            )}
          </dl>

          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
          {notice && <p className="text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{notice}</p>}

          {rescheduling ? (
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 space-y-3">
              <p className="font-bold text-sm">Reagendar atendimento</p>
              {decision.kind === 'recreate' && (
                <p className="text-xs bg-white border border-amber-200 text-amber-900 rounded-xl px-3 py-2">
                  Este atendimento está <strong>{def.panel.toLowerCase()}</strong>. {decision.reason}
                </p>
              )}
              <label className="block">
                <span className="text-xs font-bold text-zinc-500">NOVA DATA</span>
                <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)}
                  className="block w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm mt-1" />
              </label>
              {loadingSlots ? (
                <p className="text-xs text-zinc-500">Buscando horários livres…</p>
              ) : (
                <div>
                  <span className="text-xs font-bold text-zinc-500">HORÁRIOS LIVRES</span>
                  {slots.length === 0 ? (
                    <p className="text-xs text-amber-700 mt-1">Nenhum horário livre nesta data.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      {slots.map((t) => (
                        <button key={t} onClick={() => setTime(t)}
                          className={`text-xs font-bold px-3 py-2 rounded-lg border ${time === t ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200'}`}>
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Confirmação explícita: nunca remarcamos em silêncio. */}
              {confirming ? (
                <div className="rounded-xl border-2 border-emerald-300 bg-white p-3">
                  <p className="text-xs font-bold text-zinc-800">Confirmar reagendamento?</p>
                  <p className="text-xs text-zinc-600 mt-1">
                    {decision.kind === 'recreate' ? 'Cria um novo atendimento para' : 'Move este atendimento para'}{' '}
                    <strong>{formatDateBR(date)} às {time}</strong>. O cliente não é avisado automaticamente.
                  </p>
                  <div className="flex gap-2 mt-2.5">
                    <button onClick={reschedule} disabled={!!acting}
                      className="flex-1 text-sm font-bold bg-zinc-900 text-white py-2.5 rounded-xl disabled:opacity-50">
                      {acting === 'reschedule' ? 'Salvando…' : 'Confirmar'}
                    </button>
                    <button onClick={() => setConfirming(false)} className="text-sm font-bold bg-zinc-100 px-4 py-2.5 rounded-xl">Voltar</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setConfirming(true)} disabled={!date || !time || !!acting}
                    className="flex-1 text-sm font-bold bg-zinc-900 text-white py-2.5 rounded-xl disabled:opacity-50">
                    Revisar e confirmar
                  </button>
                  <button onClick={() => { setRescheduling(false); setError(''); }} className="text-sm font-bold bg-zinc-100 px-4 py-2.5 rounded-xl">Cancelar</button>
                </div>
              )}
            </div>
          ) : (
            <>
              {!late && actions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {actions.map((a) => (
                    <button key={a.status} onClick={() => act(a.status)} disabled={!!acting}
                      className={`text-xs font-bold px-3.5 py-2 rounded-lg disabled:opacity-50 ${TONE_BTN[a.tone] || 'bg-zinc-100'}`}>
                      {acting === a.status ? 'Aguarde…' : a.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => { setRescheduling(true); setError(''); }}
                  className="text-xs font-bold bg-zinc-900 text-white px-3.5 py-2 rounded-lg inline-flex items-center gap-1.5">
                  <Icon n="calendar" size={14} /> Reagendar
                </button>
                {booking.customerPhone && (
                  <a href={waLink(booking.customerPhone, waMsg)} target="_blank" rel="noreferrer"
                    className="text-xs font-bold bg-[#22c55e]/10 text-green-700 px-3.5 py-2 rounded-lg inline-flex items-center gap-1.5">
                    <Icon n="whatsapp" size={14} /> Avisar no WhatsApp
                  </a>
                )}
              </div>
            </>
          )}

          {(booking.history || []).length > 0 && (
            <div className="pt-2 border-t border-zinc-100">
              <button onClick={() => setHistoryOpen((v) => !v)} className="text-[11px] font-extrabold uppercase tracking-wider text-zinc-400">
                Histórico ({booking.history.length}) {historyOpen ? '▲' : '▼'}
              </button>
              {historyOpen && (
                <ul className="mt-2 space-y-1">
                  {[...booking.history].reverse().map((h, i) => (
                    <li key={i} className="text-xs text-zinc-500">
                      {formatDateBR((h.at || '').slice(0, 10))} {(h.at || '').slice(11, 16)} · {h.from || 'criado'} → {h.to}
                      {h.note ? ` · ${h.note}` : ''}
                      {' · '}{h.by === 'customer' ? 'cliente' : h.by === 'owner' ? 'equipe' : h.by === 'master' ? 'suporte' : 'sistema'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
