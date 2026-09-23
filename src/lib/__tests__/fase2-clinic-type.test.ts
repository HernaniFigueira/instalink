import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeDB, emptyDB } from '../db';
import { templateFromPreset, CLINIC_PRESETS, clinicTerms } from '../clinic-presets';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

describe('FASE 2 · P5 — tipo de clínica no onboarding (preset)', () => {
  it('tela pergunta "Qual é o tipo da sua clínica?" com os 4 tipos + Outro', () => {
    const page = read('src/app/onboarding/page.tsx');
    expect(page).toContain('Qual é o tipo da sua clínica?');
    for (const id of ['medica', 'odontologica', 'veterinaria', 'estetica', 'geral']) {
      expect(page, `opção ${id}`).toContain(`id: '${id}'`);
    }
    // um produto só — o texto deixa isso explícito (não são 4 aplicações).
    expect(page).toContain('o produto é o mesmo, só o preset muda');
    // envia clinicType na criação
    expect(page).toMatch(/clinicType,\s*\n?\s*\}\)/);
  });

  it('POST /api/businesses aceita clinicType e semeia a anamnese do preset', () => {
    const api = read('src/app/api/businesses/route.ts');
    expect(api).toContain('isClinicType(body.clinicType)');
    expect(api).toContain('templateFromPreset(clinicType');
    expect(api).toContain('clinicType');
    // tipo inválido/ausente cai em 'geral' — dado legado jamais é corrompido
    expect(api).toMatch(/isClinicType\(body\.clinicType\) \? body\.clinicType : 'geral'/);
  });

  it('PATCH pode mudar o tipo depois, ignorando valor inválido', () => {
    const patch = read('src/app/api/businesses/[id]/route.ts');
    expect(patch).toContain('body.clinicType !== undefined && isClinicType(body.clinicType)');
  });

  it('seed do preset é por unidade e nunca para "geral"', () => {
    const tpl = templateFromPreset('veterinaria', () => 'id1', 'now');
    expect(tpl.preset).toBe('veterinaria');
    expect(tpl.fields.length).toBeGreaterThan(3);
    // unidades antigas continuam 'geral' e ganham terminologia padrão
    const db = normalizeDB({ businesses: [{ id: 'b', ownerId: 'u', name: 'X', slug: 'x', niche: 'saude', modes: [] }] } as any);
    expect(db.businesses[0].clinicType).toBe('geral');
    expect(clinicTerms('geral').customer).toBe('Cliente');
    expect(emptyDB().anamneseTemplates).toEqual([]);
    // os quatro presets existem com terminologia própria
    expect(CLINIC_PRESETS.veterinaria.terms.customer).toBe('Tutor');
    expect(CLINIC_PRESETS.medica.terms.customer).toBe('Paciente');
    expect(CLINIC_PRESETS.odontologica.terms.professional).toBe('Dentista');
    expect(CLINIC_PRESETS.estetica.terms.service).toBe('Procedimento');
  });
});
