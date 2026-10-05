// ═══════════════════════════════════════════════════════════════
// CLINICAL ENCOUNTER F1A — INICIAR / RETOMAR / WORKSPACE
// ═══════════════════════════════════════════════════════════════
// Travas desta fatia (cada teste existe porque um bug real é possível):
//   A. um Booking NÃO cria dois atendimentos ativos;
//   B. iniciar um atendimento que já existe ABRE o existente;
//   C. acesso por ID valida businessId no servidor;
//   D. IDs enviados pelo cliente NÃO concedem acesso;
//   E. Professional/Pet/Booking precisam ser do mesmo tenant;
//   F. finalizado NÃO volta para in_progress por start/resume;
//   I. nenhuma busca depende de primeiro item de array.
import './helpers/temp-db';

import fs from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { GET as encountersGET, PATCH as encountersPATCH } from '@/app/api/encounters/route';
import { POST as startPOST } from '@/app/api/encounters/start/route';
import { encounterVersion } from '../encounters';
import { availableEncounterSections, resolveEncounterSection, ENCOUNTER_SECTIONS } from '../encounter-sections';
import {
  ENCOUNTER_CLINICAL_STATE, ENCOUNTER_PROFESSIONAL_REQUIRED_ERROR, encounterClinicalState,
  encounterIsInProgress, encounterPatientId, encounterResponsibleId,
} from '../encounters';
import { PROFESSIONAL_NOT_ELIGIBLE_ERROR } from '../booking';
import type { Business, BusinessMember, DB, Encounter, Professional, Service } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-10-03T12:00:00.000Z';
const BIZ = 'f1a-clinica';
const OTHER = 'f1a-outra-clinica';
const OWNER = 'f1a-owner';
const PROF_A = 'f1a-prof-a';       // Michelle — profissional do tenant
const PROF_B = 'f1a-prof-b';       // outro profissional do mesmo tenant
const PROF_OTHER_TENANT = 'f1a-prof-outra';
const RECEPCAO = 'f1a-recepcao';

function business(id: string, ownerId = OWNER): Business {
  return {
    id, ownerId, organizationId: `org-${id}`, name: `Clínica ${id}`, slug: id,
    description: '', logo: '', cover: '', niche: 'pet', clinicType: 'veterinaria',
    modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false },
    phone: '', whatsapp: '', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0,
    googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'auto', leadMin: 0, cancelUntilMin: 0, horizonDays: 60, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: false, createdAt: NOW, updatedAt: NOW, businessTimezone: 'America/Sao_Paulo',
  } as Business;
}

/** Agendamento já com CHECK-IN (etapa `arrived`) — gate do workflow. */
function booking(id: string, businessId: string, extra: Partial<DB['bookings'][number]> = {}) {
  return {
    id, businessId, customerId: '', serviceId: 'svc-derma', professionalId: 'pro-a',
    date: '2026-10-03', time: '14:00', customerName: 'Isabelle Tutora', customerPhone: '11999990001',
    status: 'confirmed', checkedInAt: NOW, note: '', answers: [], createdAt: NOW, updatedAt: NOW,
    history: [], petId: 'pet-mel', petName: 'Mel', ...extra,
  } as DB['bookings'][number];
}

async function seed() {
  const db: DB = emptyDB();
  db.users.push(
    { id: OWNER, name: 'Dono', email: 'dono@f1a.test', passwordHash: 'x', createdAt: NOW, role: 'owner' },
    { id: PROF_A, name: 'Michelle', email: 'michelle@f1a.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
    { id: PROF_B, name: 'Outra Profissional', email: 'outra@f1a.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
    { id: PROF_OTHER_TENANT, name: 'Profissional de fora', email: 'fora@f1a.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
    { id: RECEPCAO, name: 'Recepção', email: 'recepcao@f1a.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
  );
  db.businesses.push(business(BIZ), business(OTHER));
  const member = (id: string, businessId: string, userId: string, role: string) => ({
    id, businessId, userId, role, permissions: {}, note: '', invitedBy: OWNER, active: true,
    createdAt: NOW, updatedAt: NOW,
  } as BusinessMember);
  db.members.push(
    member('m-prof-a', BIZ, PROF_A, 'PROFISSIONAL'),
    member('m-prof-b', BIZ, PROF_B, 'PROFISSIONAL'),
    // Recepção: enxerga a Agenda, NÃO ganha escrita clínica.
    member('m-recepcao', BIZ, RECEPCAO, 'SECRETARIA'),
    member('m-outra', OTHER, PROF_OTHER_TENANT, 'PROFISSIONAL'),
  );
  const pro = (id: string, businessId: string, name: string, userId: string, role = '') => ({
    id, businessId, name, role, photo: '', active: true, userId, followBusinessHours: true,
  } as Professional);
  db.professionals.push(
    pro('pro-a', BIZ, 'Michelle', PROF_A, 'Médica veterinária'),
    pro('pro-b', BIZ, 'Outra Profissional', PROF_B),
    pro('pro-outra', OTHER, 'Profissional de fora', PROF_OTHER_TENANT),
  );
  db.services.push({
    id: 'svc-derma', businessId: BIZ, name: 'Consulta dermatológica', durationMin: 30, price: 12000,
    description: '', active: true, bookable: true, professionalIds: [],
    categoryId: '', image: '', featured: false, questions: [],
  } as Service);
  // Serviço restrito: SÓ a pro-b atende (régua revalidada no start).
  db.services.push({
    id: 'svc-cirurgia', businessId: BIZ, name: 'Cirurgia', durationMin: 60, price: 50000,
    description: '', active: true, bookable: true, professionalIds: ['pro-b'],
    categoryId: '', image: '', featured: false, questions: [],
  } as Service);
  db.contacts.push(
    { id: 'ct-tutor', businessId: BIZ, customerId: '', name: 'Isabelle Tutora', phone: '11999990001', email: '', createdAt: NOW, updatedAt: NOW, source: 'manual', lastInteraction: NOW, marketingOptIn: true },
  );
  db.pets.push(
    { id: 'pet-mel', businessId: BIZ, tutorId: 'ct-tutor', name: 'Mel', photo: '', species: 'canina', breed: 'SRD', sex: 'F', birthDate: '2024-01-01', weightKg: 8, notes: '', active: true, createdAt: NOW, updatedAt: NOW },
    // Pet de OUTRA unidade (cross-tenant):
    { id: 'pet-outra', businessId: OTHER, tutorId: '', name: 'Pet de fora', photo: '', species: 'felina', breed: '', sex: '', birthDate: '', weightKg: 0, notes: '', active: true, createdAt: NOW, updatedAt: NOW },
  );
  db.bookings.push(
    booking('bk-mel', BIZ),
    booking('bk-sem-checkin', BIZ, { checkedInAt: undefined }),
    booking('bk-outra-prof', BIZ, { professionalId: 'pro-b' }),
    booking('bk-pet-outra-unidade', BIZ, { petId: 'pet-outra', petName: 'Pet de fora' }),
    booking('bk-prof-outra-unidade', BIZ, { professionalId: 'pro-outra' }),
    booking('bk-sem-pet', BIZ, { petId: '', petName: '' }),
    // Sem PROFISSIONAL na origem: quem inicia precisa resolver um responsável.
    booking('bk-sem-prof', BIZ, { professionalId: '' }),
    booking('bk-cirurgia-sem-prof', BIZ, { professionalId: '', serviceId: 'svc-cirurgia' }),
    { ...booking('bk-outra-unidade', OTHER, { petId: '', petName: '' }), } as DB['bookings'][number],
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

let ownerToken = '';
let profToken = '';
let profBToken = '';
let recepcaoToken = '';
let otherTenantToken = '';

beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  ownerToken = await createSession(OWNER);
  profToken = await createSession(PROF_A);
  profBToken = await createSession(PROF_B);
  recepcaoToken = await createSession(RECEPCAO);
  otherTenantToken = await createSession(PROF_OTHER_TENANT);
});

/** start or resume pelo endpoint canônico. */
async function start(body: Record<string, unknown>, token = ownerToken) {
  const res = await startPOST(jsonReq('/api/encounters/start', body, token));
  return { res, body: await json(res) };
}
async function getById(id: string, businessId = BIZ, token = ownerToken) {
  const res = await encountersGET(jsonReq(`/api/encounters?businessId=${encodeURIComponent(businessId)}&id=${encodeURIComponent(id)}`, undefined, token, 'GET'));
  return { res, body: await json(res) };
}

// ═══════════════════════════════════════════════════════════════
// 1 · CONTRATO CANÔNICO (puro)
// ═══════════════════════════════════════════════════════════════
describe('F1A · contrato canônico do Encounter (puro)', () => {
  it('convergência de estados: registro existente = em atendimento; ausente = não iniciado', () => {
    expect(encounterClinicalState(null)).toBe('not_started');
    expect(encounterClinicalState({ status: 'draft' })).toBe('in_progress');
    expect(encounterClinicalState({ status: 'finalized' })).toBe('finalized');
    expect(encounterIsInProgress({ status: 'draft' })).toBe(true);
    expect(encounterIsInProgress({ status: 'finalized' })).toBe(false);
    expect(ENCOUNTER_CLINICAL_STATE.in_progress.label).toBe('Em atendimento');
    expect(ENCOUNTER_CLINICAL_STATE.not_started.label).toBe('Não iniciado');
    expect(ENCOUNTER_CLINICAL_STATE.finalized.label).toBe('Finalizado');
  });

  it('paciente e responsável são vínculos de ID — nunca nome/e-mail', () => {
    const e = { petId: 'pet-1', contactId: 'ct-1', customerId: '' } as Encounter;
    expect(encounterPatientId(e)).toBe('pet-1');
    expect(encounterResponsibleId(e)).toBe('ct-1');
    expect(encounterPatientId({ petId: '' })).toBe('');
    expect(encounterResponsibleId({ contactId: '', customerId: 'cus-1' })).toBe('cus-1');
  });

  it('a estrutura de seções existe, mas só o que é REAL é renderizado', () => {
    expect(ENCOUNTER_SECTIONS.length).toBeGreaterThan(1); // estrutura preparada p/ F1B
    // F1B1 — as seções reais eram três; o F1B2 acrescentou problemas, conduta e
    // procedimentos, sempre SÓ na vertical que liga o módulo (veterinária).
    // Seção entra aqui quando tem UI + persistência + leitura + autosave +
    // permissões + testes NA MESMA entrega; o resto segue fora.
    const live = availableEncounterSections('veterinaria');
    expect(live.map((s) => s.id)).toEqual([
      'atendimento', 'anamnese', 'avaliacao', 'problemas', 'conduta', 'procedimentos',
    ]);
    // Isolamento por vertical: sem clínica veterinária, só o CORE.
    expect(availableEncounterSections('odontologica').map((s) => s.id)).toEqual(['atendimento']);
    expect(availableEncounterSections(undefined).map((s) => s.id)).toEqual(['atendimento']);
    // O que continua PLANEJADO não é órfão: pedir uma indisponível cai na real.
    expect(resolveEncounterSection('anexos', 'veterinaria').id).toBe('atendimento');
    expect(resolveEncounterSection(null, 'veterinaria').id).toBe('atendimento');
    expect(resolveEncounterSection('atendimento').id).toBe('atendimento');
    expect(resolveEncounterSection('avaliacao', 'odontologica').id).toBe('atendimento');
  });
});

// ═══════════════════════════════════════════════════════════════
// 2 · START OR RESUME (rotas reais)
// ═══════════════════════════════════════════════════════════════
describe('F1A · startOrResumeEncounter', () => {
  it('INICIA: cria o atendimento com paciente, tutor, serviço e profissional do tenant', async () => {
    const { res, body } = await start({ businessId: BIZ, bookingId: 'bk-mel' });
    expect(res.status).toBe(200);
    expect(body.created).toBe(true);
    expect(body.outcome).toBe('created');
    const e = body.encounter;
    expect(e.businessId).toBe(BIZ);
    expect(e.bookingId).toBe('bk-mel');
    expect(e.petId).toBe('pet-mel');           // paciente = pet (protagonista)
    expect(e.professionalId).toBe('pro-a');    // profissional do agendamento
    expect(e.serviceId).toBe('svc-derma');
    expect(e.status).toBe('draft');            // persistido = EM ATENDIMENTO
    expect(String(e.startedAt)).toBeTruthy();  // início clínico canônico
    // Contexto resolvido no servidor (nada de montar cabeçalho no cliente).
    expect(e.context.clinicalState).toBe('in_progress');
    expect(e.context.patient.name).toBe('Mel');
    expect(e.context.responsible.name).toBe('Isabelle Tutora');
    expect(e.context.service.name).toBe('Consulta dermatológica');
    expect(e.context.professional.name).toBe('Michelle');
    expect(e.context.booking.id).toBe('bk-mel');
    // Auditoria: uma criação, com autor.
    const db = await readDB();
    expect(db.audit.filter((a) => a.action === 'encounter.created' && a.meta?.encounterId === e.id)).toHaveLength(1);
  });

  it('RETOMA: repetir o start devolve o MESMO encounterId (não duplica)', async () => {
    const first = await start({ businessId: BIZ, bookingId: 'bk-mel' });
    const again = await start({ businessId: BIZ, bookingId: 'bk-mel' });
    expect(again.res.status).toBe(200);
    expect(again.body.created).toBe(false);
    expect(again.body.outcome).toBe('resumed');
    expect(again.body.encounterId).toBe(first.body.encounterId);
    const db = await readDB();
    expect(db.encounters.filter((e) => e.bookingId === 'bk-mel')).toHaveLength(1);
    expect(db.audit.filter((a) => a.action === 'encounter.created')).toHaveLength(1);
  });

  it('IDEMPOTENTE SOB CONCORRÊNCIA: duas chamadas simultâneas criam UM atendimento', async () => {
    const [a, b] = await Promise.all([
      start({ businessId: BIZ, bookingId: 'bk-mel' }),
      start({ businessId: BIZ, bookingId: 'bk-mel' }),
    ]);
    expect(a.res.status).toBe(200);
    expect(b.res.status).toBe(200);
    expect(a.body.encounterId).toBe(b.body.encounterId);
    const db = await readDB();
    expect(db.encounters.filter((e) => e.bookingId === 'bk-mel')).toHaveLength(1);
    // Exatamente uma criação auditada (a outra só retomou).
    expect(db.audit.filter((x) => x.action === 'encounter.created')).toHaveLength(1);
  });

  it('FINALIZADO NÃO VOLTA A FICAR EM ATENDIMENTO (F1A não reabre)', async () => {
    // O conteúdo mínimo entra na criação: finalizar não reescreve texto.
    const created = await start({
      businessId: BIZ, bookingId: 'bk-mel',
      evolution: 'Conduta realizada e orientações entregues.',
    });
    const id = created.body.encounterId;
    const fin = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: BIZ, id, action: 'finalize', expectedVersion: encounterVersion(created.body.encounter),
    }, ownerToken, 'PATCH'));
    expect(fin.status).toBe(200);
    const after = await start({ businessId: BIZ, bookingId: 'bk-mel' });
    expect(after.res.status).toBe(200);
    expect(after.body.created).toBe(false);
    expect(after.body.outcome).toBe('reused_finalized');
    expect(after.body.encounterId).toBe(id);
    expect(after.body.encounter.status).toBe('finalized');
    expect(after.body.encounter.context.clinicalState).toBe('finalized');
    const db = await readDB();
    expect(db.encounters.filter((e) => e.bookingId === 'bk-mel')).toHaveLength(1);
  });

  it('a etapa operacional manda: sem check-in NÃO inicia atendimento', async () => {
    const { res, body } = await start({ businessId: BIZ, bookingId: 'bk-sem-checkin' });
    expect(res.status).toBe(409);
    expect(body.error).toBeTruthy();
    expect(await readDB().then((d) => d.encounters.length)).toBe(0);
  });

  it('sem origem (nem agendamento nem fila) é recusado', async () => {
    const { res } = await start({ businessId: BIZ });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3 · TENANT / ESCOPO / PERMISSÕES
// ═══════════════════════════════════════════════════════════════
describe('F1A · isolamento multi-tenant e permissões', () => {
  it('tenant A não cria atendimento para agendamento do tenant B', async () => {
    const { res } = await start({ businessId: BIZ, bookingId: 'bk-outra-unidade' });
    expect(res.status).toBe(404);
    expect((await readDB()).encounters.length).toBe(0);
  });

  it('URL direta de outro tenant não lê o atendimento (404, nunca 200)', async () => {
    const created = await start({ businessId: BIZ, bookingId: 'bk-mel' });
    const id = created.body.encounterId;
    const leak = await getById(id, OTHER, ownerToken);
    expect(leak.res.status).toBe(404);
    expect(leak.body.error).toBeTruthy();
    expect(leak.body.encounter).toBeUndefined();
    // O dono do tenant B realmente não enxerga: a leitura é por tenant.
    const mine = await getById(id, BIZ, ownerToken);
    expect(mine.res.status).toBe(200);
    expect(mine.body.encounter.id).toBe(id);
  });

  it('paciente de OUTRO tenant é rejeitado (booking apontando pet de fora)', async () => {
    const { res } = await start({ businessId: BIZ, bookingId: 'bk-pet-outra-unidade' });
    expect(res.status).toBe(409);
    expect((await readDB()).encounters.length).toBe(0);
  });

  it('profissional de OUTRO tenant é rejeitado', async () => {
    const { res } = await start({ businessId: BIZ, bookingId: 'bk-prof-outra-unidade' });
    expect(res.status).toBe(409);
    expect((await readDB()).encounters.length).toBe(0);
  });

  it('ID de pet enviado PELO CLIENTE não concede vínculo cross-tenant', async () => {
    // (a) booking SEM pet: pet de outra unidade não vira paciente deste
    //     atendimento (404 — não existe nesta clínica).
    const stranger = await start({ businessId: BIZ, bookingId: 'bk-sem-pet', petId: 'pet-outra' });
    expect(stranger.res.status).toBe(404);
    expect((await readDB()).encounters.length).toBe(0);
    // (b) booking COM pet: o PACIENTE do agendamento é autoritativo — o id
    //     mandado pelo cliente é ignorado, nunca sobrescreve.
    const authoritative = await start({ businessId: BIZ, bookingId: 'bk-mel', petId: 'pet-outra' });
    expect(authoritative.res.status).toBe(200);
    expect(authoritative.body.encounter.petId).toBe('pet-mel');
    expect(authoritative.body.encounter.context.patient.id).toBe('pet-mel');
  });

  it('ID de profissional enviado PELO CLIENTE não concede vínculo cross-tenant', async () => {
    // (a) agendamento COM profissional: o PROFISSIONAL DO AGENDAMENTO é
    //     autoritativo — o id mandado pelo cliente é ignorado, nunca sobrescreve.
    const authoritative = await start({ businessId: BIZ, bookingId: 'bk-mel', professionalId: 'pro-outra' });
    expect(authoritative.res.status).toBe(200);
    expect(authoritative.body.encounter.professionalId).toBe('pro-a');
    expect(authoritative.body.encounter.context.professional.id).toBe('pro-a');
    // (b) agendamento SEM profissional: o id de OUTRA unidade não vira
    //     responsável deste atendimento (409 — não existe nesta clínica).
    const stranger = await start({ businessId: BIZ, bookingId: 'bk-sem-prof', professionalId: 'pro-outra' });
    expect(stranger.res.status).toBe(409);
    expect((await readDB()).encounters.length).toBe(1);   // só o de (a)
  });

  it('Recepção (SECRETARIA) NÃO inicia nem lê atendimento clínico', async () => {
    const started = await start({ businessId: BIZ, bookingId: 'bk-mel' }, recepcaoToken);
    expect(started.res.status).toBe(403);
    const created = await start({ businessId: BIZ, bookingId: 'bk-mel' });
    const read = await getById(created.body.encounterId, BIZ, recepcaoToken);
    expect(read.res.status).toBe(403);
  });

  it('usuário de outro tenant não inicia atendimento nem lê por id', async () => {
    const created = await start({ businessId: BIZ, bookingId: 'bk-mel' });
    const started = await start({ businessId: BIZ, bookingId: 'bk-mel' }, otherTenantToken);
    expect(started.res.status).toBe(403);
    const read = await getById(created.body.encounterId, BIZ, otherTenantToken);
    expect(read.res.status).toBe(403);
  });

  it('profissional só atende o que é dele: booking de outro profissional é recusado', async () => {
    const mine = await start({ businessId: BIZ, bookingId: 'bk-mel' }, profToken);
    expect(mine.res.status).toBe(200);
    // O vínculo é por PROFISSIONAL, nunca por e-mail/nome: pro-b tentando
    // assumir o atendimento da Michelle não passa.
    const theirs = await start({ businessId: BIZ, bookingId: 'bk-mel' }, profBToken);
    expect(theirs.res.status).toBe(403);
    const read = await getById(mine.body.encounterId, BIZ, profBToken);
    expect(read.res.status).toBe(403);
    // E o profissional dono do agendamento lê normalmente.
    const own = await getById(mine.body.encounterId, BIZ, profToken);
    expect(own.res.status).toBe(200);
    expect(own.body.encounter.professionalId).toBe('pro-a');
  });

  it('profissional inicia o PRÓPRIO atendimento (escopo não bloqueia quem atende)', async () => {
    const { res, body } = await start({ businessId: BIZ, bookingId: 'bk-mel' }, profToken);
    expect(res.status).toBe(200);
    expect(body.encounter.professionalId).toBe('pro-a');
    expect(body.encounter.createdBy).toBe(PROF_A);
  });

  it('Owner/Admin com permissão clínica inicia e lê (escopo amplo, sem virar profissional)', async () => {
    const { res, body } = await start({ businessId: BIZ, bookingId: 'bk-mel' });
    expect(res.status).toBe(200);
    // Não inventa identidade profissional: assume a do agendamento.
    expect(body.encounter.professionalId).toBe('pro-a');
    expect(body.encounter.createdBy).toBe(OWNER);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3.1 · PROFISSIONAL RESPONSÁVEL É OBRIGATÓRIO (invariante clínica)
// ═══════════════════════════════════════════════════════════════
// Um atendimento clínico sem profissional responsável não é um atendimento:
// o registro NÃO nasce órfão e nenhum profissional é fabricado (nada de
// "primeiro da lista", User, BusinessMember ou e-mail como identidade).
describe('F1A · profissional responsável (obrigatório e nunca fabricado)', () => {
  it('Owner + agendamento COM profissional: inicia sem virar profissional', async () => {
    const { res, body } = await start({ businessId: BIZ, bookingId: 'bk-mel' });
    expect(res.status).toBe(200);
    expect(body.encounter.professionalId).toBe('pro-a');   // o da agenda
    expect(body.encounter.createdBy).toBe(OWNER);          // o ator continua sendo o dono
  });

  it('Owner + agendamento SEM profissional: RECUSA e não cria nada', async () => {
    const { res, body } = await start({ businessId: BIZ, bookingId: 'bk-sem-prof' });
    expect(res.status).toBe(409);
    expect(body.error).toBe(ENCOUNTER_PROFESSIONAL_REQUIRED_ERROR);
    const db = await readDB();
    expect(db.encounters.length).toBe(0);
    expect(db.audit.filter((a) => a.action === 'encounter.created')).toHaveLength(0);
    expect(db.bookings.find((b) => b.id === 'bk-sem-prof')!.professionalId).toBe('');
  });

  it('Professional + agendamento dele: inicia (vínculo real)', async () => {
    const { res, body } = await start({ businessId: BIZ, bookingId: 'bk-mel' }, profToken);
    expect(res.status).toBe(200);
    expect(body.encounter.professionalId).toBe('pro-a');
  });

  it('Professional + agendamento SEM profissional: resolve para o PRÓPRIO profissional', async () => {
    const { res, body } = await start({ businessId: BIZ, bookingId: 'bk-sem-prof' }, profToken);
    expect(res.status).toBe(200);
    expect(body.created).toBe(true);
    expect(body.encounter.professionalId).toBe('pro-a');   // escopo real do ator
    expect(body.encounter.createdBy).toBe(PROF_A);
  });

  it('Professional INELEGÍVEL para o serviço: recusa (e nada é criado)', async () => {
    // Cirurgia só é atendida pela pro-b: o escopo da pro-a não assume.
    const { res, body } = await start({ businessId: BIZ, bookingId: 'bk-cirurgia-sem-prof' }, profToken);
    expect(res.status).toBe(403);
    expect(body.error).toBe(PROFESSIONAL_NOT_ELIGIBLE_ERROR);
    expect((await readDB()).encounters.length).toBe(0);
    // Quem PODE, inicia — e o registro fica com ela.
    const ok = await start({ businessId: BIZ, bookingId: 'bk-cirurgia-sem-prof' }, profBToken);
    expect(ok.res.status).toBe(200);
    expect(ok.body.encounter.professionalId).toBe('pro-b');
  });

  it('Professional de OUTRO tenant: recusa (nunca vira responsável)', async () => {
    const { res } = await start({ businessId: BIZ, bookingId: 'bk-prof-outra-unidade' });
    expect(res.status).toBe(409);
    const stranger = await start({ businessId: BIZ, bookingId: 'bk-sem-prof', professionalId: 'pro-outra' });
    expect(stranger.res.status).toBe(409);
    expect((await readDB()).encounters.length).toBe(0);
  });

  it('start RECUSADO não deixa atendimento parcial (nenhuma escrita)', async () => {
    // Cada recusa abaixo é anterior à criação: o documento não é tocado.
    for (const body of [
      { businessId: BIZ, bookingId: 'bk-sem-prof' },                                 // sem profissional
      { businessId: BIZ, bookingId: 'bk-cirurgia-sem-prof', professionalId: 'pro-outra' }, // fora do tenant
    ]) {
      const { res } = await start(body);
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    const db = await readDB();
    expect(db.encounters.length).toBe(0);
    expect(db.audit.filter((a) => a.action === 'encounter.created')).toHaveLength(0);
  });

  it('nenhum caminho de criação fabrica profissional (nem "primeiro da lista")', async () => {
    const created = await start({ businessId: BIZ, bookingId: 'bk-mel' });
    const resumed = await start({ businessId: BIZ, bookingId: 'bk-mel' });
    const db = await readDB();
    expect(db.encounters).toHaveLength(1);
    for (const e of db.encounters) {
      expect(e.professionalId).toBe('pro-a');
      expect(db.professionals.some((p) => p.id === e.professionalId && p.businessId === e.businessId)).toBe(true);
    }
    expect(created.body.encounterId).toBe(resumed.body.encounterId);
    // A regra é estrutural: nenhum fallback por lista/e-mail/usuário no domínio.
    const src = fs.readFileSync('src/lib/encounter-start.ts', 'utf8');
    expect(src).not.toMatch(/professionals\[0\]/);
    expect(src).not.toMatch(/\(\s*d\.professionals\s*\|\|\s*\[\]\s*\)\s*\[0\]/);
    expect(src).not.toMatch(/actor\.email/);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4 · WORKSPACE: F5, volta e retomada caem no MESMO registro
// ═══════════════════════════════════════════════════════════════
describe('F1A · workspace persistente (ler por id é a mesma entidade)', () => {
  it('start → sair → GET pelo id → start de novo: SEMPRE o mesmo encounterId', async () => {
    const first = await start({ businessId: BIZ, bookingId: 'bk-mel' });
    const id = first.body.encounterId;
    // "F5" na rota canônica: leitura pura por id.
    const reloaded = await getById(id);
    expect(reloaded.res.status).toBe(200);
    expect(reloaded.body.encounter.id).toBe(id);
    expect(reloaded.body.encounter.startedAt).toBe(first.body.encounter.startedAt);
    // "Retomar atendimento" pela Agenda: a mesma operação, o mesmo registro.
    const resumed = await start({ businessId: BIZ, bookingId: 'bk-mel' });
    expect(resumed.body.encounterId).toBe(id);
    expect(resumed.body.outcome).toBe('resumed');
    // O cabeçalho continua resolvido a partir do vínculo, não de ordem de array.
    const ctx = reloaded.body.encounter.context;
    expect(ctx.patient.id).toBe('pet-mel');
    expect(ctx.patient.ageLabel).toMatch(/anos?$/);
    expect(ctx.responsible.name).toBe('Isabelle Tutora');
  });

  it('o início clínico de registro anterior ao F1A é derivado (nunca vazio)', async () => {
    const created = await start({ businessId: BIZ, bookingId: 'bk-mel' });
    const db = await readDB();
    // Simula documento legado (sem o campo) e roda a normalização da leitura.
    delete (db.encounters[0] as Encounter).startedAt;
    await writeDB(db);
    const legacy = await getById(created.body.encounterId);
    expect(legacy.res.status).toBe(200);
    expect(String(legacy.body.encounter.startedAt)).toBeTruthy();
  });
});
