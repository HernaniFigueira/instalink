import { describe, expect, it } from 'vitest';
import { SERVICE_MODEL_OPTIONS, isServiceModel, modesForServiceModel } from '../onboarding';

// "Como sua empresa atende?" — a resposta só define a BASE de módulos
// (depois, Recursos liga/desliga livremente). Produtos NÃO depende de
// Serviços — o mapeamento precisa refletir isso.

describe('primeira configuração — mapeamento de módulos', () => {
  it('Serviços e agendamento → Serviços ON, Agendamentos ON', () => {
    expect(modesForServiceModel('agenda')).toEqual(['services', 'bookings']);
  });

  it('Produtos → Produtos ON (sem serviços/agenda)', () => {
    expect(modesForServiceModel('produtos')).toEqual(['products']);
  });

  it('Serviços + produtos → os três módulos', () => {
    expect(modesForServiceModel('ambos')).toEqual(['services', 'bookings', 'products']);
  });

  it('desconhecido/ausente cai no padrão de atendimento', () => {
    expect(modesForServiceModel(undefined)).toEqual(['services', 'bookings']);
    expect(modesForServiceModel('qualquer-coisa')).toEqual(['services', 'bookings']);
  });

  it('oferece exatamente as 3 opções oficiais, na ordem', () => {
    expect(SERVICE_MODEL_OPTIONS.map((o) => o.id)).toEqual(['agenda', 'produtos', 'ambos']);
    expect(isServiceModel('produtos')).toBe(true);
    expect(isServiceModel('ecommerce')).toBe(false);
  });
});
