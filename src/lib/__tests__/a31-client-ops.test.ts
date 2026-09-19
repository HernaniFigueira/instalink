// A3.1 — portas operacionais de CRM, acesso Customer e elegibilidade.
// Este arquivo exercita as rotas reais sobre um banco temporário: captura
// pública continua sendo quote; painel usa manual; contato não cria lead.
import './helpers/temp-db';

import fs from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, updateDB, writeDB } from '../db';
import { createSession, verifyPassword } from '../auth';
import { POST as publicLeadsPOST } from '@/app/api/leads/route';
import { POST as manualLeadsPOST } from '@/app/api/leads/manual/route';
import { POST as contactsPOST } from '@/app/api/contacts/route';
import { POST as customerRegisterPOST } from '@/app/api/customer/register/route';
import { PATCH as bookingsPATCH } from '@/app/api/bookings/route';
import type { Business, DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-18T12:00:00.000Z';
const BUSINESS_ID = 'biz-a31';
const OTHER_BUSINESS_ID = 'biz-other';
const OWNER_ID = 'owner-a31';

function business(id: string, ownerId = OWNER_ID): Business {
  return {
    id,
    ownerId,
    organizationId: `org-${id}`,
    name: `Negócio ${id}`,
    slug: id,
    description: '', logo: '', cover: '', niche: 'servicos', modes: ['services', 'bookings'],
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
  db.users.push({ id: OWNER_ID, name: 'Dono A3.1', email: 'a31@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' });
  db.users.push({ id: 'other-owner', name: 'Outro dono', email: 'other@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' });
  db.businesses.push(business(BUSINESS_ID), business(OTHER_BUSINESS_ID, 'other-owner'));
  await writeDB(db);
}

function jsonReq(path: string, body: unknown, token?: string, method = 'POST'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`http://localhost:3000${path}`, {
    method, headers, body: JSON.stringify(body),
  });
}

async function json(res: Response): Promise<any> {
  return res.json();
}

let ownerToken = '';
beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  ownerToken = await createSession(OWNER_ID);
});

describe('A3.1 — lead público versus lead manual', () => {
  it('POST /api/leads continua público, mas protegido pelo módulo quote', async () => {
    const res = await publicLeadsPOST(jsonReq('/api/leads', {
      businessId: BUSINESS_ID,
      origin: 'orcamento',
      name: 'Visitante',
      phone: '11911112222',
    }));
    expect(res.status).toBe(403);
    expect((await json(res)).error).toMatch(/orçamento/i);
    expect((await readDB()).leads).toHaveLength(0);
  });

  it('POST /api/leads/manual exige sessão/permissão, força origem manual e deduplica', async () => {
    const unauthenticated = await manualLeadsPOST(jsonReq('/api/leads/manual', {
      businessId: BUSINESS_ID, name: 'Sem sessão', phone: '11911113333', origin: 'instagram',
    }));
    expect(unauthenticated.status).toBe(401);

    const first = await manualLeadsPOST(jsonReq('/api/leads/manual', {
      businessId: BUSINESS_ID,
      name: 'Marina Manual', phone: '(11) 91111-2222', email: 'MARINA@example.com',
      origin: 'instagram', interest: 'Consulta', priority: 'high',
    }, ownerToken));
    const firstBody = await json(first);
    expect(first.status).toBe(200);
    expect(firstBody.created).toBe(true);
    expect(firstBody.lead.origin).toBe('manual');
    expect(firstBody.lead.stageId).toBe('new');
    expect(firstBody.contact.businessId).toBe(BUSINESS_ID);

    const duplicate = await manualLeadsPOST(jsonReq('/api/leads/manual', {
      businessId: BUSINESS_ID, name: 'Marina atualizada', phone: '11911112222', origin: 'whatsapp',
    }, ownerToken));
    const duplicateBody = await json(duplicate);
    expect(duplicate.status).toBe(200);
    expect(duplicateBody.created).toBe(false);

    const db = await readDB();
    expect(db.leads).toHaveLength(1);
    expect(db.contacts).toHaveLength(1);
    expect(db.leads[0].origin).toBe('manual');
    expect(db.audit.some((a) => a.action === 'lead.created' && a.businessId === BUSINESS_ID)).toBe(true);
    expect(db.audit.some((a) => a.action === 'lead.updated' && a.businessId === BUSINESS_ID)).toBe(true);
  });

  it('manual é tenant-scoped: dono de A não grava em B', async () => {
    const res = await manualLeadsPOST(jsonReq('/api/leads/manual', {
      businessId: OTHER_BUSINESS_ID, name: 'Fora do tenant', phone: '11911114444',
    }, ownerToken));
    expect(res.status).toBe(403);
    expect((await readDB()).leads).toHaveLength(0);
  });
});

describe('A3.1 — servidor é autoridade na elegibilidade do drag', () => {
  it('PATCH de agendamento não aceita Silvio quando o serviço é só de Orlando', async () => {
    await updateDB((db) => {
      db.services.push({
        id: 'svc-odonto-a31', businessId: BUSINESS_ID, categoryId: '', name: 'Odonto', description: '', image: '',
        price: 10000, showPrice: true, durationMin: 60, professionalIds: ['orlando-a31'], active: true,
        featured: false, bookable: true, questions: [],
      });
      db.professionals.push(
        { id: 'orlando-a31', businessId: BUSINESS_ID, name: 'Orlando', role: 'Dentista', photo: '', active: true, followBusinessHours: true },
        { id: 'silvio-a31', businessId: BUSINESS_ID, name: 'Silvio', role: 'Dentista', photo: '', active: true, followBusinessHours: true },
      );
      db.availability.push({ id: 'av-a31', businessId: BUSINESS_ID, professionalId: '', serviceId: '', weekday: 1, start: '08:00', end: '18:00', slotMin: 60 });
      db.bookings.push({
        id: 'booking-a31', businessId: BUSINESS_ID, customerId: '', serviceId: 'svc-odonto-a31', professionalId: 'silvio-a31',
        date: '2026-09-21', time: '10:00', customerName: 'Paciente', customerPhone: '11995556666', status: 'pending',
        note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [],
      });
    });
    const res = await bookingsPATCH(jsonReq('/api/bookings', {
      businessId: BUSINESS_ID, id: 'booking-a31', date: '2026-09-21', time: '11:00', professionalId: 'silvio-a31',
    }, ownerToken, 'PATCH'));
    expect(res.status).toBe(400);
    expect((await readDB()).bookings[0].time).toBe('10:00');
  });
});

describe('A3.1 — cadastro direto de pessoa e conta opcional', () => {
  it('contato sem acesso não cria Lead/Booking e opt-in começa desligado', async () => {
    const res = await contactsPOST(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID,
      name: 'Pessoa CRM', phone: '(11) 92222-3333', email: 'pessoa@example.com',
      note: 'Prefere manhã', marketingOptIn: false,
    }, ownerToken));
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.contact.accountStatus).toBe('none');
    expect(body.contact.marketingOptIn).toBe(false);

    const db = await readDB();
    expect(db.contacts).toHaveLength(1);
    expect(db.customers).toHaveLength(0);
    expect(db.leads).toHaveLength(0);
    expect(db.bookings).toHaveLength(0);
  });

  it('deduplica cadastro direto por e-mail quando o WhatsApp ainda não existe', async () => {
    const first = await contactsPOST(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, name: 'Pessoa por e-mail', email: 'email-only@example.com',
    }, ownerToken));
    expect(first.status).toBe(200);
    const second = await contactsPOST(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, name: 'Pessoa por e-mail atualizada', email: 'EMAIL-ONLY@example.com',
    }, ownerToken));
    expect(second.status).toBe(200);
    expect((await readDB()).contacts).toHaveLength(1);
  });

  it('cria uma Customer única, associa customerId e emite a senha temporária uma vez', async () => {
    const first = await contactsPOST(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID,
      name: 'Pessoa com acesso', phone: '11992223333', email: 'acesso@example.com',
      createAccount: true,
    }, ownerToken));
    const firstBody = await json(first);
    expect(first.status).toBe(200);
    expect(firstBody.temporaryPassword).toMatch(/^[A-Za-z0-9]{16}$/);
    expect(firstBody.contact.accountStatus).toBe('active');
    expect(firstBody.contact.mustChangePassword).toBe(true);

    const second = await contactsPOST(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID,
      name: 'Pessoa com acesso', phone: '11992223333', email: 'acesso@example.com',
      createAccount: true,
    }, ownerToken));
    const secondBody = await json(second);
    expect(second.status).toBe(200);
    expect(secondBody.temporaryPassword).toBeUndefined();

    const db = await readDB();
    expect(db.customers).toHaveLength(1);
    expect(db.contacts).toHaveLength(1);
    expect(db.contacts[0].customerId).toBe(db.customers[0].id);
    expect(db.customers[0].passwordHash).not.toBe(firstBody.temporaryPassword);
    expect(verifyPassword(firstBody.temporaryPassword, db.customers[0].passwordHash)).toBe(true);
    expect(db.leads).toHaveLength(0);
    expect(db.bookings).toHaveLength(0);
    expect(db.audit.filter((a) => a.action === 'customer.access_created')).toHaveLength(1);
  });

  it('o cadastro público continua criando conta com a mesma rota existente', async () => {
    const res = await customerRegisterPOST(jsonReq('/api/customer/register', {
      name: 'Cadastro público', phone: '11993334444', email: 'public@example.com', password: 'public123',
    }));
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.token).toBeTruthy();
    expect(body.customer.mustChangePassword).toBe(false);
    expect((await readDB()).customers).toHaveLength(1);
  });
});
