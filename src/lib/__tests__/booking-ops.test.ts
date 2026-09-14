import { describe, expect, it } from 'vitest';
import {
  bookingActions, bookingDuration, needsClosure, pendingClosures, rescheduleDecision,
  rescheduleForwardNote, rescheduleNote, summarizeDay, isTerminal,
} from '../booking-ops';
import { BOOKING_FLOW, canTransition } from '../status';
import type { Booking, Service } from '../types';

function service(partial: Partial<Service> = {}): Service {
  return {
    id: 's1', businessId: 'b1', name: 'Corte', description: '', price: 5000, promoPrice: 0,
    durationMin: 60, active: true, bookable: true, professionalIds: [], order: 0, ...partial,
  } as Service;
}

function booking(partial: Partial<Booking> = {}): Booking {
  return {
    id: 'bk1', businessId: 'b1', customerId: '', customerName: 'Ana', customerPhone: '11999999999',
    customerEmail: '', serviceId: 's1', professionalId: '', date: '2026-09-10', time: '14:00',
    status: 'confirmed', answers: [], note: '', history: [], createdAt: '', ...partial,
  } as Booking;
}

const services = { s1: service() };

describe('agenda — pendência de fechamento (nada conclui sozinho)', () => {
  it('atendimento de ontem em aberto precisa de fechamento', () => {
    expect(needsClosure(booking({ date: '2026-09-10' }), 60, '2026-09-13', '09:00')).toBe(true);
  });

  it('atendimento de hoje ainda no horário NÃO é pendência', () => {
    expect(needsClosure(booking({ date: '2026-09-13', time: '15:00' }), 60, '2026-09-13', '14:30')).toBe(false);
  });

  it('atendimento de hoje com o fim do horário já passado é pendência', () => {
    expect(needsClosure(booking({ date: '2026-09-13', time: '10:00' }), 60, '2026-09-13', '11:30')).toBe(true);
    // exatamente no fim do horário ainda não é pendência
    expect(needsClosure(booking({ date: '2026-09-13', time: '10:00' }), 60, '2026-09-13', '11:00')).toBe(false);
  });

  it('status final nunca é pendência', () => {
    for (const status of ['completed', 'cancelled', 'no_show'] as const) {
      expect(needsClosure(booking({ date: '2026-01-01', status }), 60, '2026-09-13', '09:00')).toBe(false);
      expect(isTerminal(status)).toBe(true);
    }
    expect(isTerminal('pending')).toBe(false);
  });

  it('pendências vêm ordenadas da mais antiga para a mais recente', () => {
    const list = pendingClosures([
      booking({ id: 'b', date: '2026-09-11' }),
      booking({ id: 'a', date: '2026-09-09' }),
      booking({ id: 'c', date: '2026-09-13', status: 'completed' }),
      booking({ id: 'd', date: '2026-09-12' }),
    ], services, '2026-09-13', '18:00');
    expect(list.map((b) => b.id)).toEqual(['a', 'b', 'd']);
  });

  it('resumo do dia separa os status e conta as pendências', () => {
    const day = '2026-09-13';
    const s = summarizeDay([
      booking({ id: '1', date: day, time: '09:00', status: 'completed' }),
      booking({ id: '2', date: day, time: '10:00', status: 'pending' }),
      booking({ id: '3', date: day, time: '11:00', status: 'no_show' }),
      booking({ id: '4', date: day, time: '12:00', status: 'cancelled' }),
      booking({ id: '5', date: day, time: '16:00', status: 'confirmed' }),
      booking({ id: '6', date: '2026-09-14', time: '10:00', status: 'pending' }),
    ], day, services, day, '15:00');
    expect(s.total).toBe(5);
    expect(s.completed).toBe(1);
    expect(s.noShow).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(s.pending).toBe(1);
    expect(s.confirmed).toBe(1);
    expect(s.needsClosure).toBe(1); // 10:00 pendente e já passou
  });

  it('duração usa o serviço e cai no padrão quando ele não existe', () => {
    expect(bookingDuration(service({ durationMin: 45 }))).toBe(45);
    expect(bookingDuration(undefined, 30)).toBe(30);
  });
});

describe('agenda — reagendamento com histórico honesto', () => {
  it('aguardando confirmação: move o mesmo registro e mantém o status', () => {
    const d = rescheduleDecision('pending');
    expect(d.kind).toBe('move');
    expect(d.nextStatus).toBe('pending');
  });

  it('confirmado: move o mesmo registro e continua confirmado', () => {
    const d = rescheduleDecision('confirmed');
    expect(d.kind).toBe('move');
    expect(d.nextStatus).toBe('confirmed');
  });

  it('concluído: NÃO volta para "pendente" no mesmo registro — cria novo atendimento', () => {
    const d = rescheduleDecision('completed');
    expect(d.kind).toBe('recreate');
    expect(d.nextStatus).toBe('pending');
  });

  it('falta e cancelamento também geram novo registro (histórico preservado)', () => {
    expect(rescheduleDecision('no_show').kind).toBe('recreate');
    expect(rescheduleDecision('cancelled').kind).toBe('recreate');
    expect(rescheduleDecision('cancelled').nextStatus).toBe('pending');
  });

  it('a nota do histórico descreve a mudança nos dois registros', () => {
    expect(rescheduleNote({ date: '2026-09-09', time: '14:00' }, { date: '2026-09-16', time: '15:30' }))
      .toBe('Reagendado de 09/09 14:00 para 16/09 15:30');
    expect(rescheduleForwardNote({ date: '2026-09-16', time: '15:30' }))
      .toBe('Reagendado para 16/09 15:30 (novo atendimento criado)');
  });

  it('reagendar um CONCLUÍDO preserva o registro antigo (histórico nunca é apagado)', () => {
    // Contrato §16: o atendimento concluído permanece como está; o novo
    // horário entra como NOVO agendamento pendente apontando para o anterior
    // (previousId) — nada na decisão reescreve status/histórico do antigo.
    const concluded = { id: 'b-old', status: 'completed' as const, date: '2026-09-09', time: '10:00' };
    const decision = rescheduleDecision(concluded.status);
    expect(decision.kind).toBe('recreate');
    expect(decision.nextStatus).toBe('pending');
    // a decisão é pura: o status original continua 'completed' (intocado)
    expect(concluded.status).toBe('completed');
    expect(isTerminal('completed')).toBe(true);
    // e a grade de ações do concluído não oferece edição — só reagendamento
    expect(bookingActions('completed')).toEqual([]);
  });

  it('ações do painel usam os rótulos do produto (Concluir / Não compareceu / Cancelar)', () => {
    const labels = bookingActions('confirmed').map((a) => a.label);
    expect(labels).toContain('Concluir');
    expect(labels).toContain('Não compareceu');
    expect(labels).toContain('Cancelar');
  });

  it('ações rápidas por status (painel e detalhe usam a mesma verdade)', () => {
    expect(bookingActions('pending').map((a) => a.status)).toEqual(['confirmed', 'cancelled']);
    expect(bookingActions('confirmed').map((a) => a.status)).toEqual(['completed', 'no_show', 'cancelled']);
    expect(bookingActions('completed')).toEqual([]);
    expect(bookingActions('cancelled').map((a) => a.status)).toEqual(['pending']);
  });

  it('toda ação rápida é uma transição VÁLIDA na máquina de estados', () => {
    for (const status of ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'] as const) {
      for (const action of bookingActions(status)) {
        expect(canTransition(BOOKING_FLOW, status, action.status)).toBe(true);
      }
    }
  });
});
