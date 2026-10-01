import {
  assertCanonicalWindow,
  eventPresentation,
  instantToLocalDateTime,
  minutesBetween,
  overlaps,
  type AppointmentWindow,
} from './temporal-contract.ts';
import {
  benchmarkEvents,
  DEMO_TIME_ZONE,
  demoEvents,
  PROFESSIONALS,
  type SpikeEvent,
} from './fixtures.ts';

export type DemoMutationKind = 'move' | 'resize';

export interface DemoMutationRequest {
  action: DemoMutationKind;
  eventId: string;
  current: AppointmentWindow;
  next: AppointmentWindow;
  eventCount?: number;
}

export interface DemoMutationResponse {
  ok: boolean;
  event?: SpikeEvent;
  message: string;
}

export interface DemoServerState {
  eventCount: number;
  events: SpikeEvent[];
}

export function createDemoServerState(eventCount = 7): DemoServerState {
  const count = Math.max(7, Math.min(1_000, Math.floor(eventCount)));
  return { eventCount: count, events: count === 7 ? demoEvents() : benchmarkEvents(count) };
}

export function resetDemoServerState(state: DemoServerState, eventCount = 7): void {
  const next = createDemoServerState(eventCount);
  state.eventCount = next.eventCount;
  state.events = next.events;
}

function activeForConflict(event: SpikeEvent): boolean {
  return event.status === 'pending' || event.status === 'confirmed';
}

function isOnFiveMinuteGrid(value: string): boolean {
  const { time } = instantToLocalDateTime(value, DEMO_TIME_ZONE);
  return Number(time.slice(3, 5)) % 5 === 0;
}

/**
 * Dev-only mock API authority. It validates and stores only in process memory;
 * it never reads or writes the application DB. A rejected mutation leaves the
 * state unchanged, so subsequent drags are checked against the latest accepted
 * server window rather than the original fixture.
 */
export function validateDemoMutation(
  input: DemoMutationRequest,
  state: DemoServerState = createDemoServerState(input.eventCount || 7),
): DemoMutationResponse {
  if (input.eventCount && input.eventCount !== state.eventCount) {
    resetDemoServerState(state, input.eventCount);
  }
  const original = state.events.find((item) => item.id === input.eventId);
  if (!original) return { ok: false, message: 'Esse agendamento de demonstração não existe mais.' };
  if (original.status !== 'pending' && original.status !== 'confirmed') {
    return { ok: false, message: 'Este status é somente leitura; não é possível mover ou redimensionar.' };
  }

  let current: AppointmentWindow;
  let next: AppointmentWindow;
  try {
    current = assertCanonicalWindow(input.current);
    next = assertCanonicalWindow(input.next);
  } catch {
    return { ok: false, message: 'O intervalo de horário é inválido. O cartão foi restaurado.' };
  }
  if (current.timeZone !== DEMO_TIME_ZONE || next.timeZone !== DEMO_TIME_ZONE) {
    return { ok: false, message: 'O fuso da unidade mudou. Atualize a agenda antes de salvar.' };
  }
  if (current.startAt !== original.startAt || current.endAt !== original.endAt) {
    return { ok: false, message: 'Este agendamento mudou em outra ação. Atualize a agenda e tente novamente.' };
  }
  if (!isOnFiveMinuteGrid(next.startAt) || !isOnFiveMinuteGrid(next.endAt)) {
    return { ok: false, message: 'Escolha um horário em passos de 5 minutos.' };
  }

  const currentDuration = minutesBetween(current.startAt, current.endAt);
  const nextDuration = minutesBetween(next.startAt, next.endAt);
  if (input.action === 'move' && nextDuration !== currentDuration) {
    return { ok: false, message: 'Mover o cartão não altera a duração do atendimento.' };
  }
  if (input.action === 'resize' && current.startAt !== next.startAt) {
    return { ok: false, message: 'Redimensionar só altera o fim do atendimento.' };
  }
  if (input.action === 'resize' && nextDuration < 5) {
    return { ok: false, message: 'A duração mínima é de 5 minutos.' };
  }

  const proposed: SpikeEvent = { ...original, ...next };
  const conflict = state.events.find((other) =>
    other.id !== original.id
    && other.professionalId === original.professionalId
    && activeForConflict(other)
    && overlaps(proposed, other),
  );
  if (conflict) {
    const pro = PROFESSIONALS.find((item) => item.id === original.professionalId)?.name || 'Este profissional';
    const other = eventPresentation({ customerName: conflict.customerName, serviceName: conflict.serviceName, status: conflict.status });
    return {
      ok: false,
      message: `${pro} já tem ${other.serviceLabel} nesse intervalo. O horário original foi restaurado.`,
    };
  }

  state.events = state.events.map((item) => item.id === original.id ? proposed : item);
  return {
    ok: true,
    event: proposed,
    message: input.action === 'move'
      ? 'Horário validado no servidor de demonstração.'
      : 'Nova duração validada no servidor de demonstração.',
  };
}
