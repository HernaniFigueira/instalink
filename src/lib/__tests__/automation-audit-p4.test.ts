// ═══════════════════════════════════════════════════════════════
// P4 (auditoria final) — CRON, RETOMADA, FILA POR UNIDADE E MULTI-TENANT
// ═══════════════════════════════════════════════════════════════
// Nada aqui testa função isolada: é o SISTEMA (banco em arquivo temporário,
// rotas reais, serviços oficiais do P3) respondendo às perguntas que a
// auditoria da PR #18 fez:
//
//   • a rota do cron é fail-closed e, quando autorizada, processa fila + esperas
//     vencidas SEM adiantar as que ainda vão vencer;
//   • a retomada cai exatamente no próximo nó e não repete o passo anterior;
//   • a posse é liberada durante a espera e uma execução abandonada volta sozinha;
//   • automação desativada para de executar (e as execuções vivas encerram);
//   • "processar a fila desta unidade" não toca em NENHUMA outra unidade;
//   • a posse interna do motor nunca sai na API;
//   • referência cruzada de tenant em tarefa é recusada (e não é devolvida);
//   • o gancho inline retoma espera vencida mesmo sem agendador configurado
//     (no Vercel Hobby não há cron por minuto — ver README §Automações).
//
// O primeiro import é obrigatório: isola o banco em arquivo temporário.
import './helpers/temp-db';

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, updateDB, writeDB } from '../db';
import { TEMP_DB_FILE } from './helpers/temp-db';
import { createSession } from '../auth';
import { getBusinessPipeline, ingestLead } from '../pipeline';
import { openTasks } from '../automation/tasks';
import { drainAutomations, isAutomationRunDue } from '../automation/executor';
import { emitAutomationEvent } from '../automation/events';
import { automationFixtures, FIXED_NOW } from './helpers/automation-fixtures';
import { addDaysISO, todayISO } from '../tz';
import type { DB } from '../types';

import { GET as cronGET } from '@/app/api/cron/automations/route';
import {
  GET as automationsGET, PATCH as automationsPATCH, POST as automationsPOST, DELETE as automationsDELETE,
} from '@/app/api/automations/route';
import { GET as automationDetailGET, POST as automationDetailPOST } from '@/app/api/automations/[id]/route';
import { GET as tasksGET, POST as tasksPOST, PATCH as tasksPATCH } from '@/app/api/tasks/route';

const SECRET = 'cron-secret-auditoria-p4';
const OWNER_A = 'owner-b1';
const OWNER_B = 'owner-b2';
const FUTURE_DAY = addDaysISO(todayISO(), 3);

const iso = (offsetMs = 0) => new Date(Date.parse(FIXED_NOW) + offsetMs).toISOString();

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

/** Espera assíncrona (o gancho inline do updateDB não é aguardado pela rota). */
async function until(label: string, probe: () => Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await probe()) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  throw new Error(`timeout esperando: ${label}`);
}

/** Dois tenants completos (b1 com agenda aberta todo dia; b2 mínimo). */
async function seed() {
  const db: DB = emptyDB();
  db.users.push(
    { id: OWNER_A, name: 'Dono A', email: 'a@t.com', passwordHash: 'x', createdAt: FIXED_NOW, role: 'owner' },
    { id: OWNER_B, name: 'Dono B', email: 'b@t.com', passwordHash: 'x', createdAt: FIXED_NOW, role: 'owner' },
    { id: 'ana', name: 'Ana', email: 'ana@t.com', passwordHash: 'x', createdAt: FIXED_NOW, role: 'owner' },
  );
  db.businesses.push(...automationFixtures().businesses);
  db.members.push({
    id: 'm-ana', businessId: 'b1', userId: 'ana', role: 'SECRETARIA', permissions: {},
    active: true, note: 'Secretaria', invitedBy: OWNER_A, createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
  });
  const svc = (id: string, businessId: string) => ({
    id, businessId, categoryId: '', name: 'Consulta', description: '', image: '', price: 10000, showPrice: true,
    durationMin: 30, professionalIds: [], active: true, featured: false, bookable: true, questions: [],
  });
  db.services.push(svc('srv1', 'b1'), svc('srv2', 'b2'));
  db.pipelines.push(getBusinessPipeline(db, 'b1'), getBusinessPipeline(db, 'b2'));
  for (let weekday = 0; weekday <= 6; weekday++) {
    db.availability.push({ id: `av-${weekday}`, businessId: 'b1', professionalId: '', serviceId: '', weekday, start: '08:00', end: '20:00', slotMin: 30 });
  }
  db.webhooks.push({
    id: 'wh-a', businessId: 'b1', url: 'https://invalido.local/hook', secret: 'whsec_segredo_do_teste',
    events: ['lead.updated'], active: true, createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
  });
  await writeDB(db);
}

/** Automação criada PELA API (mesmo caminho de validação do painel). */
async function createAutomation(token: string, businessId: string, draft: Record<string, any>) {
  const res = await automationsPOST(jsonReq('/api/automations', {
    method: 'POST', token, body: { businessId, active: true, ...draft },
  }));
  const json = await body(res);
  if (res.status !== 201) throw new Error(`automação recusada (${res.status}): ${JSON.stringify(json)}`);
  return json.automation as { id: string; name: string };
}

async function cronCall(authorization?: string) {
  return cronGET(jsonReq('/api/cron/automations', authorization ? { headers: { authorization } } : {}));
}

beforeEach(async () => {
  fs.rmSync(TEMP_DB_FILE, { force: true });
  process.env.AUTOMATION_INLINE = '0';   // a fila anda quando o TESTE decidir
  await seed();
});

afterEach(() => {
  delete process.env.AUTOMATION_INLINE;
  delete process.env.CRON_SECRET;
});

describe('P4 auditoria — cron fail-closed e retomada (item 2)', () => {
  async function queuedRunInQueue() {
    const automation = await createAutomation(await createSession(OWNER_A), 'b1', {
      name: 'Simples', event: 'lead.created',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'processado pelo cron' } } }],
    });
    await updateDB((d) => {
      ingestLead(d, { businessId: 'b1', name: 'Na Fila', phone: '11900001000', now: FIXED_NOW });
    });
    return automation;
  }

  it('sem CRON_SECRET a rota responde 503 e NÃO processa nada', async () => {
    const queued = await queuedRunInQueue();
    const res = await cronCall();
    expect(res.status).toBe(503);
    const db = await readDB();
    const run = db.automationRuns.find((r) => r.automationId === queued.id)!;
    expect(run.status).toBe('queued');
    expect((db.leads[0].notes || [])).toHaveLength(0);
    // A resposta é apenas o aviso: nenhum valor de segredo, stack ou fila exposta.
    const json = await body(res);
    expect(Object.keys(json).sort()).toEqual(['error', 'ok']);
    expect(json.error).toContain('desativado');
    expect(JSON.stringify(json)).not.toContain('Bearer');
  });

  it('credencial ausente ou errada responde 401 e deixa a fila intacta', async () => {
    process.env.CRON_SECRET = SECRET;
    const queued = await queuedRunInQueue();
    expect((await cronCall()).status).toBe(401);
    expect((await cronCall('Bearer nao-e-o-segredo')).status).toBe(401);
    const db = await readDB();
    expect(db.automationRuns.find((r) => r.automationId === queued.id)!.status).toBe('queued');
  });

  it('autorizada: processa a fila, retoma espera VENCIDA e não toca na espera futura', async () => {
    process.env.CRON_SECRET = SECRET;
    const automation = await createAutomation(await createSession(OWNER_A), 'b1', {
      name: 'Com espera', event: 'lead.created',
      steps: [
        { kind: 'wait', wait: { mode: 'duration', minutes: 60 } },
        { kind: 'action', action: { type: 'create_task', params: { title: 'Depois da espera' } } },
      ],
    });
    void automation;
    // três leads: um sem espera (fila), dois que vão parar em waiting (um vence, o outro não)
    await updateDB((d) => {
      d.automations.forEach(() => undefined);
      ingestLead(d, { businessId: 'b1', name: 'Um', phone: '11900002001', now: FIXED_NOW });
    });
    await cronCall(`Bearer ${SECRET}`);

    // A espera fica gravada com o momento de retomada e nada aberto.
    let db = await readDB();
    const waiting = db.automationRuns[0];
    expect(waiting.status).toBe('waiting');
    expect(waiting.claimToken).toBeUndefined();
    expect(waiting.claimExpiresAt).toBeUndefined();
    expect(isAutomationRunDue(waiting, new Date(Date.parse(waiting.waitingUntil) - 1000).toISOString())).toBe(false);
    expect(isAutomationRunDue(waiting, new Date(Date.parse(waiting.waitingUntil) + 1000).toISOString())).toBe(true);
    expect(openTasks(db, 'b1')).toHaveLength(0);

    // Antes de vencer, uma chamada autorizada EXTRA não adianta nada.
    const antes = await cronCall(`Bearer ${SECRET}`);
    expect((await body(antes)).completed).toBe(0);
    db = await readDB();
    expect(db.automationRuns[0].status).toBe('waiting');
    expect(openTasks(db, 'b1')).toHaveLength(0);

    // Venceu: a mesma chamada retoma exatamente do próximo nó.
    await updateDB((d) => { d.automationRuns[0].waitingUntil = new Date(Date.now() - 1000).toISOString(); });
    const depois = await body(await cronCall(`Bearer ${SECRET}`));
    expect(depois.completed).toBe(1);
    db = await readDB();
    const done = db.automationRuns[0];
    expect(done.status).toBe('completed');
    expect(done.currentNodeId).not.toBe(waiting.currentNodeId);   // andou um nó
    expect(done.steps).toBeGreaterThan(0);
    const tasks = openTasks(db, 'b1');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Depois da espera');
  });

  it('execução abandonada com posse vencida volta sozinha sem repetir o passo feito', async () => {
    process.env.CRON_SECRET = SECRET;
    await createAutomation(await createSession(OWNER_A), 'b1', {
      name: 'Nota', event: 'lead.created',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'nota da automação' } } }],
    });
    await updateDB((d) => {
      ingestLead(d, { businessId: 'b1', name: 'Interrompida', phone: '11900002100', now: FIXED_NOW });
    });
    // Simula a instância morta: a nota JÁ foi escrita, o nó não avançou, a
    // posse venceu. A retomada não pode escrever a nota de novo.
    await updateDB((d) => {
      const run = d.automationRuns[0];
      const automation = d.automations.find((a) => a.id === run.automationId)!;
      const actionNode = automation.nodes.find((n) => n.type === 'action')!;
      // Estado EXATO de uma instância morta depois da ação e antes do avanço:
      // a nota foi escrita (com a marca run+nó) e o nó ainda é o da ação.
      d.leads[0].notes = d.leads[0].notes || [];
      d.leads[0].notes.push({
        id: 'n-1', text: 'nota da automação', at: FIXED_NOW,
        by: `automation:${run.id}:${actionNode.id}`, byName: 'Automação',
      } as any);
      run.status = 'running';
      run.currentNodeId = actionNode.id;
      run.claimToken = 'instancia_morta';
      run.claimExpiresAt = new Date(Date.now() - 5000).toISOString();
      run.steps = 1;
    });

    const summary = await body(await cronCall(`Bearer ${SECRET}`));
    expect(summary.completed).toBe(1);
    const db = await readDB();
    expect(db.automationRuns[0].status).toBe('completed');
    const notes = (db.leads[0].notes || []).filter((n: any) => String(n.text) === 'nota da automação');
    expect(notes, 'a retomada não pode repetir um efeito já aplicado').toHaveLength(1);
    expect(db.automationRuns[0].history.some((h) => h.outcome === 'skipped')).toBe(true);
  });

  it('execução com posse VIVA não é retomada (duas instâncias não disputam o mesmo nó)', async () => {
    const db0 = await readDB();
    void db0;
    await createAutomation(await createSession(OWNER_A), 'b1', {
      name: 'Viva', event: 'lead.created',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'x' } } }],
    });
    await updateDB((d) => {
      ingestLead(d, { businessId: 'b1', name: 'Protegida', phone: '11900002200', now: FIXED_NOW });
    });
    await updateDB((d) => {
      const run = d.automationRuns[0];
      run.status = 'running';
      run.claimToken = 'outra_instancia';
      run.claimExpiresAt = new Date(Date.now() + 120_000).toISOString();
    });
    const summary = await drainAutomations({});
    expect(summary.claimed).toBe(0);
    const db = await readDB();
    expect(db.automationRuns[0].claimToken).toBe('outra_instancia');
    expect(db.automationRuns[0].status).toBe('running');
  });

  it('automação desativada pela API: nada novo é criado e as esperas encerram', async () => {
    process.env.CRON_SECRET = SECRET;
    const automation = await createAutomation(await createSession(OWNER_A), 'b1', {
      name: 'Desligada', event: 'lead.created',
      steps: [
        { kind: 'wait', wait: { mode: 'duration', minutes: 60 } },
        { kind: 'action', action: { type: 'create_task', params: { title: 'nunca' } } },
      ],
    });
    await updateDB((d) => {
      ingestLead(d, { businessId: 'b1', name: 'Em Espera', phone: '11900002300', now: FIXED_NOW });
    });
    await cronCall(`Bearer ${SECRET}`);
    expect((await readDB()).automationRuns[0].status).toBe('waiting');

    const token = await createSession(OWNER_A);
    const off = await body(await automationsPOST(jsonReq('/api/automations', {
      method: 'POST', token, body: { businessId: 'b1', action: 'toggle', id: automation.id, active: false },
    })));
    expect(off.automation.active).toBe(false);
    expect(off.cancelledRuns).toBe(1);

    const db = await readDB();
    const run = db.automationRuns[0];
    expect(run.status).toBe('cancelled');
    expect(run.finishedAt).not.toBe('');
    expect(openTasks(db, 'b1')).toHaveLength(0);

    // E o gatilho seguinte não cria execução nenhuma.
    await updateDB((d) => {
      ingestLead(d, { businessId: 'b1', name: 'Depois de Desligar', phone: '11900002301', now: FIXED_NOW });
    });
    expect((await readDB()).automationRuns).toHaveLength(1);
  });

  it('sem agendador configurado, o gancho inline retoma a espera vencida', async () => {
    delete process.env.AUTOMATION_INLINE;                 // produção: ligado
    await createAutomation(await createSession(OWNER_A), 'b1', {
      name: 'Inline', event: 'lead.created',
      steps: [
        { kind: 'wait', wait: { mode: 'duration', minutes: 60 } },
        { kind: 'action', action: { type: 'create_task', params: { title: 'retomada inline' } } },
      ],
    });
    await updateDB((d) => {
      ingestLead(d, { businessId: 'b1', name: 'Inline', phone: '11900002400', now: FIXED_NOW });
    });
    await drainAutomations({});                            // deixa em 'waiting'
    expect((await readDB()).automationRuns[0].status).toBe('waiting');

    // Espera AINDA FUTURA: uma escrita qualquer não acorda nada.
    await updateDB((d) => { d.businesses[0].description = 'toc'; });
    await new Promise((r) => setTimeout(r, 250));
    expect((await readDB()).automationRuns[0].status).toBe('waiting');
    expect(openTasks(await readDB(), 'b1')).toHaveLength(0);

    // Vencida: a próxima escrita do sistema (qualquer uma) retoma, sem cron.
    await updateDB((d) => { d.automationRuns[0].waitingUntil = new Date(Date.now() - 1000).toISOString(); });
    for (let i = 0; i < 12; i++) {
      await updateDB((d) => { d.businesses[0].description = `toc-${i}`; });
      try {
        await until('espera vencida retomada inline', async () => openTasks(await readDB(), 'b1').length > 0, 400);
        break;
      } catch {
        if (i === 11) throw new Error('espera vencida não foi retomada pelo gancho inline');
      }
    }
    const db = await readDB();
    expect(db.automationRuns[0].status).toBe('completed');
    expect(openTasks(db, 'b1').map((t) => t.title)).toEqual(['retomada inline']);
  });
});

describe('P4 auditoria — fila por unidade e o que a API devolve', () => {
  it('"processar a fila desta unidade" não executa nem escreve na unidade vizinha', async () => {
    const tokenA = await createSession(OWNER_A);
    const tokenB = await createSession(OWNER_B);
    // Duas automações análogas, uma por unidade (gatilho idêntico).
    const draft = {
      name: 'Anota origem', event: 'lead.created',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'gravado pela automação' } } }],
    };
    const inA = await createAutomation(tokenA, 'b1', draft);
    const inB = await createAutomation(tokenB, 'b2', draft);

    await updateDB((d) => {
      ingestLead(d, { businessId: 'b1', name: 'Lead A', phone: '11900003001', now: FIXED_NOW });
      ingestLead(d, { businessId: 'b2', name: 'Lead B', phone: '11900003002', now: FIXED_NOW });
    });
    let db = await readDB();
    expect(db.automationRuns.map((r) => r.businessId).sort()).toEqual(['b1', 'b2']);
    expect(db.automationRuns.every((r) => r.status === 'queued')).toBe(true);

    // A pede para drenar a própria fila (botão do painel).
    const res = await automationDetailPOST(jsonReq(`/api/automations/${inA.id}?businessId=b1`, {
      method: 'POST', token: tokenA, body: { businessId: 'b1', action: 'drain' },
    }), { params: { id: inA.id } });
    expect(res.status).toBe(200);

    db = await readDB();
    expect(db.automationRuns.find((r) => r.automationId === inA.id)!.status).toBe('completed');
    const runB = db.automationRuns.find((r) => r.automationId === inB.id)!;
    expect(runB.status, 'execução de B não pode ser processada por A').toBe('queued');
    const leadB = db.leads.find((l) => l.phone === '11900003002')!;
    expect((leadB.notes || [])).toHaveLength(0);
  });

  it('a lista nunca devolve a posse interna do motor', async () => {
    const token = await createSession(OWNER_A);
    await createAutomation(token, 'b1', {
      name: 'Lista', event: 'lead.created',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'x' } } }],
    });
    await updateDB((d) => {
      ingestLead(d, { businessId: 'b1', name: 'Lista', phone: '11900003100', now: FIXED_NOW });
      const run = d.automationRuns[0];
      run.status = 'running';
      run.claimToken = 'auto_SEGREDO_DA_POSSE';
      run.claimExpiresAt = iso(30_000);
    });
    const list = await body(await automationsGET(jsonReq('/api/automations?businessId=b1', { token })));
    const raw = JSON.stringify(list);
    expect(raw).not.toContain('auto_SEGREDO_DA_POSSE');
    expect(raw).not.toContain('claimToken');
    expect(raw).not.toContain('claimExpiresAt');
    expect(list.recentRuns[0].status).toBe('running');        // o resto do histórico continua lá
    expect(list.recentRuns[0].context.lead.name).toBe('Lista');
  });

  it('tarefa não aceita referência a lead/agendamento de outra unidade (e não devolve o nome)', async () => {
    const tokenA = await createSession(OWNER_A);
    const tokenB = await createSession(OWNER_B);
    await updateDB((d) => {
      ingestLead(d, { businessId: 'b2', name: 'Cliente SECRETO de B', phone: '11900003200', now: FIXED_NOW });
    });
    const foreignLeadId = (await readDB()).leads[0].id;

    const cross = await tasksPOST(jsonReq('/api/tasks', {
      method: 'POST', token: tokenA,
      body: { businessId: 'b1', title: 'tarefa invasora', leadId: foreignLeadId },
    }));
    expect(cross.status).toBe(422);
    expect(JSON.stringify(await body(cross))).toContain('unidade');

    const list = await body(await tasksGET(jsonReq('/api/tasks?businessId=b1&status=all', { token: tokenA })));
    expect(JSON.stringify(list)).not.toContain('SECRETO');
    expect(list.tasks).toHaveLength(0);

    // O responsável de fora também não entra (mesma regra que a automação usa).
    const assignOutsider = await tasksPOST(jsonReq('/api/tasks', {
      method: 'POST', token: tokenA,
      body: { businessId: 'b1', title: 'com responsável alheio', assignedUserId: OWNER_B },
    }));
    expect(assignOutsider.status).toBe(422);

    // Dentro da própria unidade continua funcionando normalmente.
    const ok = await tasksPOST(jsonReq('/api/tasks', {
      method: 'POST', token: tokenA, body: { businessId: 'b1', title: 'tarefa legítima', assignedUserId: 'ana' },
    }));
    expect(ok.status).toBe(201);
    const db = await readDB();
    expect(db.tasks.some((t) => t.title === 'tarefa legítima' && t.assignedUserId === 'ana')).toBe(true);
  });
});

describe('P4 auditoria — isolamento multi-tenant negativo', () => {
  let automationB = { id: '', name: '' };
  let tokenA = '';
  let tokenB = '';

  beforeEach(async () => {
    tokenA = await createSession(OWNER_A);
    tokenB = await createSession(OWNER_B);
    automationB = await createAutomation(tokenB, 'b2', {
      name: 'Coisa de B', event: 'lead.created',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'de B' } } }],
    });
  });

  it('A não consegue LER, EDITAR, ATIVAR, DUPLICAR nem EXCLUIR a automação de B', async () => {
    const readB = await automationDetailGET(jsonReq(`/api/automations/${automationB.id}?businessId=b1`, { token: tokenA }), { params: { id: automationB.id } });
    expect(readB.status).toBe(404);

    const patchB = await automationsPATCH(jsonReq('/api/automations', {
      method: 'PATCH', token: tokenA, body: { businessId: 'b1', id: automationB.id, name: 'sequestrada' },
    }));
    expect(patchB.status).toBe(404);

    const toggleB = await automationsPOST(jsonReq('/api/automations', {
      method: 'POST', token: tokenA, body: { businessId: 'b1', action: 'toggle', id: automationB.id },
    }));
    expect(toggleB.status).toBe(404);

    const dupB = await automationsPOST(jsonReq('/api/automations', {
      method: 'POST', token: tokenA, body: { businessId: 'b1', action: 'duplicate', id: automationB.id },
    }));
    expect(dupB.status).toBe(404);

    const delB = await automationsDELETE(jsonReq('/api/automations', {
      method: 'DELETE', token: tokenA, body: { businessId: 'b1', id: automationB.id },
    }));
    expect(delB.status).toBe(404);

    // Nem pela própria unidade de B (o contexto da sessão manda).
    const viaB = await automationsDELETE(jsonReq('/api/automations', {
      method: 'DELETE', token: tokenA, body: { businessId: 'b2', id: automationB.id },
    }));
    expect(viaB.status).toBe(403);

    const db = await readDB();
    const still = db.automations.find((a) => a.id === automationB.id)!;
    expect(still.name).toBe('Coisa de B');
    expect(still.active).toBe(true);

    // E o que B realmente faz aparece para B.
    const own = await body(await automationsGET(jsonReq('/api/automations?businessId=b2', { token: tokenB })));
    expect(own.automations.map((a: any) => a.id)).toEqual([automationB.id]);
  });

  it('A não consegue encerrar nem cancelar execução de B, e não vê as tarefas de B', async () => {
    await updateDB((d) => {
      ingestLead(d, { businessId: 'b2', name: 'Lead de B', phone: '11900003300', now: FIXED_NOW });
      createTaskForB(d);
    });
    const db0 = await readDB();
    const runB = db0.automationRuns.find((r) => r.businessId === 'b2')!;
    const taskB = db0.tasks.find((t) => t.businessId === 'b2')!;
    expect(runB).toBeTruthy();
    expect(taskB).toBeTruthy();

    const cancel = await automationDetailPOST(jsonReq(`/api/automations/${automationB.id}?businessId=b1`, {
      method: 'POST', token: tokenA, body: { businessId: 'b1', action: 'cancel-run', runId: runB.id },
    }), { params: { id: automationB.id } });
    expect(cancel.status).toBe(404);

    const cancelViaB2 = await automationDetailPOST(jsonReq(`/api/automations/${automationB.id}?businessId=b2`, {
      method: 'POST', token: tokenA, body: { businessId: 'b2', action: 'cancel-run', runId: runB.id },
    }), { params: { id: automationB.id } });
    expect(cancelViaB2.status).toBe(403);

    const listTasks = await body(await tasksGET(jsonReq('/api/tasks?businessId=b1&status=all', { token: tokenA })));
    expect(JSON.stringify(listTasks)).not.toContain('pendência de B');

    const closeTask = await tasksPATCH(jsonReq('/api/tasks', {
      method: 'PATCH', token: tokenA, body: { businessId: 'b1', id: taskB.id, status: 'done' },
    }));
    expect(closeTask.status).toBe(404);
    expect((await readDB()).tasks.find((t) => t.id === taskB.id)!.status).toBe('open');

    // A execução de B continua viva e intocada.
    const db = await readDB();
    expect(db.automationRuns.find((r) => r.id === runB.id)!.status).toBe('queued');
  });

  it('inverso: B não enxerga nem altera nada de A', async () => {
    const automationA = await createAutomation(tokenA, 'b1', {
      name: 'Coisa de A', event: 'lead.created',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'de A' } } }],
    });
    await updateDB((d) => {
      createTaskForA(d);
      ingestLead(d, { businessId: 'b1', name: 'Lead de A', phone: '11900003400', now: FIXED_NOW });
    });

    const listA = await body(await automationsGET(jsonReq('/api/automations?businessId=b1', { token: tokenB })));
    expect(listA.ok).toBeUndefined();               // 403 antes de qualquer dado
    const readA = await automationDetailGET(jsonReq(`/api/automations/${automationA.id}?businessId=b2`, { token: tokenB }), { params: { id: automationA.id } });
    expect(readA.status).toBe(404);
    const patchA = await automationsPATCH(jsonReq('/api/automations', {
      method: 'PATCH', token: tokenB, body: { businessId: 'b2', id: automationA.id, name: 'invadida' },
    }));
    expect(patchA.status).toBe(404);

    const tasksB = await body(await tasksGET(jsonReq('/api/tasks?businessId=b2&status=all', { token: tokenB })));
    expect(JSON.stringify(tasksB)).not.toContain('pendência de A');
    const db = await readDB();
    expect(db.automations.find((a) => a.id === automationA.id)!.name).toBe('Coisa de A');
    expect(db.tasks.find((t) => t.businessId === 'b1')!.status).toBe('open');
  });

  it('um evento emitido no contexto de A não cria execução na automação de B', async () => {
    const db = await readDB();
    const leadA = db.leads[0]?.id || 'lead-de-a';
    const res = emitAutomationEvent(db, { event: 'lead.created', businessId: 'b1', leadId: leadA, at: FIXED_NOW, data: { isNew: true } });
    expect(res.matched).toBe(0);                    // A não tem automação neste teste
    expect(res.created).toHaveLength(0);
    // Mesmo conteúdo na unidade certa cria exatamente uma (em b2, a automação é de B).
    const inB = emitAutomationEvent(db, { event: 'lead.created', businessId: 'b2', leadId: leadA, at: FIXED_NOW, data: { isNew: true } });
    expect(inB.created.map((r) => r.businessId)).toEqual(['b2']);
  });
});

function createTaskForB(d: DB) {
  d.tasks.push({
    id: 'task-b-1', businessId: 'b2', title: 'pendência de B', note: '', status: 'open',
    dueAt: '', createdAt: FIXED_NOW, updatedAt: FIXED_NOW, doneAt: '', assignedUserId: '',
    createdBy: OWNER_B, source: 'manual',
  });
}

function createTaskForA(d: DB) {
  d.tasks.push({
    id: 'task-a-1', businessId: 'b1', title: 'pendência de A', note: '', status: 'open',
    dueAt: '', createdAt: FIXED_NOW, updatedAt: FIXED_NOW, doneAt: '', assignedUserId: '',
    createdBy: OWNER_A, source: 'manual',
  });
}

describe('P4 auditoria — contrato de gravação das configurações de dedupe', () => {
  it('dedupeField válido é gravado e sobrevive à leitura', async () => {
    const token = await createSession(OWNER_A);
    const created = await createAutomation(token, 'b1', {
      name: 'Follow-up uma vez por lead', event: 'lead.created',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'oi' } } }],
      settings: { dedupeField: 'lead.id' },
    });
    const detail = await body(await automationDetailGET(
      jsonReq(`/api/automations/${created.id}?businessId=b1`, { token }), { params: { id: created.id } },
    ));
    expect(detail.automation.settings.dedupeField).toBe('lead.id');
  });

  it('dedupeField INVÁLIDO não é gravado às cegas: criar e editar devolvem o aviso', async () => {
    const token = await createSession(OWNER_A);
    const created = await automationsPOST(jsonReq('/api/automations', {
      method: 'POST', token,
      body: {
        businessId: 'b1', name: 'Campo errado', active: true, event: 'lead.created',
        steps: [], settings: { dedupeField: 'lead.passwordHash' },
      },
    }));
    expect(created.status).toBe(201);
    const createdJson = await body(created);
    expect(createdJson.warnings.join(' ')).toContain('deduplicação');
    expect(createdJson.automation.settings.dedupeField).toBeUndefined();

    const patched = await automationsPATCH(jsonReq('/api/automations', {
      method: 'PATCH', token,
      body: { businessId: 'b1', id: createdJson.automation.id, settings: { dedupeField: 'nao.existe' } },
    }));
    expect(patched.status).toBe(200);
    const patchedJson = await body(patched);
    expect(patchedJson.warnings.join(' ')).toContain('inválido ignorado');
    expect(patchedJson.warnings.join(' ')).toContain('deduplicação');
    expect(patchedJson.automation.settings.dedupeField).toBeUndefined();
  });
});

describe('P4 auditoria — persistência e poda (item 6)', () => {
  it('falha de leitura NUNCA é tratada como banco vazio (nada é sobrescrito)', async () => {
    await updateDB((d) => {
      d.businesses[0].name = 'Empresa A — antes da falha';
    });
    const before = fs.readFileSync(TEMP_DB_FILE, 'utf8');
    fs.writeFileSync(TEMP_DB_FILE + '.corrompido', before);
    fs.writeFileSync(TEMP_DB_FILE, '{ isso não é json');

    await expect(readDB()).rejects.toBeTruthy();
    await expect(updateDB((d) => { d.businesses[0].name = 'POR CIMA DO ERRO'; })).rejects.toBeTruthy();

    // O arquivo continuou exatamente como estava (a gravação não aconteceu).
    expect(fs.readFileSync(TEMP_DB_FILE, 'utf8')).toBe('{ isso não é json');
    fs.writeFileSync(TEMP_DB_FILE, before);
    const db = await readDB();
    expect(db.businesses.find((b) => b.id === 'b1')!.name).toBe('Empresa A — antes da falha');
  });

  it('a poda preserva queued/running/waiting mesmo com o histórico estourado', async () => {
    await updateDB((d) => {
      for (let i = 0; i < 500; i++) {
        d.automationRuns.push({
          id: `old-${i}`, businessId: 'b1', automationId: 'auto-velha', automationName: 'velha',
          status: 'completed', triggerEvent: 'lead.created', currentNodeId: '', context: {},
          waitingUntil: '', startedAt: iso(-60_000 - i), updatedAt: iso(-60_000 - i),
          finishedAt: iso(-60_000 - i), error: '', history: [], eventKey: `old-${i}`,
          emittedByRunId: '', steps: 1, resumes: 0,
        } as any);
      }
      d.automationRuns.push({
        id: 'live-waiting', businessId: 'b1', automationId: 'auto-velha', automationName: 'velha',
        status: 'waiting', triggerEvent: 'lead.created', currentNodeId: 'do_2', context: {},
        waitingUntil: iso(86400_000 * 5), startedAt: FIXED_NOW, updatedAt: FIXED_NOW,
        finishedAt: '', error: '', history: [], eventKey: 'live-w', emittedByRunId: '', steps: 2, resumes: 0,
      } as any);
    });
    const db = await readDB();
    const waiting = db.automationRuns.find((r) => r.id === 'live-waiting');
    expect(waiting, 'espera no futuro não pode ser podada').toBeTruthy();
    expect(waiting!.waitingUntil).toBe(iso(86400_000 * 5));
    const finished = db.automationRuns.filter((r) => r.status === 'completed');
    expect(finished.length).toBeGreaterThan(0);
    expect(finished.length).toBeLessThanOrEqual(200);

    // Histórico cheio não quebra o fluxo: um lead novo entra, é processado e a
    // espera alheia continua viva.
    await createAutomation(await createSession(OWNER_A), 'b1', {
      name: 'Com histórico cheio', event: 'lead.created',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'mesmo com fila cheia' } } }],
    });
    await updateDB((d) => {
      ingestLead(d, { businessId: 'b1', name: 'Com histórico cheio', phone: '11900003500', now: FIXED_NOW });
    });
    await drainAutomations({});
    const after = await readDB();
    expect(after.automationRuns.some((r) => r.businessId === 'b1' && r.status === 'completed')).toBe(true);
    expect(after.automationRuns.find((r) => r.id === 'live-waiting')!.status).toBe('waiting');
  });
});

describe('P4 auditoria — fluxo ponta a ponta (item 3)', () => {
  it('lead → gatilho → condição → etapa → espera → tarefa → webhook → conclusão', async () => {
    process.env.CRON_SECRET = SECRET;
    const token = await createSession(OWNER_A);
    await createAutomation(token, 'b1', {
      name: 'Follow-up do Instagram', event: 'lead.created',
      condition: { field: 'lead.origin', operator: 'equals', value: 'instagram' },
      steps: [
        { kind: 'action', action: { type: 'change_lead_stage', params: { stageId: 'qualifying' } } },
        { kind: 'action', action: { type: 'update_lead', params: { priority: 'high', nextAction: 'ligar hoje' } } },
        { kind: 'wait', wait: { mode: 'duration', minutes: 60 } },
        { kind: 'action', action: { type: 'create_task', params: { title: 'Ligar para {{lead.name}}', assignee: 'leadOwner' } } },
        { kind: 'action', action: { type: 'dispatch_webhook', params: { event: 'lead.updated', note: 'follow-up criado' } } },
      ],
      elseSteps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'fora do público-alvo' } } }],
    });

    // 1) lead entra pelo serviço oficial (como na página/API/assistente).
    await updateDB((d) => {
      ingestLead(d, { businessId: 'b1', name: 'Rafael', phone: '11911112222', source: 'instagram', now: FIXED_NOW });
    });
    let db = await readDB();
    expect(db.automationRuns).toHaveLength(1);
    expect(db.automationRuns[0].status).toBe('queued');

    // 2) o cron roda: condição verdadeira → etapa + prioridade + espera.
    let summary = await body(await cronCall(`Bearer ${SECRET}`));
    expect(summary.waiting).toBe(1);
    db = await readDB();
    const run = db.automationRuns[0];
    expect(run.status).toBe('waiting');
    expect(db.leads[0].stageId).toBe('qualifying');
    expect(db.leads[0].priority).toBe('high');
    expect(db.leads[0].nextAction).toBe('ligar hoje');
    // A esteira registrou o movimento com a AUTOMAÇÃO como autora (não um buraco).
    const history = db.leads[0].stageHistory || [];
    expect(history.at(-1)!.movedBy).toBe('automation');
    expect(history.at(-1)!.movedByName).toContain('Follow-up do Instagram');
    // Nada depois da espera aconteceu ainda.
    expect(openTasks(db, 'b1')).toHaveLength(0);
    expect(db.webhookDeliveries).toHaveLength(0);

    // 3) espera vence → retomada → tarefa + webhook → conclusão.
    await updateDB((d) => { d.automationRuns[0].waitingUntil = new Date(Date.now() - 1000).toISOString(); });
    summary = await body(await cronCall(`Bearer ${SECRET}`));
    expect(summary.completed).toBe(1);
    db = await readDB();
    const done = db.automationRuns[0];
    expect(done.status).toBe('completed');
    expect(done.finishedAt).not.toBe('');
    const tasks = openTasks(db, 'b1');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Ligar para Rafael');
    expect(tasks[0].source).toBe('automation');
    expect(tasks[0].leadId).toBe(db.leads[0].id);
    // O webhook saiu pelo CANAL DO P3 (fila + retry), não por um caminho paralelo.
    expect(db.webhookDeliveries).toHaveLength(1);
    expect(db.webhookDeliveries[0].businessId).toBe('b1');
    expect(db.webhookDeliveries[0].event).toBe('lead.updated');
    expect(JSON.stringify(db.webhookDeliveries[0])).not.toContain('whsec_');
    // Histórico legível, sem segredo.
    const labels = done.history.map((h) => h.label).join(' | ');
    expect(labels).toContain('Gatilho');
    expect(labels).toContain('Condição');
    expect(labels).toContain('Esperando');
    expect(labels).toContain('Execução concluída');
    expect(JSON.stringify(done)).not.toContain('whsec_');

    // 4) rodar de novo não duplica nada (execução terminal nunca volta).
    const again = await body(await cronCall(`Bearer ${SECRET}`));
    expect(again.claimed).toBe(0);
    db = await readDB();
    expect(openTasks(db, 'b1')).toHaveLength(1);
    expect(db.automationRuns).toHaveLength(1);

    // 5) condição FALSA: executa o "Senão", sem mexer na esteira.
    await updateDB((d) => {
      ingestLead(d, { businessId: 'b1', name: 'Visitante', phone: '11911113333', source: 'google', now: FIXED_NOW });
    });
    summary = await body(await cronCall(`Bearer ${SECRET}`));
    expect(summary.completed).toBe(1);
    db = await readDB();
    const secondRun = db.automationRuns[1];
    expect(secondRun.status).toBe('completed');
    expect(db.leads[1].stageId).toBe('new');
    expect((db.leads[1].notes || []).map((n: any) => n.text)).toContain('fora do público-alvo');
    expect(openTasks(db, 'b1')).toHaveLength(1);        // nenhuma tarefa nova no caminho "não"
  });

  it('ação recusada pela agenda falha com diagnóstico e não estraga a operação do usuário', async () => {
    process.env.CRON_SECRET = SECRET;
    const token = await createSession(OWNER_A);
    await createAutomation(token, 'b1', {
      name: 'Agenda impossível', event: 'lead.created',
      steps: [{ kind: 'action', action: { type: 'create_booking', params: { serviceId: 'srv1', date: '2099-01-15', time: '10:00' } } }],
    });
    await updateDB((d) => {
      ingestLead(d, { businessId: 'b1', name: 'Impossível', phone: '11900004000', now: FIXED_NOW });
    });
    const summary = await body(await cronCall(`Bearer ${SECRET}`));
    expect(summary.failed).toBe(1);
    const db = await readDB();
    expect(db.automationRuns[0].status).toBe('failed');
    expect(db.automationRuns[0].error).toContain('agenda');
    // O lead do usuário existe e está intacto; nenhuma linha de agenda foi criada.
    expect(db.leads[0].name).toBe('Impossível');
    expect(db.bookings).toHaveLength(0);
    // O erro é legível para o lojista: frase curta, sem stack trace nem caminho de arquivo.
    const errorLine = db.automationRuns[0].history.find((h) => h.outcome === 'error');
    expect(errorLine).toBeTruthy();
    expect((errorLine!.detail || '').length).toBeLessThan(301);
    expect((errorLine!.detail || '') + db.automationRuns[0].error).not.toMatch(/at \S+\.ts|\n\s+at /);
  });

  it('reserva criada pela automação usa o motor de agenda real e o cancelamento volta pelo mesmo caminho', async () => {
    process.env.CRON_SECRET = SECRET;
    const token = await createSession(OWNER_A);
    // cria booking no slot livre + depois cancela quando o lead for marcado perdido
    await createAutomation(token, 'b1', {
      name: 'Agenda e cancela', event: 'lead.created',
      steps: [
        { kind: 'action', action: { type: 'create_booking', params: { serviceId: 'srv1', date: FUTURE_DAY, time: '09:00' } } },
        { kind: 'action', action: { type: 'assign_lead', params: { target: 'member', userId: 'ana' } } },
      ],
    });
    await updateDB((d) => {
      ingestLead(d, { businessId: 'b1', name: 'Agendado', phone: '11900004100', now: FIXED_NOW });
    });
    const summary = await body(await cronCall(`Bearer ${SECRET}`));
    expect(summary.completed).toBe(1);
    let db = await readDB();
    expect(db.bookings).toHaveLength(1);
    expect(db.bookings[0].date).toBe(FUTURE_DAY);
    expect(db.leads[0].assignedUserId).toBe('ana');
    const bookingId = db.bookings[0].id;

    // Cancelar pelo painel usa a transição oficial ⇒ dispara booking.cancelled,
    // que é o gatilho da segunda automação (que cancela nada: já está cancelado).
    await createAutomation(token, 'b1', {
      name: 'Avisar cancelamento', event: 'booking.cancelled',
      steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'cancelado' } } }],
    });
    const { applyBookingStatusTx } = await import('../booking-status');
    await updateDB((d) => {
      applyBookingStatusTx(d, { businessId: 'b1', bookingId, to: 'cancelled', by: 'system', note: 'teste', now: FIXED_NOW });
    });
    db = await readDB();
    const cancelRun = db.automationRuns.find((r) => r.triggerEvent === 'booking.cancelled');
    expect(cancelRun, 'cancelamento oficial precisa gerar o gatilho').toBeTruthy();
    await drainAutomations({});
    db = await readDB();
    expect((db.leads[0].notes || []).map((n: any) => n.text)).toContain('cancelado');
  });
});
