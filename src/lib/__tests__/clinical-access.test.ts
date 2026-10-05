// ═══════════════════════════════════════════════════════════════
// CLINICAL ACCESS — continuidade assistencial e histórico longitudinal
// ═══════════════════════════════════════════════════════════════
// Prova a decisão de produto desta fase:
//
//   "PACIENTE DA CLÍNICA NÃO É CARTEIRA PARTICULAR DO PROFISSIONAL."
//
// Um Professional ATIVO vinculado a um `businessId`:
//   • LOCALIZA todos os pacientes clínicos da unidade (mesmo sem nunca os
//     ter atendido) — Clientes, Pets e Busca;
//   • LÊ o histórico clínico longitudinal completo (Encounters de Orlando,
//     Michele e qualquer outro profissional da mesma clínica), com autoria;
//   • ABRE o Encounter alheio em READ-ONLY;
//   • ESCREVE somente nos Encounters em que é o responsável (contrato F1).
//
// E, na mesma medida, NÃO recebe: Conversas/WhatsApp, Leads/Oportunidades,
// marketing, financeiro, pedidos/gasto, configurações, agenda de outro
// profissional, fila administrativa da clínica nem dados de conta/login.
//
// Recepção e Owner/Admin NÃO ganham identidade clínica por papel; o tenant
// (`businessId`) é barreira absoluta, provada de forma adversarial (A vs B).
import './helpers/temp-db';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { emptyDB, writeDB, readDB } from '../db';
import { createSession } from '../auth';
import { biz, service, user } from './helpers/automation-fixtures';
import { GET as encGET, POST as encPOST, PATCH as encPATCH } from '@/app/api/encounters/route';
import { GET as contactsGET, PATCH as contactsPATCH } from '@/app/api/contacts/route';
import { GET as petsGET } from '@/app/api/pets/route';
import { GET as p360GET } from '@/app/api/people360/route';
import { GET as searchGET } from '@/app/api/search/route';
import { GET as bookingsGET, PATCH as bookingsPATCH } from '@/app/api/bookings/route';
import { GET as tasksGET } from '@/app/api/tasks/route';
import { GET as convGET } from '@/app/api/conversations/route';
import { GET as overviewGET } from '@/app/api/overview/route';
import { GET as financeGET } from '@/app/api/finance/route';
import { GET as exportFullGET } from '@/app/api/contacts/export-full/route';
import { encounterVersion } from '../encounters';
import { NO_PROFESSIONAL_SCOPE } from '../access-core';
import {
  isLinkedContact, isLinkedPet, operationalScope, patientAccess,
  scopeReadableContacts, scopeReadablePets,
} from '../data-scope';
import type { DB } from '../types';

const NOW = '2026-09-18T12:00:00Z'; // 09:00 em São Paulo
const A = 'b-andrioni';   // clínica A — Pet Isabelle (Orlando → Michele)
const OUT = 'b-bioclin';  // clínica B — outro tenant, nunca alcançável

function req(method: string, path: string, token: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': randomUUID(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
}
const j = (r: Response) => r.json() as Promise<any>;

let T: Record<'owner' | 'maria' | 'orlando' | 'michele' | 'semvinculo' | 'fora', string>;

function encounterFixture(id: string, extra: Record<string, unknown>) {
  return {
    id, businessId: A, bookingId: '', queueId: '', serviceId: 's-consulta', professionalId: 'pro-orlando',
    customerId: '', contactId: 'ct-ana', customerName: 'Tutora Ana', date: '2026-09-10', time: '10:00',
    complaint: '', evolution: '', guidance: '', followUp: '', followUpMode: '', followUpDate: '', followUpDays: 0,
    internalNote: '', tags: [], files: [], petId: 'pet-isabelle', startedAt: NOW, status: 'draft',
    version: 3, createdAt: NOW, updatedAt: NOW, updatedBy: 'u-orlando',
    clinical: {
      anamnesis: { history: 'Histórico da Isabelle', observations: '' },
      problems: [{ id: 'p1', kind: 'diagnosis' as const, label: 'Dermatite', notes: '' }],
      plan: { conduct: 'Tratamento tópico' },
      procedures: [{ id: 'pr1', name: 'Coleta de sangue', notes: '' }],
    },
    ...extra,
  } as any;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  const d: DB = emptyDB();
  d.businesses.push(biz(A, { clinicType: 'veterinaria' } as any), biz(OUT, { clinicType: 'veterinaria' } as any));
  d.users.push(
    user('u-owner', 'Dono da Clínica'), user('u-maria', 'Maria Recepção'),
    user('u-orlando', 'Dr. Orlando'), user('u-michele', 'Dra. Michele'),
    user('u-semvinculo', 'Profissional sem vínculo'),
    user(`owner-${OUT}`, 'Dono Fora'),
  );
  const mem = (id: string, businessId: string, userId: string, role: string, permissions: any = {}) => ({
    id, businessId, userId, role, active: true, permissions, note: '', invitedBy: 'u-owner', createdAt: NOW, updatedAt: NOW,
  } as any);
  d.members.push(
    mem('m-owner', A, 'u-owner', 'OWNER'),
    mem('m-maria', A, 'u-maria', 'SECRETARIA'),
    mem('m-orlando', A, 'u-orlando', 'PROFISSIONAL'),
    mem('m-michele', A, 'u-michele', 'PROFISSIONAL'),
    mem('m-semvinculo', A, 'u-semvinculo', 'PROFISSIONAL'),
    mem('m-fora', OUT, `owner-${OUT}`, 'OWNER'),
  );
  d.professionals.push(
    { id: 'pro-orlando', businessId: A, name: 'Dr. Orlando', role: 'veterinário', photo: '', active: true, userId: 'u-orlando', followBusinessHours: true } as any,
    { id: 'pro-michele', businessId: A, name: 'Dra. Michele', role: 'dermatologia', photo: '', active: true, userId: 'u-michele', followBusinessHours: true } as any,
    // O DONO também atende: a identidade clínica dele vem DESTE vínculo, não
    // do papel OWNER (que só lhe dá a visão administrativa).
    { id: 'pro-owner', businessId: A, name: 'Dona da Clínica', role: 'clínica geral', photo: '', active: true, userId: 'u-owner', followBusinessHours: true } as any,
  );
  d.services.push(service('s-consulta', A, { professionalIds: ['pro-orlando', 'pro-michele'] }), service('s-fora', OUT));
  for (let weekday = 0; weekday < 7; weekday++) {
    d.availability.push({ id: `av${weekday}`, businessId: A, weekday, start: '00:00', end: '23:59', slotMin: 30, professionalId: '', serviceId: '' } as any);
  }
  const contact = (id: string, name: string, phone: string, businessId = A, extra: Record<string, unknown> = {}) => ({
    id, businessId, customerId: '', name, phone, email: '', createdAt: NOW, updatedAt: NOW, source: 'manual',
    lastInteraction: NOW, marketingOptIn: false, note: '', ...extra,
  } as any);
  d.contacts.push(
    contact('ct-ana', 'Tutora Ana', '11911110001', A, { note: 'Observação administrativa do CRM' }),
    contact('ct-bruno', 'Tutor Bruno', '11922220002'),
    // CRM puro: só lead/campanha, sem pegada clínica — NÃO é paciente da clínica.
    contact('ct-lead', 'Contato Só Lead', '11988887777', A, { source: 'campanha' }),
    contact('ct-fora', 'Tutor Fora', '11944440004', OUT),
  );
  const pet = (id: string, name: string, tutorId: string, businessId = A) => ({
    id, businessId, tutorId, name, photo: '', species: 'cachorro', breed: '', sex: '', birthDate: '', weightKg: 0,
    notes: '', active: true, createdAt: NOW, updatedAt: NOW,
  } as any);
  d.pets.push(pet('pet-isabelle', 'Isabelle', 'ct-ana'), pet('pet-thor', 'Thor', 'ct-bruno'), pet('pet-fora', 'Pet Fora', 'ct-fora', OUT));
  const booking = (id: string, extra: Record<string, unknown>) => ({
    id, businessId: A, customerId: '', serviceId: 's-consulta', professionalId: 'pro-orlando',
    date: '2026-09-18', time: '10:00', customerName: 'Tutora Ana', customerPhone: '11911110001',
    status: 'confirmed', note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [], ...extra,
  } as any);
  d.bookings.push(
    booking('bk-orlando', { petId: 'pet-isabelle', date: '2026-09-19' }),
    // Agendamento da PRÓPRIA Michele (retorno do Thor) — vínculo operacional dela.
    booking('bk-michele', { professionalId: 'pro-michele', petId: 'pet-thor', customerName: 'Tutor Bruno', customerPhone: '11922220002', time: '11:00' }),
    { ...booking('bk-fora', { petId: 'pet-fora', customerName: 'Tutor Fora', customerPhone: '11944440004' }), businessId: OUT, professionalId: '', serviceId: 's-fora' },
  );
  d.encounters.push(
    // Orlando atendeu a Isabelle (rascunho em andamento) — paciente da clínica.
    encounterFixture('enc-orlando', { bookingId: 'bk-orlando', evolution: 'Dermatite da Isabelle — Orlando', date: '2026-09-10' }),
    // E um atendimento ANTERIOR finalizado (documento fechado, com revisão).
    encounterFixture('enc-orlando-final', {
      status: 'finalized', date: '2026-08-20', version: 5, evolution: 'Retorno anterior finalizado',
      finalizedAt: NOW, finalizedBy: 'u-orlando', signedBy: 'Dr. Orlando', finalizationRevisionId: 'rev-1',
    }),
    // Michele atendeu o Thor (Encounter PRÓPRIO).
    encounterFixture('enc-michele', {
      professionalId: 'pro-michele', contactId: 'ct-bruno', petId: 'pet-thor', customerName: 'Tutor Bruno',
      evolution: 'Registro da Michele no Thor', date: '2026-09-15', version: 2, updatedBy: 'u-michele',
    }),
    // Encounter do PRÓPRIO dono (que também é profissional vinculado).
    encounterFixture('enc-owner', {
      professionalId: 'pro-owner', contactId: 'ct-bruno', petId: 'pet-thor', customerName: 'Tutor Bruno',
      evolution: 'Registro da dona como profissional', updatedBy: 'u-owner',
    }),
    // Outro TENANT: jamais alcançável pela clínica A.
    { ...encounterFixture('enc-fora', {}), businessId: OUT, professionalId: '', contactId: 'ct-fora', petId: 'pet-fora', customerName: 'Tutor Fora' },
  );
  d.encounterFinalizationRevisions.push({
    id: 'rev-1', businessId: A, encounterId: 'enc-orlando-final', revisionNumber: 1, encounterVersion: 5,
    finalizedAt: NOW, finalizedByUserId: 'u-orlando', finalizedByProfessionalId: 'pro-orlando',
    snapshot: { evolution: 'Retorno anterior finalizado' }, fingerprint: 'fp-1',
  } as any);
  d.tasks.push(
    // Pendência do trabalho do Orlando — a Michele NÃO deve ver (§13).
    { id: 'tk-orlando', businessId: A, title: 'Retorno da Isabelle', note: '', status: 'open', dueAt: '', createdAt: NOW, updatedAt: NOW, doneAt: '', assignedUserId: 'u-orlando', createdBy: 'u-maria', source: 'manual', bookingId: 'bk-orlando' } as any,
    // Pendência da própria Michele.
    { id: 'tk-michele', businessId: A, title: 'Confirmar exame do Thor', note: '', status: 'open', dueAt: '', createdAt: NOW, updatedAt: NOW, doneAt: '', assignedUserId: 'u-michele', createdBy: 'u-maria', source: 'manual', bookingId: 'bk-michele' } as any,
    // Fila administrativa da clínica (sem vínculo com o trabalho dela).
    { id: 'tk-maria', businessId: A, title: 'Conferir caixa', note: '', status: 'open', dueAt: '', createdAt: NOW, updatedAt: NOW, doneAt: '', assignedUserId: 'u-maria', createdBy: 'u-owner', source: 'manual' } as any,
  );
  d.conversations.push(
    // Conversa do paciente do ORLANDO (telefone da Tutora Ana).
    { id: 'cv-ana', businessId: A, channel: 'whatsapp', contactId: '', customerId: '', phone: '11911110001', name: 'Tutora Ana', status: 'open', lastMessageAt: NOW, lastMessagePreview: 'oi', unread: 3, mode: 'automation', createdAt: NOW } as any,
    // Conversa do paciente da MICHELE (telefone do Tutor Bruno) — vínculo dela.
    { id: 'cv-bruno', businessId: A, channel: 'whatsapp', contactId: 'ct-bruno', customerId: '', phone: '11922220002', name: 'Tutor Bruno', status: 'open', lastMessageAt: NOW, lastMessagePreview: 'oi', unread: 1, mode: 'automation', createdAt: NOW } as any,
  );
  d.leads.push(
    { id: 'ld-ana', businessId: A, customerId: '', name: 'Tutora Ana', phone: '11911110001', email: '', origin: 'formulario', status: 'new', stageId: 'new', createdAt: NOW, priority: 'medium', stageHistory: [], interest: '', message: '' } as any,
  );
  d.orders.push(
    { id: 'or-ana', businessId: A, code: 'P1', customerName: 'Tutora Ana', customerPhone: '11911110001', customerId: '', status: 'new', total: 12345, createdAt: NOW, items: [] } as any,
  );
  d.financeEntries.push(
    { id: 'fe-ana', businessId: A, kind: 'receita', description: 'Consulta', amount: 15000, date: '2026-09-10', status: 'pago', createdAt: NOW } as any,
  );
  await writeDB(d);
  T = {
    owner: await createSession('u-owner'),
    maria: await createSession('u-maria'),
    orlando: await createSession('u-orlando'),
    michele: await createSession('u-michele'),
    semvinculo: await createSession('u-semvinculo'),
    fora: await createSession(`owner-${OUT}`),
  };
});
afterEach(() => vi.useRealTimers());

// ═══════════════════════════════════════════════════════════════
// 1 · DOMÍNIO PURO — OPERACIONAL ≠ CLÍNICO
// ═══════════════════════════════════════════════════════════════
describe('Clinical Access · as duas noções são separadas na autoridade única', () => {
  it('patientAccess: papel de atendimento SEM vínculo fecha; vinculado e administração leem a unidade', () => {
    expect(patientAccess({ professionalScope: '' })).toEqual({ level: 'unit', professionalId: '' });
    expect(patientAccess({ professionalScope: 'pro-michele' })).toEqual({ level: 'unit', professionalId: 'pro-michele' });
    expect(patientAccess({ professionalScope: NO_PROFESSIONAL_SCOPE })).toEqual({ level: 'none', professionalId: '' });
  });

  it('o vínculo OPERACIONAL continua mínimo: o paciente da clínica não vira carteira do profissional', async () => {
    const db = await readDB();
    const michele = operationalScope(db, A, { professionalScope: 'pro-michele' });
    // Só o trabalho DELA.
    expect(michele.bookingIds.has('bk-michele')).toBe(true);
    expect(michele.encounterIds.has('enc-michele')).toBe(true);
    expect(michele.contactIds.has('ct-bruno')).toBe(true);
    // Nada do Orlando entra — nem o agendamento, nem o Encounter, nem o pet
    // compartilhado, nem o contato da paciente dele.
    expect(michele.bookingIds.has('bk-orlando')).toBe(false);
    expect(michele.encounterIds.has('enc-orlando')).toBe(false);
    expect(michele.petIds.has('pet-isabelle')).toBe(false);
    expect(michele.contactIds.has('ct-ana')).toBe(false);
    const ctx = { professionalScope: 'pro-michele' };
    expect(isLinkedContact(db, ctx, db.contacts.find((c) => c.id === 'ct-ana')!)).toBe(false);
    expect(isLinkedPet(db, ctx, db.pets.find((p) => p.id === 'pet-isabelle')!)).toBe(false);
  });

  it('a LEITURA clínica alcança a unidade e exclui o CRM puro (contato sem pegada clínica)', async () => {
    const db = await readDB();
    const ctx = { professionalScope: 'pro-michele' };
    const unitContacts = db.contacts.filter((c) => c.businessId === A);
    expect(scopeReadableContacts(db, ctx, unitContacts).map((c) => c.id).sort()).toEqual(['ct-ana', 'ct-bruno']);
    // O dono da unidade continua vendo o CRM inteiro.
    expect(scopeReadableContacts(db, { professionalScope: '' }, unitContacts).map((c) => c.id).sort())
      .toEqual(['ct-ana', 'ct-bruno', 'ct-lead']);
    expect(scopeReadablePets(db, ctx, db.pets.filter((p) => p.businessId === A)).map((p) => p.id).sort())
      .toEqual(['pet-isabelle', 'pet-thor']);
  });

  it('papel de atendimento sem vínculo não lê NADA (fecha por padrão)', async () => {
    const db = await readDB();
    const ctx = { professionalScope: NO_PROFESSIONAL_SCOPE };
    expect(scopeReadableContacts(db, ctx, db.contacts.filter((c) => c.businessId === A))).toEqual([]);
    expect(scopeReadablePets(db, ctx, db.pets.filter((p) => p.businessId === A))).toEqual([]);
  });

  it('tenant primeiro: nenhuma leitura clínica cruza o businessId', async () => {
    const db = await readDB();
    const ctx = { professionalScope: 'pro-michele' };
    expect(scopeReadableContacts(db, ctx, db.contacts.filter((c) => c.businessId === OUT))).toEqual([]);
    expect(scopeReadablePets(db, ctx, db.pets.filter((p) => p.businessId === OUT))).toEqual([]);
    // O MESMO id de escopo não vale em outro tenant (profissional não existe lá).
    expect(scopeReadablePets(db, ctx, [{ id: 'pet-fora', businessId: OUT, tutorId: 'ct-fora' } as any])).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// 2 · A/B/C — localizar, abrir e ler o histórico longitudinal
// ═══════════════════════════════════════════════════════════════
describe('Professional · continuidade assistencial com paciente de outro profissional', () => {
  it('A · Michele localiza a Isabelle ANTES de ter qualquer Encounter próprio', async () => {
    const db = await readDB();
    expect(db.encounters.some((e) => e.professionalId === 'pro-michele' && e.petId === 'pet-isabelle')).toBe(false);
    // Clientes: a tutora aparece na busca do Professional.
    const contacts = await j(await contactsGET(req('GET', `/api/contacts?businessId=${A}&q=Ana`, T.michele)));
    expect((contacts.contacts as any[]).map((c: any) => c.id)).toEqual(['ct-ana']);
    // Pets: o paciente aparece na busca por tutor.
    const pets = await j(await petsGET(req('GET', `/api/pets?businessId=${A}&tutorId=ct-ana`, T.michele)));
    expect((pets.pets as any[]).map((p: any) => p.id)).toEqual(['pet-isabelle']);
    // Busca global: pessoas/pets sim; agenda/conversa alheia não.
    const search = await j(await searchGET(req('GET', `/api/search?businessId=${A}&q=Isabelle`, T.michele)));
    const groups = (search.groups as any[]).map((h: any) => h.group);
    expect(groups).toContain('pets');
    expect(groups).not.toContain('agendamentos');
    expect(groups).not.toContain('conversas');
  });

  it('B · abre o Pet 360 e recebe o tutor básico do cuidado, sem o CRM dele', async () => {
    const p360 = await j(await p360GET(req('GET', `/api/people360?businessId=${A}&q=Ana`, T.michele)));
    const ana = (p360.people as any[]).find((p: any) => p.name === 'Tutora Ana');
    expect(ana).toBeTruthy();
    expect(ana.phone).toBe('11911110001');
    // Nome/telefone/agendamentos do paciente permanecem; o COMERCIAL sai.
    expect(ana.note).toBe('');
    expect(ana.notes).toEqual([]);
    expect(ana.source).toBe('');
    expect(ana.marketingOptIn).toBe(false);
    expect(ana.orders).toBe(0);
    expect(ana.spent).toBe(0);
    expect(ana.leads).toEqual([]);
    expect(ana.conversations).toEqual([]);
    expect(ana.accountEmail).toBe('');
    expect(JSON.stringify(p360)).not.toContain('Observação administrativa do CRM');
  });

  it('C · o histórico da Isabelle é LONGITUDINAL e diz quem atendeu cada visita', async () => {
    const byPet = await j(await encGET(req('GET', `/api/encounters?businessId=${A}&petId=pet-isabelle`, T.michele)));
    expect((byPet.encounters as any[]).map((e: any) => e.id).sort()).toEqual(['enc-orlando', 'enc-orlando-final']);
    const orlando = (byPet.encounters as any[]).find((e: any) => e.id === 'enc-orlando');
    expect(orlando.professionalName).toBe('Dr. Orlando');
    expect(orlando.clinical.problems[0].label).toBe('Dermatite');
    // O mesmo histórico é alcançado pelo tutor (contactId).
    const byContact = await j(await encGET(req('GET', `/api/encounters?businessId=${A}&contactId=ct-ana`, T.michele)));
    expect((byContact.encounters as any[]).map((e: any) => e.id).sort()).toEqual(['enc-orlando', 'enc-orlando-final']);
    // O finalizado abre com revisão/snapshot (F1C intacto).
    const finalRow = (byContact.encounters as any[]).find((e: any) => e.id === 'enc-orlando-final');
    expect(finalRow.status).toBe('finalized');
    const byId = await j(await encGET(req('GET', `/api/encounters?businessId=${A}&id=enc-orlando-final`, T.michele)));
    expect(byId.encounter.finalizationRevisions).toHaveLength(1);
    expect(byId.encounter.finalizationRevisions[0].snapshot.evolution).toBe('Retorno anterior finalizado');
  });
});

// ═══════════════════════════════════════════════════════════════
// 3 · D/E/F — Encounter alheio é READ-ONLY; escrita só do responsável
// ═══════════════════════════════════════════════════════════════
describe('Encounter · leitura clínica da unidade, escrita exclusiva do responsável (F1)', () => {
  it('D · Michele abre o Encounter do Orlando em read-only, sem bypass de payload', async () => {
    const read = await encGET(req('GET', `/api/encounters?businessId=${A}&id=enc-orlando`, T.michele));
    expect(read.status).toBe(200);
    const row = (await j(read)).encounter;
    expect(row.professionalName).toBe('Dr. Orlando');
    expect(row.access.canEditCore).toBe(false);
    expect(row.access.canEditClinicalProblems).toBe(false);
    expect(row.canAddendum).toBe(false);
    // Conteúdo: nenhuma escrita passa — nem texto, nem seção clínica, nem
    // transição de estado, nem auto-declaração de responsável.
    const base = { businessId: A, id: 'enc-orlando', expectedVersion: encounterVersion(row) };
    for (const body of [
      { ...base, evolution: 'invadindo o registro' },
      { ...base, clinical: { problems: [] } },
      { ...base, action: 'finalize' },
      { ...base, evolution: 'x', professionalId: 'pro-orlando', role: 'OWNER' },
    ]) {
      expect((await encPATCH(req('PATCH', '/api/encounters', T.michele, body))).status, JSON.stringify(body)).toBe(403);
    }
    const db = await readDB();
    expect(db.encounters.find((e) => e.id === 'enc-orlando')!.evolution).toBe('Dermatite da Isabelle — Orlando');
    // Finalizado: leitura continua, escrita é 409/403 pelo contrato F1C.
    expect((await encPATCH(req('PATCH', '/api/encounters', T.michele, {
      businessId: A, id: 'enc-orlando-final', expectedVersion: 5, evolution: 'x',
    }))).status).toBe(409);
    expect((await encPATCH(req('PATCH', '/api/encounters', T.michele, {
      businessId: A, id: 'enc-orlando-final', expectedVersion: 5, action: 'addendum', text: 'nota alheia',
    }))).status).toBe(403);
    expect((await encPATCH(req('PATCH', '/api/encounters', T.michele, {
      businessId: A, id: 'enc-orlando-final', expectedVersion: 5, action: 'reopen', reason: 'quero editar',
    }))).status).toBe(403);
  });

  it('E · Michele escreve no PRÓPRIO Encounter e não inicia o atendimento do colega', async () => {
    const patch = await encPATCH(req('PATCH', '/api/encounters', T.michele, {
      businessId: A, id: 'enc-michele', expectedVersion: 2, evolution: 'Evolução da Michele',
    }));
    expect(patch.status).toBe(200);
    expect((await readDB()).encounters.find((e) => e.id === 'enc-michele')!.evolution).toBe('Evolução da Michele');
    // O agendamento da Isabelle é do Orlando: a Michele não assume por cima.
    expect((await encPOST(req('POST', '/api/encounters', T.michele, { businessId: A, bookingId: 'bk-orlando' }))).status).toBe(403);
    // O próprio agendamento (chegada registrada pela Recepção) inicia normal.
    expect((await bookingsPATCH(req('PATCH', '/api/bookings', T.maria, { businessId: A, id: 'bk-michele', action: 'check-in' }))).status).toBe(200);
    const own = await encPOST(req('POST', '/api/encounters', T.michele, { businessId: A, bookingId: 'bk-michele' }));
    expect(own.status).toBe(200);
    expect((await j(own)).encounter.professionalId).toBe('pro-michele');
  });

  it('F · na direção inversa, Orlando lê a Michele em read-only (simetria)', async () => {
    const read = await encGET(req('GET', `/api/encounters?businessId=${A}&id=enc-michele`, T.orlando));
    expect(read.status).toBe(200);
    const row = (await j(read)).encounter;
    expect(row.professionalName).toBe('Dra. Michele');
    expect(row.access.canEditCore).toBe(false);
    expect((await encPATCH(req('PATCH', '/api/encounters', T.orlando, {
      businessId: A, id: 'enc-michele', expectedVersion: 2, evolution: 'x',
    }))).status).toBe(403);
    // O histórico do Thor é longitudinal: traz o da Michele E o da dona (que
    // também atende), cada um com seu autor.
    const byPet = await j(await encGET(req('GET', `/api/encounters?businessId=${A}&petId=pet-thor`, T.orlando)));
    expect((byPet.encounters as any[]).map((e: any) => e.id).sort()).toEqual(['enc-michele', 'enc-owner']);
    expect(byPet.encounters.find((e: any) => e.id === 'enc-owner').professionalName).toBe('Dona da Clínica');
  });

  it('escrita administrativa do CRM não vem com a leitura clínica', async () => {
    // Lê a tutora da Isabelle…
    const contacts = await j(await contactsGET(req('GET', `/api/contacts?businessId=${A}&limit=50`, T.michele)));
    expect((contacts.contacts as any[]).map((c: any) => c.id).sort()).toEqual(['ct-ana', 'ct-bruno']);
    // …mas editar/observar o cadastro alheio continua fora do escopo (404).
    expect((await contactsPATCH(req('PATCH', '/api/contacts', T.michele, { businessId: A, id: 'ct-ana', note: 'x' }))).status).toBe(404);
    expect((await contactsPATCH(req('PATCH', '/api/contacts', T.michele, { businessId: A, id: 'ct-ana', addNote: { text: 'x' } }))).status).toBe(404);
    // O tutor do PRÓPRIO atendimento segue editável.
    expect((await contactsPATCH(req('PATCH', '/api/contacts', T.michele, { businessId: A, id: 'ct-bruno', note: 'ok' }))).status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4 · G/H — agenda e Início continuam "Meu dia"
// ═══════════════════════════════════════════════════════════════
describe('Professional · operação continua exclusiva do profissional', () => {
  it('G · a agenda da Michele é só dela; o paciente aparece como CONTEXTO clínico', async () => {
    const manage = await j(await bookingsGET(req('GET', `/api/bookings?businessId=${A}&mode=manage&from=2026-09-01&to=2026-10-30`, T.michele)));
    expect((manage.bookings as any[]).map((b: any) => b.id)).toEqual(['bk-michele']);
    // Contexto do paciente (Pet 360): os agendamentos DELE na unidade —
    // inclusive os de outro profissional (continuidade), nunca uma listagem geral.
    const isabelle = await j(await bookingsGET(req('GET', `/api/bookings?businessId=${A}&mode=patient&petId=pet-isabelle`, T.michele)));
    expect((isabelle.bookings as any[]).map((b: any) => b.id)).toEqual(['bk-orlando']);
    const thor = await j(await bookingsGET(req('GET', `/api/bookings?businessId=${A}&mode=patient&petId=pet-thor`, T.michele)));
    expect((thor.bookings as any[]).map((b: any) => b.id)).toEqual(['bk-michele']);
    // Sem chave de paciente, `mode=patient` não vira listagem geral.
    expect((await bookingsGET(req('GET', `/api/bookings?businessId=${A}&mode=patient`, T.michele))).status).toBe(400);
  });

  it('H · o Início é o "Meu dia": próximos do profissional, sem agenda alheia', async () => {
    const ov = await j(await overviewGET(req('GET', `/api/overview?businessId=${A}`, T.michele)));
    expect((ov.upcoming as any[]).map((b: any) => b.id)).toEqual(['bk-michele']);
    expect(JSON.stringify(ov)).not.toContain('bk-orlando');
    expect(JSON.stringify(ov)).not.toContain('Dr. Orlando');
  });

  it('Pendências: só as do próprio trabalho (§13), nunca a fila administrativa', async () => {
    const tasks = await j(await tasksGET(req('GET', `/api/tasks?businessId=${A}&status=all`, T.michele)));
    expect((tasks.tasks as any[]).map((t: any) => t.id)).toEqual(['tk-michele']);
    // A Recepção segue operando a fila dela.
    expect((await tasksGET(req('GET', `/api/tasks?businessId=${A}&status=all`, T.maria))).status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// 5 · I/J — nenhum módulo comercial vem com o acesso clínico
// ═══════════════════════════════════════════════════════════════
describe('Professional · módulos comerciais continuam fora', () => {
  it('I · sem permissão de WhatsApp não há Conversas — nem métrica, nem lista', async () => {
    expect((await convGET(req('GET', `/api/conversations?businessId=${A}`, T.michele))).status).toBe(403);
    const ov = await j(await overviewGET(req('GET', `/api/overview?businessId=${A}`, T.michele)));
    expect(ov.whatsapp ?? null).toBeNull();
    // E a busca não tem grupo de conversas.
    const search = await j(await searchGET(req('GET', `/api/search?businessId=${A}&q=Bruno`, T.michele)));
    expect((search.groups as any[]).some((h: any) => h.group === 'conversas')).toBe(false);
  });

  it('I2 · COM permissão de WhatsApp, o recorte ainda é o vínculo real (nunca o paciente do colega)', async () => {
    // Orlando recebe a permissão de WhatsApp por override e continua vendo só
    // as conversas do trabalho dele — nunca a da paciente do colega.
    const db = await readDB();
    const m = db.members.find((x) => x.id === 'm-orlando')!;
    m.permissions = { ...(m.permissions || {}), whatsapp: true };
    await writeDB(db);
    const list = await j(await convGET(req('GET', `/api/conversations?businessId=${A}`, T.orlando)));
    const ids = (list.conversations as any[]).map((c: any) => c.id);
    expect(ids).toContain('cv-ana');
    expect(ids).not.toContain('cv-bruno');
  });

  it('J · Financeiro, pedidos/gasto e a saída completa da base seguem fora', async () => {
    expect((await financeGET(req('GET', `/api/finance?businessId=${A}`, T.michele))).status).toBe(403);
    expect((await exportFullGET(req('GET', `/api/contacts/export-full?businessId=${A}`, T.michele))).status).toBe(403);
    const ov = await j(await overviewGET(req('GET', `/api/overview?businessId=${A}`, T.michele)));
    expect(ov.showMoney).toBe(false);
    // Oportunidades também não: o lead do paciente do Orlando não é da Michele.
    const p360 = await j(await p360GET(req('GET', `/api/people360?businessId=${A}&q=Ana`, T.michele)));
    expect((p360.people as any[]).find((p: any) => p.name === 'Tutora Ana').leads).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// 6 · K — Recepção opera o administrativo, sem escrita clínica
// ═══════════════════════════════════════════════════════════════
describe('Recepção · administrativo preservado, clínico fechado', () => {
  it('K · cadastra, agenda e opera a fila — mas não lê nem escreve o registro clínico', async () => {
    expect((await contactsGET(req('GET', `/api/contacts?businessId=${A}&limit=50`, T.maria))).status).toBe(200);
    expect((await j(await contactsGET(req('GET', `/api/contacts?businessId=${A}&limit=50`, T.maria)))).contacts).toHaveLength(3);
    expect((await petsGET(req('GET', `/api/pets?businessId=${A}`, T.maria))).status).toBe(200);
    expect((await bookingsGET(req('GET', `/api/bookings?businessId=${A}&mode=manage&from=2026-09-01&to=2026-10-30`, T.maria))).status).toBe(200);
    // Clínico: 403 em leitura por id, busca de histórico e escrita.
    expect((await encGET(req('GET', `/api/encounters?businessId=${A}&id=enc-orlando`, T.maria))).status).toBe(403);
    expect((await encGET(req('GET', `/api/encounters?businessId=${A}&petId=pet-isabelle`, T.maria))).status).toBe(403);
    expect((await encPATCH(req('PATCH', '/api/encounters', T.maria, { businessId: A, id: 'enc-orlando', expectedVersion: 3, evolution: 'x' }))).status).toBe(403);
    expect((await encPOST(req('POST', '/api/encounters', T.maria, { businessId: A, bookingId: 'bk-orlando' }))).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7 · L — Owner/Admin: administra a unidade, não assina clínica
// ═══════════════════════════════════════════════════════════════
describe('Owner/Admin · sem identidade clínica automática', () => {
  it('L · lê (regra administrativa) mas não escreve nem finaliza por conta própria', async () => {
    const read = await encGET(req('GET', `/api/encounters?businessId=${A}&id=enc-orlando`, T.owner));
    expect(read.status).toBe(200);
    const row = (await j(read)).encounter;
    expect(row.access.canEditCore).toBe(false);
    expect((await encPATCH(req('PATCH', '/api/encounters', T.owner, {
      businessId: A, id: 'enc-orlando', expectedVersion: 3, evolution: 'assinando pelo profissional',
    }))).status).toBe(403);
    expect((await encPATCH(req('PATCH', '/api/encounters', T.owner, {
      businessId: A, id: 'enc-orlando', expectedVersion: 3, action: 'finalize',
    }))).status).toBe(403);
    expect((await encPATCH(req('PATCH', '/api/encounters', T.owner, {
      businessId: A, id: 'enc-orlando-final', expectedVersion: 5, action: 'addendum', text: 'nota do dono',
    }))).status).toBe(403);
    // A reabertura administrativa do F1C continua existindo — e é AUDITADA,
    // não uma escrita clínica silenciosa.
    expect((await encPATCH(req('PATCH', '/api/encounters', T.owner, {
      businessId: A, id: 'enc-orlando-final', expectedVersion: 5, action: 'reopen', reason: 'correção administrativa',
    }))).status).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// 7b · Owner COM vínculo Professional legítimo — identidade vem do vínculo
// ═══════════════════════════════════════════════════════════════
describe('Owner com Professional legítimo · capacidades da identidade clínica', () => {
  it('L2 · escreve no PRÓPRIO Encounter (não por ser dono) e continua sem escrever o alheio', async () => {
    const own = await encPATCH(req('PATCH', '/api/encounters', T.owner, {
      businessId: A, id: 'enc-owner', expectedVersion: 3, evolution: 'Evolução da dona como profissional',
    }));
    expect(own.status).toBe(200);
    expect((await readDB()).encounters.find((e) => e.id === 'enc-owner')!.evolution)
      .toBe('Evolução da dona como profissional');
    // O Encounter do Orlando continua fechado para escrita — e a leitura
    // administrativa dele não muda isso.
    expect((await encPATCH(req('PATCH', '/api/encounters', T.owner, {
      businessId: A, id: 'enc-orlando', expectedVersion: 3, evolution: 'x',
    }))).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════
// 8 · M — tenant é barreira absoluta (adversarial)
// ═══════════════════════════════════════════════════════════════
describe('Tenant · nada da clínica A alcança a clínica B (e vice-versa)', () => {
  it('M · paciente, pet, Encounter e agenda de outro tenant não existem para a clínica A', async () => {
    expect((await encGET(req('GET', `/api/encounters?businessId=${A}&id=enc-fora`, T.owner))).status).toBe(404);
    expect((await encGET(req('GET', `/api/encounters?businessId=${A}&id=enc-fora`, T.michele))).status).toBe(404);
    expect((await encPATCH(req('PATCH', '/api/encounters', T.michele, { businessId: A, id: 'enc-fora', expectedVersion: 3, evolution: 'x' }))).status).toBe(404);
    const byPet = await j(await encGET(req('GET', `/api/encounters?businessId=${A}&petId=pet-fora`, T.michele)));
    expect(byPet.encounters).toEqual([]);
    expect((await j(await petsGET(req('GET', `/api/pets?businessId=${A}`, T.michele)))).pets.map((p: any) => p.id)).not.toContain('pet-fora');
    const peopleA = await j(await p360GET(req('GET', `/api/people360?businessId=${A}`, T.owner)));
    expect(JSON.stringify(peopleA)).not.toContain('Tutor Fora');
    expect((await contactsGET(req('GET', `/api/contacts?businessId=${A}&q=Fora`, T.owner))).status).toBe(200);
    expect((await j(await contactsGET(req('GET', `/api/contacts?businessId=${A}&q=Fora`, T.owner)))).contacts).toEqual([]);
    // O dono da clínica B não entra na clínica A.
    expect((await encGET(req('GET', `/api/encounters?businessId=${A}&id=enc-orlando`, T.fora))).status).toBe(403);
    expect((await bookingsGET(req('GET', `/api/bookings?businessId=${A}&mode=manage`, T.fora))).status).toBe(403);
    // O contexto do paciente nunca devolve agendamento de outra unidade.
    const patient = await j(await bookingsGET(req('GET', `/api/bookings?businessId=${OUT}&mode=patient&petId=pet-fora`, T.fora)));
    expect((patient.bookings as any[]).map((b: any) => b.id)).toEqual(['bk-fora']);
    expect((patient.bookings as any[]).every((b: any) => b.businessId === OUT)).toBe(true);
  });
});
