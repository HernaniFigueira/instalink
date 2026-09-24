import { describe, expect, it } from 'vitest';
import { emptyDB } from '../db';
import { addContact, addLead, automationFixtures, buildAutomation, FIXED_NOW, biz } from './helpers/automation-fixtures';
import type { Booking, Conversation, Encounter, FollowUpRule, Message, Pet } from '../types';
import { evaluateRule, evaluateFollowUps, followUpChannelState } from '../follow-up';
import {
  applyOutreachReply, buildOutreachMessage, classifyOutreachReply,
  deferUntilQuietEnd, isQuietHours, markOutreachBooked, outreachHistory,
  outreachIdempotencyKey, outreachEventKey, outreachStatusLabel,
  revalidateOutreach, scanAllOutreach, scanBusinessOutreach, upcomingReturnFor,
} from '../follow-up-outreach';
import { followUpDueDate } from '../encounters';
import { emitAutomationEvent } from '../automation/events';
import { sendConversationMessage } from '../messaging/service';
import { FOLLOW_UP_OUTREACH_LABELS } from '../types';

// ══════════════════════════════════════════════════════════════
// F3-H · Follow-up, Reativação e Anti-Duplo-Envio
// 1–12 retorno · 13–20 reativação · regressões F3-G/F/F/E/D
// ══════════════════════════════════════════════════════════════

const NOW = FIXED_NOW; // 2026-09-16T12:00:00Z = 09:00 America/Sao_Paulo (qua)
const TODAY = '2026-09-16';

function ruleReturn(businessId = 'b1'): FollowUpRule {
  return {
    id: 'rule-return',
    businessId,
    name: 'Retorno',
    trigger: 'return_due',
    active: true,
    delayValue: 0,
    delayUnit: 'days',
    params: {},
    action: 'Lembrar do retorno',
    channel: 'whatsapp',
    audience: 'Pacientes com retorno',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function ruleInactive(businessId = 'b1', days = 90): FollowUpRule {
  return {
    id: 'rule-inactive',
    businessId,
    name: 'Inativo',
    trigger: 'inactive_patient',
    active: true,
    delayValue: days,
    delayUnit: 'days',
    params: {},
    action: 'Reativar',
    channel: 'whatsapp',
    audience: 'Inativos',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function connectedBiz(id = 'b1', extra: Partial<Parameters<typeof biz>[1]> = {}) {
  return biz(id, {
    whatsappIntegration: {
      id: 'wa-1',
      businessId: id,
      status: 'connected',
      phoneNumberId: '123',
      displayPhone: '11999990000',
      wabaId: '',
      accountId: '',
      appId: '',
      createdAt: NOW,
      updatedAt: NOW,
    } as any,
    ...extra,
  });
}

function encounterDue(overrides: Partial<Encounter> = {}): Encounter {
  return {
    id: 'enc-1',
    businessId: 'b1',
    bookingId: '',
    queueId: '',
    serviceId: 'srv1',
    professionalId: '',
    customerId: '',
    contactId: 'ct-1',
    customerName: 'Rafael',
    date: '2026-09-01',
    time: '10:00',
    complaint: '',
    evolution: '',
    guidance: '',
    followUp: '',
    internalNote: '',
    tags: [],
    status: 'finalized',
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    createdBy: 'ana',
    updatedBy: 'ana',
    finalizedAt: NOW,
    finalizedBy: 'ana',
    signedBy: 'Ana',
    followUpMode: 'date',
    followUpDate: TODAY,
    ...overrides,
  } as Encounter;
}

function baseDb(bizExtra: any = {}) {
  const db = automationFixtures();
  db.businesses = [connectedBiz('b1', bizExtra), biz('b2')];
  addContact(db, { id: 'ct-1', phone: '11988887777', name: 'Rafael', marketingOptIn: false });
  return db;
}

describe('F3-H · Follow-up de retorno (1–12)', () => {
  // 1 — chave lógica estável
  it('1 · chave de idempotência é estável e completa', () => {
    const a = outreachIdempotencyKey({ businessId: 'b1', kind: 'return', ruleId: 'r1', subjectId: 'enc-1', dueDate: TODAY });
    const b = outreachIdempotencyKey({ businessId: 'b1', kind: 'return', ruleId: 'r1', subjectId: 'enc-1', dueDate: TODAY });
    expect(a).toBe(b);
    expect(a).toContain('b1');
    expect(a).toContain('return');
    expect(a).toContain('enc-1');
    expect(a).toContain(TODAY);
    const other = outreachIdempotencyKey({ businessId: 'b1', kind: 'return', ruleId: 'r1', subjectId: 'enc-1', dueDate: '2026-09-17' });
    expect(other).not.toBe(a);
  });

  // 2 — evaluateRule return_due candidato vencido
  it('2 · retorno vencido vira candidato; futuro não', () => {
    const db = baseDb();
    db.encounters.push(encounterDue());
    const past = encounterDue({ id: 'enc-2', followUpDate: '2026-09-20' });
    db.encounters.push(past);
    const cands = evaluateRule(ruleReturn(), {
      rules: [ruleReturn()], contacts: db.contacts, leads: [], bookings: [], encounters: db.encounters,
      today: TODAY, now: NOW,
    });
    expect(cands.some((c) => c.encounterId === 'enc-1')).toBe(true);
    expect(cands.some((c) => c.encounterId === 'enc-2')).toBe(false);
  });

  // 3 — emit 1x com eventKey; re-scan não duplica
  it('3 · scan emite followup.due 1× e re-scan não duplica', () => {
    const db = baseDb();
    db.encounters.push(encounterDue());
    db.followUpRules.push(ruleReturn());
    const auto = buildAutomation({ event: 'followup.due', steps: [{ kind: 'action', action: { type: 'create_task', params: { title: 'Follow-up' } } }], id: 'auto-fup' });
    db.automations.push(auto);

    const r1 = scanBusinessOutreach(db, { businessId: 'b1', now: NOW });
    expect(r1.emitted).toBe(1);
    const r2 = scanBusinessOutreach(db, { businessId: 'b1', now: NOW });
    expect(r2.emitted).toBe(0);
    expect(db.followUpOutreach).toHaveLength(1);
    const runs = db.automationRuns.filter((r) => r.triggerEvent === 'followup.due' && r.businessId === 'b1');
    expect(runs.length).toBe(1); // 1× lógico
    const row = db.followUpOutreach[0];
    expect(runs[0].eventKey).toBe(row.eventKey);
    // re-scan não cria 2º run
    const runs2 = db.automationRuns.filter((r) => r.triggerEvent === 'followup.due' && r.businessId === 'b1');
    expect(runs2.length).toBe(1);
  });

  // 4 — skip já agendado
  it('4 · booking futuro ⇒ skipped_already_scheduled', () => {
    const db = baseDb();
    db.encounters.push(encounterDue());
    db.followUpRules.push(ruleReturn());
    const booking = {
      id: 'bk-1', businessId: 'b1', date: '2026-09-20', status: 'confirmed',
      customerPhone: '11988887777', customerName: 'Rafael',
    } as unknown as Booking;
    db.bookings.push(booking);
    // evaluateRule não gera candidato com booking futuro (não incomoda)
    const cands = evaluateRule(ruleReturn(), {
      rules: [ruleReturn()], contacts: db.contacts, leads: [], bookings: db.bookings,
      encounters: db.encounters, today: TODAY, now: NOW,
    });
    expect(cands.some((c) => c.encounterId === 'enc-1')).toBe(false);
    const r = scanBusinessOutreach(db, { businessId: 'b1', now: NOW });
    expect(r.emitted).toBe(0);
    // camada de revalidação (se um candidato chegar por outro caminho)
    const rev = revalidateOutreach({
      db, business: db.businesses[0], now: NOW,
      candidate: { ruleId: 'rule-return', trigger: 'return_due', contactId: 'ct-1', encounterId: 'enc-1', name: 'Rafael', phone: '', dueAt: TODAY, context: '' },
    });
    expect(rev.ok).toBe(false);
    expect(rev.reason).toBe('skipped_already_scheduled');
  });

  // 5 — skip superseded (atendimento mais novo)
  it('5 · atendimento mais novo ⇒ skipped_superseded', () => {
    const db = baseDb();
    const older = encounterDue({
      id: 'enc-old', followUpDate: TODAY, date: '2026-08-01',
      finalizedAt: '2026-08-01T12:00:00.000Z', updatedAt: '2026-08-01T12:00:00.000Z',
    });
    const newer = encounterDue({
      id: 'enc-new', followUpDate: TODAY, date: '2026-09-10', contactId: older.contactId,
      finalizedAt: '2026-09-10T12:00:00.000Z', updatedAt: '2026-09-10T12:00:00.000Z',
    });
    db.encounters.push(older, newer);
    // evaluateRule gera candidato para ambos; o mais novo supersede o antigo
    const revOld = revalidateOutreach({
      db, business: db.businesses[0], now: NOW,
      candidate: { ruleId: 'rule-return', trigger: 'return_due', contactId: 'ct-1', encounterId: 'enc-old', name: 'Rafael', phone: '', dueAt: TODAY, context: '' },
    });
    expect(revOld.ok).toBe(false);
    expect(revOld.reason).toBe('skipped_superseded');
  });

  // 6 — cancelado por contexto (retorno removido)
  it('6 · follow-up removido ⇒ cancelled_by_context', () => {
    const db = baseDb();
    const enc = encounterDue({ followUpMode: 'none' as any });
    db.encounters.push(enc);
    const rev = revalidateOutreach({
      db, business: db.businesses[0], now: NOW,
      candidate: { ruleId: 'rule-return', trigger: 'return_due', contactId: 'ct-1', encounterId: 'enc-1', name: 'Rafael', phone: '11988887777', dueAt: TODAY, context: '' },
    });
    expect(rev.ok).toBe(false);
    expect(rev.reason).toBe('cancelled_by_context');
  });

  // 7 — sem telefone
  it('7 · sem telefone ⇒ skipped_no_phone', () => {
    const db = baseDb();
    const c = db.contacts.find((x) => x.id === 'ct-1')!;
    c.phone = '';
    db.encounters.push(encounterDue({ contactId: 'ct-1' }));
    // candidate sem phone
    const rev = revalidateOutreach({
      db, business: db.businesses[0], now: NOW,
      candidate: { ruleId: 'rule-return', trigger: 'return_due', contactId: 'ct-1', encounterId: 'enc-1', name: 'Rafael', phone: '', dueAt: TODAY, context: '' },
    });
    expect(rev.ok).toBe(false);
    expect(rev.reason).toBe('skipped_no_phone');
  });

  // 8 — canal off ⇒ awaiting_channel sem emitir
  it('8 · WhatsApp desconectado ⇒ aguardando_canal e sem evento de envio', () => {
    const db = automationFixtures();
    db.businesses = [biz('b1'), biz('b2')]; // sem whatsappIntegration
    addContact(db, { id: 'ct-1', phone: '11988887777', name: 'Rafael' });
    db.encounters.push(encounterDue());
    db.followUpRules.push(ruleReturn());
    expect(followUpChannelState(db.businesses[0]).ready).toBe(false);
    const r = scanBusinessOutreach(db, { businessId: 'b1', now: NOW });
    expect(r.emitted).toBe(0);
    expect(r.skipped.some((s) => s.reason === 'awaiting_channel')).toBe(true);
    const row = db.followUpOutreach.find((o) => o.businessId === 'b1');
    expect(row?.status).toBe('aguardando_canal');
    expect(row?.statusLabel).toBe('Aguardando WhatsApp');
    // ao reconectar, revalida e emite
    db.businesses[0].whatsappIntegration = connectedBiz('b1').whatsappIntegration;
    db.automations.push(buildAutomation({ event: 'followup.due', steps: [{ kind: 'action', action: { type: 'create_task', params: { title: 'Follow-up' } } }] }));
    const r2 = scanBusinessOutreach(db, { businessId: 'b1', now: NOW });
    expect(r2.emitted).toBe(1);
  });

  // 9 — quiet hours: adia, não falha
  it('9 · quiet hours adia envio sem falhar', () => {
    const db = baseDb();
    const b = db.businesses[0];
    // 05:00 SP = quiet (antes das 09)
    const early = '2026-09-16T08:00:00.000Z';
    expect(isQuietHours(early, b)).toBe(true);
    const defer = deferUntilQuietEnd(early, b);
    expect(defer > early || defer.startsWith(TODAY)).toBe(true);
    // 09:00 SP = aberto qua 09–18
    expect(isQuietHours(NOW, b)).toBe(false);
    // 23:00 SP = quiet
    expect(isQuietHours('2026-09-17T02:00:00.000Z', b)).toBe(true);

    db.encounters.push(encounterDue());
    db.followUpRules.push(ruleReturn());
    db.automations.push(buildAutomation({ event: 'followup.due', steps: [{ kind: 'action', action: { type: 'create_task', params: { title: 'Follow-up' } } }] }));
    const r = scanBusinessOutreach(db, { businessId: 'b1', now: early });
    expect(r.emitted).toBe(0);
    expect(r.deferred).toBe(1);
    expect(db.followUpOutreach[0]?.status).toBe('ignorado');
    expect(db.followUpOutreach[0]?.nextAttemptAt).toBeTruthy();
    expect(db.followUpOutreach[0]?.statusLabel).toBe('Ignorado');
  });

  // 10 — mensagem sem motivo clínico; copy do briefing
  it('10 · mensagem de retorno: operacional, sem motivo clínico', () => {
    const msg = buildOutreachMessage({
      kind: 'return', patientName: 'Rafael', destName: 'Rafael',
      clinicName: 'Clínica Central', isVet: false,
    });
    expect(msg).toContain('retorno');
    expect(msg).toContain('Clínica Central');
    expect(msg).not.toMatch(/diagn[oó]stico|sintoma|rem[eé]dio|doen[çc]a|exame/i);
    const vet = buildOutreachMessage({
      kind: 'return', patientName: 'Rex', destName: 'Ana',
      clinicName: 'Vet Amor', isVet: true,
    });
    expect(vet).toContain('Rex'); // pet é o paciente
    expect(vet).toContain('Ana'); // destino é o tutor
  });

  // 11 — resposta sim → F3-E (sem booking direto); negativa → declined
  it('11 · resposta positiva marca respondido sem criar booking; negativa recusa', () => {
    const db = baseDb();
    const conv: Conversation = {
      id: 'cv-1', businessId: 'b1', contactId: 'ct-1', customerId: '',
      channel: 'whatsapp', phone: '11988887777', name: 'Rafael',
      status: 'open', mode: 'automation', unread: 1,
      lastMessageAt: NOW, lastMessagePreview: '',
      lastInboundAt: NOW, createdAt: NOW, updatedAt: NOW,
    } as Conversation;
    db.conversations.push(conv);
    db.followUpOutreach.push({
      id: 'o1', businessId: 'b1', kind: 'return', ruleId: 'rule-return',
      encounterId: 'enc-1', contactId: 'ct-1', dueDate: TODAY,
      idempotencyKey: outreachIdempotencyKey({ businessId: 'b1', kind: 'return', ruleId: 'rule-return', subjectId: 'enc-1', dueDate: TODAY }),
      status: 'mensagem_enviada', statusLabel: outreachStatusLabel('mensagem_enviada'),
      eventKey: outreachEventKey({ idempotencyKey: 'k', kind: 'return' }),
      phone: '11988887777', patientName: 'Rafael', destName: 'Rafael',
      origin: 'return', attempt: 1, nextAttemptAt: '',
      conversationId: 'cv-1', createdAt: NOW, updatedAt: NOW,
    });
    const bookingsBefore = db.bookings.length;
    const row = applyOutreachReply(db, { businessId: 'b1', conversationId: 'cv-1', body: 'sim, quero agendar', now: NOW });
    expect(row?.status).toBe('paciente_respondeu');
    expect(db.bookings.length).toBe(bookingsBefore); // NÃO cria booking direto (F3-E)

    // negativa em outro ciclo
    const row2 = applyOutreachReply(db, { businessId: 'b1', conversationId: 'cv-1', body: 'não quero mais', now: NOW });
    expect(row2?.status).toBe('recusado');
    expect(row2?.statusLabel).toBe('Recusado');
    expect(classifyOutreachReply('quero falar com alguém')).toBe('human');
    expect(classifyOutreachReply('sim')).toBe('positive');
    expect(classifyOutreachReply('não obrigado')).toBe('negative');
  });

  // 12 — status humanos + histórico + upcoming
  it('12 · status humanos sem eventId/payload; histórico e retorno previsto', () => {
    expect(FOLLOW_UP_OUTREACH_LABELS.programado).toBe('Retorno previsto');
    expect(FOLLOW_UP_OUTREACH_LABELS.aguardando_canal).toBe('Aguardando WhatsApp');
    expect(FOLLOW_UP_OUTREACH_LABELS.ignorado).toBe('Ignorado');
    // labels nunca expõem chaves técnicas
    for (const label of Object.values(FOLLOW_UP_OUTREACH_LABELS)) {
      expect(label).not.toMatch(/eventKey|webhook|runner|payload|timeout|retry/i);
    }

    const db = baseDb();
    db.followUpOutreach.push({
      id: 'o1', businessId: 'b1', kind: 'return', ruleId: 'rule-return',
      encounterId: 'enc-1', contactId: 'ct-1', petId: 'pet-1', dueDate: TODAY,
      idempotencyKey: 'k1', status: 'programado', statusLabel: 'Retorno previsto',
      eventKey: 'e1', phone: '11988887777', patientName: 'Rex', destName: 'Ana',
      origin: 'return', attempt: 0, nextAttemptAt: '',
      createdAt: NOW, updatedAt: NOW,
    });
    const hist = outreachHistory(db, 'b1', { petId: 'pet-1' });
    expect(hist[0]?.label).toBe('Retorno previsto');
    const up = upcomingReturnFor(db, 'b1', { petId: 'pet-1' });
    expect(up?.dueDate).toBe(TODAY);
    expect(up?.label).toBe('Retorno previsto');
  });
});

describe('F3-H · Reativação (13–20)', () => {
  // 13 — inativo por último completed ≥ delay
  it('13 · inativo por último atendimento CONCLUÍDO (≠ booking criado)', () => {
    const db = baseDb();
    db.followUpRules.push(ruleInactive('b1', 90));
    // completed há 100 dias
    db.bookings.push({
      id: 'bk-old', businessId: 'b1', date: '2026-06-08', status: 'completed',
      customerPhone: '11988887777', customerName: 'Rafael',
    } as Booking);
    // booking apenas criado (pending) recente NÃO é "atendimento"
    db.bookings.push({
      id: 'bk-pending', businessId: 'b1', date: '2026-09-10', status: 'pending',
      customerPhone: '11988887778', customerName: 'Outro',
    } as Booking);
    const cands = evaluateFollowUps({
      rules: [ruleInactive('b1', 90)], contacts: db.contacts, leads: db.leads,
      bookings: db.bookings, encounters: [], today: TODAY, now: NOW,
    });
    expect(cands.some((c) => c.contactId === 'ct-1')).toBe(true);
    expect(cands.some((c) => c.phone === '11988887778')).toBe(false);
  });

  // 14 — sem consentimento ⇒ skip
  it('14 · reativação sem acceptsPromotions/marketingOptIn ⇒ skipped_no_marketing_consent', () => {
    const db = baseDb();
    db.followUpRules.push(ruleInactive());
    const rev = revalidateOutreach({
      db, business: db.businesses[0], now: NOW,
      candidate: { ruleId: 'rule-inactive', trigger: 'inactive_patient', contactId: 'ct-1', name: 'Rafael', phone: '11988887777', dueAt: TODAY, context: '' },
    });
    expect(rev.ok).toBe(false);
    expect(rev.reason).toBe('skipped_no_marketing_consent');
  });

  // 15 — com consentimento emite patient.inactive
  it('15 · com consentimento emite patient.inactive 1×', () => {
    const db = baseDb();
    const c = db.contacts.find((x) => x.id === 'ct-1')!;
    c.marketingOptIn = true;
    db.bookings.push({
      id: 'bk-old', businessId: 'b1', date: '2026-06-08', status: 'completed',
      customerPhone: '11988887777', customerName: 'Rafael',
    } as Booking);
    db.followUpRules.push(ruleInactive());
    db.automations.push(buildAutomation({ event: 'patient.inactive', steps: [{ kind: 'action', action: { type: 'create_task', params: { title: 'Follow-up' } } }] }));
    const r1 = scanBusinessOutreach(db, { businessId: 'b1', now: NOW });
    expect(r1.emitted).toBe(1);
    const r2 = scanBusinessOutreach(db, { businessId: 'b1', now: NOW });
    expect(r2.emitted).toBe(0);
    const row = db.followUpOutreach.find((o) => o.businessId === 'b1');
    expect(row?.kind).toBe('reactivation');
    expect(row?.origin).toBe('reactivation');
  });

  // 16 — booking futuro ⇒ não reativar
  it('16 · booking futuro ⇒ não é inativo p/ reativação', () => {
    const db = baseDb();
    const c = db.contacts.find((x) => x.id === 'ct-1')!;
    c.marketingOptIn = true;
    db.bookings.push({
      id: 'bk-old', businessId: 'b1', date: '2026-06-08', status: 'completed',
      customerPhone: '11988887777', customerName: 'Rafael',
    } as Booking);
    db.bookings.push({
      id: 'bk-fut', businessId: 'b1', date: '2026-09-25', status: 'confirmed',
      customerPhone: '11988887777', customerName: 'Rafael',
    } as Booking);
    db.followUpRules.push(ruleInactive());
    // evaluateRule não gera candidato com booking futuro
    const cands = evaluateFollowUps({
      rules: [ruleInactive()], contacts: db.contacts, leads: [], bookings: db.bookings,
      encounters: [], today: TODAY, now: NOW,
    });
    expect(cands.some((c) => c.contactId === 'ct-1')).toBe(false);
    // e revalidação rejeita mesmo se um candidato chegar
    const rev = revalidateOutreach({
      db, business: db.businesses[0], now: NOW,
      candidate: { ruleId: 'rule-inactive', trigger: 'inactive_patient', contactId: 'ct-1', name: 'Rafael', phone: '11988887777', dueAt: TODAY, context: '' },
    });
    expect(rev.ok).toBe(false);
    expect(rev.reason).toBe('skipped_already_scheduled');
    const r = scanBusinessOutreach(db, { businessId: 'b1', now: NOW });
    expect(r.emitted).toBe(0);
  });

  // 17 — 30/60/90/180 delays aceitos
  it('17 · delay de reativação aceita 30/60/90/180 dias', () => {
    const db = baseDb();
    addContact(db, { id: 'ct-30', phone: '11911111111', name: 'A', marketingOptIn: true });
    addContact(db, { id: 'ct-60', phone: '11922222222', name: 'B', marketingOptIn: true });
    addContact(db, { id: 'ct-90', phone: '11933333333', name: 'C', marketingOptIn: true });
    addContact(db, { id: 'ct-180', phone: '11944444444', name: 'D', marketingOptIn: true });
    const pairs: Array<[string, string, string]> = [
      ['ct-30', '11911111111', '2026-08-10'],
      ['ct-60', '11922222222', '2026-07-10'],
      ['ct-90', '11933333333', '2026-06-15'],
      ['ct-180', '11944444444', '2026-03-20'],
    ];
    for (const [cid, phone, date] of pairs) {
      const contact = db.contacts.find((x) => x.id === cid)!;
      contact.marketingOptIn = true;
      db.bookings.push({
        id: `bk-${cid}`, businessId: 'b1', date, status: 'completed',
        customerPhone: phone, customerName: contact.name,
      } as Booking);
      const rule = ruleInactive('b1', Number(cid.split('-')[1]));
      const cands = evaluateRule(rule, {
        rules: [rule], contacts: db.contacts, leads: [], bookings: db.bookings, encounters: [],
        today: TODAY, now: NOW,
      });
      expect(cands.some((c) => c.contactId === cid)).toBe(true);
    }
  });

  // 18 — vet: paciente = PET, msg → tutor
  it('18 · vet: paciente é o PET; mensagem vai para o tutor', () => {
    const db = baseDb({ clinicType: 'veterinaria' });
    const pet: Pet = {
      id: 'pet-1', businessId: 'b1', tutorId: 'ct-1', name: 'Rex',
      species: 'Cão', breed: '', gender: 'M', birthDate: '',
      coat: '', weightKg: 0, active: true,
      photo: '', sex: 'male', notes: '',
      createdAt: NOW, updatedAt: NOW,
    } as unknown as Pet;
    db.pets.push(pet);
    db.encounters.push(encounterDue({ petId: 'pet-1', customerName: 'Ana' }));
    const rev = revalidateOutreach({
      db, business: db.businesses[0], now: NOW,
      candidate: { ruleId: 'rule-return', trigger: 'return_due', contactId: 'ct-1', encounterId: 'enc-1', name: 'Ana', phone: '', dueAt: TODAY, context: '' },
    });
    expect(rev.ok).toBe(true);
    expect(rev.patientName).toBe('Rex');
    // destino = tutor (nome do contato CRM)
    expect(rev.destName).toBe('Rafael');
    expect(rev.destName).not.toBe(rev.patientName);
    expect(rev.petId).toBe('pet-1');
    const msg = buildOutreachMessage({
      kind: 'return', patientName: rev.patientName, destName: rev.destName,
      clinicName: 'Vet', isVet: true,
    });
    expect(msg).toContain('Rex');
    expect(msg).toContain('Rafael');
  });

  // 19 — MessagingService idempotencyKey não reenvia
  it('19 · sendConversationMessage com idempotencyKey não cria 2ª Message', async () => {
    const db = baseDb();
    db.conversations.push({
      id: 'cv-1', businessId: 'b1', contactId: 'ct-1', customerId: '',
      channel: 'whatsapp', phone: '11988887777', name: 'Rafael',
      status: 'open', mode: 'automation', unread: 0,
      lastMessageAt: NOW, lastMessagePreview: '', lastInboundAt: NOW,
      createdAt: NOW, updatedAt: NOW,
    } as Conversation);
    const input = {
      businessId: 'b1', conversationId: 'cv-1', body: 'Olá. Retorno?',
      by: 'automation' as const, byName: 'Automação', useSimulator: true,
      idempotencyKey: 'followup:b1:return:r:e:TODAY',
      at: NOW,
    };
    const out1 = await sendConversationMessage(db, input);
    expect(out1.ok).toBe(true);
    const count1 = db.messages.filter((m) => m.conversationId === 'cv-1').length;
    const out2 = await sendConversationMessage(db, input);
    expect(out2.ok).toBe(true);
    const count2 = db.messages.filter((m) => m.conversationId === 'cv-1').length;
    expect(count2).toBe(count1); // retry ≠ 2º envio
    expect(out2.messageId).toBe(out1.messageId);
  });

  // 20 — triggerSource no run + marketing vs operacional
  it('20 · run grava triggerSource; reativação=marketing, retorno=operacional', () => {
    const db = baseDb();
    const c = db.contacts.find((x) => x.id === 'ct-1')!;
    c.marketingOptIn = true;
    db.bookings.push({
      id: 'bk-old', businessId: 'b1', date: '2026-06-08', status: 'completed',
      customerPhone: '11988887777', customerName: 'Rafael',
    } as Booking);
    db.followUpRules.push(ruleInactive());
    db.automations.push(buildAutomation({ event: 'patient.inactive', steps: [{ kind: 'action', action: { type: 'create_task', params: { title: 'Follow-up' } } }] }));
    scanBusinessOutreach(db, { businessId: 'b1', now: NOW });
    const runs = db.automationRuns.filter((r) => r.businessId === 'b1');
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs.some((r) => r.triggerSource === 'reactivation')).toBe(true);

    // retorno: copy operacional (não marketing copy "promoção/oferta")
    const retMsg = buildOutreachMessage({
      kind: 'return', patientName: 'R', destName: 'R', clinicName: 'C', isVet: false,
    });
    expect(retMsg).not.toMatch(/promo[çc][ãa]o|oferta|desconto|campanha/i);
    const reMsg = buildOutreachMessage({
      kind: 'reactivation', patientName: 'R', destName: 'R', clinicName: 'C', isVet: false,
    });
    expect(reMsg).toContain('Faz um tempo');
  });
});
