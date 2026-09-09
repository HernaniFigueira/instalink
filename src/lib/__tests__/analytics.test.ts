import { describe, expect, it } from 'vitest';
import { convRate, pctChange, dropOff, seriesByDay, topN, funnelRates } from '../analytics';

describe('convRate', () => {
  it('calcula % com 1 casa', () => {
    expect(convRate(1, 4)).toBe(25);
    expect(convRate(1, 3)).toBe(33.3);
    expect(convRate(0, 10)).toBe(0);
  });
  it('whole zerado retorna 0', () => {
    expect(convRate(5, 0)).toBe(0);
    expect(convRate(5, -2)).toBe(0);
  });
});

describe('pctChange', () => {
  it('variação positiva e negativa', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(75, 100)).toBe(-25);
  });
  it('sem base retorna null', () => {
    expect(pctChange(10, 0)).toBeNull();
  });
});

describe('dropOff', () => {
  it('abandono entre etapas', () => {
    expect(dropOff(100, 25)).toBe(75);
    expect(dropOff(100, 100)).toBe(0);
    expect(dropOff(0, 0)).toBe(0);
  });
});

describe('seriesByDay', () => {
  it('agrupa por dia e tipo, zerando ausentes', () => {
    const out = seriesByDay(
      [
        { createdAt: '2026-09-08T10:00:00Z', type: 'page_view' },
        { createdAt: '2026-09-08T11:00:00Z', type: 'page_view' },
        { createdAt: '2026-09-09T09:00:00Z', type: 'conversion' },
      ],
      ['2026-09-08', '2026-09-09'],
      ['page_view', 'conversion'],
    );
    expect(out).toEqual([
      { day: '2026-09-08', counts: { page_view: 2, conversion: 0 } },
      { day: '2026-09-09', counts: { page_view: 0, conversion: 1 } },
    ]);
  });
  it('ignora dias fora da lista', () => {
    const out = seriesByDay(
      [{ createdAt: '2026-01-01T00:00:00Z', type: 'page_view' }],
      ['2026-09-09'],
      ['page_view'],
    );
    expect(out[0].counts.page_view).toBe(0);
  });
});

describe('topN', () => {
  it('ordena desc e limita', () => {
    expect(topN({ a: 1, b: 5, c: 3 }, 2)).toEqual([
      { key: 'b', value: 5 },
      { key: 'c', value: 3 },
    ]);
  });
});

describe('funnelRates', () => {
  it('primeira etapa 100, demais relativas', () => {
    expect(funnelRates([100, 50, 10])).toEqual([100, 50, 20]);
    expect(funnelRates([0, 5])).toEqual([100, 0]);
  });
});
