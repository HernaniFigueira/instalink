import type { AppointmentWindow, CalendarView } from '../domain/temporal-contract';
import type { SpikeEvent } from '../domain/fixtures';

export interface CalendarAdapterProps {
  events: SpikeEvent[];
  view: CalendarView;
  focusDate: string;
  /** Business IANA zone is passed explicitly; never read from browser/system state. */
  timeZone: string;
  professionalFilter: string;
  pendingEventId: string;
  eventCount: number;
  onSelectEvent: (eventId: string) => void;
  onSelectRange: (startAt: string, endAt: string, professionalId?: string) => void;
  onMutation: (eventId: string, action: 'move' | 'resize', next: AppointmentWindow) => Promise<boolean>;
  onNotice: (message: string) => void;
}

export const STATUS_CLASS: Record<SpikeEvent['status'], string> = {
  pending: 'status-pending',
  confirmed: 'status-confirmed',
  cancelled: 'status-cancelled',
  completed: 'status-completed',
  no_show: 'status-no-show',
};

export const STATUS_TEXT: Record<SpikeEvent['status'], string> = {
  pending: 'Aguardando',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
  completed: 'Concluído',
  no_show: 'Não compareceu',
};
