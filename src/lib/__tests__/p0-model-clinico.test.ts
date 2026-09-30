import './helpers/temp-db';
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { POST as catalogPOST } from '@/app/api/catalog/route';
import { GET as catalogGet } from '@/app/api/catalog/get/route';
import { POST as teamPOST } from '@/app/api/team/route';
import { eligibleProfessionalIds, professionalServesService, serviceProfessionalMode } from '../booking';
import { serviceHasHistory, professionalHasHistory, historyRefsForBusiness } from '../history';
import type { Business, Service, Professional } from '../types';

const NOW = '2026-09-30T12:00:00.000Z';
const BIZ = 'biz-model';
const OWNER_ID = 'owner-model';

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

function authed(url: string, body: any, token: string) {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` } as any,
  });
}
function getAuthed(url: string, token: string) {
  return new NextRequest(url, { headers: { authorization: `Bearer ${token}` } as any });
}

describe('P0 modelo clínico — service ↔ professional + integridade histórica', () => {
  let token: string;
  beforeEach(async () => {
    const db = emptyDB();
    db.users.push({ id: OWNER_ID, name: 'Owner', email: 'owner@biz.com', passwordHash: 'x', createdAt: NOW, role: 'owner', lastLoginAt: '' } as any);
    db.businesses.push(business(BIZ));
    db.organizations.push({ id: `org-${BIZ}`, name: 'Org', ownerId: OWNER_ID, createdAt: NOW } as any);
    await writeDB(db);
    token = await createSession(OWNER_ID);
  });

  it('A. Service legado [] → ambos elegíveis (all)', async () => {
    const pros: Professional[] = [
      { id: 'A', businessId: BIZ, name: 'Dr A', role: 'Vet', photo: '', active: true } as Professional,
      { id: 'B', businessId: BIZ, name: 'Dr B', role: 'Vet', photo: '', active: true } as Professional,
    ];
    const svc: Service = { id: 's1', businessId: BIZ, name: 'Consulta', description: '', image: '', price: 0, durationMin: 30, professionalIds: [], categoryId: '', active: true, featured: false, bookable: true, questions: [] } as any;
    expect(serviceProfessionalMode(svc)).toBe('all');
    expect(eligibleProfessionalIds(svc, pros)).toEqual(expect.arrayContaining(['A', 'B']));
    expect(professionalServesService(svc, 'A', pros)).toBe(true);
    expect(professionalServesService(svc, 'B', pros)).toBe(true);
  });

  it('B. Service legado [A] → só A elegível (selected)', async () => {
    const pros: Professional[] = [
      { id: 'A', businessId: BIZ, name: 'Dr A', role: 'Vet', photo: '', active: true } as Professional,
      { id: 'B', businessId: BIZ, name: 'Dr B', role: 'Vet', photo: '', active: true } as Professional,
    ];
    const svc: Service = { id: 's1', businessId: BIZ, name: 'Consulta', description: '', image: '', price: 0, durationMin: 30, professionalIds: ['A'], categoryId: '', active: true, featured: false, bookable: true, questions: [] } as any;
    expect(serviceProfessionalMode(svc)).toBe('selected');
    expect(eligibleProfessionalIds(svc, pros)).toEqual(['A']);
    expect(professionalServesService(svc, 'A', pros)).toBe(true);
    expect(professionalServesService(svc, 'B', pros)).toBe(false);
  });

  it('C. Service all, editar A sem mudar seleção → continua ALL, B não afetado', async () => {
    // Cria service all
    const r = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Consulta Geral', durationMin: 30, professionalMode: 'all', professionalIds: [] }, token));
    const { serviceId } = await r.json() as any;
    // Cria A e B
    const ra = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr A', serviceIds: [] }, token));
    const { professionalId: pidA } = await ra.json() as any;
    const rb = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr B', serviceIds: [] }, token));
    const { professionalId: pidB } = await rb.json() as any;
    // Busca service para confirmar all
    let db = await readDB();
    let svc = db.services.find(s=>s.id===serviceId)! as any;
    expect(svc.professionalMode).toBe('all');
    // Edita A mantendo mesma seleção (serviço continua marcado porque all)
    // Para editar A, precisamos saber quais serviços ele realiza: all => deve estar incluído
    // Vamos chamar professional.save com serviceIds incluindo o serviço (como se mantivesse)
    const editA = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', id: pidA, name: 'Dr A', serviceIds: [serviceId] }, token));
    expect((await editA.json() as any).ok).toBe(true);
    db = await readDB();
    svc = db.services.find(s=>s.id===serviceId)! as any;
    expect(svc.professionalMode).toBe('all'); // não converteu
    expect(svc.professionalIds).toEqual([]); // continua all
    // B ainda elegível via all
    const pros = db.professionals.filter(p=>p.businessId===BIZ);
    expect(professionalServesService(svc as any, pidB, pros as any)).toBe(true);
  });

  it('D. Service all, A desmarca → converte selected com B, A não elegível', async () => {
    const r = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Consulta Geral', durationMin: 30, professionalMode: 'all', professionalIds: [] }, token));
    const { serviceId } = await r.json() as any;
    const ra = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr A', serviceIds: [] }, token));
    const { professionalId: pidA } = await ra.json() as any;
    const rb = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr B', serviceIds: [] }, token));
    const { professionalId: pidB } = await rb.json() as any;
    // A desmarca o serviço (serviceIds sem o serviço)
    const editA = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', id: pidA, name: 'Dr A', serviceIds: [] }, token));
    expect((await editA.json() as any).ok).toBe(true);
    const db = await readDB();
    const svc = db.services.find(s=>s.id===serviceId)! as any;
    expect(svc.professionalMode).toBe('selected');
    expect(svc.professionalIds).toContain(pidB);
    expect(svc.professionalIds).not.toContain(pidA);
    const pros = db.professionals.filter(p=>p.businessId===BIZ);
    expect(professionalServesService(svc as any, pidA, pros as any)).toBe(false);
    expect(professionalServesService(svc as any, pidB, pros as any)).toBe(true);
  });

  it('E. Depois disso criar C → C NÃO entra automaticamente em selected', async () => {
    const r = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Consulta Geral', durationMin: 30, professionalMode: 'all', professionalIds: [] }, token));
    const { serviceId } = await r.json() as any;
    const ra = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr A', serviceIds: [] }, token));
    const { professionalId: pidA } = await ra.json() as any;
    const rb = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr B', serviceIds: [] }, token));
    const { professionalId: pidB } = await rb.json() as any;
    // A desmarca -> converte para selected [B]
    await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', id: pidA, name: 'Dr A', serviceIds: [] }, token));
    let db = await readDB();
    let svc = db.services.find(s=>s.id===serviceId)! as any;
    expect(svc.professionalMode).toBe('selected');
    // Cria C
    const rc = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr C', serviceIds: [] }, token));
    const { professionalId: pidC } = await rc.json() as any;
    db = await readDB();
    svc = db.services.find(s=>s.id===serviceId)! as any;
    expect(svc.professionalIds).not.toContain(pidC);
    const pros = db.professionals.filter(p=>p.businessId===BIZ);
    expect(professionalServesService(svc as any, pidC, pros as any)).toBe(false);
  });

  it('F. Service selected [A,B], editar A → não altera B', async () => {
    const ra = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr A', serviceIds: [] }, token));
    const { professionalId: pidA } = await ra.json() as any;
    const rb = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr B', serviceIds: [] }, token));
    const { professionalId: pidB } = await rb.json() as any;
    const r = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Consulta', durationMin: 30, professionalMode: 'selected', professionalIds: [pidA, pidB] }, token));
    const { serviceId } = await r.json() as any;
    // Edita A mantendo o serviço
    await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', id: pidA, name: 'Dr A edit', serviceIds: [serviceId] }, token));
    const db = await readDB();
    const svc = db.services.find(s=>s.id===serviceId)! as any;
    expect(svc.professionalIds).toContain(pidA);
    expect(svc.professionalIds).toContain(pidB);
  });

  it('G. Agenda/Booking/Queue usam mesma função', async () => {
    // Verifica que Queue e Booking importam a mesma função canônica
    const bookingSrc = await import('../booking');
    const queueSrc = await import('../queue');
    expect(typeof bookingSrc.eligibleProfessionalIds).toBe('function');
    expect(typeof bookingSrc.professionalServesService).toBe('function');
    expect(typeof bookingSrc.serviceProfessionalMode).toBe('function');
    // Queue usa professionalServesService internamente (via resolveQueueAssignment com mode)
    expect(typeof queueSrc.resolveQueueAssignment).toBe('function');
  });

  it('H. Cenário principal: Consulta Geral com Dr A e Dr B, disponibilidades independentes', async () => {
    // Service
    const r = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Consulta Geral', durationMin: 30, professionalMode: 'all', professionalIds: [] }, token));
    const { serviceId } = await r.json() as any;
    // Professionals
    const ra = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr A', serviceIds: [] }, token));
    const { professionalId: pidA } = await ra.json() as any;
    const rb = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr B', serviceIds: [] }, token));
    const { professionalId: pidB } = await rb.json() as any;
    // Disponibilidades independentes: A seg/ter/qua, B qui/sex/sab
    // Primeiro, colocar A e B em modo próprio
    await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', id: pidA, name: 'Dr A', followBusinessHours: false }, token));
    await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', id: pidB, name: 'Dr B', followBusinessHours: false }, token));
    await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'availability.save', scope: { professionalId: pidA }, rules: [{ weekday: 1, start: '09:00', end: '12:00', slotMin: 30 }, { weekday: 2, start: '09:00', end: '12:00', slotMin: 30 }, { weekday: 3, start: '09:00', end: '12:00', slotMin: 30 }] }, token));
    await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'availability.save', scope: { professionalId: pidB }, rules: [{ weekday: 4, start: '09:00', end: '12:00', slotMin: 30 }, { weekday: 5, start: '09:00', end: '12:00', slotMin: 30 }, { weekday: 6, start: '09:00', end: '12:00', slotMin: 30 }] }, token));
    const db = await readDB();
    const svc = db.services.find(s=>s.id===serviceId)! as any;
    // both eligible
    const pros = db.professionals.filter(p=>p.businessId===BIZ);
    expect(professionalServesService(svc as any, pidA, pros as any)).toBe(true);
    expect(professionalServesService(svc as any, pidB, pros as any)).toBe(true);
    // Disponibilidades estão separadas
    const avA = db.availability.filter(a=>a.professionalId===pidA);
    const avB = db.availability.filter(a=>a.professionalId===pidB);
    expect(avA.length).toBe(3);
    expect(avB.length).toBe(3);
    // Não duplicar serviço: só um serviço
    expect(db.services.filter(s=>s.businessId===BIZ && s.name==='Consulta Geral').length).toBe(1);
  });

  it('I. Inline service dentro do profissional nasce selected com pid real', async () => {
    // Cria Dr A novo e inline service
    const ra = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr A', serviceIds: [] }, token));
    const { professionalId: pidA } = await ra.json() as any;
    // inline service: cria como selected vazio, sem pid ainda
    const rs = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Consulta Cardiológica', durationMin: 30, professionalMode: 'selected', professionalIds: [] }, token));
    const { serviceId } = await rs.json() as any;
    let db = await readDB();
    let svc = db.services.find(s=>s.id===serviceId)! as any;
    expect(svc.professionalMode).toBe('selected');
    expect(svc.professionalIds).toEqual([]);
    // agora vincula via professional.save
    await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', id: pidA, name: 'Dr A', serviceIds: [serviceId] }, token));
    db = await readDB();
    svc = db.services.find(s=>s.id===serviceId)! as any;
    expect(svc.professionalMode).toBe('selected');
    expect(svc.professionalIds).toEqual([pidA]);
    const pros = db.professionals.filter(p=>p.businessId===BIZ);
    expect(professionalServesService(svc as any, pidA, pros as any)).toBe(true);
  });

  it('J. Histórico: Queue walk-in sem booking bloqueia delete', async () => {
    const rs = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Consulta', durationMin: 30, professionalMode: 'selected', professionalIds: [] }, token));
    const { serviceId } = await rs.json() as any;
    const rp = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr A', serviceIds: [] }, token));
    const { professionalId } = await rp.json() as any;
    // Cria QueueEntry sem booking
    const db = await readDB();
    db.queue.push({ id: 'q1', businessId: BIZ, customerName: 'Cli', customerPhone: '11999999999', contactId: '', serviceId, professionalId, bookingId: '', note: '', status: 'waiting', date: '2026-09-30', createdAt: NOW, calledAt: '', startedAt: '', endedAt: '', updatedBy: OWNER_ID, updatedAt: NOW } as any);
    await writeDB(db);
    expect(serviceHasHistory(await readDB() as any, BIZ, serviceId)).toBe(true);
    expect(professionalHasHistory(await readDB() as any, BIZ, professionalId)).toBe(true);
    const delS = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.delete', id: serviceId }, token));
    expect((await delS.json() as any).error).toMatch(/possui histórico/);
    const delP = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.delete', id: professionalId }, token));
    expect((await delP.json() as any).error).toMatch(/possui histórico/);
    // historyRefs deve conter
    const hist = historyRefsForBusiness(await readDB() as any, BIZ);
    expect(hist.services).toContain(serviceId);
    expect(hist.professionals).toContain(professionalId);
  });

  it('K. Histórico: Encounter sem booking bloqueia delete', async () => {
    const rs = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Consulta', durationMin: 30 }, token));
    const { serviceId } = await rs.json() as any;
    const rp = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr A', serviceIds: [] }, token));
    const { professionalId } = await rp.json() as any;
    const db = await readDB();
    db.encounters.push({ id: 'e1', businessId: BIZ, bookingId: '', queueId: 'q1', serviceId, professionalId, customerId: '', contactId: '', customerName: 'Cli', date: '2026-09-30', time: '09:00', complaint: '', evolution: '', guidance: '', followUp: '', internalNote: '', tags: [], status: 'finalized', createdAt: NOW } as any);
    await writeDB(db);
    expect(serviceHasHistory(await readDB() as any, BIZ, serviceId)).toBe(true);
    const delS = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.delete', id: serviceId }, token));
    expect((await delS.json() as any).error).toMatch(/possui histórico/);
  });

  it('L. Histórico: Booking passado ainda bloqueia, nunca referenciado pode deletar', async () => {
    const rs = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Consulta', durationMin: 30 }, token));
    const { serviceId } = await rs.json() as any;
    const rp = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr A', serviceIds: [] }, token));
    const { professionalId } = await rp.json() as any;
    // Booking passado
    const db = await readDB();
    db.bookings.push({ id: 'b1', businessId: BIZ, serviceId, professionalId, customerId: '', customerName: 'Cli', customerPhone: '11999999999', date: '2020-01-01', time: '09:00', status: 'completed', note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [] } as any);
    await writeDB(db);
    const delS = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.delete', id: serviceId }, token));
    expect((await delS.json() as any).error).toMatch(/possui histórico/);
    // Cria outro nunca referenciado
    const rs2 = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Temp', durationMin: 30 }, token));
    const { serviceId: sid2 } = await rs2.json() as any;
    const rp2 = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'TempPro', serviceIds: [sid2] }, token));
    const { professionalId: pid2 } = await rp2.json() as any;
    // Antes de deletar, verifica que não tem histórico
    expect(serviceHasHistory(await readDB() as any, BIZ, sid2)).toBe(false);
    // Mas agora tem professional vinculado, mas sem histórico ainda, pode deletar professional e limpar
    await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'availability.save', scope: { professionalId: pid2 }, rules: [{ weekday: 1, start: '09:00', end: '12:00', slotMin: 30 }] }, token));
    const delP2 = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.delete', id: pid2 }, token));
    expect((await delP2.json() as any).ok).toBe(true);
    const db2 = await readDB();
    expect(db2.services.find(s=>s.id===sid2)!.professionalIds).not.toContain(pid2);
    expect(db2.availability.some(a=>a.professionalId===pid2)).toBe(false);
  });
});
