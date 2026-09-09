import { describe, expect, it } from 'vitest';
import {
  BOOKING_STATUS, BOOKING_FLOW, ORDER_STATUS, ORDER_FLOW,
  LEAD_STATUS, LEAD_FLOW, canTransition,
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
