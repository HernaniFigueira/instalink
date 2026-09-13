'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { todayISO, addDaysISO, weekdayOf, formatDateBR, nowHM } from '@/lib/tz';
import { WEEKDAYS, WEEKDAYS_LONG, timeToMin, minToTime } from '@/lib/utils';
import type { Availability, Booking, BookingStatus, Professional, Service } from '@/lib/types';
import { ListSkeleton, Button } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BookingDetailSheet } from '@/components/dashboard/BookingDetailSheet';
import { NewBookingSheet } from '@/components/dashboard/NewBookingSheet';
import { bookingDuration, needsClosure } from '@/lib/booking-ops';

type View = 'day' | 'week' | 'month';

const STATUS_BLOCK: Record<BookingStatus, string> = {
  pending: 'border-amber-300 bg-amber-50 text-amber-900',
  confirmed: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  completed: 'border-blue-300 bg-blue-50 text-blue-900',
  cancelled: 'border-zinc-200 bg-zinc-50 text-zinc-400',
  no_show: 'border-red-300 bg-red-50 text-red-700',
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
const COL_MIN = 148;

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

  // drag state — pointer based, sem re-render por pixel
  const [dragId, setDragId] = useState('');
  const [dragSlots, setDragSlots] = useState<Record<string, string[]>>({});
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState('');
  const [hoverSlot, setHoverSlot] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ date: string; time: string } | null>(null);
  const [dropError, setDropError] = useState('');
  const [moving, setMoving] = useState(false);
  const dragSeq = useRef(0);
  const hoverRaf = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const today = todayISO();
  const nowMin = timeToMin(nowHM());

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
    const cols: Array<{ id: string; label: string; isPro: boolean }> = activePros.map((p) => ({ id: p.id, label: p.name, isPro: true }));
    const orphan = bookings.some((b) => !b.professionalId);
    if (orphan) cols.push({ id: '__none', label: 'Sem profissional', isPro: false });
    return cols;
  }, [activePros, bookings]);

  const serviceOf = (id: string) => services.find((s) => s.id === id);
  const serviceName = (id: string) => serviceOf(id)?.name || 'Serviço';
  const proName = (id: string) => pros.find((p) => p.id === id)?.name || '';

  const pendencies = useMemo(
    () => bookings.filter((b) => needsClosure(b, bookingDuration(serviceOf(b.serviceId)), today, nowHM())).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1)),
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

  // ── Drag: inicia ao pressionar (pointer), busca slots com race-protection ──
  function beginDrag(b: Booking, e: React.PointerEvent) {
    // Evita selecionar texto e permite arrastar; não previne click do detalhe se não mover
    const target = e.currentTarget as HTMLElement;
    try { target.setPointerCapture(e.pointerId); } catch {}
    setDragId(b.id);
    setSlotsError('');
    setHoverSlot(null);
    setSlotsLoading(true);
    setDragSlots({});
    const seq = ++dragSeq.current;
    const days = [...weekDays];
    Promise.all(days.map(async (d) => {
      try {
        const r = await fetch(`/api/bookings?businessId=${businessId}&serviceId=${b.serviceId}&date=${d}`);
        if (seq !== dragSeq.current) return [d, []] as const;
        const j = await r.json();
        if (!r.ok) return [d, []] as const;
        return [d, (j.slots || []).filter((t: string) => !(d === b.date && t === b.time))] as const;
      } catch {
        return [d, []] as const;
      }
    })).then((entries) => {
      if (seq !== dragSeq.current) return;
      setDragSlots(Object.fromEntries(entries));
      setSlotsLoading(false);
      if (entries.every(([, arr]) => arr.length === 0)) {
        // sem slots em nenhum dia — não é erro, é empty (será mostrado corretamente)
      }
    }).catch(() => {
      if (seq !== dragSeq.current) return;
      setSlotsError('Não foi possível carregar os horários.');
      setSlotsLoading(false);
    });
  }

  function endDrag() {
    dragSeq.current++;
    setDragId('');
    setDragSlots({});
    setSlotsLoading(false);
    setSlotsError('');
    setHoverSlot(null);
    if (hoverRaf.current) { cancelAnimationFrame(hoverRaf.current); hoverRaf.current = null; }
  }

  function onSlotHover(date: string, time: string) {
    const key = `${date} ${time}`;
    if (hoverRaf.current) cancelAnimationFrame(hoverRaf.current);
    hoverRaf.current = requestAnimationFrame(() => setHoverSlot(key));
  }

  function onSlotLeave() {
    if (hoverRaf.current) cancelAnimationFrame(hoverRaf.current);
    hoverRaf.current = requestAnimationFrame(() => setHoverSlot(null));
  }

  function chooseSlot(date: string, time: string) {
    if (!dragId) return;
    setDropTarget({ date, time });
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
      setDropTarget(null);
      load();
    } catch (e: any) {
      setDropError(e.message);
    } finally {
      setMoving(false);
    }
  }

  const dragging = dragId ? bookings.find((b) => b.id === dragId) : null;
  const isDragging = !!dragId;

  // Cancela drag com ESC
  useEffect(() => {
    if (!isDragging) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') endDrag(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDragging]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-sm text-zinc-500 mt-1">Dia, semana e mês — arraste para reagendar.</p>
        </div>
        <Button onClick={() => setCreating(true)} variant="primary" size="md"><Icon n="calendarPlus" size={16} /> Novo agendamento</Button>
      </div>

      {pendencyCount > 0 && (
        <div className="mb-3 border border-amber-200 bg-amber-50 px-3 py-2.5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-amber-900 inline-flex items-center gap-1.5"><Icon n="calendar" size={14} /> {pendencyCount} precisam de fechamento</span>
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {pendencies.slice(0, 4).map((b) => (
              <button key={b.id} onClick={() => setDetail(b)} className="text-xs font-medium bg-white border border-amber-200 text-amber-900 px-2.5 py-1 rounded-md">
                {formatDateBR(b.date)} {b.time} · {b.customerName}
              </button>
            ))}
            {pendencyCount > 4 && <span className="text-xs font-medium text-amber-900 self-center">+{pendencyCount - 4}</span>}
          </div>
        </div>
      )}

      <div className="bg-white border border-zinc-200 mb-3">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-zinc-100">
          <div className="flex items-center gap-1.5">
            <button onClick={() => move(-1)} aria-label="Anterior" className="w-8 h-8 rounded-md bg-zinc-50 border border-zinc-200 hover:bg-zinc-100 flex items-center justify-center"><Icon n="chevL" size={14} /></button>
            <button onClick={() => setFocus(todayISO())} className={`text-xs font-semibold px-3 py-1.5 rounded-md border ${focus === today ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white border-zinc-200'}`}>Hoje</button>
            <button onClick={() => move(1)} aria-label="Próximo" className="w-8 h-8 rounded-md bg-zinc-50 border border-zinc-200 hover:bg-zinc-100 flex items-center justify-center"><Icon n="chevR" size={14} /></button>
            <span className="text-sm font-semibold ml-1 capitalize">{focusLabel}</span>
          </div>
          <div className="flex gap-1 p-0.5 bg-zinc-100 rounded-md" role="tablist">
            {(['day', 'week', 'month'] as View[]).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => { endDrag(); setView(v); }} className={`text-xs font-semibold px-3 py-1 rounded ${view === v ? 'bg-white shadow-sm border border-zinc-200' : 'text-zinc-500'}`}>
                {v === 'day' ? 'Dia' : v === 'week' ? 'Semana' : 'Mês'}
              </button>
            ))}
          </div>
        </div>
        {isDragging && view === 'week' && (
          <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium text-amber-900">Arraste concluído — escolha um horário livre abaixo. <span className="font-normal text-amber-800">Clique no horário para confirmar.</span></span>
            <button onClick={endDrag} className="font-semibold text-amber-900 underline underline-offset-2">Cancelar</button>
          </div>
        )}
      </div>

      {!loaded ? <ListSkeleton rows={4} /> : (
        <div className="bg-white border border-zinc-200 overflow-hidden" ref={containerRef}>
          {view === 'month' ? (
            <div className="p-2">
              <div className="grid grid-cols-7 gap-px mb-1">
                {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => (
                  <span key={d} className="text-[10px] font-semibold tracking-wider uppercase text-zinc-400 text-center py-1">{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-px bg-zinc-200 border border-zinc-200">
                {Array.from({ length: 42 }, (_, i) => addDaysISO(range.from, i)).map((d) => {
                  const list = bookings.filter((b) => b.date === d && b.status !== 'cancelled');
                  const pend = list.filter((b) => needsClosure(b, bookingDuration(serviceOf(b.serviceId)), today, nowHM())).length;
                  const inMonth = d.slice(0, 7) === focus.slice(0, 7);
                  return (
                    <button key={d} onClick={() => { setFocus(d); setView('day'); }} className={`bg-white p-1.5 min-h-[72px] text-left hover:bg-zinc-50 ${d === today ? 'ring-1 ring-inset ring-emerald-500 bg-emerald-50/40' : ''} ${!inMonth ? 'bg-zinc-50 text-zinc-400' : ''}`}>
                      <span className="flex items-center justify-between">
                        <span className={`text-xs font-semibold ${d === today ? 'text-emerald-700' : inMonth ? 'text-zinc-700' : 'text-zinc-400'}`}>{Number(d.slice(8, 10))}</span>
                        {pend > 0 && <span className="text-[9px] font-bold bg-amber-500 text-white rounded-full px-1">{pend}</span>}
                      </span>
                      {list.length > 0 && (
                        <>
                          <span className="block text-[10px] font-medium text-zinc-600 mt-1">{list.length} · {list.slice(0, 2).map(b => b.time).join(', ')}</span>
                          <span className="flex gap-0.5 mt-1">{list.slice(0, 6).map((b) => <span key={b.id} className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[b.status]}`} />)}</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : view === 'day' ? (
            <div className="overflow-auto ws-scroll" style={{ maxHeight: 'calc(100vh - 260px)' }}>
              <div style={{ minWidth: dayWidth }}>
                <div className="sticky top-0 z-10 flex bg-white border-b border-zinc-200">
                  <div className="sticky left-0 z-20 bg-white shrink-0 border-r border-zinc-100" style={{ width: GUTTER_W, height: 36 }} />
                  {columns.map((col) => (
                    <div key={col.id} className="shrink-0 px-3 flex items-center gap-2 border-r border-zinc-100 last:border-r-0" style={{ minWidth: COL_MIN, flex: 1, height: 36 }}>
                      <span className="w-5 h-5 rounded-full bg-zinc-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{col.isPro ? col.label.slice(0, 1).toUpperCase() : '—'}</span>
                      <span className="text-xs font-semibold truncate">{col.label}</span>
                    </div>
                  ))}
                </div>
                <div className="flex">
                  <div className="sticky left-0 z-10 bg-white shrink-0 border-r border-zinc-200" style={{ width: GUTTER_W }}>
                    <div className="relative" style={{ height: gridHeight }}>
                      {Array.from({ length: grid.hours + 1 }, (_, i) => (
                        <span key={i} className="absolute -translate-y-1/2 right-2 text-[10px] font-medium text-zinc-400" style={{ top: i * PX_PER_HOUR }}>{minToTime(grid.start + i * 60)}</span>
                      ))}
                    </div>
                  </div>
                  {columns.map((col) => (
                    <div key={col.id} className="relative shrink-0 border-r border-zinc-100 last:border-r-0" style={{ minWidth: COL_MIN, flex: 1, height: gridHeight }}>
                      {Array.from({ length: grid.hours + 1 }, (_, i) => (
                        <span key={i} className="absolute left-0 right-0 border-t border-zinc-100" style={{ top: i * PX_PER_HOUR }} />
                      ))}
                      {focus === today && nowMin >= grid.start && nowMin <= grid.end && (
                        <span className="absolute left-0 right-0 border-t border-red-500 z-10" style={{ top: ((nowMin - grid.start) / 60) * PX_PER_HOUR }}><span className="absolute -left-1 -top-[4px] w-2 h-2 rounded-full bg-red-500" /></span>
                      )}
                      {bookings.filter((b) => b.date === focus).filter((b) => inColumn(b, col)).map((b) => {
                        const { top, height } = pos(b);
                        return (
                          <button key={b.id} onClick={() => setDetail(b)} className={`absolute left-1 right-1 rounded-md border-l-2 px-2 py-1 text-left overflow-hidden hover:opacity-90 ${STATUS_BLOCK[b.status]}`} style={{ top, height }}>
                            <span className="block text-[11px] font-semibold leading-tight truncate">{b.time} · {b.customerName}</span>
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
            <div className={`overflow-x-auto ws-scroll ${isDragging ? 'select-none' : ''}`}>
              <div className="flex" style={{ minWidth: 7 * 148 }}>
                {weekDays.map((d) => {
                  const dayBookings = bookings.filter((b) => b.date === d).sort((a, b) => (a.time < b.time ? -1 : 1));
                  const slots = dragSlots[d] || [];
                  return (
                    <div key={d} className={`shrink-0 border-r border-zinc-100 last:border-r-0 min-h-[340px] ${d === today ? 'bg-zinc-50/50' : ''}`} style={{ minWidth: 148, flex: 1 }}>
                      <div className="h-9 px-2 flex flex-col justify-center items-center border-b border-zinc-100 bg-white sticky top-0">
                        <span className="text-[10px] font-semibold tracking-wide uppercase text-zinc-400">{WEEKDAYS[weekdayOf(d)]}</span>
                        <span className={`text-xs font-semibold ${d === today ? 'text-emerald-700' : 'text-zinc-700'}`}>{d.slice(8, 10)}/{d.slice(5, 7)}</span>
                      </div>
                      <div className="p-1.5 space-y-1">
                        {dayBookings.map((b) => (
                          <button
                            key={b.id}
                            onClick={() => !isDragging && setDetail(b)}
                            onPointerDown={(e) => beginDrag(b, e)}
                            onPointerUp={() => { /* permite click se não arrastou */ }}
                            className={`block w-full rounded-md border-l-2 px-2 py-1.5 text-left touch-none select-none ${STATUS_BLOCK[b.status]} ${dragId === b.id ? 'ring-2 ring-zinc-900 ring-offset-1 opacity-90' : 'hover:opacity-90'} ${isDragging ? 'cursor-grabbing' : 'cursor-grab active:cursor-grabbing'}`}
                            title={isDragging ? 'Solte sobre um horário livre' : `${b.customerName} · arraste para reagendar`}
                          >
                            <span className="block text-[11px] font-semibold leading-tight truncate">{b.time} · {b.customerName}</span>
                            <span className="block text-[10px] leading-tight truncate opacity-80">{serviceName(b.serviceId)}{b.professionalId ? ` · ${proName(b.professionalId)}` : ''}</span>
                          </button>
                        ))}
                        {dayBookings.length === 0 && !isDragging && <p className="text-[11px] text-zinc-300 text-center pt-6">—</p>}

                        {isDragging && (
                          <div className="pt-2 mt-1 border-t border-dashed border-zinc-200">
                            <p className="text-[10px] font-semibold tracking-wide uppercase text-zinc-400 px-1 pb-1">horários livres</p>
                            {slotsLoading ? (
                              <p className="text-xs text-zinc-500 px-1 py-1 animate-pulse">Carregando horários…</p>
                            ) : slotsError ? (
                              <p className="text-xs font-medium text-red-600 px-1 py-1">{slotsError}</p>
                            ) : slots.length === 0 ? (
                              <p className="text-xs text-zinc-400 px-1 py-1">Nenhum horário disponível.</p>
                            ) : (
                              <div className="flex flex-wrap gap-1">
                                {slots.map((t) => {
                                  const key = `${d} ${t}`;
                                  const isHover = hoverSlot === key;
                                  const isChosen = dropTarget?.date === d && dropTarget?.time === t;
                                  return (
                                    <button
                                      key={t}
                                      onPointerEnter={() => onSlotHover(d, t)}
                                      onPointerLeave={onSlotLeave}
                                      onClick={() => chooseSlot(d, t)}
                                      className={`text-[11px] font-medium px-2 py-1 rounded border ${isChosen ? 'bg-zinc-900 text-white border-zinc-900' : isHover ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-300'}`}
                                    >
                                      {t}
                                    </button>
                                  );
                                })}
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

      {dropTarget && dragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => !moving && setDropTarget(null)} />
          <div className="relative w-full sm:max-w-sm bg-white rounded-lg border border-zinc-200 p-5 shadow-lg">
            <p className="font-semibold">Confirmar reagendamento</p>
            <p className="text-sm text-zinc-600 mt-1.5"><strong>{dragging.customerName}</strong> · {serviceName(dragging.serviceId)}</p>
            <p className="text-sm mt-1">{formatDateBR(dragging.date)} {dragging.time} → <strong>{formatDateBR(dropTarget.date)} {dropTarget.time}</strong></p>
            {['completed', 'no_show', 'cancelled'].includes(dragging.status) ? (
              <p className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2 mt-3">Este atendimento está {dragging.status === 'completed' ? 'concluído' : dragging.status === 'no_show' ? 'marcado como falta' : 'cancelado'}: o novo horário entra como <strong>novo agendamento pendente</strong>.</p>
            ) : (
              <p className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2 mt-3">O mesmo atendimento muda de horário e mantém “{dragging.status === 'pending' ? 'pendente' : 'confirmado'}”.</p>
            )}
            {dropError && <p className="text-sm font-medium text-red-600 mt-3">{dropError}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={confirmDrop} disabled={moving} className="flex-1 text-sm font-semibold bg-zinc-900 text-white py-2.5 rounded-md disabled:opacity-50 hover:bg-zinc-800">{moving ? 'Salvando…' : 'Confirmar'}</button>
              <button onClick={() => setDropTarget(null)} disabled={moving} className="text-sm font-semibold bg-white border border-zinc-200 px-4 py-2.5 rounded-md hover:bg-zinc-50">Cancelar</button>
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
