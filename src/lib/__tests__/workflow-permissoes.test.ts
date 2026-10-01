// ═══════════════════════════════════════════════════════════════
// WORKFLOW + PERMISSÕES — regras puras e rotas reais
// ═══════════════════════════════════════════════════════════════
// Agendado → Chegou → Em atendimento → Finalizado (+ Cancelado/Faltou/Reagendado)
// e o ESCOPO DE DADOS do Profissional (Clientes, Pets, People 360, busca,
// Oportunidades, Pendências, Conversas, Visão geral, export/import).
// Nenhum teste depende de texto de documentação: só de comportamento.
import './helpers/temp-db';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { emptyDB, writeDB, readDB } from '../db';
import { createSession } from '../auth';
import { biz, service, user } from './helpers/automation-fixtures';
import { PATCH as bookingsPATCH, GET as bookingsGET } from '@/app/api/bookings/route';
import { POST as encPOST, PATCH as encPATCH, GET as encGET } from '@/app/api/encounters/route';
import { GET as contactsGET, POST as contactsPOST, PATCH as contactsPATCH } from '@/app/api/contacts/route';
import { GET as exportGET } from '@/app/api/contacts/export/route';
import { GET as exportFullGET } from '@/app/api/contacts/export-full/route';
import { POST as importPOST } from '@/app/api/contacts/import/route';
import { GET as p360GET } from '@/app/api/people360/route';
import { GET as petsGET, POST as petsPOST } from '@/app/api/pets/route';
import { GET as searchGET } from '@/app/api/search/route';
import { GET as overviewGET } from '@/app/api/overview/route';
import { GET as leadsGET, PATCH as leadsPATCH } from '@/app/api/leads/route';
import { GET as tasksGET, PATCH as tasksPATCH } from '@/app/api/tasks/route';
import { GET as convGET, POST as convPOST } from '@/app/api/conversations/route';
import { POST as queuePOST } from '@/app/api/queue/route';
import { permissionsFor, PERMISSION_IDS } from '../permissions';
import {
  WORKFLOW_STATES, appointmentWorkflowState, canWorkflowTransition, workflowAllowedActions,
  type WorkflowFacts, type WorkflowState,
} from '../appointment-workflow';
import {
  canAccessContact, canAccessPet, scopeContacts, scopePets, scopedDbView,
} from '../data-scope';
import type { DB } from '../types';

const NOW = '2026-09-18T12:00:00Z'; // 09:00 em São Paulo
const B = 'b1';
const OUT = 'b2';

// ── Fábrica de pedidos ───────────────────────────────────────
function req(method: string, path: string, token: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': randomUUID(), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  });
}
const j = (r: Response) => r.json() as Promise<any>;
const patchBooking = (token: string, body: Record<string, unknown>) => bookingsPATCH(req('PATCH', '/api/bookings', token, { businessId: B, ...body }));
const checkIn = (token: string, id: string) => patchBooking(token, { id, action: 'check-in' });
const setStatus = (token: string, id: string, status: string) => patchBooking(token, { id, status });
const startCare = (token: string, bookingId: string) => encPOST(req('POST', '/api/encounters', token, { businessId: B, bookingId }));
async function manage(token: string) {
  const r = await bookingsGET(req('GET', `/api/bookings?businessId=${B}&mode=manage&from=2026-09-01&to=2026-10-30`, token));
  const d = await j(r);
  return Object.fromEntries((d.bookings || []).map((b: any) => [b.id, b])) as Record<string, any>;
}
const dbNow = () => readDB();

let T: Record<'owner' | 'admin' | 'maria' | 'orlando' | 'segundo' | 'fora', string>;

function booking(id: string, extra: Record<string, unknown>) {
  return {
    id, businessId: B, customerId: '', serviceId: 's1', professionalId: 'pro-orlando',
    date: '2026-09-18', time: '14:00', customerName: 'Cliente', customerPhone: '', status: 'confirmed',
    note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [], ...extra,
  } as any;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  const d: DB = emptyDB();
  d.businesses.push(biz(B, { clinicType: 'veterinaria' } as any), biz(OUT));
  d.users.push(
    user('owner-b1', 'Dono'), user('owner-b2', 'Dono Fora'),
    user('u-admin', 'Admin', 'admin'), user('u-maria', 'Maria', 'admin'),
    user('u-orlando', 'Dr. Orlando', 'admin'), user('u-segundo', 'Dra. Segunda', 'admin'),
  );
  const mem = (id: string, userId: string, role: string, permissions: any = {}) => ({
    id, businessId: B, userId, role, active: true, permissions, note: '', invitedBy: 'owner-b1', createdAt: NOW, updatedAt: NOW,
  } as any);
  d.members.push(
    mem('m-admin', 'u-admin', 'ADMIN'),
    mem('m-maria', 'u-maria', 'SECRETARIA'),
    // Orlando recebe, além do padrão, Oportunidades e Conversas: o escopo de
    // dados tem de valer MESMO com a permissão de módulo aberta.
    mem('m-orlando', 'u-orlando', 'PROFISSIONAL', { leads: true, whatsapp: true }),
    mem('m-segundo', 'u-segundo', 'PROFISSIONAL'),
  );
  d.professionals.push(
    { id: 'pro-orlando', businessId: B, name: 'Dr. Orlando', role: '', photo: '', active: true, userId: 'u-orlando', followBusinessHours: true } as any,
    { id: 'pro-segundo', businessId: B, name: 'Dra. Segunda', role: '', photo: '', active: true, userId: 'u-segundo', followBusinessHours: true } as any,
  );
  d.services.push(service('s1', B, { professionalIds: ['pro-orlando', 'pro-segundo'] }), service('s2', OUT));
  for (let weekday = 0; weekday < 7; weekday++) {
    d.availability.push({ id: `a${weekday}`, businessId: B, weekday, start: '00:00', end: '23:59', slotMin: 30, professionalId: '', serviceId: '' } as any);
  }
  const contact = (id: string, name: string, phone: string, businessId = B) => ({
    id, businessId, customerId: '', name, phone, email: '', createdAt: NOW, updatedAt: NOW, source: 'manual',
    lastInteraction: NOW, marketingOptIn: false, note: '',
  } as any);
  d.contacts.push(
    contact('ct-a', 'Tutor Alfa', '11911110001'),
    contact('ct-b', 'Tutor Beta', '11922220002'),
    contact('ct-c', 'Tutor Gama', '11933330003'),
    contact('ct-fora', 'Tutor Fora', '11944440004', OUT),
  );
  const pet = (id: string, name: string, tutorId: string, businessId = B) => ({
    id, businessId, tutorId, name, photo: '', species: 'cachorro', breed: '', sex: '', birthDate: '', weightKg: 0,
    notes: '', active: true, createdAt: NOW, updatedAt: NOW,
  } as any);
  d.pets.push(pet('pet-a', 'Rex Alfa', 'ct-a'), pet('pet-b', 'Mia Beta', 'ct-b'), pet('pet-c', 'Bob Gama', 'ct-c'));
  d.bookings.push(
    booking('bk-a', { petId: 'pet-a', customerName: 'Tutor Alfa', customerPhone: '11911110001' }),
    booking('bk-b', { professionalId: 'pro-segundo', petId: 'pet-b', customerName: 'Tutor Beta', customerPhone: '11922220002', time: '15:00' }),
    booking('bk-past', { petId: 'pet-a', customerName: 'Tutor Alfa', customerPhone: '11911110001', date: '2026-09-17', time: '10:00' }),
    booking('bk-pend', { petId: 'pet-a', customerName: 'Tutor Alfa', customerPhone: '11911110001', date: '2026-09-19', time: '09:00', status: 'pending' }),
    booking('bk-x', { professionalId: 'pro-orlando', customerName: 'Sem pet', customerPhone: '11955550005', time: '16:00' }),
    { ...booking('bk-fora', { serviceId: 's2', professionalId: '' }), businessId: OUT },
  );
  d.leads.push({
    id: 'ld-b', businessId: B, customerId: '', name: 'Tutor Beta', phone: '11922220002', email: '', origin: 'formulario',
    status: 'new', stageId: 'new', createdAt: NOW, priority: 'medium', stageHistory: [], interest: '', message: '',
  } as any, {
    id: 'ld-a', businessId: B, customerId: '', name: 'Tutor Alfa', phone: '11911110001', email: '', origin: 'formulario',
    status: 'new', stageId: 'new', createdAt: NOW, priority: 'medium', stageHistory: [], interest: '', message: '',
  } as any);
  const task = (id: string, bookingId: string) => ({
    id, businessId: B, title: `Tarefa ${id}`, note: '', status: 'open', dueAt: '', createdAt: NOW, updatedAt: NOW,
    doneAt: '', assignedUserId: '', createdBy: 'u-maria', source: 'manual', bookingId,
  } as any);
  d.tasks.push(task('tk-a', 'bk-a'), task('tk-b', 'bk-b'));
  const conv = (id: string, phone: string, name: string) => ({
    id, businessId: B, channel: 'whatsapp', contactId: '', customerId: '', phone, name, status: 'open',
    lastMessageAt: NOW, lastMessagePreview: 'oi', unread: 1, mode: 'automation', createdAt: NOW,
  } as any);
  d.conversations.push(conv('cv-a', '11911110001', 'Tutor Alfa'), conv('cv-b', '11922220002', 'Tutor Beta'));
  d.orders.push({ id: 'or-b', businessId: B, code: 'X1', customerName: 'Tutor Beta', customerPhone: '11922220002', customerId: '', status: 'new', total: 9900, createdAt: NOW, items: [] } as any);
  await writeDB(d);
  T = {
    owner: await createSession('owner-b1'), admin: await createSession('u-admin'), maria: await createSession('u-maria'),
    orlando: await createSession('u-orlando'), segundo: await createSession('u-segundo'), fora: await createSession('owner-b2'),
  };
});
afterEach(() => vi.useRealTimers());

// ═══════════════════════════════════════════════════════════════
// 1 · Regras puras do workflow
// ═══════════════════════════════════════════════════════════════
describe('Workflow · etapa canônica derivada (sem 4ª máquina persistida)', () => {
  const st = (status: string, extra: any = {}) => appointmentWorkflowState({ booking: { status, ...extra.booking } as any, encounter: extra.encounter, queue: extra.queue });
  it('resolve as seis etapas a partir de Booking + Queue + Encounter', () => {
    expect(st('confirmed')).toBe('scheduled');
    expect(st('pending')).toBe('scheduled');
    expect(st('confirmed', { booking: { checkedInAt: NOW } })).toBe('arrived');
    expect(st('confirmed', { queue: { status: 'waiting' } })).toBe('arrived');
    expect(st('confirmed', { queue: { status: 'called' } })).toBe('arrived');
    expect(st('confirmed', { queue: { status: 'in_service' } })).toBe('in_care');
    expect(st('confirmed', { booking: { checkedInAt: NOW }, encounter: { status: 'draft' } })).toBe('in_care');
    expect(st('confirmed', { encounter: { status: 'finalized' } })).toBe('finalized');
    expect(st('completed')).toBe('finalized');
    expect(st('cancelled', { booking: { checkedInAt: NOW } })).toBe('cancelled');
    expect(st('no_show')).toBe('no_show');
  });
  it('transições legais e ilegais', () => {
    const ok: Array<[WorkflowState, WorkflowState]> = [
      ['scheduled', 'arrived'], ['scheduled', 'cancelled'], ['scheduled', 'no_show'],
      ['arrived', 'in_care'], ['arrived', 'scheduled'], ['arrived', 'cancelled'],
      ['in_care', 'finalized'], ['cancelled', 'scheduled'], ['no_show', 'scheduled'],
    ];
    for (const [a, b] of ok) expect(canWorkflowTransition(a, b), `${a}→${b}`).toBe(true);
    const bad: Array<[WorkflowState, WorkflowState]> = [
      ['scheduled', 'in_care'], ['scheduled', 'finalized'], ['arrived', 'no_show'], ['arrived', 'finalized'],
      ['in_care', 'cancelled'], ['in_care', 'no_show'], ['in_care', 'arrived'], ['in_care', 'scheduled'],
      ['finalized', 'cancelled'], ['finalized', 'no_show'], ['finalized', 'in_care'], ['finalized', 'scheduled'],
      ['cancelled', 'arrived'], ['no_show', 'arrived'], ['cancelled', 'finalized'],
    ];
    for (const [a, b] of bad) expect(canWorkflowTransition(a, b), `${a}→${b}`).toBe(false);
    expect(WORKFLOW_STATES).toHaveLength(6);
  });
  it('matriz estado × papel: recepção opera a agenda, nunca a área clínica', () => {
    const f = (state: WorkflowState, o: Partial<WorkflowFacts> = {}): WorkflowFacts => ({ state, status: 'confirmed', overdue: false, hasEncounter: false, hasDraft: false, ...o });
    const recep = { agenda: true, atendimento: false };
    const clin = { agenda: true, atendimento: true };
    expect(workflowAllowedActions(f('scheduled'), recep)).toEqual(['check_in', 'reschedule', 'no_show', 'cancel']);
    expect(workflowAllowedActions(f('arrived'), recep)).toEqual(['check_in_undo', 'reschedule', 'cancel']);
    expect(workflowAllowedActions(f('in_care', { hasEncounter: true, hasDraft: true }), recep)).toEqual([]);
    expect(workflowAllowedActions(f('finalized', { hasEncounter: true }), recep)).toEqual(['reschedule']);
    for (const s of ['scheduled', 'arrived', 'in_care', 'finalized', 'cancelled', 'no_show'] as WorkflowState[]) {
      const a = workflowAllowedActions(f(s, { hasEncounter: true, hasDraft: s === 'in_care', overdue: true }), recep);
      for (const clinical of ['start_care', 'open_care', 'view_care', 'close_retro'] as const) expect(a).not.toContain(clinical);
    }
    expect(workflowAllowedActions(f('arrived'), clin)).toContain('start_care');
    expect(workflowAllowedActions(f('in_care', { hasEncounter: true, hasDraft: true }), clin)).toEqual(['open_care']);
    expect(workflowAllowedActions(f('finalized', { hasEncounter: true }), clin)).toContain('view_care');
    expect(workflowAllowedActions(f('scheduled', { overdue: true }), clin)).toContain('close_retro');
    expect(workflowAllowedActions(f('scheduled', { overdue: false }), clin)).not.toContain('close_retro');
    expect(workflowAllowedActions(f('scheduled', { overdue: true, hasDraft: true }), clin)).not.toContain('close_retro');
    expect(workflowAllowedActions(f('scheduled', { status: 'pending' }), recep)).toContain('confirm');
    expect(workflowAllowedActions(f('scheduled', { status: 'pending' }), recep)).not.toContain('no_show');
    expect(workflowAllowedActions(f('cancelled'), recep)).toEqual(['reopen', 'reschedule']);
    expect(workflowAllowedActions(f('scheduled'), { agenda: false, atendimento: false })).toEqual([]);
  });
  it('capacidades de base inteira só por padrão para Proprietário e Administrador', () => {
    expect(PERMISSION_IDS).toContain('clientes_exportar');
    expect(PERMISSION_IDS).toContain('clientes_importar');
    for (const role of ['OWNER', 'ADMIN'] as const) {
      expect(permissionsFor(role).clientes_exportar).toBe(true);
      expect(permissionsFor(role).clientes_importar).toBe(true);
    }
    for (const role of ['SECRETARIA', 'PROFISSIONAL', 'ATENDENTE', 'VENDEDOR', 'VIEWER'] as const) {
      expect(permissionsFor(role).clientes_exportar, role).toBe(false);
      expect(permissionsFor(role).clientes_importar, role).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// 2 · Escopo de dados (puro)
// ═══════════════════════════════════════════════════════════════
describe('Escopo de dados · relações reais, nunca nome', () => {
  it('só enxerga o que tem vínculo (agendamento/atendimento/fila) com o profissional', async () => {
    const db = await dbNow();
    const ctx = { professionalScope: 'pro-orlando' };
    const ids = (list: Array<{ id: string }>) => list.map((x) => x.id).sort();
    expect(ids(scopeContacts(db, ctx, db.contacts.filter((c) => c.businessId === B)))).toEqual(['ct-a']); // bk-x tem telefone sem cadastro
    expect(ids(scopePets(db, ctx, db.pets))).toEqual(['pet-a']);
    const ctxB = { professionalScope: 'pro-segundo' };
    expect(ids(scopeContacts(db, ctxB, db.contacts.filter((c) => c.businessId === B)))).toEqual(['ct-b']);
    // Sem recorte: tudo da unidade.
    expect(scopeContacts(db, { professionalScope: '' }, db.contacts)).toHaveLength(db.contacts.length);
    // Pet C nunca é vinculado, mesmo tutor sendo "conhecido".
    expect(canAccessPet(db, ctx, db.pets.find((p) => p.id === 'pet-c')!)).toBe(false);
  });
  it('um homônimo NÃO herda acesso: a chave é telefone/conta/contato, não o nome', async () => {
    const db = await dbNow();
    db.contacts.push({ ...db.contacts.find((c) => c.id === 'ct-a')!, id: 'ct-homonimo', phone: '11900009999' } as any);
    expect(canAccessContact(db, { professionalScope: 'pro-orlando' }, db.contacts.find((c) => c.id === 'ct-homonimo')!)).toBe(false);
  });
  it('encontro e fila ampliam o vínculo; papel sem vínculo não vê nada', async () => {
    const db = await dbNow();
    db.encounters.push({ id: 'e1', businessId: B, bookingId: '', queueId: '', serviceId: 's1', professionalId: 'pro-orlando', customerId: '', contactId: 'ct-c', petId: 'pet-c', status: 'draft' } as any);
    const ctx = { professionalScope: 'pro-orlando' };
    const db2 = { ...db };
    expect(canAccessContact(db2, ctx, db.contacts.find((c) => c.id === 'ct-c')!)).toBe(true);
    expect(canAccessPet(db2, ctx, db.pets.find((p) => p.id === 'pet-c')!)).toBe(true);
    expect(scopedDbView(db2, B, { professionalScope: '__nenhum__' }).contacts.filter((c) => c.businessId === B)).toHaveLength(0);
    expect(scopedDbView(db2, B, { professionalScope: '__nenhum__' }).bookings.filter((c) => c.businessId === B)).toHaveLength(0);
  });
  it('tenant primeiro: vínculos de outra unidade não contam', async () => {
    const db = await dbNow();
    db.bookings.push(booking('bk-leak', { businessId: OUT, professionalId: 'pro-orlando', customerPhone: '11933330003' }));
    const db2 = { ...db };
    expect(canAccessContact(db2, { professionalScope: 'pro-orlando' }, db.contacts.find((c) => c.id === 'ct-c')!)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// 3 · Transições pelas rotas reais
// ═══════════════════════════════════════════════════════════════
describe('Workflow · Agendado → Chegou', () => {
  it('Recepção registra a chegada: grava quem/quando, audita e é idempotente', async () => {
    const r = await checkIn(T.maria, 'bk-a');
    expect(r.status).toBe(200);
    const body = await j(r);
    expect(body.workflow.state).toBe('arrived');
    let db = await dbNow();
    const b = db.bookings.find((x) => x.id === 'bk-a')!;
    expect(b.checkedInAt).toBeTruthy();
    expect(b.checkedInBy).toBe('u-maria');
    expect(b.status).toBe('confirmed'); // chegar não conclui
    const audits = () => db.audit.filter((a) => a.action === 'booking.status_changed' && (a.meta as any).bookingId === 'bk-a');
    expect(audits()).toHaveLength(1);
    expect((audits()[0].meta as any)).toMatchObject({ from: 'scheduled', to: 'arrived' });
    const first = b.checkedInAt;
    expect((await checkIn(T.maria, 'bk-a')).status).toBe(200);
    db = await dbNow();
    expect(db.bookings.find((x) => x.id === 'bk-a')!.checkedInAt).toBe(first);
    expect(audits()).toHaveLength(1);
  });
  it('não registra chegada de atendimento cancelado, faltou ou finalizado', async () => {
    await setStatus(T.maria, 'bk-pend', 'cancelled');
    expect((await checkIn(T.maria, 'bk-pend')).status).toBe(400);
    await setStatus(T.maria, 'bk-b', 'no_show');
    expect((await checkIn(T.maria, 'bk-b')).status).toBe(400);
    expect((await setStatus(T.orlando, 'bk-past', 'completed')).status).toBe(200);
    expect((await checkIn(T.maria, 'bk-past')).status).toBe(400);
  });
  it('desfazer a chegada volta a Agendado; depois de iniciar não desfaz', async () => {
    await checkIn(T.maria, 'bk-a');
    const undo = await patchBooking(T.maria, { id: 'bk-a', action: 'check-in-undo' });
    expect(undo.status).toBe(200);
    expect((await j(undo)).workflow.state).toBe('scheduled');
    await checkIn(T.maria, 'bk-a');
    expect((await startCare(T.orlando, 'bk-a')).status).toBe(200);
    const late = await patchBooking(T.maria, { id: 'bk-a', action: 'check-in-undo' });
    expect(late.status).toBe(409);
  });
  it('profissional não registra chegada do atendimento de outro; Recepção sem vínculo registra de qualquer um', async () => {
    expect((await checkIn(T.orlando, 'bk-b')).status).toBe(403);
    expect((await checkIn(T.segundo, 'bk-a')).status).toBe(403);
    expect((await checkIn(T.maria, 'bk-b')).status).toBe(200);
  });
});

describe('Workflow · Chegou → Em atendimento → Finalizado', () => {
  it('não inicia o atendimento de quem ainda não chegou (409 com instrução humana)', async () => {
    const r = await startCare(T.orlando, 'bk-a');
    expect(r.status).toBe(409);
    expect((await j(r)).error).toMatch(/chegada/i);
    expect((await dbNow()).encounters).toHaveLength(0);
  });
  it('fluxo completo com idempotência, sem registro duplicado', async () => {
    await checkIn(T.maria, 'bk-a');
    const s1 = await startCare(T.orlando, 'bk-a');
    expect(s1.status).toBe(200);
    const enc = (await j(s1)).encounter;
    const s2 = await startCare(T.orlando, 'bk-a');
    expect((await j(s2)).reused).toBe(true);
    expect((await dbNow()).encounters.filter((e) => e.bookingId === 'bk-a')).toHaveLength(1);
    expect((await manage(T.orlando))['bk-a'].workflow.state).toBe('in_care');
    expect((await manage(T.maria))['bk-a'].workflow.state).toBe('in_care');
    // Finaliza (conteúdo mínimo) — conclui o agendamento pela função oficial.
    const upd = await encPATCH(req('PATCH', '/api/encounters', T.orlando, { businessId: B, id: enc.id, expectedVersion: enc.version, evolution: 'Consulta de rotina realizada' }));
    expect(upd.status).toBe(200);
    const cur = (await j(upd)).encounter;
    const fin = await encPATCH(req('PATCH', '/api/encounters', T.orlando, { businessId: B, id: enc.id, action: 'finalize', expectedVersion: cur.version }));
    expect(fin.status).toBe(200);
    const db = await dbNow();
    expect(db.bookings.find((b) => b.id === 'bk-a')!.status).toBe('completed');
    expect((await manage(T.orlando))['bk-a'].workflow.state).toBe('finalized');
    expect(db.audit.some((a) => a.action === 'encounter.finalized')).toBe(true);
    // Repetir a finalização é recusado (não duplica efeito).
    const again = await encPATCH(req('PATCH', '/api/encounters', T.orlando, { businessId: B, id: enc.id, action: 'finalize', expectedVersion: (await j(fin)).encounter.version }));
    expect(again.status).toBe(409);
  });
  it('Recepção não abre, não inicia e não finaliza o registro clínico (403 no servidor)', async () => {
    await checkIn(T.maria, 'bk-a');
    expect((await startCare(T.maria, 'bk-a')).status).toBe(403);
    const s = await startCare(T.orlando, 'bk-a');
    const enc = (await j(s)).encounter;
    expect((await encGET(req('GET', `/api/encounters?businessId=${B}&id=${enc.id}`, T.maria))).status).toBe(403);
    expect((await encPATCH(req('PATCH', '/api/encounters', T.maria, { businessId: B, id: enc.id, action: 'finalize', expectedVersion: enc.version }))).status).toBe(403);
    expect((await encPATCH(req('PATCH', '/api/encounters', T.maria, { businessId: B, id: enc.id, evolution: 'x', expectedVersion: enc.version }))).status).toBe(403);
  });
  it('outro profissional não inicia nem finaliza o atendimento alheio', async () => {
    await checkIn(T.maria, 'bk-a');
    expect((await startCare(T.segundo, 'bk-a')).status).toBe(403);
    const enc = (await j(await startCare(T.orlando, 'bk-a'))).encounter;
    const bad = await encPATCH(req('PATCH', '/api/encounters', T.segundo, { businessId: B, id: enc.id, action: 'finalize', expectedVersion: enc.version }));
    expect(bad.status).toBe(403);
  });
  it('em atendimento: não cancela, não marca falta, não reagenda, não desfaz chegada', async () => {
    await checkIn(T.maria, 'bk-a');
    await startCare(T.orlando, 'bk-a');
    expect((await setStatus(T.maria, 'bk-a', 'cancelled')).status).toBe(409);
    expect((await setStatus(T.maria, 'bk-a', 'no_show')).status).toBe(409);
    const re = await patchBooking(T.maria, { id: 'bk-a', date: '2026-09-20', time: '10:00' });
    expect(re.status).toBe(409);
    expect((await dbNow()).bookings.find((b) => b.id === 'bk-a')!.date).toBe('2026-09-18');
  });
});

describe('Workflow · Faltou / Cancelado / Reagendado', () => {
  it('faltou: só de agendamento confirmado ainda não chegado; abre pendência única e é idempotente', async () => {
    const r = await setStatus(T.maria, 'bk-a', 'no_show');
    expect(r.status).toBe(200);
    let db = await dbNow();
    const tasks = () => db.tasks.filter((t) => t.bookingId === 'bk-a' && t.createdBy === 'workflow');
    expect(tasks()).toHaveLength(1);
    expect(tasks()[0].title).toMatch(/^Reagendar falta de Tutor Alfa/);
    expect(tasks()[0].status).toBe('open');
    expect(tasks()[0].dueAt).toBe('2026-09-18'); // vence HOJE no fuso da unidade (conta como "para hoje")
    expect((await setStatus(T.maria, 'bk-a', 'no_show')).status).toBe(200);
    db = await dbNow();
    expect(tasks()).toHaveLength(1);
    expect(db.bookings.find((b) => b.id === 'bk-a')!.history.filter((h) => h.to === 'no_show')).toHaveLength(1);
  });
  it('faltou é recusado para quem já chegou, em atendimento, finalizado e pendente', async () => {
    await checkIn(T.maria, 'bk-a');
    expect((await setStatus(T.maria, 'bk-a', 'no_show')).status).toBe(409);
    await startCare(T.orlando, 'bk-a');
    expect((await setStatus(T.maria, 'bk-a', 'no_show')).status).toBe(409);
    expect((await setStatus(T.orlando, 'bk-past', 'completed')).status).toBe(200);
    expect((await setStatus(T.maria, 'bk-past', 'no_show')).status).toBe(422);
    expect((await setStatus(T.maria, 'bk-pend', 'no_show')).status).toBe(422);
  });
  it('cancelar preserva o histórico (nunca apaga) e é idempotente; reabrir volta a Agendado', async () => {
    expect((await setStatus(T.maria, 'bk-pend', 'cancelled')).status).toBe(200);
    expect((await setStatus(T.maria, 'bk-pend', 'cancelled')).status).toBe(200);
    let db = await dbNow();
    const b = db.bookings.find((x) => x.id === 'bk-pend')!;
    expect(b.status).toBe('cancelled');
    expect(b.history.filter((h) => h.to === 'cancelled')).toHaveLength(1);
    expect((await setStatus(T.maria, 'bk-pend', 'pending')).status).toBe(200);
    expect((await manage(T.maria))['bk-pend'].workflow.state).toBe('scheduled');
  });
  it('cancelar quem já chegou é permitido e tira da fila', async () => {
    await checkIn(T.maria, 'bk-a');
    expect((await setStatus(T.maria, 'bk-a', 'cancelled')).status).toBe(200);
    expect((await manage(T.maria))['bk-a'].workflow.state).toBe('cancelled');
  });
  it('reagendar move o atendimento e limpa a chegada antiga; de terminal recria e fecha a pendência', async () => {
    await checkIn(T.maria, 'bk-a');
    const mv = await patchBooking(T.maria, { id: 'bk-a', date: '2026-09-21', time: '10:00' });
    expect(mv.status).toBe(200);
    const moved = (await dbNow()).bookings.find((b) => b.id === 'bk-a')!;
    expect(moved.date).toBe('2026-09-21');
    expect(moved.checkedInAt).toBeUndefined();
    expect((await manage(T.maria))['bk-a'].workflow.state).toBe('scheduled');
    // Faltou → pendência → reagendar (recria) → pendência fecha, registro antigo preservado.
    await setStatus(T.maria, 'bk-b', 'no_show');
    expect((await dbNow()).tasks.some((t) => t.bookingId === 'bk-b' && t.status === 'open')).toBe(true);
    const re = await patchBooking(T.maria, { id: 'bk-b', date: '2026-09-22', time: '11:00' });
    expect(re.status).toBe(200);
    expect((await j(re)).created).toBe(true);
    const db = await dbNow();
    expect(db.tasks.find((t) => t.bookingId === 'bk-b' && t.createdBy === 'workflow')!.status).toBe('done');
    expect(db.bookings.find((b) => b.id === 'bk-b')!.status).toBe('no_show');
    expect(db.bookings.some((b) => b.previousId === 'bk-b')).toBe(true);
  });
});

describe('Workflow · fechamento sem registro clínico é de quem atende', () => {
  it('Recepção não conclui (nem vencido); profissional conclui só o vencido e o próprio', async () => {
    expect((await setStatus(T.maria, 'bk-past', 'completed')).status).toBe(403);
    expect((await setStatus(T.orlando, 'bk-a', 'completed')).status).toBe(409); // ainda no futuro do dia
    expect((await setStatus(T.segundo, 'bk-past', 'completed')).status).toBe(403); // de outro profissional
    expect((await setStatus(T.orlando, 'bk-past', 'completed')).status).toBe(200);
    expect((await setStatus(T.orlando, 'bk-past', 'completed')).status).toBe(200); // idempotente
  });
  it('não conclui por fora quem chegou ou está em atendimento', async () => {
    await checkIn(T.maria, 'bk-past');
    expect((await setStatus(T.orlando, 'bk-past', 'completed')).status).toBe(409);
  });
});

describe('Workflow · ações por papel e etapa (o servidor entrega o que a tela desenha)', () => {
  it('Maria vê Registrar chegada, nunca um botão clínico; Orlando vê Iniciar atendimento só após a chegada', async () => {
    let m = await manage(T.maria);
    expect(m['bk-a'].workflow.allowed).toContain('check_in');
    expect(m['bk-a'].workflow.allowed).not.toContain('start_care');
    await checkIn(T.maria, 'bk-a');
    m = await manage(T.maria);
    expect(m['bk-a'].workflow.state).toBe('arrived');
    for (const c of ['start_care', 'open_care', 'view_care', 'close_retro']) expect(m['bk-a'].workflow.allowed).not.toContain(c);
    const o = await manage(T.orlando);
    expect(o['bk-a'].workflow.allowed).toContain('start_care');
    expect(Object.keys(o)).not.toContain('bk-b'); // agenda própria
    await startCare(T.orlando, 'bk-a');
    expect((await manage(T.orlando))['bk-a'].workflow.allowed).toEqual(['open_care']);
  });
});

// ═══════════════════════════════════════════════════════════════
// 4 · Escopo de dados pelas rotas reais
// ═══════════════════════════════════════════════════════════════
describe('Profissional · só o que tem vínculo (Clientes, Pets, 360, busca)', () => {
  it('Contatos: lista filtrada, edição por id recusada (404), cadastro livre bloqueado', async () => {
    const own = await j(await contactsGET(req('GET', `/api/contacts?businessId=${B}&limit=50`, T.orlando)));
    expect(own.contacts.map((c: any) => c.id)).toEqual(['ct-a']);
    const probe = await j(await contactsGET(req('GET', `/api/contacts?businessId=${B}&q=beta`, T.orlando)));
    expect(probe.contacts).toEqual([]);
    expect((await contactsPATCH(req('PATCH', '/api/contacts', T.orlando, { businessId: B, id: 'ct-b', note: 'x' }))).status).toBe(404);
    expect((await contactsPATCH(req('PATCH', '/api/contacts', T.orlando, { businessId: B, id: 'ct-b', addNote: { text: 'x' } }))).status).toBe(404);
    expect((await contactsPATCH(req('PATCH', '/api/contacts', T.orlando, { businessId: B, id: 'ct-a', note: 'ok' }))).status).toBe(200);
    expect((await contactsPOST(req('POST', '/api/contacts', T.orlando, { businessId: B, name: 'Novo', phone: '11977776666' }))).status).toBe(403);
    // Recepção e Owner/Admin veem a unidade inteira.
    for (const t of [T.maria, T.owner, T.admin]) {
      const all = await j(await contactsGET(req('GET', `/api/contacts?businessId=${B}&limit=50`, t)));
      expect(all.contacts).toHaveLength(3);
    }
  });
  it('Recepção cadastra Tutor e Pet', async () => {
    const c = await contactsPOST(req('POST', '/api/contacts', T.maria, { businessId: B, name: 'Tutor Novo', phone: '11977776666' }));
    expect(c.status).toBe(200);
    const id = (await j(c)).contact.id;
    const p = await petsPOST(req('POST', '/api/pets', T.maria, { businessId: B, action: 'create', tutorId: id, pet: { name: 'Thor', species: 'cachorro' } }));
    expect(p.status).toBe(200);
  });
  it('People 360: só o próprio paciente/tutor, sem pedidos, oportunidades e conversas', async () => {
    const own = await j(await p360GET(req('GET', `/api/people360?businessId=${B}`, T.orlando)));
    const names = (own.people || own.persons || own.items || []).map((p: any) => p.name);
    expect(names).toContain('Tutor Alfa');
    expect(names).not.toContain('Tutor Beta');
    expect(names).not.toContain('Tutor Gama');
    const alfa = (own.people || own.persons || own.items).find((p: any) => p.name === 'Tutor Alfa');
    expect(alfa.leads).toEqual([]);
    expect(alfa.conversations).toEqual([]);
    expect(alfa.orders).toBe(0);
    // Dos agendamentos do tutor, só os DELE.
    expect(alfa.bookings.every((b: any) => b.professionalId === 'pro-orlando')).toBe(true);
    const full = await j(await p360GET(req('GET', `/api/people360?businessId=${B}`, T.owner)));
    const fullNames = (full.people || full.persons || full.items).map((p: any) => p.name);
    expect(fullNames).toEqual(expect.arrayContaining(['Tutor Alfa', 'Tutor Beta', 'Tutor Gama']));
    // Abrir o 360 do outro por chave (URL/ID): não existe para o Orlando.
    const betaKey = (full.people || full.persons || full.items).find((p: any) => p.name === 'Tutor Beta').key;
    const byKey = await p360GET(req('GET', `/api/people360?businessId=${B}&key=${encodeURIComponent(betaKey)}`, T.orlando));
    const kb = await j(byKey);
    expect(JSON.stringify(kb)).not.toContain('Tutor Beta');
  });
  it('Pets: lista, tutor, edição e criação seguem o vínculo (404/403 em objeto alheio)', async () => {
    const own = await j(await petsGET(req('GET', `/api/pets?businessId=${B}`, T.orlando)));
    expect(own.pets.map((p: any) => p.id)).toEqual(['pet-a']);
    const byTutor = await j(await petsGET(req('GET', `/api/pets?businessId=${B}&tutorId=ct-b`, T.orlando)));
    expect(byTutor.pets).toEqual([]);
    const upd = (id: string, tutorId: string) => petsPOST(req('POST', '/api/pets', T.orlando, { businessId: B, action: 'update', tutorId, pet: { id, name: 'Renomeado', species: 'cachorro' } }));
    expect((await upd('pet-b', 'ct-b')).status).toBe(404);
    expect((await upd('pet-b', 'ct-a')).status).toBe(404); // não "adota" o pet alheio
    expect((await upd('pet-a', 'ct-a')).status).toBe(200);
    expect((await petsPOST(req('POST', '/api/pets', T.orlando, { businessId: B, action: 'create', tutorId: 'ct-a', pet: { name: 'Novo', species: 'gato' } }))).status).toBe(403);
    expect((await petsPOST(req('POST', '/api/pets', T.orlando, { businessId: B, action: 'delete', id: 'pet-a' }))).status).toBe(403);
    for (const t of [T.owner, T.admin, T.maria]) {
      expect((await j(await petsGET(req('GET', `/api/pets?businessId=${B}`, t)))).pets).toHaveLength(3);
    }
  });
  it('Busca global usa o MESMO escopo: nome do outro paciente/tutor/conversa não aparece', async () => {
    const hits = async (t: string, q: string) => (await j(await searchGET(req('GET', `/api/search?businessId=${B}&q=${q}`, t)))).groups as Array<{ group: string; title: string }>;
    expect((await hits(T.orlando, 'Beta')).filter((h) => h.group !== 'agendamentos')).toEqual([]);
    expect((await hits(T.orlando, 'Mia')).length).toBe(0);
    expect((await hits(T.orlando, 'Alfa')).map((h) => h.group)).toEqual(expect.arrayContaining(['pessoas', 'conversas']));
    expect((await hits(T.orlando, 'Rex')).map((h) => h.group)).toContain('pets');
    const maria = await hits(T.maria, 'Beta');
    expect(maria.map((h) => h.group)).toEqual(expect.arrayContaining(['pessoas', 'conversas']));
  });
  it('Visão geral: agregados de CRM/oportunidades/conversas saem da visão recortada', async () => {
    const ov = async (t: string) => j(await overviewGET(req('GET', `/api/overview?businessId=${B}`, t)));
    const own = await ov(T.orlando);
    const all = await ov(T.owner);
    expect(own.crm.contacts).toBe(1);
    expect(all.crm.contacts).toBe(3);
    expect(own.crm.leads).toBe(1);
    expect(all.crm.leads).toBe(2);
    expect(JSON.stringify(own)).not.toContain('Tutor Beta');
  });
});

describe('Profissional · Oportunidades, Pendências e Conversas', () => {
  it('Oportunidades: lista e PATCH só de quem tem vínculo', async () => {
    const own = await j(await leadsGET(req('GET', `/api/leads?businessId=${B}`, T.orlando)));
    expect(own.leads.map((l: any) => l.id)).toEqual(['ld-a']);
    expect((await leadsPATCH(req('PATCH', '/api/leads', T.orlando, { businessId: B, id: 'ld-b', priority: 'high' }))).status).toBe(404);
    expect((await j(await leadsGET(req('GET', `/api/leads?businessId=${B}`, T.maria)))).leads).toHaveLength(2);
  });
  it('Pendências: só as ligadas ao próprio trabalho; PATCH alheio é 404; contadores recortados', async () => {
    const own = await j(await tasksGET(req('GET', `/api/tasks?businessId=${B}`, T.orlando)));
    expect(own.tasks.map((t: any) => t.id)).toEqual(['tk-a']);
    expect(own.summary.open).toBe(1);
    expect((await tasksPATCH(req('PATCH', '/api/tasks', T.orlando, { businessId: B, id: 'tk-b', status: 'done' }))).status).toBe(404);
    expect((await tasksPATCH(req('PATCH', '/api/tasks', T.orlando, { businessId: B, id: 'tk-a', status: 'done' }))).status).toBe(200);
    const m = await j(await tasksGET(req('GET', `/api/tasks?businessId=${B}&status=all`, T.maria)));
    expect(m.tasks).toHaveLength(2);
  });
  it('Conversas: lista, detalhe e envio só da conversa vinculada', async () => {
    const own = await j(await convGET(req('GET', `/api/conversations?businessId=${B}`, T.orlando)));
    expect(own.conversations.map((c: any) => c.id)).toEqual(['cv-a']);
    expect((await convGET(req('GET', `/api/conversations?businessId=${B}&id=cv-b`, T.orlando))).status).toBe(404);
    expect((await convGET(req('GET', `/api/conversations?businessId=${B}&id=cv-a`, T.orlando))).status).toBe(200);
    for (const action of [{ action: 'takeover' }, { body: 'olá' }]) {
      const r = await convPOST(req('POST', '/api/conversations', T.orlando, { businessId: B, conversationId: 'cv-b', ...action }));
      expect(r.status).toBe(404);
    }
    expect((await convPOST(req('POST', '/api/conversations', T.orlando, { businessId: B, phone: '11922220002', body: 'olá' }))).status).toBe(404);
  });
});

describe('Export / Import da base inteira: capacidade própria + escopo da unidade', () => {
  const csvReq = (t: string, b = B) => exportGET(req('GET', `/api/contacts/export?businessId=${b}`, t));
  it('Owner/Admin exportam; Recepção e Profissional não (mesmo com clientes=true)', async () => {
    expect((await csvReq(T.owner)).status).toBe(200);
    expect((await csvReq(T.admin)).status).toBe(200);
    expect((await csvReq(T.maria)).status).toBe(403);
    expect((await csvReq(T.orlando)).status).toBe(403);
    expect((await csvReq(T.segundo)).status).toBe(403);
    expect((await exportFullGET(req('GET', `/api/contacts/export-full?businessId=${B}`, T.owner))).status).toBe(200);
    expect((await exportFullGET(req('GET', `/api/contacts/export-full?businessId=${B}`, T.maria))).status).toBe(403);
    expect((await exportFullGET(req('GET', `/api/contacts/export-full?businessId=${B}`, T.orlando))).status).toBe(403);
  });
  it('Profissional NUNCA exporta/importa, nem se receber a capacidade por override (escopo manda)', async () => {
    const d = await dbNow();
    d.members.find((m) => m.userId === 'u-orlando')!.permissions = { clientes_exportar: true, clientes_importar: true } as any;
    await writeDB(d);
    expect((await csvReq(T.orlando)).status).toBe(403);
    expect((await exportFullGET(req('GET', `/api/contacts/export-full?businessId=${B}`, T.orlando))).status).toBe(403);
    expect((await importPOST(req('POST', '/api/contacts/import', T.orlando, { businessId: B, mode: 'preview', csv: 'Nome;Telefone\nX;11999998888' }))).status).toBe(403);
  });
  it('Importar: só com clientes_importar; Recepção não; Admin sim', async () => {
    const body = { businessId: B, mode: 'preview', csv: 'Nome;Telefone\nX;11999998888' };
    expect((await importPOST(req('POST', '/api/contacts/import', T.maria, body))).status).toBe(403);
    expect((await importPOST(req('POST', '/api/contacts/import', T.admin, body))).status).toBe(200);
  });
  it('capacidade concedida individualmente à Recepção funciona (Equipe pode conceder)', async () => {
    const d = await dbNow();
    d.members.find((m) => m.userId === 'u-maria')!.permissions = { clientes_exportar: true } as any;
    await writeDB(d);
    expect((await csvReq(T.maria)).status).toBe(200);
  });
});

describe('Isolamento entre unidades (tenant primeiro)', () => {
  it('ids e rotas de outra unidade não vazam em nenhuma superfície', async () => {
    const x = (r: Response) => r.status;
    // Dono da unidade b2 tentando ler/alterar a unidade b1.
    expect([401, 403, 404]).toContain(x(await bookingsPATCH(req('PATCH', '/api/bookings', T.fora, { businessId: B, id: 'bk-a', action: 'check-in' }))));
    expect([401, 403, 404]).toContain(x(await contactsGET(req('GET', `/api/contacts?businessId=${B}`, T.fora))));
    expect([401, 403, 404]).toContain(x(await p360GET(req('GET', `/api/people360?businessId=${B}`, T.fora))));
    expect([401, 403, 404]).toContain(x(await exportGET(req('GET', `/api/contacts/export?businessId=${B}`, T.fora))));
    // Dentro da própria unidade, o id de um agendamento da b1 não existe.
    const r = await bookingsPATCH(req('PATCH', '/api/bookings', T.fora, { businessId: OUT, id: 'bk-a', action: 'check-in' }));
    expect(r.status).toBe(404);
    expect((await dbNow()).bookings.find((b) => b.id === 'bk-a')!.checkedInAt).toBeUndefined();
    // Fila: agendamento da outra unidade não é aceito como vínculo.
    const q = await queuePOST(req('POST', '/api/queue', T.maria, { businessId: B, customerName: 'Fulano', bookingId: 'bk-fora' }));
    expect(q.status).toBe(404);
    // Encontro: agendamento de outra unidade.
    expect((await encPOST(req('POST', '/api/encounters', T.owner, { businessId: B, bookingId: 'bk-fora' }))).status).toBe(404);
  });
  it('profissional não vincula fila a agendamento de colega', async () => {
    const q = await queuePOST(req('POST', '/api/queue', T.orlando, { businessId: B, customerName: 'Fulano', bookingId: 'bk-b' }));
    expect(q.status).toBe(403);
    const ok = await queuePOST(req('POST', '/api/queue', T.orlando, { businessId: B, customerName: 'Fulano', bookingId: 'bk-a' }));
    expect(ok.status).toBe(200);
    // Entrada de fila vinculada = chegada (etapa derivada).
    expect((await manage(T.orlando))['bk-a'].workflow.state).toBe('arrived');
  });
  it('payload não é prova: professionalId/businessId/permissão no corpo não elevam privilégio', async () => {
    const r = await patchBooking(T.orlando, { id: 'bk-b', action: 'check-in', professionalId: 'pro-orlando', permissions: { agenda: true }, role: 'OWNER' });
    expect(r.status).toBe(403);
    const re = await patchBooking(T.orlando, { id: 'bk-a', date: '2026-09-21', time: '10:00', professionalId: 'pro-segundo' });
    expect(re.status).toBe(403);
  });
});

describe('Cliente (área pública) não altera quem já chegou', () => {
  it('cancelar e remarcar pela conta do cliente: 409 depois da chegada', async () => {
    const { createCustomerSession } = await import('../customer-auth');
    const { PATCH: customerPATCH } = await import('@/app/api/customer/bookings/route');
    const d = await dbNow();
    d.customers.push({ id: 'cons', name: 'Tutor Alfa', phone: '11911110001', email: 'a@x.test', passwordHash: 'x', googleId: '', avatar: '', createdAt: NOW } as any);
    const bk = d.bookings.find((b) => b.id === 'bk-pend')!;
    bk.customerId = 'cons'; bk.checkedInAt = NOW; bk.date = '2026-09-25';
    await writeDB(d);
    const tk = await createCustomerSession('cons');
    const cancel = await customerPATCH(req('PATCH', '/api/customer/bookings', tk, { id: 'bk-pend' }));
    expect(cancel.status).toBe(409);
    const move = await customerPATCH(req('PATCH', '/api/customer/bookings', tk, { id: 'bk-pend', date: '2026-09-26', time: '10:00' }));
    expect(move.status).toBe(409);
    expect((await dbNow()).bookings.find((b) => b.id === 'bk-pend')!.status).toBe('pending');
  });
});
