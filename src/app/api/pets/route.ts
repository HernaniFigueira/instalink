import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { readDB, updateDB } from '@/lib/db';
import { requireBusiness } from '@/lib/access';
import { sanitizePet, validatePet, petsOfTutor } from '@/lib/pets';
import type { Pet } from '@/lib/types';

// ═══════════════════════════════════════════════════════════════
// FASE 2 · P6 — PETS (pacientes veterinários) — API
// ═══════════════════════════════════════════════════════════════
// Tutor (BusinessCustomer) continua sendo a PESSOA de contato; o pet é a
// entidade do paciente. Permissão: quem opera clientes/atendimento.
// GET  ?businessId=&tutorId=  → { vet, pets }  (vet = clinicType veterinaria)
// POST { action: 'create'|'update'|'delete', ... }

export async function GET(req: NextRequest) {
  const businessId = req.nextUrl.searchParams.get('businessId') || '';
  const tutorId = req.nextUrl.searchParams.get('tutorId') || '';
  const guard = await requireBusiness(req, businessId, ['clientes', 'atendimento']);
  if (!guard.ok) return guard.res;
  const db = guard.db;
  const business = db.businesses.find((b) => b.id === businessId);
  const all = db.pets.filter((p) => p.businessId === businessId && (!tutorId || p.tutorId === tutorId));
  return NextResponse.json({
    vet: business?.clinicType === 'veterinaria',
    clinicType: business?.clinicType || 'geral',
    pets: tutorId ? petsOfTutor(all, tutorId) : all,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const businessId = String(body.businessId || '');
    const guard = await requireBusiness(req, businessId, ['clientes', 'atendimento']);
    if (!guard.ok) return guard.res;
    const action = String(body.action || '');

    if (action === 'create' || action === 'update') {
      const tutorId = String(body.tutorId || '');
      if (!tutorId) return NextResponse.json({ error: 'Informe o tutor do pet.' }, { status: 400 });
      const problem = validatePet(body.pet || {});
      if (problem) return NextResponse.json({ error: problem }, { status: 400 });

      const saved = await updateDB((db) => {
        const now = new Date().toISOString();
        const tutor = db.contacts.find((c) => c.id === tutorId && c.businessId === businessId);
        if (!tutor) throw Object.assign(new Error('Tutor não encontrado nesta unidade.'), { status: 404 });
        const id = String((body.pet && body.pet.id) || '');
        const existing = id ? db.pets.find((p) => p.id === id && p.businessId === businessId) : undefined;
        if (existing) {
          const clean = sanitizePet({ id: existing.id, businessId, tutorId }, body.pet || {});
          Object.assign(existing, clean, { updatedAt: now });
          return existing;
        }
        const pet: Pet = {
          ...sanitizePet({ id: randomUUID(), businessId, tutorId }, body.pet || {}),
          createdAt: now, updatedAt: now,
        };
        db.pets.push(pet);
        return pet;
      });
      return NextResponse.json({ ok: true, pet: saved });
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
