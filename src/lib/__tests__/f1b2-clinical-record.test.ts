// ═══════════════════════════════════════════════════════════════
// F1B2 · PROBLEMAS / HIPÓTESES / DIAGNÓSTICOS · CONDUTA · PROCEDIMENTOS
// ═══════════════════════════════════════════════════════════════
// Travas desta entrega:
//   • os três blocos vivem no MESMO Encounter (`Encounter.clinical`), com a
//     MESMA versão compartilhada (B1 → B2 sem 409 interno);
//   • identidade ESTÁVEL por item (o índice do array nunca é identidade);
//   • servidor valida tipo, textos, duplicidade de id, teto técnico e chave
//     desconhecida (400) — payload parcial preserva as outras seções;
//   • escrita só do profissional responsável (Owner sem vínculo / Recepção /
//     outro profissional / cross-tenant não escrevem);
//   • vertical: o pacote B2 é veterinário nesta fase e NÃO vaza;
//   • procedimento NÃO gera efeito financeiro/estoque/pedido/comissão e não
//     exige Service do catálogo (procedimento custom é o caso normal);
//   • legado sem os campos novos normaliza vazio (nada derivado de texto velho).
import './helpers/temp-db';

import fs from 'node:fs';
import { describe, expect, it, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, writeDB } from '../db';
import { createSession } from '../auth';
import { GET as encountersGET, POST as encountersPOST, PATCH as encountersPATCH } from '@/app/api/encounters/route';
import {
  CLINICAL_ITEM_ID_PATTERN, CLINICAL_LIST_LIMITS, CLINICAL_PLAN_LIMITS,
  CLINICAL_PROBLEM_KINDS, applyEncounterClinicalPatch, newClinicalItemId,
  normalizeEncounterClinical,
} from '../encounter-clinical';
import { availableEncounterSections, clinicalBranchesForClinic } from '../encounter-sections';
import type { Business, DB, Encounter } from '../types';
import { TEMP_DB_FILE } from './helpers/temp-db';

const NOW = '2026-10-04T12:00:00.000Z';
const BIZ = 'biz-f1b2';
const OTHER = 'biz-f1b2-outra';
const OWNER = 'owner-f1b2';
const MICHELLE_USER = 'user-michelle-f1b2';
const CAIO_USER = 'user-caio-f1b2';
const MARIA_USER = 'user-maria-f1b2';
const OUTRA_USER = 'user-outra-f1b2';
const PET = 'pet-mel-f1b2';
const TUTOR = 'ct-isabelle-f1b2';

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

async function seed() {
  const db: DB = emptyDB();
  db.users.push(
    { id: OWNER, name: 'Dona Unidade', email: 'owner@f1b2.test', passwordHash: 'x', createdAt: NOW, role: 'owner' },
    { id: MICHELLE_USER, name: 'Michelle', email: 'michelle@f1b2.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
    { id: CAIO_USER, name: 'Caio', email: 'caio@f1b2.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
    { id: MARIA_USER, name: 'Maria', email: 'maria@f1b2.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
    { id: OUTRA_USER, name: 'Vet de fora', email: 'outra@f1b2.test', passwordHash: 'x', createdAt: NOW, role: 'admin' },
  );
  db.businesses.push(business(BIZ), business(OTHER, OUTRA_USER));
  db.members.push(
    { id: 'm-michelle', businessId: BIZ, userId: MICHELLE_USER, role: 'PROFISSIONAL', permissions: {}, active: true, note: '', invitedBy: OWNER, createdAt: NOW, updatedAt: NOW },
    { id: 'm-caio', businessId: BIZ, userId: CAIO_USER, role: 'PROFISSIONAL', permissions: {}, active: true, note: '', invitedBy: OWNER, createdAt: NOW, updatedAt: NOW },
    { id: 'm-maria', businessId: BIZ, userId: MARIA_USER, role: 'SECRETARIA', permissions: {}, active: true, note: '', invitedBy: OWNER, createdAt: NOW, updatedAt: NOW },
  );
  db.professionals.push(
    { id: 'pro-michelle', businessId: BIZ, name: 'Michelle', role: 'Veterinária', photo: '', active: true, userId: MICHELLE_USER, followsBusinessHours: true, createdAt: NOW } as any,
    { id: 'pro-caio', businessId: BIZ, name: 'Caio', role: 'Veterinário', photo: '', active: true, userId: CAIO_USER, followsBusinessHours: true, createdAt: NOW } as any,
    { id: 'pro-fora', businessId: OTHER, name: 'Vet de fora', role: '', photo: '', active: true, userId: OUTRA_USER, followsBusinessHours: true, createdAt: NOW } as any,
  );
  db.services.push({ id: 'svc-dermato', businessId: BIZ, name: 'Consulta dermatológica', durationMin: 30, price: 18000, description: '', active: true, bookable: true, professionalIds: [], createdAt: NOW, updatedAt: NOW } as any);
  db.contacts.push({ id: TUTOR, businessId: BIZ, name: 'Isabelle', phone: '11999990002', customerId: '', createdAt: NOW } as any);
  db.pets.push({
    id: PET, businessId: BIZ, tutorId: TUTOR, name: 'Mel', photo: '', species: 'cachorro', breed: 'SRD',
    sex: 'F', birthDate: '2024-01-01', weightKg: 8.4, notes: '', active: true, createdAt: NOW, updatedAt: NOW,
  } as any);
  db.bookings.push({
    id: 'bk-f1b2', businessId: BIZ, customerId: '', serviceId: 'svc-dermato', professionalId: 'pro-michelle',
    petId: PET, date: '2026-10-04', time: '15:00', customerName: 'Isabelle', customerPhone: '11999990002',
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

async function openEncounter(tk = tokenMichelle, bookingId = 'bk-f1b2') {
  const res = await encountersPOST(jsonReq('/api/encounters', { businessId: BIZ, bookingId }, tk));
  expect(res.status).toBe(200);
  return (await json(res)).encounter;
}

async function patch(payload: Record<string, unknown>, tk: string, version?: number) {
  const current = (await readDB()).encounters.find((e) => e.id === encounterId);
  const expectedVersion = version ?? (current ? Number(current.version) || 1 : 1);
  return encountersPATCH(jsonReq('/api/encounters', {
    businessId: BIZ, id: encounterId, expectedVersion, ...payload,
  }, tk, 'PATCH'));
}

const row = async (): Promise<Encounter> => (await readDB()).encounters.find((e) => e.id === encounterId)!;
const snapshot = async (): Promise<string> => JSON.stringify(await row());
const versionOf = async (): Promise<number> => Number((await row()).version) || 1;
const updatesFor = async () => (await readDB()).audit.filter(
  (entry) => entry.action === 'encounter.updated' && entry.meta?.encounterId === encounterId,
);
const lastFields = async (): Promise<string[]> => {
  const entries = await updatesFor();
  return (entries[entries.length - 1]?.meta?.fields || []) as string[];
};
/** Fotografia do que NÃO pode ser tocado por registro clínico (efeito colateral). */
const sideEffects = async () => {
  const db = await readDB();
  return JSON.stringify({
    orders: db.orders, products: db.products, financeEntries: db.financeEntries, tasks: db.tasks,
    bookings: db.bookings.map((b) => ({ id: b.id, status: b.status, items: (b as any).items })),
  });
};

const PROBLEMS = [
  { id: 'prb-1', kind: 'hypothesis' as const, label: 'Dermatite alérgica', notes: 'Suspeita pela sazonalidade.' },
  { id: 'prb-2', kind: 'diagnosis' as const, label: 'Otite externa', notes: '' },
];
const PROCEDURES = [
  { id: 'proc-1', name: 'Limpeza auricular', notes: 'Bilateral.' },
  { id: 'proc-2', name: 'Curativo simples', notes: '' },
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

describe('F1B2 · modelo e normalização (regra pura)', () => {
  it('legado sem problems/plan/procedures normaliza VAZIO (nada derivado de texto antigo)', () => {
    const legacy = { anamnesis: { history: 'Coceira há 3 dias' } };
    const normalized = normalizeEncounterClinical(legacy);
    expect(normalized.problems).toEqual([]);
    expect(normalized.plan).toEqual({ conduct: '' });
    expect(normalized.procedures).toEqual([]);
    // Evolução/história NÃO viram diagnóstico nem procedimento inventado.
    expect(JSON.stringify(normalized.problems)).not.toContain('Coceira');
    expect(normalized.anamnesis.history).toBe('Coceira há 3 dias');
  });

  it('ids estáveis: gerados no cliente, dentro do contrato aceito pelo servidor', () => {
    const a = newClinicalItemId('prb');
    const b = newClinicalItemId('prb');
    expect(a).not.toBe(b);
    expect(CLINICAL_ITEM_ID_PATTERN.test(a)).toBe(true);
    expect(a.startsWith('prb-')).toBe(true);
    expect(newClinicalItemId('proc').startsWith('proc-')).toBe(true);
    // O índice do array nunca é identidade: reordenar preserva os ids.
    const reordered = [...PROBLEMS].reverse();
    expect(reordered.map((item) => item.id)).toEqual(['prb-2', 'prb-1']);
  });

  it('limites técnicos declarados (texto/teto de itens/conduta)', () => {
    expect(CLINICAL_LIST_LIMITS.problems.maxItems).toBe(30);
    expect(CLINICAL_LIST_LIMITS.procedures.maxItems).toBe(40);
    expect(CLINICAL_PLAN_LIMITS.conduct).toBe(4000);
    expect([...CLINICAL_PROBLEM_KINDS]).toEqual(['problem', 'hypothesis', 'diagnosis']);
  });
});

describe('F1B2 · problemas / hipóteses / diagnósticos', () => {
  it('adicionar, editar e remover persistem no MESMO Encounter', async () => {
    expect((await patch({ clinical: { problems: PROBLEMS } }, tokenMichelle)).status).toBe(200);
    let saved = await row();
    expect(saved.clinical!.problems).toHaveLength(2);
    expect(saved.clinical!.problems[0].kind).toBe('hypothesis');
    expect(saved.clinical!.problems[1].kind).toBe('diagnosis');

    // Editar UM item (identidade preservada, o outro intacto).
    const edited = [{ ...PROBLEMS[0], label: 'Dermatite alérgica alimentar' }, PROBLEMS[1]];
    expect((await patch({ clinical: { problems: edited } }, tokenMichelle)).status).toBe(200);
    saved = await row();
    expect(saved.clinical!.problems[0].id).toBe('prb-1');
    expect(saved.clinical!.problems[0].label).toBe('Dermatite alérgica alimentar');
    expect(saved.clinical!.problems[1].label).toBe('Otite externa');

    // Remover UM item.
    expect((await patch({ clinical: { problems: [PROBLEMS[1]] } }, tokenMichelle)).status).toBe(200);
    saved = await row();
    expect(saved.clinical!.problems.map((item) => item.id)).toEqual(['prb-2']);

    // Reordenar NÃO troca identidade.
    expect((await patch({ clinical: { problems: PROBLEMS } }, tokenMichelle)).status).toBe(200);
    expect((await patch({ clinical: { problems: [...PROBLEMS].reverse() } }, tokenMichelle)).status).toBe(200);
    saved = await row();
    expect(saved.clinical!.problems.map((item) => item.id)).toEqual(['prb-2', 'prb-1']);
    expect(saved.clinical!.problems[0].label).toBe('Otite externa');
  });

  it('tipo inválido, id duplicado e id malformado são recusados (400) sem gravar', async () => {
    const antes = await snapshot();
    const badKind = await patch({
      clinical: { problems: [{ id: 'prb-9', kind: 'suspeita', label: 'Tipo inventado' }] },
    }, tokenMichelle);
    expect(badKind.status).toBe(400);
    expect((await json(badKind)).error).toMatch(/tipo válido/i);

    const dupId = await patch({
      clinical: {
        problems: [
          { id: 'prb-1', kind: 'problem', label: 'Um' },
          { id: 'prb-1', kind: 'diagnosis', label: 'Dois' },
        ],
      },
    }, tokenMichelle);
    expect(dupId.status).toBe(400);
    expect((await json(dupId)).error).toMatch(/duplicad/i);

    const badId = await patch({
      clinical: { problems: [{ id: '1-índice-do-array', kind: 'problem', label: 'Id inválido' }] },
    }, tokenMichelle);
    expect(badId.status).toBe(400);

    const notArray = await patch({ clinical: { problems: { id: 'prb-1' } } }, tokenMichelle);
    expect(notArray.status).toBe(400);

    const unknownKey = await patch({
      clinical: { problems: [{ id: 'prb-1', kind: 'problem', label: 'Com campo estranho', cid10: 'H60' }] },
    }, tokenMichelle);
    expect(unknownKey.status).toBe(400);

    const emptyLabel = await patch({
      clinical: { problems: [{ id: 'prb-1', kind: 'problem', label: '   ' }] },
    }, tokenMichelle);
    expect(emptyLabel.status).toBe(400);

    expect(await snapshot()).toBe(antes);                    // nada gravado
    expect((await row()).clinical!.problems).toEqual([]);
    expect(await updatesFor()).toHaveLength(0);
  });

  it('payload parcial preserva as outras seções (anamnese/avaliação/conduta intactas)', async () => {
    expect((await patch({ clinical: { anamnesis: { history: 'Coceira há 3 dias.' } } }, tokenMichelle)).status).toBe(200);
    expect((await patch({ clinical: { assessment: { veterinary: { weightKg: 8.9 } } } }, tokenMichelle)).status).toBe(200);
    expect((await patch({ clinical: { plan: { conduct: 'Tratamento tópico por 14 dias.' } } }, tokenMichelle)).status).toBe(200);

    expect((await patch({ clinical: { problems: PROBLEMS } }, tokenMichelle)).status).toBe(200);
    const saved = await row();
    expect(saved.clinical!.anamnesis.history).toBe('Coceira há 3 dias.');
    expect(saved.clinical!.assessment.veterinary.weightKg).toBe(8.9);
    expect(saved.clinical!.plan.conduct).toBe('Tratamento tópico por 14 dias.');

    // E o caminho inverso: gravar conduta não apaga os problemas.
    expect((await patch({ clinical: { plan: { conduct: 'Reavaliar em 15 dias.' } } }, tokenMichelle)).status).toBe(200);
    const after = await row();
    expect(after.clinical!.problems).toHaveLength(2);
    expect(after.clinical!.plan.conduct).toBe('Reavaliar em 15 dias.');
  });

  it('teto técnico de itens é recusado (não trunca em silêncio)', async () => {
    const many = Array.from({ length: CLINICAL_LIST_LIMITS.problems.maxItems + 1 }, (_, index) => ({
      id: `prb-${index}`, kind: 'problem' as const, label: `Problema ${index}`, notes: '',
    }));
    const res = await patch({ clinical: { problems: many } }, tokenMichelle);
    expect(res.status).toBe(400);
    expect((await json(res)).error).toMatch(/até 30/i);
    expect((await row()).clinical!.problems).toEqual([]);
  });
});

describe('F1B2 · conduta (plano clínico)', () => {
  it('persiste o plano e NÃO duplica evolution/guidance/followUp', async () => {
    expect((await patch({
      evolution: 'Paciente apresentou eritema em orelha direita.',
      guidance: 'Manter orelha seca; colar elisabetano por 7 dias.',
      followUpMode: 'interval', followUpDays: 15,
    }, tokenMichelle)).status).toBe(200);
    expect((await patch({ clinical: { plan: { conduct: 'Tratamento tópico por 14 dias; solicitar citologia.' } } }, tokenMichelle)).status).toBe(200);

    const saved = await row();
    expect(saved.clinical!.plan.conduct).toBe('Tratamento tópico por 14 dias; solicitar citologia.');
    // Evolução continua sendo o que ACONTECEU; nada foi copiado entre campos.
    expect(saved.evolution).toBe('Paciente apresentou eritema em orelha direita.');
    expect(saved.guidance).toBe('Manter orelha seca; colar elisabetano por 7 dias.');
    expect(saved.followUpMode).toBe('interval');
    expect(saved.followUpDays).toBe(15);
    expect(saved.clinical!.plan.conduct).not.toBe(saved.evolution);
    expect(saved.clinical!.plan.conduct).not.toBe(saved.guidance);
  });

  it('texto longo é truncado no limite técnico e conduta inválida é recusada', async () => {
    const long = 'x'.repeat(CLINICAL_PLAN_LIMITS.conduct + 500);
    expect((await patch({ clinical: { plan: { conduct: long } } }, tokenMichelle)).status).toBe(200);
    expect((await row()).clinical!.plan.conduct).toHaveLength(CLINICAL_PLAN_LIMITS.conduct);

    const notText = await patch({ clinical: { plan: { conduct: 42 } } }, tokenMichelle);
    expect(notText.status).toBe(400);
    const unknownPlanKey = await patch({ clinical: { plan: { conduct: 'ok', prescription: 'x' } } }, tokenMichelle);
    expect(unknownPlanKey.status).toBe(400);
  });
});

describe('F1B2 · procedimentos realizados', () => {
  it('procedimento CUSTOM (fora do catálogo) é registrado e editado', async () => {
    expect((await patch({ clinical: { procedures: PROCEDURES } }, tokenMichelle)).status).toBe(200);
    let saved = await row();
    expect(saved.clinical!.procedures.map((item) => item.name)).toEqual(['Limpeza auricular', 'Curativo simples']);

    // Nenhum dos dois existe como Service do tenant — e isso não impede nada.
    const services = (await readDB()).services.map((service) => service.name);
    expect(services).toEqual(['Consulta dermatológica']);

    const edited = [{ ...PROCEDURES[0], notes: 'Bilateral, sem secreção.' }, PROCEDURES[1]];
    expect((await patch({ clinical: { procedures: edited } }, tokenMichelle)).status).toBe(200);
    saved = await row();
    expect(saved.clinical!.procedures[0].id).toBe('proc-1');
    expect(saved.clinical!.procedures[0].notes).toBe('Bilateral, sem secreção.');

    // Remover um item.
    expect((await patch({ clinical: { procedures: [PROCEDURES[1]] } }, tokenMichelle)).status).toBe(200);
    expect((await row()).clinical!.procedures.map((item) => item.id)).toEqual(['proc-2']);
  });

  it('NENHUM efeito colateral: sem cobrança, estoque, pedido, comissão ou mudança no agendamento', async () => {
    const antes = await sideEffects();
    expect((await patch({ clinical: { procedures: PROCEDURES } }, tokenMichelle)).status).toBe(200);
    expect(await sideEffects()).toBe(antes);

    const db = await readDB();
    expect(db.orders).toHaveLength(0);
    expect(db.financeEntries).toHaveLength(0);
    expect(db.tasks).toHaveLength(0);
    // O serviço do agendamento NÃO virou procedimento automaticamente.
    expect((await row()).clinical!.procedures.map((item) => item.name)).not.toContain('Consulta dermatológica');
    expect(db.bookings.find((booking) => booking.id === 'bk-f1b2')!.status).toBe('confirmed');
  });

  it('validação: sem nome, id duplicado e chave desconhecida são recusados', async () => {
    const antes = await snapshot();
    expect((await patch({ clinical: { procedures: [{ id: 'proc-1', name: '  ' }] } }, tokenMichelle)).status).toBe(400);
    expect((await patch({
      clinical: { procedures: [{ id: 'proc-1', name: 'A' }, { id: 'proc-1', name: 'B' }] },
    }, tokenMichelle)).status).toBe(400);
    expect((await patch({
      clinical: { procedures: [{ id: 'proc-1', name: 'A', price: 5000 }] },
    }, tokenMichelle)).status).toBe(400);
    expect(await snapshot()).toBe(antes);
    expect((await row()).clinical!.procedures).toEqual([]);
  });
});

describe('F1B2 · versionamento compartilhado (B1 → B2)', () => {
  it('Avaliação salva → Problemas usa a versão NOVA → Conduta → Procedimentos, sem 409 interno', async () => {
    const v0 = await versionOf();
    expect((await patch({ clinical: { assessment: { veterinary: { weightKg: 8.9, temperatureC: 38.4 } } } }, tokenMichelle)).status).toBe(200);
    const v1 = await versionOf();
    expect(v1).toBe(v0 + 1);

    expect((await patch({ clinical: { problems: PROBLEMS } }, tokenMichelle)).status).toBe(200);
    const v2 = await versionOf();
    expect(v2).toBe(v1 + 1);

    expect((await patch({ clinical: { plan: { conduct: 'Tratamento tópico por 14 dias.' } } }, tokenMichelle)).status).toBe(200);
    const v3 = await versionOf();
    expect(v3).toBe(v2 + 1);

    expect((await patch({ clinical: { procedures: PROCEDURES } }, tokenMichelle)).status).toBe(200);
    expect(await versionOf()).toBe(v3 + 1);

    const saved = await row();
    expect(saved.clinical!.assessment.veterinary.weightKg).toBe(8.9);
    expect(saved.clinical!.problems).toHaveLength(2);
    expect(saved.clinical!.plan.conduct).toContain('Tratamento tópico');
    expect(saved.clinical!.procedures).toHaveLength(2);
  });

  it('concorrência EXTERNA continua sendo 409 real (sem merge automático, sem sobrescrita)', async () => {
    expect((await patch({ clinical: { problems: PROBLEMS } }, tokenMichelle)).status).toBe(200);
    const stale = await versionOf();

    // Outra tela grava a conduta com a versão atual.
    expect((await patch({ clinical: { plan: { conduct: 'Gravado em outra tela.' } } }, tokenMichelle)).status).toBe(200);

    // A primeira tela insiste com a versão velha: 409, nada sobrescrito.
    const conflict = await patch({ clinical: { problems: [{ id: 'prb-3', kind: 'problem', label: 'Sobrescrever?' }] } }, tokenMichelle, stale);
    expect(conflict.status).toBe(409);
    const saved = await row();
    expect(saved.clinical!.problems.map((item) => item.id)).toEqual(['prb-1', 'prb-2']);
    expect(saved.clinical!.plan.conduct).toBe('Gravado em outra tela.');

    // Retry com a versão atual grava o texto que estava na tela.
    expect((await patch({ clinical: { problems: [...PROBLEMS, { id: 'prb-3', kind: 'problem', label: 'Sobrescrever?', notes: '' }] } }, tokenMichelle)).status).toBe(200);
    const after = await row();
    expect(after.clinical!.problems).toHaveLength(3);
    expect(after.clinical!.plan.conduct).toBe('Gravado em outra tela.');
  });

  it('auditoria granular por bloco (clinical.problems · clinical.plan.conduct · clinical.procedures)', async () => {
    expect((await patch({ clinical: { problems: PROBLEMS } }, tokenMichelle)).status).toBe(200);
    expect(await lastFields()).toEqual(['clinical.problems']);

    expect((await patch({ clinical: { plan: { conduct: 'Plano registrado.' } } }, tokenMichelle)).status).toBe(200);
    expect(await lastFields()).toEqual(['clinical.plan.conduct']);

    expect((await patch({ clinical: { procedures: PROCEDURES } }, tokenMichelle)).status).toBe(200);
    expect(await lastFields()).toEqual(['clinical.procedures']);

    // Mistos: núcleo + B1 + B2 numa chamada só, sem duplicata e sem rótulo coarse.
    expect((await patch({
      evolution: 'Evolução registrada.',
      clinical: { anamnesis: { appetite: 'changed' }, problems: [PROBLEMS[1]], plan: { conduct: 'Reavaliar.' } },
    }, tokenMichelle)).status).toBe(200);
    const fields = await lastFields();
    expect(fields).toEqual([
      'evolution', 'clinical.anamnesis.appetite', 'clinical.problems', 'clinical.plan.conduct',
    ]);
    expect(new Set(fields).size).toBe(fields.length);
    expect(fields).not.toContain('clinical');
    for (const entry of await updatesFor()) {
      expect(entry.meta?.fields).not.toContain('clinical');
    }
  });

  it('reenvio idêntico não sobe versão nem cria auditoria', async () => {
    expect((await patch({ clinical: { problems: PROBLEMS } }, tokenMichelle)).status).toBe(200);
    const versao = await versionOf();
    const total = (await updatesFor()).length;
    expect((await patch({ clinical: { problems: PROBLEMS } }, tokenMichelle)).status).toBe(200);
    expect(await versionOf()).toBe(versao);
    expect((await updatesFor()).length).toBe(total);
  });
});

describe('F1B2 · permissões (servidor, não a UI)', () => {
  const BLOCKED: Array<[string, Record<string, unknown>]> = [
    ['clinical.problems', { clinical: { problems: PROBLEMS } }],
    ['clinical.plan', { clinical: { plan: { conduct: 'Plano de quem não pode.' } } }],
    ['clinical.procedures', { clinical: { procedures: PROCEDURES } }],
  ];

  it('Owner sem vínculo Professional não escreve nenhum bloco B2 (403)', async () => {
    const antes = await snapshot();
    const versao = await versionOf();
    for (const [label, payload] of BLOCKED) {
      const res = await patch(payload, tokenOwner);
      expect(res.status, `Owner → ${label}`).toBe(403);
      expect((await json(res)).error).toMatch(/profissional responsável/i);
    }
    expect(await snapshot()).toBe(antes);
    expect(await versionOf()).toBe(versao);
    expect(await updatesFor()).toHaveLength(0);
  });

  it('Recepção não escreve nenhum bloco B2 (403)', async () => {
    const antes = await snapshot();
    for (const [label, payload] of BLOCKED) {
      expect((await patch(payload, tokenMaria)).status, `Recepção → ${label}`).toBe(403);
    }
    expect(await snapshot()).toBe(antes);
    expect(await updatesFor()).toHaveLength(0);
  });

  it('outro Professional da mesma unidade não escreve (403/404)', async () => {
    const antes = await snapshot();
    for (const [label, payload] of BLOCKED) {
      expect([403, 404], `Caio → ${label}`).toContain((await patch(payload, tokenCaio)).status);
    }
    expect(await snapshot()).toBe(antes);
    expect(await updatesFor()).toHaveLength(0);
  });

  it('cross-tenant não escreve (404) e nada cruza a fronteira', async () => {
    const antes = await snapshot();
    const res = await encountersPATCH(jsonReq('/api/encounters', {
      businessId: OTHER, id: encounterId, expectedVersion: await versionOf(),
      clinical: { problems: PROBLEMS, plan: { conduct: 'outro tenant' }, procedures: PROCEDURES },
    }, tokenOutra, 'PATCH'));
    expect(res.status).toBe(404);
    expect(await snapshot()).toBe(antes);
  });

  it('profissional responsável escreve os três blocos (200)', async () => {
    for (const [, payload] of BLOCKED) {
      expect((await patch(payload, tokenMichelle)).status).toBe(200);
    }
    const saved = await row();
    expect(saved.clinical!.problems).toHaveLength(2);
    expect(saved.clinical!.plan.conduct).toContain('Plano');
    expect(saved.clinical!.procedures).toHaveLength(2);
  });

  it('sem Pet válido no tenant, os blocos B2 também ficam bloqueados (409)', async () => {
    const db = await readDB();
    delete (db.encounters.find((e) => e.id === encounterId) as any).petId;
    await writeDB(db);
    for (const [label, payload] of BLOCKED) {
      const res = await patch(payload, tokenMichelle);
      expect(res.status, `sem Pet → ${label}`).toBe(409);
    }
    expect((await row()).clinical!.problems).toEqual([]);
  });

  it('a leitura devolve as capacidades B2 resolvidas no SERVIDOR', async () => {
    const asMichelle = await json(await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&id=${encounterId}`, undefined, tokenMichelle, 'GET')));
    expect(asMichelle.encounter.access).toMatchObject({
      canEditCore: true, canEditClinicalProblems: true, canEditCarePlan: true, canEditClinicalProcedures: true,
    });
    const asOwner = await json(await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&id=${encounterId}`, undefined, tokenOwner, 'GET')));
    expect(asOwner.encounter.access).toMatchObject({
      canEditClinicalProblems: false, canEditCarePlan: false, canEditClinicalProcedures: false,
      reason: 'professional_required',
    });
  });
});

describe('F1B2 · isolamento por vertical (pacote B2 é veterinário nesta fase)', () => {
  it('VET liga as seis seções; odonto/estética/médica/geral continuam SÓ com Atendimento', () => {
    expect(availableEncounterSections('veterinaria').map((section) => section.id)).toEqual([
      'atendimento', 'anamnese', 'avaliacao', 'problemas', 'conduta', 'procedimentos',
    ]);
    for (const clinicType of ['odontologica', 'estetica', 'medica', 'geral', undefined, 'pizzaria']) {
      expect(availableEncounterSections(clinicType).map((section) => section.id), String(clinicType)).toEqual(['atendimento']);
      expect(clinicalBranchesForClinic(clinicType), String(clinicType)).toEqual([]);
    }
  });

  it('ODONTO: o servidor recusa os três blocos B2 (400) e o CORE segue editável', async () => {
    const db = await readDB();
    db.businesses.find((b) => b.id === BIZ)!.clinicType = 'odontologica';
    await writeDB(db);
    const antes = await snapshot();

    expect((await patch({ clinical: { problems: PROBLEMS } }, tokenMichelle)).status).toBe(400);
    expect((await patch({ clinical: { plan: { conduct: 'não deve gravar' } } }, tokenMichelle)).status).toBe(400);
    expect((await patch({ clinical: { procedures: PROCEDURES } }, tokenMichelle)).status).toBe(400);
    expect(await snapshot()).toBe(antes);
    expect(await updatesFor()).toHaveLength(0);

    expect((await patch({ complaint: 'Queixa no CORE da odonto' }, tokenMichelle)).status).toBe(200);
    expect((await row()).complaint).toBe('Queixa no CORE da odonto');
  });

  it('esconder a vertical NÃO apaga dado B2 já gravado', async () => {
    expect((await patch({
      clinical: { problems: PROBLEMS, plan: { conduct: 'Tratamento tópico.' }, procedures: PROCEDURES },
    }, tokenMichelle)).status).toBe(200);

    const db = await readDB();
    db.businesses.find((b) => b.id === BIZ)!.clinicType = 'estetica';
    await writeDB(db);

    const leitura = await json(await encountersGET(jsonReq(`/api/encounters?businessId=${BIZ}&id=${encounterId}`, undefined, tokenMichelle, 'GET')));
    expect(leitura.encounter.clinicType).toBe('estetica');
    expect(leitura.encounter.clinical.problems).toHaveLength(2);
    expect(leitura.encounter.clinical.plan.conduct).toBe('Tratamento tópico.');
    expect(leitura.encounter.clinical.procedures).toHaveLength(2);
    expect(leitura.encounter.access.canEditClinicalProblems).toBe(false);

    // Escrita recusada E o dado anterior permanece byte a byte.
    expect((await patch({ clinical: { problems: [] } }, tokenMichelle)).status).toBe(400);
    const after = await row();
    expect(after.clinical!.problems).toHaveLength(2);
    expect(after.clinical!.procedures).toHaveLength(2);

    // De volta à vertical veterinária, tudo continua no lugar.
    const db2 = await readDB();
    db2.businesses.find((b) => b.id === BIZ)!.clinicType = 'veterinaria';
    await writeDB(db2);
    expect(availableEncounterSections('veterinaria').map((s) => s.id)).toContain('problemas');
    expect((await row()).clinical!.problems.map((item) => item.label)).toEqual(['Dermatite alérgica', 'Otite externa']);
  });
});

describe('F1B2 · regra pura de validação (applyEncounterClinicalPatch)', () => {
  const current = normalizeEncounterClinical(undefined);

  it('aceita os três ramos novos e recusa chave desconhecida', () => {
    expect(applyEncounterClinicalPatch(current, { problems: PROBLEMS }).ok).toBe(true);
    expect(applyEncounterClinicalPatch(current, { plan: { conduct: 'x' } }).ok).toBe(true);
    expect(applyEncounterClinicalPatch(current, { procedures: PROCEDURES }).ok).toBe(true);
    const unknown = applyEncounterClinicalPatch(current, { prescription: { drug: 'x' } });
    expect(unknown.ok).toBe(false);
    const future = applyEncounterClinicalPatch(current, { problems: [], attachments: [] });
    expect(future.ok).toBe(false);
  });

  it('lista vazia limpa o bloco (remoção total explícita) e reporta a mudança', () => {
    const withData = applyEncounterClinicalPatch(current, { problems: PROBLEMS, procedures: PROCEDURES });
    expect(withData.ok).toBe(true);
    if (!withData.ok) return;
    const cleared = applyEncounterClinicalPatch(withData.clinical, { problems: [], procedures: [] });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.clinical.problems).toEqual([]);
    expect(cleared.clinical.procedures).toEqual([]);
    expect(cleared.changedFields).toEqual(['clinical.problems', 'clinical.procedures']);
  });

  it('texto acima do limite é truncado (sanitização), tipo inválido é erro', () => {
    const long = applyEncounterClinicalPatch(current, {
      problems: [{ id: 'prb-1', kind: 'problem', label: 'a'.repeat(400), notes: '' }],
    });
    expect(long.ok).toBe(true);
    if (!long.ok) return;
    expect(long.clinical.problems[0].label).toHaveLength(CLINICAL_LIST_LIMITS.problems.label);
    expect(applyEncounterClinicalPatch(current, { problems: [{ id: 'prb-1', kind: 42, label: 'x' }] }).ok).toBe(false);
  });
});
