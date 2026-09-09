import { describe, expect, it } from 'vitest';
import {
  money, parseMoneyToCents, centsToBR, slugify, onlyDigits, waLink,
  timeToMin, minToTime,
} from '../utils';

describe('money', () => {
  it('formata centavos em BRL', () => {
    expect(money(4500)).toBe('R$ 45,00');
    expect(money(0)).toBe('R$ 0,00');
  });
});

describe('parseMoneyToCents', () => {
  it('aceita decimal com ponto (nunca multiplica por 100 errado)', () => {
    expect(parseMoneyToCents('45.00')).toBe(4500);
  });
  it('aceita formato BR com vírgula e milhar', () => {
    expect(parseMoneyToCents('R$ 1.234,56')).toBe(123456);
    expect(parseMoneyToCents('10,50')).toBe(1050);
  });
  it('entradas inválidas viram 0', () => {
    expect(parseMoneyToCents('')).toBe(0);
    expect(parseMoneyToCents('abc')).toBe(0);
  });
});

describe('centsToBR', () => {
  it('centavos → texto editável', () => {
    expect(centsToBR(4500)).toBe('45,00');
  });
});

describe('slugify', () => {
  it('normaliza acentos e remove separadores (slug colado)', () => {
    expect(slugify('Barbearia do João!')).toBe('barbeariadojoao');
  });
});

describe('onlyDigits', () => {
  it('remove máscara (base da dedupe por telefone)', () => {
    expect(onlyDigits('(21) 99999-8888')).toBe('21999998888');
  });
});

describe('waLink', () => {
  it('aplica DDI 55 quando ausente e codifica mensagem', () => {
    const url = waLink('21999998888', 'Olá!');
    expect(url).toBe('https://wa.me/5521999998888?text=Ol%C3%A1!');
  });
  it('não duplica DDI existente', () => {
    expect(waLink('5521999998888', 'Oi')).toBe('https://wa.me/5521999998888?text=Oi');
  });
});

describe('time helpers', () => {
  it('roundtrip HH:MM', () => {
    expect(minToTime(timeToMin('09:30'))).toBe('09:30');
    expect(timeToMin('00:00')).toBe(0);
  });
});
