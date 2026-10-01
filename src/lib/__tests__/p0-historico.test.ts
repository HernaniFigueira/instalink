// P0 FECHAMENTO — histórico clínico: financeiro + anamnese
// Prova real (temp-db) que serviceHasHistory/professionalHasHistory e historyRefs
// consideram FinanceEntry.serviceId/professionalId e AnamneseResponse.professionalId,
// além de Bookings/Queue/Encounters. Garante que limpeza de vínculo libera hard delete.
import './helpers/temp-db';
import { beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { POST as catalogPOST } from '@/app/api/catalog/route';
import { serviceHasHistory, professionalHasHistory, historyRefsForBusiness } from '../history';
import type { Business } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-30T12:00:00.000Z';
const BIZ = 'biz-p0-hist';
const OWNER = 'owner-p0-hist';

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
    createdAt: NOW,
    updatedAt: NOW,
  } as Business;
}

function authed(body: any, token: string) {
  return new NextRequest('http://test/api/catalog', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', authorization: `Bearer ${token}` } as any,
  });
}

describe('P0 histórico — FinanceEntry e AnamneseResponse contam como histórico', () => {
  let token = '';
  beforeEach(async () => {
    fs.rmSync(TEMP_DB_FILE, { force: true });
    const db = emptyDB();
    db.users.push({ id: OWNER, name: 'Owner', email: 'owner@biz.com', passwordHash: 'x', createdAt: NOW, role: 'owner' } as any);
    db.businesses.push(business(BIZ));
    db.organizations.push({ id: `org-${BIZ}`, name: 'Org', ownerId: OWNER, createdAt: NOW } as any);
    await writeDB(db);
    token = await createSession(OWNER);
  });

  it('FinanceOnly: service e professional com histórico apenas via financeEntries bloqueiam delete, com mensagem humana', async () => {
    const rs = await catalogPOST(authed({ businessId: BIZ, action: 'service.save', name: 'Consulta', durationMin: 30, professionalMode: 'selected', professionalIds: [] }, token));
    const { serviceId } = (await rs.json()) as any;
    const rp = await catalogPOST(authed({ businessId: BIZ, action: 'professional.save', name: 'Dr Ana', serviceIds: [serviceId] }, token));
    const { professionalId } = (await rp.json()) as any;

    // Só financeiro — sem booking/queue/encounter
    const db = await readDB();
    db.financeEntries.push({
      id: 'fin-1',
      businessId: BIZ,
      kind: 'receita',
      status: 'paid',
      amount: 10000,
      description: 'Consulta',
      dueDate: '2026-09-30',
      paidAt: '2026-09-30',
      method: 'pix',
      contactId: '',
      bookingId: '',
      serviceId,
      professionalId,
      createdAt: NOW,
      updatedAt: NOW,
    } as any);
    await writeDB(db);

    expect(serviceHasHistory(await readDB() as any, BIZ, serviceId)).toBe(true);
    expect(professionalHasHistory(await readDB() as any, BIZ, professionalId)).toBe(true);
    const hist = historyRefsForBusiness(await readDB() as any, BIZ);
    expect(hist.services).toContain(serviceId);
    expect(hist.professionals).toContain(professionalId);

    const delS = await catalogPOST(authed({ businessId: BIZ, action: 'service.delete', id: serviceId }, token));
    const jS = await delS.json() as any;
    expect(jS.error).toMatch(/possui histórico/i);
    expect(jS.error).toMatch(/Desative/i);
    const delP = await catalogPOST(authed({ businessId: BIZ, action: 'professional.delete', id: professionalId }, token));
    expect((await delP.json() as any).error).toMatch(/possui histórico/i);
  });

  it('AnamneseOnly: professional com histórico apenas via anamneseResponses bloqueia; service não é bloqueado por anamnese', async () => {
    const rs = await catalogPOST(authed({ businessId: BIZ, action: 'service.save', name: 'Consulta', durationMin: 30 }, token));
    const { serviceId } = (await rs.json()) as any;
    const rp = await catalogPOST(authed({ businessId: BIZ, action: 'professional.save', name: 'Dr Bruno', serviceIds: [serviceId] }, token));
    const { professionalId } = (await rp.json()) as any;

    const db = await readDB();
    // Anamnese só tem professionalId, não serviceId
    db.anamneseResponses.push({
      id: 'ana-1',
      businessId: BIZ,
      templateId: 'tmpl-1',
      encounterId: '',
      contactId: '',
      petId: '',
      professionalId,
      answers: { q1: 'sim' },
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: OWNER,
    } as any);
    await writeDB(db);

    expect(professionalHasHistory(await readDB() as any, BIZ, professionalId)).toBe(true);
    // service não tem histórico só por anamnese (anamnese não vincula serviço)
    expect(serviceHasHistory(await readDB() as any, BIZ, serviceId)).toBe(false);

    const hist = historyRefsForBusiness(await readDB() as any, BIZ);
    expect(hist.professionals).toContain(professionalId);
    expect(hist.services).not.toContain(serviceId);

    const delP = await catalogPOST(authed({ businessId: BIZ, action: 'professional.delete', id: professionalId }, token));
    expect((await delP.json() as any).error).toMatch(/possui histórico/i);
    // service sem histórico pode ser deletado (ou pelo menos não bloqueia por histórico)
    // Cria um service sem vínculo para deletar? Mas o serviceId tem vínculo com professional mas não com histórico,
    // então delete deve passar (não ter erro de histórico). Vamos tentar deletar um service temporário.
    const delS = await catalogPOST(authed({ businessId: BIZ, action: 'service.delete', id: serviceId }, token));
    // Service com professional vinculado mas sem histórico operacional/financeiro: o delete deve limpar vínculo e ok
    // Se houver bloqueio, seria por anamnese — mas anamnese não bloqueia service
    expect((await delS.json() as any).ok).toBe(true);
  });

  it('Limpeza: após remover finance/anamnese e booking, historyRefs limpa e delete libera, removendo availabilities', async () => {
    const rs = await catalogPOST(authed({ businessId: BIZ, action: 'service.save', name: 'Temp', durationMin: 30 }, token));
    const { serviceId } = (await rs.json()) as any;
    const rp = await catalogPOST(authed({ businessId: BIZ, action: 'professional.save', name: 'TempPro', serviceIds: [serviceId] }, token));
    const { professionalId } = (await rp.json()) as any;

    // Cria histórico finance + anamnese + booking
    let db = await readDB();
    db.financeEntries.push({
      id: 'fin-2',
      businessId: BIZ,
      kind: 'receita',
      status: 'paid',
      amount: 5000,
      description: 'Tx',
      dueDate: '2026-09-30',
      paidAt: '2026-09-30',
      method: 'pix',
      contactId: '',
      bookingId: '',
      serviceId,
      professionalId,
      createdAt: NOW,
      updatedAt: NOW,
    } as any);
    db.anamneseResponses.push({
      id: 'ana-2',
      businessId: BIZ,
      templateId: 'tmpl-1',
      encounterId: '',
      contactId: '',
      petId: '',
      professionalId,
      answers: {},
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: OWNER,
    } as any);
    db.bookings.push({
      id: 'bk-1',
      businessId: BIZ,
      customerId: '',
      serviceId,
      professionalId,
      date: '2026-09-10',
      time: '09:00',
      customerName: 'Cli',
      customerPhone: '11999999999',
      status: 'completed',
      note: '',
      answers: [],
      createdAt: NOW,
      updatedAt: NOW,
      history: [],
    } as any);
    db.availability.push({ id: 'av-1', businessId: BIZ, weekday: 1, start: '09:00', end: '12:00', slotMin: 30, professionalId, serviceId: '' } as any);
    await writeDB(db);

    expect(serviceHasHistory(await readDB() as any, BIZ, serviceId)).toBe(true);
    expect(professionalHasHistory(await readDB() as any, BIZ, professionalId)).toBe(true);

    // Limpa tudo
    db = await readDB();
    db.financeEntries = [];
    db.anamneseResponses = [];
    db.bookings = [];
    db.queue = [];
    db.encounters = [];
    await writeDB(db);

    expect(serviceHasHistory(await readDB() as any, BIZ, serviceId)).toBe(false);
    expect(professionalHasHistory(await readDB() as any, BIZ, professionalId)).toBe(false);
    const hist = historyRefsForBusiness(await readDB() as any, BIZ);
    expect(hist.services).not.toContain(serviceId);
    expect(hist.professionals).not.toContain(professionalId);

    // Agora delete deve funcionar e limpar availability
    const delP = await catalogPOST(authed({ businessId: BIZ, action: 'professional.delete', id: professionalId }, token));
    expect((await delP.json() as any).ok).toBe(true);
    db = await readDB();
    expect(db.professionals.find(p => p.id === professionalId)).toBeUndefined();
    expect(db.availability.some(a => a.professionalId === professionalId)).toBe(false);
    expect(db.services.find(s => s.id === serviceId)!.professionalIds).not.toContain(professionalId);

    const delS = await catalogPOST(authed({ businessId: BIZ, action: 'service.delete', id: serviceId }, token));
    expect((await delS.json() as any).ok).toBe(true);
    expect((await readDB()).services.find(s => s.id === serviceId)).toBeUndefined();
  });

  it('historyRefs une corretamente Booking/Queue/Encounters/Finance/Anamnese sem duplicar e por business', async () => {
    // Cria service e professionals
    const rs = await catalogPOST(authed({ businessId: BIZ, action: 'service.save', name: 'Consulta', durationMin: 30 }, token));
    const { serviceId } = (await rs.json()) as any;
    const rpA = await catalogPOST(authed({ businessId: BIZ, action: 'professional.save', name: 'Dr A', serviceIds: [serviceId] }, token));
    const { professionalId: pidA } = (await rpA.json()) as any;
    const rpB = await catalogPOST(authed({ businessId: BIZ, action: 'professional.save', name: 'Dr B', serviceIds: [] }, token));
    const { professionalId: pidB } = (await rpB.json()) as any;

    const otherBiz = 'biz-other';
    const db0 = await readDB();
    db0.businesses.push(business(otherBiz));
    // Dados de outro business não devem vazar
    db0.bookings.push({
      id: 'bk-other',
      businessId: otherBiz,
      customerId: '',
      serviceId,
      professionalId: pidA,
      date: '2026-09-30',
      time: '10:00',
      customerName: 'Outro',
      customerPhone: '11988888888',
      status: 'confirmed',
      note: '',
      answers: [],
      createdAt: NOW,
      updatedAt: NOW,
      history: [],
    } as any);
    db0.financeEntries.push({
      id: 'fin-other',
      businessId: otherBiz,
      kind: 'receita',
      status: 'paid',
      amount: 1000,
      description: 'Outro',
      dueDate: '2026-09-30',
      paidAt: '2026-09-30',
      method: 'pix',
      contactId: '',
      bookingId: '',
      serviceId,
      professionalId: pidA,
      createdAt: NOW,
      updatedAt: NOW,
    } as any);
    // Dados do BIZ
    db0.bookings.push({
      id: 'bk-biz',
      businessId: BIZ,
      customerId: '',
      serviceId,
      professionalId: pidA,
      date: '2026-09-30',
      time: '11:00',
      customerName: 'Cli',
      customerPhone: '11999999999',
      status: 'confirmed',
      note: '',
      answers: [],
      createdAt: NOW,
      updatedAt: NOW,
      history: [],
    } as any);
    db0.queue.push({
      id: 'q-1',
      businessId: BIZ,
      customerName: 'Walk',
      customerPhone: '11999999999',
      contactId: '',
      serviceId,
      professionalId: pidB,
      bookingId: '',
      note: '',
      status: 'waiting',
      date: '2026-09-30',
      createdAt: NOW,
      calledAt: '',
      startedAt: '',
      endedAt: '',
      updatedBy: OWNER,
      updatedAt: NOW,
    } as any);
    db0.encounters.push({
      id: 'e-1',
      businessId: BIZ,
      bookingId: '',
      queueId: 'q-1',
      serviceId,
      professionalId: pidA,
      customerId: '',
      contactId: '',
      customerName: 'Cli',
      date: '2026-09-30',
      time: '09:00',
      complaint: '',
      evolution: 'feito',
      guidance: '',
      followUp: '',
      internalNote: '',
      tags: [],
      status: 'finalized',
      createdAt: NOW,
    } as any);
    db0.financeEntries.push({
      id: 'fin-biz',
      businessId: BIZ,
      kind: 'receita',
      status: 'paid',
      amount: 2000,
      description: 'Finance BIZ',
      dueDate: '2026-09-30',
      paidAt: '2026-09-30',
      method: 'pix',
      contactId: '',
      bookingId: '',
      serviceId,
      professionalId: pidB,
      createdAt: NOW,
      updatedAt: NOW,
    } as any);
    db0.anamneseResponses.push({
      id: 'ana-biz',
      businessId: BIZ,
      templateId: 'tmpl-1',
      encounterId: '',
      contactId: '',
      petId: '',
      professionalId: pidB,
      answers: {},
      createdAt: NOW,
      updatedAt: NOW,
      createdBy: OWNER,
    } as any);
    await writeDB(db0);

    const hist = historyRefsForBusiness(await readDB() as any, BIZ);
    expect(hist.services).toContain(serviceId);
    // Não contém duplicados
    expect(new Set(hist.services).size).toBe(hist.services.length);
    expect(new Set(hist.professionals).size).toBe(hist.professionals.length);
    expect(hist.professionals).toEqual(expect.arrayContaining([pidA, pidB]));
    // Não vazou do otherBiz
    const histOther = historyRefsForBusiness(await readDB() as any, otherBiz);
    expect(histOther.services).toContain(serviceId);
    expect(histOther.professionals).toContain(pidA);
  });
});
