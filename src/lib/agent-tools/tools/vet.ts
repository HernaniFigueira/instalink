// F3-D — tools VETERINÁRIAS (pet = paciente; tutor = contato)
import type { ToolDef } from '../types';
import { validatePet, sanitizePet, petsOfTutor, petLabel } from '../../pets';
import { findContact } from '../../contacts';
import { randomUUID } from 'node:crypto';

export const listTutorPets: ToolDef<{ tutorId?: string; phone?: string }, Array<{
  id: string; name: string; species: string; label: string;
}>> = {
  name: 'listTutorPets',
  description: 'Pets do tutor (pacientes veterinários).',
  domain: 'vet',
  sideEffect: 'read',
  requiresPermission: 'clientes',
  requiresConfirm: false,
  inputSchema: [
    { name: 'tutorId', type: 'string', required: false, max: 64 },
    { name: 'phone', type: 'string', required: false, max: 20 },
  ],
  outputSchema: 'any',
  handler: (input, ctx) => {
    let tutorId = String(input.tutorId || '');
    if (!tutorId && input.phone) {
      const c = findContact(ctx.db, ctx.businessId, '', input.phone, '', '');
      tutorId = c?.id || '';
    }
    if (!tutorId) return [];
    return petsOfTutor((ctx.db.pets || []).filter((p) => p.businessId === ctx.businessId), tutorId)
      .map((p) => ({ id: p.id, name: p.name, species: p.species || '', label: petLabel(p) }));
  },
};

export const createPet: ToolDef<{ tutorId: string; name: string; species?: string; breed?: string }, {
  id: string; name: string; tutorId: string;
}> = {
  name: 'createPet',
  description: 'Cadastra pet (paciente) vinculado ao tutor da unidade.',
  domain: 'vet',
  sideEffect: 'write',
  requiresPermission: 'clientes',
  requiresConfirm: false,
  inputSchema: [
    { name: 'tutorId', type: 'string', required: true, max: 64 },
    { name: 'name', type: 'string', required: true, max: 80 },
    { name: 'species', type: 'string', required: false, max: 40 },
    { name: 'breed', type: 'string', required: false, max: 80 },
  ],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const tutor = (ctx.db.contacts || []).find(
      (c) => c.id === input.tutorId && c.businessId === ctx.businessId,
    );
    if (!tutor) throw Object.assign(new Error('Tutor não encontrado nesta unidade.'), { status: 404 });
    const err = validatePet({ name: input.name, species: input.species, breed: input.breed });
    if (err) throw Object.assign(new Error(err), { status: 400 });
    const now = ctx.now || new Date().toISOString();
    const pet = {
      ...sanitizePet(
        { id: randomUUID(), businessId: ctx.businessId, tutorId: tutor.id },
        { name: input.name, species: input.species, breed: input.breed },
      ),
      createdAt: now,
      updatedAt: now,
    };
    if (!Array.isArray(ctx.db.pets)) ctx.db.pets = [];
    ctx.db.pets.push(pet);
    return { id: pet.id, name: pet.name, tutorId: pet.tutorId };
  },
};

export const getPetBasics: ToolDef<{ petId: string }, {
  id: string; name: string; species: string; breed: string; tutorId: string;
  /** SEM histórico clínico. */
  clinical: false;
} | null> = {
  name: 'getPetBasics',
  description: 'Básico do pet (nome/espécie/tutor) — sem prontuário.',
  domain: 'vet',
  sideEffect: 'read',
  requiresPermission: 'clientes',
  requiresConfirm: false,
  inputSchema: [{ name: 'petId', type: 'string', required: true, max: 64 }],
  outputSchema: 'any',
  handler: (input, ctx) => {
    const p = (ctx.db.pets || []).find(
      (x) => x.id === input.petId && x.businessId === ctx.businessId,
    );
    if (!p) return null;
    return {
      id: p.id,
      name: p.name,
      species: p.species || '',
      breed: p.breed || '',
      tutorId: p.tutorId,
      clinical: false as const,
    };
  },
};

export const vetTools = [listTutorPets, createPet, getPetBasics];
