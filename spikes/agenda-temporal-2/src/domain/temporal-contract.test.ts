import { describe, expect, it } from 'vitest';
import {
  createWindow,
  eventPresentation,
  instantToLocalDateTime,
  libraryView,
  localDateTimeToInstant,
  moveWindow,
  resizeToDuration,
  resizeWindow,
  requireTimeZone,
  resolveWindow,
  selectWindow,
  snapInstant,
  viewForViewport,
} from './temporal-contract';
import {
  benchmarkEvents,
  DAY_PROFESSIONALS,
  DEMO_TIME_ZONE,
  demoEvents,
  eventHasSlotConflicts,
  eventResources,
  SERVICES,
} from './fixtures';
import { createDemoServerState, validateDemoMutation } from './server-mock';

describe('Agenda Temporal 2.0 — contrato independente dos adapters', () => {
  it('mapeia Dia/Semana/Lista para cada adapter sem misturar domínio e biblioteca', () => {
    expect(libraryView('grid', 'day')).toBe('day');
    expect(libraryView('grid', 'week')).toBe('week');
    expect(libraryView('rbc', 'day')).toBe('day');
    expect(libraryView('rbc', 'week')).toBe('week');
    expect(libraryView('rbc', 'list')).toBe('agenda');
    expect(libraryView('fullcalendar', 'day')).toBe('timeGridDay');
    expect(libraryView('fullcalendar', 'week')).toBe('timeGridWeek');
    expect(libraryView('schedule-x', 'day')).toBe('day');
    expect(libraryView('schedule-x', 'week')).toBe('week');
    expect(libraryView('schedule-x', 'list')).toBe('list');
  });

  it('seleciona 10:00–10:40 com fim exclusivo e fuso da unidade', () => {
    const rawStart = localDateTimeToInstant('2026-10-05', '10:02', DEMO_TIME_ZONE);
    const rawEnd = localDateTimeToInstant('2026-10-05', '10:38', DEMO_TIME_ZONE);
    const selected = selectWindow(rawStart, rawEnd, DEMO_TIME_ZONE, 5);

    expect(instantToLocalDateTime(selected.startAt, DEMO_TIME_ZONE)).toEqual({ date: '2026-10-05', time: '10:00' });
    expect(instantToLocalDateTime(selected.endAt, DEMO_TIME_ZONE)).toEqual({ date: '2026-10-05', time: '10:40' });
    expect(selected.durationMin).toBe(40);
    expect(selected.startAt).toBe('2026-10-05T13:00:00.000Z');
    expect(selected.endAt).toBe('2026-10-05T13:40:00.000Z');
  });

  it('move 10:00→11:15 preserva os 40 minutos congelados', () => {
    const current = createWindow('2026-10-05', '10:00', 40, DEMO_TIME_ZONE);
    const moved = moveWindow(current, localDateTimeToInstant('2026-10-05', '11:15', DEMO_TIME_ZONE));
    expect(instantToLocalDateTime(moved.startAt, DEMO_TIME_ZONE).time).toBe('11:15');
    expect(instantToLocalDateTime(moved.endAt, DEMO_TIME_ZONE).time).toBe('11:55');
    expect(moved.durationMin).toBe(40);
  });

  it('resize 40→55 e arredonda movimento em passos de 5 minutos', () => {
    const current = createWindow('2026-10-05', '10:00', 40, DEMO_TIME_ZONE);
    const resized = resizeWindow(current, localDateTimeToInstant('2026-10-05', '10:54', DEMO_TIME_ZONE));
    expect(resized.durationMin).toBe(55);
    expect(instantToLocalDateTime(resized.endAt, DEMO_TIME_ZONE).time).toBe('10:55');
    expect(resizeToDuration(current, 52).durationMin).toBe(50);
    expect(instantToLocalDateTime(snapInstant(localDateTimeToInstant('2026-10-05', '10:02', DEMO_TIME_ZONE), DEMO_TIME_ZONE), DEMO_TIME_ZONE).time).toBe('10:00');
    expect(instantToLocalDateTime(snapInstant(localDateTimeToInstant('2026-10-05', '10:03', DEMO_TIME_ZONE), DEMO_TIME_ZONE), DEMO_TIME_ZONE).time).toBe('10:05');
  });

  it('exige timezone IANA explícito e mantém start/end coerentes em São Paulo e Nova York', () => {
    expect(() => requireTimeZone(undefined)).toThrow('precisa ser informado explicitamente');
    expect(() => requireTimeZone('Mars/Olympus_Mons')).toThrow('Fuso IANA inválido');

    const saoPaulo = createWindow('2026-01-15', '10:00', 40, 'America/Sao_Paulo');
    const newYork = createWindow('2026-01-15', '10:00', 40, 'America/New_York');
    expect(saoPaulo.startAt).toBe('2026-01-15T13:00:00.000Z');
    expect(saoPaulo.endAt).toBe('2026-01-15T13:40:00.000Z');
    expect(newYork.startAt).toBe('2026-01-15T15:00:00.000Z');
    expect(newYork.endAt).toBe('2026-01-15T15:40:00.000Z');
    expect(instantToLocalDateTime(saoPaulo.startAt, 'America/Sao_Paulo')).toEqual({ date: '2026-01-15', time: '10:00' });
    expect(instantToLocalDateTime(newYork.startAt, 'America/New_York')).toEqual({ date: '2026-01-15', time: '10:00' });
    expect(() => localDateTimeToInstant('2026-03-08', '02:30', 'America/New_York')).toThrow();
    expect(() => localDateTimeToInstant('2026-11-01', '01:30', 'America/New_York')).toThrow();
  });

  it('migra date/time legado uma vez e conserva o snapshot canônico', () => {
    const legacy = resolveWindow({ date: '2026-10-05', time: '10:00', serviceDurationDefault: 45 }, DEMO_TIME_ZONE);
    expect(legacy.source).toBe('legacy');
    expect(legacy.inferredDuration).toBe(true);
    expect(legacy.window.durationMin).toBe(45);
    const canonical = resolveWindow({ ...legacy.window, durationMin: 45, serviceDurationDefault: 90 }, DEMO_TIME_ZONE);
    expect(canonical.source).toBe('canonical');
    expect(canonical.inferredDuration).toBe(false);
    expect(canonical.window.durationMin).toBe(45);
  });

  it('renderiza status sem depender só de cor e mantém evento customizável/legível', () => {
    const event = eventPresentation({ customerName: 'Marina Costa · Luna', serviceName: 'Consulta clínica', status: 'confirmed' });
    expect(event.ariaLabel).toContain('Marina Costa · Luna');
    expect(event.ariaLabel).toContain('Consulta clínica');
    expect(event.statusLabel).toBe('Confirmado');
    expect(event.tone).toBe('confirmed');
    expect(eventPresentation({ customerName: 'Paciente', serviceName: 'Vacina V8', status: 'no_show' }).statusLabel).toBe('Não compareceu');
  });

  it('seleciona Lista como vista padrão até 600 px e respeita a vista preferida acima disso', () => {
    expect(viewForViewport(390, 'day')).toBe('list');
    expect(viewForViewport(600, 'week')).toBe('list');
    expect(viewForViewport(601, 'week')).toBe('week');
  });

  it('prepara Dia com Orlando/Ana/Carlos e procedimento de 90 min; mantém 5 profissionais no benchmark', () => {
    const events = demoEvents();
    expect(DAY_PROFESSIONALS.map((professional) => professional.name)).toEqual(['Dr. Orlando', 'Dra. Ana', 'Dr. Carlos']);
    expect(eventResources(DAY_PROFESSIONALS)).toHaveLength(3);
    expect(events).toHaveLength(7);
    expect(new Set(events.map((event) => event.professionalId)).size).toBe(3);
    expect(SERVICES.find((service) => service.durationMin === 90)?.name).toBe('Procedimento clínico');
    const longProcedure = events.find((event) => event.id === 'booking-carlos-procedimento-90')!;
    expect(longProcedure.durationMin).toBe(90);
    expect(longProcedure.status).toBe('confirmed');
    expect(new Set(eventResources().map((resource) => resource.id)).size).toBe(5);
  });

  it('mantém cargas reprodutíveis de 200/1000 eventos sem conflito ativo', () => {
    expect(eventResources()).toHaveLength(5);
    for (const count of [200, 1_000]) {
      const events = benchmarkEvents(count);
      expect(events).toHaveLength(count);
      expect(new Set(events.map((event) => event.professionalId)).size).toBe(5);
      const active = events.filter((event) => event.status === 'pending' || event.status === 'confirmed');
      for (let index = 0; index < active.length; index++) {
        for (let other = index + 1; other < active.length; other++) {
          if (active[index]!.professionalId === active[other]!.professionalId) {
            expect(eventHasSlotConflicts(active[index]!, active[other]!)).toBe(false);
          }
        }
      }
    }
  });
});

describe('Servidor efêmero de demonstração', () => {
  it('serializa duas tentativas de move para o mesmo slot e mantém a regra de conflito no servidor', () => {
    const state = createDemoServerState(7);
    const first = state.events.find((event) => event.id === 'booking-orlando-1000')!;
    const second = state.events.find((event) => event.id === 'booking-orlando-conflict')!;
    const firstCurrent = { startAt: first.startAt, endAt: first.endAt, durationMin: first.durationMin, timeZone: first.timeZone };
    const secondCurrent = { startAt: second.startAt, endAt: second.endAt, durationMin: second.durationMin, timeZone: second.timeZone };
    const contestedStart = localDateTimeToInstant('2026-10-05', '11:15', DEMO_TIME_ZONE);
    const firstMove = moveWindow(firstCurrent, contestedStart);
    const secondMove = moveWindow(secondCurrent, contestedStart);

    const accepted = validateDemoMutation({ action: 'move', eventId: first.id, current: firstCurrent, next: firstMove }, state);
    expect(accepted.ok).toBe(true);
    const rejected = validateDemoMutation({ action: 'move', eventId: second.id, current: secondCurrent, next: secondMove }, state);
    expect(rejected.ok).toBe(false);
    expect(rejected.message).toContain('já tem');
    expect(state.events.find((event) => event.id === first.id)?.startAt).toBe(firstMove.startAt);
    expect(state.events.find((event) => event.id === second.id)?.startAt).toBe(second.startAt);
  });

  it('aceita move/resize depois de validar; conflito e estado obsoleto revertem sem mutar', () => {
    const state = createDemoServerState(7);
    const original = state.events.find((event) => event.id === 'booking-orlando-1000')!;
    const current = {
      startAt: original.startAt,
      endAt: original.endAt,
      durationMin: original.durationMin,
      timeZone: original.timeZone,
    };
    const nextMove = moveWindow(current, localDateTimeToInstant('2026-10-05', '11:15', DEMO_TIME_ZONE));
    const moved = validateDemoMutation({ action: 'move', eventId: original.id, current, next: nextMove }, state);
    expect(moved.ok).toBe(true);
    expect(moved.event?.durationMin).toBe(40);
    expect(instantToLocalDateTime(moved.event!.startAt, DEMO_TIME_ZONE).time).toBe('11:15');

    const movedWindow = {
      startAt: moved.event!.startAt,
      endAt: moved.event!.endAt,
      durationMin: moved.event!.durationMin,
      timeZone: moved.event!.timeZone,
    };
    const conflictMove = moveWindow(movedWindow, localDateTimeToInstant('2026-10-05', '12:30', DEMO_TIME_ZONE));
    const beforeRejectedMove = state.events.find((event) => event.id === original.id)!.startAt;
    const conflict = validateDemoMutation({ action: 'move', eventId: original.id, current: movedWindow, next: conflictMove }, state);
    expect(conflict.ok).toBe(false);
    expect(conflict.message).toContain('já tem');
    expect(state.events.find((event) => event.id === original.id)!.startAt).toBe(beforeRejectedMove);

    const stale = validateDemoMutation({ action: 'move', eventId: original.id, current, next: nextMove }, state);
    expect(stale.ok).toBe(false);
    expect(stale.message).toContain('mudou em outra ação');
  });

  it('aceita resize somente de fim, e mantém eventos terminais como leitura', () => {
    const state = createDemoServerState(7);
    const original = state.events.find((event) => event.id === 'booking-orlando-1000')!;
    const current = { startAt: original.startAt, endAt: original.endAt, durationMin: original.durationMin, timeZone: original.timeZone };
    const next = resizeWindow(current, localDateTimeToInstant('2026-10-05', '10:55', DEMO_TIME_ZONE));
    const resized = validateDemoMutation({ action: 'resize', eventId: original.id, current, next }, state);
    expect(resized.ok).toBe(true);
    expect(resized.event?.durationMin).toBe(55);

    const completed = state.events.find((event) => event.status === 'completed')!;
    const readOnly = validateDemoMutation({
      action: 'move',
      eventId: completed.id,
      current: { startAt: completed.startAt, endAt: completed.endAt, durationMin: completed.durationMin, timeZone: completed.timeZone },
      next: moveWindow(completed, completed.startAt),
    }, state);
    expect(readOnly.ok).toBe(false);
    expect(readOnly.message).toContain('somente leitura');
  });
});
