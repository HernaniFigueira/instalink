// R9 · D · Pendências da Recepção: a tarefa de retorno mostra PACIENTE (pet do
// atendimento, do mesmo tutor e da mesma unidade) e SOLICITANTE (quem pediu).
// Regra de segurança: nunca pet de outro tutor/unidade, nunca "o primeiro" de
// vários pets sem indicação. Só leitura — nada é persistido aqui.
import { describe, expect, it } from 'vitest';
import { taskView } from '@/lib/task-view';

const BIZ = 'biz-1';
const OTHER = 'biz-2';
const TUTOR = 'tutor-bernardo';
const OUTRO_TUTOR = 'tutor-ana';

function db(extra: Record<string, any> = {}) {
  return {
    users: [{ id: 'u-michele', name: 'Dra. Michele Martins' }],
    contacts: [{ id: TUTOR, businessId: BIZ, name: 'Bernardo Almeida', customerId: '' }],
    pets: [
      { id: 'pet-thor', businessId: BIZ, tutorId: TUTOR, name: 'Thor' },
      { id: 'pet-luna', businessId: BIZ, tutorId: TUTOR, name: 'Luna' },
      { id: 'pet-alheio', businessId: BIZ, tutorId: OUTRO_TUTOR, name: 'Mel' },
      { id: 'pet-outra-unidade', businessId: OTHER, tutorId: TUTOR, name: 'Fantasma' },
    ],
    encounters: [
      { id: 'enc-1', businessId: BIZ, petId: 'pet-thor', contactId: TUTOR },
      { id: 'enc-alheio', businessId: BIZ, petId: 'pet-alheio', contactId: TUTOR },
      { id: 'enc-outra', businessId: OTHER, petId: 'pet-thor', contactId: TUTOR },
      { id: 'enc-sem-pet', businessId: BIZ, petId: '', contactId: TUTOR },
    ],
    bookings: [],
    ...extra,
  };
}

function task(over: Record<string, any> = {}) {
  return {
    id: 't-1', businessId: BIZ, title: 'Agendar retorno de Bernardo Almeida', note: 'Ligar em 30 dias',
    status: 'open', dueAt: '', createdAt: '2026-10-11T22:00:00Z', updatedAt: '', doneAt: '',
    assignedUserId: '', createdBy: 'u-michele', source: 'manual',
    customerId: TUTOR, encounterId: 'enc-1', bookingId: '',
    ...over,
  } as any;
}

describe('Pendências · paciente e solicitante na tarefa de retorno', () => {
  it('mostra o pet do atendimento (mesmo tutor, mesma unidade) e quem pediu', () => {
    const v = taskView(db(), task(), '2026-10-11');
    expect(v.patientName).toBe('Thor');
    expect(v.requesterName).toBe('Dra. Michele Martins');
  });

  it('nunca mostra pet de outro tutor, mesmo vinculado ao atendimento', () => {
    const v = taskView(db(), task({ encounterId: 'enc-alheio' }), '2026-10-11');
    expect(v.patientName).toBe('');
  });

  it('nunca mostra pet de outra unidade (tenant)', () => {
    const v = taskView(db(), task({ encounterId: 'enc-outra' }), '2026-10-11');
    expect(v.patientName).toBe('');
  });

  it('dois pets do tutor sem indicação no atendimento: não escolhe o primeiro', () => {
    const v = taskView(db(), task({ encounterId: 'enc-sem-pet' }), '2026-10-11');
    expect(v.patientName).toBe('');
  });

  it('sem atendimento, usa o pet do agendamento vinculado (mesmo tutor)', () => {
    const d = db({ bookings: [{ id: 'bk-1', businessId: BIZ, petId: 'pet-luna', customerId: TUTOR, date: '2026-10-11', time: '18:30' }] });
    const v = taskView(d, task({ encounterId: '', bookingId: 'bk-1' }), '2026-10-11');
    expect(v.patientName).toBe('Luna');
  });

  it('tarefa criada pela automação mostra "Automação" como solicitante', () => {
    const v = taskView(db(), task({ createdBy: 'automation', encounterId: '' }), '2026-10-11');
    expect(v.requesterName).toBe('Automação');
    expect(v.fromAutomation).toBe(true);
  });

  it('não altera os campos já existentes da visão (contrato preservado)', () => {
    const v = taskView(db(), task(), '2026-10-11');
    expect(v.contactName).toBe('Bernardo Almeida');
    expect(v.contactId).toBe(TUTOR);
    expect(v.dueLabel).toBeTruthy();
    expect(v.title).toBe('Agendar retorno de Bernardo Almeida');
  });
});
