import { describe, expect, it } from 'vitest';
import { todayISO, addDaysISO, parseISODate, isPastDate, humanDay, isValidDateISO, isValidClockTime, weekdayOf } from '../tz';

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

// ── Validações usadas pelo agendamento (público e remarcação do dono) ──

describe('isValidClockTime', () => {
  it('aceita horários do dia', () => {
    for (const t of ['00:00', '09:30', '12:00', '18:45', '23:59']) {
      expect(isValidClockTime(t)).toBe(true);
    }
  });

  it('recusa hora/minuto fora do intervalo (não vira "horário ocupado")', () => {
    for (const t of ['24:00', '99:99', '12:60', '23:60']) {
      expect(isValidClockTime(t)).toBe(false);
    }
  });

  it('recusa formato diferente de HH:MM', () => {
    for (const t of ['', '9:30', '09:3', '0930', '09:30:00', 'abc', '09:30 ']) {
      expect(isValidClockTime(t)).toBe(false);
    }
  });

  it('recusa valores ausentes sem lançar', () => {
    // @ts-expect-error entrada inválida de propósito
    expect(isValidClockTime(undefined)).toBe(false);
    // @ts-expect-error entrada inválida de propósito
    expect(isValidClockTime(null)).toBe(false);
  });
});

describe('isValidDateISO', () => {
  it('só aceita YYYY-MM-DD', () => {
    expect(isValidDateISO('2026-09-14')).toBe(true);
    expect(isValidDateISO('2026-9-14')).toBe(false);
    expect(isValidDateISO('14/09/2026')).toBe(false);
    expect(isValidDateISO('')).toBe(false);
  });
});

describe('weekdayOf', () => {
  it('bate com o dia da semana (0 = domingo), sem depender de fuso local', () => {
    expect(weekdayOf('2026-09-13')).toBe(0);
    expect(weekdayOf('2026-09-14')).toBe(1);
    expect(weekdayOf('2026-09-19')).toBe(6);
  });
});
