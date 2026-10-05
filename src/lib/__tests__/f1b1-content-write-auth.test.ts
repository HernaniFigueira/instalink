// ═══════════════════════════════════════════════════════════════
// F1B1 · PATCH DE AUTORIZAÇÃO SERVER-SIDE (P1) + AUDITORIA GRANULAR (P2)
// ═══════════════════════════════════════════════════════════════
// Regra canônica provada AQUI, pela API direta (não pela UI):
//
//   Toda mutação de CONTEÚDO de um Encounter em andamento exige o
//   PROFISSIONAL RESPONSÁVEL autorizado. Papel administrativo (Owner/Admin
//   sem vínculo) lê e opera, mas NÃO escreve conteúdo. Recepção não escreve.
//   Outro profissional não escreve. Cross-tenant não escreve.
//
// O bypass que este arquivo fecha: `followUpMode`, `followUpDate`,
// `followUpDays` e `files` eram gravados FORA do gate (o gate olhava só
// texto + tags). Frontend desabilitado não é segurança — o PATCH direto
// precisa recusar sozinho.
//
// E o ajuste de auditoria: `encounter.updated.meta.fields` passa a registrar
// os caminhos GRANULARES que `applyEncounterClinicalPatch` já calculava
// (clinical.anamnesis.appetite, clinical.assessment.veterinary.temperatureC)
// em vez do rótulo coarse "clinical".
import './helpers/temp-db';

import fs from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { GET as encountersGET, POST as encountersPOST, PATCH as encountersPATCH } from '@/app/api/encounters/route';
import {
  ENCOUNTER_CONTENT_FIELDS, ENCOUNTER_STRUCTURED_FOLLOW_UP_FIELDS, ENCOUNTER_TEXT_FIELDS,
  writesEncounterContent,
} from '../encounters';
import { EMPTY_ENCOUNTER_CLINICAL } from '../encounter-clinical';
import type { Business, DB, Encounter } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-10-04T12:00:00.000Z';
const BIZ = 'biz-cwa';
const OWNER = 'owner-cwa';
const MICHELLE_USER = 'user-michelle-cwa';
const CAIO_USER = 'user-caio-cwa';
const MARIA_USER = 'user-maria-cwa';
const OUTRA_USER = 'user-outra-cwa';
const PET = 'pet-mel-cwa';
const TUTOR = 'ct-isabelle-cwa';

function business(id: string, ownerId = OWNER, clinicType: Business['clinicType'] = 'veterinaria'): Business {
  return {
    id, ownerId, organizationId: `org-${id}`, name: `Clínica ${id}`, slug: id,
    clinicType,
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

/**
 * Base descartável. O detalhe que importa: o OWNER desta unidade NÃO tem
 * vínculo Professional (é o caso do bypass) e o CAIO é profissional da
 * MESMA unidade, mas não é o responsável por este atendimento.
 */
async function seed() {
  const db: DB = emptyDB();
  db.users.push(
    { id: OWNER, name: 'Dona Unidade', email: 'owner@cwa.test', passwordHash: 'x', createdAt: NOW, role: 'owner' },
    { id: MICHELLE_USER, name: 'Michelle', email: 'michelle@cwa.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
    { id: CAIO_USER, name: 'Caio', email: 'caio@cwa.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
    { id: MARIA_USER, name: 'Maria', email: 'maria@cwa.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
    { id: OUTRA_USER, name: 'Vet de fora', email: 'outra@cwa.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
  );
  db.businesses.push(business(BIZ), business('biz-cwa-outra', OUTRA_USER));
  db.members.push(
    { id: 'm-michelle', businessId: BIZ, userId: MICHELLE_USER, role: 'PROFISSIONAL', permissions: {}, active: true, note: '', invitedBy: OWNER, createdAt: NOW, updatedAt: NOW },
    { id: 'm-caio', businessId: BIZ, userId: CAIO_USER, role: 'PROFISSIONAL', permissions: {}, active: true, note: '', invitedBy: OWNER, createdAt: NOW, updatedAt: NOW },
    { id: 'm-maria', businessId: BIZ, userId: MARIA_USER, role: 'SECRETARIA', permissions: {}, active: true, note: '', invitedBy: OWNER, createdAt: NOW, updatedAt: NOW },
  );
  db.professionals.push(
    { id: 'pro-michelle', businessId: BIZ, name: 'Michelle', role: 'Veterinária', photo: '', active: true, userId: MICHELLE_USER, followsBusinessHours: true, createdAt: NOW } as any,
    { id: 'pro-caio', businessId: BIZ, name: 'Caio', role: 'Veterinário', photo: '', active: true, userId: CAIO_USER, followsBusinessHours: true, createdAt: NOW } as any,
    { id: 'pro-fora', businessId: 'biz-cwa-outra', name: 'Vet de fora', role: '', photo: '', active: true, userId: OUTRA_USER, followsBusinessHours: true, createdAt: NOW } as any,
  );
  db.services.push({ id: 'svc-consulta', businessId: BIZ, name: 'Consulta clínica', durationMin: 30, price: 15000, description: '', active: true, bookable: true, professionalIds: [], createdAt: NOW, updatedAt: NOW } as any);
  db.contacts.push({ id: TUTOR, businessId: BIZ, name: 'Isabelle', phone: '11999990001', customerId: '', createdAt: NOW } as any);
  db.pets.push({
    id: PET, businessId: BIZ, tutorId: TUTOR, name: 'Mel', photo: '', species: 'cachorro', breed: 'SRD',
    sex: 'F', birthDate: '2024-01-01', weightKg: 8.4, notes: '', active: true, createdAt: NOW, updatedAt: NOW,
  } as any);
  db.bookings.push({
    id: 'bk-cwa', businessId: BIZ, customerId: '', serviceId: 'svc-consulta', professionalId: 'pro-michelle',
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
let tokenCaio = '';
let tokenMaria = '';
let tokenOutra = '';
let encounterId = '';

/** Abre o atendimento canônico (Michelle é a profissional do agendamento). */
async function openEncounter(tk = tokenMichelle, bookingId = 'bk-cwa') {
  const res = await encountersPOST(jsonReq('/api/encounters', { businessId: BIZ, bookingId }, tk));
  expect(res.status).toBe(200);
  return (await json(res)).encounter;
}

/** PATCH de conteúdo com a versão ATUAL (o que a tela faz pela autoridade). */
async function patch(payload: Record<string, unknown>, tk: string, version?: number) {
  const current = (await readDB()).encounters.find((e) => e.id === encounterId);
  const expectedVersion = version ?? (current ? Number(current.version) || 1 : 1);
  return encountersPATCH(jsonReq('/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion, ...payload,
  }, tk, 'PATCH'));
}

/** Fotografia byte-for-byte do registro (prova de "nada mudou"). */
const snapshot = async (): Promise<string> => JSON.stringify(
  (await readDB()).encounters.find((e) => e.id === encounterId) as Encounter,
);
const versionOf = async (): Promise<number> => Number(
  (await readDB()).encounters.find((e) => e.id === encounterId)?.version,
) || 1;
const updatesFor = async () => (await readDB()).audit.filter(
  (entry) => entry.action === 'encounter.updated' && entry.meta?.encounterId === encounterId,
);

const ARQUIVO = [{
  id: 'f-exame-1', name: 'otoscopia.jpg', url: 'https://cdn.cwa.test/otoscopia.jpg',
  size: 20480, createdAt: NOW, by: 'Michelle',
}];

/** Os quatro campos do bypass, cada um com o payload que ANTES gravava. */
const BYPASS_PAYLOADS: Array<{ label: string; payload: Record<string, unknown>; wrote: string }> = [
  { label: 'followUpMode', payload: { followUpMode: 'interval', followUpDays: 30 }, wrote: 'followUpMode' },
  { label: 'followUpDate', payload: { followUpMode: 'date', followUpDate: '2026-12-01' }, wrote: 'followUpDate' },
  { label: 'followUpDays', payload: { followUpMode: 'interval', followUpDays: 45 }, wrote: 'followUpDays' },
  { label: 'files', payload: { files: ARQUIVO }, wrote: 'files' },
];

beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  await seed();
  tokenOwner = await createSession(OWNER);
  tokenMichelle = await createSession(MICHELLE_USER);
  tokenCaio = await createSession(CAIO_USER);
  tokenMaria = await createSession(MARIA_USER);
  tokenOutra = await createSession(OUTRA_USER);
  encounterId = (await openEncounter()).id;
});

describe('F1B1 · P1 — definição única de "escreve conteúdo"', () => {
  it('a lista de conteúdo cobre TODO campo que a rota grava (nada fica de fora)', () => {
    expect([...ENCOUNTER_TEXT_FIELDS]).toEqual(['complaint', 'evolution', 'guidance', 'followUp', 'internalNote']);
    expect([...ENCOUNTER_STRUCTURED_FOLLOW_UP_FIELDS]).toEqual(['followUpMode', 'followUpDate', 'followUpDays']);
    expect([...ENCOUNTER_CONTENT_FIELDS]).toEqual([
      'complaint', 'evolution', 'guidance', 'followUp', 'internalNote', 'tags',
      'followUpMode', 'followUpDate', 'followUpDays', 'files', 'clinical',
    ]);
    // O gate não pode depender de um campo citado à mão em outro lugar.
    const rota = fs.readFileSync(`${process.cwd()}/src/app/api/encounters/route.ts`, 'utf8');
    expect(rota).toMatch(/writesEncounterContent\(body\)/);
    expect(rota).not.toMatch(/const writesCore/);
  });

  it('cada campo de conteúdo liga o gate; metadado e transição NÃO ligam', () => {
    for (const field of ENCOUNTER_CONTENT_FIELDS) {
      expect(writesEncounterContent({ [field]: '' }), `campo ${field}`).toBe(true);
    }
    // Transporte/roteamento não é conteúdo.
    expect(writesEncounterContent({ id: 'e1', businessId: BIZ, expectedVersion: 3 })).toBe(false);
    // Transições de estado têm contrato próprio (finalize/reopen/DELETE).
    expect(writesEncounterContent({ action: 'finalize', expectedVersion: 3 })).toBe(false);
    expect(writesEncounterContent({ action: 'reopen', expectedVersion: 3 })).toBe(false);
    // `undefined` explícito não é escrita (a tela omite o que não tocou).
    expect(writesEncounterContent({ followUpMode: undefined, files: undefined })).toBe(false);
    expect(writesEncounterContent(null)).toBe(false);
    expect(writesEncounterContent([])).toBe(false);
  });
});

describe('F1B1 · P1 — bypass fechado: conteúdo exige o profissional responsável', () => {
  it('Owner SEM vínculo Professional não altera followUpMode/Date/Days nem files', async () => {
    const antes = await snapshot();
    const versao = await versionOf();
    const auditoriaAntes = (await updatesFor()).length;

    for (const caso of BYPASS_PAYLOADS) {
      const res = await patch(caso.payload, tokenOwner);
      expect(res.status, `Owner → ${caso.label}`).toBe(403);
      expect((await json(res)).error).toMatch(/profissional responsável/i);
    }
    // Campo isolado também é recusado (a definição não depende do trio).
    expect((await patch({ followUpDays: 30 }, tokenOwner)).status).toBe(403);
    expect((await patch({ followUpDate: '2026-12-01' }, tokenOwner)).status).toBe(403);

    expect(await snapshot()).toBe(antes);                    // byte-for-byte intacto
    expect(await versionOf()).toBe(versao);                  // versão não sobe
    expect((await updatesFor()).length).toBe(auditoriaAntes); // nenhuma auditoria nova
  });

  it('Recepção não altera retorno nem arquivos', async () => {
    const antes = await snapshot();
    const versao = await versionOf();
    for (const caso of BYPASS_PAYLOADS) {
      const res = await patch(caso.payload, tokenMaria);
      expect(res.status, `Recepção → ${caso.label}`).toBe(403);
    }
    expect(await snapshot()).toBe(antes);
    expect(await versionOf()).toBe(versao);
    expect(await updatesFor()).toHaveLength(0);
  });

  it('outro Professional da MESMA unidade não altera conteúdo', async () => {
    const antes = await snapshot();
    const versao = await versionOf();
    for (const caso of BYPASS_PAYLOADS) {
      const res = await patch(caso.payload, tokenCaio);
      expect([403, 404], `Caio → ${caso.label}`).toContain(res.status);
    }
    expect(await snapshot()).toBe(antes);
    expect(await versionOf()).toBe(versao);
    expect(await updatesFor()).toHaveLength(0);
  });

  it('cross-tenant não escreve (404) e nada cruza a fronteira', async () => {
    const antes = await snapshot();
    const res = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: 'biz-cwa-outra', id: encounterId, expectedVersion: await versionOf(),
      followUpMode: 'interval', followUpDays: 7, files: ARQUIVO,
    }, tokenOutra, 'PATCH'));
    expect(res.status).toBe(404);
    expect(await snapshot()).toBe(antes);
    expect(await updatesFor()).toHaveLength(0);
  });

  it('o núcleo (complaint) e o dado clínico continuam protegidos pela MESMA régua', async () => {
    const antes = await snapshot();
    expect((await patch({ complaint: 'queixa do papel administrativo' }, tokenOwner)).status).toBe(403);
    expect((await patch({ evolution: 'evolução do papel administrativo' }, tokenOwner)).status).toBe(403);
    expect((await patch({ internalNote: 'nota do papel administrativo' }, tokenOwner)).status).toBe(403);
    expect((await patch({ tags: ['invasao'] }, tokenOwner)).status).toBe(403);
    expect((await patch({ clinical: { anamnesis: { history: 'anamnese do papel administrativo' } } }, tokenOwner)).status).toBe(403);
    expect((await patch({ clinical: { assessment: { veterinary: { weightKg: 9.9 } } } }, tokenOwner)).status).toBe(403);
    expect((await patch({ clinical: { anamnesis: { history: 'outro profissional' } } }, tokenCaio)).status).toBe(403);
    expect(await snapshot()).toBe(antes);
    expect(await updatesFor()).toHaveLength(0);
  });

  it('o profissional responsável grava retorno estruturado e arquivos (caminho legítimo)', async () => {
    const versao = await versionOf();
    const retorno = await patch({ followUpMode: 'interval', followUpDays: 30 }, tokenMichelle);
    expect(retorno.status).toBe(200);
    let row = (await readDB()).encounters.find((e) => e.id === encounterId)!;
    expect(row.followUpMode).toBe('interval');
    expect(row.followUpDays).toBe(30);
    expect(Number(row.version)).toBe(versao + 1);

    const data = await patch({ followUpMode: 'date', followUpDate: '2026-12-01' }, tokenMichelle);
    expect(data.status).toBe(200);
    row = (await readDB()).encounters.find((e) => e.id === encounterId)!;
    expect(row.followUpMode).toBe('date');
    expect(row.followUpDate).toBe('2026-12-01');

    const arquivos = await patch({ files: ARQUIVO }, tokenMichelle);
    expect(arquivos.status).toBe(200);
    row = (await readDB()).encounters.find((e) => e.id === encounterId)!;
    expect(row.files).toHaveLength(1);
    expect(row.files![0].id).toBe('f-exame-1');

    // O Owner continua LENDO (leitura não é escrita de conteúdo).
    const leitura = await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&id=${encounterId}`, undefined, tokenOwner, 'GET'));
    expect(leitura.status).toBe(200);
    const corpo = await json(leitura);
    expect(corpo.encounter.files[0].id).toBe('f-exame-1');
    expect(corpo.encounter.access.canEditCore).toBe(false);
  });

  it('a vertical continua isolando o módulo vet (odonto não grava clinical)', async () => {
    const db = await readDB();
    db.businesses.find((b) => b.id === BIZ)!.clinicType = 'odontologica';
    await writeDB(db);
    const antes = await snapshot();
    expect((await patch({ clinical: { anamnesis: { history: 'não deve gravar' } } }, tokenMichelle)).status).toBe(400);
    expect((await patch({ clinical: { assessment: { veterinary: { weightKg: 7 } } } }, tokenMichelle)).status).toBe(400);
    expect(await snapshot()).toBe(antes);
    expect(await updatesFor()).toHaveLength(0);
    // O CORE segue editável pelo responsável — a vertical desliga o módulo.
    expect((await patch({ complaint: 'Queixa no CORE da odonto' }, tokenMichelle)).status).toBe(200);
  });
});

describe('F1B1 · P2 — auditoria clínica granular', () => {
  const lastFields = async (): Promise<string[]> => {
    const entries = await updatesFor();
    return (entries[entries.length - 1]?.meta?.fields || []) as string[];
  };

  it('campo do núcleo é registrado pelo nome físico', async () => {
    expect((await patch({ evolution: 'Evolução da consulta.' }, tokenMichelle)).status).toBe(200);
    expect(await lastFields()).toEqual(['evolution']);
    expect((await patch({ followUpMode: 'interval', followUpDays: 30 }, tokenMichelle)).status).toBe(200);
    expect(await lastFields()).toEqual(['followUpMode', 'followUpDays']);
    expect((await patch({ files: ARQUIVO }, tokenMichelle)).status).toBe(200);
    expect(await lastFields()).toEqual(['files']);
  });

  it('anamnese e avaliação entram com o caminho granular do campo', async () => {
    expect((await patch({ clinical: { anamnesis: { appetite: 'changed' } } }, tokenMichelle)).status).toBe(200);
    expect(await lastFields()).toEqual(['clinical.anamnesis.appetite']);

    expect((await patch({ clinical: { assessment: { veterinary: { temperatureC: 38.4 } } } }, tokenMichelle)).status).toBe(200);
    expect(await lastFields()).toEqual(['clinical.assessment.veterinary.temperatureC']);

    // Vários campos de uma vez: um caminho por campo, sem duplicata.
    expect((await patch({
      clinical: {
        anamnesis: { history: 'Coceira há 3 dias.', allergiesReported: 'Ração de frango (relatada).' },
        assessment: { veterinary: { weightKg: 8.9, hydration: 'Normohidratada' } },
      },
    }, tokenMichelle)).status).toBe(200);
    expect(await lastFields()).toEqual([
      'clinical.anamnesis.history',
      'clinical.anamnesis.allergiesReported',
      'clinical.assessment.veterinary.weightKg',
      'clinical.assessment.veterinary.hydration',
    ]);
  });

  it('núcleo + clínico no MESMO PATCH: as duas granularidades juntas, sem duplicata', async () => {
    const res = await patch({
      evolution: 'Evolução registrada.',
      clinical: { anamnesis: { appetite: 'changed' }, assessment: { veterinary: { temperatureC: 38.5 } } },
    }, tokenMichelle);
    expect(res.status).toBe(200);
    const fields = await lastFields();
    expect(fields).toEqual([
      'evolution', 'clinical.anamnesis.appetite', 'clinical.assessment.veterinary.temperatureC',
    ]);
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields).not.toContain('clinical');   // granularidade disponível ⇒ nunca coarse
  });

  it('auditoria só após persistência REAL: sem mudança, sem versão e sem registro', async () => {
    expect((await patch({ clinical: { anamnesis: { appetite: 'changed' } } }, tokenMichelle)).status).toBe(200);
    const versao = await versionOf();
    const total = (await updatesFor()).length;
    // Reenvio idêntico (o autosave faz isso): nada muda, nada é auditado.
    expect((await patch({ clinical: { anamnesis: { appetite: 'changed' } } }, tokenMichelle)).status).toBe(200);
    expect(await versionOf()).toBe(versao);
    expect((await updatesFor()).length).toBe(total);
  });

  it('legado sem o campo normaliza na leitura; auditoria NUNCA cai no rótulo coarse', async () => {
    const db = await readDB();
    delete (db.encounters.find((e) => e.id === encounterId) as any).clinical;
    await writeDB(db);
    // A camada de persistência materializa a estrutura VAZIA em toda leitura:
    // é por isso que a granularidade do merge é completa e o "clinical" coarse
    // não tem mais razão de existir na auditoria.
    expect((await readDB()).encounters.find((e) => e.id === encounterId)!.clinical).toEqual(EMPTY_ENCOUNTER_CLINICAL);
    const versao = await versionOf();
    // Payload idêntico ao padrão: nada mudou de fato → sem versão e sem auditoria.
    expect((await patch({ clinical: { anamnesis: { appetite: 'not_reported' } } }, tokenMichelle)).status).toBe(200);
    expect(await versionOf()).toBe(versao);
    expect(await updatesFor()).toHaveLength(0);
    // A primeira escrita REAL já nasce granular.
    expect((await patch({ clinical: { anamnesis: { diet: 'Ração seca habitual.' } } }, tokenMichelle)).status).toBe(200);
    expect(await lastFields()).toEqual(['clinical.anamnesis.diet']);
    for (const entry of await updatesFor()) {
      expect(entry.meta?.fields).not.toContain('clinical');
    }
  });

  it('a tentativa recusada não cria auditoria nem em vertical CORE-only', async () => {
    const db = await readDB();
    db.businesses.find((b) => b.id === BIZ)!.clinicType = 'estetica';
    await writeDB(db);
    expect((await patch({ clinical: { anamnesis: { history: 'x' } } }, tokenOwner)).status).toBe(403);
    expect(await updatesFor()).toHaveLength(0);
    expect(await versionOf()).toBe(1);
  });
});
