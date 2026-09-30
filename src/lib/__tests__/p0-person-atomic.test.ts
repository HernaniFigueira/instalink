// P0 — Person orchestration atômica + RBAC + tenant-safe
import './helpers/temp-db';
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { POST as teamPOST } from '@/app/api/team/route';
import { POST as catalogPOST } from '@/app/api/catalog/route';
import type { Business } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';
import { hashPassword } from '../auth';

const NOW = '2026-09-30T12:00:00.000Z';
const BIZ = 'biz-p0-person';
const BIZ_OTHER = 'biz-p0-other';
const OWNER = 'owner-p0-person';

function business(id: string, ownerId = OWNER): Business {
  return {
    id,
    ownerId,
    organizationId: `org-${id}`,
    name: `Negocio ${id}`,
    slug: id,
    description: '',
    logo: '',
    cover: '',
    niche: 'saude',
    modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false },
    phone: '',
    whatsapp: '',
    email: '',
    instagram: '',
    tiktok: '',
    address: '',
    mapsUrl: '',
    hours: {},
    paymentMethods: [],
    pixKey: '',
    deliveryFee: 0,
    minOrder: 0,
    googleUrl: '',
    googlePlaceId: '',
    googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 30, bufferMin: 0 },
    nav: [],
    navCustom: false,
    about: { title: '', text: '', image: '', enabled: false },
    published: true,
    createdAt: NOW,
    updatedAt: NOW,
  } as Business;
}

function authedTeam(body: any, token: string) {
  return new NextRequest('http://test/api/team', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` } as any,
  });
}
function authedCatalog(body: any, token: string) {
  return new NextRequest('http://test/api/catalog', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` } as any,
  });
}

describe('P0 person orchestration atômica', () => {
  let ownerToken = '';
  let adminToken = '';
  let viewerToken = '';
  let adminUserId = 'admin-p0';
  let viewerUserId = 'viewer-p0';

  beforeEach(async () => {
    fs.rmSync(TEMP_DB_FILE, { force: true });
    const db = emptyDB();
    db.users.push({ id: OWNER, name: 'Owner', email: 'owner@biz.com', passwordHash: 'x', createdAt: NOW, role: 'owner' } as any);
    db.businesses.push(business(BIZ));
    db.businesses.push(business(BIZ_OTHER));
    db.organizations.push({ id: `org-${BIZ}`, name: 'Org', ownerId: OWNER, createdAt: NOW } as any);
    db.organizations.push({ id: `org-${BIZ_OTHER}`, name: 'OrgOther', ownerId: OWNER, createdAt: NOW } as any);
    // admin with equipe+ catalogo
    const adminHash = hashPassword('admin123');
    db.users.push({ id: adminUserId, name: 'Admin', email: 'admin@biz.com', passwordHash: adminHash, createdAt: NOW, role: 'owner' } as any);
    db.members.push({ id: 'mem-admin', businessId: BIZ, userId: adminUserId, role: 'ADMIN', permissions: {}, active: true, note: '', invitedBy: OWNER, createdAt: NOW, updatedAt: NOW } as any);
    // ATENDENTE with only equipe, no catalogo — not readOnly, so can test boundary
    const viewerHash = hashPassword('viewer123');
    db.users.push({ id: viewerUserId, name: 'Viewer', email: 'viewer@biz.com', passwordHash: viewerHash, createdAt: NOW, role: 'owner' } as any);
    db.members.push({ id: 'mem-viewer', businessId: BIZ, userId: viewerUserId, role: 'ATENDENTE', permissions: { equipe: true }, active: true, note: '', invitedBy: OWNER, createdAt: NOW, updatedAt: NOW } as any);
    await writeDB(db);
    ownerToken = await createSession(OWNER);
    adminToken = await createSession(adminUserId);
    viewerToken = await createSession(viewerUserId);
  });

  it('A. novo Professional + Member + User tudo criado em 1 transação', async () => {
    const res = await teamPOST(authedTeam({
      businessId: BIZ,
      action: 'person.save',
      mode: 'create',
      name: 'Dr Novo',
      email: 'drnovo@biz.com',
      phone: '11999999999',
      cpf: '52998224725',
      hasAccess: true,
      hasClinical: true,
      role: 'PROFISSIONAL',
      password: '123456',
      funcao: 'Vet',
      crmvUf: 'SP',
      crmvNumero: '12345',
      serviceIds: [],
      pendingServices: [{ tempId: 't1', name: 'Exame Novo', suggestedGroupName: 'Exames', durationMin: 30, price: '100,00' }],
      dispMode: 'follow',
    }, ownerToken));
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    expect(j.ok).toBe(true);
    const db = await readDB();
    expect(db.professionals.length).toBe(1);
    expect(db.professionals[0].name).toBe('Dr Novo');
    expect(db.services.length).toBe(1);
    expect(db.services[0].name).toBe('Exame Novo');
    expect(db.services[0].professionalIds).toContain(j.professionalId);
    expect(db.categories.find(c => c.name === 'Exames')).toBeTruthy();
    expect(db.users.find(u => u.email === 'drnovo@biz.com')).toBeTruthy();
    expect(db.members.find(m => m.userId === j.userId)).toBeTruthy();
    // audit
    expect(db.audit.some(a => (a as any).action === 'member.created')).toBe(true);
    expect(db.audit.some(a => (a as any).action === 'professional.created')).toBe(true);
  });

  it('B. Professional existente sem Member → Conceder acesso cria Member + vínculo', async () => {
    // cria professional solo sem member
    const rp = await catalogPOST(authedCatalog({ businessId: BIZ, action: 'professional.save', name: 'Dr Solo', serviceIds: [] }, ownerToken));
    const { professionalId } = await rp.json() as any;
    let db = await readDB();
    expect(db.professionals.find(p => p.id === professionalId)).toBeTruthy();
    expect(db.members.find(m => m.userId && db.professionals.find(p => p.userId === m.userId))).toBeFalsy();
    // conceder acesso via person.save update
    const res = await teamPOST(authedTeam({
      businessId: BIZ,
      action: 'person.save',
      mode: 'update',
      existingProfessionalId: professionalId,
      existingMemberId: '',
      existingUserId: '',
      name: 'Dr Solo',
      email: 'drsolo@biz.com',
      phone: '11988877777',
      hasAccess: true,
      hasClinical: true,
      role: 'PROFISSIONAL',
      password: '123456',
      funcao: 'Clinico',
      crmvUf: 'RJ',
      crmvNumero: '9999',
      serviceIds: [],
      pendingServices: [],
      dispMode: 'follow',
    }, ownerToken));
    if (res.status !== 200) {
      const b = await res.clone().json() as any;
      console.log('B error', b, res.status);
    }
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    expect(j.ok).toBe(true);
    db = await readDB();
    const pro = db.professionals.find(p => p.id === professionalId)!;
    expect(pro.userId).toBe(j.userId);
    const mem = db.members.find(m => m.id === j.memberId);
    expect(mem).toBeTruthy();
    expect(mem?.userId).toBe(j.userId);
    expect(mem?.role).toBe('PROFISSIONAL');
    expect(db.audit.some(a => (a as any).action === 'member.professional_linked')).toBe(true);
  });

  it('C. User existente → passwordHash preservado', async () => {
    const existingHash = hashPassword('oldpass123');
    const db0 = await readDB();
    db0.users.push({ id: 'user-exist', name: 'Exist', email: 'exist@biz.com', passwordHash: existingHash, createdAt: NOW, role: 'owner' } as any);
    await writeDB(db0);
    const res = await teamPOST(authedTeam({
      businessId: BIZ,
      action: 'person.save',
      mode: 'create',
      name: 'Exist',
      email: 'exist@biz.com',
      hasAccess: true,
      hasClinical: false,
      role: 'ATENDENTE',
      password: 'shouldNotBeUsed',
    }, ownerToken));
    expect(res.status).toBe(200);
    const db = await readDB();
    const u = db.users.find(x => x.email === 'exist@biz.com')!;
    expect(u.passwordHash).toBe(existingHash);
    expect(u.id).toBe('user-exist');
    // não duplicou user
    expect(db.users.filter(x => x.email === 'exist@biz.com').length).toBe(1);
  });

  it('D. falha de Member/role/etc → Professional/Service/Category não persistem parcialmente', async () => {
    const dbBefore = await readDB();
    const proCount = dbBefore.professionals.length;
    const svcCount = dbBefore.services.length;
    const catCount = dbBefore.categories.length;
    const res = await teamPOST(authedTeam({
      businessId: BIZ,
      action: 'person.save',
      mode: 'create',
      name: 'Dr Fail',
      email: 'fail@biz.com',
      hasAccess: true,
      hasClinical: true,
      role: 'SUPERADMIN', // inválido
      password: '123456',
      funcao: 'Vet',
      crmvUf: 'SP',
      crmvNumero: '12345',
      pendingServices: [{ tempId: 't1', name: 'Svc Fail', suggestedGroupName: 'FailCat', durationMin: 30, price: '50,00' }],
    }, ownerToken));
    expect(res.status).toBe(400);
    const db = await readDB();
    expect(db.professionals.length).toBe(proCount);
    expect(db.services.length).toBe(svcCount);
    expect(db.categories.find(c => c.name === 'FailCat')).toBeFalsy();
  });

  it('E. edit existente com e-mail conflitante → Professional/Services também não mudam', async () => {
    // cria pessoa A
    const rA = await teamPOST(authedTeam({
      businessId: BIZ, action: 'person.save', mode: 'create',
      name: 'Pessoa A', email: 'a@biz.com', hasAccess: true, hasClinical: true, role: 'ATENDENTE', password: '123456',
      funcao: 'A', crmvUf: 'SP', crmvNumero: '11111', serviceIds: [], pendingServices: [], dispMode: 'follow',
    }, ownerToken));
    const { professionalId, memberId, userId } = await rA.json() as any;
    const db0 = await readDB();
    const proBefore = { ...db0.professionals.find(p => p.id === professionalId)! };
    // cria pessoa B com email b@biz.com
    await teamPOST(authedTeam({
      businessId: BIZ, action: 'person.save', mode: 'create',
      name: 'Pessoa B', email: 'b@biz.com', hasAccess: true, hasClinical: false, role: 'ATENDENTE', password: '123456',
    }, ownerToken));
    // tenta editar A para usar email de B
    const res = await teamPOST(authedTeam({
      businessId: BIZ, action: 'person.save', mode: 'update',
      existingMemberId: memberId, existingProfessionalId: professionalId, existingUserId: userId,
      name: 'Pessoa A Editada', email: 'b@biz.com', hasAccess: true, hasClinical: true, role: 'ATENDENTE',
      funcao: 'A2', crmvUf: 'RJ', crmvNumero: '22222', serviceIds: [], pendingServices: [{ tempId: 't9', name: 'Novo Svc', suggestedGroupName: 'CatX', durationMin: 30 }],
    }, ownerToken));
    expect(res.status).toBe(400);
    const db = await readDB();
    const proAfter = db.professionals.find(p => p.id === professionalId)!;
    expect(proAfter.name).toBe(proBefore.name);
    expect(proAfter.role).toBe(proBefore.role);
    expect(db.services.find(s => s.name === 'Novo Svc')).toBeFalsy();
    expect(db.categories.find(c => c.name === 'CatX')).toBeFalsy();
  });

  it('F. pending Service cancelado → zero persistência (simula cancel)', async () => {
    const dbBefore = await readDB();
    const svcCount = dbBefore.services.length;
    // simula UI com pending mas cancela (não chama API) — nada deve persistir
    // aqui apenas garantimos que sem chamar API, nada mudou; depois chamamos com pending vazio para confirmar
    const res = await teamPOST(authedTeam({
      businessId: BIZ, action: 'person.save', mode: 'create',
      name: 'Sem Pendente', email: 'sem@biz.com', hasAccess: true, hasClinical: true, role: 'ATENDENTE', password: '123456',
      funcao: 'Vet', crmvUf: 'SP', crmvNumero: '33333', pendingServices: [],
    }, ownerToken));
    expect(res.status).toBe(200);
    const db = await readDB();
    // não criou categoria fantasma
    expect(db.services.length).toBe(svcCount + 0); // só o professional, sem service pendente
  });

  it('G. pending Service salvo → Category + Service + Professional no mesmo commit', async () => {
    const res = await teamPOST(authedTeam({
      businessId: BIZ, action: 'person.save', mode: 'create',
      name: 'Dr G', email: 'drg@biz.com', hasAccess: true, hasClinical: true, role: 'PROFISSIONAL', password: '123456',
      funcao: 'G', crmvUf: 'MG', crmvNumero: '44444', pendingServices: [
        { tempId: 'tg1', name: 'Servico G1', suggestedGroupName: 'Grupo G', durationMin: 45, price: '200,00' },
        { tempId: 'tg2', name: 'Servico G2', groupId: '', suggestedGroupName: 'Grupo G', durationMin: 30, price: '100,00' },
      ],
    }, ownerToken));
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    const db = await readDB();
    const cat = db.categories.find(c => c.name === 'Grupo G' && c.kind === 'service');
    expect(cat).toBeTruthy();
    const svc1 = db.services.find(s => s.name === 'Servico G1')!;
    const svc2 = db.services.find(s => s.name === 'Servico G2')!;
    expect(svc1.categoryId).toBe(cat!.id);
    expect(svc2.categoryId).toBe(cat!.id);
    expect(svc1.professionalIds).toContain(j.professionalId);
    expect(svc2.professionalIds).toContain(j.professionalId);
    expect(db.professionals.find(p => p.id === j.professionalId)).toBeTruthy();
  });

  it('H. role inválido → 400 / nada persistido', async () => {
    const dbBefore = await readDB();
    const res = await teamPOST(authedTeam({
      businessId: BIZ, action: 'person.save', mode: 'create',
      name: 'Bad Role', email: 'badrole@biz.com', hasAccess: true, hasClinical: false, role: 'FINANCEIRO', password: '123456',
    }, ownerToken));
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/Papel inválido/i);
    const db = await readDB();
    expect(db.users.find(u => u.email === 'badrole@biz.com')).toBeFalsy();
    expect(db.members.length).toBe(dbBefore.members.length);
    // VIEWER válido deve passar
    const res2 = await teamPOST(authedTeam({
      businessId: BIZ, action: 'person.save', mode: 'create',
      name: 'Viewer Ok', email: 'viewerok@biz.com', hasAccess: true, hasClinical: false, role: 'VIEWER', password: '123456',
    }, ownerToken));
    expect(res2.status).toBe(200);
  });

  it('I. groupId outro tenant → 400 / nenhuma Category falsa', async () => {
    // cria categoria no outro business
    const catOther = await catalogPOST(authedCatalog({ businessId: BIZ_OTHER, action: 'category.save', kind: 'service', name: 'Grupo Other' }, ownerToken));
    const { categoryId: otherCatId } = await catOther.json() as any;
    const dbBefore = await readDB();
    const catCount = dbBefore.categories.length;
    const res = await teamPOST(authedTeam({
      businessId: BIZ, action: 'person.save', mode: 'create',
      name: 'Dr Cross', email: 'cross@biz.com', hasAccess: true, hasClinical: true, role: 'PROFISSIONAL', password: '123456',
      funcao: 'Cross', crmvUf: 'SP', crmvNumero: '55555',
      pendingServices: [{ tempId: 'tc1', name: 'Svc Cross', groupId: otherCatId, durationMin: 30 }],
    }, ownerToken));
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toMatch(/Grupo inválido/i);
    const db = await readDB();
    expect(db.categories.length).toBe(catCount);
    // não criou categoria com ID como nome
    expect(db.categories.find(c => c.name === otherCatId)).toBeFalsy();
    expect(db.services.find(s => s.name === 'Svc Cross')).toBeFalsy();
  });

  it('isOwner spoof não funciona — ADMIN com isOwner:true não vira Owner', async () => {
    // cria member comum
    const r = await teamPOST(authedTeam({
      businessId: BIZ, action: 'person.save', mode: 'create',
      name: 'Alvo', email: 'alvo@biz.com', hasAccess: true, hasClinical: false, role: 'ATENDENTE', password: '123456',
    }, ownerToken));
    const { memberId, userId } = await r.json() as any;
    // tenta editar enviando isOwner:true como admin
    const res = await teamPOST(authedTeam({
      businessId: BIZ, action: 'person.save', mode: 'update',
      existingMemberId: memberId, existingUserId: userId,
      isOwner: true, // spoof
      name: 'Alvo Spoof', email: 'alvo@biz.com', hasAccess: true, hasClinical: false, role: 'OWNER',
    }, adminToken));
    // deve falhar, não transformar em OWNER
    expect(res.status).toBe(400);
    const db = await readDB();
    const mem = db.members.find(m => m.id === memberId)!;
    expect(mem.role).not.toBe('OWNER');
  });

  it('catalogo boundary: equipe=true catalogo=false + access-only → permitido; com clinical → 403', async () => {
    // access-only com ATENDENTE+equipe true, catalogo false deve permitir
    const res1 = await teamPOST(authedTeam({
      businessId: BIZ, action: 'person.save', mode: 'create',
      name: 'Only Access', email: 'onlyaccess@biz.com', hasAccess: true, hasClinical: false, role: 'ATENDENTE', password: '123456',
    }, viewerToken));
    expect(res1.status).toBe(200);
    // com clinical deve bloquear 403
    const res2 = await teamPOST(authedTeam({
      businessId: BIZ, action: 'person.save', mode: 'create',
      name: 'Clin Fail', email: 'clinfail@biz.com', hasAccess: true, hasClinical: true, role: 'PROFISSIONAL', password: '123456',
      funcao: 'Fail', crmvUf: 'SP', crmvNumero: '66666', pendingServices: [{ tempId: 't1', name: 'Svc Fail', suggestedGroupName: 'Cat', durationMin: 30 }],
    }, viewerToken));
    expect(res2.status).toBe(403);
    expect((await res2.json() as any).error).toMatch(/catalogo/i);
  });

  it('permissionOverrides inválido → 400', async () => {
    const res = await teamPOST(authedTeam({
      businessId: BIZ, action: 'person.save', mode: 'create',
      name: 'Bad Perm', email: 'badperm@biz.com', hasAccess: true, hasClinical: false, role: 'ATENDENTE', password: '123456',
      permissionOverrides: { equipe: true, invalida: true } as any,
    }, ownerToken));
    expect(res.status).toBe(400);
    const res2 = await teamPOST(authedTeam({
      businessId: BIZ, action: 'person.save', mode: 'create',
      name: 'Bad Perm2', email: 'badperm2@biz.com', hasAccess: true, hasClinical: false, role: 'ATENDENTE', password: '123456',
      permissionOverrides: { agenda: 'true' } as any,
    }, ownerToken));
    expect(res2.status).toBe(400);
  });

  it('409 histórico real: serviceHasHistory bloqueia com 409', async () => {
    const rs = await catalogPOST(authedCatalog({ businessId: BIZ, action: 'service.save', name: 'Svc Hist', durationMin: 30 }, ownerToken));
    const { serviceId } = await rs.json() as any;
    const rp = await catalogPOST(authedCatalog({ businessId: BIZ, action: 'professional.save', name: 'Dr Hist', serviceIds: [serviceId] }, ownerToken));
    const { professionalId } = await rp.json() as any;
    const db0 = await readDB();
    db0.financeEntries.push({ id: 'fin-p0', businessId: BIZ, kind: 'receita', status: 'paid', amount: 1000, description: 'x', dueDate: '2026-09-30', paidAt: '2026-09-30', method: 'pix', contactId: '', bookingId: '', serviceId, professionalId, createdAt: NOW, updatedAt: NOW } as any);
    await writeDB(db0);
    const delS = await catalogPOST(authedCatalog({ businessId: BIZ, action: 'service.delete', id: serviceId }, ownerToken));
    expect(delS.status).toBe(409);
    expect((await delS.json() as any).error).toMatch(/histórico/i);
    const delP = await catalogPOST(authedCatalog({ businessId: BIZ, action: 'professional.delete', id: professionalId }, ownerToken));
    expect(delP.status).toBe(409);
  });

  it('slotEligible: legado com inactive não reabre solo, sem registro volta undefined', async () => {
    const { slotEligibleProfessionalIds } = await import('../booking');
    const { computeSlots } = await import('../slots');
    // legado service
    const svc: any = { id: 'svc-leg', businessId: BIZ, professionalIds: [], active: true };
    // professional inactive
    const proInactive: any = { id: 'pro-in', businessId: BIZ, active: false };
    expect(slotEligibleProfessionalIds(svc, [proInactive])).toEqual([]);
    const q1: any = {
      rules: [{ id: 'r1', businessId: BIZ, weekday: 1, start: '09:00', end: '12:00', slotMin: 30, professionalId: '', serviceId: '' }],
      exceptions: [], bookings: [], services: [svc], professionals: [proInactive],
      dateISO: '2026-10-05', weekday: 1, serviceId: 'svc-leg', durationMin: 30, professionalId: '', eligibleProIds: [], nowHM: '', leadMin: 0, bufferMin: 0,
    };
    const r1 = computeSlots(q1);
    expect(r1.slots).toEqual([]);
    expect(r1.closed).toBe(true);
    // remover registro → undefined
    expect(slotEligibleProfessionalIds(svc, [])).toBeUndefined();
    const q2 = { ...q1, professionals: [], eligibleProIds: undefined };
    const r2 = computeSlots(q2);
    // com regra geral, solo deve gerar slots — undefined não força no_windows
    expect(r2.closed).toBe(false);
    expect(r2.slots.length).toBeGreaterThan(0);
    expect(r2.closedReason).toBeUndefined();
  });
});
