// A3 CRM operacional — 22 casos obrigatórios
// Páginas/canal/API → LEAD → FUNIL → CONTATO/CLIENTE → AGENDAMENTO → CONVERSA/TAREFA → 360 → AUTOMAÇÕES
// Invariantes: tenant isolation, pipeline como única máquina, stageId verdade, LeadStatus projeção,
// moveLeadStage para todas as movimentações, ingestLead para entradas, createBookingTx/computeSlots,
// tenant isolation etc.
import { describe, expect, it } from 'vitest';
import { emptyDB } from '../db';
import {
  DEFAULT_PIPELINE_STAGES,
  STRUCTURAL_STAGE_IDS,
  getBusinessPipeline,
  updateBusinessPipeline,
  moveLeadStage,
  ingestLead,
  ensureScheduledStage,
  ensureConvertedStage,
  markLeadScheduled,
  markLeadConverted,
  normalizeLeadStageId,
  mapStageToStatus,
} from '../pipeline';
import { createBookingTx } from '../booking-create';
import { applyBookingStatusTx } from '../booking-status';
import { createWinBackLeads } from '../automations';
import { createTaskTx } from '../automation/tasks';
import type { Business, Lead, Service } from '../types';
import { onlyDigits } from '../utils';

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
    description: '',
    logo: '',
    cover: '',
    niche: 'servicos',
    modes: ['services', 'bookings'],
    phone: '',
    whatsapp: '11999990000',
    email: '',
    instagram: '',
    tiktok: '',
    address: '',
    mapsUrl: '',
    hours: {},
    paymentMethods: [],
    pixKey: '',
    deliveryFee: 0,
    minOrder: 0,
    googleUrl: '',
    googlePlaceId: '',
    googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 60, bufferMin: 0 },
    nav: [],
    navCustom: false,
    about: { title: '', text: '', image: '', enabled: false },
    published: true,
    createdAt: NOW,
    updatedAt: NOW,
  } as Business;
}
function service(id: string, businessId: string): Service {
  return {
    id,
    businessId,
    categoryId: '',
    name: 'Serviço',
    description: '',
    image: '',
    price: 5000,
    durationMin: 30,
    professionalIds: [],
    active: true,
    featured: false,
    bookable: true,
    questions: [],
  } as Service;
}
function withAvailability(d: any, businessId: string) {
  d.availability.push({ id: 'av-1', businessId, professionalId: '', serviceId: '', weekday: 1, start: '09:00', end: '18:00', slotMin: 30 });
}

describe('A3 · Pipeline estrutural e máquina única', () => {
  it('1 - updateBusinessPipeline garante estruturais new/scheduled/converted', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    updateBusinessPipeline(d, 'b1', [
      { id: 'new', name: 'Novo', order: 0 },
      { id: 'custom', name: 'Custom', order: 1 },
      { id: 'converted', name: 'Fim', order: 2, isTerminal: true },
    ]);
    const p = getBusinessPipeline(d, 'b1');
    expect(p.stages.some((s) => s.id === 'new')).toBe(true);
    expect(p.stages.some((s) => s.id === 'scheduled')).toBe(true);
    expect(p.stages.some((s) => s.id === 'converted')).toBe(true);
  });
  it('2 - new sempre primeira, scheduled antes de converted', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    updateBusinessPipeline(d, 'b1', [
      { id: 'custom_a', name: 'A', order: 0 },
      { id: 'converted', name: 'Fim', order: 1, isTerminal: true },
      { id: 'new', name: 'Novo', order: 5 },
    ]);
    const p = getBusinessPipeline(d, 'b1');
    expect(p.stages[0].id).toBe('new');
    const sIdx = p.stages.findIndex((s) => s.id === 'scheduled');
    const cIdx = p.stages.findIndex((s) => s.id === 'converted');
    expect(sIdx).toBeGreaterThan(0);
    expect(sIdx).toBeLessThan(cIdx);
  });
  it('3 - dedupe ids e order sequencial', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    updateBusinessPipeline(d, 'b1', [
      { id: 'new', name: 'Novo', order: 0 },
      { id: 'negociando', name: 'Neg1', order: 1 },
      { id: 'negociando', name: 'Neg2', order: 2 },
      { id: 'converted', name: 'Fim', order: 3, isTerminal: true },
    ]);
    const p = getBusinessPipeline(d, 'b1');
    const ids = p.stages.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(p.stages.map((s) => s.order)).toEqual(p.stages.map((_, i) => i));
  });
  it('4 - STRUCTURAL_STAGE_IDS inclui new/scheduled/converted', () => {
    expect([...STRUCTURAL_STAGE_IDS].sort()).toEqual(['converted', 'new', 'scheduled'].sort());
  });
  it('5 - moveLeadStage idempotente: mesma etapa não gera histórico/evento duplicado', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.leads.push({
      id: 'l1',
      businessId: 'b1',
      customerId: '',
      name: 'Ana',
      phone: '11900000001',
      email: '',
      instagram: '',
      origin: 'manual',
      interest: '',
      action: 'contato',
      status: 'new',
      stageId: 'new',
      assignedUserId: '',
      priority: 'medium',
      nextAction: '',
      serviceId: '',
      professionalId: '',
      sourceUrl: '',
      metadata: {},
      notes: [],
      stageHistory: [],
      createdAt: NOW,
      lastInteraction: NOW,
    } as Lead);
    const before = d.automationRuns.length;
    const beforeHist = d.leads[0].stageHistory?.length || 0;
    moveLeadStage(d, { businessId: 'b1', leadId: 'l1', toStageId: 'new', actor: { id: 'owner', name: 'Equipe' }, now: NOW });
    expect(d.leads[0].stageHistory?.length || 0).toBe(beforeHist);
    expect(d.automationRuns.length).toBe(before);
  });
  it('6 - moveLeadStage gera histórico quando muda de etapa', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.leads.push({
      id: 'l1',
      businessId: 'b1',
      customerId: '',
      name: 'Ana',
      phone: '11900000002',
      email: '',
      instagram: '',
      origin: 'manual',
      interest: '',
      action: 'contato',
      status: 'new',
      stageId: 'new',
      assignedUserId: '',
      priority: 'medium',
      nextAction: '',
      serviceId: '',
      professionalId: '',
      sourceUrl: '',
      metadata: {},
      notes: [],
      stageHistory: [],
      createdAt: NOW,
      lastInteraction: NOW,
    } as Lead);
    moveLeadStage(d, { businessId: 'b1', leadId: 'l1', toStageId: 'scheduled', actor: { id: 'owner', name: 'Equipe' }, now: NOW, allowScheduledTransition: true });
    expect(d.leads[0].stageId).toBe('scheduled');
    expect(d.leads[0].stageHistory?.length).toBe(1);
    expect(d.leads[0].stageHistory?.[0].toStage).toBe('scheduled');
  });
  it('7 - tenant isolation: lead de outro business não é movido', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'), biz('b2'));
    d.leads.push({
      id: 'l2',
      businessId: 'b2',
      customerId: '',
      name: 'Outro',
      phone: '11900000003',
      email: '',
      instagram: '',
      origin: '',
      interest: '',
      action: 'contato',
      status: 'new',
      stageId: 'new',
      assignedUserId: '',
      priority: 'medium',
      nextAction: '',
      serviceId: '',
      professionalId: '',
      sourceUrl: '',
      metadata: {},
      notes: [],
      stageHistory: [],
      createdAt: NOW,
      lastInteraction: NOW,
    } as Lead);
    expect(() =>
      moveLeadStage(d, { businessId: 'b1', leadId: 'l2', toStageId: 'scheduled', actor: { id: 'owner', name: 'Equipe' } }),
    ).toThrow();
  });
  it('8 - ensureScheduledStage idempotente', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    ensureScheduledStage(d, 'b1');
    const p1 = ensureScheduledStage(d, 'b1');
    expect(p1.stages.filter((s) => s.id === 'scheduled').length).toBe(1);
  });
  it('9 - ensureConvertedStage idempotente', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    ensureConvertedStage(d, 'b1');
    const p1 = ensureConvertedStage(d, 'b1');
    expect(p1.stages.filter((s) => s.id === 'converted').length).toBe(1);
  });
});

describe('A3 · Agenda ↔ CRM oficial', () => {
  it('10 - createBookingTx de cliente novo cria lead via ingestLead e vai para scheduled', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.services.push(service('s1', 'b1'));
    withAvailability(d, 'b1');
    const res = createBookingTx(d, {
      business: d.businesses[0],
      service: d.services[0],
      date: FUTURE_DATE,
      time: FUTURE_TIME,
      actor: 'customer',
      customer: { id: '', name: 'Bruno', phone: '11912345678' },
      now: NOW,
    });
    expect(res.bookingId).toBeTruthy();
    const lead = d.leads.find((l) => onlyDigits(l.phone) === '11912345678');
    expect(lead?.stageId).toBe('scheduled');
    expect(lead?.stageHistory?.some((h) => h.toStage === 'scheduled')).toBe(true);
  });
  it('11 - createBookingTx reutiliza lead existente sem duplicar', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.services.push(service('s1', 'b1'));
    withAvailability(d, 'b1');
    d.leads.push({
      id: 'l-ex',
      businessId: 'b1',
      customerId: '',
      name: 'Marina',
      phone: '11965432100',
      email: '',
      instagram: '',
      origin: 'instagram',
      interest: 'Corte',
      action: 'contato',
      status: 'new',
      stageId: 'new',
      assignedUserId: '',
      priority: 'medium',
      nextAction: '',
      serviceId: '',
      professionalId: '',
      sourceUrl: '',
      metadata: {},
      notes: [],
      stageHistory: [],
      createdAt: NOW,
      lastInteraction: NOW,
    } as Lead);
    createBookingTx(d, {
      business: d.businesses[0],
      service: d.services[0],
      date: FUTURE_DATE,
      time: FUTURE_TIME,
      actor: 'customer',
      customer: { id: '', name: 'Marina', phone: '11965432100' },
      now: NOW,
    });
    expect(d.leads.filter((l) => onlyDigits(l.phone) === '11965432100').length).toBe(1);
    expect(d.leads[0].stageId).toBe('scheduled');
  });
  it('12 - createBookingTx com lead terminal reabre para scheduled (nunca lost+scheduled)', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.services.push(service('s1', 'b1'));
    withAvailability(d, 'b1');
    d.leads.push({
      id: 'l-lost',
      businessId: 'b1',
      customerId: '',
      name: 'Rafa',
      phone: '11944443333',
      email: '',
      instagram: '',
      origin: 'agendamento',
      interest: '',
      action: 'contato',
      status: 'lost',
      stageId: 'lost',
      assignedUserId: '',
      priority: 'medium',
      nextAction: '',
      serviceId: '',
      professionalId: '',
      sourceUrl: '',
      metadata: {},
      notes: [],
      stageHistory: [],
      createdAt: NOW,
      lastInteraction: NOW,
    } as Lead);
    createBookingTx(d, {
      business: d.businesses[0],
      service: d.services[0],
      date: FUTURE_DATE,
      time: FUTURE_TIME,
      actor: 'customer',
      customer: { id: '', name: 'Rafa', phone: '11944443333' },
      now: NOW,
    });
    expect(d.leads.length).toBe(1);
    expect(d.leads[0].stageId).toBe('scheduled');
    expect(d.leads[0].status).not.toBe('lost');
  });
  it('13 - applyBookingStatus completed → converted é idempotente', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.services.push(service('s1', 'b1'));
    d.leads.push({
      id: 'l1',
      businessId: 'b1',
      customerId: '',
      name: 'Ana',
      phone: '11988887777',
      email: '',
      instagram: '',
      origin: 'agendamento',
      interest: '',
      action: 'contato',
      status: 'converted',
      stageId: 'scheduled',
      assignedUserId: '',
      priority: 'medium',
      nextAction: '',
      serviceId: '',
      professionalId: '',
      sourceUrl: '',
      metadata: {},
      notes: [],
      stageHistory: [{ id: 'h1', fromStage: 'new', toStage: 'scheduled', movedBy: 'customer', movedByName: 'Agendamento', at: NOW }],
      createdAt: NOW,
      lastInteraction: NOW,
    } as Lead);
    d.bookings.push({
      id: 'bk1',
      businessId: 'b1',
      customerId: '',
      serviceId: 's1',
      professionalId: '',
      date: FUTURE_DATE,
      time: FUTURE_TIME,
      customerName: 'Ana',
      customerPhone: '11988887777',
      status: 'confirmed',
      note: '',
      answers: [],
      createdAt: NOW,
      updatedAt: NOW,
      history: [{ at: NOW, from: '', to: 'confirmed', by: 'owner' }],
      leadId: 'l1',
    } as any);
    const r1 = applyBookingStatusTx(d, { businessId: 'b1', bookingId: 'bk1', to: 'completed', by: 'owner', now: NOW });
    expect(r1.ok).toBe(true);
    expect(d.leads[0].stageId).toBe('converted');
    const histCount = d.leads[0].stageHistory?.length || 0;
    const r2 = applyBookingStatusTx(d, { businessId: 'b1', bookingId: 'bk1', to: 'completed', by: 'owner', now: NOW });
    expect(r2.ok).toBe(true);
    expect(d.leads[0].stageHistory?.length).toBe(histCount);
  });
  it('14 - markLeadConverted idempotente não duplica histórico', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.leads.push({
      id: 'l1',
      businessId: 'b1',
      customerId: '',
      name: 'Jo',
      phone: '11900000010',
      email: '',
      instagram: '',
      origin: 'agendamento',
      interest: '',
      action: 'contato',
      status: 'converted',
      stageId: 'converted',
      assignedUserId: '',
      priority: 'medium',
      nextAction: '',
      serviceId: '',
      professionalId: '',
      sourceUrl: '',
      metadata: {},
      notes: [],
      stageHistory: [{ id: 'h1', fromStage: 'scheduled', toStage: 'converted', movedBy: 'system', movedByName: 'Atendimento', at: NOW }],
      createdAt: NOW,
      lastInteraction: NOW,
    } as Lead);
    const out = markLeadConverted(d, { businessId: 'b1', leadId: 'l1', actor: { id: 'owner', name: 'Atendimento' }, now: NOW });
    expect(out?.moved).toBe(false);
    expect(d.leads[0].stageHistory?.length).toBe(1);
  });
});

describe('A3 · ingestLead única porta e projeção LeadStatus', () => {
  it('15 - ingestLead cria lead com stageId=new e histórico new', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    const { lead } = ingestLead(d, {
      businessId: 'b1',
      name: 'Novo',
      phone: '11999990000',
      interest: 'teste',
      source: 'manual',
      actor: { id: 'owner', name: 'Equipe', type: 'user' },
      now: NOW,
    });
    expect(lead.stageId).toBe('new');
    expect(lead.stageHistory?.[0].toStage).toBe('new');
    expect(lead.status).toBe('new');
  });
  it('16 - LeadStatus é projeção de stageId (mapStageToStatus) e nunca diverge', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    const pipeline = getBusinessPipeline(d, 'b1');
    for (const st of pipeline.stages) {
      expect(mapStageToStatus(pipeline, st.id)).toBeDefined();
    }
    // scheduled mapeia para converted (estrutura)
    expect(mapStageToStatus(pipeline, 'scheduled')).toBe('converted');
  });
  it('17 - ingestLead dedupe por telefone não duplica lead', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    ingestLead(d, {
      businessId: 'b1',
      name: 'A',
      phone: '11999990001',
      source: 'manual',
      actor: { id: 'owner', name: 'Equipe', type: 'user' },
      now: NOW,
    });
    const before = d.leads.length;
    ingestLead(d, {
      businessId: 'b1',
      name: 'A2',
      phone: '11999990001',
      source: 'instagram',
      actor: { id: 'owner', name: 'Equipe', type: 'user' },
      now: NOW,
    });
    expect(d.leads.length).toBe(before);
  });
  it('18 - winBack cria leads via ingestLead com stageId válido', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    // contato com booking antigo (31 dias atrás)
    d.contacts.push({
      id: 'c1',
      businessId: 'b1',
      customerId: 'cust1',
      name: 'Cliente Antigo',
      phone: '11900000020',
      email: '',
      source: 'agendamento',
      marketingOptIn: true,
      note: '',
      notes: [],
      createdAt: '2026-08-01T00:00:00.000Z',
      lastInteraction: '2026-08-10T00:00:00.000Z',
    } as any);
    d.bookings.push({
      id: 'bk-old',
      businessId: 'b1',
      customerId: 'cust1',
      serviceId: 's1',
      professionalId: '',
      date: '2026-08-10',
      time: '10:00',
      customerName: 'Cliente Antigo',
      customerPhone: '11900000020',
      status: 'completed',
      note: '',
      answers: [],
      createdAt: '2026-08-10T00:00:00.000Z',
      updatedAt: '2026-08-10T00:00:00.000Z',
      history: [],
    } as any);
    const count = createWinBackLeads(d, 'b1', '2026-09-16');
    expect(count).toBeGreaterThan(0);
    const lead = d.leads.find((l) => onlyDigits(l.phone) === '11900000020');
    expect(lead).toBeTruthy();
    expect(lead?.stageId).toBeDefined();
    expect(normalizeLeadStageId(getBusinessPipeline(d, 'b1'), lead!)).toBe(lead?.stageId);
  });
});

describe('A3 · Tarefas e isolamento', () => {
  it('19 - createTaskTx recusa lead de outro tenant', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'), biz('b2'));
    d.leads.push({
      id: 'l-other',
      businessId: 'b2',
      customerId: '',
      name: 'Outro',
      phone: '11900000030',
      email: '',
      instagram: '',
      origin: '',
      interest: '',
      action: 'contato',
      status: 'new',
      stageId: 'new',
      assignedUserId: '',
      priority: 'medium',
      nextAction: '',
      serviceId: '',
      professionalId: '',
      sourceUrl: '',
      metadata: {},
      notes: [],
      stageHistory: [],
      createdAt: NOW,
      lastInteraction: NOW,
    } as Lead);
    const res = createTaskTx(d, {
      businessId: 'b1',
      title: 'Ligar',
      createdBy: 'owner',
      leadId: 'l-other',
    });
    expect(res.task).toBeNull();
    expect(res.reason).toMatch(/lead não pertence/);
  });
  it('20 - createTaskTx cria tarefa vinculada ok', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.leads.push({
      id: 'l1',
      businessId: 'b1',
      customerId: '',
      name: 'Ana',
      phone: '11900000040',
      email: '',
      instagram: '',
      origin: '',
      interest: '',
      action: 'contato',
      status: 'new',
      stageId: 'new',
      assignedUserId: '',
      priority: 'medium',
      nextAction: '',
      serviceId: '',
      professionalId: '',
      sourceUrl: '',
      metadata: {},
      notes: [],
      stageHistory: [],
      createdAt: NOW,
      lastInteraction: NOW,
    } as Lead);
    const res = createTaskTx(d, { businessId: 'b1', title: 'Retornar', createdBy: 'owner', leadId: 'l1' });
    expect(res.created).toBe(true);
    expect(res.task?.leadId).toBe('l1');
  });
  it('21 - pipeline 360: normalizeLeadStageId nunca deixa lead invisível', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    const pipeline = getBusinessPipeline(d, 'b1');
    const fakeLead = {
      businessId: 'b1',
      stageId: 'etapa_inexistente',
      status: 'new',
    } as Lead;
    const normalized = normalizeLeadStageId(pipeline, fakeLead);
    expect(pipeline.stages.some((s) => s.id === normalized)).toBe(true);
  });
  it('22 - stageId é a verdade: status muda quando stage muda', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.leads.push({
      id: 'l1',
      businessId: 'b1',
      customerId: '',
      name: 'Ana',
      phone: '11900000050',
      email: '',
      instagram: '',
      origin: 'manual',
      interest: '',
      action: 'contato',
      status: 'new',
      stageId: 'new',
      assignedUserId: '',
      priority: 'medium',
      nextAction: '',
      serviceId: '',
      professionalId: '',
      sourceUrl: '',
      metadata: {},
      notes: [],
      stageHistory: [],
      createdAt: NOW,
      lastInteraction: NOW,
    } as Lead);
    const pipeline = getBusinessPipeline(d, 'b1');
    moveLeadStage(d, { businessId: 'b1', leadId: 'l1', toStageId: 'scheduled', actor: { id: 'owner', name: 'Equipe' }, now: NOW, allowScheduledTransition: true });
    const lead = d.leads[0];
    expect(lead.stageId).toBe('scheduled');
    expect(lead.status).toBe(mapStageToStatus(pipeline, 'scheduled'));
  });
});
