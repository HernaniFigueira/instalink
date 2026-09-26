// ═══════════════════════════════════════════════════════════════
// F3-B — RECEITAS PRONTAS, ESPERA RELATIVA, STATUS draft/active
// ═══════════════════════════════════════════════════════════════
import { describe, expect, it } from 'vitest';
import { automationFixtures } from './helpers/automation-fixtures';
import {
  automationStatusOf, resolveBookingOffsetWait, resolveWait,
} from '../automation/model';
import {
  AUTOMATION_TEMPLATES, applyTemplate, templateOffers,
} from '../automation/templates';
import { ADVANCED_LIMITS } from '../automation/capabilities';

const FIXED = new Date('2026-09-16T12:00:00');

function dbOf() {
  return automationFixtures();
}

describe('F3-B — receitas prontas', () => {
  it('catálogo cobre as receitas do briefing', () => {
    const ids = AUTOMATION_TEMPLATES.map((t) => t.id);
    expect(ids.length).toBeGreaterThanOrEqual(12);
    const required = [
      'booking_confirm_24h', 'booking_reminder_2h', 'booking_created_msg',
      'booking_rescheduled_msg', 'booking_no_show_recovery', 'booking_completed_thanks',
      'booking_review_request', 'followup_return_msg', 'patient_inactive_reengage',
      'lead_created_welcome', 'lead_followup_no_booking', 'booking_cancelled_msg',
    ];
    for (const id of required) expect(ids, `falta ${id}`).toContain(id);
    const receitas = AUTOMATION_TEMPLATES.filter((t) => t.tags.includes('Receita'));
    expect(receitas.length).toBeGreaterThanOrEqual(10);
  });

  it('toda receita vira automação válida como rascunho (nunca auto-ativa)', () => {
    const db = dbOf();
    for (const t of AUTOMATION_TEMPLATES) {
      const applied = applyTemplate(db, 'b1', t.id, { userId: 'u1' });
      expect(applied.ok, `${t.id}: ${applied.errors.join('; ')}`).toBe(true);
      expect(applied.automation.active, t.id).toBe(false);
      expect(applied.automation.status, t.id).toBe('draft');
      expect(applied.automation.source, t.id).toBe('template');
      expect(applied.automation.templateId).toBe(t.id);
    }
    const on = applyTemplate(db, 'b1', 'booking_created_task', { active: true });
    expect(on.ok).toBe(true);
    expect(on.automation.active).toBe(true);
    expect(on.automation.status).toBe('active');
  });

  it('galeria expõe receitas com preview da espera relativa', () => {
    const db = dbOf();
    const offers = templateOffers(db, 'b1');
    expect(offers.length).toBe(AUTOMATION_TEMPLATES.length);
    const conf = offers.find((o) => o.id === 'booking_confirm_24h')!;
    expect(conf.preview.thens.join(' ')).toMatch(/1 dia|24 horas/i);
    expect(conf.applicable).toBe(true);
  });

  it('aniversário: sem evento no Event Layer — receita ausente (honesto)', () => {
    expect(
      AUTOMATION_TEMPLATES.some((t) => t.id.includes('birthday') || t.id.includes('anivers')),
    ).toBe(false);
  });
});

describe('F3-B — espera relativa ao agendamento', () => {
  it('24 h antes resolve alvo a partir do booking vivo', () => {
    const res = resolveBookingOffsetWait(
      { mode: 'booking_offset', offsetMinutes: -1440 },
      FIXED, ADVANCED_LIMITS,
      { booking: { date: '2026-09-20', time: '10:00' } },
    );
    expect(res.ok).toBe(true);
    expect(Date.parse(res.resumeAt)).toBe(Date.parse('2026-09-19T10:00'));
    expect(res.label).toContain('antes do agendamento');
  });

  it('2 h antes; prazo no passado ⇒ retoma já; sem booking ⇒ erro claro', () => {
    const ok = resolveBookingOffsetWait(
      { mode: 'booking_offset', offsetMinutes: -120 },
      FIXED, ADVANCED_LIMITS,
      { booking: { date: '2026-09-16', time: '13:00' } },
    );
    expect(ok.ok).toBe(true);
    const past = resolveBookingOffsetWait(
      { mode: 'booking_offset', offsetMinutes: -1440 },
      FIXED, ADVANCED_LIMITS,
      { booking: { date: '2026-09-10', time: '09:00' } },
    );
    expect(past.ok).toBe(true);
    expect(past.label).toContain('passou');
    const noBk = resolveBookingOffsetWait(
      { mode: 'booking_offset', offsetMinutes: -1440 },
      FIXED, ADVANCED_LIMITS, {},
    );
    expect(noBk.ok).toBe(false);
    const far = resolveBookingOffsetWait(
      { mode: 'booking_offset', offsetMinutes: -99999 },
      FIXED, ADVANCED_LIMITS,
      { booking: { date: '2026-09-20', time: '10:00' } },
    );
    expect(far.ok).toBe(false);
  });

  it('resolveWait delega booking_offset com contexto', () => {
    const res = resolveWait(
      { mode: 'booking_offset', offsetMinutes: -1440 },
      FIXED, ADVANCED_LIMITS,
      { booking: { date: '2026-09-20', time: '08:30' } },
    );
    expect(res.ok).toBe(true);
    expect(Date.parse(res.resumeAt)).toBe(Date.parse('2026-09-19T08:30'));
  });

  it('remarcação muda o alvo (recalcula do booking novo)', () => {
    const antes = resolveBookingOffsetWait(
      { mode: 'booking_offset', offsetMinutes: -1440 },
      FIXED, ADVANCED_LIMITS,
      { booking: { date: '2026-09-20', time: '10:00' } },
    );
    const depois = resolveBookingOffsetWait(
      { mode: 'booking_offset', offsetMinutes: -1440 },
      FIXED, ADVANCED_LIMITS,
      { booking: { date: '2026-09-25', time: '15:00' } },
    );
    expect(Date.parse(depois.resumeAt)).not.toBe(Date.parse(antes.resumeAt));
    expect(Date.parse(depois.resumeAt)).toBe(Date.parse('2026-09-24T15:00'));
  });
});

describe('F3-B — status draft/active/paused/archived', () => {
  it('statusOf deriva de active em docs antigos e preserva draft/archived', () => {
    expect(automationStatusOf({ active: true })).toBe('active');
    expect(automationStatusOf({ active: false })).toBe('paused');
    expect(automationStatusOf({ active: false, status: 'draft' })).toBe('draft');
    expect(automationStatusOf({ active: false, status: 'archived' })).toBe('archived');
    expect(automationStatusOf({ active: true, status: 'draft' })).toBe('draft');
  });
});
