import { useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { blockHeight, exceedsDragThreshold, layoutBlocks } from '@/lib/agenda-drag';
import { timeToMin } from '@/lib/utils';
import {
  instantToLocalDateTime,
  localDateTimeToInstant,
  minutesBetween,
  resizeToDuration,
  snapMinutes,
  type AppointmentWindow,
  type CalendarView,
} from '../domain/temporal-contract';
import { DEMO_TIME_ZONE, PROFESSIONALS, type SpikeEvent } from '../domain/fixtures';
import { SpikeEventCard } from '../components/SpikeEventCard';
import type { CalendarAdapterProps } from './types';

const START_MINUTE = 5 * 60;
const END_MINUTE = 23 * 60;
const PX_PER_HOUR = 78;
const COLUMN_MIN_WIDTH = 172;
const HEADER_HEIGHT = 50;
const DRAG_THRESHOLD = 6;

type Column = { key: string; title: string; subtitle: string; date: string; professionalId?: string };
type PointerOrigin = {
  event: SpikeEvent;
  x: number;
  y: number;
  pointerId: number;
  action: 'move' | 'resize';
};

function dateLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const local = new Date(Date.UTC(year!, month! - 1, day!, 12));
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', timeZone: DEMO_TIME_ZONE }).format(local);
}

function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + amount, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function minutesFromPointer(clientY: number, rectTop: number): number {
  return START_MINUTE + ((clientY - rectTop) / PX_PER_HOUR) * 60;
}

function clockFromMinute(value: number, mode: 'floor' | 'ceil' | 'nearest'): string {
  const snapped = Math.max(0, Math.min(1_439, snapMinutes(value, 5, mode)));
  return `${String(Math.floor(snapped / 60)).padStart(2, '0')}:${String(snapped % 60).padStart(2, '0')}`;
}

function dayColumns(focusDate: string, view: CalendarView, professionalFilter: string): Column[] {
  if (view === 'day') {
    const pros = professionalFilter
      ? PROFESSIONALS.filter((pro) => pro.id === professionalFilter)
      : PROFESSIONALS;
    return pros.map((pro) => ({
      key: `${focusDate}:${pro.id}`,
      title: pro.name,
      subtitle: pro.role,
      date: focusDate,
      professionalId: pro.id,
    }));
  }
  const start = view === 'week' ? focusDate : focusDate;
  return Array.from({ length: view === 'week' ? 7 : 1 }, (_, index) => {
    const date = view === 'week' ? addDays(start, index) : focusDate;
    return { key: date, title: dateLabel(date), subtitle: date, date };
  });
}

export default function ExistingGridAdapter(props: CalendarAdapterProps) {
  const { events, view, focusDate, professionalFilter, pendingEventId, onSelectEvent, onSelectRange, onMutation, onNotice } = props;
  const [pointerOrigin, setPointerOrigin] = useState<PointerOrigin | null>(null);
  const [pointerDelta, setPointerDelta] = useState(0);
  const [selectionOrigin, setSelectionOrigin] = useState<{ x: number; y: number; date: string; professionalId?: string; rectTop: number; pointerId: number } | null>(null);
  const [selectionEndY, setSelectionEndY] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);
  const columns = useMemo(() => dayColumns(focusDate, view, professionalFilter), [focusDate, view, professionalFilter]);
  const visibleEvents = useMemo(() => events.filter((item) => {
    if (professionalFilter && item.professionalId !== professionalFilter) return false;
    const { date } = instantToLocalDateTime(item.startAt, item.timeZone);
    return view === 'day' ? date === focusDate : view === 'week'
      ? date >= focusDate && date <= addDays(focusDate, 6)
      : date === focusDate;
  }), [events, focusDate, professionalFilter, view]);

  function columnsForEvent(item: SpikeEvent): number {
    const localDate = instantToLocalDateTime(item.startAt, item.timeZone).date;
    return columns.findIndex((column) => view === 'day'
      ? column.professionalId === item.professionalId
      : column.date === localDate);
  }

  function startEventPointer(item: SpikeEvent, action: 'move' | 'resize', e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || pendingEventId === item.id || !['pending', 'confirmed'].includes(item.status)) return;
    suppressClickRef.current = false;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setPointerOrigin({ event: item, x: e.clientX, y: e.clientY, pointerId: e.pointerId, action });
    setPointerDelta(0);
  }

  function moveEventPointer(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointerOrigin || e.pointerId !== pointerOrigin.pointerId) return;
    setPointerDelta(e.clientY - pointerOrigin.y);
  }

  function finishEventPointer(e: ReactPointerEvent<HTMLDivElement>) {
    if (!pointerOrigin || e.pointerId !== pointerOrigin.pointerId) return;
    const moved = exceedsDragThreshold({ x: pointerOrigin.x, y: pointerOrigin.y }, { x: e.clientX, y: e.clientY }, DRAG_THRESHOLD);
    const origin = pointerOrigin;
    setPointerOrigin(null);
    if (moved) suppressClickRef.current = true;
    if (!moved) {
      if (origin.action === 'move') onSelectEvent(origin.event.id);
      return;
    }
    const originalLocal = instantToLocalDateTime(origin.event.startAt, origin.event.timeZone);
    const oldMinute = timeToMin(originalLocal.time);
    const deltaMin = snapMinutes((e.clientY - origin.y) / PX_PER_HOUR * 60, 5, 'nearest');
    if (origin.action === 'move') {
      const target = Math.max(START_MINUTE, Math.min(END_MINUTE - origin.event.durationMin, oldMinute + deltaMin));
      const time = clockFromMinute(target, 'nearest');
      const startAt = localDateTimeToInstant(originalLocal.date, time, origin.event.timeZone);
      const endAt = new Date(Date.parse(startAt) + origin.event.durationMin * 60_000).toISOString();
      void onMutation(origin.event.id, 'move', {
        startAt,
        endAt,
        durationMin: origin.event.durationMin,
        timeZone: origin.event.timeZone,
      });
    } else {
      const requested = origin.event.durationMin + deltaMin;
      const next = resizeToDuration(origin.event, Math.max(5, requested));
      void onMutation(origin.event.id, 'resize', next);
    }
  }

  function startSelection(e: ReactPointerEvent<HTMLDivElement>, column: Column) {
    if (e.button !== 0 || (e.target as HTMLElement).closest('[data-spike-event-id]')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelectionOrigin({ x: e.clientX, y: e.clientY, date: column.date, professionalId: column.professionalId, rectTop: rect.top, pointerId: e.pointerId });
    setSelectionEndY(e.clientY);
  }

  function moveSelection(e: ReactPointerEvent<HTMLDivElement>) {
    if (!selectionOrigin || e.pointerId !== selectionOrigin.pointerId) return;
    setSelectionEndY(e.clientY);
  }

  function finishSelection(e: ReactPointerEvent<HTMLDivElement>) {
    if (!selectionOrigin || e.pointerId !== selectionOrigin.pointerId) return;
    const origin = selectionOrigin;
    setSelectionOrigin(null);
    setSelectionEndY(null);
    if (!exceedsDragThreshold({ x: origin.x, y: origin.y }, { x: e.clientX, y: e.clientY }, DRAG_THRESHOLD)) return;
    const a = minutesFromPointer(origin.y, origin.rectTop);
    const b = minutesFromPointer(e.clientY, origin.rectTop);
    const start = Math.max(START_MINUTE, Math.min(a, b));
    const end = Math.min(END_MINUTE, Math.max(a, b));
    const startTime = clockFromMinute(start, 'floor');
    const endTime = clockFromMinute(end, 'ceil');
    if (startTime === endTime) return;
    onSelectRange(
      localDateTimeToInstant(origin.date, startTime, DEMO_TIME_ZONE),
      localDateTimeToInstant(origin.date, endTime, DEMO_TIME_ZONE),
      origin.professionalId,
    );
  }

  if (view === 'list') {
    return (
      <div className="sp-list-view" data-spike-view="list">
        {visibleEvents.length === 0 ? <p className="sp-empty">Nenhum atendimento nesta data.</p> : visibleEvents.map((item) => (
          <button key={item.id} className="sp-list-row" data-spike-event-id={item.id} onClick={() => onSelectEvent(item.id)}>
            <SpikeEventCard event={item} />
            <span className="sp-list-row__open">Detalhes</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={`sp-current-grid sp-current-grid--${view}`} data-spike-view={view}>
      <div className="sp-grid-scroll" ref={scrollRef}>
        <div className="sp-grid-layout" style={{ minWidth: `${56 + columns.length * COLUMN_MIN_WIDTH}px` }}>
          <div className="sp-grid-time-gutter">
            <div className="sp-grid-time-gutter__head" />
            <div className="sp-grid-time-rail" style={{ height: `${((END_MINUTE - START_MINUTE) / 60) * PX_PER_HOUR}px` }}>
              {Array.from({ length: END_MINUTE / 60 - START_MINUTE / 60 + 1 }, (_, index) => START_MINUTE / 60 + index).map((hour) => (
                <span key={hour} style={{ top: `${(hour - START_MINUTE / 60) * PX_PER_HOUR}px` }}>{String(hour % 24).padStart(2, '0')}:00</span>
              ))}
            </div>
          </div>
          <div className="sp-grid-main">
            <div className="sp-grid-head" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(${COLUMN_MIN_WIDTH}px, 1fr))` }}>
              {columns.map((column) => (
                <div key={column.key} className="sp-grid-head__cell">
                  <strong>{column.title}</strong>
                  <span>{column.subtitle}</span>
                </div>
              ))}
            </div>
            <div className="sp-grid-columns" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(${COLUMN_MIN_WIDTH}px, 1fr))` }}>
              {columns.map((column) => {
                const items = visibleEvents.filter((item) => columnsForEvent(item) === columns.indexOf(column));
                const layouts = layoutBlocks(items.map((item) => ({
                  id: item.id,
                  minute: timeToMin(instantToLocalDateTime(item.startAt, item.timeZone).time),
                  durationMin: item.durationMin,
                })), { startMinute: START_MINUTE, pxPerHour: PX_PER_HOUR });
                const byId = new Map(items.map((item) => [item.id, item]));
                return (
                  <div
                    key={column.key}
                    className="sp-grid-column"
                    data-spike-resource={column.professionalId || column.date}
                    onPointerDown={(e) => startSelection(e, column)}
                    onPointerMove={moveSelection}
                    onPointerUp={finishSelection}
                    onPointerCancel={() => { setSelectionOrigin(null); setSelectionEndY(null); }}
                  >
                    <div className="sp-grid-column__lines" style={{ height: `${((END_MINUTE - START_MINUTE) / 60) * PX_PER_HOUR}px` }}>
                      {Array.from({ length: END_MINUTE / 60 - START_MINUTE / 60 + 1 }, (_, index) => (
                        <span key={index} style={{ top: `${index * PX_PER_HOUR}px` }} />
                      ))}
                      {selectionOrigin?.date === column.date && selectionOrigin.professionalId === column.professionalId && selectionEndY !== null && (() => {
                        const from = Math.max(START_MINUTE, Math.min(minutesFromPointer(selectionOrigin.y, selectionOrigin.rectTop), minutesFromPointer(selectionEndY, selectionOrigin.rectTop)));
                        const to = Math.min(END_MINUTE, Math.max(minutesFromPointer(selectionOrigin.y, selectionOrigin.rectTop), minutesFromPointer(selectionEndY, selectionOrigin.rectTop)));
                        return <div className="sp-grid-selection" style={{ top: `${((from - START_MINUTE) / 60) * PX_PER_HOUR}px`, height: `${Math.max(8, ((to - from) / 60) * PX_PER_HOUR)}px` }} />;
                      })()}
                      {layouts.map((layout) => {
                        const item = byId.get(layout.id)!;
                        const busy = pointerOrigin?.event.id === item.id;
                        const style: CSSProperties = {
                          top: layout.top,
                          height: Math.max(layout.height, blockHeight(item.durationMin, PX_PER_HOUR, 30)),
                          left: `calc(${layout.leftPct}% + 2px)`,
                          width: `calc(${layout.widthPct}% - 4px)`,
                        };
                        return (
                          <div
                            key={item.id}
                            className={`sp-grid-event ${busy ? 'sp-grid-event--dragging' : ''}`}
                            style={style}
                            role="button"
                            tabIndex={0}
                            aria-label={`${item.customerName}, ${item.serviceName}, ${item.status}`}
                            data-spike-event-id={item.id}
                            onPointerDown={(e) => startEventPointer(item, 'move', e)}
                            onPointerMove={moveEventPointer}
                            onPointerUp={finishEventPointer}
                            onPointerCancel={() => setPointerOrigin(null)}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                              if (!pointerOrigin) onSelectEvent(item.id);
                            }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectEvent(item.id); } }}
                          >
                            <SpikeEventCard event={item} compact={layout.height < 75} />
                            {['pending', 'confirmed'].includes(item.status) && (
                              <div
                                className="sp-grid-event__resize"
                                aria-label={`Redimensionar ${item.customerName}`}
                                onPointerDown={(e) => startEventPointer(item, 'resize', e)}
                                onPointerMove={moveEventPointer}
                                onPointerUp={finishEventPointer}
                                onPointerCancel={() => setPointerOrigin(null)}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      {pointerOrigin && Math.abs(pointerDelta) > 0 && (
        <div className="sp-grid-live-feedback" aria-live="polite">
          {pointerOrigin.action === 'move' ? 'Movendo · ' : 'Redimensionando · '}{pointerOrigin.event.customerName}
        </div>
      )}
      <p className="sp-grid-caption">Grade própria · reaproveita `layoutBlocks`/geometria da agenda atual; seleção e resize foram adicionados apenas neste spike.</p>
    </div>
  );
}
