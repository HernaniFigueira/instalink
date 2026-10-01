import { useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { DateTime } from 'luxon';
import { Calendar, type EventProps } from 'react-big-calendar';
import withDragAndDropImport from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import {
  instantToLocalDateTime,
  libraryView,
  moveWindow,
  resizeWindow,
  type AppointmentWindow,
} from '../domain/temporal-contract';
import { DAY_PROFESSIONALS, PROFESSIONALS, type SpikeEvent } from '../domain/fixtures';
import { createIanaLuxonLocalizer } from './rbcIanaLocalizer';
import { SpikeEventCard } from '../components/SpikeEventCard';
import { STATUS_TEXT, type CalendarAdapterProps } from './types';

// The published addon is CommonJS with an `exports.default` property. Unwrap
// that shape explicitly so both Vite's dev transform and production bundling
// receive the factory function rather than a nested namespace object.
const withDragAndDrop =
  (withDragAndDropImport as unknown as { default?: typeof withDragAndDropImport }).default
  ?? withDragAndDropImport;

const DnDCalendar = withDragAndDrop<CalendarEvent, { id: number; title: string }>(Calendar);

interface CalendarEvent extends SpikeEvent {
  title: string;
  start: Date;
  end: Date;
  resourceId: number;
}

function rbcResourceId(professionalId: string): number {
  const index = PROFESSIONALS.findIndex((professional) => professional.id === professionalId);
  if (index < 0) throw new RangeError(`Profissional sem recurso RBC: ${professionalId}`);
  return index + 1;
}

function professionalFromRbcResource(resourceId: string | number | undefined): string | undefined {
  if (resourceId === undefined) return undefined;
  return PROFESSIONALS.find((professional) => rbcResourceId(professional.id) === Number(resourceId))?.id;
}

function toCalendarEvent(event: SpikeEvent): CalendarEvent {
  return {
    ...event,
    title: `${event.customerName} · ${event.serviceName} · ${STATUS_TEXT[event.status]}`,
    start: new Date(event.startAt),
    end: new Date(event.endAt),
    // RBC's drag-and-drop EventWrapper declares its resource prop as number.
    // Keep this adapter-local ordinal; domain identity stays the IANA-safe ID.
    resourceId: rbcResourceId(event.professionalId),
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
    const candidates = professionalFilter
      ? PROFESSIONALS.filter((professional) => professional.id === professionalFilter)
      : DAY_PROFESSIONALS;
    return candidates.map((professional) => ({
      id: rbcResourceId(professional.id),
      title: professional.name,
    }));
  }, [professionalFilter]);
  const activeView = libraryView('rbc', view) as 'day' | 'week' | 'agenda';
  const focusedDate = dateInBusinessZone(focusDate, timeZone);
  const min = dateInBusinessZone(focusDate, timeZone, 5);
  const max = dateInBusinessZone(focusDate, timeZone, 23);
  const scrollToTime = dateInBusinessZone(focusDate, timeZone, 9);
  const calendarWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = calendarWrapRef.current;
    if (!root) return;
    const hideEmptyAllDayRows = () => {
      root.querySelectorAll('.rbc-allday-cell').forEach((cell) => {
        if (cell.querySelector('.rbc-event')) cell.removeAttribute('aria-hidden');
        else cell.setAttribute('aria-hidden', 'true');
      });
    };
    hideEmptyAllDayRows();
    const observer = new MutationObserver(hideEmptyAllDayRows);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [activeView, calendarEvents]);

  function handleCalendarKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const button = (event.target as HTMLElement).closest<HTMLElement>('.rbc-event[role="button"]');
    if (!button || !event.currentTarget.contains(button)) return;
    const eventElement = button.querySelector<HTMLElement>('[data-event-id], [data-spike-event-id]');
    const eventId = eventElement?.dataset.eventId || eventElement?.dataset.spikeEventId;
    if (!eventId) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectEvent(eventId);
  }

  function requestChange(event: CalendarEvent, action: 'move' | 'resize', start: Date | string, end: Date | string, resourceId?: string | number) {
    if (resourceId !== undefined && resourceId !== null) {
      const targetProfessional = PROFESSIONALS.find((professional) => rbcResourceId(professional.id) === Number(resourceId));
      if (!targetProfessional || targetProfessional.id !== event.professionalId) {
        onNotice('Trocar o profissional exige validar serviço, escopo e elegibilidade no servidor. Este spike mantém o vínculo atual.');
        return;
      }
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
      <div className="sp-rbc-wrap" ref={calendarWrapRef} onKeyDown={handleCalendarKeyDown}>
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
          onSelectSlot={(slot) => onSelectRange(
            slot.start.toISOString(),
            slot.end.toISOString(),
            professionalFromRbcResource(slot.resourceId) || professionalFilter || undefined,
          )}
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
          resourceAccessor="resourceId"
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
