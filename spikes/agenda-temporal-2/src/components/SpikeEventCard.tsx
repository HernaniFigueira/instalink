import { eventPresentation, instantToLocalDateTime } from '../domain/temporal-contract';
import type { SpikeEvent } from '../domain/fixtures';
import { STATUS_CLASS, STATUS_TEXT } from '../adapters/types';

export function SpikeEventCard({ event, compact = false }: { event: SpikeEvent; compact?: boolean }) {
  const local = instantToLocalDateTime(event.startAt, event.timeZone);
  const presentation = eventPresentation({
    customerName: event.customerName,
    serviceName: event.serviceName,
    status: event.status,
  });
  return (
    <div
      className={`sp-event-card ${STATUS_CLASS[event.status]} ${compact ? 'sp-event-card--compact' : ''}`}
      data-spike-event-id={event.id}
      data-event-id={event.id}
      data-status={event.status}
      aria-label={presentation.ariaLabel}
    >
      <span className="sp-event-card__time">{local.time}–{instantToLocalDateTime(event.endAt, event.timeZone).time}</span>
      <strong className="sp-event-card__person">{event.customerName}</strong>
      {!compact && <span className="sp-event-card__service">{event.serviceName}</span>}
      <span className="sp-event-card__status">{STATUS_TEXT[event.status]}</span>
    </div>
  );
}
