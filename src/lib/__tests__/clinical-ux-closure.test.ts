import { readFileSync } from "node:fs";
import { describe, expect, it } from 'vitest';
import { snapGestureMinute, minuteFromOffsetY } from '../agenda-drag';
import { bookingTimezone, buildBookingWindow } from '../booking-temporal';
import { DEFAULT_TIMEZONE } from '../tz';

describe('Clinical UX — manual interaction, not Booking precision', () => {
  it.each([[547,540],[548,555],[562,555],[562.5,570],[563,570],[577,570],[578,585]])('nearest 15: %s → %s (half rounds up)', (input, output) => {
    expect(snapGestureMinute(input)).toBe(output);
    expect(minuteFromOffsetY(input, { startMinute:0,endMinute:1440,pxPerHour:60 })).toBe(output);
  });
  it('empty clinic timezone uses canonical default and 240 minutes remains 09:00–13:00', () => {
    expect(bookingTimezone('')).toBe(DEFAULT_TIMEZONE);
    const w = buildBookingWindow({ date:'2026-10-05',time:'09:00',durationMin:240,timeZone:bookingTimezone('') });
    expect(Date.parse(w.endAt)-Date.parse(w.startAt)).toBe(240*60000);
    expect(w.startAt).toBe('2026-10-05T12:00:00.000Z');
    expect(w.endAt).toBe('2026-10-05T16:00:00.000Z');
  });
});

// Focused final-polish guards: presentation only; no storage/API changes.
describe('PR53 final polish — Agenda, ShellAppearance, ClientProfileDrawer', () => {
  it('range and block-mode notice use active theme aliases, not blue utilities', () => {
    const agenda = readFileSync('src/app/(dashboard)/agenda/page.tsx', 'utf8');
    const range = agenda.split('\n').find(line => line.includes('data-testid="agenda-selected-range"'))!;
    const block = agenda.split('\n').find(line => line.includes('{blockMode &&'))!;
    for (const line of [range, block]) {
      expect(line).toContain('bg-[var(--brand-soft)]');
      expect(line).toContain('text-[var(--brand-fg)]');
      expect(line).not.toMatch(/(?:bg|border|text)-blue-/);
    }
    expect(range).toContain('border-[var(--brand)]');
    const status = readFileSync('src/lib/status.ts', 'utf8');
    expect(status).toContain('bg-[var(--fit-in)]');
    expect(status).toContain('text-[var(--fit-in-fg)]');
  });
  it('ShellAppearance honestly describes a personal browser preference', () => {
    const source = readFileSync('src/components/dashboard/ShellAppearance.tsx', 'utf8');
    expect(source).toContain('Aparência da interface');
    expect(source).toContain('Escolha a cor de acento das ações principais neste navegador.');
    expect(source).toContain('Esta preferência vale somente para você neste navegador e não altera a identidade visual da clínica para outros usuários.');
    expect(source).not.toContain('Tema da clínica:');
    expect(source).toContain('setNavAccent(a.id)');
  });
  it('ClientProfileDrawer drops unreachable access/consent handlers, not identity fields or live controls', () => {
    const source = readFileSync('src/components/dashboard/ClientProfileDrawer.tsx', 'utf8');
    expect(source).not.toMatch(/createAccess|setConsent|accessSaving|setAccessSaving|notice\.password|temporaryPassword/);
    expect(source).toContain("accountStatus: 'none' | 'active'");
    expect(source).toContain('marketingOptIn: boolean');
    expect(source).toContain('<Switch checked={draft.guardian.isMinor}');
    expect(source).toContain("apiSend<any>('/api/contacts', 'PATCH'");
  });
});
