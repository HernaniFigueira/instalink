import { describe, expect, it } from 'vitest';
import { bookingIntentPayload, resolvePetSelection } from '@/lib/booking-quick-create';

describe('Quick Create · paciente (pet) na veterinária', () => {
  it('tutor sem pet: nada a escolher e o servidor decide', () => {
    expect(resolvePetSelection([], '')).toEqual({ petId: '', required: false, missing: '' });
  });

  it('exatamente 1 pet: seleção automática, sem exigir clique', () => {
    const r = resolvePetSelection([{ id: 'pet-mel', name: 'Mel' }], '');
    expect(r).toEqual({ petId: 'pet-mel', required: true, missing: '' });
  });

  it('pets inativos não contam para a regra', () => {
    const r = resolvePetSelection([{ id: 'a', name: 'Antigo', active: false }, { id: 'b', name: 'Thor' }], '');
    expect(r.petId).toBe('b');
    expect(r.missing).toBe('');
  });

  it('2+ pets: exige escolha explícita e recusa escolha fora da lista', () => {
    const pets = [{ id: 'mel', name: 'Mel' }, { id: 'thor', name: 'Thor' }];
    expect(resolvePetSelection(pets, '')).toEqual({
      petId: '', required: true, missing: 'Escolha o pet (paciente) deste agendamento.',
    });
    expect(resolvePetSelection(pets, 'fora').missing).toBe('Escolha o pet (paciente) deste agendamento.');
    expect(resolvePetSelection(pets, 'thor')).toEqual({ petId: 'thor', required: true, missing: '' });
  });

  it('o petId escolhido vai no payload canônico (mesmo nome do fluxo completo)', () => {
    const payload = bookingIntentPayload('biz', {
      contactId: 'c1', customerName: 'Ana', customerPhone: '1', serviceId: 's1',
      professionalId: '', date: '2026-10-09', time: '15:00', petId: 'pet-mel',
    });
    expect(payload.petId).toBe('pet-mel');
    const semPet = bookingIntentPayload('biz', {
      contactId: 'c1', customerName: 'Ana', customerPhone: '1', serviceId: 's1',
      professionalId: '', date: '2026-10-09', time: '15:00',
    });
    expect('petId' in semPet).toBe(false);
  });
});
