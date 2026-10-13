// ═══════════════════════════════════════════════════════════════
// ETAPA 2 · INTEGRAÇÃO — TUTOR × PET × ALERGIAS (rotas reais, banco temporário)
// ═══════════════════════════════════════════════════════════════
// Travas (cada uma existe porque um defeito é possível):
//   A. atendimento NÃO grava no histórico de um pet com outro responsável (409);
//   B. sem responsável informado, o atendimento herda o tutor do pet;
//   C. o histórico do pet (encounters?petId) não mistura pets do mesmo tutor;
//   D. alergia só é gravada por quem tem atendimento; recepção só lê;
//   E. profissional sem vínculo: lê o paciente (política clínica) mas NÃO grava alergia (403 com motivo);
//   F. alergia pertence ao petId: não vaza para o outro pet do tutor;
//   G. inativar mantém o registro (histórico); editar cadastro não apaga alergias;
//   H. pet de outra unidade não existe nesta (404).
import './helpers/temp-db';

import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, writeDB } from '../db';
import { createSession } from '../auth';
import { GET as petsGET, POST as petsPOST } from '@/app/api/pets/route';
import { POST as startPOST } from '@/app/api/encounters/start/route';
import { GET as encountersGET } from '@/app/api/encounters/route';
import type { Business, BusinessMember, DB, Professional, Service } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-10-03T12:00:00.000Z';
const BIZ = 'e2-aurora';
const OTHER = 'e2-outra';
const OWNER = 'e2-owner';
const MICHELE = 'e2-michele';   // profissional VINCULADA ao Thor (agendamento)
const ORLANDO = 'e2-orlando';   // profissional SEM vínculo com o Thor
const RECEPCAO = 'e2-recepcao';
const FORA = 'e2-fora';

function business(id: string, ownerId = OWNER): Business {
  return {
    id, ownerId, organizationId: `org-${id}`, name: `Clínica ${id}`, slug: id,
    description: '', logo: '', cover: '', niche: 'pet', clinicType: 'veterinaria',
    modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false },
    phone: '', whatsapp: '', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0,
    googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'auto', leadMin: 0, cancelUntilMin: 0, horizonDays: 60, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: false, createdAt: NOW, updatedAt: NOW, businessTimezone: 'America/Sao_Paulo',
  } as Business;
}

async function seed() {
  const db: DB = emptyDB();
  const user = (id: string, name: string, role: string) => ({ id, name, email: `${id}@e2.test`, passwordHash: 'x', createdAt: NOW, role } as DB['users'][number]);
  db.users.push(
    user(OWNER, 'Dono', 'owner'),
    user(MICHELE, 'Michele', 'admin'),
    user(ORLANDO, 'Orlando', 'admin'),
    user(RECEPCAO, 'Recepção', 'admin'),
    user(FORA, 'Fora', 'admin'),
  );
  db.businesses.push(business(BIZ), business(OTHER));
  const member = (id: string, businessId: string, userId: string, role: string) => ({
    id, businessId, userId, role, permissions: {}, note: '', invitedBy: OWNER, active: true, createdAt: NOW, updatedAt: NOW,
  } as BusinessMember);
  db.members.push(
    member('m-michele', BIZ, MICHELE, 'PROFISSIONAL'),
    member('m-orlando', BIZ, ORLANDO, 'PROFISSIONAL'),
    member('m-recepcao', BIZ, RECEPCAO, 'SECRETARIA'),
    member('m-fora', OTHER, FORA, 'PROFISSIONAL'),
  );
  const pro = (id: string, businessId: string, name: string, userId: string) => ({
    id, businessId, name, role: '', photo: '', active: true, userId, followBusinessHours: true,
  } as Professional);
  db.professionals.push(
    pro('pro-michele', BIZ, 'Michele', MICHELE),
    pro('pro-orlando', BIZ, 'Orlando', ORLANDO),
    pro('pro-fora', OTHER, 'Fora', FORA),
  );
  db.services.push({
    id: 'svc-consulta', businessId: BIZ, name: 'Consulta', durationMin: 30, price: 12000,
    description: '', active: true, bookable: true, professionalIds: [], categoryId: '', image: '', featured: false, questions: [],
  } as Service);
  // Dois tutores; Bernardo tem DOIS pets (Thor e Luna); Carolina tem Mel.
  db.contacts.push(
    { id: 'ct-bernardo', businessId: BIZ, customerId: '', name: 'Bernardo Tutor', phone: '11999990001', email: '', createdAt: NOW, updatedAt: NOW, source: 'manual', lastInteraction: NOW, marketingOptIn: true },
    { id: 'ct-carolina', businessId: BIZ, customerId: '', name: 'Carolina Tutora', phone: '11999990002', email: '', createdAt: NOW, updatedAt: NOW, source: 'manual', lastInteraction: NOW, marketingOptIn: true },
  );
  const pet = (id: string, businessId: string, tutorId: string, name: string) => ({
    id, businessId, tutorId, name, photo: '', species: 'cachorro', breed: 'SRD', sex: 'M', birthDate: '2020-01-01',
    weightKg: 10, notes: '', active: true, createdAt: NOW, updatedAt: NOW,
  } as DB['pets'][number]);
  db.pets.push(
    pet('pet-thor', BIZ, 'ct-bernardo', 'Thor'),
    pet('pet-luna', BIZ, 'ct-bernardo', 'Luna'),
    pet('pet-mel', BIZ, 'ct-carolina', 'Mel'),
    pet('pet-fora', OTHER, '', 'Pet de fora'),
  );
  const booking = (id: string, petId: string, petName: string, professionalId: string, customerName: string) => ({
    id, businessId: BIZ, customerId: '', serviceId: 'svc-consulta', professionalId,
    date: '2026-10-03', time: '14:00', customerName, customerPhone: '', status: 'confirmed', checkedInAt: NOW,
    note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [], petId, petName,
  } as unknown as DB['bookings'][number]);
  db.bookings.push(
    booking('bk-thor', 'pet-thor', 'Thor', 'pro-michele', 'Bernardo Tutor'),
    booking('bk-mel', 'pet-mel', 'Mel', 'pro-michele', 'Carolina Tutora'),
    // Walk-in / agendamento SEM pet identificado: continua permitido e não recebe animal.
    booking('bk-sem-pet', '', '', 'pro-michele', 'Visitante sem pet'),
  );
  await writeDB(db);
}

function req(path: string, token: string, body?: unknown, method: 'GET' | 'POST' = 'GET'): NextRequest {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return new NextRequest(`http://localhost:3000${path}`, {
    method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const json = (res: Response) => res.json() as Promise<any>;

let ownerT = '';
let micheleT = '';
let orlandoT = '';
let recepcaoT = '';

function readDBFile(): DB {
  return JSON.parse(fs.readFileSync(TEMP_DB_FILE, 'utf8')) as DB;
}

beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  ownerT = await createSession(OWNER);
  micheleT = await createSession(MICHELE);
  orlandoT = await createSession(ORLANDO);
  recepcaoT = await createSession(RECEPCAO);
});

describe('A/B · atendimento respeita o vínculo tutor × pet', () => {
  it('A. responsável DIVERGENTE do tutor do pet é recusado (409) e nada é gravado', async () => {
    const res = await startPOST(req('/api/encounters/start', ownerT, {
      businessId: BIZ, bookingId: 'bk-thor', contactId: 'ct-carolina',
    }, 'POST'));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatch(/outro responsável/);
    expect(readDBFile().encounters.filter((e) => e.petId === 'pet-thor')).toHaveLength(0);
  });

  it('B. sem responsável informado, o atendimento herda o tutor do pet (nunca o de outro)', async () => {
    const res = await startPOST(req('/api/encounters/start', ownerT, { businessId: BIZ, bookingId: 'bk-thor' }, 'POST'));
    expect(res.status).toBe(200);
    const body = await json(res);
    const stored = readDBFile().encounters.find((e) => e.id === body.encounterId)!;
    expect(stored.petId).toBe('pet-thor');
    expect(stored.contactId).toBe('ct-bernardo');
  });
});

describe('W · atendimento sem pet identificado (walk-in) é permitido e NÃO recebe animal', () => {
  it('abre sem paciente e não atribui pet nenhum', async () => {
    const res = await startPOST(req('/api/encounters/start', ownerT, { businessId: BIZ, bookingId: 'bk-sem-pet' }, 'POST'));
    expect(res.status).toBe(200);
    const body = await json(res);
    const stored = readDBFile().encounters.find((e) => e.id === body.encounterId)!;
    expect(stored.petId || '').toBe('');
    // Nenhum atendimento clínico foi atribuído a um animal sem vínculo confirmado.
    expect(readDBFile().encounters.filter((e) => e.petId === 'pet-thor' || e.petId === 'pet-luna' || e.petId === 'pet-mel')).toHaveLength(0);
  });
});

describe('C · histórico do pet não mistura pets do mesmo tutor', () => {
  it('encounters?petId devolve SÓ os atendimentos daquele pet', async () => {
    const thor = await startPOST(req('/api/encounters/start', ownerT, { businessId: BIZ, bookingId: 'bk-thor' }, 'POST'));
    const mel = await startPOST(req('/api/encounters/start', ownerT, { businessId: BIZ, bookingId: 'bk-mel' }, 'POST'));
    expect(thor.status).toBe(200);
    expect(mel.status).toBe(200);
    const list = await json(await encountersGET(req(`/api/encounters?businessId=${BIZ}&petId=pet-thor`, ownerT)));
    const ids = (list.encounters || []).map((e: any) => e.petId);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id: string) => id === 'pet-thor')).toBe(true);
  });
});

describe('D/E/F/G/H · alergias: autorização, vínculo exclusivo e histórico', () => {
  it('D. recepção LÊ o cadastro mas NÃO grava alergia (403)', async () => {
    const read = await petsGET(req(`/api/pets?businessId=${BIZ}&petId=pet-thor`, recepcaoT));
    expect(read.status).toBe(200);
    const write = await petsPOST(req('/api/pets', recepcaoT, {
      action: 'allergy-add', businessId: BIZ, petId: 'pet-thor', allergy: { substance: 'Dipirona', severity: 'grave' },
    }, 'POST'));
    expect(write.status).toBe(403);
  });

  it('E. profissional SEM vínculo: LÊ o paciente (política clínica); grava → 403 com motivo, nunca "inexistente"', async () => {
    // Política documentada em /api/pets (CLINICAL ACCESS): o profissional da unidade
    // localiza os pacientes para o histórico longitudinal; a ESCRITA exige vínculo real.
    const read = await petsGET(req(`/api/pets?businessId=${BIZ}&petId=pet-thor`, orlandoT));
    expect(read.status).toBe(200);
    const write = await petsPOST(req('/api/pets', orlandoT, {
      action: 'allergy-add', businessId: BIZ, petId: 'pet-thor', allergy: { substance: 'Frango', severity: 'leve' },
    }, 'POST'));
    // Autorização (403) com motivo — o pet é legível por ele, então não é "inexistente".
    expect(write.status).toBe(403);
    expect((await json(write)).error).toMatch(/Sem vínculo clínico/);
    const db = readDBFile();
    expect(db.pets.find((p) => p.id === 'pet-thor')?.allergies ?? []).toHaveLength(0);
  });

  it('F. alergia gravada no Thor NÃO aparece na Luna (mesmo tutor)', async () => {
    const add = await petsPOST(req('/api/pets', ownerT, {
      action: 'allergy-add', businessId: BIZ, petId: 'pet-thor',
      allergy: { substance: 'Dipirona', reaction: 'vômito', severity: 'grave' },
    }, 'POST'));
    expect(add.status).toBe(200);
    const thor = await json(await petsGET(req(`/api/pets?businessId=${BIZ}&petId=pet-thor`, ownerT)));
    const luna = await json(await petsGET(req(`/api/pets?businessId=${BIZ}&petId=pet-luna`, ownerT)));
    expect(thor.pet.allergies.filter((a: any) => a.active).map((a: any) => a.substance)).toEqual(['Dipirona']);
    expect(luna.pet.allergies ?? []).toHaveLength(0);
    // E no banco: a alergia está no pet certo, e só nele.
    const db = readDBFile();
    expect(db.pets.find((p) => p.id === 'pet-luna')?.allergies ?? []).toHaveLength(0);
  });

  it('G. inativar mantém o registro; editar cadastro NÃO apaga alergias', async () => {
    const add = await json(await petsPOST(req('/api/pets', ownerT, {
      action: 'allergy-add', businessId: BIZ, petId: 'pet-thor', allergy: { substance: 'Frango', severity: 'moderada' },
    }, 'POST')));
    const allergyId = add.pet.allergies[0].id;
    // Edição de cadastro (nome) não toca nas alergias.
    const upd = await petsPOST(req('/api/pets', ownerT, {
      action: 'update', businessId: BIZ, tutorId: 'ct-bernardo', pet: { id: 'pet-thor', name: 'Thor Jr', species: 'cachorro', breed: 'SRD', sex: 'M', birthDate: '2020-01-01', weightKg: 31.4, notes: '', photo: '' },
    }, 'POST'));
    expect(upd.status).toBe(200);
    let thor = await json(await petsGET(req(`/api/pets?businessId=${BIZ}&petId=pet-thor`, ownerT)));
    expect(thor.pet.name).toBe('Thor Jr');
    expect(thor.pet.allergies.filter((a: any) => a.active)).toHaveLength(1);
    // Inativar: sai da lista ativa, mas o registro continua no histórico.
    const off = await petsPOST(req('/api/pets', ownerT, {
      action: 'allergy-deactivate', businessId: BIZ, petId: 'pet-thor', allergyId,
    }, 'POST'));
    expect(off.status).toBe(200);
    thor = await json(await petsGET(req(`/api/pets?businessId=${BIZ}&petId=pet-thor`, ownerT)));
    expect(thor.pet.allergies.filter((a: any) => a.active)).toHaveLength(0);
    expect(thor.pet.allergies.find((a: any) => a.id === allergyId)?.active).toBe(false);
  });

  it('H. pet de OUTRA unidade é 404 nesta unidade (sem revelar existência)', async () => {
    const res = await petsGET(req(`/api/pets?businessId=${BIZ}&petId=pet-fora`, ownerT));
    expect(res.status).toBe(404);
  });

  it('D2. profissional VINCULADA ao Thor (agendamento) grava alergia do Thor', async () => {
    const res = await petsPOST(req('/api/pets', micheleT, {
      action: 'allergy-add', businessId: BIZ, petId: 'pet-thor', allergy: { substance: 'Picada de pulga', severity: 'leve' },
    }, 'POST'));
    expect(res.status).toBe(200);
  });
});
