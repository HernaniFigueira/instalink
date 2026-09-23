import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AUTOMATION_EVENTS } from '@/lib/types';
import { AUTOMATION_EVENT_DEFS, automationEventLabel, isAutomationEvent } from '@/lib/automation/model';
import { bookingStatusEvent } from '@/lib/booking-status';

// ═══════════════════════════════════════════════════════════════
// FASE 3 · F3-A — Event Layer + runner durável (contrato)
// ═══════════════════════════════════════════════════════════════

const read = (p: string) => readFileSync(p, 'utf8');

describe('Event Layer · catálogo F3', () => {
  it('inclui os eventos do briefing (no_show, rescheduled, encounter, conversa, mensagem)', () => {
    const required = [
      'booking.no_show', 'booking.rescheduled',
      'encounter.started', 'encounter.completed',
      'followup.due', 'patient.inactive',
      'conversation.started', 'conversation.handoff',
      'message.received', 'message.sent',
    ];
    for (const id of required) {
      expect(AUTOMATION_EVENTS, id).toContain(id);
      expect(isAutomationEvent(id), id).toBe(true);
      expect(AUTOMATION_EVENT_DEFS.some((d) => d.id === id), id).toBe(true);
    }
  });

  it('defs têm label, hint, entity e source (rastreabilidade)', () => {
    for (const id of AUTOMATION_EVENTS) {
      const def = AUTOMATION_EVENT_DEFS.find((d) => d.id === id);
      expect(def, id).toBeTruthy();
      expect(def!.label.length, id).toBeGreaterThan(0);
      expect(def!.hint.length, id).toBeGreaterThan(0);
      expect(def!.source.length, id).toBeGreaterThan(0);
      expect(def!.entity, id).toBeTruthy();
      expect(automationEventLabel(id)).toBe(def!.label);
    }
  });

  it('lista de defs cobre 1:1 a união de eventos', () => {
    expect(new Set(AUTOMATION_EVENT_DEFS.map((d) => d.id)).size).toBe(AUTOMATION_EVENTS.length);
  });

  it('bookingStatusEvent mapeia no_show', () => {
    expect(bookingStatusEvent('no_show')).toBe('booking.no_show');
    expect(bookingStatusEvent('confirmed')).toBe('booking.confirmed');
    expect(bookingStatusEvent('pending')).toBeNull();
  });
});

describe('Event Layer · emissões nos serviços oficiais', () => {
  it('booking.rescheduled emitido nos dois caminhos de remarcação', () => {
    const t = read('src/app/api/bookings/route.ts');
    expect(t).toContain("event: 'booking.rescheduled'");
    expect(t).toContain("kind: 'recreate'");
    expect(t).toContain("kind: 'move'");
    // exatamente um emit por caminho (sem duplicidade)
    expect((t.match(/event: 'booking\.rescheduled'/g) || []).length).toBe(2);
  });

  it('encounter.started no POST e encounter.completed no finalize', () => {
    const t = read('src/app/api/encounters/route.ts');
    expect(t).toContain("event: 'encounter.started'");
    expect(t).toContain("event: 'encounter.completed'");
  });

  it('conversation.handoff só em takeover para humano', () => {
    const t = read('src/app/api/conversations/route.ts');
    expect(t).toContain("event: 'conversation.handoff'");
    expect(t).toMatch(/newMode === 'human' && prev !== 'human'/);
  });

  it('webhook emite conversation.started e message.received', () => {
    const t = read('src/app/api/whatsapp/webhook/route.ts');
    expect(t).toContain("event: 'conversation.started'");
    expect(t).toContain("event: 'message.received'");
  });

  it('message.sent emitido ao enfileirar outbound de automação', () => {
    const t = read('src/lib/automation/actions.ts');
    expect(t).toContain("event: 'message.sent'");
  });
});

describe('Runner durável · contrato documentado', () => {
  it('cron de automações + docs de eventos/runner existem', () => {
    expect(read('src/app/api/cron/automations/route.ts')).toContain('drainAutomations');
    const doc = read('docs/FASE3-EVENTS-RUNNER.md');
    expect(doc).toContain('waitingUntil');
    expect(doc).toContain('Vercel Workflow');
    expect(doc).toContain('FEITO com runner atual');
  });

  it('nenhum setTimeout longo no motor de automação', () => {
    const exec = read('src/lib/automation/executor.ts');
    // esperas são waitingUntil persistido, não timers de horas
    expect(exec).not.toMatch(/setTimeout\([^)]{0,40}\s*\*\s*3600/);
    expect(exec).toContain('waitingUntil');
  });
});
