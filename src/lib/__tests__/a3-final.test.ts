// A3 FECHAMENTO FINAL — 4 pontos restantes
import { describe, expect, it } from 'vitest';
import { emptyDB } from '../db';
import {
  getBusinessPipeline,
  updateBusinessPipeline,
  moveLeadStage,
  ingestLead,
  normalizeLeadStageId,
  mapStageToStatus,
} from '../pipeline';
import { createBookingTx } from '../booking-create';
import { winBackCandidates, createWinBackLeads } from '../automations';
import { executeAction } from '../automation/actions';
import type { Business, Lead, Service } from '../types';
import { onlyDigits } from '../utils';

const NOW = '2026-09-16T12:00:00.000Z';
const FUTURE_DATE = '2026-09-21';
const FUTURE_TIME = '09:00';

function biz(id: string): Business {
  return {
    id, ownerId: `owner-${id}`, organizationId: `org-${id}`, name: `Negócio ${id}`, slug: id,
    description: '', logo: '', cover: '', niche: 'servicos', modes: ['services','bookings'],
    phone: '', whatsapp: '11999990000', email: '', instagram: '', tiktok: '', address: '', mapsUrl: '',
    hours: {}, paymentMethods: [], pixKey: '', deliveryFee: 0, minOrder: 0, googleUrl: '', googlePlaceId: '', googleApiKey: '',
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
function withAvailability(d: any, businessId: string) {
  d.availability.push({ id: 'av-1', businessId, professionalId: '', serviceId: '', weekday: 1, start: '09:00', end: '18:00', slotMin: 30 });
}

// 1. Proteger scheduled no domínio
describe('A3 Final · scheduled só via booking (domínio)', () => {
  it('moveLeadStage direto -> scheduled recusa 422', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.leads.push({
      id: 'l1', businessId: 'b1', customerId: '', name: 'Ana', phone: '11900000001', email: '', instagram: '', origin: 'manual', interest: '', action: 'contato',
      status: 'new', stageId: 'new', assignedUserId: '', priority: 'medium', nextAction: '', serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [], stageHistory: [], createdAt: NOW, lastInteraction: NOW,
    } as Lead);
    expect(() => moveLeadStage(d, { businessId: 'b1', leadId: 'l1', toStageId: 'scheduled', actor: { id: 'owner', name: 'Equipe' } }))
      .toThrow(/Agendado requer um agendamento real/);
    // alias agendado também recusa
    expect(() => moveLeadStage(d, { businessId: 'b1', leadId: 'l1', toStageId: 'agendado', actor: { id: 'owner', name: 'Equipe' } }))
      .toThrow(/Agendado requer um agendamento real/);
    // no-op repair em scheduled já existente é permitido (não recusa)
    const lead2 = d.leads[0];
    lead2.stageId = 'scheduled';
    lead2.status = 'lost'; // legado incoerente
    // no-op deve reparar sem lançar
    expect(() => moveLeadStage(d, { businessId: 'b1', leadId: 'l1', toStageId: 'scheduled', actor: { id: 'owner', name: 'Equipe' } })).not.toThrow();
    expect(lead2.status).toBe('converted'); // reparou
  });

  it('ingestLead stageId scheduled/agendado recusa', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    expect(() => ingestLead(d, { businessId: 'b1', name: 'X', phone: '11999990001', stageId: 'scheduled', source: 'api', actor: { id: 'api', name: 'API', type: 'api' } }))
      .toThrow(/Agendado requer um agendamento real/);
    expect(() => ingestLead(d, { businessId: 'b1', name: 'Y', phone: '11999990002', stageId: 'agendado', source: 'api', actor: { id: 'api', name: 'API', type: 'api' } }))
      .toThrow(/Agendado requer um agendamento real/);
    // alias ingles scheduled also
    expect(() => ingestLead(d, { businessId: 'b1', name: 'Z', phone: '11999990003', stageId: 'scheduled', source: 'api', actor: { id: 'api', name: 'API', type: 'api' } }))
      .toThrow(/Agendado requer um agendamento real/);
  });

  it('P4 change_lead_stage scheduled falha honestamente (via moveLeadStage)', async () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    const { lead } = ingestLead(d, { businessId: 'b1', name: 'P4', phone: '11999990010', source: 'manual', actor: { id: 'owner', name: 'Equipe', type: 'user' } });
    // cria automação fake para testar executeAction
    const automation: any = { id: 'auto-1', businessId: 'b1', name: 'Teste', trigger: { event: 'lead.created' }, nodes: [{ id: 'n1', type: 'trigger' }, { id: 'n2', type: 'action', action: { type: 'change_lead_stage', params: { stageId: 'scheduled' } } }] };
    const run: any = { id: 'run-1', businessId: 'b1', automationId: 'auto-1', context: { lead: { id: lead.id } } };
    const business = d.businesses[0];
    const res = await executeAction({ db: d, business: business as any, automation, run, nodeId: 'n2', now: NOW, params: { __type: 'change_lead_stage', stageId: 'scheduled' } });
    expect(res.ok).toBe(false);
    expect(res.error || '').toMatch(/Agendado requer/);
    expect(lead.stageId).not.toBe('scheduled');
  });

  it('createBookingTx continua chegando a scheduled normalmente (via markLeadScheduled autorizado)', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.services.push(service('s1','b1'));
    withAvailability(d, 'b1');
    const res = createBookingTx(d, {
      business: d.businesses[0], service: d.services[0], date: FUTURE_DATE, time: FUTURE_TIME,
      actor: 'customer', customer: { id: '', name: 'Cliente', phone: '11999990020' }, now: NOW,
    });
    expect(res.bookingId).toBeTruthy();
    const lead = d.leads.find(l => onlyDigits(l.phone)==='11999990020');
    expect(lead?.stageId).toBe('scheduled');
  });

  it('ingestLead P4? alias agendado via stageId scheduled também bloqueado, mas new funciona', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    const { lead } = ingestLead(d, { businessId: 'b1', name: 'Ok', phone: '11999990030', stageId: 'new', source: 'api', actor: { id: 'api', name: 'API', type: 'api' } });
    expect(lead.stageId).toBe('new');
  });
});

describe('A3 Final · semântica estrutural preservada', () => {
  it('updateBusinessPipeline preserva isSystem/isTerminal/mappedStatus de new/scheduled/converted mesmo se UI tentar inverter', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    // tenta enviar semântica invertida pela UI
    const p = updateBusinessPipeline(d, 'b1', [
      { id: 'new', name: 'Novo Renomeado', order: 0, isTerminal: true, isSystem: false, mappedStatus: 'converted', color: 'red' },
      { id: 'scheduled', name: 'Agendado Renomeado', order: 1, isTerminal: true, isSystem: false, mappedStatus: 'lost', color: 'blue' },
      { id: 'converted', name: 'Convertido Renomeado', order: 2, isTerminal: false, isSystem: false, mappedStatus: 'new', color: 'zinc' },
      { id: 'custom', name: 'Custom', order: 3, isTerminal: true, mappedStatus: 'contacted' },
    ]);
    const n = p.stages.find(s=> s.id==='new')!;
    expect(n.name).toBe('Novo Renomeado'); // nome pode mudar
    expect(n.isSystem).toBe(true);
    expect(n.isTerminal).toBe(false);
    expect(n.mappedStatus).toBe('new');
    const s = p.stages.find(s=> s.id==='scheduled')!;
    expect(s.name).toBe('Agendado Renomeado');
    expect(s.isSystem).toBe(true);
    expect(s.isTerminal).toBe(false);
    expect(s.mappedStatus).toBe('converted');
    const c = p.stages.find(s=> s.id==='converted')!;
    expect(c.name).toBe('Convertido Renomeado');
    expect(c.isSystem).toBe(true);
    expect(c.isTerminal).toBe(true);
    expect(c.mappedStatus).toBe('converted');
    // custom não estrutural permanece como enviado
    const cust = p.stages.find(s=> s.id==='custom')!;
    expect(cust.isTerminal).toBe(true);
    expect(cust.mappedStatus).toBe('contacted');
  });
});

describe('A3 Final · win-back por PipelineStage (não LeadStatus)', () => {
  it('etapa custom terminal com mappedStatus contacted é considerada FINAL e win-back cria retorno', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.services.push(service('s1','b1'));
    // cria pipeline custom com etapa terminal que mapeia para contacted (armadilha)
    updateBusinessPipeline(d, 'b1', [
      { id: 'new', name: 'Novo', order: 0 },
      { id: 'custom_terminal', name: 'Fim Custom', order: 1, isTerminal: true, mappedStatus: 'contacted', color: 'zinc' },
      { id: 'converted', name: 'Convertido', order: 2, isTerminal: true },
    ]);
    const pipeline = getBusinessPipeline(d, 'b1');
    const ct = pipeline.stages.find(s=> s.id==='custom_terminal')!;
    expect(ct.isTerminal).toBe(true);
    expect(ct.mappedStatus).toBe('contacted');

    // lead nessa etapa, status será contacted (projeção), mas é terminal
    d.contacts.push({
      id: 'c1', businessId: 'b1', customerId: 'cust1', name: 'Cliente', phone: '11900000050', email: '', source: 'agendamento', marketingOptIn: true, note: '', notes: [],
      createdAt: '2026-08-01T00:00:00.000Z', lastInteraction: '2026-08-10T00:00:00.000Z',
    } as any);
    d.bookings.push({
      id: 'bk-old', businessId: 'b1', customerId: 'cust1', serviceId: 's1', professionalId: '', date: '2026-08-10', time: '10:00', customerName: 'Cliente', customerPhone: '11900000050', status: 'completed', note: '', answers: [], createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', history: [],
    } as any);
    d.leads.push({
      id: 'l-custom-terminal', businessId: 'b1', customerId: 'cust1', name: 'Cliente', phone: '11900000050', email: '', instagram: '', origin: 'agendamento', interest: 'Serviço', action: 'contato',
      status: 'contacted', stageId: 'custom_terminal', assignedUserId: '', priority: 'medium', nextAction: '', serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [{ id: 'h0', fromStage: 'new', toStage: 'custom_terminal', movedBy: 'owner', movedByName: 'Equipe', at: NOW }],
      createdAt: '2026-08-01T00:00:00.000Z', lastInteraction: '2026-08-01T00:00:00.000Z',
    } as Lead);

    // sem o fix, winBackCandidates usaria status contacted != lost/converted e acharia que há oportunidade aberta, não criando
    // com fix por PipelineStage, custom_terminal é terminal => não é aberta => deve criar win-back
    const cands = winBackCandidates(d, 'b1', '2026-09-16');
    expect(cands.length).toBe(1);
    expect(cands[0].contact.phone).toBe('11900000050');

    const count = createWinBackLeads(d, 'b1', '2026-09-16');
    expect(count).toBe(1);
    expect(d.leads.length).toBe(1); // mesmo lead reaberto
    expect(d.leads[0].stageId).toBe('new');
    expect(d.leads[0].action).toBe('retorno');
  });

  it('win-back não duplica quando ja existe retorno aberto em etapa não terminal', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.contacts.push({
      id: 'c1', businessId: 'b1', customerId: 'cust1', name: 'Cliente2', phone: '11900000060', email: '', source: 'agendamento', marketingOptIn: true, note: '', notes: [],
      createdAt: '2026-08-01T00:00:00.000Z', lastInteraction: '2026-08-10T00:00:00.000Z',
    } as any);
    d.bookings.push({
      id: 'bk-old', businessId: 'b1', customerId: 'cust1', serviceId: 's1', professionalId: '', date: '2026-08-10', time: '10:00', customerName: 'Cliente2', customerPhone: '11900000060', status: 'completed', note: '', answers: [], createdAt: '2026-08-10T00:00:00.000Z', updatedAt: '2026-08-10T00:00:00.000Z', history: [],
    } as any);
    d.leads.push({
      id: 'l-retorno-open', businessId: 'b1', customerId: 'cust1', name: 'Cliente2', phone: '11900000060', email: '', instagram: '', origin: 'agendamento', interest: 'Retorno', action: 'retorno',
      status: 'new', stageId: 'new', assignedUserId: '', priority: 'medium', nextAction: '', serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [{ id: 'h0', fromStage: '', toStage: 'new', movedBy: 'system', movedByName: 'Sys', at: NOW }],
      createdAt: '2026-08-01T00:00:00.000Z', lastInteraction: NOW,
    } as Lead);
    const cands = winBackCandidates(d, 'b1', '2026-09-16');
    expect(cands.length).toBe(0);
  });
});
