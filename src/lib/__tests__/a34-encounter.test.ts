// ═══════════════════════════════════════════════════════════════
// A3.4 · BLOCO 5 — REGISTRO DO ATENDIMENTO
// ═══════════════════════════════════════════════════════════════
// Travas deste bloco:
//   • o registro é entidade PRÓPRIA (não é `Booking.note`), 1:1 com o
//     agendamento — criar duas vezes devolve o existente, nunca duplica;
//   • permissão DEDICADA (`atendimento`): não vem junto com "clientes";
//   • rascunho é livre, finalizado é DOCUMENTO: só reabre quem administra, e
//     toda mudança fica auditada;
//   • a via impressa do cliente NÃO leva anotação interna;
//   • escopo do profissional vale aqui como na agenda.
import './helpers/temp-db';

import fs from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { GET as encountersGET, POST as encountersPOST, PATCH as encountersPATCH, DELETE as encountersDELETE } from '@/app/api/encounters/route';
import { PERMISSIONS, permissionsFor } from '../permissions';
import {
  ENCOUNTER_LIMITS, ENCOUNTER_STATUS, canEditEncounter, canFinalize, cleanTags, cleanText,
  encounterForBooking, encounterInScope, encounterPrintBlocks, encounterSignature, encounterSummary,
  encountersForCustomer,
} from '../encounters';
import type { Business, DB, Encounter } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const BIZ = 'biz-b5';
const OTHER = 'biz-b5-outra';
const OWNER = 'owner-b5';
const PROF_USER = 'user-prof-b5';

function business(id: string, ownerId = OWNER): Business {
  return {
    id, ownerId, organizationId: `org-${id}`, name: `Negócio ${id}`, slug: id,
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

const encounter = (extra: Partial<Encounter> & { id: string }): Encounter => ({
  businessId: BIZ, bookingId: '', serviceId: 'svc-1', professionalId: 'pro-1', customerId: '',
  contactId: 'ct-1', customerName: 'Ana', date: '2026-09-19', time: '09:00',
  complaint: '', evolution: 'Limpeza', guidance: 'Evitar frios', followUp: '', internalNote: '',
  tags: [], status: 'draft', createdAt: NOW, updatedAt: NOW, createdBy: OWNER, updatedBy: OWNER,
  finalizedAt: '', finalizedBy: '', signedBy: '', ...extra,
});

async function seed() {
  const db: DB = emptyDB();
  db.users.push({ id: OWNER, name: 'Dona Unidade', email: 'b5@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' });
  db.users.push({ id: PROF_USER, name: 'Dra. Bia', email: 'bia@example.com', passwordHash: 'x', createdAt: NOW, role: 'admin' });
  db.businesses.push(business(BIZ));
  db.businesses.push(business(OTHER));
  db.members.push({
    id: 'm-prof', businessId: BIZ, userId: PROF_USER, role: 'PROFISSIONAL', active: true,
    permissions: {}, createdAt: NOW, updatedAt: NOW,
  } as any);
  db.professionals.push(
    { id: 'pro-1', businessId: BIZ, name: 'Bia', role: '', photo: '', active: true, userId: PROF_USER, followsBusinessHours: true, createdAt: NOW } as any,
    { id: 'pro-2', businessId: BIZ, name: 'Caio', role: '', photo: '', active: true, userId: '', followsBusinessHours: true, createdAt: NOW } as any,
  );
  db.services.push({ id: 'svc-1', businessId: BIZ, name: 'Limpeza', durationMin: 60, price: 100, description: '', active: true, bookable: true, professionalIds: [], createdAt: NOW, updatedAt: NOW } as any);
  db.contacts.push({ id: 'ct-1', businessId: BIZ, name: 'Ana', phone: '11999990000', customerId: '', createdAt: NOW } as any);
  db.bookings.push(
    { id: 'bk-1', businessId: BIZ, customerId: '', serviceId: 'svc-1', professionalId: 'pro-1', date: '2026-09-19', time: '09:00', customerName: 'Ana', customerPhone: '11999990000', status: 'confirmed', note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [] } as any,
    { id: 'bk-2', businessId: BIZ, customerId: '', serviceId: 'svc-1', professionalId: 'pro-2', date: '2026-09-19', time: '11:00', customerName: 'Outra pessoa', customerPhone: '11988887777', status: 'confirmed', note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [] } as any,
    { id: 'bk-outra', businessId: OTHER, customerId: '', serviceId: 'svc-1', professionalId: 'pro-1', date: '2026-09-19', time: '09:00', customerName: 'De outra unidade', customerPhone: '', status: 'confirmed', note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [] } as any,
  );
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
  token = await createSession(OWNER);
});

describe('A3.4 · Bloco 5 — regras puras do registro', () => {
  it('a permissão de atendimento é própria e não vem com "clientes"', () => {
    expect(PERMISSIONS.map((p) => p.id)).toContain('atendimento');
    const secretaria = permissionsFor('SECRETARIA');
    const atendente = permissionsFor('ATENDENTE');
    const vendedor = permissionsFor('VENDEDOR');
    expect(secretaria.clientes).toBe(true);
    expect(secretaria.atendimento).toBeFalsy();   // balcão NÃO lê o registro
    expect(atendente.atendimento).toBeFalsy();
    expect(vendedor.atendimento).toBeFalsy();
    // Quem atende e quem administra têm por padrão.
    expect(permissionsFor('PROFISSIONAL').atendimento).toBe(true);
    expect(permissionsFor('ADMIN').atendimento).toBe(true);
    expect(permissionsFor('OWNER').atendimento).toBe(true);
    // E pode ser concedida por override explícito.
    expect(permissionsFor('SECRETARIA', { atendimento: true }).atendimento).toBe(true);
  });

  it('texto é higienizado e limitado por campo', () => {
    expect(cleanText('  linha com espaço no fim   \nsegunda  ', 'evolution')).toBe('linha com espaço no fim\nsegunda');
    expect(cleanText('x'.repeat(9000), 'evolution').length).toBe(ENCOUNTER_LIMITS.evolution);
    expect(cleanText('x'.repeat(9000), 'complaint').length).toBe(ENCOUNTER_LIMITS.complaint);
    expect(cleanText(null, 'guidance')).toBe('');
  });

  it('etiquetas: sem repetição, sem vazio, com teto', () => {
    expect(cleanTags([' limpeza ', 'LIMPEZA', '', 'flúor'])).toEqual(['limpeza', 'flúor']);
    expect(cleanTags(Array.from({ length: 20 }, (_, i) => `t${i}`)).length).toBe(8);
    expect(cleanTags('não é lista')).toEqual([]);
  });

  it('finalizar exige conteúdo: documento vazio não vira via do cliente', () => {
    expect(canFinalize({ evolution: '', complaint: '', guidance: '' }).ok).toBe(false);
    expect(canFinalize({ evolution: 'ab', complaint: '', guidance: '' }).ok).toBe(false);
    expect(canFinalize({ evolution: 'limpeza feita', complaint: '', guidance: '' }).ok).toBe(true);
    expect(canFinalize({ evolution: '', complaint: 'dor no dente', guidance: '' }).ok).toBe(true);
  });

  it('rascunho é editável; finalizado só com quem reabre', () => {
    expect(canEditEncounter({ status: 'draft' }, { canReopen: false })).toBe(true);
    expect(canEditEncounter({ status: 'finalized' }, { canReopen: false })).toBe(false);
    expect(canEditEncounter({ status: 'finalized' }, { canReopen: true })).toBe(true);
  });

  it('escopo do profissional: quem atende vê o que atendeu', () => {
    expect(encounterInScope({ professionalId: 'pro-1' }, '')).toBe(true);
    expect(encounterInScope({ professionalId: 'pro-1' }, 'pro-1')).toBe(true);
    expect(encounterInScope({ professionalId: 'pro-2' }, 'pro-1')).toBe(false);
  });

  it('a via do cliente NÃO leva anotação interna, e a assinatura é de quem atendeu', () => {
    const e = encounter({
      id: 'e1', internalNote: 'segredo da unidade', signedBy: 'Bia', finalizedBy: 'user-1', status: 'finalized',
    });
    const blocks = encounterPrintBlocks(e);
    expect(blocks.map((b) => b.label)).toEqual(['O que foi feito', 'Orientações']);
    expect(JSON.stringify(blocks)).not.toContain('segredo da unidade');
    expect(encounterSignature(e)).toBe('Bia');
    expect(encounterSignature({ signedBy: '', finalizedBy: '' }, 'Equipe')).toBe('Equipe');
  });

  it('o 1:1 com o agendamento é por unidade e o resumo é legível', () => {
    const list = [encounter({ id: 'e1', bookingId: 'bk-1' }), encounter({ id: 'e2', businessId: OTHER, bookingId: 'bk-1' })];
    expect(encounterForBooking(list, BIZ, 'bk-1')?.id).toBe('e1');
    expect(encounterForBooking(list, BIZ, '')).toBeNull();
    expect(encounterSummary({ evolution: '', complaint: 'dor' })).toBe('dor');
    expect(encounterSummary({ evolution: '', complaint: '' })).toBe('Sem descrição');
    expect(encounterSummary({ evolution: 'a'.repeat(200), complaint: '' }).endsWith('…')).toBe(true);
    // Histórico do cliente: casamento por IDENTIDADE, não por nome.
    const forAna = encountersForCustomer(list, BIZ, { contactId: 'ct-1' });
    expect(forAna.map((x) => x.id)).toEqual(['e1']);
    expect(encountersForCustomer(list, BIZ, {})).toEqual([]);
    expect(ENCOUNTER_STATUS.finalized.tone).toBe('green');
  });
});

describe('A3.4 · Bloco 5 — registro pelas rotas reais', () => {
  async function createFor(bookingId: string, extra: Record<string, unknown> = {}, tk = token) {
    const res = await encountersPOST(jsonReq('/api/encounters', { businessId: BIZ, bookingId, ...extra }, tk));
    expect(res.status).toBe(200);
    return (await json(res)).encounter;
  }

  it('nasce rascunho a partir do agendamento, herdando cliente/serviço/profissional', async () => {
    const e = await createFor('bk-1');
    expect(e.status).toBe('draft');
    expect(e.customerName).toBe('Ana');
    expect(e.serviceId).toBe('svc-1');
    expect(e.professionalId).toBe('pro-1');
    expect(e.date).toBe('2026-09-19');
    expect(e.professionalName).toBe('Bia');
    const db = await readDB();
    expect(db.audit.some((a) => a.action === 'encounter.created' && a.meta?.encounterId === e.id)).toBe(true);
    // Nada foi escrito no agendamento: o registro é entidade própria.
    expect(db.bookings.find((b) => b.id === 'bk-1')!.note).toBe('');
  });

  it('não duplica: pedir de novo devolve o MESMO registro', async () => {
    const first = await createFor('bk-1', { evolution: 'feito' });
    const again = await encountersPOST(jsonReq('/api/encounters', { businessId: BIZ, bookingId: 'bk-1' }, token));
    const body = await json(again);
    expect(again.status).toBe(200);
    expect(body.reused).toBe(true);
    expect(body.encounter.id).toBe(first.id);
    const db = await readDB();
    expect(db.encounters.filter((e) => e.bookingId === 'bk-1')).toHaveLength(1);
  });

  it('a GET por agendamento devolve null quando não existe (a tela cria, não inventa)', async () => {
    const res = await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&bookingId=bk-2`, undefined, token, 'GET'));
    expect(res.status).toBe(200);
    expect((await json(res)).encounter).toBeNull();
  });

  it('salvar conteúdo, finalizar (assina) e depois editar exige reabrir', async () => {
    const e = await createFor('bk-1', { evolution: 'limpeza completa', guidance: 'evitar frios' });
    const fin = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'finalize' }, token, 'PATCH'));
    expect(fin.status).toBe(200);
    const finalized = (await json(fin)).encounter;
    expect(finalized.status).toBe('finalized');
    expect(finalized.signedBy).toBe('Bia');
    expect(finalized.finalizedAt).toBeTruthy();

    // Finalizado: dono (OWNER) reabre; e a edição direta já não é livre.
    const edit = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, evolution: 'outra coisa' }, token, 'PATCH'));
    expect(edit.status).toBe(200); // OWNER pode editar (reabre na prática)
    const reabrir = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'reopen' }, token, 'PATCH'));
    expect(reabrir.status).toBe(200);
    const db = await readDB();
    expect(db.audit.filter((a) => a.meta?.encounterId === e.id).map((a) => a.action))
      .toEqual(['encounter.created', 'encounter.finalized', 'encounter.updated', 'encounter.reopened']);
  });

  it('finalizar sem conteúdo responde 400 com a razão', async () => {
    const e = await createFor('bk-1');
    const res = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'finalize' }, token, 'PATCH'));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/o que foi feito/i);
  });

  it('profissional finaliza o PRÓPRIO registro; edição livre é recusada no dele', async () => {
    const e = await createFor('bk-1', { evolution: 'limpeza' });
    const profToken = await createSession(PROF_USER);
    // O profissional vê o dele na GET por agendamento…
    const get = await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&bookingId=bk-1`, undefined, profToken, 'GET'));
    expect((await json(get)).encounter?.id).toBe(e.id);
    // …e não vê o do colega.
    const outro = await createFor('bk-2');
    const getOutro = await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&bookingId=bk-2`, undefined, profToken, 'GET'));
    expect((await json(getOutro)).encounter).toBeNull();
    const editarOutro = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: outro.id, evolution: 'x' }, profToken, 'PATCH'));
    expect(editarOutro.status).toBe(403);
    // E finalizar o do colega também não passa.
    const fin = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: outro.id, action: 'finalize' }, profToken, 'PATCH'));
    expect(fin.status).toBe(403);
  });

  it('registro finalizado não é apagado por profissional, mas é por quem administra', async () => {
    const e = await createFor('bk-1', { evolution: 'limpeza' });
    await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'finalize' }, token, 'PATCH'));
    const profToken = await createSession(PROF_USER);
    const doProf = await encountersDELETE(jsonReq('/api/encounters', { businessId: BIZ, id: e.id }, profToken, 'DELETE'));
    expect(doProf.status).toBe(403);
    const doDono = await encountersDELETE(jsonReq('/api/encounters', { businessId: BIZ, id: e.id }, token, 'DELETE'));
    expect(doDono.status).toBe(200);
    const db = await readDB();
    expect(db.encounters.some((x) => x.id === e.id)).toBe(false);
    expect(db.audit.some((a) => a.action === 'encounter.removed' && a.meta?.wasFinalized === true)).toBe(true);
  });

  it('isolamento entre unidades: o agendamento de fora não abre registro aqui', async () => {
    const res = await encountersPOST(jsonReq('/api/encounters', { businessId: BIZ, bookingId: 'bk-outra' }, token));
    expect(res.status).toBe(404);
    const db = await readDB();
    expect(db.encounters).toHaveLength(0);
  });

  it('a lista por cliente casa por identidade (contato) — não por nome', async () => {
    const e = await createFor('bk-1', { evolution: 'limpeza' });
    const res = await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&contactId=ct-1`, undefined, token, 'GET'));
    const body = await json(res);
    expect(body.encounters.map((x: any) => x.id)).toEqual([e.id]);
    const semMatch = await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&contactId=nao-existe`, undefined, token, 'GET'));
    expect((await json(semMatch)).encounters).toHaveLength(0);
  });
});
