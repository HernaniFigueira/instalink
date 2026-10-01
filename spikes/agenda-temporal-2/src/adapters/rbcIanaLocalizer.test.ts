import { Settings } from 'luxon';
import { describe, expect, it } from 'vitest';
import { createIanaLuxonLocalizer } from './rbcIanaLocalizer';

describe('RBC IANA localizer', () => {
  it('keeps simultaneous clinic zones isolated without mutating Luxon global settings', () => {
    const originalZone = Settings.defaultZone;
    Settings.defaultZone = 'Asia/Tokyo';
    try {
      const saoPaulo = createIanaLuxonLocalizer('America/Sao_Paulo');
      const losAngeles = createIanaLuxonLocalizer('America/Los_Angeles');
      const instant = new Date('2026-02-01T12:00:00.000Z');

      expect(saoPaulo.format(instant, 'yyyy-MM-dd HH:mm')).toBe('2026-02-01 09:00');
      expect(losAngeles.format(instant, 'yyyy-MM-dd HH:mm')).toBe('2026-02-01 04:00');
      expect(saoPaulo.getMinutesFromMidnight(instant)).toBe(9 * 60);
      expect(losAngeles.getMinutesFromMidnight(instant)).toBe(4 * 60);
      expect(saoPaulo.startOf(instant, 'day').toISOString()).toBe('2026-02-01T03:00:00.000Z');
      expect(losAngeles.startOf(instant, 'day').toISOString()).toBe('2026-02-01T08:00:00.000Z');
      expect(Settings.defaultZone.name).toBe('Asia/Tokyo');
    } finally {
      Settings.defaultZone = originalZone;
    }
  });

  it('rejects missing or invalid business zones instead of falling back to the host zone', () => {
    expect(() => createIanaLuxonLocalizer('')).toThrow('precisa ser informado explicitamente');
    expect(() => createIanaLuxonLocalizer('Not/A_Zone')).toThrow('Fuso IANA inválido');
  });
});
