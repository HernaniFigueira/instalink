import { describe, expect, it } from 'vitest';
import {
  BOOKING_STATUS_GROUP_LABELS, BOOKING_STATUS_LABELS, NO_DATA_MESSAGE,
  REVENUE_ELIGIBLE_BOOKING_STATUSES, REVENUE_EXCLUDED_BOOKING_STATUSES,
  REVENUE_HINTS, REVENUE_LABELS, REVENUE_UNIT_LABELS,
  bookingRevenue, orderRevenue, revenueEmptyMessage, revenueSources,
} from '../revenue';
import { BOOKING_STATUS } from '../status';
import type { BookingRevenueItem, OrderRevenueItem, RevenueWindow } from '../revenue';

const SETEMBRO: RevenueWindow = { from: '2026-09-01', to: '2026-09-30' };
const AGOSTO: RevenueWindow = { from: '2026-08-01', to: '2026-08-31' };

const bk = (status: BookingRevenueItem['status'], date: string, price: number): BookingRevenueItem => ({ status, date, price });

describe('revenue — semântica (não fingimos contabilidade)', () => {
  it('atendimentos são "Receita prevista"; pedidos são "Receita"', () => {
    expect(REVENUE_LABELS.bookings).toBe('Receita prevista');
    expect(REVENUE_LABELS.orders).toBe('Receita');
    expect(REVENUE_LABELS.bookings).not.toBe(REVENUE_LABELS.orders);
  });

  it('a regra fica documentada no texto de apoio', () => {
    expect(REVENUE_HINTS.bookings).toMatch(/pendentes, confirmados e concluídos/);
    expect(REVENUE_HINTS.bookings).toMatch(/não é dinheiro recebido/i);
    expect(REVENUE_HINTS.orders).toMatch(/pedidos não cancelados/);
  });

  it('unidade acompanha a fonte (atendimentos × pedidos)', () => {
    expect(REVENUE_UNIT_LABELS.bookings).toBe('atendimentos');
    expect(REVENUE_UNIT_LABELS.orders).toBe('pedidos');
  });

  it('status elegíveis e excluídos são explícitos', () => {
    expect(REVENUE_ELIGIBLE_BOOKING_STATUSES).toEqual(['pending', 'confirmed', 'completed']);
    expect(REVENUE_EXCLUDED_BOOKING_STATUSES).toEqual(['cancelled', 'no_show']);
  });

  it('rótulos de status vêm de lib/status (fonte única)', () => {
    for (const [key, def] of Object.entries(BOOKING_STATUS)) {
      expect(BOOKING_STATUS_LABELS[key as keyof typeof BOOKING_STATUS]).toBe(def.panel);
    }
    expect(BOOKING_STATUS_GROUP_LABELS.no_show).toBe('faltas');
  });
});

describe('revenue — receita prevista de atendimentos', () => {
  const items: BookingRevenueItem[] = [
    bk('completed', '2026-09-02', 18000),
    bk('confirmed', '2026-09-10', 12000),
    bk('pending', '2026-09-20', 10000),
    bk('cancelled', '2026-09-11', 50000),
    bk('no_show', '2026-09-12', 40000),
    bk('completed', '2026-08-15', 99999),   // fora do período
  ];

  it('soma pendentes + confirmados + concluídos do período', () => {
    const r = bookingRevenue(items, SETEMBRO);
    expect(r.total).toBe(40000);
    expect(r.count).toBe(3);
    expect(r.hasData).toBe(true);
    expect(r.kind).toBe('bookings');
  });

  it('cancelados e faltas ficam FORA da soma', () => {
    const r = bookingRevenue(items, SETEMBRO);
    expect(r.total).not.toBe(140000);
    const cancelled = r.breakdown?.find((b) => b.status === 'cancelled');
    const noShow = r.breakdown?.find((b) => b.status === 'no_show');
    expect(cancelled?.eligible).toBe(false);
    expect(cancelled?.total).toBe(50000);   // visível na quebra, fora do total
    expect(noShow?.eligible).toBe(false);
  });

  it('quebra por status mostra o período inteiro (transparência)', () => {
    const r = bookingRevenue(items, SETEMBRO);
    expect(r.breakdown).not.toBeNull();
    expect(r.breakdown?.map((b) => b.status)).toEqual(['completed', 'confirmed', 'pending', 'no_show', 'cancelled']);
    expect(r.breakdown?.find((b) => b.status === 'completed')).toMatchObject({ count: 1, total: 18000, eligible: true });
  });

  it('ignora atendimentos fora do período (data do atendimento manda)', () => {
    const r = bookingRevenue(items, SETEMBRO);
    expect(r.total).toBe(40000);
    const agosto = bookingRevenue(items, AGOSTO);
    expect(agosto.total).toBe(99999);
    expect(agosto.count).toBe(1);
  });

  it('compara com o período anterior (delta)', () => {
    const r = bookingRevenue(items, SETEMBRO, AGOSTO);
    expect(r.prev).toBe(99999);
    expect(r.delta).toBe(40000 - 99999);
  });

  it('ticket médio por atendimento elegível', () => {
    const r = bookingRevenue(items, SETEMBRO);
    expect(r.ticket).toBe(Math.round(40000 / 3));
  });

  it('sem itens elegíveis: total zero, hasData false e mensagem "Sem dados suficientes"', () => {
    const r = bookingRevenue([bk('cancelled', '2026-09-05', 5000)], SETEMBRO);
    expect(r.total).toBe(0);
    expect(r.count).toBe(0);
    expect(r.hasData).toBe(false);
    expect(revenueEmptyMessage(r)).toBe(NO_DATA_MESSAGE);
    expect(r.ticket).toBe(0);
  });

  it('lista vazia não quebra e não inventa número', () => {
    const r = bookingRevenue([], SETEMBRO);
    expect(r.total).toBe(0);
    expect(r.hasData).toBe(false);
    expect(revenueEmptyMessage(r)).toBe(NO_DATA_MESSAGE);
    expect(bookingRevenue([], SETEMBRO).breakdown?.every((b) => b.count === 0)).toBe(true);
  });

  it('preço inválido é tratado como zero', () => {
    const r = bookingRevenue([bk('completed', '2026-09-05', NaN), bk('completed', '2026-09-06', 1000)], SETEMBRO);
    expect(r.total).toBe(1000);
    expect(r.count).toBe(2);
  });
});

describe('revenue — receita de pedidos (regra preservada)', () => {
  const orders: OrderRevenueItem[] = [
    { status: 'completed', createdAt: '2026-09-03T12:00:00.000Z', total: 5900 },
    { status: 'new', createdAt: '2026-09-04T12:00:00.000Z', total: 4100 },
    { status: 'cancelled', createdAt: '2026-09-05T12:00:00.000Z', total: 99900 },
    { status: 'accepted', createdAt: '2026-08-20T12:00:00.000Z', total: 3000 },
  ];

  it('soma pedidos não cancelados pela data de criação', () => {
    const r = orderRevenue(orders, SETEMBRO);
    expect(r.total).toBe(10000);
    expect(r.count).toBe(2);
    expect(r.hasData).toBe(true);
    expect(r.kind).toBe('orders');
    expect(r.breakdown).toBeNull();
  });

  it('pedido cancelado não entra', () => {
    expect(orderRevenue(orders, SETEMBRO).total).not.toBe(109900);
  });

  it('período anterior e delta', () => {
    const r = orderRevenue(orders, SETEMBRO, AGOSTO);
    expect(r.prev).toBe(3000);
    expect(r.delta).toBe(7000);
  });

  it('sem pedidos: zero + "Sem dados suficientes"', () => {
    const r = orderRevenue([], SETEMBRO);
    expect(r.total).toBe(0);
    expect(r.hasData).toBe(false);
    expect(revenueEmptyMessage(r)).toBe(NO_DATA_MESSAGE);
  });
});

describe('revenue — fontes por tipo de negócio', () => {
  it('clínica (serviços/agenda) tem receita prevista mesmo sem pedidos', () => {
    expect(revenueSources({ bookings: true, services: true, orders: false, products: false })).toEqual(['bookings']);
  });

  it('varejo usa pedidos', () => {
    expect(revenueSources({ bookings: false, services: false, orders: true, products: true })).toEqual(['orders']);
  });

  it('híbrido mostra as duas fontes, separadas', () => {
    expect(revenueSources({ bookings: true, services: true, orders: true, products: true })).toEqual(['bookings', 'orders']);
  });

  it('só serviços (sem agenda) ainda tem valor de atendimentos', () => {
    expect(revenueSources({ services: true })).toEqual(['bookings']);
  });

  it('sem módulos de venda, não há fonte de receita (e nada é inventado)', () => {
    expect(revenueSources({})).toEqual([]);
  });
});
