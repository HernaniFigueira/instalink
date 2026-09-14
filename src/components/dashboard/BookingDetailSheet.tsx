'use client';
// Detalhe do agendamento (painel): status, histórico, ações de fechamento e
// remarcação. Regras de negócio vêm de lib/booking-ops (mesma verdade da API):
//  • atendimento passado e ainda aberto = PENDÊNCIA DE FECHAMENTO (o sistema
//    nunca conclui sozinho);
//  • reagendar um atendimento já concluído/faltou/cancelado cria um NOVO
//    agendamento — o registro antigo permanece no histórico;
//  • a remarcação sempre pede confirmação e é validada no servidor
//    (disponibilidade, conflito, duração, buffer, horizonte).
//
// APRESENTAÇÃO (padrão do workspace): drawer lateral INTEGRADO à agenda — a
// grade continua visível ao fundo. Borda fina, raio moderado, pouca sombra,
// densidade igual ao resto do painel; nada de "card flutuante gigante".
// Somente a casca visual mudou; a lógica de ações é exatamente a mesma.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { BOOKING_STATUS, toneCls } from '@/lib/status';
import { todayISO, nowHM, formatDateBR, humanDay } from '@/lib/tz';
import { waLink, cn, money } from '@/lib/utils';
import { bookingActions, bookingDuration, needsClosure, rescheduleDecision } from '@/lib/booking-ops';
import { SLOT_STATE_MESSAGE } from '@/lib/slot-states';
import type { Booking, BookingStatus } from '@/lib/types';

interface ServiceRef { id: string; name: string; durationMin: number; price?: number; questions?: string[] }
interface ProRef { id: string; name: string }

// Botões discretos, coerentes com o workspace (sem botões saturados gigantes).
const TONE_BTN: Record<string, string> = {
  ok: 'bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-700',
  warn: 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50',
  danger: 'bg-white text-red-700 border-red-200 hover:bg-red-50',
  neutral: 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50',
};

const ROW = 'flex items-baseline justify-between gap-3 py-2';
const ROW_DT = 'text-xs font-medium text-zinc-500 shrink-0';
const ROW_DD = 'text-sm text-zinc-900 text-right font-medium';

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
  // Falha de rede/erro ≠ "nenhum horário livre": os estados não se misturam.
  const [slotsError, setSlotsError] = useState('');
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
    setSlotsError('');
    setTime('');
    fetch(`/api/bookings?businessId=${businessId}&serviceId=${booking.serviceId}&date=${date}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || SLOT_STATE_MESSAGE.error);
        setSlots(d.slots || []);
      })
      .catch((e: any) => {
        setSlots([]);
        setSlotsError(e?.message || SLOT_STATE_MESSAGE.error);
      })
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

  // Drawer recebe o foco e fecha em ESC (como qualquer painel do workspace).
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const actionBtn = 'text-xs font-semibold px-3 py-2 rounded-md border transition-colors disabled:opacity-50';

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="false" aria-label="Detalhe do agendamento">
      {/* Fundo: a agenda continua visível e legível atrás do painel. */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      <aside ref={panelRef} tabIndex={-1}
        className="absolute inset-y-0 right-0 w-full max-w-[420px] bg-white border-l border-zinc-200 shadow-sm flex flex-col outline-none">
        {/* ── Cabeçalho denso ── */}
        <header className="shrink-0 px-4 py-3 flex items-start justify-between gap-3 border-b border-zinc-200">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-zinc-600 tabular-nums">{formatDateBR(booking.date)} · {booking.time}–{endHM}</span>
              <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded border ${toneCls(def.tone)}`}>{def.panel}</span>
            </div>
            <p className="font-semibold text-sm mt-1 leading-snug truncate">{service?.name || 'Serviço'}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{humanDay(booking.date, today)} · {dur} min</p>
          </div>
          <button onClick={onClose} aria-label="Fechar"
            className="text-zinc-400 hover:text-zinc-900 hover:bg-zinc-50 rounded-md p-1.5 -m-1 inline-flex shrink-0"><Icon n="x" size={16} /></button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* ── Pendência: passado e ainda aberto (aviso discreto, não card) ── */}
          {late && (
            <div className="px-4 py-3 bg-amber-50/60 border-b border-amber-200/60">
              <p className="text-xs font-semibold text-amber-900 flex items-center gap-1.5"><Icon n="alert" size={13} /> Este atendimento precisa de fechamento</p>
              <p className="text-[11px] text-amber-800/80 mt-1 leading-snug">
                O horário já passou e o status continua “{def.panel}”. O InstaLink não conclui atendimento sozinho — escolha o que aconteceu:
              </p>
              <div className="grid grid-cols-2 gap-1.5 mt-2.5">
                {actions.map((a) => (
                  <button key={a.status} onClick={() => act(a.status)} disabled={!!acting}
                    className={cn(actionBtn, TONE_BTN[a.tone] || 'bg-white text-zinc-700 border-zinc-200')}>
                    {acting === a.status ? 'Salvando…' : a.label}
                  </button>
                ))}
                <button onClick={() => { setRescheduling(true); setError(''); }} disabled={!!acting}
                  className={cn(actionBtn, 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-50')}>
                  Reagendar
                </button>
              </div>
            </div>
          )}

          {/* ── Dados do atendimento (linhas com separadores discretos) ── */}
          <dl className="px-4 py-1 divide-y divide-zinc-100">
            <div className={ROW}>
              <dt className={ROW_DT}>Cliente</dt>
              <dd className={ROW_DD}>
                {booking.customerName}
                {booking.customerPhone && <span className="block text-xs text-zinc-500 font-normal">{booking.customerPhone}</span>}
              </dd>
            </div>
            <div className={ROW}>
              <dt className={ROW_DT}>Profissional</dt>
              <dd className={ROW_DD}>{pro?.name || 'Automático'}</dd>
            </div>
            <div className={ROW}>
              <dt className={ROW_DT}>Valor</dt>
              <dd className={ROW_DD}>{service?.price !== undefined ? money(service.price) : '—'}</dd>
            </div>
            {booking.note && (
              <div className={ROW}>
                <dt className={ROW_DT}>Observação</dt>
                <dd className={`${ROW_DD} font-normal text-zinc-700`}>“{booking.note}”</dd>
              </div>
            )}
            {(booking.rescheduleCount || 0) > 0 && (
              <div className={ROW}>
                <dt className={ROW_DT}>Reagendamentos</dt>
                <dd className={ROW_DD}>{booking.rescheduleCount}×</dd>
              </div>
            )}
            {(booking.answers || []).some(Boolean) && (
              <div className="py-2">
                <dt className={`${ROW_DT} mb-1`}>Respostas do cliente</dt>
                {(booking.answers || []).map((a, i) => a && (
                  <dd key={i} className="text-xs text-zinc-700 mb-1">
                    <span className="text-zinc-400 font-medium">{(service?.questions || [])[i] || `Pergunta ${i + 1}`}: </span>{a}
                  </dd>
                ))}
              </div>
            )}
          </dl>

          {error && <p className="px-4 py-2 text-sm font-medium text-red-600 border-t border-zinc-100">{error}</p>}
          {notice && <p className="px-4 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 border-t border-emerald-100">{notice}</p>}

          {rescheduling ? (
            <div className="px-4 py-3 border-t border-zinc-200 space-y-2.5">
              <p className="text-sm font-semibold">Reagendar atendimento</p>
              {decision.kind === 'recreate' && (
                <p className="text-[11px] bg-amber-50 border border-amber-200/70 text-amber-900 rounded-md px-3 py-2 leading-snug">
                  Este atendimento está <strong>{def.panel.toLowerCase()}</strong>. {decision.reason}
                </p>
              )}
              <label className="block">
                <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Nova data</span>
                <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)}
                  className="block w-full mt-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-900" />
              </label>
              {loadingSlots ? (
                <p className="text-xs text-zinc-500">Buscando horários livres…</p>
              ) : slotsError ? (
                <p className="text-xs font-medium text-red-600">{slotsError}</p>
              ) : (
                <div>
                  <span className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">Horários livres</span>
                  {slots.length === 0 ? (
                    <p className="text-xs text-amber-700 mt-1">Nenhum horário livre nesta data.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {slots.map((t) => (
                        <button key={t} onClick={() => setTime(t)}
                          className={cn('text-xs font-semibold px-2.5 py-1.5 rounded-md border', time === t ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50')}>
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Confirmação explícita: nunca remarcamos em silêncio. */}
              {confirming ? (
                <div className="rounded-md border border-zinc-300 bg-zinc-50 p-3">
                  <p className="text-xs font-semibold text-zinc-800">Confirmar reagendamento?</p>
                  <p className="text-[11px] text-zinc-600 mt-1 leading-snug">
                    {decision.kind === 'recreate' ? 'Cria um novo atendimento para' : 'Move este atendimento para'}{' '}
                    <strong>{formatDateBR(date)} às {time}</strong>. O cliente não é avisado automaticamente.
                  </p>
                  <div className="flex gap-2 mt-2.5">
                    <button onClick={reschedule} disabled={!!acting}
                      className="flex-1 text-xs font-semibold bg-zinc-900 text-white py-2 rounded-md disabled:opacity-50 hover:bg-zinc-700">
                      {acting === 'reschedule' ? 'Salvando…' : 'Confirmar'}
                    </button>
                    <button onClick={() => setConfirming(false)} className="text-xs font-semibold bg-white border border-zinc-200 px-3.5 py-2 rounded-md hover:bg-zinc-50">Voltar</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2">
                  <button onClick={() => setConfirming(true)} disabled={!date || !time || !!acting}
                    className="flex-1 text-xs font-semibold bg-zinc-900 text-white py-2 rounded-md disabled:opacity-50 hover:bg-zinc-700">
                    Revisar e confirmar
                  </button>
                  <button onClick={() => { setRescheduling(false); setError(''); }} className="text-xs font-semibold bg-white border border-zinc-200 px-3.5 py-2 rounded-md hover:bg-zinc-50">Cancelar</button>
                </div>
              )}
            </div>
          ) : (
            <div className="px-4 py-3 border-t border-zinc-200 space-y-2.5">
              {!late && actions.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {actions.map((a) => (
                    <button key={a.status} onClick={() => act(a.status)} disabled={!!acting}
                      className={cn(actionBtn, TONE_BTN[a.tone] || 'bg-white text-zinc-700 border-zinc-200')}>
                      {acting === a.status ? 'Aguarde…' : a.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap gap-1.5">
                <button onClick={() => { setRescheduling(true); setError(''); }}
                  className={cn(actionBtn, 'bg-zinc-900 text-white border-zinc-900 hover:bg-zinc-700 inline-flex items-center gap-1.5')}>
                  <Icon n="calendar" size={13} /> Reagendar
                </button>
                {booking.customerPhone && (
                  <a href={waLink(booking.customerPhone, waMsg)} target="_blank" rel="noreferrer"
                    className={cn(actionBtn, 'bg-white text-green-700 border-zinc-200 hover:bg-emerald-50/60 inline-flex items-center gap-1.5')}>
                    <Icon n="whatsapp" size={13} /> Avisar no WhatsApp
                  </a>
                )}
              </div>
            </div>
          )}

          {(booking.history || []).length > 0 && (
            <div className="px-4 py-3 border-t border-zinc-100">
              <button onClick={() => setHistoryOpen((v) => !v)} className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-700">
                Histórico ({booking.history.length}) {historyOpen ? '▲' : '▼'}
              </button>
              {historyOpen && (
                <ul className="mt-2 divide-y divide-zinc-100">
                  {[...booking.history].reverse().map((h, i) => (
                    <li key={i} className="text-xs text-zinc-500 py-1.5">
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
      </aside>
    </div>
  );
}
