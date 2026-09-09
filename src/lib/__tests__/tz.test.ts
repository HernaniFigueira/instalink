import { describe, expect, it } from 'vitest';
import { todayISO, addDaysISO, parseISODate, isPastDate, humanDay } from '../tz';

describe('todayISO', () => {
  it('retorna YYYY-MM-DD válido', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('addDaysISO', () => {
  it('soma e subtrai dias atravessando mês', () => {
    expect(addDaysISO('2026-09-09', 1)).toBe('2026-09-10');
    expect(addDaysISO('2026-09-01', -1)).toBe('2026-08-31');
    expect(addDaysISO('2026-02-28', 1)).toBe('2026-03-01');
  });
});

describe('parseISODate', () => {
  it('rejeita formato inválido sem lançar', () => {
    expect(parseISODate('09/09/2026')).toBeNull();
    expect(parseISODate('2026-13-01')).toBeNull();
    expect(parseISODate('2026-09-09')).not.toBeNull();
  });
});

describe('isPastDate', () => {
  it('ontem é passado, hoje e amanhã não', () => {
    const today = todayISO();
    expect(isPastDate(addDaysISO(today, -1))).toBe(true);
    expect(isPastDate(today)).toBe(false);
    expect(isPastDate(addDaysISO(today, 1))).toBe(false);
  });
});

describe('humanDay', () => {
  it('rotula hoje/amanhã/ontem e formata o resto', () => {
    const today = todayISO();
    expect(humanDay(today)).toBe('Hoje');
    expect(humanDay(addDaysISO(today, 1))).toBe('Amanhã');
    expect(humanDay(addDaysISO(today, -1))).toBe('Ontem');
    expect(humanDay('2020-01-15')).toBe('15/01/2020');
  });
});
