import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { can } from '@/lib/access-core';
import { pushAudit } from '@/lib/audit';
import {
  sanitizePet, validatePet, petsOfTutor, validatePetAllergy, sanitizePetAllergy, PET_ALLERGY_MAX,
} from '@/lib/pets';
import { isLinkedContact, isLinkedPet, isProfessionalScoped, scopeReadablePets, canReadPet } from '@/lib/data-scope';
import type { Pet, PetAllergy } from '@/lib/types';

/** Projeção clínica do Pet: mantém o vínculo com o tutor necessário ao Pet 360,
 * mas não expõe metadados internos da entidade. Admin/Recepção conservam o DTO.
 */
type ClinicalPet = Pick<Pet,
  'id' | 'tutorId' | 'name' | 'photo' | 'species' | 'breed' | 'sex' |
  'birthDate' | 'weightKg' | 'notes' | 'active' | 'allergies'
>;

function petResponse(pet: Pet, ctx: { professionalScope: string }): Pet | ClinicalPet {
  if (!isProfessionalScoped(ctx)) return { ...pet, allergies: pet.allergies || [] };
  const { id, tutorId, name, photo, species, breed, sex, birthDate, weightKg, notes, active, allergies } = pet;
  return { id, tutorId, name, photo, species, breed, sex, birthDate, weightKg, notes, active, allergies: allergies || [] };
}

// ═══════════════════════════════════════════════════════════════
// FASE 2 · P6 — PETS (pacientes veterinários) — API
// ═══════════════════════════════════════════════════════════════
// Tutor (BusinessCustomer) continua sendo a PESSOA de contato; o pet é a
// entidade do paciente. Permissão: quem opera clientes/atendimento.
// GET  ?businessId=&tutorId=  → { vet, pets }   (lista do tutor)
// GET  ?businessId=&petId=    → { vet, pet, tutor }    (ficha do paciente — Etapa 2)
// POST { action: 'create'|'update'|'delete', ... }
// POST { action: 'allergy-add'|'allergy-update'|'allergy-deactivate', petId, ... }
//      Alergia é registro CLÍNICO: exige permissão de atendimento e, para o
//      profissional, vínculo com o paciente. A recepção lê, não grava.

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const tutorId = req.nextUrl.searchParams.get('tutorId') || '';
  const petId = req.nextUrl.searchParams.get('petId') || '';
  const guard = await requireBusiness(req, businessId, ['clientes', 'atendimento']);
  if (!guard.ok) return guard.res;
  const db = guard.db;
  const business = db.businesses.find((b) => b.id === businessId);
  if (petId) {
    // Ficha por id: o MESMO escopo da lista (tenant + acesso clínico). Fora dele: 404,
    // sem revelar se o pet existe em outra unidade.
    const pet = db.pets.find((p) => p.id === petId && p.businessId === businessId);
    if (!pet || !canReadPet(db, guard.ctx, pet)) {
      return NextResponse.json({ error: 'Pet não encontrado nesta unidade.' }, { status: 404 });
    }
    // Responsável (tutor) só como referência: nome para o cabeçalho. Financeiro e
    // cadastro completo continuam no contato do tutor.
    const tutorContact = db.contacts.find((c) => c.id === pet.tutorId && c.businessId === businessId);
    return NextResponse.json({
      vet: business?.clinicType === 'veterinaria',
      clinicType: business?.clinicType || 'geral',
      pet: petResponse(pet, guard.ctx),
      tutor: { id: pet.tutorId, name: tutorContact?.name || '' },
    });
  }
  // CLINICAL ACCESS: o PACIENTE é o protagonista clínico — o Professional
  // vinculado localiza todos os pets da unidade (mesmo sem nunca ter
  // atendido), para abrir a ficha e o histórico longitudinal. A ESCRITA
  // continua presa ao vínculo real (`isLinkedPet`), sem bypass.
  const all = scopeReadablePets(db, guard.ctx, db.pets.filter((p) => p.businessId === businessId && (!tutorId || p.tutorId === tutorId)));
  return NextResponse.json({
    vet: business?.clinicType === 'veterinaria',
    clinicType: business?.clinicType || 'geral',
    pets: (tutorId ? petsOfTutor(all, tutorId) : all).map((pet) => petResponse(pet, guard.ctx)),
  });
}

const ALLERGY_ACTIONS = ['allergy-add', 'allergy-update', 'allergy-deactivate'];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, ['clientes', 'atendimento']);
    if (!guard.ok) return guard.res;
    const action = String(body.action || '');
    const scoped = isProfessionalScoped(guard.ctx);

    // ── ALERGIAS (Etapa 2) ─────────────────────────────────────────────
    if (ALLERGY_ACTIONS.includes(action)) {
      if (!can(guard.ctx, 'atendimento')) {
        return NextResponse.json({ error: 'Alergia é registro clínico: quem grava é a equipe de atendimento.' }, { status: 403 });
      }
      const petId = String(body.petId || '');
      const actor = guard.ctx.user;
      if (action === 'allergy-add') {
        const problem = validatePetAllergy(body.allergy || {});
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      }
      if (action === 'allergy-update') {
        const problem = validatePetAllergy(body.allergy || {});
        if (problem) return NextResponse.json({ error: problem }, { status: 400 });
      }
      const saved = await updateDB((d) => {
        const pet = d.pets.find((p) => p.id === petId && p.businessId === businessId);
        if (!pet) {
          throw Object.assign(new Error('Pet não encontrado nesta unidade.'), { status: 404 });
        }
        if (scoped && !isLinkedPet(d, guard.ctx, pet)) {
          // Autorização, não inexistência: o pet já é legível para quem pergunta
          // (leitura clínica da unidade), então a recusa pode dizer o motivo sem
          // revelar dado inacessível. Sem leitura nenhuma, continua 404.
          if (canReadPet(d, guard.ctx, pet)) {
            throw Object.assign(new Error('Sem vínculo clínico com este paciente: alergias só podem ser registradas pela equipe que atende o pet.'), { status: 403 });
          }
          throw Object.assign(new Error('Pet não encontrado nesta unidade.'), { status: 404 });
        }
        const now = new Date().toISOString();
        const list: PetAllergy[] = Array.isArray(pet.allergies) ? pet.allergies : [];
        const allergyId = String(body.allergyId || '');
        let change: 'added' | 'updated' | 'inactivated';
        if (action === 'allergy-add') {
          if (list.length >= PET_ALLERGY_MAX) {
            throw Object.assign(new Error(`Limite de ${PET_ALLERGY_MAX} alergias por paciente.`), { status: 400 });
          }
          const row = sanitizePetAllergy(body.allergy || {}, { id: randomUUID(), recordedBy: actor.id, at: now });
          pet.allergies = [...list, row];
          change = 'added';
        } else {
          const target = list.find((a) => a.id === allergyId);
          if (!target) throw Object.assign(new Error('Alergia não encontrada neste paciente.'), { status: 404 });
          if (!target.active) throw Object.assign(new Error('Esta alergia já foi inativada.'), { status: 409 });
          if (action === 'allergy-update') {
            const clean = sanitizePetAllergy(body.allergy || {}, { id: target.id, recordedBy: actor.id, at: target.recordedAt });
            Object.assign(target, { substance: clean.substance, reaction: clean.reaction, severity: clean.severity, recordedBy: actor.id });
            change = 'updated';
          } else {
            Object.assign(target, { active: false, inactivatedAt: now });
            change = 'inactivated';
          }
        }
        pet.updatedAt = now;
        pushAudit(d, {
          action: 'pet.allergy_changed', businessId, actor,
          // Sem o texto clínico no log: só o que mudou e onde.
          meta: { petId: pet.id, change, allergyId: change === 'added' ? '' : allergyId },
        }, now);
        return pet;
      });
      return NextResponse.json({ ok: true, pet: petResponse(saved, guard.ctx) });
    }

    // Cadastrar/remover paciente é da recepção/gestão; quem atende só ajusta
    // os pacientes que atende (nunca cria nem apaga).
    if (scoped && action !== 'update') {
      return NextResponse.json({ error: 'O cadastro de pacientes é feito pela recepção. Você ajusta os pacientes dos seus atendimentos.' }, { status: 403 });
    }

    if (action === 'create' || action === 'update') {
      const tutorId = String(body.tutorId || '');
      if (!tutorId) return NextResponse.json({ error: 'Informe o tutor do pet.' }, { status: 400 });
      const problem = validatePet(body.pet || {});
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });

      const saved = await updateDB((db) => {
        const now = new Date().toISOString();
        const tutor = db.contacts.find((c) => c.id === tutorId && c.businessId === businessId);
        if (!tutor || !isLinkedContact(db, guard.ctx, tutor)) throw Object.assign(new Error('Tutor não encontrado nesta unidade.'), { status: 404 });
        const id = String((body.pet && body.pet.id) || '');
        const existing = id ? db.pets.find((p) => p.id === id && p.businessId === businessId) : undefined;
        if (scoped && (!existing || !isLinkedPet(db, guard.ctx, existing))) {
          throw Object.assign(new Error('Pet não encontrado.'), { status: 404 });
        }
        if (existing) {
          // Só os campos de cadastro: `sanitizePet` não carrega `allergies`, então
          // a alergia estruturada nunca é sobrescrita por uma edição de cadastro.
          const clean = sanitizePet({ id: existing.id, businessId, tutorId }, body.pet || {});
          Object.assign(existing, clean, { updatedAt: now });
          return existing;
        }
        const pet: Pet = {
          ...sanitizePet({ id: randomUUID(), businessId, tutorId }, body.pet || {}),
          allergies: [],
          createdAt: now, updatedAt: now,
        };
        db.pets.push(pet);
        return pet;
      });
      return NextResponse.json({ ok: true, pet: petResponse(saved, guard.ctx) });
    }

    if (action === 'delete') {
      const id = String(body.id || '');
      const db0 = await readDB();
      const mine = db0.pets.find((p) => p.id === id && p.businessId === businessId);
      if (!mine) return NextResponse.json({ error: 'Pet não encontrado.' }, { status: 404 });
      // PROTEGIDO: apagar o pet de agendamentos/atendimentos existentes
      // apagaria o paciente do histórico — o correto é desativar.
      const usedByBooking = db0.bookings.some((b) => b.businessId === businessId && b.petId === id);
      const usedByEncounter = db0.encounters.some((e) => e.businessId === businessId && e.petId === id);
      if (usedByBooking || usedByEncounter) {
        await updateDB((d) => {
          const p = d.pets.find((x) => x.id === id && x.businessId === businessId);
          if (p) { p.active = false; p.updatedAt = new Date().toISOString(); }
        });
        return NextResponse.json({ ok: true, deactivated: true });
      }
      await updateDB((d) => {
        d.pets = d.pets.filter((p) => !(p.id === id && p.businessId === businessId));
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (e: any) {
    const status = e?.status || 500;
    if (status === 500) console.error('[pets] falhou:', e);
    return NextResponse.json({ error: status === 500 ? 'Não foi possível concluir a operação.' : e.message }, { status });
  }
}
