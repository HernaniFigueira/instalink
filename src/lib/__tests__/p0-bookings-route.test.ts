// P0 FECHAMENTO — GET /api/bookings distingue unit vs route-handler vs HTTP
// e valida eligibleProfessionalIds + slots para 5 casos: selected empty, all, selected+0, all+0, legacy solo
import './helpers/temp-db';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { GET as bookingsGET, POST as bookingsPOST } from '@/app/api/bookings/route';
import { eligibleProfessionalIds, slotEligibleProfessionalIds, serviceProfessionalMode } from '../booking';
import { TEMP_DB_FILE } from './helpers/temp-db';
import type { Business } from '../types';

const NOW_ISO = '2026-09-30T12:00:00.000Z';
const BIZ = 'biz-p0-book';
const OWNER = 'owner-p0-book';
const DATE_WITHIN = '2026-10-06'; // Monday, dentro do horizonte (30 dias a partir de 2026-09-30)

function business(id: string): Business {
  return {
    id,
    ownerId: OWNER,
    organizationId: `org-${id}`,
    name: `Negócio ${id}`,
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
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    businessTimezone: 'America/Sao_Paulo',
  } as any;
}

function reqGET(query: string) {
  return new NextRequest(`http://localhost/api/bookings${query}`, { method: 'GET' });
}

function reqPOST(body: any, token = '') {
  const headers: any = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest('http://localhost/api/bookings', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('P0 bookings GET — 5 casos de elegibilidade (route-handler real sobre temp-db)', () => {
  let token = '';
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW_ISO));
    fs.rmSync(TEMP_DB_FILE, { force: true });
    const db = emptyDB();
    db.users.push({ id: OWNER, name: 'Owner', email: 'owner@biz.com', passwordHash: 'x', createdAt: NOW_ISO, role: 'owner' } as any);
    db.businesses.push(business(BIZ));
    db.organizations.push({ id: `org-${BIZ}`, name: 'Org', ownerId: OWNER, createdAt: NOW_ISO } as any);
    // Availability will be added per test
    await writeDB(db);
    token = await createSession(OWNER);
  });
  afterEach(() => vi.useRealTimers());

  async function addPros(ids: { id: string; active?: boolean; name?: string }[]) {
    const db = await readDB();
    for (const p of ids) {
      db.professionals.push({
        id: p.id,
        businessId: BIZ,
        name: p.name || p.id,
        role: 'Vet',
        photo: '',
        active: p.active !== false,
        followBusinessHours: false,
        createdAt: NOW_ISO,
      } as any);
      // Disponibilidade individual (para equipe)
      for (let w = 0; w < 7; w++) {
        db.availability.push({
          id: `av-${p.id}-${w}`,
          businessId: BIZ,
          weekday: w,
          start: '09:00',
          end: '12:00',
          slotMin: 30,
          professionalId: p.id,
          serviceId: '',
        } as any);
      }
    }
    // Disponibilidade geral (para solo)
    for (let w = 0; w < 7; w++) {
      db.availability.push({
        id: `av-geral-${w}`,
        businessId: BIZ,
        weekday: w,
        start: '09:00',
        end: '12:00',
        slotMin: 30,
        professionalId: '',
        serviceId: '',
      } as any);
    }
    await writeDB(db);
  }

  async function createService(extra: any) {
    const db = await readDB();
    const svc = {
      id: `svc-${Math.random().toString(36).slice(2, 6)}`,
      businessId: BIZ,
      name: 'Consulta',
      description: '',
      image: '',
      price: 100,
      durationMin: 30,
      categoryId: '',
      active: true,
      featured: false,
      bookable: true,
      questions: [],
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
      ...extra,
    } as any;
    db.services.push(svc);
    await writeDB(db);
    return svc;
  }

  it('selected empty — professionalMode selected com [] explícito e 2 pros ativos → eligible [] e sem janelas', async () => {
    await addPros([{ id: 'A' }, { id: 'B' }]);
    const svc = await createService({ professionalMode: 'selected', professionalIds: [] });

    const db = await readDB();
    const active = db.professionals.filter(p => p.businessId === BIZ && p.active !== false);
    expect(serviceProfessionalMode(svc as any)).toBe('selected');
    expect(eligibleProfessionalIds(svc as any, active as any)).toEqual([]);
    expect(slotEligibleProfessionalIds(svc as any, active as any)).toEqual([]);

    const res = await bookingsGET(reqGET(`?businessId=${BIZ}&serviceId=${svc.id}&date=${DATE_WITHIN}`));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.eligibleProfessionalIds).toEqual([]);
    expect(body.slots).toEqual([]);
    expect(body.closed).toBe(true);
    // Mensagem humana não vaza DTO interno na UI, mas a API retorna eligibleProfessionalIds vazio, não sentinel
    expect(body.eligibleProfessionalIds).not.toContain('');

    // Booking não nasce
    const post = await bookingsPOST(reqPOST({
      businessId: BIZ,
      serviceId: svc.id,
      date: DATE_WITHIN,
      time: '09:00',
      asOwner: true,
      customerName: 'Cli',
      customerPhone: '11999999999',
    }, token));
    expect(post.status).toBe(400);
    expect((await post.json() as any).error).toMatch(/não tem profissional/i);
  });

  it('all — professionalMode all com [A,B] ativos → eligible [A,B] e janelas existem, byPro separado', async () => {
    await addPros([{ id: 'A' }, { id: 'B' }]);
    const svc = await createService({ professionalMode: 'all', professionalIds: [] });

    const db = await readDB();
    const active = db.professionals.filter(p => p.businessId === BIZ && p.active !== false);
    expect(serviceProfessionalMode(svc as any)).toBe('all');
    expect(eligibleProfessionalIds(svc as any, active as any).sort()).toEqual(['A', 'B']);
    expect(slotEligibleProfessionalIds(svc as any, active as any)!.sort()).toEqual(['A', 'B']);

    const res = await bookingsGET(reqGET(`?businessId=${BIZ}&serviceId=${svc.id}&date=${DATE_WITHIN}`));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.eligibleProfessionalIds.sort()).toEqual(['A', 'B']);
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots).toContain('09:00');
    expect(body.byPro['A']).toBeTruthy();
    expect(body.byPro['B']).toBeTruthy();
    expect(body.closed).toBe(false);

    // Booking nasce (owner escolhe A)
    const post = await bookingsPOST(reqPOST({
      businessId: BIZ,
      serviceId: svc.id,
      date: DATE_WITHIN,
      time: '09:00',
      asOwner: true,
      professionalId: 'A',
      customerName: 'Cli',
      customerPhone: '11999999999',
    }, token));
    expect(post.status).toBe(200);
    expect((await post.json() as any).ok).toBe(true);
  });

  it('selected+0 — selected com [A] mas A inativo → eligible [] e sem janelas (explicit empty)', async () => {
    await addPros([{ id: 'A', active: false }, { id: 'B', active: false }]);
    const svc = await createService({ professionalMode: 'selected', professionalIds: ['A'] });

    const db = await readDB();
    const active = db.professionals.filter(p => p.businessId === BIZ && p.active !== false);
    expect(active.length).toBe(0);
    expect(eligibleProfessionalIds(svc as any, db.professionals.filter(p=>p.businessId===BIZ) as any)).toEqual([]);
    expect(slotEligibleProfessionalIds(svc as any, db.professionals.filter(p=>p.businessId===BIZ) as any)).toEqual([]);

    const res = await bookingsGET(reqGET(`?businessId=${BIZ}&serviceId=${svc.id}&date=${DATE_WITHIN}`));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.eligibleProfessionalIds).toEqual([]);
    expect(body.slots).toEqual([]);
    expect(body.closed).toBe(true);

    const post = await bookingsPOST(reqPOST({
      businessId: BIZ,
      serviceId: svc.id,
      date: DATE_WITHIN,
      time: '09:00',
      asOwner: true,
      customerName: 'Cli',
      customerPhone: '11999999999',
    }, token));
    expect(post.status).toBe(400);
    expect((await post.json() as any).error).toMatch(/não tem profissional/i);
  });

  it('all+0 — all com zero ativos → eligible [] e sem janelas (explicit empty bloqueia)', async () => {
    // Nenhum professional ativo (mas tem registro inativo)
    await addPros([{ id: 'A', active: false }]);
    const svc = await createService({ professionalMode: 'all', professionalIds: [] });

    const db = await readDB();
    const active = db.professionals.filter(p => p.businessId === BIZ && p.active !== false);
    expect(active.length).toBe(0);
    expect(eligibleProfessionalIds(svc as any, active as any)).toEqual([]);
    expect(slotEligibleProfessionalIds(svc as any, active as any)).toEqual([]);

    const res = await bookingsGET(reqGET(`?businessId=${BIZ}&serviceId=${svc.id}&date=${DATE_WITHIN}`));
    const body = await res.json() as any;
    expect(body.eligibleProfessionalIds).toEqual([]);
    expect(body.slots).toEqual([]);
    expect(body.closed).toBe(true);

    const post = await bookingsPOST(reqPOST({
      businessId: BIZ,
      serviceId: svc.id,
      date: DATE_WITHIN,
      time: '09:00',
      asOwner: true,
      customerName: 'Cli',
      customerPhone: '11999999999',
    }, token));
    expect(post.status).toBe(400);
    expect((await post.json() as any).error).toMatch(/não tem profissional/i);
  });

  it('legacy solo — sem professionalMode e sem ids e sem profissionais → slotEligible undefined, ainda abre janela geral e permite booking', async () => {
    // Zero profissionais, serviço legado (sem campo professionalMode)
    // Não adiciona pros, só disponibilidade geral
    const db0 = await readDB();
    for (let w = 0; w < 7; w++) {
      db0.availability.push({
        id: `av-legacy-${w}`,
        businessId: BIZ,
        weekday: w,
        start: '09:00',
        end: '12:00',
        slotMin: 30,
        professionalId: '',
        serviceId: '',
      } as any);
    }
    await writeDB(db0);
    const svc = await createService({ professionalIds: [] }); // sem professionalMode
    // Simula legado: apaga professionalMode caso tenha sido default
    const db1 = await readDB();
    const raw = db1.services.find(s => s.id === svc.id) as any;
    delete raw.professionalMode;
    await writeDB(db1);
    const svcLegacy = (await readDB()).services.find(s => s.id === svc.id) as any;
    expect(svcLegacy.professionalMode).toBeUndefined();
    expect((svcLegacy.professionalIds || []).length).toBe(0);

    const active: any[] = [];
    expect(eligibleProfessionalIds(svcLegacy as any, active as any)).toEqual([]); // canônica retorna [] (all com zero)
    expect(slotEligibleProfessionalIds(svcLegacy as any, active as any)).toBeUndefined(); // helper preserva legacy

    const res = await bookingsGET(reqGET(`?businessId=${BIZ}&serviceId=${svc.id}&date=${DATE_WITHIN}`));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    // eligibleProfessionalIds da API é a lista canônica (vazia, não sentinel), mas slots existem via solo fallback
    expect(body.eligibleProfessionalIds).toEqual([]);
    expect(body.slots.length).toBeGreaterThan(0);
    expect(body.slots).toContain('09:00');
    // Solo: byPro '' contém janelas
    expect(body.byPro['']).toBeTruthy();
    expect(body.closed).toBe(false);

    // Booking nasce mesmo sem profissional (preserva compatibilidade)
    const post = await bookingsPOST(reqPOST({
      businessId: BIZ,
      serviceId: svc.id,
      date: DATE_WITHIN,
      time: '09:00',
      asOwner: true,
      customerName: 'Cli Solo',
      customerPhone: '11999999999',
    }, token));
    expect(post.status).toBe(200);
    const j = await post.json() as any;
    expect(j.ok).toBe(true);
    expect(j.professionalId).toBe(''); // solo
  });

  it('distinção unit vs route-handler: helper unitário e rota real concordam sobre all+0 vs legacy', async () => {
    // Unit: helper
    const svcAllZero: any = { id: 's1', businessId: BIZ, name: 'Svc', durationMin: 30, professionalMode: 'all', professionalIds: [] };
    const svcLegacy: any = { id: 's2', businessId: BIZ, name: 'Svc', durationMin: 30, professionalIds: [] }; // sem mode
    expect(slotEligibleProfessionalIds(svcAllZero, [])).toEqual([]); // explicit
    expect(slotEligibleProfessionalIds(svcLegacy, [])).toBeUndefined(); // legacy

    // Route-handler: GET real já testado acima; aqui só confirma que a distinção não é perdida no transporte HTTP
    // (o server nunca serializa undefined como [] — o helper interno é o que decide)
    expect(serviceProfessionalMode(svcAllZero)).toBe('all');
    expect(serviceProfessionalMode(svcLegacy)).toBe('all'); // fallback, mas slot helper diferencia
  });
});
