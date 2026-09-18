// ═══════════════════════════════════════════════════════════════
// A2-B1 (F2) — AGENDA → PIPELINE OFICIAL
// ═══════════════════════════════════════════════════════════════
// Regressão do caminho booking → lead: nenhum fluxo escreve `stageId`
// diretamente; todo destino passa pela máquina oficial (markLeadScheduled →
// moveLeadStage) com histórico coerente, status projetado recalculado e
// evento `lead.stage_changed` emitido para o P4.
import { describe, expect, it } from 'vitest';
import { emptyDB } from '../db';
import {
  ensureScheduledStage,
  getBusinessPipeline,
  markLeadScheduled,
  moveLeadStage,
  normalizeLeadStageId,
  updateBusinessPipeline,
} from '../pipeline';
import { createBookingTx } from '../booking-create';
import type { Business, DB, Lead, Service } from '../types';
import { buildAutomation } from './helpers/automation-fixtures';

const NOW = '2026-09-16T12:00:00.000Z';

function biz(id: string, extra: Partial<Business> = {}): Business {
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
    ...extra,
  };
}

function service(id: string, businessId: string, extra: Partial<Service> = {}): Service {
  return {
    id, businessId, categoryId: '', name: 'Corte', description: '', image: '',
    price: 5000, durationMin: 30, professionalIds: [], active: true, featured: false,
    bookable: true, questions: [],
    ...extra,
  };
}

// Segunda 2026-09-21 (data futura fixa, dentro do horizonte) — 09:00.
const FUTURE_DATE = '2026-09-21';
const FUTURE_TIME = '09:00';

function withAvailability(d: DB, businessId: string): void {
  d.availability.push({
    id: 'av-1', businessId, professionalId: '', serviceId: '',
    weekday: 1, start: '09:00', end: '18:00', slotMin: 30,
  });
}

function leadOf(d: DB, businessId: string, phone: string): Lead | undefined {
  return d.leads.find((l) => l.businessId === businessId && l.phone === phone);
}

function stageEvents(d: DB, businessId: string): Array<Record<string, any>> {
  return d.automationRuns
    .filter((r) => r.businessId === businessId && r.triggerEvent === 'lead.stage_changed')
    .map((r) => (r.context as any)?.event ?? {}) as Array<Record<string, any>>;
}

/** Automação ouvinte: permite observar que o evento do P4 foi emitido. */
function listenStageChanged(d: DB): void {
  d.automations.push(buildAutomation({
    id: 'auto-listen-stage',
    event: 'lead.stage_changed',
    steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'etapa mudou' } } }],
  }));
}

/** Ouvintes para todos os eventos do ciclo booking → lead (P4). */
function listenAll(d: DB): void {
  listenStageChanged(d);
  d.automations.push(buildAutomation({
    id: 'auto-listen-lead-created',
    event: 'lead.created',
    steps: [{ kind: 'action', action: { type: 'add_lead_note', params: { text: 'lead criado' } } }],
  }));
  d.automations.push(buildAutomation({
    id: 'auto-listen-booking-created',
    event: 'booking.created',
    steps: [{ kind: 'action', action: { type: 'create_task', params: { title: 'novo agendamento' } } }],
  }));
}

function runEventsOf(d: DB): string[] {
  return d.automationRuns.map((r) => r.triggerEvent);
}

// ── ensureScheduledStage (DECISÃO 2 — etapa estrutural) ──────────
describe('A2-B1 · ensureScheduledStage', () => {
  it('esteira padrão já tem `scheduled` — nada muda', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    const p = ensureScheduledStage(d, 'b1');
    expect(p.stages.some((s) => s.id === 'scheduled' && s.isSystem)).toBe(true);
    expect(p.stages.length).toBe(8);
  });

  it('esteira customizada sem `scheduled` ganha a etapa de sistema de volta, preservando as customizadas', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    updateBusinessPipeline(d, 'b1', [
      { id: 'new', name: 'Novo', order: 0 },
      { id: 'negociando', name: 'Negociando', order: 1 },
      { id: 'converted', name: 'Concluído', order: 2, isTerminal: true },
    ]);
    expect(getBusinessPipeline(d, 'b1').stages.some((s) => s.id === 'scheduled')).toBe(false);

    const p = ensureScheduledStage(d, 'b1');
    expect(p.stages.some((s) => s.id === 'scheduled' && s.isSystem)).toBe(true);
    expect(p.stages.some((s) => s.id === 'negociando')).toBe(true); // customização intacta
    expect(p.stages.find((s) => s.id === 'scheduled')?.mappedStatus).toBe('converted');
  });

  it('é idempotente (não duplica a etapa)', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    ensureScheduledStage(d, 'b1');
    const p = ensureScheduledStage(d, 'b1');
    expect(p.stages.filter((s) => s.id === 'scheduled').length).toBe(1);
  });
});

// ── markLeadScheduled (a máquina oficial aplicada ao agendamento) ──
describe('A2-B1 · markLeadScheduled', () => {
  it('move o lead para `scheduled` com status projetado coerente, histórico e evento P4', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    listenStageChanged(d);
    const res = markLeadScheduled(d, {
      businessId: 'b1', leadId: undefined as unknown as string, // sem lead → null
      actor: { id: 'customer', name: 'Agendamento' },
    });
    expect(res).toBeNull();

    d.leads.push({
      id: 'l1', businessId: 'b1', customerId: '', name: 'Ana', phone: '11988887777',
      email: '', instagram: '', origin: 'agendamento', interest: '', action: 'contato',
      status: 'new', stageId: 'new', assignedUserId: '', priority: 'medium', nextAction: '',
      serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [], createdAt: NOW, lastInteraction: NOW,
    });
    const out = markLeadScheduled(d, {
      businessId: 'b1', leadId: 'l1',
      bookingId: 'bk1', bookingDate: FUTURE_DATE, bookingTime: FUTURE_TIME,
      actor: { id: 'customer', name: 'Agendamento' }, now: NOW,
    });
    expect(out?.moved).toBe(true);
    expect(out?.lead.stageId).toBe('scheduled');
    expect(out?.lead.status).toBe('converted'); // projeção recalculada (nunca inconsistente)
    expect(out?.lead.bookingId).toBe('bk1');
    const hist = out?.lead.stageHistory || [];
    expect(hist.length).toBe(1);
    expect(hist[0].fromStage).toBe('new');
    expect(hist[0].toStage).toBe('scheduled');
    expect(hist[0].note).toContain(FUTURE_DATE);
    // Evento para o P4 nasce do movimento oficial.
    const evs = stageEvents(d, 'b1');
    expect(evs.length).toBe(1);
    expect(evs[0].stageId).toBe('scheduled');
    expect(evs[0].fromStage).toBe('new');
  });

  it('reabre lead TERMINAL (perdido): stageId=scheduled ⇒ status=converted (DECISÃO 1)', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.leads.push({
      id: 'l1', businessId: 'b1', customerId: '', name: 'Ana', phone: '11988887777',
      email: '', instagram: '', origin: 'agendamento', interest: '', action: 'contato',
      status: 'lost', stageId: 'lost', assignedUserId: '', priority: 'medium', nextAction: '',
      serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [], createdAt: NOW, lastInteraction: NOW,
    });
    const out = markLeadScheduled(d, {
      businessId: 'b1', leadId: 'l1',
      bookingId: 'bk2', bookingDate: FUTURE_DATE, bookingTime: FUTURE_TIME,
      actor: { id: 'customer', name: 'Agendamento' }, now: NOW,
    });
    expect(out?.reopened).toBe(true);
    expect(out?.moved).toBe(true);
    // PROIBIDO: stageId=scheduled + status=lost
    expect(out?.lead.stageId).toBe('scheduled');
    expect(out?.lead.status).not.toBe('lost');
    expect(out?.lead.status).toBe('converted');
    expect(out?.lead.stageHistory!.at(-1)?.fromStage).toBe('lost');
  });

  it('agendamento repetido (lead já em `scheduled`) não gera histórico redundante', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.leads.push({
      id: 'l1', businessId: 'b1', customerId: '', name: 'Ana', phone: '11988887777',
      email: '', instagram: '', origin: 'agendamento', interest: '', action: 'contato',
      status: 'converted', stageId: 'scheduled', assignedUserId: '', priority: 'medium', nextAction: '',
      serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [{ id: 'h1', fromStage: 'new', toStage: 'scheduled', movedBy: 'customer', movedByName: 'Agendamento', at: NOW }],
      createdAt: NOW, lastInteraction: NOW,
    });
    const out = markLeadScheduled(d, {
      businessId: 'b1', leadId: 'l1', bookingId: 'bk3',
      bookingDate: FUTURE_DATE, bookingTime: '10:00',
      actor: { id: 'customer', name: 'Agendamento' }, now: NOW,
    });
    expect(out?.moved).toBe(false);
    expect(out?.lead.stageHistory!.length).toBe(1); // sem entrada duplicada
    expect(out?.lead.bookingId).toBe('bk3'); // vínculo atualizado
    expect(stageEvents(d, 'b1').length).toBe(0); // sem evento sem mudança
  });

  it('esteira customizada sem `scheduled`: o destino estrutural é garantido (sem fallback para Novo)', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    updateBusinessPipeline(d, 'b1', [
      { id: 'new', name: 'Novo', order: 0 },
      { id: 'converted', name: 'Concluído', order: 1, isTerminal: true },
    ]);
    d.leads.push({
      id: 'l1', businessId: 'b1', customerId: '', name: 'Ana', phone: '11988887777',
      email: '', instagram: '', origin: 'agendamento', interest: '', action: 'contato',
      status: 'new', stageId: 'new', assignedUserId: '', priority: 'medium', nextAction: '',
      serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [], createdAt: NOW, lastInteraction: NOW,
    });
    const out = markLeadScheduled(d, {
      businessId: 'b1', leadId: 'l1',
      bookingId: 'bk4', bookingDate: FUTURE_DATE, bookingTime: FUTURE_TIME,
      actor: { id: 'customer', name: 'Agendamento' }, now: NOW,
    });
    const pipeline = getBusinessPipeline(d, 'b1');
    expect(pipeline.stages.some((s) => s.id === 'scheduled')).toBe(true);
    expect(normalizeLeadStageId(pipeline, out!.lead)).toBe('scheduled'); // não vira "Novo"
    expect(out?.lead.status).toBe('converted');
  });

  it('isolamento: leadId de outro tenant nunca é movido', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'), biz('b2'));
    d.leads.push({
      id: 'l-b2', businessId: 'b2', customerId: '', name: 'De Outro Dono', phone: '11977776666',
      email: '', instagram: '', origin: '', interest: '', action: 'contato',
      status: 'new', stageId: 'new', assignedUserId: '', priority: 'medium', nextAction: '',
      serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [], createdAt: NOW, lastInteraction: NOW,
    });
    const out = markLeadScheduled(d, {
      businessId: 'b1', leadId: 'l-b2',
      bookingId: 'bk5', bookingDate: FUTURE_DATE, bookingTime: FUTURE_TIME,
      actor: { id: 'customer', name: 'Agendamento' }, now: NOW,
    });
    expect(out).toBeNull(); // não encontrado no tenant b1
    expect(d.leads[0].stageId).toBe('new'); // intacto
    expect(d.leads[0].bookingId).toBeUndefined();
  });
});

// ── createBookingTx ponta a ponta (o caminho de booking usa o helper) ──
describe('A2-B1 · createBookingTx → esteira oficial', () => {
  function baseDb(): DB {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.services.push(service('s1', 'b1'));
    withAvailability(d, 'b1');
    return d;
  }

  it('booking público de cliente NOVO cria o lead pela entrada universal, já em `scheduled`', () => {
    const d = baseDb();
    listenAll(d);
    const res = createBookingTx(d, {
      business: d.businesses[0],
      service: d.services[0],
      date: FUTURE_DATE,
      time: FUTURE_TIME,
      actor: 'customer',
      customer: { id: '', name: 'Bruno Novo', phone: '11912345678' },
      now: NOW,
    });
    expect(res.bookingId).toBeTruthy();
    expect(res.status).toBe('pending');

    const lead = leadOf(d, 'b1', '11912345678')!;
    expect(lead).toBeTruthy();
    expect(lead.stageId).toBe('scheduled');
    expect(lead.status).toBe('converted');
    expect(lead.bookingId).toBe(res.bookingId);
    expect(lead.origin).toBe('agendamento');
    // Histórico coerente: entrada + movimento oficial para `scheduled`
    expect(lead.stageHistory!.map((h) => h.toStage)).toEqual(['new', 'scheduled']);
    expect(lead.stageHistory!.at(-1)?.note).toContain(FUTURE_DATE);
    // Eventos: lead criado + mudança de etapa + booking criado
    const runEvents = runEventsOf(d);
    expect(runEvents).toContain('lead.created');
    expect(runEvents).toContain('lead.stage_changed');
    expect(runEvents).toContain('booking.created');
  });

  it('booking público de lead EXISTENTE reutiliza o lead (nunca duplica) e move pela máquina oficial', () => {
    const d = baseDb();
    const ing = (() => {
      // lead pré-existente em negociação
      d.leads.push({
        id: 'l-ex', businessId: 'b1', customerId: '', name: 'Marina', phone: '11965432100',
        email: '', instagram: '', origin: 'instagram', interest: 'Corte', action: 'contato',
        status: 'contacted', stageId: 'in_progress', assignedUserId: '', priority: 'medium', nextAction: '',
        serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
        stageHistory: [{ id: 'h0', fromStage: 'new', toStage: 'in_progress', movedBy: 'owner', movedByName: 'Equipe', at: NOW }],
        createdAt: NOW, lastInteraction: NOW,
      });
      return true;
    })();
    expect(ing).toBe(true);

    createBookingTx(d, {
      business: d.businesses[0],
      service: d.services[0],
      date: FUTURE_DATE,
      time: FUTURE_TIME,
      actor: 'customer',
      customer: { id: '', name: 'Marina', phone: '11965432100' },
      now: NOW,
    });

    expect(d.leads.filter((l) => onlyPhone(l) === '11965432100').length).toBe(1);
    const lead = leadOf(d, 'b1', '11965432100')!;
    expect(lead.stageId).toBe('scheduled');
    expect(lead.status).toBe('converted');
    expect(lead.stageHistory!.map((h) => h.toStage)).toEqual(['in_progress', 'scheduled']);
  });

  it('booking de lead TERMINAL (perdido) reabre o MESMO lead — nunca status=lost com stageId=scheduled', () => {
    const d = baseDb();
    d.leads.push({
      id: 'l-lost', businessId: 'b1', customerId: '', name: 'Rafael', phone: '11944443333',
      email: '', instagram: '', origin: 'agendamento', interest: '', action: 'contato',
      status: 'lost', stageId: 'lost', assignedUserId: '', priority: 'medium', nextAction: '',
      serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [{ id: 'h0', fromStage: 'new', toStage: 'lost', movedBy: 'owner', movedByName: 'Equipe', at: NOW }],
      createdAt: NOW, lastInteraction: NOW,
    });
    createBookingTx(d, {
      business: d.businesses[0],
      service: d.services[0],
      date: FUTURE_DATE,
      time: FUTURE_TIME,
      actor: 'customer',
      customer: { id: '', name: 'Rafael', phone: '11944443333' },
      now: NOW,
    });
    expect(d.leads.length).toBe(1); // SEM lead duplicado
    const lead = d.leads[0];
    expect(lead.stageId).toBe('scheduled');
    expect(lead.status).toBe('converted');
    expect(lead.stageHistory!.at(-1)?.fromStage).toBe('lost');
  });

  it('booking de DONO com leadId (esteira/bookLead) também passa pelo helper oficial', () => {
    const d = baseDb();
    d.leads.push({
      id: 'l-owner', businessId: 'b1', customerId: '', name: 'Paula', phone: '11922223333',
      email: '', instagram: '', origin: 'manual', interest: '', action: 'contato',
      status: 'new', stageId: 'new', assignedUserId: '', priority: 'high', nextAction: '',
      serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [], createdAt: NOW, lastInteraction: NOW,
    });
    createBookingTx(d, {
      business: d.businesses[0],
      service: d.services[0],
      date: FUTURE_DATE,
      time: FUTURE_TIME,
      actor: 'owner',
      customer: { id: '', name: 'Paula', phone: '11922223333' },
      leadId: 'l-owner',
      now: NOW,
    });
    const lead = d.leads[0];
    expect(lead.stageId).toBe('scheduled');
    expect(lead.status).toBe('converted');
    expect(lead.stageHistory!.at(-1)?.movedBy).toBe('owner');
  });

  it('booking público com esteira CUSTOMIZADA sem `scheduled`: lead cai na etapa estrutural recreada', () => {
    const d = baseDb();
    updateBusinessPipeline(d, 'b1', [
      { id: 'new', name: 'Novo', order: 0 },
      { id: 'converted', name: 'Fim', order: 1, isTerminal: true },
    ]);
    createBookingTx(d, {
      business: d.businesses[0],
      service: d.services[0],
      date: FUTURE_DATE,
      time: FUTURE_TIME,
      actor: 'customer',
      customer: { id: '', name: 'Helena', phone: '11911112222' },
      now: NOW,
    });
    const lead = leadOf(d, 'b1', '11911112222')!;
    expect(lead.stageId).toBe('scheduled');
    expect(normalizeLeadStageId(getBusinessPipeline(d, 'b1'), lead)).toBe('scheduled');
    expect(lead.status).toBe('converted');
  });

  it('pipeline customizado não é reescrito pelo booking (etapas do lojista permanecem)', () => {
    const d = baseDb();
    updateBusinessPipeline(d, 'b1', [
      { id: 'new', name: 'Novo', order: 0 },
      { id: 'negociando', name: 'Em negociação', order: 1 },
      { id: 'converted', name: 'Fim', order: 2, isTerminal: true },
    ]);
    createBookingTx(d, {
      business: d.businesses[0],
      service: d.services[0],
      date: FUTURE_DATE,
      time: FUTURE_TIME,
      actor: 'customer',
      customer: { id: '', name: 'Tiago', phone: '11900001111' },
      now: NOW,
    });
    const stages = getBusinessPipeline(d, 'b1').stages.map((s) => s.id);
    expect(stages).toContain('negociando');
    expect(stages.filter((s) => s === 'scheduled').length).toBe(1);
  });

  it('booking pelo assistente (agent) também move o lead pela máquina oficial', () => {
    const d = baseDb();
    listenStageChanged(d);
    createBookingTx(d, {
      business: d.businesses[0],
      service: d.services[0],
      date: FUTURE_DATE,
      time: FUTURE_TIME,
      actor: 'agent',
      customer: { id: '', name: 'Sofia', phone: '11933334444' },
      now: NOW,
    });
    const lead = leadOf(d, 'b1', '11933334444')!;
    expect(lead.stageId).toBe('scheduled');
    expect(lead.status).toBe('converted');
    expect(lead.stageHistory!.at(-1)?.movedBy).toBe('agent');
    expect(runEventsOf(d)).toContain('lead.stage_changed');
  });
});

function onlyPhone(l: Lead): string {
  return l.phone;
}

// Sanity: movimentos inválidos continuam recusados pela máquina oficial
describe('A2-B1 · máquina oficial intacta', () => {
  it('moveLeadStage continua recusando etapa inexistente', () => {
    const d = emptyDB();
    d.businesses.push(biz('b1'));
    d.leads.push({
      id: 'l1', businessId: 'b1', customerId: '', name: 'Ana', phone: '11988887777',
      email: '', instagram: '', origin: '', interest: '', action: 'contato',
      status: 'new', stageId: 'new', assignedUserId: '', priority: 'medium', nextAction: '',
      serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [], createdAt: NOW, lastInteraction: NOW,
    });
    expect(() =>
      moveLeadStage(d, {
        businessId: 'b1', leadId: 'l1', toStageId: 'etapa_inexistente',
        actor: { id: 'owner', name: 'Equipe' },
      }),
    ).toThrow();
  });
});
