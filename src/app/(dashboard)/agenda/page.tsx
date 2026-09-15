'use client';
// ═══════════════════════════════════════════════════════════════
// AGENDA — clique abre detalhe, arraste move o atendimento
// ═══════════════════════════════════════════════════════════════
// REGRA DE INTERAÇÃO (obrigatória, implementada em lib/agenda-drag.ts):
//
//   pointerdown → guarda posição inicial → aguarda movimento
//     movimento ≤ 6px → CLIQUE simples → abre BookingDetailSheet
//     movimento > 6px → inicia DRAG (e só então busca os horários livres)
//
// DRAG-AND-DROP REAL:
//   clicar e segurar → arrastar → preview visual (ghost + célula destacada)
//   → soltar → validar no servidor → confirmar → salvar.
//
// Durante o arraste: nenhum request por pixel, nenhuma re-renderização da
// grade inteira (colunas são memoizadas), nenhum modal, nenhum change de
// status e nenhuma gravação. O destino é calculado por geometria e validado
// contra os horários livres buscados UMA única vez no início do movimento.
//
// REAGENDAMENTO (lib/booking-ops.rescheduleDecision, regra preservada):
//   pending/confirmed            → move o registro existente
//   completed/no_show/cancelled  → cria NOVO agendamento 'pending'
//   preservando previousId, rescheduleCount e histórico.
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { todayISO, addDaysISO, weekdayOf, formatDateBR, nowHM } from '@/lib/tz';
import { WEEKDAYS, WEEKDAYS_LONG, timeToMin, minToTime } from '@/lib/utils';
import type { Availability, Booking, BookingStatus, Professional, Service } from '@/lib/types';
import { ListSkeleton, Button } from '@/components/ui';
import { Icon } from '@/components/icons';
import { BookingDetailSheet } from '@/components/dashboard/BookingDetailSheet';
import { NewBookingSheet } from '@/components/dashboard/NewBookingSheet';
import { AccessDenied, PermissionNotice, useAreaLoad, useForbiddenNotice } from '@/components/dashboard/AccessNotice';
import { bookingDuration, needsClosure, rescheduleDecision } from '@/lib/booking-ops';
import { apiGet, apiSend } from '@/lib/api-client';
import { SLOT_STATE_MESSAGE, slotState } from '@/lib/slot-states';
import {
  IDLE_INTERACTION, blockHeight, blockTop, dragPreviewLabel, dragSlotUrls, dropConfirmQuestion,
  emptyDragSlots, geometryFromRect, layoutBlocks, planDrop, reduceInteraction, withOwnSlot,
  type CellAvailability, type DragSlots, type DropColumn, type GridGeometry, type InteractionState,
  type Point,
} from '@/lib/agenda-drag';

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
const HEADER_H = 36;
/** Tolerância para "encaixar" o ponteiro no horário livre mais próximo. */
const DROP_TOLERANCE_MIN = 75;

// ── Modelo de visualização (pré-calculado: a coluna memoizada não faz conta) ──
interface BlockVM {
  id: string;
  top: number;
  height: number;
  leftPct: number;
  widthPct: number;
  time: string;
  title: string;
  subtitle: string;
  cls: string;
  dragging: boolean;
  label: string;
}

interface ColumnVM {
  key: string;
  label: string;
  sub: string;
  date: string;
  professionalId: string;
  isProfessional: boolean;
  isToday: boolean;
  blocks: BlockVM[];
}

interface HighlightVM {
  top: number;
  height: number;
  label: string;
  tone: 'free' | 'busy' | 'loading';
}

interface HoverTarget {
  column: number;
  columnKey: string;
  date: string;
  time: string;
  minute: number;
  availability: CellAvailability;
}

// ── Coluna da grade (memoizada: o drag não re-renderiza a grade inteira) ──
const GridColumn = memo(function GridColumn({ column, variant, highlight, onPressStart, onPressMove, onPressEnd, onPressCancel, onBlockClick, gridHeight, hours }: {
  column: ColumnVM;
  variant: 'day' | 'week';
  highlight: HighlightVM | null;
  onPressStart: (id: string, e: React.PointerEvent) => void;
  onPressMove: (id: string, e: React.PointerEvent) => void;
  onPressEnd: (id: string, e: React.PointerEvent) => void;
  onPressCancel: () => void;
  onBlockClick: (id: string) => void;
  gridHeight: number;
  hours: number;
}) {
  return (
    <div className="relative shrink-0 border-r border-zinc-100 last:border-r-0" style={{ minWidth: COL_MIN, flex: 1, height: gridHeight }}>
      {Array.from({ length: hours + 1 }, (_, i) => (
        <span key={i} className="absolute left-0 right-0 border-t border-zinc-100" style={{ top: i * PX_PER_HOUR }} />
      ))}
      {column.isToday && (
        <span className="absolute inset-0 bg-emerald-50/25 pointer-events-none" aria-hidden="true" />
      )}

      {/* Célula destino destacada durante o arraste */}
      {highlight && (
        <div
          className={
            'pointer-events-none absolute z-20 rounded-md border-2 flex items-start justify-center overflow-hidden '
            + (highlight.tone === 'free'
              ? 'border-emerald-500 bg-emerald-100/70'
              : highlight.tone === 'loading'
                ? 'border-zinc-300 bg-zinc-100/70 border-dashed'
                : 'border-red-400 bg-red-100/70')
          }
          style={{ top: highlight.top, height: highlight.height, left: 2, right: 2 }}
          aria-hidden="true"
        >
          <span className={
            'text-[10px] font-bold px-1.5 py-0.5 rounded-b '
            + (highlight.tone === 'free' ? 'bg-emerald-600 text-white' : highlight.tone === 'loading' ? 'bg-zinc-500 text-white' : 'bg-red-600 text-white')
          }>
            {highlight.label}
          </span>
        </div>
      )}

      {column.blocks.map((b) => (
        <button
          key={b.id}
          type="button"
          aria-label={b.label}
          title={b.label}
          draggable={false}
          onPointerDown={(e) => onPressStart(b.id, e)}
          onPointerMove={(e) => onPressMove(b.id, e)}
          onPointerUp={(e) => onPressEnd(b.id, e)}
          onPointerCancel={onPressCancel}
          onClick={() => onBlockClick(b.id)}
          className={
            'absolute rounded-md border-l-2 px-2 py-1 text-left overflow-hidden touch-none select-none '
            + b.cls
            + (b.dragging ? ' opacity-40 ring-2 ring-zinc-900 ring-offset-1 cursor-grabbing' : ' hover:opacity-90 cursor-grab active:cursor-grabbing')
          }
          style={{
            top: b.top,
            height: b.height,
            left: `calc(${b.leftPct}% + 2px)`,
            width: `calc(${b.widthPct}% - 4px)`,
          }}
        >
          <span className="block text-[11px] font-semibold leading-tight truncate">{b.title}</span>
          {b.height > 30 && <span className="block text-[10px] leading-tight truncate opacity-80">{b.subtitle}</span>}
        </button>
      ))}
      {variant === 'week' && column.blocks.length === 0 && (
        <span className="absolute inset-x-0 top-3 text-center text-[11px] text-zinc-300 pointer-events-none">—</span>
      )}
    </div>
  );
});

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
  const [flash, setFlash] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);

  // ── Drag: estado mínimo (o movimento em si vive em refs, sem re-render) ──
  const [dragId, setDragId] = useState('');
  const [drag, setDrag] = useState<DragSlots>(emptyDragSlots);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [dropAsk, setDropAsk] = useState<{ booking: Booking; date: string; time: string; professionalId: string; columnLabel: string } | null>(null);
  const [dropError, setDropError] = useState('');
  const [saving, setSaving] = useState(false);

  const interactionRef = useRef<InteractionState>({ ...IDLE_INTERACTION });
  const dragSlotsRef = useRef<DragSlots>(emptyDragSlots());
  const hoverRef = useRef<HoverTarget | null>(null);
  const columnsRef = useRef<DropColumn[]>([]);
  const bookingsRef = useRef<Map<string, Booking>>(new Map());
  const durationRef = useRef(30);
  const geometryRef = useRef<{ g: GridGeometry; minX: number; minY: number } | null>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const dragSeq = useRef(0);
  const lastPointerUpRef = useRef<{ id: string; at: number }>({ id: '', at: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const colsRef = useRef<HTMLDivElement>(null);
  const [colWidth, setColWidth] = useState(COL_MIN);

  const { notice, dismiss } = useForbiddenNotice('Agenda');
  const { denied, report } = useAreaLoad('Agenda');

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

  const load = useCallback(async () => {
    if (!businessId) return;
    const [cat, bk] = await Promise.all([
      apiGet<any>(`/api/catalog/get?businessId=${businessId}`, { scope: 'area', area: 'Agenda' }),
      apiGet<{ bookings?: Booking[] }>(
        `/api/bookings?businessId=${businessId}&mode=manage&from=${range.from}&to=${range.to}&limit=1000`,
        { scope: 'area', area: 'Agenda' },
      ),
    ]);
    // Sem permissão (403): mostra o aviso amigável e PARA de carregar — a tela
    // não pode ficar em skeleton para sempre. A sessão continua intacta.
    if (!report(cat)) { setLoaded(true); return; }
    const d = cat.data || {};
    setServices(d.services || []);
    setPros(d.professionals || []);
    setRules(d.availability || []);
    setBookings(bk.ok ? (bk.data?.bookings || []) : []);
    setLoaded(true);
  }, [businessId, range.from, range.to, report]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { bookingsRef.current = new Map(bookings.map((b) => [b.id, b])); }, [bookings]);

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

  const serviceOf = useCallback((id: string) => services.find((s) => s.id === id), [services]);
  const serviceName = useCallback((id: string) => serviceOf(id)?.name || 'Serviço', [serviceOf]);
  const proName = useCallback((id: string) => pros.find((p) => p.id === id)?.name || '', [pros]);
  const durationOf = useCallback((b: Booking) => bookingDuration(serviceOf(b.serviceId), 30), [serviceOf]);

  const pendencies = useMemo(
    () => bookings
      .filter((b) => needsClosure(b, bookingDuration(serviceOf(b.serviceId)), today, nowHM()))
      .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1)),
    [bookings, serviceOf, today],
  );

  // ── Colunas: dia = profissionais; semana = dias ──
  const columns = useMemo<ColumnVM[]>(() => {
    const base: Array<{ key: string; label: string; sub: string; date: string; professionalId: string; isProfessional: boolean }> = [];
    if (view === 'week') {
      for (const d of weekDays) {
        base.push({
          key: d, label: WEEKDAYS[weekdayOf(d)], sub: `${d.slice(8, 10)}/${d.slice(5, 7)}`,
          date: d, professionalId: '', isProfessional: false,
        });
      }
    } else if (activePros.length === 0) {
      base.push({ key: '__all', label: 'Agenda', sub: '', date: focus, professionalId: '', isProfessional: false });
    } else {
      for (const p of activePros) {
        base.push({ key: p.id, label: p.name, sub: p.role || '', date: focus, professionalId: p.id, isProfessional: true });
      }
      if (bookings.some((b) => b.date === focus && !b.professionalId)) {
        base.push({ key: '__none', label: 'Sem profissional', sub: '', date: focus, professionalId: '', isProfessional: false });
      }
    }

    return base.map((c) => {
      const list = bookings
        .filter((b) => b.date === c.date)
        .filter((b) => (c.isProfessional ? b.professionalId === c.professionalId : c.key === '__none' ? !b.professionalId : true))
        .sort((a, b) => (a.time < b.time ? -1 : 1));
      const layout = layoutBlocks(
        list.map((b) => ({ id: b.id, minute: timeToMin(b.time), durationMin: durationOf(b) })),
        { startMinute: grid.start, pxPerHour: PX_PER_HOUR },
      );
      const byId = new Map(layout.map((l) => [l.id, l]));
      const blocks: BlockVM[] = list.map((b) => {
        const l = byId.get(b.id)!;
        const pro = b.professionalId ? proName(b.professionalId) : '';
        return {
          id: b.id,
          top: l.top,
          height: l.height,
          leftPct: l.leftPct,
          widthPct: l.widthPct,
          time: b.time,
          title: `${b.time} · ${b.customerName}`,
          subtitle: view === 'week' ? `${serviceName(b.serviceId)}${pro ? ` · ${pro}` : ''}` : serviceName(b.serviceId),
          cls: STATUS_BLOCK[b.status],
          dragging: dragId === b.id,
          label: `${b.customerName} · ${serviceName(b.serviceId)} · ${formatDateBR(b.date)} ${b.time}${pro ? ` · ${pro}` : ''} — clique para ver o detalhe ou arraste para reagendar`,
        };
      });
      return { ...c, isToday: c.date === today, blocks };
    });
  }, [view, weekDays, activePros, focus, bookings, grid.start, durationOf, proName, serviceName, dragId, today]);

  // Colunas usadas pelo cálculo de destino (mesma ordem da renderização).
  useEffect(() => {
    columnsRef.current = columns.map((c) => ({
      key: c.key, label: c.label, date: c.date, professionalId: c.professionalId, isProfessional: c.isProfessional,
    }));
  }, [columns]);

  const gridHeight = Math.max(460, Math.round((grid.span / 60) * PX_PER_HOUR));
  const dayWidth = GUTTER_W + columns.length * COL_MIN;

  // ── Geometria (medida, não por pixel de evento) ──
  useLayoutEffect(() => {
    const measure = () => {
      const el = colsRef.current;
      if (!el) return;
      const w = el.getBoundingClientRect().width / Math.max(1, columns.length);
      setColWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (colsRef.current && ro) ro.observe(colsRef.current);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [columns.length, view, loaded]);

  // ── Altura útil da grade (auditoria §23 — só apresentação) ──
  // O `calc(100vh - 280px)` fixo criava uma faixa de rolagem pequena demais
  // em telas grandes e espremida nas pequenas. Medimos a posição REAL do
  // container e usamos o resto da viewport (com piso confortável). As regras
  // de agenda não são tocadas: isto é apenas o tamanho da área de desenho.
  const [gridMaxH, setGridMaxH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = scrollRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const h = window.innerHeight - top - (window.innerWidth >= 1024 ? 28 : 16);
      setGridMaxH(Math.max(320, Math.round(h)));
    };
    fit();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (typeof document !== 'undefined' && ro) ro.observe(document.body);
    window.addEventListener('resize', fit);
    return () => { ro?.disconnect(); window.removeEventListener('resize', fit); };
  }, [loaded, view, pendencies.length, notice?.title]);

  const readGeometry = useCallback((): { g: GridGeometry; minX: number; minY: number } | null => {
    const scroll = scrollRef.current;
    const cols = colsRef.current;
    if (!scroll || !cols || colWidth <= 0) return null;
    const scrollRect = scroll.getBoundingClientRect();
    const colsRect = cols.getBoundingClientRect();
    const g = geometryFromRect(
      { left: colsRect.left, top: colsRect.top },
      {
        gutterWidth: 0, scrollLeft: 0, scrollTop: 0,
        columnWidth: colWidth, columnCount: columns.length,
        startMinute: grid.start, endMinute: grid.end, pxPerHour: PX_PER_HOUR,
      },
    );
    // O gutter (horas) e o cabeçalho são fixos: nada de destino atrás deles.
    return { g, minX: scrollRect.left + GUTTER_W, minY: scrollRect.top + HEADER_H };
  }, [colWidth, columns.length, grid.start, grid.end]);

  useEffect(() => { geometryRef.current = readGeometry(); }, [readGeometry]);

  // ── Busca de horários: UMA vez por drag (nunca por pixel) ──
  const loadDragSlots = useCallback((b: Booking, dates: string[]) => {
    const seq = ++dragSeq.current;
    const initial: DragSlots = { loading: true, error: '', slots: {}, byPro: {} };
    dragSlotsRef.current = initial;
    setDrag(initial);
    const own = { date: b.date, time: b.time };
    Promise.all(dragSlotUrls(businessId, b.serviceId, dates).map(async (url, i) => {
      try {
        const r = await fetch(url);
        if (!r.ok) return [dates[i], null] as const;
        const j = await r.json();
        return [dates[i], j] as const;
      } catch {
        return [dates[i], null] as const;
      }
    })).then((entries) => {
      if (seq !== dragSeq.current) return;
      const failed = entries.filter(([, j]) => !j).length;
      const next: DragSlots = {
        loading: false,
        error: failed === entries.length ? SLOT_STATE_MESSAGE.error : '',
        slots: {},
        byPro: {},
      };
      for (const [d, j] of entries) {
        if (!j) continue;
        next.slots[d] = withOwnSlot(d, Array.isArray(j.slots) ? [...j.slots] : [], own);
        const byPro = (j.byPro || {}) as Record<string, string[]>;
        next.byPro[d] = {};
        for (const pid of Object.keys(byPro)) {
          next.byPro[d][pid] = withOwnSlot(
            d, Array.isArray(byPro[pid]) ? [...byPro[pid]] : [],
            pid === b.professionalId ? own : null,
          );
        }
        if (!b.professionalId) next.byPro[d][''] = next.slots[d];
      }
      dragSlotsRef.current = next;
      setDrag(next);
    });
  }, [businessId]);

  const endDrag = useCallback(() => {
    dragSeq.current++;
    interactionRef.current = { ...IDLE_INTERACTION };
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setDragId('');
    const empty = emptyDragSlots();
    dragSlotsRef.current = empty;
    setDrag(empty);
    hoverRef.current = null;
    setHover(null);
    if (ghostRef.current) ghostRef.current.style.display = 'none';
  }, []);

  const visibleDates = useCallback(
    () => (view === 'week' ? weekDays : [focus]),
    [view, weekDays, focus],
  );

  // ── Preview: ghost segue o ponteiro (DOM direto) e a célula é recalculada
  //    no máximo uma vez por frame, e só atualiza estado quando muda. ──
  const positionGhost = useCallback((at: Point) => {
    const el = ghostRef.current;
    if (!el) return;
    el.style.display = 'block';
    el.style.transform = `translate3d(${Math.round(at.x + 14)}px, ${Math.round(at.y + 14)}px, 0)`;
  }, []);

  const computeHover = useCallback((at: Point) => {
    const geo = geometryRef.current || readGeometry();
    if (!geo) return;
    geometryRef.current = geo;
    const b = bookingsRef.current.get(interactionRef.current.id);
    const point: Point = { x: Math.max(at.x, geo.minX), y: Math.max(at.y, geo.minY) };
    const plan = planDrop({
      point,
      geometry: geo.g,
      columns: columnsRef.current,
      drag: dragSlotsRef.current,
      durationMin: durationRef.current,
      toleranceMin: DROP_TOLERANCE_MIN,
      own: b ? { date: b.date, time: b.time } : null,
    });
    const col = columnsRef.current[plan.column];
    const next: HoverTarget | null = plan.target
      ? {
        column: plan.column, columnKey: plan.target.columnKey, date: plan.target.date,
        time: plan.target.time, minute: plan.minute, availability: plan.availability,
      }
      : col
        ? {
          column: plan.column, columnKey: col.key, date: col.date, time: '',
          minute: Math.max(0, plan.minute), availability: plan.availability,
        }
        : null;
    const prev = hoverRef.current;
    if (prev && next && prev.column === next.column && prev.time === next.time && prev.availability === next.availability) return;
    if (!prev && !next) return;
    hoverRef.current = next;
    setHover(next);
  }, [readGeometry]);

  const scheduleHover = useCallback((at: Point) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      computeHover(at);
    });
  }, [computeHover]);

  // ── Handlers de ponteiro (estáveis: as colunas memoizadas não remontam) ──
  const onPressStart = useCallback((id: string, e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const booking = bookingsRef.current.get(id);
    if (!booking) return;
    durationRef.current = bookingDuration(services.find((s) => s.id === booking.serviceId), 30);
    geometryRef.current = readGeometry();
    interactionRef.current = reduceInteraction(interactionRef.current, {
      type: 'down', id, at: { x: e.clientX, y: e.clientY },
    }).state;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
  }, [readGeometry, services]);

  const onPressMove = useCallback((id: string, e: React.PointerEvent) => {
    const state = interactionRef.current;
    if (state.phase === 'idle' || state.id !== id) return;
    const at: Point = { x: e.clientX, y: e.clientY };
    const wasDragging = state.phase === 'dragging';
    const step = reduceInteraction(state, { type: 'move', at });
    interactionRef.current = step.state;

    if (step.effect === 'start-drag') {
      // Threshold ultrapassado: SÓ AGORA o drag começa (e só agora a rede é usada).
      const booking = bookingsRef.current.get(id);
      setDragId(id);
      if (booking) loadDragSlots(booking, visibleDates());
    }
    if (step.state.phase !== 'dragging') return;
    positionGhost(at);
    if (!wasDragging) computeHover(at);
    else scheduleHover(at);
  }, [computeHover, loadDragSlots, positionGhost, scheduleHover, visibleDates]);

  const finishDrop = useCallback((id: string) => {
    const booking = bookingsRef.current.get(id);
    const target = hoverRef.current;
    endDrag();
    if (!booking) return;
    if (!target || !target.time) {
      setFlash({
        tone: 'warn',
        text: target && target.availability === 'loading'
          ? 'Ainda carregando os horários livres. Tente soltar novamente em instantes.'
          : 'Nenhum horário livre perto de onde você soltou. Escolha outro ponto da grade.',
      });
      window.setTimeout(() => setFlash(null), 4000);
      return;
    }
    if (target.availability !== 'free') {
      setFlash({ tone: 'error', text: `${target.time} em ${formatDateBR(target.date)} não está disponível para este atendimento.` });
      window.setTimeout(() => setFlash(null), 4000);
      return;
    }
    // Nada é salvo em silêncio: o drop abre a confirmação explícita.
    // A coluna de um profissional envia o id dela; colunas de dia (semana)
    // deixam o servidor resolver quem atende (política "equilibrar equipe").
    const col = columnsRef.current[target.column];
    setDropError('');
    setDropAsk({
      booking,
      date: target.date,
      time: target.time,
      professionalId: col?.isProfessional ? col.professionalId : '',
      columnLabel: col?.label || '',
    });
  }, [endDrag]);

  const onPressEnd = useCallback((id: string, e: React.PointerEvent) => {
    const step = reduceInteraction(interactionRef.current, { type: 'up', at: { x: e.clientX, y: e.clientY } });
    interactionRef.current = step.state;
    lastPointerUpRef.current = { id, at: Date.now() };
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    if (step.effect === 'open-detail') {
      // CLIQUE SIMPLES → detalhe. Nunca inicia reagendamento.
      const booking = bookingsRef.current.get(id);
      if (booking) setDetail(booking);
      return;
    }
    if (step.effect === 'drop') finishDrop(id);
  }, [finishDrop]);

  const onPressCancel = useCallback(() => {
    interactionRef.current = { ...IDLE_INTERACTION };
    endDrag();
  }, [endDrag]);

  const onBlockClick = useCallback((id: string) => {
    // O clique que vem logo depois do pointerup já foi tratado (detalhe ou
    // drop). Aqui só interessa o clique de TECLADO (Enter/Espaço), que não
    // gera eventos de ponteiro.
    const last = lastPointerUpRef.current;
    if (last.id === id && Date.now() - last.at < 700) return;
    const booking = bookingsRef.current.get(id);
    if (booking) setDetail(booking);
  }, []);

  // ESC cancela o arraste sem salvar nada.
  useEffect(() => {
    if (!dragId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') endDrag(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dragId, endDrag]);

  // Cancela o drag se a view mudar no meio do movimento.
  useEffect(() => { endDrag(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [view, focus]);

  async function confirmDrop() {
    if (!dropAsk) return;
    const { booking, date, time } = dropAsk;
    const professionalId = dropAsk.professionalId;
    setSaving(true);
    setDropError('');
    // O servidor revalida tudo (disponibilidade, profissional, conflito,
    // duração, buffer, horizonte) e aplica rescheduleDecision.
    const res = await apiSend<{ ok?: boolean; created?: boolean; moved?: boolean; reason?: string }>(
      '/api/bookings',
      'PATCH',
      { businessId, id: booking.id, date, time, professionalId: professionalId || undefined },
      { scope: 'action', area: 'Agenda' },
    );
    setSaving(false);
    if (!res.ok) {
      setDropError(res.message || 'Não foi possível reagendar.');
      return;
    }
    const decision = rescheduleDecision(booking.status);
    setDropAsk(null);
    setFlash({
      tone: 'ok',
      text: decision.kind === 'recreate'
        ? `Novo atendimento criado para ${formatDateBR(date)} às ${time} (aguardando confirmação). O registro anterior continua no histórico.`
        : `Atendimento movido para ${formatDateBR(date)} às ${time}.`,
    });
    window.setTimeout(() => setFlash(null), 5000);
    load();
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
    : view === 'week'
      ? `${formatDateBR(weekDays[0])} — ${formatDateBR(weekDays[6])}`
      : `${WEEKDAYS_LONG[weekdayOf(focus)]}, ${formatDateBR(focus)}`;

  const dragging = dragId ? bookingsRef.current.get(dragId) || bookings.find((b) => b.id === dragId) || null : null;
  const isDragging = !!dragId;

  // Destaque da célula destino (por coluna).
  const highlightFor = useCallback((index: number): HighlightVM | null => {
    if (!isDragging || !hover || hover.column !== index) return null;
    const duration = durationRef.current;
    if (!hover.time) {
      const minute = Math.max(grid.start, Math.min(grid.end - duration, hover.minute));
      return {
        top: blockTop(minute, grid.start, PX_PER_HOUR),
        height: blockHeight(duration, PX_PER_HOUR),
        label: hover.availability === 'loading' ? 'Carregando horários...' : 'Indisponível',
        tone: hover.availability === 'loading' ? 'loading' : 'busy',
      };
    }
    return {
      top: blockTop(hover.time, grid.start, PX_PER_HOUR),
      height: blockHeight(duration, PX_PER_HOUR),
      label: hover.availability === 'free' ? hover.time : 'Indisponível',
      tone: hover.availability === 'free' ? 'free' : 'busy',
    };
  }, [isDragging, hover, grid.start, grid.end]);

  const ghostLabel = hover?.time
    ? dragPreviewLabel(hover.date, hover.time)
    : drag.loading
      ? SLOT_STATE_MESSAGE.loading
      : drag.error
        ? SLOT_STATE_MESSAGE.error
        : 'Sem horário livre aqui';
  const slotsState = slotState({ loading: drag.loading, error: drag.error || null, slots: hover?.time ? [hover.time] : [], idle: !isDragging });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Agenda</h1>
          <p className="text-sm text-zinc-500 mt-1">Clique para ver o detalhe · clique e arraste para mudar o horário.</p>
        </div>
        <Button onClick={() => setCreating(true)} variant="primary" size="md"><Icon n="calendarPlus" size={16} /> Novo agendamento</Button>
      </div>

      <PermissionNotice message={notice?.title} hint={notice?.hint} onDismiss={dismiss} />

      {flash && (
        <div
          role="status"
          aria-live="polite"
          className={
            'mb-3 border px-3 py-2.5 text-xs font-medium flex items-start gap-2 '
            + (flash.tone === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : flash.tone === 'warn'
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-red-200 bg-red-50 text-red-700')
          }
        >
          <Icon n={flash.tone === 'ok' ? 'checkCircle' : 'alert'} size={14} className="mt-0.5" />
          <span>{flash.text}</span>
          <button onClick={() => setFlash(null)} className="ml-auto underline underline-offset-2 shrink-0">Fechar</button>
        </div>
      )}

      {pendencies.length > 0 && (
        <div className="mb-3 border border-amber-200 bg-amber-50 px-3 py-2.5 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-amber-900 inline-flex items-center gap-1.5"><Icon n="calendar" size={14} /> {pendencies.length} precisam de fechamento</span>
          <div className="flex flex-wrap gap-1.5 ml-auto">
            {pendencies.slice(0, 4).map((b) => (
              <button key={b.id} onClick={() => setDetail(b)} className="text-xs font-medium bg-white border border-amber-200 text-amber-900 px-2.5 py-1 rounded-md">
                {formatDateBR(b.date)} {b.time} · {b.customerName}
              </button>
            ))}
            {pendencies.length > 4 && <span className="text-xs font-medium text-amber-900 self-center">+{pendencies.length - 4}</span>}
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
        {isDragging && view !== 'month' && (
          <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-amber-900 inline-flex items-center gap-2">
              <Icon n="calendar" size={13} />
              Solte no novo horário
              <span className={
                'font-semibold px-1.5 py-0.5 rounded border '
                + (slotsState === 'loading'
                  ? 'bg-white border-amber-300 text-amber-800'
                  : slotsState === 'error'
                    ? 'bg-white border-red-300 text-red-700'
                    : 'bg-white border-amber-300 text-amber-800')
              }>
                {hover?.time
                  ? dragPreviewLabel(hover.date, hover.time)
                  : SLOT_STATE_MESSAGE[slotsState] || 'Aponte para um horário livre'}
              </span>
            </span>
            <button onClick={endDrag} className="font-semibold text-amber-900 underline underline-offset-2">Cancelar arraste</button>
          </div>
        )}
      </div>

      {denied ? <AccessDenied area="Agenda" /> : !loaded ? <ListSkeleton rows={4} /> : view === 'month' ? (
        <div className="bg-white border border-zinc-200 overflow-hidden p-2">
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
                      <span className="block text-[10px] font-medium text-zinc-600 mt-1">{list.length} · {list.slice(0, 2).map((b) => b.time).join(', ')}</span>
                      <span className="flex gap-0.5 mt-1">{list.slice(0, 6).map((b) => <span key={b.id} className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[b.status]}`} />)}</span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-white border border-zinc-200 overflow-hidden">
          <div ref={scrollRef} className={`overflow-auto ws-scroll ${isDragging ? 'select-none' : ''}`}
            style={{ maxHeight: gridMaxH ? `${gridMaxH}px` : 'calc(100dvh - 280px)' }}>
            <div className="flex" style={{ minWidth: dayWidth }}>
              {/* Gutter de horas (fixo na horizontal) */}
              <div className="sticky left-0 z-30 bg-white shrink-0 border-r border-zinc-200" style={{ width: GUTTER_W }}>
                <div style={{ height: HEADER_H }} className="border-b border-zinc-200" />
                <div className="relative" style={{ height: gridHeight }}>
                  {Array.from({ length: grid.hours + 1 }, (_, i) => (
                    <span key={i} className="absolute -translate-y-1/2 right-2 text-[10px] font-medium text-zinc-400" style={{ top: i * PX_PER_HOUR }}>{minToTime(grid.start + i * 60)}</span>
                  ))}
                </div>
              </div>

              <div className="flex-1 min-w-0">
                {/* Cabeçalho das colunas (fixo na vertical) */}
                <div className="sticky top-0 z-20 flex bg-white border-b border-zinc-200">
                  {columns.map((c) => (
                    <div key={c.key} className="shrink-0 px-3 flex items-center gap-2 border-r border-zinc-100 last:border-r-0" style={{ minWidth: COL_MIN, flex: 1, height: HEADER_H }}>
                      {view === 'day' && (
                        <span className="w-5 h-5 rounded-full bg-zinc-900 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                          {c.isProfessional ? c.label.slice(0, 1).toUpperCase() : '—'}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className={`block text-xs font-semibold truncate ${c.isToday ? 'text-emerald-700' : 'text-zinc-800'}`}>{c.label}</span>
                        {c.sub && <span className="block text-[10px] text-zinc-400 truncate">{c.sub}</span>}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Corpo da grade */}
                <div className="flex relative" ref={colsRef}>
                  {view === 'day' && focus === today && nowMin >= grid.start && nowMin <= grid.end && (
                    <span className="absolute left-0 right-0 border-t border-red-500 z-10 pointer-events-none" style={{ top: ((nowMin - grid.start) / 60) * PX_PER_HOUR }}>
                      <span className="absolute -left-1 -top-[4px] w-2 h-2 rounded-full bg-red-500" />
                    </span>
                  )}
                  {columns.map((c, i) => (
                    <GridColumn
                      key={c.key}
                      column={c}
                      variant={view === 'week' ? 'week' : 'day'}
                      highlight={highlightFor(i)}
                      gridHeight={gridHeight}
                      hours={grid.hours}
                      onPressStart={onPressStart}
                      onPressMove={onPressMove}
                      onPressEnd={onPressEnd}
                      onPressCancel={onPressCancel}
                      onBlockClick={onBlockClick}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Ghost do atendimento sendo arrastado (posição via DOM: zero re-render) */}
      <div
        ref={ghostRef}
        className="fixed top-0 left-0 z-[70] pointer-events-none hidden"
        aria-hidden="true"
        style={{ willChange: 'transform' }}
      >
        <div className="bg-zinc-900 text-white rounded-md shadow-lg px-2.5 py-1.5 max-w-[220px]">
          <p className="text-[11px] font-semibold leading-tight truncate">
            {dragging ? `${dragging.customerName} · ${serviceName(dragging.serviceId)}` : ''}
          </p>
          <p className={
            'text-[11px] leading-tight mt-0.5 '
            + (hover?.availability === 'free' ? 'text-emerald-300' : hover?.time ? 'text-red-300' : 'text-zinc-300')
          }>
            {isDragging ? ghostLabel : ''}
          </p>
        </div>
      </div>

      {/* Confirmação explícita do drop — nada acontece em silêncio */}
      {dropAsk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Confirmar reagendamento">
          <div className="absolute inset-0 bg-black/40" onClick={() => !saving && setDropAsk(null)} />
          <div className="relative w-full sm:max-w-sm bg-white rounded-lg border border-zinc-200 p-5 shadow-lg">
            <p className="font-semibold">{dropConfirmQuestion(dropAsk.date, dropAsk.time)}</p>
            <p className="text-sm text-zinc-600 mt-1.5"><strong>{dropAsk.booking.customerName}</strong> · {serviceName(dropAsk.booking.serviceId)}</p>
            <p className="text-sm mt-1">
              {formatDateBR(dropAsk.booking.date)} {dropAsk.booking.time} → <strong>{formatDateBR(dropAsk.date)} {dropAsk.time}</strong>
            </p>
            {(() => {
              const decision = rescheduleDecision(dropAsk.booking.status);
              return decision.kind === 'recreate' ? (
                <p className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2 mt-3">
                  Este atendimento está {dropAsk.booking.status === 'completed' ? 'concluído' : dropAsk.booking.status === 'no_show' ? 'marcado como falta' : 'cancelado'}: o novo horário entra como <strong>novo agendamento pendente</strong>, preservando o histórico.
                </p>
              ) : (
                <p className="text-xs text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-md px-3 py-2 mt-3">
                  O mesmo atendimento muda de horário e mantém “{dropAsk.booking.status === 'pending' ? 'pendente' : 'confirmado'}”.
                </p>
              );
            })()}
            {dropError && <p className="text-sm font-medium text-red-600 mt-3" role="alert">{dropError}</p>}
            <div className="flex gap-2 mt-4">
              <button onClick={confirmDrop} disabled={saving} className="flex-1 text-sm font-semibold bg-zinc-900 text-white py-2.5 rounded-md disabled:opacity-50 hover:bg-zinc-800">{saving ? 'Salvando…' : 'Confirmar'}</button>
              <button onClick={() => setDropAsk(null)} disabled={saving} className="text-sm font-semibold bg-white border border-zinc-200 px-4 py-2.5 rounded-md hover:bg-zinc-50">Cancelar</button>
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
