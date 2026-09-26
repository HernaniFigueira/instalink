import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FOLLOW_UP_RECIPES, evaluateRule, evaluateFollowUps, followUpChannelState, seedFollowUpRules,
} from '../follow-up';
import { buildWorkspaceAlerts } from '../workspace-alerts';
import { dashboardAttention } from '../dashboard';
import type { Booking, BusinessCustomer as Contact, Encounter, FollowUpRule, Lead } from '../types';

const root = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(root, rel), 'utf8');

const rule = (trigger: FollowUpRule['trigger'], over: Partial<FollowUpRule> = {}): FollowUpRule => ({
  id: `fup-${trigger}`, businessId: 'b1', name: trigger, trigger, active: true,
  delayValue: 0, delayUnit: 'days', params: {}, action: 'a', channel: 'whatsapp',
  audience: 'p', createdAt: '2026-01-01', updatedAt: '2026-01-01', ...over,
});

const contact = (over: Partial<Contact>): Contact => ({
  id: 'c1', businessId: 'b1', customerId: '', name: 'João', phone: '11999998888', email: '',
  createdAt: '2026-01-01', updatedAt: '2026-01-01', source: 'x', lastInteraction: '', marketingOptIn: false,
  ...over,
} as Contact);

const booking = (over: Partial<Booking>): Booking => ({
  id: 'bk1', businessId: 'b1', customerId: '', serviceId: 's1', professionalId: 'p1',
  date: '2026-09-20', time: '10:00', customerName: 'João', customerPhone: '11999998888',
  status: 'completed', note: '', answers: [], createdAt: '2026-09-01', updatedAt: '2026-09-01', history: [],
  ...over,
} as Booking);

const encounter = (over: Partial<Encounter>): Encounter => ({
  id: 'e1', businessId: 'b1', bookingId: '', queueId: '', serviceId: 's1', professionalId: 'p1',
  customerId: '', contactId: 'c1', customerName: 'João', date: '2026-09-01', time: '10:00',
  complaint: '', evolution: 'feito', guidance: '', followUp: '', internalNote: '', tags: [],
  status: 'finalized', version: 1, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  createdBy: '', updatedBy: '', finalizedAt: '2026-09-01T01:00:00Z', finalizedBy: '', signedBy: 'Dra.',
  followUpMode: 'none', followUpDate: '', followUpDays: 0, files: [],
  ...over,
} as Encounter);

const lead = (over: Partial<Lead>): Lead => ({
  id: 'l1', businessId: 'b1', customerId: '', name: 'Maria', phone: '11911112222', email: '',
  instagram: '', origin: 'site', interest: '', action: '', status: 'new',
  createdAt: '2026-09-01T00:00:00Z', lastInteraction: '', ...over,
} as Lead);

const baseInput = (over: Partial<Parameters<typeof evaluateFollowUps>[0]> = {}) => ({
  rules: [], contacts: [], leads: [], bookings: [], encounters: [],
  today: '2026-09-23', now: '2026-09-23T12:00:00Z', ...over,
});

describe('FASE 2 · P10 — receitas de follow-up (fundação, sem envio)', () => {
  it('catálogo tem as 6 receitas com gatilho/atraso/público/ação', () => {
    expect(FOLLOW_UP_RECIPES.map((r) => r.trigger).sort()).toEqual(
      ['after_completion', 'before_appointment', 'inactive_patient', 'lead_no_booking', 'no_show', 'return_due'].sort(),
    );
    for (const r of FOLLOW_UP_RECIPES) {
      expect(r.name).toBeTruthy();
      expect(r.audience).toBeTruthy();
      expect(r.action).toBeTruthy();
      expect(['minutes', 'hours', 'days']).toContain(r.delay.unit);
      expect(r.defaultActive).toBe(false); // ligar é decisão explícita
    }
    const seeded = seedFollowUpRules('business-1', 'now');
    expect(seeded).toHaveLength(6);
    expect(new Set(seeded.map((r) => r.id)).size).toBe(6);
    expect(seeded.every((r) => r.active === false)).toBe(true);
    expect(seeded.every((r) => r.businessId === 'business-1')).toBe(true);
  });

  it('estado honesto do canal: só "connected" está operacional', () => {
    expect(followUpChannelState({ whatsappIntegration: { status: 'connected' } as any })).toEqual({ ready: true, label: 'WhatsApp conectado' });
    expect(followUpChannelState({ whatsappIntegration: { status: 'pending' } as any }).label).toBe('Aguardando conexão do WhatsApp');
    expect(followUpChannelState({}).ready).toBe(false);
  });

  it('regra DESLIGADA não gera candidato (nunca)', () => {
    const r = rule('lead_no_booking', { active: false });
    expect(evaluateRule(r, baseInput({ leads: [lead({})] }))).toEqual([]);
  });

  it('lead sem agendamento: idade >= atraso, status aberto, sem booking', () => {
    const r = rule('lead_no_booking', { delayValue: 1, delayUnit: 'days' });
    const fresh = lead({ id: 'l-new', createdAt: '2026-09-23T01:00:00Z' }); // hoje
    const old = lead({ id: 'l-old', createdAt: '2026-09-01T00:00:00Z' });
    const booked = lead({ id: 'l-bk', createdAt: '2026-09-01T00:00:00Z', bookingId: 'bk9' });
    const lost = lead({ id: 'l-lost', createdAt: '2026-09-01T00:00:00Z', status: 'lost' });
    const out = evaluateRule(r, baseInput({ leads: [fresh, old, booked, lost] }));
    expect(out.map((c) => c.leadId)).toEqual(['l-old']);
  });

  it('retorno: vencido/hoje SEM futuro agendamento (telefone é a chave)', () => {
    const r = rule('return_due');
    const due = encounter({ id: 'e-due', followUpMode: 'interval', followUpDays: 30, date: '2026-08-01' }); // venceu 2026-08-31
    const future = booking({ id: 'bk-f', date: '2026-10-01', status: 'confirmed', customerPhone: '11999998888' });
    const joao = contact({ id: 'c1', phone: '11999998888' });
    // com agendamento futuro (mesmo telefone) → some
    expect(evaluateRule(r, baseInput({ encounters: [due], bookings: [future], contacts: [joao] }))).toEqual([]);
    // sem futuro → aparece, com o contato do atendimento
    const out = evaluateRule(r, baseInput({ encounters: [due], contacts: [joao] }));
    expect(out).toHaveLength(1);
    expect(out[0].contactId).toBe('c1');
    expect(out[0].trigger).toBe('return_due');
    // retorno futuro ainda não venceu
    const later = encounter({ id: 'e-later', followUpMode: 'date', followUpDate: '2026-12-01' });
    expect(evaluateRule(r, baseInput({ encounters: [later] }))).toEqual([]);
  });

  it('falta: no_show recente sem reagendamento; pós-atendimento dentro da janela', () => {
    const noshow = booking({ id: 'bk-ns', status: 'no_show', date: '2026-09-22' });
    const rebooked = booking({ id: 'bk-ns2', status: 'no_show', date: '2026-09-22', customerPhone: '11900000001' });
    const again = booking({ id: 'bk-again', status: 'confirmed', date: '2026-10-01', customerPhone: '11900000001' });
    const out = evaluateRule(rule('no_show'), baseInput({ bookings: [noshow, rebooked, again] }));
    expect(out.map((c) => c.bookingId)).toEqual(['bk-ns']);

    const done = encounter({ id: 'e-done', date: '2026-09-22', followUpMode: 'none' });
    const post = evaluateRule(rule('after_completion', { delayValue: 1, delayUnit: 'days' }), baseInput({ encounters: [done] }));
    expect(post).toHaveLength(1);
  });

  it('paciente inativo: última conclusão por telefone + atraso', () => {
    const r = rule('inactive_patient', { delayValue: 90, delayUnit: 'days' });
    const old = booking({ id: 'bk-old', status: 'completed', date: '2026-01-01', customerPhone: '11912345678' });
    const recent = booking({ id: 'bk-new', status: 'completed', date: '2026-09-01', customerPhone: '11987654321' });
    const c1 = contact({ id: 'c-old', phone: '11912345678' });
    const c2 = contact({ id: 'c-new', phone: '11987654321' });
    const out = evaluateRule(r, baseInput({ bookings: [old, recent], contacts: [c1, c2] }));
    expect(out.map((c) => c.contactId)).toEqual(['c-old']);
  });

  it('evaluateFollowUps junta todas as regras ativas (teto por regra preservado)', () => {
    const rules = [rule('lead_no_booking', { delayValue: 1, delayUnit: 'days' }), rule('return_due')];
    const leads = Array.from({ length: 60 }, (_, i) => lead({ id: `l${i}`, createdAt: '2026-09-01T00:00:00Z' }));
    const all = evaluateFollowUps(baseInput({ rules, leads }));
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThanOrEqual(100); // 50 por regra
  });
});

describe('FASE 2 · P10 — notificações reais (retorno pendente)', () => {
  it('atenção ganha "retornos pendentes" só com dado real e href por permissão', () => {
    const withPerm = dashboardAttention({
      closures: 0, leadsNew: 0, tasksOverdue: 0, returnsDue: 2,
      permissions: { agenda: true, leads: false, tasks: false, followUp: true },
    });
    expect(withPerm.find((i) => i.id === 'returnsDue')).toEqual({
      id: 'returnsDue', count: 2, label: 'retornos pendentes', href: '/followup',
    });
    const semPerm = dashboardAttention({
      closures: 0, leadsNew: 0, tasksOverdue: 0, returnsDue: 1,
      permissions: { agenda: true, leads: false, tasks: false, followUp: false },
    });
    expect(semPerm.find((i) => i.id === 'returnsDue')?.href).toBeNull();
    // zero não inventa item
    expect(dashboardAttention({ closures: 0, leadsNew: 0, tasksOverdue: 0, permissions: { agenda: true, leads: true, tasks: true } })).toEqual([]);
  });

  it('sino traduz o item com tom/ícone próprios', () => {
    const alerts = buildWorkspaceAlerts({
      attention: [{ id: 'returnsDue', count: 3, label: 'retornos pendentes', href: '/followup' }],
      whatsapp: null, pendingSetup: 0,
    }, '?b=x');
    expect(alerts.items[0]).toMatchObject({ id: 'returnsDue', count: 3, tone: 'violet', href: '/followup?b=x' });
    expect(alerts.total).toBe(3);
  });
});

describe('FASE 2 · P10 — página e API honestas (regressão estática)', () => {
  it('porta /followup no catálogo + API com guarda config + sem envio', () => {
    const panel = read('src/lib/panel.ts');
    expect(panel).toContain("href: '/followup'");
    expect(panel).toContain("route: '/api/followup'");
    const api = read('src/app/api/followup/route.ts');
    expect(api).toContain("requireBusiness(req, businessId, 'config')");
    // a API só lê/gerencia regras — nenhuma chamada de envio/integração
    expect(api).not.toMatch(/whatsapp-cloud|dispatch|sendText|graph\.facebook/);
    const page = read('src/app/(dashboard)/followup/page.tsx');
    expect(page).toContain('Aguardando conexão do WhatsApp');
    expect(page).toContain('nada é enviado');
    expect(page).toContain("action: 'seed'");
    expect(page).toContain('Prévia agora');
  });
});
