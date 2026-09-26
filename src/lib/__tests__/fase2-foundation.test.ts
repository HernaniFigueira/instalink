import { describe, it, expect } from 'vitest';
import { emptyDB, normalizeDB } from '../db';
import {
  CLINIC_PRESETS, ANAMNESE_PRESETS, clinicTerms, isVetClinic,
  anamnesePresetFor, templateFromPreset, clinicPreset,
} from '../clinic-presets';
import { VALID_CLINIC_TYPES, isClinicType } from '../types';

describe('FASE 2 · fundação — arrays novos e defaults', () => {
  it('emptyDB já traz os arrays novos vazios', () => {
    const db = emptyDB();
    expect(db.pets).toEqual([]);
    expect(db.anamneseTemplates).toEqual([]);
    expect(db.anamneseResponses).toEqual([]);
    expect(db.financeEntries).toEqual([]);
    expect(db.followUpRules).toEqual([]);
  });

  it('documento antigo (sem os arrays) ganha [] via normalizeDB', () => {
    const legacy = {
      users: [], businesses: [{ id: 'b1', ownerId: 'u1', name: 'X', slug: 'x', niche: 'saude', modes: ['bookings'] }],
    } as any;
    const db = normalizeDB(legacy);
    expect(Array.isArray(db.pets)).toBe(true);
    expect(Array.isArray(db.anamneseTemplates)).toBe(true);
    expect(Array.isArray(db.financeEntries)).toBe(true);
    expect(Array.isArray(db.followUpRules)).toBe(true);
  });

  it('clinicType ausente/ inválido vira "geral"; válido é preservado', () => {
    const db = normalizeDB({ businesses: [
      { id: 'b1', ownerId: 'u1', name: 'A', slug: 'a', niche: 'pet', modes: [] },
      { id: 'b2', ownerId: 'u1', name: 'B', slug: 'b', niche: 'pet', modes: [], clinicType: 'veterinaria' },
      { id: 'b3', ownerId: 'u1', name: 'C', slug: 'c', niche: 'pet', modes: [], clinicType: 'lixo' },
    ] } as any);
    expect(db.businesses[0].clinicType).toBe('geral');
    expect(db.businesses[1].clinicType).toBe('veterinaria');
    expect(db.businesses[2].clinicType).toBe('geral');
  });
});

describe('FASE 2 · presets de clínica', () => {
  it('todo tipo válido tem preset e preset de anamnese', () => {
    for (const t of VALID_CLINIC_TYPES) {
      expect(CLINIC_PRESETS[t]).toBeTruthy();
      expect(ANAMNESE_PRESETS[t]).toBeTruthy();
      expect(ANAMNESE_PRESETS[t].fields.length).toBeGreaterThan(0);
    }
  });

  it('terminologia: veterinária usa Tutor e é vetMode; médica usa Paciente', () => {
    expect(clinicTerms('veterinaria').customer).toBe('Tutor');
    expect(isVetClinic('veterinaria')).toBe(true);
    expect(clinicTerms('medica').customer).toBe('Paciente');
    expect(isVetClinic('medica')).toBe(false);
    // fallback
    expect(clinicTerms(undefined).customer).toBe('Cliente');
    expect(clinicPreset('naoexiste' as any).type).toBe('geral');
  });

  it('templateFromPreset cria template ativo com campos estáveis e escopo vazio', () => {
    let n = 0;
    const tpl = templateFromPreset('odontologica', () => `id-${++n}`, '2026-09-23T00:00:00Z');
    expect(tpl.preset).toBe('odontologica');
    expect(tpl.active).toBe(true);
    expect(tpl.businessId).toBe(''); // preenchido pelo chamador
    expect(tpl.fields.some((f) => f.id === 'sangramento' && f.type === 'boolean')).toBe(true);
    // ids de campo são estáveis (slug) — reconhecíveis entre presets
    const ids = tpl.fields.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('anamnesePresetFor tem fallback geral', () => {
    expect(anamnesePresetFor(undefined).preset).toBe('geral');
    expect(isClinicType('estetica')).toBe(true);
    expect(isClinicType('x')).toBe(false);
  });
});
