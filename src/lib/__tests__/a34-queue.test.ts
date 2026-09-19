// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 4 — A FILA (regras) E O ENCAIXE (conflito dito na cara)
// ═══════════════════════════════════════════════════════════════
// Travas deste bloco:
//   • fila NÃO é agenda — ela tem entidade própria e não cria Booking;
//   • a ordem é por chegada; o tempo de espera congela quando o atendimento
//     começa (ninguém "espera" durante o próprio atendimento);
//   • a máquina de estados recusa caminho inventado (done → waiting etc.);
//   • encaixe diz COM QUEM o horário bate — e só a equipe encaixa.
import { describe, expect, it } from 'vitest';
import {
  QUEUE_LONG_WAIT_MIN, QUEUE_STATUS, activeQueue, nextToCall, queueForDay, queuePosition,
  queueSummary, queueTransitionAllowed, waitLabel, waitMinutes,
} from '../queue';
import { fitInConflicts, fitInConflictsFromDB, fitInWarning, occupiesGrid } from '../fit-in';
import type { Booking, QueueEntry } from '../types';

const at = (min: number) => new Date(Date.UTC(2026, 8, 19, 12, min)).toISOString();

function entry(partial: Partial<QueueEntry> & { id: string }): QueueEntry {
  return {
    businessId: 'b1', customerName: 'Cliente', customerPhone: '11999998888', contactId: '',
    serviceId: '', professionalId: '', bookingId: '', note: '', status: 'waiting',
    date: '2026-09-19', createdAt: at(0), calledAt: '', startedAt: '', endedAt: '',
    updatedBy: '', updatedAt: at(0), ...partial,
  };
}

const now = new Date(Date.UTC(2026, 8, 19, 12, 40));

describe('A3.4 · Bloco 4 — fila de espera', () => {
  it('a ordem é a de chegada e a posição é estável', () => {
    const list = [
      entry({ id: 'c', createdAt: at(20) }),
      entry({ id: 'a', createdAt: at(5) }),
      entry({ id: 'b', createdAt: at(12) }),
    ];
    expect(queueForDay(list, 'b1', '2026-09-19').map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(queuePosition(list, 'b1', '2026-09-19', 'b')).toBe(2);
    expect(queuePosition(list, 'b1', '2026-09-19', 'z')).toBe(0);
  });

  it('encerrados e de outras unidades/dias saem da fila', () => {
    const list = [
      entry({ id: 'ok', createdAt: at(1) }),
      entry({ id: 'done', status: 'done' }),
      entry({ id: 'left', status: 'left' }),
      entry({ id: 'outra', businessId: 'b2' }),
      entry({ id: 'ontem', date: '2026-09-18' }),
    ];
    expect(queueForDay(list, 'b1', '2026-09-19').map((e) => e.id)).toEqual(['ok']);
    // A fila VIVA ignora a virada do dia (fila que passou da meia-noite não
    // desaparece da tela), mas nunca inclui encerrados nem outra unidade.
    expect(activeQueue(list, 'b1').map((e) => e.id)).toEqual(['ok', 'ontem']);
  });

  it('tempo de espera congela quando o atendimento começa', () => {
    const waiting = entry({ id: 'w', createdAt: at(0) });
    expect(waitMinutes(waiting, now)).toBe(40);
    const started = entry({ id: 's', createdAt: at(0), startedAt: at(15), status: 'in_service' });
    expect(waitMinutes(started, now)).toBe(15); // esperou 15 min, não 40
    const done = entry({ id: 'd', createdAt: at(0), startedAt: at(10), endedAt: at(35), status: 'done' });
    expect(waitMinutes(done, now)).toBe(10);
  });

  it('resumo do dia: quem aguarda, quem está em atendimento e a maior espera', () => {
    const list = [
      entry({ id: 'a', createdAt: at(0) }),
      entry({ id: 'b', createdAt: at(10), status: 'called' }),
      entry({ id: 'c', createdAt: at(20), startedAt: at(25), status: 'in_service' }),
      entry({ id: 'd', createdAt: at(30), status: 'done', startedAt: at(32), endedAt: at(33) }),
    ];
    const s = queueSummary(list, 'b1', '2026-09-19', now);
    expect(s.waiting).toBe(1);
    expect(s.called).toBe(1);
    expect(s.inService).toBe(1);
    expect(s.longestWaitMin).toBe(40);
    expect(s.longWait).toBe(QUEUE_LONG_WAIT_MIN <= 40);
    expect(s.next?.id).toBe('a');
    expect(nextToCall(list, 'b1', '2026-09-19')?.id).toBe('a');
  });

  it('quem já foi chamado não é "o próximo a chamar"', () => {
    const list = [entry({ id: 'a', status: 'called' }), entry({ id: 'b', createdAt: at(9) })];
    expect(nextToCall(list, 'b1', '2026-09-19')?.id).toBe('b');
  });

  it('máquina de estados: nada de caminho inventado', () => {
    expect(queueTransitionAllowed('waiting', 'called')).toBe(true);
    expect(queueTransitionAllowed('called', 'waiting')).toBe(true);   // chamou errado
    expect(queueTransitionAllowed('in_service', 'done')).toBe(true);
    expect(queueTransitionAllowed('done', 'waiting')).toBe(false);
    expect(queueTransitionAllowed('left', 'called')).toBe(false);
    expect(queueTransitionAllowed('waiting', 'waiting')).toBe(false);
    expect(QUEUE_STATUS.done.active).toBe(false);
    expect(QUEUE_STATUS.waiting.active).toBe(true);
  });

  it('rótulo de espera é legível para o balcão', () => {
    expect(waitLabel(0)).toBe('agora');
    expect(waitLabel(12)).toBe('12 min');
    expect(waitLabel(60)).toBe('1h');
    expect(waitLabel(65)).toBe('1h05');
  });
});

describe('A3.4 · Bloco 4 — encaixe (fit_in)', () => {
  const booking = (partial: Partial<Booking> & { id: string }): Booking => ({
    businessId: 'b1', customerId: '', serviceId: 's1', professionalId: 'p1',
    date: '2026-09-19', time: '09:00', customerName: 'Ana', customerPhone: '11999998888',
    status: 'confirmed', note: '', answers: [], createdAt: at(0), updatedAt: at(0), history: [],
    ...partial,
  });
  const pros = [{ id: 'p1', name: 'Bia' }, { id: 'p2', name: 'Caio' }];
  const duration = new Map([['s1', 60], ['s2', 30]]);

  const run = (bookings: Booking[], q: Partial<Parameters<typeof fitInConflicts>[2]>) =>
    fitInConflicts(
      bookings.map((b) => ({ ...b, durationMin: duration.get(b.serviceId) || 30 })),
      pros,
      { date: '2026-09-19', time: '09:30', durationMin: 60, professionalId: 'p1', ...q },
    );

  it('só estados ativos ocupam a grade', () => {
    expect(occupiesGrid('confirmed')).toBe(true);
    expect(occupiesGrid('pending')).toBe(true);
    expect(occupiesGrid('completed')).toBe(false);
    expect(occupiesGrid('cancelled')).toBe(false);
    expect(occupiesGrid('no_show')).toBe(false);
  });

  it('diz com quem bate: sobreposição real no mesmo profissional', () => {
    const conflicts = run([booking({ id: 'x', time: '09:00' })], {});
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ id: 'x', customerName: 'Ana', time: '09:00', endTime: '10:00', professionalName: 'Bia' });
    expect(fitInWarning(conflicts)).toContain('Ana');
    expect(fitInWarning(conflicts)).toContain('09:00');
  });

  it('encaixe encostado (fim = começo) NÃO é conflito', () => {
    expect(run([booking({ id: 'x', time: '08:00' })], {})).toHaveLength(0); // 08:00–09:00 × 09:30
    expect(run([booking({ id: 'x', time: '10:30' })], {})).toHaveLength(0); // começa depois
  });

  it('outro profissional não bloqueia o encaixe do escolhido', () => {
    expect(run([booking({ id: 'x', professionalId: 'p2' })], { professionalId: 'p1' })).toHaveLength(0);
    // Mas quando o encaixe é "qualquer um", a equipe inteira importa.
    const team = run([booking({ id: 'x', professionalId: 'p2' })], { professionalId: '' });
    expect(team).toHaveLength(1);
    expect(team[0].kind).toBe('team');
  });

  it('atendimento terminal no mesmo horário não gera aviso falso', () => {
    expect(run([booking({ id: 'x', status: 'completed' })], {})).toHaveLength(0);
  });

  it('a partir do banco, usa a duração do serviço de CADA agendamento', () => {
    const conflicts = fitInConflictsFromDB({
      bookings: [
        booking({ id: 'curto', serviceId: 's2', time: '09:00' }),   // 30 min → 09:00–09:30
        booking({ id: 'longo', serviceId: 's1', time: '09:30' }),   // 60 min → 09:30–10:30
      ],
      services: [
        { id: 's1', durationMin: 60 } as any,
        { id: 's2', durationMin: 30 } as any,
      ],
      professionals: pros,
    }, { date: '2026-09-19', time: '09:15', durationMin: 30, professionalId: 'p1' });
    // 09:15–09:45 toca os dois: o curto até 09:30 e o longo a partir de 09:30.
    expect(conflicts.map((c) => c.id)).toEqual(['curto', 'longo']);
    expect(conflicts[0].endTime).toBe('09:30');
    expect(conflicts[1].endTime).toBe('10:30');
  });

  it('sem conflito, o aviso é vazio (nada de susto desnecessário)', () => {
    expect(fitInWarning([])).toBe('');
  });
});
