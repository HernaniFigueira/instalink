import { describe, it, expect } from 'vitest';
import {
  filterEntries, summarize, periodBars, plannedVsRealized, methodSlices, validateEntry,
} from '../finance';
import type { FinanceEntry } from '../types';

const e = (over: Partial<FinanceEntry>): FinanceEntry => ({
  id: over.id || 'x', businessId: 'b1', kind: 'receita', status: 'pago', amount: 10000,
  description: 'Mov', dueDate: '2026-09-10', paidAt: '2026-09-10', method: 'pix',
  contactId: '', bookingId: '', serviceId: '', professionalId: '', encounterId: '', note: '',
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', createdBy: 'u1',
  ...over,
});

describe('P7 · financeiro básico (motor puro)', () => {
  it('filtros: período, status, tipo, profissional, serviço, forma', () => {
    const list = [
      e({ id: '1', dueDate: '2026-09-01', status: 'pago' }),
      e({ id: '2', dueDate: '2026-09-15', status: 'pendente' }),
      e({ id: '3', dueDate: '2026-08-20', kind: 'despesa', status: 'pago' }),
      e({ id: '4', dueDate: '2026-09-10', professionalId: 'p1', method: 'cash' }),
    ];
    expect(filterEntries(list, { from: '2026-09-01', to: '2026-09-30' }).map((x) => x.id)).toEqual(['1', '2', '4']);
    expect(filterEntries(list, { status: 'pago' }).map((x) => x.id)).toEqual(['1', '3', '4']);
    expect(filterEntries(list, { kind: 'despesa' }).map((x) => x.id)).toEqual(['3']);
    expect(filterEntries(list, { professionalId: 'p1' }).map((x) => x.id)).toEqual(['4']);
    expect(filterEntries(list, { method: 'cash' }).map((x) => x.id)).toEqual(['4']);
  });

  it('summary: previsto/pendente/recebido/despesas/saldo/ticket (centavos)', () => {
    const list = [
      e({ id: 'r1', status: 'pago', amount: 50000 }),           // receita paga
      e({ id: 'r2', status: 'pago', amount: 30000 }),           // receita paga
      e({ id: 'r3', status: 'previsto', amount: 20000 }),
      e({ id: 'r4', status: 'pendente', amount: 10000 }),
      e({ id: 'd1', kind: 'despesa', status: 'pago', amount: 15000 }),
      e({ id: 'd2', kind: 'despesa', status: 'pendente', amount: 5000 }),
      e({ id: 'r5', status: 'cancelado', amount: 99999 }),      // fora de tudo
    ];
    const s = summarize(list);
    expect(s.receitaRecebida).toBe(80000);
    expect(s.receitaPrevista).toBe(20000);
    expect(s.receitaPendente).toBe(10000);
    expect(s.despesasPagas).toBe(15000);
    expect(s.despesasProjetadas).toBe(5000);
    expect(s.saldo).toBe(65000);
    expect(s.pagamentosCount).toBe(2);
    expect(s.ticketMedio).toBe(40000);
    // sem pagamentos → ticket 0 (nunca NaN/divisão por zero)
    expect(summarize([]).ticketMedio).toBe(0);
  });

  it('periodBars agrega por dia/dia-semana conforme a janela; cancelado fica de fora', () => {
    const list = [
      e({ dueDate: '2026-09-01', amount: 1000, status: 'pago' }),
      e({ dueDate: '2026-09-01', amount: 2000, kind: 'despesa', status: 'pago' }),
      e({ dueDate: '2026-09-02', amount: 5000, status: 'cancelado' }),
    ];
    const bars = periodBars(list, '2026-09-01', '2026-09-03');
    expect(bars).toHaveLength(3);
    expect(bars[0].receita).toBe(1000);
    expect(bars[0].despesa).toBe(2000);
    expect(bars[1].receita).toBe(0); // cancelado não soma
    expect(periodBars(list, '', '')).toEqual([]);
  });

  it('plannedVsRealized e methodSlices', () => {
    const list = [
      e({ status: 'pago', amount: 1000, method: 'pix' }),
      e({ status: 'pago', amount: 2000, method: 'card' }),
      e({ status: 'pendente', amount: 4000 }),
      e({ kind: 'despesa', status: 'pago', amount: 500, method: 'cash' }),
    ];
    const p = plannedVsRealized(list);
    expect(p.find((x) => x.label === 'Receitas')).toEqual({ label: 'Receitas', previsto: 4000, realizado: 3000 });
    expect(p.find((x) => x.label === 'Despesas')).toEqual({ label: 'Despesas', previsto: 0, realizado: 500 });
    const m = methodSlices(list);
    expect(m[0]).toEqual({ method: 'card', label: 'Cartão', amount: 2000 });
    expect(m.map((x) => x.method)).toEqual(['card', 'pix']); // só receitas pagas
  });

  it('validateEntry: valor, tipo, status, datas, descrição', () => {
    expect(validateEntry({ amount: 0, kind: 'receita', status: 'pago', dueDate: '2026-09-01', paidAt: '2026-09-01', description: 'X' })).toContain('valor');
    expect(validateEntry({ amount: 100, kind: 'x' as any, status: 'pago', dueDate: '2026-09-01', paidAt: '2026-09-01', description: 'X' })).toContain('receita');
    expect(validateEntry({ amount: 100, kind: 'receita', status: 'pago', dueDate: '2026-09-01', paidAt: '', description: 'X' })).toContain('pagamento');
    expect(validateEntry({ amount: 100, kind: 'receita', status: 'pago', dueDate: '2026-09-01', paidAt: '2026-09-01', description: '  ' })).toContain('Descreva');
    expect(validateEntry({ amount: 100, kind: 'receita', status: 'previsto', dueDate: '2026-09-01', paidAt: '', description: 'X' })).toBe('');
  });
});
