// ═══════════════════════════════════════════════════════════════
// A2-B5 — F9 (fuso por negócio) · F3 ("Aberto agora" = fonte da Agenda)
// ═══════════════════════════════════════════════════════════════
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TIMEZONE, effectiveTimezone, isValidTimezone, nowHM, todayISO, addDaysISO, weekdayOf,
} from '../tz';
import { getBusinessOpenStatus, scheduleSummary } from '../hours';
import { validateAvailabilityException } from '../hours';
import { createBookingTx } from '../booking-create';
import { emptyDB } from '../db';
import { biz as fixtureBiz, service as fixtureService, FIXED_NOW } from './helpers/automation-fixtures';
import type { Availability, AvailabilityException, Business } from '../types';

// ── F9: fuso efetivo e fallback seguro ──────────────────────────
describe('A2-B5 · F9 — effectiveTimezone/isValidTimezone', () => {
  it('default do produto é America/Sao_Paulo', () => {
    expect(DEFAULT_TIMEZONE).toBe('America/Sao_Paulo');
    expect(effectiveTimezone(undefined)).toBe('America/Sao_Paulo');
    expect(effectiveTimezone('')).toBe('America/Sao_Paulo');
    expect(effectiveTimezone(null)).toBe('America/Sao_Paulo');
  });
  it('fuso inválido cai no fallback (nunca quebra a agenda)', () => {
    expect(isValidTimezone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimezone('Atlantic/Atlantida')).toBe(false);
    expect(isValidTimezone('Nao/Eh-Fuso;;')).toBe(false);
    expect(effectiveTimezone('Nao/Eh-Fuso;;')).toBe('America/Sao_Paulo');
  });
  it('fuso válido configurado vence', () => {
    expect(effectiveTimezone('America/New_York')).toBe('America/New_York');
  });
});

// ── F9: "hoje" muda conforme o fuso (transição de data) ─────────
describe('A2-B5 · F9 — todayISO/nowHM por fuso (perto da meia-noite)', () => {
  it('22:00 em São Paulo ainda é o mesmo dia em SP, mas já é amanhã em Sydney', () => {
    // 2026-09-16 22:00 em SP = 2026-09-17 11:00 em Sydney (AEST, UTC+10)
    const at = new Date('2026-09-17T01:00:00.000Z'); // = 22:00-03:00 SP = 11:00 Sydney
    expect(todayISO(at, 'America/Sao_Paulo')).toBe('2026-09-16');
    expect(todayISO(at, 'Australia/Sydney')).toBe('2026-09-17');
    expect(todayISO(at)).toBe('2026-09-16'); // default do produto
  });
  it('01:00 em SP já é "hoje" novo em SP, mas ainda "ontem" em Los Angeles', () => {
    const at = new Date('2026-09-16T04:00:00.000Z'); // 01:00 SP · 21:00 LA (PDT, UTC-7) do dia 15
    expect(todayISO(at, 'America/Sao_Paulo')).toBe('2026-09-16');
    expect(todayISO(at, 'America/Los_Angeles')).toBe('2026-09-15');
    expect(nowHM(at, 'America/Los_Angeles')).toBe('21:00');
    expect(nowHM(at, 'America/Sao_Paulo')).toBe('01:00');
  });
  it('weekday acompanha o fuso', () => {
    const at = new Date('2026-09-16T04:00:00.000Z'); // quarta em SP, terça em LA
    expect(weekdayOf(todayISO(at, 'America/Sao_Paulo'))).toBe(3);
    expect(weekdayOf(todayISO(at, 'America/Los_Angeles'))).toBe(2);
  });
});

// ── F9: createBookingTx no fuso do negócio (passado/horizonte) ──
function bizWithTz(tz?: string): Business {
  const b = fixtureBiz('b1', { published: true });
  if (tz === undefined) return b; // sem campo (legado)
  return { ...b, businessTimezone: tz };
}

describe('A2-B5 · F9 — createBookingTx no fuso do negócio', () => {
  function dbFor(b: Business) {
    const d = emptyDB();
    d.businesses.push(b);
    d.services.push(fixtureService('s1', 'b1', { durationMin: 30, professionalIds: [] }));
    d.availability.push({
      id: 'av1', businessId: 'b1', professionalId: '', serviceId: '',
      weekday: 0, start: '00:00', end: '23:59', slotMin: 30,
    } as Availability);
    d.availability.push({
      id: 'av2', businessId: 'b1', professionalId: '', serviceId: '',
      weekday: 1, start: '00:00', end: '23:59', slotMin: 30,
    } as Availability);
    d.availability.push({
      id: 'av3', businessId: 'b1', professionalId: '', serviceId: '',
      weekday: 2, start: '00:00', end: '23:59', slotMin: 30,
    } as Availability);
    d.availability.push({
      id: 'av4', businessId: 'b1', professionalId: '', serviceId: '',
      weekday: 6, start: '00:00', end: '23:59', slotMin: 30,
    } as Availability);
    return d;
  }

  // Relógio CONGELADO: 04:00Z de 16/09 = 01:00 de 16/09 em SP · 21:00 de
  // 15/09 em LA. O corte do passado usa o fuso do NEGÓCIO:
  //   LA  → 15/09 23:00 é FUTURO (22h para o atendimento);
  //   SP  → 15/09 é PASSADO (já virou 16/09).
  afterEach(() => { vi.useRealTimers(); });

  it('mesma data/hora: futuro para o negócio em LA, passado para SP', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T04:00:00.000Z'));
    const dLA = dbFor(bizWithTz('America/Los_Angeles'));
    const resLA = createBookingTx(dLA, {
      business: dLA.businesses[0], service: dLA.services[0],
      date: '2026-09-15', time: '23:00',
      actor: 'owner', customer: { id: '', name: 'Ana', phone: '11988887777' },
    });
    expect(resLA.bookingId).toBeTruthy(); // LA: 15/09 23:00 é futuro (21:00 de 15/09)

    const dSP = dbFor(bizWithTz('America/Sao_Paulo'));
    expect(() => createBookingTx(dSP, {
      business: dSP.businesses[0], service: dSP.services[0],
      date: '2026-09-15', time: '23:00',
      actor: 'owner', customer: { id: '', name: 'Ana', phone: '11988887777' },
    })).toThrow('passado'); // SP: 15/09 já virou ontem (01:00 de 16/09)
  });

  it('legado sem campo (undefined) = São Paulo (sem migração destrutiva)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T04:00:00.000Z'));
    const d = dbFor(bizWithTz(undefined));
    expect(() => createBookingTx(d, {
      business: d.businesses[0], service: d.services[0],
      date: '2026-09-15', time: '23:00',
      actor: 'owner', customer: { id: '', name: 'Ana', phone: '11988887777' },
    })).toThrow('passado'); // default do produto: SP
    expect(effectiveTimezone(d.businesses[0].businessTimezone)).toBe('America/Sao_Paulo');
  });
});

// ── F3: "Aberto agora" pela MESMA fonte da Agenda ───────────────
const RULES_1 = (start = '09:00', end = '18:00'): Availability[] => (
  [1, 2, 3, 4, 5].map((wd) => ({
    id: `av${wd}`, businessId: 'b1', professionalId: '', serviceId: '',
    weekday: wd, start, end, slotMin: 30,
  } as Availability))
);

describe('A2-B5 · F3 — getBusinessOpenStatus (Availability + exceptions)', () => {
  const hoursLegacy = { '1': { open: '08:00', close: '18:00' } };

  it('aberto: regra da Agenda manda (Business.hours é ignorado como regra)', () => {
    const b = { ...bizWithTz(), hours: hoursLegacy }; // horas legadas dizem 08:00–18:00
    // 12:00 de segunda (SP) = 2026-09-14T15:00Z · Agenda diz 09:00–18:00
    const st = getBusinessOpenStatus(b, RULES_1(), [], new Date('2026-09-14T15:00:00.000Z'));
    expect(st?.open).toBe(true);
    expect(st?.label).toContain('até 18:00');
  });

  it('fechado antes de abrir: mostra a ABERTURA da Agenda, não a do hours', () => {
    const b = { ...bizWithTz(), hours: hoursLegacy }; // legado diz 08:00
    // 08:30 de segunda: legado diria "aberto"; a Agenda abre 09:00.
    const st = getBusinessOpenStatus(b, RULES_1(), [], new Date('2026-09-14T11:30:00.000Z'));
    expect(st?.open).toBe(false);
    expect(st?.label).toBe('Fechado · abre hoje às 09:00');
  });

  it('exceção fechando HOJE: folga honesta + próxima abertura', () => {
    const b = bizWithTz(); // segunda 2026-09-14
    const exc: AvailabilityException[] = [{ id: 'e1', businessId: 'b1', date: '2026-09-14', closed: true, start: '', end: '', note: 'manutenção' }];
    const st = getBusinessOpenStatus(b, RULES_1(), exc, new Date('2026-09-14T15:00:00.000Z'));
    expect(st?.open).toBe(false);
    expect(st?.label).toBe('Fechado · abre amanhã às 09:00');
  });

  it('exceção com horário especial restringe a janela do dia', () => {
    const b = bizWithTz();
    const exc: AvailabilityException[] = [{ id: 'e2', businessId: 'b1', date: '2026-09-14', closed: false, start: '10:00', end: '12:00', note: '' }];
    // 11:30 de segunda: dentro do especial 10–12
    const open = getBusinessOpenStatus(b, RULES_1(), exc, new Date('2026-09-14T14:30:00.000Z'));
    expect(open?.open).toBe(true);
    expect(open?.label).toContain('até 12:00');
    // 14:30: depois do especial fechou
    const after = getBusinessOpenStatus(b, RULES_1(), exc, new Date('2026-09-14T17:30:00.000Z'));
    expect(after?.open).toBe(false);
    expect(after?.label).toBe('Fechado · abre amanhã às 09:00');
  });

  it('sem regras: fallback legado ao horário CADASTRADO (documentado)', () => {
    const b = { ...bizWithTz(), hours: hoursLegacy };
    const st = getBusinessOpenStatus(b, [], [], new Date('2026-09-14T15:00:00.000Z')); // 12:00 SP seg
    expect(st?.open).toBe(true); // legado 08:00–18:00
    expect(st?.label).toContain('até 18:00');
  });

  it('sem regras e sem hours: null (sem chip por achismo)', () => {
    const b = { ...bizWithTz(), hours: {} }; // fixture tem hours; zera p/ o caso
    expect(getBusinessOpenStatus(b, [], [], new Date())).toBeNull();
  });

  it('fuso do negócio decide o "agora" (LA: ainda aberto quando SP já fechou)', () => {
    const bLA = bizWithTz('America/Los_Angeles');
    // 2026-09-15T00:30Z = 21:30 de terça em LA (aberto até 22:00 p/ teste) · 21:30 SP tb terça
    const b = { ...bLA };
    const rules = RULES_1('09:00', '22:00');
    const at = new Date('2026-09-15T21:30:00.000Z'); // 18:30 SP · 14:30 LA
    const stSP = getBusinessOpenStatus({ ...bizWithTz('America/Sao_Paulo') }, rules, [], at);
    const stLA = getBusinessOpenStatus(b, rules, [], new Date('2026-09-16T01:30:00.000Z')); // 22:30 SP (fechou) · 18:30 LA (aberto)
    expect(stSP?.open).toBe(true);
    expect(stLA?.open).toBe(true); // LA ainda aberto no SEU fuso
    // agora o mesmo instante para o negócio em SP:
    const st = getBusinessOpenStatus({ ...bizWithTz('America/Sao_Paulo') }, rules, [], new Date('2026-09-16T01:30:00.000Z'));
    expect(st?.open).toBe(false); // 22:30 SP: fechado
  });
});

// ── F3: resumo de horário (agente/concierge) pela Agenda ────────
describe('A2-B5 · F3 — scheduleSummary', () => {
  it('regras da Agenda vencem o horário cadastrado', () => {
    const b = { hours: { '1': { open: '07:00', close: '20:00' } } };
    const txt = scheduleSummary(b, RULES_1());
    expect(txt).toContain('Seg 09:00–18:00');
    expect(txt).not.toContain('07:00');
    expect(txt).not.toContain('20:00');
  });
  it('sem regras: mostra o horário cadastrado (legado, só exibição)', () => {
    const b = { hours: { '1': { open: '07:00', close: '20:00' } } };
    expect(scheduleSummary(b, [])).toBe('Seg 07:00–20:00');
  });
});

// ── F9: exceção validada no fuso do negócio ─────────────────────
describe('A2-B5 · F9 — validateAvailabilityException usa o fuso do negócio', () => {
  it('data passada EM LOS ANGELES ainda é hoje em SP: cabe ao chamado passar o today certo', () => {
    const ctxLA = { today: '2026-09-15', rules: RULES_1() };
    const okLA = validateAvailabilityException({ date: '2026-09-15', closed: true, start: '', end: '' }, ctxLA);
    expect(okLA.ok).toBe(true); // 15/09 ainda é "hoje" em LA
    const ctxSP = { today: '2026-09-16', rules: RULES_1() };
    const rSP = validateAvailabilityException({ date: '2026-09-15', closed: true, start: '', end: '' }, ctxSP);
    expect(rSP.ok).toBe(false); // 15/09 já é passado em SP
  });
});

// ── F9: timezone com DST não desloca a lista de dias (addDaysISO) ──
describe('A2-B5 · F9 — lista de dias sem drift de 24h', () => {
  it('addDaysISO cruza virada de DST (SP não tem; NY tem) sem pular dia', () => {
    // Período do DST nos EUA em 2026: 01/11. 31/10 + 1 = 01/11 (não 01/11 01:00)
    expect(addDaysISO('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDaysISO('2026-10-31', 2)).toBe('2026-11-02');
    expect(todayISO(new Date('2026-11-01T05:30:00.000Z'), 'America/New_York')).toBe('2026-11-01'); // 01:30 EDT
    expect(todayISO(new Date('2026-11-01T06:30:00.000Z'), 'America/New_York')).toBe('2026-11-01'); // 01:30 EST (voltou)
  });
});
