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
  ENCOUNTER_LIMITS, ENCOUNTER_STATUS, ENCOUNTER_VERSION_ERROR, canEditEncounter, canFinalize,
  cleanTags, cleanText, encounterForBooking, encounterInScope, encounterPrintBlocks,
  encounterSignature, encounterSummary, encounterVersion, encountersForCustomer, versionConflict,
} from '../encounters';
import type { Business, DB, Encounter } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-09-19T12:00:00.000Z';
const BIZ = 'biz-b5';
const OTHER = 'biz-b5-outra';
const OWNER = 'owner-b5';
const PROF_USER = 'user-prof-b5';
const ADMIN_USER = 'user-admin-b5';

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
  tags: [], status: 'draft', version: 1, createdAt: NOW, updatedAt: NOW, createdBy: OWNER, updatedBy: OWNER,
  finalizedAt: '', finalizedBy: '', signedBy: '', ...extra,
});

async function seed() {
  const db: DB = emptyDB();
  db.users.push({ id: OWNER, name: 'Dona Unidade', email: 'b5@example.com', passwordHash: 'x', createdAt: NOW, role: 'owner' });
  db.users.push({ id: PROF_USER, name: 'Dra. Bia', email: 'bia@example.com', passwordHash: 'x', createdAt: NOW, role: 'admin' });
  db.users.push({ id: ADMIN_USER, name: 'Gerente Caio', email: 'caio@example.com', passwordHash: 'x', createdAt: NOW, role: 'admin' });
  db.businesses.push(business(BIZ));
  db.businesses.push(business(OTHER));
  db.members.push({
    id: 'm-prof', businessId: BIZ, userId: PROF_USER, role: 'PROFISSIONAL', active: true,
    permissions: {}, createdAt: NOW, updatedAt: NOW,
  } as any);
  // ADMIN da unidade (não é o dono) — a revisão pediu a prova dos dois.
  db.members.push({
    id: 'm-admin', businessId: BIZ, userId: ADMIN_USER, role: 'ADMIN', active: true,
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

  it('rascunho é editável; finalizado só depois de reabrir', () => {
    expect(canEditEncounter({ status: 'draft' }, { canReopen: false })).toBe(true);
    // Quem administra pode REABRIR (é a porta auditada), mas enquanto o
    // registro está finalizado a edição de conteúdo continua fechada — a
    // prova de que isso vale no servidor está nos testes de rota abaixo.
    expect(canEditEncounter({ status: 'finalized' }, { canReopen: false })).toBe(false);
    expect(canEditEncounter({ status: 'finalized' }, { canReopen: true })).toBe(true);
  });

  it('revisão do registro: legado sem campo vale 1; a trava só age quando o chamador manda a versão', () => {
    expect(encounterVersion({ version: 3 })).toBe(3);
    expect(encounterVersion({})).toBe(1);
    expect(encounterVersion(null)).toBe(1);
    expect(encounterVersion({ version: 0 as number })).toBe(1);
    // Sem expectedVersion (script/legado) não há conflito inventado.
    expect(versionConflict({ version: 2 }, undefined)).toEqual({ conflict: false });
    expect(versionConflict({ version: 2 }, 2)).toEqual({ conflict: false });
    const stale = versionConflict({ version: 2 }, 1);
    expect(stale.conflict).toBe(true);
    expect(stale.conflict && stale.message).toBe(ENCOUNTER_VERSION_ERROR);
    expect(ENCOUNTER_VERSION_ERROR).toMatch(/atualizado em outra aba/i);
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

  it('finalizar assina o registro e cria a versão seguinte', async () => {
    const e = await createFor('bk-1', { evolution: 'limpeza completa', guidance: 'evitar frios' });
    expect(e.version).toBe(1);
    const fin = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'finalize' }, token, 'PATCH'));
    expect(fin.status).toBe(200);
    const finalized = (await json(fin)).encounter;
    expect(finalized.status).toBe('finalized');
    expect(finalized.signedBy).toBe('Bia');
    expect(finalized.finalizedAt).toBeTruthy();
    expect(finalized.version).toBe(2); // rascunho criado (1) → finalizado (2)
  });

  // ═══════════════════════════════════════════════════════════════════
  // REVISÃO B5 — item 1: FINALIZADO NÃO É EDITADO DIRETO. NUNCA. NEM DONO.
  // ═══════════════════════════════════════════════════════════════════
  it('doc/OWNER NÃO edita registro finalizado direto — só reabrindo', async () => {
    const e = await createFor('bk-1', { evolution: 'limpeza completa' });
    await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'finalize' }, token, 'PATCH'));

    const direto = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: BIZ, id: e.id, evolution: 'mudei por baixo', expectedVersion: e.version,
    }, token, 'PATCH'));
    expect(direto.status).toBe(409);
    expect((await json(direto)).error).toMatch(/finalizado não é editado direto/i);

    // Nada mudou no banco: nem texto, nem versão, nem auditoria de edição.
    let db = await readDB();
    let row = db.encounters.find((x) => x.id === e.id)!;
    expect(row.evolution).toBe('limpeza completa');
    expect(row.version).toBe(2);
    expect(db.audit.filter((a) => a.meta?.encounterId === e.id).map((a) => a.action))
      .toEqual(['encounter.created', 'encounter.finalized']);

    // A porta certa: reabrir (auditado) e SÓ ENTÃO editar.
    const reabrir = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'reopen' }, token, 'PATCH'));
    expect(reabrir.status).toBe(200);
    const depois = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, evolution: 'agora sim' }, token, 'PATCH'));
    expect(depois.status).toBe(200);
    expect((await json(depois)).encounter.evolution).toBe('agora sim');

    db = await readDB();
    row = db.encounters.find((x) => x.id === e.id)!;
    expect(row.status).toBe('draft');
    expect(row.version).toBe(4); // criado(1) → finalizado(2) → reaberto(3) → editado(4)
    expect(db.audit.filter((a) => a.meta?.encounterId === e.id).map((a) => a.action))
      .toEqual(['encounter.created', 'encounter.finalized', 'encounter.reopened', 'encounter.updated']);
  });

  it('ADMIN da unidade também NÃO edita finalizado direto', async () => {
    const e = await createFor('bk-1', { evolution: 'limpeza' });
    await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'finalize' }, token, 'PATCH'));
    const adminToken = await createSession(ADMIN_USER);
    // O admin VÊ o registro (tem a permissão por padrão)…
    const get = await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&bookingId=bk-1`, undefined, adminToken, 'GET'));
    expect((await json(get)).encounter?.id).toBe(e.id);
    // …e ainda assim a edição direta é recusada. Precisa reabrir.
    const direto = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, guidance: 'x' }, adminToken, 'PATCH'));
    expect(direto.status).toBe(409);
    const reabre = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'reopen' }, adminToken, 'PATCH'));
    expect(reabre.status).toBe(200);
    const edita = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, guidance: 'x' }, adminToken, 'PATCH'));
    expect(edita.status).toBe(200);
  });

  it('PROFISSIONAL também NÃO edita finalizado direto (nem o próprio)', async () => {
    const e = await createFor('bk-1', { evolution: 'limpeza' });
    await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'finalize' }, token, 'PATCH'));
    const profToken = await createSession(PROF_USER);
    const direto = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, evolution: 'x' }, profToken, 'PATCH'));
    expect([403, 409]).toContain(direto.status);
    // E reabrir não é para ele — quem administra é que reabre.
    const reabre = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'reopen' }, profToken, 'PATCH'));
    expect(reabre.status).toBe(403);
    const db = await readDB();
    expect(db.encounters.find((x) => x.id === e.id)!.evolution).toBe('limpeza');
    expect(db.encounters.find((x) => x.id === e.id)!.status).toBe('finalized');
  });

  // ═══════════════════════════════════════════════════════════════════
  // REVISÃO B5 — item 2: CONCORRÊNCIA OTIMISTA (duas abas)
  // ═══════════════════════════════════════════════════════════════════
  it('duas abas: a segunda com versão velha recebe 409 e NÃO sobrescreve', async () => {
    const e = await createFor('bk-1', { evolution: 'v1' });
    // Aba A salvou primeiro (versão 1 → 2).
    const abaA = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: BIZ, id: e.id, evolution: 'texto da aba A', expectedVersion: 1,
    }, token, 'PATCH'));
    expect(abaA.status).toBe(200);
    expect((await json(abaA)).encounter.version).toBe(2);

    // Aba B ainda acha que está na 1: recusa EXPLÍCITA, com recado claro.
    const abaB = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: BIZ, id: e.id, evolution: 'texto da aba B', expectedVersion: 1,
    }, token, 'PATCH'));
    expect(abaB.status).toBe(409);
    expect((await json(abaB)).error).toBe(ENCOUNTER_VERSION_ERROR);

    const db = await readDB();
    const row = db.encounters.find((x) => x.id === e.id)!;
    expect(row.evolution).toBe('texto da aba A'); // nada de overwrite silencioso
    expect(row.version).toBe(2);

    // Recarregando (versão 2), a aba B consegue salvar o que ela quer.
    const abaB2 = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: BIZ, id: e.id, evolution: 'texto da aba B', expectedVersion: 2,
    }, token, 'PATCH'));
    expect(abaB2.status).toBe(200);
    expect((await json(abaB2)).encounter.version).toBe(3);
  });

  it('finalizar e reabrir também respeitam expectedVersion', async () => {
    const e = await createFor('bk-1', { evolution: 'limpeza' });
    // Primeiro salva (1 → 2); quem ainda manda versão 1 é recusado já no finalize.
    await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, evolution: 'limpeza feita' }, token, 'PATCH'));
    const finVelho = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'finalize', expectedVersion: 1 }, token, 'PATCH'));
    expect(finVelho.status).toBe(409);
    const finOk = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'finalize', expectedVersion: 2 }, token, 'PATCH'));
    expect(finOk.status).toBe(200);
    const reopenVelho = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'reopen', expectedVersion: 1 }, token, 'PATCH'));
    expect(reopenVelho.status).toBe(409);
    const reopenOk = await encountersPATCH(jsonReq('/api/encounters', { businessId: BIZ, id: e.id, action: 'reopen', expectedVersion: 3 }, token, 'PATCH'));
    expect(reopenOk.status).toBe(200);
    expect((await json(reopenOk)).encounter.version).toBe(4);
  });

  it('salvar sem mudança não cria versão nova (o autosave bate aqui e precisa ser barato)', async () => {
    const e = await createFor('bk-1', { evolution: 'limpeza' });
    const igual = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: BIZ, id: e.id, evolution: 'limpeza', expectedVersion: 1,
    }, token, 'PATCH'));
    expect(igual.status).toBe(200);
    expect((await json(igual)).encounter.version).toBe(1);
    const db = await readDB();
    expect(db.audit.filter((a) => a.meta?.encounterId === e.id).map((a) => a.action)).toEqual(['encounter.created']);
  });

  it('registro sem `version` (legado) vale 1 — a primeira trava não dá 409 falso', async () => {
    const e = await createFor('bk-1', { evolution: 'limpeza' });
    // Simula um documento antigo: o campo não existia antes desta revisão.
    const db = await readDB();
    delete (db.encounters.find((x) => x.id === e.id) as any).version;
    await writeDB(db);
    const res = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: BIZ, id: e.id, evolution: 'agora com versão', expectedVersion: 1,
    }, token, 'PATCH'));
    expect(res.status).toBe(200);
    expect((await json(res)).encounter.version).toBe(2);
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

  it('a fila vira atendimento SEM agendamento: bookingId fica vazio e NADA de Booking falso', async () => {
    const db0 = await readDB();
    db0.queue.push({
      id: 'q-1', businessId: BIZ, customerName: 'Chegou sem hora', customerPhone: '11955554444',
      contactId: 'ct-1', serviceId: 'svc-1', professionalId: 'pro-1', bookingId: '', note: '',
      status: 'in_service', date: '2026-09-19', createdAt: '2026-09-19T11:40:00.000Z',
      calledAt: '', startedAt: '2026-09-19T11:52:00.000Z', endedAt: '', updatedBy: OWNER, updatedAt: NOW,
    } as any);
    await writeDB(db0);

    const res = await encountersPOST(jsonReq('/api/encounters', {
      businessId: BIZ, queueId: 'q-1',
    }, token));
    expect(res.status).toBe(200);
    const e = (await json(res)).encounter;
    expect(e.bookingId).toBe('');                       // sem inventar agendamento
    expect(e.contactId).toBe('ct-1');                   // veio da entrada da fila
    expect(e.customerName).toBe('Chegou sem hora');
    expect(e.serviceId).toBe('svc-1');
    expect(e.professionalId).toBe('pro-1');
    expect(e.date).toBe('2026-09-19');
    // Sem horário de agenda: o registro usa a CHEGADA/INÍCIO real (11:52Z = 08:52 em SP).
    expect(e.time).toBe('08:52');

    const db = await readDB();
    expect(db.bookings.filter((b) => b.customerName === 'Chegou sem hora')).toHaveLength(0);
    expect(db.audit.some((a) => a.action === 'encounter.created' && a.meta?.queueId === 'q-1')).toBe(true);
  });

  it('entrada de fila de OUTRA unidade não abre registro aqui', async () => {
    const db0 = await readDB();
    db0.queue.push({
      id: 'q-outra', businessId: OTHER, customerName: 'De fora', customerPhone: '', contactId: '',
      serviceId: '', professionalId: '', bookingId: '', note: '', status: 'in_service',
      date: '2026-09-19', createdAt: NOW, calledAt: '', startedAt: NOW, endedAt: '', updatedBy: '', updatedAt: NOW,
    } as any);
    await writeDB(db0);
    const res = await encountersPOST(jsonReq('/api/encounters', { businessId: BIZ, queueId: 'q-outra' }, token));
    expect(res.status).toBe(404);
    expect((await readDB()).encounters).toHaveLength(0);
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
