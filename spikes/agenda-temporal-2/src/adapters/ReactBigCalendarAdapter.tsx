import { useMemo } from 'react';
import { DateTime, Settings } from 'luxon';
import { Calendar, luxonLocalizer, type EventProps } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import {
  instantToLocalDateTime,
  libraryView,
  moveWindow,
  resizeWindow,
  type AppointmentWindow,
} from '../domain/temporal-contract';
import { DEMO_TIME_ZONE, eventResources, type SpikeEvent } from '../domain/fixtures';
import { SpikeEventCard } from '../components/SpikeEventCard';
import type { CalendarAdapterProps } from './types';

// RBC's documented timezone support uses Luxon's global default zone.
// It is scoped to this isolated single-business spike; do not copy globally into a multi-tenant production app.
Settings.defaultZone = DEMO_TIME_ZONE;
const localizer = luxonLocalizer(DateTime, { firstDayOfWeek: 1 });
const DnDCalendar = withDragAndDrop<CalendarEvent, { id: string; title: string }>(Calendar);

interface CalendarEvent extends SpikeEvent {
  title: string;
  start: Date;
  end: Date;
  resourceId: string;
}

function toCalendarEvent(event: SpikeEvent): CalendarEvent {
  return {
    ...event,
    title: `${event.customerName} · ${event.serviceName}`,
    start: new Date(event.startAt),
    end: new Date(event.endAt),
    resourceId: event.professionalId,
  };
}

function dateInBusinessZone(date: string, hour = 12): Date {
  return DateTime.fromISO(`${date}T${String(hour).padStart(2, '0')}:00`, { zone: DEMO_TIME_ZONE }).toJSDate();
}

function asInstant(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function CustomEvent({ event }: EventProps<CalendarEvent>) {
  return <SpikeEventCard event={event} compact />;
}

export default function ReactBigCalendarAdapter(props: CalendarAdapterProps) {
  const { events, view, focusDate, professionalFilter, onSelectEvent, onSelectRange, onMutation, onNotice } = props;
  const calendarEvents = useMemo(() => events.map(toCalendarEvent), [events]);
  const resources = useMemo(() => eventResources().filter((resource) => !professionalFilter || resource.id === professionalFilter), [professionalFilter]);
  const activeView = libraryView('rbc', view) as 'day' | 'week' | 'agenda';
  const focusedDate = dateInBusinessZone(focusDate);
  const min = dateInBusinessZone(focusDate, 5);
  const max = dateInBusinessZone(focusDate, 23);
  const scrollToTime = dateInBusinessZone(focusDate, 9);

  function requestChange(event: CalendarEvent, action: 'move' | 'resize', start: Date | string, end: Date | string, resourceId?: string | number) {
    if (resourceId && String(resourceId) !== event.professionalId) {
      onNotice('Trocar o profissional exige validar serviço, escopo e elegibilidade no servidor. Este spike mantém o vínculo atual.');
      return;
    }
    const current: AppointmentWindow = {
      startAt: event.startAt,
      endAt: event.endAt,
      durationMin: event.durationMin,
      timeZone: event.timeZone,
    };
    const next = action === 'move'
      ? moveWindow(current, asInstant(start))
      : resizeWindow(current, asInstant(end));
    void onMutation(event.id, action, next);
  }

  return (
    <section className="sp-library-frame sp-library-frame--rbc" data-library="rbc" aria-label="React Big Calendar">
      <div className="sp-library-note">
        <span className="sp-license-tag sp-license-tag--mit">MIT</span>
        <span>Day/Week/Agenda · cinco profissionais no recurso Dia · seleção, mover e resize nativos · passo 5 min.</span>
      </div>
      <div className="sp-rbc-wrap">
        <DnDCalendar
          localizer={localizer}
          events={calendarEvents}
          date={focusedDate}
          view={activeView}
          onNavigate={(date) => onNotice(`Data navegada pelo calendário: ${instantToLocalDateTime(date.toISOString(), DEMO_TIME_ZONE).date}`)}
          onView={() => { /* toolbar do produto fica fora da biblioteca */ }}
          views={['day', 'week', 'agenda']}
          toolbar={false}
          popup
          selectable={activeView !== 'agenda'}
          resizable
          draggableAccessor={(event) => event.status === 'pending' || event.status === 'confirmed'}
          resizableAccessor={(event) => event.status === 'pending' || event.status === 'confirmed'}
          onSelectEvent={(event) => onSelectEvent(event.id)}
          onSelectSlot={(slot) => onSelectRange(slot.start.toISOString(), slot.end.toISOString(), String(slot.resourceId || professionalFilter || ''))}
          onEventDrop={({ event, start, end, resourceId }) => requestChange(event, 'move', start, end, resourceId)}
          onEventResize={({ event, start, end }) => requestChange(event, 'resize', start, end)}
          step={5}
          timeslots={12}
          min={min}
          max={max}
          scrollToTime={scrollToTime}
          resources={activeView === 'day' ? resources : undefined}
          resourceIdAccessor="id"
          resourceTitleAccessor="title"
          resourceAccessor="professionalId"
          startAccessor="start"
          endAccessor="end"
          titleAccessor="title"
          dayLayoutAlgorithm="overlap"
          components={{ event: CustomEvent }}
          eventPropGetter={(event) => ({
            className: `sp-rbc-event sp-rbc-event--${event.status}`,
            style: { background: 'transparent', border: '0', padding: '0', color: 'inherit' },
          })}
          formats={{ timeGutterFormat: 'HH:mm', eventTimeRangeFormat: ({ start, end }, _culture, loc) => `${loc?.format(start, 'HH:mm') ?? ''}–${loc?.format(end, 'HH:mm') ?? ''}` }}
          culture="pt-BR"
          getNow={() => dateInBusinessZone(focusDate, 12)}
          messages={{ noEventsInRange: 'Nenhum atendimento neste período.', showMore: (count) => `+${count} atendimentos` }}
        />
      </div>
      <p className="sp-grid-caption">Fuso do spike: {DEMO_TIME_ZONE}. O localizer usa a zona Luxon global documentada pelo RBC; testar troca de tenant/SSR antes de produção.</p>
    </section>
  );
}
