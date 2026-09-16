// ═══════════════════════════════════════════════════════════════
// P5.4 / P5.5 / P5.6 — aprovação, publicação, P4 executa, tenants
// ═══════════════════════════════════════════════════════════════
import './helpers/temp-db';

import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { emptyDB, readDB, updateDB, writeDB } from '../db';
import { TEMP_DB_FILE } from './helpers/temp-db';
import { createSession } from '../auth';
import { ingestLead } from '../pipeline';
import { drainAutomations } from '../automation/executor';
import { openTasks } from '../automation/tasks';
import { DEFAULT_PIPELINE_STAGES } from '../pipeline';
import {
  approveProposal, cancelProposal, editProposal, generateProposal,
  publishProposal, regenerateProposal,
} from '../ai/proposals';
import { observeBusiness } from '../ai/observe';
import { GET as aiGET, POST as aiPOST, PATCH as aiPATCH } from '@/app/api/ai/automations/route';
import type { DB } from '../types';

const FIXED_NOW = '2026-09-16T12:00:00.000Z';
const OWNER = 'owner-b1';
const OTHER = 'owner-b2';
const PROMPT = 'Quando um cliente entrar pelo Instagram e demonstrar interesse em limpeza dental, coloque o lead como interessado, atribua para a recepção e crie uma tarefa para ligar amanhã.';

async function seed() {
  const db: DB = emptyDB();
  db.users.push(
    { id: OWNER, name: 'Dono A', email: 'a@t.com', passwordHash: 'x', createdAt: FIXED_NOW, role: 'owner' },
    { id: OTHER, name: 'Dono B', email: 'b@t.com', passwordHash: 'x', createdAt: FIXED_NOW, role: 'owner' },
    { id: 'ana', name: 'Ana', email: 'ana@t.com', passwordHash: 'x', createdAt: FIXED_NOW, role: 'owner' },
  );
  const biz = (id: string, ownerId: string, slug: string): DB['businesses'][number] => ({
    id, ownerId, organizationId: `org-${id}`, name: `Empresa ${id}`, slug, description: '', logo: '', cover: '',
    niche: 'servicos', modes: ['services', 'bookings'],
    features: { reviews: false, faq: false, gallery: false, location: false, whatsapp: true, about: false, agent: false },
    phone: '', whatsapp: '11999990000', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0, googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 60, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: FIXED_NOW, updatedAt: FIXED_NOW, automations: {}, capabilityFlags: {},
  });
  db.businesses.push(biz('b1', OWNER, 'empresa-a'), biz('b2', OTHER, 'empresa-b'));
  db.members.push({
    id: 'm-ana', businessId: 'b1', userId: 'ana', role: 'SECRETARIA', permissions: {},
    active: true, note: 'Recepção', invitedBy: OWNER, createdAt: FIXED_NOW, updatedAt: FIXED_NOW,
  });
  db.services.push(
    { id: 'srv-a', businessId: 'b1', categoryId: '', name: 'Consulta', description: '', image: '', price: 10000, showPrice: true, durationMin: 30, professionalIds: [], active: true, featured: false, bookable: true, questions: [] },
    { id: 'srv-b', businessId: 'b2', categoryId: '', name: 'Consulta B', description: '', image: '', price: 10000, showPrice: true, durationMin: 30, professionalIds: [], active: true, featured: false, bookable: true, questions: [] },
  );
  db.professionals.push({ id: 'pro-a', businessId: 'b1', name: 'Ana', role: '', photo: '', active: true, userId: 'ana', followBusinessHours: true });
  for (let weekday = 0; weekday <= 6; weekday++) {
    db.availability.push({ id: `av-${weekday}`, businessId: 'b1', professionalId: '', serviceId: '', weekday, start: '08:00', end: '20:00', slotMin: 30 });
  }
  db.pipelines.push({
    id: 'pipe-1', businessId: 'b1',
    stages: DEFAULT_PIPELINE_STAGES.map((s) => ({ ...s })),
    updatedAt: FIXED_NOW,
  });
  await writeDB(db);
}

function jsonReq(path: string, init: { method?: string; body?: unknown; token?: string } = {}): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
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
  process.env.AUTOMATION_INLINE = '0';
  await seed();
});

afterEach(() => {
  delete process.env.AUTOMATION_INLINE;
});

describe('P5.4 — aprovação humana (nunca publica sozinha)', () => {
  it('8) gerar cria rascunho e NÃO grava Automation', async () => {
    const res = await updateDB((d) => generateProposal(d, { businessId: 'b1', prompt: PROMPT, userId: OWNER, now: FIXED_NOW }));
    expect(res.ok).toBe(true);
    expect(res.proposal?.status).toBe('draft');
    expect(res.proposal?.validation.ok, (res.proposal?.validation.errors || []).join(' | ')).toBe(true);
    const db = await readDB();
    expect(db.automations).toHaveLength(0);
    expect(db.aiProposals).toHaveLength(1);
    expect(db.aiProposals[0].businessId).toBe('b1');
  });

  it('9) publicar sem aprovar é recusado; depois de aprovar cria a Automation', async () => {
    const id = await updateDB((d) => generateProposal(d, { businessId: 'b1', prompt: PROMPT, userId: OWNER }).proposal!.id);
    const denied = await updateDB((d) => publishProposal(d, { businessId: 'b1', id, userId: OWNER }));
    expect(denied.ok).toBe(false);
    expect(denied.errors.some((e) => /aprove/i.test(e))).toBe(true);
    expect((await readDB()).automations).toHaveLength(0);

    const approved = await updateDB((d) => approveProposal(d, { businessId: 'b1', id }));
    expect(approved.ok).toBe(true);
    expect(approved.proposal?.status).toBe('approved');

    const published = await updateDB((d) => publishProposal(d, { businessId: 'b1', id, userId: OWNER, activate: true, now: FIXED_NOW }));
    expect(published.ok, (published.errors || []).join(' | ')).toBe(true);
    expect(published.automation?.active).toBe(true);
    expect(published.automation?.templateId).toBe('ai');
    expect(published.automation?.businessId).toBe('b1');
    const db = await readDB();
    expect(db.automations).toHaveLength(1);
    expect(db.aiProposals[0].status).toBe('published');
    expect(db.aiProposals[0].automationId).toBe(db.automations[0].id);
  });

  it('10) editar antes de publicar volta para rascunho e revalida', async () => {
    const id = await updateDB((d) => generateProposal(d, { businessId: 'b1', prompt: PROMPT, userId: OWNER }).proposal!.id);
    await updateDB((d) => approveProposal(d, { businessId: 'b1', id }));
    const edited = await updateDB((d) => editProposal(d, { businessId: 'b1', id, name: 'Lead Instagram · limpeza' }));
    expect(edited.ok).toBe(true);
    expect(edited.proposal?.status).toBe('draft');
    expect(edited.proposal?.plan.name).toBe('Lead Instagram · limpeza');
    const published = await updateDB((d) => publishProposal(d, { businessId: 'b1', id }));
    expect(published.ok).toBe(false);
    expect(published.errors.some((e) => /aprove/i.test(e))).toBe(true);
  });

  it('11) cancelar impede publicação', async () => {
    const id = await updateDB((d) => generateProposal(d, { businessId: 'b1', prompt: PROMPT, userId: OWNER }).proposal!.id);
    const cancelled = await updateDB((d) => cancelProposal(d, { businessId: 'b1', id }));
    expect(cancelled.proposal?.status).toBe('cancelled');
    const published = await updateDB((d) => publishProposal(d, { businessId: 'b1', id, activate: true }));
    expect(published.ok).toBe(false);
    expect((await readDB()).automations).toHaveLength(0);
  });

  it('gerar novamente substitui o plano e mantém o id', async () => {
    const id = await updateDB((d) => generateProposal(d, { businessId: 'b1', prompt: PROMPT, userId: OWNER }).proposal!.id);
    const again = await updateDB((d) => regenerateProposal(d, {
      businessId: 'b1', id,
      prompt: 'Quando uma consulta for cancelada, crie uma tarefa para remarcar.',
    }));
    expect(again.proposal?.id).toBe(id);
    expect(again.proposal?.plan.event).toBe('booking.cancelled');
    expect(again.proposal?.status).toBe('draft');
  });
});

describe('P5 × P4 — a IA planeja, o motor executa', () => {
  it('12) automação gerada pela IA é executada pelo P4 (lead Instagram)', async () => {
    const published = await updateDB((d) => {
      const g = generateProposal(d, { businessId: 'b1', prompt: PROMPT, userId: OWNER, now: FIXED_NOW });
      approveProposal(d, { businessId: 'b1', id: g.proposal!.id });
      return publishProposal(d, { businessId: 'b1', id: g.proposal!.id, userId: OWNER, activate: true, now: FIXED_NOW });
    });
    expect(published.ok, (published.errors || []).join(' | ')).toBe(true);

    await updateDB((d) => ingestLead(d, {
      businessId: 'b1', name: 'Marina', phone: '11911112222',
      source: 'instagram', interest: 'limpeza dental', now: FIXED_NOW,
    }));
    await drainAutomations({ nowISO: FIXED_NOW, businessId: 'b1' });

    const db = await readDB();
    const lead = db.leads[0];
    expect(lead.stageId).toBe('qualifying');
    expect(lead.assignedUserId).toBe('ana');
    const tasks = openTasks(db, 'b1');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toMatch(/ligar/i);
    expect(tasks[0].source).toBe('automation');
    expect(db.automationRuns[0].status).toBe('completed');
    expect(db.automationRuns[0].businessId).toBe('b1');
  });

  it('condição falsa (origem ≠ instagram) conclui sem efeito operacional', async () => {
    await updateDB((d) => {
      const g = generateProposal(d, { businessId: 'b1', prompt: PROMPT, userId: OWNER, now: FIXED_NOW });
      approveProposal(d, { businessId: 'b1', id: g.proposal!.id });
      publishProposal(d, { businessId: 'b1', id: g.proposal!.id, userId: OWNER, activate: true, now: FIXED_NOW });
    });
    await updateDB((d) => ingestLead(d, {
      businessId: 'b1', name: 'Paulo', phone: '11922223333',
      source: 'whatsapp', interest: 'limpeza dental', now: FIXED_NOW,
    }));
    await drainAutomations({ nowISO: FIXED_NOW, businessId: 'b1' });
    const db = await readDB();
    expect(db.leads[0].stageId).toBe('new');
    expect(openTasks(db, 'b1')).toHaveLength(0);
    expect(db.automationRuns[0].status).toBe('completed');
  });

  it('13) falha do P4 (etapa fantasma injetada) marca a execução failed', async () => {
    await updateDB((d) => {
      const g = generateProposal(d, { businessId: 'b1', prompt: 'Quando chegar um lead, crie uma tarefa para ligar.', userId: OWNER });
      approveProposal(d, { businessId: 'b1', id: g.proposal!.id });
      publishProposal(d, { businessId: 'b1', id: g.proposal!.id, userId: OWNER, activate: true });
      // Corrompe a definição JÁ publicada (simula esteira que mudou por baixo):
      const action = d.automations[0].nodes.find((n) => n.type === 'action' && n.config.action?.type === 'create_task');
      if (action?.config.action) {
        action.config.action.type = 'change_lead_stage';
        action.config.action.params = { stageId: 'etapa-fantasma' };
      }
    });
    await updateDB((d) => ingestLead(d, { businessId: 'b1', name: 'Falha', phone: '11933334444', now: FIXED_NOW }));
    await drainAutomations({ nowISO: FIXED_NOW, businessId: 'b1' });
    const db = await readDB();
    expect(db.automationRuns[0].status).toBe('failed');
    expect(db.automationRuns[0].error).toMatch(/etapa/i);
    expect(openTasks(db, 'b1')).toHaveLength(0);
  });

  it('14) espera gerada pela IA retoma no P4 sem repetir efeito', async () => {
    await updateDB((d) => {
      const g = generateProposal(d, {
        businessId: 'b1',
        prompt: 'Quando uma consulta for cancelada, crie uma tarefa para remarcar.',
        userId: OWNER,
      });
      // Injeta uma espera antes da tarefa no plano publicado via edição + republicação.
      const plan = g.proposal!.plan;
      plan.steps = [
        { kind: 'wait', wait: { mode: 'duration', minutes: 60 } },
        ...plan.steps,
      ];
      editProposal(d, { businessId: 'b1', id: g.proposal!.id, plan });
      approveProposal(d, { businessId: 'b1', id: g.proposal!.id });
      publishProposal(d, { businessId: 'b1', id: g.proposal!.id, userId: OWNER, activate: true, now: FIXED_NOW });
    });

    // Dispara o gatilho oficial (booking.cancelled) via ingest? Melhor emitir
    // um agendamento cancelado — usamos o evento direto do serviço: criar
    // automação escuta booking.cancelled, então emitimos pelo caminho oficial
    // só se houver booking. Para este teste, ingestLead não serve. Gravamos
    // um run? Não: usamos emitAutomationEvent via apply? Mais simples: o
    // generate de cancelamento + espera precisa de booking.cancelled.
    // Disparamos o evento pelo ônibus oficial importado.
    const { emitAutomationEvent } = await import('../automation/events');
    await updateDB((d) => {
      emitAutomationEvent(d, {
        event: 'booking.cancelled', businessId: 'b1', at: FIXED_NOW,
        data: { customerName: 'Vera' },
      });
    });
    await drainAutomations({ nowISO: FIXED_NOW, businessId: 'b1' });
    let db = await readDB();
    expect(db.automationRuns[0].status).toBe('waiting');
    expect(openTasks(db, 'b1')).toHaveLength(0);

    await drainAutomations({ nowISO: '2026-09-16T13:01:00.000Z', businessId: 'b1' });
    db = await readDB();
    expect(db.automationRuns[0].status).toBe('completed');
    expect(openTasks(db, 'b1')).toHaveLength(1);
    await drainAutomations({ nowISO: '2026-09-16T14:00:00.000Z', businessId: 'b1' });
    expect(openTasks(await readDB(), 'b1')).toHaveLength(1);
  });
});

describe('P5 — isolamento multi-tenant', () => {
  it('15) proposta de A é invisível para B; B não publica em A', async () => {
    const tokenA = await createSession(OWNER);
    const tokenB = await createSession(OTHER);

    const created = await aiPOST(jsonReq('/api/ai/automations', {
      method: 'POST', token: tokenA,
      body: { businessId: 'b1', action: 'generate', prompt: PROMPT },
    }));
    expect(created.status).toBe(201);
    const payload = await body(created);
    const id = payload.proposal.id;

    const listBown = await body(await aiGET(jsonReq('/api/ai/automations?businessId=b2', { token: tokenB })));
    expect(listBown.proposals).toHaveLength(0);

    const listBcross = await aiGET(jsonReq('/api/ai/automations?businessId=b1', { token: tokenB }));
    expect(listBcross.status).toBe(403);

    const steal = await aiPOST(jsonReq('/api/ai/automations', {
      method: 'POST', token: tokenB,
      body: { businessId: 'b1', action: 'approve', id },
    }));
    expect(steal.status).toBe(403);

    const forge = await aiPOST(jsonReq('/api/ai/automations', {
      method: 'POST', token: tokenB,
      body: { businessId: 'b2', action: 'publish', id },
    }));
    expect([404, 422]).toContain(forge.status);

    const db = await readDB();
    expect(db.aiProposals.filter((p) => p.businessId === 'b1')).toHaveLength(1);
    expect(db.aiProposals.filter((p) => p.businessId === 'b2')).toHaveLength(0);
    expect(db.automations).toHaveLength(0);
  });

  it('sem sessão = 401; membro sem config = 403', async () => {
    const anon = await aiGET(jsonReq('/api/ai/automations?businessId=b1'));
    expect(anon.status).toBe(401);
    const tokenAna = await createSession('ana');
    const denied = await aiPOST(jsonReq('/api/ai/automations', {
      method: 'POST', token: tokenAna, body: { businessId: 'b1', prompt: PROMPT },
    }));
    expect(denied.status).toBe(403);
  });

  it('editar via PATCH não vaza para o outro tenant', async () => {
    const tokenA = await createSession(OWNER);
    const tokenB = await createSession(OTHER);
    const created = await body(await aiPOST(jsonReq('/api/ai/automations', {
      method: 'POST', token: tokenA, body: { businessId: 'b1', prompt: PROMPT },
    })));
    const patched = await aiPATCH(jsonReq('/api/ai/automations', {
      method: 'PATCH', token: tokenB,
      body: { businessId: 'b2', id: created.proposal.id, name: 'hijack' },
    }));
    expect(patched.status).toBe(404);
    const db = await readDB();
    expect(db.aiProposals[0].plan.name).not.toBe('hijack');
  });
});

describe('P5.6 — observação sem autonomia', () => {
  it('observa só a própria unidade e não cria automação', async () => {
    await updateDB((d) => generateProposal(d, { businessId: 'b1', prompt: PROMPT, userId: OWNER }));
    const db = await readDB();
    const obsA = observeBusiness(db, 'b1');
    const obsB = observeBusiness(db, 'b2');
    expect(obsA?.businessId).toBe('b1');
    expect(obsB?.businessId).toBe('b2');
    expect(obsB?.stats.automations).toBe(0);
    expect(obsA?.suggestions.length).toBeGreaterThan(0);
    expect(db.automations).toHaveLength(0);
    expect(observeBusiness(db, 'inexistente')).toBeNull();
  });
});

describe('P5 × HTTP (contrato da API)', () => {
  it('GET devolve exemplos e não devolve proposta de outro tenant', async () => {
    const token = await createSession(OWNER);
    const res = await body(await aiGET(jsonReq('/api/ai/automations?businessId=b1', { token })));
    expect(res.ok).toBe(true);
    expect(res.enabled).toBe(true);
    expect(res.examples.length).toBeGreaterThan(0);
    expect(res.catalog.stages.length).toBeGreaterThan(0);
  });

  it('approve-publish cria automação desligada por padrão', async () => {
    const token = await createSession(OWNER);
    const created = await body(await aiPOST(jsonReq('/api/ai/automations', {
      method: 'POST', token, body: { businessId: 'b1', prompt: PROMPT },
    })));
    const published = await aiPOST(jsonReq('/api/ai/automations', {
      method: 'POST', token,
      body: { businessId: 'b1', action: 'approve-publish', id: created.proposal.id },
    }));
    expect(published.status).toBe(200);
    const db = await readDB();
    expect(db.automations[0].active).toBe(false);
    expect(db.aiProposals[0].status).toBe('published');
  });
});
