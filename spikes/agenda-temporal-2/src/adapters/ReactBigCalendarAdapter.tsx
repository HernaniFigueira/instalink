import { useMemo } from 'react';
import { DateTime } from 'luxon';
import { Calendar, type EventProps } from 'react-big-calendar';
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
import { DAY_PROFESSIONALS, eventResources, PROFESSIONALS, type SpikeEvent } from '../domain/fixtures';
import { createIanaLuxonLocalizer } from './rbcIanaLocalizer';
import { SpikeEventCard } from '../components/SpikeEventCard';
import type { CalendarAdapterProps } from './types';

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

function dateInBusinessZone(date: string, timeZone: string, hour = 12): Date {
  return DateTime.fromISO(`${date}T${String(hour).padStart(2, '0')}:00`, { zone: timeZone }).toJSDate();
}

function asInstant(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function CustomEvent({ event }: EventProps<CalendarEvent>) {
  return <SpikeEventCard event={event} compact />;
}

export default function ReactBigCalendarAdapter(props: CalendarAdapterProps) {
  const { events, view, focusDate, timeZone, professionalFilter, onSelectEvent, onSelectRange, onMutation, onNotice } = props;
  const localizer = useMemo(() => createIanaLuxonLocalizer(timeZone), [timeZone]);
  const calendarEvents = useMemo(() => events.map(toCalendarEvent), [events]);
  const resources = useMemo(() => {
    const candidates = professionalFilter ? PROFESSIONALS : DAY_PROFESSIONALS;
    return eventResources(candidates).filter((resource) => !professionalFilter || resource.id === professionalFilter);
  }, [professionalFilter]);
  const activeView = libraryView('rbc', view) as 'day' | 'week' | 'agenda';
  const focusedDate = dateInBusinessZone(focusDate, timeZone);
  const min = dateInBusinessZone(focusDate, timeZone, 5);
  const max = dateInBusinessZone(focusDate, timeZone, 23);
  const scrollToTime = dateInBusinessZone(focusDate, timeZone, 9);

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
        <span>Day/Week/Agenda · Orlando, Ana e Carlos no recurso Dia · seleção, mover e resize nativos · passo 5 min.</span>
      </div>
      <div className="sp-rbc-wrap">
        <DnDCalendar
          localizer={localizer}
          events={calendarEvents}
          date={focusedDate}
          view={activeView}
          onNavigate={(date) => onNotice(`Data navegada pelo calendário: ${instantToLocalDateTime(date.toISOString(), timeZone).date}`)}
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
          getNow={() => dateInBusinessZone(focusDate, timeZone, 12)}
          messages={{ noEventsInRange: 'Nenhum atendimento neste período.', showMore: (count) => `+${count} atendimentos` }}
        />
      </div>
      <p className="sp-grid-caption">Fuso IANA explícito: {timeZone}. O localizer fecha sobre esta zona sem mutar Settings.defaultZone; ainda exige homologação em browser/SSR antes de produção.</p>
    </section>
  );
}
