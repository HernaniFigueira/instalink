import { describe, expect, it } from 'vitest';
import { readFaqItems, visibleFaqItems } from '../faq';

describe('FAQ', () => {
  it('mantém o formato existente de pergunta e resposta', () => {
    const items = [{
      q: 'Qual o horário de atendimento?',
      a: 'Atendemos de segunda a sábado, das 8h às 18h.',
    }];

    expect(readFaqItems(items)).toEqual(items);
  });

  it('preserva espaços e separadores como parte normal do texto', () => {
    const items = [{
      q: 'Atendem aos domingos? ',
      a: 'Sim, aos domingos — somente com hora marcada | consulte a disponibilidade. ',
    }];

    expect(readFaqItems(items)).toEqual(items);
  });

  it('aceita nomes extensos legados e oculta itens sem pergunta no site', () => {
    expect(visibleFaqItems([
      { question: 'Pergunta antiga', answer: 'Resposta antiga' },
      { q: '   ', a: 'Sem pergunta' },
    ])).toEqual([{ q: 'Pergunta antiga', a: 'Resposta antiga' }]);
  });
});
