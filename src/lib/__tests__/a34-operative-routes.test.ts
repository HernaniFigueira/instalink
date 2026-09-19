// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 4 — ROTAS REAIS: encaixe, check-in e fila
// ═══════════════════════════════════════════════════════════════
// O que só aparece no servidor (e é onde a regra de verdade vive):
//   • ENCAIXE passa pelo MESMO createBookingTx, mas primeiro DIZ o conflito
//     e não grava nada; com `confirmFitIn` grava marcado como `fit_in`;
//   • encaixe nunca vem do cliente público nem cria série;
//   • CHECK-IN grava chegada + auditoria sem mudar status, e é reversível;
//   • FILA tem rota própria, respeita a máquina de estados e o isolamento
//     entre unidades.
import './helpers/temp-db';

import fs from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { POST as bookingsPOST, PATCH as bookingsPATCH } from '@/app/api/bookings/route';
import { GET as queueGET, POST as queuePOST, PATCH as queuePATCH, DELETE as queueDELETE } from '@/app/api/queue/route';
import type { Business, DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const BUSINESS_ID = 'biz-b4';
const OTHER_ID = 'biz-b4-outra';
const OWNER_ID = 'owner-b4';
const TODAY = '2026-09-19';

function business(id: string): Business {
  return {
    id, ownerId: OWNER_ID, organizationId: `org-${id}`, name: `Negócio ${id}`, slug: id,
    description: '', logo: '', cover: '', niche: 'saude', modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false },
    phone: '', whatsapp: '', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0,
    googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 30, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: NOW, updatedAt: NOW, businessTimezone: 'America/Sao_Paulo',
  } as Business;
}

/** Sábado (2026-09-19) com a equipe atendendo das 08:00 às 20:00. */
async function seed() {
  const db: DB = emptyDB();
  db.users.push({ id: OWNER_ID, name: 'Dono Bloco 4', email: 'b4@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' });
  db.users.push({ id: 'outro-dono', name: 'Dono da outra unidade', email: 'outro@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' });
  db.businesses.push(business(BUSINESS_ID));
  db.businesses.push({ ...business(OTHER_ID), ownerId: 'outro-dono' });
  db.professionals.push(
    { id: 'pro-1', businessId: BUSINESS_ID, name: 'Bia', role: '', photo: '', active: true, userId: '', followsBusinessHours: true, createdAt: NOW } as any,
  );
  db.services.push({
    id: 'svc-1', businessId: BUSINESS_ID, name: 'Corte', durationMin: 60, price: 100, description: '',
    active: true, bookable: true, professionalIds: [], createdAt: NOW, updatedAt: NOW,
  } as any);
  db.services.push({
    id: 'svc-2', businessId: OTHER_ID, name: 'Serviço da outra unidade', durationMin: 30, price: 50,
    description: '', active: true, bookable: true, professionalIds: [], createdAt: NOW, updatedAt: NOW,
  } as any);
  db.availability.push({
    id: 'av-1', businessId: BUSINESS_ID, professionalId: '', serviceId: '', weekday: 6,
    start: '08:00', end: '20:00', slotMin: 30,
  } as any);
  db.bookings.push({
    id: 'bk-existente', businessId: BUSINESS_ID, customerId: '', serviceId: 'svc-1', professionalId: 'pro-1',
    date: TODAY, time: '10:00', customerName: 'Vera', customerPhone: '11999990000',
    status: 'confirmed', note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [],
  } as any);
  db.queue.push({
    id: 'q-outra', businessId: OTHER_ID, customerName: 'Da outra unidade', customerPhone: '',
    contactId: '', serviceId: '', professionalId: '', bookingId: '', note: '', status: 'waiting',
    date: TODAY, createdAt: NOW, calledAt: '', startedAt: '', endedAt: '', updatedBy: '', updatedAt: NOW,
  } as any);
  await writeDB(db);
}

function jsonReq(path: string, body: unknown, token?: string, method = 'POST'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(`http://localhost:3000${path}`, {
    method, headers,
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

const bookingPayload = (extra: Record<string, unknown> = {}) => ({
  businessId: BUSINESS_ID, asOwner: true, customerName: 'Clara', customerPhone: '11988887777',
  serviceId: 'svc-1', professionalId: 'pro-1', date: TODAY, time: '10:30', ...extra,
});

describe('A3.4 · Bloco 4 — encaixe pela rota de agendamento', () => {
  it('sem confirmação o encaixe NÃO grava e devolve o conflito com nome e horário', async () => {
    const res = await bookingsPOST(jsonReq('/api/bookings', bookingPayload({ bookingKind: 'fit_in' }), token));
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.code).toBe('fit_in_conflict');
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0]).toMatchObject({ id: 'bk-existente', customerName: 'Vera', time: '10:00', endTime: '11:00' });
    expect(body.error).toContain('Vera');
    const db = await readDB();
    expect(db.bookings.filter((b) => b.time === '10:30')).toHaveLength(0);
  });

  it('com confirmação o encaixe é criado marcado como fit_in e vira evento rastreável', async () => {
    const res = await bookingsPOST(jsonReq('/api/bookings', bookingPayload({ bookingKind: 'fit_in', confirmFitIn: true }), token));
    expect(res.status).toBe(200);
    const body = await json(res);
    const db = await readDB();
    const created = db.bookings.find((b) => b.id === body.bookingId)!;
    expect(created.bookingKind).toBe('fit_in');
    expect(created.status).toBe('confirmed');
    expect(created.history[0].note).toMatch(/encaixe/i);
    expect(db.events.some((e) => e.type === 'booking_created' && e.meta?.kind === 'fit_in')).toBe(true);
    // O CRM recebe o contato como em qualquer atendimento.
    expect(db.contacts.some((c) => c.businessId === BUSINESS_ID && c.phone === '11988887777')).toBe(true);
  });

  it('encaixe sem conflito não pede confirmação (nada de susto desnecessário)', async () => {
    const res = await bookingsPOST(jsonReq('/api/bookings', bookingPayload({ time: '15:00', bookingKind: 'fit_in' }), token));
    expect(res.status).toBe(200);
    const db = await readDB();
    expect(db.bookings.find((b) => b.time === '15:00')?.bookingKind).toBe('fit_in');
  });

  it('o agendamento normal continua exigindo horário da grade', async () => {
    const res = await bookingsPOST(jsonReq('/api/bookings', bookingPayload(), token));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatch(/ocupado/i);
  });

  it('o cliente público NUNCA encaixa (nem manda série com encaixe)', async () => {
    const semLogin = await bookingsPOST(jsonReq('/api/bookings', {
      businessId: BUSINESS_ID, customerName: 'Cliente', customerPhone: '11988887777',
      serviceId: 'svc-1', date: TODAY, time: '10:30', bookingKind: 'fit_in', confirmFitIn: true,
    }));
    expect(semLogin.status).toBe(403);
    const serie = await bookingsPOST(jsonReq('/api/bookings', bookingPayload({
      bookingKind: 'fit_in', confirmFitIn: true,
      series: { requestId: 'r1', occurrences: [{ date: TODAY, time: '10:30' }] },
    }), token));
    expect(serie.status).toBe(400);
    expect((await json(serie)).error).toMatch(/série/i);
  });
});

describe('A3.4 · Bloco 4 — check-in do atendimento', () => {
  it('registra a chegada sem mexer no status, com auditoria', async () => {
    const res = await bookingsPATCH(jsonReq('/api/bookings', {
      businessId: BUSINESS_ID, id: 'bk-existente', action: 'check-in',
    }, token, 'PATCH'));
    expect(res.status).toBe(200);
    const db = await readDB();
    const b = db.bookings.find((x) => x.id === 'bk-existente')!;
    expect(b.status).toBe('confirmed');       // chegar NÃO é concluir
    expect(b.checkedInAt).toBeTruthy();
    expect(b.checkedInByName).toBe('Dono Bloco 4');
    expect(b.history.at(-1)?.note).toMatch(/check-in/i);
    expect(db.audit.some((a) => a.action === 'booking.checkin' && a.meta?.bookingId === 'bk-existente')).toBe(true);
  });

  it('check-in é reversível (engano no balcão) e não some com o histórico', async () => {
    await bookingsPATCH(jsonReq('/api/bookings', { businessId: BUSINESS_ID, id: 'bk-existente', action: 'check-in' }, token, 'PATCH'));
    const res = await bookingsPATCH(jsonReq('/api/bookings', {
      businessId: BUSINESS_ID, id: 'bk-existente', action: 'check-in-undo',
    }, token, 'PATCH'));
    expect(res.status).toBe(200);
    const db = await readDB();
    const b = db.bookings.find((x) => x.id === 'bk-existente')!;
    expect(b.checkedInAt).toBeFalsy();
    expect(b.history.some((h) => /desfeito/i.test(h.note || ''))).toBe(true);
    const again = await bookingsPATCH(jsonReq('/api/bookings', {
      businessId: BUSINESS_ID, id: 'bk-existente', action: 'check-in-undo',
    }, token, 'PATCH'));
    expect(again.status).toBe(400);
  });

  it('atendimento encerrado não recebe check-in', async () => {
    const d = await readDB();
    d.bookings.find((x) => x.id === 'bk-existente')!.status = 'completed';
    await writeDB(d);
    const res = await bookingsPATCH(jsonReq('/api/bookings', {
      businessId: BUSINESS_ID, id: 'bk-existente', action: 'check-in',
    }, token, 'PATCH'));
    expect(res.status).toBe(400);
  });

  it('outra unidade não faz check-in no meu atendimento', async () => {
    const outrasToken = await createSession('outro-dono');
    const res = await bookingsPATCH(jsonReq('/api/bookings', {
      businessId: OTHER_ID, id: 'bk-existente', action: 'check-in',
    }, outrasToken, 'PATCH'));
    expect([400, 403, 404]).toContain(res.status);
    const db = await readDB();
    expect(db.bookings.find((x) => x.id === 'bk-existente')!.checkedInAt).toBeFalsy();
  });
});

describe('A3.4 · Bloco 4 — fila de espera pela rota', () => {
  async function addEntry(extra: Record<string, unknown> = {}) {
    const res = await queuePOST(jsonReq('/api/queue', {
      businessId: BUSINESS_ID, customerName: 'Walk-in', customerPhone: '11977776666', ...extra,
    }, token));
    expect(res.status).toBe(200);
    return (await json(res)).entry;
  }

  it('adiciona à fila, alimenta o CRM e não cria agendamento', async () => {
    const entry = await addEntry({ serviceId: 'svc-1', professionalId: 'pro-1' });
    expect(entry.status).toBe('waiting');
    expect(entry.serviceName).toBe('Corte');
    expect(entry.professionalName).toBe('Bia');
    const db = await readDB();
    expect(db.bookings.some((b) => b.customerName === 'Walk-in')).toBe(false); // fila ≠ agenda
    expect(db.queue.find((q) => q.id === entry.id)!.bookingId).toBe('');
    expect(db.audit.some((a) => a.action === 'queue.created' && a.meta?.entryId === entry.id)).toBe(true);
  });

  it('a GET devolve a fila do dia e NUNCA a de outra unidade', async () => {
    await addEntry();
    const res = await queueGET(jsonReq(`/api/queue?businessId=${BUSINESS_ID}`, undefined, token, 'GET'));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].customerName).toBe('Walk-in');
    expect(body.entries.some((e: any) => e.id === 'q-outra')).toBe(false);
    expect(body.summary.waiting).toBe(1);
  });

  it('máquina de estados: chamar → iniciar → concluir, e caminho inventado é recusado', async () => {
    const entry = await addEntry();
    const chamar = await queuePATCH(jsonReq('/api/queue', { businessId: BUSINESS_ID, id: entry.id, status: 'called' }, token, 'PATCH'));
    expect(chamar.status).toBe(200);
    expect((await json(chamar)).entry.calledAt).toBeTruthy();
    const invalido = await queuePATCH(jsonReq('/api/queue', { businessId: BUSINESS_ID, id: entry.id, status: 'waiting', ok: true }, token, 'PATCH'));
    expect(invalido.status).toBe(200); // chamado → aguardando é permitido (chamou errado)
    const pular = await queuePATCH(jsonReq('/api/queue', { businessId: BUSINESS_ID, id: entry.id, status: 'done' }, token, 'PATCH'));
    expect(pular.status).toBe(200);
    const voltar = await queuePATCH(jsonReq('/api/queue', { businessId: BUSINESS_ID, id: entry.id, status: 'in_service' }, token, 'PATCH'));
    expect(voltar.status).toBe(409);
    expect((await json(voltar)).error).toMatch(/Não é possível ir de/i);
  });

  it('iniciar atendimento congela a espera e concluir encerra a entrada', async () => {
    const entry = await addEntry();
    await queuePATCH(jsonReq('/api/queue', { businessId: BUSINESS_ID, id: entry.id, status: 'in_service' }, token, 'PATCH'));
    let db = await readDB();
    expect(db.queue.find((q) => q.id === entry.id)!.startedAt).toBeTruthy();
    await queuePATCH(jsonReq('/api/queue', { businessId: BUSINESS_ID, id: entry.id, status: 'done' }, token, 'PATCH'));
    db = await readDB();
    const row = db.queue.find((q) => q.id === entry.id)!;
    expect(row.status).toBe('done');
    expect(row.endedAt).toBeTruthy();
    // Concluída não aparece mais na fila viva.
    const res = await queueGET(jsonReq(`/api/queue?businessId=${BUSINESS_ID}`, undefined, token, 'GET'));
    const body = await json(res);
    expect(body.entries).toHaveLength(0);
    expect(body.done.map((e: any) => e.id)).toContain(entry.id);
  });

  it('exige nome ou WhatsApp (não entra linha vazia na fila)', async () => {
    const res = await queuePOST(jsonReq('/api/queue', { businessId: BUSINESS_ID, customerName: '', customerPhone: '' }, token));
    expect(res.status).toBe(400);
  });

  it('a fila de outra unidade não é operável nem removível', async () => {
    const outrasToken = await createSession('outro-dono');
    const patchRes = await queuePATCH(jsonReq('/api/queue', { businessId: OTHER_ID, id: 'q-outra', status: 'called' }, outrasToken, 'PATCH'));
    expect([200, 403]).toContain(patchRes.status); // o dono da outra unidade PODE
    const del = await queueDELETE(jsonReq('/api/queue', { businessId: BUSINESS_ID, id: 'q-outra' }, token, 'DELETE'));
    expect(del.status).toBe(404);
    const db = await readDB();
    expect(db.queue.some((q) => q.id === 'q-outra')).toBe(true);
  });
});
