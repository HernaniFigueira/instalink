// A3 CORREÇÃO CIRÚRGICA — regressões para revisão externa
import { describe, expect, it } from 'vitest';
import { emptyDB } from '../db';
import {
  getBusinessPipeline,
  moveLeadStage,
  ingestLead,
  normalizeLeadStageId,
  mapStageToStatus,
  markLeadScheduled,
} from '../pipeline';
import { applyBookingStatusTx } from '../booking-status';
import { createWinBackLeads } from '../automations';
import { createTaskTx } from '../automation/tasks';
import type { Business, Lead, Service } from '../types';
import { onlyDigits } from '../utils';
import * as fs from 'node:fs';
import * as path from 'node:path';

const NOW = '2026-09-16T12:00:00.000Z';
const FUTURE_DATE = '2026-09-21';
const FUTURE_TIME = '09:00';

function biz(id: string): Business {
  return {
    id,
    ownerId: `owner-${id}`,
    organizationId: `org-${id}`,
    name: `Negócio ${id}`,
    slug: id,
    description: '', logo: '', cover: '', niche: 'servicos',
    modes: ['services','bookings'], phone: '', whatsapp: '11999990000', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0,
    googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 60, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: NOW, updatedAt: NOW,
  } as Business;
}
function service(id: string, businessId: string): Service {
  return {
    id, businessId, categoryId: '', name: 'Serviço', description: '', image: '',
    price: 5000, durationMin: 30, professionalIds: [], active: true, featured: false, bookable: true, questions: [],
  } as Service;
}

describe('A3 Correção — moveLeadStage no-op repara projeção', () => {
  it('23 - no-op repara status legado sem histórico/evento', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    const pipeline = getBusinessPipeline(d, 'b1');
    // Lead com etapa scheduled mas status divergente lost (legado)
    d.leads.push({
      id: 'l1', businessId: 'b1', customerId: '', name: 'Ana', phone: '11900000001',
      email: '', instagram: '', origin: 'manual', interest: '', action: 'contato',
      status: 'lost', stageId: 'scheduled',
      assignedUserId: '', priority: 'medium', nextAction: '', serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [{ id: 'h1', fromStage: 'new', toStage: 'scheduled', movedBy: 'system', movedByName: 'Sys', at: NOW }],
      createdAt: NOW, lastInteraction: NOW,
    } as Lead);
    const beforeHist = d.leads[0].stageHistory!.length;
    const beforeRuns = d.automationRuns.length;
    const beforeInteraction = d.leads[0].lastInteraction;
    moveLeadStage(d, { businessId: 'b1', leadId: 'l1', toStageId: 'scheduled', actor: { id: 'owner', name: 'Equipe' }, now: NOW });
    expect(d.leads[0].stageId).toBe('scheduled');
    expect(d.leads[0].status).toBe(mapStageToStatus(pipeline, 'scheduled')); // deve ser converted, não lost
    expect(d.leads[0].stageHistory!.length).toBe(beforeHist); // sem novo histórico
    expect(d.automationRuns.length).toBe(beforeRuns); // sem evento
    expect(d.leads[0].lastInteraction).toBe(beforeInteraction); // não tocou
  });
  it('24 - markLeadScheduled já scheduled repara projeção sem evento duplicado', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    const pipeline = getBusinessPipeline(d, 'b1');
    d.leads.push({
      id: 'l1', businessId: 'b1', customerId: '', name: 'Ana', phone: '11900000002',
      email: '', instagram: '', origin: 'agendamento', interest: '', action: 'agendamento',
      status: 'lost', stageId: 'scheduled',
      assignedUserId: '', priority: 'medium', nextAction: '', serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [{ id: 'h1', fromStage: 'new', toStage: 'scheduled', movedBy: 'system', movedByName: 'Sys', at: NOW }],
      createdAt: NOW, lastInteraction: NOW,
    } as Lead);
    const res = markLeadScheduled(d, { businessId: 'b1', leadId: 'l1', bookingId: 'bk1', actor: { id: 'customer', name: 'Agendamento' }, now: NOW });
    expect(res?.moved).toBe(false);
    expect(d.leads[0].status).toBe(mapStageToStatus(pipeline, 'scheduled'));
    expect(d.leads[0].stageHistory!.length).toBe(1);
  });
});

describe('A3 Correção — win-back reabre terminal', () => {
  function setupWinBackScenario(status: 'converted' | 'lost') {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.services.push(service('s1','b1'));
    // contato com booking antigo 30+ dias
    d.contacts.push({
      id: 'c1', businessId: 'b1', customerId: 'cust1', name: 'Cliente Antigo', phone: '11900000020', email: '',
      source: 'agendamento', marketingOptIn: true, note: '', notes: [], createdAt: '2026-08-01T00:00:00.000Z', lastInteraction: '2026-08-10T00:00:00.000Z',
    } as any);
    d.bookings.push({
      id: 'bk-old', businessId: 'b1', customerId: 'cust1', serviceId: 's1', professionalId: '', date: '2026-08-10', time: '10:00',
      customerName: 'Cliente Antigo', customerPhone: '11900000020', status: 'completed', note: '', answers: [], createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', history: [],
    } as any);
    // lead terminal do mesmo cliente
    d.leads.push({
      id: 'l-terminal', businessId: 'b1', customerId: 'cust1', name: 'Cliente Antigo', phone: '11900000020', email: '',
      instagram: '', origin: 'agendamento', interest: 'Serviço', action: 'agendamento',
      status, stageId: status === 'converted' ? 'converted' : 'lost',
      assignedUserId: '', priority: 'medium', nextAction: '', serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [{ id: 'h0', fromStage: 'new', toStage: status === 'converted' ? 'converted' : 'lost', movedBy: 'owner', movedByName: 'Equipe', at: NOW }],
      createdAt: '2026-08-01T00:00:00.000Z', lastInteraction: '2026-08-01T00:00:00.000Z',
    } as Lead);
    return d;
  }
  it('25 - winBack converted -> new reabre mesmo lead, sem duplicar', () => {
    const d = setupWinBackScenario('converted');
    const count = createWinBackLeads(d, 'b1', '2026-09-16');
    expect(count).toBe(1);
    expect(d.leads.length).toBe(1);
    const lead = d.leads[0];
    expect(lead.action).toBe('retorno');
    expect(lead.stageId).toBe('new');
    expect(lead.status).toBe('new');
    // histórico deve ter exatamente converted -> new uma vez
    const last = lead.stageHistory![lead.stageHistory!.length - 1];
    expect(last.fromStage).toBe('converted');
    expect(last.toStage).toBe('new');
    // apenas um novo histórico além do original
    expect(lead.stageHistory!.length).toBe(2);
  });
  it('26 - winBack lost -> new', () => {
    const d = setupWinBackScenario('lost');
    const count = createWinBackLeads(d, 'b1', '2026-09-16');
    expect(count).toBe(1);
    expect(d.leads.length).toBe(1);
    expect(d.leads[0].stageId).toBe('new');
    expect(d.leads[0].action).toBe('retorno');
    const last = d.leads[0].stageHistory!.at(-1)!;
    expect(last.fromStage).toBe('lost');
    expect(last.toStage).toBe('new');
  });
  it('27 - winBack não duplica quando já há oportunidade aberta', () => {
    const d = setupWinBackScenario('converted');
    // primeira rodada cria retorno em new (aberta)
    createWinBackLeads(d, 'b1', '2026-09-16');
    // segunda rodada não deve criar outra, pois já existe retorno aberta (action retorno, status new)
    const before = d.leads.length;
    const c2 = createWinBackLeads(d, 'b1', '2026-09-16');
    expect(c2).toBe(0);
    expect(d.leads.length).toBe(before);
  });
  it('28 - winBack evento P4 (histórico lead.stage_changed para new, idempotente)', () => {
    const d = setupWinBackScenario('converted');
    // Se houver automação para lead.stage_changed, ela deve ser disparada uma única vez
    // Para testar o bus sem depender de fixture de automação, validamos que o histórico
    // do lead contém exatamente um evento converted→new e que segunda execução não duplica
    createWinBackLeads(d, 'b1', '2026-09-16');
    const hist = d.leads[0].stageHistory!;
    expect(hist[hist.length-1].fromStage).toBe('converted');
    expect(hist[hist.length-1].toStage).toBe('new');
    const afterFirst = hist.length;
    // segunda chamada não deve acrescentar histórico porque já existe oportunidade aberta
    createWinBackLeads(d, 'b1', '2026-09-16');
    expect(d.leads[0].stageHistory!.length).toBe(afterFirst);
  });
});

describe('A3 Correção — sem db.leads.push operacional', () => {
  it('29 - nenhum arquivo operacional cria lead fora de ingestLead (exceto pipeline)', () => {
    const allowed = new Set(['src/lib/pipeline.ts']);
    const root = path.resolve('src');
    const files: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(path.resolve('.'), full).replace(/\\/g,'/');
        if (entry.isDirectory()) {
          if (['__tests__','node_modules','.next'].includes(entry.name)) continue;
          walk(full);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          files.push(rel);
        }
      }
    }
    walk(root);
    const offenders: string[] = [];
    for (const f of files) {
      if (allowed.has(f)) continue;
      if (f.includes('__tests__')) continue;
      if (f.includes('helpers')) continue;
      const content = fs.readFileSync(f, 'utf-8');
      // procura padrão db.leads.push ou d.leads.push que não seja comentário
      if (/\b(d|db)\.leads\.push\s*\(/.test(content)) {
        offenders.push(f);
      }
    }
    expect(offenders, `arquivos com db.leads.push fora da porta oficial: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('A3 Correção — booking status', () => {
  it('30 - completed -> converted uma vez, idempotente', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.services.push(service('s1','b1'));
    d.leads.push({
      id: 'l1', businessId: 'b1', customerId: '', name: 'Ana', phone: '11988887777',
      email: '', instagram: '', origin: 'agendamento', interest: '', action: 'contato',
      status: 'converted', stageId: 'scheduled',
      assignedUserId: '', priority: 'medium', nextAction: '', serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [{ id: 'h1', fromStage: 'new', toStage: 'scheduled', movedBy: 'customer', movedByName: 'Agendamento', at: NOW }],
      createdAt: NOW, lastInteraction: NOW,
    } as Lead);
    d.bookings.push({
      id: 'bk1', businessId: 'b1', customerId: '', serviceId: 's1', professionalId: '', date: FUTURE_DATE, time: FUTURE_TIME,
      customerName: 'Ana', customerPhone: '11988887777', status: 'confirmed', note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [{ at: NOW, from: '', to: 'confirmed', by: 'owner' }], leadId: 'l1',
    } as any);
    const r1 = applyBookingStatusTx(d, { businessId: 'b1', bookingId: 'bk1', to: 'completed', by: 'owner', now: NOW });
    expect(r1.ok).toBe(true);
    expect(d.leads[0].stageId).toBe('converted');
    const hist = d.leads[0].stageHistory!.length;
    const r2 = applyBookingStatusTx(d, { businessId: 'b1', bookingId: 'bk1', to: 'completed', by: 'owner', now: NOW });
    expect(r2.ok).toBe(true);
    expect(d.leads[0].stageHistory!.length).toBe(hist);
  });
  it('31 - cancelled não altera lead', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.services.push(service('s1','b1'));
    d.leads.push({
      id: 'l1', businessId: 'b1', customerId: '', name: 'Ana', phone: '11988887777',
      email: '', instagram: '', origin: 'agendamento', interest: '', action: 'contato',
      status: 'converted', stageId: 'scheduled',
      assignedUserId: '', priority: 'medium', nextAction: '', serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [{ id: 'h1', fromStage: 'new', toStage: 'scheduled', movedBy: 'customer', movedByName: 'Agendamento', at: NOW }],
      createdAt: NOW, lastInteraction: NOW,
    } as Lead);
    d.bookings.push({
      id: 'bk1', businessId: 'b1', customerId: '', serviceId: 's1', professionalId: '', date: FUTURE_DATE, time: FUTURE_TIME,
      customerName: 'Ana', customerPhone: '11988887777', status: 'confirmed', note: '', answers: [], createdAt: NOW, updatedAt: NOW, history: [], leadId: 'l1',
    } as any);
    const beforeStage = d.leads[0].stageId;
    const beforeHist = d.leads[0].stageHistory!.length;
    const r = applyBookingStatusTx(d, { businessId: 'b1', bookingId: 'bk1', to: 'cancelled', by: 'owner', now: NOW });
    expect(r.ok).toBe(true);
    expect(d.leads[0].stageId).toBe(beforeStage);
    expect(d.leads[0].stageHistory!.length).toBe(beforeHist);
  });
  it('32 - tasks tenant isolation e cliente360', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'), biz('b2'));
    d.leads.push({
      id: 'l-b2', businessId: 'b2', customerId: '', name: 'Outro', phone: '11900000099', email: '', instagram: '', origin: '', interest: '', action: 'contato',
      status: 'new', stageId: 'new', assignedUserId: '', priority: 'medium', nextAction: '', serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [], stageHistory: [], createdAt: NOW, lastInteraction: NOW,
    } as Lead);
    const res = createTaskTx(d, { businessId: 'b1', title: 'Tarefa', createdBy: 'owner', leadId: 'l-b2' });
    expect(res.task).toBeNull();
    expect(res.reason).toMatch(/lead não pertence/);
  });
});
