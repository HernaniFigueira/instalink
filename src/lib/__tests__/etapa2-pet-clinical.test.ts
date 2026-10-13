// ETAPA 2 — Pet 360: alergias estruturadas, vínculo tutor × pet e histórico de peso.
// Testes de COMPORTAMENTO do motor puro (sem strings no código).
import { describe, it, expect } from 'vitest';
import {
  validatePetAllergy, sanitizePetAllergy, activePetAllergies, resolvePetTutor, petWeightHistory,
  PET_ALLERGY_MAX,
} from '../pets';
import type { Pet, PetAllergy } from '../types';

const allergy = (over: Partial<PetAllergy>): PetAllergy => ({
  id: 'a', substance: 'dipirona', reaction: '', severity: 'moderada', active: true,
  recordedAt: '2026-10-01T10:00:00.000Z', recordedBy: 'u1', inactivatedAt: '', ...over,
});

describe('Etapa 2 · alergia estruturada — validação', () => {
  it('exige substância; recusa texto longo e gravidade fora do vocabulário', () => {
    expect(validatePetAllergy({ substance: '   ' })).not.toBe('');
    expect(validatePetAllergy({ substance: 'x'.repeat(81) })).toContain('80');
    expect(validatePetAllergy({ substance: 'frango', reaction: 'r'.repeat(201) })).toContain('200');
    expect(validatePetAllergy({ substance: 'frango', severity: 'mortal' })).toContain('Gravidade');
    expect(validatePetAllergy({ substance: 'frango', severity: 'grave', reaction: 'vômito' })).toBe('');
    expect(validatePetAllergy({ substance: 'frango' })).toBe('');
  });

  it('higieniza: aparar espaços, limitar tamanho, gravidade vazia quando inválida, sempre ativa', () => {
    const a = sanitizePetAllergy({ substance: '  dipirona  ', reaction: 'coceira', severity: 'lixo' }, { id: 'x', recordedBy: 'u', at: 'T' });
    expect(a.substance).toBe('dipirona');
    expect(a.severity).toBe('');
    expect(a.active).toBe(true);
    expect(a.inactivatedAt).toBe('');
    expect(a.recordedAt).toBe('T');
    expect(sanitizePetAllergy({ substance: 'y'.repeat(200) }, { id: 'x', recordedBy: 'u', at: 'T' }).substance.length).toBe(80);
  });

  it('limite por paciente é explícito', () => {
    expect(PET_ALLERGY_MAX).toBeGreaterThanOrEqual(10);
  });
});

describe('Etapa 2 · alergias ativas', () => {
  it('uma alergia inativada NÃO aparece na lista de hoje, mas continua no registro', () => {
    const pet = { allergies: [allergy({ id: 'a1', active: false, inactivatedAt: 'T2' }), allergy({ id: 'a2', substance: 'frango' })] } as Pet;
    const active = activePetAllergies(pet);
    expect(active.map((a) => a.id)).toEqual(['a2']);
    expect(pet.allergies!.length).toBe(2);
  });

  it('pet legado sem o campo não quebra e vale lista vazia', () => {
    expect(activePetAllergies({} as Pet)).toEqual([]);
    expect(activePetAllergies(null)).toEqual([]);
  });

  it('mais recentes primeiro', () => {
    const pet = { allergies: [allergy({ id: 'antiga', recordedAt: '2026-01-01' }), allergy({ id: 'nova', recordedAt: '2026-09-01' })] } as Pet;
    expect(activePetAllergies(pet).map((a) => a.id)).toEqual(['nova', 'antiga']);
  });
});

describe('Etapa 2 · vínculo tutor × pet no atendimento', () => {
  const thor = { id: 'thor', tutorId: 'bernardo' } as Pet;

  it('sem responsável informado, o tutor do pet é o responsável', () => {
    expect(resolvePetTutor(thor, '')).toEqual({ contactId: 'bernardo', error: '' });
  });

  it('o tutor do pet é aceito', () => {
    expect(resolvePetTutor(thor, 'bernardo').error).toBe('');
  });

  it('OUTRO responsável é recusado: histórico de pet não vai para outra pessoa', () => {
    const r = resolvePetTutor(thor, 'carolina');
    expect(r.error).toContain('outro responsável');
  });

  it('pet sem tutor (legado) mantém o responsável informado', () => {
    expect(resolvePetTutor({ id: 'x', tutorId: '' } as Pet, 'carolina')).toEqual({ contactId: 'carolina', error: '' });
  });

  it('sem pet, o atendimento segue como antes (contato livre)', () => {
    expect(resolvePetTutor(null, 'carolina')).toEqual({ contactId: 'carolina', error: '' });
  });
});

describe('Etapa 2 · histórico de peso do paciente', () => {
  const enc = (over: any) => ({ id: over.id, date: '2026-01-01', status: 'finalized', petId: 'thor', clinical: { assessment: { veterinary: { weightKg: 30 } } }, ...over });

  it('usa só o peso MEDIDO nas visitas do próprio pet, em ordem cronológica', () => {
    const list = [
      enc({ id: 'e2', date: '2026-05-01', clinical: { assessment: { veterinary: { weightKg: 31.4 } } } }),
      enc({ id: 'e1', date: '2026-02-01', clinical: { assessment: { veterinary: { weightKg: 30.2 } } } }),
    ];
    const h = petWeightHistory(list, 'thor');
    expect(h.map((p) => p.encounterId)).toEqual(['e1', 'e2']);
    expect(h.map((p) => p.weightKg)).toEqual([30.2, 31.4]);
  });

  it('NÃO mistura pets do mesmo tutor: a Luna não aparece no histórico do Thor', () => {
    const list = [
      enc({ id: 'do-thor', petId: 'thor' }),
      enc({ id: 'da-luna', petId: 'luna', clinical: { assessment: { veterinary: { weightKg: 4.2 } } } }),
      enc({ id: 'sem-pet', petId: '' }),
    ];
    expect(petWeightHistory(list, 'thor').map((p) => p.encounterId)).toEqual(['do-thor']);
    expect(petWeightHistory(list, 'luna').map((p) => p.encounterId)).toEqual(['da-luna']);
  });

  it('visita sem peso medido não vira ponto (nunca copia o peso do cadastro)', () => {
    const list = [enc({ id: 'sem-peso', clinical: { assessment: { veterinary: { weightKg: null } } } })];
    expect(petWeightHistory(list, 'thor')).toEqual([]);
  });

  it('sem pet informado, histórico vazio', () => {
    expect(petWeightHistory([enc({ id: 'x' })], '')).toEqual([]);
  });
});
