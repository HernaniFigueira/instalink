import { useEffect, useMemo, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import timeGridPlugin from '@fullcalendar/react/timegrid';
import listPlugin from '@fullcalendar/react/list';
import interactionPlugin from '@fullcalendar/react/interaction';
import ptBrLocale from '@fullcalendar/react/locales/pt-br';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/classic/theme.css';
import '@fullcalendar/react/themes/classic/palette.css';
import {
  eventPresentation,
  libraryView,
  moveWindow,
  resizeWindow,
  type AppointmentWindow,
} from '../domain/temporal-contract';
import type { SpikeEvent } from '../domain/fixtures';
import { SpikeEventCard } from '../components/SpikeEventCard';
import type { CalendarAdapterProps } from './types';

const STATUS_COLOR: Record<SpikeEvent['status'], { background: string; border: string; text: string }> = {
  pending: { background: '#fff7d6', border: '#c58a00', text: '#694700' },
  confirmed: { background: '#dbeafe', border: '#2563eb', text: '#163b74' },
  cancelled: { background: '#f1f5f9', border: '#64748b', text: '#334155' },
  completed: { background: '#dcfce7', border: '#15803d', text: '#14532d' },
  no_show: { background: '#fee2e2', border: '#b91c1c', text: '#7f1d1d' },
};

function calendarEvent(event: SpikeEvent) {
  const colors = STATUS_COLOR[event.status];
  return {
    id: event.id,
    title: `${event.customerName} · ${event.serviceName}`,
    start: event.startAt,
    end: event.endAt,
    backgroundColor: colors.background,
    borderColor: colors.border,
    textColor: colors.text,
    extendedProps: { raw: event, status: event.status, professionalId: event.professionalId },
  };
}

export default function FullCalendarAdapter(props: CalendarAdapterProps) {
  const { events, view, focusDate, timeZone, professionalFilter, onSelectEvent, onSelectRange, onMutation, onNotice } = props;
  const visibleEvents = useMemo(() => events
    .filter((event) => !professionalFilter || event.professionalId === professionalFilter)
    .map(calendarEvent), [events, professionalFilter]);
  const calendarView = libraryView('fullcalendar', view);
  const calendarWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrapper = calendarWrapRef.current;
    if (!wrapper) return;
    const exposeAccessibleHeaders = () => {
      wrapper.querySelectorAll('[role="columnheader"] [aria-hidden="true"]').forEach((label) => {
        label.removeAttribute('aria-hidden');
      });
      wrapper.querySelectorAll('[role="rowheader"][aria-label="Timed"]').forEach((header) => {
        header.setAttribute('aria-label', 'Horários do dia');
        if (!header.textContent?.trim()) {
          const label = document.createElement('span');
          label.className = 'sp-sr-only';
          label.textContent = 'Horários do dia';
          header.append(label);
        }
      });
    };
    exposeAccessibleHeaders();
    const observer = new MutationObserver(exposeAccessibleHeaders);
    observer.observe(wrapper, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label', 'aria-hidden'] });
    return () => observer.disconnect();
  }, [view, focusDate]);

  function requestMove(info: { event: any; revert: () => void }) {
    const original = info.event.extendedProps.raw as SpikeEvent;
    info.revert(); // parent state only changes after the dev server accepts it
    const current: AppointmentWindow = {
      startAt: original.startAt,
      endAt: original.endAt,
      durationMin: original.durationMin,
      timeZone: original.timeZone,
    };
    const next = moveWindow(current, info.event.start.toISOString());
    void onMutation(original.id, 'move', next);
  }

  function requestResize(info: { event: any; revert: () => void }) {
    const original = info.event.extendedProps.raw as SpikeEvent;
    info.revert();
    const current: AppointmentWindow = {
      startAt: original.startAt,
      endAt: original.endAt,
      durationMin: original.durationMin,
      timeZone: original.timeZone,
    };
    const next = resizeWindow(current, info.event.end.toISOString());
    void onMutation(original.id, 'resize', next);
  }

  return (
    <section className="sp-library-frame sp-library-frame--fullcalendar" data-library="fullcalendar" aria-label="FullCalendar Standard">
      <div className="sp-library-note">
        <span className="sp-license-tag sp-license-tag--mit">Standard · MIT</span>
        <span>TimeGrid Day/Week + List · seleção, drag, resize e snap nativos de 5 min · sem Scheduler/Premium.</span>
      </div>
      <div className="sp-fullcalendar-wrap" ref={calendarWrapRef}>
        <FullCalendar
          plugins={[timeGridPlugin, listPlugin, interactionPlugin]}
          initialView={calendarView}
          key={calendarView}
          initialDate={`${focusDate}T12:00:00`}
          timeZone={timeZone}
          locale={ptBrLocale}
          headerToolbar={false}
          height="auto"
          expandRows={false}
          nowIndicator
          slotMinTime="05:00:00"
          slotMaxTime="23:00:00"
          slotDuration="00:30:00"
          snapDuration="00:05:00"
          scrollTime="09:00:00"
          selectable={view !== 'list'}
          selectMirror
          selectOverlap={false}
          eventStartEditable
          eventDurationEditable
          eventResizableFromStart={false}
          eventAllow={(_dropInfo, draggedEvent) => Boolean(draggedEvent && ['pending', 'confirmed'].includes(String(draggedEvent.extendedProps.status)))}
          editable
          events={visibleEvents}
          eventContent={(info) => {
            // FullCalendar also calls eventContent for its select-mirror draft;
            // that transient object has no domain event and must not crash React.
            const event = info.event.extendedProps.raw as SpikeEvent | undefined;
            if (!event) return null;
            return <SpikeEventCard event={event} compact={view === 'week'} />;
          }}
          eventClass={(arg) => `sp-fc-event sp-fc-event--${arg.event.extendedProps.status}`}
          columnEventAfterClass={() => 'sp-fc-resize-handle'}
          eventClick={(info) => { info.jsEvent.preventDefault(); onSelectEvent(info.event.id); }}
          dateClick={(info) => {
            const startAt = info.date.toISOString();
            const endAt = new Date(Date.parse(startAt) + 40 * 60_000).toISOString();
            onSelectRange(startAt, endAt, professionalFilter || undefined);
          }}
          select={(info) => onSelectRange(info.start.toISOString(), info.end.toISOString(), professionalFilter || undefined)}
          eventDrop={requestMove}
          eventResize={requestResize}
          datesSet={() => {
            // The product toolbar owns navigation; FullCalendar remains a view adapter.
          }}
          eventDidMount={(info) => {
            const event = info.event.extendedProps.raw as SpikeEvent | undefined;
            if (!event) return; // selection-mirror, not a persisted demo booking
            info.el.dataset.spikeEventId = event.id;
            info.el.dataset.status = event.status;
            info.el.setAttribute('aria-label', eventPresentation({
              customerName: event.customerName,
              serviceName: event.serviceName,
              status: event.status,
            }).ariaLabel);
          }}
          eventChange={() => { /* updates are acknowledged through the test API first */ }}
          contentHeight={680}
          progressiveEventRendering
        />
      </div>
      <p className="sp-grid-caption">Standard não fornece visão multi-recurso. Resource Timeline/Vertical Resource pertence ao Scheduler Premium e não foi instalado.</p>
    </section>
  );
}
