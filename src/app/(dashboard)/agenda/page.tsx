'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { todayISO, addDaysISO, weekdayOf, formatDateBR, nowHM, isPastDate } from '@/lib/tz';
import { WEEKDAYS, WEEKDAYS_LONG, timeToMin, minToTime } from '@/lib/utils';
import type { Availability, Booking, BookingStatus, Professional, Service } from '@/lib/types';
import { ListSkeleton, Button } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BookingDetailSheet } from '@/components/dashboard/BookingDetailSheet';
import { NewBookingSheet } from '@/components/dashboard/NewBookingSheet';
import { bookingDuration, needsClosure } from '@/lib/booking-ops';

type View = 'day' | 'week' | 'month';

const STATUS_BLOCK: Record<BookingStatus, string> = {
  pending: 'border-amber-400 bg-amber-50 text-amber-900',
  confirmed: 'border-emerald-400 bg-emerald-50 text-emerald-900',
  completed: 'border-blue-400 bg-blue-50 text-blue-900',
  cancelled: 'border-zinc-300 bg-zinc-50 text-zinc-400',
  no_show: 'border-red-400 bg-red-50 text-red-700',
};
const STATUS_DOT: Record<BookingStatus, string> = {
  pending: 'bg-amber-400',
  confirmed: 'bg-emerald-500',
  completed: 'bg-blue-500',
  cancelled: 'bg-zinc-300',
  no_show: 'bg-red-500',
};

const PX_PER_HOUR = 52;
const GUTTER_W = 56;
const COL_MIN = 150;

export default function AgendaPage() {
  const params = useSearchParams();
  const businessId = params.get('b') || '';
  const [view, setView] = useState<View>('day');
  const [focus, setFocus] = useState(todayISO());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [pros, setPros] = useState<Professional[]>([]);
  const [rules, setRules] = useState<Availability[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [detail, setDetail] = useState<Booking | null>(null);
  const [creating, setCreating] = useState(false);
  // drag & drop (visão Semana)
  const [dragId, setDragId] = useState('');
  const [dragSlots, setDragSlots] = useState<Record<string, string[]>>({});
  const [dropTarget, setDropTarget] = useState<{ date: string; time: string } | null>(null);
  const [dropError, setDropError] = useState('');
  const [moving, setMoving] = useState(false);

  const today = todayISO();
  const nowMin = timeToMin(nowHM());

  // Alcance carregado: mês inteiro na visão Mês; janela ±3/4 semanas nas demais.
  const range = useMemo(() => {
    if (view === 'month') {
      const first = focus.slice(0, 8) + '01';
      const dow = weekdayOf(first);
      const gridStart = addDaysISO(first, -((dow + 6) % 7));
      return { from: gridStart, to: addDaysISO(gridStart, 41) };
    }
    return { from: addDaysISO(focus, -21), to: addDaysISO(focus, 28) };
  }, [view, focus]);

  const load = useCallback(() => {
    if (!businessId) return;
    fetch(`/api/bookings?businessId=${businessId}&mode=manage&from=${range.from}&to=${range.to}&limit=1000`)
      .then((r) => r.json())
      .then((d) => setBookings(d.bookings || []))
      .catch(() => setBookings([]));
    fetch(`/api/catalog/get?businessId=${businessId}`)
      .then((r) => r.json())
      .then((d) => {
        setServices(d.services || []);
        setPros(d.professionals || []);
        setRules(d.availability || []);
        setLoaded(true);
      });
  }, [businessId, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const activePros = useMemo(() => pros.filter((p) => p.active !== false), [pros]);
  const horizonDays = 60;

  const grid = useMemo(() => {
    let s = 8 * 60, e = 20 * 60;
    for (const r of rules) {
      s = Math.min(s, timeToMin(r.start));
      e = Math.max(e, timeToMin(r.end));
    }
    s = Math.floor(s / 60) * 60;
    e = Math.ceil(e / 60) * 60;
    if (e - s < 6 * 60) e = s + 6 * 60;
    return { start: s, end: e, span: e - s, hours: Math.floor((e - s) / 60) };
  }, [rules]);

  const weekStart = useMemo(() => {
    const dow = weekdayOf(focus);
    return addDaysISO(focus, -((dow + 6) % 7));
  }, [focus]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)), [weekStart]);

  const columns = useMemo(() => {
    if (activePros.length === 0) return [{ id: '', label: 'Agenda', isPro: false }];
    const cols: Array<{ id: string; label: string; isPro: boolean }> =
      activePros.map((p) => ({ id: p.id, label: p.name, isPro: true }));
    const orphan = bookings.some((b) => !b.professionalId);
    if (orphan) cols.push({ id: '__none', label: 'Sem profissional', isPro: false });
    return cols;
  }, [activePros, bookings]);

  const serviceOf = (id: string) => services.find((s) => s.id === id);
  const serviceName = (id: string) => serviceOf(id)?.name || 'Serviço';
  const proName = (id: string) => pros.find((p) => p.id === id)?.name || '';

  // ── Pendências de fechamento (atendimentos passados não resolvidos) ──
  const pendencies = useMemo(
    () => bookings
      .filter((b) => needsClosure(b, bookingDuration(serviceOf(b.serviceId)), today, nowHM()))
      .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookings, services, today],
  );
  const pendencyCount = pendencies.length;

  function pos(b: Booking) {
    const s = timeToMin(b.time);
    const dur = serviceOf(b.serviceId)?.durationMin || 30;
    const top = Math.max(0, (s - grid.start) / 60) * PX_PER_HOUR;
    const height = Math.max(22, ((Math.min(grid.end, s + dur) - Math.max(grid.start, s)) / 60) * PX_PER_HOUR);
    return { top, height };
  }

  function move(dir: -1 | 1) {
    if (view === 'month') {
      const [y, m] = focus.split('-').map(Number);
      const nd = new Date(Date.UTC(y, m - 1 + dir, 1));
      setFocus(nd.toISOString().slice(0, 10));
      return;
    }
    setFocus((f) => addDaysISO(f, view === 'week' ? dir * 7 : dir));
  }

  const focusLabel = view === 'month'
    ? new Date(focus + 'T12:00:00Z').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    : `${WEEKDAYS_LONG[weekdayOf(focus)]}, ${formatDateBR(focus)}`;
  const gridHeight = Math.max(460, Math.round((grid.span / 60) * PX_PER_HOUR));
  const dayWidth = GUTTER_W + columns.length * COL_MIN;
  const inColumn = (b: Booking, col: { id: string; isPro: boolean }) => {
    if (col.isPro) return b.professionalId === col.id;
    if (col.id === '__none') return !b.professionalId;
    return true;
  };

  // ── Drag & drop: busca os horários LIVRES da semana para o serviço ──
  async function beginDrag(b: Booking) {
    setDragId(b.id);
    setDropError('');
    const days = [...weekDays];
    const entries = await Promise.all(days.map(async (d) => {
      try {
        const r = await fetch(`/api/bookings?businessId=${businessId}&serviceId=${b.serviceId}&date=${d}`);
        const j = await r.json();
        // o próprio horário atual não é destino válido
        return [d, (j.slots || []).filter((t: string) => !(d === b.date && t === b.time))] as const;
      } catch {
        return [d, []] as const;
      }
    }));
    setDragSlots(Object.fromEntries(entries));
  }

  function endDrag() {
    setDragId('');
    setDragSlots({});
    setDropTarget(null);
    setDropError('');
  }

  async function confirmDrop() {
    if (!dropTarget) return;
    const b = bookings.find((x) => x.id === dragId);
    if (!b) return;
    setMoving(true); setDropError('');
    try {
      const res = await fetch('/api/bookings', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, id: b.id, date: dropTarget.date, time: dropTarget.time }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || 'Não foi possível reagendar.');
      endDrag();
      load();
    } catch (e: any) {
      setDropError(e.message);
    } finally {
      setMoving(false);
    }
  }

  const dragging = dragId ? bookings.find((b) => b.id === dragId) : null;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agenda</h1>
          <p className="text-sm text-zinc-500 mt-1">Quem atende, quando e qual cliente — dia, semana e mês.</p>
        </div>
        <Button onClick={() => setCreating(true)}><Icon n="calendarPlus" size={16} /> Novo agendamento</Button>
      </div>

      {/* Pendências de fechamento: nada é concluído automaticamente. */}
      {pendencyCount > 0 && (
        <div className="mb-4 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-extrabold text-amber-900 flex items-center gap-2">
            <Icon n="alert" size={16} />
            {pendencyCount === 1 ? '1 atendimento precisa de fechamento' : `${pendencyCount} atendimentos precisam de fechamento`}
          </p>
          <p className="text-xs text-amber-900 mt-1">O horário passou e o status continua em aberto. Toque para resolver.</p>
          <div className="flex flex-wrap gap-2 mt-2.5">
            {pendencies.slice(0, 4).map((b) => (
              <button key={b.id} onClick={() => setDetail(b)}
                className="text-xs font-bold bg-white border border-amber-300 text-amber-900 px-3 py-2 rounded-lg">
                {formatDateBR(b.date)} {b.time} · {b.customerName}
              </button>
            ))}
            {pendencyCount > 4 && <span className="text-xs font-bold text-amber-900 self-center">+{pendencyCount - 4}…</span>}
          </div>
        </div>
      )}

      <div className="bg-white border border-zinc-200 rounded-2xl mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <button onClick={() => move(-1)} aria-label="Anterior"
              className="w-9 h-9 rounded-lg bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center"><Icon n="chevL" size={16} /></button>
            <button onClick={() => setFocus(todayISO())}
              className={`text-xs font-bold px-3 py-2 rounded-lg ${focus === today ? 'bg-zinc-900 text-white' : 'bg-zinc-100 hover:bg-zinc-200'}`}>Hoje</button>
            <button onClick={() => move(1)} aria-label="Próximo"
              className="w-9 h-9 rounded-lg bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center"><Icon n="chevR" size={16} /></button>
            <span className="text-sm font-bold ml-1 capitalize">{focusLabel}</span>
          </div>
          <div className="flex gap-1 p-1 bg-zinc-100 rounded-xl" role="tablist" aria-label="Tipo de visão">
            {(['day', 'week', 'month'] as View[]).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
                className={`text-xs font-bold px-3.5 py-1.5 rounded-lg ${view === v ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500'}`}>
                {v === 'day' ? 'Dia' : v === 'week' ? 'Semana' : 'Mês'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!loaded ? <ListSkeleton rows={4} /> : (
        <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
          {view === 'month' ? (
            /* ── VISÃO MÊS: calendário completo com indicadores por dia ── */
            <div className="p-1.5 sm:p-3">
              <div className="grid grid-cols-7 gap-1 mb-1">
                {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => (
                  <span key={d} className="text-[10px] font-extrabold uppercase tracking-wider text-zinc-400 text-center py-1">{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 42 }, (_, i) => addDaysISO(range.from, i)).map((d) => {
                  const list = bookings.filter((b) => b.date === d && b.status !== 'cancelled');
                  const pend = list.filter((b) => needsClosure(b, bookingDuration(serviceOf(b.serviceId)), today, nowHM())).length;
                  const inMonth = d.slice(0, 7) === focus.slice(0, 7);
                  return (
                    <button key={d} onClick={() => { setFocus(d); setView('day'); }}
                      className={`rounded-xl border p-1.5 sm:p-2 min-h-[74px] sm:min-h-[86px] text-left align-top transition-colors ${
                        d === today ? 'border-emerald-400 bg-emerald-50/60' : inMonth ? 'border-zinc-200 hover:bg-zinc-50' : 'border-transparent bg-zinc-50/60 text-zinc-400'}`}>
                      <span className="flex items-center justify-between">
                        <span className={`text-xs font-extrabold ${d === today ? 'text-emerald-700' : inMonth ? 'text-zinc-700' : 'text-zinc-400'}`}>
                          {Number(d.slice(8, 10))}
                        </span>
                        {pend > 0 && (
                          <span title={`${pend} precisam de fechamento`}
                            className="text-[9px] font-extrabold bg-amber-400 text-amber-950 rounded-full px-1.5">{pend}</span>
                        )}
                      </span>
                      {list.length > 0 && (
                        <>
                          <span className="block text-[10px] font-bold text-zinc-600 mt-1">
                            {list.length} atendimento{list.length > 1 ? 's' : ''}
                          </span>
                          <span className="flex flex-wrap gap-0.5 mt-1">
                            {list.slice(0, 8).map((b) => (
                              <span key={b.id} title={`${b.time} ${b.customerName}`} className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[b.status]}`} />
                            ))}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-3 px-1 pt-3 pb-1 text-[11px] font-bold text-zinc-500">
                {(['pending', 'confirmed', 'completed', 'no_show', 'cancelled'] as BookingStatus[]).map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${STATUS_DOT[s]}`} />
                    {s === 'pending' ? 'aguardando' : s === 'confirmed' ? 'confirmado' : s === 'completed' ? 'concluído' : s === 'no_show' ? 'falta' : 'cancelado'}
                  </span>
                ))}
              </div>
            </div>
          ) : view === 'day' ? (
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 240px)' }}>
              <div style={{ minWidth: dayWidth }}>
                <div className="sticky top-0 z-20 flex bg-white border-b border-zinc-100">
                  <div className="sticky left-0 z-30 bg-white shrink-0 border-r border-zinc-100" style={{ width: GUTTER_W, height: 44 }} />
                  {columns.map((col) => (
                    <div key={col.id} className="shrink-0 px-3 flex items-center gap-2 border-r border-zinc-100 last:border-r-0"
                      style={{ minWidth: COL_MIN, flex: 1, height: 44 }}>
                      <span className="w-6 h-6 rounded-full bg-zinc-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {col.isPro ? col.label.slice(0, 1).toUpperCase() : '—'}
                      </span>
                      <span className="text-xs font-bold truncate">{col.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex">
                  <div className="sticky left-0 z-20 bg-white shrink-0 border-r border-zinc-100" style={{ width: GUTTER_W }}>
                    <div className="relative" style={{ height: gridHeight }}>
                      {Array.from({ length: grid.hours }, (_, i) => (
                        <span key={i} className="absolute -translate-y-1/2 right-2 text-[10px] font-semibold text-zinc-400"
                          style={{ top: i * PX_PER_HOUR }}>
                          {minToTime(grid.start + i * 60)}
                        </span>
                      ))}
                    </div>
                  </div>
                  {columns.map((col) => (
                    <div key={col.id} className="relative shrink-0 border-r border-zinc-100 last:border-r-0"
                      style={{ minWidth: COL_MIN, flex: 1, height: gridHeight }}>
                      {Array.from({ length: grid.hours + 1 }, (_, i) => (
                        <span key={i} className="absolute left-0 right-0 border-t border-zinc-100/70" style={{ top: i * PX_PER_HOUR }} />
                      ))}
                      {focus === today && nowMin >= grid.start && nowMin <= grid.end && (
                        <span className="absolute left-0 right-0 border-t-2 border-red-500 z-10" style={{ top: ((nowMin - grid.start) / 60) * PX_PER_HOUR }}>
                          <span className="absolute -left-1 -top-[5px] w-2 h-2 rounded-full bg-red-500" />
                        </span>
                      )}
                      {bookings
                        .filter((b) => b.date === focus)
                        .filter((b) => inColumn(b, col))
                        .map((b) => {
                          const { top, height } = pos(b);
                          return (
                            <button key={b.id} onClick={() => setDetail(b)}
                              className={`absolute left-1 right-1 rounded-lg border-l-4 px-2 py-0.5 text-left overflow-hidden ${STATUS_BLOCK[b.status]}`}
                              style={{ top, height }}
                              title={`${b.customerName} · ${serviceName(b.serviceId)}`}>
                              <span className="block text-[11px] font-extrabold leading-tight truncate">{b.time} · {b.customerName}</span>
                              <span className="block text-[10px] leading-tight truncate opacity-80">{serviceName(b.serviceId)}</span>
                            </button>
                          );
                        })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* ── VISÃO SEMANA: arraste um atendimento para um horário livre ──
               Os alvos são os horários LIVRES de cada dia (mesma API de
               disponibilidade). Soltar abre confirmação; o servidor revalida
               profissional, duração, buffer e conflitos antes de gravar. */
            <div className="overflow-x-auto">
              <div className="flex" style={{ minWidth: 7 * 150 }}>
                {weekDays.map((d) => {
                  const dayBookings = bookings.filter((b) => b.date === d).sort((a, b) => (a.time < b.time ? 1 : -1));
                  const slots = dragSlots[d] || [];
                  const isTarget = !!dragId;
                  return (
                    <div key={d} className={`shrink-0 border-r border-zinc-100 last:border-r-0 min-h-[320px] ${d === today ? 'bg-emerald-50/40' : ''}`}
                      style={{ minWidth: 150, flex: 1 }}>
                      <div className="h-11 px-2 flex flex-col justify-center items-center border-b border-zinc-100">
                        <span className="text-[10px] font-bold text-zinc-400 uppercase">{WEEKDAYS[weekdayOf(d)]}</span>
                        <span className={`text-sm font-extrabold ${d === today ? 'text-emerald-700' : ''}`}>{d.slice(8, 10)}/{d.slice(5, 7)}</span>
                      </div>
                      <div className="p-1 space-y-1">
                        {dayBookings.map((b) => (
                          <button key={b.id} onClick={() => setDetail(b)}
                            draggable
                            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; beginDrag(b); }}
                            onDragEnd={endDrag}
                            className={`block w-full rounded-lg border-l-4 px-2 py-1.5 text-left cursor-grab active:cursor-grabbing ${STATUS_BLOCK[b.status]} ${dragId === b.id ? 'opacity-40' : ''}`}>
                            <span className="block text-[11px] font-extrabold leading-tight">{b.time} · {b.customerName}</span>
                            <span className="block text-[10px] leading-tight truncate opacity-80">{serviceName(b.serviceId)}{b.professionalId ? ` · ${proName(b.professionalId)}` : ''}</span>
                          </button>
                        ))}
                        {dayBookings.length === 0 && !isTarget && <p className="text-[10px] text-zinc-300 text-center pt-4">—</p>}

                        {isTarget && (
                          <div className="pt-1">
                            <p className="text-[9px] font-extrabold uppercase tracking-wide text-zinc-400 px-1 pb-1">horários livres</p>
                            {slots.length === 0 ? (
                              <p className="text-[10px] text-zinc-400 px-1">sem horário livre</p>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {slots.map((t) => (
                                  <span key={t}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => { e.preventDefault(); setDropTarget({ date: d, time: t }); setDropError(''); }}
                                    className="text-[10px] font-bold px-1.5 py-1 rounded border border-dashed border-emerald-400 bg-emerald-50 text-emerald-800">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Diálogo de confirmação do arrastar-e-soltar — nada é silencioso. */}
      {dropTarget && dragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => !moving && setDropTarget(null)} />
          <div className="relative w-full sm:max-w-sm bg-white rounded-3xl p-5">
            <p className="font-bold text-lg">Confirmar reagendamento</p>
            <p className="text-sm text-zinc-600 mt-2">
              <strong>{dragging.customerName}</strong> · {serviceName(dragging.serviceId)}
            </p>
            <p className="text-sm mt-1">
              {formatDateBR(dragging.date)} {dragging.time} → <strong>{formatDateBR(dropTarget.date)} {dropTarget.time}</strong>
            </p>
            {dragging.status === 'completed' || dragging.status === 'no_show' || dragging.status === 'cancelled' ? (
              <p className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 mt-3">
                Este atendimento está {dragging.status === 'completed' ? 'concluído' : dragging.status === 'no_show' ? 'marcado como falta' : 'cancelado'}:
                o novo horário entra como <strong>novo atendimento aguardando confirmação</strong> e o registro atual continua no histórico.
              </p>
            ) : (
              <p className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 mt-3">
                O mesmo atendimento muda de horário e mantém o status “{dragging.status === 'pending' ? 'aguardando confirmação' : 'confirmado'}”.
              </p>
            )}
            {dropError && <p className="text-sm font-semibold text-red-600 mt-3">{dropError}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={confirmDrop} disabled={moving}
                className="flex-1 text-sm font-bold bg-emerald-600 text-white py-3 rounded-xl disabled:opacity-50">
                {moving ? 'Salvando…' : 'Confirmar'}
              </button>
              <button onClick={() => setDropTarget(null)} disabled={moving} className="text-sm font-bold bg-zinc-100 px-4 py-3 rounded-xl">Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {detail && (
        <BookingDetailSheet
          booking={detail}
          service={serviceOf(detail.serviceId)}
          pro={detail.professionalId ? pros.find((p) => p.id === detail.professionalId) : undefined}
          businessId={businessId}
          onClose={() => setDetail(null)}
          onChanged={() => { setDetail(null); load(); }}
        />
      )}

      {creating && (
        <NewBookingSheet
          businessId={businessId}
          services={services}
          pros={pros}
          horizonDays={horizonDays}
          onClose={() => setCreating(false)}
          onCreated={load}
        />
      )}
    </>
  );
}
