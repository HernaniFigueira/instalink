// ═══════════════════════════════════════════════════════════════
// REGRESSÃO §6 — Financeiro e Dashboard usam os MESMOS conceitos
// ═══════════════════════════════════════════════════════════════
// Cenário real da auditoria: R$ 160 em atendimentos elegíveis
// (Dashboard "previsto") × R$ 0 no Financeiro (nada registrado).
// O contrato agora: AGENDADO/REALIZADO vêm dos atendimentos,
// RECEBIDO só de pagamento registrado, EM ABERTO = realizado − recebido.
import { describe, expect, it } from 'vitest';
import { financeMetrics, FINANCE_METRIC_LABELS } from '../finance-metrics';
import type { FinanceEntry } from '../types';

const b = (status: 'pending' | 'confirmed' | 'completed' | 'cancelled', date: string, price: number) =>
  ({ status, date, price });
const e = (over: Partial<FinanceEntry>): FinanceEntry => ({
  id: 'x', businessId: 'b', kind: 'receita', status: 'pago', amount: 0,
  description: '', dueDate: '2026-09-20', paidAt: '2026-09-20', method: 'pix',
  contactId: '', createdAt: '', ...over,
} as FinanceEntry);

describe('financeMetrics — semântica dos quatro conceitos', () => {
  it('cenário da auditoria: R$160 de atendimentos e NENHUM pagamento → recebido 0, em aberto = realizado', () => {
    const m = financeMetrics({
      bookings: [b('pending', '2026-09-25', 80), b('completed', '2026-09-20', 80)],
      entries: [],
      from: '2026-09-01', to: '2026-09-30',
    });
    expect(m.agendado).toBe(80);
    expect(m.realizado).toBe(80);
    expect(m.recebido).toBe(0);
    expect(m.emAberto).toBe(80);
    expect(m.previsto).toBe(160);
  });

  it('pagamento registrado entra em RECEBIDO e reduz o EM ABERTO', () => {
    const m = financeMetrics({
      bookings: [b('completed', '2026-09-20', 200)],
      entries: [e({ amount: 150, status: 'pago', paidAt: '2026-09-21' })],
      from: '2026-09-01', to: '2026-09-30',
    });
    expect(m.recebido).toBe(150);
    expect(m.emAberto).toBe(50);
    expect(m.pagamentos).toBe(1);
  });

  it('agendamento NUNCA vira dinheiro: pendente/confirmado não mexe em recebido', () => {
    const m = financeMetrics({
      bookings: [b('confirmed', '2026-09-22', 500), b('pending', '2026-09-23', 300)],
      entries: [],
      from: '2026-09-01', to: '2026-09-30',
    });
    expect(m.agendado).toBe(800);
    expect(m.recebido).toBe(0);
    expect(m.emAberto).toBe(0);
  });

  it('cancelado e falta ficam FORA de todos os valores', () => {
    const m = financeMetrics({
      bookings: [b('cancelled', '2026-09-10', 999), b('completed', '2026-09-11', 100)],
      entries: [],
      from: '2026-09-01', to: '2026-09-30',
    });
    expect(m.previsto).toBe(100);
  });

  it('período é pela DATA DO ATENDIMENTO (fora da janela não conta)', () => {
    const m = financeMetrics({
      bookings: [b('completed', '2026-08-31', 400), b('completed', '2026-09-01', 100)],
      entries: [e({ amount: 50, paidAt: '2026-08-15' })],
      from: '2026-09-01', to: '2026-09-30',
    });
    expect(m.realizado).toBe(100);
    expect(m.recebido).toBe(0); // pagamento fora do período não entra
  });

  it('recebido maior que realizado não fabrica "em aberto" negativo', () => {
    const m = financeMetrics({
      bookings: [b('completed', '2026-09-05', 100)],
      entries: [e({ amount: 300, paidAt: '2026-09-06' })],
      from: '2026-09-01', to: '2026-09-30',
    });
    expect(m.emAberto).toBe(0);
    expect(m.recebido).toBe(300);
  });

  it('despesa e receita não paga NÃO entram em recebido', () => {
    const m = financeMetrics({
      bookings: [b('completed', '2026-09-05', 100)],
      entries: [
        e({ kind: 'despesa', amount: 70, paidAt: '2026-09-06' }),
        e({ amount: 60, status: 'pendente', paidAt: '' }),
      ],
      from: '2026-09-01', to: '2026-09-30',
    });
    expect(m.recebido).toBe(0);
  });

  it('rótulos nunca chamam tudo de "receita"', () => {
    expect(FINANCE_METRIC_LABELS.agendado).toBe('Agendado');
    expect(FINANCE_METRIC_LABELS.realizado).toBe('Realizado');
    expect(FINANCE_METRIC_LABELS.recebido).toBe('Recebido');
    expect(FINANCE_METRIC_LABELS.emAberto).toBe('Em aberto');
  });
});

describe('financeMetrics — MESMA função nas três telas (contrato de fonte única)', () => {
  it('overview e finance importam o módulo compartilhado; results usa via collectResults', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const f of ['src/app/api/overview/route.ts', 'src/app/api/finance/route.ts']) {
      const src = await readFile(f, 'utf8');
      expect(src.includes('finance-metrics'), `${f} deve importar lib/finance-metrics`).toBe(true);
    }
    const insights = await readFile('src/lib/insights.ts', 'utf8');
    expect(insights.includes('finance-metrics'), 'insights deve importar lib/finance-metrics').toBe(true);
    const results = await readFile('src/app/api/results/route.ts', 'utf8');
    expect(results.includes('collectResults'), 'results usa o motor compartilhado (collectResults)').toBe(true);
  });
});
