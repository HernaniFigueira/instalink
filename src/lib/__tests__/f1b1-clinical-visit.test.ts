// ═══════════════════════════════════════════════════════════════
// F1B1 · REGISTRO CLÍNICO DA VISITA (anamnese + avaliação veterinária)
// ═══════════════════════════════════════════════════════════════
// Travas desta entrega (A–M do escopo autorizado):
//   A. Encounter sem Pet válido no tenant não grava dado clínico;
//   B. profissional diferente do responsável não edita conteúdo clínico;
//   C. Owner sem vínculo Professional não edita conteúdo clínico;
//   D. Recepção não edita;
//   E. o profissional responsável edita;
//   F. cross-tenant é rejeitado;
//   G/H. anamnese e avaliação persistem no MESMO `encounterId`;
//   I/J. a versão é UMA só: anamnese salva → avaliação usa a versão nova,
//        sem 409 interno criado pelo próprio sistema;
//   K. concorrência externa continua produzindo 409 real;
//   L. retry preserva o texto (reenvio com a versão atual grava o mesmo texto);
//   M. dados legados sem os campos novos normalizam (estrutura vazia, sem
//      copiar nada do cadastro permanente do Pet).
import './helpers/temp-db';

import fs from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { GET as encountersGET, POST as encountersPOST, PATCH as encountersPATCH } from '@/app/api/encounters/route';
import { ENCOUNTER_LABELS } from '../encounters';
import { ENCOUNTER_SECTIONS, availableEncounterSections } from '../encounter-sections';
import {
  EMPTY_ENCOUNTER_CLINICAL, VETERINARY_ASSESSMENT_NUMBER_LIMITS,
  applyEncounterClinicalPatch, clinicalWriteError, encounterClinicalAccess, normalizeEncounterClinical,
} from '../encounter-clinical';
import type { Business, DB } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-10-04T12:00:00.000Z';
const BIZ = 'biz-f1b1';
const OTHER = 'biz-f1b1-outra';
const OWNER = 'owner-f1b1';
const MICHELLE_USER = 'user-michelle';
const MARIA_USER = 'user-maria';
const OUTRA_USER = 'user-outra';
const PET = 'pet-mel';
const TUTOR = 'ct-isabelle';

function business(id: string, ownerId = OWNER): Business {
  return {
    id, ownerId, organizationId: `org-${id}`, name: `Clínica ${id}`, slug: id,
    description: '', logo: '', cover: '', niche: 'pet', modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: false, about: false, agent: false },
    phone: '', whatsapp: '', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0,
    googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 30, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: NOW, updatedAt: NOW, businessTimezone: 'America/Sao_Paulo',
  } as Business;
}

/** Base descartável: Tenant A (Owner + Michelle profissional + Maria recepção)
 *  e Tenant B (profissional sem vínculo com A). */
async function seed() {
  const db: DB = emptyDB();
  db.users.push(
    { id: OWNER, name: 'Dona Unidade', email: 'owner@f1b1.test', passwordHash: 'x', createdAt: NOW, role: 'owner' },
    { id: MICHELLE_USER, name: 'Michelle', email: 'michelle@f1b1.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
    { id: MARIA_USER, name: 'Maria', email: 'maria@f1b1.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
    { id: OUTRA_USER, name: 'Vet de outra unidade', email: 'outra@f1b1.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
  );
  db.businesses.push(business(BIZ), business(OTHER, OUTRA_USER));
  db.members.push(
    { id: 'm-michelle', businessId: BIZ, userId: MICHELLE_USER, role: 'PROFISSIONAL', permissions: {}, active: true, note: '', invitedBy: OWNER, createdAt: NOW, updatedAt: NOW },
    { id: 'm-maria', businessId: BIZ, userId: MARIA_USER, role: 'SECRETARIA', permissions: {}, active: true, note: '', invitedBy: OWNER, createdAt: NOW, updatedAt: NOW },
  );
  db.professionals.push(
    // ATENÇÃO: o Owner desta clínica NÃO tem vínculo Professional (caso C).
    { id: 'pro-michelle', businessId: BIZ, name: 'Michelle', role: 'Veterinária', photo: '', active: true, userId: MICHELLE_USER, followsBusinessHours: true, createdAt: NOW } as any,
    { id: 'pro-outra', businessId: BIZ, name: 'Outro vet', role: '', photo: '', active: true, userId: '', followsBusinessHours: true, createdAt: NOW } as any,
    { id: 'pro-outra-b', businessId: OTHER, name: 'Vet B', role: '', photo: '', active: true, userId: OUTRA_USER, followsBusinessHours: true, createdAt: NOW } as any,
  );
  db.services.push({ id: 'svc-consulta', businessId: BIZ, name: 'Consulta clínica', durationMin: 30, price: 15000, description: '', active: true, bookable: true, professionalIds: [], createdAt: NOW, updatedAt: NOW } as any);
  db.contacts.push({ id: TUTOR, businessId: BIZ, name: 'Isabelle', phone: '11999990001', customerId: '', createdAt: NOW } as any);
  db.pets.push({
    id: PET, businessId: BIZ, tutorId: TUTOR, name: 'Mel', photo: '', species: 'cachorro', breed: 'SRD',
    sex: 'F', birthDate: '2024-01-01', weightKg: 8.4, notes: 'Alergia relatada: ração de frango',
    active: true, createdAt: NOW, updatedAt: NOW,
  } as any);
  db.bookings.push({
    id: 'bk-f1b1', businessId: BIZ, customerId: '', serviceId: 'svc-consulta', professionalId: 'pro-michelle',
    petId: PET, date: '2026-10-04', time: '14:00', customerName: 'Isabelle', customerPhone: '11999990001',
    status: 'confirmed', checkedInAt: NOW, note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [],
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

let tokenOwner = '';
let tokenMichelle = '';
let tokenMaria = '';
let tokenOutra = '';
let encounterId = '';

/** Abre o atendimento canônico (Michelle é a responsável pelo agendamento). */
async function openEncounter(tk = tokenMichelle, bookingId = 'bk-f1b1') {
  const res = await encountersPOST(jsonReq('/api/encounters', { businessId: BIZ, bookingId }, tk));
  expect(res.status).toBe(200);
  return (await json(res)).encounter;
}

/** PATCH de conteúdo com a versão ATUAL (como a tela faz pela autoridade). */
async function patchClinical(payload: Record<string, unknown>, tk: string, version?: number) {
  const current = (await readDB()).encounters.find((e) => e.id === encounterId);
  const expectedVersion = version ?? (current ? Number(current.version) || 1 : 1);
  return encountersPATCH(jsonReq('/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion, ...payload,
  }, tk, 'PATCH'));
}

const ANAMNESIS = {
  history: 'Coceira nas orelhas há 3 dias, piora à noite.',
  diet: 'Ração seca habitual; trocou de marca há 1 semana.',
  appetite: 'usual', waterIntake: 'changed', urine: 'usual', stool: 'changed',
  vomiting: 'no', diarrhea: 'yes',
  medicationsReported: 'Antipulgas mensal (relatado).',
  allergiesReported: 'Tutor relata reação a ração de frango.',
  observations: 'Tutora relata que a Mel está mais quieta.',
};

beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  tokenOwner = await createSession(OWNER);
  tokenMichelle = await createSession(MICHELLE_USER);
  tokenMaria = await createSession(MARIA_USER);
  tokenOutra = await createSession(OUTRA_USER);
  const opened = await openEncounter();
  encounterId = opened.id;
});

describe('F1B1 · estrutura de seções e copy clínica', () => {
  it('as três seções do recorte estão REAIS; o resto continua declarado e indisponível', () => {
    expect(availableEncounterSections().map((s) => s.id)).toEqual(['atendimento', 'anamnese', 'avaliacao']);
    for (const id of ['problemas', 'conduta', 'procedimentos', 'anexos']) {
      expect(ENCOUNTER_SECTIONS.find((s) => s.id === id)?.available).toBe(false);
    }
  });

  it('copy clínica do atendimento (§6) sem renomear campo físico', () => {
    expect(ENCOUNTER_LABELS.complaint).toBe('Queixa principal');
    expect(ENCOUNTER_LABELS.evolution).toBe('Evolução clínica');
    expect(ENCOUNTER_LABELS.guidance).toBe('Orientações ao tutor');
    expect(ENCOUNTER_LABELS.followUp).toBe('Retorno');
    expect(ENCOUNTER_LABELS.internalNote).toBe('Nota interna');
  });
});

describe('F1B1 · dado permanente × dado da visita', () => {
  it('M · documento legado normaliza para estrutura VAZIA (nada copiado do Pet)', async () => {
    const db = await readDB();
    const row = db.encounters.find((e) => e.id === encounterId)!;
    // Simula um registro anterior ao F1B1: o campo não existia.
    delete (row as any).clinical;
    await writeDB(db);
    const reread = (await readDB()).encounters.find((e) => e.id === encounterId)!;
    expect(normalizeEncounterClinical(reread.clinical)).toEqual(EMPTY_ENCOUNTER_CLINICAL);
    expect(JSON.stringify(reread.clinical)).not.toContain('8.4');
    // O cadastro permanente continua sendo a única fonte do peso do cadastro.
    expect((await readDB()).pets.find((p) => p.id === PET)!.weightKg).toBe(8.4);
  });

  it('peso medido hoje vive no Encounter e NÃO sobrescreve o cadastro do Pet', async () => {
    const res = await patchClinical(
      { clinical: { assessment: { veterinary: { weightKg: 8.9, temperatureC: 38.4, heartRateBpm: 120, respiratoryRateRpm: 32, physicalExam: 'Orelha direita com eritema.' } } } },
      tokenMichelle,
    );
    expect(res.status).toBe(200);
    const db = await readDB();
    const row = db.encounters.find((e) => e.id === encounterId)!;
    expect(row.clinical!.assessment.veterinary.weightKg).toBe(8.9);
    expect(row.clinical!.assessment.veterinary.temperatureC).toBe(38.4);
    expect(row.petId).toBe(PET);
    expect(db.pets.find((p) => p.id === PET)!.weightKg).toBe(8.4);   // intacto
    expect(db.pets.find((p) => p.id === PET)!.notes).toContain('Alergia relatada');
  });
});

describe('F1B1 · permissões de escrita clínica (servidor)', () => {
  it('E · o profissional responsável edita (anamnese + avaliação)', async () => {
    const anamnese = await patchClinical({ clinical: { anamnesis: ANAMNESIS } }, tokenMichelle);
    expect(anamnese.status).toBe(200);
    const avaliacao = await patchClinical(
      { clinical: { assessment: { veterinary: { temperatureC: 38.5, hydration: 'Normohidratada', mucousMembranes: 'Róseas e úmidas', capillaryRefillSeconds: 2, bodyCondition: 'Escore 5/9', physicalExam: 'Sem alterações relevantes.' } } } },
      tokenMichelle,
    );
    expect(avaliacao.status).toBe(200);
    const row = (await readDB()).encounters.find((e) => e.id === encounterId)!;
    expect(row.clinical!.anamnesis.history).toContain('Coceira');
    expect(row.clinical!.assessment.veterinary.temperatureC).toBe(38.5);
    expect(row.professionalId).toBe('pro-michelle');
  });

  it('C · Owner sem vínculo Professional NÃO escreve conteúdo clínico', async () => {
    const res = await patchClinical({ clinical: { anamnesis: { history: 'Tentativa do papel administrativo.' } } }, tokenOwner);
    expect(res.status).toBe(403);
    expect((await json(res)).error).toMatch(/profissional responsável/i);
    const row = (await readDB()).encounters.find((e) => e.id === encounterId)!;
    expect(row.clinical!.anamnesis.history).toBe('');
    // Núcleo (queixa/evolução) também é conteúdo clínico: mesmo bloqueio.
    const core = await patchClinical({ evolution: 'papel administrativo' }, tokenOwner);
    expect(core.status).toBe(403);
    expect((await readDB()).encounters.find((e) => e.id === encounterId)!.evolution).toBe('');
    // E o Owner continua LENDO e INICIANDO (a leitura não é escrita clínica).
    const read = await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&id=${encounterId}`, undefined, tokenOwner, 'GET'));
    expect(read.status).toBe(200);
    expect((await json(read)).encounter.access.canEditClinical).toBe(false);
  });

  it('B · profissional diferente do responsável não edita (mesmo sendo da unidade)', async () => {
    // pro-outra não tem login; criamos o vínculo do OUTRO usuário com a unidade
    // A para provar que o bloqueio é do RESPONSÁVEL, não do tenant.
    const db = await readDB();
    db.professionals.find((p) => p.id === 'pro-outra')!.userId = OUTRA_USER;
    db.members.push({ id: 'm-outra', businessId: BIZ, userId: OUTRA_USER, role: 'PROFISSIONAL', permissions: {}, active: true, note: '', invitedBy: OWNER, createdAt: NOW, updatedAt: NOW });
    await writeDB(db);

    const res = await patchClinical({ clinical: { anamnesis: { history: 'Outro profissional tentando escrever.' } } }, tokenOutra);
    expect([403, 404]).toContain(res.status);   // fora do escopo: 403 (não é dele)
    expect((await readDB()).encounters.find((e) => e.id === encounterId)!.clinical!.anamnesis.history).toBe('');
  });

  it('D · Recepção não edita (não tem a permissão clínica)', async () => {
    const res = await patchClinical({ clinical: { anamnesis: { history: 'Recepção tentando escrever.' } } }, tokenMaria);
    expect(res.status).toBe(403);
    expect((await readDB()).encounters.find((e) => e.id === encounterId)!.clinical!.anamnesis.history).toBe('');
    // Leitura clínica também não é dela.
    const read = await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&id=${encounterId}`, undefined, tokenMaria, 'GET'));
    expect(read.status).toBe(403);
  });

  it('F · cross-tenant é rejeitado (404/403) e nada cruza a fronteira', async () => {
    const get = await encountersGET(jsonReq(`/api/encounters?businessId=${OTHER}&id=${encounterId}`, undefined, tokenOutra, 'GET'));
    expect(get.status).toBe(404);
    const patch = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: OTHER, id: encounterId, expectedVersion: 1,
      clinical: { anamnesis: { history: 'cross-tenant' } },
    }, tokenOutra, 'PATCH'));
    expect(patch.status).toBe(404);
    const db = await readDB();
    expect(db.encounters.every((e) => e.businessId === BIZ)).toBe(true);
    expect(db.encounters.find((e) => e.id === encounterId)!.clinical!.anamnesis.history).toBe('');
  });

  it('A · Encounter sem Pet válido no tenant não grava dado clínico', async () => {
    const db = await readDB();
    const row = db.encounters.find((e) => e.id === encounterId)!;
    row.petId = 'pet-de-outra-unidade';
    await writeDB(db);
    const res = await patchClinical({ clinical: { anamnesis: ANAMNESIS } }, tokenMichelle);
    expect(res.status).toBe(409);
    expect((await json(res)).error).toMatch(/Pet/i);
    expect((await readDB()).encounters.find((e) => e.id === encounterId)!.clinical!.anamnesis.history).toBe('');
    // Sem NENHUM Pet vinculado, o bloqueio é o mesmo — e é explícito.
    const db2 = await readDB();
    delete (db2.encounters.find((e) => e.id === encounterId) as any).petId;
    await writeDB(db2);
    const semPet = await patchClinical({ clinical: { assessment: { veterinary: { weightKg: 9 } } } }, tokenMichelle);
    expect(semPet.status).toBe(409);
    expect((await readDB()).encounters.find((e) => e.id === encounterId)!.clinical!.assessment.veterinary.weightKg).toBe(null);
  });

  it('a leitura devolve a capacidade de escrita resolvida no SERVIDOR', async () => {
    const asMichelle = await json(await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&id=${encounterId}`, undefined, tokenMichelle, 'GET')));
    expect(asMichelle.encounter.access).toMatchObject({ canEditCore: true, canEditClinical: true, reason: 'editable' });
    const asOwner = await json(await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&id=${encounterId}`, undefined, tokenOwner, 'GET')));
    expect(asOwner.encounter.access).toMatchObject({ canEditCore: false, canEditClinical: false, reason: 'professional_required' });
  });
});

describe('F1B1 · versionamento entre seções (uma autoridade)', () => {
  it('G/H · anamnese e avaliação persistem no MESMO encounterId', async () => {
    await patchClinical({ clinical: { anamnesis: ANAMNESIS } }, tokenMichelle);
    await patchClinical({ clinical: { assessment: { veterinary: { weightKg: 8.9 } } } }, tokenMichelle);
    const db = await readDB();
    expect(db.encounters.filter((e) => e.bookingId === 'bk-f1b1')).toHaveLength(1);
    const row = db.encounters[0];
    expect(row.clinical!.anamnesis.appetite).toBe('usual');
    expect(row.clinical!.assessment.veterinary.weightKg).toBe(8.9);
  });

  it('I/J · anamnese muda a versão compartilhada e a avaliação salva com a versão NOVA (sem 409 interno)', async () => {
    const first = await openEncounter();
    // Anamnese (v1 → v2)
    const anamnese = await patchClinical({ clinical: { anamnesis: ANAMNESIS } }, tokenMichelle, first.version);
    expect(anamnese.status).toBe(200);
    const afterAnamnese = (await json(anamnese)).encounter;
    expect(afterAnamnese.version).toBe(first.version + 1);
    // Avaliação usando a versão ANTIGA falharia (409) — é exatamente o acidente
    // que a autoridade única elimina. Com a versão publicada, grava.
    const stale = await patchClinical({ clinical: { assessment: { veterinary: { weightKg: 8.9 } } } }, tokenMichelle, first.version);
    expect(stale.status).toBe(409);
    const fresh = await patchClinical({ clinical: { assessment: { veterinary: { weightKg: 8.9 } } } }, tokenMichelle, afterAnamnese.version);
    expect(fresh.status).toBe(200);
    expect((await json(fresh)).encounter.version).toBe(afterAnamnese.version + 1);
    const row = (await readDB()).encounters.find((e) => e.id === encounterId)!;
    // Nada foi perdido no caminho: as duas seções estão gravadas.
    expect(row.clinical!.anamnesis.diarrhea).toBe('yes');
    expect(row.clinical!.assessment.veterinary.weightKg).toBe(8.9);
  });

  it('K · concorrência EXTERNA continua produzindo 409 real (não é o sistema se atropelando)', async () => {
    const opened = await openEncounter();
    const outraTela = await patchClinical({ clinical: { anamnesis: { history: 'gravado em outra tela' } } }, tokenMichelle, opened.version);
    expect(outraTela.status).toBe(200);
    const versaoExterna = (await json(outraTela)).encounter.version;
    const tentativaVelha = await patchClinical({ evolution: 'texto local' }, tokenMichelle, opened.version);
    expect(tentativaVelha.status).toBe(409);
    const row = (await readDB()).encounters.find((e) => e.id === encounterId)!;
    expect(row.evolution).toBe('');                       // nada sobrescrito
    expect(row.clinical!.anamnesis.history).toBe('gravado em outra tela');
    // L · retry com a versão atual grava o MESMO texto (o texto nunca muda).
    const retry = await patchClinical({ evolution: 'texto local' }, tokenMichelle, versaoExterna);
    expect(retry.status).toBe(200);
    expect((await readDB()).encounters.find((e) => e.id === encounterId)!.evolution).toBe('texto local');
  });
});

describe('F1B1 · validação do payload clínico (unidades e limites técnicos)', () => {
  it('número não finito / fora do limite técnico é 400 e não grava', async () => {
    const texto = await patchClinical({ clinical: { assessment: { veterinary: { weightKg: '8 kg' } } } }, tokenMichelle);
    expect(texto.status).toBe(400);
    const infinito = await patchClinical({ clinical: { assessment: { veterinary: { temperatureC: 'x' } } } }, tokenMichelle);
    expect(infinito.status).toBe(400);
    const absurdo = await patchClinical(
      { clinical: { assessment: { veterinary: { heartRateBpm: VETERINARY_ASSESSMENT_NUMBER_LIMITS.heartRateBpm.max + 1 } } } },
      tokenMichelle,
    );
    expect(absurdo.status).toBe(400);
    expect((await readDB()).encounters.find((e) => e.id === encounterId)!.clinical!.assessment.veterinary.weightKg).toBe(null);
  });

  it('campo vazio é permitido (opcional) e vira null — nunca 0 inventado', async () => {
    await patchClinical({ clinical: { assessment: { veterinary: { weightKg: 9.2, temperatureC: 38.1 } } } }, tokenMichelle);
    const limpo = await patchClinical({ clinical: { assessment: { veterinary: { weightKg: null, temperatureC: '' } } } }, tokenMichelle);
    expect(limpo.status).toBe(200);
    const vet = (await readDB()).encounters.find((e) => e.id === encounterId)!.clinical!.assessment.veterinary;
    expect(vet.weightKg).toBe(null);
    expect(vet.temperatureC).toBe(null);
  });

  it('opção fora da lista e chave desconhecida são recusadas (nada de seção futura ligada em silêncio)', async () => {
    const opcao = await patchClinical({ clinical: { anamnesis: { appetite: 'muito' } } }, tokenMichelle);
    expect(opcao.status).toBe(400);
    const chave = await patchClinical({ clinical: { anamnesis: { diagnosis: 'otite' } } }, tokenMichelle);
    expect(chave.status).toBe(400);
    const secao = await patchClinical({ clinical: { problemas: [{ descricao: 'otite' }] } }, tokenMichelle);
    expect(secao.status).toBe(400);
    expect((await readDB()).encounters.find((e) => e.id === encounterId)!.clinical).toEqual(normalizeEncounterClinical(undefined));
  });

  it('merge é PARCIAL: a fatia que não veio no payload permanece intacta', async () => {
    await patchClinical({ clinical: { anamnesis: ANAMNESIS } }, tokenMichelle);
    await patchClinical({ clinical: { assessment: { veterinary: { weightKg: 9 } } } }, tokenMichelle);
    const soAnamnese = await patchClinical({ clinical: { anamnesis: { observations: 'Atualizado' } } }, tokenMichelle);
    expect(soAnamnese.status).toBe(200);
    const row = (await readDB()).encounters.find((e) => e.id === encounterId)!;
    expect(row.clinical!.anamnesis.observations).toBe('Atualizado');
    expect(row.clinical!.anamnesis.history).toContain('Coceira');   // preservado
    expect(row.clinical!.assessment.veterinary.weightKg).toBe(9);   // preservado
  });

  it('regra pura: access e mensagens de recusa (mesma régua do servidor)', () => {
    const db = { professionals: [], pets: [] } as unknown as Pick<DB, 'professionals' | 'pets'>;
    const draft = { businessId: BIZ, professionalId: 'p', petId: PET, status: 'draft' as const };
    expect(encounterClinicalAccess(db, draft, 'u', 'OWNER')).toMatchObject({ canEditCore: false, reason: 'professional_required' });
    const finalized = encounterClinicalAccess(db, { ...draft, status: 'finalized' }, 'u', 'OWNER');
    expect(finalized.reason).toBe('finalized');
    expect(clinicalWriteError(finalized).status).toBe(409);
    expect(clinicalWriteError(finalized).message).toMatch(/finalizado/i);
    // applyEncounterClinicalPatch é puro e devolve os campos que MUDARAM.
    const merged = applyEncounterClinicalPatch(undefined, { anamnesis: { appetite: 'changed' } });
    expect(merged.ok).toBe(true);
    if (merged.ok) {
      expect(merged.changedFields).toEqual(['clinical.anamnesis.appetite']);
      expect(merged.clinical.anamnesis.appetite).toBe('changed');
      expect(merged.clinical.anamnesis.history).toBe('');
    }
  });
});

describe('F1B1 · registro finalizado continua fechado para conteúdo clínico', () => {
  it('finalizado recusa anamnese/avaliação como recusa a edição de conteúdo', async () => {
    // Preenche (núcleo + anamnese), finaliza e tenta escrever. A finalização
    // continua sendo a do domínio (o F1B1 não expõe botão de finalizar).
    await patchClinical({ evolution: 'Consulta realizada; conduta registrada.' }, tokenMichelle);
    await patchClinical({ clinical: { anamnesis: ANAMNESIS } }, tokenMichelle);
    const finalized = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: BIZ, id: encounterId, action: 'finalize', expectedVersion: (await readDB()).encounters.find((e) => e.id === encounterId)!.version,
    }, tokenMichelle, 'PATCH'));
    expect(finalized.status).toBe(200);
    const depois = await patchClinical({ clinical: { assessment: { veterinary: { weightKg: 9.5 } } } }, tokenMichelle);
    expect(depois.status).toBe(409);
    const row = (await readDB()).encounters.find((e) => e.id === encounterId)!;
    expect(row.status).toBe('finalized');
    expect(row.clinical!.assessment.veterinary.weightKg).toBe(null);
    expect(row.clinical!.anamnesis.history).toContain('Coceira');
  });
});

describe('F1B1 · legado preservado', () => {
  it('a rota do registro completo e o motor de fichas continuam existindo (nada apagado)', () => {
    const root = process.cwd();
    expect(fs.existsSync(`${root}/src/app/(dashboard)/atendimento/[encounterId]/registro/page.tsx`)).toBe(true);
    expect(fs.existsSync(`${root}/src/app/api/anamnese/route.ts`)).toBe(true);
    const sheet = fs.readFileSync(`${root}/src/components/dashboard/EncounterSheet.tsx`, 'utf8');
    expect(sheet).toMatch(/AnamneseFiller/);
    const filler = fs.readFileSync(`${root}/src/components/dashboard/AnamneseFiller.tsx`, 'utf8');
    expect(filler).toContain("action: 'response.save'");
  });

  it('a nova seção de anamnese NÃO grava resposta no motor legado (nem o contrário)', async () => {
    await patchClinical({ clinical: { anamnesis: ANAMNESIS } }, tokenMichelle);
    const db = await readDB();
    expect(db.anamneseResponses).toHaveLength(0);
    expect(db.anamneseTemplates).toHaveLength(0);
  });
});
