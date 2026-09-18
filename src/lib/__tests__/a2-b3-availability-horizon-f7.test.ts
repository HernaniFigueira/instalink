// ═══════════════════════════════════════════════════════════════
// A2-B3 — F4 (fechado ≠ lotado) · F5 (horizonte) · F7 (bugs pequenos)
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { computeSlots, dayAvailability, dayAvailabilityMessage, type SlotQuery } from '../slots';
import { effectiveHorizonDays } from '../booking-ops';
import { applyBookingStatusTx } from '../booking-status';
import { validateAvailabilityException } from '../hours';
import { noteLeadReschedule } from '../pipeline';
import { emptyDB } from '../db';
import type { Availability, AvailabilityException, Booking, Business, Service } from '../types';

const TODAY = '2026-09-16'; // quarta
const FUTURE = '2026-09-21'; // segunda

function svc(durationMin = 30): Service {
  return {
    id: 's1', businessId: 'b1', categoryId: '', name: 'Corte', description: '', image: '',
    price: 0, durationMin, professionalIds: [], active: true, featured: false, bookable: true, questions: [],
  };
}

function rule(weekday: number, start = '09:00', end = '18:00'): Availability {
  return { id: `av-${weekday}`, businessId: 'b1', professionalId: '', serviceId: '', weekday, start, end, slotMin: 30 };
}

function bookingAt(date: string, time: string, extra: Partial<Booking> = {}): Booking {
  return {
    id: `bk-${date}-${time}`, businessId: 'b1', customerId: '', serviceId: 's1',
    professionalId: '', date, time, customerName: 'X', customerPhone: '11900000000',
    status: 'confirmed', note: '', answers: [], createdAt: '', updatedAt: '', history: [],
    ...extra,
  };
}

// Grade completa de um dia 09:00–18:00 com slot de 30min (18 horários).
const ALL_SLOTS: string[] = [];
for (let m = 9 * 60; m + 30 <= 18 * 60; m += 30) {
  ALL_SLOTS.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
}

function q(overrides: Partial<SlotQuery> = {}): SlotQuery {
  return {
    rules: [rule(1)],
    exceptions: [],
    bookings: [],
    services: [svc()],
    professionals: [],
    dateISO: FUTURE,
    weekday: 1,
    serviceId: 's1',
    durationMin: 30,
    professionalId: '',
    eligibleProIds: [],
    nowHM: '',
    leadMin: 0,
    bufferMin: 0,
    ...overrides,
  };
}

// ── F4: fechado ≠ lotado ≠ disponível ────────────────────────────
describe('A2-B3 · F4 — dayAvailability (fechado × lotado × livre)', () => {
  it('dia com horários livres → open', () => {
    const d = dayAvailability(q());
    expect(d.state).toBe('open');
    expect(d.closed).toBe(false);
    expect(d.full).toBe(false);
    expect(d.free).toBeGreaterThan(0);
  });

  it('dia aberto com TODOS os horários ocupados → full (não "closed")', () => {
    const d = dayAvailability(q({
      bookings: ALL_SLOTS.map((t) => bookingAt(FUTURE, t)),
    }));
    expect(d.state).toBe('full');
    expect(d.closed).toBe(false); // não é fechado: está aberto e lotado
    expect(d.full).toBe(true);
    expect(d.free).toBe(0);
    expect(dayAvailabilityMessage(d)).toContain('ocupados');
  });

  it('exceção fechando o dia → closed/exception', () => {
    const exc: AvailabilityException = { id: 'e1', businessId: 'b1', date: FUTURE, closed: true, start: '', end: '', note: 'Natal' };
    const d = dayAvailability(q({ exceptions: [exc] }));
    expect(d.state).toBe('closed');
    expect(d.reason).toBe('exception');
    expect(dayAvailabilityMessage(d)).toContain('Fechado');
  });

  it('dia da semana sem regra → closed/no_windows', () => {
    const d = dayAvailability(q({ weekday: 0, dateISO: '2026-09-20', rules: [rule(1)] })); // domingo sem regra
    expect(d.state).toBe('closed');
    expect(d.reason).toBe('no_windows');
  });

  it('hoje com janela encerrada pelo lead time → sem mentir "fechado" (ended)', () => {
    const d = dayAvailability(q({ dateISO: TODAY, weekday: 3, rules: [rule(3)], nowHM: '17:30', leadMin: 60 }));
    expect(d.reason).toBe('ended');
    expect(dayAvailabilityMessage(d)).toContain('encerraram');
  });

  it('dia passado → past', () => {
    const d = dayAvailability(q({ dateISO: '2026-09-14' }), { today: TODAY });
    expect(d.state).toBe('past');
    expect(d.closed).toBe(true);
  });

  it('janela curta demais para o serviço → no_fit (não "open", não "full")', () => {
    const d = dayAvailability(q({ rules: [rule(1, '09:00', '09:20')], durationMin: 30 })); // serviço 30min > janela 20min
    expect(d.state).toBe('closed');
    expect(d.reason).toBe('no_fit');
  });

  it('computeSlots continua compatível (closed quando sem slots) + closedReason explicíto', () => {
    const r = computeSlots(q({ bookings: ALL_SLOTS.map((t) => bookingAt(FUTURE, t)) }));
    expect(r.closed).toBe(true);
    expect(r.closedReason).toBe('none'); // janelas existiam; motivo fino fica no dayAvailability
    const rOpen = computeSlots(q());
    expect(rOpen.closed).toBe(false);
    expect(rOpen.closedReason).toBeUndefined();
  });
});

// ── F5: horizonte efetivo (uma regra, 1–365) ─────────────────────
describe('A2-B3 · F5 — effectiveHorizonDays', () => {
  it('configuração ausente → default 60', () => {
    expect(effectiveHorizonDays(undefined)).toBe(60);
    expect(effectiveHorizonDays(null)).toBe(60);
    expect(effectiveHorizonDays({})).toBe(60);
  });
  it('respeita valor menor (negócio com janela curta)', () => {
    expect(effectiveHorizonDays({ horizonDays: 7 })).toBe(7);
    expect(effectiveHorizonDays({ horizonDays: 1 })).toBe(1);
  });
  it('respeita valor maior (sem teto 90/60 disfarçado)', () => {
    expect(effectiveHorizonDays({ horizonDays: 200 })).toBe(200);
    expect(effectiveHorizonDays({ horizonDays: 365 })).toBe(365);
  });
  it('fora da faixa aceita pelo servidor → cai no default/clamp', () => {
    expect(effectiveHorizonDays({ horizonDays: 0 })).toBe(60);
    expect(effectiveHorizonDays({ horizonDays: -5 })).toBe(60);
    expect(effectiveHorizonDays({ horizonDays: 9999 })).toBe(365); // clamp máximo
    expect(effectiveHorizonDays({ horizonDays: 12.7 })).toBe(13); // arredonda
  });
});

// ── F7.1: transição sem mudança real = no-op idempotente ─────────
function bizRow(): Business {
  return {
    id: 'b1', ownerId: 'o', organizationId: 'org', name: 'B1', slug: 'b1', description: '',
    logo: '', cover: '', niche: 'servicos', modes: ['services', 'bookings'], phone: '', whatsapp: '',
    email: '', instagram: '', tiktok: '', address: '', mapsUrl: '', hours: {}, paymentMethods: [],
    pixKey: '', deliveryFee: 0, minOrder: 0, googleUrl: '', googlePlaceId: '', googleApiKey: '',
    booking: { teamMode: 'solo', leadMin: 0, cancelUntilMin: 60, horizonDays: 60, bufferMin: 0 },
    nav: [], navCustom: false, about: { title: '', text: '', image: '', enabled: false },
    published: true, createdAt: '', updatedAt: '',
  };
}

describe('A2-B3 · F7.1 — applyBookingStatusTx no-op', () => {
  function dbWithBooking(): { db: ReturnType<typeof emptyDB>; bookingId: string } {
    const d = emptyDB();
    d.businesses.push(bizRow());
    d.services.push(svc());
    d.bookings.push({
      id: 'bk1', businessId: 'b1', customerId: '', serviceId: 's1', professionalId: '',
      date: FUTURE, time: '09:00', customerName: 'Ana', customerPhone: '11988887777',
      status: 'pending', note: '', answers: [],
      createdAt: '2026-09-16T10:00:00.000Z', updatedAt: '2026-09-16T10:00:00.000Z',
      history: [{ at: '2026-09-16T10:00:00.000Z', from: '', to: 'pending', by: 'customer' }],
    });
    return { db: d, bookingId: 'bk1' };
  }

  it('pending → pending: ok SEM nova entrada de histórico e SEM mexer em updatedAt', () => {
    const { db: d, bookingId } = dbWithBooking();
    const before = d.bookings[0];
    const res = applyBookingStatusTx(d, { businessId: 'b1', bookingId, to: 'pending', by: 'owner', note: 'clique duplo' });
    expect(res.ok).toBe(true);
    expect(res.status).toBe('pending');
    expect(before.history.length).toBe(1); // nada de entrada redundante
    expect(before.updatedAt).toBe('2026-09-16T10:00:00.000Z');
  });

  it('confirmed → confirmed: não re-enfileira mensagem de confirmação (P3 idempotente)', () => {
    const { db: d, bookingId } = dbWithBooking();
    const first = applyBookingStatusTx(d, { businessId: 'b1', bookingId, to: 'confirmed', by: 'owner' });
    expect(first.ok).toBe(true);
    const messagesAfterFirst = d.messages.length;
    expect(messagesAfterFirst).toBeGreaterThan(0); // confirmação enfileirada UMA vez
    const again = applyBookingStatusTx(d, { businessId: 'b1', bookingId, to: 'confirmed', by: 'owner' });
    expect(again.ok).toBe(true);
    expect(d.messages.length).toBe(messagesAfterFirst); // nada duplicado
    expect(d.bookings[0].history.filter((h) => h.to === 'confirmed').length).toBe(1);
  });

  it('transição real continua gravando histórico (pending → confirmed)', () => {
    const { db: d, bookingId } = dbWithBooking();
    applyBookingStatusTx(d, { businessId: 'b1', bookingId, to: 'confirmed', by: 'owner', note: 'confirmação da equipe' });
    const hist = d.bookings[0].history;
    expect(hist.length).toBe(2);
    expect(hist[1]).toMatchObject({ from: 'pending', to: 'confirmed', by: 'owner', note: 'confirmação da equipe' });
  });
});

// ── F7.2: nota da esteira acompanha o reagendamento ──────────────
describe('A2-B3 · F7.2 — noteLeadReschedule', () => {
  function dbWithLead() {
    const d = emptyDB();
    d.businesses.push(bizRow());
    d.leads.push({
      id: 'l1', businessId: 'b1', customerId: '', name: 'Ana', phone: '11988887777',
      email: '', instagram: '', origin: 'agendamento', interest: '', action: 'agendamento',
      status: 'converted', stageId: 'scheduled', assignedUserId: '', priority: 'medium', nextAction: '',
      serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [{ id: 'h1', fromStage: 'new', toStage: 'scheduled', movedBy: 'customer', movedByName: 'Agendamento', at: '', note: 'Agendado para 2026-09-21 às 09:00' }],
      createdAt: '', lastInteraction: '', bookingId: 'bk1',
    });
    return d;
  }

  it('acrescenta nota de reagendamento SEM mudar de etapa (padrão assignLead)', () => {
    const d = dbWithLead();
    noteLeadReschedule(d, {
      businessId: 'b1', leadId: 'l1',
      from: { date: '2026-09-21', time: '09:00' }, to: { date: '2026-09-25', time: '14:00' },
      by: 'owner', now: '2026-09-16T12:00:00.000Z',
    });
    const hist = d.leads[0].stageHistory!;
    expect(hist.length).toBe(2);
    expect(hist[1].fromStage).toBe('scheduled');
    expect(hist[1].toStage).toBe('scheduled'); // sem movimento de etapa
    expect(hist[1].note).toContain('Reagendado de 21/09 09:00 para 25/09 14:00');
    expect(hist[0].note).toContain('2026-09-21'); // histórico anterior intacto (append-only)
  });

  it('sem leadId (booking sem vínculo) → no-op seguro', () => {
    const d = dbWithLead();
    const before = JSON.stringify(d.leads[0]);
    noteLeadReschedule(d, {
      businessId: 'b1', leadId: undefined,
      from: { date: '2026-09-21', time: '09:00' }, to: { date: '2026-09-25', time: '14:00' },
      by: 'customer',
    });
    expect(JSON.stringify(d.leads[0])).toBe(before);
  });

  it('isolamento: lead de outro tenant não é tocado', () => {
    const d = emptyDB();
    d.businesses.push(bizRow(), { ...bizRow(), id: 'b2', slug: 'b2' });
    d.leads.push({
      id: 'l-b2', businessId: 'b2', customerId: '', name: 'De Outro', phone: '11977770000',
      email: '', instagram: '', origin: '', interest: '', action: 'contato',
      status: 'new', stageId: 'new', assignedUserId: '', priority: 'medium', nextAction: '',
      serviceId: '', professionalId: '', sourceUrl: '', metadata: {}, notes: [],
      stageHistory: [], createdAt: '', lastInteraction: '',
    });
    noteLeadReschedule(d, {
      businessId: 'b1', leadId: 'l-b2',
      from: { date: '2026-09-21', time: '09:00' }, to: { date: '2026-09-25', time: '14:00' },
      by: 'owner',
    });
    expect(d.leads[0].stageHistory!.length).toBe(0);
  });
});

// ── F7.4/F7.5: exceção só é gravada com efeito real ──────────────
describe('A2-B3 · F7.4/F7.5 — validateAvailabilityException', () => {
  const ctx = { today: TODAY, rules: [rule(1, '09:00', '18:00')] };

  it('data passada é recusada (exceção sem efeito)', () => {
    const r = validateAvailabilityException({ date: '2026-09-14', closed: true, start: '', end: '' }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('passada');
  });

  it('horário especial com fim antes do início é recusado', () => {
    const r = validateAvailabilityException({ date: FUTURE, closed: false, start: '14:00', end: '09:00' }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('fim');
  });

  it('horário especial sem janela é recusado (nem fechado nem horário = nada)', () => {
    const r = validateAvailabilityException({ date: FUTURE, closed: false, start: '', end: '' }, ctx);
    expect(r.ok).toBe(false);
  });

  it('horário especial que não intersecta nenhuma regra do dia é recusado', () => {
    // segunda tem regra 09:00–18:00; 20:00–22:00 não afeta nada
    const r = validateAvailabilityException({ date: FUTURE, closed: false, start: '20:00', end: '22:00' }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('não afeta');
  });

  it('exceção válida: dia fechado no futuro', () => {
    expect(validateAvailabilityException({ date: FUTURE, closed: true, start: '', end: '' }, ctx).ok).toBe(true);
  });

  it('exceção válida: horário especial intersecta a regra do dia', () => {
    expect(validateAvailabilityException({ date: FUTURE, closed: false, start: '10:00', end: '12:00' }, ctx).ok).toBe(true);
    // interseção parcial também vale (a exceção restringe parte da janela)
    expect(validateAvailabilityException({ date: FUTURE, closed: false, start: '17:00', end: '19:00' }, ctx).ok).toBe(true);
  });

  it('data inválida continua recusada', () => {
    expect(validateAvailabilityException({ date: '21/09/2026', closed: true, start: '', end: '' }, ctx).ok).toBe(false);
  });
});
