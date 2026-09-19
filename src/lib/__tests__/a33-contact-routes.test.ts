// A3.3 — carteirinha do cliente nas rotas reais (POST/PATCH /api/contacts e GET /api/people360).
// Cobre o que só aparece no servidor: normalização do cadastro, idade SEMPRE derivada,
// PATCH parcial, CPF inválido recusado com 400 (e não 500) e a busca por CPF/e-mail.
import './helpers/temp-db';

import fs from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, writeDB } from '../db';
import { createSession } from '../auth';
import { POST as contactsPOST, PATCH as contactsPATCH } from '@/app/api/contacts/route';
import { GET as people360GET } from '@/app/api/people360/route';
import type { Business, DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const BUSINESS_ID = 'biz-a33';
const OWNER_ID = 'owner-a33';

function business(id: string): Business {
  return {
    id,
    ownerId: OWNER_ID,
    organizationId: `org-${id}`,
    name: `Negócio ${id}`,
    slug: id,
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
  db.users.push({ id: OWNER_ID, name: 'Dono A3.3', email: 'a33@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' });
  db.businesses.push(business(BUSINESS_ID));
  await writeDB(db);
}

function jsonReq(path: string, body: unknown, token?: string, method = 'POST'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers,
    ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body) }),
  });
}

const json = (res: Response) => res.json() as Promise<any>;

let token = '';
beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  token = await createSession(OWNER_ID);
});

async function createContact(extra: Record<string, unknown> = {}) {
  const res = await contactsPOST(jsonReq('/api/contacts', {
    businessId: BUSINESS_ID,
    name: 'Ana Carteirinha',
    phone: '11988880001',
    email: 'ana.cart@example.com',
    source: 'manual',
    ...extra,
  }, token));
  expect(res.status).toBe(200);
  const body = await json(res);
  return body.contact;
}

describe('A3.3 — cadastro da carteirinha nas rotas', () => {
  it('POST normaliza o cadastro e deriva a idade (nunca salva idade no banco)', async () => {
    const contact = await createContact({
      profile: {
        birthDate: '2016-04-10',
        cpf: '529.982.247-25',
        gender: 'f',
        adminNote: 'Alergia a dipirona',
        address: { cep: '01310-100', street: 'Av Paulista', number: '1000', state: 'sp' },
        guardian: { name: 'Ana Mãe', phone: '(11) 97777-0000' },
        tags: ['convênio', 'convênio', 'vip'],
      },
    });
    expect(contact.profile.cpf).toBe('52998224725');
    expect(contact.profile.address.cep).toBe('01310100');
    expect(contact.profile.address.state).toBe('SP');
    expect(contact.profile.guardian.phone).toBe('11977770000');
    expect(contact.profile.tags).toEqual(['convênio', 'vip']);
    // Idade derivada: 10 anos em 2026-09-19.
    expect(contact.age).toBe(10);
    expect(contact.profile).not.toHaveProperty('age');
    // Menor de idade é derivado da data de nascimento, não de uma flag enviada.
    expect(contact.tags.map((t: any) => t.id)).toContain('menor');
  });

  it('PATCH com CPF inválido responde 400 com mensagem clara (não 500)', async () => {
    const contact = await createContact();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID,
      id: contact.id,
      profile: { cpf: '111.111.111-11' },
    }, token, 'PATCH'));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/cpf/i);
  });

  it('PATCH é parcial: só os campos enviados mudam', async () => {
    const contact = await createContact({
      profile: {
        birthDate: '1990-01-01',
        cpf: '52998224725',
        adminNote: 'Observação original',
        address: { cep: '01310100', street: 'Av Paulista', city: 'São Paulo', state: 'SP' },
        tags: ['vip'],
      },
    });
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID,
      id: contact.id,
      profile: { tags: ['retorno'] },
    }, token, 'PATCH'));
    expect(res.status).toBe(200);
    const profile = (await json(res)).contact.profile;
    expect(profile.tags).toEqual(['retorno']);
    expect(profile.cpf).toBe('52998224725');
    expect(profile.adminNote).toBe('Observação original');
    expect(profile.address.street).toBe('Av Paulista');
    expect(profile.address.state).toBe('SP');
    expect(profile.birthDate).toBe('1990-01-01');
  });

  it('PATCH de contato legado (sem profile) cria o cadastro sem quebrar nada', async () => {
    const contact = await createContact();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID,
      id: contact.id,
      profile: { birthDate: '1985-07-20' },
    }, token, 'PATCH'));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.contact.profile.birthDate).toBe('1985-07-20');
    expect(body.contact.name).toBe('Ana Carteirinha');
    expect(body.contact.phone).toBe('11988880001');
  });

  it('PATCH sem sessão é recusado', async () => {
    const contact = await createContact();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID,
      id: contact.id,
      profile: { adminNote: 'invasão' },
    }, undefined, 'PATCH'));
    expect(res.status).toBe(401);
  });
});

describe('A3.3 — busca e filtros do cliente 360', () => {
  it('encontra por CPF com ou sem máscara', async () => {
    await createContact({ profile: { cpf: '52998224725' } });
    const masked = await json(await people360GET(jsonReq(`/api/people360?businessId=${BUSINESS_ID}&q=529.982.247-25`, null, token, 'GET')));
    expect(masked.people.map((p: any) => p.name)).toEqual(['Ana Carteirinha']);
    const plain = await json(await people360GET(jsonReq(`/api/people360?businessId=${BUSINESS_ID}&q=52998224725`, null, token, 'GET')));
    expect(plain.people.map((p: any) => p.name)).toEqual(['Ana Carteirinha']);
  });

  it('trecho curto de dígitos não vira busca de CPF (sem chuva de falsos positivos)', async () => {
    await createContact({ profile: { cpf: '52998224725' } });
    await createContact({ name: 'Bruno Outros', phone: '11933334444', email: 'bruno@example.com' });
    const res = await json(await people360GET(jsonReq(`/api/people360?businessId=${BUSINESS_ID}&q=33`, null, token, 'GET')));
    // O telefone continua buscável por trecho; o CPF não entra com só 2 dígitos.
    expect(res.people.map((p: any) => p.name)).toContain('Bruno Outros');
    expect(res.people.map((p: any) => p.name)).not.toContain('Ana Carteirinha');
  });

  it('filtro minor=yes usa a idade derivada', async () => {
    await createContact({ profile: { birthDate: '2018-03-03' } });
    await createContact({ name: 'Carlos Adulto', phone: '11922223333', email: 'carlos@example.com', profile: { birthDate: '1980-05-05' } });
    const res = await json(await people360GET(jsonReq(`/api/people360?businessId=${BUSINESS_ID}&minor=yes`, null, token, 'GET')));
    expect(res.total).toBe(1);
    expect(res.people[0].name).toBe('Ana Carteirinha');
    expect(res.people[0].age).toBe(8);
  });

  it('filtro consent=yes respeita o consentimento de marketing', async () => {
    await createContact({ marketingOptIn: true });
    await createContact({ name: 'Bruno Sem', phone: '11933334444', email: 'bruno@example.com', marketingOptIn: false });
    const yes = await json(await people360GET(jsonReq(`/api/people360?businessId=${BUSINESS_ID}&consent=yes`, null, token, 'GET')));
    expect(yes.people.map((p: any) => p.name)).toEqual(['Ana Carteirinha']);
    const no = await json(await people360GET(jsonReq(`/api/people360?businessId=${BUSINESS_ID}&consent=no`, null, token, 'GET')));
    expect(no.people.map((p: any) => p.name)).toEqual(['Bruno Sem']);
  });

  it('filtro access separa quem tem acesso de quem não tem', async () => {
    await createContact();
    await createContact({ name: 'Bruno Com Acesso', phone: '11933334444', email: 'bruno@example.com', createAccount: true });
    const active = await json(await people360GET(jsonReq(`/api/people360?businessId=${BUSINESS_ID}&access=active`, null, token, 'GET')));
    expect(active.people.map((p: any) => p.name)).toEqual(['Bruno Com Acesso']);
    const none = await json(await people360GET(jsonReq(`/api/people360?businessId=${BUSINESS_ID}&access=none`, null, token, 'GET')));
    expect(none.people.map((p: any) => p.name)).toEqual(['Ana Carteirinha']);
  });
});
