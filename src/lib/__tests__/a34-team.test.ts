// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 2 — PROFISSIONAIS × EQUIPE nas ROTAS REAIS
// ═══════════════════════════════════════════════════════════════
// O que este bloco NÃO faz: criar uma segunda entidade de profissional.
// O que ele garante:
//   • criar profissional NÃO cria login em silêncio (e devolve o id);
//   • criar acesso A PARTIR de um profissional grava Professional.userId;
//   • um profissional não ganha segundo login; um login não aponta para dois
//     profissionais na mesma unidade;
//   • Secretária continua independente (sem vínculo de agenda);
//   • a Equipe recebe a FOTO real do profissional vinculado;
//   • multi-tenant: profissional de outra unidade é recusado.
import './helpers/temp-db';

import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { GET as teamGET, POST as teamPOST, PATCH as teamPATCH } from '@/app/api/team/route';
import { POST as catalogPOST } from '@/app/api/catalog/route';
import type { Business, BusinessMember, DB, Professional } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const UNIT_A = 'unit-a34-a';
const UNIT_B = 'unit-a34-b';
const OWNER_ID = 'owner-a34';

function business(id: string, ownerId = OWNER_ID): Business {
  return {
    id,
    ownerId,
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

function professional(id: string, businessId: string, extra: Partial<Professional> = {}): Professional {
  return {
    id, businessId, name: `Prof ${id}`, role: 'Dentista', photo: `https://cdn.example.com/${id}.jpg`,
    active: true, followBusinessHours: true, userId: '', ...extra,
  } as Professional;
}

function member(id: string, businessId: string, userId: string, role: BusinessMember['role'], extra: Partial<BusinessMember> = {}): BusinessMember {
  return {
    id, businessId, userId, role, permissions: {}, active: true, note: '',
    invitedBy: OWNER_ID, createdAt: NOW, updatedAt: NOW, ...extra,
  } as BusinessMember;
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
  const db: DB = emptyDB();
  db.users.push({ id: OWNER_ID, name: 'Dono A3.4', email: 'a34@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' });
  db.businesses.push(business(UNIT_A), business(UNIT_B, 'owner-b'));
  db.professionals.push(
    professional('pro-orlando', UNIT_A, { name: 'Orlando Pires', role: 'Dentista' }),
    professional('pro-maria', UNIT_A, { name: 'Maria Souza', role: 'Ortodontista' }),
    professional('pro-outra-unidade', UNIT_B, { name: 'João de Outra', role: 'Clínico Geral' }),
  );
  await writeDB(db);
  token = await createSession(OWNER_ID);
});

describe('A3.4 · profissional não é login (e login não é profissional)', () => {
  it('criar profissional NÃO cria usuário/membro em silêncio e devolve o id', async () => {
    const before = await readDB();
    const res = await catalogPOST(jsonReq('/api/catalog', {
      businessId: UNIT_A, action: 'professional.save', name: 'Dra. Ana', role: 'Dentista',
    }, token));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.professionalId).toBeTruthy();

    const after = await readDB();
    expect(after.professionals.length).toBe(before.professionals.length + 1);
    // NENHUM login novo: a pergunta "criar acesso?" é da tela, não do motor.
    expect(after.users.length).toBe(before.users.length);
    expect(after.members.length).toBe(before.members.length);
    const created = after.professionals.find((p) => p.id === body.professionalId)!;
    expect(created.userId).toBe('');
  });

  it('editar profissional mantém o mesmo id (o vínculo não se perde)', async () => {
    const res = await catalogPOST(jsonReq('/api/catalog', {
      businessId: UNIT_A, action: 'professional.save', id: 'pro-orlando', name: 'Orlando P. Filho', role: 'Dentista',
    }, token));
    const body = await json(res);
    expect(body.professionalId).toBe('pro-orlando');
  });
});

describe('A3.4 · criar acesso a partir do profissional', () => {
  it('grava Professional.userId (vínculo 1:1) e papel PROFISSIONAL', async () => {
    const res = await teamPOST(jsonReq('/api/team', {
      businessId: UNIT_A, name: 'Orlando Pires', email: 'orlando@clinica.com',
      password: 'segredo123', role: 'PROFISSIONAL', professionalId: 'pro-orlando',
    }, token));
    expect(res.status).toBe(200);
    const db = await readDB();
    const pro = db.professionals.find((p) => p.id === 'pro-orlando')!;
    const m = db.members.find((x) => x.businessId === UNIT_A && x.role === 'PROFISSIONAL')!;
    expect(pro.userId).toBe(m.userId);
    expect(pro.userId).toBeTruthy();
    // A agenda do profissional passa a ser a DELE (escopo no servidor).
    expect(db.users.find((u) => u.id === m.userId)?.email).toBe('orlando@clinica.com');
  });

  it('profissional já vinculado NÃO ganha segundo login', async () => {
    const first = await teamPOST(jsonReq('/api/team', {
      businessId: UNIT_A, name: 'Orlando', email: 'orlando@clinica.com',
      password: 'segredo123', role: 'PROFISSIONAL', professionalId: 'pro-orlando',
    }, token));
    expect(first.status).toBe(200);
    const second = await teamPOST(jsonReq('/api/team', {
      businessId: UNIT_A, name: 'Orlando (duplicado)', email: 'orlando2@clinica.com',
      password: 'segredo123', role: 'PROFISSIONAL', professionalId: 'pro-orlando',
    }, token));
    expect(second.status).toBe(400);
    expect((await json(second)).error).toMatch(/já está vinculado/i);
    const db = await readDB();
    // Um único login aponta para o profissional.
    expect(db.members.filter((m) => m.businessId === UNIT_A)).toHaveLength(1);
  });

  it('um login não pode apontar para DOIS profissionais na mesma unidade', async () => {
    const created = await teamPOST(jsonReq('/api/team', {
      businessId: UNIT_A, name: 'Secretária Maria', email: 'maria@clinica.com',
      password: 'segredo123', role: 'SECRETARIA',
    }, token));
    expect(created.status).toBe(200);
    const memberId = (await json(created)).memberId;

    const link1 = await teamPATCH(jsonReq('/api/team', { businessId: UNIT_A, id: memberId, professionalId: 'pro-maria' }, token, 'PATCH'));
    expect(link1.status).toBe(200);
    const link2 = await teamPATCH(jsonReq('/api/team', { businessId: UNIT_A, id: memberId, professionalId: 'pro-orlando' }, token, 'PATCH'));
    expect(link2.status).toBe(200);

    const db = await readDB();
    const linked = db.professionals.filter((p) => p.businessId === UNIT_A && p.userId);
    expect(linked.map((p) => p.id)).toEqual(['pro-orlando']);
  });
});

describe('A3.4 · Equipe mostra a mesma pessoa (foto real)', () => {
  it('GET devolve foto do profissional e a foto no acesso vinculado', async () => {
    await teamPOST(jsonReq('/api/team', {
      businessId: UNIT_A, name: 'Orlando Pires', email: 'orlando@clinica.com',
      password: 'segredo123', role: 'PROFISSIONAL', professionalId: 'pro-orlando',
    }, token));
    const res = await teamGET(jsonReq(`/api/team?businessId=${UNIT_A}`, {}, token, 'GET'));
    expect(res.status).toBe(200);
    const body = await json(res);
    const pro = body.professionals.find((p: any) => p.id === 'pro-orlando');
    expect(pro.photo).toBe('https://cdn.example.com/pro-orlando.jpg');
    const linkedMember = body.members.find((m: any) => m.professionalId === 'pro-orlando');
    expect(linkedMember.professionalPhoto).toBe('https://cdn.example.com/pro-orlando.jpg');
  });

  it('lista de profissionais sem acesso é derivável (userId vazio)', async () => {
    const res = await teamGET(jsonReq(`/api/team?businessId=${UNIT_A}`, {}, token, 'GET'));
    const body = await json(res);
    const semAcesso = body.professionals.filter((p: any) => !p.userId).map((p: any) => p.id);
    expect(semAcesso.sort()).toEqual(['pro-maria', 'pro-orlando']);
  });
});

describe('A3.4 · secretária continua independente', () => {
  it('acesso administrativo não mexe em nenhum profissional', async () => {
    const res = await teamPOST(jsonReq('/api/team', {
      businessId: UNIT_A, name: 'Ana Secretária', email: 'ana@clinica.com',
      password: 'segredo123', role: 'SECRETARIA', note: 'recepção',
    }, token));
    expect(res.status).toBe(200);
    const db = await readDB();
    const m = db.members.find((x) => x.businessId === UNIT_A)!;
    expect(m.role).toBe('SECRETARIA');
    expect(db.professionals.every((p) => !p.userId)).toBe(true);
    // A secretária tem agenda/clientes, mas nenhuma permissão de administração.
    expect(m.permissions?.equipe).toBeUndefined();
  });
});

describe('A3.4 · multi-tenant', () => {
  it('vincular profissional de OUTRA unidade é recusado (404)', async () => {
    const res = await teamPOST(jsonReq('/api/team', {
      businessId: UNIT_A, name: 'Impostor', email: 'impostor@clinica.com',
      password: 'segredo123', role: 'PROFISSIONAL', professionalId: 'pro-outra-unidade',
    }, token));
    expect(res.status).toBe(404);
    const db = await readDB();
    expect(db.members.filter((m) => m.businessId === UNIT_A)).toHaveLength(0);
    expect(db.professionals.find((p) => p.id === 'pro-outra-unidade')!.userId).toBe('');
  });

  it('criar profissional em OUTRA unidade não aparece nesta', async () => {
    const res = await catalogPOST(jsonReq('/api/catalog', {
      businessId: UNIT_B, action: 'professional.save', name: 'Novo da B',
    }, token));
    // A unidade B tem outro dono: o guard recusa antes de gravar (401/403 —
    // o importante é NÃO gravar e não vazar dado de outra unidade).
    expect([401, 403, 404]).toContain(res.status);
    const db = await readDB();
    expect(db.professionals.filter((p) => p.businessId === UNIT_B)).toHaveLength(1);
  });
});
