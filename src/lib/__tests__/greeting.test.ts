// ═══════════════════════════════════════════════════════════════
// Saudação — o nome que aparece na primeira dobra
// ═══════════════════════════════════════════════════════════════
// Regressão vista em navegador: o profissional cadastrado como "Dr. Orlando"
// era cumprimentado com "Meu dia, Dr." — sinal de sistema que não conhece o
// próprio dado. A regra continua sendo "primeiro nome": só que tratamento
// (Dr./Dra./Prof./Sr.) não é nome.
import { describe, expect, it } from 'vitest';
import { firstName } from '../greeting';

describe('firstName — tratamento não é nome', () => {
  it('pula o tratamento quando existe um nome depois', () => {
    expect(firstName('Dr. Orlando')).toBe('Orlando');
    expect(firstName('Dra. Ana Paula')).toBe('Ana');
    expect(firstName('Prof. Marcos')).toBe('Marcos');
    expect(firstName('Sr. Antônio')).toBe('Antônio');
    expect(firstName('Sra. Helena')).toBe('Helena');
    expect(firstName('doutor João')).toBe('João');
  });

  it('sem tratamento, o comportamento histórico se mantém', () => {
    expect(firstName('Demo InstaLink')).toBe('Demo');
    expect(firstName('Sofia (secretária)')).toBe('Sofia');
    expect(firstName('Vitor')).toBe('Vitor');
  });

  it('nunca devolve vazio (nem com nome ausente)', () => {
    expect(firstName('')).toBe('você');
    expect(firstName('   ')).toBe('você');
    expect(firstName(undefined)).toBe('você');
    expect(firstName(null)).toBe('você');
  });

  it('só o tratamento: devolve o que existe em vez de vazio', () => {
    expect(firstName('Dr.')).toBe('Dr.');
    expect(firstName('Dra.')).toBe('Dra.');
  });

  it('espaços e vírgulas do cadastro não quebram a leitura', () => {
    expect(firstName('  Dr.   Orlando  ')).toBe('Orlando');
    // "Dra., Ana" é cadastro torto mas real: a vírgula colada no tratamento
    // não pode virar o nome da pessoa.
    expect(firstName('Dra., Ana')).toBe('Ana');
  });
});
