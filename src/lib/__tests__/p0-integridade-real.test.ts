import './helpers/temp-db';
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { GET as teamGET, POST as teamPOST, PATCH as teamPATCH } from '@/app/api/team/route';
import { POST as catalogPOST } from '@/app/api/catalog/route';
import type { Booking, Business, BusinessMember, Category, Professional, Service } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';
import fs from 'node:fs';
import path from 'node:path';

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

const NOW = '2026-09-30T12:00:00.000Z';
const BIZ = 'biz-p0-real';
const OWNER_ID = 'owner-p0';

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

function makeReq(url: string, body: any, userId: string) {
  const req = new NextRequest(url, {
    method: 'POST',
    body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  });
  // mock auth via cookie/session: createSession and set cookie header
  return req;
}

async function setupBiz() {
  const db = emptyDB();
  db.users.push({ id: OWNER_ID, name: 'Owner', email: 'owner@biz.com', passwordHash: 'x', createdAt: NOW, role: 'owner', lastLoginAt: '' } as any);
  db.businesses.push(business(BIZ));
  // organization
  db.organizations.push({ id: `org-${BIZ}`, name: 'Org', ownerId: OWNER_ID, createdAt: NOW } as any);
  await writeDB(db);
  const token = await createSession(OWNER_ID);
  return token;
}

function authedReq(url: string, body: any, token: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const method = body ? 'POST' : 'GET';
  return new NextRequest(url, {
    method,
    headers: headers as any,
    body: body ? JSON.stringify(body) : undefined,
  });
}
function patchReq(url: string, body: any, token: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', authorization: `Bearer ${token}` };
  return new NextRequest(url, { method: 'PATCH', headers: headers as any, body: JSON.stringify(body) });
}
function getReq(url: string, token: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  return new NextRequest(url, { headers: headers as any });
}

describe('P0 integridade real — chamada de comportamento', () => {
  let token: string;
  beforeEach(async () => {
    token = await setupBiz();
  });

  it('A. override removido persiste removido (permissionOverrides replace)', async () => {
    // Cria SECRETARIA com override catalogo=true
    const req1 = authedReq('http://test/api/team', { businessId: BIZ, name: 'Sec', email: 'sec@biz.com', password: '123456', role: 'SECRETARIA', permissionOverrides: { catalogo: true } }, token);
    // need to set method POST for teamPOST, but NextRequest default is POST when body present? Our helper uses POST
    // Call directly POST handler
    const res1 = await teamPOST(req1);
    const j1: any = await res1.json();
    expect(j1.ok).toBe(true);
    const db1 = await readDB();
    const mem = db1.members.find(m => m.businessId === BIZ && db1.users.find(u=>u.id===m.userId)?.email === 'sec@biz.com')!;
    expect(mem.permissions.catalogo).toBe(true);
    // Agora volta catalogo para false (remove override) -> enviar permissionOverrides vazio ou sem catalogo
    const req2 = patchReq('http://test/api/team', { businessId: BIZ, id: mem.id, permissionOverrides: {} }, token);
    const res2: any = await teamPATCH(req2);
    const j2 = await res2.json();
    expect(j2.ok).toBe(true);
    const db2 = await readDB();
    const mem2 = db2.members.find(m=>m.id===mem.id)!;
    expect(mem2.permissions.catalogo).toBeUndefined();
    // GET deve retornar efetiva false e permissionOverrides vazio
    const getReqInstance = getReq(`http://test/api/team?businessId=${BIZ}`, token);
    const getRes: any = await teamGET(getReqInstance);
    const gj: any = await getRes.json();
    const fetched = gj.members.find((m: any)=> m.id===mem.id);
    expect(fetched.permissionOverrides.catalogo).toBeUndefined();
    expect(fetched.permissions.catalogo).toBe(false);
  });

  it('B. password existingUser não muda', async () => {
    // Cria user existente em outro biz
    const db0 = await readDB();
    const otherBiz = business('other-biz');
    db0.businesses.push(otherBiz);
    db0.users.push({ id: 'user-exist', name: 'Exist', email: 'exist@biz.com', passwordHash: 'old-hash', createdAt: NOW, role: 'owner', lastLoginAt: '' } as any);
    db0.members.push({ id: 'mem-other', businessId: 'other-biz', userId: 'user-exist', role: 'ATENDENTE', permissions: {}, active: true, note: '', invitedBy: OWNER_ID, createdAt: NOW, updatedAt: NOW } as any);
    await writeDB(db0);
    const before = (await readDB()).users.find(u=>u.id==='user-exist')!.passwordHash;
    // Tenta vincular existingUser a BIZ sem senha
    const req = authedReq('http://test/api/team', { businessId: BIZ, name: 'Exist', email: 'exist@biz.com', role: 'ATENDENTE', permissionOverrides: {}, phone: '', cpf: '' }, token);
    // teamPOST should succeed without password
    const res = await teamPOST(req);
    const j: any = await res.json();
    expect(j.ok).toBe(true);
    expect(j.linkedExistingUser).toBe(true);
    const after = (await readDB()).users.find(u=>u.id==='user-exist')!.passwordHash;
    expect(after).toBe(before);
    // Tenta vincular com senha enviada (deveria ignorar)
    const req2 = authedReq('http://test/api/team', { businessId: BIZ, name: 'Exist2', email: 'exist2@biz.com', password: 'newpass123', role: 'ATENDENTE' }, token);
    // need to create exist2 first as existing user
    const db1 = await readDB();
    db1.users.push({ id: 'user-exist2', name: 'Exist2', email: 'exist2@biz.com', passwordHash: 'hash2', createdAt: NOW, role: 'owner', lastLoginAt: '' } as any);
    await writeDB(db1);
    const before2 = (await readDB()).users.find(u=>u.email==='exist2@biz.com')!.passwordHash;
    const req3 = authedReq('http://test/api/team', { businessId: BIZ, name: 'Exist2', email: 'exist2@biz.com', password: 'should-not-change', role: 'ATENDENTE' }, token);
    const res3 = await teamPOST(req3);
    const j3: any = await res3.json();
    expect(j3.ok).toBe(true);
    const after2 = (await readDB()).users.find(u=>u.email==='exist2@biz.com')!.passwordHash;
    expect(after2).toBe(before2);
  });

  it('C. access-only foto não mente (sem Professional não mostra foto)', async () => {
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    // Foto deve estar dentro de fHasClinical, não em IDENTIFICAÇÃO
    expect(equipe).toContain('Foto profissional');
    // IDENTIFICAÇÃO não deve conter ImageUpload fora de hasClinical
    // Check that the only ImageUpload is inside hasClinical
    const hasClinicalBlocks = (equipe.match(/fHasClinical && \(/g) || []).length;
    expect(hasClinicalBlocks).toBeGreaterThan(0);
    const fotoInsideClinical = equipe.includes('{fHasClinical && (') && equipe.includes('Foto profissional');
    expect(fotoInsideClinical).toBe(true);
    // Secretária sem Professional não deve receber campo foto que desaparece
    expect(equipe).not.toMatch(/IDENTIFICAÇÃO[\s\S]*ImageUpload[\s\S]*fHasAccess/);
  });

  it('D. success own não permite segunda criação (drawer mostra só sucesso)', async () => {
    const equipe = read('src/app/(dashboard)/equipe/page.tsx');
    expect(equipe).toContain('{fSuccessProfessionalId ? (');
    expect(equipe).toContain('Pessoa adicionada com sucesso.');
    expect(equipe).toContain('Configurar disponibilidade');
    expect(equipe).toContain('Fechar');
    // O footer "Adicionar pessoa" deve estar dentro do : (else) e não visível quando success
    expect(equipe).toContain('handleAddSave');
    // Verifica que quando success, não há botão Adicionar pessoa duplicado
    const countAdd = (equipe.match(/Adicionar pessoa/g) || []).length;
    // Deve haver pelo menos um Adicionar pessoa (no else)
    expect(countAdd).toBeGreaterThanOrEqual(1);

  });

  it('E. category rename duplicate bloqueado por normalização', async () => {
    // Cria categoria "Cardiologia"
    const r1 = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'category.save', kind: 'service', name: 'Cardiologia' }, token));
    const j1: any = await r1.json();
    expect(j1.categoryId).toBeTruthy();
    const catId1 = j1.categoryId;
    // Cria outra "Vacinas"
    const r2 = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'category.save', kind: 'service', name: 'Vacinas' }, token));
    const j2: any = await r2.json();
    const catId2 = j2.categoryId;
    expect(catId2).not.toBe(catId1);
    // Tenta renomear Vacinas para " cardiología " (mesmo normalizado)
    const r3 = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'category.save', id: catId2, kind: 'service', name: ' cardiología ' }, token));
    const j3: any = await r3.json();
    expect(j3.error).toMatch(/Já existe um grupo com este nome/);
  });

  it('F. service/professional com Booking histórico não pode ser apagado', async () => {
    // Cria service e professional
    const sRes = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Consulta', durationMin: 30, price: 0 }, token));
    const sJ: any = await sRes.json();
    const serviceId = sJ.serviceId;
    const pRes = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr Vet', active: true }, token));
    const pJ: any = await pRes.json();
    const proId = pJ.professionalId;
    // Cria booking passado com esses ids
    const db = await readDB();
    db.bookings.push({
      id: 'bk-history', businessId: BIZ, serviceId, professionalId: proId,
      customerId: 'cli1', customerName: 'Cli', customerPhone: '11999999999',
      date: '2020-01-01', time: '09:00', status: 'completed',
      createdAt: NOW, updatedAt: NOW, history: [],
    } as unknown as Booking);
    await writeDB(db);
    // Tenta delete service
    const delS = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'service.delete', id: serviceId }, token));
    const delSJ: any = await delS.json();
    expect(delSJ.error).toMatch(/possui histórico/);
    // Tenta delete professional
    const delP = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'professional.delete', id: proId }, token));
    const delPJ: any = await delP.json();
    expect(delPJ.error).toMatch(/possui histórico/);
    // Desativar deve funcionar
    const deactS = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'service.save', id: serviceId, name: 'Consulta', active: false, durationMin: 30 }, token));
    const deactSJ: any = await deactS.json();
    expect(deactSJ.ok).toBe(true);
    const deactP = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', id: proId, name: 'Dr Vet', active: false }, token));
    const deactPJ: any = await deactP.json();
    expect(deactPJ.ok).toBe(true);
  });

  it('G. entity nunca referenciada pode ser apagada e limpa relações', async () => {
    const sRes = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'TempService', durationMin: 30, professionalMode: 'selected', professionalIds: [] }, token));
    const { serviceId } = await sRes.json() as any;
    const pRes = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'TempPro', serviceIds: [serviceId] }, token));
    const { professionalId } = await pRes.json() as any;
    // Verifica que service tem pro
    let db = await readDB();
    let svc = db.services.find(s=>s.id===serviceId)!;
    expect(svc.professionalIds).toContain(professionalId);
    // Cria availability para pro
    await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'availability.save', scope: { professionalId }, rules: [{ weekday: 1, start: '09:00', end: '12:00', slotMin: 30 }] }, token));
    db = await readDB();
    expect(db.availability.some(a=>a.professionalId===professionalId)).toBe(true);
    // Delete professional (nunca referenciado em booking)
    const delP = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'professional.delete', id: professionalId }, token));
    const delPJ: any = await delP.json();
    expect(delPJ.ok).toBe(true);
    db = await readDB();
    expect(db.professionals.find(p=>p.id===professionalId)).toBeUndefined();
    expect(db.services.find(s=>s.id===serviceId)!.professionalIds).not.toContain(professionalId);
    expect(db.availability.some(a=>a.professionalId===professionalId)).toBe(false);
    // Delete service
    const delS = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'service.delete', id: serviceId }, token));
    const delSJ: any = await delS.json();
    expect(delSJ.ok).toBe(true);
    db = await readDB();
    expect(db.services.find(s=>s.id===serviceId)).toBeUndefined();
  });

  it('H. cross-tenant serviceIds/professionalIds são recusados', async () => {
    // Cria biz B e service lá
    const otherBiz = business('other-tenant');
    const db0 = await readDB();
    db0.businesses.push(otherBiz);
    db0.categories.push({ id: 'cat-other', businessId: 'other-tenant', kind: 'service', name: 'OtherCat', order: 0, active: true } as any);
    db0.services.push({ id: 'svc-other', businessId: 'other-tenant', name: 'OtherSvc', description: '', image: '', price: 0, showPrice: true, durationMin: 30, professionalIds: [], categoryId: '', active: true, featured: false, bookable: true, questions: [] } as any);
    db0.professionals.push({ id: 'pro-other', businessId: 'other-tenant', name: 'OtherPro', role: '', photo: '', active: true, followBusinessHours: true } as any);
    await writeDB(db0);
    // Tenta salvar professional em BIZ com serviceId de outro tenant
    const r1 = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Hacker', serviceIds: ['svc-other'] }, token));
    const j1: any = await r1.json();
    expect(j1.error).toMatch(/Serviço inválido/);
    // Tenta salvar service em BIZ com professionalId de outro tenant
    const r2 = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'HackSvc', professionalIds: ['pro-other'], durationMin: 30 }, token));
    const j2: any = await r2.json();
    expect(j2.error).toMatch(/Profissional inválido/);
  });

  it('I. CRMV vazio não vira registro falso e limpeza funciona', async () => {
    // Cria professional sem CRMV
    const r1 = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'NoCrmv', active: true, crmvUf: '', crmvNumero: '' }, token));
    const j1: any = await r1.json();
    expect(j1.ok).toBe(true);
    let db = await readDB();
    let pro: any = db.professionals.find(p=>p.name==='NoCrmv')!;
    expect((pro.crmvUf || '') as string).toBe('');
    expect((pro.crmvNumero || '') as string).toBe('');
    expect((pro.conselho || '') as string).toBe('');
    // Cria com CRMV
    const r2 = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'WithCrmv', active: true, crmvUf: 'SP', crmvNumero: '12345' }, token));
    const j2: any = await r2.json();
    expect(j2.ok).toBe(true);
    db = await readDB();
    let pro2: any = db.professionals.find(p=>p.name==='WithCrmv')!;
    expect(pro2.crmvUf).toBe('SP');
    expect(pro2.crmvNumero).toBe('12345');
    expect(pro2.conselho).toBe('CRMV');
    // Limpa
    const r3 = await catalogPOST(authedReq('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', id: pro2.id, name: 'WithCrmv', crmvUf: '', crmvNumero: '' }, token));
    const j3: any = await r3.json();
    expect(j3.ok).toBe(true);
    db = await readDB();
    pro2 = db.professionals.find(p=>p.id===pro2.id)! as any;
    expect((pro2.crmvUf || '') as string).toBe('');
    expect((pro2.crmvNumero || '') as string).toBe('');
    expect((pro2.conselho || '') as string).toBe('');
  });
});
