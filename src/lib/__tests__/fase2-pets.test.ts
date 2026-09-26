import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { petAge, petLabel, petsOfTutor, sanitizePet, validatePet, agendaLabelFor } from '../pets';
import { normalizeDB } from '../db';
import type { Pet } from '../types';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

const pet = (over: Partial<Pet>): Pet => ({
  id: 'p1', businessId: 'b1', tutorId: 'c1', name: 'Thor', photo: '', species: 'cachorro',
  breed: 'Pastor', sex: 'M', birthDate: '', weightKg: 0, notes: '', active: true,
  createdAt: '2026-01-01', updatedAt: '2026-01-01', ...over,
});

describe('FASE 2 · P6 — tutor ≠ pet (motor puro)', () => {
  it('validação: nome obrigatório, data e peso plausíveis', () => {
    expect(validatePet({ name: '' })).toContain('nome');
    expect(validatePet({ name: 'Thor', birthDate: '01/02/2020' })).toContain('nascimento');
    expect(validatePet({ name: 'Thor', weightKg: -1 })).toContain('Peso');
    expect(validatePet({ name: 'Thor', weightKg: 32.5 })).toBe('');
    expect(validatePet({ name: 'Thor', birthDate: '2020-02-01' })).toBe('');
  });

  it('sanitizePet normaliza espécie/sexo/peso e aplica limites', () => {
    const p = sanitizePet({ id: 'x', businessId: 'b', tutorId: 'c' }, {
      name: '  Luna  ', species: 'GATO', sex: 'F', weightKg: '4.555', birthDate: '2021-05-05',
      notes: 'n'.repeat(2000),
    });
    expect(p.name).toBe('Luna');
    expect(p.species).toBe('gato');
    expect(p.sex).toBe('F');
    expect(p.weightKg).toBe(4.56);
    expect(p.notes.length).toBeLessThanOrEqual(1000);
    expect(sanitizePet({ businessId: 'b', tutorId: 'c' }, { name: 'x', sex: 'X' }).sex).toBe('');
  });

  it('idade derivada e rótulos', () => {
    expect(petAge('')).toBe(null);
    expect(petAge('2099-01-01')).toBe(null); // futuro não vira idade
    expect(petLabel({ name: 'Thor', species: 'cachorro', breed: 'Pastor alemão' })).toBe('Thor · Cachorro (Pastor alemão)');
    expect(petLabel({ name: 'Luna' })).toBe('Luna');
  });

  it('petsOfTutor isola por tutor; agenda mostra PET primeiro com tutor como contexto', () => {
    const list = [
      pet({ id: 'p1', tutorId: 'c1', createdAt: '2026-01-02' }),
      pet({ id: 'p2', tutorId: 'c1', name: 'Luna', createdAt: '2026-01-05' }),
      pet({ id: 'p3', tutorId: 'c2', name: 'Rex' }),
    ];
    expect(petsOfTutor(list, 'c1').map((p) => p.id)).toEqual(['p2', 'p1']); // mais recente primeiro
    expect(petsOfTutor(list, 'zzz')).toEqual([]);
    expect(agendaLabelFor({ customerName: 'João', petId: 'p1' }, list)).toEqual({ primary: 'Thor', secondary: 'João' });
    expect(agendaLabelFor({ customerName: 'João' }, list)).toEqual({ primary: 'João', secondary: '' });
  });

  it('documento antigo ganha [] de pets sem mexer em nada (compatibilidade)', () => {
    const db = normalizeDB({ businesses: [], contacts: [] } as any);
    expect(db.pets).toEqual([]);
  });
});

describe('FASE 2 · P6 — cadeia pet na agenda/atendimento (regressão estática)', () => {
  it('bookings GET resolve petName só em veterinária', () => {
    const api = read('src/app/api/bookings/route.ts');
    expect(api).toContain("business.clinicType === 'veterinaria'");
    expect(api).toContain('petName');
    // escrita valida o pet na unidade e o público nunca envia
    expect(api).toMatch(/isOwner \|\| !body\.petId|!isOwner \|\| !body\.petId|if \(!isOwner \|\| !body\.petId\)/);
  });
  it('agenda e detalhe preferem o PET; tutor continua identificado', () => {
    const agenda = read('src/app/(dashboard)/agenda/page.tsx');
    expect(agenda).toContain('b.petName || b.customerName');
    expect(agenda).toContain('dropAsk.booking.petName');
    const detail = read('src/components/dashboard/BookingDetailSheet.tsx');
    expect(detail).toContain('Tutor:');
  });
  it('encontro herda o pet do agendamento (vetor do atendimento)', () => {
    const enc = read('src/app/api/encounters/route.ts');
    expect(enc).toContain('petId: booking?.petId');
  });
  it('PetsSection só aparece em veterinária e o novo agendamento escolhe pet', () => {
    const petsSection = read('src/components/dashboard/PetsSection.tsx');
    expect(petsSection).toContain('if (!vet) return null');
    const sheet = read('src/components/dashboard/NewBookingSheet.tsx');
    expect(sheet).toContain('Pet (paciente)');
    expect(sheet).toContain('petId');
  });
});
