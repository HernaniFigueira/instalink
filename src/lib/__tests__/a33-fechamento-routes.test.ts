// Fechamento A3.3 — rotas reais sobre banco temporário.
// Cobre: edição de nome/telefone/e-mail com recusa de conflito (e conta global
// intacta), CPF validado no POST E no PATCH (cliente e responsável), avatar real
// vindo do Customer e a regra correta de "já atendido".
import './helpers/temp-db';

import fs from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, updateDB, writeDB } from '../db';
import { createSession } from '../auth';
import { POST as contactsPOST, PATCH as contactsPATCH } from '@/app/api/contacts/route';
import { GET as people360GET } from '@/app/api/people360/route';
import type { Booking, Business, DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const BUSINESS_ID = 'biz-fech';
const OWNER_ID = 'owner-fech';
const CPF_VALIDO = '52998224725';
const CPF_INVALIDO = '11111111111';

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
  db.users.push({ id: OWNER_ID, name: 'Dono Fech', email: 'fech@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' });
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
const get360 = async (qs: string, token: string) =>
  json(await people360GET(jsonReq(`/api/people360?businessId=${BUSINESS_ID}&${qs}`, null, token, 'GET')));

let token = '';
beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  token = await createSession(OWNER_ID);
});

async function create(extra: Record<string, unknown> = {}) {
  const res = await contactsPOST(jsonReq('/api/contacts', {
    businessId: BUSINESS_ID,
    name: 'Ana Cliente',
    phone: '11988880001',
    email: 'ana@exemplo.com',
    source: 'manual',
    ...extra,
  }, token));
  expect(res.status).toBe(200);
  return (await json(res)).contact;
}

/** Booking mínimo para os testes de "atendido". */
async function addBooking(customerId: string, status: Booking['status'], id = `bk-${status}-${Math.random().toString(36).slice(2, 7)}`) {
  await updateDB((db) => {
    db.bookings.push({
      id, businessId: BUSINESS_ID, customerId, serviceId: 'svc-1', professionalId: '',
      date: '2026-09-20', time: '10:00', customerName: 'Ana Cliente', customerPhone: '11988880001',
      status, note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [],
    } as Booking);
    return null;
  });
}

describe('Fechamento A3.3 — editar dados básicos de verdade (ponto 3)', () => {
  it('edita o nome', async () => {
    const c = await create();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, id: c.id, name: 'Ana Silva Cliente',
    }, token, 'PATCH'));
    expect(res.status).toBe(200);
    expect((await json(res)).contact.name).toBe('Ana Silva Cliente');
  });

  it('troca o telefone normalizando', async () => {
    const c = await create();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, id: c.id, phone: '(21) 97777-1234',
    }, token, 'PATCH'));
    expect(res.status).toBe(200);
    expect((await json(res)).contact.phone).toBe('21977771234');
  });

  it('troca o e-mail normalizando (minúsculas)', async () => {
    const c = await create();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, id: c.id, email: ' NOVO@Exemplo.COM ',
    }, token, 'PATCH'));
    expect(res.status).toBe(200);
    expect((await json(res)).contact.email).toBe('novo@exemplo.com');
  });

  it('nome vazio é recusado', async () => {
    const c = await create();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, id: c.id, name: '   ',
    }, token, 'PATCH'));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/nome/i);
  });

  it('telefone inválido é recusado', async () => {
    const c = await create();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, id: c.id, phone: '123',
    }, token, 'PATCH'));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/whatsapp/i);
  });

  it('e-mail inválido é recusado', async () => {
    const c = await create();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, id: c.id, email: 'nao-eh-email',
    }, token, 'PATCH'));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/e-mail/i);
  });

  it('não deixa o cliente ficar sem telefone E sem e-mail', async () => {
    const c = await create();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, id: c.id, phone: '', email: '',
    }, token, 'PATCH'));
    expect(res.status).toBe(400);
  });

  it('conflito de telefone com OUTRO contato é recusado (409) e nada muda', async () => {
    await create({ name: 'Bruno Outro', phone: '11933334444', email: 'bruno@exemplo.com' });
    const c = await create();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, id: c.id, phone: '11933334444',
    }, token, 'PATCH'));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatch(/WhatsApp/);
    // A ficha original segue intacta: ninguém foi fundido.
    const db = await readDB();
    expect(db.contacts.find((x) => x.id === c.id)?.phone).toBe('11988880001');
    expect(db.contacts).toHaveLength(2);
  });

  it('conflito de e-mail com OUTRO contato é recusado (409)', async () => {
    await create({ name: 'Bruno Outro', phone: '11933334444', email: 'bruno@exemplo.com' });
    const c = await create();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, id: c.id, email: 'bruno@exemplo.com',
    }, token, 'PATCH'));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatch(/e-mail/);
  });

  it('o MESMO contato pode reenviar o próprio telefone (não é conflito consigo)', async () => {
    const c = await create();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, id: c.id, phone: '11988880001',
    }, token, 'PATCH'));
    expect(res.status).toBe(200);
  });

  it('a conta global de login permanece intacta ao trocar telefone/e-mail', async () => {
    // Cria contato COM acesso: nasce um Customer global vinculado.
    const c = await create({ createAccount: true });
    const before = await readDB();
    const customer = before.customers.find((x) => x.id === c.customerId);
    expect(customer).toBeTruthy();
    const globalEmail = customer!.email;
    const globalPhone = customer!.phone;

    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, id: c.id, phone: '21977771234', email: 'troca@exemplo.com',
    }, token, 'PATCH'));
    expect(res.status).toBe(200);
    const body = await json(res);
    // O cadastro da unidade mudou…
    expect(body.contact.phone).toBe('21977771234');
    expect(body.contact.email).toBe('troca@exemplo.com');
    // …mas a identidade da CONTA continua a mesma, e separada na carteirinha.
    expect(body.contact.accountEmail).toBe(globalEmail);
    expect(body.contact.accountPhone).toBe(globalPhone);

    const after = await readDB();
    const same = after.customers.find((x) => x.id === c.customerId);
    expect(same?.email).toBe(globalEmail);
    expect(same?.phone).toBe(globalPhone);
  });

  it('a troca de identidade fica auditada', async () => {
    const c = await create();
    await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, id: c.id, phone: '21977771234',
    }, token, 'PATCH'));
    const db = await readDB();
    const entry = db.audit.filter((a) => a.action === 'contact.identity_updated').pop();
    expect(entry).toBeTruthy();
    expect(entry?.meta?.contactId).toBe(c.id);
    expect(entry?.meta?.fields).toContain('telefone');
    expect(entry?.meta?.customerTouched).toBe(false);
  });
});

describe('Fechamento A3.3 — CPF no servidor, POST e PATCH (ponto 4)', () => {
  it('POST recusa profile.cpf inválido', async () => {
    const res = await contactsPOST(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, name: 'Ana', phone: '11988880001',
      profile: { cpf: CPF_INVALIDO },
    }, token));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('CPF inválido.');
  });

  it('POST recusa guardian.cpf inválido com mensagem própria', async () => {
    const res = await contactsPOST(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, name: 'Ana', phone: '11988880001',
      profile: { cpf: CPF_VALIDO, guardian: { name: 'Ana Mãe', cpf: CPF_INVALIDO } },
    }, token));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('CPF do responsável inválido.');
  });

  it('POST aceita CPFs válidos e vazio', async () => {
    const ok = await contactsPOST(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, name: 'Ana', phone: '11988880001',
      profile: { cpf: CPF_VALIDO, guardian: { cpf: '' } },
    }, token));
    expect(ok.status).toBe(200);
  });

  it('PATCH recusa guardian.cpf inválido (antes só a UI checava)', async () => {
    const c = await create();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, id: c.id, profile: { guardian: { cpf: CPF_INVALIDO } },
    }, token, 'PATCH'));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe('CPF do responsável inválido.');
    // E não gravou nada.
    const db = await readDB();
    expect(db.contacts.find((x) => x.id === c.id)?.profile?.guardian?.cpf || '').not.toBe(CPF_INVALIDO);
  });

  it('PATCH recusa profile.cpf inválido', async () => {
    const c = await create();
    const res = await contactsPATCH(jsonReq('/api/contacts', {
      businessId: BUSINESS_ID, id: c.id, profile: { cpf: CPF_INVALIDO },
    }, token, 'PATCH'));
    expect(res.status).toBe(400);
  });
});

describe('Fechamento A3.3 — avatar real (ponto 8)', () => {
  it('expõe o avatar do Customer vinculado', async () => {
    const c = await create({ createAccount: true });
    await updateDB((db) => {
      const customer = db.customers.find((x) => x.id === c.customerId);
      if (customer) customer.avatar = 'https://cdn.exemplo.com/ana.png';
      return null;
    });
    const data = await get360(`q=${encodeURIComponent('Ana Cliente')}`, token);
    const person = data.people.find((p: any) => p.contactId === c.id);
    expect(person.avatar).toBe('https://cdn.exemplo.com/ana.png');
  });

  it('sem conta vinculada, avatar vazio (a UI usa iniciais)', async () => {
    await create();
    const data = await get360(`q=${encodeURIComponent('Ana Cliente')}`, token);
    expect(data.people[0].avatar).toBe('');
  });
});

describe('Fechamento A3.3 — "já atendido" é atendimento concluído (ponto 9)', () => {
  it('agendamento confirmado (futuro) NÃO coloca a pessoa em "já atendidos"', async () => {
    const c = await create();
    await addBooking(c.customerId, 'confirmed');
    const attended = await get360('attended=yes', token);
    expect(attended.people.map((p: any) => p.contactId)).not.toContain(c.id);
  });

  it('booking cancelado ou falta também não contam', async () => {
    const c = await create();
    await addBooking(c.customerId, 'cancelled');
    await addBooking(c.customerId, 'no_show', 'bk-noshow-1');
    await addBooking(c.customerId, 'pending', 'bk-pending-1');
    const attended = await get360('attended=yes', token);
    expect(attended.people.map((p: any) => p.contactId)).not.toContain(c.id);
  });

  it('atendimento concluído entra no filtro e na etiqueta', async () => {
    const c = await create();
    await addBooking(c.customerId, 'confirmed');
    await addBooking(c.customerId, 'completed', 'bk-done-1');
    const attended = await get360('attended=yes', token);
    expect(attended.people.map((p: any) => p.contactId)).toContain(c.id);
    const person = attended.people.find((p: any) => p.contactId === c.id);
    const tag = person.tags.find((t: any) => t.id === 'paciente');
    expect(tag).toBeTruthy();
    expect(tag.label).toBe('Cliente atendido');
    // 1 concluído de 2 no histórico — o hint não esconde o total.
    expect(tag.hint).toContain('1 atendimento(s) concluído(s) de 2');
  });

  it('sem nenhum concluído a etiqueta vira "Com agendamentos"', async () => {
    const c = await create();
    await addBooking(c.customerId, 'confirmed');
    const all = await get360(`q=${encodeURIComponent('Ana Cliente')}`, token);
    const person = all.people.find((p: any) => p.contactId === c.id);
    expect(person.tags.map((t: any) => t.id)).not.toContain('paciente');
    const tag = person.tags.find((t: any) => t.id === 'agendado');
    expect(tag?.label).toBe('Com agendamentos');
  });
});
