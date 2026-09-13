import { describe, expect, it } from 'vitest';
import { eligibleProfessionalIds, resolveProfessional, bookingMode } from '../booking';
import type { Professional, Service } from '../types';

const pros: Professional[] = [
  { id: 'ana', businessId: 'b', name: 'Dra. Ana', role: 'Dentista', photo: '', active: true },
  { id: 'carlos', businessId: 'b', name: 'Dr. Carlos', role: 'Dentista', photo: '', active: true },
  { id: 'joao', businessId: 'b', name: 'Dr. João', role: 'Dentista', photo: '', active: false },
];

function svc(professionalIds: string[]): Service {
  return {
    id: 's1', businessId: 'b', categoryId: '', name: 'Consulta', description: '', image: '',
    price: 0, durationMin: 60, professionalIds, active: true, featured: false, bookable: true, questions: [],
  };
}

describe('bookingMode (cliente × dono)', () => {
  it('cliente logado (sem asOwner) → cliente, mesmo sem sessão de dono', () => {
    expect(bookingMode({ ownerLogged: false, ownerMatches: false })).toBe('customer');
  });

  it('BUG: dono logado visitando a própria página pública NÃO vira owner', () => {
    expect(bookingMode({ ownerLogged: true, ownerMatches: true })).toBe('customer');
  });

  it('asOwner=true + sessão de dono do negócio → owner', () => {
    expect(bookingMode({ asOwner: true, ownerLogged: true, ownerMatches: true })).toBe('owner');
  });

  it('asOwner=true sem sessão de dono → cliente (cai no customerFromRequest)', () => {
    expect(bookingMode({ asOwner: true, ownerLogged: false, ownerMatches: false })).toBe('customer');
  });

  it('asOwner=true mas sessão de dono de OUTRO negócio → cliente', () => {
    expect(bookingMode({ asOwner: true, ownerLogged: true, ownerMatches: false })).toBe('customer');
  });

  it('asOwner como string "true" não conta (strict === true)', () => {
    expect(bookingMode({ asOwner: 'true', ownerLogged: true, ownerMatches: true })).toBe('customer');
  });
});

describe('eligibleProfessionalIds', () => {
  it('[] = todos os ativos (inativos ficam de fora)', () => {
    expect(eligibleProfessionalIds(svc([]), pros)).toEqual(['ana', 'carlos']);
  });
  it('respeita o vínculo serviço → profissional', () => {
    expect(eligibleProfessionalIds(svc(['ana']), pros)).toEqual(['ana']);
    expect(eligibleProfessionalIds(svc(['carlos', 'joao']), pros)).toEqual(['carlos']);
  });
});

describe('resolveProfessional', () => {
  const assign = { '09:00': 'carlos', '10:00': 'ana' };

  it('cliente nunca escolhe: requested é ignorado (usa assign)', () => {
    expect(resolveProfessional({ service: svc(['ana', 'carlos']), professionals: pros, assign, time: '09:00', requested: 'ana' })).toBe('carlos');
  });

  it('cenário 5: Ana ocupada, Carlos livre → atribui Carlos', () => {
    // assign já reflete que no horário 09:00 só Carlos está livre
    expect(resolveProfessional({ service: svc(['ana', 'carlos']), professionals: pros, assign: { '09:00': 'carlos' }, time: '09:00' })).toBe('carlos');
  });

  it('cenário 6: ambos livres → menor carga no dia (assign)', () => {
    const a = { '09:00': 'ana' };
    expect(resolveProfessional({ service: svc(['ana', 'carlos']), professionals: pros, assign: a, time: '09:00' })).toBe('ana');
  });

  it('cenário 7: serviço só da Ana → Carlos não pode receber', () => {
    expect(eligibleProfessionalIds(svc(['ana']), pros)).not.toContain('carlos');
    expect(resolveProfessional({ service: svc(['ana']), professionals: pros, assign: { '09:00': 'ana' }, time: '09:00', requested: 'carlos', allowRequested: true })).toBe('ana');
  });

  it('cenário 8: professionalId inválido é rejeitado/ignorado até pelo dono', () => {
    // requested não elegível → cai no assign (nunca o requested)
    expect(resolveProfessional({ service: svc(['ana']), professionals: pros, assign: { '09:00': 'ana' }, time: '09:00', requested: 'carlos', allowRequested: true })).toBe('ana');
    // requested inativo → também ignorado
    expect(resolveProfessional({ service: svc([]), professionals: pros, assign: { '09:00': 'ana' }, time: '09:00', requested: 'joao', allowRequested: true })).toBe('ana');
  });

  it('dono pode indicar profissional elegível', () => {
    expect(resolveProfessional({ service: svc(['ana', 'carlos']), professionals: pros, assign, time: '09:00', requested: 'ana', allowRequested: true })).toBe('ana');
  });
});
