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
