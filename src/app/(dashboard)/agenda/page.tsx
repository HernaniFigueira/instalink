'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { todayISO, addDaysISO, weekdayOf, formatDateBR, nowHM } from '@/lib/tz';
import { WEEKDAYS, WEEKDAYS_LONG, timeToMin, minToTime } from '@/lib/utils';
import type { Availability, Booking, BookingStatus, Professional, Service } from '@/lib/types';
import { ListSkeleton, Button } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BookingDetailSheet } from '@/components/dashboard/BookingDetailSheet';
import { NewBookingSheet } from '@/components/dashboard/NewBookingSheet';

type View = 'day' | 'week';

const STATUS_BLOCK: Record<BookingStatus, string> = {
  pending: 'border-amber-400 bg-amber-50 text-amber-900',
  confirmed: 'border-emerald-400 bg-emerald-50 text-emerald-900',
  completed: 'border-blue-400 bg-blue-50 text-blue-900',
  cancelled: 'border-zinc-300 bg-zinc-50 text-zinc-400',
  no_show: 'border-red-400 bg-red-50 text-red-700',
};

const PX_PER_HOUR = 52;
const GUTTER_W = 56; // coluna de horários (fixa/sticky à esquerda)
const COL_MIN = 150; // largura mínima de cada coluna de profissional

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

  const load = useCallback(() => {
    if (!businessId) return;
    const from = addDaysISO(focus, -21);
    const to = addDaysISO(focus, 28);
    fetch(`/api/bookings?businessId=${businessId}&mode=manage&from=${from}&to=${to}&limit=500`)
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
  }, [businessId, focus]);

  useEffect(() => { load(); }, [load]);

  const activePros = useMemo(() => pros.filter((p) => p.active !== false), [pros]);
  const horizonDays = 60;

  // Limites da grade a partir dos horários cadastrados (fallback 08–20h).
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
    return addDaysISO(focus, -((dow + 6) % 7)); // semana começa na segunda
  }, [focus]);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)), [weekStart]);

  // Colunas: profissionais ativos (ou uma coluna única quando não há equipe).
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
  const today = todayISO();
  const nowMin = timeToMin(nowHM());

  function pos(b: Booking) {
    const s = timeToMin(b.time);
    const dur = serviceOf(b.serviceId)?.durationMin || 30;
    const top = Math.max(0, (s - grid.start) / 60) * PX_PER_HOUR;
    const height = Math.max(22, ((Math.min(grid.end, s + dur) - Math.max(grid.start, s)) / 60) * PX_PER_HOUR);
    return { top, height };
  }

  function move(dir: -1 | 1) {
    setFocus((f) => addDaysISO(f, view === 'week' ? dir * 7 : dir));
  }

  const focusLabel = `${WEEKDAYS_LONG[weekdayOf(focus)]}, ${formatDateBR(focus)}`;
  const gridHeight = Math.max(460, Math.round((grid.span / 60) * PX_PER_HOUR));
  const dayWidth = GUTTER_W + columns.length * COL_MIN;
  const inColumn = (b: Booking, col: { id: string; isPro: boolean }) => {
    if (col.isPro) return b.professionalId === col.id;
    if (col.id === '__none') return !b.professionalId; // órfãos/legados
    return true; // coluna única (sem equipe): mostra tudo
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Agenda</h1>
          <p className="text-sm text-zinc-500 mt-1">Quem atende, quando e qual cliente — em um calendário por profissional.</p>
        </div>
        <Button onClick={() => setCreating(true)}><Icon n="calendarPlus" size={16} /> Novo agendamento</Button>
      </div>

      <div className="bg-white border border-zinc-200 rounded-2xl mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <button onClick={() => move(-1)} aria-label="Anterior"
              className="w-9 h-9 rounded-lg bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center"><Icon n="chevL" size={16} /></button>
            <button onClick={() => setFocus(todayISO())}
              className={`text-xs font-bold px-3 py-2 rounded-lg ${focus === today ? 'bg-zinc-900 text-white' : 'bg-zinc-100 hover:bg-zinc-200'}`}>Hoje</button>
            <button onClick={() => move(1)} aria-label="Próximo"
              className="w-9 h-9 rounded-lg bg-zinc-100 hover:bg-zinc-200 flex items-center justify-center"><Icon n="chevR" size={16} /></button>
            <span className="text-sm font-bold ml-1">{focusLabel}</span>
          </div>
          <div className="flex gap-1 p-1 bg-zinc-100 rounded-xl" role="tablist" aria-label="Tipo de visão">
            <button role="tab" aria-selected={view === 'day'} onClick={() => setView('day')}
              className={`text-xs font-bold px-3.5 py-1.5 rounded-lg ${view === 'day' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500'}`}>Dia</button>
            <button role="tab" aria-selected={view === 'week'} onClick={() => setView('week')}
              className={`text-xs font-bold px-3.5 py-1.5 rounded-lg ${view === 'week' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500'}`}>Semana</button>
          </div>
        </div>
      </div>

      {!loaded ? <ListSkeleton rows={4} /> : (
        <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
          {view === 'day' ? (
            /* ── VISÃO DIA (desktop e mobile: MESMA grade visual) ──
               Grade vertical com coluna de horários fixa à esquerda e
               profissionais como colunas roláveis horizontalmente. */
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 240px)' }}>
              <div style={{ minWidth: dayWidth }}>
                {/* Cabeçalho das colunas (sticky topo) */}
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

                {/* Corpo: coluna de horários (sticky esquerda) + colunas */}
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
            /* ── VISÃO SEMANA ── dias em colunas; rolagem horizontal no
               espaço pequeno (cada dia com largura mínima legível). */
            <div className="overflow-x-auto">
              <div className="flex" style={{ minWidth: 7 * 150 }}>
                {weekDays.map((d) => {
                  const dayBookings = bookings.filter((b) => b.date === d).sort((a, b) => (a.time < b.time ? 1 : -1));
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
                            className={`block w-full rounded-lg border-l-4 px-2 py-1.5 text-left ${STATUS_BLOCK[b.status]}`}>
                            <span className="block text-[11px] font-extrabold leading-tight">{b.time} · {b.customerName}</span>
                            <span className="block text-[10px] leading-tight truncate opacity-80">{serviceName(b.serviceId)}{b.professionalId ? ` · ${proName(b.professionalId)}` : ''}</span>
                          </button>
                        ))}
                        {dayBookings.length === 0 && <p className="text-[10px] text-zinc-300 text-center pt-4">—</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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
