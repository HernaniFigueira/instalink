// ═══════════════════════════════════════════════════════════════
// P4 — INTEGRAÇÃO COM O SISTEMA EXISTENTE (persistência, API e P3)
// ═══════════════════════════════════════════════════════════════
// O que aqui é provado é justamente o risco do P4: virar um sistema paralelo.
// Então os testes NÃO chamam "a automação" com dados inventados — eles usam as
// funções oficiais (ingestLead, createBookingTx, bookLead, applyBookingStatusTx)
// e as rotas reais (NextRequest + sessão Bearer), sobre o banco em arquivo
// temporário, e verificam o que ficou GRAVADO.
//
// Cobertura adicional:
//   • isolamento multi-tenant na camada HTTP (dono de A não vê automação de B);
//   • retomada entre execuções (a fila é o banco, não a memória);
//   • posse (CAS) — duas varreduras não processam a mesma execução;
//   • o que o P3 já fazia continua igual (mensagem na fila do WhatsApp,
//     histórico da esteira, máquina de estados da agenda);
//   • gancho inline do updateDB e o endpoint do cron.
//
// O primeiro import é obrigatório: isola o banco em arquivo temporário.
import './helpers/temp-db';

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, updateDB, writeDB } from '../db';
import { TEMP_DB_FILE } from './helpers/temp-db';
import { createSession } from '../auth';
import { createBookingTx } from '../booking-create';
import { addLeadNote, assignLead, ingestLead, moveLeadStage } from '../pipeline';
import { applyBookingStatusTx } from '../booking-status';
import { createTaskTx, openTasks, summarizeTasks } from '../automation/tasks';
import { limitsFor } from '../automation/capabilities';
import { stepAutomationRun } from '../automation/executor';
import { emitAutomationEvent } from '../automation/events';
import {
  cancelRunsOfAutomation, claimDueAutomationRuns, drainAutomations,
  isAutomationRunClaimLive, processAutomationRunsInDb,
} from '../automation/executor';
import { buildAutomation, FIXED_NOW } from './helpers/automation-fixtures';
import { addDaysISO, todayISO } from '../tz';

/** Dia dentro do horizonte da agenda (o motor revalida contra o "hoje"). */
const FUTURE = addDaysISO(todayISO(), 3);
import { GET as cronAutomationsGET } from '@/app/api/cron/automations/route';
import { GET as automationsGET, PATCH as automationsPATCH, POST as automationsPOST, DELETE as automationsDELETE } from '@/app/api/automations/route';
import { GET as tasksGET, PATCH as tasksPATCH } from '@/app/api/tasks/route';
import type { DB } from '../types';

const OWNER = 'owner-b1';
const OTHER_OWNER = 'owner-b2';

function iso(offsetMs: number, from = Date.parse(FIXED_NOW)): string {
  return new Date(from + offsetMs).toISOString();
}

/** Mesmo claim do motor (exposto para teste de posse entre instâncias). */
function claimDueAutomationRunsForTest(db: DB, opts: { nowISO: string; holder: string; leaseMs: number }) {
  return claimDueAutomationRuns(db, opts);
}

/** Semeia dois tenants completos (agenda aberta todos os dias úteis). */
async function seed() {
  const db: DB = emptyDB();
  db.users.push(
    { id: OWNER, name: 'Dono A', email: 'a@t.com', passwordHash: 'x', createdAt: FIXED_NOW, role: 'owner' },
    { id: OTHER_OWNER, name: 'Dono B', email: 'b@t.com', passwordHash: 'x', createdAt: FIXED_NOW, role: 'owner' },
    { id: 'ana', name: 'Ana', email: 'ana@t.com', passwordHash: 'x', createdAt: FIXED_NOW, role: 'owner' },
    { id: 'bruno', name: 'Bruno', email: 'bruno@t.com', passwordHash: 'x', createdAt: FIXED_NOW, role: 'owner' },
  );
  const biz = (id: string, ownerId: string, slug: string): DB['businesses'][number] => ({
    id, ownerId, organizationId: `org-${id}`, name: `Empresa ${id}`, slug, description: '', logo: '', cover: '',
    niche: 'servicos', modes: ['services', 'bookings'], features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: true, about: false, agent: false },
    phone: '', whatsapp: '11999990000', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0, googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 60, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: FIXED_NOW, updatedAt: FIXED_NOW, automations: {}, capabilityFlags: {},
  });
  db.businesses.push(biz('b1', OWNER, 'empresa-a'), biz('b2', OTHER_OWNER, 'empresa-b'));
  db.members.push(
    { id: 'm-ana', businessId: 'b1', userId: 'ana', role: 'SECRETARIA', permissions: {}, active: true, note: 'Secretaria', invitedBy: OWNER, createdAt: FIXED_NOW, updatedAt: FIXED_NOW },
    { id: 'm-bruno', businessId: 'b1', userId: 'bruno', role: 'ATENDENTE', permissions: {}, active: true, note: 'Atendente', invitedBy: OWNER, createdAt: FIXED_NOW, updatedAt: FIXED_NOW },
  );
  const svc = (id: string, businessId: string) => ({
    id, businessId, categoryId: '', name: 'Consulta', description: '', image: '', price: 10000, showPrice: true,
    durationMin: 30, professionalIds: [], active: true, featured: false, bookable: true, questions: [],
  });
  db.services.push(svc('srv-a', 'b1'), svc('srv-b', 'b2'));
  db.professionals.push({ id: 'pro-a', businessId: 'b1', name: 'Ana', role: '', photo: '', active: true, userId: 'ana', followBusinessHours: true });
  for (let weekday = 0; weekday <= 6; weekday++) {
    db.availability.push({ id: `av-${weekday}`, businessId: 'b1', professionalId: '', serviceId: '', weekday, start: '08:00', end: '20:00', slotMin: 30 });
    db.availability.push({ id: `avb-${weekday}`, businessId: 'b2', professionalId: '', serviceId: '', weekday, start: '08:00', end: '20:00', slotMin: 30 });
  }
  await writeDB(db);
}

function jsonReq(path: string, init: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {}): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers || {}) };
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method || 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function body(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  // O gancho inline do updateDB é desligado nos testes: aqui se quer controlar
  // EXATAMENTE quando a fila é processada (o resto do comportamento é igual).
  process.env.AUTOMATION_INLINE = '0';
  await seed();
});

afterEach(() => {
  delete process.env.AUTOMATION_INLINE;
  delete process.env.CRON_SECRET;
});

describe('P4 × persistência (o banco é a fonte de verdade)', () => {
  it('o gatilho criado por ingestLead é gravado junto com o lead', async () => {
    const automation = buildAutomation({
      id: 'auto-persist',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'Bem-vindo {{lead.name}}' } } }],
    });
    await updateDB((d) => { d.automations.push(automation); });

    await updateDB((d) => ingestLead(d, { businessId: 'b1', name: 'Marcos', phone: '11911112222', source: 'instagram', now: FIXED_NOW }));

    const after = await readDB();
    expect(after.leads).toHaveLength(1);
    expect(after.automationRuns).toHaveLength(1);
    expect(after.automationRuns[0].status).toBe('queued');
    expect(after.automationRuns[0].businessId).toBe('b1');

    const summary = await drainAutomations({ nowISO: FIXED_NOW });
    expect(summary.completed).toBe(1);

    const done = await readDB();
    expect(done.automationRuns[0].status).toBe('completed');
    expect((done.leads[0].notes || []).map((n) => n.text)).toContain('Bem-vindo Marcos');
  });

  it('espera sobrevive a um processo novo (retomada lida do banco)', async () => {
    const automation = buildAutomation({
      steps: [
        { kind: 'wait', wait: { mode: 'duration', minutes: 60 } },
        { kind: 'action', action: { type: 'create_task', params: { title: 'Ligar depois de 1h' } } },
      ],
    });
    // O gatilho nasce DENTRO de ingestLead (serviço oficial) — a rota/automação
    // não precisa emitir nada à mão: é isso que o P4 chama de "um caminho só".
    await updateDB((d) => {
      d.automations.push(automation);
      ingestLead(d, { businessId: 'b1', name: 'Vera', phone: '11922223333', now: FIXED_NOW });
    });

    await drainAutomations({ nowISO: FIXED_NOW });
    const waiting = await readDB();
    expect(waiting.automationRuns[0].status).toBe('waiting');
    expect(waiting.automationRuns[0].waitingUntil).toBe(iso(3600000));
    expect(openTasks(waiting, 'b1')).toHaveLength(0);
    // Nada ficou preso com posse viva: um processo novo pode assumir.
    expect(isAutomationRunClaimLive(waiting.automationRuns[0], iso(61 * 60000))).toBe(false);

    // "Uma hora depois", em outra varredura: continua do ponto salvo.
    const after = await drainAutomations({ nowISO: iso(61 * 60000) });
    expect(after.completed).toBe(1);
    const final = await readDB();
    expect(final.automationRuns[0].status).toBe('completed');
    const tasks = openTasks(final, 'b1');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Ligar depois de 1h');
    expect(tasks[0].source).toBe('automation');
    expect(tasks[0].automationId).toBe(automation.id);
    expect(summarizeTasks(final, 'b1', '2026-09-16', 'ninguém').open).toBe(1);
  });

  it('duas instâncias não duplicam efeito: posse viva bloqueia e posse vencida retoma sem repetir', async () => {
    const automation = buildAutomation({
      steps: [
        { kind: 'action', action: { type: 'add_lead_note', params: { text: 'única' } } },
        { kind: 'action', action: { type: 'create_task', params: { title: 'única' } } },
      ],
    });
    await updateDB((d) => {
      d.automations.push(automation);
      ingestLead(d, { businessId: 'b1', name: 'Corrida', phone: '11933334444', now: FIXED_NOW });
    });

    // Instância A reivindica e processa SÓ o gatilho + a primeira ação: simula
    // a função interrompida no meio do fluxo (estado salvo, posse viva).
    const runId = await updateDB((d) => claimDueAutomationRuns(d, { nowISO: FIXED_NOW, holder: 'A', leaseMs: 600000 })[0]?.id || '');
    expect(runId).toBeTruthy();
    const limits = limitsFor(null);
    await updateDB((d) => stepAutomationRun(d, { runId: runId!, holder: 'A', nowISO: FIXED_NOW, limits }));
    await updateDB((d) => stepAutomationRun(d, { runId: runId!, holder: 'A', nowISO: FIXED_NOW, limits }));

    let db = await readDB();
    expect(db.automationRuns[0].status).toBe('running');
    expect((db.leads[0].notes || []).filter((n) => n.text === 'única')).toHaveLength(1);
    expect(openTasks(db, 'b1')).toHaveLength(0);

    // B varre com posse viva de A: não reivindica e NÃO age.
    const b = await drainAutomations({ nowISO: FIXED_NOW, holder: 'B' });
    expect(b.claimed).toBe(0);
    db = await readDB();
    expect((db.leads[0].notes || []).filter((n) => n.text === 'única')).toHaveLength(1);

    // O lease de A venceu: C retoma do ponto salvo e completa, sem repetir o
    // passo que A já tinha gravado.
    const c = await drainAutomations({ nowISO: iso(600001), holder: 'C' });
    expect(c.claimed).toBe(1);
    db = await readDB();
    expect(db.automationRuns[0].status).toBe('completed');
    expect((db.leads[0].notes || []).filter((n) => n.text === 'única')).toHaveLength(1);
    expect(openTasks(db, 'b1')).toHaveLength(1);

    // Execução terminal nunca volta para a fila.
    const again = await drainAutomations({ nowISO: iso(700000) });
    expect(again.claimed).toBe(0);
  });

  it('AUTOMATION_INLINE=0 + gancho do updateDB: nada roda sozinho durante os testes', async () => {
    const automation = buildAutomation({ steps: [{ kind: 'action', action: { type: 'create_task', params: { title: 'inline' } } }] });
    await updateDB((d) => {
      d.automations.push(automation);
      const { lead } = ingestLead(d, { businessId: 'b1', name: 'Inline', phone: '11944445555' });
      emitAutomationEvent(d, { event: 'lead.created', businessId: 'b1', leadId: lead.id, at: FIXED_NOW });
    });
    await new Promise((r) => setTimeout(r, 30));
    const db = await readDB();
    expect(db.automationRuns[0].status).toBe('queued'); // desligado por env, como esperado
    expect(openTasks(db, 'b1')).toHaveLength(0);
  });
});

describe('P4 × P3 (nenhuma regra existente foi trocada por outra)', () => {
  it('agendamento criado por automação usa o MOTOR DE AGENDA real e mantém a mensagem do P3', async () => {
    const automation = buildAutomation({
      serviceIds: ['srv-a'],
      steps: [{ kind: 'action', action: { type: 'create_booking', params: { serviceId: 'srv-a', date: FUTURE, time: '09:00' } } }],
    });
    await updateDB((d) => { d.automations.push(automation); });
    await updateDB((d) => ingestLead(d, { businessId: 'b1', name: 'Paula', phone: '11955556666', source: 'instagram', now: FIXED_NOW }));

    await drainAutomations({ nowISO: FIXED_NOW });
    const db = await readDB();
    expect(db.automationRuns[0].status).toBe('completed');

    const booking = db.bookings.find((b) => b.leadId === db.leads[0].id)!;
    expect(booking).toBeTruthy();
    expect(booking.date).toBe(FUTURE);
    expect(booking.time).toBe('09:00');
    expect(booking.status).toBe('confirmed');                 // dono/automação confirma
    expect(booking.professionalId).toBe('pro-a');              // política interna resolveu
    expect(db.leads[0].stageId).toBe('scheduled');             // esteira atualizada pelo P3
    // Automação de mensagem do P3 (fila do WhatsApp, nunca "enviada"):
    expect(db.messages.some((m) => m.by === 'automation' && m.status === 'pending')).toBe(true);

    // Conflito de slot é a MESMA recusa do painel (409) — registrada como erro
    // da execução, sem quebrar nada.
    const automation2 = { ...structuredClone(automation), id: 'auto-conflicto', name: 'Conflito' };
    await updateDB((d) => {
      d.automations.push(automation2);
      ingestLead(d, { businessId: 'b1', name: 'Paula Segunda', phone: '11955556667', source: 'instagram', now: FIXED_NOW });
    });
    await drainAutomations({ nowISO: FIXED_NOW });
    const after = await readDB();
    const run = after.automationRuns.find((r) => r.automationId === 'auto-conflicto')!;
    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/horário|ocupado/i);
  });

  it('transição de status extraída continua idêntica (histórico, máquina e P3)', async () => {
    const db = await readDB();
    const created = await updateDB((d) => createBookingTx(d, {
      business: d.businesses[0], service: d.services[0], date: FUTURE, time: '10:00',
      actor: 'customer', customer: { id: '', name: 'Quem agenda', phone: '11966667777', email: '' },
      now: FIXED_NOW,
    }));
    const fresh = await readDB();
    const bookingId = fresh.bookings.find((b) => b.id === created.bookingId)!.id;

    // pending → completed é inválido pela máquina de estados (precisa confirmar).
    const refused = await updateDB((d) => applyBookingStatusTx(d, { businessId: 'b1', bookingId, to: 'completed', by: 'system', now: FIXED_NOW }));
    expect(refused.ok).toBe(false);
    expect(refused.status_code).toBe(422);
    expect(refused.error).toBe('Não é possível mudar de "pending" para "completed".');

    const ok = await updateDB((d) => applyBookingStatusTx(d, { businessId: 'b1', bookingId, to: 'confirmed', by: 'system', now: FIXED_NOW }));
    expect(ok!.ok).toBe(true);
    const done = await updateDB((d) => applyBookingStatusTx(d, { businessId: 'b1', bookingId, to: 'completed', by: 'system', now: FIXED_NOW }));
    expect(done!.booking!.history.map((h) => h.to)).toEqual(['pending', 'confirmed', 'completed']);

    // Mensagens do P3 continuam na fila (confirmação + pós-atendimento + avaliação).
    const after = await readDB();
    const kinds = after.messages.filter((m) => m.externalId?.includes('auto:')).map((m) => m.externalId);
    expect(kinds.some((k) => k!.includes('booking_confirmation'))).toBe(true);
    expect(kinds.some((k) => k!.includes('post_service'))).toBe(true);
    expect(kinds.some((k) => k!.includes('review_request'))).toBe(true);
    expect(after.bookings.find((b) => b.id === bookingId)!.status).toBe('completed');
    void bookingId;
  });

  it('ação de etapa usa moveLeadStage (histórico da esteira com autor "Automação")', async () => {
    const automation = buildAutomation({
      steps: [{ kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'qualified', note: 'qualificado pela automação' } } }],
    });
    await updateDB((d) => { d.automations.push(automation); });
    await updateDB((d) => ingestLead(d, { businessId: 'b1', name: 'Rita', phone: '11977778888', source: 'whatsapp', now: FIXED_NOW }));
    await drainAutomations({ nowISO: FIXED_NOW });

    const db = await readDB();
    const lead = db.leads[0];
    expect(lead.stageId).toBe('qualified');
    expect(lead.status).toBe('qualified');
    const last = lead.stageHistory!.at(-1)!;
    expect(last.toStage).toBe('qualified');
    expect(last.movedByName).toContain('Automação');
    expect(last.note).toBe('qualificado pela automação');
  });

  it('nota do painel e nota da automação usam o mesmo addLeadNote (append-only)', async () => {
    const automation = buildAutomation({
      id: 'auto-note',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'da automação' } } }],
    });
    await updateDB((d) => {
      d.automations.push(automation);
      const { lead } = ingestLead(d, { businessId: 'b1', name: 'Sérgio', phone: '11988889999', now: FIXED_NOW });
      addLeadNote(d, { businessId: 'b1', leadId: lead.id, text: 'do painel', actor: { id: OWNER, name: 'Dono A' }, now: FIXED_NOW });
    });
    await drainAutomations({ nowISO: FIXED_NOW });
    const db = await readDB();
    expect((db.leads[0].notes || []).map((n) => n.text)).toEqual(['do painel', 'da automação']);
    expect(db.leads[0].notes![1].by).toContain('automation');
  });
});

describe('P4 × HTTP (rotas, sessão e permissões)', () => {
  it('cria pela API, recusa definição inválida e exclui com histórico preservado', async () => {
    const token = await createSession(OWNER);

    const created = await automationsPOST(jsonReq('/api/automations', {
      method: 'POST', token,
      body: {
        businessId: 'b1',
        name: 'Follow-up de Instagram',
        description: 'Lead do Instagram é qualificado e vira tarefa em 2h',
        event: 'lead.created',
        condition: { logic: 'and', conditions: [{ field: 'lead.origin', operator: 'equals', value: 'instagram' }] },
        steps: [
          { kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'qualifying' } } },
          { kind: 'wait', wait: { mode: 'duration', minutes: 120 } },
          { kind: 'action', action: { type: 'create_task', params: { title: 'Contatar {{lead.name}}', dueInMinutes: 240 } } },
        ],
      },
    }));
    expect(created.status).toBe(201);
    const payload = await body(created);
    const id = payload.automation.id;
    expect(payload.automation.linear.steps).toHaveLength(3);
    expect(payload.automation.nodes.map((n: any) => n.type)).toEqual(['trigger', 'condition', 'action', 'wait', 'action', 'end']);

    const list = await body(await automationsGET(jsonReq(`/api/automations?businessId=b1`, { token })));
    expect(list.automations.map((a: any) => a.id)).toContain(id);
    expect(list.options.stages.length).toBeGreaterThan(0);
    expect(list.capabilities['automation.basic']).toBe(true);

    const invalid = await automationsPOST(jsonReq('/api/automations', {
      method: 'POST', token,
      body: { businessId: 'b1', name: 'Quebrada', event: 'lead.created', steps: [{ kind: 'action', action: { type: 'não_existe', params: {} } }] },
    }));
    expect(invalid.status).toBe(422);
    expect((await body(invalid)).errors.some((e: string) => e.includes('ação'))).toBe(true);

    const edited = await automationsPATCH(jsonReq('/api/automations', {
      method: 'PATCH', token, body: { businessId: 'b1', id, name: 'Follow-up de Instagram v2', active: false },
    }));
    expect(edited.status).toBe(200);
    const editedBody = await body(edited);
    expect(editedBody.automation.name).toBe('Follow-up de Instagram v2');
    expect(editedBody.automation.active).toBe(false);
    expect(editedBody.automation.version).toBe(2);

    const removed = await automationsDELETE(jsonReq('/api/automations', { method: 'DELETE', token, body: { businessId: 'b1', id } }));
    expect(removed.status).toBe(200);
    const after = await body(await automationsGET(jsonReq('/api/automations?businessId=b1', { token })));
    expect(after.automations.map((a: any) => a.id)).not.toContain(id);
  });

  it('isolamento: o dono de B não cria, não lista e não lê a automação de A', async () => {
    const automation = buildAutomation({ id: 'auto-secreta', businessId: 'b1' });
    await updateDB((d) => { d.automations.push(automation); });

    const tokenA = await createSession(OWNER);
    const tokenB = await createSession(OTHER_OWNER);

    expect((await body(await automationsGET(jsonReq('/api/automations?businessId=b1', { token: tokenA })))).automations).toHaveLength(1);
    const listB = await automationsGET(jsonReq('/api/automations?businessId=b1', { token: tokenB }));
    expect(listB.status).toBe(403);

    const createInA = await automationsPOST(jsonReq('/api/automations', {
      method: 'POST', token: tokenB,
      body: { businessId: 'b1', name: 'intrusa', event: 'lead.created' },
    }));
    expect(createInA.status).toBe(403);

    // Nem pelo próprio tenant a automação de A aparece.
    const listOwn = await body(await automationsGET(jsonReq('/api/automations?businessId=b2', { token: tokenB })));
    expect(listOwn.automations).toHaveLength(0);

    // O id congelado no corpo não troca de tenant: businessId vem da sessão.
    const forged = await automationsPOST(jsonReq('/api/automations', {
      method: 'POST', token: tokenB,
      body: { businessId: 'b2', id: 'auto-secreta', name: 'hijack', event: 'lead.created' },
      },
    ));
    expect(forged.status).toBe(201);
    const forgedBody = await body(forged);
    expect(forgedBody.automation.id).not.toBe('auto-secreta');
    const stillA = await readDB();
    expect(stillA.automations.find((a) => a.id === 'auto-secreta')!.businessId).toBe('b1');
    expect(stillA.automations.find((a) => a.id === 'auto-secreta')!.name).toBe('Automação de teste');
  });

  it('sem sessão não há acesso; tarefa alheia não é encerrada por outro tenant', async () => {
    const anon = await automationsGET(jsonReq('/api/automations?businessId=b1'));
    expect(anon.status).toBe(401);

    const token = await createSession(OWNER);
    const taskId = await updateDB((d) => {
      const res = createTaskTx(d, { businessId: 'b1', title: 'Manual do painel', createdBy: OWNER, source: 'manual' });
      return res.task!.id;
    });

    const list = await body(await tasksGET(jsonReq('/api/tasks?businessId=b1', { token })));
    expect(list.ok).toBe(true);
    expect(list.tasks.map((t: any) => t.title)).toContain('Manual do painel');

    // Dono de B tenta concluir a tarefa de A (mesmo id, outro contexto).
    const other = await createSession(OTHER_OWNER);
    const crossTenant = await tasksPATCH(jsonReq('/api/tasks', {
      method: 'PATCH', token: other, body: { businessId: 'b2', id: taskId, status: 'done' },
    }));
    expect(crossTenant.status).toBe(404);
    let db = await readDB();
    expect(db.tasks.find((t) => t.id === taskId)!.status).toBe('open');

    const mine = await tasksPATCH(jsonReq('/api/tasks', {
      method: 'PATCH', token, body: { businessId: 'b1', id: taskId, status: 'done' },
    }));
    expect(mine.status).toBe(200);
    db = await readDB();
    expect(db.tasks.find((t) => t.id === taskId)!.status).toBe('done');
  });

  it('membro sem permissão de configuração não edita automação (papel ≠ dono)', async () => {
    const tokenAna = await createSession('ana'); // SECRETARIA: sem 'config'
    const denied = await automationsPOST(jsonReq('/api/automations', {
      method: 'POST', token: tokenAna, body: { businessId: 'b1', name: 'clandestina', event: 'lead.created' },
    }));
    expect(denied.status).toBe(403);
    const db = await readDB();
    expect(db.automations.some((a) => a.name === 'clandestina')).toBe(false);
  });
});

describe('P4 × cron e proteções de fila', () => {
  it('rota do cron: fail-closed sem segredo e resumo sem dado sensível', async () => {
    const noSecret = await cronAutomationsGET(jsonReq('/api/cron/automations'));
    expect(noSecret.status).toBe(503);

    process.env.CRON_SECRET = 'cron-secret-p4-teste';
    const wrong = await cronAutomationsGET(jsonReq('/api/cron/automations', { headers: { authorization: 'Bearer errado' } }));
    expect(wrong.status).toBe(401);

    const automation = buildAutomation({ steps: [{ kind: 'action', action: { type: 'create_task', params: { title: 'pelo cron' } } }] });
    await updateDB((d) => {
      d.automations.push(automation);
      ingestLead(d, { businessId: 'b1', name: 'Cron', phone: '11900001111', now: FIXED_NOW });
    });

    const ok = await cronAutomationsGET(jsonReq('/api/cron/automations', { headers: { authorization: 'Bearer cron-secret-p4-teste' } }));
    expect(ok.status).toBe(200);
    const payload = await body(ok);
    expect(payload.completed).toBe(1);
    expect(JSON.stringify(payload)).not.toContain('lead-');       // nada de identidade/segredo
    const db = await readDB();
    expect(openTasks(db, 'b1')[0].title).toBe('pelo cron');
  });

  it('editar o gatilho encerra as execuções em espera (sem estado órfão)', async () => {
    const automation = buildAutomation({
      steps: [{ kind: 'wait', wait: { mode: 'duration', minutes: 60 } }, { kind: 'action', action: { type: 'create_task', params: { title: 'nunca' } } }],
    });
    await updateDB((d) => {
      d.automations.push(automation);
      ingestLead(d, { businessId: 'b1', name: 'Edição', phone: '11900002222', now: FIXED_NOW });
    });
    await drainAutomations({ nowISO: FIXED_NOW });
    let db = await readDB();
    expect(db.automationRuns[0].status).toBe('waiting');

    const cancelled = await updateDB((d) => cancelRunsOfAutomation(d, 'b1', automation.id, 'automação reeditada', FIXED_NOW));
    expect(cancelled).toBe(1);
    db = await readDB();
    expect(db.automationRuns[0].status).toBe('cancelled');
    expect(db.automationRuns[0].waitingUntil).toBe('');
    expect(openTasks(db, 'b1')).toHaveLength(0);

    // Execução terminal nunca volta para a fila.
    const again = await drainAutomations({ nowISO: iso(3600_000 * 2) });
    expect(again.claimed).toBe(0);
  });

  it('evento produzido por ação não reabre a mesma automação (anti-loop), mas reentra se liberado', async () => {
    const db = await readDB();
    const noReentry = buildAutomation({ id: 'auto-a', event: 'lead.stage_changed', steps: [{ kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'converted' } } }] });
    const withReentry = buildAutomation({
      id: 'auto-b', event: 'lead.stage_changed', settings: { allowReentry: true },
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'reentrou' } } }],
    });
    await updateDB((d) => {
      d.automations.push(noReentry, withReentry);
      const { lead } = ingestLead(d, { businessId: 'b1', name: 'Loop', phone: '11900003333' });
      // Movimento manual (sem origem de automação) ⇒ os dois escutam.
      moveLeadStage(d, { businessId: 'b1', leadId: lead.id, toStageId: 'qualifying', actor: { id: OWNER, name: 'Dono A' }, now: FIXED_NOW });
    });
    let after = await readDB();
    expect(after.automationRuns.filter((r) => r.automationId === 'auto-a')).toHaveLength(1);
    expect(after.automationRuns.filter((r) => r.automationId === 'auto-b')).toHaveLength(1);

    // O passo de auto-a (mover para converted) gera lead.stage_changed de novo:
    // 'auto-a' NÃO reentra; 'auto-b' sim.
    await drainAutomations({ nowISO: FIXED_NOW });
    after = await readDB();
    const runsOfA = after.automationRuns.filter((r) => r.automationId === 'auto-a');
    expect(runsOfA).toHaveLength(1);
    const runsOfB = after.automationRuns.filter((r) => r.automationId === 'auto-b');
    expect(runsOfB.length).toBeGreaterThan(runsOfA.length);
    void db;
  });

  it('capacidade desligada: nada é criado no gatilho (falha segura)', async () => {
    const automation = buildAutomation({ steps: [{ kind: 'action', action: { type: 'create_task', params: { title: 'não deveria existir' } } }] });
    await updateDB((d) => {
      d.automations.push(automation);
      const b = d.businesses.find((x) => x.id === 'b1')!;
      b.capabilityFlags = { 'automation.basic': false };
      d.businesses = d.businesses.map((x) => (x.id === 'b1' ? b : x));
    });
    await updateDB((d) => {
      const { lead } = ingestLead(d, { businessId: 'b1', name: 'Sem licença', phone: '11900004444' });
      emitAutomationEvent(d, { event: 'lead.created', businessId: 'b1', leadId: lead.id, at: FIXED_NOW });
    });
    const db = await readDB();
    expect(db.automationRuns).toHaveLength(0);
    await processAutomationRunsInDb(db, { nowISO: FIXED_NOW });
    expect(openTasks(db, 'b1')).toHaveLength(0);

    // ... e a atribuição de responsável pelo painel continua funcionando.
    await updateDB((d) => {
      assignLead(d, { businessId: 'b1', leadId: d.leads[0].id, assignedUserId: 'ana', actor: { id: OWNER, name: 'Dono A' }, now: FIXED_NOW });
    });
    const final = await readDB();
    expect(final.leads[0].assignedUserId).toBe('ana');
  });
});
