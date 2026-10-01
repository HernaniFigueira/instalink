import { useMemo } from 'react';
import {
  createViewDay,
  createViewList,
  createViewWeek,
  type CalendarEventExternal,
} from '@schedule-x/calendar';
import { ScheduleXCalendar, useCalendarApp } from '@schedule-x/react';
import { Temporal as ScheduleTemporal } from '@agenda-sx/temporal';
import '@agenda-sx/temporal/global';
import '@schedule-x/theme-default';
import { libraryView } from '../domain/temporal-contract';
import { DEMO_TIME_ZONE, type SpikeEvent } from '../domain/fixtures';
import type { CalendarAdapterProps } from './types';

const STATUS_COLORS = {
  confirmed: { main: '#2563eb', container: '#eaf2ff', onContainer: '#173b73' },
  pending: { main: '#b77900', container: '#fff4d6', onContainer: '#694700' },
  completed: { main: '#16803d', container: '#e8f7ec', onContainer: '#14532d' },
  cancelled: { main: '#64748b', container: '#f1f5f9', onContainer: '#334155' },
  no_show: { main: '#b91c1c', container: '#fee2e2', onContainer: '#7f1d1d' },
} as const;

interface ScheduleEvent extends CalendarEventExternal {
  customerName: string;
  serviceName: string;
  status: SpikeEvent['status'];
  startAt: string;
  endAt: string;
  timeZone: string;
}

function toScheduleEvent(event: SpikeEvent): ScheduleEvent {
  return {
    ...event,
    id: event.id,
    title: `${event.customerName} · ${event.serviceName}`,
    start: ScheduleTemporal.Instant.from(event.startAt).toZonedDateTimeISO(event.timeZone),
    end: ScheduleTemporal.Instant.from(event.endAt).toZonedDateTimeISO(event.timeZone),
    calendarId: event.status,
  };
}

function ScheduleXEvent({ calendarEvent }: { calendarEvent: ScheduleEvent }) {
  const start = calendarEvent.start as ScheduleTemporal.ZonedDateTime;
  const end = calendarEvent.end as ScheduleTemporal.ZonedDateTime;
  const labels: Record<SpikeEvent['status'], string> = {
    pending: 'Aguardando',
    confirmed: 'Confirmado',
    cancelled: 'Cancelado',
    completed: 'Concluído',
    no_show: 'Não compareceu',
  };
  return (
    <div className={`sx-spike-event sx-spike-event--${calendarEvent.status}`} data-spike-event-id={String(calendarEvent.id)}>
      <span>{start.toPlainTime().toString({ smallestUnit: 'minute' })}–{end.toPlainTime().toString({ smallestUnit: 'minute' })}</span>
      <strong>{calendarEvent.customerName}</strong>
      <small>{calendarEvent.serviceName}</small>
      <em>{labels[calendarEvent.status]}</em>
    </div>
  );
}

const CUSTOM_COMPONENTS = {
  timeGridEvent: ScheduleXEvent,
  dateGridEvent: ScheduleXEvent,
  weekAgendaEvent: ScheduleXEvent,
  monthAgendaEvent: ScheduleXEvent,
};

export default function ScheduleXAdapter(props: CalendarAdapterProps) {
  const {
    events,
    view,
    focusDate,
    professionalFilter,
    onSelectEvent,
    onSelectRange,
    onNotice,
  } = props;
  const visibleEvents = useMemo(() => events
    .filter((event) => !professionalFilter || event.professionalId === professionalFilter)
    .map(toScheduleEvent), [events, professionalFilter]);
  const scheduleView = libraryView('schedule-x', view);
  const calendarApp = useCalendarApp({
    defaultView: scheduleView,
    selectedDate: ScheduleTemporal.PlainDate.from(focusDate),
    timezone: DEMO_TIME_ZONE,
    locale: 'pt-BR',
    firstDayOfWeek: 1,
    dayBoundaries: { start: '05:00', end: '23:00' },
    // The community calendar's public grid granularity starts at 10/15 min;
    // the required 5-minute interaction cannot be honestly demonstrated here.
    weekOptions: { gridStep: 15, eventOverlap: true },
    views: [createViewDay(), createViewWeek(), createViewList()],
    calendars: Object.fromEntries(Object.entries(STATUS_COLORS).map(([id, colors]) => [id, {
      colorName: id,
      lightColors: colors,
    }])),
    events: visibleEvents,
    callbacks: {
      onEventClick: (event) => onSelectEvent(String(event.id)),
      // Community edition has no drag-to-create plugin. A single time-cell click
      // only demonstrates its default-duration affordance; it is not drag-select.
      onClickDateTime: (dateTime) => {
        const startAt = dateTime.toInstant().toString();
        const endAt = dateTime.add({ minutes: 40 }).toInstant().toString();
        onSelectRange(startAt, endAt, professionalFilter || undefined);
      },
      onBeforeEventUpdate: () => {
        onNotice('Mover/redimensionar no Schedule-X exige os plugins Premium; nenhuma alteração local foi aceita.');
        return false;
      },
      onEventUpdate: () => {
        onNotice('O Schedule-X Community não tem gesto de move/resize neste spike.');
      },
    },
  });
  return (
    <section className="sp-library-frame sp-library-frame--schedule-x" data-library="schedule-x" aria-label="Schedule-X Community">
      <div className="sp-library-note">
        <span className="sp-license-tag sp-license-tag--mit">Community · MIT</span>
        <span>Day/Week/List · Temporal + componentes customizados · seleção por clique com sugestão de 40 min.</span>
      </div>
      <div className="sp-schedule-x-wrap">
        {calendarApp && <ScheduleXCalendar calendarApp={calendarApp} customComponents={CUSTOM_COMPONENTS} />}
      </div>
      <p className="sp-grid-caption">Limites v4 verificados: drag/drop, resize, drag-to-create e Resource View estão em Premium; snap público não chega a 5 min. Não simulamos gestos pagos no adapter Community.</p>
    </section>
  );
}
