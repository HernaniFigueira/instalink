// P0.2 — "Vincular à equipe clínica" não pode criar segundo cadastro para um profissional que
// já existe na unidade sem login (ex.: "Dra. Michele Martins" cadastrada pela clínica).
import './helpers/temp-db';

import fs from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { POST as accountPOST } from '@/app/api/account/route';
import type { Business, DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-10-13T12:00:00.000Z';
const BUSINESS_ID = 'biz-p02';
const OWNER_ID = 'owner-p02';

function business(id: string): Business {
  return {
    id, ownerId: OWNER_ID, organizationId: `org-${id}`, name: `Negócio ${id}`, slug: id,
    description: '', logo: '', cover: '', niche: 'saude', modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false },
    phone: '', whatsapp: '', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0,
    googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 30, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: NOW, updatedAt: NOW,
  } as Business;
}

async function seed() {
  const db: DB = emptyDB();
  db.users.push({ id: OWNER_ID, name: 'Michele Martins', email: 'p02@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' });
  db.businesses.push(business(BUSINESS_ID));
  // Cadastro feito pela clínica, SEM login vinculado.
  db.professionals.push({
    id: 'pro-michele-clinica', businessId: BUSINESS_ID, name: 'Dra. Michele Martins', role: 'Médica veterinária',
    photo: '', active: true, followBusinessHours: true,
  } as any);
  await writeDB(db);
}

function req(body: unknown, token: string): NextRequest {
  return new NextRequest('http://localhost:3000/api/account', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

let token = '';
beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  token = await createSession(OWNER_ID);
});

describe('P0.2 · link_as_professional não duplica profissional existente', () => {
  it('nome igual (ignorando "Dr./Dra." e caixa) → 409 com o candidato, sem criar registro', async () => {
    const res = await accountPOST(req({ action: 'link_as_professional', businessId: BUSINESS_ID }, token));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('professional_name_taken');
    expect(body.candidate).toEqual({ id: 'pro-michele-clinica', name: 'Dra. Michele Martins' });
    expect(body.error).toMatch(/Equipe/);

    const db = await readDB();
    const same = db.professionals.filter((p) => p.businessId === BUSINESS_ID && /michele martins/i.test(p.name));
    expect(same).toHaveLength(1);
    expect(same[0].userId || '').toBe(''); // sem login vinculado (o banco normaliza para string vazia)
  });

  it('nome sem acento e com título diferente também conta como duplicata', async () => {
    const res = await accountPOST(req({ action: 'link_as_professional', businessId: BUSINESS_ID, professionalName: 'DR. MICHELE MARTINS' }, token));
    expect(res.status).toBe(409);
  });

  it('nome realmente diferente continua criando e vinculando normalmente', async () => {
    const res = await accountPOST(req({ action: 'link_as_professional', businessId: BUSINESS_ID, professionalName: 'Dr. Carlos Lima' }, token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alreadyLinked).toBe(false);
    const db = await readDB();
    expect(db.professionals.filter((p) => p.businessId === BUSINESS_ID)).toHaveLength(2);
  });

  it('o mesmo login chamando de novo recebe o vínculo existente (sem duplicar)', async () => {
    const created = await accountPOST(req({ action: 'link_as_professional', businessId: BUSINESS_ID, professionalName: 'Dr. Carlos Lima' }, token));
    expect(created.status).toBe(200);
    const again = await accountPOST(req({ action: 'link_as_professional', businessId: BUSINESS_ID, professionalName: 'Dr. Carlos Lima' }, token));
    const body = await again.json();
    expect(body.alreadyLinked).toBe(true);
    const db = await readDB();
    expect(db.professionals.filter((p) => p.businessId === BUSINESS_ID)).toHaveLength(2);
  });
});
