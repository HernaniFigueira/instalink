// Campo de data canônico (DD/MM/AAAA ↔ ISO). Puro: sem DOM, sem fuso.
import { describe, expect, it } from 'vitest';
import { dateErrorMessage, isoToBr, maskBrDate, parseBrDate, todayIsoLocal } from '@/lib/date-field';

describe('máscara DD/MM/AAAA', () => {
  it('insere as barras à medida que digita e ignora letras', () => {
    expect(maskBrDate('1')).toBe('1');
    expect(maskBrDate('12')).toBe('12');
    expect(maskBrDate('123')).toBe('12/3');
    expect(maskBrDate('12031990')).toBe('12/03/1990');
    expect(maskBrDate('12/03/1990999')).toBe('12/03/1990');
    expect(maskBrDate('ab12')).toBe('12');
  });
});

describe('conversão ISO ↔ BR sem deslocamento de fuso', () => {
  it('ISO vira DD/MM/AAAA com os mesmos dígitos', () => {
    expect(isoToBr('1990-03-12')).toBe('12/03/1990');
    expect(isoToBr('2024-02-29')).toBe('29/02/2024');
    expect(isoToBr('')).toBe('');
    expect(isoToBr('12/03/1990')).toBe('');
  });
  it('todayIsoLocal usa o calendário local (fim do dia não vira o dia seguinte)', () => {
    const lateNight = new Date(2026, 9, 12, 23, 59, 59); // mês é 0-based: 12/10/2026 local
    expect(todayIsoLocal(lateNight)).toBe('2026-10-12');
    const earlyMorning = new Date(2026, 0, 1, 0, 0, 1);
    expect(todayIsoLocal(earlyMorning)).toBe('2026-01-01');
  });
});

describe('validação real', () => {
  it('vazio é válido e significa "sem data"', () => {
    expect(parseBrDate('')).toEqual({ ok: true, iso: '' });
  });
  it('aceita data real e devolve ISO', () => {
    expect(parseBrDate('12/03/1990')).toEqual({ ok: true, iso: '1990-03-12' });
  });
  it('parcial é incompleta', () => {
    expect(parseBrDate('12/03/19')).toEqual({ ok: false, error: 'incompleta' });
  });
  it('rejeita dia inexistente, mês 13 e 31/02', () => {
    expect(parseBrDate('31/02/2020')).toEqual({ ok: false, error: 'invalida' });
    expect(parseBrDate('10/13/2020')).toEqual({ ok: false, error: 'invalida' });
    expect(parseBrDate('00/05/2020')).toEqual({ ok: false, error: 'invalida' });
  });
  it('ano bissexto: 29/02 só existe em ano bissexto', () => {
    expect(parseBrDate('29/02/2023')).toEqual({ ok: false, error: 'invalida' });
    expect(parseBrDate('29/02/2024')).toEqual({ ok: true, iso: '2024-02-29' });
    expect(parseBrDate('29/02/2000')).toEqual({ ok: true, iso: '2000-02-29' });
    expect(parseBrDate('29/02/1900')).toEqual({ ok: false, error: 'invalida' }); // 1900 não é bissexto
  });
  it('limites max/min são comparados pela data, não por texto', () => {
    expect(parseBrDate('13/10/2026', { max: '2026-10-12' })).toEqual({ ok: false, error: 'depois_do_limite' });
    expect(parseBrDate('12/10/2026', { max: '2026-10-12' })).toEqual({ ok: true, iso: '2026-10-12' });
    expect(parseBrDate('31/12/1899')).toEqual({ ok: false, error: 'antiga' });
    expect(parseBrDate('01/01/1950', { min: '1960-01-01' })).toEqual({ ok: false, error: 'antes_do_limite' });
  });
  it('mensagens em português para todo erro', () => {
    expect(dateErrorMessage('incompleta')).toMatch(/DD\/MM\/AAAA/);
    expect(dateErrorMessage('invalida')).toMatch(/inexistente/);
  });
});
