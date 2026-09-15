import { describe, expect, it } from 'vitest';
import {
  ATTENTION_MARK_CLS, ATTENTION_RING_CLS,
  BOOKING_BLOCK, BOOKING_DOT, BOOKING_STATUS, BOOKING_FLOW, ORDER_STATUS, ORDER_FLOW,
  LEAD_STATUS, LEAD_FLOW, canTransition, toneCls,
} from '../status';

describe('rótulos', () => {
  it('todo status tem consumer/panel/desc/tone preenchidos', () => {
    for (const map of [BOOKING_STATUS, ORDER_STATUS, LEAD_STATUS]) {
      for (const def of Object.values(map)) {
        expect(def.consumer.length).toBeGreaterThan(0);
        expect(def.panel.length).toBeGreaterThan(0);
        expect(def.desc.length).toBeGreaterThan(0);
        expect(def.tone.length).toBeGreaterThan(0);
      }
    }
  });
  it('não existe status "na agenda" — é rótulo de confirmed', () => {
    expect('na_agenda' in BOOKING_STATUS).toBe(false);
    expect(BOOKING_STATUS.confirmed.consumer).toBe('Na agenda');
  });
});

describe('máquinas de estado', () => {
  it('booking: pending→confirmed→completed; sem pular para completed', () => {
    expect(canTransition(BOOKING_FLOW, 'pending', 'confirmed')).toBe(true);
    expect(canTransition(BOOKING_FLOW, 'confirmed', 'completed')).toBe(true);
    expect(canTransition(BOOKING_FLOW, 'pending', 'completed')).toBe(false);
    expect(canTransition(BOOKING_FLOW, 'completed', 'cancelled')).toBe(false);
  });
  it('order: avança em cadeia; completed é terminal', () => {
    expect(canTransition(ORDER_FLOW, 'new', 'accepted')).toBe(true);
    expect(canTransition(ORDER_FLOW, 'new', 'ready')).toBe(false);
    expect(canTransition(ORDER_FLOW, 'completed', 'new')).toBe(false);
  });
  it('lead: new avança; converted não volta para new', () => {
    expect(canTransition(LEAD_FLOW, 'new', 'contacted')).toBe(true);
    expect(canTransition(LEAD_FLOW, 'converted', 'new')).toBe(false);
  });
});

describe('apresentação dos estados (P1 — cor = estado)', () => {
  it('agenda usa significado fixo: pendente=laranja, confirmado=verde, concluído=azul, faltou=cinza, cancelado=vermelho', () => {
    expect(BOOKING_STATUS.pending.tone).toBe('orange');
    expect(BOOKING_STATUS.confirmed.tone).toBe('emerald');
    expect(BOOKING_STATUS.completed.tone).toBe('blue');
    expect(BOOKING_STATUS.no_show.tone).toBe('zinc');
    expect(BOOKING_STATUS.cancelled.tone).toBe('red');
  });

  it('todo tom rende selo sólido (bg presente, sem aparência apagada)', () => {
    for (const tone of ['amber', 'orange', 'yellow', 'emerald', 'blue', 'zinc', 'red', 'purple'] as const) {
      const cls = toneCls(tone);
      expect(cls).toMatch(/bg-\S+-600|bg-\S+-500|bg-yellow-400/);
      expect(cls).toMatch(/text-(white|yellow-950)/);
    }
  });

  it('cada status de agendamento tem bloco e ponto próprios e distintos', () => {
    const statuses = Object.keys(BOOKING_STATUS);
    expect(new Set(statuses.map((s) => BOOKING_BLOCK[s as keyof typeof BOOKING_BLOCK])).size).toBe(statuses.length);
    expect(new Set(statuses.map((s) => BOOKING_DOT[s as keyof typeof BOOKING_DOT])).size).toBe(statuses.length);
  });

  it('pendência de fechamento tem marcador de atenção próprio (não é status)', () => {
    expect(ATTENTION_RING_CLS.length).toBeGreaterThan(0);
    expect(ATTENTION_MARK_CLS.length).toBeGreaterThan(0);
    expect('needs_closure' in BOOKING_STATUS).toBe(false);
  });
});
