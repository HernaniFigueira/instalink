import { describe, expect, it } from 'vitest';
import {
  PERIOD_VALUES, parsePeriodParam, periodLabel, periodShortLabel, periodWindows,
} from '../periods';

describe('períodos de consulta (P1)', () => {
  it('oferece 7/30/90 dias, 12 meses e todo o período', () => {
    expect([...PERIOD_VALUES]).toEqual([7, 30, 90, 365, 0]);
  });

  it('parsePeriodParam normaliza a URL e cai para 30 no desconhecido', () => {
    expect(parsePeriodParam('7')).toBe(7);
    expect(parsePeriodParam('30')).toBe(30);
    expect(parsePeriodParam('90')).toBe(90);
    expect(parsePeriodParam('365')).toBe(365);
    expect(parsePeriodParam('0')).toBe(0);
    expect(parsePeriodParam('all')).toBe(0);
    expect(parsePeriodParam(null)).toBe(30);
    expect(parsePeriodParam(undefined)).toBe(30);
    expect(parsePeriodParam('')).toBe(30);
    expect(parsePeriodParam('999')).toBe(30);
    expect(parsePeriodParam('abc')).toBe(30);
  });

  it('rótulos longo e curto cobrem todos os períodos', () => {
    expect(periodLabel(7)).toBe('7 dias');
    expect(periodLabel(30)).toBe('30 dias');
    expect(periodLabel(90)).toBe('90 dias');
    expect(periodLabel(365)).toBe('12 meses');
    expect(periodLabel(0)).toBe('Todo período');
    expect(periodShortLabel(365)).toBe('12m');
    expect(periodShortLabel(0)).toBe('Tudo');
  });

  it('janelas de 7/30 dias preservam a regra histórica (inclui hoje)', () => {
    const w7 = periodWindows(7, '2026-09-15');
    expect(w7).toEqual({
      from: '2026-09-09', to: '2026-09-15',
      prevFrom: '2026-09-02', prevTo: '2026-09-08', hasPrevious: true,
    });
    const w30 = periodWindows(30, '2026-09-15');
    expect(w30.from).toBe('2026-08-17');
    expect(w30.to).toBe('2026-09-15');
    expect(w30.hasPrevious).toBe(true);
  });

  it('todo o período não tem início nem janela anterior comparável', () => {
    const w = periodWindows(0, '2026-09-15');
    expect(w.from).toBe('');
    expect(w.to).toBe('2026-09-15');
    expect(w.hasPrevious).toBe(false);
  });
});
