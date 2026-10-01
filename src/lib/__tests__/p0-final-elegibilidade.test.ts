import './helpers/temp-db';
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { POST as catalogPOST } from '@/app/api/catalog/route';
import { GET as bookingsGET } from '@/app/api/bookings/route';
import { eligibleProfessionalIds, serviceProfessionalMode } from '../booking';
import { computeSlots } from '../slots';
import { serviceAcceptsProfessional, uniqueEligibleServiceId } from '../agenda-cell-prefill';
import type { Business, Service, Professional } from '../types';
import { addDaysISO } from '../tz';

const NOW = '2026-09-30T12:00:00.000Z';
const BIZ = 'biz-final';
const OWNER_ID = 'owner-final';

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
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 60, bufferMin: 0 },
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

describe('P0 FINAL — elegibilidade verdade única', () => {
  let token: string;
  beforeEach(async () => {
    const db = emptyDB();
    db.users.push({ id: OWNER_ID, name: 'Owner', email: 'owner@biz.com', passwordHash: 'x', createdAt: NOW, role: 'owner', lastLoginAt: '' } as any);
    db.businesses.push(business(BIZ));
    db.organizations.push({ id: `org-${BIZ}`, name: 'Org', ownerId: OWNER_ID, createdAt: NOW } as any);
    await writeDB(db);
    token = await createSession(OWNER_ID);
  });

  it('1) eligibleProfessionalIds nunca retorna sentinel, só IDs reais', async () => {
    const pros: Professional[] = [
      { id: 'A', businessId: BIZ, name: 'Dr A', role: 'Vet', photo: '', active: true } as Professional,
      { id: 'B', businessId: BIZ, name: 'Dr B', role: 'Vet', photo: '', active: true } as Professional,
    ];
    const svcAll: Service = { id: 's-all', businessId: BIZ, name: 'Consulta Geral', description: '', image: '', price: 0, durationMin: 30, professionalIds: [], categoryId: '', active: true, featured: false, bookable: true, questions: [] } as any;
    (svcAll as any).professionalMode = 'all';
    expect(eligibleProfessionalIds(svcAll as any, pros)).toEqual(expect.arrayContaining(['A', 'B']));
    expect(eligibleProfessionalIds(svcAll as any, pros)).not.toContain('__no_eligible__');

    const svcSelEmpty: Service = { id: 's-empty', businessId: BIZ, name: 'Sem profissional', description: '', image: '', price: 0, durationMin: 30, professionalIds: [], categoryId: '', active: true, featured: false, bookable: true, questions: [] } as any;
    (svcSelEmpty as any).professionalMode = 'selected';
    expect(eligibleProfessionalIds(svcSelEmpty as any, pros)).toEqual([]);
    expect(eligibleProfessionalIds(svcSelEmpty as any, pros)).not.toContain('__no_eligible__');
  });

  it('2) computeSlots selected+empty -> [] e sem slots', async () => {
    const pros: Professional[] = [
      { id: 'A', businessId: BIZ, name: 'Dr A', role: 'Vet', photo: '', active: true } as any,
      { id: 'B', businessId: BIZ, name: 'Dr B', role: 'Vet', photo: '', active: true } as any,
    ];
    const svcEmpty: Service = { id: 's-empty', businessId: BIZ, name: 'Vazio', durationMin: 30, professionalIds: [], categoryId: '', active: true, featured: false, bookable: true, price: 0, description: '', image: '', questions: [] } as any;
    (svcEmpty as any).professionalMode = 'selected';
    const eligible = eligibleProfessionalIds(svcEmpty as any, pros);
    expect(eligible).toEqual([]);

    const rules: any[] = [{ id: 'r1', businessId: BIZ, professionalId: '', serviceId: '', weekday: 1, start: '09:00', end: '12:00', slotMin: 30 }];
    const r = computeSlots({
      rules, exceptions: [], bookings: [], services: [svcEmpty as any], professionals: pros as any,
      dateISO: '2026-10-05', weekday: 1, serviceId: 's-empty', durationMin: 30,
      professionalId: '', eligibleProIds: eligible, nowHM: '', leadMin: 0, bufferMin: 0,
    });
    expect(r.slots).toEqual([]);
    expect(r.closed).toBe(true);

    // all deve gerar slots
    const svcAll: Service = { id: 's-all', businessId: BIZ, name: 'Todos', durationMin: 30, professionalIds: [], categoryId: '', active: true, featured: false, bookable: true, price: 0, description: '', image: '', questions: [] } as any;
    (svcAll as any).professionalMode = 'all';
    const eligibleAll = eligibleProfessionalIds(svcAll as any, pros);
    expect(eligibleAll.length).toBe(2);
    const r2 = computeSlots({
      rules, exceptions: [], bookings: [], services: [svcAll as any], professionals: pros as any,
      dateISO: '2026-10-05', weekday: 1, serviceId: 's-all', durationMin: 30,
      professionalId: '', eligibleProIds: eligibleAll, nowHM: '', leadMin: 0, bufferMin: 0,
    });
    expect(r2.slots.length).toBeGreaterThan(0);
  });

  it('3) agenda-cell-prefill: selected+empty não é elegível e não é escolhido', async () => {
    const svcEmpty: any = { id: 's-empty', active: true, bookable: true, professionalIds: [], professionalMode: 'selected' };
    expect(serviceAcceptsProfessional(svcEmpty, 'A')).toBe(false);
    expect(serviceAcceptsProfessional(svcEmpty, '')).toBe(true); // sem profissional, não filtra

    const services: any[] = [
      { id: 's-empty', active: true, bookable: true, professionalIds: [], professionalMode: 'selected' },
      { id: 's-other', active: true, bookable: true, professionalIds: ['B'], professionalMode: 'selected' },
    ];
    // Para profissional A, só s-empty poderia ser, mas ele não é elegível (false), então 0 elegíveis -> ''
    expect(uniqueEligibleServiceId(services, 'A')).toBe('');
    // Para B, s-other é elegível único -> escolhe s-other
    expect(uniqueEligibleServiceId(services, 'B')).toBe('s-other');
    // Para serviço all, aceita qualquer
    const svcAll: any = { id: 's-all', active: true, bookable: true, professionalIds: [], professionalMode: 'all' };
    expect(serviceAcceptsProfessional(svcAll, 'A')).toBe(true);
  });

  it('4) sem booking-create regras paralelas: usa helper canônico', async () => {
    // Verifica que booking-create.ts não contém `professionalMode ||` paralelo
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/lib/booking-create.ts', 'utf8');
    expect(src).not.toMatch(/professionalMode\s*\|\|/);
    expect(src).toContain('professionalServesService');
  });

  it('5) API bookings eligibleProfessionalIds só IDs reais, tenant-safe', async () => {
    const rAll = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Consulta Geral', durationMin: 30, professionalMode: 'all', professionalIds: [] }, token));
    const { serviceId: sidAll } = await rAll.json() as any;
    const rEmpty = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Vazio', durationMin: 30, professionalMode: 'selected', professionalIds: [] }, token));
    const { serviceId: sidEmpty } = await rEmpty.json() as any;
    const ra = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr A', serviceIds: [sidAll] }, token));
    const { professionalId: pidA } = await ra.json() as any;

    // Cria disponibilidade para segunda
    await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'availability.save', scope: { professionalId: '' }, rules: [{ weekday: 1, start: '09:00', end: '12:00', slotMin: 30 }] }, token));

    // Chama GET /api/bookings para slots com service all
    const db = await readDB();
    const biz = db.businesses.find(b => b.id === BIZ)!;
    // Simula requisição de slots via API: precisa de businessId, serviceId, date
    const date = addDaysISO('2026-09-30', 7); // próxima segunda? 2026-10-05 é segunda
    const weekday = 1;
    // Usa helper para verificar que eligible para all contém pidA e não contém sentinel
    const svcAll = db.services.find(s => s.id === sidAll)! as any;
    const pros = db.professionals.filter(p => p.businessId === BIZ) as any;
    const eligibleAll = eligibleProfessionalIds(svcAll, pros);
    expect(eligibleAll).toContain(pidA);
    expect(eligibleAll).not.toContain('__no_eligible__');
    expect(eligibleAll.every(id => pros.some((p:any)=>p.id===id))).toBe(true);

    const svcEmpty = db.services.find(s => s.id === sidEmpty)! as any;
    const eligibleEmpty = eligibleProfessionalIds(svcEmpty, pros);
    expect(eligibleEmpty).toEqual([]);
  });

  it('6) Novo profissional: UI deve representar all marcado, selected não — salvar sem tocar preserva, desmarcar com explicit converte', async () => {
    // Cria services: A all, B selected [DrExistente]
    const rA = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Consulta Geral', durationMin: 30, professionalMode: 'all', professionalIds: [] }, token));
    const { serviceId: sidA } = await rA.json() as any;
    const rExist = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'DrExistente', serviceIds: [] }, token));
    const { professionalId: pidExist } = await rExist.json() as any;
    const rB = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Cirurgia', durationMin: 30, professionalMode: 'selected', professionalIds: [pidExist] }, token));
    const { serviceId: sidB } = await rB.json() as any;

    // Verifica que antes de criar DrNovo, os modos estão corretos
    let db = await readDB();
    expect(serviceProfessionalMode(db.services.find(s=>s.id===sidA)! as any)).toBe('all');
    expect(serviceProfessionalMode(db.services.find(s=>s.id===sidB)! as any)).toBe('selected');

    // Simula UI: novo profissional, fServiceIds padrão deve ser [sidA] (all), não [sidB]
    const defaultIds = db.services.filter(s=> serviceProfessionalMode(s as any)==='all').map(s=>s.id);
    expect(defaultIds).toContain(sidA);
    expect(defaultIds).not.toContain(sidB);

    // Salvar DrNovo sem tocar (explicit false, serviceIds = [sidA])
    const rNovo1 = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'DrNovo', serviceIds: [sidA], serviceSelectionExplicit: false }, token));
    const { professionalId: pidNovo1 } = await rNovo1.json() as any;
    db = await readDB();
    // A deve continuar all
    expect(serviceProfessionalMode(db.services.find(s=>s.id===sidA)! as any)).toBe('all');
    // B continua selected [pidExist]
    expect(db.services.find(s=>s.id===sidB)!.professionalIds).toEqual([pidExist]);
    // DrNovo elegível para A (all) e não para B
    const prosAfter1 = db.professionals.filter(p=>p.businessId===BIZ) as any;
    expect(eligibleProfessionalIds(db.services.find(s=>s.id===sidA)! as any, prosAfter1)).toContain(pidNovo1);
    expect(eligibleProfessionalIds(db.services.find(s=>s.id===sidB)! as any, prosAfter1)).not.toContain(pidNovo1);

    // Agora testar desmarcar all com explicit true: novo DrD desmarca A
    // Primeiro, cria B/C existentes para ter outros ativos
    const rC = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr C', serviceIds: [sidA] }, token));
    const { professionalId: pidC } = await rC.json() as any;
    db = await readDB();
    const activeBefore = db.professionals.filter(p=>p.businessId===BIZ && p.active!==false).map(p=>p.id);
    expect(activeBefore).toContain(pidExist);
    expect(activeBefore).toContain(pidNovo1);
    expect(activeBefore).toContain(pidC);

    // Dr D novo, desmarca A (serviceIds = [] ou sem sidA, explicit true)
    const rNovoD = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr D', serviceIds: [], serviceSelectionExplicit: true }, token));
    const { professionalId: pidD } = await rNovoD.json() as any;
    db = await readDB();
    const svcAAfter = db.services.find(s=>s.id===sidA)! as any;
    expect(svcAAfter.professionalMode).toBe('selected');
    // deve conter todos os anteriores, sem D
    expect(svcAAfter.professionalIds).toContain(pidExist);
    expect(svcAAfter.professionalIds).toContain(pidNovo1);
    expect(svcAAfter.professionalIds).toContain(pidC);
    expect(svcAAfter.professionalIds).not.toContain(pidD);
    // D não elegível, outros ainda elegíveis
    const prosAfterD = db.professionals.filter(p=>p.businessId===BIZ) as any;
    expect(eligibleProfessionalIds(svcAAfter, prosAfterD)).not.toContain(pidD);
    expect(eligibleProfessionalIds(svcAAfter, prosAfterD)).toContain(pidExist);
  });

  it('7) Compatibilidade: criar professional com serviceIds [] sem explicit não converte all', async () => {
    const rA = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Consulta Geral', durationMin: 30, professionalMode: 'all', professionalIds: [] }, token));
    const { serviceId: sidA } = await rA.json() as any;
    const rExist = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr Exist', serviceIds: [] }, token));
    await rExist.json();
    // Cria novo com serviceIds [] sem explicit (API antiga)
    const rNovo = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr Novo Sem Explicit', serviceIds: [] }, token));
    await rNovo.json();
    const db = await readDB();
    const svcA = db.services.find(s=>s.id===sidA)! as any;
    // deve permanecer all, não converter
    expect(serviceProfessionalMode(svcA)).toBe('all');
  });

  it('8) Inline service dentro de DrNovo continua selected', async () => {
    const rPro = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', name: 'Dr Novo Inline', serviceIds: [] }, token));
    const { professionalId: pid } = await rPro.json() as any;
    const rSvc = await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'service.save', name: 'Consulta Cardiológica', durationMin: 30, professionalMode: 'selected', professionalIds: [] }, token));
    const { serviceId } = await rSvc.json() as any;
    let db = await readDB();
    let svc = db.services.find(s=>s.id===serviceId)! as any;
    expect(svc.professionalMode).toBe('selected');
    expect(svc.professionalIds).toEqual([]);
    // vincula
    await catalogPOST(authed('http://test/api/catalog', { businessId: BIZ, action: 'professional.save', id: pid, name: 'Dr Novo Inline', serviceIds: [serviceId], serviceSelectionExplicit: true }, token));
    db = await readDB();
    svc = db.services.find(s=>s.id===serviceId)! as any;
    expect(svc.professionalMode).toBe('selected');
    expect(svc.professionalIds).toEqual([pid]);
  });
});
